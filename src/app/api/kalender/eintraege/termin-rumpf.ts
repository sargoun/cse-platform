import type { Rumpf } from '../../rumpf';
import { leseTerminZeiten, type TerminEingabe } from '@/server/services/kalender/termin';

/**
 * Die Lesart des Terminformulars — EINE für Anlegen und Ändern (V-221).
 *
 * Eine eigene Datei und nicht in `route.ts`: eine Routendatei darf neben den
 * HTTP-Methoden nichts exportieren, sonst weist Next.js sie beim Bauen ab.
 */

/** Die Felder, die bei einer Abweisung mit auf die Maske reisen (V-240). */
export const TERMIN_MASKE = [
  'art', 'titel', 'ort', 'beschreibung', 'ganztaegig', 'beginn', 'ende', 'vonTag', 'bisTag',
] as const;

/** Die Eingabe aus dem Rumpf. Die Zeiten löst `leseTerminZeiten` auf (Invariante 2). */
export function terminAusRumpf(rumpf: Rumpf): TerminEingabe {
  const ganztaegig = (rumpf.felder['ganztaegig'] ?? '') === 'ja';
  const zeiten = leseTerminZeiten({
    ganztaegig,
    ...(rumpf.felder['beginn'] === undefined ? {} : { beginn: rumpf.felder['beginn'] }),
    ...(rumpf.felder['ende'] === undefined ? {} : { ende: rumpf.felder['ende'] }),
    ...(rumpf.felder['vonTag'] === undefined ? {} : { vonTag: rumpf.felder['vonTag'] }),
    ...(rumpf.felder['bisTag'] === undefined ? {} : { bisTag: rumpf.felder['bisTag'] }),
  });
  return {
    art: rumpf.felder['art'] ?? '',
    titel: rumpf.felder['titel'] ?? '',
    beschreibung: rumpf.felder['beschreibung'] ?? '',
    ort: rumpf.felder['ort'] ?? '',
    beginn: zeiten.beginn,
    ende: zeiten.ende,
    ganztaegig,
    teilnehmer: rumpf.alle('teilnehmer'),
  };
}
