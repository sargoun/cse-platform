/**
 * Die Leseschicht der Stundenkonten-Seiten gegen die echte Datenbank.
 *
 * **Warum das ein eigener Test ist.** Die Zahlen selbst prueft
 * `stundenkonto.test.ts` am Dienst. Hier steht die andere Haelfte: dass die
 * Seite dieselbe Wahrheit zeigt, aus der der Abschluss entscheidet. Zwei
 * Praedikate — eines fuer die Anzeige, eines fuer die Regel — waeren zwei
 * Wahrheiten: der Bildschirm zeigte einen Knopf, und der Dienst wiese ihn ab,
 * oder schlimmer: der Bildschirm sagte „alles freigegeben", und ein Eintrag
 * bliebe still zurueck.
 *
 * Der Test legt seine Zeiten selbst an; die Demodaten kennen diesen Monat
 * nicht.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  bucheFreigegebeneZeiten, eroeffneKonto, schliesseMonatAb, UnfreigegebeneZeitenFehler,
} from '../../src/server/services/zeit/stundenkonto.js';
import {
  leseJahr, leseKontoZeile, leseMonatsliste,
} from '../../src/app/portal/[mandant]/personal/stundenkonten/daten.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Ein Monat der Vergangenheit — weit genug weg von jeder anderen Fixtur. */
const JAHR = 2026;
const MONAT = 5;
const ERSTER = '2026-05-01';

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function planer(mandant: string): Promise<string> {
  const email = `konten-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId('leitung')] as never[]);
  return u!.id;
}

/**
 * `quelle_* = 'import'`: `kern.stempel_feldzeit()` ersetzt bei `server_uhr`
 * den Beginn durch `now()` (Invariante 5, und richtig so) — ein Monat der
 * Vergangenheit liesse sich damit gar nicht aufbauen.
 */
async function zeiteintrag(opts: {
  anstellung: string; person: string; von: string; bis: string;
  freigebenDurch?: string | null;
}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
        pause_minuten, erfassungsart_beginn, erfassungsart_ende,
        quelle_beginn, quelle_ende, status, erstellt_von_art,
        freigegeben_am, freigegeben_von)
     values ($1,$2,$3,$4::timestamptz,$5::timestamptz,0,
             'import','import','import','import','abgeschlossen','system',
             case when $6::uuid is null then null else now() end, $6::uuid)
     returning id`,
    [f.reinigung, opts.anstellung, opts.person, opts.von, opts.bis,
      opts.freigebenDurch ?? null] as never[]);
  return z!.id;
}

function kontextAus(
  tx: postgres.TransactionSql, benutzer: string,
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

function sitzung(benutzer: string): Parameters<typeof alsApp>[0] {
  return {
    scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern', readonly: false,
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('die Liste zeigt jede Beschäftigung — auch die ohne Konto', () => {
  it('ein fehlendes Konto ist eine Zeile, kein Weglassen', async () => {
    const b = await planer(f.reinigung);
    const zeilen = await alsApp(sitzung(b), (tx) =>
      leseMonatsliste(kontextAus(tx, b), ERSTER));

    /**
     * Waere die Abfrage ueber `stundenkonto` gelaufen, waere diese Liste LEER
     * — und eine leere Liste laese sich als „niemand beschäftigt" lesen. Genau
     * das fehlende Konto ist aber der Befund: ein Monat, der nie in den Lohn
     * laeuft.
     */
    expect(zeilen.length).toBeGreaterThan(0);
    const fatima = zeilen.find((z) => z.anstellungId === f.fatimaReinigung);
    expect(fatima, 'die Beschäftigung fehlt in der Liste').toBeDefined();
    expect(fatima!.kontoId).toBeNull();
    expect(fatima!.status).toBeNull();
    expect(fatima!.istMinuten).toBe(0);
    expect(fatima!.zeiten).toBe(0);
  });

  it('eine fremde Gesellschaft steht nicht darin (K-02)', async () => {
    const b = await planer(f.reinigung);
    const zeilen = await alsApp(sitzung(b), (tx) =>
      leseMonatsliste(kontextAus(tx, b), ERSTER));
    // Die Fixtur beschäftigt denselben Menschen auch in `security`; die Zeile
    // dieser Beschäftigung gehoert NICHT in die Liste der Reinigung (D-09).
    expect(zeilen.map((z) => z.anstellungId)).not.toContain(f.fatimaSecurity);
  });
});

describe('`offeneZeiten` ist genau das, was den Abschluss blockiert', () => {
  it('die Zahl der Seite und die Verweigerung des Dienstes stimmen überein', async () => {
    const b = await planer(f.reinigung);
    // Zwei Schichten im Mai, EINE davon freigegeben.
    await zeiteintrag({
      anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-05-04T06:00:00Z', bis: '2026-05-04T14:00:00Z', freigebenDurch: b });
    await zeiteintrag({
      anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-05-05T06:00:00Z', bis: '2026-05-05T14:00:00Z' });

    const vorher = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, b);
      await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: JAHR, monat: MONAT });
      await bucheFreigegebeneZeiten(k, {
        anstellungId: f.fatimaReinigung, jahr: JAHR, monat: MONAT });
      return leseKontoZeile(k, f.fatimaReinigung, ERSTER);
    });

    expect(vorher!.zeiten).toBe(2);
    expect(vorher!.offeneZeiten).toBe(1);
    // Nur die freigegebene Schicht ist auf dem Konto — 480 Minuten, nicht 960.
    expect(vorher!.istMinuten).toBe(480);
    expect(vorher!.status).toBe('offen');

    // Und der Dienst verweigert mit DERSELBEN Zahl.
    const fehler = await alsApp(sitzung(b), async (tx) =>
      schliesseMonatAb(kontextAus(tx, b), {
        anstellungId: f.fatimaReinigung, jahr: JAHR, monat: MONAT,
      }).then(() => null, (e: unknown) => e));
    expect(fehler).toBeInstanceOf(UnfreigegebeneZeitenFehler);
    expect((fehler as UnfreigegebeneZeitenFehler).anzahl).toBe(vorher!.offeneZeiten);
  });

  it('nach der Freigabe zeigt die Seite 0 und der Abschluss geht durch', async () => {
    const b = await planer(f.reinigung);
    await zeiteintrag({
      anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-05-04T06:00:00Z', bis: '2026-05-04T14:00:00Z', freigebenDurch: b });
    const zweiter = await zeiteintrag({
      anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-05-05T06:00:00Z', bis: '2026-05-05T12:00:00Z' });
    await sql.unsafe(
      `update zeiteintrag set freigegeben_am = now(), freigegeben_von = $2 where id = $1`,
      [zweiter, b] as never[]);

    const danach = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, b);
      await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: JAHR, monat: MONAT });
      const offen = await leseKontoZeile(k, f.fatimaReinigung, ERSTER);
      const abschluss = await schliesseMonatAb(k, {
        anstellungId: f.fatimaReinigung, jahr: JAHR, monat: MONAT });
      const zu = await leseKontoZeile(k, f.fatimaReinigung, ERSTER);
      return { offen, abschluss, zu };
    });

    expect(danach.offen!.offeneZeiten).toBe(0);
    expect(danach.abschluss.istMinuten).toBe(480 + 360);
    // Die Seite liest den Abschluss, ohne dass jemand sie darueber informiert.
    expect(danach.zu!.status).toBe('gesperrt');
    expect(danach.zu!.gesperrtAm).not.toBeNull();
    expect(danach.zu!.istMinuten).toBe(danach.abschluss.istMinuten);
  });
});

describe('Liste, Einzelzeile und Jahr sagen dasselbe', () => {
  it('dieselbe Beschäftigung, dieselben Zahlen — drei Leser, ein Prädikat', async () => {
    const b = await planer(f.reinigung);
    await zeiteintrag({
      anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-05-04T06:00:00Z', bis: '2026-05-04T14:00:00Z', freigebenDurch: b });

    const daten = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, b);
      await eroeffneKonto(k, {
        anstellungId: f.fatimaReinigung, jahr: JAHR, monat: MONAT,
        sollMinuten: 9600, saldoVortragMinuten: 120 });
      await bucheFreigegebeneZeiten(k, {
        anstellungId: f.fatimaReinigung, jahr: JAHR, monat: MONAT });
      return {
        liste: await leseMonatsliste(k, ERSTER),
        zeile: await leseKontoZeile(k, f.fatimaReinigung, ERSTER),
        jahr: await leseJahr(k, f.fatimaReinigung, JAHR),
      };
    });

    const ausListe = daten.liste.find((z) => z.anstellungId === f.fatimaReinigung)!;
    const ausJahr = daten.jahr.find((m) => m.monat === MONAT)!;

    expect(daten.zeile!.istMinuten).toBe(ausListe.istMinuten);
    expect(ausJahr.istMinuten).toBe(ausListe.istMinuten);
    expect(ausJahr.sollMinuten).toBe(9600);
    expect(ausJahr.saldoVortragMinuten).toBe(120);
    // Der Saldo ist die Spalte der Datenbank — nicht eine zweite Rechnung.
    expect(ausJahr.saldoMinuten).toBe(120 + 480 - 9600);
    expect(ausListe.saldoMinuten).toBe(ausJahr.saldoMinuten);
  });
});
