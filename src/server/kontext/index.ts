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
import { KeinAktiverMandantFehler, KeinKundenzugangFehler, KeinePersonFehler }
  from './fehler.js';

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

/**
 * Die Bindung fuer eine reine ANFRAGE-Pruefung — Tor und Rollenabfrage.
 *
 * Sie setzt dieselben GUCs wie `bindeSitzung`, ohne einen Kontext
 * zurueckzugeben: das Tor liest keine Fachzeilen, es fragt `app.hat_recht`.
 * `app.mandant_ids` bleibt hier leer und wird vom Aufrufer nachgezogen, wo der
 * Scope es verlangt — im Gruppen-Scope IST diese Menge die sichtbare Menge,
 * und sie darf nicht aus der Anwendung kommen.
 */
export async function bindeAnfrage(tx: Transaktion, sitzung: Sitzung): Promise<void> {
  await bindeSitzung(tx, sitzung, true, []);
}

/**
 * Dieselbe Bindung, aber SCHREIBEND — fuer das, was einem Menschen gehoert
 * und keiner Gesellschaft.
 *
 * **Warum es das getrennt gibt.** `bindeAnfrage` setzt `app.readonly = 'on'`,
 * und jede `with check`-Bedingung im Haus traegt `not app.ist_readonly()`. Ein
 * Schreibvorgang dahinter faellt deshalb in die RLS statt in eine Pruefung:
 * „new row violates row-level security policy" — richtig, und an der falschen
 * Stelle erklaert.
 *
 * `withTenant` waere die uebliche Antwort, verlangt aber genau EINEN aktiven
 * Mandanten (Invariante 10, `SchreibKontext.aktiverMandantId: string`). Der
 * Posteingang und die Benachrichtigungseinstellung gehoeren aber dem KONTO
 * und nicht einem Bereich: sie stehen auch in der Gruppenansicht, in der es
 * keinen aktiven Mandanten gibt. Eingegrenzt sind sie trotzdem, nur woanders —
 * `t_benachrichtigung_lesen_setzen` und `t_praeferenz_eigene` binden jede
 * Zeile an `app.aktueller_benutzer()`.
 *
 * `app.mandant_ids` bleibt leer: was hier geschrieben wird, gehoert keinem
 * Bereich, und eine Liste, die nicht gebraucht wird, waere eine, die jemand
 * spaeter benutzt.
 */
export async function bindePersoenlich(tx: Transaktion, sitzung: Sitzung): Promise<void> {
  await bindeSitzung(tx, sitzung, false, []);
}

/**
 * Die Bereiche, die im Gruppen-Scope offenstehen — aus der Datenbank.
 *
 * `app.switcher_mandanten()` und NICHT `select id from mandant`: die zweite
 * Fassung gab jeder Sitzung jeden nicht archivierten Bereich, und weil
 * `app.sichtbare_mandanten()` im Gruppen-Scope genau `app.mandant_ids()` ist
 * (`0004_rls_baseline.sql`), waere das die sichtbare Menge geworden.
 * `t_mandant_lesen` prueft nur die Zugehoerigkeit zu dieser Menge und kein
 * Recht — eine `leitung` der Reinigung haette die Namen aller vier
 * Gesellschaften gelesen.
 *
 * Der Unterschied zu `sichtbare_mandanten()` ist Absicht (B14): ein
 * archivierter Bereich bleibt LESBAR — seine Rechnungen stehen zehn Jahre —
 * wird aber nicht mehr als Arbeitskontext angeboten.
 */
export async function gruppenMandanten(tx: Transaktion): Promise<readonly string[]> {
  const [zeile] = (await tx.unsafe(
    `select app.switcher_mandanten() as ids`,
  )) as { ids: readonly string[] | null }[];
  return zeile?.ids ?? [];
}

/**
 * Die Rolle der aktiven Mitgliedschaft — IN der gebundenen Transaktion.
 *
 * `t_bm_lesen` verlangt `benutzer_id = app.aktueller_benutzer()`. Ohne
 * gebundene Sitzung gibt `benutzer_mandant` deshalb null Zeilen zurueck, und
 * `force row level security` laesst auch dem Eigentuemer keinen Weg daran
 * vorbei. Diese Funktion setzt voraus, dass `bindeAnfrage` oder
 * `bindeSitzung` bereits lief — sie bindet nicht selbst, damit es genau eine
 * Stelle gibt, an der gebunden wird.
 */
export async function rolleImMandanten(
  tx: Transaktion, sitzung: Sitzung,
): Promise<string | null> {
  if (sitzung.aktiverMandantId === null) return null;
  const zeilen = (await tx.unsafe(
    `select r.schluessel from benutzer_mandant bm
       join rolle r on r.id = bm.rolle_id
      where bm.benutzer_id = $1 and bm.mandant_id = $2
        and bm.entzogen_am is null
        and bm.gueltig_ab <= current_date
        and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
      limit 1`,
    [sitzung.benutzerId, sitzung.aktiverMandantId],
  )) as { schluessel: string }[];
  return zeilen[0]?.schluessel ?? null;
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
 *
 * **Die Menge nimmt dieser Kontext nicht entgegen, er leitet sie ab.** Sie
 * einzureichen hiess, dass der Aufrufer bestimmt, was die Gruppenansicht
 * umfasst — und der erste Aufrufer reichte `select id from mandant` ein, also
 * jeden Bereich, unabhängig von jeder Mitgliedschaft.
 */
export async function withGroupScope<T>(
  tx: Transaktion,
  sitzung: Sitzung,
  fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  const gruppe: Sitzung = {
    ...sitzung, ansicht: 'gruppe', aktiverMandantId: null, portal: 'intern',
  };
  // Erst binden, dann ableiten, dann setzen — wie im Personen-Scope. Ohne
  // gebundenen Benutzer gaebe `switcher_mandanten()` die leere Menge zurueck.
  await bindeSitzung(tx, gruppe, true, []);
  const mandantIds = await gruppenMandanten(tx);
  await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`,
    [mandantIds.join(',')]);
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

/**
 * Der Personen-Scope (PER, K-18) — das Mitarbeiterportal.
 *
 * **Er spannt ueber Mandanten, aber als SUBJEKT.** Fatima arbeitet in zwei
 * Gesellschaften (D-09); ihr Portal zeigt beide Beschaeftigungen. Das ist
 * NICHT die Gruppenansicht: die verlangt `gruppe.<modul>.lesen`, ein
 * Leitungsrecht, das kein `mitarbeiter` haelt. Ueber den Gruppen-Scope
 * gelesen bliebe das Mitarbeiterportal LEER — kein Fehler, keine Meldung,
 * nur nichts. Genau dieser Fehler steht in `04-SEITENKARTE.md` §1.3 als
 * Kategorienfehler mit konkreter Folge.
 *
 * **Die sichtbaren Mandanten werden SERVERSEITIG abgeleitet** (K-02), und
 * zwar von der Datenbank: `app.sichtbare_mandanten()` liest im
 * Personen-Scope die lebenden `anstellung`-Zeilen dieser Person. Deshalb
 * bindet diese Funktion zuerst Scope und Person, fragt dann die Menge ab und
 * setzt sie erst danach — sie kann nicht von aussen gesetzt werden.
 */
export async function withPersonScope<T>(
  tx: Transaktion,
  sitzung: Sitzung,
  fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  if (sitzung.personId === null || sitzung.personId === '') throw new KeinePersonFehler();

  const person: Sitzung = {
    ...sitzung, ansicht: 'person', aktiverMandantId: null, portal: 'mitarbeiter',
  };
  // Erst binden — ohne `app.scope` und `app.person_id` antwortet
  // `sichtbare_mandanten()` mit der leeren Menge.
  await bindeSitzung(tx, person, true, []);
  const [zeile] = (await tx.unsafe(
    `select app.sichtbare_mandanten() as ids`,
  )) as { ids: readonly string[] | null }[];
  const mandantIds = zeile?.ids ?? [];
  await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [mandantIds.join(',')]);

  return fn(basis(tx, person, mandantIds));
}

/**
 * Der Kunden-Scope (KDN, K-18) — das Kundenportal.
 *
 * Er liest ueber `kunde_zugang`, und diese Tabelle entsteht mit dem
 * CRM-Modul in Phase 4. `app.sichtbare_mandanten()` gibt hier heute `'{}'`
 * zurueck — fail closed und im Funktionsrumpf ausdruecklich so vermerkt.
 *
 * **Deshalb wirft dieser Kontext, statt eine leere Menge zu binden.** Ein
 * Kundenportal ueber einer leeren Menge zeigte lauter leere Listen, und die
 * lesen sich wie "dieser Kunde hat keine Auftraege" — nicht wie "dieses
 * Modul gibt es noch nicht". Wer die beiden verwechselt, ruft beim Kunden an.
 */
export async function withKundeScope<T>(
  tx: Transaktion,
  sitzung: Sitzung,
  fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  const kunde: Sitzung = {
    ...sitzung, ansicht: 'kunde', aktiverMandantId: null, portal: 'kunde',
  };
  await bindeSitzung(tx, kunde, true, []);
  const [zeile] = (await tx.unsafe(
    `select app.sichtbare_mandanten() as ids`,
  )) as { ids: readonly string[] | null }[];
  const mandantIds = zeile?.ids ?? [];
  if (mandantIds.length === 0) throw new KeinKundenzugangFehler();

  await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [mandantIds.join(',')]);
  return fn(basis(tx, kunde, mandantIds));
}

export { KeinAktiverMandantFehler, KeinKundenzugangFehler, KeinePersonFehler };
