import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { FensterFehler, erhebeEinspruch, nimmZurueck }
  from '@/server/services/freigabe/stapel';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/freigaben/fenster` — Einspruch (APR-05) und Rücknahme (APR-06).
 *
 * **Zwei Handlungen an einer Adresse, weil sie dieselbe Form haben**: eine
 * Freigabe, ein Grund, ein Fenster, das laufen muss. Die Datenbank prüft
 * beides ein zweites Mal — zwischen dem Anzeigen eines Knopfes und seinem
 * Drücken vergeht Zeit, und ein Fenster kann in dieser Zeit zugehen.
 *
 * **Beide brauchen einen Grund.** Wer eine gefallene Entscheidung zurückholt,
 * schuldet den anderen Beteiligten eine Erklärung; in einem halben Jahr ist
 * „warum wurde das damals gestoppt" eine echte Frage.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Wohin eine ABGEWIESENE Handlung zurueckgeht — aus einem GESCHLOSSENEN Satz.
 *
 * **Der Befund, der das gebracht hat.** Diese Route leitete in allen drei
 * Ausgaengen fest auf die Detailseite `/portal/{mandant}/freigaben/{id}` um.
 * Die beiden Unterseiten `/einspruch` und `/rueckgaengig` tragen aber ihr
 * eigenes Formular, und die Detailseite wertet `?fehler=grund` und
 * `?fehler=fenster` gar nicht aus (sie kennt nur `fehler=ausfuehrung`): jede
 * Fehlermeldung dieser zwei Seiten verschwand spurlos. Wer einen zu kurzen
 * Grund eintippte, landete auf einer Seite, die nichts dazu sagte, und
 * konnte nur raten.
 *
 * **Der ERFOLG geht weiter auf die Detailseite** — und das bleibt so. Nach
 * einem Einspruch ist die Freigabe widerrufen, nach einer Ruecknahme die
 * Ausfuehrung zurueckgedreht; die Unterseite waere danach leer, und was
 * jetzt gilt, steht auf der Detailseite. Genau dieselbe Aufteilung wie bei
 * `/api/vergabe/einreichung`: Fehler zum Formular, Erfolg zum Ergebnis.
 *
 * **Und der Name wird aufgeloest, nicht eingesetzt.** Das Formular schickt
 * `einspruch` oder `ruecknahme`, nie einen Pfad — sonst waere das Feld eine
 * offene Weiterleitung.
 */
const FORMULARSEITE: Readonly<Record<string, string>> = {
  einspruch: 'einspruch',
  ruecknahme: 'rueckgaengig',
};

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const mandant = (String(daten.get('mandant') ?? '')).replace(/[^a-z0-9-]/gu, '');
  const freigabe = String(daten.get('freigabe') ?? '');
  const was = String(daten.get('was') ?? '');
  const grund = String(daten.get('grund') ?? '').trim();
  if (!UUID.test(freigabe)) {
    return NextResponse.json({ fehler: 'unbekannte_freigabe' }, { status: 400 });
  }
  const seite = `/portal/${mandant}/freigaben/${freigabe}`;
  if (was !== 'einspruch' && was !== 'ruecknahme') {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  /*
   * Kam das Formular von einer Unterseite, gehen Absagen DORTHIN zurueck —
   * mit der Eingabe im Blick und einem Satz dazu. Ohne `zurueck` ist die
   * Detailseite das Ziel, wie fuer ihr eingebettetes Formular.
   */
  const unterseite = FORMULARSEITE[String(daten.get('zurueck') ?? '')];
  const formular = unterseite === undefined ? seite : `${seite}/${unterseite}`;
  if (grund.length < 5) {
    return NextResponse.redirect(
      internesZiel(`${formular}?fehler=grund`, formular, anfrage), 303);
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /*
         * Einspruch und Rücknahme sind im Katalog zwei eigene, bindbare
         * Rechte — und nicht dasselbe wie „darf entscheiden".
         */
        await authorize(sitzung, {
          recht: was === 'einspruch' ? 'freigabe.einspruch_erheben' : 'freigabe.rueckgaengig',
          schreibend: true,
        }, rechtepruefer(kontext.abfrage.bind(kontext)));
        if (was === 'einspruch') await erhebeEinspruch(kontext, freigabe, grund);
        else await nimmZurueck(kontext, freigabe, grund);
      }));
  } catch (fehler) {
    if (fehler instanceof FensterFehler) {
      /*
       * **Der Code der Absage, nicht immer „Fenster".** Ein fehlendes
       * `erforderliches_recht` der Zeile weist `app.freigabe_einspruch`
       * mit `insufficient_privilege` ab; das als abgelaufene Frist
       * auszugeben liess den Menschen auf ein naechstes Fenster warten,
       * das ihm nie geholfen haette.
       */
      return NextResponse.redirect(
        internesZiel(`${formular}?fehler=${fehler.code}`, formular, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${seite}?vermerkt=${was}`, seite, anfrage), 303);
}
