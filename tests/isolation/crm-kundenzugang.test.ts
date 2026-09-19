/**
 * Der Kundenzugang — ausstellen, neu einladen, entziehen, gegen echte Rechte
 * und echte Policies (AUT-01, AUT-04, K-04, Invariante 8, 0249).
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Ausstellen legt VIER Zeilen an, die nur zusammen einen Sinn haben:
 *     Konto, Mitgliedschaft mit der Rolle `kunde`, Bindung, Einladungstoken.
 *  2. Danach sieht `app.aktuelle_kunden()` für dieses Konto genau diesen
 *     einen Kunden — die K-04-Decke steht.
 *  3. **Ohne zweiten Faktor wird nicht ausgestellt**, obwohl das Manifest der
 *     Route `aal2: false` führt: `benutzer_mandant` trägt `p_bm_aal2`, und
 *     die Funktion prüft es selbst statt sie als Definer zu umgehen.
 *  4. Ohne `system.benutzer_verwalten` wird nichts ausgestellt.
 *  5. Ein INTERNES Konto wird nie zum Kundenkonto (K-04).
 *  6. Zwei Zugänge für dasselbe Konto in derselben Gesellschaft gibt es
 *     nicht; der zweite Versuch ist eine Auskunft, kein Fehler.
 *  7. Ein fremder Kunde ist nicht erreichbar (Invariante 3).
 *  8. Entziehen ist ein DATUM: die Zeile bleibt, die Mitgliedschaft fällt,
 *     offene Einladungen verfallen, laufende Sitzungen enden.
 *  9. Ein Entzug ohne Grund wird abgewiesen.
 * 10. Ein neuer Einladungslink entwertet den alten.
 * 11. Der Klartext des Tokens steht nirgends in der Datenbank — nur sein
 *     SHA-256.
 * 12. Die Gruppenansicht stellt nichts aus (Invariante 10).
 * 13. Die Definer-Funktionen gehören `cse_definer`, nicht der
 *     Migrationsrolle (K-01) — sonst liefen sie an jeder RLS vorbei.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let chef = '';
let chefEmail = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const token = (): string => randomBytes(32).toString('hex');
const hash = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht]);
}

async function konto(rolle: string | null, mandantId: string): Promise<{
  id: string; email: string;
}> {
  const email = `kz-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  if (rolle !== null) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, $3, false)`, [u!.id, mandantId, await rolleId(rolle)]);
  }
  return { id: u!.id, email };
}

async function kunde(mandantId: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Hausverwaltung Testfall') returning id`,
    [mandantId, `K-${zufall()}`]);
  return z!.id;
}

async function alsIntern<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  opts: { readonly aal?: string; readonly portal?: 'intern' | 'kunde';
    readonly readonly?: boolean; readonly benutzerId?: string } = {},
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId, benutzerId: opts.benutzerId ?? chef,
      portal: opts.portal ?? 'intern', readonly: opts.readonly ?? false,
    },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal',$1,true)`, [opts.aal ?? 'aal2']);
      return fn(tx);
    },
  );
}

interface Ergebnis {
  ok: boolean; grund: string; konto_id: string | null; zugang_id: string | null;
  neues_konto: boolean;
}

async function ausstellen(
  mandantId: string, kundeId: string, email: string, name = 'Bernd Beispiel',
  t = token(), opts: Parameters<typeof alsIntern>[2] = {},
): Promise<Ergebnis> {
  const zeilen = await alsIntern(mandantId, async (tx) =>
    tx.unsafe<Ergebnis[]>(
      `select ok, grund, konto_id, zugang_id, neues_konto
         from app.kundenzugang_ausstellen($1::uuid, $2, $3, $4)`,
      [kundeId, email, name, hash(t)]), opts);
  return zeilen[0]!;
}

beforeEach(async () => {
  f = await seed();
  const k = await konto('admin', f.reinigung);
  chef = k.id;
  chefEmail = k.email;
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, $3, false)`, [chef, f.bau, await rolleId('admin')]);
});

afterAll(async () => { await schliessen(); });

describe('ausstellen · vier Zeilen, die nur zusammen einen Sinn haben', () => {
  it('Konto, Mitgliedschaft mit Rolle `kunde`, Bindung und Einladungstoken', async () => {
    const kd = await kunde(f.reinigung);
    const t = token();
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`,
      'Bernd Beispiel', t);

    expect(e.ok).toBe(true);
    expect(e.neues_konto).toBe(true);
    expect(e.konto_id).not.toBeNull();

    const [b] = await sql.unsafe<{ status: string; person_id: string | null }[]>(
      `select status::text, person_id from benutzer where id = $1`, [e.konto_id]);
    expect(b!.status).toBe('eingeladen');
    // Ein Kundenkonto hängt an KEINER Person: `person` ist die Personalakte.
    expect(b!.person_id).toBeNull();

    const [bm] = await sql.unsafe<{ schluessel: string; aus_anstellung: boolean }[]>(
      `select r.schluessel, bm.aus_anstellung
         from benutzer_mandant bm join rolle r on r.id = bm.rolle_id
        where bm.benutzer_id = $1 and bm.mandant_id = $2`, [e.konto_id, f.reinigung]);
    expect(bm!.schluessel).toBe('kunde');
    expect(bm!.aus_anstellung).toBe(false);

    const [kz] = await sql.unsafe<{ kunde_id: string; entzogen_am: Date | null }[]>(
      `select kunde_id, entzogen_am from kunde_zugang where id = $1`, [e.zugang_id]);
    expect(kz!.kunde_id).toBe(kd);
    expect(kz!.entzogen_am).toBeNull();

    const [tok] = await sql.unsafe<{ zweck: string; token_hash: string }[]>(
      `select zweck, token_hash from kern.kennwort_token where benutzer_id = $1`,
      [e.konto_id]);
    expect(tok!.zweck).toBe('einladung');
    expect(tok!.token_hash).toBe(hash(t));
  });

  it('der KLARTEXT des Tokens steht nirgends in der Datenbank', async () => {
    const kd = await kunde(f.reinigung);
    const t = token();
    await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`, 'B', t);
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from kern.kennwort_token where token_hash = $1`, [t]);
    expect(z!.n).toBe('0');
  });

  it('danach sieht das Konto genau diesen einen Kunden (K-04-Decke)', async () => {
    const kd = await kunde(f.reinigung);
    const fremd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);

    const sichtbar = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: e.konto_id!, portal: 'kunde' },
      async (tx) => tx.unsafe<{ kunden: string[] }[]>(
        `select app.aktuelle_kunden() as kunden`));
    expect(sichtbar[0]!.kunden).toEqual([kd]);
    expect(sichtbar[0]!.kunden).not.toContain(fremd);
  });

  it('der Vorgang steht im Prüfprotokoll', async () => {
    const kd = await kunde(f.reinigung);
    await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'kunde.zugang_ausgestellt'`);
    expect(z!.n).toBe('1');
  });

  it('ein BESTEHENDES Kundenkonto wird gebunden, nicht neu angelegt', async () => {
    const kd1 = await kunde(f.reinigung);
    const kd2 = await kunde(f.bau);
    const email = `portal-${zufall()}@hv.test`;

    const erste = await ausstellen(f.reinigung, kd1, email);
    expect(erste.neues_konto).toBe(true);

    /* Dasselbe Konto, andere Gesellschaft: `kunde_zugang_uk` greift je Bereich. */
    const zweite = await ausstellen(f.bau, kd2, email);
    expect(zweite.ok).toBe(true);
    expect(zweite.neues_konto).toBe(false);
    expect(zweite.konto_id).toBe(erste.konto_id);
  });
});

describe('ausstellen · was NICHT geht, und warum', () => {
  it('ohne zweiten Faktor nicht — auch wenn das Manifest aal2:false führt', async () => {
    const kd = await kunde(f.reinigung);
    await expect(ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`,
      'B', token(), { aal: 'aal1' }))
      .rejects.toThrow(/zweitem Faktor/u);
  });

  it('ohne `system.benutzer_verwalten` nicht', async () => {
    await entziehe('admin', 'system.benutzer_verwalten', f.reinigung);
    const kd = await kunde(f.reinigung);
    await expect(ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`))
      .rejects.toThrow(/system\.benutzer_verwalten fehlt/u);
  });

  it('im Kundenportal nicht (K-04)', async () => {
    const kd = await kunde(f.reinigung);
    await expect(ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`,
      'B', token(), { portal: 'kunde' }))
      .rejects.toThrow(/internen Portal/u);
  });

  it('in der Gruppenansicht nicht (Invariante 10)', async () => {
    const kd = await kunde(f.reinigung);
    await expect(ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`,
      'B', token(), { readonly: true }))
      .rejects.toThrow(/Gruppenansicht/u);
  });

  it('ein INTERNES Konto wird nie zum Kundenkonto', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, chefEmail, 'Die Sachbearbeitung');
    expect(e.ok).toBe(false);
    expect(e.grund).toContain('internen Konto');
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from kunde_zugang`);
    expect(z!.n).toBe('0');
  });

  it('zweimal derselbe Zugang ist eine Auskunft, kein Fehler', async () => {
    const kd = await kunde(f.reinigung);
    const email = `portal-${zufall()}@hv.test`;
    expect((await ausstellen(f.reinigung, kd, email)).ok).toBe(true);
    const zweite = await ausstellen(f.reinigung, kd, email);
    expect(zweite.ok).toBe(false);
    expect(zweite.grund).toContain('schon einen Zugang');
  });

  it('ein FREMDER Kunde ist nicht erreichbar (Invariante 3)', async () => {
    const fremd = await kunde(f.bau);
    const e = await ausstellen(f.reinigung, fremd, `portal-${zufall()}@hv.test`);
    expect(e.ok).toBe(false);
    expect(e.grund).toContain('nicht');
  });

  it('eine unbrauchbare E-Mail-Adresse wird benannt abgewiesen', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, 'kein-at-zeichen');
    expect(e.ok).toBe(false);
    expect(e.grund).toContain('E-Mail');
  });

  it('ohne Namen nicht — er steht in jedem Protokolleintrag', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`, '   ');
    expect(e.ok).toBe(false);
    expect(e.grund).toContain('Namen');
  });

  it('ein Token, der kein SHA-256 ist, wird abgewiesen', async () => {
    const kd = await kunde(f.reinigung);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `select ok from app.kundenzugang_ausstellen($1::uuid, $2, 'B', 'zu-kurz')`,
        [kd, `portal-${zufall()}@hv.test`])))
      .rejects.toThrow(/SHA-256/u);
  });
});

describe('neu einladen · der alte Link verfällt', () => {
  it('es entsteht ein zweites Token, und das erste ist eingelöst', async () => {
    const kd = await kunde(f.reinigung);
    const alt = token();
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`, 'B', alt);

    const neu = token();
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ ok: boolean }[]>(
        `select ok from app.kundenzugang_neu_einladen($1::uuid, $2)`,
        [e.zugang_id, hash(neu)]));
    expect(zeilen[0]!.ok).toBe(true);

    const tokens = await sql.unsafe<{ token_hash: string; offen: boolean }[]>(
      `select token_hash, eingeloest_am is null as offen
         from kern.kennwort_token where benutzer_id = $1 order by erstellt_am`,
      [e.konto_id]);
    expect(tokens).toHaveLength(2);
    expect(tokens.find((t) => t.token_hash === hash(alt))?.offen).toBe(false);
    expect(tokens.find((t) => t.token_hash === hash(neu))?.offen).toBe(true);
  });

  it('ein entzogener Zugang wird nicht neu eingeladen', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select ok from app.kundenzugang_entziehen($1::uuid, 'Vertrag beendet')`,
        [e.zugang_id]));
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ ok: boolean; grund: string }[]>(
        `select ok, grund from app.kundenzugang_neu_einladen($1::uuid, $2)`,
        [e.zugang_id, hash(token())]));
    expect(zeilen[0]!.ok).toBe(false);
  });
});

describe('entziehen · ein Datum, keine Löschung (Invariante 8)', () => {
  it('die Zeile bleibt, mit Datum und Urheber', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select ok from app.kundenzugang_entziehen($1::uuid, 'Vertrag beendet')`,
        [e.zugang_id]));

    const [kz] = await sql.unsafe<{
      entzogen_am: Date | null; entzogen_von: string | null;
    }[]>(`select entzogen_am, entzogen_von from kunde_zugang where id = $1`,
      [e.zugang_id]);
    expect(kz!.entzogen_am).not.toBeNull();
    expect(kz!.entzogen_von).toBe(chef);
  });

  it('die Mitgliedschaft fällt mit — mit dem Grund', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select ok from app.kundenzugang_entziehen($1::uuid, 'Vertrag beendet')`,
        [e.zugang_id]));
    const [bm] = await sql.unsafe<{
      entzogen_am: Date | null; entzugsgrund: string | null;
    }[]>(`select entzogen_am, entzugsgrund from benutzer_mandant
            where benutzer_id = $1 and mandant_id = $2`, [e.konto_id, f.reinigung]);
    expect(bm!.entzogen_am).not.toBeNull();
    expect(bm!.entzugsgrund).toBe('Vertrag beendet');
  });

  it('danach sieht das Konto keinen Kunden mehr', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select ok from app.kundenzugang_entziehen($1::uuid, 'Vertrag beendet')`,
        [e.zugang_id]));
    const sichtbar = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: e.konto_id!, portal: 'kunde' },
      async (tx) => tx.unsafe<{ kunden: string[] }[]>(
        `select app.aktuelle_kunden() as kunden`));
    expect(sichtbar[0]!.kunden).toEqual([]);
  });

  it('offene Einladungen verfallen — ein Link nach dem Entzug ist ein offenes Fenster', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select ok from app.kundenzugang_entziehen($1::uuid, 'Vertrag beendet')`,
        [e.zugang_id]));
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from kern.kennwort_token
        where benutzer_id = $1 and eingeloest_am is null`, [e.konto_id]);
    expect(z!.n).toBe('0');
  });

  it('laufende Sitzungen enden — ein Entzug, der morgen wirkt, ist kein Entzug', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    await sql.unsafe(
      `insert into benutzer_sitzung
         (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal, ablauf_am)
       values ($1, $2, $3, 'mandant', 'aal1', now() + interval '8 hours')`,
      [e.konto_id, hash(token()), f.reinigung]);

    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ sitzungen: number }[]>(
        `select sitzungen from app.kundenzugang_entziehen($1::uuid, 'Vertrag beendet')`,
        [e.zugang_id]));
    expect(Number(zeilen[0]!.sitzungen)).toBe(1);

    const [bs] = await sql.unsafe<{ beendet_am: Date | null; ende_grund: string }[]>(
      `select beendet_am, ende_grund::text from benutzer_sitzung
        where benutzer_id = $1`, [e.konto_id]);
    expect(bs!.beendet_am).not.toBeNull();
    expect(bs!.ende_grund).toBe('gesperrt');
  });

  it('ohne Grund wird nicht entzogen', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ ok: boolean; grund: string }[]>(
        `select ok, grund from app.kundenzugang_entziehen($1::uuid, '   ')`,
        [e.zugang_id]));
    expect(zeilen[0]!.ok).toBe(false);
    expect(zeilen[0]!.grund).toContain('Grund');
  });

  it('ein FREMDER Zugang ist nicht entziehbar (Invariante 3)', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    const zeilen = await alsIntern(f.bau, async (tx) =>
      tx.unsafe<{ ok: boolean }[]>(
        `select ok from app.kundenzugang_entziehen($1::uuid, 'fremd')`, [e.zugang_id]));
    expect(zeilen[0]!.ok).toBe(false);
  });

  it('eine harte Löschung bleibt gesperrt', async () => {
    const kd = await kunde(f.reinigung);
    const e = await ausstellen(f.reinigung, kd, `portal-${zufall()}@hv.test`);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`delete from kunde_zugang where id = $1`, [e.zugang_id])))
      .rejects.toThrow();
  });
});

describe('app.kundenzugang_liste · die Zugänge eines Kunden', () => {
  it('sie nennt Konto, Zustand und offene Einladung', async () => {
    const kd = await kunde(f.reinigung);
    const email = `portal-${zufall()}@hv.test`;
    await ausstellen(f.reinigung, kd, email, 'Bernd Beispiel');
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{
        email: string; name: string; konto_status: string; einladung_offen: boolean;
        entzogen_am: Date | null;
      }[]>(`select email, name, konto_status, einladung_offen, entzogen_am
              from app.kundenzugang_liste($1::uuid)`, [kd]));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.email).toBe(email);
    expect(zeilen[0]!.name).toBe('Bernd Beispiel');
    expect(zeilen[0]!.konto_status).toBe('eingeladen');
    expect(zeilen[0]!.einladung_offen).toBe(true);
    expect(zeilen[0]!.entzogen_am).toBeNull();
  });

  it('sie prüft das Recht der SEITE, nicht `system.benutzer_lesen`', async () => {
    /*
     * Der Grund, warum es diesen Definer gibt: `benutzer` steht hinter
     * `t_benutzer_lesen`. Wem `system.benutzer_lesen` einzeln entzogen ist,
     * sähe ohne diese Funktion eine Liste aus Bindestrichen — und die sieht
     * aus wie „kein Konto hinterlegt".
     */
    await entziehe('admin', 'system.benutzer_lesen', f.reinigung);
    const kd = await kunde(f.reinigung);
    const email = `portal-${zufall()}@hv.test`;
    await ausstellen(f.reinigung, kd, email);
    const zeilen = await alsIntern(f.reinigung, async (tx) =>
      tx.unsafe<{ email: string }[]>(
        `select email from app.kundenzugang_liste($1::uuid)`, [kd]));
    expect(zeilen[0]!.email).toBe(email);
  });

  it('ohne `system.benutzer_verwalten` wirft sie', async () => {
    await entziehe('admin', 'system.benutzer_verwalten', f.reinigung);
    const kd = await kunde(f.reinigung);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select * from app.kundenzugang_liste($1::uuid)`, [kd])))
      .rejects.toThrow(/system\.benutzer_verwalten fehlt/u);
  });
});

describe('K-01 · die neuen Definer gehören `cse_definer`', () => {
  it('alle vier — sonst laufen sie als Superuser an jeder RLS vorbei', async () => {
    const zeilen = await sql.unsafe<{ name: string; eigentuemer: string }[]>(
      `select p.proname as name, pg_get_userbyid(p.proowner) as eigentuemer
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.proname in ('kundenzugang_ausstellen', 'kundenzugang_neu_einladen',
                            'kundenzugang_entziehen', 'kundenzugang_liste')`);
    expect(zeilen).toHaveLength(4);
    for (const z of zeilen) expect(z.eigentuemer, z.name).toBe('cse_definer');
  });

  it('die drei aus 0247/0248 ebenso', async () => {
    const zeilen = await sql.unsafe<{ name: string; eigentuemer: string }[]>(
      `select p.proname as name, pg_get_userbyid(p.proowner) as eigentuemer
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.proname in ('kontakt_rechtsgrundlage_liste',
                            'kontakt_rechtsgrundlage_blatt',
                            'werbewiderspruch_manuell_setzen')`);
    expect(zeilen).toHaveLength(3);
    for (const z of zeilen) expect(z.eigentuemer, z.name).toBe('cse_definer');
  });

  it('`cse_app` legt selbst KEIN Konto an — nur die Funktion tut es', async () => {
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(
        `insert into benutzer (id, email, name, status)
         values (gen_random_uuid(), 'direkt@hv.test', 'Direkt', 'eingeladen')`)))
      .rejects.toThrow();
  });
});
