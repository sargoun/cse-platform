import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { meldeAbwesenheit } from '@/server/services/abwesenheit/index';

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

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
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
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const anstellungId = textOder(daten, 'anstellung');
  const abwesenheitsartId = textOder(daten, 'abwesenheitsart');
  const von = textOder(daten, 'von');
  const bis = textOder(daten, 'bis');

  if (anstellungId === null || !UUID.test(anstellungId)) {
    return NextResponse.json({ fehler: 'keine_anstellung' }, { status: 400 });
  }
  if (abwesenheitsartId === null || !UUID.test(abwesenheitsartId)) {
    return NextResponse.json({ fehler: 'keine_art' }, { status: 400 });
  }
  if (von === null || bis === null || !DATUM.test(von) || !DATUM.test(bis)) {
    return NextResponse.json({ fehler: 'kein_datum' }, { status: 400 });
  }

  const auBis = textOder(daten, 'au_bis');
  if (auBis !== null && !DATUM.test(auBis)) {
    return NextResponse.json({ fehler: 'kein_datum' }, { status: 400 });
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
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    /*
     * Die Ausschlussbedingung `abwesenheit_kein_ueberlapp` (0073) meldet sich
     * als `23P01`. Zwei Abwesenheiten derselben Anstellung im selben Zeitraum
     * sind kein Serverfehler, sondern die haeufigste Eingabe am Telefon: der
     * Mensch hat sich gestern schon gemeldet.
     */
    if (code === '23P01') {
      /*
       * **Zurueck auf das Formular, nicht als JSON.** Die Portalformulare
       * laufen ohne JavaScript; eine JSON-Antwort mit 409 waere fuer den
       * Menschen am Telefon eine weisse Seite mit geschweiften Klammern. Der
       * Weg fuehrt auf die Aufnahmeseite, die den Satz dazu kennt.
       */
      const weg = textOder(daten, 'fehlerweg');
      if (weg !== null) {
        const ziel = new URL(internesZiel(weg, '/portal', anfrage));
        ziel.searchParams.set('fehler', 'ueberlappt');
        return NextResponse.redirect(ziel, 303);
      }
      return NextResponse.json({ fehler: 'ueberlappt' }, { status: 409 });
    }
    if (typeof status === 'number' && typeof code === 'string') {
      return NextResponse.json(
        { fehler: code, meldung: (fehler as Error).message }, { status });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
