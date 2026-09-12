import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  platzhalterBild, type PlatzhalterMotiv,
} from '@/lib/placeholder-assets';

/**
 * Ein echtes Bild, wenn eines daliegt — sonst der Platzhalter.
 *
 * **Warum es das gibt.** Der Weg fuer echte Bilder fuehrte bisher ueber
 * `medien` und den Speicher, und der Speicher ist nicht verbunden. Wer heute
 * ein Foto auf die Startseite bringen wollte, brauchte also Zugangsdaten, eine
 * Hochladeoberflaeche und eine Zeile in `abschnitt.medien_id` — drei Dinge,
 * von denen zwei noch nicht existieren.
 *
 * Diese Datei macht daraus eine Dateiablage: liegt in `public/bilder/` eine
 * Datei, die so heisst wie das Motiv, nimmt die Seite sie. Kein Code, keine
 * Datenbank, kein Neustart — die Datei hinlegen und neu laden.
 *
 * **Die Reihenfolge bleibt richtig.** Ein Bild aus `medien` — also eines, das
 * jemand bewusst DIESEM Abschnitt zugeordnet hat — schlaegt weiterhin alles;
 * diese Ablage steht nur da, wo bisher der Platzhalter stand. Sie ist der
 * schnelle Weg, nicht der endgueltige: verwaltet, versioniert und je Abschnitt
 * zuordenbar wird ein Bild erst ueber `medien` (O-13).
 *
 * **Und sie erfindet nichts.** Liegt keine Datei da, kommt der Platzhalter mit
 * seiner sichtbaren Kennzeichnung zurueck — nicht ein zufaelliges Bild, das
 * so tut, als waere es ein Objekt der Gruppe (DESIGN §4.1/§4.3).
 */

/**
 * `webp` und `avif` zuerst: wer beides hinlegt, meint das kleinere.
 * `next/image` optimiert ohnehin, aber der erste Aufruf kostet weniger.
 */
const ENDUNGEN = ['avif', 'webp', 'jpg', 'jpeg', 'png'] as const;

/**
 * **Gemerkt wird nur der FUND, nie das Fehlen.**
 *
 * Der erste Entwurf legte auch `null` ab — und widersprach damit dem Satz
 * darueber, den er selbst versprach: „Datei hinlegen, Seite neu laden."
 * Genau das ging dann nicht mehr. Wer den Auftritt einmal aufruft, BEVOR das
 * Bild im Ordner liegt (und das tut jeder: der Ordner ist anfangs leer),
 * bekommt fuer die Lebensdauer des Prozesses den Platzhalter — auch wenn die
 * Datei zwei Minuten spaeter daliegt. Auf einem Server, der wochenlang laeuft,
 * heisst das: nie.
 *
 * Ein gefundener Pfad dagegen darf bleiben. Eine Datei, die da ist,
 * verschwindet nicht: die Ablage liegt im Abbild, und ein Austausch geht
 * ueber ein neues Abbild.
 *
 * Was das kostet: bis zu fuenf `existsSync` je Bild und Aufruf, solange
 * nichts abgelegt ist. Das ist ein Verzeichniseintrag im Seitencache des
 * Betriebssystems — deutlich billiger als eine Zusage, die nicht gilt.
 */
const gemerkt = new Map<string, string>();

function sucheDatei(motiv: PlatzhalterMotiv): string | null {
  const bekannt = gemerkt.get(motiv);
  if (bekannt !== undefined) return bekannt;

  const wurzel = join(process.cwd(), 'public', 'bilder');
  for (const endung of ENDUNGEN) {
    if (existsSync(join(wurzel, `${motiv}.${endung}`))) {
      const pfad = `/bilder/${motiv}.${endung}`;
      gemerkt.set(motiv, pfad);
      return pfad;
    }
  }
  return null;
}

export interface Bildwahl {
  readonly pfad: string;
  readonly alt: string;
  readonly platzhalter: boolean;
}

/**
 * Der Alternativtext eines abgelegten Bildes.
 *
 * Er beschreibt das MOTIV und nicht die Aufnahme — welche Aufnahme dort
 * liegt, weiss diese Funktion nicht. Das ist die ehrlichste Auskunft, die sich
 * aus einem Dateinamen ziehen laesst; ein Bild, das mehr sagen soll, gehoert
 * ueber `medien` eingespielt, wo `alt_text` daneben steht (und eine Pflicht
 * ist: `medien_alt_text_check`).
 */
const MOTIV_TEXT: Readonly<Record<PlatzhalterMotiv, string>> = {
  gruppe: 'Die CSE Gruppe',
  reinigung: 'Unterhaltsreinigung im Einsatz',
  security: 'Objektschutz im Einsatz',
  bau: 'Baustelle der REALTIME Service',
  operations: 'Betriebssteuerung der CSE Operations',
  objekt: 'Ein betreutes Objekt',
  projekt: 'Ein Bauprojekt',
  team: 'Das Team',
};

export function bildFuerMotiv(motiv: PlatzhalterMotiv): Bildwahl {
  const datei = sucheDatei(motiv);
  if (datei === null) return platzhalterBild(motiv);
  return { pfad: datei, alt: MOTIV_TEXT[motiv], platzhalter: false };
}
