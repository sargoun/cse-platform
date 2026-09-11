import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  buche, istEmpfaengerArt, istEreignis,
} from '@/server/services/security/schluessel';
import { alsAntwort } from '../../../antwort';
import { feldText as text } from '../../../formular';

/**
 * `POST /api/sicherheit/schluessel/[id]/quittung` — eine Journalzeile
 * schreiben (SEC-07, TIM-08, LEG-01).
 *
 * **Alle acht Ereignisse über EINE Adresse.** Übergabe, Rücknahme,
 * Verlustmeldung, Wiederauffinden, Sperrung, Entsperrung, Vernichtung und
 * Inventur brauchen dieselbe Sitzung, denselben Ursprungscheck, denselben
 * Mandantenkontext und dasselbe Recht — und alle acht sind dieselbe Zeile in
 * derselben Tabelle. Acht Adressen wären acht Stellen, an denen die Prüfung
 * fehlen kann.
 *
 * **Die Zeit kommt nicht von hier.** Der Server stempelt `quittiert_am` im
 * Auslöser (0079 §5); was das Formular mitschickt, ist höchstens
 * `geraete_zeit` — eine Behauptung, die daneben gespeichert wird und nie an
 * die Stelle der Serverzeit tritt (Invariante 5, TIM-08).
 *
 * **Die zweite Übergabe ohne Rücknahme weist die DATENBANK ab**
 * (`sq_offene_ausgabe_uk`, Abnahme 4). Der Dienst übersetzt den
 * Eindeutigkeitsverstoss in einen Satz; abgelehnt hat ihn der Index, und zwar
 * auch für einen Weg, der diese Adresse nicht benutzt.
 *
 * **Die Unterschrift ist heute ein NAME.** Das Bild vom Bildschirm braucht
 * `POST /api/dokumente/upload-ticket` und eine Zeile im geschlossenen Register
 * `einsatz_medien_bezug`; beides gibt es für `schluessel_quittung` nicht, und
 * die Oberfläche sagt das, statt einen Erfolg vorzutäuschen (D-232).
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest,
  kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const { id } = await kontextParam.params;
  const daten = await anfrage.formData();
  const mandant = String(daten.get('mandant') ?? '');
  const art = daten.get('art');
  if (!istEreignis(art)) {
    return NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 });
  }
  const empfaengerArt = daten.get('empfaenger_art');

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'schluessel.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return buche(kontext, {
          schluesselId: id,
          art,
          empfaengerArt: istEmpfaengerArt(empfaengerArt) ? empfaengerArt : null,
          anstellungId: text(daten, 'anstellung'),
          kundeId: text(daten, 'kunde'),
          firmaId: text(daten, 'firma'),
          empfaengerName: text(daten, 'empfaenger_name'),
          unterzeichnerName: text(daten, 'unterzeichner'),
          geplanteRueckgabe: text(daten, 'geplante_rueckgabe'),
          aufhebtQuittungId: text(daten, 'aufhebt'),
          bemerkung: text(daten, 'bemerkung'),
          /**
           * Die Geräteuhr wandert MIT, wenn die Oberfläche sie kennt — und
           * wird sofort als Abweichung verrechnet (TIM-08). Sie zu
           * verschweigen wäre bequemer und nähme der Auswertung genau die
           * Tatsache, für die Invariante 5 die Spalte verlangt.
           */
          geraeteZeit: text(daten, 'geraete_zeit'),
          nachgetragen: daten.get('nachgetragen') === '1',
        });
      }));
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/security/schluessel/${id}`,
      anfrage,
    ),
    303,
  );
}
