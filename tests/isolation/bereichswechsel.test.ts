/**
 * **Der Bereichswechsel: Bereiche, Gewerke und Live-Zaehler** (TEN-06,
 * TEN-10, DESIGN §6, V-165, D-659, 0417; V-166, D-660, 0418).
 *
 * Gemessen am ECHTEN Seed, weil die Zusage eine ueber den Bestand ist: der
 * Zaehler im Umschalter ist dieselbe Zahl, die eine direkte Zaehlung ergibt —
 * und er erscheint nur, wo der Betrachter das Leserecht haelt, in einer
 * internen Sitzung ist und im Bereich selbst intern arbeitet (§5, §6). Eine
 * Null fuer einen Bereich ohne Recht waere eine Aussage ueber dessen Bestand;
 * die Funktion liefert dann gar keine Zeile.
 */
import type postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { eigeneDatenbank } from './eigene-datenbank.js';
import type { Sitzung } from './harness.js';
import { umschalterStand, zaehltFuer, type StandFragen, type UmschalterStand }
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

/**
 * Der Stand, wie ihn ein Aufrufer liest. Vorgabe hier: alles fragen — so
 * misst die Datei, was die DATENBANK hergibt; welche Sitzung die Zaehler
 * ueberhaupt fragt, prueft §5 und `tests/kern/bereichswechsel.test.ts`.
 */
async function stand(
  s: Sitzung, fragen: StandFragen = { gruppe: true, zaehler: true },
): Promise<UmschalterStand> {
  return alsApp(s, (tx) => umschalterStand({
    abfrage: async <T,>(q: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(q, w as never[])) as unknown as readonly T[],
  }, fragen));
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
  /* Seit 0418 liest die Zaehlung auch `rolle` und `benutzer` — das Portal je Bereich. */
  const BREIT = [
    ['auftrag', 'd_auftrag_lesen'],
    ['projekt', 'd_projekt_kennzahlen'],
    ['mandant', 'd_feed_mandant'],
    ['benutzer_mandant', 'd_bm_lesen'],
    ['benutzer_mandant', 'd_feed_mitgliedschaft'],
    ['rolle', 'd_feed_rolle'],
    ['rolle', 'd_rolle_freigabe'],
    ['benutzer', 'd_feed_benutzer'],
    ['benutzer', 'd_benutzer_anmeldung'],
  ] as const;
  const EIGEN = [
    ['auftrag', 'd_umschalter_auftrag'],
    ['projekt', 'd_umschalter_projekt'],
    ['mandant', 'd_umschalter_mandant'],
    ['benutzer_mandant', 'd_umschalter_mitgliedschaft'],
    ['rolle', 'd_umschalter_rolle'],
    ['benutzer', 'd_umschalter_benutzer'],
  ] as const;

  interface Bild { readonly kennzahlen: string; readonly bereiche: string }

  class Rueckrollen extends Error {
    constructor(readonly bild: Bild) { super('zurueckgerollt'); }
  }

  /**
   * Liest beide Funktionen als die Plattformverwaltung — ohne die genannten
   * Policies und nach den Anweisungen in `vorher`, alles in einer
   * zurueckgerollten Transaktion.
   */
  async function ohne(
    policies: readonly (readonly [string, string])[], vorher: readonly string[] = [],
  ): Promise<Bild> {
    try {
      await sql.begin(async (tx: postgres.TransactionSql) => {
        for (const anweisung of vorher) await tx.unsafe(anweisung);
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
      ['benutzer', 'd_umschalter_benutzer', 'SELECT', 'cse_definer'],
      ['benutzer_mandant', 'd_umschalter_mitgliedschaft', 'SELECT', 'cse_definer'],
      ['mandant', 'd_umschalter_mandant', 'SELECT', 'cse_definer'],
      ['projekt', 'd_umschalter_projekt', 'SELECT', 'cse_definer'],
      ['rolle', 'd_umschalter_rolle', 'SELECT', 'cse_definer'],
    ]);
    /* Einmal je Anweisung gefragt (InitPlan), nicht je Zeile — 01-KERN §1.3. */
    for (const z of zeilen) expect(z.bedingung, z.name).toMatch(/\(\s*SELECT app\./u);
    /*
     * Und sie fragen NUR Funktionen, keine Tabelle. Die erste Fassung von
     * d_umschalter_rolle fragte benutzer_mandant — und schloss damit einen
     * Kreis mit d_bm_verwaltungsrolle und d_bm_kundenrolle, deren with check
     * rolle fragt: jedes Anlegen einer Mitgliedschaft als cse_definer brach
     * mit „infinite recursion detected in policy" ab (§7).
     */
    for (const z of zeilen) expect(z.bedingung, z.name).not.toMatch(/\bFROM\b/iu);
  });

  /*
   * **Kreisfrei nur, solange switcher_mandanten an der RLS vorbei liest**
   * (V-237, D-731).
   *
   * Vier dieser Policies fragen app.switcher_mandanten(), und die Funktion
   * liest mandant und benutzer_mandant — ueber app.ist_super_admin auch
   * benutzer und rolle. Heute gehoeren beide postgres (D-300: Superuser mit
   * BYPASSRLS), lesen also an jeder Policy vorbei, und der Kreis schliesst
   * sich nie. Zoege switcher_mandanten zu cse_definer um — das Ziel von
   * D-300 —, laese sie mandant unter d_umschalter_mandant, und die fragt
   * wieder sie. Solange d_feed_mandant (using true, 0161) daneben steht,
   * faltet der Planer das „oder" weg; faellt auch sie, bricht jede Zaehlung
   * mit „stack depth limit exceeded" ab — die Gegenprobe unten zeigt es.
   *
   * Festgenagelt und nicht umgebaut: eine Policy, die den Kreis ohne die
   * Funktion ausdrueckte, waere eine zweite Fassung der Bereichsregel neben
   * switcher_mandanten (Mitgliedschaft, Fenster, Archiv, globale Rolle), und
   * zwei Fassungen derselben Regel laufen auseinander. Wer die Funktion
   * umzieht, sieht hier rot und muss vorher die Policies umbauen.
   */
  it('die Umschalter-Policies fragen switcher_mandanten — und die Funktion liest an der RLS vorbei', async () => {
    const fragen = await sql<{ policy: string }[]>`
      select c.relname || '.' || p.polname as policy
        from pg_policy p
        join pg_class c on c.oid = p.polrelid
        join pg_roles r on r.oid = any (p.polroles)
       where r.rolname = 'cse_definer'
         and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
                ~ 'switcher_mandanten|ist_super_admin'
              or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
                ~ 'switcher_mandanten|ist_super_admin')
       order by 1`;
    expect(fragen.map((z) => z.policy), 'eine neue Policy fuer cse_definer, die die Funktion '
      + 'fragt, gehoert in diese Liste — und unter dieselbe Bedingung').toEqual([
      'auftrag.d_umschalter_auftrag', 'mandant.d_umschalter_mandant',
      'projekt.d_umschalter_projekt', 'rolle.d_umschalter_rolle',
    ]);

    const eigentuemer = await sql<{ name: string; rolle: string; vorbei: boolean }[]>`
      select p.proname as name, r.rolname as rolle, (r.rolsuper or r.rolbypassrls) as vorbei
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_roles r on r.oid = p.proowner
       where n.nspname = 'app' and p.proname in ('switcher_mandanten', 'ist_super_admin')
       order by 1`;
    expect(eigentuemer.map((e) => [e.name, e.vorbei]),
      'switcher_mandanten und ist_super_admin muessen an der RLS vorbei lesen, solange '
      + 'd_umschalter_* sie fragen — unter cse_definer laesen die Policies sich selbst')
      .toEqual([['ist_super_admin', true], ['switcher_mandanten', true]]);
  });

  it('Gegenprobe: unter cse_definer und ohne die breiten Policies laese sie sich selbst', async () => {
    await expect(ohne(BREIT, [
      `alter function app.switcher_mandanten() owner to cse_definer`,
      `grant execute on function app.ist_super_admin() to cse_definer`,
    ])).rejects.toThrow(/stack depth limit exceeded|infinite recursion/u);
    /* Zurueckgerollt: der Eigentuemer ist wieder der alte. */
    const [e] = await sql<{ rolle: string }[]>`
      select pg_get_userbyid(proowner) as rolle from pg_proc
       where oid = 'app.switcher_mandanten()'::regprocedure`;
    expect(e!.rolle).not.toBe('cse_definer');
  });
});

/**
 * **Ein Kundenkonto zaehlt nicht** (V-166, D-660, 0418).
 *
 * Die Rolle `kunde` haelt `auftrag.lesen` und `bau.lesen` plattformweit
 * (0008). Auf die eigenen Zeilen beschraenkt sie allein die RLS
 * (`p_kunde_decke`, `p_portal_decke`), und die Definer-Zaehlung sieht diese
 * Decke nicht. Bis 0418 stand deshalb auf der Bereichswahl eines Kunden mit
 * zwei Gesellschaften der Bestand jeder Gesellschaft ueber ALLE Kunden.
 *
 * Gemessen wird beides: die Seite fragt fuer diese Sitzung keine Zaehler
 * (`zaehltFuer`), und die Datenbank gibt ihr auch dann keine, wenn ein
 * Aufrufer es doch versucht.
 */
describe('(5) ein Kundenkonto in zwei Gesellschaften sieht keine Zaehler', () => {
  const email = 'kunde-zwei@test.invalid';

  beforeAll(async () => {
    const [u] = await sql<{ id: string }[]>`
      insert into auth.users (email) values (${email}) returning id`;
    await sql`
      insert into benutzer (id, email, name, status)
      values (${u!.id}, ${email}, 'Kunde in zwei Gesellschaften', 'aktiv')`;
    /* Wie 0249 es fuer ein bestehendes Kundenkonto tut: je Gesellschaft eine Mitgliedschaft
       mit der Rolle kunde und ein Kundenzugang. In der Reinigung ein Kunde OHNE Auftrag. */
    for (const slug of ['reinigung', 'bau'] as const) {
      await sql`
        insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
        values (${u!.id}, ${ids.get(slug)!},
                (select id from rolle where schluessel = 'kunde' and mandant_id is null),
                ${slug === 'reinigung'})`;
      const [k] = await sql<{ id: string }[]>`
        select k.id from kunde k
         where k.mandant_id = ${ids.get(slug)!} and k.archiviert_am is null
           and (${slug} = 'bau' or not exists (
                 select 1 from auftrag a where a.kunde_id = k.id and a.mandant_id = k.mandant_id))
         order by k.id limit 1`;
      expect(k, `Seed-Kunde in ${slug} fehlt`).toBeDefined();
      await sql`
        insert into kunde_zugang (mandant_id, kunde_id, benutzer_id)
        values (${ids.get(slug)!}, ${k!.id}, ${u!.id})`;
    }
    konten.set(email, u!.id);
  });

  const kunde = (): Sitzung => sitzung(email, { portal: 'kunde', aal: 'aal1' });
  /* Die Kundensicht selbst (Scope `kunde`, ohne aktiven Mandanten): dort ist app.portal() fest `kunde`. */
  const kundensicht = (): Sitzung => ({
    scope: 'kunde', mandantIds: [ids.get('reinigung')!, ids.get('bau')!],
    benutzerId: konten.get(email)!, portal: 'kunde', readonly: false, aal: 'aal1',
  });

  it('die Seite fragt fuer das Kundenportal keine Zaehler (zaehltFuer)', () => {
    expect(zaehltFuer({ portal: 'kunde', ansicht: 'mandant' })).toBe(false);
    expect(zaehltFuer({ portal: 'kunde', ansicht: 'kunde' })).toBe(false);
  });

  it('der Stand der Bereichswahl: zwei Bereiche, keine Zahl, kein Gruppeneintrag', async () => {
    const u = await stand(kunde(), { gruppe: true, zaehler: false });
    expect(u.bereiche.map((b) => b.slug).sort()).toEqual(['bau', 'reinigung']);
    expect(u.bereiche.every((b) => b.zaehler === null)).toBe(true);
    expect(u.gruppe, 'ein Kundenkonto betritt die Gruppenansicht nie').toBe(false);
  });

  it('die zweite Linie: fragt ein Aufrufer trotzdem, liefert die Datenbank nichts (0418)', async () => {
    expect(await kennzahlen(kunde())).toEqual([]);
    expect(await kennzahlen(kundensicht())).toEqual([]);
    const u = await stand(kunde(), { gruppe: true, zaehler: true });
    expect(u.bereiche.every((b) => b.zaehler === null)).toBe(true);
  });

  /**
   * **Die Gegenprobe: die Zahl WAERE eine Auskunft gewesen.** Die RLS zeigt
   * diesem Konto in der Reinigung null laufende Auftraege; die Gesellschaft
   * hat mehr. Genau diese Differenz stand bis 0418 auf seinem Bildschirm.
   */
  it('Gegenprobe: was der Kunde sehen darf, ist weniger als der Bestand', async () => {
    const eigene = await alsApp(kunde(), async (tx) => (await tx.unsafe(
      `select count(*)::int as n from auftrag where status = 'aktiv' and archiviert_am is null`,
    )) as unknown as { n: number }[]);
    expect(eigene[0]!.n).toBe(0);
    expect(await direkt('reinigung', 'auftraege_aktiv')).toBeGreaterThan(0);
  });
});

/**
 * **Das Portal zaehlt je Bereich, nicht je Sitzung** (0418, D-660).
 *
 * Wer in einer Gesellschaft intern arbeitet und in einer anderen nicht, steht
 * mit einer internen Sitzung im Portal — der Umschalter fragt also Zaehler.
 * Fuer den zweiten Bereich zeigt ihm die RLS nach dem Wechsel nur seine
 * eigenen Vorgaenge; die Zahl dort waere dieselbe Auskunft wie in §5. Die
 * Anwendungswege verhindern das Mischen von kunde und intern (0249, 0372);
 * die Datenbank verlaesst sich nicht darauf. Die Mischung aus intern und
 * mitarbeiter ist dagegen der Normalfall eines Menschen mit zwei
 * Anstellungen (D-09).
 */
describe('(6) ein Bereich ohne interne Rolle bekommt keinen Zaehler', () => {
  const email = 'gemischt@test.invalid';

  beforeAll(async () => {
    const [u] = await sql<{ id: string }[]>`
      insert into auth.users (email) values (${email}) returning id`;
    await sql`insert into auth.mfa_factors (user_id) values (${u!.id})`;
    await sql`
      insert into benutzer (id, email, name, status)
      values (${u!.id}, ${email}, 'Gemischtes Konto', 'aktiv')`;
    for (const [slug, rolle] of [['reinigung', 'admin'], ['bau', 'kunde']] as const) {
      await sql`
        insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
        values (${u!.id}, ${ids.get(slug)!},
                (select id from rolle where schluessel = ${rolle} and mandant_id is null))`;
    }
    konten.set(email, u!.id);
  });

  it('intern in der Reinigung, Kunde bei REALTIME: nur die Reinigung zaehlt', async () => {
    const s = sitzung(email);
    const zeilen = await kennzahlen(s);
    expect(zeilen.map((z) => `${z.slug}:${z.schluessel}`)).toEqual(['reinigung:auftraege_aktiv']);
    /* Das Leserecht allein haette gereicht: der Kunde haelt bau.lesen bei REALTIME. */
    const recht = await alsApp(s, async (tx) => (await tx.unsafe(
      `select app.hat_recht('bau.lesen', $1::uuid) as ok`, [ids.get('bau')!],
    )) as unknown as { ok: boolean }[]);
    expect(recht[0]!.ok).toBe(true);

    const u2 = await stand(s);
    expect(u2.bereiche.find((b) => b.slug === 'bau')!.zaehler).toBeNull();
    expect(u2.bereiche.find((b) => b.slug === 'reinigung')!.zaehler?.schluessel)
      .toBe('auftraege_aktiv');
  });

  /**
   * **Dieselbe Anmeldung als Kundensitzung: gar keine Zahl.** Steht dieses
   * Konto in REALTIME, ist seine Sitzung eine Kundensitzung
   * (`app.sitzung_aufloesen`, 0138). Die Reinigung waere nach dem Wechsel
   * wieder intern — gezaehlt wird trotzdem nicht: Zaehler gehoeren den
   * internen Leisten (D-659 Nr. 4), und die Datenbank sagt das selbst.
   */
  it('dieselbe Anmeldung als Kundensitzung: gar keine Zahl, auch nicht fuer die Reinigung', async () => {
    const s = sitzung(email, {
      mandantId: ids.get('bau')!, mandantIds: [ids.get('bau')!], portal: 'kunde',
    });
    expect(await kennzahlen(s)).toEqual([]);
    const u = await stand(s, { gruppe: true, zaehler: true });
    expect(u.bereiche.every((b) => b.zaehler === null)).toBe(true);
  });

  /**
   * **Das Portal im Bereich ist das des Wechsels — ohne Gueltigkeitsfenster.**
   *
   * `app.sitzung_aufloesen` (0138) nimmt die Rolle der NICHT ENTZOGENEN
   * Mitgliedschaft, gleich ob ihr Fenster laeuft. Eine abgelaufene
   * Kundenmitgliedschaft neben einer globalen internen Rolle macht die
   * Sitzung nach dem Wechsel zu einer Kundensitzung, und die RLS zeigt dann
   * nur die eigenen Vorgaenge. Haette die Zaehlung das Fenster beachtet,
   * waere sie ueber die globale Rolle intern gewesen und haette den ganzen
   * Bestand gezaehlt — genau die Auskunft aus §5.
   */
  it('eine abgelaufene Kundenmitgliedschaft neben der globalen Rolle: dort keine Zahl', async () => {
    const adresse = 'global-mit-kunde@test.invalid';
    const [u] = await sql<{ id: string }[]>`
      insert into auth.users (email) values (${adresse}) returning id`;
    await sql`insert into auth.mfa_factors (user_id) values (${u!.id})`;
    await sql`
      insert into benutzer (id, email, name, status, globale_rolle_id)
      values (${u!.id}, ${adresse}, 'Global mit Kundenzeile', 'aktiv',
              (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`;
    await sql`
      insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab, gueltig_bis)
      values (${u!.id}, ${ids.get('bau')!},
              (select id from rolle where schluessel = 'kunde' and mandant_id is null),
              '2020-01-01', '2020-12-31')`;
    konten.set(adresse, u!.id);

    const s = sitzung(adresse);
    const zeilen = await kennzahlen(s);
    expect([...new Set(zeilen.map((z) => z.slug))].sort())
      .toEqual(['operations', 'reinigung', 'security']);
    /* Der Umschalter bietet REALTIME an, und das Leserecht haelt die globale Rolle. */
    expect((await stand(s)).bereiche.map((b) => b.slug)).toContain('bau');
    const recht = await alsApp(s, async (tx) => (await tx.unsafe(
      `select app.hat_recht('bau.lesen', $1::uuid) as ok`, [ids.get('bau')!],
    )) as unknown as { ok: boolean }[]);
    expect(recht[0]!.ok).toBe(true);

    /* Die Probe auf den Wechsel selbst: dieselbe Anmeldung in REALTIME ist eine Kundensitzung. */
    const hash = `${'a'.repeat(63)}1`;
    await sql`
      insert into benutzer_sitzung (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal,
                                    ablauf_am)
      values (${u!.id}, ${hash}, ${ids.get('bau')!}, 'mandant', 'aal2', now() + interval '1 hour')`;
    const [aufgeloest] = await sql<{ portal: string }[]>`
      select portal from app.sitzung_aufloesen(${hash})`;
    expect(aufgeloest!.portal).toBe('kunde');
  });

  /**
   * Eine Mitarbeiterrolle, der eine Gesellschaft `auftrag.lesen` gibt
   * (Zuschnitt je Gesellschaft, AUT-03): das Recht bejaht `app.hat_recht`,
   * das Portal im Bereich bleibt `mitarbeiter`. Gezaehlt wird dort nicht,
   * auch aus einer internen Sitzung heraus. In einer zurueckgerollten
   * Transaktion, damit Zuschnitt und Mitgliedschaft keine andere Pruefung
   * dieser Datei beruehren.
   */
  it('eine Mitarbeiterrolle im Bereich zaehlt auch mit Leserecht nicht', async () => {
    class Zurueck extends Error {
      constructor(readonly ergebnis: { recht: boolean; zeilen: string }) { super('zurueck'); }
    }
    let ergebnis: { recht: boolean; zeilen: string } | null = null;
    try {
      await sql.begin(async (tx: postgres.TransactionSql) => {
        await tx.unsafe(
          `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
           values ((select id from rolle where schluessel = 'mitarbeiter' and mandant_id is null),
                   (select id from berechtigung where schluessel = 'auftrag.lesen'),
                   $1::uuid, true)`, [ids.get('security')!]);
        await tx.unsafe(
          `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
           values ($1::uuid, $2::uuid,
                   (select id from rolle where schluessel = 'mitarbeiter' and mandant_id is null))`,
          [konten.get(email)!, ids.get('security')!]);
        await tx.unsafe(`set local role cse_app`);
        for (const [schluessel, wert] of [
          ['app.scope', 'mandant'], ['app.mandant_id', ids.get('reinigung')!],
          ['app.mandant_ids', ids.get('reinigung')!], ['app.person_id', ''],
          ['app.benutzer_id', konten.get(email)!],
          ['app.readonly', 'on'], ['app.portal', 'intern'], ['app.akteur_typ', 'mensch'],
          ['app.aal', 'aal2'],
        ] as const) {
          await tx.unsafe(`select set_config($1, $2, true)`, [schluessel, wert]);
        }
        const [r] = (await tx.unsafe(`select app.hat_recht('auftrag.lesen', $1::uuid) as ok`,
          [ids.get('security')!])) as unknown as { ok: boolean }[];
        const [z] = (await tx.unsafe(
          `select coalesce(string_agg(m.slug || ':' || k.schluessel, ',' order by m.slug), '') as t
             from app.mandant_kennzahlen() k
             join lateral (select slug from app.umschalter_bereiche() u
                            where u.id = k.mandant_id) m on true`,
        )) as unknown as { t: string }[];
        throw new Zurueck({ recht: r!.ok, zeilen: z!.t });
      });
    } catch (fehler) {
      if (!(fehler instanceof Zurueck)) throw fehler;
      ergebnis = fehler.ergebnis;
    }
    expect(ergebnis).toEqual({ recht: true, zeilen: 'reinigung:auftraege_aktiv' });
  });
});

/**
 * **Die Rollenpolicy schliesst keinen Kreis** (V-166, 0418).
 *
 * `d_bm_kundenrolle` (0249) und `d_bm_verwaltungsrolle` (0372) pruefen beim
 * Anlegen einer Mitgliedschaft als `cse_definer` die Rolle — ihr `with check`
 * fragt `rolle`. Fragte eine `cse_definer`-Policy auf `rolle` ihrerseits
 * `benutzer_mandant`, bricht Postgres jedes solche Anlegen mit „infinite
 * recursion detected in policy" ab: Einladung und Kundenzugang standen dann
 * still. Die erste Fassung von `d_umschalter_rolle` tat genau das. Gemessen
 * am Weg des Kundenzugangs, in einer zurueckgerollten Transaktion.
 */
describe('(7) eine Mitgliedschaft laesst sich als cse_definer weiter anlegen', () => {
  it('Kundenrolle ueber d_bm_kundenrolle: kein Kreis, die Zeile entsteht', async () => {
    class Zurueck extends Error {
      constructor(readonly angelegt: number) { super('zurueck'); }
    }
    let angelegt = -1;
    try {
      await sql.begin(async (tx: postgres.TransactionSql) => {
        const [u] = (await tx.unsafe(
          `insert into auth.users (email) values ('kreis@test.invalid') returning id`,
        )) as unknown as { id: string }[];
        await tx.unsafe(
          `insert into benutzer (id, email, name, status)
           values ($1, 'kreis@test.invalid', 'Kreisprobe', 'aktiv')`, [u!.id]);
        await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [ids.get('reinigung')!]);
        await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
        await tx.unsafe(`set local role cse_definer`);
        const zeilen = (await tx.unsafe(
          `insert into benutzer_mandant (id, benutzer_id, mandant_id, rolle_id)
           values (gen_random_uuid(), $1, $2,
                   (select id from rolle where schluessel = 'kunde' and mandant_id is null))
           returning id`, [u!.id, ids.get('reinigung')!])) as unknown as { id: string }[];
        throw new Zurueck(zeilen.length);
      });
    } catch (fehler) {
      if (!(fehler instanceof Zurueck)) throw fehler;
      angelegt = fehler.angelegt;
    }
    expect(angelegt).toBe(1);
  });
});
