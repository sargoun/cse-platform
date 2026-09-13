import 'server-only';
import { createHash } from 'node:crypto';
import { berechneHash } from './finanz/hash-chain.js';

/**
 * Die Freigabe als Vorgang — K-13, APR-07 (`01-KERN.md` §6, PR 12).
 *
 * **Warum es diesen Dienst gibt.** Die drei Schritte einer Freigabe —
 * `freigabe`, Kettennummer, `freigabe_snapshot` — standen bisher nur an
 * EINER Stelle ausgeschrieben, im Seed der Bau-Domäne. Jede weitere Domäne,
 * die eine Freigabe braucht, hätte sie abgeschrieben, und eine abgeschriebene
 * Hashkette ist eine, die beim ersten Tippfehler nichts mehr bezeugt.
 *
 * **Was eine Freigabe ist und was nicht.** Sie ist der unveränderliche Satz
 * „diese Person hat GENAU DAS genehmigt". Deshalb wird nicht nur der
 * Entschluss gespeichert, sondern die NUTZLAST, über die entschieden wurde,
 * samt Abdruck — wer den Vorgang nach der Freigabe umschreibt, hat für das,
 * was er dann tut, keine mehr.
 *
 * **Die Kette hängt Glied an Glied.** `app.freigabe_kette_ziehen` zieht die
 * Nummer unter `SELECT … FOR UPDATE`, damit zwei gleichzeitige Freigebende
 * die Kette nicht gabeln, und `berechneHash` ist dieselbe Funktion, mit der
 * die Rechnungskette rechnet: SHA-256 über die Nutzlastbytes UND den
 * vorherigen Hash als rohe Bytes. `hash = nutzlast_hash` zu schreiben sähe
 * gleich aus und wäre keine Kette — jedes Glied liesse sich einzeln
 * austauschen.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type Entscheidung = 'genehmigt' | 'abgelehnt';

export class FreigabeFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'FreigabeFehler';
  }
}

/**
 * Stabil über die Schlüsselreihenfolge (`sha256-jcs-v1`, die Vorgabe der
 * Spalte `algorithmus`).
 *
 * Ohne Sortierung hätten zwei gleiche Nutzlasten verschiedene Abdrücke, je
 * nachdem in welcher Reihenfolge jemand die Felder gesetzt hat — und jede
 * Freigabe wäre zufällig ungültig.
 *
 * **Getrennt von `agent/policy.ts::nutzlastHash`, und das ist Absicht.** Dort
 * geht es um das Tor vor dem, was das HAUS VERLÄSST (Invariante 7), und die
 * dortige `Aktion` ist genau diese geschlossene Menge. Eine interne Kontrolle
 * wie die Freigabe einer Eingangsrechnung gehört nicht hinein; sie in jene
 * Liste zu schreiben hiesse, eine Buchhaltungsentscheidung als Aussendung zu
 * führen.
 */
function abdruck(aktion: string, mandantId: string, inhalt: Record<string, unknown>): string {
  const kanonisch = JSON.stringify({ aktion, mandantId, inhalt: sortiere(inhalt) });
  return createHash('sha256').update(kanonisch, 'utf8').digest('hex');
}

function sortiere(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(sortiere);
  if (wert !== null && typeof wert === 'object') {
    const o = wert as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortiere(o[k])]));
  }
  return wert;
}

export interface FreigabeErteilen {
  /** Was freigegeben wird, als Schlüssel — z. B. `eingangsrechnung_buchen`. */
  readonly aktion: string;
  /** Worüber entschieden wurde. Der Abdruck davon bindet die Freigabe daran. */
  readonly inhalt: Record<string, unknown>;
  readonly begruendung: string;
  readonly entscheidung?: Entscheidung;
  /**
   * Der Abdruck, wenn ihn der Aufrufer vorgibt.
   *
   * **Für alles, was das Haus verlässt, MUSS er vorgegeben werden.** Der
   * Versand läuft durch `agent/policy.ts::gate`, und das vergleicht den
   * gespeicherten `nutzlast_hash` mit `policy.nutzlastHash` über die Nutzlast,
   * wie sie im Moment des Versands dasteht. Der hausinterne `abdruck()` unten
   * kanonisiert anders (ohne `betragCent`) — eine damit erteilte Freigabe
   * passte nie zu dem, was hinausgeht, und das Tor wiese jede einzelne ab.
   * Für rein interne Kontrollen (eine gebuchte Eingangsrechnung) bleibt
   * `abdruck()` richtig; die gehören nicht in die Aktionsliste des Tors.
   */
  readonly abdruck?: string;
}

/**
 * Erteilt (oder verweigert) eine Freigabe und gibt ihre Kennung zurück.
 *
 * Die Begründung ist Pflicht: eine Freigabe ohne Grund ist im Nachhinein
 * nicht von einem Versehen zu unterscheiden, und genau danach wird gefragt.
 */
export async function erteileFreigabe(
  db: Abfrage, e: FreigabeErteilen,
): Promise<string> {
  if (e.begruendung.trim().length < 5) {
    throw new FreigabeFehler(
      'Eine Freigabe nennt ihren Grund — er steht später allein in der Kette.');
  }
  const entscheidung = e.entscheidung ?? 'genehmigt';

  const [freigabe] = await db.abfrage<{ id: string; mandant_id: string }>(
    `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                           begruendung, erstellt_von)
     values (app.aktiver_mandant(), $1, $2::freigabe_status, app.aktueller_benutzer(),
             now(), $3, app.aktueller_benutzer())
     returning id, mandant_id`,
    [e.aktion, entscheidung, e.begruendung.trim()]);
  if (freigabe === undefined) {
    throw new FreigabeFehler('Die Freigabe wurde nicht angelegt.');
  }

  const [kette] = await db.abfrage<{ kette_nr: string; vorheriger_hash: string }>(
    `select * from app.freigabe_kette_ziehen($1::uuid)`, [freigabe.mandant_id]);
  if (kette === undefined) {
    throw new FreigabeFehler('Die Freigabekette gab keine Nummer aus.');
  }

  const bytes = Buffer.from(JSON.stringify(e.inhalt), 'utf8');
  await db.abfrage(
    `insert into freigabe_snapshot (mandant_id, freigabe_id, kette_nr, nutzlast,
                                    nutzlast_hash, vorheriger_hash, hash,
                                    entscheidung, entschieden_von)
     values ($1::uuid, $2::uuid, $3::bigint, $4::jsonb, $5, $6, $7,
             $8::freigabe_status, app.aktueller_benutzer())`,
    [freigabe.mandant_id, freigabe.id, kette.kette_nr, JSON.stringify(e.inhalt),
     e.abdruck ?? abdruck(e.aktion, freigabe.mandant_id, e.inhalt), kette.vorheriger_hash,
     berechneHash(bytes, kette.vorheriger_hash), entscheidung]);

  return freigabe.id;
}
