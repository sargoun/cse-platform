/**
 * **Ist das dieselbe Anschrift?** (V-361, O-70, D-817)
 *
 * Ein Gebäude ist ein Objekt (O-70, D-792). Damit zwei Erfasser dasselbe Haus
 * nicht zweimal anlegen — zwei Raumbücher, zwei Schlüsselsätze, zwei
 * Objektnummern für dieselbe Tür —, fragt `legeObjektAn` vorher nach
 * Objekten der Gesellschaft mit derselben Anschrift. „Dieselbe" heisst:
 * derselbe Schlüssel aus Postleitzahl, Strasse und Hausnummer, so
 * normalisiert, dass Schreibweisen nicht zählen.
 *
 * **Was gleich wird:** Gross- und Kleinschreibung, Umlaute und ß (`ä` = `ae`,
 * `ß` = `ss`), Akzente, „Straße"/„Strasse"/„Str." am Wortende, Leerzeichen,
 * Bindestriche und Satzzeichen — `Karl-Marx-Allee 31` und `karl marx allee
 * 31`, `Hauptstr. 5 a` und `Hauptstraße 5a`.
 *
 * **Was verschieden bleibt:** eine andere Hausnummer (`5` und `5a` sind zwei
 * Häuser), eine andere Postleitzahl und der Ort, der neben der Postleitzahl
 * nichts unterscheidet. Eine Wohnanlage mit mehreren Häusern hat mehrere
 * Hausnummern; wo sie nur eine hat, legt der Mensch nach einer bewussten
 * Bestätigung trotzdem an.
 */

export interface Anschrift {
  readonly strasse: string;
  readonly hausnummer?: string | null | undefined;
  readonly plz: string;
}

/** Kleinbuchstaben, Umlaute ausgeschrieben, Akzente weg. */
function gefaltet(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/gu, 'ae').replace(/ö/gu, 'oe').replace(/ü/gu, 'ue').replace(/ß/gu, 'ss')
    .normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** Nur Buchstaben und Ziffern. */
function verdichtet(text: string): string {
  return text.replace(/[^a-z0-9]/gu, '');
}

export function normalisierteStrasse(strasse: string): string {
  /*
   * „Straße", „Strasse", „Str." und „Str" am WORTENDE werden zu `str` —
   * „Hauptstraße" und „Hauptstr." sind dieselbe Strasse. Mitten im Wort bleibt
   * es stehen: „Strassburger Platz" ist keine Abkürzung.
   */
  return verdichtet(gefaltet(strasse).replace(/(str)(?:asse|\.)?(?=[^a-z]|$)/gu, '$1'));
}

export function normalisierteHausnummer(hausnummer: string | null | undefined): string {
  return verdichtet(gefaltet(hausnummer ?? ''));
}

/** Der Schlüssel, an dem zwei Anschriften als dieselbe gelten. */
export function anschriftSchluessel(a: Anschrift): string {
  const plz = a.plz.replace(/\D/gu, '');
  return `${plz}|${normalisierteStrasse(a.strasse)}|${normalisierteHausnummer(a.hausnummer)}`;
}

/** Die Felder, die nach „Anschrift schon vorhanden" ins Formular zurückreisen (V-361). */
export const ZURUECKGEREICHTE_FELDER = [
  'bezeichnung', 'strasse', 'plz', 'ort', 'hausnummer', 'adresszusatz', 'land', 'kundeId',
  'gebaeudetyp', 'etagenAnzahl', 'geoLat', 'geoLon', 'objektnummer',
] as const;
export type ZurueckgereichtesFeld = (typeof ZURUECKGEREICHTE_FELDER)[number];

/**
 * `?werte=` lesen — nur die bekannten Felder, nur Text, höchstens 200 Zeichen.
 *
 * Die Adresse ist Eingabe von aussen: was nicht in der Liste steht oder kein
 * Text ist, fällt weg, und ein kaputtes JSON heisst „nichts mitgebracht",
 * kein 500.
 */
export function zurueckgereichteWerte(
  roh: unknown,
): Readonly<Partial<Record<ZurueckgereichtesFeld, string>>> {
  if (typeof roh !== 'string' || roh.length > 4000) return {};
  let daten: unknown;
  try { daten = JSON.parse(roh); } catch { return {}; }
  if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) return {};
  const aus: Partial<Record<ZurueckgereichtesFeld, string>> = {};
  for (const feld of ZURUECKGEREICHTE_FELDER) {
    const wert = (daten as Record<string, unknown>)[feld];
    if (typeof wert === 'string' && wert.length <= 200) aus[feld] = wert;
  }
  return aus;
}
