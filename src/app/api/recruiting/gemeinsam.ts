import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { erwarteterUrsprung, internesZiel, istGleicherUrsprung } from '@/server/auth/ursprung';
import { rechtepruefer } from '@/server/auth/zugang';
import { db } from '@/server/db/pool';
import { type SchreibKontext, withTenant } from '@/server/kontext/index';
import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import { BewertungFehler } from '@/server/services/recruiting/rangfolge';
import { liesRumpf, type Rumpf } from '../rumpf';

/**
 * Das Gerüst der vier schreibenden Recruiting-Routen — dieselbe Form wie bei
 * Social (`api/social/gemeinsam.ts`), aus demselben Grund: Ursprungsprüfung,
 * Sitzung, genau ein aktiver Mandant, `authorize`, Transaktion und Fehlerbild
 * sind bei allen vieren dasselbe, und vier Kopien sind vier Stellen, an denen
 * eines davon beim nächsten Umbau fehlt.
 *
 * **Drei Fehlerarten, drei Antworten, und die Unterscheidung ist der Punkt:**
 *
 *  - `RecruitingFehler` trägt seinen Status selbst (400 für eine
 *    unvollständige Eingabe, 403 für eine abgewiesene Zeile, 404 für etwas,
 *    das es nicht gibt). Ein Mensch soll den Satz lesen und wissen, was fehlt.
 *  - `BewertungFehler` ist 400: eine Punktzahl ausserhalb 0…10 oder ein
 *    Gewicht ausserhalb 0…100 ist eine Eingabe, kein Programmfehler.
 *  - Was `authorize` wirft, übersetzt `server/auth/antwort.ts`. Wer das nicht
 *    fängt, beantwortet ein FEHLENDES RECHT mit 500 — und 500 sagt „hier ist
 *    etwas", wo AUT-06 nichts sagen will.
 *
 * **Der Rückweg kommt aus `internesZiel`**, nicht aus `nextUrl`: `nextUrl`
 * trägt die Adresse des SERVERS, nicht die aus dem Browser. Hinter einem Proxy
 * oder einem Tunnel landet der Mensch sonst nach dem Absenden auf einem Wirt,
 * den er nie aufgerufen hat (D-562).
 */

/**
 * Was ein Handler zurückgibt, wenn der Vorgang GESCHRIEBEN wurde und trotzdem
 * schiefging.
 *
 * **Der Fall, der das nötig macht:** ein Versuch gegen eine unverbundene
 * Jobbörse wird vermerkt (mit Datum und Grund) und schlägt fehl. Würde der
 * Handler danach werfen, riss er den Vermerk mit — die Transaktion rollt
 * zurück, und der Versuch, den morgen jemand sucht, hat nie stattgefunden.
 * Genau das tat die erste Fassung, während ihr eigener Kommentar das
 * Gegenteil behauptete.
 *
 * Also: schreiben, zurückgeben, festschreiben — und die Antwort danach aus
 * `fehler` bilden. Ein JSON-Aufrufer bekommt seinen Status (R-17 verlangt 409
 * für einen nicht verbundenen Kanal), ein Formular geht auf die Seite zurück,
 * auf der der Vermerk jetzt steht.
 */
export interface HandlerErgebnis {
  readonly ergebnis: string;
  readonly fehler?: { readonly grund: string; readonly meldung: string; readonly status: number };
}

export interface Lauf {
  readonly recht: string;
  readonly handle: (
    kontext: SchreibKontext, rumpf: Rumpf,
  ) => Promise<string | HandlerErgebnis>;
  /** Wohin ein Formular danach zeigt — `slug` ist der Bereich. */
  readonly ziel: (slug: string, ergebnis: string) => string;
}

/**
 * Wohin es geht, wenn `zurueck` nicht in diese Anwendung zeigt.
 *
 * `/portal` ist der Wegweiser (D-560) und kein Bildschirm, den jemand
 * vorgeben kann — genau das ist der Punkt.
 */
const HEIMWEG = '/portal';

export async function fuehreRecruitingAus(
  anfrage: NextRequest, lauf: Lauf,
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const rumpf = await liesRumpf(anfrage).catch(() => null);
  if (rumpf === null) {
    return NextResponse.json({ fehler: 'unlesbarer_rumpf' }, { status: 400 });
  }

  try {
    const { ergebnis, slug } = await (db().begin(
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht: lauf.recht, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        const e = await lauf.handle(kontext, rumpf);
        return {
          ergebnis: typeof e === 'string' ? { ergebnis: e } : e,
          slug: m?.slug ?? '',
        };
      }))) as { ergebnis: HandlerErgebnis; slug: string };

    /*
     * Geschrieben ist geschrieben — die Transaktion ist durch. Was jetzt noch
     * kommt, ist die Antwort auf einen Vorgang, der stattgefunden hat.
     */
    if (ergebnis.fehler !== undefined) {
      if (rumpf.json) {
        return NextResponse.json(
          { fehler: ergebnis.fehler.grund, meldung: ergebnis.fehler.meldung },
          { status: ergebnis.fehler.status });
      }
      const zurueck = rumpf.felder['zurueck'];
      const trenner = (zurueck ?? '').includes('?') ? '&' : '?';
      return NextResponse.redirect(
        internesZiel(
          zurueck === undefined || zurueck === ''
            ? null
            : `${zurueck}${trenner}fehler=${encodeURIComponent(ergebnis.fehler.grund)}`,
          lauf.ziel(slug, ergebnis.ergebnis), anfrage),
        303);
    }

    if (rumpf.json) return NextResponse.json({ ergebnis: ergebnis.ergebnis }, { status: 200 });
    return NextResponse.redirect(
      new URL(lauf.ziel(slug, ergebnis.ergebnis), erwarteterUrsprung(anfrage)), 303);
  } catch (fehler: unknown) {
    const antwort = fehlerantwort(fehler);
    if (antwort !== null) {
      /*
       * **Zurück auf das Formular, nicht auf eine weisse Seite mit JSON.**
       *
       * Ein Formular, dessen Fehler als `{"fehler":"…"}` landet, hat den
       * Menschen verloren: sein Entwurf ist weg und der Rückweg ist der
       * Zurück-Knopf. Dieselbe Lösung wie in `api/zeit/korrektur`.
       */
      const zurueck = rumpf.felder['zurueck'];
      if (!rumpf.json && zurueck !== undefined && zurueck !== '') {
        const trenner = zurueck.includes('?') ? '&' : '?';
        /*
         * **Der Rueckfall ist SERVERSEITIG, nicht noch einmal `zurueck`.**
         *
         * Hier stand `zurueck` in beiden Argumenten — und damit wurde die
         * Pruefung zu ihrem eigenen Gegenteil: `internesZiel` wies ein
         * absolutes `https://boese.example` als Ziel ab und gab es als
         * Rueckfall unveraendert zurueck. Nach einem gueltigen POST aus dem
         * eigenen Portal ging die Umleitung nach draussen. Gemeldet hat das
         * die Copilot-Runde auf PR 16; `internesZiel` prueft den Rueckfall
         * seither ebenfalls, aber ein Aufrufer, der sein eigenes Ziel nicht
         * kennt, gehoert trotzdem korrigiert.
         */
        return NextResponse.redirect(
          internesZiel(
            `${zurueck}${trenner}fehler=${encodeURIComponent(antwort.grund)}`,
            HEIMWEG, anfrage),
          303);
      }
      return NextResponse.json(
        { fehler: antwort.grund, meldung: antwort.meldung }, { status: antwort.status });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}

function fehlerantwort(
  fehler: unknown,
): { readonly grund: string; readonly meldung: string; readonly status: number } | null {
  if (fehler instanceof RecruitingFehler) {
    return { grund: fehler.grund, meldung: fehler.message, status: fehler.status };
  }
  if (fehler instanceof BewertungFehler) {
    return { grund: fehler.code, meldung: fehler.message, status: fehler.status };
  }
  return null;
}
