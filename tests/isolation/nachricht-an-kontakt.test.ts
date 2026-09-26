import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  NachrichtFehler, schreibeAnKontakt, type NachrichtAnKontakt,
} from '../../src/server/services/crm/nachricht-an-kontakt.js';

/**
 * **Eine Nachricht an einen Kontakt — und bei jedem „nein" entsteht NICHTS**
 * (V-101, CRM-08, Invariante 7, D-627) — gegen echtes Postgres.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum diese Datei vor allem Abwesenheit prüft.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Solange kein Versender verbunden ist (O-36), geht nichts hinaus — das ist
 * leicht. Die teure Frage ist eine andere: bleibt dabei etwas LIEGEN? Eine
 * Freigabe für eine Nachricht, die es nicht gibt, wäre ein Glied in der
 * Kette, das nichts bezeugt. Eine Nachrichtenzeile ohne Versand wäre eine
 * Behauptung in dem Nachweis, den eine UWG-Abmahnung liest. Und ein
 * ausgegebener Widerspruchsschlüssel ohne Zustellung wäre ein Schlüssel, den
 * niemand hat und der trotzdem gilt.
 *
 * Deshalb zählt jede Prüfung hier vorher und nachher drei Tabellen:
 * `freigabe`, `nachricht`, `werbewiderspruch_token`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Und die Reihenfolge.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das UWG-Tor antwortet VOR „nicht verbunden" (§4). Wer ohne Rechtsgrundlage
 * Werbung schreiben will, erfährt das jetzt — und nicht erst an dem Tag, an
 * dem der Anbieter eingerichtet ist und die Werbemail sonst hinausginge.
 */

let f: Fixtur;
let chef = '';
let mitGrundlage = '';
let ohneGrundlage = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

function kontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const lauf = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: lauf, schreibe: lauf,
  };
}

function alsChef<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef, portal: 'intern',
      readonly: false, aal: 'aal2' },
    (tx) => fn(kontext(tx, chef)),
  );
}

/** Die drei Tabellen, in denen bei einem „nein" nichts entstehen darf. */
async function stand(): Promise<{ freigabe: number; nachricht: number; token: number }> {
  const [z] = await sql.unsafe<{ freigabe: number; nachricht: number; token: number }[]>(
    `select (select count(*) from freigabe)::int as freigabe,
            (select count(*) from nachricht)::int as nachricht,
            (select count(*) from werbewiderspruch_token)::int as token`);
  return z!;
}

/** Der Fehlergrund — oder `null`, wenn nichts geworfen wurde. */
async function grund(e: NachrichtAnKontakt): Promise<string | null> {
  try {
    await alsChef((k) => schreibeAnKontakt(k, e));
    return null;
  } catch (x: unknown) {
    if (x instanceof NachrichtFehler) return x.grund;
    throw x;
  }
}

function nachricht(teil: Partial<NachrichtAnKontakt> = {}): NachrichtAnKontakt {
  return {
    ansprechpartnerId: mitGrundlage, kanal: 'email', zweck: 'vertraglich',
    betreff: 'Reinigungsplan Oktober', text: 'Guten Tag, anbei der Plan für Oktober.',
    ...teil,
  };
}

beforeEach(async () => {
  f = await seed();
  const email = `vertrieb-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  chef = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [chef]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Vertrieb','aktiv')`,
    [chef, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [chef, f.reinigung, await rolleId('admin')] as never[]);

  /* Ein Bestandskunde MIT aufgezeichneter Grundlage … */
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Hausverwaltung Mitte', 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [f.reinigung, `K-${zufall()}`] as never[]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, nachname, email,
                                  rechtsgrundlage, rechtsgrundlage_quelle,
                                  rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Bauer', $3, 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [f.reinigung, k!.id, `b-${zufall()}@example.test`] as never[]);
  mitGrundlage = a!.id;

  /* … und ein Kontakt OHNE — ein Name aus einer Messe, sonst nichts. */
  const [k2] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage)
     values ($1, $2, 'Messebekanntschaft GmbH', 'keine') returning id`,
    [f.reinigung, `K-${zufall()}`] as never[]);
  const [a2] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, nachname, email, rechtsgrundlage)
     values ($1, $2, 'Sommer', $3, 'keine') returning id`,
    [f.reinigung, k2!.id, `s-${zufall()}@example.test`] as never[]);
  ohneGrundlage = a2!.id;

  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b
      where b.schluessel = 'crm.kommunikation_versenden'
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [await rolleId('admin'), f.reinigung] as never[]);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('§1 ohne Rechtsgrundlage keine Werbung — und nichts bleibt liegen', () => {
  it('Werbung an einen Kontakt ohne Grundlage wird abgewiesen', async () => {
    const vorher = await stand();
    expect(await grund(nachricht({ ansprechpartnerId: ohneGrundlage, zweck: 'werbung' })))
      .toBe('keine_grundlage');
    expect(await stand()).toEqual(vorher);
  });
});

describe('§2 ohne Versender geht nichts hinaus — und nichts wird geschrieben', () => {
  it('mit Grundlage, aber ohne Anbieter: „nicht verbunden", null neue Zeilen', async () => {
    /*
     * Keine Freigabe (sie bezeugte eine Nachricht, die es nicht gibt), keine
     * Nachricht (sie behauptete einen Versand) — dieselbe Regel wie in
     * `sendeNachAussen`, eine Stufe früher.
     */
    const vorher = await stand();
    expect(await grund(nachricht())).toBe('nicht_verbunden');
    expect(await stand()).toEqual(vorher);
  });

  it('auch bei Werbung MIT Grundlage wird kein Widerspruchsschlüssel verbrannt', async () => {
    const vorher = await stand();
    expect(await grund(nachricht({ zweck: 'werbung' }))).toBe('nicht_verbunden');
    expect((await stand()).token).toBe(vorher.token);
  });
});

describe('§3 was vor jeder Datenbankfrage abgewiesen wird', () => {
  it('ein unbekannter Kontakt ist von einem fremden nicht zu unterscheiden (AUT-06)', async () => {
    expect(await grund(nachricht({
      ansprechpartnerId: '00000000-0000-0000-0000-000000000001' }))).toBe('kein_kontakt');
  });

  it('eine Nachricht ohne Text ist keine', async () => {
    expect(await grund(nachricht({ text: '   ' }))).toBe('kein_text');
  });

  it('ein unbekannter Kanal oder Zweck wird abgewiesen, nicht geraten', async () => {
    expect(await grund(nachricht({ kanal: 'fax' as never }))).toBe('ungueltig');
    expect(await grund(nachricht({ zweck: 'irgendwas' as never }))).toBe('ungueltig');
  });
});

describe('§4 das UWG-Tor antwortet VOR „nicht verbunden"', () => {
  it('ohne Grundlage UND ohne Anbieter lautet die Antwort „keine Grundlage"', async () => {
    /*
     * Die Reihenfolge ist die Auskunft. Wer „nicht verbunden" läse, hielte die
     * Werbemail für ein Konfigurationsproblem — und schickte sie am Tag ab, an
     * dem der Anbieter eingerichtet ist. Die Grundlage fehlt aber unabhängig
     * von jedem Anbieter.
     */
    expect(await grund(nachricht({ ansprechpartnerId: ohneGrundlage, zweck: 'werbung' })))
      .toBe('keine_grundlage');
  });
});
