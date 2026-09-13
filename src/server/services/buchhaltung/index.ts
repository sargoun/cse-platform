import 'server-only';

/**
 * Die Buchhaltung (Phase 7, ACC-01 …): Kontenrahmen, Kontenzuordnung,
 * Perioden und Buchungssätze.
 *
 * Ein Wiedereinstieg, damit Aufrufer nicht in die Innereien greifen — und
 * damit sichtbar ist, was dieses Verzeichnis nach aussen verspricht.
 */
export {
  KONTENRAHMEN, RAHMEN_NAME, RECHNUNG_BRAUCHT, istKontenrahmen, pruefeKontonummer,
  type Kontenrahmen, type KontoBefund, type RahmenEinstellung,
} from './kontenrahmen.js';
export {
  PeriodeUnklarFehler, periodenVorlauf, sicherePeriode,
  type Periode,
} from './periode.js';
export { kontiere, type Kontierung, type KontoFrage, type SchluesselTyp } from './kontierung.js';
export {
  BuchungFehler, bucheEingangsrechnung, bucheRechnung, bucheStorno,
  type BuchungErgebnis,
} from './buchungssatz.js';
