/**
 * `/einstellungen/vorlagen` und die Rechte, die nicht der Seite gehoeren
 * (OPS-08, BAU-06, FIN-15, Invariante 3).
 *
 * **Der stille Fehler, den diese Datei einfriert.** Die Seite ist mit
 * `system.einstellung_verwalten` bewacht; die Vorlagen der
 * Behinderungsanzeige gehoeren dem BAU (`bau.lesen`/`bau.schreiben`), die
 * Mahnstufen dem Mahnwesen (`mahnung.lesen`). Eine Sitzung mit dem Recht der
 * SEITE und ohne das Recht des GEWERKS kommt durch das Tor und bekommt von
 * der RLS null Zeilen — und „keine Vorlage hinterlegt" ist eine ganz andere
 * Auskunft als „Sie dürfen sie nicht sehen". Genau diese Verwechslung war
 * der vierte Blocker, und `ladeVorlagenuebersicht` fragt die drei Rechte
 * seitdem ausdruecklich.
 *
 * Das ist eine Aenderung an Invariante 3, und die verlangt einen Test.
 * Geprueft wird deshalb beides: dass die Rechteauskunft stimmt, und dass die
 * RLS darunter unveraendert haelt — die Behebung WEITET die RLS nicht, sie
 * macht sie nur sichtbar.
 *
 * **Erreichbar ist die Lage ueber die MODUL-Schnittmenge** (AUT-01,
 * `app.hat_recht_fuer`: `split_part(schluessel, '.', 1) = any (bm.module)`).
 * Eine Verwaltung mit `module = {system}` haelt `system.*` und kein `bau.*`
 * — ohne dass jemand eine Rolle geaendert haette. Derselbe Bau wie in
 * `agent-richtlinie-recht.test.ts`.
 *
 * `system.einstellung_verwalten` wird dazu MANDANTENSPEZIFISCH an `admin`
 * gebunden — der dokumentierte Weg fuer ein `bindbar`-Recht
 * (`katalog.generiert.ts`: gebunden an `super_admin`, bindbar an `admin`).
 * `super_admin` selbst kommt hier nicht in Frage: die Rolle traegt
 * `geltungsbereich = 'global'`, und `kern.bm_rolle_pruefen` laesst sie nicht
 * als Mitgliedschaftsrolle zu.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  ladeVorlagenuebersicht, setzeBehinderungsvorlage,
} from '../../src/server/services/einstellung/vorlagen.js';

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

/**
 * Ein Konto mit einer Modulbuchung. `module = null` heisst „keine
 * Einschraenkung", eine Liste heisst „nur diese" — die Schnittmenge aus 0008.
 */
async function konto(
  mandant: string, rolle: string, module: readonly string[] | null,
): Promise<string> {
  const email = `vorlagen-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
     values ($1,$2,$3,$4::text[])`,
    [u!.id, mandant, await rolleId(rolle),
      module === null ? null : `{${module.join(',')}}`] as never[]);
  return u!.id;
}

/** Eine laufende Behinderungsvorlage — als Eigentuemer, an der RLS vorbei. */
async function vorlage(mandant: string, schluessel: string): Promise<void> {
  await sql.unsafe(
    `insert into behinderung_vorlage
       (mandant_id, schluessel, bezeichnung, fundstelle, betreff, rumpf, ist_platzhalter)
     values ($1, $2, 'Behinderung — Platzhalter', '§ 6 Abs. 1 VOB/B',
             'Behinderungsanzeige {projekt}', 'Ursache: {ursache}', true)`,
    [mandant, schluessel] as never[]);
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

beforeEach(async () => {
  f = await seed();
  await binde('admin', 'system.einstellung_verwalten', f.bau);
  await vorlage(f.bau, `behinderung_${zufall()}`);
});

afterAll(async () => {
  await schliessen();
});

describe('Das Recht der Seite genuegt fuer die Vorlagen NICHT (Invariante 3)', () => {
  it('ohne bau.lesen sagt die Uebersicht „nicht sichtbar", nicht „nicht hinterlegt"',
    async () => {
      /* `module = {system}`: das Recht der Seite ja, das des Gewerks nein. */
      const benutzer = await konto(f.bau, 'admin', ['system']);
      const befund = await alsApp(
        { scope: 'mandant', mandantId: f.bau, benutzerId: benutzer,
          portal: 'intern', readonly: false },
        async (tx) => {
          const [r] = await tx.unsafe(
            `select app.hat_recht('system.einstellung_verwalten') as seite,
                    app.hat_recht('bau.lesen') as bau`) as
            { seite: boolean; bau: boolean }[];
          return {
            recht: r!,
            uebersicht: await ladeVorlagenuebersicht(kontextAus(tx, f.bau, benutzer)),
          };
        },
      );
      /* Die Lage, die den Fehler erreichbar macht. */
      expect(befund.recht.seite).toBe(true);
      expect(befund.recht.bau).toBe(false);
      /*
       * Die Liste ist leer — aber die Uebersicht SAGT warum. Ohne das Feld
       * stuende auf dem Bildschirm „keine Vorlage hinterlegt", und genau das
       * ist die falsche Auskunft.
       */
      expect(befund.uebersicht.rechte.bauLesen).toBe(false);
      expect(befund.uebersicht.rechte.bauSchreiben).toBe(false);
      expect(befund.uebersicht.behinderung).toHaveLength(0);
    });

  it('mit bau.lesen kommen die Zeilen', async () => {
    const benutzer = await konto(f.bau, 'admin', null);
    const uebersicht = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => ladeVorlagenuebersicht(kontextAus(tx, f.bau, benutzer)),
    );
    expect(uebersicht.rechte.bauLesen).toBe(true);
    expect(uebersicht.rechte.mahnungLesen).toBe(true);
    expect(uebersicht.behinderung.length).toBeGreaterThan(0);
  });
});

describe('Schreiben verlangt bau.schreiben — die RLS wird nicht geweitet', () => {
  it('ohne das Recht des Gewerks wird die Bestaetigung abgewiesen', async () => {
    const benutzer = await konto(f.bau, 'admin', ['system']);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => setzeBehinderungsvorlage(kontextAus(tx, f.bau, benutzer), {
        schluessel: 'behinderung_witterung',
        bezeichnung: 'Behinderung durch Witterung',
        fundstelle: '§ 6 Abs. 1 VOB/B',
        betreff: 'Behinderungsanzeige {projekt}',
        rumpf: 'Ursache: {ursache}. Beginn: {beginn}.',
      }),
    )).rejects.toThrow();
  });

  it('mit beiden Rechten: die alte Fassung wird archiviert, die neue ist bestaetigt',
    async () => {
      const schluessel = `behinderung_${zufall()}`;
      await vorlage(f.bau, schluessel);
      const benutzer = await konto(f.bau, 'admin', null);
      await alsApp(
        { scope: 'mandant', mandantId: f.bau, benutzerId: benutzer,
          portal: 'intern', readonly: false },
        (tx) => setzeBehinderungsvorlage(kontextAus(tx, f.bau, benutzer), {
          schluessel,
          bezeichnung: 'Behinderung durch Witterung',
          fundstelle: '§ 6 Abs. 1 VOB/B',
          betreff: 'Behinderungsanzeige {projekt}',
          rumpf: 'Ursache: {ursache}. Beginn: {beginn}.',
        }),
      );
      const zeilen = await sql.unsafe<{
        ist_platzhalter: boolean; archiviert: boolean;
      }[]>(
        `select ist_platzhalter, (archiviert_am is not null) as archiviert
           from behinderung_vorlage
          where mandant_id = $1 and schluessel = $2
          order by archiviert_am nulls last`,
        [f.bau, schluessel] as never[]);
      /*
       * Zwei Zeilen, nicht eine geaenderte: eine versendete Anzeige beruft
       * sich auf den Wortlaut, wie er GALT (§ 6 Abs. 1 VOB/B, Invariante 8).
       */
      expect(zeilen).toHaveLength(2);
      expect(zeilen.filter((z) => !z.archiviert)).toHaveLength(1);
      expect(zeilen.find((z) => !z.archiviert)?.ist_platzhalter).toBe(false);
      expect(zeilen.find((z) => z.archiviert)?.ist_platzhalter).toBe(true);
    });
});
