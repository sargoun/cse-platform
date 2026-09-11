/**
 * PR 43 gegen die echte Datenbank — das Leistungsverzeichnis (BAU-01).
 *
 * Drei Dinge lassen sich nur hier pruefen, nicht im Einheitstest:
 *
 *  1. **Die Ordnung der DATENBANK.** Der Einheitstest prueft die
 *     TypeScript-Fassung des Sortierschluessels; ob `order by sortier_pfad`
 *     dasselbe liefert, entscheidet Postgres. Zwei Ordnungen fuer eine OZ
 *     waeren zwei verschiedene Leistungsverzeichnisse — und die Abweichung
 *     faellt niemandem auf, weil beide plausibel aussehen.
 *  2. **Der Spalten-GRANT auf `einheitspreis_cent`** (K-05). Er laesst sich
 *     nur gegen eine echte Rolle pruefen: als Eigentuemer ist jede Spalte
 *     lesbar.
 *  3. **Die Σ je Titel und je Los** aus Zeilen, die wirklich durch die
 *     Ausloeser gelaufen sind — mit `pfad`, `ebene` und `sortier_pfad`, wie
 *     die Datenbank sie setzt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  baueOzBaum, flachInOrdnung, lvSummeCent, ozSortierSchluessel, positionsBetragCent,
  type LvArt, type LvZeile,
} from '../../src/server/services/bau/lv.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly projekt: string;
  readonly lv: string;
  readonly benutzer: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  return u!.id;
}

/** Kunde → Auftrag → Projekt → Leistungsverzeichnis, wie §7.1 es verlangt. */
async function baueProjekt(mandant: string, rolle = 'leitung'): Promise<Aufbau> {
  const benutzer = await konto(`bau-${zufall()}@cse.test`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId(rolle)]);

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
                          vertragsgrundlage)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b') returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id] as never[]);
  const [lv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Rohbau') returning id`,
    [mandant, p!.id] as never[]);

  return { mandant, kunde: k!.id, projekt: p!.id, lv: lv!.id, benutzer };
}

async function position(
  bau: Aufbau,
  opts: {
    oz: string; art: LvArt; eltern?: string | null; kurztext?: string;
    menge?: string | null; preis?: number | null; einheit?: string | null;
    positionsart?: string; konfidenz?: number | null;
  },
): Promise<string> {
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, eltern_id,
                              oz, pfad, sortier_pfad, ebene, art, positionsart, kurztext,
                              einheit, menge_vertrag, einheitspreis_cent, konfidenz)
     values ($1,$2,$3,$4::uuid,$5,'','',1,$6::lv_art,$7::lv_positionsart,$8,$9,
             $10::numeric,$11::bigint,$12::numeric)
     returning id`,
    [
      bau.mandant, bau.lv, bau.projekt, opts.eltern ?? null, opts.oz, opts.art,
      opts.positionsart ?? 'normalposition', opts.kurztext ?? opts.oz,
      opts.art === 'position' ? (opts.einheit ?? 'm²') : null,
      opts.art === 'position' ? (opts.menge ?? '1.000') : null,
      opts.art === 'position' ? (opts.preis ?? 1000) : null,
      opts.konfidenz ?? null,
    ] as never[]);
  return p!.id;
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('(4) die OZ-Ordnung der Datenbank', () => {
  it('stellt 1.2.10 HINTER 1.2.9 — und `order by oz` taete das Gegenteil', async () => {
    const bau = await baueProjekt(f.bau);
    const titel = await position(bau, { oz: '1.2', art: 'titel' });
    for (const oz of ['1.2.10', '1.2.9', '1.2.100', '1.2.1']) {
      await position(bau, { oz, art: 'position', eltern: titel });
    }

    const nachPfad = await sql.unsafe<{ oz: string }[]>(
      `select oz from lv_position where leistungsverzeichnis_id = $1 and art = 'position'
        order by sortier_pfad`, [bau.lv]);
    expect(nachPfad.map((z) => z.oz)).toEqual(['1.2.1', '1.2.9', '1.2.10', '1.2.100']);

    // Die Gegenprobe: die naive Ordnung, gegen die `sortier_pfad` existiert.
    const nachOz = await sql.unsafe<{ oz: string }[]>(
      `select oz from lv_position where leistungsverzeichnis_id = $1 and art = 'position'
        order by oz`, [bau.lv]);
    expect(nachOz.map((z) => z.oz)).toEqual(['1.2.1', '1.2.10', '1.2.100', '1.2.9']);
  });

  it('und die SQL-Fassung des Schluessels stimmt mit der TypeScript-Fassung ueberein', async () => {
    /**
     * Die Regel steht zweimal — in `kern.oz_sortierschluessel` und in
     * `services/bau/lv.ts`. Das ist unvermeidbar (die Datenbank sortiert, die
     * Anzeige gruppiert) und deshalb gepruefte Doppelung statt stiller.
     */
    const proben = [
      '1.2.10', '01.02.0030', '1', '10', '1.2.9', '0030.A', '0030.a', '2.10.3',
      'A.1', '1.', '', '  1.2  ', '999999.1', '1.2.3.4.5',
    ];
    for (const oz of proben) {
      const [zeile] = await sql.unsafe<{ schluessel: string }[]>(
        `select kern.oz_sortierschluessel($1) as schluessel`, [oz]);
      expect(zeile!.schluessel, oz).toBe(ozSortierSchluessel(oz));
    }
  });

  it('Pfad, Ebene und Projekt kommen vom Ausloeser, nicht vom Aufrufer', async () => {
    const bau = await baueProjekt(f.bau);
    const los = await position(bau, { oz: '01', art: 'los' });
    const titel = await position(bau, { oz: '01.02', art: 'titel', eltern: los });
    const pos = await position(bau, { oz: '01.02.0030', art: 'position', eltern: titel });

    const [z] = await sql.unsafe<{ pfad: string; sortier_pfad: string; ebene: number; projekt_id: string }[]>(
      `select pfad, sortier_pfad, ebene, projekt_id from lv_position where id = $1`, [pos]);
    expect(z!.ebene).toBe(3);
    expect(z!.projekt_id).toBe(bau.projekt);
    // Die OZ traegt den Pfad des Elternteils bereits — dann IST sie der Pfad.
    expect(z!.pfad).toBe('01.02.0030');
    expect(z!.sortier_pfad).toBe('000001.000002.000030');

    // Und die kurze Schreibweise wird angehaengt, statt den Teilbaum zu verlieren.
    const kurz = await position(bau, { oz: '40', art: 'position', eltern: titel });
    const [k] = await sql.unsafe<{ pfad: string }[]>(
      `select pfad from lv_position where id = $1`, [kurz]);
    expect(k!.pfad).toBe('01.02.40');
  });

  it('eine Position kann nicht ihr eigener Vorfahr werden', async () => {
    const bau = await baueProjekt(f.bau);
    const a = await position(bau, { oz: '1', art: 'titel' });
    const b = await position(bau, { oz: '1.1', art: 'titel', eltern: a });
    await expect(
      sql.unsafe(`update lv_position set eltern_id = $1 where id = $2`, [b, a]),
    ).rejects.toThrow(/Vorfahr/u);
  });
});

describe('(4) Σ je Titel und je Los stimmen mit der LV-Summe ueberein', () => {
  it('auf den Cent — aus Zeilen, die durch die Datenbank gelaufen sind', async () => {
    const bau = await baueProjekt(f.bau);
    const los = await position(bau, { oz: '1', art: 'los' });
    const t1 = await position(bau, { oz: '1.1', art: 'titel', eltern: los });
    const t2 = await position(bau, { oz: '1.2', art: 'titel', eltern: los });
    // Mengen, die beim Multiplizieren wirklich runden muessen.
    await position(bau, { oz: '1.1.1', art: 'position', eltern: t1, menge: '3.333', preis: 1299 });
    await position(bau, { oz: '1.1.2', art: 'position', eltern: t1, menge: '17.500', preis: 2450 });
    await position(bau, { oz: '1.2.9', art: 'position', eltern: t2, menge: '0.125', preis: 99 });
    await position(bau, { oz: '1.2.10', art: 'position', eltern: t2, menge: '1000.005', preis: 7 });

    const zeilen = await sql.unsafe<{
      id: string; eltern_id: string | null; oz: string; ebene: number; art: LvArt;
      positionsart: string; kurztext: string; einheit: string | null;
      menge_vertrag: string | null; einheitspreis_cent: string | null;
    }[]>(
      `select id, eltern_id, oz, ebene, art::text as art, positionsart::text as positionsart,
              kurztext, einheit, menge_vertrag::text as menge_vertrag,
              einheitspreis_cent::text as einheitspreis_cent
         from lv_position where leistungsverzeichnis_id = $1 order by sortier_pfad`,
      [bau.lv]);

    const baum = baueOzBaum(zeilen.map((z): LvZeile => ({
      id: z.id,
      elternId: z.eltern_id,
      oz: z.oz,
      ebene: z.ebene,
      art: z.art,
      positionsart: 'normalposition',
      kurztext: z.kurztext,
      einheit: z.einheit,
      mengeVertrag: z.menge_vertrag,
      einheitspreisCent: z.einheitspreis_cent === null ? null : BigInt(z.einheitspreis_cent),
      konfidenz: null,
      geprueftAm: null,
    })));

    const flach = flachInOrdnung(baum);
    // Die Reihenfolge des Baums ist die Reihenfolge der Datenbank.
    expect(flach.map((k) => k.zeile.oz))
      .toEqual(['1', '1.1', '1.1.1', '1.1.2', '1.2', '1.2.9', '1.2.10']);

    const summe = (oz: string): bigint =>
      flach.find((k) => k.zeile.oz === oz)?.summeCent ?? -1n;

    expect(summe('1.1')).toBe(4330n + 42_875n);
    expect(summe('1.2')).toBe(12n + 7000n);
    expect(summe('1')).toBe(summe('1.1') + summe('1.2'));
    expect(lvSummeCent(baum)).toBe(summe('1'));
    // Und derselbe Betrag, wenn man die Positionen direkt summiert.
    expect(lvSummeCent(baum)).toBe(
      positionsBetragCent('3.333', 1299n)! + positionsBetragCent('17.500', 2450n)!
      + positionsBetragCent('0.125', 99n)! + positionsBetragCent('1000.005', 7n)!,
    );
  });
});

describe('K-05: der Einheitspreis haengt an einer Spalte, die `cse_app` nicht liest', () => {
  it('ein direkter Zugriff auf die Spalte scheitert — auch mit bau.lesen', async () => {
    const bau = await baueProjekt(f.bau);
    await position(bau, { oz: '1', art: 'position', menge: '2.000', preis: 5000 });

    await expect(alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select einheitspreis_cent from lv_position`),
    )).rejects.toThrow(/permission denied|einheitspreis_cent/u);
  });

  it('aber die Mengen und Texte sind lesbar — die Zeile bleibt offen', async () => {
    const bau = await baueProjekt(f.bau);
    await position(bau, { oz: '1', art: 'position', menge: '2.000', preis: 5000 });

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select oz, menge_vertrag::text as menge from lv_position`),
    ) as { oz: string; menge: string }[];
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.menge).toBe('2.000');
  });

  it('`app.lv_preis_lesen` gibt ihn heraus — und nur mit `bau.preis_lesen`', async () => {
    const bau = await baueProjekt(f.bau, 'admin');
    const id = await position(bau, { oz: '1', art: 'position', menge: '2.000', preis: 5000 });

    // `admin` haelt `bau.preis_lesen` (Katalog §12).
    const [mitRecht] = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select app.lv_preis_lesen($1)::text as preis`, [id]),
    ) as { preis: string | null }[];
    expect(mitRecht!.preis).toBe('5000');

    // `mitarbeiter` haelt es nicht — und bekommt NULL statt einer Zahl.
    const ohne = await baueProjekt(f.bau, 'mitarbeiter');
    const [ohneRecht] = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: ohne.benutzer, portal: 'mitarbeiter' },
      async (tx) => tx.unsafe(`select app.lv_preis_lesen($1)::text as preis`, [id]),
    ) as { preis: string | null }[];
    expect(ohneRecht!.preis).toBeNull();
  });

  it('und jeder Zugriff auf den Preis steht im Protokoll', async () => {
    const bau = await baueProjekt(f.bau, 'admin');
    const id = await position(bau, { oz: '1', art: 'position', menge: '1.000', preis: 4200 });
    await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select app.lv_preis_lesen($1)`, [id]),
    );
    const [eintrag] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from audit_log where aktion = 'bau.preis_gelesen'`);
    expect(Number(eintrag!.anzahl)).toBeGreaterThan(0);
  });
});

describe('Mandantentrennung', () => {
  it('das LV der REALTIME Service GmbH ist aus der Reinigung nicht lesbar', async () => {
    const bau = await baueProjekt(f.bau);
    await position(bau, { oz: '1', art: 'position', menge: '1.000', preis: 100 });
    const fremd = await baueProjekt(f.reinigung);

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: fremd.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select id from lv_position`),
    ) as { id: string }[];
    // Nicht „weniger", sondern KEINE: die fremde Zeile existiert fuer diese
    // Sitzung nicht.
    expect(zeilen).toHaveLength(0);
  });

  it('und niemand loescht eine LV-Position — auch der Eigentuemer nicht', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await position(bau, { oz: '1', art: 'position' });
    await expect(
      alsRolle('', async (tx) => tx.unsafe(`delete from lv_position where id = $1`, [id])),
    ).rejects.toThrow(/gesperrt|Invariante 8/u);
  });
});
