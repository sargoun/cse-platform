import 'server-only';
import { sicherRegistriert, type ArtDefinition } from '../../benachrichtigung/registry.js';
import { UEBERSICHT_TEXTE } from '../../../lib/i18n/verwaltung/finanzen/uebersicht.js';

/**
 * Die Meldungen der SPEC-§14-Wachen (NOT-01, NOT-02, NOT-03): drei aus dem
 * Dienstplan und dem Bau, seit V-286 dazu der Bruch der Rechnungs-Hashkette.
 *
 * **Drei Arten und nicht eine „Dienstplanwarnung".** NOT-02 hängt je Art:
 * eine Einsatzleitung, die die abendliche Besetzungswarnung unbedingt per
 * E-Mail will, aber die stündliche Zeiterfassungslücke nur im Posteingang,
 * kann das nur einstellen, wenn es getrennte Arten sind.
 *
 * **Zusammengesetzte Schlüssel** — ein Literal der Form `<modul>.<etwas>`
 * läse der Rechtekatalog-Scanner als Rechteschlüssel (K-19, D-493).
 */

const DIENSTPLAN = 'dienstplan';
const BAU = 'bau';
const FINANZEN = 'finanzen';

export const ART_SCHICHT_OHNE_ZEIT = `${DIENSTPLAN}.schicht_ohne_zeiteintrag`;
export const ART_MORGEN_UNBESETZT = `${DIENSTPLAN}.morgen_unbesetzt`;
export const ART_NACHTRAG_OFFEN = `${BAU}.nachtrag_ueberfaellig`;
export const ART_KETTE_GEBROCHEN = `${FINANZEN}.kette_gebrochen`;

function ziel(slug: unknown, pfad: string): string | null {
  return typeof slug === 'string' && slug !== '' ? `/portal/${slug}${pfad}` : null;
}

/**
 * **Nicht sammelbar, alle drei.**
 *
 * Eine Besetzungslücke für morgen in der Tageszusammenfassung des nächsten
 * Morgens zu lesen, heisst sie am Einsatztag zu lesen — dann ist niemand mehr
 * zu finden. Ein fehlender Zeiteintrag verjährt zwar nicht, aber die
 * Nacherfassung ist umso glaubwürdiger, je näher sie am Tag liegt. Und ein
 * Nachtrag, der seit vierzehn Tagen offen ist, hat schon genug gewartet.
 */
function schichtOhneZeit(): ArtDefinition {
  return ({
    schluessel: ART_SCHICHT_OHNE_ZEIT,
    titel: (k) => `Kein Zeiteintrag: ${String(k.daten['person'] ?? 'unbekannt')}, `
      + `${String(k.daten['ende'] ?? '')}`,
    text: (k) => {
      const objekt = k.daten['objekt'];
      return `Die Schicht von ${String(k.daten['person'] ?? 'unbekannt')} endete `
        + `${String(k.daten['ende'] ?? '')}`
        + (typeof objekt === 'string' ? ` (${objekt})` : '')
        + `, vor ${String(k.daten['stunden'] ?? '?')} Stunden — und es liegt kein Zeiteintrag `
        + 'vor. Entweder nacherfassen (die Abweichung wird dabei festgehalten) oder die '
        + 'Zuordnung richtigstellen, wenn die Schicht nicht gearbeitet wurde.';
    },
    /*
     * **`/zeiten/`, nicht `/zeit/`** (V-034). Der Modulpfad heisst `zeiten`;
     * `/portal/<slug>/zeit/nacherfassung` gibt es im Routenregister nicht,
     * und die Meldung fuehrte damit jede Nacht auf eine 404. Eine Warnung,
     * deren einziger Verweis ins Leere zeigt, ist schlimmer als keine: sie
     * sieht aus wie eine, der jemand nachgegangen ist.
     */
    ziel: (k) => ziel(k.mandantSlug, '/zeiten/nacherfassung'),
    kanaeleVorgabe: ['app'],
    sammelbar: false,
  });
}

function morgenUnbesetzt(): ArtDefinition {
  return ({
    schluessel: ART_MORGEN_UNBESETZT,
    titel: (k) => `Morgen unbesetzt: ${String(k.daten['objekt'] ?? 'Einsatz')}, `
      + `${String(k.daten['beginn'] ?? '')}`,
    text: (k) =>
      `Für morgen sind ${String(k.daten['besetzt'] ?? 0)} von `
      + `${String(k.daten['soll'] ?? 0)} Plätzen zugesagt`
      + (typeof k.daten['objekt'] === 'string' ? ` (${String(k.daten['objekt'])})` : '')
      + `, Beginn ${String(k.daten['beginn'] ?? '')}. Gezählt werden ZUSAGEN, nicht `
      + 'Einteilungen — wer eingeteilt ist und nicht zugesagt hat, steht morgen nicht da.',
    /*
     * **`/dienstplan/tag`, nicht `/dienstplan`** (V-034, zweiter Fund).
     *
     * Ein blosses `/portal/<slug>/dienstplan` gibt es nicht: das Modul hat
     * keine Wurzelseite, sondern vier Ansichten (`woche`, `monat`, `tag`,
     * `serien`). Der Verweis fuehrte auf eine 404.
     *
     * Von den vieren ist `tag` die richtige: die Meldung sagt „morgen sind
     * drei von fuenf Plaetzen zugesagt", und die Tagesansicht ist die
     * Disposition — dort wird nachbesetzt. Die Wochenansicht waere die
     * Uebersicht und verlangte einen zweiten Klick an genau der Stelle, an
     * der jemand um sechs Uhr morgens schnell sein muss.
     */
    ziel: (k) => ziel(k.mandantSlug, '/dienstplan/tag'),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

function nachtragOffen(): ArtDefinition {
  return ({
    schluessel: ART_NACHTRAG_OFFEN,
    titel: (k) => `Nachtrag ${String(k.daten['nummer'] ?? '')} seit `
      + `${String(k.daten['tage'] ?? '?')} Tagen angemeldet`,
    text: (k) =>
      `„${String(k.daten['titel'] ?? 'Nachtrag')}" im Projekt `
      + `${String(k.daten['projekt'] ?? 'unbekannt')} ist seit `
      + `${String(k.daten['angemeldet'] ?? '')} angemeldet und nicht eingereicht. `
      + 'Nach § 2 Abs. 6 VOB/B gehört die Ankündigung VOR der Ausführung; eine Forderung, '
      + 'die erst nach der Leistung eingereicht wird, ist schwer durchzusetzen.'
      /*
       * Ohne Bauleitung geht die Meldung an die Leitung der Gesellschaft
       * (V-381) — und sagt, warum: sonst liest sie sich wie ein Irrläufer.
       */
      + (k.daten['ohneBauleitung'] === true
        ? ' Das Projekt hat keine Bauleitung; deshalb geht diese Meldung an die Leitung '
          + 'der Gesellschaft. Bitte eine Bauleitung eintragen.'
        : ''),
    /* Das Ziel liefert der Dienst als fertigen Pfad — es enthaelt Projekt UND Nachtrag. */
    ziel: (k) => (typeof k.daten['ziel'] === 'string' && k.daten['ziel'] !== ''
      ? String(k.daten['ziel']) : null),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

/**
 * „Hashkette gebrochen" (SPEC §14: „alert immediately", FIN-06, V-286).
 *
 * Die Meldung geht an Buchhaltung und Geschäftsführung der Gesellschaft
 * (`kern.kette_meldung_empfaenger`, 0507), nicht an die Person, die eine
 * Rechnung geschrieben hat: ein Bruch ist ein Befund über den Bestand, keiner
 * über eine Handlung. Der Grund steht im Satz der Hashketten-Ansicht, damit
 * Meldung und Ansicht dasselbe sagen.
 */
function ketteGebrochen(): ArtDefinition {
  const gruende = UEBERSICHT_TEXTE.de.bruchGrund as Readonly<Record<string, string>>;
  return ({
    schluessel: ART_KETTE_GEBROCHEN,
    titel: (k) => `Hashkette gebrochen bei Rechnung ${String(k.daten['nummer'] ?? '?')}`,
    text: (k) => {
      const grund = String(k.daten['grund'] ?? '');
      return 'Die nächtliche Prüfung der Rechnungs-Hashkette hat einen Bruch gefunden: '
        + `Rechnung ${String(k.daten['nummer'] ?? '?')}, Kreis `
        + `${String(k.daten['kreis'] ?? '?')}, Position ${String(k.daten['position'] ?? '?')}. `
        + `${gruende[grund] ?? grund} `
        + 'Festgeschriebene Rechnungen lassen sich nicht ändern; der Befund heißt, dass '
        + 'gespeicherte Daten nicht mehr zu ihrem Hash passen. Bitte die Hashketten-Ansicht '
        + 'prüfen und die Steuerberatung einbeziehen.';
    },
    ziel: (k) => ziel(k.mandantSlug, '/finanzen/hashkette'),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

/**
 * Idempotent, wie bei den Radararten (D-493): der Bootstrap läuft im Test
 * mehrfach — und `sicherRegistriert` prüft je Schlüssel. Die frühere
 * Fassung fragte nur die erste Art; fehlte danach eine der beiden anderen,
 * blieb sie für immer unangemeldet, und der Wächter meldete nachts eine
 * Lücke, die niemand je zu sehen bekam.
 */
export function registriereWaechterArten(): readonly ArtDefinition[] {
  return sicherRegistriert([
    schichtOhneZeit(), morgenUnbesetzt(), nachtragOffen(), ketteGebrochen(),
  ]);
}
