/**
 * Der idempotente Inhaltsimport (PUB-08).
 *
 * Zweimal laufen lassen aendert **null Zeilen**. Das ist die ganze Zusage: ein
 * Import, der beim zweiten Lauf Duplikate erzeugt, wird genau einmal
 * ausgefuehrt und danach nie wieder angefasst — und dann veraltet der Inhalt,
 * weil niemand sich traut.
 *
 * Erreicht wird sie ueber den Pfad als natuerlichen Schluessel und einen
 * Vergleich VOR dem Schreiben: gleich heisst nicht schreiben, nicht schreiben
 * heisst kein `geaendert_am`, kein Audit-Eintrag und keine falsche Spur in der
 * Historie.
 */

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface ImportSeite {
  readonly pfad: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly abschnitte: readonly {
    readonly art: string;
    readonly reihenfolge: number;
    readonly ueberschrift: string | null;
    readonly akzentWort: string | null;
    readonly text: string | null;
    /**
     * Der `jsonb`-Anteil des Abschnitts — Leistungslisten und FAQ.
     *
     * Er wird MITVERGLICHEN. Ohne ihn hielte der Import eine Seite für
     * unverändert, deren Leistungsliste sich geändert hat, und der zweite
     * Lauf schriebe die neue Liste nie.
     */
    readonly daten?: Record<string, unknown> | undefined;
  }[];
}

export interface ImportBericht {
  readonly angelegt: number;
  readonly geaendert: number;
  readonly unveraendert: number;
}

/** Objektschlüssel sortiert — damit der Vergleich den Inhalt meint, nicht die Reihenfolge. */
function sortiereTief(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(sortiereTief);
  if (wert !== null && typeof wert === 'object') {
    const o = wert as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortiereTief(o[k])]));
  }
  return wert;
}

export async function importiere(
  db: Abfrage, seiten: readonly ImportSeite[],
): Promise<ImportBericht> {
  let angelegt = 0;
  let geaendert = 0;
  let unveraendert = 0;

  for (const s of seiten) {
    const vorhanden = (await db.unsafe(
      `select id, titel, beschreibung from seite
        where pfad = $1 and sprache = 'de' and geloescht_am is null`,
      [s.pfad],
    )) as { id: string; titel: string; beschreibung: string | null }[];

    let seiteId: string;
    if (vorhanden[0] === undefined) {
      const neu = (await db.unsafe(
        `insert into seite (pfad, titel, beschreibung, status, veroeffentlicht_am)
         values ($1,$2,$3,'veroeffentlicht',now()) returning id`,
        [s.pfad, s.titel, s.beschreibung],
      )) as { id: string }[];
      seiteId = neu[0]!.id;
      angelegt += 1;
    } else {
      seiteId = vorhanden[0].id;
      // VERGLEICH vor dem Schreiben. Ein `update` mit identischen Werten
      // stempelt `geaendert_am`, schreibt eine Audit-Zeile und behauptet
      // damit eine Aenderung, die nicht stattgefunden hat.
      if (vorhanden[0].titel !== s.titel || vorhanden[0].beschreibung !== s.beschreibung) {
        await db.unsafe(
          `update seite set titel = $2, beschreibung = $3, geaendert_am = now() where id = $1`,
          [seiteId, s.titel, s.beschreibung],
        );
        geaendert += 1;
      } else {
        unveraendert += 1;
      }
    }

    for (const a of s.abschnitte) {
      const alt = (await db.unsafe(
        `select id, ueberschrift, akzent_wort, text, daten from abschnitt
          where seite_id = $1 and reihenfolge = $2 and geloescht_am is null`,
        [seiteId, a.reihenfolge],
      )) as { id: string; ueberschrift: string | null; akzent_wort: string | null;
              text: string | null; daten: Record<string, unknown> | null }[];

      const daten = a.daten ?? {};
      // Schlüsselreihenfolge-unabhängig: `{a,b}` und `{b,a}` sind derselbe
      // Inhalt, und ein Vergleich, der sie unterscheidet, meldet ewig
      // Änderungen.
      const gleich = (x: unknown, y: unknown): boolean =>
        JSON.stringify(sortiereTief(x)) === JSON.stringify(sortiereTief(y));

      if (alt[0] === undefined) {
        await db.unsafe(
          `insert into abschnitt (seite_id, art, reihenfolge, ueberschrift, akzent_wort,
                                  text, daten)
           values ($1,$2::abschnitt_art,$3,$4,$5,$6,$7)`,
          [seiteId, a.art, a.reihenfolge, a.ueberschrift, a.akzentWort, a.text, daten],
        );
        angelegt += 1;
      } else if (alt[0].ueberschrift !== a.ueberschrift
                 || alt[0].akzent_wort !== a.akzentWort
                 || alt[0].text !== a.text
                 || !gleich(alt[0].daten ?? {}, daten)) {
        await db.unsafe(
          `update abschnitt set ueberschrift = $2, akzent_wort = $3, text = $4,
                                daten = $5, geaendert_am = now() where id = $1`,
          [alt[0].id, a.ueberschrift, a.akzentWort, a.text, daten],
        );
        geaendert += 1;
      } else {
        unveraendert += 1;
      }
    }
  }

  return { angelegt, geaendert, unveraendert };
}

/**
 * Die Weiterleitungen der alten Seite (PUB-08).
 *
 * Jede Alt-URL geht per **301** auf ihr Ziel. Ein 302 waere hier falsch: die
 * Suchmaschine behaelt dann den alten Eintrag, und die Autoritaet der alten
 * Adresse geht nicht auf die neue ueber.
 *
 * // TODO(client): O-13 — die vollstaendige Liste der Alt-URLs kommt aus dem
 * // Export von cse-dienstleistungen.de; hier stehen die bekannten.
 */
export const WEITERLEITUNGEN: Readonly<Record<string, string>> = {
  '/index.html': '/',
  '/home': '/',
  '/leistungen.html': '/leistungen',
  '/ueber-uns.html': '/ueber-uns',
  '/kontakt.html': '/kontakt',
  '/impressum.html': '/impressum',
  '/datenschutz.html': '/datenschutz',
  '/gebaeudereinigung': '/reinigung',
  '/sicherheitsdienst': '/security',
};
