/**
 * **Der Bereichswechsel: Bereiche, Gewerke und Live-Zaehler** (TEN-06,
 * TEN-10, DESIGN §6, V-165, D-659, 0417).
 *
 * Gemessen am ECHTEN Seed, weil die Zusage eine ueber den Bestand ist: der
 * Zaehler im Umschalter ist dieselbe Zahl, die eine direkte Zaehlung ergibt —
 * und er erscheint nur, wo der Betrachter das Leserecht haelt. Eine Null fuer
 * einen Bereich ohne Recht waere eine Aussage ueber dessen Bestand; die
 * Funktion liefert dann gar keine Zeile.
 */
import type postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { eigeneDatenbank } from './eigene-datenbank.js';
import type { Sitzung } from './harness.js';
import { umschalterStand, type UmschalterStand }
  from '../../src/server/services/mandant/umschalter.js';

const { alsApp, sql, baueAuf } = eigeneDatenbank('cse_bereichswechsel');

const ids = new Map<string, string>();
const konten = new Map<string, string>();

interface Kennzahl { readonly slug: string; readonly schluessel: string; readonly wert: number }

function sitzung(email: string, optionen: Partial<Sitzung> = {}): Sitzung {
  const benutzerId = konten.get(email);
  if (benutzerId === undefined) throw new Error(`Seed-Konto fehlt: ${email}`);
  return {
    scope: 'mandant', mandantId: ids.get('reinigung')!, mandantIds: [ids.get('reinigung')!],
    benutzerId, portal: 'intern', readonly: false, aal: 'aal2', ...optionen,
  };
}

async function kennzahlen(s: Sitzung): Promise<readonly Kennzahl[]> {
  return alsApp(s, async (tx) => (await tx.unsafe(
    `select m.slug, k.schluessel, k.wert
       from app.mandant_kennzahlen() k
       join lateral (select slug from app.umschalter_bereiche() u where u.id = k.mandant_id) m
         on true
      order by m.slug, k.schluessel`)) as unknown as Kennzahl[]);
}

async function stand(s: Sitzung): Promise<UmschalterStand> {
  return alsApp(s, (tx) => umschalterStand({
    abfrage: async <T,>(q: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(q, w as never[])) as unknown as readonly T[],
  }));
}

async function direkt(slug: string, schluessel: string): Promise<number> {
  const mandant = ids.get(slug)!;
  const [z] = schluessel === 'auftraege_aktiv'
    ? await sql<{ n: number }[]>`
        select count(*)::int as n from auftrag
         where mandant_id = ${mandant} and status = 'aktiv' and archiviert_am is null`
    : await sql<{ n: number }[]>`
        select count(*)::int as n from projekt
         where mandant_id = ${mandant} and status in ('geplant', 'in_arbeit')
           and archiviert_am is null`;
  return z!.n;
}

beforeAll(async () => {
  baueAuf();
  for (const m of await sql<{ id: string; slug: string }[]>`select id, slug from mandant`) {
    ids.set(m.slug, m.id);
  }
  for (const b of await sql<{ id: string; email: string }[]>`
    select id, email from benutzer where email is not null`) {
    konten.set(b.email, b.id);
  }
}, 240_000);

describe('(1) die Zaehler sind dieselbe Zahl wie eine direkte Zaehlung', () => {
  it('die Plattformverwaltung sieht alle vier Bereiche — Auftraege ueberall, Projekte nur im Bau', async () => {
    const zeilen = await kennzahlen(sitzung('admin@cse-gruppe.de'));
    const slugs = [...new Set(zeilen.map((z) => z.slug))].sort();
    expect(slugs).toEqual(['bau', 'operations', 'reinigung', 'security']);
    expect(zeilen.filter((z) => z.schluessel === 'projekte_laufend').map((z) => z.slug))
      .toEqual(['bau']);
    for (const z of zeilen) {
      expect(z.wert, `${z.slug} ${z.schluessel}`).toBe(await direkt(z.slug, z.schluessel));
    }
    /* Die Probe haette sonst nur Nullen verglichen. */
    expect(zeilen.some((z) => z.wert > 0), 'der Seed traegt Auftraege').toBe(true);
  });

  it('nur Anzahlen: der Rueckgabetyp traegt kein Geld', async () => {
    const [f] = await sql<{ typ: string }[]>`
      select pg_get_function_result('app.mandant_kennzahlen()'::regprocedure) as typ`;
    expect(f!.typ).toBe('TABLE(mandant_id uuid, schluessel text, wert integer)');
  });
});

describe('(2) nur mit dem Leserecht des Betrachters — sonst KEINE Zeile', () => {
  it('eine Leitung mit einem Bereich sieht nur ihn', async () => {
    const s = sitzung('leitung.bau@cse-gruppe.de', {
      mandantId: ids.get('bau')!, mandantIds: [ids.get('bau')!],
    });
    const zeilen = await kennzahlen(s);
    expect(new Set(zeilen.map((z) => z.slug))).toEqual(new Set(['bau']));
    const u = await stand(s);
    expect(u.bereiche.map((b) => b.slug)).toEqual(['bau']);
    expect(u.gruppe, 'ein Bereich, keine Gruppenansicht').toBe(false);
  });

  it('eine Modulliste ohne auftrag nimmt den Zaehler dieses Bereichs weg (0416)', async () => {
    /* Ein Konto in zwei Gesellschaften: in der Reinigung nur crm, in der Security alles. */
    const [u] = await sql<{ id: string }[]>`
      insert into auth.users (email) values ('umschalter-zwei@test.invalid') returning id`;
    await sql`insert into auth.mfa_factors (user_id) values (${u!.id})`;
    await sql`
      insert into benutzer (id, email, name, status)
      values (${u!.id}, 'umschalter-zwei@test.invalid', 'Zwei Bereiche', 'aktiv')`;
    for (const [slug, module] of [['reinigung', ['crm']], ['security', null]] as const) {
      await sql`
        insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
        values (${u!.id}, ${ids.get(slug)!},
                (select id from rolle where schluessel = 'admin' and mandant_id is null),
                ${module === null ? null : [...module]}::text[])`;
    }
    konten.set('umschalter-zwei@test.invalid', u!.id);

    const s = sitzung('umschalter-zwei@test.invalid');
    const zeilen = await kennzahlen(s);
    expect(zeilen.map((z) => z.slug)).not.toContain('reinigung');
    expect(zeilen.map((z) => `${z.slug}:${z.schluessel}`)).toContain('security:auftraege_aktiv');

    const umschalter = await stand(s);
    expect(umschalter.bereiche.map((b) => b.slug).sort()).toEqual(['reinigung', 'security']);
    const reinigung = umschalter.bereiche.find((b) => b.slug === 'reinigung')!;
    expect(reinigung.zaehler, 'kein Recht, keine Zahl — auch keine Null').toBeNull();
    expect(umschalter.bereiche.find((b) => b.slug === 'security')!.zaehler?.schluessel)
      .toBe('auftraege_aktiv');
  });

  it('ohne zweiten Faktor gewaehrt die Rolle nichts — auch keinen Zaehler (0395)', async () => {
    const zeilen = await kennzahlen(sitzung('umschalter-zwei@test.invalid', { aal: 'aal1' }));
    expect(zeilen).toEqual([]);
  });

  it('eine Mitarbeiterin in zwei Gesellschaften: zwei Bereiche, keine Zaehler, keine Gruppe', async () => {
    const s = sitzung('fatima.yildiz@cse-gruppe.de', { portal: 'mitarbeiter' });
    const u = await stand(s);
    expect(u.bereiche.map((b) => b.slug).sort()).toEqual(['reinigung', 'security']);
    expect(u.bereiche.every((b) => b.zaehler === null)).toBe(true);
    expect(u.gruppe).toBe(false);
  });

  it('in der Gruppenansicht: dieselben Zaehler — sie sind Lesen (Invariante 10)', async () => {
    const zeilen = await kennzahlen({
      scope: 'gruppe', mandantIds: [...ids.values()],
      benutzerId: konten.get('admin@cse-gruppe.de')!, portal: 'intern', readonly: true,
      aal: 'aal2',
    });
    expect(new Set(zeilen.map((z) => z.slug)).size).toBe(4);
  });

  it('ohne gebundenes Konto: nichts', async () => {
    const zeilen = await alsApp({ scope: 'mandant', mandantId: ids.get('reinigung')!,
      mandantIds: [ids.get('reinigung')!], portal: 'intern', readonly: false },
    async (tx) => tx.unsafe(`select * from app.mandant_kennzahlen()`));
    expect(zeilen.length).toBe(0);
  });
});

describe('(3) der Stand des Umschalters: Gewerke und die Wahl des Zaehlers', () => {
  it('Bau zeigt Projekte, Reinigung Auftraege, Operations (kein Gewerk) keinen', async () => {
    const u = await stand(sitzung('admin@cse-gruppe.de'));
    const je = new Map(u.bereiche.map((b) => [b.slug, b]));
    expect(je.get('reinigung')!.gewerke).toEqual(['reinigung']);
    expect(je.get('reinigung')!.zaehler?.schluessel).toBe('auftraege_aktiv');
    expect(je.get('bau')!.gewerke).toEqual(['bau']);
    expect(je.get('bau')!.zaehler).toEqual(
      { schluessel: 'projekte_laufend', wert: await direkt('bau', 'projekte_laufend') });
    expect(je.get('operations')!.gewerke).toEqual([]);
    expect(je.get('operations')!.zaehler).toBeNull();
    expect(u.gruppe, 'die Plattformverwaltung darf die Gruppenansicht').toBe(true);
  });

  it('eine nie gepflegte Buchung heisst: Gewerk unbekannt (NULL), nicht leer (O-355)', async () => {
    await sql`update mandant set module_gepflegt = false where slug = 'security'`;
    try {
      const u = await stand(sitzung('admin@cse-gruppe.de'));
      const security = u.bereiche.find((b) => b.slug === 'security')!;
      expect(security.gewerke).toBeNull();
      expect(security.zaehler?.schluessel).toBe('auftraege_aktiv');
    } finally {
      await sql`update mandant set module_gepflegt = true where slug = 'security'`;
    }
  });

  it('der Zugang ist beschraenkt: nur die Anwendung ruft die Funktionen', async () => {
    const zeilen = await sql<{ f: string; oeffentlich: boolean; app: boolean; eigner: string }[]>`
      select p.proname as f,
             has_function_privilege('public', p.oid, 'execute') as oeffentlich,
             has_function_privilege('cse_app', p.oid, 'execute') as app,
             pg_get_userbyid(p.proowner) as eigner
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('mandant_kennzahlen', 'umschalter_bereiche')
       order by 1`;
    expect(zeilen).toEqual([
      { f: 'mandant_kennzahlen', oeffentlich: false, app: true, eigner: 'cse_definer' },
      { f: 'umschalter_bereiche', oeffentlich: false, app: true, eigner: 'cse_definer' },
    ]);
  });
});

/**
 * **Die eigenen Policies der Funktionen tragen allein** (0417, K-01).
 *
 * `cse_definer` liest `mandant`, `benutzer_mandant`, `auftrag` und `projekt`
 * heute auch ueber breite Policies anderer Migrationen (`using (true)`). Die
 * Migration behauptet, ihre eigenen `d_umschalter_*` hielten auch dann, wenn
 * jene einmal enger werden. Geprueft wird das in einer Transaktion, die die
 * breiten Policies fallen laesst und zurueckgerollt wird — und mit der
 * Gegenprobe, dass ohne die eigenen tatsaechlich etwas fehlt.
 */
describe('(4) die eigenen Policies tragen die Funktionen allein', () => {
  const BREIT = [
    ['auftrag', 'd_auftrag_lesen'],
    ['projekt', 'd_projekt_kennzahlen'],
    ['mandant', 'd_feed_mandant'],
    ['benutzer_mandant', 'd_bm_lesen'],
    ['benutzer_mandant', 'd_feed_mitgliedschaft'],
  ] as const;
  const EIGEN = [
    ['auftrag', 'd_umschalter_auftrag'],
    ['projekt', 'd_umschalter_projekt'],
    ['mandant', 'd_umschalter_mandant'],
    ['benutzer_mandant', 'd_umschalter_mitgliedschaft'],
  ] as const;

  interface Bild { readonly kennzahlen: string; readonly bereiche: string }

  class Rueckrollen extends Error {
    constructor(readonly bild: Bild) { super('zurueckgerollt'); }
  }

  /** Liest beide Funktionen als die Plattformverwaltung — ohne die genannten Policies. */
  async function ohne(policies: readonly (readonly [string, string])[]): Promise<Bild> {
    try {
      await sql.begin(async (tx: postgres.TransactionSql) => {
        for (const [tabelle, name] of policies) await tx.unsafe(`drop policy ${name} on ${tabelle}`);
        await tx.unsafe(`set local role cse_app`);
        for (const [schluessel, wert] of [
          ['app.scope', 'mandant'], ['app.mandant_id', ids.get('reinigung')!],
          ['app.mandant_ids', ids.get('reinigung')!], ['app.person_id', ''],
          ['app.benutzer_id', konten.get('admin@cse-gruppe.de')!], ['app.readonly', 'off'],
          ['app.portal', 'intern'], ['app.akteur_typ', 'mensch'], ['app.aal', 'aal2'],
        ] as const) {
          await tx.unsafe(`select set_config($1, $2, true)`, [schluessel, wert]);
        }
        const [k] = (await tx.unsafe(
          `select coalesce(string_agg(mandant_id || ':' || schluessel || '=' || wert, ' '
                    order by mandant_id, schluessel), '') as t
             from app.mandant_kennzahlen()`)) as unknown as { t: string }[];
        const [b] = (await tx.unsafe(
          `select coalesce(string_agg(slug || ':' || coalesce(array_to_string(gewerke, ','), '?'),
                    ' ' order by slug), '') as t
             from app.umschalter_bereiche()`)) as unknown as { t: string }[];
        throw new Rueckrollen({ kennzahlen: k!.t, bereiche: b!.t });
      });
    } catch (fehler) {
      if (fehler instanceof Rueckrollen) return fehler.bild;
      throw fehler;
    }
    throw new Error('Die Transaktion haette zurueckgerollt werden muessen.');
  }

  it('ohne die breiten Policies: dieselben Bereiche, dieselben Zaehler', async () => {
    const mit = await ohne([]);
    expect(mit.bereiche.split(' ').length, 'vier Bereiche').toBe(4);
    expect(mit.kennzahlen).toMatch(/auftraege_aktiv=[1-9]/u);
    expect(await ohne(BREIT)).toEqual(mit);
  });

  it('Gegenprobe: ohne die eigenen fehlt etwas — sie sind es, die tragen', async () => {
    const mit = await ohne([]);
    const ganzOhne = await ohne([...BREIT, ...EIGEN]);
    expect(ganzOhne.bereiche).not.toBe(mit.bereiche);
    expect(ganzOhne.kennzahlen).not.toBe(mit.kennzahlen);
  });

  it('sie gelten nur fuer cse_definer und nur zum Lesen, in der gehobenen Form', async () => {
    const zeilen = await sql<{ tabelle: string; name: string; befehl: string; rollen: string;
      bedingung: string }[]>`
      select tablename as tabelle, policyname as name, cmd as befehl,
             array_to_string(roles, ',') as rollen, qual as bedingung
        from pg_policies
       where policyname like 'd\_umschalter\_%'
       order by tablename`;
    expect(zeilen.map((z) => [z.tabelle, z.name, z.befehl, z.rollen])).toEqual([
      ['auftrag', 'd_umschalter_auftrag', 'SELECT', 'cse_definer'],
      ['benutzer_mandant', 'd_umschalter_mitgliedschaft', 'SELECT', 'cse_definer'],
      ['mandant', 'd_umschalter_mandant', 'SELECT', 'cse_definer'],
      ['projekt', 'd_umschalter_projekt', 'SELECT', 'cse_definer'],
    ]);
    /* Einmal je Anweisung gefragt (InitPlan), nicht je Zeile — 01-KERN §1.3. */
    for (const z of zeilen) expect(z.bedingung, z.name).toMatch(/\(\s*SELECT app\./u);
  });
});
