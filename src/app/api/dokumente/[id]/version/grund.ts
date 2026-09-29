import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { ExifFehler } from '@/server/storage/exif';
import { MimeFehler } from '@/server/storage/mime';
import { AblageFehler, FassungFehler } from '@/server/services/dokument/ablage';

/**
 * Der Grund einer abgewiesenen Fassung — ein Schlüssel für das Blatt, nie ein
 * Satz in der Adresse (D-599, V-219).
 *
 * Eine eigene Datei und nicht in `route.ts`: eine Routendatei darf neben den
 * HTTP-Methoden nichts exportieren, und `tests/kern/dokument-fassung.test.ts`
 * prüft, dass JEDER Wurf der Prüfkette einen Grund bekommt.
 *
 * **`ExifFehler` hat einen eigenen** (V-266, D-759): `ladeHoch` wirft ihn für
 * jedes erlaubte Bild ohne Bereinigungsverfahren (TIFF, GIF, WebP) und für
 * jedes verschlüsselte PDF — ausgerechnet den eingescannten oder signierten
 * Vertrag, den typischen Fall einer zweiten Fassung. Ohne diesen Zweig landete
 * er als 500 auf einer Fehlerseite statt als Satz auf dem Blatt.
 */
export function fassungGrund(fehler: unknown): string | null {
  if (fehler instanceof FassungFehler) return fehler.grund;
  if (fehler instanceof NichtVerbundenFehler) return 'speicher';
  if (fehler instanceof MimeFehler) return `datei_${fehler.grund}`;
  if (fehler instanceof ExifFehler) return 'datei_metadaten';
  if (fehler instanceof AblageFehler) return 'datei_zu_gross';
  return null;
}
