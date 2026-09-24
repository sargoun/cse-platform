/**
 * **Eine abgewiesene Maske kommt mit ihren Eingaben zurück** (V-143, D-599,
 * D-637).
 *
 * Ein Formular ohne Javascript navigiert zur Route und zeigt, was
 * zurückkommt. Seit D-599 kommt bei einer Abweisung die Maske zurück, mit
 * dem Grund als Schlüssel — aber LEER: wer im Auftragsassistenten zehn Felder
 * ausgefüllt und sich bei den Wochenstunden vertippt hatte, fing von vorne
 * an. Die Eingaben reisen deshalb in der Adresse mit, und die Maske belegt
 * ihre Felder damit vor.
 *
 * **Was hier NICHT mitreist:** nichts, was geheim ist oder die Adresse
 * sprengt. Die Masken, die das nutzen, fragen Stammdaten eines Vorgangs ab
 * (Bezeichnung, Daten, Zahlen, Kennungen aus Auswahllisten); ein Kennwort
 * oder eine Datei ginge nie diesen Weg. Jeder Wert wird auf
 * `MASKE_WERT_HOECHSTENS` Zeichen gekürzt — eine Adresse mit zehn Seiten
 * Beschreibung weist mancher Proxy ab, und dann käme gar nichts zurück.
 *
 * Die Funktion ist rein: sie baut nur den Pfad. Welches Ziel intern und damit
 * erlaubt ist, entscheidet die Route (`internesZiel`).
 */

export const MASKE_WERT_HOECHSTENS = 1000;

/**
 * Der Pfad der Maske mit ihren Eingaben und dem Grund der Abweisung.
 *
 * Leere und fehlende Werte fallen weg; `fehler` steht zuletzt und gewinnt
 * gegen ein gleichnamiges Feld — eine Eingabe namens `fehler` darf den Grund
 * nicht überschreiben.
 */
export function maskeMitEingaben(
  pfad: string,
  grund: string,
  werte: Readonly<Record<string, string | null | undefined>>,
): string {
  const [basis, vorhanden] = pfad.split('?', 2) as [string, string | undefined];
  const suche = new URLSearchParams(vorhanden ?? '');
  for (const [name, wert] of Object.entries(werte)) {
    if (name === 'fehler' || wert === null || wert === undefined) continue;
    const t = wert.trim();
    if (t === '') continue;
    suche.set(name, t.length > MASKE_WERT_HOECHSTENS ? t.slice(0, MASKE_WERT_HOECHSTENS) : t);
  }
  suche.set('fehler', grund);
  return `${basis}?${suche.toString()}`;
}

/**
 * Ein vorbelegter Wert aus der Adresse — nur ein einzelner Text, nie ein
 * Feld aus mehreren (`?x=a&x=b`), nie länger als erlaubt.
 */
export function vorbelegt(
  suche: Readonly<Record<string, string | string[] | undefined>>, name: string,
): string | undefined {
  const wert = suche[name];
  if (typeof wert !== 'string') return undefined;
  return wert.length > MASKE_WERT_HOECHSTENS ? wert.slice(0, MASKE_WERT_HOECHSTENS) : wert;
}
