/**
 * Material und Gerät in der Kalkulation, gegen eine echte Datenbank (V-174,
 * OPS-07).
 *
 * Was hier fallen würde, fiele leise: eine Materialzeile, die in der
 * Kalkulation steht und nicht im Angebotspreis; zwei Summen desselben
 * Datensatzes, die auseinanderlaufen; eine Basis, die gewählt und nicht
 * gerechnet wird; eine Zeile, die verschwindet, statt als Beleg zu bleiben.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { ladeKalkulationsgrundlage } from '../../src/server/services/kalkulation/raumbuch.js';
import { kalkuliere } from '../../src/server/services/kalkulation/index.js';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF }
  from '../../src/server/services/kalkulation/tarif.js';
import {
  gibPreisFrei, legeAngebotAn, uebernimmKalkulation, versendeAngebot,
} from '../../src/server/services/angebot/index.js';
import { bestaetigeKalkulation, KalkulationFehler }
  from '../../src/server/services/kalkulation/bestaetigung.js';
import { setzeKostenposition } from '../../src/server/services/kalkulation/kostenposition.js';

let f: Fixtur;
let chef = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `kosten-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function nummernkreis(mandant: string, typ: string, maske: string): Promise<void> {
  await sql.unsafe(
    `insert into nummernkreis (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos,
                               format_maske, zuruecksetzung, geoeffnet_am, ist_platzhalter,
                               erstellt_von_art, erstellt_von_dienst)
     values ($1,$2::nummernkreis_typ,2026,$3,false,$4,'jaehrlich',current_date,false,
             'system','job:test')`,
    [mandant, typ, typ, maske]);
}

async function kunde(mandant: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Hausverwaltung','bestandskunde','Vertrag', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  return z!.id;
}

async function objektMitRaumbuch(mandant: string, kundeId: string): Promise<string> {
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,$2,'PVC / Vinyl','250.000','Platzhalter (O-17)','2026-01-01') returning id`,
    [mandant, `PVC${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Buerohaus','Kurfuerstendamm 21','10719','Berlin') returning id`,
    [mandant, kundeId, `OBJ-${zufall()}`]);
  for (const [nr, flaeche] of [['101', '300.000'], ['102', '200.000']] as const) {
    await sql.unsafe(
      `insert into raum (mandant_id, objekt_id, raumnummer, etage, flaeche_qm, belagsart_id)
       values ($1,$2,$3,'EG',$4,$5)`, [mandant, o!.id, nr, flaeche, b!.id]);
  }
  return o!.id;
}

function kontextAus(tx: Parameters<Parameters<typeof alsApp>[1]>[0]) {
  return {
    abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[],
    unsafe: async (s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly unknown[],
  };
}

const als = <T>(mandant: string, fn: (db: ReturnType<typeof kontextAus>) => Promise<T>) =>
  alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: chef,
           portal: 'intern', readonly: false }, async (tx) => fn(kontextAus(tx)));
const alsChef = <T>(fn: (db: ReturnType<typeof kontextAus>) => Promise<T>) =>
  als(f.reinigung, fn);

async function angebotMitKalkulation(): Promise<string> {
  const k = await kunde(f.reinigung);
  const o = await objektMitRaumbuch(f.reinigung, k);
  return alsChef(async (db) => {
    const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
    const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
    const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
    const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
    const id = await legeAngebotAn(db, { kundeId: k, titel: 'Unterhaltsreinigung', objektId: o });
    await uebernimmKalkulation(db, id, kalk,
      { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
    return id;
  });
}

interface Summen {
  lohn: string; material: string; geraet: string; gk: string; wg: string;
  kalk_netto: string; angebot_netto: string; positionen: string; zeilen: string;
}
async function summen(angebotId: string): Promise<Summen> {
  const [z] = await sql.unsafe<Summen[]>(
    `select k.summe_lohn_cent::text as lohn, k.summe_material_cent::text as material,
            k.summe_geraet_cent::text as geraet, k.summe_gemeinkosten_cent::text as gk,
            k.summe_wagnis_gewinn_cent::text as wg,
            k.angebotssumme_netto_cent::text as kalk_netto,
            a.netto_cent::text as angebot_netto,
            (select coalesce(sum(p.gesamtpreis_cent), 0)::text from angebotsposition p
              where p.angebot_id = a.id and p.typ = 'leistung' and p.entfernt_am is null)
              as positionen,
            (select count(*)::text from kalkulation_position kp
              where kp.kalkulation_id = k.id) as zeilen
       from kalkulation k join angebot a on a.id = k.angebot_id
      where a.id = $1`, [angebotId]);
  return z!;
}

const WERTE = {
  stundensatzEuro: '29,00', gemeinkostenBasis: 'lohn', gemeinkostenProzent: '15',
  wagnisGewinnProzent: '8', frequenzFaktor: '1', leistungswerteBestaetigen: true,
};
const MATERIAL = {
  kostenart: 'material', bezeichnung: 'Reinigungsmittel', menge: '12,5', einheit: 'l',
  einzelpreisEuro: '3,20',
};

beforeAll(async () => {
  f = await seed();
  chef = await konto();
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [chef, m, await rolleId('leitung')]);
  }
  await nummernkreis(f.reinigung, 'angebot', 'AN-{jahr}-{nr:5}');
});
afterAll(schliessen);

describe('(1) eine Materialzeile geht in den Preis — und beide Summen sagen dasselbe', () => {
  it('Material 40,00 € steht in der Kalkulation UND im Angebotspreis', async () => {
    const angebotId = await angebotMitKalkulation();
    const vorher = await summen(angebotId);
    expect(vorher.material).toBe('0');

    await alsChef((db) => setzeKostenposition(db, angebotId, MATERIAL));
    const nachher = await summen(angebotId);
    expect(nachher.material).toBe('4000');
    // Der Preis ist gestiegen — um mindestens das Material.
    expect(BigInt(nachher.angebot_netto) - BigInt(vorher.angebot_netto))
      .toBeGreaterThanOrEqual(4000n);
    // Die Positionen des Angebots ergeben das Netto, und die Kalkulation nennt DENSELBEN Betrag.
    expect(nachher.positionen).toBe(nachher.angebot_netto);
    expect(nachher.kalk_netto).toBe(nachher.angebot_netto);
    expect(BigInt(nachher.kalk_netto)).toBe(
      BigInt(nachher.lohn) + BigInt(nachher.material) + BigInt(nachher.geraet)
      + BigInt(nachher.gk) + BigInt(nachher.wg));
  });

  it('Gerät zählt getrennt vom Material', async () => {
    const angebotId = await angebotMitKalkulation();
    await alsChef((db) => setzeKostenposition(db, angebotId, MATERIAL));
    await alsChef((db) => setzeKostenposition(db, angebotId, {
      kostenart: 'geraet', bezeichnung: 'Scheuersaugmaschine', menge: '1', einheit: 'Monat',
      einzelpreisEuro: '85,00',
    }));
    const s = await summen(angebotId);
    expect(s).toMatchObject({ material: '4000', geraet: '8500' });
    expect(s.kalk_netto).toBe(s.angebot_netto);
  });
});

describe('(2) die Gemeinkostenbasis WIRKT', () => {
  it('Selbstkosten: 15 % auf Lohn + Material + Gerät, Lohn: 15 % auf den Lohn allein', async () => {
    const a = await angebotMitKalkulation();
    const b = await angebotMitKalkulation();
    for (const id of [a, b]) {
      await alsChef((db) => setzeKostenposition(db, id, MATERIAL));
    }
    await alsChef((db) => bestaetigeKalkulation(db, a, { ...WERTE, benutzerId: chef }));
    await alsChef((db) => bestaetigeKalkulation(db, b,
      { ...WERTE, gemeinkostenBasis: 'selbstkosten', benutzerId: chef }));
    const sa = await summen(a);
    const sb = await summen(b);
    // Beide Angebote sind gleich — nur die Basis unterscheidet sich.
    expect(sa.lohn).toBe(sb.lohn);
    // 15 % mit halb aufwärts gerundet, in ganzen Cent (die Datenbank rechnet nichts davon).
    const halbAuf = (x: bigint): bigint => (x * 1500n * 2n + 10_000n) / 20_000n;
    expect(BigInt(sa.gk)).toBe(halbAuf(BigInt(sa.lohn)));
    expect(BigInt(sb.gk)).toBe(halbAuf(BigInt(sb.lohn) + 4000n));
    expect(BigInt(sb.angebot_netto)).toBeGreaterThan(BigInt(sa.angebot_netto));
    for (const s of [sa, sb]) expect(s.kalk_netto).toBe(s.angebot_netto);
  });

  it('je Kostenart wird abgewiesen, nicht still auf den Lohn gerechnet (O-16)', async () => {
    const id = await angebotMitKalkulation();
    const fehler = await alsChef((db) => bestaetigeKalkulation(db, id,
      { ...WERTE, gemeinkostenBasis: 'je_kostenart', benutzerId: chef }))
      .then(() => null, (e: unknown) => e);
    expect(fehler).toBeInstanceOf(KalkulationFehler);
    expect((fehler as KalkulationFehler).grund).toBe('basis_offen');
  });
});

describe('(3) berichtigt wird die Zeile — gelöscht wird nichts (Invariante 8)', () => {
  it('Menge 0 neutralisiert die Zeile; sie bleibt stehen, und das Protokoll kennt beide Stände', async () => {
    const angebotId = await angebotMitKalkulation();
    const { positionId } = await alsChef((db) => setzeKostenposition(db, angebotId, MATERIAL));
    const mit = await summen(angebotId);
    await alsChef((db) => setzeKostenposition(db, angebotId, {
      ...MATERIAL, menge: '0', positionId }));
    const ohne = await summen(angebotId);
    expect(ohne.material).toBe('0');
    expect(ohne.zeilen).toBe(mit.zeilen);
    expect(BigInt(ohne.angebot_netto)).toBeLessThan(BigInt(mit.angebot_netto));
    const [log] = await sql.unsafe<{ vorher: Record<string, unknown> | null;
      nachher: Record<string, unknown> }[]>(
      `select vorher, nachher from audit_log where aktion = 'kalkulation.kostenposition'
        order by id desc limit 1`);
    expect(log?.vorher).toMatchObject({ betrag_cent: '4000' });
    expect(log?.nachher).toMatchObject({ betrag_cent: '0', position: positionId });
  });

  it('die Zeile eines FREMDEN Angebots lässt sich nicht berichtigen', async () => {
    const a = await angebotMitKalkulation();
    const b = await angebotMitKalkulation();
    const { positionId } = await alsChef((db) => setzeKostenposition(db, a, MATERIAL));
    await expect(alsChef((db) => setzeKostenposition(db, b, {
      ...MATERIAL, menge: '999', positionId }))).rejects.toMatchObject({ grund: 'nicht_gefunden' });
    expect((await summen(a)).material).toBe('4000');
  });
});

describe('(4) gesperrt ist, was nicht mehr geändert werden darf', () => {
  it('nach der Preisfreigabe: abgewiesen (O-732) — der freigegebene Preis bleibt', async () => {
    const id = await angebotMitKalkulation();
    await alsChef((db) => bestaetigeKalkulation(db, id, { ...WERTE, benutzerId: chef }));
    await alsChef((db) => gibPreisFrei(db, id, chef));
    const vorher = await summen(id);
    await expect(alsChef((db) => setzeKostenposition(db, id, MATERIAL)))
      .rejects.toMatchObject({ grund: 'preis_freigegeben' });
    expect(await summen(id)).toEqual(vorher);
  });

  it('nach dem Versand: eingefroren', async () => {
    const id = await angebotMitKalkulation();
    await alsChef((db) => bestaetigeKalkulation(db, id, { ...WERTE, benutzerId: chef }));
    await alsChef(async (db) => { await gibPreisFrei(db, id, chef); await versendeAngebot(db, id, chef); });
    await expect(alsChef((db) => setzeKostenposition(db, id, MATERIAL)))
      .rejects.toMatchObject({ grund: 'eingefroren' });
  });

  it('aus einer anderen Gesellschaft gibt es die Kalkulation nicht (Invariante 3)', async () => {
    const id = await angebotMitKalkulation();
    await expect(als(f.security, (db) => setzeKostenposition(db, id, MATERIAL)))
      .rejects.toMatchObject({ grund: 'nicht_gefunden' });
    expect((await summen(id)).material).toBe('0');
  });
});

describe('(5) die Zuschlagszeilen finden ihre Nummer hinter der Materialzeile', () => {
  it('Material zuerst, dann Bestätigung — keine doppelte Positionsnummer', async () => {
    const id = await angebotMitKalkulation();
    await alsChef((db) => setzeKostenposition(db, id, MATERIAL));
    await alsChef((db) => bestaetigeKalkulation(db, id, { ...WERTE, benutzerId: chef }));
    await alsChef((db) => setzeKostenposition(db, id, { ...MATERIAL, bezeichnung: 'Tücher' }));
    const nummern = await sql.unsafe<{ nr: number; art: string }[]>(
      `select position_nr as nr, kostenart::text as art from kalkulation_position
        where kalkulation_id = (select id from kalkulation where angebot_id = $1)
        order by position_nr`, [id]);
    expect(new Set(nummern.map((n) => n.nr)).size).toBe(nummern.length);
    expect(nummern.filter((n) => n.art === 'gemeinkosten')).toHaveLength(1);
    expect(nummern.filter((n) => n.art === 'wagnis_gewinn')).toHaveLength(1);
    const s = await summen(id);
    expect(s.material).toBe('8000');
    expect(s.kalk_netto).toBe(s.angebot_netto);
  });
});
