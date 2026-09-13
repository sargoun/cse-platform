import 'server-only';
import { cent, type Cent } from './geld.js';

/**
 * Das Rechnungsausgangsbuch (FIN-16, REP-07; `05-FINANZEN.md` §10).
 *
 * **Was eine Betriebsprüfung hier sucht.** Drei Dinge, und alle drei stehen
 * in der Abstimmung unten: Ist die Nummernfolge je Kreis lückenlos? Passt die
 * Summe des Buches zur Summe der Belege? Trägt jeder Beleg sein Kettenglied?
 *
 * **Die Summe wird in SQL gebildet, nicht hier.** Ein `reduce` über die
 * Zeilen ergäbe dieselbe Zahl aus derselben Quelle — und bewiese damit
 * nichts. `abstimmung()` fragt die Belegtabelle unabhängig von der Sicht;
 * weichen beide ab, ist das ein Befund und keine Rundung.
 *
 * **Entwürfe stehen nicht darin.** Sie haben keine Nummer und keine
 * rechtliche Existenz — deshalb bewegt ein verworfener Entwurf auch keine
 * Kennzahl (§5.5).
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface BuchZeile {
  readonly rechnungId: string;
  readonly nummernkreis: string;
  readonly nummer: string;
  readonly nummerLaufend: number;
  readonly rechnungsdatum: string;
  readonly kundeName: string | null;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  readonly bruttoCent: Cent;
  readonly rechnungsart: string;
  readonly storniert: boolean;
  readonly kettePosition: number | null;
  readonly hash: string | null;
  readonly luecke: boolean;
  readonly ohneKettenglied: boolean;
}

interface BuchRoh {
  readonly rechnung_id: string;
  readonly nummernkreis: string;
  readonly nummer: string;
  readonly nummer_laufend: string;
  readonly rechnungsdatum: string;
  readonly kunde_name: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly rechnungsart: string;
  readonly storniert: boolean;
  readonly kette_position: string | null;
  readonly hash: string | null;
  readonly luecke: boolean;
  readonly ohne_kettenglied: boolean;
}

export interface BuchFilter {
  /** Kalenderjahr des Rechnungsdatums. `null` zeigt alles. */
  readonly jahr?: number | null;
}

export async function leseAusgangsbuch(
  db: Abfrage, filter: BuchFilter = {},
): Promise<readonly BuchZeile[]> {
  const zeilen = await db.abfrage<BuchRoh>(
    `select rechnung_id, nummernkreis, nummer, nummer_laufend::text,
            to_char(rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
            kunde_name, netto_gesamt_cent::text, steuer_gesamt_cent::text,
            brutto_cent::text, rechnungsart::text as rechnungsart, storniert,
            kette_position::text, hash, luecke, ohne_kettenglied
       from rechnungsausgangsbuch
      where ($1::integer is null
             or extract(year from rechnungsdatum) = $1::integer)
      order by nummernkreis, nummer_laufend`,
    [filter.jahr ?? null]);

  return zeilen.map((z) => ({
    rechnungId: z.rechnung_id,
    nummernkreis: z.nummernkreis,
    nummer: z.nummer,
    nummerLaufend: Number(z.nummer_laufend),
    rechnungsdatum: z.rechnungsdatum,
    kundeName: z.kunde_name,
    nettoCent: cent(BigInt(z.netto_gesamt_cent)),
    steuerCent: cent(BigInt(z.steuer_gesamt_cent)),
    bruttoCent: cent(BigInt(z.brutto_cent)),
    rechnungsart: z.rechnungsart,
    storniert: z.storniert,
    kettePosition: z.kette_position === null ? null : Number(z.kette_position),
    hash: z.hash,
    luecke: z.luecke,
    ohneKettenglied: z.ohne_kettenglied,
  }));
}

export interface KreisAbstimmung {
  readonly nummernkreis: string;
  readonly anzahl: number;
  readonly ersteNummer: number;
  readonly letzteNummer: number;
  /** Die Summe AUS DER SICHT. */
  readonly summeBuchCent: Cent;
  /** Die Summe aus der Belegtabelle — der unabhängige zweite Weg. */
  readonly summeBelegeCent: Cent;
  readonly luecken: readonly number[];
  readonly ohneKettenglied: number;
}

export interface Abstimmung {
  readonly ok: boolean;
  readonly kreise: readonly KreisAbstimmung[];
}

/**
 * Die Abstimmung — lückenlos, doppelfrei, summengleich.
 *
 * **Warum die Summe zweimal gebildet wird.** Die Sicht liest `rechnung`;
 * diese Abfrage liest sie ebenfalls, aber ohne die Sicht — ohne die Joins auf
 * Snapshot und Kette, ohne das Fensterfunktions-Fenster. Weicht eine der
 * beiden ab, liegt der Fehler in der Sicht, und genau den findet sonst
 * niemand: eine Sicht mit einem falschen Join zeigt plausible Zahlen.
 *
 * `anzahl` gegen `letzte − erste + 1`: eine Doppelnummer ist über den
 * eindeutigen Index unmöglich, eine LÜCKE dagegen nur über den Zähler — und
 * die fällt hier auf, auch wenn `luecke` je Zeile stimmen sollte.
 */
export async function stimmeAb(db: Abfrage, filter: BuchFilter = {}): Promise<Abstimmung> {
  const zeilen = await db.abfrage<{
    nummernkreis: string; anzahl: string; erste: string; letzte: string;
    summe_buch: string; luecken: string[] | null; ohne_kette: string;
  }>(
    `select nummernkreis,
            count(*)::text                                   as anzahl,
            min(nummer_laufend)::text                        as erste,
            max(nummer_laufend)::text                        as letzte,
            coalesce(sum(brutto_cent), 0)::text              as summe_buch,
            array_remove(array_agg(case when luecke then nummer_laufend::text end), null)
                                                             as luecken,
            count(*) filter (where ohne_kettenglied)::text   as ohne_kette
       from rechnungsausgangsbuch
      where ($1::integer is null or extract(year from rechnungsdatum) = $1::integer)
      group by nummernkreis
      order by nummernkreis`,
    [filter.jahr ?? null]);

  const belege = await db.abfrage<{ nummernkreis: string; summe: string }>(
    `select nk.bezeichnung as nummernkreis,
            coalesce(sum(r.brutto_cent), 0)::text as summe
       from rechnung r
       join nummernkreis nk on nk.id = r.nummernkreis_id and nk.mandant_id = r.mandant_id
      where r.status = 'festgeschrieben'
        and ($1::integer is null or extract(year from r.rechnungsdatum) = $1::integer)
      group by nk.bezeichnung`,
    [filter.jahr ?? null]);
  const summeJeKreis = new Map(belege.map((b) => [b.nummernkreis, BigInt(b.summe)]));

  const kreise = zeilen.map((z) => {
    const anzahl = Number(z.anzahl);
    const erste = Number(z.erste);
    const letzte = Number(z.letzte);
    return {
      nummernkreis: z.nummernkreis,
      anzahl,
      ersteNummer: erste,
      letzteNummer: letzte,
      summeBuchCent: cent(BigInt(z.summe_buch)),
      summeBelegeCent: cent(summeJeKreis.get(z.nummernkreis) ?? 0n),
      /*
       * Die Lückenkennzeichen der Sicht UND die Spanne: die erste sagt „hier
       * fehlt der Vorgänger", die zweite fällt auch dann auf, wenn ein Kreis
       * an einer Stelle klafft, die keine Zeile mehr hat.
       */
      luecken: anzahl === letzte - erste + 1
        ? (z.luecken ?? []).map(Number)
        : [...new Set([...(z.luecken ?? []).map(Number), letzte])],
      ohneKettenglied: Number(z.ohne_kette),
    };
  });

  return {
    ok: kreise.every((k) => k.luecken.length === 0
      && k.ohneKettenglied === 0
      && k.summeBuchCent === k.summeBelegeCent),
    kreise,
  };
}
