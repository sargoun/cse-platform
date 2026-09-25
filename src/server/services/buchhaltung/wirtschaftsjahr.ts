/**
 * Das Wirtschaftsjahr einer Gesellschaft — und der Zeitraum, den ein
 * Jahrgang umfasst (ACC-06, ACC-11, O-05).
 *
 * Monat und Tag des Beginns stehen in `datev_konfiguration`
 * (`wj_beginn_monat`, `wj_beginn_tag`, seit 0126) und tragen dort den
 * Platzhalter, solange O-05 offen ist. Ohne Zeile gilt das Kalenderjahr —
 * als Platzhalter, nicht als Entscheidung: der Bildschirm sagt es.
 *
 * **Was das Wirtschaftsjahr bestimmt und was nicht.** Es bestimmt, welche
 * Belege zu einem Jahrgang gehoeren (Pruefbuendel, Jahrespaket, Z3). Es
 * bestimmt NICHT den Beginn der Aufbewahrungsfrist: der ist der Schluss des
 * Kalenderjahrs (§ 147 Abs. 4 AO, `app.aufbewahrung_ende`, D-483).
 *
 * Reine Zeichenketten- und UTC-Kalenderarithmetik: kein Zeitpunkt, keine
 * Zone, nur Kalendertage (Invariante 2, K-11).
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface Wirtschaftsjahr {
  readonly beginnMonat: number;
  readonly beginnTag: number;
  /** Solange O-05 offen ist: der Beginn ist angenommen, nicht bestaetigt. */
  readonly istPlatzhalter: boolean;
}

export interface Zeitraum {
  readonly von: string;
  readonly bis: string;
  /** „2026" fuer das Kalenderjahr, „2026/2027" fuer ein abweichendes. */
  readonly bezeichnung: string;
}

export class WirtschaftsjahrFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'WirtschaftsjahrFehler';
  }
}

export const KALENDERJAHR: Wirtschaftsjahr = { beginnMonat: 1, beginnTag: 1, istPlatzhalter: true };

const ISO = /^\d{4}-\d{2}-\d{2}$/u;

function iso(jahr: number, monat: number, tag: number): string {
  return `${String(jahr).padStart(4, '0')}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

function tagUtc(jahr: number, monat: number, tag: number): number {
  const t = Date.UTC(jahr, monat - 1, tag);
  const d = new Date(t);
  if (d.getUTCFullYear() !== jahr || d.getUTCMonth() !== monat - 1 || d.getUTCDate() !== tag) {
    throw new WirtschaftsjahrFehler(`Kein Kalendertag: ${iso(jahr, monat, tag)}`);
  }
  return t;
}

function vonUtc(t: number): string {
  const d = new Date(t);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const TAG_MS = 86_400_000;

/** Der Zeitraum des Wirtschaftsjahrs, das im Kalenderjahr `jahr` BEGINNT. */
export function wirtschaftsjahrZeitraum(jahr: number, wj: Wirtschaftsjahr): Zeitraum {
  if (!Number.isInteger(jahr) || jahr < 1900 || jahr > 2200) {
    throw new WirtschaftsjahrFehler(`Kein Jahr: ${String(jahr)}`);
  }
  const beginn = tagUtc(jahr, wj.beginnMonat, wj.beginnTag);
  const naechster = tagUtc(jahr + 1, wj.beginnMonat, wj.beginnTag);
  const kalender = wj.beginnMonat === 1 && wj.beginnTag === 1;
  return {
    von: vonUtc(beginn),
    bis: vonUtc(naechster - TAG_MS),
    bezeichnung: kalender ? String(jahr) : `${String(jahr)}/${String(jahr + 1)}`,
  };
}

/** Das Beginnjahr des Wirtschaftsjahrs, in dem ein Kalendertag liegt. */
export function wirtschaftsjahrVon(datum: string, wj: Wirtschaftsjahr): number {
  if (!ISO.test(datum)) throw new WirtschaftsjahrFehler(`Kein ISO-Kalendertag: ${datum}`);
  const jahr = Number(datum.slice(0, 4));
  const beginnImJahr = iso(jahr, wj.beginnMonat, wj.beginnTag);
  return datum >= beginnImJahr ? jahr : jahr - 1;
}

interface KonfigRoh {
  readonly wj_beginn_monat: number | null;
  readonly wj_beginn_tag: number | null;
  readonly ist_platzhalter: boolean;
}

/** Aus den Stammdaten des aktiven Bereichs — unter der Policy, nie per Parameter. */
export async function liesWirtschaftsjahr(db: Abfrage): Promise<Wirtschaftsjahr> {
  return (await liesWirtschaftsjahrWennGepflegt(db)) ?? KALENDERJAHR;
}

/**
 * Wie `liesWirtschaftsjahr`, aber `null` statt des Kalenderjahrs, wenn keine
 * Zeile sichtbar ist oder Monat/Tag fehlen.
 *
 * Für eine Frage, die mit einer ANGENOMMENEN Antwort falsch würde: die
 * Vorschau des DATEV-Stapels sperrt den Knopf, wenn der Zeitraum über den
 * WJ-Beginn reicht (V-212). Wer `buchhaltung.exportieren` hält, aber nicht
 * `buchhaltung_konfiguration.lesen`, sieht die Zeile nicht — ein
 * angenommenes Kalenderjahr sperrte ihm dann einen Zeitraum, der in einem
 * abweichenden Wirtschaftsjahr völlig in Ordnung ist. Ohne Wissen sagt die
 * Vorschau nichts; der Dienst prüft beim Erzeugen mit den echten Stammdaten.
 */
export async function liesWirtschaftsjahrWennGepflegt(db: Abfrage): Promise<Wirtschaftsjahr | null> {
  const [k] = await db.abfrage<KonfigRoh>(
    `select wj_beginn_monat, wj_beginn_tag, ist_platzhalter
       from datev_konfiguration
      where mandant_id = app.aktiver_mandant()`);
  if (k === undefined || k.wj_beginn_monat === null || k.wj_beginn_tag === null) return null;
  return { beginnMonat: k.wj_beginn_monat, beginnTag: k.wj_beginn_tag, istPlatzhalter: k.ist_platzhalter };
}
