import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import {
  KeinBenutzerkontoFuerMediumFehler, nimmClaimAn,
  type OfflineArt, type OfflineEreignis,
} from '@/server/services/zeit/offline';

/**
 * `POST /api/check-in/[token]/offline` — die Warteschlange eines Telefons
 * nachreichen (TIM-09, K-08 Registerzeile 4).
 *
 * **Bewusst offen, und aus demselben Grund wie der Check-in selbst.** Die
 * Kraft, deren Telefon im Treppenhaus kein Netz hatte, hat keine Anmeldung —
 * hinter einer gaebe es diese Nachreichung nicht. Was die Route schuetzt, ist
 * DIESELBE Marke wie beim Check-in, derselbe Prinzipal `cse_checkin` und
 * dieselbe Funktion aus dem geschlossenen K-08-Register. Ein zweiter, laxerer
 * Weg waere kein zweiter Weg, sondern ein Umgehungsweg.
 *
 * **Sie antwortet IMMER 202, und das ist die Entscheidung.**
 *
 *  - 202 statt 200, weil nichts erledigt ist: es entsteht KEIN `zeiteintrag`.
 *    Ein 200 mit „angenommen" liesse ein Telefon glauben, die Stunde stehe im
 *    Nachweis. Sie steht in der Warteschlange eines Menschen (§9.4).
 *  - IMMER, weil jede Unterscheidung ein Orakel waere. Ob die Marke aufgeloest
 *    hat oder in den Vorbereich gefallen ist, geht den Absender nichts an
 *    (AUT-06) — und ausserdem soll ein Telefon eine abgewiesene Einreichung
 *    NICHT ewig weiter senden.
 *
 * **Die Route rechnet nichts und liest keine Tabelle** (CLAUDE.md: authorize →
 * Dienst → Antwort). Sie koennte es nicht: `cse_checkin` haelt kein einziges
 * Tabellenrecht.
 */
export const dynamic = 'force-dynamic';

/** Hoechstens so viele Ereignisse je Einreichung — eine Warteschlange, kein Fass. */
const MAX_EREIGNISSE = 200;

const ARTEN: readonly OfflineArt[] = [
  // `unbekannt` MUSS hier stehen: ohne den Wert verwirft die Route genau
  // die Ereignisse, die wahrheitsgemäss keine Richtung behaupten, und das
  // Gerät hinge mit einer Schlange da, die es nie los wird.
  'checkin', 'checkout', 'unbekannt', 'pause', 'foto', 'nacherfassung',
];

interface RohEreignis {
  readonly client_ereignis_id?: unknown;
  readonly art?: unknown;
  readonly behauptete_zeit?: unknown;
  readonly geraete_zeit?: unknown;
  readonly geraet_id?: unknown;
  readonly geo?: unknown;
}

/**
 * Die Kennung muss die FORM einer UUID haben, nicht nur die einer Zeichenkette.
 *
 * `client_ereignis_id` wird in der Datenbank mit `::uuid` gelesen. Eine
 * Zeichenkette, die keine ist, lief bis hierhin durch diese Pruefung und warf
 * dort — und weil die ganze Einreichung in EINER Transaktion laeuft, fiel mit
 * ihr jedes gueltige Ereignis desselben Rumpfes zurueck. Die Route antwortete
 * 500, das Telefon zaehlte einen Versuch und sendete unveraendert weiter: eine
 * Schlange, die an einem einzigen krummen Eintrag fuer immer haengenbleibt —
 * genau der Fall, gegen den `ereignisAus` geschrieben ist. Ein Fremder
 * brauchte dafuer einen einzigen POST.
 */
const UUID_FORM =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function datumAus(wert: unknown): Date | null {
  if (typeof wert !== 'string') return null;
  const d = new Date(wert);
  return Number.isNaN(d.getTime()) ? null : d;
}

function geoAus(wert: unknown): { lat: number; lon: number; genauigkeitM?: number } | null {
  if (wert === null || typeof wert !== 'object') return null;
  const { lat, lon, genauigkeit_m: genauigkeit } = wert as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { lat, lon, ...(typeof genauigkeit === 'number' ? { genauigkeitM: genauigkeit } : {}) };
}

/**
 * Ein Ereignis, oder `null` — und `null` heisst STILL VERWERFEN, nicht 400.
 *
 * Der naheliegende Entwurf wiese die ganze Einreichung ab, sobald ein Eintrag
 * krumm ist. Damit haengt die Warteschlange eines Telefons fuer immer an einem
 * einzigen kaputten Eintrag fest: sie wird gesendet, abgewiesen, gespeichert,
 * wieder gesendet — und die GUELTIGEN Ereignisse dahinter, in denen die
 * geleistete Zeit steht, kommen nie an.
 */
function ereignisAus(roh: RohEreignis): OfflineEreignis | null {
  const id = roh.client_ereignis_id;
  const art = roh.art;
  const behauptet = datumAus(roh.behauptete_zeit);
  if (typeof id !== 'string' || !UUID_FORM.test(id)) return null;
  if (typeof art !== 'string' || !ARTEN.includes(art as OfflineArt)) return null;
  if (behauptet === null) return null;
  return {
    clientEreignisId: id,
    art: art as OfflineArt,
    behaupteteZeit: behauptet,
    geraeteZeit: datumAus(roh.geraete_zeit),
    geraetId: typeof roh.geraet_id === 'string' ? roh.geraet_id : null,
    geo: geoAus(roh.geo),
  };
}

/** Die erste Adresse aus `x-forwarded-for` — die des Geraets, nicht die des Proxys. */
function ipAus(anfrage: NextRequest): string | null {
  const kopf = anfrage.headers.get('x-forwarded-for');
  const erste = kopf?.split(',')[0]?.trim();
  return erste === undefined || erste === '' ? null : erste;
}

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await kontext.params;
  if (token === '' || token.length > 512) {
    // Dieselbe Antwort wie fuer eine unbekannte Marke: kein Orakel.
    return NextResponse.json({ angenommen: [] }, { status: 202 });
  }

  let rumpf: { ereignisse?: unknown } = {};
  try {
    // Gleiche Falle wie beim Check-in: der Rumpf `null` ist gueltiges JSON,
    // und `rumpf.ereignisse` warf darauf — 500 statt der 202, die diese Route
    // laut ihrem eigenen Kopf IMMER gibt. Ein `as` prueft nichts.
    const gelesen: unknown = await anfrage.json();
    if (typeof gelesen === 'object' && gelesen !== null) {
      rumpf = gelesen as { ereignisse?: unknown };
    }
  } catch {
    rumpf = {};
  }

  const roh = Array.isArray(rumpf.ereignisse)
    ? (rumpf.ereignisse as RohEreignis[]).slice(0, MAX_EREIGNISSE)
    : [];
  const ereignisse = roh.map(ereignisAus).filter((e): e is OfflineEreignis => e !== null);
  /**
   * Der byte-treue Rumpf JE Ereignis, gebildet aus dem, was tatsaechlich
   * ankam — nicht aus dem, was wir daraus gemacht haben. `nutzlast_roh` ist
   * Beweismittel; eine normalisierte Fassung waere keins (§5.9).
   */
  const rohTexte = roh
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => ereignisAus(r) !== null)
    .map(({ r }) => JSON.stringify(r));

  if (ereignisse.length === 0) {
    return NextResponse.json({ angenommen: [] }, { status: 202 });
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      nimmClaimAn(tx as never, {
        token,
        ereignisse,
        rohJeEreignis: rohTexte,
        ip: ipAus(anfrage),
        userAgent: anfrage.headers.get('user-agent'),
      })) as Promise<Awaited<ReturnType<typeof nimmClaimAn>>>);

    return NextResponse.json({
      angenommen: ergebnis.map((a) => ({
        client_ereignis_id: a.clientEreignisId,
        vorgang_id: a.vorgangId,
        status: a.status,
      })),
    }, { status: 202 });
  } catch (fehler: unknown) {
    if (fehler instanceof KeinBenutzerkontoFuerMediumFehler) {
      return NextResponse.json(
        { error: { code: fehler.code, message: fehler.message } },
        { status: fehler.status },
      );
    }
    throw fehler;
  }
}
