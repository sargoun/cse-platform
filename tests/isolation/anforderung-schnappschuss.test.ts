import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';

/**
 * **Die Schicht hält fest, was DAMALS verlangt war** (V-129, D-624, 0394,
 * 03-GEWERKE §9.2/§9.4) — gegen echtes Postgres.
 *
 * Geprüft wird die Zusage aus 0028, die bis 0394 niemand einlöste:
 *
 *  1. Jede neu angelegte Schicht trägt ihre Anforderungsmenge — auch eine,
 *     die an keinem Dienst vorbei als rohes INSERT entsteht.
 *  2. Bis zum Beginn folgt der Schnappschuss dem Katalog; ab dem Beginn ist er
 *     eingefroren, und ein später geänderter Katalog ändert die Bewertung
 *     einer vergangenen Schicht nicht.
 *  3. `anforderung_erfuellt` trennt „unbesetzt" (NULL) von „falsch gemischt"
 *     (false) — für `jeder` und für `mindestens_einer`.
 *
 * Alle Schichten hier werden als Eigentümer angelegt (wie Import und
 * Konsole): gerade DIESER Weg soll den Schnappschuss bekommen.
 */

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function qualifikation(name: string): Promise<string> {
  const [q] = await sql.unsafe<{ id: string }[]>(
    `insert into qualifikation (mandant_id, schluessel, bezeichnung, kategorie,
                                rechtsgrundlage, laeuft_ab, blockiert_einsatz, warnung_tage)
     values (null, $1, $2, 'gesetzlich', null, true, false, '{60,30,7}') returning id`,
    [`q_${zufall()}`, name]);
  return q!.id;
}

async function nachweis(person: string, q: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into nachweis (person_id, qualifikation_id, gueltig_ab, gueltig_bis,
                           status, erfasst_von_mandant_id)
     values ($1,$2,'2020-01-01',null,'gueltig',$3)`, [person, q, mandant]);
}

async function objekt(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Buerohaus','Kurfürstendamm 21','10719','Berlin') returning id`,
    [mandant, k!.id, `OBJ-${zufall()}`]);
  return o!.id;
}

/** Eine Schicht, `tage` Tage von heute (negativ: in der Vergangenheit), 08–16 Uhr Berlin. */
async function einsatz(mandant: string, objektId: string, tage: number): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, objekt_id, quelle, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt,
                          beginn_lokal, ende_lokal, endet_am_folgetag, erstellt_von_art)
     select $1, $2, 'manuell', d,
            (d + time '08:00') at time zone 'Europe/Berlin',
            (d + time '16:00') at time zone 'Europe/Berlin',
            '08:00', '16:00', false, 'system'
       from (select (now() at time zone 'Europe/Berlin')::date + $3::int as d) t
     returning id`,
    [mandant, objektId, tage]);
  return e!.id;
}

async function anforderung(o: {
  mandant: string; objekt: string; qualifikation: string;
  geltung?: 'jeder' | 'mindestens_einer'; mindestanzahl?: number; zwingend?: boolean;
}): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatzanforderung (mandant_id, geltungsbereich, objekt_id, qualifikation_id,
                                     zwingend, geltung, mindestanzahl)
     values ($1,'objekt',$2,$3,$4,$5::qualifikation_geltung,$6) returning id`,
    [o.mandant, o.objekt, o.qualifikation, o.zwingend ?? false, o.geltung ?? 'jeder',
     o.mindestanzahl ?? 1]);
  return a!.id;
}

async function einteilen(mandant: string, e: string, anstellung: string, person: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id, erstellt_von_art)
     values ($1,$2,$3,$4,'system') returning id`, [mandant, e, anstellung, person]);
  return z!.id;
}

async function stand(e: string): Promise<{ snapshot: unknown; erfuellt: boolean | null }> {
  const [z] = await sql.unsafe<{ snapshot: unknown; erfuellt: boolean | null }[]>(
    `select anforderung_snapshot as snapshot, anforderung_erfuellt as erfuellt
       from einsatz where id = $1`, [e]);
  return z!;
}

beforeEach(async () => {
  f = await seed();
});

afterAll(async () => {
  await schliessen();
});

describe('§1 jede neue Schicht trägt ihre Anforderungsmenge', () => {
  it('auch ein rohes INSERT — und NULL als Bewertung, solange niemand eingeteilt ist', async () => {
    const q = await qualifikation('Ersthelfer');
    const o = await objekt(f.reinigung);
    const a = await anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q });
    const e = await einsatz(f.reinigung, o, 5);
    const s = await stand(e);
    expect(s.snapshot).toEqual([expect.objectContaining({
      anforderung_id: a, qualifikation_id: q, geltung: 'jeder', zwingend: false,
    })]);
    expect(s.erfuellt).toBeNull();
  });

  it('ohne Anforderung: eine LEERE Menge, nicht „nicht aufgelöst"', async () => {
    const o = await objekt(f.reinigung);
    const e = await einsatz(f.reinigung, o, 5);
    expect((await stand(e)).snapshot).toEqual([]);
  });

  it('eine archivierte Anforderung und eine erst künftig gültige gehören nicht dazu', async () => {
    const q1 = await qualifikation('Alt');
    const q2 = await qualifikation('Später');
    const o = await objekt(f.reinigung);
    const alt = await anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q1 });
    await sql.unsafe(`update einsatzanforderung set archiviert_am = now() where id = $1`, [alt]);
    const spaeter = await anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q2 });
    await sql.unsafe(
      `update einsatzanforderung set gueltig_ab = current_date + 30 where id = $1`, [spaeter]);
    const e = await einsatz(f.reinigung, o, 5);
    expect((await stand(e)).snapshot).toEqual([]);
  });
});

describe('§2 die Mischung — unbesetzt ist nicht falsch gemischt', () => {
  it('„jeder": eine Kraft ohne Nachweis macht die Schicht falsch gemischt', async () => {
    const q = await qualifikation('Hygieneschulung');
    const o = await objekt(f.reinigung);
    await anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q, geltung: 'jeder' });
    const e = await einsatz(f.reinigung, o, 5);
    await einteilen(f.reinigung, e, f.jonasReinigung, f.jonas);
    expect((await stand(e)).erfuellt).toBe(false);
  });

  it('„jeder": mit Nachweis erfüllt', async () => {
    const q = await qualifikation('Hygieneschulung');
    await nachweis(f.jonas, q, f.reinigung);
    const o = await objekt(f.reinigung);
    await anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q, geltung: 'jeder' });
    const e = await einsatz(f.reinigung, o, 5);
    await einteilen(f.reinigung, e, f.jonasReinigung, f.jonas);
    expect((await stand(e)).erfuellt).toBe(true);
  });

  it('„mindestens_einer": eine von zwei Kräften mit Nachweis genügt — bei mindestanzahl 2 nicht', async () => {
    const q = await qualifikation('Ersthelfer');
    await nachweis(f.fatima, q, f.reinigung);
    const o = await objekt(f.reinigung);
    const a = await anforderung({
      mandant: f.reinigung, objekt: o, qualifikation: q, geltung: 'mindestens_einer',
    });
    const e = await einsatz(f.reinigung, o, 5);
    await einteilen(f.reinigung, e, f.jonasReinigung, f.jonas);
    expect((await stand(e)).erfuellt).toBe(false);
    await einteilen(f.reinigung, e, f.fatimaReinigung, f.fatima);
    expect((await stand(e)).erfuellt).toBe(true);

    await sql.unsafe(`update einsatzanforderung set mindestanzahl = 2 where id = $1`, [a]);
    const e2 = await einsatz(f.reinigung, o, 6);
    await einteilen(f.reinigung, e2, f.jonasReinigung, f.jonas);
    await einteilen(f.reinigung, e2, f.fatimaReinigung, f.fatima);
    expect((await stand(e2)).erfuellt).toBe(false);
  });

  it('eine entfernte Zuordnung zählt nicht mehr — die Bewertung folgt', async () => {
    const q = await qualifikation('Hygieneschulung');
    await nachweis(f.fatima, q, f.reinigung);
    const o = await objekt(f.reinigung);
    await anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q, geltung: 'jeder' });
    const e = await einsatz(f.reinigung, o, 5);
    await einteilen(f.reinigung, e, f.fatimaReinigung, f.fatima);
    const ohne = await einteilen(f.reinigung, e, f.jonasReinigung, f.jonas);
    expect((await stand(e)).erfuellt).toBe(false);
    await sql.unsafe(`update einsatz_zuordnung set entfernt_am = now() where id = $1`, [ohne]);
    expect((await stand(e)).erfuellt).toBe(true);
  });
});

describe('§3 bis zum Beginn folgt der Schnappschuss dem Katalog, danach nie mehr', () => {
  it('künftige Schicht: eine NACH dem Anlegen hinzugekommene Anforderung zieht mit der nächsten Einteilung nach', async () => {
    const q = await qualifikation('Neu');
    const o = await objekt(f.reinigung);
    const e = await einsatz(f.reinigung, o, 5);
    expect((await stand(e)).snapshot).toEqual([]);
    await anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q });
    await einteilen(f.reinigung, e, f.jonasReinigung, f.jonas);
    const s = await stand(e);
    expect((s.snapshot as unknown[]).length).toBe(1);
    expect(s.erfuellt).toBe(false);
  });

  it('vergangene Schicht: ein später verschärfter Katalog ändert ihre Bewertung NICHT', async () => {
    const o = await objekt(f.reinigung);
    const e = await einsatz(f.reinigung, o, -3);
    await einteilen(f.reinigung, e, f.jonasReinigung, f.jonas);
    expect(await stand(e)).toEqual({ snapshot: [], erfuellt: true });

    const q = await qualifikation('Nachträglich verlangt');
    await anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q });
    await einteilen(f.reinigung, e, f.fatimaReinigung, f.fatima);
    expect(await stand(e)).toEqual({ snapshot: [], erfuellt: true });
  });
});
