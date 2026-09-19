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
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  MANIFEST_NAME, NUTZLAST_NAME, ZEILEN_NAME, erstelleAuditBuendel, nutzlastCsv,
  packeAuditBuendel, zeilenCsv,
} from '../../src/server/services/audit/buendel.js';
import { leseZipEintrag, leseZipVerzeichnis }
  from '../../src/server/services/archiv/zip.js';

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

/**
 * Eine Protokollzeile mit einem Zeitstempel des VORMONATS — nur als
 * Eigentuemer, denn `app.protokolliere` setzt `now()`.
 *
 * Genau das passiert im Betrieb von selbst: `audit_log.erstellt_am` ist
 * `now()`, also die STARTZEIT der Transaktion. Eine Transaktion, die am
 * Monatsletzten um 23:59:50 beginnt und nach Mitternacht committet, legt
 * Zeilen des Vormonats ab, nachdem die Kette des neuen Monats schon steht.
 */
async function nachgetragen(mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into audit_log (mandant_id, ebene, akteur_typ, aktion, objekt_typ,
                            objekt_id, nachher, erstellt_am)
     values ($1::uuid, 'mandant', 'system', 'probe.nachgetragen', 'probe', $2,
             $3::jsonb, date_trunc('month', now()) - interval '5 days')`,
    [mandant, zufall(), JSON.stringify({ wert: zufall() })] as never[]);
}

function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage, schreibe: abfrage,
  };
}

/** Der Berliner Kalendertag von `now()` — der Zeitraum, den ein Buendel trifft. */
async function heute(): Promise<string> {
  const [t] = await sql.unsafe<{ t: string }[]>(
    `select app.berlin_heute()::text as t`);
  return t!.t;
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

  /*
   * **Der falsche Alarm, den es nicht geben darf.** `fortschreiben` haengt
   * eine nachgetragene Vormonatszeile korrekt an die VORMONATSKETTE und
   * bewegt dabei deren `letzter_hash`. Ein Pruefer, der den Startwert der
   * Folgekette aus dem JETZIGEN Kopf des Vormonats holte, saehe danach einen
   * Bruch am ersten Glied des Folgemonats, wo keiner ist — ein
   * Manipulationsalarm auf der Beweiskette, ausgeloest vom normalen Betrieb.
   * Deshalb haelt `kern.audit_kette.start_hash` den Wert fest, gegen den
   * tatsaechlich gehasht wurde.
   */
  it('eine nachgetragene Vormonatszeile bricht die Folgekette NICHT', async () => {
    const benutzer = await konto(f.reinigung);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern' as const, readonly: false,
    };
    const teil = await partition();

    /* 1. Vormonat zuerst, damit die Kette dieses Monats einen Vorgaenger hat. */
    await nachgetragen(f.reinigung);
    await protokolliere(f.reinigung, 'probe.laufend');
    await alsApp(sitzung, (tx) => tx.unsafe(`select app.audit_kette_fortschreiben()`));

    const [vorher] = await sql.unsafe<{ id: string; start_hash: string | null;
      letzter_hash: string | null }[]>(
      `select k.id::text as id, k.start_hash, v.letzter_hash
         from kern.audit_kette k
         left join kern.audit_kette v on v.id = k.vorgaenger_kette_id
        where k.partition = $1`, [teil]);
    expect(vorher?.start_hash).toBe(vorher?.letzter_hash);

    /* 2. Noch eine Vormonatszeile — sie bewegt den Kopf des Vormonats. */
    await nachgetragen(f.reinigung);
    await alsApp(sitzung, (tx) => tx.unsafe(`select app.audit_kette_fortschreiben()`));

    const [nachher] = await sql.unsafe<{ start_hash: string | null;
      letzter_hash: string | null }[]>(
      `select k.start_hash, v.letzter_hash
         from kern.audit_kette k
         left join kern.audit_kette v on v.id = k.vorgaenger_kette_id
        where k.partition = $1`, [teil]);
    /* Der Vormonatskopf ist gewandert, der Startwert dieser Kette nicht. */
    expect(nachher?.letzter_hash).not.toBe(vorher?.letzter_hash);
    expect(nachher?.start_hash).toBe(vorher?.start_hash);

    /* 3. Und die Pruefung sieht trotzdem keinen Bruch. */
    const befund = await alsApp(sitzung, async (tx) => {
      const [r] = await tx.unsafe(
        `select glieder::text, bruch_bei::text from app.audit_kette_pruefen($1)`,
        [teil] as never[]) as { glieder: string; bruch_bei: string | null }[];
      return r!;
    });
    expect(Number(befund.glieder)).toBeGreaterThan(0);
    expect(befund.bruch_bei).toBeNull();
  });

  it('der Startwert einer Kette ist fest — auch fuer den Eigentuemer', async () => {
    await protokolliere(f.reinigung, 'probe.start');
    const benutzer = await konto(f.reinigung);
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select app.audit_kette_fortschreiben()`));
    const teil = await partition();
    await expect(sql.unsafe(
      `update kern.audit_kette set start_hash = repeat('a', 64) where partition = $1`,
      [teil] as never[])).rejects.toThrow(/Startwert/u);
  });

  it('eine veraenderte Protokollzeile bricht die Kette — und die Stelle wird genannt', async () => {
    /**
     * **VIER Zeilen, und nicht eine — der Fall schreibt seine Vorbedingung
     * selbst.**
     *
     * Unten wird das DRITTE Glied herausgegriffen (`offset 2`), und das mit
     * Absicht: ein Bruch am ERSTEN Glied prueft nur den Startwert der Kette.
     * Erst ein Bruch in der Mitte zeigt, dass das gespeicherte
     * `vorheriger_hash` und die nachgerechnete Kette zusammengehoeren — und
     * dass die Pruefung an der ERSTEN Abweichung stehenbleibt und nicht an
     * irgendeiner.
     *
     * Die Zeilen dafuer entstehen hier und nirgendwo sonst. `seed()` raeumt
     * `audit_log` leer, und die Helfer daneben schreiben keine Protokollzeile:
     * `benutzer`, `benutzer_mandant` und `rolle_berechtigung` stehen in
     * `GEAENDERT_AM`, nicht in `AUDITIERT`. Mit dem einen `protokolliere`,
     * das hier frueher stand, hatte die Kette GENAU EIN Glied, und der Fall
     * fiel an seiner eigenen Vorbedingung statt an der Sache.
     */
    for (const teilname of ['drei.a', 'drei.b', 'drei.c', 'drei.d']) {
      await protokolliere(f.reinigung, `probe.${teilname}`);
    }
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
        portal: 'intern', readonly: false, aal: 'aal2' },
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

  /*
   * 0206: `system.audit_sensitiv_lesen` traegt `berechtigung.erfordert_2fa`.
   * Die Werte sind Loehne, Geburtsdaten und gesundheitsnahe
   * Abwesenheitsgruende — im Klartext und im Zweifel ueber ein ganzes Jahr
   * (SEC-A9, 03-AUTH-BERECHTIGUNGEN Z. 2342). Eine Sitzung ohne zweiten
   * Faktor bekommt deshalb ein REDIGIERTES Buendel, keinen Fehler.
   */
  it('in einer aal1-Sitzung kommt NICHTS — das Recht verlangt den zweiten Faktor',
    async () => {
      await protokolliere(f.reinigung, 'probe.aal');
      const benutzer = await konto(f.reinigung);
      const befund = await alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
          portal: 'intern', readonly: false },
        async (tx) => {
          const [r] = await tx.unsafe(
            `select app.hat_recht('system.audit_exportieren') as export,
                    app.hat_recht('system.audit_sensitiv_lesen') as sensitiv`) as
            { export: boolean; sensitiv: boolean }[];
          return {
            recht: r!,
            zeilen: await tx.unsafe(
              `select audit_id from app.audit_nutzlast_buendel(
                        now() - interval '1 day', now() + interval '1 day')`) as unknown[],
          };
        },
      );
      /* Das Buendel selbst bleibt erlaubt — nur seine Werte nicht. */
      expect(befund.recht.export).toBe(true);
      expect(befund.recht.sensitiv).toBe(false);
      expect(befund.zeilen).toHaveLength(0);
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
    /* `aal2`: geprueft wird das fehlende RECHT, nicht der fehlende Faktor (0206). */
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false, aal: 'aal2' },
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
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false, aal: 'aal2' },
      async (tx) => ({
        alle: await tx.unsafe(
          `select audit_id from app.audit_nutzlast_buendel(now() - interval '1 day',
                                                           now() + interval '1 day')`,
        ) as unknown[],
        plattform: await tx.unsafe(
          `select b.audit_id::text as audit_id
             from app.audit_nutzlast_buendel(now() - interval '1 day',
                                             now() + interval '1 day') b
             join audit_log a on a.id = b.audit_id
            where a.ebene = 'plattform'`) as unknown[],
      }),
    );
    /* Sonst ginge der Test auch durch, wenn die Funktion gar nichts gaebe. */
    expect(befund.alle.length).toBeGreaterThan(0);
    expect(befund.plattform).toHaveLength(0);
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

/**
 * **Das Manifest bindet die NUTZLAST — oder es ist eine Behauptung.**
 *
 * `x-cse-manifest-sha256` signiert das Manifest. Traegt das Manifest keinen
 * Hash je Datei, sagt es nur etwas ueber sich selbst: wer `nutzlast.csv` im
 * Archiv austauscht, laesst den Manifesthash und den Dateinamen unveraendert,
 * und die Pruefung geht durch. Fuer ein Beweismittel nach SEC-A9/LEG-01 ist
 * das der Unterschied zwischen einer Signatur und einer Behauptung; das
 * Vorbild `services/buchhaltung/pruefbuendel.ts` fuehrt `sha256` je Datei und
 * rechnet die Bytes vor dem Packen dagegen.
 */
describe('erstelleAuditBuendel — das Manifest ueber dem echten Bestand', () => {
  it('fuehrt jede Datei mit ihrem SHA-256, und das Archiv haelt sie ein',
    async () => {
      await protokolliere(f.reinigung, 'probe.manifest');
      const benutzer = await konto(f.reinigung);
      const tag = await heute();
      const b = await alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
          portal: 'intern', readonly: false, aal: 'aal2' },
        (tx) => erstelleAuditBuendel(
          kontextAus(tx, f.reinigung, benutzer), { von: tag, bis: tag }),
      );
      expect(b.redigiert).toBe(false);
      expect(b.zeilen.length).toBeGreaterThan(0);

      /* Das Manifest SELBST — nicht nur das Objekt daneben. */
      const manifest = JSON.parse(new TextDecoder().decode(b.manifest)) as {
        dateien: readonly { pfad: string; sha256: string; groesseBytes: number }[];
      };
      const pfade = manifest.dateien.map((d) => d.pfad).sort();
      expect(pfade).toEqual([NUTZLAST_NAME, ZEILEN_NAME].sort());
      const zeilenEintrag = manifest.dateien.find((d) => d.pfad === ZEILEN_NAME)!;
      expect(zeilenEintrag.sha256).toBe(createHash('sha256')
        .update(new TextEncoder().encode(zeilenCsv(b))).digest('hex'));
      const nutzlastEintrag = manifest.dateien.find((d) => d.pfad === NUTZLAST_NAME)!;
      expect(nutzlastEintrag.sha256).toBe(createHash('sha256')
        .update(new TextEncoder().encode(nutzlastCsv(b))).digest('hex'));

      /* Und die Bytes im ZIP sind genau diese. */
      const archiv = packeAuditBuendel(b);
      const verzeichnis = leseZipVerzeichnis(archiv);
      expect(verzeichnis.map((e) => e.pfad).sort())
        .toEqual([MANIFEST_NAME, NUTZLAST_NAME, ZEILEN_NAME].sort());
      for (const d of manifest.dateien) {
        const eintrag = verzeichnis.find((e) => e.pfad === d.pfad)!;
        const bytes = leseZipEintrag(archiv, eintrag);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(d.sha256);
        expect(bytes.length).toBe(d.groesseBytes);
      }
    });

  it('ein redigiertes Buendel fuehrt nur protokoll.csv — und sagt den Grund',
    async () => {
      await protokolliere(f.reinigung, 'probe.redigiert');
      const benutzer = await konto(f.reinigung);
      const tag = await heute();
      /* `aal1`: das Recht der Werte verlangt den zweiten Faktor (0206). */
      const b = await alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
          portal: 'intern', readonly: false },
        (tx) => erstelleAuditBuendel(
          kontextAus(tx, f.reinigung, benutzer), { von: tag, bis: tag }),
      );
      expect(b.redigiert).toBe(true);
      const manifest = JSON.parse(new TextDecoder().decode(b.manifest)) as {
        dateien: readonly { pfad: string }[];
        nutzlast: { redigiert: boolean; grund: string | null };
      };
      expect(manifest.dateien.map((d) => d.pfad)).toEqual([ZEILEN_NAME]);
      expect(manifest.nutzlast.redigiert).toBe(true);
      expect(manifest.nutzlast.grund).toContain('system.audit_sensitiv_lesen');
      expect(leseZipVerzeichnis(packeAuditBuendel(b)).map((e) => e.pfad))
        .not.toContain(NUTZLAST_NAME);
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
