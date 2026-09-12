/**
 * Die eigenen Nachweise mit persoenlicher Ablaufwarnung (EMP-08, SEC-02,
 * SEC-03, D-09).
 *
 * **Eine Quelle, zwei Verbraucher.** Dieselbe Lage, aus der PR 31 die
 * Einteilung SPERRT (`nachweis/tor.ts` ueber
 * `app.einsatz_qualifikation_erfuellt`), warnt hier den Menschen. Das ist die
 * eigentliche Zusage dieses Moduls: die Kraft erfaehrt von ihrem ablaufenden
 * §34a-Nachweis, BEVOR die Planung sie nicht mehr einteilen kann — und nicht
 * aus einer zweiten Liste, die irgendwann von der ersten abweicht.
 *
 * Deshalb wird hier nichts nachgebaut:
 *
 *  - die GUELTIGKEIT kommt aus `decktStichtag` (`nachweis/gueltigkeit.ts`) —
 *    derselben Bedingung, die `app.einsatz_qualifikation_erfuellt` in SQL
 *    traegt;
 *  - die SPERRWIRKUNG aus `qualifikation.blockiert_einsatz` — derselben
 *    Spalte, die das Tor liest;
 *  - die WARNSTUFEN aus `qualifikation.warnung_tage` ueber `faelligeStufen`
 *    (`nachweis/ablauf.ts`) — denselben Schwellen, die der naechtliche
 *    Waechter meldet. Eine hier erfundene 30-Tage-Grenze waere eine zweite
 *    Regel, und die erste, die niemand pflegt.
 *
 * **Der Stichtag ist ein Argument, kein Vorgabewert „heute".** Er kommt aus
 * der DATENBANK (`berlinHeute`), weil die Uhr des Node-Prozesses nicht die des
 * Servers ist und weil zwischen Mitternacht und 02:00 Berliner Zeit der
 * UTC-Tag noch der gestrige ist.
 *
 * **Person, nicht Beschaeftigung** (D-09): ein Nachweis ist eine Tatsache
 * ueber den Menschen. Er haengt an `person_id`, gilt in beiden Gesellschaften
 * und taucht hier genau einmal auf.
 */
import type { LeseKontext } from '../../kontext/index.js';
import { faelligeStufen } from '../nachweis/ablauf.js';
import { decktStichtag, tageZwischen, type NachweisStatus }
  from '../nachweis/gueltigkeit.js';
import type { PortalSprache } from '../../../lib/i18n/texte.js';

/** Wie dringend ist dieser Nachweis — als WORT, nicht als Farbe (DESIGN §9). */
export type Warnlage = 'gueltig' | 'laeuft_ab' | 'abgelaufen';

export interface EigenerNachweis {
  readonly nachweisId: string;
  readonly qualifikationSchluessel: string;
  /** Uebersetzt, wo `bezeichnung_i18n` eine Fassung traegt — sonst deutsch. */
  readonly bezeichnung: string;
  readonly rechtsgrundlage: string | null;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
  readonly status: NachweisStatus;
  /** Deckt er den Stichtag? Dieselbe Bedingung wie das Tor (SEC-04). */
  readonly gueltigAmStichtag: boolean;
  /** Sperrt sein Fehlen die Einteilung? Dieselbe Spalte wie das Tor. */
  readonly blockiertEinsatz: boolean;
  readonly warnlage: Warnlage;
  /** Negativ, wenn er schon abgelaufen ist. `null` bei unbefristet. */
  readonly tageBisAblauf: number | null;
  /** Die groebste faellige Warnstufe aus `qualifikation.warnung_tage`. */
  readonly warnstufeTage: number | null;
}

export interface EigeneNachweislage {
  readonly stichtag: string;
  readonly nachweise: readonly EigenerNachweis[];
  /** Wie viele davon die Einteilung heute sperren — die Zahl der Kachel. */
  readonly sperrendeAnzahl: number;
  readonly bewacher: {
    readonly vorhanden: boolean;
    readonly status: string | null;
    readonly gueltigBis: string | null;
    readonly gueltigAmStichtag: boolean;
    /** SEC-03: es gibt keine Schnittstelle zum Register — das steht da. */
    readonly quelle: 'manuell';
    readonly verbindung: 'nicht_verbunden';
  };
}

export const EIGENER_NACHWEIS_FELDER = [
  'nachweisId', 'qualifikationSchluessel', 'bezeichnung', 'rechtsgrundlage',
  'gueltigAb', 'gueltigBis', 'status', 'gueltigAmStichtag', 'blockiertEinsatz',
  'warnlage', 'tageBisAblauf', 'warnstufeTage',
] as const;

export const EIGENE_NACHWEISLAGE_FELDER = [
  'stichtag', 'nachweise', 'sperrendeAnzahl', 'bewacher',
] as const;

interface NachweisRoh {
  readonly id: string;
  readonly qualifikation_id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly rechtsgrundlage: string | null;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  readonly status: NachweisStatus;
  readonly blockiert_einsatz: boolean;
  readonly warnung_tage: readonly number[];
  readonly widerrufen_am: string | null;
}

interface BewacherRoh {
  readonly bewacher_id: string;
  readonly status: string;
  readonly gueltig_bis: string | null;
}

/**
 * Die Nachweislage dieses Menschen zum genannten Stichtag.
 *
 * `widerrufen_am is null` filtert wie die Uebersicht der Planung
 * (`nachweis/uebersicht.ts`): ein widerrufener Nachweis ist kein Nachweis
 * mehr, und er steht trotzdem noch in der Tabelle (Invariante 8).
 */
export async function leseEigeneNachweise(
  kontext: LeseKontext, stichtag: string, sprache: PortalSprache,
): Promise<EigeneNachweislage> {
  const roh = await kontext.abfrage<NachweisRoh>(
    `select n.id,
            n.qualifikation_id,
            q.schluessel,
            coalesce(nullif(q.bezeichnung_i18n ->> $1, ''), q.bezeichnung) as bezeichnung,
            q.rechtsgrundlage,
            to_char(n.gueltig_ab,  'YYYY-MM-DD') as gueltig_ab,
            to_char(n.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
            n.status::text                       as status,
            q.blockiert_einsatz,
            q.warnung_tage,
            to_char(n.widerrufen_am at time zone 'Europe/Berlin', 'YYYY-MM-DD')
              as widerrufen_am
       from nachweis n
       join qualifikation q on q.id = n.qualifikation_id
      where n.person_id = app.aktuelle_person()
        and n.widerrufen_am is null
      order by q.blockiert_einsatz desc, n.gueltig_bis asc nulls last, q.schluessel asc`,
    [sprache],
  );

  const nachweise = roh.map((n) => {
    const gueltigAmStichtag = decktStichtag(
      {
        qualifikationId: n.qualifikation_id,
        gueltigAb: n.gueltig_ab,
        gueltigBis: n.gueltig_bis,
        status: n.status,
        widerrufenAm: n.widerrufen_am,
      },
      stichtag,
    );
    const tage = n.gueltig_bis === null ? null : tageZwischen(stichtag, n.gueltig_bis);
    const stufen = n.gueltig_bis === null
      ? [] : faelligeStufen(n.gueltig_bis, n.warnung_tage, stichtag);
    /**
     * Die Reihenfolge ist die Aussage: abgelaufen SCHLAEGT „laeuft ab".
     * `faelligeStufen` gibt fuer einen bereits abgelaufenen Nachweis bewusst
     * nichts zurueck — „laeuft in 7 Tagen ab" ueber ein seit gestern
     * ungueltiges Dokument waere eine falsche Aussage.
     */
    const warnlage: Warnlage = !gueltigAmStichtag
      ? 'abgelaufen'
      : (stufen.length > 0 ? 'laeuft_ab' : 'gueltig');
    return {
      nachweisId: n.id,
      qualifikationSchluessel: n.schluessel,
      bezeichnung: n.bezeichnung,
      rechtsgrundlage: n.rechtsgrundlage,
      gueltigAb: n.gueltig_ab,
      gueltigBis: n.gueltig_bis,
      status: n.status,
      gueltigAmStichtag,
      blockiertEinsatz: n.blockiert_einsatz,
      warnlage,
      tageBisAblauf: tage,
      warnstufeTage: stufen[0] ?? null,
    } satisfies EigenerNachweis;
  });

  const register = await kontext.abfrage<BewacherRoh>(
    `select b.bewacher_id, b.status::text as status,
            to_char(b.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis
       from bewacher_eintrag b
      where b.person_id = app.aktuelle_person() and b.erloschen_am is null`,
  );
  const eintrag = register[0];

  return {
    stichtag,
    nachweise,
    sperrendeAnzahl:
      nachweise.filter((n) => n.blockiertEinsatz && !n.gueltigAmStichtag).length,
    bewacher: {
      vorhanden: eintrag !== undefined,
      status: eintrag?.status ?? null,
      gueltigBis: eintrag?.gueltig_bis ?? null,
      // Dieselbe Bedingung, die das Tor in SQL traegt: nur `registriert`
      // zaehlt, und geprueft wird gegen den STICHTAG.
      gueltigAmStichtag:
        eintrag !== undefined
        && eintrag.status === 'registriert'
        && (eintrag.gueltig_bis === null || eintrag.gueltig_bis >= stichtag),
      quelle: 'manuell',
      verbindung: 'nicht_verbunden',
    },
  };
}
