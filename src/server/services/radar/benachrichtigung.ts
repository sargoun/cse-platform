import 'server-only';
import { findeArt, registriereArt, type ArtDefinition } from '../../benachrichtigung/registry.js';

/**
 * Die zwei Radarmeldungen (SPEC §14, RAD-08, NOT-01, NOT-03).
 *
 * **Zwei Arten und nicht eine.** NOT-02 ist der Grund: wer die knappe Frist
 * unbedingt per E-Mail will, aber den Treffer eines Suchprofils nur im
 * Posteingang, kann das nur einstellen, wenn beide getrennte Arten sind —
 * `benachrichtigung_praeferenz` hängt je Art.
 *
 * **Keine ist sammelbar.** Eine Fristwarnung in der Tageszusammenfassung des
 * nächsten Morgens wird einen Tag zu spät gelesen, und bei einer Restfrist
 * von vier Tagen ist ein Tag ein Viertel der verbleibenden Zeit. Dasselbe
 * Argument wie bei den Nachweiswarnungen.
 */

const FRIST_TAGE = 5;

/**
 * **Fünf Tage stehen in SPEC §14 und in RAD-06** — sie sind nicht geraten,
 * und sie sind auch keine Schwelle, die jemand setzen müsste: der Wächter
 * meldet die knappe Frist ohne jede Konfiguration. Die Schwelle, die offen
 * ist (O-15), betrifft die PUNKTZAHL, nicht die Uhr.
 */
export const FRIST_WARNUNG_TAGE = FRIST_TAGE;

/**
 * **Zusammengesetzt und nicht als Literal geschrieben** — genau wie
 * `nachweis.artSchluessel`, und aus demselben Grund: ein Zeichenkettenliteral
 * der Form `<modul>.<etwas>` in `src/**` liest der Rechtekatalog-Scanner
 * (`scripts/katalog/benutzung.ts`) als RECHTEschlüssel. Er fände dafür keine
 * Katalogzeile — ein roter Lauf für eine Benachrichtigungsart, die gar kein
 * Recht ist. Gefunden hat es K-19, beim ersten Lauf nach dem Anlegen.
 */
const MODUL = 'radar';

export const ART_FRIST = `${MODUL}.frist_knapp`;
export const ART_TREFFER = `${MODUL}.treffer`;

function radarZiel(mandantSlug: string | null | undefined, id: string): string | null {
  /* Ohne Slug kein Ziel: eine Adresse aus der Kennung führte auf 404 (D-467-Nachbar). */
  return mandantSlug === null || mandantSlug === undefined || mandantSlug === ''
    ? null : `/portal/${mandantSlug}/radar/${id}`;
}

function frist(): ArtDefinition {
  return registriereArt({
    schluessel: ART_FRIST,
    titel: (k) => {
      const tage = Number(k.daten['restTage'] ?? 0);
      return `Abgabe in ${String(tage)} ${tage === 1 ? 'Tag' : 'Tagen'}: `
        + `${String(k.daten['titel'] ?? 'Ausschreibung')}`;
    },
    text: (k) => {
      const tage = Number(k.daten['restTage'] ?? 0);
      const stand = String(k.daten['stand'] ?? 'neu');
      return `Die Angebotsfrist läuft in ${String(tage)} ${tage === 1 ? 'Tag' : 'Tagen'} ab, `
        + `und der Vorgang steht noch auf „${stand}". `
        + 'Entweder jetzt in Bearbeitung nehmen — die Vergabemappe braucht Zeit, und eine '
        + 'Plattformfreischaltung dauert Tage bis Wochen — oder mit Grund verwerfen, damit '
        + 'die Liste ehrlich bleibt.';
    },
    ziel: (k) => radarZiel(k.mandantSlug, k.objektId),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

function treffer(): ArtDefinition {
  return registriereArt({
    schluessel: ART_TREFFER,
    titel: (k) =>
      `${String(k.daten['punkte'] ?? '?')} Punkte: ${String(k.daten['titel'] ?? 'Ausschreibung')}`,
    text: (k) => {
      const grund = String(k.daten['begruendung'] ?? '');
      return `Diese Bekanntmachung erreicht ${String(k.daten['punkte'] ?? '?')} von `
        + `${String(k.daten['skalaMax'] ?? '?')} Punkten im Profil „`
        + `${String(k.daten['profil'] ?? 'unbenannt')}" und liegt damit auf oder über der `
        + `Schwelle ${String(k.daten['abPunkte'] ?? '?')}, die Sie gesetzt haben.`
        + (grund === '' ? '' : ` ${grund}`);
    },
    ziel: (k) => radarZiel(k.mandantSlug, k.objektId),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

/**
 * Registriert beide Arten — **idempotent, und das mit Bedacht**.
 *
 * `registriereArt` wirft bei einer zweiten Registrierung, und das ist richtig:
 * zwei Definitionen einer Art wären zwei Texte für dieselbe Meldung. Hier
 * kommt die zweite Registrierung aber nicht von einer zweiten Definition,
 * sondern von einem zweiten Aufruf DESSELBEN Moduls — der Jobbootstrap läuft
 * im Test mehrfach, und ein Wächter, der beim zweiten Start stirbt, fiele
 * erst in der zweiten Nacht auf. Vorhandene Art heisst: diese hier, schon da.
 */
export function registriereRadarArten(): readonly ArtDefinition[] {
  const da = findeArt(ART_FRIST);
  if (da !== undefined) {
    const zweite = findeArt(ART_TREFFER);
    return zweite === undefined ? [da] : [da, zweite];
  }
  return [frist(), treffer()];
}
