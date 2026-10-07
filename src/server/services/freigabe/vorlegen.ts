import 'server-only';
import type { Risiko } from './posteingang.js';

/**
 * **Vorlegen ist nicht Entscheiden** (V-376, O-369, O-513, D-819).
 *
 * Eine offene Bitte um Freigabe entsteht nur über `app.freigabe_vorlegen`
 * (0515). Bis dahin schrieb jeder Dienst sie selbst in `freigabe` — und die
 * Schreibpolicy aus 0136 verlangte dafür `freigabe.entscheiden`. Wer nur
 * vorlegen sollte, scheiterte; wer vorlegen konnte, durfte damit auch
 * entscheiden. Genau diese Trennung ist Invariante 7.
 *
 * **Was der Definer selbst setzt:** die aktive Gesellschaft, den Status
 * `offen`, den Urheber (die Sitzung; bei einem Agentenlauf niemand — wie
 * bisher) und alle Entscheidungsfelder. Der Aufrufer gibt nur den Vorgang
 * mit, samt den extrahierten Feldern eines Vorschlags; eine Angabe, die
 * nicht in der Liste steht, ist ein Fehler.
 *
 * **Wer vorlegen darf** (Voreinstellung O-513, D-799): wer im Modul des
 * erforderlichen Rechts ein nicht lesendes Recht hält (`social.freigeben` →
 * `social.schreiben` genügt); bei einem Agentenlauf, wer Agentenaufgaben
 * starten darf — mit einer laufenden Aufgabe dieser Gesellschaft. Agent und
 * Aufgabe kommen aus der Aufgabe, nicht vom Aufrufer.
 *
 * TODO(client, O-513): Voreinstellung — das Vorlegerecht ist das nicht
 * lesende Recht im Modul des Entscheidungsrechts, beim Agenten das Recht,
 * Aufgaben zu starten. D-799, D-819.
 */

export interface Schreiber {
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/** Ein extrahiertes Feld eines Vorschlags (`freigabe_feld`) — es gehört zum Vorgang. */
export interface VorlageFeld {
  readonly feldPfad: string;
  readonly bezeichnung: string;
  readonly wertVorher: string | null;
  readonly wertNachher: string | null;
  /** Als Text, wie `konfidenzText` ihn bildet. */
  readonly konfidenz: string | null;
  readonly unsicher: boolean;
  readonly grund: string | null;
  readonly quelleDokumentId?: string | null;
  readonly quelleTabelle?: string | null;
  readonly quelleZelle?: string | null;
  readonly quelleZitat?: string | null;
  readonly extraktionModell: string | null;
}

export interface Vorlage {
  readonly aktion: string;
  /** `agent_vorgang_typ` — die Art, nach der der Posteingang sortiert. */
  readonly vorgangTyp: string;
  readonly titel: string;
  readonly zusammenfassung: string;
  readonly risiko: Risiko;
  readonly risikoPunkte?: number | null;
  /** Der Diff als JSON-Wert (`diffZuJson`); ohne: kein Vergleich. */
  readonly diff?: unknown;
  /** Die Nutzlast, über die entschieden wird — bereits als JSON-Wert. */
  readonly vorschauPayload: unknown;
  readonly payloadHash: string;
  readonly betragCent?: bigint | null;
  /** Als Text, wie `konfidenzText` ihn bildet. */
  readonly minKonfidenz?: string | null;
  readonly stapelFaehig?: boolean;
  readonly stapelSperreGrund?: string | null;
  /** Das Recht, das entscheidet; ohne: `freigabe.entscheiden`. */
  readonly erforderlichesRecht?: string | null;
  readonly bezugTyp?: string | null;
  readonly bezugId?: string | null;
  readonly externeRef?: string | null;
  /** Die Aufgabe eines Agentenlaufs — dann prüft der Definer `agent.aufgabe_starten`. */
  readonly agentAufgabeId?: string | null;
  /** ISO-Zeitpunkt. */
  readonly frist?: string | null;
  /** Die extrahierten Felder — im selben Aufruf, sonst bräuchte der Vorleger `freigabe.lesen`. */
  readonly felder?: readonly VorlageFeld[];
}

/**
 * Die Angaben für den Definer — nur, was gesetzt ist. `betrag_cent` geht
 * als Text: eine `bigint` überlebt `JSON.stringify` nicht, und der Definer
 * liest ihn ohnehin mit `::bigint`.
 */
export function vorlageAlsJson(v: Vorlage): Record<string, unknown> {
  const aus: Record<string, unknown> = {
    aktion: v.aktion,
    vorgang_typ: v.vorgangTyp,
    titel: v.titel,
    zusammenfassung: v.zusammenfassung,
    risiko: v.risiko,
    vorschau_payload: v.vorschauPayload,
    payload_hash: v.payloadHash,
  };
  const dazu = (schluessel: string, wert: unknown): void => {
    if (wert !== undefined && wert !== null) aus[schluessel] = wert;
  };
  dazu('risiko_punkte', v.risikoPunkte);
  dazu('diff', v.diff);
  dazu('betrag_cent', v.betragCent === undefined || v.betragCent === null
    ? null : v.betragCent.toString());
  dazu('min_konfidenz', v.minKonfidenz);
  dazu('stapel_faehig', v.stapelFaehig);
  dazu('stapel_sperre_grund', v.stapelSperreGrund);
  dazu('erforderliches_recht', v.erforderlichesRecht);
  dazu('bezug_typ', v.bezugTyp);
  dazu('bezug_id', v.bezugId);
  dazu('externe_ref', v.externeRef);
  dazu('agent_aufgabe_id', v.agentAufgabeId);
  dazu('frist', v.frist);
  if (v.felder !== undefined && v.felder.length > 0) {
    aus['felder'] = v.felder.map((f) => ({
      feld_pfad: f.feldPfad,
      bezeichnung: f.bezeichnung,
      wert_vorher: f.wertVorher,
      wert_nachher: f.wertNachher,
      konfidenz: f.konfidenz,
      unsicher: f.unsicher,
      grund: f.grund,
      quelle_dokument_id: f.quelleDokumentId ?? null,
      quelle_tabelle: f.quelleTabelle ?? null,
      quelle_zelle: f.quelleZelle ?? null,
      quelle_zitat: f.quelleZitat ?? null,
      extraktion_modell: f.extraktionModell,
    }));
  }
  return aus;
}

/** Legt die offene Bitte an und gibt ihre Kennung zurück. */
export async function legeFreigabeVor(kontext: Schreiber, v: Vorlage): Promise<string> {
  const [z] = await kontext.schreibe<{ id: string }>(
    `select app.freigabe_vorlegen($1::jsonb) as id`, [vorlageAlsJson(v)]);
  if (z === undefined) throw new Error('Die Freigabe wurde nicht angelegt.');
  return z.id;
}

/**
 * Nimmt eine offene Bitte zurück — `false`, wenn sie schon entschieden ist
 * (dann bleibt sie, wie sie ist: Entscheidungen sind Tatsachen, APR-07).
 */
export async function zieheFreigabeZurueck(
  kontext: Schreiber, freigabeId: string, grund: string,
): Promise<boolean> {
  const [z] = await kontext.schreibe<{ ok: boolean }>(
    `select app.freigabe_zurueckziehen($1::uuid, $2) as ok`, [freigabeId, grund]);
  return z?.ok === true;
}
