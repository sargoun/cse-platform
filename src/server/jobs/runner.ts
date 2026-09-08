/**
 * Der Job-Runner — Idempotenz, Wiederholung mit Backoff, Alarm.
 *
 * Drei Zusagen, und jede hat einen Ausfall dahinter, den sie verhindert:
 *
 *  - **Idempotenz.** Derselbe Schluessel zweimal heisst: die Arbeit passiert
 *    einmal. Ohne das erzeugt ein doppelt ausgeloester naechtlicher Lauf zwei
 *    Mahnungen an denselben Kunden.
 *  - **Wiederholung mit Backoff.** Ein Netzfehler ist kein Grund, den Lauf
 *    aufzugeben; sofort wieder zu versuchen ist keiner, ihn zu retten.
 *  - **Alarm.** Ein Job, der scheitert und niemanden erreicht, ist ein Job,
 *    der nicht laeuft — und das faellt erst auf, wenn jemand die Zahlen
 *    vermisst. Deshalb gibt es keinen stillen Tod.
 */
import type { JobDefinition, JobKontext } from './registry.js';

export type Ergebnis = 'erfolg' | 'teilweise' | 'fehler' | 'abgebrochen';

export interface LaufProtokoll {
  neuerLauf(job: string, idempotenzSchluessel: string | null, versuch: number):
    Promise<{ laufId: string; bereitsErledigt: boolean }>;
  beendeLauf(laufId: string, ergebnis: Ergebnis, kennzahlen: Record<string, unknown>,
             fehlertext: string | null): Promise<void>;
  ergebnisJeMandant(laufId: string, mandantId: string, ergebnis: Ergebnis,
                    kennzahlen: Record<string, unknown>, fehlertext: string | null): Promise<void>;
}

export interface Alarm {
  melde(job: string, laufId: string, fehler: string, versuche: number): Promise<void>;
}

export interface LaufOptionen {
  readonly idempotenzSchluessel?: string | null;
  /** Bei `je_mandant`: ueber welche Mandanten. */
  readonly mandanten?: readonly string[];
  /** Wartefunktion — uebergeben, damit der Test nicht wirklich wartet. */
  readonly warte?: (ms: number) => Promise<void>;
}

/** Exponentiell: 1s, 2s, 4s, 8s … Gedeckelt, damit ein Lauf nicht ewig haengt. */
export function backoffMs(versuch: number): number {
  return Math.min(1000 * 2 ** (versuch - 1), 60_000);
}

export interface LaufErgebnis {
  readonly laufId: string;
  readonly ergebnis: Ergebnis;
  readonly versuche: number;
  readonly uebersprungen: boolean;
}

export async function fuehreAus(
  job: JobDefinition,
  protokoll: LaufProtokoll,
  alarm: Alarm,
  optionen: LaufOptionen = {},
): Promise<LaufErgebnis> {
  const schluessel = optionen.idempotenzSchluessel ?? null;
  const warte = optionen.warte ?? ((ms) => new Promise((r) => { setTimeout(r, ms); }));

  const { laufId, bereitsErledigt } = await protokoll.neuerLauf(job.schluessel, schluessel, 1);
  if (bereitsErledigt) {
    // Die Arbeit ist schon passiert. Kein Fehler, kein zweiter Durchlauf.
    return { laufId, ergebnis: 'erfolg', versuche: 0, uebersprungen: true };
  }

  const maxVersuche = job.versuche + 1;
  let letzterFehler: unknown = null;

  for (let versuch = 1; versuch <= maxVersuche; versuch += 1) {
    try {
      if (job.bereich === 'je_mandant') {
        const mandanten = optionen.mandanten ?? [];
        const kennzahlen: Record<string, unknown> = { mandanten: mandanten.length };
        let fehlerhaft = 0;

        for (const mandantId of mandanten) {
          const kontext: JobKontext = { mandantId, laufId, versuch };
          try {
            const z = await job.ausfuehren(kontext);
            await protokoll.ergebnisJeMandant(laufId, mandantId, 'erfolg', z, null);
          } catch (f) {
            // Ein Mandant, der scheitert, beendet nicht den Lauf fuer die
            // anderen — er wird als sein eigenes Ergebnis vermerkt.
            fehlerhaft += 1;
            await protokoll.ergebnisJeMandant(
              laufId, mandantId, 'fehler', {}, f instanceof Error ? f.message : String(f),
            );
          }
        }

        const ergebnis: Ergebnis = fehlerhaft === 0 ? 'erfolg'
          : fehlerhaft === mandanten.length ? 'fehler' : 'teilweise';
        await protokoll.beendeLauf(laufId, ergebnis, { ...kennzahlen, fehlerhaft }, null);
        if (ergebnis !== 'erfolg') {
          await alarm.melde(job.schluessel, laufId, `${fehlerhaft} Mandanten fehlerhaft`, versuch);
        }
        return { laufId, ergebnis, versuche: versuch, uebersprungen: false };
      }

      const kennzahlen = await job.ausfuehren({ mandantId: null, laufId, versuch });
      await protokoll.beendeLauf(laufId, 'erfolg', kennzahlen, null);
      return { laufId, ergebnis: 'erfolg', versuche: versuch, uebersprungen: false };
    } catch (f) {
      letzterFehler = f;
      if (versuch < maxVersuche) await warte(backoffMs(versuch));
    }
  }

  const text = letzterFehler instanceof Error ? letzterFehler.message : String(letzterFehler);
  await protokoll.beendeLauf(laufId, 'fehler', {}, text);
  // KEIN stiller Tod.
  await alarm.melde(job.schluessel, laufId, text, maxVersuche);
  return { laufId, ergebnis: 'fehler', versuche: maxVersuche, uebersprungen: false };
}
