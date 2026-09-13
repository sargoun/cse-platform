/**
 * PR 62 (Rest) — die zwei Dienste hinter den zwei Bildschirmen, gegen eine
 * echte Datenbank (APR-02, APR-03, APR-07, APR-08, D-472).
 *
 * Die Kettenformel steht in `freigabe-posteingang.test.ts` §4; hier steht,
 * was `oeffneFreigabe` und `entscheideFreigabe` DARUEBER zusichern:
 *
 *  1. Oeffnen vermerkt — anfuegend, nur fuer Wartendes.
 *  2. Ohne Vermerk keine Entscheidung; die Abweisung traegt ihren Grund.
 *  3. Die Entscheidung schreibt den Schnappschuss, und JEDER seiner
 *     jsonb-Bestandteile hasht — kanonisiert, wie gespeichert — auf den
 *     Digest daneben. Das ist die Zusage, an der ein Waechter spaeter
 *     nachrechnen kann.
 *  4. Unsichere Felder sperren die Genehmigung im DIENST, nicht nur am Knopf.
 *  5. Eine Nutzlast, die nicht zur vorgelegten passt, wird abgewiesen.
 *  6. Zwei Entscheidungen ergeben eine Kette, die `pruefeKette` intakt nennt.
 */
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { kanonisiere } from '../../src/server/services/finanz/kanonisch.js';
import { alsKanonischerWert } from '../../src/server/services/freigabe/diff-json.js';
import { oeffneFreigabe } from '../../src/server/services/freigabe/laden.js';
import {
  ANSICHT_VERSION, entscheideFreigabe, FreigabeAbgewiesen, TOR_VERSION,
} from '../../src/server/services/freigabe/entscheiden.js';
import { pruefeKette } from '../../src/server/services/freigabe/kette.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung], abfrage, schreibe: abfrage,
  };
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Freigeberin', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function legeFreigabeAn(
  teil: { nutzlast?: Record<string, unknown>; hashVon?: Record<string, unknown> } = {},
): Promise<{ id: string; nutzlast: Record<string, unknown> }> {
  const nutzlast = teil.nutzlast ?? { aktion: 'rechnung_senden', betrag_cent: 45_600 };
  const hash = sha256(kanonisiere(alsKanonischerWert(teil.hashVon ?? nutzlast)));
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung,
                           risiko, diff, vorschau_payload, payload_hash, betrag_cent, erstellt_von)
     values ($1, 'rechnung_senden', 'offen', 'monatsrechnung_entwurf', 'Monatsrechnung August',
             'Wie im Juli, ausser +12 Nachtstunden', 'mittel', '[]'::jsonb, $2::jsonb, $3,
             45600, $4)
     returning id`,
    // Das OBJEKT, nicht sein JSON-Text: der Treiber kodiert einen Text ein zweites Mal.
    [f.reinigung, nutzlast, hash, benutzer] as never[]);
  return { id: z!.id, nutzlast };
}

async function legeFeldAn(freigabeId: string, unsicher: boolean): Promise<void> {
  await sql.unsafe(
    `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung, wert_nachher,
                                konfidenz, unsicher, grund, quelle_zitat)
     values ($1, $2, '/betrag_cent', 'Betrag', '456,00 €', $3, $4, $5, 'Zeile 3 der Vorlage')`,
    [f.reinigung, freigabeId, unsicher ? '0.800' : '0.990', unsicher,
      unsicher ? 'Konfidenz unter der Schwelle' : null]);
}

async function ansichten(freigabeId: string): Promise<number> {
  const [z] = await sql.unsafe<{ n: string }[]>(
    `select count(*)::text as n from freigabe_ansicht where freigabe_id = $1`, [freigabeId]);
  return Number(z!.n);
}

const oeffne = (id: string) => alsApp(sitzung(), (tx) => oeffneFreigabe(kontextAus(tx), id, 'web'));
const entscheide = (id: string, art: 'genehmigt' | 'abgelehnt', begruendung: string | null = null) =>
  alsApp(sitzung(), (tx) => entscheideFreigabe(kontextAus(tx), {
    freigabeId: id, art, begruendung, ip: '203.0.113.7', userAgent: 'vitest', codeVersion: 'test',
  }));

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`bildschirm-${zufall()}@cse.test`);
});

afterAll(schliessen);

describe('(1) Oeffnen vermerkt — anfuegend, nur fuer Wartendes', () => {
  it('jedes Oeffnen ist eine Zeile, und der Vermerk kommt aus dem Dienst', async () => {
    const fg = await legeFreigabeAn();
    const a = await oeffne(fg.id);
    expect(a?.freigabe.status).toBe('offen');
    expect(a?.routineFaehig).toBe(false);
    expect(await ansichten(fg.id)).toBe(1);
    await oeffne(fg.id);
    expect(await ansichten(fg.id)).toBe(2);
  });

  it('eine entschiedene Freigabe wird gelesen, aber nicht mehr vermerkt', async () => {
    const fg = await legeFreigabeAn();
    await oeffne(fg.id);
    await entscheide(fg.id, 'genehmigt');
    const vorher = await ansichten(fg.id);
    const a = await oeffne(fg.id);
    expect(a?.freigabe.status).toBe('genehmigt');
    expect(a?.schnappschuss?.ketteNr).toBe(1n);
    expect(await ansichten(fg.id)).toBe(vorher);
  });

  it('was nicht sichtbar ist, ist null — kein Fehler, keine Auskunft', async () => {
    expect(await oeffne('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('(2) ohne Vermerk keine Entscheidung', () => {
  it('die Abweisung nennt ihren Grund', async () => {
    const fg = await legeFreigabeAn();
    const fehler = await entscheide(fg.id, 'genehmigt').catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(FreigabeAbgewiesen);
    expect((fehler as FreigabeAbgewiesen).grund).toBe('nicht_geoeffnet');
  });
});

describe('(3) die Entscheidung schreibt den Schnappschuss — jeder Bestandteil hasht auf seinen Digest', () => {
  it('genehmigt: Status, Kettenglied, und die fuenf Digests stimmen ueber die gespeicherten Bytes', async () => {
    const fg = await legeFreigabeAn();
    await legeFeldAn(fg.id, false);
    await oeffne(fg.id);
    const e = await entscheide(fg.id, 'genehmigt', 'Wie besprochen.');
    expect(e.ketteNr).toBe(1n);
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/u);

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from freigabe where id = $1`, [fg.id]);
    expect(z!.status).toBe('genehmigt');

    // host(): text(inet) haengt bei einer Hostadresse das /32 an, inet_out nicht.
    const [s] = await sql.unsafe<Record<string, unknown>[]>(
      `select nutzlast, nutzlast_hash, diff, diff_hash, felder, felder_hash,
              ansicht_modell, ansicht_modell_hash, policy_ergebnis, policy_ergebnis_hash,
              pruefdauer_sek, host(ip_adresse) as ip, user_agent, code_version
         from freigabe_snapshot where id = $1`, [e.snapshotId]);
    const digest = (wert: unknown): string => sha256(kanonisiere(alsKanonischerWert(wert)));
    expect(digest(s!['nutzlast'])).toBe(s!['nutzlast_hash']);
    expect(digest(s!['diff'])).toBe(s!['diff_hash']);
    expect(digest(s!['felder'])).toBe(s!['felder_hash']);
    expect(digest(s!['ansicht_modell'])).toBe(s!['ansicht_modell_hash']);
    expect(digest(s!['policy_ergebnis'])).toBe(s!['policy_ergebnis_hash']);

    expect((s!['ansicht_modell'] as { version: string }).version).toBe(ANSICHT_VERSION);
    expect((s!['policy_ergebnis'] as { version: string }).version).toBe(TOR_VERSION);
    expect((s!['felder'] as unknown[]).length).toBe(1);
    // Der Server hat gemessen — nicht der Aufrufer.
    expect(typeof s!['pruefdauer_sek']).toBe('number');
    expect(s!['ip']).toBe('203.0.113.7');
    expect(s!['code_version']).toBe('test');
  });

  it('abgelehnt ohne Begruendung faellt im Dienst — bevor die Datenbank es tut', async () => {
    const fg = await legeFreigabeAn();
    await oeffne(fg.id);
    const fehler = await entscheide(fg.id, 'abgelehnt', '   ').catch((e: unknown) => e);
    expect((fehler as FreigabeAbgewiesen).grund).toBe('ohne_begruendung');
    expect(await sql.unsafe(`select 1 from freigabe_snapshot where freigabe_id = $1`, [fg.id]))
      .toHaveLength(0);
  });
});

describe('(4) unsichere Felder sperren die Genehmigung im Dienst', () => {
  it('genehmigt wird abgewiesen, abgelehnt geht — mit Grund', async () => {
    const fg = await legeFreigabeAn();
    await legeFeldAn(fg.id, true);
    await oeffne(fg.id);
    const fehler = await entscheide(fg.id, 'genehmigt').catch((e: unknown) => e);
    expect((fehler as FreigabeAbgewiesen).grund).toBe('unsichere_felder');

    const e = await entscheide(fg.id, 'abgelehnt', 'Nachtstunden stimmen nicht mit dem Konto.');
    expect(e.ketteNr).toBe(1n);
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from freigabe where id = $1`, [fg.id]);
    expect(z!.status).toBe('abgelehnt');
  });
});

describe('(5) die eingereichte Nutzlast ist die vorgelegte', () => {
  it('ein Abdruck, der nicht zur Vorschau passt, wird abgewiesen', async () => {
    const fg = await legeFreigabeAn({
      nutzlast: { aktion: 'rechnung_senden', betrag_cent: 45_600 },
      hashVon: { aktion: 'rechnung_senden', betrag_cent: 99 },
    });
    await oeffne(fg.id);
    const fehler = await entscheide(fg.id, 'genehmigt').catch((e: unknown) => e);
    expect((fehler as FreigabeAbgewiesen).grund).toBe('nutzlast_veraendert');
  });
});

describe('(6) zwei Entscheidungen ergeben eine intakte Kette', () => {
  it('pruefeKette findet keinen Bruch — mit dem Genesis als leerem Vorgaenger', async () => {
    const a = await legeFreigabeAn();
    const b = await legeFreigabeAn();
    await oeffne(a.id);
    await oeffne(b.id);
    await entscheide(a.id, 'genehmigt');
    await entscheide(b.id, 'abgelehnt', 'Nicht in dieser Form.');

    const glieder = await sql.unsafe<Record<string, string | null>[]>(
      `select nutzlast_hash, artefakt_hash, diff_hash, felder_hash, ansicht_modell_hash,
              policy_ergebnis_hash, art::text as art, entschieden_von::text as entschieden_von,
              to_char(entschieden_am at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                as entschieden_am,
              kette_nr::text as kette_nr, vorheriger_hash, hash
         from freigabe_snapshot where mandant_id = $1 order by kette_nr`, [f.reinigung]);
    expect(glieder).toHaveLength(2);
    const befund = pruefeKette(glieder.map((g) => ({
      nutzlastHash: g['nutzlast_hash']!,
      artefaktHash: g['artefakt_hash'] ?? '',
      diffHash: g['diff_hash']!,
      felderHash: g['felder_hash']!,
      ansichtModellHash: g['ansicht_modell_hash']!,
      policyErgebnisHash: g['policy_ergebnis_hash']!,
      art: g['art'] as 'genehmigt' | 'abgelehnt',
      entschiedenVon: g['entschieden_von']!,
      entschiedenAm: new Date(g['entschieden_am']!),
      ketteNr: BigInt(g['kette_nr']!),
      // Der Genesis (64 Nullen) ist in der Formel die leere Zeichenkette.
      vorherHash: /^0{64}$/u.test(g['vorheriger_hash'] ?? '') ? '' : g['vorheriger_hash']!,
      hash: g['hash']!,
    })));
    expect(befund).toEqual({ intakt: true, bruchBei: null, grund: null });
  });
});
