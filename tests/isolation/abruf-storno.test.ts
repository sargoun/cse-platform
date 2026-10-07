/**
 * Eine Abrufherkunft übersteht das Storno (V-395, D-832).
 *
 * Bis hierher liess sich eine Rechnung mit einer Zeile aus einem Einzelabruf
 * nicht stornieren: `uebernimmQuellen` kopierte `sonderleistung_id` nicht, die
 * Stornozeile trug den Typ ohne den Abruf, und `rpq_genau_eine_quelle` (0112)
 * wies sie ab. Und selbst mit der Spalte blieb der Abruf danach
 * `abgerechnet` — `einzelabruf.ts` liest nur `erbracht`, die Neuausstellung
 * fände ihn nicht mehr.
 *
 * Der Status folgt jetzt der Herkunft (`fin.abrufstatus_nachziehen`, 0523),
 * auch für eine Rolle, die festschreiben und stornieren darf, aber keine
 * Reinigungsrechte hält — für sie traf das frühere UPDATE unter FORCE RLS
 * null Zeilen, ohne Fehler.
 *
 * **Jede Prüfung fällt ohne die Umsetzung**: ohne die Spalte in
 * `uebernimmQuellen` wirft schon das Storno, ohne den Definer bleibt der
 * Status für die Rolle ohne Reinigungsrechte stehen.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, korrigiere, legeEntwurfAn, storniere, vonHand,
  type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { bestueckeAusAbrechnungsart } from '../../src/server/services/finanz/abrechnungsart/index.js';
import { ladeQuellen } from '../../src/server/services/finanz/positionsquelle.js';

let f: Fixtur;
let benutzer: string;
const zufall = (): string => String(Math.random()).slice(2, 10);
const AUGUST = { von: '2026-08-01', bis: '2026-08-31' } as const;
const GRUND = 'Abruf doppelt erfasst — der Kunde hat widersprochen';

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung(mandantId: string, benutzerId = benutzer) {
  return {
    scope: 'mandant' as const, mandantId, benutzerId,
    portal: 'intern' as const, readonly: false,
  };
}

async function legeBenutzerAn(email: string, globaleRolle: string | null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, email, globaleRolle]);
  return u!.id;
}

async function machtMitglied(benutzerId: string, mandantId: string, rolleId: string) {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1, $2, $3)`,
    [benutzerId, mandantId, rolleId]);
}

async function systemrolle(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/**
 * Eine Rolle dieser Gesellschaft mit den Rechten von `admin` — ohne die
 * Reinigung. So sieht eine Buchhaltung aus, die festschreiben und stornieren
 * darf, aber keinen Abruf pflegt.
 */
async function finanzrolleOhneReinigung(mandantId: string, zusatz: readonly string[] = [])
  : Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, 'Buchhaltung ohne Reinigung', 'mandant', 'intern') returning id`,
    [mandantId, `fibu_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1::uuid, rb.berechtigung_id, $2::uuid, true
       from rolle_berechtigung rb
       join rolle a on a.id = rb.rolle_id and a.schluessel = 'admin' and a.mandant_id is null
       join berechtigung b on b.id = rb.berechtigung_id
      where rb.gewaehrt and b.schluessel not like 'reinigung.%'
        and b.schluessel not like 'gruppe.reinigung.%'
     union
     select $1::uuid, b.id, $2::uuid, true from berechtigung b
      where b.schluessel = any($3::text[])`,
    [r!.id, mandantId, [...zusatz]]);
  return r!.id;
}

/** Eine Rolle, die Rechnungen nur liest. */
async function nurLesen(mandantId: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, 'Nur lesen', 'mandant', 'intern') returning id`,
    [mandantId, `leser_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = 'finanzen.lesen'`,
    [r!.id, mandantId]);
  return r!.id;
}

async function macheFakturierfaehig(mandantId: string, praefix: string): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B'
      where id = $1`, [mandantId]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, $2, true, $3, 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId, `Rechnungen ${praefix}`, `${praefix}-{nr:5}`]);
}

interface Bau {
  readonly mandant: string;
  readonly kunde: string;
  readonly objekt: string;
  readonly auftrag: string;
  readonly leistung: string;
}

async function baueAuftrag(mandant: string): Promise<Bau> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus Mitte','Teststr. 7','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'dauerauftrag','aktiv','Unterhaltsreinigung',$5,'2026-01-01')
     returning id`,
    [mandant, `AU-${zufall()}`, k!.id, o!.id, benutzer] as never[]);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                   bezeichnung, einheit, einzelpreis_cent, steuersatz_bp,
                                   steuer_kennzeichen, gueltig_ab)
     values ($1,$2,1,$3,'Sonderreinigung Bürohaus','stk',8900,1900,'regelsatz','2026-01-01')
     returning id`,
    [mandant, a!.id, o!.id] as never[]);
  return { mandant, kunde: k!.id, objekt: o!.id, auftrag: a!.id, leistung: l!.id };
}

async function legeKonfigurationAn(
  bau: Bau, art: string, parameter: Record<string, unknown>,
  pauschaleNettoCent: bigint | null = null,
): Promise<void> {
  await sql.unsafe(
    `insert into vertrag_abrechnung
       (mandant_id, auftrag_id, auftrag_leistung_id, abrechnungsart, parameter,
        pauschale_netto_cent, abrechnungsintervall, leistungszeitraum_modus, gueltig_ab)
     values ($1,$2,$3,$4::abrechnungsart,($5::text)::jsonb,$6::bigint,
             $7::abrechnungsintervall,'kalendermonat','2026-01-01')`,
    [bau.mandant, bau.auftrag, bau.leistung, art, JSON.stringify(parameter),
     pauschaleNettoCent, art === 'einzelabruf' ? 'nach_leistung' : 'monatlich'] as never[]);
}

async function baueAbruf(bau: Bau, tag: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, version, status,
                                   gueltig_ab)
     values ($1,$2,'Sonderleistungen',1,'aktiv','2026-01-01') returning id`,
    [bau.mandant, `sonder-${zufall()}`]);
  const [kp] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog_position
       (mandant_id, katalog_id, oz, kurztext, einheit, standard_einzelpreis_cent, gueltig_ab)
     values ($1,$2,'01.001','Grundreinigung','stk',9900,'2026-01-01') returning id`,
    [bau.mandant, k!.id]);
  const [s] = await sql.unsafe<{ id: string }[]>(
    `insert into sonderleistung
       (mandant_id, objekt_id, auftrag_leistung_id, leistungskatalog_position_id, kunde_id,
        bezeichnung, beauftragt_am, ausfuehrung_von, ausfuehrung_bis, menge, einheit,
        status, erstellt_von_art, erstellt_von)
     values ($1,$2,$3,$4,$5,'Grundreinigung Treppenhaus',$6::date,$6::date,$6::date,
             2.000,'stk','erbracht','mensch',$7) returning id`,
    [bau.mandant, bau.objekt, bau.leistung, kp!.id, bau.kunde, tag, benutzer] as never[]);
  return s!.id;
}

/** Ein Entwurf über August, bestückt aus der Abrechnungsart des Auftrags. */
async function bestueckterEntwurf(bau: Bau, wer = benutzer): Promise<string> {
  return alsApp(sitzung(bau.mandant, wer), async (tx) => {
    const id = await legeEntwurfAn(alsDienst(tx), {
      kundeId: bau.kunde, objektId: bau.objekt, auftragId: bau.auftrag,
      leistungVon: AUGUST.von, leistungBis: AUGUST.bis, zahlungszielTage: 30,
    });
    await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
      auftragId: bau.auftrag, periode: AUGUST,
    });
    return id;
  });
}

async function status(abruf: string): Promise<string> {
  const [s] = await sql.unsafe<{ status: string }[]>(
    `select status::text from sonderleistung where id = $1`, [abruf]);
  return s!.status;
}

/**
 * Die Herkunft einer Rechnung, nach Typ. Eine Abrufzeile trägt zwei: den
 * Abruf und die Vertragszeile, unter der er abgerechnet wird.
 */
async function herkunft(rechnungId: string) {
  return sql.unsafe<{ typ: string; sonderleistung_id: string | null; wirksam: boolean }[]>(
    `select quelle_typ::text as typ, sonderleistung_id::text, wirksam
       from rechnungsposition_quelle where rechnung_id = $1
      order by quelle_typ::text, erstellt_am, id`,
    [rechnungId]);
}

function abrufzeile(abrufId: string, wirksam: boolean) {
  return [
    { typ: 'sonderleistung', sonderleistung_id: abrufId, wirksam },
    { typ: 'vertrag', sonderleistung_id: null, wirksam },
  ];
}

let bau: Bau;
let abruf: string;

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`abruf-${zufall()}@cse.test`, 'super_admin');
  await macheFakturierfaehig(f.reinigung, 'RE');
  await machtMitglied(benutzer, f.reinigung, await systemrolle('admin'));
  bau = await baueAuftrag(f.reinigung);
  await legeKonfigurationAn(bau, 'einzelabruf', { mindestabrufmenge: null });
  abruf = await baueAbruf(bau, '2026-08-12');
});
afterAll(schliessen);

describe('V-395 — das Storno einer Rechnung über einen Einzelabruf', () => {
  it('gelingt, nennt den Abruf in der Stornozeile und gibt ihn frei', async () => {
    const original = await bestueckterEntwurf(bau);
    await alsApp(sitzung(f.reinigung), (tx) => finalisiere(alsDienst(tx), original));
    expect(await status(abruf)).toBe('abgerechnet');

    const storno = await alsApp(sitzung(f.reinigung), (tx) =>
      storniere(alsDienst(tx), original, GRUND));

    // Die Stornozeile bezeugt, WAS aufgehoben wurde — mit dem Abruf, unwirksam.
    expect(await herkunft(storno.stornoId)).toEqual(abrufzeile(abruf, false));
    // Das Original gibt ihn frei …
    expect(await herkunft(original)).toEqual(abrufzeile(abruf, false));
    // … und der Abruf ist wieder erbracht, also wieder abrechenbar.
    expect(await status(abruf)).toBe('erbracht');
    const neu = await bestueckterEntwurf(bau);
    expect(await herkunft(neu)).toEqual(abrufzeile(abruf, true));
  });

  it('die Korrektur beansprucht den Abruf neu und rechnet ihn wieder ab', async () => {
    const original = await bestueckterEntwurf(bau);
    await alsApp(sitzung(f.reinigung), (tx) => finalisiere(alsDienst(tx), original));

    const korrektur = await alsApp(sitzung(f.reinigung), (tx) =>
      korrigiere(alsDienst(tx), original, GRUND));

    expect(await herkunft(korrektur.neuId)).toEqual(abrufzeile(abruf, true));
    expect(await herkunft(korrektur.stornoId)).toEqual(abrufzeile(abruf, false));
    expect(await herkunft(original)).toEqual(abrufzeile(abruf, false));
    expect(await status(abruf)).toBe('abgerechnet');
  });

  it('die Nutzlast eines neuen Belegs nennt den Abruf', async () => {
    const original = await bestueckterEntwurf(bau);
    await alsApp(sitzung(f.reinigung), (tx) => finalisiere(alsDienst(tx), original));
    const [snap] = await sql.unsafe<{ quellen: { typ: string; id: string }[] }[]>(
      `select nutzlast -> 'positionen' -> 0 -> 'quellen' as quellen
         from rechnung_snapshot where rechnung_id = $1`, [original]);
    // Bis D-832 stand beim Abruf `id: ''` — seine Kennung fehlte.
    expect(snap!.quellen).toEqual([
      { typ: 'sonderleistung', id: abruf, menge_anteil: '2.000' },
      { typ: 'vertrag', id: bau.leistung, menge_anteil: null },
    ]);
  });
});

describe('V-395 — der Status folgt der Herkunft auch ohne Reinigungsrechte', () => {
  it('festschreiben und stornieren setzt und löst den Status', async () => {
    const fibu = await legeBenutzerAn(`fibu-${zufall()}@cse.test`, null);
    await machtMitglied(fibu, f.reinigung, await finanzrolleOhneReinigung(f.reinigung, [
      'finanzen.festschreiben', 'finanzen.stornieren',
    ]));

    // Der Abruf ist für diese Rolle unsichtbar (t_mandant, 0067) …
    const sichtbar = await alsApp(sitzung(f.reinigung, fibu), (tx) =>
      tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from sonderleistung where id = $1`, [abruf]));
    expect(sichtbar[0]!.n).toBe(0);

    // … bestückt wird der Entwurf deshalb von der Leitung, festgeschrieben
    // und storniert von der Buchhaltung.
    const original = await bestueckterEntwurf(bau);
    await alsApp(sitzung(f.reinigung, fibu), (tx) => finalisiere(alsDienst(tx), original));
    expect(await status(abruf)).toBe('abgerechnet');

    await alsApp(sitzung(f.reinigung, fibu), (tx) => storniere(alsDienst(tx), original, GRUND));
    expect(await status(abruf)).toBe('erbracht');
  });

  it('wer Rechnungen nur liest, zieht keinen Status nach', async () => {
    const leser = await legeBenutzerAn(`leser-${zufall()}@cse.test`, null);
    await machtMitglied(leser, f.reinigung, await nurLesen(f.reinigung));
    const original = await bestueckterEntwurf(bau);
    await expect(alsApp(sitzung(f.reinigung, leser), (tx) =>
      tx.unsafe(`select fin.abrufstatus_nachziehen($1::uuid)`, [original])))
      .rejects.toThrow(/festschreiben, stornieren oder verwerfen/);
  });

  it('eine Rechnung einer anderen Gesellschaft bleibt unberührt', async () => {
    const original = await bestueckterEntwurf(bau);
    await macheFakturierfaehig(f.bau, 'BA');
    await machtMitglied(benutzer, f.bau, await systemrolle('admin'));
    await expect(alsApp(sitzung(f.bau), (tx) =>
      tx.unsafe(`select fin.abrufstatus_nachziehen($1::uuid)`, [original])))
      .rejects.toThrow(/gehoert nicht zur aktiven Gesellschaft/);
  });
});

describe('V-395 — was das Verwerfen freigibt', () => {
  it('eine Zeile „von Hand" aus einer Vereinbarung ist als solche erkennbar', async () => {
    const pauschal = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(pauschal, 'monatspauschale', { teilmonat: 'kalendertage' },
      189_000n);
    const id = await bestueckterEntwurf(pauschal);

    // Daneben eine Zeile „von Hand" ohne Vereinbarung — sie hält nichts fest.
    await alsApp(sitzung(f.reinigung), (tx) => fuegePositionHinzu(alsDienst(tx), {
      rechnungId: id, bezeichnung: 'Anfahrt Sonderfahrt',
      menge: milliMenge(1000n), einheit: 'stk',
      einzelpreisCent: cent(4_500n), steuergruppe: 'ust_19',
      quellen: vonHand('Mit dem Kunden am Telefon vereinbart'),
    }));

    const quellen = await alsApp(sitzung(f.reinigung), (tx) => ladeQuellen(alsDienst(tx), id));
    // Die Pauschale beansprucht ihren Monat (V-207): von Hand, AUS der Vereinbarung.
    expect(quellen.map((q) => [q.positionNr, q.typ, q.quelleId, q.ausVereinbarung])).toEqual([
      [1, 'manuell', null, true],
      [2, 'manuell', null, false],
    ]);
  });
});
