import 'server-only';

/**
 * Das TAGESRASTER — aus einer Liste von Zeilen wird ein Kalender (CAL-01).
 *
 * Eine Kalenderzeile ist eine SPANNE; ein Kalender zeigt TAGE. Dazwischen
 * liegt genau eine Rechnung, und sie ist die, an der selbstgebaute Kalender
 * scheitern: welcher Tag ist der letzte, an dem eine Zeile noch fällt?
 *
 * Sie steht hier und nicht in der Seite, weil sie prüfbar sein muss — ohne
 * Browser, ohne Datenbank, gegen die beiden Nächte im Jahr, in denen der
 * Berliner Tag nicht vierundzwanzig Stunden hat.
 */
import type { KalenderZeile } from './eintraege.js';

/** Der Berliner Kalendertag eines Zeitpunkts — nie `toISOString()` (Invariante 2). */
export function berlinerTag(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

/**
 * Eine Zeile je Tag, an dem sie LÄUFT — nicht nur an ihrem Beginn.
 *
 * Eine Nachtschicht von 22:00 bis 06:00 gehört in beide Tage, sonst
 * verschwindet sie aus dem Tag, an dem sie endet (Invariante 2: Schichten
 * kreuzen Mitternacht). Ein mehrtägiger Termin ebenso.
 */
export interface Tageszeile {
  readonly zeile: KalenderZeile;
  /** Beginnt sie an DIESEM Tag? Sonst läuft sie nur hindurch. */
  readonly beginnt: boolean;
}

export function nachTagen(
  zeilen: readonly KalenderZeile[],
): ReadonlyMap<string, readonly Tageszeile[]> {
  const karte = new Map<string, Tageszeile[]>();
  for (const z of zeilen) {
    const ersterTag = berlinerTag(z.beginn);
    /*
     * **Das Ende ist EXKLUSIV, und zwar in beiden Bedeutungen.** Bei einer
     * ganztaegigen Zeile ist `ende` der Tag NACH dem letzten (Migration 0160,
     * wie in iCal); bei einer Schicht von 22:00 bis 00:00 ist Mitternacht der
     * erste Augenblick des Folgetags, an dem sie keine Sekunde mehr laeuft.
     * `berlinerTag(ende)` haette beide einen Tag zu weit gezogen: der
     * ganztaegige Termin stand zwei Tage lang da, die Nachtschicht in einem
     * Tag, in dem sie nicht vorkommt.
     */
    const endeMs = new Date(z.ende).getTime();
    const letzterTag = endeMs > new Date(z.beginn).getTime()
      ? berlinerTag(new Date(endeMs - 1).toISOString())
      : ersterTag;
    let tag = ersterTag;
    for (let i = 0; i < 400 && tag <= letzterTag; i += 1) {
      (karte.get(tag) ?? karte.set(tag, []).get(tag)!)
        .push({ zeile: z, beginnt: tag === ersterTag });
      const d = new Date(`${tag}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      tag = d.toISOString().slice(0, 10);
    }
  }
  /*
   * Innerhalb eines Tages zuerst, was den ganzen Tag faellt oder schon lief,
   * dann die Uhrzeiten dieses Tages. Die Vorsortierung der Abfrage gilt fuer
   * den BEGINN; eine Nachtschicht, die gestern um 22:00 anfing, stuende hier
   * sonst ueber allem, was heute frueh beginnt.
   */
  /*
   * Drei Raenge, und in dieser Reihenfolge liest man einen Tag:
   *
   *  0 GANZTAEGIG -- das Band ueber dem Tag. Eine Frist ist eine Eigenschaft
   *    des Tages und keine Uhrzeit darin.
   *  1 LAEUFT HINEIN -- was gestern begann und heute noch dauert. Es hat
   *    heute keinen Beginn, also gehoert es nicht zwischen die Uhrzeiten.
   *  2 BEGINNT HEUTE -- nach der Uhr.
   */
  const rang = (t: Tageszeile): number =>
    (t.zeile.ganztaegig ? 0 : t.beginnt ? 2 : 1);
  for (const [tag, liste] of karte) {
    karte.set(tag, [...liste].sort((a, b) => {
      if (rang(a) !== rang(b)) return rang(a) - rang(b);
      if (a.zeile.beginn !== b.zeile.beginn) return a.zeile.beginn < b.zeile.beginn ? -1 : 1;
      return a.zeile.titel.localeCompare(b.zeile.titel, 'de');
    }));
  }
  /*
   * Ohne Beschnitt: das Monatsgitter zeigt die Randtage der Nachbarmonate,
   * und die Agenda schneidet sich ihren Zeitraum selbst heraus.
   */
  return karte;
}
