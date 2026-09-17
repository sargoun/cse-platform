/**
 * Die Hashkette ueber das Pruefprotokoll und der Buendel-Lesepfad
 * (§6.12, §9.1, SEC-A9, DOC-08, LEG-01, 0204).
 *
 * **Eine Hashkette ohne Gegenprobe ist eine Behauptung.** Sie faellt nur auf,
 * wenn jemand nachrechnet — also prueft dieser Test genau das: ketten, dann
 * eine Protokollzeile veraendern (was nur der Eigentuemer kann, und auch nur,
 * weil er Superuser ist), dann nachrechnen und die BRUCHSTELLE erwarten. Ohne
 * diesen Fall wuesste niemand, ob die Kette ueberhaupt etwas bezeugt.
 *
 * **Zwei Rechte, und sie sind nicht dasselbe.**
 * `system.audit_exportieren` erlaubt das Buendel;
 * `system.audit_sensitiv_lesen` erlaubt die WERTE darin (05-API-KARTE
 * Z. 369/591, 03-AUTH-BERECHTIGUNGEN Z. 2342). `cse_app` haelt auf
 * `audit_log.vorher`/`nachher` ueberhaupt keinen Spaltengrant — die Werte
 * kommen nur ueber die Definer-Funktion, und die prueft selbst.
 *
 * **Plattformzeilen gehoeren nie in ein Mandantenbuendel** (K-16(d)): Login,
 * Zwei-Faktor, Sperre, Mandantenanlage. Sie zu exportieren gaebe die
 * Aktivitaet anderer Gesellschaften mit heraus.
 *
 * Die Rechte werden hier MANDANTENSPEZIFISCH gebunden
 * (`rolle_berechtigung.mandant_id`) — das ist der dokumentierte Weg fuer ein
 * `bindbar`-Recht (`katalog.generiert.ts`: `system.audit_exportieren` ist an
 * `super_admin` gebunden und an `admin` bindbar) und macht den Test
 * unabhaengig davon, was die Plattformvorgabe gerade sagt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Ein `bindbar`-Recht in genau EINEM Bereich gewaehren (AUT-05). */
async function binde(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $3, true from berechtigung b where b.schluessel = $2
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [await rolleId(rolle), recht, mandant] as never[]);
}

async function konto(mandant: string): Promise<string> {
  const email = `kette-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId('admin')] as never[]);
  return u!.id;
}

/** Eine Protokollzeile in diesem Bereich — ueber den einzigen Schreibweg. */
async function protokolliere(mandant: string, aktion: string): Promise<void> {
  await sql.unsafe(
    `select app.protokolliere($1, 'probe', $2, null, $3::jsonb, $4::uuid)`,
    [aktion, zufall(), JSON.stringify({ wert: zufall() }), mandant] as never[]);
}

/** Die Partition, in der `now()` liegt — dieselbe Bildung wie in 0204. */
async function partition(): Promise<string> {
  const [p] = await sql.unsafe<{ p: string }[]>(
    `select 'audit_log_' || to_char(now() at time zone 'UTC', 'YYYY_MM') as p`);
  return p!.p;
}

beforeEach(async () => {
  f = await seed();
  await binde('admin', 'system.audit_exportieren', f.reinigung);
  await binde('admin', 'system.audit_sensitiv_lesen', f.reinigung);
});

afterAll(async () => {
  await schliessen();
});

describe('app.audit_kette_fortschreiben', () => {
  it('kettet jede ungekettete Zeile und laesst die zweite Runde leer', async () => {
    await protokolliere(f.reinigung, 'probe.eins');
    const benutzer = await konto(f.reinigung);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern' as const, readonly: false,
    };

    const erste = await alsApp(sitzung, async (tx) => {
      const [r] = await tx.unsafe(
        `select app.audit_kette_fortschreiben() as n`) as { n: number }[];
      return r!.n;
    });
    expect(erste).toBeGreaterThan(0);

    /* Zweiter Lauf: nichts mehr offen — die Kette waechst nicht doppelt. */
    const zweite = await alsApp(sitzung, async (tx) => {
      const [r] = await tx.unsafe(
        `select app.audit_kette_fortschreiben() as n`) as { n: number }[];
      return r!.n;
    });
    expect(zweite).toBe(0);

    /* Je Protokollzeile genau EIN Glied. */
    const [zahlen] = await sql.unsafe<{ zeilen: string; glieder: string }[]>(
      `select (select count(*)::text from audit_log) as zeilen,
              (select count(*)::text from kern.audit_kettenglied) as glieder`);
    expect(zahlen?.glieder).toBe(zahlen?.zeilen);
  });

  it('ohne system.audit_exportieren wird nichts gekettet', async () => {
    await protokolliere(f.bau, 'probe.ohne_recht');
    /* `bau` hat die Bindung nicht bekommen — nur `reinigung`. */
    const benutzer = await konto(f.bau);
    const n = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => {
        const [r] = await tx.unsafe(
          `select app.audit_kette_fortschreiben() as n`) as { n: number }[];
        return r!.n;
      });
    expect(n).toBe(0);
  });

  it('der Kettenkopf ist fuer cse_app unerreichbar (K-08-Muster)', async () => {
    const benutzer = await konto(f.reinigung);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select letzte_nr from kern.audit_kette`),
    )).rejects.toThrow();
    /*
     * Eine Kette, deren Kopf jemand von aussen verstellen kann, bezeugt
     * nichts — deshalb kein Grant und keine cse_app-Policy, wie bei
     * `freigabe_kette`.
     */
  });
});

describe('app.audit_kette_pruefen — die Gegenprobe', () => {
  it('eine unveraenderte Kette ist geschlossen', async () => {
    await protokolliere(f.reinigung, 'probe.zwei');
    const benutzer = await konto(f.reinigung);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern' as const, readonly: false,
    };
    const teil = await partition();
    const befund = await alsApp(sitzung, async (tx) => {
      await tx.unsafe(`select app.audit_kette_fortschreiben()`);
      const [r] = await tx.unsafe(
        `select glieder::text, bruch_bei::text, kopf_hash
           from app.audit_kette_pruefen($1)`, [teil] as never[]) as
        { glieder: string; bruch_bei: string | null; kopf_hash: string }[];
      return r!;
    });
    expect(Number(befund.glieder)).toBeGreaterThan(0);
    expect(befund.bruch_bei).toBeNull();
    expect(befund.kopf_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('eine veraenderte Protokollzeile bricht die Kette — und die Stelle wird genannt', async () => {
    await protokolliere(f.reinigung, 'probe.drei');
    const benutzer = await konto(f.reinigung);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern' as const, readonly: false,
    };
    const teil = await partition();
    await alsApp(sitzung, (tx) => tx.unsafe(`select app.audit_kette_fortschreiben()`));

    /*
     * Die Manipulation geht NUR als Eigentuemer (Superuser): `audit_log` hat
     * keine UPDATE-Policy und keinen UPDATE-Grant, fuer niemanden. Genau
     * deshalb liegt die Kette in eigenen Tabellen und nicht in Spalten, die
     * jemand nachtraeglich fuellen muesste (siehe Kopf von 0204).
     */
    const [glied] = await sql.unsafe<{ audit_id: string; ketten_nr: string }[]>(
      `select audit_id::text as audit_id, ketten_nr::text as ketten_nr
         from kern.audit_kettenglied order by ketten_nr limit 1 offset 2`);
    expect(glied, 'zu wenige Glieder fuer diesen Test').toBeDefined();
    await sql.unsafe(
      `update audit_log set aktion = aktion || '.manipuliert' where id = $1`,
      [glied!.audit_id] as never[]);

    const befund = await alsApp(sitzung, async (tx) => {
      const [r] = await tx.unsafe(
        `select bruch_bei::text from app.audit_kette_pruefen($1)`, [teil] as never[]) as
        { bruch_bei: string | null }[];
      return r!;
    });
    expect(befund.bruch_bei).toBe(glied!.ketten_nr);

    /* Und der Bruch bleibt am Kettenkopf vermerkt, bis er behoben ist. */
    const [kopf] = await sql.unsafe<{ gebrochen_bei: string | null }[]>(
      `select gebrochen_bei::text from kern.audit_kette where partition = $1`, [teil]);
    expect(kopf?.gebrochen_bei).toBe(glied!.ketten_nr);
  });
});

describe('app.audit_nutzlast_buendel', () => {
  it('mit beiden Rechten kommen die Werte — und EINE Protokollzeile fuer den Abruf', async () => {
    await protokolliere(f.reinigung, 'probe.vier');
    const benutzer = await konto(f.reinigung);
    const vorher = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'audit.nutzlast_buendel_gelesen'`);

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `select audit_id::text as audit_id, vorher, nachher
           from app.audit_nutzlast_buendel(now() - interval '1 day',
                                           now() + interval '1 day')`),
    ) as { audit_id: string; nachher: unknown }[];
    expect(zeilen.length).toBeGreaterThan(0);
    expect(zeilen.some((z) => z.nachher !== null)).toBe(true);

    const nachher = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'audit.nutzlast_buendel_gelesen'`);
    /*
     * GENAU eine mehr. `app.audit_nutzlast_lesen` (0139) schreibt eine je
     * ZEILE; ueber ein Jahresbuendel waeren das Zehntausende, und der
     * naechste Export traegt sie mit. Ein Protokoll, das ueberwiegend sein
     * eigenes Lesen protokolliert, ist unlesbar.
     */
    expect(Number(nachher[0]?.n ?? '0')).toBe(Number(vorher[0]?.n ?? '0') + 1);
  });

  it('ohne system.audit_sensitiv_lesen kommt NICHTS — nicht etwa Nullwerte', async () => {
    await protokolliere(f.reinigung, 'probe.fuenf');
    /* Das Recht der Werte wird in diesem Bereich entzogen, das der Route bleibt. */
    await sql.unsafe(
      `update rolle_berechtigung set gewaehrt = false
        where rolle_id = $1 and mandant_id = $2
          and berechtigung_id = (select id from berechtigung
                                  where schluessel = 'system.audit_sensitiv_lesen')`,
      [await rolleId('admin'), f.reinigung] as never[]);
    const benutzer = await konto(f.reinigung);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `select audit_id from app.audit_nutzlast_buendel(now() - interval '1 day',
                                                         now() + interval '1 day')`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('cse_app kommt an vorher/nachher nicht direkt heran (Spaltenrecht)', async () => {
    const benutzer = await konto(f.reinigung);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select vorher, nachher from audit_log limit 1`),
    )).rejects.toThrow();
  });

  it('Plattformzeilen sind nie Teil eines Mandantenbuendels (K-16(d))', async () => {
    /* Eine Zeile OHNE Mandanten — `app.protokolliere` macht daraus `ebene = plattform`. */
    await sql.unsafe(
      `select app.protokolliere('probe.plattform', 'probe', $1, null, $2::jsonb, null)`,
      [zufall(), JSON.stringify({ a: 1 })] as never[]);
    const benutzer = await konto(f.reinigung);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `select b.audit_id::text as audit_id
           from app.audit_nutzlast_buendel(now() - interval '1 day',
                                           now() + interval '1 day') b
           join audit_log a on a.id = b.audit_id
          where a.ebene = 'plattform'`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });
});

describe('app.audit_kette_deckung', () => {
  it('nennt die Zeilen des Zeitraums und davon die geketteten', async () => {
    await protokolliere(f.reinigung, 'probe.sechs');
    const benutzer = await konto(f.reinigung);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern' as const, readonly: false,
    };

    const ungekettet = await alsApp(sitzung, async (tx) => {
      const [d] = await tx.unsafe(
        `select zeilen::text, gekettet::text
           from app.audit_kette_deckung(now() - interval '1 day',
                                        now() + interval '1 day')`) as
        { zeilen: string; gekettet: string }[];
      return d!;
    });
    expect(Number(ungekettet.zeilen)).toBeGreaterThan(0);
    expect(Number(ungekettet.gekettet)).toBe(0);

    const gekettet = await alsApp(sitzung, async (tx) => {
      await tx.unsafe(`select app.audit_kette_fortschreiben()`);
      const [d] = await tx.unsafe(
        `select zeilen::text, gekettet::text, ketten
           from app.audit_kette_deckung(now() - interval '1 day',
                                        now() + interval '1 day')`) as
        { zeilen: string; gekettet: string; ketten: readonly string[] }[];
      return d!;
    });
    /*
     * Das ist der Satz, den das Manifest fuehren darf: „so viele Zeilen, so
     * viele davon gekettet". Was nicht gekettet ist, ist nicht bewiesen — und
     * der Unterschied gehoert dem Pruefer, nicht der Software.
     */
    expect(gekettet.gekettet).toBe(gekettet.zeilen);
    expect(gekettet.ketten.length).toBeGreaterThan(0);
  });

  it('ohne das Exportrecht antwortet sie nicht', async () => {
    const benutzer = await konto(f.bau);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `select zeilen from app.audit_kette_deckung(now() - interval '1 day',
                                                    now() + interval '1 day')`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });
});

describe('Kein DELETE auf der Kette (Invariante 8)', () => {
  it('weder Kopf noch Glied', async () => {
    await protokolliere(f.reinigung, 'probe.sieben');
    const benutzer = await konto(f.reinigung);
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select app.audit_kette_fortschreiben()`));

    await expect(sql.unsafe(`delete from kern.audit_kettenglied`)).rejects.toThrow();
    await expect(sql.unsafe(`delete from kern.audit_kette`)).rejects.toThrow();
  });
});
