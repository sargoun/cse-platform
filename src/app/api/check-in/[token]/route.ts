import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import {
  KeinBenutzerkontoFehler, KeinOffenerEintragFehler, TokenAbgelehntFehler,
  loeseCheckinEin, type GeoPunkt,
} from '@/server/services/zeit/checkin';

/**
 * `POST /api/check-in/[token]` — die Marke einloesen (TIM-07, TIM-08, K-08).
 *
 * **Bewusst offen, und das ist die Entscheidung, nicht das Versehen.** Die
 * Kraft, die um 05:55 im Treppenhaus steht, hat keine Anmeldung; hinter einer
 * gaebe es keinen Check-in. Was diese Route schuetzt, sind nicht Rechte des
 * Aufrufers, sondern die Marke selbst: ein 256-Bit-Geheimnis, das nur als
 * SHA-256 gespeichert ist, genau einmal gilt, nur in seinem Fenster gilt, und
 * dessen Einloesung EINE bedingte Anweisung ist (K-09).
 *
 * **Die Route rechnet nichts und liest keine Tabelle** (CLAUDE.md: authorize →
 * Dienst → Antwort). Sie koennte es nicht: `cse_checkin` haelt kein einziges
 * Tabellenrecht.
 *
 * Zwei Dinge, die diese Antwort bewusst NICHT tut:
 *
 *  1. **Sie unterscheidet keine Ablehnungsgruende.** Unbekannte Marke,
 *     abgelaufen, zu frueh, widerrufen, schon benutzt — alles ergibt 409
 *     `ungueltiger_zustand` mit derselben Meldung. Eine Antwort, die die Faelle
 *     unterscheidet, macht das Durchprobieren lohnend (AUT-06, §9.2).
 *     (`05-API-KARTE.md` §C schreibt hier 404, `08-PR-PLAN.md` PR 34 nennt
 *     woertlich 409 fuer die zweite Einloesung. Der Widerspruch ist in
 *     DECISIONS.md notiert; PR 34 gewinnt, und entscheidend ist ohnehin, dass
 *     EIN Status fuer ALLE Ablehnungen gilt.)
 *
 *  2. **Sie schickt keine Koordinaten mit, wenn keine erhoben wurden.** Ist
 *     `zeit.geolokalisierung` aus, fragt die Oberflaeche das Geraet gar nicht
 *     erst, das Feld fehlt im Rumpf, und die Datenbank verwirft es zusaetzlich
 *     (LEG-10, O-06).
 */
export const dynamic = 'force-dynamic';

interface Rumpf {
  readonly geraetezeit?: unknown;
  readonly geo?: unknown;
}

/**
 * Die Geraetezeit wird ANGENOMMEN und gespeichert — nie geglaubt.
 *
 * Ein unbrauchbarer Wert wird zu `null` und nicht zu einem Fehler: der
 * Check-in soll ankommen. Die Uhr des Telefons ist Beiwerk (TIM-08); der
 * massgebliche Zeitpunkt entsteht in der Datenbank.
 */
function geraeteZeitAus(rumpf: Rumpf): Date | null {
  if (typeof rumpf.geraetezeit !== 'string') return null;
  const d = new Date(rumpf.geraetezeit);
  return Number.isNaN(d.getTime()) ? null : d;
}

function geoAus(rumpf: Rumpf): GeoPunkt | null {
  const g = rumpf.geo;
  if (g === null || typeof g !== 'object') return null;
  const { lat, lon, genauigkeit_m: genauigkeit } = g as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return {
    lat, lon,
    ...(typeof genauigkeit === 'number' ? { genauigkeitM: genauigkeit } : {}),
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
    return NextResponse.json(
      { error: { code: 'ungueltiger_zustand', message: 'Dieser Link ist nicht gültig.' } },
      { status: 409 },
    );
  }

  let rumpf: Rumpf = {};
  try {
    /**
     * Das Ergebnis wird GEPRUEFT, nicht nur behauptet.
     *
     * `as Rumpf` prueft nichts: ein Rumpf aus den vier Zeichen `null` ist
     * gueltiges JSON, `json()` liefert dafuer `null`, und der Zugriff auf
     * `rumpf.geraetezeit` warf danach — die Route antwortete 500 auf einen
     * Fall, den ihr eigener Kommentar zwei Zeilen tiefer als „kein Fehler"
     * bezeichnet. Dasselbe gilt fuer eine Zahl oder eine Zeichenkette.
     */
    const gelesen: unknown = await anfrage.json();
    if (typeof gelesen === 'object' && gelesen !== null) rumpf = gelesen as Rumpf;
  } catch {
    // Ein leerer oder unlesbarer Rumpf ist kein Fehler: die Marke traegt
    // alles, was noetig ist. Geraetezeit und Ort sind Beiwerk.
    rumpf = {};
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      loeseCheckinEin(tx as never, {
        token,
        geraeteZeit: geraeteZeitAus(rumpf),
        ip: ipAus(anfrage),
        userAgent: anfrage.headers.get('user-agent'),
        geo: geoAus(rumpf),
      })) as Promise<Awaited<ReturnType<typeof loeseCheckinEin>>>);

    return NextResponse.json({
      ergebnis: ergebnis.ergebnis,
      zeiteintrag_id: ergebnis.zeiteintragId,
      objekt: ergebnis.objekt,
      // Der SERVER-Zeitpunkt. Angezeigt wird er in Europe/Berlin — die
      // Umwandlung macht die Oberflaeche, gespeichert bleibt UTC (Invariante 2).
      server_zeit: ergebnis.serverZeit.toISOString(),
      zeitabweichung_sek: ergebnis.zeitabweichungSek,
    });
  } catch (fehler: unknown) {
    if (fehler instanceof TokenAbgelehntFehler
        || fehler instanceof KeinOffenerEintragFehler
        || fehler instanceof KeinBenutzerkontoFehler) {
      return NextResponse.json(
        { error: { code: fehler.code, message: fehler.message } },
        { status: fehler.status },
      );
    }
    throw fehler;
  }
}
