import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { ExifFehler } from '@/server/storage/exif';
import { MimeFehler } from '@/server/storage/mime';
import { AblageFehler, FassungFehler, type AblageGrund } from '@/server/services/dokument/ablage';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  DOKUMENT_BLATT_TEXTE, type FassungAbweisungText,
} from '@/lib/i18n/verwaltung/dokument-blatt';

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
 *
 * **`AblageFehler` reist mit seinem eigenen Grund, wo das Blatt einen Satz
 * dafür hat** (D-774 Nachrunde). Bis dahin wurde hier JEDER `AblageFehler`
 * zu `datei_zu_gross` — richtig für den einen, den `legeFassungAn` heute
 * wirft, und falsch für jeden anderen: `datei_leer` hätte „Die Datei ist zu
 * groß." gezeigt. Ein Grund, zu dem das Fassungsblatt keinen Satz hat (die
 * Felder der Ablage: Titel, Kategorie, Beschreibung, Bezug), bleibt beim
 * bisherigen Rückfall. Der Typ hält Abbildung und Satztabelle beieinander.
 */
export function fassungGrund(fehler: unknown): FassungAbweisungText | null {
  if (fehler instanceof FassungFehler) return fehler.grund;
  if (fehler instanceof NichtVerbundenFehler) return 'speicher';
  if (fehler instanceof MimeFehler) return `datei_${fehler.grund}`;
  if (fehler instanceof ExifFehler) return 'datei_metadaten';
  if (fehler instanceof AblageFehler) {
    return hatFassungsSatz(fehler.grund) ? fehler.grund : 'datei_zu_gross';
  }
  return null;
}

/** Hat das Fassungsblatt einen eigenen Satz zu diesem Grund der Ablage? */
function hatFassungsSatz(grund: AblageGrund): grund is AblageGrund & FassungAbweisungText {
  return eigenerEintrag(DOKUMENT_BLATT_TEXTE.de.faFehler, grund) !== undefined;
}
