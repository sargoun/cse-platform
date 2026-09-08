/**
 * Die Sitzungskontexte — `withTenant`, `withGroupScope` und die zwei
 * Portalvarianten (K-18).
 *
 * **Der Gruppenkontext hat keine Schreibmethoden.** Nicht "prüft vor dem
 * Schreiben", sondern hat sie nicht: `LeseKontext` deklariert `abfrage`,
 * `SchreibKontext` erweitert ihn um `schreibe`, und `withGroupScope` gibt den
 * ersten zurück. Ein Schreibversuch in der Gruppenansicht ist damit ein
 * Compilerfehler und keine Laufzeitentscheidung — Invariante 10 wird von
 * niemandem vergessen, weil sie sich nicht formulieren lässt.
 *
 * Die zweite Linie steht trotzdem: RLS trägt `not app.ist_readonly()` in jeder
 * `WITH CHECK`, und ein direkter POST landet auf `KeinAktiverMandantFehler`.
 * Ein Typ schützt den Code, den wir schreiben; die Datenbank schützt den Rest.
 */
import { KeinAktiverMandantFehler } from './fehler.js';

export type Scope = 'mandant' | 'gruppe' | 'person' | 'kunde';
export type Portal = 'intern' | 'mitarbeiter' | 'kunde';

/** Was `app.sitzung_aufloesen` liefert. */
export interface Sitzung {
  readonly benutzerId: string;
  readonly personId: string | null;
  readonly aktiverMandantId: string | null;
  readonly ansicht: Scope;
  readonly aal: 'aal1' | 'aal2';
  readonly portal: Portal;
  readonly sitzungId: string;
}

/** Der schmale Treiberausschnitt — die Schicht bindet keinen Treiber. */
export interface Transaktion {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface LeseKontext {
  readonly scope: Scope;
  readonly portal: Portal;
  readonly benutzerId: string;
  /** In jedem mandantenübergreifenden Scope NULL — per Konstruktion. */
  readonly aktiverMandantId: string | null;
  readonly mandantIds: readonly string[];
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface SchreibKontext extends LeseKontext {
  /** Im Schreibkontext ist er nie NULL. Das ist der ganze Unterschied. */
  readonly aktiverMandantId: string;
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/** Setzt die K-02-GUCs. Transaktionslokal — nie über die Anfrage hinaus. */
async function bindeSitzung(
  tx: Transaktion,
  sitzung: Sitzung,
  readonly: boolean,
  mandantIds: readonly string[],
): Promise<void> {
  await tx.unsafe(`set local role cse_app`);
  const setze = async (name: string, wert: string): Promise<void> => {
    await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
  };
  await setze('app.scope', sitzung.ansicht);
  await setze('app.mandant_id', sitzung.aktiverMandantId ?? '');
  await setze('app.mandant_ids', mandantIds.join(','));
  await setze('app.benutzer_id', sitzung.benutzerId);
  await setze('app.person_id', sitzung.personId ?? '');
  await setze('app.aal', sitzung.aal);
  await setze('app.portal', sitzung.portal);
  await setze('app.readonly', readonly ? 'on' : 'off');
  await setze('app.sitzung_id', sitzung.sitzungId);
  await setze('app.akteur_typ', 'mensch');
}

function basis(
  tx: Transaktion, sitzung: Sitzung, mandantIds: readonly string[],
): LeseKontext {
  return {
    scope: sitzung.ansicht,
    portal: sitzung.portal,
    benutzerId: sitzung.benutzerId,
    aktiverMandantId: sitzung.aktiverMandantId,
    mandantIds,
    abfrage: async <T,>(sql: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(sql, werte)) as readonly T[],
  };
}

/**
 * Der Arbeitskontext: genau ein Mandant, lesen und schreiben.
 *
 * Wirft, wenn kein aktiver Mandant gebunden ist. Das ist kein Sonderfall,
 * sondern die einzige Stelle, an der Invariante 10 überhaupt geprüft werden
 * muss — jeder Schreibpfad führt hier durch.
 */
export async function withTenant<T>(
  tx: Transaktion,
  sitzung: Sitzung,
  fn: (kontext: SchreibKontext) => Promise<T>,
): Promise<T> {
  if (sitzung.ansicht !== 'mandant' || sitzung.aktiverMandantId === null) {
    throw new KeinAktiverMandantFehler(`Ansicht ${sitzung.ansicht}`);
  }
  const mandantId = sitzung.aktiverMandantId;
  await bindeSitzung(tx, sitzung, false, [mandantId]);
  const lese = basis(tx, sitzung, [mandantId]);
  return fn({
    ...lese,
    aktiverMandantId: mandantId,
    schreibe: lese.abfrage,
  });
}

/**
 * Die Gruppenansicht (TEN-05) — lesend, über mehrere Bereiche.
 *
 * `app.scope = 'gruppe'`, `app.mandant_id` NULL, `app.mandant_ids` trägt die
 * Menge (K-02, K-18). Sie ist ausdrücklich **kein** breiter `mandant`-Scope:
 * ein solcher hätte einen aktiven Mandanten und damit einen Schreibpfad.
 *
 * `app.portal` ist hier die Konstante `intern`, beim Betreten gebunden (K-20).
 * Es aus `aktiver_mandant` neu zu berechnen ergäbe das fail-closed
 * `mitarbeiter` — was jede K-04-Mitarbeiterdecke INNERHALB der Gruppenansicht
 * auslöst und sie für genau das Publikum leert, für das TEN-05 sie gebaut hat.
 */
export async function withGroupScope<T>(
  tx: Transaktion,
  sitzung: Sitzung,
  mandantIds: readonly string[],
  fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  const gruppe: Sitzung = {
    ...sitzung, ansicht: 'gruppe', aktiverMandantId: null, portal: 'intern',
  };
  await bindeSitzung(tx, gruppe, true, mandantIds);
  return fn(basis(tx, gruppe, mandantIds));
}

/**
 * Der Kontext, den eine Gruppenseite bekommt.
 *
 * Der Rückgabetyp ist `LeseKontext` und nur er — es gibt kein `schreibe`,
 * das jemand aufrufen könnte.
 */
export function readOnlyGroupContext(kontext: LeseKontext): LeseKontext {
  if (kontext.scope === 'mandant') {
    throw new Error('readOnlyGroupContext auf einem Mandantenkontext — Scope verwechselt.');
  }
  return kontext;
}

export { KeinAktiverMandantFehler };
