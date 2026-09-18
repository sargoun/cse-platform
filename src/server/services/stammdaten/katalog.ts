import 'server-only';

/**
 * Das Gemeinsame der fuenf Stammdatenkataloge (OPS-02, OPS-03, SEC-01,
 * EMP-05, EMP-10; `04-SEITENKARTE` §5.13).
 *
 * **Warum es diese Datei gibt.** Fuenf Kataloge, fuenf Pflegeseiten, und
 * dieselben vier Fragen in jedem: ist der Schluessel formgerecht, traegt die
 * Zeile eine Bezeichnung, gehoert sie der Plattform oder dieser Gesellschaft,
 * und welche der vier Arbeitersprachen sind hinterlegt (EMP-12). Fuenfmal
 * geschrieben laufen die Antworten auseinander — und zwar unbemerkt, weil
 * jede einzelne fuer sich plausibel bleibt.
 *
 * **Hier wird nichts gerechnet.** Kein Geld, keine Menge, keine Frist: die
 * Kataloge tragen Werte, aus denen ANDERE Dienste rechnen
 * (`kalkulation/raumbuch`, `reinigung/sollzeit`, `abwesenheit`). Diese Schicht
 * legt ab, was ein Mensch eingegeben hat, und weist ab, was die Datenbank
 * ohnehin abweisen wuerde — nur mit einem Satz, den ein Mensch lesen kann.
 */

/** Die vier Sprachen der Arbeiteroberflaeche (SPEC §10, EMP-12). */
export const SPRACHEN = ['de', 'en', 'ar', 'tr'] as const;
export type Katalogsprache = typeof SPRACHEN[number];

export const SPRACHE_TEXT: Readonly<Record<Katalogsprache, string>> = {
  de: 'Deutsch', en: 'Englisch', ar: 'Arabisch', tr: 'Türkisch',
};

/**
 * Die Form, die jede der fuenf Tabellen als CHECK fuehrt
 * (`aa_schluessel_form`, `at_schluessel_form`).
 *
 * Sie steht hier ein zweites Mal, damit die Meldung am FELD entsteht und
 * nicht als `23514` aus der Datenbank kommt — dieselbe Regel, zwei Linien.
 */
const SCHLUESSEL_FORM = /^[a-z][a-z0-9_]{1,40}$/u;

export type Fehlergrund =
  /** Eingabe passt nicht — Form, Pflichtfeld, Wertebereich. */
  | 'ungueltig'
  /** Die Zeile gibt es nicht, oder diese Sitzung darf sie nicht aendern. */
  | 'nicht_gefunden'
  /** Plattformkatalog: nur der Super-Admin (0275, 0030 §6.16). */
  | 'plattform'
  /** `ist_system`: fuer jeden unveraenderlich (EMP-10). */
  | 'system'
  /** Der Schluessel ist auf der anderen Katalogstufe belegt (0276). */
  | 'kollision'
  /** Den Schluessel gibt es auf dieser Stufe schon. */
  | 'doppelt'
  /** Die Zeile ist in Gebrauch, und der Wert haengt daran. */
  | 'benutzt';

export class StammdatenFehler extends Error {
  constructor(readonly grund: Fehlergrund, nachricht: string) {
    super(nachricht);
    this.name = 'StammdatenFehler';
  }
}

/**
 * `„ Urlaub Halbtags "` → Fehler, `urlaub_halbtags` → `urlaub_halbtags`.
 *
 * Kleingeschrieben wird, was der Mensch gross getippt hat: die Form verlangt
 * Kleinbuchstaben, und eine Fehlermeldung wegen einer Grossschreibung, die
 * der Rechner selbst beheben kann, ist eine Huerde ohne Zweck. Alles andere
 * wird NICHT geraten — ein Leerzeichen wird nicht zum Unterstrich, weil
 * `urlaub halbtags` und `urlaub_halbtags` zwei verschiedene Schluessel in
 * einem Lohnexport sind.
 */
export function pruefeSchluessel(eingabe: string): string {
  const roh = eingabe.trim().toLowerCase();
  if (!SCHLUESSEL_FORM.test(roh)) {
    throw new StammdatenFehler('ungueltig',
      `„${eingabe.trim()}" ist kein Schlüssel. Erlaubt sind 2 bis 41 Zeichen, `
      + 'beginnend mit einem Kleinbuchstaben, danach Kleinbuchstaben, Ziffern '
      + 'und Unterstriche — der Schlüssel reist in Exporte und Lohnzuordnungen.');
  }
  return roh;
}

/** Ein Pflichttext ohne Randleerraum — leer ist kein Name. */
export function pflichttext(eingabe: string | null, feld: string): string {
  const roh = (eingabe ?? '').trim();
  if (roh === '') {
    throw new StammdatenFehler('ungueltig', `${feld} ist Pflicht.`);
  }
  return roh;
}

/**
 * Die uebersetzten Bezeichnungen — genau die vier Sprachen, nichts daneben.
 *
 * `qualifikation_sprachen` prueft in der Datenbank
 * `bezeichnung_i18n - array['de','en','ar','tr'] = '{}'`; ein fuenfter
 * Schluessel scheitert dort. Leere Felder kommen NICHT ins Objekt: eine
 * hinterlegte leere Fassung waere im Mitarbeiterportal ein Eintrag, den
 * niemand auswaehlen kann (`coalesce(nullif(… ->> $1, ''), bezeichnung)`
 * faengt das zwar ab — aber erst, nachdem jemand es geschrieben hat).
 */
export function i18nAus(
  lies: (feld: string) => string | null, deutsch: string,
): Readonly<Record<string, string>> {
  const karte: Record<string, string> = { de: deutsch };
  for (const sprache of SPRACHEN) {
    if (sprache === 'de') continue;
    const wert = (lies(`i18n_${sprache}`) ?? '').trim();
    if (wert !== '') karte[sprache] = wert;
  }
  return karte;
}

/**
 * Eine nicht-negative ganze Zahl oder `null` — nie `NaN`, nie ein Rest.
 *
 * **Neun Stellen, und die Zahl ist nicht gegriffen:** alle Ziel-Spalten sind
 * `integer`, und 999.999.999 ist die groesste Zahl mit voller Stellenzahl, die
 * sicher unter `int4` (2.147.483.647) bleibt. Eine engere Form waere eine
 * Obergrenze, die weder die Tabelle noch SPEC/DESIGN/DECISIONS kennen — und
 * die Meldung nannte sie nicht einmal, sodass `1234567` als „keine ganze
 * Zahl" abgewiesen wurde, obwohl es eine ist.
 */
export function ganzzahlOderNull(
  eingabe: string | null, feld: string, mindestens = 0,
): number | null {
  const roh = (eingabe ?? '').trim();
  if (roh === '') return null;
  if (!/^\d{1,9}$/u.test(roh)) {
    throw new StammdatenFehler('ungueltig',
      `${feld}: „${roh}" ist keine ganze Zahl bis 999999999 (die Spalte ist `
      + '`integer`).');
  }
  const zahl = Number.parseInt(roh, 10);
  if (zahl < mindestens) {
    throw new StammdatenFehler('ungueltig',
      `${feld} muss mindestens ${String(mindestens)} sein.`);
  }
  return zahl;
}

/**
 * Ein ISO-Datum, wie ein `<input type="date">` es schickt — als TEXT.
 *
 * Nicht `new Date(...)`: ein Datum durch die Zeitzone des Node-Prozesses zu
 * schicken macht aus dem 1. Maerz je nach Stunde den 28. Februar (K-11,
 * Invariante 2). Postgres bekommt den Text und castet ihn selbst.
 */
export function isoDatum(eingabe: string | null, feld: string): string {
  const roh = (eingabe ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(roh)) {
    throw new StammdatenFehler('ungueltig', `${feld} ist Pflicht (Format JJJJ-MM-TT).`);
  }
  return roh;
}

/**
 * Wer diese Zeile pflegen darf — die eine Frage, die auf allen fuenf Seiten
 * dieselbe ist.
 *
 * Sie beantwortet NICHT „darf dieser Mensch schreiben" (das entscheiden
 * `authorize` und die RLS), sondern „welche der sichtbaren Zeilen bietet die
 * Seite ueberhaupt zum Aendern an". Ein Bearbeiten-Knopf an einer
 * Plattformzeile, die die Datenbank abweist, ist ein Versprechen, das die
 * naechste Person einloest und dann eine 500 sieht.
 */
export function pflegbar(
  zeile: { readonly istPlattform: boolean; readonly istSystem?: boolean },
  istSuperAdmin: boolean,
): boolean {
  if (zeile.istSystem === true) return false;
  return zeile.istPlattform ? istSuperAdmin : true;
}

/** Der Satz, der an einer nicht pflegbaren Zeile steht. */
export function sperrgrund(
  zeile: { readonly istPlattform: boolean; readonly istSystem?: boolean },
  istSuperAdmin: boolean,
): string | null {
  if (zeile.istSystem === true) {
    return 'Systemeintrag — für jeden unveränderlich: an ihm hängt die Kette '
      + 'Antrag → Abwesenheit (EMP-10).';
  }
  if (zeile.istPlattform && !istSuperAdmin) {
    return 'Plattformkatalog — hier nicht änderbar. Diese Zeile gilt für alle '
      + 'vier Gesellschaften und wird von der Super-Administration gepflegt.';
  }
  return null;
}

/**
 * Die Kollision ueber die KATALOGSTUFEN hinweg — aus dem Ausloeser zurueck in
 * einen Satz.
 *
 * `kern.katalog_schluessel_frei` (0276) meldet mit
 * `errcode = 'unique_violation'`, weil das der naechstliegende Code ist. Fuer
 * `alsStammdatenFehler` sieht das aus wie eine gewoehnliche Dublette auf
 * DERSELBEN Stufe, und der Mensch bekaeme „Diesen Schluessel fuehrt dieser
 * Katalog schon" — die Meldung fuer einen anderen Fall. Unterscheidbar sind
 * die beiden nur am Text des Ausloesers, und genau den liest diese Funktion.
 *
 * Sie steht deshalb VOR `alsStammdatenFehler`: beide sehen `23505`.
 */
export function alsStufenkollision(fehler: unknown): StammdatenFehler | null {
  const f = fehler as { code?: unknown; message?: unknown };
  if (f.code !== '23505') return null;
  const text = typeof f.message === 'string' ? f.message : '';
  if (!text.includes('anderen Katalogstufe')) return null;
  return new StammdatenFehler('kollision',
    'Diesen Schlüssel führt die ANDERE Katalogstufe schon — entweder der '
    + 'Plattformkatalog oder mindestens eine Gesellschaft als eigene Art. Im '
    + 'Antragsformular stünden sonst zwei gleich aussehende Einträge mit '
    + 'verschiedener Lohnfolge (0276).');
}

/**
 * Der Uebersetzer fuer die Schranken, die ALLE fuenf Kataloge teilen.
 *
 * Eine `23505` aus einer Katalogtabelle heisst immer dasselbe: den Schluessel
 * gibt es schon. Eine `42501` heisst: die Policy hat abgewiesen — und weil
 * `force row level security` gilt, ist das die Plattformzeile ohne
 * Super-Admin. Beide ohne Uebersetzung landeten als Datenbanktext auf dem
 * Bildschirm.
 */
export function alsStammdatenFehler(fehler: unknown, was: string): StammdatenFehler | null {
  const f = fehler as { code?: unknown; message?: unknown };
  if (f.code === '23505') {
    return new StammdatenFehler('doppelt',
      `Diesen Schlüssel führt ${was} schon. Ein zweiter Eintrag mit demselben `
      + 'Schlüssel wäre in jedem Export dieselbe Zeile.');
  }
  if (f.code === '42501') {
    return new StammdatenFehler('plattform',
      'Diese Zeile gehört dem Plattformkatalog und wird von der '
      + 'Super-Administration gepflegt (mit zweitem Faktor).');
  }
  return null;
}
