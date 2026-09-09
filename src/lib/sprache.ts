/**
 * Die Sprachen der oeffentlichen Website — Deutsch und Englisch.
 *
 * **Deutsch hat keinen Praefix.** Die Gruppe ist berlinerisch, ihre Kunden
 * sind es ueberwiegend auch, und die deutschen Adressen sind bereits im Umlauf.
 * Ein nachtraegliches `/de` vor jede davon zu setzen hiesse, jede bestehende
 * Adresse umzuleiten und den Suchmaschinen ohne Not zu erklaeren, dass die
 * Startseite umgezogen ist. Englisch bekommt deshalb den Praefix, Deutsch
 * bleibt, wo es steht.
 *
 * Die Datenbank war darauf vorbereitet: `seite` traegt `sprache` und einen
 * eindeutigen Index auf `(pfad, sprache)` — eine englische Seite ist eine
 * eigene Zeile mit eigenen Abschnitten, keine Uebersetzungstabelle daneben.
 */

export const SPRACHEN = ['de', 'en'] as const;
export type Sprache = (typeof SPRACHEN)[number];

/** Ohne Angabe ist es Deutsch. */
export const VORGABE_SPRACHE: Sprache = 'de';

/** Was in `<html lang>` steht (WCAG 3.1.1) und in `hreflang`. */
export const BCP47: Readonly<Record<Sprache, string>> = { de: 'de-DE', en: 'en' };

/** Was Open Graph erwartet — eine andere Schreibweise derselben Sache. */
export const OG_LOCALE: Readonly<Record<Sprache, string>> = { de: 'de_DE', en: 'en_US' };

/** Der Name der Sprache IN ihrer Sprache — nie übersetzt (Usability). */
export const EIGENNAME: Readonly<Record<Sprache, string>> = {
  de: 'Deutsch', en: 'English',
};

export function istSprache(wert: string): wert is Sprache {
  return (SPRACHEN as readonly string[]).includes(wert);
}

/**
 * Der Praefix einer Sprache — leer fuer die Vorgabe.
 *
 * Eine Funktion und keine Tabelle, damit `de` gar keinen Praefix HABEN kann:
 * ein Eintrag `de: '/de'` waere eine Zeile weit von einem doppelten Bestand
 * derselben Seite entfernt.
 */
export function praefix(sprache: Sprache): string {
  return sprache === VORGABE_SPRACHE ? '' : `/${sprache}`;
}

export interface ZerlegterPfad {
  readonly sprache: Sprache;
  /** Der Pfad OHNE Sprachpraefix — so, wie er in `seite.pfad` steht. */
  readonly pfad: string;
}

/**
 * Trennt den Sprachpraefix vom Inhaltspfad.
 *
 * `/en/kontakt` → `en` + `/kontakt`; `/en` → `en` + `/`; `/kontakt` → `de` +
 * `/kontakt`. Der Praefix muss ein GANZES Segment sein: `/englisch` ist kein
 * englischer Pfad, sondern eine deutsche Seite, die zufaellig so anfaengt.
 */
export function zerlegePfad(voll: string): ZerlegterPfad {
  const ohneQuery = voll.split('?')[0] ?? voll;
  const teile = ohneQuery.split('/').filter((s) => s !== '');
  const erstes = teile[0];
  if (erstes !== undefined && istSprache(erstes) && erstes !== VORGABE_SPRACHE) {
    const rest = teile.slice(1);
    return { sprache: erstes, pfad: rest.length === 0 ? '/' : `/${rest.join('/')}` };
  }
  return { sprache: VORGABE_SPRACHE, pfad: ohneQuery === '' ? '/' : ohneQuery };
}

/**
 * Setzt einen Inhaltspfad in eine Sprache.
 *
 * `('/kontakt', 'en')` → `/en/kontakt`, `('/', 'en')` → `/en`, und mit `de`
 * bleibt beides unveraendert. Der Pfad kommt OHNE Praefix herein; wer einen
 * praefigierten hineingibt, bekommt ihn zerlegt zurueck statt verdoppelt.
 */
export function mitSprache(pfad: string, sprache: Sprache): string {
  const { pfad: rein } = zerlegePfad(pfad);
  const p = praefix(sprache);
  if (rein === '/') return p === '' ? '/' : p;
  return `${p}${rein}`;
}

/**
 * Die Adressen EINER Seite in allen Sprachen — fuer `hreflang`.
 *
 * Sie entstehen an einer Stelle, weil `hreflang` nur wirkt, wenn die Verweise
 * gegenseitig sind: eine Seite, die auf ihre Uebersetzung zeigt, ohne dass
 * diese zurueckzeigt, wird von Google ignoriert. Zwei getrennt gepflegte
 * Listen waeren genau dieser Fall, sobald eine davon vergessen wird.
 */
export function alternativen(
  pfad: string, basis: string,
): Readonly<Record<string, string>> {
  const { pfad: rein } = zerlegePfad(pfad);
  const eintraege: Record<string, string> = {};
  for (const s of SPRACHEN) eintraege[BCP47[s]] = `${basis}${mitSprache(rein, s)}`;
  // `x-default` zeigt auf die Vorgabe: was ein Besucher bekommt, dessen
  // Sprache keine der beiden ist.
  eintraege['x-default'] = `${basis}${mitSprache(rein, VORGABE_SPRACHE)}`;
  return eintraege;
}
