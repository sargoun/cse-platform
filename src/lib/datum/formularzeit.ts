/**
 * Eine Zeitangabe aus einem FORMULAR in einen Zeitpunkt verwandeln.
 *
 * **Das Problem, das diese Datei loest, sieht man nicht.** `<input
 * type="datetime-local">` schickt `2026-03-29T02:30` — Wanduhrzeit, ohne
 * Zone. `new Date('2026-03-29T02:30')` liest sie nach ECMAScript als ORTSZEIT
 * DES PROZESSES: im Container und auf Vercel ist das UTC. Eine Planerin, die
 * „06:00" eintraegt, bekommt damit 06:00 UTC — also 08:00 Berliner Zeit, im
 * Sommer. Kein Fehler, keine Meldung: nur eine Schicht, die zwei Stunden
 * spaeter anfaengt als eingetragen, und ein Lohnstreit ein Jahr spaeter.
 *
 * **Traegt die Angabe eine Zone, gilt sie.** Ein Geraet schickt
 * `toISOString()` mit `Z`; das ist ein Zeitpunkt und keine Wanduhrzeit, und
 * ihn nach Berlin umzudeuten waere derselbe Fehler in die andere Richtung.
 *
 * Die Aufloesung selbst macht `loeseOrtszeitAuf` — dieselbe getestete
 * Funktion, mit der der Dienstplangenerator seine Schichten legt (§7.2). Damit
 * gibt es EINE Umsetzung der Frage „welcher Instant ist 02:30 in Berlin", und
 * sie kennt die Nacht, in der es diese Uhrzeit nicht gibt, und die, in der es
 * sie zweimal gibt.
 */
import { loeseOrtszeitAuf, type Ortszeitaufloesung } from './rrule.js';

/** `2026-03-29T02:30` oder `2026-03-29T02:30:00` — Wanduhrzeit ohne Zone. */
const OHNE_ZONE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/u;

export interface FormularZeit {
  readonly zeitpunkt: Date;
  /**
   * Was die Aufloesung ueber die Wanduhrzeit sagt: `dst_luecke`, wenn es sie
   * in dieser Nacht nicht gab, `dst_doppelt`, wenn es sie zweimal gab.
   * `null`, wenn die Angabe ihre Zone selbst mitbrachte — dann war nichts
   * aufzuloesen.
   */
  readonly aufloesung: Ortszeitaufloesung | null;
}

/**
 * Die Angabe als Zeitpunkt, oder `null`, wenn sie keine ist.
 *
 * `null` und kein Wurf: ein leeres Feld ist im Formular der Normalfall, und
 * der Aufrufer entscheidet, ob es Pflicht war.
 */
export function berlinFormularZeit(roh: unknown): FormularZeit | null {
  if (typeof roh !== 'string') return null;
  const text = roh.trim();
  if (text === '') return null;

  const ohneZone = OHNE_ZONE.exec(text);
  if (ohneZone !== null) {
    const [, datum, stunde, minute, sekunde, bruchteil] = ohneZone;
    try {
      const aufloesung = loeseOrtszeitAuf(datum!, Number(stunde), Number(minute));
      /**
       * **Die Sekunden reisen mit.**
       *
       * Der Ausdruck oben nahm sie schon immer an — als NICHT einfangende
       * Gruppe. Sie fielen damit still weg: `2026-07-01T06:00:30` wurde zu
       * `04:00:00Z` statt `04:00:30Z`, und der Test darunter hielt genau
       * diese Verkuerzung fest, statt sie zu melden. Eine BEHAUPTETE Zeit
       * still um dreissig Sekunden zu verschieben ist derselbe Fehler, gegen
       * den diese Datei geschrieben ist — nur kleiner und deshalb noch
       * schlechter zu bemerken.
       *
       * Aufgeloest wird weiterhin auf die MINUTE, und das ist richtig: der
       * Zonenversatz wechselt nie innerhalb einer Minute (die Umstellung
       * liegt auf 02:00 → 03:00). Der Versatz gilt also fuer die ganze
       * Minute, und die Sekunden sind eine reine Verschiebung darin. Damit
       * bleibt `loeseOrtszeitAuf` unangetastet — dieselbe Funktion, mit der
       * der Dienstplangenerator seine Schichten legt.
       */
      const millis = sekunde === undefined
        ? 0
        : Number(sekunde) * 1000 + Math.round(Number(bruchteil ?? '0') * 1000);
      const zeitpunkt = millis === 0
        ? aufloesung.zeitpunkt
        : new Date(aufloesung.zeitpunkt.getTime() + millis);
      // `aufloesung` traegt denselben Zeitpunkt: zwei Felder mit zwei
      // verschiedenen Instants waeren die naechste Falle.
      return { zeitpunkt, aufloesung: { ...aufloesung, zeitpunkt } };
    } catch {
      // Ein Datum, das es nicht gibt (31.02.) — dasselbe Ergebnis wie ein
      // unlesbares Feld, und dieselbe Entscheidung beim Aufrufer.
      return null;
    }
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : { zeitpunkt: d, aufloesung: null };
}

/** Nur der Zeitpunkt — fuer Aufrufer, denen die DST-Lage gleichgueltig ist. */
export function berlinFormularZeitpunkt(roh: unknown): Date | null {
  return berlinFormularZeit(roh)?.zeitpunkt ?? null;
}
