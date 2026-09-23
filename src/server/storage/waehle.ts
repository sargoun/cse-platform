import { devFlaechenAn } from '../../lib/dev-flaechen.js';
import { SupabaseSpeicher, type Speicher } from './adapter.js';
import { OrdnerSpeicher } from './ordner.js';

/**
 * **Welcher Speicher gilt — an EINER Stelle entschieden** (V-131, D-623).
 *
 * Bisher stand an 37 Stellen `new SupabaseSpeicher()`. Das war ehrlich, aber
 * es machte jede Ablage von genau einer Umgebungsvariable abhängig, und ein
 * zweiter Speicher hätte 37 Änderungen gebraucht — also 36 richtige und eine
 * vergessene.
 *
 * Die Reihenfolge ist die Aussage:
 *
 *  1. **Supabase, wenn verbunden.** Der echte Speicher gewinnt immer, auch
 *     wenn daneben ein Vorführordner eingetragen ist.
 *  2. **Der Vorführordner, wenn er ausdrücklich eingetragen UND erlaubt ist**
 *     (`vorfuehrOrdner`).
 *  3. **Sonst Supabase, nicht verbunden** — und der wirft bei jeder Ablage
 *     `NichtVerbundenFehler`, wie bisher.
 */
export interface SpeicherUmgebung {
  readonly NODE_ENV?: string | undefined;
  readonly CSE_DEV_FLAECHEN?: string | undefined;
  readonly CSE_SPEICHER_ORDNER?: string | undefined;
  readonly VERCEL?: string | undefined;
  readonly SUPABASE_URL?: string | undefined;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
}

/**
 * Der Vorführordner — oder `null`, wenn eine der drei Schranken greift.
 *
 * Getrennt und exportiert, damit jede Schranke einzeln prüfbar ist, ohne
 * einen Speicher zu bauen.
 */
export function vorfuehrOrdner(u: SpeicherUmgebung = process.env): string | null {
  const ordner = (u.CSE_SPEICHER_ORDNER ?? '').trim();
  if (ordner === '') return null;
  /* Auf Vercel nie: flüchtiges Dateisystem, ungewählte Region. */
  if ((u.VERCEL ?? '').trim() !== '') return null;
  if (!devFlaechenAn(u)) return null;
  return ordner;
}

export function waehleSpeicher(u: SpeicherUmgebung = process.env): Speicher {
  const echt = new SupabaseSpeicher(u.SUPABASE_URL ?? '', u.SUPABASE_SERVICE_ROLE_KEY ?? '');
  if (echt.verbunden) return echt;
  const ordner = vorfuehrOrdner(u);
  return ordner === null ? echt : new OrdnerSpeicher(ordner);
}
