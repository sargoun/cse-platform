/**
 * **Eine Glaszone rechnet auf die Glasfläche** (V-358, O-349, D-830) — an
 * echtem Postgres, über die echten Dienste.
 *
 * Geprüft wird: die Glaszone rechnet Σ Glasfläche ÷ Leistungswert der
 * Belagsart GLAS und hält den Glaswert im Schnappschuss; der Wechsel der
 * Bezugsgrösse rechnet mit denselben Räumen sofort neu, und ein Raum, der
 * sich danach nicht rechnen lässt, behält keinen alten Anteil (Σ Räume =
 * Kopf); ohne Katalogzeile GLAS am Stichtag rechnet die Glaszone nichts und
 * sagt es; eine fremde Bezugsgrösse wird abgewiesen, ohne etwas zu ändern.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  aendereRevier, legeRevierAn, RevierFehler, setzeRaeume, setzeRevierBezug,
} from '../../src/server/services/reinigung/revier.js';

let f: Fixtur;
let leitung = '';
let objekt = '';
let raeume: { buero: string; lager: string; foyer: string };
const STICHTAG = new Date('2026-06-15T10:00:00Z');
const zufall = (): string => String(Math.random()).slice(2, 10);

function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const abfrage = async <T>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(s, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: leitung,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

const als = <T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: leitung,
           portal: 'intern', readonly: false }, async (tx) => fn(kontextAus(tx)));

beforeAll(async () => {
  f = await seed();
  const email = `glas-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  leitung = u!.id;
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [leitung, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1,$2,(select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
    [leitung, f.reinigung]);

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Glas AG') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Glashaus','Glasweg 1','10115','Berlin') returning id`,
    [f.reinigung, k!.id, `O-${zufall()}`]);
  objekt = o!.id;

  // Der Katalog: ein Belag und die Zeile GLAS, beide Voreinstellung (O-17).
  const [pvc] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,'PVC','PVC',250,'Voreinstellung (O-17)','2020-01-01') returning id`,
    [f.reinigung]);
  await sql.unsafe(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,'GLAS','Glas',50,'Voreinstellung (O-17, O-349)','2020-01-01')`,
    [f.reinigung]);

  const neu = async (nr: string, flaeche: string, glas: string | null,
                     belag: string | null, i: number): Promise<string> => {
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into raum (mandant_id, objekt_id, raumnummer, bezeichnung, flaeche_qm,
                         fenster_flaeche_qm, belagsart_id, sortierung)
       values ($1,$2,$3,$3,$4::numeric,$5::numeric,$6,$7) returning id`,
      [f.reinigung, objekt, nr, flaeche, glas, belag, i] as never[]);
    return r!.id;
  };
  raeume = {
    buero: await neu('Büro', '20', '12.5', pvc!.id, 0),
    lager: await neu('Lager', '15', null, null, 1),
    foyer: await neu('Foyer', '30', '30', pvc!.id, 2),
  };
});
afterAll(schliessen);

async function zone(bezugsgroesse?: string): Promise<string> {
  return (await als((k) => legeRevierAn(k, {
    objektId: objekt, bezeichnung: `Zone ${zufall()}`, sollzeitMinuten: '90',
    ...(bezugsgroesse === undefined ? {} : { bezugsgroesse }),
  }))).id;
}

async function stand(revier: string): Promise<{
  bezug: string; kopf: string; summe: string | null;
  raeume: Record<string, { soll: string | null; lw: string | null; glas: string | null }>;
}> {
  const [r] = await sql.unsafe<{ bezug: string; kopf: string; summe: string | null }[]>(
    `select bezugsgroesse as bezug, sollzeit_minuten::text as kopf,
            (select sum(sollzeit_minuten)::text from revier_raum where revier_id = r.id) as summe
       from revier r where r.id = $1`, [revier]);
  const zeilen = await sql.unsafe<{
    raum_id: string; soll: string | null; lw: string | null; glas: string | null;
  }[]>(
    `select raum_id, sollzeit_minuten::text as soll,
            leistungswert_qm_pro_stunde::text as lw, fenster_flaeche_qm::text as glas
       from revier_raum where revier_id = $1`, [revier]);
  const name = new Map(Object.entries(raeume).map(([n, id]) => [id, n]));
  return {
    ...r!,
    raeume: Object.fromEntries(zeilen.map((z) => [name.get(z.raum_id)!,
      { soll: z.soll, lw: z.lw, glas: z.glas }])),
  };
}

const alle = (): string[] => [raeume.buero, raeume.lager, raeume.foyer];

describe('V-358 — eine Glaszone rechnet auf die Glasfläche (O-349)', () => {
  it('Σ Glasfläche ÷ Leistungswert GLAS — der Glaswert steht im Schnappschuss', async () => {
    const revier = await zone('glas');
    const ergebnis = await als((k) => setzeRaeume(k, revier, alle(), STICHTAG));
    // 42,5 m² Glas ÷ 50 m²/h = 51 Minuten; das Lager ohne Glas hat hier nichts zu reinigen.
    expect(ergebnis.zeit.sollzeitMinuten).toBe('51.00');
    expect(ergebnis.ohneLeistungswert).toEqual([]);
    expect([...ergebnis.aufPlatzhalter].sort()).toEqual(alle().sort());
    const s = await stand(revier);
    expect(s).toMatchObject({ bezug: 'glas', kopf: '51.00', summe: '51.00' });
    expect(s.raeume).toEqual({
      buero: { soll: '15.00', lw: '50.000', glas: '12.500' },
      foyer: { soll: '36.00', lw: '50.000', glas: '30.000' },
    });
  });

  it('der Wechsel rechnet sofort neu, und ein Raum, der nicht mehr zählt, behält keinen alten Anteil', async () => {
    const revier = await zone('boden');
    await als((k) => setzeRaeume(k, revier, alle(), STICHTAG));
    // 50 m² Boden ÷ 250 m²/h = 12 Minuten; das Lager hat keinen Belag.
    expect(await stand(revier)).toMatchObject({ bezug: 'boden', kopf: '12.00', summe: '12.00' });

    // Ein zweiter Raum ohne Glas, aber mit Belag: in der Bodenzone zählt er.
    const [flur] = await sql.unsafe<{ id: string }[]>(
      `insert into raum (mandant_id, objekt_id, raumnummer, bezeichnung, flaeche_qm,
                         belagsart_id, sortierung)
       values ($1,$2,'Flur','Flur',10,
               (select id from belagsart where mandant_id = $1 and code = 'PVC'),3)
       returning id`, [f.reinigung, objekt]);
    await als((k) => setzeRaeume(k, revier, [...alle(), flur!.id], STICHTAG));
    // 60 m² Boden ÷ 250 m²/h = 14,40 Minuten, davon der Flur 2,40.
    expect(await stand(revier)).toMatchObject({ kopf: '14.40', summe: '14.40' });

    expect(await als((k) => setzeRevierBezug(k, revier, 'glas', STICHTAG)))
      .toEqual({ geaendert: true, neuGerechnet: true });
    const glas = await stand(revier);
    // Der Flur hat kein Glas: sein Bodenanteil von 2,40 Minuten bleibt nicht stehen.
    expect(glas).toMatchObject({ bezug: 'glas', kopf: '51.00', summe: '51.00' });
    const [flurZeile] = await sql.unsafe<{ soll: string | null; lw: string | null }[]>(
      `select sollzeit_minuten::text as soll, leistungswert_qm_pro_stunde::text as lw
         from revier_raum where revier_id = $1 and raum_id = $2`, [revier, flur!.id]);
    expect(flurZeile).toEqual({ soll: null, lw: null });
    expect(glas.raeume).toMatchObject({
      buero: { soll: '15.00', lw: '50.000' }, foyer: { soll: '36.00', lw: '50.000' },
    });

    expect(await als((k) => setzeRevierBezug(k, revier, 'glas', STICHTAG)))
      .toEqual({ geaendert: false, neuGerechnet: false });
    await als((k) => setzeRevierBezug(k, revier, 'boden', STICHTAG));
    // 60 m² Boden ÷ 250 m²/h = 14,40 Minuten.
    expect(await stand(revier)).toMatchObject({ bezug: 'boden', kopf: '14.40', summe: '14.40' });
  });

  it('ohne Räume wird nur gespeichert; auch das Ändern der Zone setzt die Bezugsgrösse', async () => {
    const revier = await zone();
    expect((await stand(revier)).bezug).toBe('boden');
    expect(await als((k) => setzeRevierBezug(k, revier, 'glas', STICHTAG)))
      .toEqual({ geaendert: true, neuGerechnet: false });

    await als((k) => setzeRaeume(k, revier, alle(), STICHTAG));
    await als((k) => aendereRevier(k, {
      id: revier, bezeichnung: 'Zone geändert', sollzeitMinuten: '90', bezugsgroesse: 'boden',
    }, STICHTAG));
    expect(await stand(revier)).toMatchObject({ bezug: 'boden', kopf: '12.00', summe: '12.00' });
  });

  it('ohne Katalogzeile GLAS am Stichtag rechnet die Glaszone nichts und sagt es', async () => {
    const revier = await zone('glas');
    const ergebnis = await als((k) =>
      setzeRaeume(k, revier, alle(), new Date('2019-06-15T10:00:00Z')));
    expect(ergebnis.zeit.raeume).toEqual([]);
    expect([...ergebnis.ohneLeistungswert].sort()).toEqual(alle().sort());
    // Die von Hand gesetzte Sollzeit bleibt — eine Zone ohne Rechnung ist keine ohne Arbeit.
    expect(await stand(revier)).toMatchObject({ kopf: '90.00', summe: null });
  });

  it('eine fremde Bezugsgrösse wird abgewiesen, und nichts ändert sich', async () => {
    await expect(zone('wasser')).rejects.toMatchObject({ grund: 'bezugsgroesse_ungueltig' });
    const revier = await zone('glas');
    await expect(als((k) => setzeRevierBezug(k, revier, 'wasser', STICHTAG)))
      .rejects.toBeInstanceOf(RevierFehler);
    await expect(als((k) => aendereRevier(k, {
      id: revier, bezeichnung: 'Nie', sollzeitMinuten: '90', bezugsgroesse: 'wasser',
    }, STICHTAG))).rejects.toMatchObject({ grund: 'bezugsgroesse_ungueltig' });
    const [r] = await sql.unsafe<{ bezeichnung: string; bezugsgroesse: string }[]>(
      `select bezeichnung, bezugsgroesse from revier where id = $1`, [revier]);
    expect(r!.bezugsgroesse).toBe('glas');
    expect(r!.bezeichnung).not.toBe('Nie');
    // Und die Datenbank als zweite Linie.
    await expect(sql.unsafe(
      `update revier set bezugsgroesse = 'wasser' where id = $1`, [revier]))
      .rejects.toThrow(/revier_bezugsgroesse_bekannt/u);
  });
});
