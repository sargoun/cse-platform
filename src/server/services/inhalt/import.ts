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
 *
 * **Eine Pflege im Portal bleibt stehen** (V-386, D-851). `import_stand` (0535)
 * haelt fest, was der Import zuletzt geschrieben hat. Weicht der heutige Stand
 * davon ab, hat jemand im Portal gepflegt: der Import laesst die Zeile stehen
 * und nennt sie (`gepflegt`). Eine Zeile ohne `import_stand`, deren Inhalt vom
 * Seed abweicht, gilt genauso — was vor 0535 gepflegt wurde, weiss niemand.
 * Zurueckgesetzt wird nur mit `ueberschreiben` (`pnpm content:import
 * --ueberschreiben`), ausdruecklich.
 */

import { WEITERLEITUNGEN } from '../../../lib/weiterleitungen.js';

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
  /** Wie viele abgeloeste Adressen zurueckgezogen wurden. */
  readonly abgeloest: number;
  /**
   * Was im Portal gepflegt ist und deshalb stehen blieb (V-386) — je Seite
   * `pfad`, je Abschnitt `pfad#reihenfolge`.
   */
  readonly gepflegt: readonly string[];
}

export interface ImportOptionen {
  /** Auch gepflegte Zeilen auf den Seed zuruecksetzen — nur ausdruecklich (V-386). */
  readonly ueberschreiben?: boolean;
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

/**
 * Importiert die Seiten EINER Sprache.
 *
 * Die Sprache ist ein Argument und kein fester Wert, weil `seite` sie in
 * ihrem eindeutigen Index fuehrt: `(pfad, sprache)`. Stuende hier weiter
 * `'de'`, legte ein englischer Lauf die deutschen Zeilen um — dieselbe Seite,
 * derselbe Pfad, neuer Text. Der Fehler waere nicht doppelter Inhalt, sondern
 * ein deutscher Auftritt, der ueber Nacht englisch wird.
 */
export async function importiere(
  db: Abfrage, seiten: readonly ImportSeite[], sprache = 'de',
  optionen: ImportOptionen = {},
): Promise<ImportBericht> {
  /**
   * ZUERST, vor jedem Schreibvorgang: eine Adresse kann nicht gleichzeitig
   * eine Seite und eine Weiterleitungsquelle sein. Am Ende geprueft haette der
   * Import die Seite schon angelegt, bevor er sie beanstandet.
   */
  const kollision = seiten.map((x) => x.pfad).filter((x) => x in WEITERLEITUNGEN);
  if (kollision.length > 0) throw new WeiterleitungKollisionFehler(kollision);

  let angelegt = 0;
  let geaendert = 0;
  let unveraendert = 0;
  const gepflegt: string[] = [];
  const ueberschreiben = optionen.ueberschreiben === true;
  // Schlüsselreihenfolge-unabhängig: `{a,b}` und `{b,a}` sind derselbe
  // Inhalt, und ein Vergleich, der sie unterscheidet, meldet ewig
  // Änderungen.
  const gleich = (x: unknown, y: unknown): boolean =>
    JSON.stringify(sortiereTief(x)) === JSON.stringify(sortiereTief(y));

  for (const s of seiten) {
    const vorhanden = (await db.unsafe(
      `select id, titel, beschreibung, import_stand from seite
        where pfad = $1 and sprache = $2 and geloescht_am is null`,
      [s.pfad, sprache],
    )) as { id: string; titel: string; beschreibung: string | null;
            import_stand: Record<string, unknown> | null }[];

    const seiteStand = { titel: s.titel, beschreibung: s.beschreibung };
    let seiteId: string;
    if (vorhanden[0] === undefined) {
      const neu = (await db.unsafe(
        `insert into seite (pfad, sprache, titel, beschreibung, status, veroeffentlicht_am,
                            import_stand)
         values ($1,$2,$3,$4,'veroeffentlicht',now(),$5) returning id`,
        [s.pfad, sprache, s.titel, s.beschreibung, seiteStand],
      )) as { id: string }[];
      seiteId = neu[0]!.id;
      angelegt += 1;
    } else {
      seiteId = vorhanden[0].id;
      const heute = { titel: vorhanden[0].titel, beschreibung: vorhanden[0].beschreibung };
      // VERGLEICH vor dem Schreiben. Ein `update` mit identischen Werten
      // stempelt `geaendert_am`, schreibt eine Audit-Zeile und behauptet
      // damit eine Aenderung, die nicht stattgefunden hat.
      if (gleich(heute, seiteStand)) {
        unveraendert += 1;
      } else if (!ueberschreiben && !gleich(heute, vorhanden[0].import_stand)) {
        // Im Portal gepflegt (oder vor 0535 unbekannter Herkunft): stehen lassen.
        gepflegt.push(s.pfad);
      } else {
        await db.unsafe(
          `update seite set titel = $2, beschreibung = $3, import_stand = $4, geaendert_am = now()
            where id = $1`,
          [seiteId, s.titel, s.beschreibung, seiteStand],
        );
        geaendert += 1;
      }
    }

    for (const a of s.abschnitte) {
      const alt = (await db.unsafe(
        `select id, ueberschrift, akzent_wort, text, daten, import_stand from abschnitt
          where seite_id = $1 and reihenfolge = $2 and geloescht_am is null`,
        [seiteId, a.reihenfolge],
      )) as { id: string; ueberschrift: string | null; akzent_wort: string | null;
              text: string | null; daten: Record<string, unknown> | null;
              import_stand: Record<string, unknown> | null }[];

      const daten = a.daten ?? {};
      const stand = {
        ueberschrift: a.ueberschrift, akzent_wort: a.akzentWort, text: a.text, daten,
      };

      if (alt[0] === undefined) {
        await db.unsafe(
          `insert into abschnitt (seite_id, art, reihenfolge, ueberschrift, akzent_wort,
                                  text, daten, import_stand)
           values ($1,$2::abschnitt_art,$3,$4,$5,$6,$7,$8)`,
          [seiteId, a.art, a.reihenfolge, a.ueberschrift, a.akzentWort, a.text, daten, stand],
        );
        angelegt += 1;
        continue;
      }
      const heute = {
        ueberschrift: alt[0].ueberschrift, akzent_wort: alt[0].akzent_wort,
        text: alt[0].text, daten: alt[0].daten ?? {},
      };
      if (gleich(heute, stand)) {
        unveraendert += 1;
      } else if (!ueberschreiben && !gleich(heute, alt[0].import_stand)) {
        // Im Portal gepflegt (oder vor 0535 unbekannter Herkunft): stehen lassen.
        gepflegt.push(`${s.pfad}#${String(a.reihenfolge)}`);
      } else {
        await db.unsafe(
          `update abschnitt set ueberschrift = $2, akzent_wort = $3, text = $4,
                                daten = $5, import_stand = $6, geaendert_am = now()
            where id = $1`,
          [alt[0].id, a.ueberschrift, a.akzentWort, a.text, daten, stand],
        );
        geaendert += 1;
      }
    }
  }

  const abgeloest = await zieheAbgeloesteZurueck(db, sprache);
  return { angelegt, geaendert, unveraendert, abgeloest, gepflegt };
}

/**
 * Eine Adresse kann nicht gleichzeitig eine Seite und eine Weiterleitung sein.
 *
 * Ohne diese Pruefung wuerde ein spaeter eingetragener Umzug, dessen QUELLE
 * noch eine gepflegte Seite ist, diese Seite bei jedem Import zurueckziehen —
 * still, wiederholt, und sichtbar erst, wenn jemand die Website aufruft.
 * Lieber ein lauter Fehler beim Import als eine Seite, die montags weg ist.
 */
export class WeiterleitungKollisionFehler extends Error {
  constructor(pfade: readonly string[]) {
    super(
      `Diese Adressen stehen als Weiterleitungs-QUELLE und werden gleichzeitig als `
      + `Seite importiert: ${pfade.join(', ')}. Eine von beiden ist falsch — `
      + `entweder ist der Umzug erledigt (dann raus aus WEITERLEITUNGEN) oder die `
      + `Seite gehört nicht mehr in den Import.`,
    );
    this.name = 'WeiterleitungKollisionFehler';
  }
}

/**
 * Zieht die Seiten zurueck, deren Adresse abgeloest wurde.
 *
 * **Der Befund.** Der Import legt an und aendert, er nimmt nie etwas weg. Eine
 * Datenbank, in der `/reinigung` einmal veroeffentlicht wurde, behielt diese
 * Zeile auch, nachdem die Adresse `/unternehmen/reinigung` geworden war — die
 * alte Seite blieb erreichbar, stand weiter in der Sitemap, und die
 * Suchmaschine sah zwei Adressen mit demselben Inhalt.
 *
 * **Zurueckgezogen wird nur, was in `WEITERLEITUNGEN` als Quelle steht.** Ein
 * Import, der jede Zeile loescht, die er nicht kennt, wuerde auch eine Seite
 * loeschen, die jemand in der Anwendung angelegt hat — und der Datenverlust
 * faende beim naechsten Deployment statt, ohne dass jemand ihn ausgeloest
 * haette. Die Weiterleitungstabelle nennt genau die Adressen, von denen
 * jemand ENTSCHIEDEN hat, dass sie ersetzt sind.
 *
 * Kein hartes Loeschen: `geloescht_am` (Invariante 8 im Geist — was einmal
 * veroeffentlicht war, bleibt nachvollziehbar).
 */
export async function zieheAbgeloesteZurueck(db: Abfrage, sprache: string): Promise<number> {
  const quellen = Object.keys(WEITERLEITUNGEN);
  if (quellen.length === 0) return 0;
  const betroffen = (await db.unsafe(
    `update seite set geloescht_am = now(), geaendert_am = now()
      where sprache = $2 and geloescht_am is null and pfad = any($1)
      returning id`,
    [quellen, sprache],
  )) as { id: string }[];
  return betroffen.length;
}

/**
 * Die Weiterleitungen — hier nur weitergereicht.
 *
 * Sie stehen in `src/lib/weiterleitungen.ts`, weil `next.config.ts` sie
 * ebenfalls liest und dort kein Modul geladen werden kann, das `server-only`
 * oder einen Treiber mitbringt. Der Re-Export bleibt, damit der Test und die
 * bisherigen Aufrufer ihre Adresse behalten.
 */
export { WEITERLEITUNGEN };
