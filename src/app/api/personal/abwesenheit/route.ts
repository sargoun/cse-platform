import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { istGueltigerKalendertag } from '@/lib/datum/kalendertag';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';
import {
  autorisierungsAntwort, nichtGefundenAntwort, ohneSitzungAntwort,
} from '@/server/auth/antwort';
import {
  AbwesenheitNichtGefunden, ArtUngeklaertFehler, AuBisVorBeginn, meldeAbwesenheit,
} from '@/server/services/abwesenheit/index';
import { ZeitraumFehler } from '@/server/services/abwesenheit/tage';

/**
 * `POST /api/personal/abwesenheit` — die Krankmeldung am Telefon um 05:40
 * (V-025, EMP-09).
 *
 * **Der Befund.** `meldeAbwesenheit` trägt im Kopf wörtlich „der Weg der
 * Planung (die Krankmeldung am Telefon um 05:40)" — und hing an genau einem
 * Aufrufer: `/api/mein/abwesenheit`, der Route der Arbeiterin selbst. Wer um
 * 05:40 anruft, hat kein Telefon in der Hand, mit dem er sich krank meldet;
 * das ist der Grund, warum er anruft. Die Verwaltung konnte genehmigen,
 * ablehnen, stornieren — und nichts aufnehmen.
 *
 * **Kein neues Recht und keine neue Policy.** `t_mandant_schreiben` auf
 * `abwesenheit` (0073) verlangt `zeit.abwesenheit_melden`, und das hält
 * `admin` wie `leitung` seit je. Gefehlt hat nur der Weg.
 *
 * **Die Anstellung muss nicht geprüft werden — sie ist geprüft.** Der
 * zusammengesetzte Fremdschlüssel `ab_anstellung_fk (mandant_id,
 * anstellung_id)` lässt keine Anstellung einer anderen Gesellschaft zu. Eine
 * Prüfung hier stünde ein zweites Mal da und ginge beim nächsten Aufrufer
 * verloren.
 */
export const dynamic = 'force-dynamic';

/*
 * Ein Tag ist ein Kalendertag, den es gibt — `istGueltigerKalendertag`, nicht
 * nur das Muster `JJJJ-MM-TT` (D-771 Nachtrag). Das Muster allein liess
 * `2025-02-31` bis an ein `::date` durch, und die Datenbank antwortete mit
 * 22008 — hier eine 500 statt des Grundes, den die Route für ein unlesbares
 * Datum schon hat.
 */
/*
 * **Ein Formular bekommt auch bei einem frühen Eingabefehler seinen Rückweg**
 * (D-599, D-766, V-273): `grundAufsFormularweg` führt mit `fehlerweg` (sonst
 * `zurueck`) und dem Grund als `?fehler=` zurück auf die Seite, die den Satz
 * dazu kennt. Vorher kam hier JSON — auf einem Formular ohne JavaScript eine
 * weisse Seite mit geschweiften Klammern. Ein Aufruf ohne beide Felder ist
 * ein Programm und bekommt weiter `{ fehler }` mit 400.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const anstellungId = textOder(daten, 'anstellung');
  const abwesenheitsartId = textOder(daten, 'abwesenheitsart');
  const von = textOder(daten, 'von');
  const bis = textOder(daten, 'bis');

  if (anstellungId === null || !UUID.test(anstellungId)) {
    return grundAufsFormularweg(anfrage, daten, 'keine_anstellung', 400);
  }
  if (abwesenheitsartId === null || !UUID.test(abwesenheitsartId)) {
    return grundAufsFormularweg(anfrage, daten, 'keine_art', 400);
  }
  if (von === null || bis === null
      || !istGueltigerKalendertag(von) || !istGueltigerKalendertag(bis)) {
    return grundAufsFormularweg(anfrage, daten, 'kein_datum', 400);
  }

  const auBis = textOder(daten, 'au_bis');
  if (auBis !== null && !istGueltigerKalendertag(auBis)) {
    return grundAufsFormularweg(anfrage, daten, 'kein_datum', 400);
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'zeit.abwesenheit_melden', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /*
         * **`status` bleibt der Vorgabewert `erfasst`** — genau wie auf dem
         * Weg der Arbeiterin. Eine Krankmeldung wird zur Kenntnis genommen,
         * nicht genehmigt; `beantragt` hiesse, jemand entscheide noch
         * darueber, und niemand entscheidet ueber eine Krankheit.
         *
         * // TODO(client, O-893): Darf die Verwaltung einen URLAUBSANTRAG im
         * Namen einer Arbeiterin stellen — und wer gilt dann als Antragsteller?
         */
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
      }));
  } catch (fehler) {
    const auth = autorisierungsAntwort(fehler, anfrage);
    if (auth !== null) return auth;
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    /*
     * **Ein Formular kommt mit seinem Grund zurück, ein Programm bekommt JSON**
     * (D-599, D-766, V-273). Formular heisst: `fehlerweg`, sonst `zurueck` —
     * dieselbe Regel wie für die frühen Eingabefehler oben
     * (`grundAufsFormularweg`). Vorher galt hier nur `fehlerweg`, und die
     * allgemeine Weiche unten antwortete auch einem Formular mit JSON.
     */
    const weg = textOder(daten, 'fehlerweg') ?? textOder(daten, 'zurueck');
    const aufsFormular = (g: string): NextResponse | null => {
      if (weg === null) return null;
      const ziel = new URL(internesZiel(weg, '/portal', anfrage));
      ziel.searchParams.set('fehler', g);
      return NextResponse.redirect(ziel, 303);
    };
    /*
     * **Zeitraum und Bescheinigung** (V-188): „Bis" vor „Von", mehr als ein
     * Jahr, „Bescheinigung gültig bis" vor dem ersten Tag. Der Dienst nennt
     * den Grund (`ZeitraumFehler.grund`, `AuBisVorBeginn`); ein `23514` der
     * Datenbank (`ab_zeitraum`, `ab_au_bis`) ist die zweite Linie und endete
     * vorher als 500. Alle drei fuehren auf die Aufnahmeseite zurueck.
     */
    const grund = fehler instanceof ZeitraumFehler || fehler instanceof AuBisVorBeginn
      ? fehler.grund
      : code === '23514' ? 'ungueltige_eingabe' : null;
    if (grund !== null) {
      return aufsFormular(grund) ?? NextResponse.json({ fehler: grund }, { status: 400 });
    }
    /*
     * Die Ausschlussbedingung `abwesenheit_kein_ueberlapp` (0073) meldet sich
     * als `23P01`. Zwei Abwesenheiten derselben Anstellung im selben Zeitraum
     * sind kein Serverfehler, sondern die haeufigste Eingabe am Telefon: der
     * Mensch hat sich gestern schon gemeldet.
     *
     * **Zurueck auf das Formular, nicht als JSON.** Die Portalformulare
     * laufen ohne JavaScript; eine JSON-Antwort mit 409 waere fuer den
     * Menschen am Telefon eine weisse Seite mit geschweiften Klammern. Der
     * Weg fuehrt auf die Aufnahmeseite, die den Satz dazu kennt.
     */
    if (code === '23P01') {
      return aufsFormular('ueberlappt')
        ?? NextResponse.json({ fehler: 'ueberlappt' }, { status: 409 });
    }
    /*
     * **Die Art und die Anstellung** (V-273, D-771 Nr. 15) — dieselben Gründe
     * wie `mein/abwesenheit`. `pruefeArt` weist eine Art ab, die es nicht
     * (mehr) gibt (`AbwesenheitNichtGefunden` → `art_nicht_waehlbar`), oder
     * eine, deren Bezahlung nicht hinterlegt ist (`ArtUngeklaertFehler` →
     * `art_ungeklaert`, O-139). Die Sätze der Klassen nennen die Art bzw.
     * ihre Kennung und gehen deshalb nur an ein Programm, unten in der
     * allgemeinen Weiche (D-599).
     * Eine Anstellung, die es in dieser Gesellschaft nicht gibt, meldet der
     * Fremdschlüssel `ab_anstellung_fk` (0073) als 23503: `nicht_gefunden`,
     * für ein Programm die byte-gleiche 404 (AUT-06) — vorher eine 500.
     */
    if (fehler instanceof ArtUngeklaertFehler || fehler instanceof AbwesenheitNichtGefunden) {
      const zurueck = aufsFormular(
        fehler instanceof ArtUngeklaertFehler ? 'art_ungeklaert' : 'art_nicht_waehlbar');
      if (zurueck !== null) return zurueck;
    }
    if (code === '23503'
        && (fehler as { constraint_name?: unknown }).constraint_name === 'ab_anstellung_fk') {
      return aufsFormular('nicht_gefunden') ?? nichtGefundenAntwort();
    }
    if (typeof status === 'number' && typeof code === 'string') {
      /* Ein Formular bekommt den Code als Grund (die Seite hat einen allgemeinen
         Satz dafür), ein Programm Code und Satz. */
      return aufsFormular(code) ?? NextResponse.json(
        { fehler: code, meldung: (fehler as Error).message }, { status });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
