/**
 * Die Spaltenrechnung des Dienstplans (TIM-01, TIM-04).
 *
 * Sie beantwortet eine Frage, die die Oberflaeche nicht beantworten kann,
 * ohne sie zu rechnen: **welche Schichten stehen nebeneinander, und in
 * welcher Spur?**
 *
 * Der naheliegende Entwurf gruppiert nach Anfangszeit und rendert je Gruppe
 * eine Zeile. Er faellt genau an dem Fall um, den TIM-04 verlangt: zehn
 * Wachen, die zur selben Sekunde an einem Objekt anfangen, sind zehn
 * Schichten und nicht eine. Ein Plan, der sie uebereinanderlegt, zeigt eine —
 * und niemand sieht, dass neun fehlen. Deshalb wird hier **nie** gruppiert,
 * sondern verspurt: jede Schicht bekommt ihre eigene Spur, und Spuren
 * entstehen so lange, bis keine Ueberschneidung mehr offen ist.
 *
 * Die Rechnung ist bewusst hier und nicht in der Komponente: ein Raster, das
 * man nur im Browser pruefen kann, wird nur im Browser geprueft.
 */

/** Eine Schicht, so viel wie das Raster von ihr braucht. */
export interface RasterSchicht {
  readonly id: string;
  /** UTC-Instant. Die Anzeige rechnet erst spaeter nach Europe/Berlin um. */
  readonly beginn: Date;
  readonly ende: Date;
}

export interface VerspurteSchicht<T extends RasterSchicht> {
  readonly schicht: T;
  /** Nullbasiert. Spur 0 steht links. */
  readonly spur: number;
  /** Wie viele Spuren dieser Block insgesamt braucht — die Breite je Spalte. */
  readonly spuren: number;
}

/**
 * Verspurt die Schichten EINES Tages.
 *
 * Der Kern ist ein Intervallgraph: zwei Schichten teilen sich eine Spur nur,
 * wenn sie sich nicht ueberschneiden. Die Breite (`spuren`) gilt je
 * **Ueberschneidungsblock** und nicht fuer den ganzen Tag — sonst waere eine
 * einzelne Fruehschicht so schmal wie die Nacht, in der zehn Wachen stehen.
 *
 * Beruehrung ist keine Ueberschneidung: eine Schicht, die um 14:00 endet, und
 * eine, die um 14:00 beginnt, stehen in derselben Spur. Die Gegenprobe waere
 * ein Plan, in dem jede Schichtuebergabe eine zweite Spalte oeffnet.
 */
export function verspure<T extends RasterSchicht>(
  schichten: readonly T[],
): readonly VerspurteSchicht<T>[] {
  const sortiert = [...schichten].sort((a, b) => {
    const d = a.beginn.getTime() - b.beginn.getTime();
    if (d !== 0) return d;
    // Bei gleichem Anfang zuerst die laengere — so bleibt der Block links
    // stabil, statt bei jedem Laden die Spuren zu tauschen.
    const e = b.ende.getTime() - a.ende.getTime();
    return e !== 0 ? e : a.id.localeCompare(b.id);
  });

  const ergebnis: VerspurteSchicht<T>[] = [];
  /** Die Schichten des laufenden Blocks und das Ende jeder Spur. */
  let block: { schicht: T; spur: number }[] = [];
  let spurEnde: number[] = [];

  const blockAbschliessen = (): void => {
    const breite = spurEnde.length;
    for (const b of block) ergebnis.push({ schicht: b.schicht, spur: b.spur, spuren: breite });
    block = [];
    spurEnde = [];
  };

  for (const s of sortiert) {
    const beginn = s.beginn.getTime();
    // Ein neuer Block beginnt, wenn KEINE laufende Spur mehr offen ist.
    if (spurEnde.length > 0 && spurEnde.every((ende) => ende <= beginn)) {
      blockAbschliessen();
    }
    let spur = spurEnde.findIndex((ende) => ende <= beginn);
    if (spur === -1) {
      spur = spurEnde.length;
      spurEnde.push(s.ende.getTime());
    } else {
      spurEnde[spur] = s.ende.getTime();
    }
    block.push({ schicht: s, spur });
  }
  blockAbschliessen();

  // In Eingabereihenfolge des Sortierschlüssels zurueck, damit die Ausgabe
  // deterministisch ist — ein Raster, das seine Reihenfolge wechselt, ist im
  // Test nicht zu fassen.
  return ergebnis;
}

/**
 * Der Anteil einer Schicht an einem Kalendertag, in Minuten seit 00:00
 * Ortszeit — und warum das nicht `beginn.getHours()` ist.
 *
 * Eine Nachtschicht 22:00–06:00 gehoert zwei Tagen an. Im Plan des ersten
 * Tages laeuft sie von 22:00 bis 24:00, im Plan des zweiten von 00:00 bis
 * 06:00. Wer stattdessen nur den Anfangstag zeichnet, laesst die Haelfte der
 * Nacht unsichtbar — und die Frage „wer ist am Sonntag um 03:00 im Objekt"
 * hat dann eine leere Antwort.
 */
export interface Tagesanteil {
  /** Minuten seit 00:00 Ortszeit dieses Tages, 0 … 1440. */
  readonly vonMinute: number;
  readonly bisMinute: number;
  /** Faengt die Schicht an einem frueheren Tag an? */
  readonly reichtZurueck: boolean;
  /** Laeuft sie ueber diesen Tag hinaus? */
  readonly reichtVor: boolean;
}

/**
 * `tagBeginn`/`tagEnde` sind die **Instants** der Ortszeit-Mitternachten
 * dieses Tages — sie kommen von aussen, weil nur die Datenbank sie richtig
 * bildet (§7.2). Ein Tag ist nicht immer 1440 Minuten lang: an der
 * Umstellung sind es 1380 oder 1500.
 */
export function tagesanteil(
  schicht: RasterSchicht, tagBeginn: Date, tagEnde: Date,
): Tagesanteil | null {
  const von = Math.max(schicht.beginn.getTime(), tagBeginn.getTime());
  const bis = Math.min(schicht.ende.getTime(), tagEnde.getTime());
  if (bis <= von) return null;
  const minuten = (t: number): number => Math.round((t - tagBeginn.getTime()) / 60_000);
  return {
    vonMinute: minuten(von),
    bisMinute: minuten(bis),
    reichtZurueck: schicht.beginn.getTime() < tagBeginn.getTime(),
    reichtVor: schicht.ende.getTime() > tagEnde.getTime(),
  };
}

/**
 * Die Dauer einer Schicht als deutsche Stundenzahl — `8,00 h`.
 *
 * Sie ist der Abstand zweier **Instants**, nicht die Differenz zweier
 * Uhrzeiten. Genau deshalb liest dieselbe 22:00–06:00-Schicht in der Nacht
 * der Vorstellung `7,00 h` und in der Nacht der Rueckstellung `9,00 h` — und
 * genau das steht in der Abnahme von PR 33.
 */
export function stundenText(schicht: RasterSchicht): string {
  const minuten = Math.round((schicht.ende.getTime() - schicht.beginn.getTime()) / 60_000);
  const stunden = minuten / 60;
  return `${stunden.toFixed(2).replace('.', ',')} h`;
}
