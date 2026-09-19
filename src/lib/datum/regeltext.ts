import { leseRegel, RegelFehler } from './rrule.js';

/**
 * Eine RRULE in einem deutschen Satz — gelesen vom **selben Parser**, den der
 * Generator benutzt (CLN-02, TIM-02).
 *
 * **Warum das eine eigene Datei ist.** Diese Funktion stand als lokales
 * `lesbareRegel` in `dienstplan/serien/page.tsx`. Mit der Turnusliste,
 * dem Turnusblatt und dem Modulkopf der Reinigung daneben wären es vier
 * Kopien geworden — und eine Kopie, die `INTERVAL` vergisst, zeigt „jede
 * Woche" für eine Serie, die jede zweite Woche plant. Beides sieht richtig
 * aus, und nur eines ist es.
 *
 * **Eine zweite, nur für die Anzeige geschriebene Auslegung wäre die
 * gefährlichste Variante**: sie zeigte „montags", während der Generator
 * dienstags plant. Deshalb läuft hier `leseRegel` — derselbe Parser, dieselbe
 * Meinung darüber, was die Regel sagt.
 *
 * Was der Parser nicht lesen kann, wird als **Rohtext** gezeigt und nicht
 * geraten: eine erfundene Zusammenfassung wäre schlimmer als die Regel selbst.
 */
const TAGE: Readonly<Record<string, string>> = {
  MO: 'Mo', TU: 'Di', WE: 'Mi', TH: 'Do', FR: 'Fr', SA: 'Sa', SU: 'So',
};

export function lesbareRegel(rrule: string): string {
  try {
    const r = leseRegel(rrule);
    const jede = r.interval === 1 ? 'jede' : `jede ${String(r.interval)}.`;
    if (r.freq === 'WEEKLY') {
      const tage = r.byday?.map((d) => TAGE[d] ?? d).join(', ');
      return tage === undefined ? `${jede} Woche` : `${jede} Woche · ${tage}`;
    }
    if (r.freq === 'DAILY') {
      return r.interval === 1 ? 'täglich' : `jeden ${String(r.interval)}. Tag`;
    }
    const tage = r.bymonthday?.map((d) => `${String(d)}.`).join(', ');
    return tage === undefined
      ? `${jede} Monat`
      : `${jede === 'jede' ? 'jeden' : jede} Monat · ${tage}`;
  } catch (fehler) {
    if (fehler instanceof RegelFehler) return rrule;
    throw fehler;
  }
}

/**
 * Sagt die Regel selbst, dass sie unbrauchbar ist?
 *
 * Eine Liste braucht beides: den Satz (oben) und die Auskunft, dass es KEIN
 * Satz ist, sondern der ungelesene Rohtext. Ohne diese Funktion müsste die
 * Seite den Rückgabewert mit der Eingabe vergleichen — eine Prüfung, die bei
 * einer Regel wie `FREQ=WEEKLY` zufällig richtig und bei jeder anderen
 * zufällig falsch ausgeht.
 */
export function regelFehler(rrule: string): string | null {
  try {
    leseRegel(rrule);
    return null;
  } catch (fehler) {
    if (fehler instanceof RegelFehler) return fehler.message;
    throw fehler;
  }
}
