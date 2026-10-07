/**
 * Die Anspruchsgrundlagen der Nachträge pflegen — gegen echte Policies,
 * Rechte und Auslöser (BAU-04, K-17, V-384, O-23, D-842).
 *
 * **Der Befund.** `kern.nachtrag_grundlagen_vorbelegen` (0080) legt die
 * Liste aus dem Gesetzestext als `ist_platzhalter` an, und kein Dienst schrieb
 * `nachtrag_grundlage`: jede Grundlage trug im Nachtrag für immer
 * „unbestätigter Wert".
 *
 * **Die Sätze, die diese Datei beweist — jeder fällt ohne die Umsetzung:**
 *
 *  1. Bestätigen nimmt den Platzhaltervermerk, mit Mensch, Zeit und
 *     Protokollzeile; Text und Fundstelle bleiben. Ein zweites Bestätigen
 *     wird mit Grund abgewiesen.
 *  2. Archivieren nimmt die Grundlage aus der Auswahl eines neuen Nachtrags;
 *     ein Nachtrag, der schon auf ihr steht, behält sie und bleibt lesbar.
 *     Das Protokoll nennt die Zahl der betroffenen Nachträge.
 *  3. Wieder aufnehmen macht das Archivieren rückgängig; eine archivierte
 *     Grundlage lässt sich erst danach bestätigen.
 *  4. Ohne `bau.schreiben`, in der Gruppenansicht und in einer fremden
 *     Gesellschaft ändert sich nichts.
 *  5. Der Katalog zeigt lebende zuerst, mit Stand und Zahl der Nachträge.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { ladeGrundlagen, meldeNachtragAn, findeNachtrag }
  from '../../src/server/services/bau/nachtrag.js';
import {
  NachtragGrundlageFehler, archiviereGrundlage, bestaetigeGrundlage, leseGrundlagenKatalog,
  nimmGrundlageWiederAuf,
} from '../../src/server/services/bau/nachtrag-grundlage.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle = 'leitung'): Promise<string> {
  const email = `grundlage-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)]);
  return u!.id;
}

/**
 * Der Katalog, den die Migration bei jedem Mandanten anlegt — hier von Hand,
 * wie in `bau-nachtrag.test.ts`: `seed()` läuft mit abgeschalteten Auslösern.
 */
async function katalog(mandant: string): Promise<void> {
  await sql.unsafe(`select kern.nachtrag_grundlagen_vorbelegen($1)`, [mandant]);
}

async function grundlage(mandant: string, schluessel = 'p2_abs_6'): Promise<string> {
  const [g] = await sql.unsafe<{ id: string }[]>(
    `select id from nachtrag_grundlage
      where mandant_id = $1 and schluessel = $2 and archiviert_am is null`,
    [mandant, schluessel]);
  return g!.id;
}

async function projekt(mandant: string, benutzer: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Bauherr Nord') returning id`, [mandant, `K-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'projekt','aktiv','Rohbau Nord',$4,'2026-01-01') returning id`,
    [mandant, `AU-${zufall()}`, k!.id, benutzer] as never[]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, verantwortlich_benutzer_id)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b',$5) returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id, benutzer] as never[]);
  return p!.id;
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
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

async function als<T>(
  mandant: string, benutzer: string, fn: (k: SchreibKontext) => Promise<T>, readonly = false,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: benutzer,
      portal: 'intern', readonly },
    async (tx) => fn(kontextAus(tx, mandant, benutzer)));
}

async function grund(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(NachtragGrundlageFehler);
  return (e as NachtragGrundlageFehler).grund;
}

interface Zeile {
  ist_platzhalter: boolean; archiviert_am: Date | null; archiviert_von: string | null;
  geaendert_von: string | null; bezeichnung: string; fundstelle: string; beschreibung: string;
}

async function zeile(id: string): Promise<Zeile> {
  const [z] = await sql.unsafe<Zeile[]>(
    `select ist_platzhalter, archiviert_am, archiviert_von, geaendert_von, bezeichnung,
            fundstelle, beschreibung
       from nachtrag_grundlage where id = $1`, [id]);
  return z!;
}

/**
 * Die Protokollzeilen DES DIENSTES — neben denen des allgemeinen
 * Prüfprotokolls (`nachtrag_grundlage.insert`/`.update`), das jede Zeile
 * ohnehin mit Vorher und Nachher festhält. Der Dienst nennt dazu die
 * Handlung und, beim Archivieren, die Zahl der Nachträge.
 */
async function protokoll(id: string): Promise<{ aktion: string; nachher: Record<string, unknown> }[]> {
  return sql.unsafe(
    `select aktion, nachher from audit_log
      where objekt_typ = 'nachtrag_grundlage' and objekt_id = $1
        and aktion in ('nachtrag_grundlage.bestaetigt', 'nachtrag_grundlage.archiviert',
                       'nachtrag_grundlage.wiederaufgenommen')
      order by id`, [id]);
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) Bestätigen', () => {
  it('nimmt den Platzhaltervermerk — Text bleibt, Mensch und Protokoll stehen da', async () => {
    await katalog(f.bau);
    const leitung = await konto(f.bau);
    const id = await grundlage(f.bau);
    const vorher = await zeile(id);
    expect(vorher.ist_platzhalter).toBe(true);

    await als(f.bau, leitung, (k) => bestaetigeGrundlage(k, id));
    const nachher = await zeile(id);
    expect(nachher.ist_platzhalter).toBe(false);
    expect(nachher.geaendert_von).toBe(leitung);
    expect(nachher.archiviert_am).toBeNull();
    expect({ b: nachher.bezeichnung, f: nachher.fundstelle, t: nachher.beschreibung })
      .toEqual({ b: vorher.bezeichnung, f: vorher.fundstelle, t: vorher.beschreibung });
    expect(await protokoll(id)).toEqual([{ aktion: 'nachtrag_grundlage.bestaetigt',
      nachher: { schluessel: 'p2_abs_6', fundstelle: '§ 2 Abs. 6 VOB/B' } }]);

    // Im Nachtrag ist sie jetzt bestätigt — die übrigen bleiben es nicht.
    const auswahl = await als(f.bau, leitung, (k) => ladeGrundlagen(k));
    expect(auswahl.find((g) => g.id === id)?.ist_platzhalter).toBe(false);
    expect(auswahl.filter((g) => g.id !== id).every((g) => g.ist_platzhalter)).toBe(true);

    expect(await grund(als(f.bau, leitung, (k) => bestaetigeGrundlage(k, id))))
      .toBe('schon_bestaetigt');
  });
});

describe('(2) Archivieren', () => {
  it('nimmt die Grundlage aus der Auswahl; ein Nachtrag auf ihr behält sie', async () => {
    await katalog(f.bau);
    const leitung = await konto(f.bau);
    const id = await grundlage(f.bau);
    const p = await projekt(f.bau, leitung);
    const kopf = await als(f.bau, leitung, (k) => meldeNachtragAn(k, {
      projektId: p, titel: 'Zusätzliche Bewehrung', grundlageId: id,
      begruendung: 'Vom Auftraggeber angeordnet.', angemeldetAm: '2026-09-01',
    }));

    await als(f.bau, leitung, (k) => archiviereGrundlage(k, id));
    const z = await zeile(id);
    expect(z.archiviert_am).not.toBeNull();
    expect(z.archiviert_von).toBe(leitung);

    const auswahl = await als(f.bau, leitung, (k) => ladeGrundlagen(k));
    expect(auswahl.map((g) => g.id)).not.toContain(id);
    const nachtrag = await als(f.bau, leitung, (k) => findeNachtrag(k, kopf.id));
    expect(nachtrag?.grundlage_fundstelle).toBe('§ 2 Abs. 6 VOB/B');

    const [eintrag] = await protokoll(id);
    expect(eintrag).toEqual({ aktion: 'nachtrag_grundlage.archiviert',
      nachher: { schluessel: 'p2_abs_6', fundstelle: '§ 2 Abs. 6 VOB/B', nachtraege: 1 } });

    expect(await grund(als(f.bau, leitung, (k) => archiviereGrundlage(k, id))))
      .toBe('schon_archiviert');
    expect(await grund(als(f.bau, leitung, (k) => bestaetigeGrundlage(k, id))))
      .toBe('archiviert');
  });
});

describe('(3) Wieder aufnehmen', () => {
  it('macht das Archivieren rückgängig — dann lässt sie sich bestätigen', async () => {
    await katalog(f.bau);
    const leitung = await konto(f.bau);
    const id = await grundlage(f.bau, 'bgb_650b');
    expect(await grund(als(f.bau, leitung, (k) => nimmGrundlageWiederAuf(k, id))))
      .toBe('nicht_archiviert');
    await als(f.bau, leitung, (k) => archiviereGrundlage(k, id));
    await als(f.bau, leitung, (k) => nimmGrundlageWiederAuf(k, id));
    const z = await zeile(id);
    expect(z.archiviert_am).toBeNull();
    expect(z.archiviert_von).toBeNull();
    expect((await als(f.bau, leitung, (k) => ladeGrundlagen(k))).map((g) => g.id)).toContain(id);
    await als(f.bau, leitung, (k) => bestaetigeGrundlage(k, id));
    expect((await protokoll(id)).map((e) => e.aktion)).toEqual([
      'nachtrag_grundlage.archiviert', 'nachtrag_grundlage.wiederaufgenommen',
      'nachtrag_grundlage.bestaetigt',
    ]);
  });
});

describe('(4) ohne Recht, in der Gruppenansicht, in fremder Gesellschaft: nichts', () => {
  it('ohne bau.schreiben wird nichts bestätigt oder archiviert', async () => {
    await katalog(f.bau);
    const ma = await konto(f.bau, 'mitarbeiter');
    const id = await grundlage(f.bau);
    // Ein Mitarbeiterkonto sieht den Katalog nicht einmal (p_intern_decke, bau.lesen).
    expect(await grund(als(f.bau, ma, (k) => bestaetigeGrundlage(k, id)))).toBe('nicht_gefunden');
    const leitung = await konto(f.bau);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, false from berechtigung b where b.schluessel = 'bau.schreiben'`,
      [await rolleId('leitung'), f.bau]);
    const e = await als(f.bau, leitung, (k) => archiviereGrundlage(k, id))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(e?.code).toBe('42501');
    expect((await zeile(id)).archiviert_am).toBeNull();
    expect((await zeile(id)).ist_platzhalter).toBe(true);
  });

  it('in der Gruppenansicht (nur lesend) wird nichts geändert', async () => {
    await katalog(f.bau);
    const leitung = await konto(f.bau);
    const id = await grundlage(f.bau);
    const e = await als(f.bau, leitung, (k) => bestaetigeGrundlage(k, id), true)
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(e?.code).toBe('42501');
    expect((await zeile(id)).ist_platzhalter).toBe(true);
  });

  it('die Grundlage einer anderen Gesellschaft gibt es hier nicht', async () => {
    await katalog(f.bau);
    await katalog(f.reinigung);
    const leitung = await konto(f.bau);
    const fremd = await grundlage(f.reinigung);
    expect(await grund(als(f.bau, leitung, (k) => bestaetigeGrundlage(k, fremd))))
      .toBe('nicht_gefunden');
    expect((await zeile(fremd)).ist_platzhalter).toBe(true);
  });
});

describe('(5) der Katalog der Pflegeseite', () => {
  it('lebende in der Ordnung des Gesetzes, archivierte danach — mit Stand und Zahl', async () => {
    await katalog(f.bau);
    const leitung = await konto(f.bau);
    const abs3 = await grundlage(f.bau, 'p2_abs_3');
    const abs6 = await grundlage(f.bau, 'p2_abs_6');
    await als(f.bau, leitung, (k) => bestaetigeGrundlage(k, abs6));
    await als(f.bau, leitung, (k) => archiviereGrundlage(k, abs3));
    const zeilen = await als(f.bau, leitung, (k) => leseGrundlagenKatalog(k));
    expect(zeilen.length).toBe(9);
    expect(zeilen.at(-1)).toMatchObject({ id: abs3, archiviert: true, nachtraege: 0 });
    expect(zeilen.find((z) => z.id === abs6)).toMatchObject({
      istPlatzhalter: false, archiviert: false, ankuendigungErforderlich: true,
    });
    expect(zeilen.slice(0, 8).map((z) => z.schluessel)).toEqual([
      'p1_abs_3', 'p1_abs_4', 'p2_abs_4', 'p2_abs_5', 'p2_abs_6', 'p2_abs_7', 'p2_abs_8',
      'bgb_650b',
    ]);
  });
});
