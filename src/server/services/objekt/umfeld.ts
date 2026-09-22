import 'server-only';

/**
 * **Was an einem Objekt hängt** (V-044, OPS-01, OPS-11,
 * `04-SEITENKARTE.md` §5.4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Seitenkarte beschreibt `/objekte/[id]` mit zehn Reitern: Übersicht ·
 * Raumbuch · Reviere · Posten · Dienstanweisungen · Schlüssel · Aufträge ·
 * Einsätze · Dokumente · Qualität, „each tab rendered only where its module
 * is enabled and its `lesen` right held".
 *
 * Gebaut war **einer**. Sechs der neun fehlenden Module gibt es längst — die
 * Reviere, die Posten, die Dienstanweisungen, die Schlüssel, die Aufträge,
 * die Einsätze. Sie hängen alle an derselben `objekt_id`, und von der
 * Objektseite aus führte kein Weg dorthin. Wer wissen wollte, welche
 * Schlüssel zu diesem Haus gehören, musste die Schlüsselliste öffnen und dort
 * filtern — also wissen, dass es sie gibt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ein Reiter ist ein Recht, kein Vorschlag.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jeder Reiter nennt sein Leserecht und sein Modul. Fehlt eines von beiden,
 * steht der Reiter nicht da — nicht ausgegraut, nicht mit „kein Zugriff":
 * ein Reiter, der die Existenz dessen verrät, was er nicht zeigen darf, ist
 * derselbe Verstoss gegen AUT-06 wie ein Verweis auf 404.
 *
 * **Die Zahlen kommen unter der Policy.** Gezählt wird, was DIESE Sitzung
 * sehen darf; ein Zähler ausserhalb der Policy behauptete eine Menge, deren
 * Zeilen die Liste darunter nicht zeigt — und das ist schlimmer als kein
 * Zähler.
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type ReiterSchluessel =
  | 'uebersicht' | 'raumbuch' | 'reviere' | 'posten' | 'dienstanweisungen'
  | 'schluessel' | 'auftraege' | 'einsaetze' | 'dokumente' | 'qualitaet';

export interface Reiter {
  readonly schluessel: ReiterSchluessel;
  /** `null` heisst: derselbe Schlüssel, mit dem die Seite selbst öffnet. */
  readonly recht: string | null;
}

/**
 * Die zehn Reiter in der Reihenfolge der Seitenkarte.
 *
 * **`posten` trägt `security.lesen` und nicht `posten.lesen`** — den
 * Schlüssel gibt es nicht. § 34a GewO trennt die Register (Wachbuch,
 * Dienstanweisung, Schlüssel sind eigene Rechtemodule), der Posten selbst
 * gehört zum Gewerk.
 */
export const REITER: readonly Reiter[] = [
  { schluessel: 'uebersicht', recht: null },
  { schluessel: 'raumbuch', recht: null },
  { schluessel: 'reviere', recht: 'reinigung.lesen' },
  { schluessel: 'posten', recht: 'security.lesen' },
  { schluessel: 'dienstanweisungen', recht: 'dienstanweisung.lesen' },
  { schluessel: 'schluessel', recht: 'schluessel.lesen' },
  { schluessel: 'auftraege', recht: 'auftrag.lesen' },
  { schluessel: 'einsaetze', recht: 'dienstplan.lesen' },
  { schluessel: 'dokumente', recht: 'dokument.lesen' },
  { schluessel: 'qualitaet', recht: 'qualitaet.lesen' },
];

export function istReiter(wert: unknown): wert is ReiterSchluessel {
  return typeof wert === 'string'
    && REITER.some((r) => r.schluessel === wert);
}

export type Zaehler = Readonly<Partial<Record<ReiterSchluessel, number>>>;

/**
 * Die Zahl je Reiter — in EINER Abfrage.
 *
 * Neun Rundreisen für neun Zahlen auf einer Seite, die ohnehin schon vier
 * Abfragen macht, wären neun zu viel. Gezählt wird nur, was die Sitzung
 * sehen darf: jede Unterabfrage läuft unter der Policy ihrer Tabelle.
 *
 * **Archiviertes zählt nicht mit.** Ein Revier, das aufgelöst ist, gehört
 * nicht mehr zu diesem Haus — es steht in der Spur, nicht in der Zahl.
 */
export async function zaehler(db: Abfrage, objektId: string): Promise<Zaehler> {
  const [z] = await db.abfrage<Record<string, string>>(
    `select
       (select count(*) from raum
         where objekt_id = $1::uuid)::text as raumbuch,
       (select count(*) from revier
         where objekt_id = $1::uuid and archiviert_am is null)::text as reviere,
       (select count(*) from posten
         where objekt_id = $1::uuid and archiviert_am is null)::text as posten,
       (select count(*) from dienstanweisung
         where objekt_id = $1::uuid and archiviert_am is null)::text as dienstanweisungen,
       (select count(*) from schluessel
         where objekt_id = $1::uuid and archiviert_am is null)::text as schluessel,
       (select count(*) from auftrag
         where objekt_id = $1::uuid)::text as auftraege,
       (select count(*) from einsatz
         where objekt_id = $1::uuid
           and beginn_zeitpunkt >= now() - interval '30 days')::text as einsaetze,
       (select count(*) from dokument
         where objekt_id = $1::uuid and geloescht_am is null)::text as dokumente,
       (select count(*) from qualitaetspruefung
         where objekt_id = $1::uuid)::text as qualitaet`,
    [objektId]);
  if (z === undefined) return {};
  const aus: Record<string, number> = {};
  for (const [k, v] of Object.entries(z)) aus[k] = Number(v);
  return aus as Zaehler;
}

/** Eine Zeile in einem Reiter — drei Felder, mehr braucht eine Liste nicht. */
export interface UmfeldZeile {
  readonly id: string;
  readonly text: string;
  readonly neben: string | null;
  readonly zustand: string | null;
}

const ABFRAGE: Readonly<Partial<Record<ReiterSchluessel, string>>> = {
  reviere:
    `select id, bezeichnung as text, null::text as neben, null::text as zustand
       from revier where objekt_id = $1::uuid and archiviert_am is null
      order by bezeichnung limit 200`,
  posten:
    `select id, bezeichnung as text,
            to_char(gueltig_ab, 'DD.MM.YYYY') as neben, null::text as zustand
       from posten where objekt_id = $1::uuid and archiviert_am is null
      order by gueltig_ab desc, bezeichnung limit 200`,
  dienstanweisungen:
    `select id, titel as text, null::text as neben, status::text as zustand
       from dienstanweisung where objekt_id = $1::uuid and archiviert_am is null
      order by titel limit 200`,
  schluessel:
    `select id, bezeichnung as text, null::text as neben, status::text as zustand
       from schluessel where objekt_id = $1::uuid and archiviert_am is null
      order by bezeichnung limit 200`,
  auftraege:
    `select id, auftragsnummer || ' · ' || bezeichnung as text,
            null::text as neben, status::text as zustand
       from auftrag where objekt_id = $1::uuid
      order by auftragsnummer desc limit 200`,
  /*
   * **Dreissig Tage zurück und nach vorn offen.** Ein Objekt sammelt über
   * Jahre Zehntausende Einsätze; die Frage an dieser Stelle ist „wer ist
   * hier gerade", nicht „wer war hier je". Die vollständige Liste steht im
   * Dienstplan, und dorthin führt der Verweis darunter.
   */
  einsaetze:
    `select id,
            to_char(beginn_zeitpunkt at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as text,
            to_char(ende_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI') as neben,
            quell_schluessel as zustand
       from einsatz
      where objekt_id = $1::uuid and beginn_zeitpunkt >= now() - interval '30 days'
      order by beginn_zeitpunkt desc limit 200`,
  dokumente:
    `select id, titel as text,
            to_char(entstanden_am, 'DD.MM.YYYY') as neben,
            kategorie::text as zustand
       from dokument where objekt_id = $1::uuid and geloescht_am is null
      order by entstanden_am desc limit 200`,
  qualitaet:
    `select id,
            to_char(geprueft_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as text,
            case when punkte is null then null
                 else to_char(punkte, 'FM999990D00') end as neben,
            null::text as zustand
       from qualitaetspruefung where objekt_id = $1::uuid
      order by geprueft_am desc limit 200`,
};

/**
 * Die Zeilen eines Reiters.
 *
 * `uebersicht` und `raumbuch` stehen nicht in der Tabelle: die erste IST die
 * Seite, die zweite hat ihre eigene (`/objekte/[id]/raumbuch`) und wird hier
 * nur gezählt. Eine leere Liste zurückzugeben statt zu werfen wäre hier die
 * schlechtere Antwort — ein Reiter ohne Abfrage ist ein Programmierfehler,
 * kein leeres Objekt.
 */
export async function reiterZeilen(
  db: Abfrage, objektId: string, reiter: ReiterSchluessel,
): Promise<readonly UmfeldZeile[]> {
  const sql = ABFRAGE[reiter];
  if (sql === undefined) return [];
  return db.abfrage<UmfeldZeile>(sql, [objektId]);
}
