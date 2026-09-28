import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { KeineAnstellungFehler, mandantDerAnstellung }
  from '@/server/services/zeit/einwand';
import {
  AbwesenheitNichtGefunden, ArtUngeklaertFehler, AuBisVorBeginn, meldeAbwesenheit,
} from '@/server/services/abwesenheit/index';
import { ZeitraumFehler } from '@/server/services/abwesenheit/tage';
import { grundAufsFormularweg, type FormularRueckweg } from '@/app/api/formular-antwort';
import { datenbankGrund, datenbankStatus } from '../formular';

/**
 * `POST /api/mein/abwesenheit` — der Mensch meldet eine Abwesenheit (EMP-10).
 *
 * **Dies ist der eine Schreibweg im Mitarbeiterportal, der ein RECHT
 * verlangt**, und zwar `zeit.abwesenheit_melden` (SEITENKARTE §7). Es ist das
 * einzige Schreibrecht, das die Rolle `mitarbeiter` von Haus aus haelt — und
 * die INSERT-Policy auf `abwesenheit` prueft denselben Schluessel noch einmal,
 * unabhaengig von dieser Datei (AUT-05: zwei Linien, nie eine).
 *
 * **Eine MELDUNG, kein Antrag.** Die Seitenkarte fuehrt zwei verschiedene
 * Wege: `/portal/mein/abwesenheit/neu` ist die „sickness or absence report",
 * `/portal/mein/antraege/neu` der „leave request or shift swap". Deshalb
 * entsteht hier eine Abwesenheit im Zustand, den der Dienst fuer eine Meldung
 * vorsieht (`erfasst` — zur Kenntnis genommen), und kein Vorgang, ueber den
 * noch jemand entscheiden muesste. Wer Urlaub will, stellt einen Antrag.
 *
 * **Der Grund bleibt drin, wo er hingehoert.** `bemerkung`, `au_*` und
 * `dokument_id` darf `cse_app` schreiben und NICHT lesen (0073, Art. 9 DSGVO).
 * Diese Route reicht sie durch, und keine Antwort gibt sie zurueck.
 *
 * **Der aktive Mandant der Sitzung ist nicht zwingend der der Meldung.** Ein
 * Mensch mit zwei Beschaeftigungen meldet sich bei EINER Gesellschaft ab
 * (D-09, O-209); welche das ist, sagt die gewaehlte Beschaeftigung, und der
 * Mandant wird daraus serverseitig abgeleitet (K-02). `authorize` bekommt
 * deshalb genau diesen Mandanten als aktiven — geprueft wird die
 * Mitgliedschaft des Menschen DORT, nicht anderswo.
 *
 * **Jede Abweisung fuehrt auf die Maske zurueck** (V-188, V-198, D-599,
 * D-692). Vorher kamen die Abweisungen der Route als JSON, und die der
 * DATENBANK gar nicht: die doppelte Meldung (`ab_keine_dublette`, 23P01) und
 * die Bescheinigung vor dem ersten Tag (`ab_au_bis`, 23514) trugen keinen
 * `status`, wurden weitergeworfen und endeten als rohe 500 — ausgerechnet auf
 * dem Weg, den jemand morgens krank vom Telefon aus nimmt. Die Buero-Route
 * kannte die doppelte Meldung schon als „die haeufigste Eingabe am Telefon";
 * dieser Weg nicht. Die Bescheinigung prueft jetzt der Dienst VOR dem
 * Schreiben (`AuBisVorBeginn`), die Datenbank bleibt die zweite Linie. Der Weg
 * zurueck ist `grundAufsFormularweg`: der Grund als `?fehler=`, die gewaehlten
 * Werte dazu, und ein Aufruf ohne `fehlerweg` und `zurueck` ist ein Programm
 * und bekommt JSON mit Status.
 */
export const dynamic = 'force-dynamic';

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
/** Die Maske, auf die jede Abweisung zurueckfuehrt — das einzige Formular dieses Wegs. */
const MASKE = '/portal/mein/abwesenheit/neu';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

function uuidOder(daten: FormData, feld: string): string | null {
  const wert = textOder(daten, feld);
  return wert !== null && UUID.test(wert) ? wert : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (sitzung.personId === null || sitzung.personId === '') {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const anstellungId = uuidOder(daten, 'anstellung');
  const abwesenheitsartId = uuidOder(daten, 'abwesenheitsart');
  const von = textOder(daten, 'von');
  const bis = textOder(daten, 'bis');
  const auBis = textOder(daten, 'au_bis');
  const ja = (feld: string): string | null => (daten.get(feld) === 'ja' ? 'ja' : null);
  /*
   * Was zurueckreist: Auswahlen, Tage und Haken — die Bemerkung NICHT. Sie
   * darf `cse_app` nicht einmal lesen (0073, Art. 9 DSGVO), und eine Adresse
   * landet in Verlauf und Protokollen. Die Maske bittet darum, sie noch einmal
   * einzugeben.
   */
  const rueckweg: FormularRueckweg = {
    maske: MASKE,
    werte: {
      anstellung: anstellungId, abwesenheitsart: abwesenheitsartId, von, bis,
      von_halbtags: ja('von_halbtags'), bis_halbtags: ja('bis_halbtags'),
      au_vorliegt: ja('au_vorliegt'), au_bis: auBis,
      bemerkung_neu: textOder(daten, 'bemerkung') === null ? null : 'ja',
    },
  };
  if (anstellungId === null) {
    return grundAufsFormularweg(anfrage, daten, 'keine_anstellung', 400, rueckweg);
  }
  if (abwesenheitsartId === null) {
    return grundAufsFormularweg(anfrage, daten, 'keine_art', 400, rueckweg);
  }
  if (von === null || bis === null || !DATUM.test(von) || !DATUM.test(bis)
      || (auBis !== null && !DATUM.test(auBis))) {
    return grundAufsFormularweg(anfrage, daten, 'kein_datum', 400, rueckweg);
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) => {
      const mandantId = await withPersonScope(tx, sitzung, async (kontext) =>
        mandantDerAnstellung(kontext, anstellungId));

      const imMandanten: Sitzung = {
        ...sitzung, ansicht: 'mandant', aktiverMandantId: mandantId, portal: 'mitarbeiter',
      };
      return withTenant(tx, imMandanten, async (kontext) => {
        await authorize(
          {
            benutzerId: imMandanten.benutzerId,
            personId: imMandanten.personId,
            aktiverMandantId: mandantId,
            ansicht: 'mandant',
            aal: imMandanten.aal,
            portal: 'mitarbeiter',
            sitzungId: imMandanten.sitzungId,
          },
          { recht: 'zeit.abwesenheit_melden', mandantId, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return meldeAbwesenheit(kontext, {
          anstellungId,
          abwesenheitsartId,
          von,
          bis,
          vonHalbtags: daten.get('von_halbtags') === 'ja',
          bisHalbtags: daten.get('bis_halbtags') === 'ja',
          bemerkung: textOder(daten, 'bemerkung'),
          auBescheinigungVorliegt: daten.get('au_vorliegt') === 'ja',
          auBis,
        });
      });
    });
  } catch (fehler) {
    if (fehler instanceof KeineAnstellungFehler) {
      /*
       * Eine Beschäftigung, die es für diese Anmeldung nicht (mehr) gibt —
       * fremd (AUT-06: dieselbe Antwort wie „gibt es nicht") oder beendet,
       * während das Formular offen war. Zurück aufs Formular (V-198).
       */
      return grundAufsFormularweg(anfrage, daten, 'nicht_gefunden', 404, rueckweg);
    }
    /*
     * Ein fehlendes Recht sieht auf jeder schreibenden Route gleich aus — ein
     * 404, byte-gleich, auch hinter einem Browserformular (D-656 Nr. 2,
     * D-682 Nr. 2).
     */
    const auth = autorisierungsAntwort(fehler);
    if (auth !== null) return auth;
    /*
     * Die Abweisungen des Dienstes behalten ihren Grund (V-188): „Fuer diese
     * Art ist nicht hinterlegt, ob sie bezahlt ist" (O-139) ist eine Auskunft
     * und kein Serverfehler — und sie gehoert auf die Seite des Formulars, in
     * der Sprache der Person (V-198); das Formular bietet genau diese Arten
     * an, als ungeklaert markiert. Eine Art, die es nicht (mehr) gibt, ist
     * beim MELDEN keine fehlende Abwesenheit, sondern eine Auswahl, die nicht
     * mehr geht.
     */
    if (fehler instanceof ArtUngeklaertFehler) {
      return grundAufsFormularweg(anfrage, daten, 'art_ungeklaert', fehler.status, rueckweg);
    }
    if (fehler instanceof AbwesenheitNichtGefunden) {
      return grundAufsFormularweg(anfrage, daten, 'art_nicht_waehlbar', fehler.status, rueckweg);
    }
    if (fehler instanceof ZeitraumFehler || fehler instanceof AuBisVorBeginn) {
      return grundAufsFormularweg(anfrage, daten, fehler.grund, fehler.status, rueckweg);
    }
    // Die zweite Linie: Ausschluss (die doppelte Meldung), Pruefbedingung, Kalender.
    const ausDatenbank = datenbankGrund(fehler);
    if (ausDatenbank !== null) {
      return grundAufsFormularweg(
        anfrage, daten, ausDatenbank, datenbankStatus(ausDatenbank), rueckweg);
    }
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      return grundAufsFormularweg(anfrage, daten, code, status, rueckweg);
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal/mein/antraege', anfrage),
    303,
  );
}
