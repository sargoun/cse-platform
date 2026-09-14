import 'server-only';
import { findeArt, registriereArt, type ArtDefinition } from '../../benachrichtigung/registry.js';

/**
 * Die drei Meldungen der fehlenden SPEC-§14-Wachen (NOT-01, NOT-02, NOT-03).
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

export const ART_SCHICHT_OHNE_ZEIT = `${DIENSTPLAN}.schicht_ohne_zeiteintrag`;
export const ART_MORGEN_UNBESETZT = `${DIENSTPLAN}.morgen_unbesetzt`;
export const ART_NACHTRAG_OFFEN = `${BAU}.nachtrag_ueberfaellig`;

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
  return registriereArt({
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
    ziel: (k) => ziel(k.mandantSlug, '/zeit/nacherfassung'),
    kanaeleVorgabe: ['app'],
    sammelbar: false,
  });
}

function morgenUnbesetzt(): ArtDefinition {
  return registriereArt({
    schluessel: ART_MORGEN_UNBESETZT,
    titel: (k) => `Morgen unbesetzt: ${String(k.daten['objekt'] ?? 'Einsatz')}, `
      + `${String(k.daten['beginn'] ?? '')}`,
    text: (k) =>
      `Für morgen sind ${String(k.daten['besetzt'] ?? 0)} von `
      + `${String(k.daten['soll'] ?? 0)} Plätzen zugesagt`
      + (typeof k.daten['objekt'] === 'string' ? ` (${String(k.daten['objekt'])})` : '')
      + `, Beginn ${String(k.daten['beginn'] ?? '')}. Gezählt werden ZUSAGEN, nicht `
      + 'Einteilungen — wer eingeteilt ist und nicht zugesagt hat, steht morgen nicht da.',
    ziel: (k) => ziel(k.mandantSlug, '/dienstplan'),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

function nachtragOffen(): ArtDefinition {
  return registriereArt({
    schluessel: ART_NACHTRAG_OFFEN,
    titel: (k) => `Nachtrag ${String(k.daten['nummer'] ?? '')} seit `
      + `${String(k.daten['tage'] ?? '?')} Tagen angemeldet`,
    text: (k) =>
      `„${String(k.daten['titel'] ?? 'Nachtrag')}" im Projekt `
      + `${String(k.daten['projekt'] ?? 'unbekannt')} ist seit `
      + `${String(k.daten['angemeldet'] ?? '')} angemeldet und nicht eingereicht. `
      + 'Nach § 2 Abs. 6 VOB/B gehört die Ankündigung VOR der Ausführung; eine Forderung, '
      + 'die erst nach der Leistung eingereicht wird, ist schwer durchzusetzen.',
    /* Das Ziel liefert der Dienst als fertigen Pfad — es enthaelt Projekt UND Nachtrag. */
    ziel: (k) => (typeof k.daten['ziel'] === 'string' && k.daten['ziel'] !== ''
      ? String(k.daten['ziel']) : null),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

/** Idempotent, wie bei den Radararten (D-493): der Bootstrap läuft im Test mehrfach. */
export function registriereWaechterArten(): readonly ArtDefinition[] {
  if (findeArt(ART_SCHICHT_OHNE_ZEIT) !== undefined) {
    return [ART_SCHICHT_OHNE_ZEIT, ART_MORGEN_UNBESETZT, ART_NACHTRAG_OFFEN]
      .map((s) => findeArt(s))
      .filter((a): a is ArtDefinition => a !== undefined);
  }
  return [schichtOhneZeit(), morgenUnbesetzt(), nachtragOffen()];
}
