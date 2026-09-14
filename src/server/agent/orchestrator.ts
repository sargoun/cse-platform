import 'server-only';
import type { SchreibKontext } from '../kontext/index.js';
import { kanonisiere } from '../services/finanz/kanonisch.js';
import { fordereModell } from './modell/auswahl.js';
import { ModellFehler, type ModellPort } from './modell/port.js';
import { beginneSchritt, protokolliereSchritt, starteAufgabe } from './laufzeit.js';

/**
 * Der Orchestrator — **der Weg vom Auftrag zum Vorschlag** (AGT-01, §4).
 *
 * Er ist absichtlich kurz und absichtlich langweilig, denn er ist die Stelle,
 * an der ein Modell auf echte Daten trifft. Drei Regeln, und sie sind die
 * ganze Datei:
 *
 *  1. **Die Werkzeuge rechnen, das Modell formuliert** (Invariante 6). Jede
 *     Zahl, die im Entwurf steht, kommt aus einer geprüften Funktion in
 *     `server/services/` und wandert als fertige Zeichenkette in die
 *     Tatsachen. Der Port bekommt nichts zu rechnen, also kann er sich nicht
 *     verrechnen.
 *  2. **Am Ende steht ein ENTWURF, nie eine Handlung** (Invariante 7). Der
 *     Lauf endet in einer `freigabe` mit Status `offen`. Was danach geschieht,
 *     entscheidet ein Mensch im Posteingang — auch dann, wenn eine Richtlinie
 *     das Gegenteil erlaubte: `server/agent/policy.ts` ist das Tor, und der
 *     Orchestrator geht nicht daran vorbei.
 *  3. **Jeder Schritt steht im Protokoll**, mit Modell, Tokens, Kosten und
 *     Dauer (AGT-05) — auch der, der abgewiesen wurde.
 *
 * **Kein Modell ist kein Absturz.** Ist für `entwurf_text` nichts freigegeben,
 * endet der Lauf mit `RESIDENCY_BLOCKED`, die Aufgabe steht auf `fehlgeschlagen`,
 * und der Bildschirm sagt „KI-Funktion nicht verfügbar" (§8). Die Arbeit läuft
 * von Hand weiter.
 */

export type AgentKennung = 'ceo_assistent' | 'akquise' | 'backoffice' | 'finanzen';

export interface LaufAuftrag {
  readonly agent: AgentKennung;
  readonly vorgangTyp: string;
  readonly titel: string;
  /** Die Vorlage, nach der formuliert wird — nie vom Modell gewählt. */
  readonly vorlage: string;
  /**
   * Die gerechneten Tatsachen. Sie sind schon Zeichenketten: formatiert von
   * dem Dienst, der sie gerechnet hat, damit der Orchestrator nichts
   * umrechnet und das Modell erst recht nicht.
   */
  readonly tatsachen: Readonly<Record<string, string>>;
  /** Woran der Vorschlag hängt — Objekt, Projekt, Ausschreibung, Beleg. */
  readonly bezugTyp?: string;
  readonly bezugId?: string;
  /** Verhindert den zweiten Lauf zur selben Lage (ein Ereignis kommt zweimal). */
  readonly idempotenzSchluessel?: string;
  readonly angefordertVon?: string;
  readonly codeVersion: string;
}

export interface LaufErgebnis {
  readonly aufgabeId: string;
  readonly freigabeId: string | null;
  readonly entwurf: string;
  readonly modell: string;
  readonly schritte: number;
  /** `true`, wenn die Aufgabe schon lief und nichts Neues entstand. */
  readonly bestand: boolean;
  /**
   * **Warum der Lauf nichts vorgelegt hat — als ERGEBNIS, nicht als Ausnahme.**
   *
   * §8 nennt „kein Modell freigegeben" einen Betriebszustand, keinen Fehler,
   * und das hat eine Folge, die man leicht übersieht: eine Ausnahme risse die
   * Transaktion des Aufrufers mit, und mit ihr die gerade angelegte
   * Aufgabenzeile. Der Lauf wäre gescheitert UND unsichtbar — im
   * Agentenzentrum stünde nichts, und niemand wüsste, dass er es versucht hat.
   *
   * Also: die Aufgabe bleibt stehen, sie trägt `fehlgeschlagen` und den Satz,
   * und der Aufrufer entscheidet, was er damit anzeigt.
   */
  readonly gestoert: { readonly code: string; readonly nachricht: string } | null;
}

/**
 * Ein Lauf.
 *
 * **Warum der Entwurf und die Freigabe in EINER Transaktion entstehen:** ein
 * Entwurf ohne Freigabezeile wäre Text, den niemand sieht, und eine
 * Freigabezeile ohne Entwurf ein leerer Posteingangseintrag. Beides ist
 * schlimmer als ein Lauf, der ganz scheitert.
 */
export async function fuehreLaufAus(
  kontext: SchreibKontext, auftrag: LaufAuftrag,
): Promise<LaufErgebnis> {
  const db = { abfrage: kontext.abfrage.bind(kontext) };

  const aufgabe = await starteAufgabe(db, kontext.aktiverMandantId, {
    agentKennung: auftrag.agent,
    vorgangTyp: auftrag.vorgangTyp,
    titel: auftrag.titel,
    eingabe: { vorlage: auftrag.vorlage, tatsachen: auftrag.tatsachen },
    ...(auftrag.bezugTyp === undefined ? {} : { bezugTyp: auftrag.bezugTyp }),
    ...(auftrag.bezugId === undefined ? {} : { bezugId: auftrag.bezugId }),
    ...(auftrag.idempotenzSchluessel === undefined
      ? {} : { idempotenzSchluessel: auftrag.idempotenzSchluessel }),
    ...(auftrag.angefordertVon === undefined
      ? {} : { angefordertVon: auftrag.angefordertVon }),
    ausgeloestDurch: auftrag.angefordertVon === undefined ? 'zeitplan' : 'mensch',
    codeVersion: auftrag.codeVersion,
  });

  /* Eine Aufgabe, die es schon gab, läuft nicht ein zweites Mal. */
  if (aufgabe.bestand) {
    return {
      aufgabeId: aufgabe.id, freigabeId: null, entwurf: '', modell: '',
      schritte: 0, bestand: true, gestoert: null,
    };
  }

  let port: ModellPort;
  try {
    port = await fordereModell(kontext, 'entwurf_text');
  } catch (fehler) {
    if (!(fehler instanceof ModellFehler)) throw fehler;
    const nachricht = fehler.message;
    await kontext.schreibe(
      `update agent_aufgabe set status = 'fehlgeschlagen', fehler_text = $2, beendet_am = now()
        where id = $1::uuid`,
      [aufgabe.id, nachricht]);
    return {
      aufgabeId: aufgabe.id, freigabeId: null, entwurf: '', modell: '',
      schritte: 0, bestand: false,
      gestoert: { code: fehler.code, nachricht },
    };
  }

  /* — Schritt 1: formulieren. Die Tatsachen sind schon gerechnet. — */
  const begonnen = await beginneSchritt(db);
  const entwurf = await port.entwerfe({ vorlage: auftrag.vorlage, tatsachen: auftrag.tatsachen });

  await protokolliereSchritt(db, kontext.aktiverMandantId, aufgabe, {
    werkzeug: null,
    modell: entwurf.verbrauch.modell,
    eingabe: { vorlage: auftrag.vorlage, tatsachen: auftrag.tatsachen },
    ausgabe: { text: entwurf.text },
    tokensEingabe: entwurf.verbrauch.tokensEingabe,
    tokensAusgabe: entwurf.verbrauch.tokensAusgabe,
    dauerMs: entwurf.verbrauch.dauerMs,
    begonnenAm: begonnen,
    status: 'erfolg',
  });

  /*
   * — Schritt 2: vorlegen. NIE senden. —
   *
   * Der Vorschlag geht als `freigabe` mit Status `offen` in den Posteingang.
   * Das Tor (`policy.ts`) entscheidet erst NACH einer menschlichen
   * Entscheidung, ob etwas hinausgeht; hier entsteht nur das, worüber
   * entschieden wird.
   */
  const nutzlast = { entwurf: entwurf.text, ...auftrag.tatsachen };
  const [hash] = await kontext.schreibe<{ hash: string }>(
    `select encode(digest($1::bytea, 'sha256'), 'hex') as hash`,
    [Buffer.from(kanonisiere(nutzlast as never))]);

  const [freigabe] = await kontext.schreibe<{ id: string }>(
    `insert into freigabe
       (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung, risiko,
        diff, vorschau_payload, payload_hash, agent_id, agent_aufgabe_id, externe_ref)
     values ($1::uuid, 'interner_hinweis', 'offen', $2::agent_vorgang_typ, $3, $4,
             'niedrig', '[]'::jsonb, $5::jsonb, $6, $7::uuid, $8::uuid, $9)
     returning id`,
    [kontext.aktiverMandantId, auftrag.vorgangTyp, auftrag.titel, entwurf.text,
      nutzlast, hash?.hash ?? '', aufgabe.agentId, aufgabe.id,
      `agent:${aufgabe.id}`]);

  await kontext.schreibe(
    `update agent_aufgabe
        set status = 'wartet_auf_freigabe', beendet_am = now(),
            ergebnis = jsonb_build_object('freigabe_id', $2::text)
      where id = $1::uuid`,
    [aufgabe.id, freigabe?.id ?? '']);

  return {
    aufgabeId: aufgabe.id,
    freigabeId: freigabe?.id ?? null,
    entwurf: entwurf.text,
    modell: entwurf.verbrauch.modell,
    schritte: 1,
    bestand: false,
    gestoert: null,
  };
}
