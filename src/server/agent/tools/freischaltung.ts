import 'server-only';
import { hatAusfuehrer } from './ausfuehrer.js';
import type { AgentKennung, WerkzeugName } from './register-werkzeuge.js';

/**
 * Das Tor vor jedem Werkzeugaufruf: ist dieses Werkzeug für diesen Agenten in
 * DIESER Gesellschaft freigeschaltet, und gibt es einen Ausführer? (AGT-01,
 * AGT-02, V-228, D-722)
 *
 * **Der Befund** (Audit Befund 57): die Agentenseite zeigte je Werkzeug
 * „freigeschaltet / nicht freigeschaltet" aus `agent_werkzeug` — aber keine
 * Laufzeit las die Tabelle. Der CEO-Assistent beantwortete Fragen über
 * `suche_bestand` auch dann, wenn die Seite es als „nicht freigeschaltet"
 * auswies. Angezeigter Stand und Verhalten fielen auseinander.
 *
 * **Die Zeile gilt, die Seite zeigt sie nur.** Gelesen wird als `cse_app` mit
 * RLS (`t_werkzeug_lesen`: aktiver Mandant, `agent.lesen`): eine fremde
 * Gesellschaft und eine Sitzung ohne das Leserecht bekommen keine Zeile, und
 * keine Zeile heisst „nicht freigeschaltet" — nie „erlaubt".
 */

export interface Leser {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface WerkzeugStand {
  readonly werkzeug: WerkzeugName;
  /** Die Gesellschaft hat es für diesen Agenten eingeschaltet (`ist_aktiv`). */
  readonly freigeschaltet: boolean;
  /** Was es erzeugt, geht erst nach menschlicher Freigabe weiter. */
  readonly erfordertFreigabe: boolean;
  /** Es gibt Code, der es ausführt (`tools/ausfuehrer.ts`). */
  readonly ausfuehrbar: boolean;
  /** Beides zusammen — nur dann läuft es, und nur dann steht „bereit" da. */
  readonly bereit: boolean;
}

/**
 * Der Stand aus einer (vielleicht fehlenden) Zeile — rein, deshalb geprüft.
 * Eine fehlende Zeile ist „aus" und „mit Freigabe": die Vorgabe der Tabelle,
 * nicht ihre Lockerung.
 */
export function standAus(
  werkzeug: WerkzeugName,
  zeile: { readonly ist_aktiv: boolean; readonly erfordert_freigabe: boolean } | undefined,
): WerkzeugStand {
  const freigeschaltet = zeile?.ist_aktiv === true;
  const ausfuehrbar = hatAusfuehrer(werkzeug);
  return {
    werkzeug,
    freigeschaltet,
    erfordertFreigabe: zeile?.erfordert_freigabe ?? true,
    ausfuehrbar,
    bereit: freigeschaltet && ausfuehrbar,
  };
}

export async function werkzeugStand(
  db: Leser, agent: AgentKennung, werkzeug: WerkzeugName,
): Promise<WerkzeugStand> {
  const [zeile] = await db.abfrage<{ ist_aktiv: boolean; erfordert_freigabe: boolean }>(
    `select w.ist_aktiv, w.erfordert_freigabe
       from agent_werkzeug w
       join agent a on a.id = w.agent_id
      where a.kennung = $1::agent_kennung
        and w.werkzeug = $2::agent_werkzeug_name
        and w.mandant_id = app.aktiver_mandant()`,
    [agent, werkzeug]);
  return standAus(werkzeug, zeile);
}

export class WerkzeugNichtFreigeschaltet extends Error {
  readonly code = 'werkzeug_gesperrt' as const;
  constructor(readonly stand: WerkzeugStand) {
    super(stand.freigeschaltet
      ? `Das Werkzeug „${stand.werkzeug}" ist freigeschaltet, hat aber keinen Ausführer.`
      : `Das Werkzeug „${stand.werkzeug}" ist in dieser Gesellschaft nicht freigeschaltet.`);
    this.name = 'WerkzeugNichtFreigeschaltet';
  }
}

/** Das Tor selbst: wirft, wenn das Werkzeug hier nicht laufen darf oder kann. */
export async function verlangeWerkzeug(
  db: Leser, agent: AgentKennung, werkzeug: WerkzeugName,
): Promise<WerkzeugStand> {
  const stand = await werkzeugStand(db, agent, werkzeug);
  if (!stand.bereit) throw new WerkzeugNichtFreigeschaltet(stand);
  return stand;
}
