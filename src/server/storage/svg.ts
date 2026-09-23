/**
 * **Ein SVG-Logo — nur wenn es ein Bild ist und kein Programm** (V-100,
 * D-622, O-12, SEC-A6).
 *
 * 01-KERN §6.2 nennt SVG für die drei Logovarianten, und ein Logo liegt fast
 * immer als SVG vor. Eine SVG-Datei ist aber ein XML-Dokument, das Skripte,
 * Ereignisattribute, eingebettetes HTML und Verweise nach draussen tragen
 * kann. In einem `<img>` läuft davon nichts; wer die Adresse direkt öffnet,
 * bekäme ein Dokument im Ursprung der Plattform.
 *
 * Deshalb zwei Linien, nicht eine:
 *
 *  1. **Diese Prüfung weist ab, was ein Bild nicht braucht** — eine
 *     geschlossene Liste von Mustern, kein Versuch zu „reinigen". Eine
 *     Reinigung, die etwas übersieht, liefert eine Datei aus, die als
 *     geprüft gilt; eine Ablehnung liefert einen Satz.
 *  2. **Die Auslieferung** (`/api/marke/…`) setzt eine CSP mit `sandbox` und
 *     ohne jede Skriptquelle — auch was hier durchrutschte, liefe nicht.
 */

export class SvgFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'SvgFehler';
  }
}

/** 1 MB — ein Logo als Vektor ist Kilobytes gross; alles darüber ist eingebettetes Raster. */
export const SVG_MAX_BYTES = 1024 * 1024;

/**
 * Was ein Logo nie braucht. Jedes Muster mit dem Grund, weil eine Liste ohne
 * Grund die ist, aus der jemand eine Zeile streicht.
 */
const VERBOTEN: readonly { readonly muster: RegExp; readonly grund: string }[] = [
  { muster: /<!DOCTYPE|<!ENTITY/iu, grund: 'DOCTYPE/ENTITY (Entitätenexpansion, externe Entitäten)' },
  { muster: /<\s*script\b/iu, grund: 'ein Skript' },
  { muster: /\son[a-z]+\s*=/iu, grund: 'ein Ereignisattribut (on…)' },
  { muster: /javascript\s*:/iu, grund: 'eine javascript:-Adresse' },
  { muster: /<\s*foreignObject\b/iu, grund: 'eingebettetes HTML (foreignObject)' },
  { muster: /<\s*(?:iframe|embed|object|audio|video|animate|set)\b/iu, grund: 'ein aktives Element' },
  { muster: /@import/iu, grund: 'ein CSS-Import' },
  {
    muster: /(?:xlink:)?href\s*=\s*["'](?!#|data:image\/(?:png|jpeg);base64,)/iu,
    grund: 'ein Verweis nach draussen',
  },
  { muster: /url\(\s*["']?(?!#)/iu, grund: 'eine externe Ressource in CSS' },
];

/** Ist das ein SVG — also ein XML-Dokument mit `<svg` als Wurzel? */
export function istSvg(daten: Uint8Array): boolean {
  const kopf = new TextDecoder('utf-8', { fatal: false })
    .decode(daten.subarray(0, 1024)).replace(/^﻿/u, '');
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/iu.test(kopf);
}

/** Prüft ein SVG; wirft mit dem Grund, oder gibt nichts zurück. */
export function pruefeSvg(daten: Uint8Array): void {
  if (daten.length > SVG_MAX_BYTES) {
    throw new SvgFehler('Ein SVG-Logo über 1 MB trägt eingebettetes Raster — bitte als PNG.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(daten);
  } catch {
    throw new SvgFehler('Das SVG ist kein gültiges UTF-8.');
  }
  if (!istSvg(daten)) throw new SvgFehler('Die Datei ist kein SVG-Dokument.');
  for (const v of VERBOTEN) {
    if (v.muster.test(text)) {
      throw new SvgFehler(`Das SVG enthält ${v.grund} — ein Logo braucht das nicht, und es wird abgewiesen.`);
    }
  }
}
