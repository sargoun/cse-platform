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
 * **Der Anbieter kommt aus dem Register, nicht aus dem Modellnamen.**
 *
 * Vorher hiess die Regel „beginnt mit `demo:` → hausintern, sonst OpenAI".
 * Das Register wählt aber nach `anbieter`, und die beiden Wahrheiten
 * konnten auseinanderlaufen: eine freigegebene Zeile eines DRITTEN Anbieters
 * wäre durch den OpenAI-Adapter gegangen — an dessen Endpunkt, mit dessen
 * Schlüssel, unter dessen Vertrag. Umgekehrt hätte ein echter Anbieter, der
 * ein Modell `demo:…` nennt, den hausinternen Betrieb bekommen.
 *
 * Deshalb liest die Abfrage jetzt beides — Modell UND Anbieter — und diese
 * Funktion verzweigt nach dem Anbieter. Ein unbekannter Anbieter ist kein
 * Fall für „nimm halt OpenAI", sondern `RESIDENCY_BLOCKED`: wer ihn
 * betreiben will, trägt hier einen Adapter ein, und das ist eine
 * Entscheidung, die jemand trifft.
 *
 * Der echte Adapter liegt in `server/versand`, weil ein Modellaufruf Inhalt
 * HINAUSSCHICKT und Invariante 7 dafür genau einen Ausgang kennt. Der
 * Demobetrieb liegt hier, weil er nichts hinausschickt.
 */
function baue(anbieter: string, modell: string): ModellPort {
  if (anbieter === 'demo') return new DemoModell();
  if (anbieter === 'openai') return new OpenAiModell(modell);
  throw new ModellFehler('RESIDENCY_BLOCKED',
    `Für den Anbieter „${anbieter}" gibt es keinen Adapter. Eine freigegebene `
    + 'Registerzeile allein macht ein Modell nicht aufrufbar — solange niemand einen '
    + 'Adapter eingetragen hat, bleibt die Fähigkeit abgeschaltet (§8).');
}

/** Modell und Anbieter zusammen — eine Abfrage, eine Wahrheit. */
async function gewaehlt(
  kontext: LeseKontext, faehigkeit: Faehigkeit,
): Promise<{ anbieter: string; modell: string } | null> {
  const [z] = await kontext.abfrage<{ anbieter: string | null; modell: string | null }>(
    /*
     * `app.modell_fuer` entscheidet weiterhin allein, WELCHES Modell gilt --
     * hier wird nur die Zeile dazu gelesen. Die Bedingungen stehen deshalb
     * nicht noch einmal in dieser Abfrage: zwei Fassungen derselben Regel
     * laufen irgendwann auseinander, und die stille Fassung gewinnt.
     */
    `with m as (select app.modell_fuer($1::ki_faehigkeit) as modell)
     select m.modell,
            (select r.anbieter from modell_register r
              where r.modell = m.modell and r.faehigkeit = $1::ki_faehigkeit
              limit 1) as anbieter
       from m`,
    [faehigkeit]);
  const modell = z?.modell ?? null;
  const anbieter = z?.anbieter ?? null;
  if (modell === null || anbieter === null) return null;
  return { anbieter, modell };
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
  const wahl = await gewaehlt(kontext, faehigkeit);
  return wahl === null ? null : baue(wahl.anbieter, wahl.modell);
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
