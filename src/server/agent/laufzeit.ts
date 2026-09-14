import 'server-only';
import { createHash } from 'node:crypto';
import { mikrocentNachCent } from './kosten.js';
import {
  MAX_SCHRITTE_PLATZHALTER, NUTZLAST_FRIST_TAGE_PLATZHALTER,
} from './limits.platzhalter.js';

/**
 * Die Laufzeit eines Agenten: Aufgabe, Schritt, Ende (AGT-01, AGT-04).
 *
 * **Ein Schritt wird protokolliert, BEVOR der nächste läuft.** Nicht am Ende,
 * nicht gesammelt, nicht „best effort": schlägt das Protokollieren fehl,
 * scheitert der Lauf. Ein Agent, dessen Schritte nur manchmal im Protokoll
 * stehen, ist ein Agent, dessen Kosten niemand nachrechnen und dessen
 * Entscheidung niemand nachvollziehen kann — und beides braucht man genau
 * dann, wenn etwas schiefgegangen ist.
 *
 * **Die Uhr ist die des Servers** (Invariante 5, sinngemäß). `gestartet_am`,
 * `beendet_am`, `begonnen_am` setzt Postgres mit `now()`; kein Aufrufer
 * reicht einen Zeitstempel herein. Eine Dauer, die der Aufrufer bestimmt, ist
 * eine Dauer, die er sich aussucht.
 *
 * **Die Schleifenbremse ist sichtbar.** `max_schritte` steht am Agenten
 * (PLATZHALTER, O-196); wird sie erreicht, endet die Aufgabe mit
 * `abgebrochen` und einem Text, der genau das sagt — statt eines Ergebnisses,
 * das aussieht, als wäre es fertig.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type Ausloeser = 'mensch' | 'zeitplan' | 'ereignis' | 'agent';

export type Werkzeug =
  | 'lies_dokument' | 'extrahiere_lv' | 'suche_bestand' | 'berechne_preis'
  | 'pruefe_nachweise' | 'pruefe_bilder' | 'entwirf_text' | 'sende_email'
  | 'erstelle_vorgang';

export type SchrittStatus = 'erfolg' | 'fehler' | 'abgelehnt_richtlinie' | 'uebersprungen';

export type AufgabeStatus =
  | 'wartend' | 'laufend' | 'wartet_auf_freigabe' | 'abgeschlossen'
  | 'fehlgeschlagen' | 'abgebrochen' | 'gestoppt_budget';

export interface AufgabeAnlegen {
  readonly agentKennung: 'ceo_assistent' | 'akquise' | 'backoffice' | 'finanzen';
  readonly vorgangTyp: string;
  readonly titel: string;
  /** Handles, nie Zahlen (K-10). */
  readonly eingabe?: Record<string, unknown>;
  readonly bezugTyp?: string | null;
  readonly bezugId?: string | null;
  readonly idempotenzSchluessel?: string | null;
  readonly angefordertVon?: string | null;
  readonly ausgeloestDurch?: Ausloeser;
  readonly promptVersion?: string | null;
  readonly richtlinienVersion?: string | null;
  readonly codeVersion?: string | null;
}

export interface Aufgabe {
  readonly id: string;
  readonly agentId: string;
  readonly korrelationId: string;
  readonly status: AufgabeStatus;
  readonly maxSchritte: number;
  /** `true`, wenn dieselbe Idempotenz schon eine Aufgabe hat — dann ist `id` deren. */
  readonly bestand: boolean;
}

export class AgentInaktiv extends Error {
  constructor(kennung: string) {
    super(`Der Agent „${kennung}" ist nicht eingeschaltet — er läuft nicht (AGT-01).`);
    this.name = 'AgentInaktiv';
  }
}

export class SchrittGrenzeErreicht extends Error {
  constructor(public readonly grenze: number) {
    super(`Die Aufgabe hat die Grenze von ${String(grenze)} Schritten erreicht (O-196) `
      + 'und wird einem Menschen vorgelegt.');
    this.name = 'SchrittGrenzeErreicht';
  }
}

const hash = (wert: unknown): string =>
  createHash('sha256').update(JSON.stringify(wert ?? null)).digest('hex');

interface AgentRoh {
  readonly id: string;
  readonly ist_aktiv: boolean;
  readonly max_schritte: number | null;
}

interface AufgabeRoh {
  readonly id: string;
  readonly agent_id: string;
  readonly korrelation_id: string;
  readonly status: AufgabeStatus;
}

/**
 * Legt eine Aufgabe an — oder gibt die bestehende zurück.
 *
 * **Idempotenz ist hier kein Komfort.** Ein Ereignis kann zweimal ankommen,
 * ein Zeitplan zweimal feuern, ein Mensch zweimal klicken. Ohne Schlüssel
 * liefe der Agent zweimal, kostete zweimal und legte womöglich zwei Entwürfe
 * an. Der partielle Unique-Index trägt die Zusage; diese Funktion liest sie.
 */
export async function starteAufgabe(
  db: Abfrage, mandantId: string, auftrag: AufgabeAnlegen,
): Promise<Aufgabe> {
  const [agent] = await db.abfrage<AgentRoh>(
    'select id, ist_aktiv, max_schritte from agent where kennung = $1::agent_kennung',
    [auftrag.agentKennung]);

  if (agent === undefined) throw new AgentInaktiv(auftrag.agentKennung);
  if (!agent.ist_aktiv) throw new AgentInaktiv(auftrag.agentKennung);

  const idem = auftrag.idempotenzSchluessel ?? null;
  if (idem !== null) {
    const [vorhanden] = await db.abfrage<AufgabeRoh>(
      `select id, agent_id, korrelation_id, status::text as status
         from agent_aufgabe where mandant_id = $1 and idempotenz_schluessel = $2`,
      [mandantId, idem]);
    if (vorhanden !== undefined) {
      return {
        id: vorhanden.id,
        agentId: vorhanden.agent_id,
        korrelationId: vorhanden.korrelation_id,
        status: vorhanden.status,
        maxSchritte: agent.max_schritte ?? MAX_SCHRITTE_PLATZHALTER,
        bestand: true,
      };
    }
  }

  const [neu] = await db.abfrage<AufgabeRoh>(
    `insert into agent_aufgabe
       (mandant_id, agent_id, vorgang_typ, titel, status, eingabe, bezug_typ, bezug_id,
        idempotenz_schluessel, angefordert_von, ausgeloest_durch, gestartet_am,
        prompt_version, richtlinien_version, code_version,
        erstellt_von_art, erstellt_von, erstellt_von_dienst)
     values ($1, $2, $3::agent_vorgang_typ, $4, 'laufend', $5::jsonb, $6, $7, $8, $9,
             $10::ausloeser, now(), $11, $12, $13,
             case when $9::uuid is null then 'system' else 'mensch' end::akteur_art,
             $9, case when $9::uuid is null then 'agent:laufzeit' else null end)
     returning id, agent_id, korrelation_id, status::text as status`,
    [mandantId, agent.id, auftrag.vorgangTyp, auftrag.titel,
      auftrag.eingabe ?? {}, auftrag.bezugTyp ?? null,
      auftrag.bezugId ?? null, idem, auftrag.angefordertVon ?? null,
      auftrag.ausgeloestDurch ?? 'mensch', auftrag.promptVersion ?? null,
      auftrag.richtlinienVersion ?? null, auftrag.codeVersion ?? null]);

  if (neu === undefined) throw new Error('Die Agentenaufgabe ließ sich nicht anlegen.');
  return {
    id: neu.id,
    agentId: neu.agent_id,
    korrelationId: neu.korrelation_id,
    status: neu.status,
    maxSchritte: agent.max_schritte ?? MAX_SCHRITTE_PLATZHALTER,
    bestand: false,
  };
}

export interface SchrittProtokoll {
  readonly werkzeug?: Werkzeug | null;
  readonly modell?: string | null;
  readonly eingabe: unknown;
  readonly ausgabe?: unknown;
  readonly tokensEingabe?: number;
  readonly tokensAusgabe?: number;
  readonly tokensGedanken?: number;
  readonly kostenMikrocent?: bigint;
  /**
   * Was das Werkzeug selbst gemessen hat — die Latenz des Modellaufrufs.
   * Informativ; die ZEITPUNKTE des Schritts setzt die Datenbank.
   */
  readonly dauerMs: number;
  /**
   * Der Beginn des Schritts nach der SERVERUHR — aus `beginneSchritt()`,
   * nie aus `Date.now()`. Fehlt er, tragen `begonnen_am` und `beendet_am`
   * beide `now()`: ein Schritt ohne gemessenen Beginn behauptet keinen.
   */
  readonly begonnenAm?: string | null;
  readonly status?: SchrittStatus;
  readonly policyErgebnis?: unknown;
  readonly policySpur?: unknown;
  readonly quellen?: unknown;
  readonly injektionsverdacht?: boolean;
  readonly richtlinieId?: string | null;
  readonly freigabeId?: string | null;
}

/**
 * Protokolliert einen Schritt und zählt die Aufgabe hoch — in einer Anweisung
 * je Tabelle, in derselben Transaktion wie der Schritt selbst.
 *
 * Erreicht der Zähler `max_schritte`, wirft diese Funktion: der Laeufer soll
 * die Aufgabe dann beenden und vorlegen, nicht weiterdrehen.
 */
/**
 * Der Beginn eines Schritts nach der SERVERUHR (Invariante 5).
 *
 * Die erste Fassung rechnete `begonnen_am` aus `now() - dauerMs` — und
 * `dauerMs` kam vom Aufrufer. Wer die Dauer angab, bestimmte damit den
 * Zeitstempel, obwohl der Kopf dieser Datei sagt, dass Postgres ihn setzt.
 * `clock_timestamp()` statt `now()`: `now()` ist der Beginn der
 * TRANSAKTION, und ein Schritt beginnt nicht, wenn die Aufgabe beginnt.
 */
export async function beginneSchritt(db: Abfrage): Promise<string> {
  const [z] = await db.abfrage<{ readonly jetzt: string }>(
    'select clock_timestamp()::text as jetzt');
  if (z === undefined) throw new Error('Die Serveruhr antwortet nicht.');
  return z.jetzt;
}

export async function protokolliereSchritt(
  db: Abfrage, mandantId: string, aufgabe: Aufgabe, schritt: SchrittProtokoll,
): Promise<{ readonly schrittId: string; readonly nummer: number }> {
  const [zaehler] = await db.abfrage<{ readonly schritte_anzahl: number }>(
    `update agent_aufgabe set schritte_anzahl = schritte_anzahl + 1
      where mandant_id = $1 and id = $2 returning schritte_anzahl`,
    [mandantId, aufgabe.id]);

  const nummer = zaehler?.schritte_anzahl ?? 1;

  const [zeile] = await db.abfrage<{ readonly id: string }>(
    `insert into agent_schritt
       (mandant_id, agent_aufgabe_id, schritt_nr, werkzeug, modell, eingabe, ausgabe,
        eingabe_hash, ausgabe_hash, tokens_eingabe, tokens_ausgabe, tokens_gedanken,
        kosten_mikrocent, dauer_ms, status, policy_ergebnis, policy_spur, quellen,
        injektionsverdacht, richtlinie_id, freigabe_id,
        begonnen_am, beendet_am, nutzlast_loeschfrist_am)
     values ($1, $2, $3, $4::agent_werkzeug_name, $5, $6::jsonb, $7::jsonb, $8, $9,
             $10, $11, $12, $13::bigint, $14::integer, $15::agent_schritt_status,
             $16::jsonb, $17::jsonb, $18::jsonb, $19, $20, $21,
             coalesce($23::timestamptz, clock_timestamp()),
             greatest(coalesce($23::timestamptz, clock_timestamp()), clock_timestamp()),
             (now() at time zone 'Europe/Berlin')::date + $22::integer)
     returning id`,
    /**
     * **Die Nutzlast als OBJEKT, nicht als ihr JSON-Text.**
     *
     * `JSON.stringify(...)` in einem `$n::jsonb`-Parameter schreibt eine
     * JSON-ZEICHENKETTE in die Spalte: `jsonb_typeof(eingabe)` ist dann
     * `string`, und `eingabe ->> 'dokumentId'` liefert NULL. Kein Fehler,
     * keine Meldung — die Zeile steht da und sieht vollstaendig aus, und erst
     * der Leser (0129) findet nichts. Der Treiber serialisiert selbst; ihm
     * zuvorzukommen kodiert zweimal. Derselbe Befund wie in `arbzg/detektor.ts`
     * und `bau/aufmass.ts`, wo er schon zweimal kommentiert steht.
     *
     * Der HASH nimmt weiterhin das Objekt (`hash()` serialisiert stabil) —
     * er soll den Inhalt binden, nicht dessen Transportform.
     */
    [mandantId, aufgabe.id, nummer, schritt.werkzeug ?? null, schritt.modell ?? null,
      schritt.eingabe ?? null,
      schritt.ausgabe ?? null,
      hash(schritt.eingabe),
      schritt.ausgabe === undefined ? null : hash(schritt.ausgabe),
      schritt.tokensEingabe ?? 0, schritt.tokensAusgabe ?? 0, schritt.tokensGedanken ?? 0,
      (schritt.kostenMikrocent ?? 0n).toString(), schritt.dauerMs,
      schritt.status ?? 'erfolg',
      schritt.policyErgebnis ?? null,
      schritt.policySpur ?? null,
      schritt.quellen ?? null,
      schritt.injektionsverdacht ?? false, schritt.richtlinieId ?? null,
      schritt.freigabeId ?? null, NUTZLAST_FRIST_TAGE_PLATZHALTER,
      schritt.begonnenAm ?? null]);

  if (zeile === undefined) throw new Error('Der Agentenschritt ließ sich nicht protokollieren.');

  if (nummer >= aufgabe.maxSchritte) throw new SchrittGrenzeErreicht(aufgabe.maxSchritte);
  return { schrittId: zeile.id, nummer };
}

export interface Abschluss {
  readonly status: Exclude<AufgabeStatus, 'wartend' | 'laufend'>;
  readonly ergebnis?: unknown;
  readonly fehlerText?: string | null;
  readonly budgetStopp?: boolean;
}

/**
 * Beendet die Aufgabe. Die Dauer rechnet **Postgres** aus den beiden
 * Servermarken — nicht der Aufrufer aus zwei `Date.now()`.
 */
export async function beendeAufgabe(
  db: Abfrage, mandantId: string, aufgabeId: string, abschluss: Abschluss,
): Promise<void> {
  await db.abfrage(
    `update agent_aufgabe
        set status = $3::agent_aufgabe_status,
            ergebnis = $4::jsonb,
            fehler_text = $5,
            budget_stopp = $6,
            beendet_am = now(),
            dauer_ms = greatest(0, (extract(epoch from (now() - coalesce(gestartet_am, now())))
                                    * 1000)::integer)
      where mandant_id = $1 and id = $2`,
    [mandantId, aufgabeId, abschluss.status,
      abschluss.ergebnis ?? null,
      abschluss.fehlerText ?? null, abschluss.budgetStopp ?? false]);
}

/** Was das Agenten-Zentrum je Aufgabe zeigt — Kosten schon in Cent (K-16(b)). */
export interface AufgabeZeile {
  readonly id: string;
  readonly agent: string;
  readonly titel: string;
  readonly status: AufgabeStatus;
  readonly schritte: number;
  readonly kostenCent: bigint;
  readonly budgetStopp: boolean;
  readonly erstelltAm: string;
}

interface ZeileRoh {
  readonly id: string;
  readonly agent: string;
  readonly titel: string;
  readonly status: AufgabeStatus;
  readonly schritte_anzahl: number;
  readonly kosten_cent: string;
  readonly budget_stopp: boolean;
  readonly erstellt_am: string;
}

export async function letzteAufgaben(
  db: Abfrage, grenze = 50,
): Promise<readonly AufgabeZeile[]> {
  const zeilen = await db.abfrage<ZeileRoh>(
    `select a.id, ag.name as agent, a.titel, a.status::text as status, a.schritte_anzahl,
            a.kosten_cent::text, a.budget_stopp,
            to_char(a.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as erstellt_am
       from agent_aufgabe a join agent ag on ag.id = a.agent_id
      order by a.erstellt_am desc
      limit $1`,
    [grenze]);

  return zeilen.map((z) => ({
    id: z.id,
    agent: z.agent,
    titel: z.titel,
    status: z.status,
    schritte: z.schritte_anzahl,
    kostenCent: BigInt(z.kosten_cent),
    budgetStopp: z.budget_stopp,
    erstelltAm: z.erstellt_am,
  }));
}

/** Der Monatsverbrauch je Agent, in Cent — die eine Umrechnung, hier. */
export async function monatsverbrauch(
  db: Abfrage,
): Promise<readonly { readonly agent: string; readonly cent: bigint }[]> {
  const zeilen = await db.abfrage<{ readonly agent: string; readonly mikrocent: string }>(
    `select ag.name as agent, coalesce(sum(k.kosten_mikrocent), 0)::text as mikrocent
       from agent ag
       left join agent_kosten k on k.agent_id = ag.id
        and k.jahr  = extract(year  from (now() at time zone 'Europe/Berlin'))::integer
        and k.monat = extract(month from (now() at time zone 'Europe/Berlin'))::integer
      group by ag.name
      order by ag.name`);
  return zeilen.map((z) => ({ agent: z.agent, cent: mikrocentNachCent(BigInt(z.mikrocent)) }));
}

/** Ein Schritt, wie ihn das Protokoll zeigt — ohne Nutzlast (K-05). */
export interface SchrittZeile {
  readonly id: string;
  readonly nummer: number;
  readonly werkzeug: string | null;
  readonly modell: string | null;
  readonly status: SchrittStatus;
  readonly tokensEingabe: number;
  readonly tokensAusgabe: number;
  readonly kostenCent: bigint;
  readonly dauerMs: number;
  readonly injektionsverdacht: boolean;
  readonly nutzlastGeloescht: boolean;
  readonly begonnenAm: string;
}

interface SchrittRoh {
  readonly id: string;
  readonly schritt_nr: number;
  readonly werkzeug: string | null;
  readonly modell: string | null;
  readonly status: SchrittStatus;
  readonly tokens_eingabe: number;
  readonly tokens_ausgabe: number;
  readonly kosten_mikrocent: string;
  readonly dauer_ms: number;
  readonly injektionsverdacht: boolean;
  readonly nutzlast_geloescht: boolean;
  readonly begonnen_am: string;
}

/**
 * Die Schrittkette — je Aufgabe oder je Agent.
 *
 * **Die Kosten kommen hier in Cent an, umgerechnet mit derselben Funktion wie
 * überall** (`mikrocentNachCent`, K-16(b)). Ein einzelner Schritt kostet
 * regelmäßig weniger als einen Cent und steht dann mit `0,00 €` da — das ist
 * richtig und nicht etwa ein Fehlbetrag: die Summe der Aufgabe steht im Kopf
 * und ist aus den Mikrocent gebildet, nicht aus diesen gerundeten Zeilen.
 *
 * **Ohne `eingabe`/`ausgabe`.** Die beiden Spalten fehlen `cse_app` schon im
 * Grant; wer sie sehen darf, holt sie einzeln über
 * `app.agent_nutzlast_lesen` (0129), und dieser Zugriff steht im Audit.
 */
export async function schritte(
  db: Abfrage, filter: { aufgabeId: string } | { agentId: string }, grenze = 200,
): Promise<readonly SchrittZeile[]> {
  const nachAufgabe = 'aufgabeId' in filter;
  const zeilen = await db.abfrage<SchrittRoh>(
    `select s.id, s.schritt_nr, s.werkzeug::text as werkzeug, s.modell,
            s.status::text as status, s.tokens_eingabe, s.tokens_ausgabe,
            s.kosten_mikrocent::text, s.dauer_ms, s.injektionsverdacht,
            (s.nutzlast_geloescht_am is not null) as nutzlast_geloescht,
            to_char(s.begonnen_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI:SS') as begonnen_am
       from agent_schritt s
       join agent_aufgabe a on a.mandant_id = s.mandant_id and a.id = s.agent_aufgabe_id
      where ${nachAufgabe ? 's.agent_aufgabe_id = $1' : 'a.agent_id = $1'}
      order by s.begonnen_am desc, s.schritt_nr desc
      limit $2`,
    [nachAufgabe ? filter.aufgabeId : filter.agentId, grenze]);

  return zeilen.map((z) => ({
    id: z.id,
    nummer: z.schritt_nr,
    werkzeug: z.werkzeug,
    modell: z.modell,
    status: z.status,
    tokensEingabe: z.tokens_eingabe,
    tokensAusgabe: z.tokens_ausgabe,
    kostenCent: mikrocentNachCent(BigInt(z.kosten_mikrocent)),
    dauerMs: z.dauer_ms,
    injektionsverdacht: z.injektionsverdacht,
    nutzlastGeloescht: z.nutzlast_geloescht,
    begonnenAm: z.begonnen_am,
  }));
}
