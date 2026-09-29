import { eigenerEintrag } from '@/lib/nachschlagen';
import { AUSSCHREIBUNG_STATUS_TEXT } from '@/lib/i18n/beschriftung/radar';
import { SETZBAR } from '@/server/services/radar/vorgang';

/**
 * Der Stand aus `?vermerkt=` als Wort — oder `null`, und dann steht kein
 * Erfolgskasten da (`radar/[id]`, V-232, V-271).
 *
 * **Nie Text aus der Adresse** (D-647 Nr. 7, D-733 Nr. 3). Das Blatt schrieb
 * den Wert über `beschriftung()`, und die gibt einen unbekannten Wert lesbar
 * zurück — gedacht für einen neuen Enum-Wert aus der Datenbank, nicht für
 * eine Adresse: `?vermerkt=Zuschlag_an_uns` stand im grünen Kasten als
 * „Vermerkt. Der Stand dieser Bekanntmachung ist jetzt „Zuschlag an uns"".
 * Ein Verweis genügte für eine gefälschte Erfolgsmeldung.
 *
 * **Nur, was die Vorgangsroute nach einem Erfolg dorthin schreibt:** einer der
 * drei Stände aus `SETZBAR` (`api/radar/vorgang`). Ein Stand, den man hier gar
 * nicht setzen kann (`zuschlag`), ist auch als bekanntes Wort kein Vermerk.
 */
export function vermerkterStand(roh: unknown): string | null {
  if (typeof roh !== 'string' || !(SETZBAR as readonly string[]).includes(roh)) return null;
  return eigenerEintrag(AUSSCHREIBUNG_STATUS_TEXT.de, roh) ?? null;
}
