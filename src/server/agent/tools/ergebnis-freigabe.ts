import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { risikoPunkte, stufeRisikoEin } from '../../services/freigabe/posteingang.js';
import { legeFreigabeVor } from '../../services/freigabe/vorlegen.js';
import {
  AKTION_WERKZEUG_ERGEBNIS, ergebnisAbdruck, gateWerkzeugErgebnis,
} from '../policy.js';
import type { Leser } from './freischaltung.js';
import type { AgentKennung, WerkzeugName } from './register-werkzeuge.js';

/**
 * **„Ergebnis nur mit Freigabe" — zur Laufzeit** (AGT-02, AGT-03,
 * Invariante 7, V-270, D-763).
 *
 * **Der Befund** (zweite Prüfung von V-228): `agent_werkzeug.erfordert_freigabe`
 * liess sich je Werkzeug pflegen, und das Agentenblatt schrieb
 * „in dieser Gesellschaft: nur mit Freigabe" — aber keine Laufzeit las den
 * Schalter. Der CEO-Assistent zeigte jede Antwort sofort, auch mit gesetztem
 * Schalter (und der Seed setzt ihn überall). Angezeigter Stand und Verhalten
 * fielen auseinander, jetzt sogar mit einem Bedienelement ohne Wirkung.
 *
 * **Jetzt hält die Laufzeit das Ergebnis zurück** und legt es über den
 * vorhandenen Freigabeweg vor: eine `freigabe` im Posteingang (Aktion
 * `werkzeug_ergebnis`, Vorschau = das Ergebnis, Abdruck nach RFC 8785), die
 * Aufgabe steht auf `wartet_auf_freigabe`. Entscheidet ein Mensch, zieht
 * `app.werkzeug_ergebnis_folgt_freigabe` (0475) die Aufgabe nach. Die
 * Antwort selbst steht nie in der Aufgabe: `liefereErgebnis` liest sie aus der
 * Freigabe und gibt sie nur heraus, wenn `gateWerkzeugErgebnis`
 * (`server/agent/policy.ts`) sie durchlässt — genehmigt, von einem benannten
 * Menschen, für genau diese Aufgabe und genau diesen Abdruck.
 */

/** Was vorgelegt wird. `ergebnis` trägt nur fertige Zeichenketten (K-10). */
export interface Vorlage {
  readonly aufgabeId: string;
  readonly agentId: string;
  readonly agent: AgentKennung;
  readonly werkzeug: WerkzeugName;
  readonly titel: string;
  readonly zusammenfassung: string;
  readonly ergebnis: Readonly<Record<string, string>>;
}

/** Die Vorschau der Freigabe — was der Mensch im Posteingang sieht und genehmigt. */
export function vorschauAus(v: Vorlage, risikoGruende: readonly string[]): Record<string, unknown> {
  return {
    agent: v.agent,
    werkzeug: v.werkzeug,
    ...v.ergebnis,
    risiko_gruende: [...risikoGruende],
  };
}

/**
 * Legt das Ergebnis als offene Freigabe vor und gibt ihre Kennung zurück.
 *
 * **Das Risiko urteilt der Code** (§14.4), mit denselben Tatsachen wie ein
 * Lauf des Orchestrators: kein Betrag, keine Gegenpartei, kein Vergleich —
 * „kein Vergleich" heisst volle Prüfung.
 */
export async function halteErgebnisZurueck(
  kontext: SchreibKontext, v: Vorlage,
): Promise<string> {
  const urteil = stufeRisikoEin({
    vorgangTyp: 'interner_hinweis',
    betragCent: null,
    wirksameGrenzeCent: null,
    oeffentlicherAuftraggeber: false,
    neueGegenpartei: false,
    unsichereFelder: 0,
    injektionsverdacht: false,
    personenbezogeneEntscheidung: false,
    arbzgVerdikt: 'keine',
    hatVergleich: false,
    diffLeer: false,
  });
  const vorschau = vorschauAus(v, urteil.gruende);

  /*
   * Vorgelegt über `app.freigabe_vorlegen` (V-376, D-819) — als Bitte eines
   * Agentenlaufs: Agent und Aufgabe nimmt der Definer aus der laufenden
   * Aufgabe, nicht aus `v.agentId`.
   */
  return legeFreigabeVor(kontext, {
    aktion: AKTION_WERKZEUG_ERGEBNIS,
    vorgangTyp: 'interner_hinweis',
    titel: v.titel,
    zusammenfassung: v.zusammenfassung,
    risiko: urteil.risiko,
    risikoPunkte: risikoPunkte(urteil.risiko),
    vorschauPayload: vorschau,
    payloadHash: ergebnisAbdruck(vorschau),
    agentAufgabeId: v.aufgabeId,
    externeRef: `agent:${v.aufgabeId}`,
  });
}

/**
 * Darf diese Sitzung überhaupt etwas vorlegen? Sonst legt sie nichts an.
 *
 * Dieselbe Regel wie `app.freigabe_vorlegen` für die Bitte eines
 * Agentenlaufs (V-376, D-819): wer Agentenaufgaben starten darf, legt das
 * Ergebnis vor — entscheiden muss er es nicht dürfen. Bis dahin fragte die
 * Stelle `freigabe.entscheiden`, und ein Fragender ohne Entscheidungsrecht
 * bekam nie eine Antwort, auch keine freigegebene.
 */
export async function darfVorlegen(db: Leser): Promise<boolean> {
  const [z] = await db.abfrage<{ ja: boolean }>(
    `select app.hat_recht('agent.aufgabe_starten', app.aktiver_mandant()) as ja`);
  return z?.ja === true;
}

/** Was eine Aufgabe mit zurückgehaltenem Ergebnis ihrem Menschen zeigen darf. */
export type Auslieferung =
  | { readonly art: 'geliefert'; readonly inhalt: Readonly<Record<string, unknown>> }
  /** Die Freigabe ist offen — noch hat niemand entschieden. */
  | { readonly art: 'wartet'; readonly freigabeId: string }
  /** Entschieden, aber nicht so, dass das Tor ausliefert — mit dem Satz des Tors. */
  | { readonly art: 'nicht_freigegeben'; readonly freigabeId: string; readonly grund: string }
  /** Die Freigabe ist für diese Sitzung nicht lesbar (`freigabe.lesen`). */
  | { readonly art: 'nicht_lesbar'; readonly freigabeId: string };

/**
 * Die Antwort — nur durch das Tor.
 *
 * Gelesen wird die Freigabe mit dem Recht der Sitzung (RLS), dazu der
 * Abdruck der entschiedenen Nutzlast aus dem letzten Kettenglied. Was das Tor
 * nicht durchlässt, bleibt beim Posteingang.
 */
export async function liefereErgebnis(
  db: Leser, e: { readonly mandantId: string; readonly aufgabeId: string; readonly freigabeId: string },
): Promise<Auslieferung> {
  const [f] = await db.abfrage<{
    aktion: string; mandant_id: string; agent_aufgabe_id: string | null; status: string;
    freigegeben_von: string | null; vorschau_payload: unknown; nutzlast_hash: string | null;
  }>(
    `select f.aktion, f.mandant_id, f.agent_aufgabe_id, f.status::text as status,
            f.freigegeben_von, f.vorschau_payload,
            (select s.nutzlast_hash from freigabe_snapshot s
              where s.freigabe_id = f.id and s.mandant_id = f.mandant_id
              order by s.kette_nr desc limit 1) as nutzlast_hash
       from freigabe f
      where f.id = $1::uuid and f.mandant_id = app.aktiver_mandant()`,
    [e.freigabeId]);
  if (f === undefined) return { art: 'nicht_lesbar', freigabeId: e.freigabeId };
  if (f.status === 'offen') return { art: 'wartet', freigabeId: e.freigabeId };

  const inhalt = f.vorschau_payload !== null && typeof f.vorschau_payload === 'object'
    && !Array.isArray(f.vorschau_payload)
    ? f.vorschau_payload as Record<string, unknown> : {};
  const tor = gateWerkzeugErgebnis(
    { mandantId: e.mandantId, aufgabeId: e.aufgabeId, inhalt },
    {
      aktion: f.aktion, mandantId: f.mandant_id, aufgabeId: f.agent_aufgabe_id,
      status: f.status, freigegebenVon: f.freigegeben_von, nutzlastHash: f.nutzlast_hash,
    });
  return tor.erlaubt
    ? { art: 'geliefert', inhalt }
    : { art: 'nicht_freigegeben', freigabeId: e.freigabeId, grund: tor.fehler.message };
}
