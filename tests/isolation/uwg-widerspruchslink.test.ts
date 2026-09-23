import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  WiderspruchFehler, neuerToken, tokenHash, vermerkeToken,
} from '../../src/server/services/datenschutz/werbewiderspruch.js';

/**
 * **Der Pflichtlink des § 7 Abs. 3 Nr. 4 UWG entsteht** (V-092, V-115,
 * CRM-08, LEG-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der ganze Widerspruchsweg stand: die öffentliche Seite, die Einlösung, die
 * Drossel, das Protokoll, das UWG-Tor in der Datenbank. **Der Schlüssel dazu
 * entstand nirgends** — `gibTokenAus` hatte im ganzen Baum keinen Aufrufer.
 * Solange kein Versender verbunden ist (O-36), fällt das nicht auf; in der
 * Sekunde, in der einer verbunden wird, ginge eine Werbemail ohne den
 * gesetzlich vorgeschriebenen Hinweis hinaus.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das gegen eine echte Datenbank gehört.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Zusage ist nicht „eine Zeile entsteht", sondern: mit diesem Token
 * gelingt der Widerspruch, und danach sperrt das ECHTE Tor
 * (`app.darf_kontaktiert_werden`) die Werbung an diesen Menschen. Das ist
 * eine Kette über eine Definer-Funktion, zwei Tabellen und ein Spaltenrecht,
 * und sie lässt sich nur hier zeigen. Ein Mock sagte zu jedem Glied ja.
 *
 * Und gespeichert wird der SHA-256, nie der Token (K-08): wer die Tabelle
 * liest, kann keinen fremden Widerspruch einlösen. Auch das ist eine Aussage
 * über echte Spalten.
 */

let f: Fixtur;
let chef = '';
let kundeId = '';
let kontaktId = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle = 'admin'): Promise<string> {
  const email = `uwg-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Vertrieb','aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [u!.id, mandant, await rolleId(rolle)] as never[]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql, mandantId: string, benutzerId: string): SchreibKontext {
  const lauf = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: lauf, schreibe: lauf,
  };
}

async function alsWer<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
  o: { readonly mandantId?: string; readonly readonly?: boolean } = {},
): Promise<T> {
  const mandantId = o.mandantId ?? f.reinigung;
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern',
      readonly: o.readonly ?? false, aal: 'aal2' },
    (tx) => fn(kontext(tx, mandantId, benutzerId)),
  );
}

/**
 * Die Einlösung, wie der öffentliche Weg sie ruft.
 *
 * **Mit gebundenem Mandanten und OHNE Benutzer.** `app.werbewiderspruch_einloesen`
 * ist `security definer` und fragt kein Recht ab — sie sucht den Token aber
 * `where t.mandant_id = app.aktiver_mandant()`. Als Eigentümer ohne Sitzung
 * gerufen findet sie deshalb nichts und antwortet `unbekannt`: genau der
 * Fehlalarm, der eine Prüfung grün aussehen liesse, die nichts geprüft hat.
 */
async function einloesen(klartext: string): Promise<string> {
  const [z] = await alsApp(
    { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
    (tx) => tx.unsafe(
      `select zustand from app.werbewiderspruch_einloesen($1)`,
      [tokenHash(klartext)] as never[]),
  ) as unknown as { zustand: string }[];
  return z!.zustand;
}

beforeEach(async () => {
  f = await seed();
  chef = await konto(f.reinigung);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Hausverwaltung Testfall', 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [f.reinigung, `K-${zufall()}`] as never[]);
  kundeId = k!.id;
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, nachname, email,
                                  rechtsgrundlage, rechtsgrundlage_quelle,
                                  rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Beispiel', $3, 'bestandskunde', 'Rahmenvertrag', now())
     returning id`,
    [f.reinigung, kundeId, `k-${zufall()}@example.test`] as never[]);
  kontaktId = a!.id;
  /*
   * `crm.kommunikation_versenden` ist für `admin` bindbar, nicht gebunden —
   * ohne diese Zeile wiese die Definer-Funktion jede Ausgabe ab, und jede
   * Prüfung unten wäre aus dem falschen Grund grün.
   */
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b
      where b.schluessel = 'crm.kommunikation_versenden'
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [await rolleId('admin'), f.reinigung] as never[]);
});
afterAll(schliessen);

describe('§1 der Token entsteht — und nur sein Hash steht in der Tabelle', () => {
  it('legt eine Zeile an und speichert NICHT den Klartext (K-08)', async () => {
    const marke = neuerToken();
    const id = await alsWer(chef, (k) => vermerkeToken(
      k, { ansprechpartnerId: kontaktId, kanal: 'email' }, marke.hash));
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);

    const [z] = await sql.unsafe<{ token_hash: string; kanal: string }[]>(
      `select token_hash, kanal from werbewiderspruch_token where id = $1`,
      [id] as never[]);
    expect(z!.token_hash).toBe(marke.hash);
    expect(z!.token_hash).not.toBe(marke.klartext);
    expect(z!.kanal).toBe('email');

    /* Und der Klartext steht NIRGENDS in der Zeile. */
    const [roh] = await sql.unsafe<{ text: string }[]>(
      `select to_jsonb(t)::text as text from werbewiderspruch_token t where t.id = $1`,
      [id] as never[]);
    expect(roh!.text).not.toContain(marke.klartext);
  });

  it('weist einen Kanal ab, den dieses Haus nicht kennt', async () => {
    const marke = neuerToken();
    await expect(alsWer(chef, (k) => vermerkeToken(
      k, { ansprechpartnerId: kontaktId, kanal: 'brieftaube' as never }, marke.hash)))
      .rejects.toBeInstanceOf(WiderspruchFehler);
  });
});

describe('§2 die Kette hält bis zum echten Tor', () => {
  it('mit diesem Token gelingt der Widerspruch — und danach sperrt das Tor', async () => {
    /*
     * **Das ist die eigentliche Zusage.** Nicht „eine Zeile entsteht", sondern:
     * der Empfänger kann widersprechen, und danach geht an ihn keine Werbung
     * mehr hinaus. Geprüft am ECHTEN Tor `app.darf_kontaktiert_werden`, nicht
     * an einer zweiten Fassung davon.
     */
    const vorher = await alsWer(chef, (k) => k.abfrage<{ darf: boolean }>(
      `select app.darf_kontaktiert_werden($1::uuid, 'email', 'werbung') as darf`,
      [kontaktId]));
    expect(vorher[0]?.darf, 'ein Bestandskunde ist vorher erreichbar').toBe(true);

    const marke = neuerToken();
    await alsWer(chef, (k) => vermerkeToken(
      k, { ansprechpartnerId: kontaktId, kanal: 'email' }, marke.hash));

    /* Die Einlösung läuft ÖFFENTLICH — ohne Konto, nur mit dem Token. */
    expect(await einloesen(marke.klartext)).toBe('erfasst');

    const nachher = await alsWer(chef, (k) => k.abfrage<{ darf: boolean }>(
      `select app.darf_kontaktiert_werden($1::uuid, 'email', 'werbung') as darf`,
      [kontaktId]));
    expect(nachher[0]?.darf, 'nach dem Widerspruch geht keine Werbung mehr').toBe(false);
  });

  it('und die Firma bleibt erreichbar — der Widerspruch bindet den MENSCHEN', async () => {
    /*
     * `kundeId` wird vom Sendeweg ausdrücklich NICHT gesetzt: einen Klick auf
     * die ganze Firma auszudehnen schaltete Kolleginnen stumm, die nie
     * widersprochen haben. Hier steht, dass das auch wirklich so ausgeht.
     */
    const marke = neuerToken();
    await alsWer(chef, (k) => vermerkeToken(
      k, { ansprechpartnerId: kontaktId, kundeId: null, kanal: 'email' }, marke.hash));
    expect(await einloesen(marke.klartext)).toBe('erfasst');

    const [z] = await sql.unsafe<{ gesperrt: boolean }[]>(
      `select (werbewiderspruch_am is not null) as gesperrt from kunde where id = $1`,
      [kundeId] as never[]);
    expect(z!.gesperrt).toBe(false);
  });

  it('ein zweiter Versuch mit demselben Token verfängt nicht', async () => {
    const marke = neuerToken();
    await alsWer(chef, (k) => vermerkeToken(
      k, { ansprechpartnerId: kontaktId, kanal: 'email' }, marke.hash));
    expect(await einloesen(marke.klartext)).toBe('erfasst');
    /* Verbraucht ist verbraucht (K-09) — ein zweiter Klick ist kein Fehler. */
    expect(await einloesen(marke.klartext)).toBe('verbraucht');
  });
});

describe('§3 die Wände', () => {
  it('ohne `crm.kommunikation_versenden` entsteht kein Token', async () => {
    const ohne = await konto(f.reinigung, 'mitarbeiter');
    const marke = neuerToken();
    await expect(alsWer(ohne, (k) => vermerkeToken(
      k, { ansprechpartnerId: kontaktId, kanal: 'email' }, marke.hash)))
      .rejects.toThrow(/kommunikation_versenden/u);
  });

  it('in der Nur-Lese-Bindung entsteht keiner (Invariante 10)', async () => {
    const marke = neuerToken();
    await expect(alsWer(chef, (k) => vermerkeToken(
      k, { ansprechpartnerId: kontaktId, kanal: 'email' }, marke.hash),
    { readonly: true })).rejects.toThrow(/Gruppenansicht/u);
  });
});
