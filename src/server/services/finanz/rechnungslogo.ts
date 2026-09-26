import type { RechnungsLogo } from './kanonisch.js';

/**
 * **Welches Logo eine Rechnung druckt** (V-132, D-625, DESIGN §4/§11).
 *
 * Rein und ohne Datenbank: die Festschreibung reicht die beiden Pfade aus
 * `mandant_identitaet` herein, der Leser des Snapshots prüft mit derselben
 * Regel, was darin steht. So gibt es die Regel genau einmal.
 *
 * **Die Wahl** folgt der Tabelle in DESIGN §4 („Uploaded brand images"):
 * das Drucklogo, sonst das Logo für helle Flächen — Papier ist hell. Das
 * Logo für dunkle Flächen nie: es verschwände auf weissem Papier. Dieselbe
 * Wahl trifft das Angebotsblatt (`angebote/[id]/pdf`).
 *
 * **Nur Raster.** Ein SVG lässt sich in PDF/A-3 nicht einbetten, ohne es
 * umzurechnen, und eine Umrechnung wäre ein zweites Bild, das niemand
 * gesehen hat. Ist das Drucklogo ein SVG und das helle ein PNG, druckt die
 * Rechnung das PNG; sind beide SVG, druckt sie den Namen wie bisher — und
 * die Identitätsseite sagt das (V-132).
 */

/**
 * `<mandant>/<art>/<sha256>.<png|jpg>` — das Schlüsselformat aus
 * `markenbildSchluessel` und `mi_bildpfad_eigen` (0393), eingeschränkt auf
 * die beiden Logos, die auf Papier dürfen, und auf Raster.
 */
const SCHLUESSEL =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(logo_druck|logo_hell)\/([0-9a-f]{64})\.(png|jpg)$/u;

export interface ZerlegterLogoSchluessel {
  readonly mandantId: string;
  readonly sha256: string;
  readonly mime: RechnungsLogo['mime'];
}

/** `null`, wenn der Schlüssel kein druckbares Logo bezeichnet. */
export function zerlegeLogoSchluessel(schluessel: string): ZerlegterLogoSchluessel | null {
  const t = SCHLUESSEL.exec(schluessel);
  if (t === null) return null;
  return {
    mandantId: t[1] ?? '',
    sha256: t[3] ?? '',
    mime: t[4] === 'png' ? 'image/png' : 'image/jpeg',
  };
}

/**
 * Das Logo, das bei der Festschreibung in die Nutzlast kopiert wird.
 *
 * Ein Pfad eines FREMDEN Mandanten wird nicht genommen — 0393 schliesst ihn
 * schon aus, aber die Nutzlast ist der Beweis, und in ihm steht nichts, was
 * nur eine andere Schicht verhindert hat.
 */
export function waehleRechnungsLogo(
  mandantId: string, druckPfad: string | null, hellPfad: string | null,
): RechnungsLogo | null {
  for (const pfad of [druckPfad, hellPfad]) {
    if (pfad === null) continue;
    const z = zerlegeLogoSchluessel(pfad);
    if (z === null || z.mandantId !== mandantId) continue;
    return { schluessel: pfad, sha256: z.sha256, mime: z.mime };
  }
  return null;
}
