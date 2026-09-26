import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import {
  AGENTEN, WERKZEUGE, WERKZEUG_REGISTER, untergrenze,
  type AgentKennung, type WerkzeugName,
} from '../../agent/tools/register-werkzeuge.js';
import { standAus, type WerkzeugStand } from '../../agent/tools/freischaltung.js';

/**
 * Ein Werkzeug für einen Agenten in DIESER Gesellschaft ein- oder ausschalten
 * — und festlegen, ob sein Ergebnis eine Freigabe braucht (AGT-01, AGT-02,
 * Invariante 7, V-228, D-722).
 *
 * **Der Befund** (Audit Befund 57): `agent_werkzeug` hatte seit 0150 eine
 * Schreibpolicy unter `agent.werkzeug_verbinden`, aber keinen Dienst, keine
 * Route und kein Formular. Zeilen entstanden nur im Seed; auf einem
 * Produktivbestand stand jedes Werkzeug dauerhaft auf „nicht freigeschaltet",
 * und niemand konnte es ändern.
 *
 * **Drei Regeln, und keine davon ist neu:**
 *
 *  1. **Nur Paare aus dem Register** (D-513): ein Werkzeug, das
 *     `WERKZEUG_REGISTER[w].agenten` für diesen Agenten nicht nennt, lässt
 *     sich nicht einschalten — die Liste im Code entscheidet, welche Zeilen es
 *     GIBT, die Tabelle nur ihren Stand.
 *  2. **Was das Haus verlässt, braucht immer eine Freigabe** (Invariante 7):
 *     für ein Werkzeug der Nebenwirkung `versand` (heute `sende_email`) weist
 *     der Dienst „ohne Freigabe" ab, bevor die Datenbank es mit
 *     `aw_versand_immer_freigabe` tut — der Mensch bekommt einen Satz statt
 *     einer Constraint-Verletzung.
 *  3. **Das Recht ist `agent.werkzeug_verbinden`** — die Route fragt es, die
 *     Policy `t_werkzeug_schreiben` fragt es ein zweites Mal.
 *
 * **Einschalten heisst nicht „bereit".** Ein Modellwerkzeug ohne Ausführer
 * lässt sich freischalten — das ist die Entscheidung der Gesellschaft, es zu
 * erlauben, sobald es läuft —, aber der Stand, den dieser Dienst zurückgibt,
 * sagt `bereit: false`, und die Seite schreibt „braucht Modellzugang" dazu.
 */

const AUDIT_GESETZT = 'agent.werkzeug_gesetzt';

export type WerkzeugFehlerGrund =
  | 'unbekannt' | 'kein_agent' | 'nicht_im_register' | 'freigabe_pflicht' | 'abgewiesen';

export class WerkzeugPflegeFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: WerkzeugFehlerGrund,
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'WerkzeugPflegeFehler';
  }
}

export interface WerkzeugEingabe {
  readonly agentId: string;
  readonly werkzeug: string;
  readonly istAktiv: boolean;
  readonly erfordertFreigabe: boolean;
}

function istWerkzeug(wert: string): wert is WerkzeugName {
  return (WERKZEUGE as readonly string[]).includes(wert);
}

function istAgent(wert: string): wert is AgentKennung {
  return (AGENTEN as readonly string[]).includes(wert);
}

/**
 * Die Regeln 1 und 2 ohne Datenbank — rein, deshalb in
 * `tests/kern/agent-werkzeug-pflege.test.ts` geprüft.
 */
export function pruefeWerkzeugPaar(
  agent: string, werkzeug: string, erfordertFreigabe: boolean,
): { readonly agent: AgentKennung; readonly werkzeug: WerkzeugName } {
  if (!istWerkzeug(werkzeug)) {
    throw new WerkzeugPflegeFehler(
      'Dieses Werkzeug gibt es nicht — das Register kennt neun (AGT-02).', 'unbekannt');
  }
  if (!istAgent(agent)) {
    throw new WerkzeugPflegeFehler('Diesen Agenten gibt es nicht.', 'kein_agent');
  }
  if (!WERKZEUG_REGISTER[werkzeug].agenten.includes(agent)) {
    throw new WerkzeugPflegeFehler(
      'Dieser Agent führt dieses Werkzeug nicht — welcher Agent welches Werkzeug '
      + 'führen darf, steht im Register und nicht in einer Einstellung (D-513).',
      'nicht_im_register');
  }
  if (!erfordertFreigabe
    && untergrenze(WERKZEUG_REGISTER[werkzeug].nebenwirkung) === 'freigabe_erforderlich') {
    throw new WerkzeugPflegeFehler(
      'Was das Haus verlässt, geht nie ohne menschliche Freigabe hinaus '
      + '(Invariante 7) — diese Pflicht lässt sich nicht abschalten.',
      'freigabe_pflicht');
  }
  return { agent, werkzeug };
}

export async function setzeWerkzeug(
  kontext: SchreibKontext, e: WerkzeugEingabe,
): Promise<WerkzeugStand & { readonly id: string }> {
  const [a] = await kontext.abfrage<{ kennung: string }>(
    'select kennung::text as kennung from agent where id = $1::uuid', [e.agentId]);
  if (a === undefined) {
    throw new WerkzeugPflegeFehler('Diesen Agenten gibt es nicht.', 'kein_agent', 404);
  }
  const { agent, werkzeug } = pruefeWerkzeugPaar(a.kennung, e.werkzeug, e.erfordertFreigabe);

  let zeile: { id: string; ist_aktiv: boolean; erfordert_freigabe: boolean } | undefined;
  try {
    [zeile] = await kontext.schreibe<{ id: string; ist_aktiv: boolean; erfordert_freigabe: boolean }>(
      `insert into agent_werkzeug
         (mandant_id, agent_id, werkzeug, ist_aktiv, erfordert_freigabe,
          erstellt_von_art, erstellt_von)
       values ($1::uuid, $2::uuid, $3::agent_werkzeug_name, $4::boolean, $5::boolean,
               'mensch'::akteur_art, $6::uuid)
       on conflict (mandant_id, agent_id, werkzeug) do update set
          ist_aktiv          = excluded.ist_aktiv,
          erfordert_freigabe = excluded.erfordert_freigabe,
          geaendert_von      = excluded.erstellt_von
       returning id, ist_aktiv, erfordert_freigabe`,
      [kontext.aktiverMandantId, e.agentId, werkzeug, e.istAktiv, e.erfordertFreigabe,
        kontext.benutzerId]);
  } catch (fehler: unknown) {
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    if (text.includes('row-level security') || text.includes('row level security')) {
      throw new WerkzeugPflegeFehler(
        'Das Werkzeug wurde nicht gesetzt — dafür braucht es in dieser Gesellschaft '
        + 'das Recht, Werkzeuge zu verbinden.', 'abgewiesen', 403);
    }
    throw fehler;
  }
  if (zeile === undefined) {
    throw new WerkzeugPflegeFehler(
      'Das Werkzeug wurde nicht gesetzt — dafür braucht es in dieser Gesellschaft '
      + 'das Recht, Werkzeuge zu verbinden.', 'abgewiesen', 403);
  }

  await kontext.schreibe(
    `select app.protokolliere($1, 'agent_werkzeug', $2, null, $3::jsonb, app.aktiver_mandant())`,
    /* Das OBJEKT, nicht sein JSON-Text (D-467). */
    [AUDIT_GESETZT, zeile.id, {
      agent, werkzeug, istAktiv: zeile.ist_aktiv, erfordertFreigabe: zeile.erfordert_freigabe,
    }]);

  return { id: zeile.id, ...standAus(werkzeug, zeile) };
}
