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
 *
 * **Ein Feld aus mehreren Werten** (Kästchen gleichen Namens, V-267) reist als
 * Liste: jeder Wert einmal (`?teilnehmer=a&teilnehmer=b`), jeder gekürzt wie
 * ein einzelner. Ohne das kam ein abgewiesenes Terminformular mit allen
 * Textfeldern und LEEREN Teilnehmenden zurück — wer korrigierte und erneut
 * absandte, legte den Termin still ohne die Eingeladenen an.
 */
export function maskeMitEingaben(
  pfad: string,
  grund: string,
  werte: Readonly<Record<string, string | readonly string[] | null | undefined>>,
): string {
  const [basis, vorhanden] = pfad.split('?', 2) as [string, string | undefined];
  const suche = new URLSearchParams(vorhanden ?? '');
  eingabenSetzen(suche, werte);
  suche.set('fehler', grund);
  return `${basis}?${suche.toString()}`;
}

/**
 * Die Eingaben einer Maske in eine Abfrage setzen — nach den Regeln von
 * `maskeMitEingaben`, die es hier zum zweiten Aufrufer gibt: dem Rückweg der
 * Arbeiterformulare (`grundAufsFormularweg`, V-198 mit V-187…V-189), der sein
 * Ziel erst prüft (`internesZiel`) und dann die Abfrage füllt. Leere und
 * fehlende Werte fallen weg, ein Feld namens `fehler` nie hinein, jeder Wert
 * gekürzt auf `MASKE_WERT_HOECHSTENS`. Ein Feld aus mehreren Werten reist als
 * Liste, jeder Wert einmal (V-267).
 */
export function eingabenSetzen(
  suche: URLSearchParams,
  werte: Readonly<Record<string, string | readonly string[] | null | undefined>>,
): void {
  const gekuerzt = (t: string): string =>
    (t.length > MASKE_WERT_HOECHSTENS ? t.slice(0, MASKE_WERT_HOECHSTENS) : t);
  for (const [name, wert] of Object.entries(werte)) {
    if (name === 'fehler' || wert === null || wert === undefined) continue;
    if (typeof wert !== 'string') {
      suche.delete(name);
      for (const w of wert) {
        const t = w.trim();
        if (t !== '') suche.append(name, gekuerzt(t));
      }
      continue;
    }
    const t = wert.trim();
    if (t === '') continue;
    suche.set(name, gekuerzt(t));
  }
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

/**
 * Die vorbelegten Werte eines Felds aus mehreren (Kästchen gleichen Namens) —
 * `undefined`, wenn die Adresse keinen trägt. Jeder Wert gekürzt wie bei
 * `vorbelegt`.
 */
export function vorbelegteListe(
  suche: Readonly<Record<string, string | string[] | undefined>>, name: string,
): readonly string[] | undefined {
  const wert = suche[name];
  if (wert === undefined) return undefined;
  return (typeof wert === 'string' ? [wert] : wert)
    .map((w) => (w.length > MASKE_WERT_HOECHSTENS ? w.slice(0, MASKE_WERT_HOECHSTENS) : w));
}
