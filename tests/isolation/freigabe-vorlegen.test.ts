/**
 * **Vorlegen ist nicht Entscheiden** (V-376, O-369, O-513, Invariante 7,
 * D-819) — an echtem Postgres.
 *
 * Bis 0515 verlangte die Schreibpolicy auf `freigabe` für JEDE offene Bitte
 * `freigabe.entscheiden`. Wer nur vorlegen sollte, scheiterte; wer vorlegen
 * konnte, durfte auch entscheiden. Geprüft wird hier:
 *
 *  1. Ein Konto, das NUR Social hält, legt einen Beitrag vor und nimmt die
 *     Bitte zur Überarbeitung zurück — ohne ein einziges Freigaberecht.
 *  2. Das Vorlegerecht ist das Modul des Entscheidungsrechts: mit Social keine
 *     Rechnungsfreigabe (der Köder aus O-513); ohne erforderliches Recht wie
 *     bisher ein Freigaberecht; ein unbekanntes Recht ist ein Fehler.
 *  3. Was die Freigabe selbst setzt, gibt niemand mit; eine offene Bitte
 *     schreibt `cse_app` nicht mehr direkt — eine bereits gefallene
 *     Entscheidung schon.
 *  4. Die Bitte eines Agentenlaufs: `agent.aufgabe_starten` und eine laufende
 *     Aufgabe dieser Gesellschaft; Agent aus der Aufgabe, kein Urheber.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { legeVor, schrittGehen } from '../../src/server/services/social/dienst.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/** Ein Konto dieser Gesellschaft; `module` schränkt die Rolle ein (null = keine Einschränkung). */
async function konto(
  mandant: string, module: readonly string[] | null, rolle = 'admin',
): Promise<string> {
  const email = `vorlegen-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Vorlage', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null),
             $4::text[])`,
    [u!.id, mandant, rolle, module === null ? null : `{${module.join(',')}}`]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql, mandant: string, benutzer: string): SchreibKontext {
  const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

async function als<T>(
  benutzer: string, fn: (k: SchreibKontext) => Promise<T>, mandant = f.reinigung,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, benutzerId: benutzer, portal: 'intern',
      readonly: false },
    (tx) => fn(kontext(tx, mandant, benutzer)));
}

/** `app.freigabe_vorlegen` direkt — wie die Dienste, ohne deren Vorgang. */
async function vorlegen(benutzer: string, angaben: Record<string, unknown>): Promise<string> {
  return als(benutzer, async (k) => {
    const [z] = await k.schreibe<{ id: string }>(
      `select app.freigabe_vorlegen($1::jsonb) as id`, [angaben]);
    return z!.id;
  });
}

const BITTE = {
  aktion: 'social_veroeffentlichen',
  vorgang_typ: 'beitrag_veroeffentlichen',
  titel: 'Probe',
  zusammenfassung: 'Probe',
  risiko: 'mittel',
  vorschau_payload: { titel: 'Probe' },
  payload_hash: 'a'.repeat(64),
  erforderliches_recht: 'social.freigeben',
};

async function freigabe(id: string): Promise<{
  status: string; erstellt_von: string | null; erforderliches_recht: string | null;
  mandant_id: string; agent_id: string | null; agent_aufgabe_id: string | null;
  begruendung: string | null;
}> {
  const [z] = await sql.unsafe<{
    status: string; erstellt_von: string | null; erforderliches_recht: string | null;
    mandant_id: string; agent_id: string | null; agent_aufgabe_id: string | null;
    begruendung: string | null;
  }[]>(
    `select status::text as status, erstellt_von, erforderliches_recht, mandant_id,
            agent_id, agent_aufgabe_id, begruendung
       from freigabe where id = $1::uuid`, [id]);
  return z!;
}

/** Ein Beitrag im Entwurf — mit Mandantenkontext wegen des Riegels aus 0163. */
async function beitragImEntwurf(mandant: string): Promise<string> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true),
                            set_config('app.mandant_id', $1, true)`, [mandant]);
    const [b] = await tx.unsafe<{ id: string }[]>(
      `insert into beitrag (mandant_id, titel, text, status)
       values ($1::uuid, $2, 'Text', 'entwurf'::beitrag_status) returning id`,
      [mandant, `Vorlage ${zufall()}`]);
    return b!.id;
  }) as Promise<string>;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('V-376 (1) — vorlegen ohne Freigaberecht', () => {
  it('ein Konto nur mit Social legt den Beitrag vor und holt ihn zur Überarbeitung zurück', async () => {
    const marketing = await konto(f.reinigung, ['social']);
    const rechte = await als(marketing, async (k) => {
      const [z] = await k.abfrage<{ vorlegen: boolean; entscheiden: boolean; lesen: boolean }>(
        `select app.hat_recht('social.schreiben', app.aktiver_mandant()) as vorlegen,
                app.hat_recht('freigabe.entscheiden', app.aktiver_mandant()) as entscheiden,
                app.hat_recht('freigabe.lesen', app.aktiver_mandant()) as lesen`);
      return z!;
    });
    expect(rechte).toEqual({ vorlegen: true, entscheiden: false, lesen: false });

    const beitrag = await beitragImEntwurf(f.reinigung);
    const id = await als(marketing, (k) => legeVor(k, beitrag));
    expect(await freigabe(id)).toMatchObject({
      status: 'offen', erstellt_von: marketing, erforderliches_recht: 'social.freigeben',
      mandant_id: f.reinigung, agent_id: null,
    });
    const [b] = await sql.unsafe<{ status: string; fid: string | null }[]>(
      `select status::text as status, freigabe_id as fid from beitrag where id = $1`, [beitrag]);
    expect(b).toEqual({ status: 'vorgelegt', fid: id });

    /* Vorher scheiterte das an der Policy, und die Bitte blieb offen liegen. */
    await als(marketing, (k) => schrittGehen(k, beitrag, 'ueberarbeiten'));
    const zurueck = await freigabe(id);
    expect(zurueck.status).toBe('zurueckgezogen');
    expect(zurueck.begruendung).toMatch(/Überarbeitung/u);
  });

  it('eine entschiedene Bitte nimmt niemand zurück — und ohne Vorlegerecht keine', async () => {
    const admin = await konto(f.reinigung, null);
    const id = await vorlegen(admin, BITTE);
    const fremd = await konto(f.reinigung, ['radar']);
    await expect(als(fremd, (k) => k.schreibe(
      `select app.freigabe_zurueckziehen($1::uuid, 'weg')`, [id])))
      .rejects.toThrow(/schreibendes Recht im Modul social/u);
    expect((await freigabe(id)).status).toBe('offen');

    await sql.unsafe(
      `update freigabe set status = 'abgelehnt', freigegeben_von = $2, freigegeben_am = now()
        where id = $1`, [id, admin]);
    const [z] = await als(admin, (k) => k.schreibe<{ ok: boolean }>(
      `select app.freigabe_zurueckziehen($1::uuid, 'weg') as ok`, [id]));
    expect(z!.ok).toBe(false);
    expect((await freigabe(id)).status).toBe('abgelehnt');
  });
});

describe('V-376 (2) — das Vorlegerecht ist das Modul des Entscheidungsrechts (O-513)', () => {
  it('mit Social keine Rechnungsfreigabe — der Köder über Modulgrenzen', async () => {
    const marketing = await konto(f.reinigung, ['social']);
    await expect(vorlegen(marketing, { ...BITTE, erforderliches_recht: 'eingang.freigeben' }))
      .rejects.toThrow(/schreibendes Recht im Modul eingang/u);
  });

  it('ohne erforderliches Recht verlangt Vorlegen ein Freigaberecht — wie bisher', async () => {
    const marketing = await konto(f.reinigung, ['social']);
    const ohne: Record<string, unknown> = { ...BITTE };
    delete ohne['erforderliches_recht'];
    await expect(vorlegen(marketing, ohne)).rejects.toThrow(/schreibendes Recht im Modul freigabe/u);
    const admin = await konto(f.reinigung, null);
    expect((await freigabe(await vorlegen(admin, ohne))).erforderliches_recht).toBeNull();
  });

  it('ein Recht, das der Katalog nicht kennt, ist ein Fehler — kein Stillstand (K-19)', async () => {
    const admin = await konto(f.reinigung, null);
    await expect(vorlegen(admin, { ...BITTE, erforderliches_recht: 'social.gibtsnicht' }))
      .rejects.toThrow(/Rechtekatalog/u);
  });

  it('ein Konto ohne schreibendes Recht im Modul legt nichts vor', async () => {
    const leser = await konto(f.reinigung, ['radar']);
    await expect(vorlegen(leser, BITTE)).rejects.toThrow(/schreibendes Recht im Modul social/u);
  });
});

describe('V-376 (3) — was die Freigabe selbst setzt', () => {
  it('Status, Entscheider und Gesellschaft gibt niemand mit', async () => {
    const admin = await konto(f.reinigung, null);
    for (const fremd of [{ status: 'genehmigt' }, { freigegeben_von: admin },
      { mandant_id: f.security }, { erstellt_von: admin }, { agent_id: admin }]) {
      await expect(vorlegen(admin, { ...BITTE, ...fremd }), JSON.stringify(fremd))
        .rejects.toThrow(/setzt die Freigabe selbst/u);
    }
  });

  it('eine offene Bitte schreibt cse_app nicht direkt — eine gefallene Entscheidung schon', async () => {
    const admin = await konto(f.reinigung, null);
    const direkt = (status: string): Promise<unknown> => als(admin, (k) => k.schreibe(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am)
       values (app.aktiver_mandant(), 'probe', $1::freigabe_status,
               case when $1 = 'offen' then null else $2::uuid end,
               case when $1 = 'offen' then null else now() end)`,
      [status, admin]));
    await expect(direkt('offen')).rejects.toThrow(/row-level security/u);
    await expect(direkt('genehmigt')).resolves.toBeDefined();
  });

  it('die Felder eines Vorschlags kommen mit — und der Zähler führt die Freigabe nach', async () => {
    const admin = await konto(f.reinigung, null);
    const id = await vorlegen(admin, {
      ...BITTE, stapel_faehig: true,
      felder: [
        { feld_pfad: '/a', bezeichnung: 'A', wert_vorher: null, wert_nachher: '1',
          konfidenz: '0.9', unsicher: false, grund: null, quelle_zitat: 'Zeile 1',
          extraktion_modell: 'probe' },
        { feld_pfad: '/b', bezeichnung: 'B', wert_vorher: null, wert_nachher: '2',
          konfidenz: '0.4', unsicher: true, grund: 'unleserlich', quelle_zitat: 'Zeile 2',
          extraktion_modell: 'probe' },
      ],
    });
    const [z] = await sql.unsafe<{ n: number; unsicher: number; stapel: boolean; von: string }[]>(
      `select (select count(*)::int from freigabe_feld where freigabe_id = f.id) as n,
              f.unsichere_felder_anzahl as unsicher, f.stapel_faehig as stapel,
              (select min(erstellt_von::text) from freigabe_feld where freigabe_id = f.id) as von
         from freigabe f where f.id = $1`, [id]);
    expect(z).toEqual({ n: 2, unsicher: 1, stapel: false, von: admin });
  });
});

describe('V-376 (4) — die Bitte eines Agentenlaufs', () => {
  async function aufgabe(status: string): Promise<{ id: string; agent: string }> {
    const [a] = await sql.unsafe<{ id: string }[]>(`select id from agent where kennung = 'akquise'`);
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into agent_aufgabe (mandant_id, agent_id, titel, vorgang_typ, status,
                                  erstellt_von_art, erstellt_von_agent_id, beendet_am)
       values ($1, $2, 'Probe', 'interner_hinweis', $3::agent_aufgabe_status, 'agent', $2,
               case when $3 in ('wartend', 'laufend') then null else now() end)
       returning id`, [f.reinigung, a!.id, status]);
    return { id: z!.id, agent: a!.id };
  }
  const AGENT = {
    aktion: 'interner_hinweis', vorgang_typ: 'interner_hinweis', titel: 'Probe',
    zusammenfassung: 'Probe', risiko: 'hoch', vorschau_payload: {}, payload_hash: 'b'.repeat(64),
  };

  it('wer Agentenaufgaben starten darf, legt vor — Agent aus der Aufgabe, kein Urheber', async () => {
    const starter = await konto(f.reinigung, ['agent']);
    const a = await aufgabe('laufend');
    const id = await vorlegen(starter, { ...AGENT, agent_aufgabe_id: a.id });
    expect(await freigabe(id)).toMatchObject({
      status: 'offen', erstellt_von: null, agent_id: a.agent, agent_aufgabe_id: a.id,
    });
  });

  it('ohne laufende Aufgabe dieser Gesellschaft nicht — und ohne das Recht nicht', async () => {
    const starter = await konto(f.reinigung, ['agent']);
    const fertig = await aufgabe('abgeschlossen');
    await expect(vorlegen(starter, { ...AGENT, agent_aufgabe_id: fertig.id }))
      .rejects.toThrow(/keine Agentenaufgabe/u);
    const laufend = await aufgabe('laufend');
    const marketing = await konto(f.reinigung, ['social']);
    await expect(vorlegen(marketing, { ...AGENT, agent_aufgabe_id: laufend.id }))
      .rejects.toThrow(/Agentenaufgaben starten/u);
    const security = await konto(f.security, null);
    await expect(als(security, (k) => k.schreibe(
      `select app.freigabe_vorlegen($1::jsonb)`, [{ ...AGENT, agent_aufgabe_id: laufend.id }]),
    f.security)).rejects.toThrow(/keine Agentenaufgabe/u);
  });
});
