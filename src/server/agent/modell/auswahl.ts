import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';
import { DemoModell } from './demo.js';
import { OpenAiModell } from '../../versand/modell-openai.js';
import { ModellFehler, type Faehigkeit, type ModellPort } from './port.js';

/**
 * **Fähigkeit rein, Port raus — und das Register entscheidet** (§8, 0154).
 *
 * Diese Datei ist die einzige Stelle, an der aus einer Fähigkeit ein Anbieter
 * wird. Sie trifft die Entscheidung nicht selbst: sie fragt
 * `app.modell_fuer(…)`, und die Funktion gibt nur zurück, was
 * `eu_verarbeitung AND zero_retention AND freigegeben` erfüllt. Ein Modell,
 * das jemand unachtsam in die Tabelle schreibt, ist damit nicht aufrufbar.
 *
 * **Kein Modell ist kein Fehler, sondern ein Betriebszustand.** §8 ist
 * eindeutig: fehlt die Fähigkeit, wird sie ABGESCHALTET — die Oberfläche sagt
 * „KI-Funktion nicht verfügbar", und die Arbeit läuft von Hand weiter. Kein
 * stiller Rückfall auf eine andere Region, kein stiller Wechsel auf ein
 * anderes Modell, keine Warteschlange.
 */

/**
 * Woran der Anbieter am Modellnamen erkennbar ist — mehr braucht es nicht.
 *
 * Der echte Adapter liegt in `server/versand`, weil ein Modellaufruf Inhalt
 * HINAUSSCHICKT und Invariante 7 dafür genau einen Ausgang kennt. Der
 * Demobetrieb liegt hier, weil er nichts hinausschickt.
 */
function baue(modell: string): ModellPort {
  if (modell.startsWith('demo:')) return new DemoModell();
  return new OpenAiModell(modell);
}

/**
 * Der Port für eine Fähigkeit — oder `null`, wenn keines freigegeben ist.
 *
 * `null` und nicht eine Ausnahme: der Aufrufer soll den Fall BEHANDELN, nicht
 * abstürzen. Wer stattdessen einen Port braucht und ohne ihn nicht weiter
 * kann, nimmt `fordereModell` und bekommt `RESIDENCY_BLOCKED` mit dem Satz,
 * der auf den Bildschirm gehört.
 */
export async function modellFuer(
  kontext: LeseKontext, faehigkeit: Faehigkeit,
): Promise<ModellPort | null> {
  const [z] = await kontext.abfrage<{ modell: string | null }>(
    `select app.modell_fuer($1::ki_faehigkeit) as modell`, [faehigkeit]);
  const modell = z?.modell ?? null;
  return modell === null ? null : baue(modell);
}

export async function fordereModell(
  kontext: LeseKontext, faehigkeit: Faehigkeit,
): Promise<ModellPort> {
  const port = await modellFuer(kontext, faehigkeit);
  if (port === null) {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      `KI-Funktion nicht verfügbar — für „${faehigkeit}" ist kein Modell mit `
      + 'EU-Verarbeitung und Nullspeicherung freigegeben (D-04, §8).');
  }
  return port;
}

export interface ModellStand {
  readonly faehigkeit: Faehigkeit;
  readonly modell: string | null;
  readonly anbieter: string | null;
  /** Läuft die Fähigkeit auf dem hausinternen Demobetrieb statt auf einem Anbieter? */
  readonly demo: boolean;
}

/** Was das Agentenzentrum anzeigt: je Fähigkeit, worauf sie läuft. */
export async function modellStand(kontext: LeseKontext): Promise<readonly ModellStand[]> {
  const zeilen = await kontext.abfrage<{ faehigkeit: string; modell: string | null; anbieter: string | null }>(
    `select f.f::text as faehigkeit,
            app.modell_fuer(f.f) as modell,
            (select r.anbieter from modell_register r
              where r.modell = app.modell_fuer(f.f) and r.faehigkeit = f.f
              limit 1) as anbieter
       from unnest(enum_range(null::ki_faehigkeit)) as f(f)
      order by f.f::text`);
  return zeilen.map((z) => ({
    faehigkeit: z.faehigkeit as Faehigkeit,
    modell: z.modell,
    anbieter: z.anbieter,
    demo: z.anbieter === 'demo',
  }));
}
