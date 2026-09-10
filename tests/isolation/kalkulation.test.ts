/**
 * Die Kalkulationsgrundlage — der Weg vom Raumbuch in die Rechnung, gegen
 * eine echte Datenbank mit eingeschalteter RLS und entzogenem Leistungswert.
 *
 * Das Abnahmekriterium der Phase 4 lautet: ein Reinigungsangebot laesst sich
 * aus dem Raumbuch rechnen, ohne Handrechnung. Hier steht der Beweis, dass
 * die Zahlen, die dort hineingehen, die des richtigen Mandanten sind, am
 * richtigen Stichtag gelten, und dass nichts stillschweigend verschwindet.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { ladeKalkulationsgrundlage } from '../../src/server/services/kalkulation/raumbuch.js';
import { kalkuliere } from '../../src/server/services/kalkulation/index.js';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF }
  from '../../src/server/services/kalkulation/tarif.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => String(Math.random()).slice(2, 10);
const STICHTAG = new Date('2026-06-15T00:00:00Z');

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `kalk-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function belagsart(mandant: string, code: string, wert: string,
                         ab = '2026-01-01', bis: string | null = null): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab, gueltig_bis)
     values ($1,$2,$2,$3,'Platzhalter (O-17)',$4,$5) returning id`,
    [mandant, code, wert, ab, bis]);
  return z!.id;
}

async function objekt(mandant: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,'Buerohaus','Kurfuerstendamm 21','10719','Berlin') returning id`,
    [mandant, `OBJ-${zufall()}`]);
  return z!.id;
}

async function raum(mandant: string, objektId: string, flaeche: string,
                    belagsartId: string | null, opts: Partial<{
                      nummer: string; fenster: string; archiviert: boolean;
                    }> = {}): Promise<void> {
  await sql.unsafe(
    `insert into raum (mandant_id, objekt_id, raumnummer, etage, flaeche_qm,
                       belagsart_id, fenster_flaeche_qm, archiviert_am)
     values ($1,$2,$3,'EG',$4,$5,$6,$7)`,
    [mandant, objektId, opts.nummer ?? zufall(), flaeche, belagsartId,
     opts.fenster ?? null, opts.archiviert === true ? new Date() : null]);
}

/** Als Leitung im internen Portal — die Sitzung, die eine Kalkulation rechnet. */
function alsChef<T>(mandant: string, fn: (db: {
  abfrage<R>(s: string, w?: readonly unknown[]): Promise<readonly R[]>;
}) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, benutzerId: chef, portal: 'intern', readonly: false },
    async (tx) => fn({
      abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[],
    }),
  );
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.reinigung, await rolleId('leitung')]);
});
afterAll(schliessen);

describe('(1) Die Grundlage kommt aus dem Raumbuch des eigenen Mandanten', () => {
  it('Flaechen werden je Belagsart summiert', async () => {
    const o = await objekt(f.reinigung);
    const pvc = await belagsart(f.reinigung, 'PVC', '250');
    const teppich = await belagsart(f.reinigung, 'TEPPICH', '180');
    await raum(f.reinigung, o, '200', pvc);
    await raum(f.reinigung, o, '300', pvc);
    await raum(f.reinigung, o, '120.5', teppich);

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    expect(g.posten).toHaveLength(2);
    const nachId = new Map(g.posten.map((p) => [p.belagsartId, p]));
    expect(nachId.get(pvc)?.flaeche).toBe(500_000n);
    expect(nachId.get(teppich)?.flaeche).toBe(120_500n);
    expect(nachId.get(pvc)?.leistungswert).toBe(250_000n);
  });

  it('ein archivierter Raum zaehlt nicht mit', async () => {
    const o = await objekt(f.reinigung);
    const pvc = await belagsart(f.reinigung, 'PVC', '250');
    await raum(f.reinigung, o, '200', pvc);
    await raum(f.reinigung, o, '999', pvc, { archiviert: true });

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    expect(g.posten[0]?.flaeche).toBe(200_000n);
  });

  it('ein FREMDES Objekt liefert eine leere Grundlage, keinen Fehler (SEC-A3)', async () => {
    const fremd = await objekt(f.security);
    const pvc = await belagsart(f.security, 'PVC', '250');
    await raum(f.security, fremd, '500', pvc);

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, fremd, STICHTAG));
    expect(g.posten).toHaveLength(0);
    expect(g.flaecheOhneBelagsart).toBe(0n);
  });

  it('die Glasflaeche kommt getrennt zurueck (CLN-05 rechnet auf Glas)', async () => {
    const o = await objekt(f.reinigung);
    const pvc = await belagsart(f.reinigung, 'PVC', '250');
    await raum(f.reinigung, o, '200', pvc, { fenster: '12.5' });
    await raum(f.reinigung, o, '100', pvc, { fenster: '7.5' });

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    expect(g.fensterflaeche).toBe(20_000n);
    // Und sie ist NICHT in der Bodenflaeche enthalten.
    expect(g.posten[0]?.flaeche).toBe(300_000n);
  });
});

describe('(2) Was nicht kalkulierbar ist, wird GENANNT — nicht weggelassen', () => {
  it('Raeume ohne Belagsart kommen als eigene Summe zurueck', async () => {
    const o = await objekt(f.reinigung);
    const pvc = await belagsart(f.reinigung, 'PVC', '250');
    await raum(f.reinigung, o, '500', pvc);
    await raum(f.reinigung, o, '42.5', null);

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    expect(g.flaecheOhneBelagsart).toBe(42_500n);
    expect(g.posten).toHaveLength(1);

    // Und die Kalkulation reicht sie bis ins Ergebnis durch.
    const k = kalkuliere({
      posten: g.posten,
      frequenz: PLATZHALTER_FREQUENZ.frequenz('1_pro_monat'),
      tarif: PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung'),
      flaecheOhneBelagsart: g.flaecheOhneBelagsart,
    });
    expect(k.flaecheOhneBelagsart).toBe(42_500n);
  });

  it('eine am Stichtag NICHT gueltige Belagsart wird gemeldet, nicht als 0 gerechnet', async () => {
    const o = await objekt(f.reinigung);
    const alt = await belagsart(f.reinigung, 'ALT', '250', '2020-01-01', '2025-12-31');
    await raum(f.reinigung, o, '500', alt);

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    expect(g.posten).toHaveLength(0);
    expect(g.ohneGueltigenLeistungswert).toEqual([alt]);
  });

  it('am fruehen Stichtag ist dieselbe Belagsart wieder da', async () => {
    const o = await objekt(f.reinigung);
    const alt = await belagsart(f.reinigung, 'ALT', '250', '2020-01-01', '2025-12-31');
    await raum(f.reinigung, o, '500', alt);

    const g = await alsChef(f.reinigung,
      (db) => ladeKalkulationsgrundlage(db, o, new Date('2024-06-15T00:00:00Z')));
    expect(g.posten).toHaveLength(1);
    expect(g.ohneGueltigenLeistungswert).toEqual([]);
  });

  it('ein Objekt ohne Raeume ergibt eine leere, aber gueltige Grundlage', async () => {
    const o = await objekt(f.reinigung);
    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    expect(g.posten).toHaveLength(0);
    expect(g.fensterflaeche).toBe(0n);
  });
});

describe('(3) Das Abnahmekriterium: ein Preis ohne Handrechnung', () => {
  it('Raumbuch → Σ m² ÷ Leistungswert × Frequenz → Netto in ganzen Cent', async () => {
    const o = await objekt(f.reinigung);
    const pvc = await belagsart(f.reinigung, 'PVC', '250');
    await raum(f.reinigung, o, '300', pvc);
    await raum(f.reinigung, o, '200', pvc);        // Σ 500 m²

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    const k = kalkuliere({
      posten: g.posten,
      frequenz: PLATZHALTER_FREQUENZ.frequenz('1_pro_monat'),
      tarif: PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung'),
    });

    // 500 ÷ 250 = 2 h = 7200 s, × 1,000 Durchgaenge = 7200 s
    expect(k.sekundenJePeriode).toBe(7200n);
    expect(k.lohnkosten).toBe(5800n);              // 2 h × 29,00 €
    expect(k.netto).toBe(7214n);                   // + 15 % + 3 % + 5 %
    expect(typeof k.netto).toBe('bigint');
    /**
     * Und das Ergebnis sagt, dass es auf Platzhaltern steht — auf DREI, nicht
     * auf zwei. O-17 gehoert dazu: der Leistungswert dieser Belagsart ist
     * selbst ein Richtwert, den niemand bestaetigt hat. Ohne ihn haette die
     * Kalkulation nach der Antwort auf O-16 und O-56 einen Preis als
     * bestaetigt gemeldet, der auf einer Schaetzung ruht — die letzte offene
     * Frage waere die einzige gewesen, die keiner mehr sieht.
     */
    expect(k.istPlatzhalter).toBe(true);
    expect(k.offeneFragen).toEqual(['O-16', 'O-17', 'O-56']);
  });

  it('fuenfmal die Woche ergibt den 21,667-fachen Aufwand — eine Rundungsstelle', async () => {
    const o = await objekt(f.reinigung);
    const pvc = await belagsart(f.reinigung, 'PVC', '250');
    await raum(f.reinigung, o, '500', pvc);

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    const k = kalkuliere({
      posten: g.posten,
      frequenz: PLATZHALTER_FREQUENZ.frequenz('5_pro_woche'),
      tarif: PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung'),
    });
    expect(k.sekundenJePeriode).toBe(156_002n);    // 7200 × 21,667
    expect(k.lohnkosten).toBe(125_668n);           // 1256,68 €
  });

  it('der Leistungswert erreicht die Kalkulation NUR ueber den Definer-Leser', async () => {
    // Der Beweis, dass die Grundlage nicht heimlich an der Sperre vorbeigeht:
    // dieselbe Sitzung, die eben eine Kalkulation gerechnet hat, kommt an die
    // Spalte selbst nicht heran.
    const o = await objekt(f.reinigung);
    const pvc = await belagsart(f.reinigung, 'PVC', '250');
    await raum(f.reinigung, o, '500', pvc);

    const g = await alsChef(f.reinigung, (db) => ladeKalkulationsgrundlage(db, o, STICHTAG));
    expect(g.posten[0]?.leistungswert).toBe(250_000n);

    await expect(alsChef(f.reinigung, (db) =>
      db.abfrage(`select leistungswert_qm_pro_stunde from belagsart`),
    )).rejects.toThrow(/permission denied/u);
  });

  it('ohne objekt.lesen entsteht gar keine Grundlage', async () => {
    const o = await objekt(f.reinigung);
    const pvc = await belagsart(f.reinigung, 'PVC', '250');
    await raum(f.reinigung, o, '500', pvc);
    const arbeiter = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [arbeiter, f.reinigung, await rolleId('mitarbeiter')]);

    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: arbeiter, portal: 'intern' },
      async (tx) => ladeKalkulationsgrundlage({
        abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
          (await tx.unsafe(s, w as never[])) as readonly R[],
      }, o, STICHTAG),
    )).rejects.toThrow(/objekt\.lesen fehlt/u);
  });
});
