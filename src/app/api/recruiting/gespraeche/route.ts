import { type NextRequest, type NextResponse } from 'next/server';
import { planeGespraech, RecruitingFehler } from '@/server/services/recruiting/dienst';
import { planEingabe } from '@/server/services/zeit/formulareingabe';
import { fuehreRecruitingAus } from '../gemeinsam';
import { UUID } from '../../rumpf';

/**
 * `POST /api/recruiting/gespraeche` — einen Gesprächstermin anlegen
 * (REC-06, CAL-01).
 *
 * **Auch diese Route hat gefehlt.** `planeGespraech` stand im Dienst, die
 * Liste `/recruiting/gespraeche` stand da und versprach in ihrer Leerseite
 * einen Knopf auf dem Bewerbungsblatt — und im ganzen API-Baum rief niemand
 * die Funktion. Ein Termin konnte damit nur aus dem Seed kommen; REC-06 war
 * für einen Menschen nicht ausführbar. Gemeldet hat das die Copilot-Runde auf
 * PR 16.
 *
 * **Die Uhr ist die des Servers** (Invariante 5). Das Formular schickt eine
 * Berliner Ortszeit ohne Zone; `planEingabe` übersetzt sie in einen Instant
 * und weist einen Tag ab, den der Kalender nicht kennt. Gegen `now()` aus der
 * DATENBANK wird danach geprüft — ein Gerät mit falscher Uhr legt damit
 * keinen Termin in die Vergangenheit.
 */
export const dynamic = 'force-dynamic';

/** Fünf Minuten bis vier Stunden. Alles darunter ist kein Gespräch. */
const DAUER_MIN = 5;
const DAUER_MAX = 240;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreRecruitingAus(anfrage, {
    /*
     * **BEIDE Rechte, und beide hier.**
     *
     * Hier stand nur `recruiting.bewerbung_lesen`, mit der Begründung, das
     * zweite Recht des Bildschirms (`kalender.schreiben`, Routenmanifest)
     * bewache die Seite. Das war falsch herum gedacht: eine Anfrage an diese
     * Adresse geht nicht durch die Seite. `mandantTor` läuft nie, und wer
     * gleichen Ursprungs POSTet — ein zweiter Tab genügt — legt den Termin
     * an, ohne den Kalender beschreiben zu dürfen. Die Policy
     * `t_gespraech_schreiben` (0166) prüft dasselbe eine Ebene tiefer nicht
     * nach. Gemeldet hat das die Copilot-Runde auf PR 16.
     *
     * Ein Gespräch IST ein Kalendertermin (es steht seit dieser Runde auch im
     * Kalender, `services/kalender/eintraege.ts`). Wer Termine dieser
     * Gesellschaft nicht setzen darf, setzt auch diesen nicht.
     */
    recht: 'recruiting.bewerbung_lesen',
    weitereRechte: ['kalender.schreiben'],
    handle: async (kontext, rumpf) => {
      const bewerbungId = rumpf.felder['bewerbung'] ?? '';
      if (!UUID.test(bewerbungId)) {
        throw new RecruitingFehler('Diese Bewerbung gibt es nicht.', 'unbekannt', 404);
      }
      const gelesen = planEingabe(rumpf.felder['termin'] ?? '');
      if (!(gelesen instanceof Date)) {
        throw new RecruitingFehler(gelesen.satz, gelesen.grund, 400);
      }
      const [jetzt] = await kontext.abfrage<{ t: Date }>(`select now() as t`);
      if (jetzt === undefined) {
        throw new RecruitingFehler('Die Serverzeit war nicht zu lesen.', 'keine_serverzeit', 500);
      }
      if (gelesen.getTime() <= jetzt.t.getTime()) {
        throw new RecruitingFehler(
          'Der Termin liegt nicht in der Zukunft. Ein Gespräch rückwirkend zu planen '
          + 'ist keine Einladung, sondern ein Versehen mit Verzögerung.',
          'vergangenheit', 400);
      }

      const dauerRoh = (rumpf.felder['dauer'] ?? '').trim();
      const dauer = dauerRoh === '' ? 60 : Number(dauerRoh);
      if (!Number.isInteger(dauer) || dauer < DAUER_MIN || dauer > DAUER_MAX) {
        throw new RecruitingFehler(
          `Die Dauer liegt zwischen ${String(DAUER_MIN)} und ${String(DAUER_MAX)} Minuten.`,
          'unbrauchbare_dauer', 400);
      }

      const ortRoh = (rumpf.felder['ort'] ?? '').trim();
      /*
       * Je Zeile eine Frage — dieselbe Form wie bei den Anforderungen einer
       * Stelle, und aus demselben Grund: was einzeln gestellt wird, soll
       * einzeln dastehen und nicht als Fliesstext, den niemand abhaken kann
       * (REC-06).
       */
      const fragen = (rumpf.felder['fragen'] ?? '')
        .split('\n').map((z) => z.trim()).filter((z) => z !== '');

      await planeGespraech(
        kontext, bewerbungId, gelesen, dauer, ortRoh === '' ? null : ortRoh, fragen);
      return bewerbungId;
    },
    ziel: (slug, id) => `/portal/${slug}/recruiting/bewerbungen/${id}?termin=1`,
  });
}
