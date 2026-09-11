/**
 * PR 48 — die fünf Abrechnungsarten gegen eine ECHTE Datenbank (FIN-01).
 *
 * Keine dieser Aussagen lässt sich mocken. „Auf den Cent" ist eine Aussage über
 * das, was in `rechnungsposition.netto_cent` und `rechnung_steuer.steuer_cent`
 * WIRKLICH steht — nachdem die Datenbank die Menge auf `numeric(12,3)` gerundet
 * und den Dienst hat rechnen lassen. „Die Stundenzeile stimmt mit dem
 * Stundenkonto überein" ist eine Aussage über zwei Wege durch dieselben
 * Zeiteinträge. Und „ein nicht gegengezeichnetes Aufmaß wird verweigert" ist
 * eine Aussage über einen Zustand, den ein Auslöser setzt.
 *
 * **Jede Prüfung fällt ohne die Umsetzung.** Wo das nicht offensichtlich ist,
 * steht daneben, was man entfernen müsste, damit sie fällt.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import { legeEntwurfAn, type Abfrage } from '../../src/server/services/finanz/rechnung.js';
import {
  AbrechnungFehler, alleAbrechnungsarten, berechneAbrechnung, berechneMitKonfiguration,
  beendeKonfiguration, bestuecke, bestueckeAusAbrechnungsart, entferne, hole,
  ladeKonfiguration, legeKonfigurationAn as schreibeKonfiguration, registriere,
  type Abrechnungsart, type RechnungspositionEntwurf, type VertragAbrechnung,
} from '../../src/server/services/finanz/abrechnungsart/index.js';
import { bucheFreigegebeneZeiten, eroeffneKonto }
  from '../../src/server/services/zeit/stundenkonto.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Der schmale Treiberausschnitt, den jeder Dienst hier erwartet. */
function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function alsKontext(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

let benutzer: string;

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

/**
 * Die Mitgliedschaft in der Gesellschaft.
 *
 * `auftrag.verantwortlich_benutzer_id` verlangt einen Menschen, der DIESER
 * Gesellschaft angehört („Der Verantwortliche gehoert nicht zu dieser
 * Gesellschaft") — eine globale Rolle allein genügt nicht, und das ist richtig
 * so: verantwortlich ist man für einen Auftrag, nicht für eine Plattform.
 */
async function machtMitglied(mandantId: string, rolle = 'admin'): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null))`,
    [benutzer, mandantId, rolle]);
}

/** Eine Gesellschaft, die fakturieren darf — §14-Pflichtfelder inklusive. */
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

interface Auftragsbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly objekt: string;
  readonly auftrag: string;
  readonly leistung: string;
  readonly person: string;
  readonly anstellung: string;
}

/**
 * Ein Auftrag mit EINER Leistungszeile zu 19 %, einem Objekt und einer
 * Beschäftigung, die darauf Zeit bucht.
 */
async function baueAuftrag(
  mandant: string,
  opts: { einzelpreisCent?: bigint; einheit?: string; satzBp?: number } = {},
): Promise<Auftragsbau> {
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
     values ($1,$2,1,$3,'Unterhaltsreinigung Bürohaus',$4,$5,$6,'regelsatz','2026-01-01')
     returning id`,
    [mandant, a!.id, o!.id, opts.einheit ?? 'stk',
     opts.einzelpreisCent ?? 12_500n, opts.satzBp ?? 1900] as never[]);

  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Aylin',$1) returning id`,
    [`Demir-${zufall()}`]);
  const [anst] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
     values ($1,$2,$3,'2026-01-01') returning id`,
    [mandant, p!.id, `PN-${zufall()}`] as never[]);

  return {
    mandant, kunde: k!.id, objekt: o!.id, auftrag: a!.id, leistung: l!.id,
    person: p!.id, anstellung: anst!.id,
  };
}

interface KonfigurationsWunsch {
  readonly art: string;
  readonly parameter: Record<string, unknown>;
  readonly pauschaleNettoCent?: bigint;
  readonly stundensatzCent?: bigint;
  readonly festpreisNettoCent?: bigint;
  readonly intervall?: string;
  readonly modus?: string;
  readonly gueltigAb?: string;
  readonly gueltigBis?: string | null;
  readonly aufLeistung?: boolean;
}

async function legeKonfigurationAn(
  bau: Auftragsbau, wunsch: KonfigurationsWunsch,
): Promise<string> {
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into vertrag_abrechnung
       (mandant_id, auftrag_id, auftrag_leistung_id, abrechnungsart, parameter,
        pauschale_netto_cent, stundensatz_cent, festpreis_netto_cent,
        abrechnungsintervall, leistungszeitraum_modus, gueltig_ab, gueltig_bis)
     values ($1,$2,$3::uuid,$4::abrechnungsart,($5::text)::jsonb,$6::bigint,$7::bigint,$8::bigint,
             $9::abrechnungsintervall,$10::leistungszeitraum_modus,$11::date,$12::date)
     returning id`,
    [
      bau.mandant, bau.auftrag, wunsch.aufLeistung === true ? bau.leistung : null,
      wunsch.art, JSON.stringify(wunsch.parameter),
      wunsch.pauschaleNettoCent ?? null, wunsch.stundensatzCent ?? null,
      wunsch.festpreisNettoCent ?? null,
      wunsch.intervall ?? 'monatlich', wunsch.modus ?? 'kalendermonat',
      wunsch.gueltigAb ?? '2026-01-01', wunsch.gueltigBis ?? null,
    ] as never[]);
  return v!.id;
}

/** Eine freigegebene Schicht auf der Leistungszeile — Berliner Wanduhr. */
async function baueZeiteintrag(
  bau: Auftragsbau, tag: string, von: string, bis: string, pause = 0,
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, objekt_id, auftrag_leistung_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, freigegeben_am, freigegeben_von, erstellt_von_art)
     values ($1,$2,$3,$4,$5,
             ($6 || ' ' || $7)::timestamp at time zone 'Europe/Berlin',
             ($6 || ' ' || $8)::timestamp at time zone 'Europe/Berlin',
             $9, 'import','import','import','import','abgeschlossen', now(), $10, 'system')
     returning id`,
    [bau.mandant, bau.anstellung, bau.person, bau.objekt, bau.leistung,
     tag, von, bis, pause, benutzer] as never[]);
  return z!.id;
}

function sitzung(mandantId: string) {
  return {
    scope: 'mandant' as const, mandantId, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

/** Der Entwurf, in den eine Abrechnungsart hineinschreibt. */
async function entwurf(tx: postgres.TransactionSql, bau: Auftragsbau): Promise<string> {
  return legeEntwurfAn(alsDienst(tx), {
    kundeId: bau.kunde, objektId: bau.objekt, auftragId: bau.auftrag,
    leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
  });
}

interface PositionsZeile {
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly menge: string;
  readonly einheit: string;
  readonly preis_basismenge: string;
  readonly einzelpreis_cent: string;
  readonly netto_cent: string;
  readonly abrechnungsart: string | null;
  readonly vertrag_abrechnung_id: string | null;
  readonly lv_position_id: string | null;
  readonly leistung_von: string | null;
}

async function positionen(rechnungId: string): Promise<readonly PositionsZeile[]> {
  return sql.unsafe<PositionsZeile[]>(
    `select bezeichnung, beschreibung, menge::text, einheit, preis_basismenge::text,
            einzelpreis_cent::text, netto_cent::text,
            abrechnungsart::text as abrechnungsart,
            vertrag_abrechnung_id::text as vertrag_abrechnung_id,
            lv_position_id::text as lv_position_id,
            to_char(leistung_von, 'YYYY-MM-DD') as leistung_von
       from rechnungsposition where rechnung_id = $1 order by position_nr`,
    [rechnungId]);
}

interface SteuerZeile {
  readonly schluessel: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

async function steuerzeilen(rechnungId: string): Promise<readonly SteuerZeile[]> {
  return sql.unsafe<SteuerZeile[]>(
    `select g.schluessel, s.satz_bp, s.netto_cent::text, s.steuer_cent::text
       from rechnung_steuer s join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
      where s.rechnung_id = $1 and s.netto_cent <> 0
      order by g.schluessel`,
    [rechnungId]);
}

async function kopf(rechnungId: string): Promise<{
  netto_gesamt_cent: string; steuer_gesamt_cent: string; brutto_cent: string;
}> {
  const [r] = await sql.unsafe<{
    netto_gesamt_cent: string; steuer_gesamt_cent: string; brutto_cent: string;
  }[]>(
    `select netto_gesamt_cent::text, steuer_gesamt_cent::text, brutto_cent::text
       from rechnung where id = $1`, [rechnungId]);
  return r!;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`abrechnung-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung, 'RE');
  await macheFakturierfaehig(f.bau, 'BA');
  await machtMitglied(f.reinigung);
  await machtMitglied(f.bau);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------
// (4) Ohne Abrechnungsart wird nicht gerechnet — und es gibt keinen Vorgabewert
// ---------------------------------------------------------------------------

describe('(4) ein Auftrag ohne Abrechnungsart lässt sich nicht berechnen', () => {
  it('wirft einen GETIPPTEN Fehler, statt auf eine Art zurückzufallen', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const fehler = await alsApp(sitzung(f.reinigung), async (tx) => {
      try {
        await berechneAbrechnung(alsDienst(tx), {
          auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        });
        return null;
      } catch (e) { return e; }
    });
    // Fiele hier ein `?? 'stundenbasiert'` in `ladeKonfiguration` hinein, ginge
    // diese Prüfung durch und die Plattform stellte Rechnungen nach einer
    // Regel aus, die im Vertrag nicht steht.
    expect(fehler).toBeInstanceOf(AbrechnungFehler);
    expect((fehler as AbrechnungFehler).grund).toBe('keine_abrechnungsart');
    expect((fehler as AbrechnungFehler).message).toMatch(/keinen Vorgabewert/u);
  });

  it('eine Konfiguration, die den Zeitraum nicht berührt, gilt als keine', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'monatspauschale', parameter: { teilmonat: 'keine' },
      pauschaleNettoCent: 100_000n, gueltigAb: '2026-01-01', gueltigBis: '2026-06-30',
    });
    const fehler = await alsApp(sitzung(f.reinigung), async (tx) => {
      try {
        await ladeKonfiguration(alsDienst(tx), {
          auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        });
        return null;
      } catch (e) { return e; }
    });
    expect((fehler as AbrechnungFehler).grund).toBe('keine_abrechnungsart');
  });

  it('aber eine zum 15. beendete Konfiguration FINDET der Lauf (review B9)', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'monatspauschale', parameter: { teilmonat: 'kalendertage' },
      pauschaleNettoCent: 100_000n, gueltigAb: '2026-01-01', gueltigBis: '2026-08-15',
    });
    const gefunden = await alsApp(sitzung(f.reinigung), (tx) =>
      ladeKonfiguration(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      }));
    // Mit einem `where gueltig_bis is null` fiele genau diese Zeile heraus und
    // die Leistung vom 1. bis 15. August würde nie berechnet.
    expect(gefunden.gueltigBis).toBe('2026-08-15');
  });
});

// ---------------------------------------------------------------------------
// (1) + (2) Stundenlohn
// ---------------------------------------------------------------------------

describe('(1) Stundenlohn: aus Zeiteinträgen, auf den Cent', () => {
  it('105 Minuten × 25,00 €/Std. ergeben 43,75 € netto und 8,31 € Steuer', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'stundenbasiert', parameter: { minuten_rundung: 15 },
      stundensatzCent: 2_500n, aufLeistung: true,
    });
    // 8:00–9:00 und 13:00–13:45 = 60 + 45 = 105 Minuten.
    await baueZeiteintrag(bau, '2026-08-03', '08:00', '09:00');
    await baueZeiteintrag(bau, '2026-08-04', '13:00', '13:45');

    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });

    const zeilen = await positionen(rechnungId);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.menge).toBe('105.000');
    expect(zeilen[0]!.einheit).toBe('min');
    // BT-149/150: der Stundensatz gilt je 60 Minuten. Ohne die Basismenge
    // stünde hier ein Stückpreis je MINUTE und die Zeile wäre falsch.
    expect(zeilen[0]!.preis_basismenge).toBe('60.000');
    expect(zeilen[0]!.einzelpreis_cent).toBe('2500');
    expect(zeilen[0]!.netto_cent).toBe('4375');
    expect(zeilen[0]!.abrechnungsart).toBe('stundenbasiert');

    const steuer = await steuerzeilen(rechnungId);
    expect(steuer).toHaveLength(1);
    expect(steuer[0]!.schluessel).toBe('ust_19');
    expect(steuer[0]!.steuer_cent).toBe('831'); // 4375 × 19 % = 831,25 → 831
    expect((await kopf(rechnungId)).brutto_cent).toBe('5206');
  });

  it('100 Minuten minutengenau ergeben 41,67 € — nicht 41,68 €', async () => {
    /**
     * Der Cent, um den es geht. In Stunden mit drei Nachkommastellen wären
     * 100 Minuten `1,667`, und `1,667 × 25,00 €` ist 41,68 €. Die Zeile führt
     * deshalb Minuten. Ersetzte man `einheit: 'min'` durch Stunden, stünde hier
     * `4168`.
     */
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'stundenbasiert', parameter: { minuten_rundung: 1 },
      stundensatzCent: 2_500n, aufLeistung: true,
    });
    await baueZeiteintrag(bau, '2026-08-03', '08:00', '09:40');

    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });
    const zeilen = await positionen(rechnungId);
    expect(zeilen[0]!.menge).toBe('100.000');
    expect(zeilen[0]!.netto_cent).toBe('4167');
  });

  it('die Pause zählt nicht mit — netto, nicht brutto', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'stundenbasiert', parameter: { minuten_rundung: 1 },
      stundensatzCent: 2_500n, aufLeistung: true,
    });
    // 8:00–16:00 = 480 Minuten brutto, 30 Minuten Pause = 450 netto.
    await baueZeiteintrag(bau, '2026-08-05', '08:00', '16:00', 30);
    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });
    expect((await positionen(rechnungId))[0]!.menge).toBe('450.000');
  });
});

describe('(2) die Stundenzeile ist neu gerechnet und stimmt mit dem Stundenkonto überein', () => {
  it('Rechnungszeile und stundenkonto.ist_minuten nennen dieselbe Minutenzahl', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'stundenbasiert', parameter: { minuten_rundung: 1 },
      stundensatzCent: 2_500n, aufLeistung: true,
    });
    await baueZeiteintrag(bau, '2026-08-03', '08:00', '12:00');           // 240
    await baueZeiteintrag(bau, '2026-08-04', '08:00', '16:00', 30);       // 450
    await baueZeiteintrag(bau, '2026-08-05', '22:00', '23:30');           //  90

    const kontoMinuten = await alsApp(sitzung(f.reinigung), async (tx) => {
      const kontext = alsKontext(tx, f.reinigung, benutzer);
      await eroeffneKonto(kontext, {
        anstellungId: bau.anstellung, jahr: 2026, monat: 8,
      });
      const ergebnis = await bucheFreigegebeneZeiten(kontext, {
        anstellungId: bau.anstellung, jahr: 2026, monat: 8,
      });
      return ergebnis.minuten;
    });
    expect(kontoMinuten).toBe(780);

    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });

    const zeilen = await positionen(rechnungId);
    // Dieselbe Zahl auf zwei Wegen: einmal über die Monatsanteile des
    // Stundenkontos, einmal über die Zeiteinträge des Abrechnungslaufs.
    expect(zeilen[0]!.menge).toBe('780.000');
    expect(zeilen[0]!.netto_cent).toBe('32500'); // 780/60 × 25,00 €
  });

  it('der Dienst RECHNET — eine Zahl aus der Oberfläche erreicht die Zeile nicht', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'stundenbasiert', parameter: { minuten_rundung: 1 },
      stundensatzCent: 2_500n, aufLeistung: true,
    });
    await baueZeiteintrag(bau, '2026-08-03', '08:00', '10:00');

    const { entwuerfe, rechnungId } = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      const ergebnis = await berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      /**
       * Eine manipulierte Vorschau: der Betrag wird verdoppelt, Menge und
       * Preis bleiben. Geschrieben wird trotzdem der GERECHNETE Betrag —
       * `fuegePositionHinzu` bildet ihn aus Menge, Basismenge und Einzelpreis
       * und nimmt `nettoCent` gar nicht entgegen.
       */
      const manipuliert: RechnungspositionEntwurf[] = ergebnis.positionen.map((p) => ({
        ...p, nettoCent: cent(p.nettoCent * 2n),
      }));
      await bestuecke(alsDienst(tx), id, manipuliert);
      return { entwuerfe: manipuliert, rechnungId: id };
    });

    expect(entwuerfe[0]!.nettoCent).toBe(10_000n);
    expect((await positionen(rechnungId))[0]!.netto_cent).toBe('5000');
  });

  it('eine nicht freigegebene Zeit fließt nicht in die Rechnung', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'stundenbasiert', parameter: { minuten_rundung: 1 },
      stundensatzCent: 2_500n, aufLeistung: true,
    });
    const id = await baueZeiteintrag(bau, '2026-08-03', '08:00', '10:00');
    await sql.unsafe(
      `update zeiteintrag set freigegeben_am = null, freigegeben_von = null where id = $1`,
      [id]);

    const fehler = await alsApp(sitzung(f.reinigung), async (tx) => {
      const r = await entwurf(tx, bau);
      try {
        await bestueckeAusAbrechnungsart(alsDienst(tx), r, {
          auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        });
        return null;
      } catch (e) { return e; }
    });
    expect(fehler).toBeInstanceOf(AbrechnungFehler);
  });
});

// ---------------------------------------------------------------------------
// (1) Monatspauschale
// ---------------------------------------------------------------------------

describe('(1) Monatspauschale: voller Monat und angebrochener Monat', () => {
  it('ein voller Monat ist EINE Zeile über 1 Monat zum vereinbarten Betrag', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'monatspauschale', parameter: { teilmonat: 'kalendertage' },
      pauschaleNettoCent: 189_000n, aufLeistung: true,
    });
    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });
    const zeilen = await positionen(rechnungId);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.menge).toBe('1.000');
    expect(zeilen[0]!.einheit).toBe('monat');
    expect(zeilen[0]!.netto_cent).toBe('189000');
    const steuer = await steuerzeilen(rechnungId);
    expect(steuer[0]!.steuer_cent).toBe('35910'); // 189000 × 19 %
  });

  it('15 von 31 Tagen ergeben 914,52 € — anteilig, EINMAL gerundet', async () => {
    /**
     * `189000 × 15 / 31 = 91451,6…` → 91452 Cent. Über einen Bruchteil eines
     * Monats (`0,484`) gerechnet käme 91476 Cent heraus: 24 Cent daneben, weil
     * `15/31` in drei Nachkommastellen nicht darstellbar ist. Deshalb führt die
     * Zeile TAGE und `preis_basismenge` die Monatslänge.
     */
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'monatspauschale', parameter: { teilmonat: 'kalendertage' },
      pauschaleNettoCent: 189_000n, gueltigBis: '2026-08-15', aufLeistung: true,
    });
    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });
    const zeilen = await positionen(rechnungId);
    expect(zeilen[0]!.menge).toBe('15.000');
    expect(zeilen[0]!.preis_basismenge).toBe('31.000');
    expect(zeilen[0]!.netto_cent).toBe('91452');
  });

  it('„teilmonat = keine" berechnet den angebrochenen Monat voll', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'monatspauschale', parameter: { teilmonat: 'keine' },
      pauschaleNettoCent: 189_000n, gueltigBis: '2026-08-15', aufLeistung: true,
    });
    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });
    expect((await positionen(rechnungId))[0]!.netto_cent).toBe('189000');
  });

  it('ein Quartal ergibt DREI Monatszeilen, nicht eine gerundete', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'monatspauschale', parameter: { teilmonat: 'keine' },
      pauschaleNettoCent: 100_000n, intervall: 'quartalsweise', aufLeistung: true,
    });
    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-07-01', bis: '2026-09-30' },
      });
      return id;
    });
    const zeilen = await positionen(rechnungId);
    expect(zeilen).toHaveLength(3);
    expect(zeilen.map((z) => z.leistung_von)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect((await kopf(rechnungId)).netto_gesamt_cent).toBe('300000');
  });

  it('„arbeitstage" im Teilmonat wird VERWEIGERT, nicht geschätzt', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn(bau, {
      art: 'monatspauschale', parameter: { teilmonat: 'arbeitstage' },
      pauschaleNettoCent: 189_000n, gueltigBis: '2026-08-15', aufLeistung: true,
    });
    const ergebnis = await alsApp(sitzung(f.reinigung), (tx) =>
      berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      }));
    expect(ergebnis.positionen).toHaveLength(0);
    expect(ergebnis.befunde.some((b) => b.art === 'fehler' && b.offeneFrage === 'O-04'))
      .toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (1) Pauschalpreis-Los
// ---------------------------------------------------------------------------

describe('(1) Pauschalpreis-Los: erst bei Abnahme oder anteilig', () => {
  it('ohne Abnahme wird nicht gerechnet — mit Abnahme der volle Betrag', async () => {
    const bau = await baueAuftrag(f.bau);
    await legeKonfigurationAn(bau, {
      art: 'festpreis_los', parameter: { teilleistung: 'erst_bei_abnahme' },
      festpreisNettoCent: 1_250_000n, intervall: 'einmalig', modus: 'manuell',
    });

    const ohne = await alsApp(sitzung(f.bau), (tx) =>
      berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      }));
    expect(ohne.positionen).toHaveLength(0);
    expect(ohne.befunde.some((b) => b.feld === 'abnahme_am')).toBe(true);

    await sql.unsafe(`update auftrag set abnahme_am = '2026-08-20' where id = $1`,
      [bau.auftrag]);

    const rechnungId = await alsApp(sitzung(f.bau), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });
    const zeilen = await positionen(rechnungId);
    expect(zeilen[0]!.einheit).toBe('psch');
    expect(zeilen[0]!.netto_cent).toBe('1250000');
    expect((await steuerzeilen(rechnungId))[0]!.steuer_cent).toBe('237500');
  });

  it('anteilig zu 33,33 % ergeben 4.166,25 € — EINE Rundung, in geld.ts', async () => {
    const bau = await baueAuftrag(f.bau);
    await legeKonfigurationAn(bau, {
      art: 'festpreis_los', parameter: { teilleistung: 'anteilig' },
      festpreisNettoCent: 1_250_000n, intervall: 'einmalig', modus: 'manuell',
    });
    const rechnungId = await alsApp(sitzung(f.bau), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        fertigstellungBp: 3333,
      });
      return id;
    });
    // 1.250.000 × 3333 / 10000 = 416.625 Cent, exakt.
    expect((await positionen(rechnungId))[0]!.netto_cent).toBe('416625');
  });

  it('anteilig OHNE Fertigstellungsgrad wird verweigert, nicht geschätzt', async () => {
    const bau = await baueAuftrag(f.bau);
    await legeKonfigurationAn(bau, {
      art: 'festpreis_los', parameter: { teilleistung: 'anteilig' },
      festpreisNettoCent: 1_250_000n, intervall: 'einmalig', modus: 'manuell',
    });
    const ergebnis = await alsApp(sitzung(f.bau), (tx) =>
      berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      }));
    expect(ergebnis.positionen).toHaveLength(0);
    expect(ergebnis.befunde.some((b) => b.feld === 'fertigstellung_bp')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (3) Einheitspreis nach Aufmaß
// ---------------------------------------------------------------------------

interface Blattbau extends Auftragsbau {
  readonly projekt: string;
  readonly lv: string;
  readonly lvPosition: string;
}

/** Ein Projekt mit LV-Position zu 45,99 €/m² auf der Leistungszeile des Auftrags. */
async function baueProjekt(bauMandant: string): Promise<Blattbau> {
  const bau = await baueAuftrag(bauMandant, { einheit: 'm2', einzelpreisCent: 4_599n });
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b') returning id`,
    [bau.mandant, bau.auftrag, `P-${zufall()}`, bau.kunde] as never[]);
  const [lv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Rohbau') returning id`,
    [bau.mandant, p!.id] as never[]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id,
                              auftrag_leistung_id, oz, pfad, sortier_pfad, ebene, art,
                              kurztext, einheit, menge_vertrag, einheitspreis_cent)
     values ($1,$2,$3,$4,'01.02.0030','','',1,'position','Mauerwerk','m²',120,4599)
     returning id`,
    [bau.mandant, lv!.id, p!.id, bau.leistung] as never[]);
  return { ...bau, projekt: p!.id, lv: lv!.id, lvPosition: pos!.id };
}

/** Ein Blatt mit dem Rechenansatz aus SPEC §8 — 30,87 m². */
async function baueBlatt(
  bau: Blattbau,
  opts: { ergebnis?: number; ansatz?: string } = {},
): Promise<string> {
  const [blatt] = await sql.unsafe<{ id: string }[]>(
    `insert into aufmass (mandant_id, projekt_id, kunde_id, nummer, bezeichnung, messdatum,
                          erhebungsart, leistungsverzeichnis_id)
     values ($1,$2,$3,$4,'Wand Achse C, OG1','2026-08-10','gemeinsam',$5) returning id`,
    [bau.mandant, bau.projekt, bau.kunde, `A-${zufall()}`, bau.lv] as never[]);
  const ergebnis = opts.ergebnis ?? 308_700;
  await sql.unsafe(
    `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id, lv_position_id,
                                reihenfolge, bezeichnung, rechenansatz, ergebnis_skaliert,
                                menge, einheit)
     values ($1,$2,$3,$3,$4,1,'Wand Achse C',$5,($6::text)::bigint,
             round(($6::text)::numeric/10000,3),'m²')`,
    [bau.mandant, blatt!.id, bau.projekt, bau.lvPosition,
     opts.ansatz ?? '3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)', ergebnis] as never[]);
  return blatt!.id;
}

/** Foto, Vorlage und die Unterschrift des AUFTRAGGEBERS. */
async function gegenzeichne(bau: Blattbau, blattId: string): Promise<void> {
  const pfad = `${bau.mandant}/${crypto.randomUUID()}`;
  const [m] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad,
                                 mime_typ, groesse_bytes, sha256, erstellt_von_art)
     values ($1,'aufmass',$2,'foto','einsatz-medien',$3,'image/jpeg',12345,repeat('a',64),
             'system') returning id`,
    [bau.mandant, blattId, pfad] as never[]);
  await sql.unsafe(
    `insert into aufmass_foto (mandant_id, aufmass_id, kunde_id, medien_id, zweck,
                               erstellt_von_art)
     values ($1,$2,$3,$4,'nachweis','system')`,
    [bau.mandant, blattId, bau.kunde, m!.id] as never[]);
  await sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blattId]);
  await sql.unsafe(
    `insert into aufmass_signatur (mandant_id, aufmass_id, kunde_id, rolle, anstellung_id,
                                   unterzeichner_name, snapshot, snapshot_hash,
                                   erstellt_von_art)
     values ($1,$2,$3,'auftraggeber',null,'Frau Beyer','{}'::jsonb,repeat('b',64),'system')`,
    [bau.mandant, blattId, bau.kunde] as never[]);
}

describe('(3) Einheitspreis nach Aufmaß', () => {
  it('nimmt das GESPEICHERTE Ergebnis, druckt den Rechenansatz, rechnet auf den Cent',
    async () => {
      const bau = await baueProjekt(f.bau);
      const blatt = await baueBlatt(bau);
      await gegenzeichne(bau, blatt);
      await legeKonfigurationAn(bau, {
        art: 'einheitspreis_aufmass',
        parameter: { abrechenbare_aufmass_zustaende: ['gegengezeichnet'] },
        intervall: 'nach_leistung', modus: 'manuell',
      });

      const rechnungId = await alsApp(sitzung(f.bau), async (tx) => {
        const id = await entwurf(tx, bau);
        await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
          auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
          aufmassIds: [blatt],
        });
        return id;
      });

      const zeilen = await positionen(rechnungId);
      expect(zeilen).toHaveLength(1);
      // `308700` in 10⁻⁴ m² sind 30,870 m² — die Projektion, die auch die
      // Datenbank auf `aufmass_zeile.menge` erzwingt.
      expect(zeilen[0]!.menge).toBe('30.870');
      expect(zeilen[0]!.einheit).toBe('m2');
      // 30,870 m² × 45,99 € = 1419,7113 € → 141.971 Cent, halb auf.
      expect(zeilen[0]!.netto_cent).toBe('141971');
      expect(zeilen[0]!.lv_position_id).toBe(bau.lvPosition);
      // ABNAHME (3): der Rechenansatz steht wörtlich auf der Zeile.
      expect(zeilen[0]!.beschreibung).toContain('3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)');
      expect((await steuerzeilen(rechnungId))[0]!.steuer_cent).toBe('26974');
    });

  it('summiert in der festen Skala und projiziert EINMAL — nicht je Zeile', async () => {
    /**
     * Zwei Zeilen zu je `5` (10⁻⁴), also 0,0005 m² zusammen. Je Zeile
     * projiziert wäre jede `0,001` (halb auf) und die Summe `0,002`; in der
     * festen Skala summiert sind es `10` → `0,001`. Der Unterschied ist genau
     * die Rundung, die einmal am Ende steht.
     */
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau, { ergebnis: 5, ansatz: '0,0005' });
    await sql.unsafe(
      `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id,
                                  lv_position_id, reihenfolge, bezeichnung, rechenansatz,
                                  ergebnis_skaliert, menge, einheit)
       values ($1,$2,$3,$3,$4,2,'Rest','0,0005',5,round(5::numeric/10000,3),'m²')`,
      [bau.mandant, blatt, bau.projekt, bau.lvPosition] as never[]);
    await gegenzeichne(bau, blatt);
    await legeKonfigurationAn(bau, {
      art: 'einheitspreis_aufmass',
      parameter: { abrechenbare_aufmass_zustaende: ['gegengezeichnet'] },
      intervall: 'nach_leistung', modus: 'manuell',
    });
    const ergebnis = await alsApp(sitzung(f.bau), (tx) =>
      berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        aufmassIds: [blatt],
      }));
    expect(ergebnis.positionen[0]!.menge).toBe(1n);
  });

  it('VERWEIGERT ein nicht gegengezeichnetes Aufmaß — es wird nicht übersprungen',
    async () => {
      const bau = await baueProjekt(f.bau);
      const blatt = await baueBlatt(bau);
      await legeKonfigurationAn(bau, {
        art: 'einheitspreis_aufmass',
        parameter: { abrechenbare_aufmass_zustaende: ['gegengezeichnet'] },
        intervall: 'nach_leistung', modus: 'manuell',
      });
      const { ergebnis, fehler } = await alsApp(sitzung(f.bau), async (tx) => {
        const vorschau = await berechneAbrechnung(alsDienst(tx), {
          auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
          aufmassIds: [blatt],
        });
        // Und derselbe Weg an der Vorprüfung vorbei: die Strategie selbst.
        try {
          await hole('einheitspreis_aufmass').positionen(alsDienst(tx), {
            konfiguration: await ladeKonfiguration(alsDienst(tx), {
              auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
            }),
            periode: { von: '2026-08-01', bis: '2026-08-31' },
            aufmassIds: [blatt],
          });
          return { ergebnis: vorschau, fehler: null };
        } catch (e) { return { ergebnis: vorschau, fehler: e }; }
      });
      // Das Blatt steht auf `entwurf`. Ein `where status = 'gegengezeichnet'`
      // in der Abfrage statt dieser Prüfung ergäbe eine Rechnung ohne die
      // Leistung — und niemand sähe, dass etwas fehlt.
      expect(ergebnis.positionen).toHaveLength(0);
      expect(ergebnis.befunde.some((b) => b.feld === 'aufmass.status')).toBe(true);
      expect(fehler).toBeInstanceOf(AbrechnungFehler);
      expect((fehler as AbrechnungFehler).grund).toBe('aufmass_nicht_abrechenbar');
      expect((fehler as AbrechnungFehler).message).toMatch(/entwurf/u);
    });

  it('ein einseitig festgestelltes Blatt gilt nur, wenn der Vertrag es führt', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    const pfad = `${bau.mandant}/${crypto.randomUUID()}`;
    const [m] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad,
                                   mime_typ, groesse_bytes, sha256, erstellt_von_art)
       values ($1,'aufmass',$2,'foto','einsatz-medien',$3,'image/jpeg',1,repeat('a',64),
               'system') returning id`,
      [bau.mandant, blatt, pfad] as never[]);
    await sql.unsafe(
      `insert into aufmass_foto (mandant_id, aufmass_id, kunde_id, medien_id, zweck,
                                 erstellt_von_art)
       values ($1,$2,$3,$4,'nachweis','system')`,
      [bau.mandant, blatt, bau.kunde, m!.id] as never[]);
    await sql.unsafe(
      `update aufmass set erhebungsart = 'einseitig', ankuendigung_am = '2026-08-05',
              status = 'vorgelegt' where id = $1`, [blatt]);
    await sql.unsafe(
      `insert into aufmass_signatur (mandant_id, aufmass_id, kunde_id, rolle, anstellung_id,
                                     unterzeichner_name, snapshot, snapshot_hash,
                                     erstellt_von_art)
       values ($1,$2,$3,'auftragnehmer',$4::uuid,'Polier','{}'::jsonb,repeat('b',64),
               'system')`,
      [bau.mandant, blatt, bau.kunde, bau.anstellung] as never[]);

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from aufmass where id = $1`, [blatt]);
    expect(z!.status).toBe('einseitig_festgestellt');

    await legeKonfigurationAn(bau, {
      art: 'einheitspreis_aufmass',
      parameter: { abrechenbare_aufmass_zustaende: ['gegengezeichnet'] },
      intervall: 'nach_leistung', modus: 'manuell',
    });
    const abgewiesen = await alsApp(sitzung(f.bau), (tx) =>
      berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        aufmassIds: [blatt],
      }));
    expect(abgewiesen.positionen).toHaveLength(0);
    expect(abgewiesen.befunde.some((b) => b.feld === 'aufmass.status')).toBe(true);

    await sql.unsafe(
      `update vertrag_abrechnung
          set parameter = '{"abrechenbare_aufmass_zustaende":
                            ["gegengezeichnet","einseitig_festgestellt"]}'::jsonb
        where auftrag_id = $1`, [bau.auftrag]);
    const ergebnis = await alsApp(sitzung(f.bau), (tx) =>
      berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        aufmassIds: [blatt],
      }));
    expect(ergebnis.positionen).toHaveLength(1);
  });

  it('ohne den Parameter wird gar nicht erst gerechnet (O-04)', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await gegenzeichne(bau, blatt);
    await legeKonfigurationAn(bau, {
      art: 'einheitspreis_aufmass', parameter: {},
      intervall: 'nach_leistung', modus: 'manuell',
    });
    const ergebnis = await alsApp(sitzung(f.bau), (tx) =>
      berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        aufmassIds: [blatt],
      }));
    expect(ergebnis.positionen).toHaveLength(0);
    expect(ergebnis.befunde.some(
      (b) => b.feld === 'parameter.abrechenbare_aufmass_zustaende' && b.offeneFrage === 'O-04',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (1) Einzelabruf
// ---------------------------------------------------------------------------

async function baueAbruf(
  bau: Auftragsbau, menge: string, tag: string, status = 'erbracht',
): Promise<string> {
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
             $7::numeric,'stk',$8::sonderleistung_status,'mensch',$9) returning id`,
    [bau.mandant, bau.objekt, bau.leistung, kp!.id, bau.kunde, tag, menge, status,
     benutzer] as never[]);
  return s!.id;
}

describe('(1) Einzelabruf', () => {
  it('rechnet jeden erbrachten Abruf als eigene Zeile zum Vertragspreis ab', async () => {
    const bau = await baueAuftrag(f.reinigung, { einheit: 'stk', einzelpreisCent: 8_900n });
    await legeKonfigurationAn(bau, {
      art: 'einzelabruf', parameter: { mindestabrufmenge: null },
      intervall: 'nach_leistung', aufLeistung: true,
    });
    await baueAbruf(bau, '2.000', '2026-08-12');
    await baueAbruf(bau, '1.000', '2026-08-20');

    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      await bestueckeAusAbrechnungsart(alsDienst(tx), id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
      return id;
    });
    const zeilen = await positionen(rechnungId);
    expect(zeilen).toHaveLength(2);
    // Der VERTRAGSpreis (89,00 €), nicht der Katalogpreis (99,00 €).
    expect(zeilen.map((z) => z.netto_cent)).toEqual(['17800', '8900']);
    expect((await kopf(rechnungId)).netto_gesamt_cent).toBe('26700');
    expect((await steuerzeilen(rechnungId))[0]!.steuer_cent).toBe('5073');
  });

  it('ein nur beauftragter Abruf wird nicht berechnet', async () => {
    const bau = await baueAuftrag(f.reinigung, { einheit: 'stk', einzelpreisCent: 8_900n });
    await legeKonfigurationAn(bau, {
      art: 'einzelabruf', parameter: { mindestabrufmenge: null },
      intervall: 'nach_leistung', aufLeistung: true,
    });
    await baueAbruf(bau, '2.000', '2026-08-12', 'beauftragt');
    const fehler = await alsApp(sitzung(f.reinigung), async (tx) => {
      try {
        await berechneAbrechnung(alsDienst(tx), {
          auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
        });
        return null;
      } catch (e) { return e; }
    });
    expect((fehler as AbrechnungFehler).grund).toBe('nichts_abzurechnen');
  });

  it('ohne den Parameter „mindestabrufmenge" wird nicht gerechnet (O-04)', async () => {
    const bau = await baueAuftrag(f.reinigung, { einheit: 'stk', einzelpreisCent: 8_900n });
    await legeKonfigurationAn(bau, {
      art: 'einzelabruf', parameter: {}, intervall: 'nach_leistung', aufLeistung: true,
    });
    await baueAbruf(bau, '2.000', '2026-08-12');
    const ergebnis = await alsApp(sitzung(f.reinigung), (tx) =>
      berechneAbrechnung(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      }));
    // „keine Mindestabnahme" ist eine ENTSCHEIDUNG (`null`) und nicht die
    // Abwesenheit eines Schlüssels.
    expect(ergebnis.positionen).toHaveLength(0);
    expect(ergebnis.befunde.some((b) => b.feld === 'parameter.mindestabrufmenge')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (5) Eine sechste Strategie kostet keine Zeile im Rechnungsdienst
// ---------------------------------------------------------------------------

describe('(5) eine sechste Abrechnungsart wird registriert, nicht eingebaut', () => {
  const SECHSTE_SCHLUESSEL = 'test_leistungsverzeichnis_pauschal';

  /**
   * Ein Testdoppel. Es kennt `rechnung.ts` nicht, `rechnung.ts` kennt es nicht,
   * und `abrechnungsart/index.ts` nennt es nirgends — es trägt sich selbst ein.
   */
  const SECHSTE: Abrechnungsart = {
    schluessel: SECHSTE_SCHLUESSEL,
    bezeichnung: 'Prüf-Abrechnungsart',
    istProvisorisch: true,
    offeneParameter: [],
    pruefe: () => Promise.resolve([]),
    positionen: (_db, eingabe) => Promise.resolve([{
      bezeichnung: 'Zeile einer sechsten Art',
      beschreibung: null,
      menge: milliMenge(2_000n),
      einheit: 'stk',
      preisBasismenge: milliMenge(1_000n),
      einzelpreisCent: cent(5_000n),
      nettoCent: cent(10_000n),
      steuergruppe: 'ust_19',
      abrechnungsart: SECHSTE_SCHLUESSEL,
      vertragAbrechnungId: eingabe.konfiguration.id,
      auftragLeistungId: eingabe.konfiguration.auftragLeistungId,
      lvPositionId: null,
      leistungVon: eingabe.periode.von,
      leistungBis: eingabe.periode.bis,
      herkunft: [
        { art: 'vertrag_abrechnung', id: eingabe.konfiguration.id, anteil: null },
      ],
    }]),
  };

  /**
   * **Der eine Preis einer sechsten Art: ein Aufzaehlungswert.**
   *
   * `02-CRM-OPERATIONS.md` §3.2 nennt ihn ausdrücklich — „one enum value, one
   * class and one registry line, with no change in the invoice engine". Genau
   * das wird hier gemacht: ein `add value`, ein Testdoppel, ein
   * `registriere(…)`. `rechnung.ts`, `bestuecke()` und `berechneMitKonfigura-
   * tion()` bleiben unberührt, und die Zeile entsteht trotzdem.
   */
  beforeAll(async () => {
    await sql.unsafe(
      `alter type abrechnungsart add value if not exists '${SECHSTE_SCHLUESSEL}'`);
  });
  beforeEach(() => { registriere(SECHSTE); });
  afterAll(() => { entferne(SECHSTE_SCHLUESSEL); });

  it('das Register nimmt sie auf, und `hole` findet sie', () => {
    expect(hole(SECHSTE_SCHLUESSEL)).toBe(SECHSTE);
    expect(alleAbrechnungsarten().map((a) => a.schluessel)).toContain(SECHSTE_SCHLUESSEL);
  });

  it('sie durchläuft dieselbe Erzeugung und schreibt eine echte Rechnungszeile', async () => {
    const bau = await baueAuftrag(f.reinigung);
    // Eine Konfiguration, die es in `vertrag_abrechnung` NICHT gibt: der
    // Aufzählungstyp kennt den Schlüssel nicht. Genau deshalb geht sie an
    // `berechneMitKonfiguration` — der Weg, den eine sechste Art nähme,
    // solange ihr Wert noch nicht in der Datenbank steht.
    const echt = await alsApp(sitzung(f.reinigung), async (tx) => {
      await legeKonfigurationAn(bau, {
        art: 'monatspauschale', parameter: { teilmonat: 'keine' },
        pauschaleNettoCent: 1n, aufLeistung: true,
      });
      return ladeKonfiguration(alsDienst(tx), {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' },
      });
    });
    const konfiguration: VertragAbrechnung = { ...echt, abrechnungsart: SECHSTE_SCHLUESSEL };

    const rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurf(tx, bau);
      const ergebnis = await berechneMitKonfiguration(
        alsDienst(tx), hole(SECHSTE_SCHLUESSEL), konfiguration,
        { periode: { von: '2026-08-01', bis: '2026-08-31' } },
      );
      await bestuecke(alsDienst(tx), id, ergebnis.positionen);
      return id;
    });

    const zeilen = await positionen(rechnungId);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.netto_cent).toBe('10000');
    // Die eingefrorene Kopie trägt den Schlüssel der SECHSTEN Art — keine der
    // fünf ist hier hineingeraten.
    expect(zeilen[0]!.abrechnungsart).toBe(SECHSTE_SCHLUESSEL);
    expect((await steuerzeilen(rechnungId))[0]!.steuer_cent).toBe('1900');
  });

  it('ein zweiter Eintrag unter demselben Schlüssel wird abgewiesen', () => {
    expect(() => registriere({ ...SECHSTE, bezeichnung: 'Doppelgänger' }))
      .toThrow(AbrechnungFehler);
  });
});


// ---------------------------------------------------------------------------
// Der Schreibweg: O-04 wird zu einer Datenänderung, nicht zu einer Codeänderung
// ---------------------------------------------------------------------------

describe('eine Abrechnungskonfiguration anlegen und beenden', () => {
  it('speichert nichts, solange ein Parameter der Art fehlt (O-04)', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const fehler = await alsApp(sitzung(f.reinigung), async (tx) => {
      try {
        await schreibeKonfiguration(alsDienst(tx), {
          auftragId: bau.auftrag,
          abrechnungsart: 'stundenbasiert',
          parameter: {},
          stundensatzCent: cent(2_500n),
          abrechnungsintervall: 'monatlich',
          leistungszeitraumModus: 'kalendermonat',
          gueltigAb: '2026-01-01',
        });
        return null;
      } catch (e) { return e; }
    });
    expect((fehler as AbrechnungFehler).grund).toBe('parameter_offen');
    const anzahl = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from vertrag_abrechnung where auftrag_id = $1`,
      [bau.auftrag]);
    // Nicht „angelegt und später abgewiesen": es steht keine Zeile da.
    expect(anzahl[0]!.n).toBe('0');
  });

  it('legt mit gesetztem Parameter an — und weist eine unbekannte Art ab', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const id = await alsApp(sitzung(f.reinigung), (tx) =>
      schreibeKonfiguration(alsDienst(tx), {
        auftragId: bau.auftrag,
        abrechnungsart: 'stundenbasiert',
        parameter: { minuten_rundung: 15 },
        stundensatzCent: cent(2_500n),
        abrechnungsintervall: 'monatlich',
        leistungszeitraumModus: 'kalendermonat',
        gueltigAb: '2026-01-01',
      }));
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);

    const fehler = await alsApp(sitzung(f.reinigung), async (tx) => {
      try {
        await schreibeKonfiguration(alsDienst(tx), {
          auftragId: bau.auftrag, abrechnungsart: 'gibt_es_nicht', parameter: {},
          abrechnungsintervall: 'monatlich', leistungszeitraumModus: 'kalendermonat',
          gueltigAb: '2027-01-01',
        });
        return null;
      } catch (e) { return e; }
    });
    expect((fehler as AbrechnungFehler).grund).toBe('unbekannte_abrechnungsart');
  });

  it('zwei überlappende Konfigurationen desselben Bereichs weist die DATENBANK ab', async () => {
    const bau = await baueAuftrag(f.reinigung);
    await legeKonfigurationAn2(bau, '2026-01-01', null);
    await expect(legeKonfigurationAn2(bau, '2026-06-01', null)).rejects.toThrow(
      /va_kein_ueberlapp/u);
  });

  it('eine laufende Konfiguration wird BEENDET, nicht überschrieben', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const id = await legeKonfigurationAn2(bau, '2026-01-01', null);
    await alsApp(sitzung(f.reinigung), (tx) =>
      beendeKonfiguration(alsDienst(tx), id, '2026-08-15'));
    const [z] = await sql.unsafe<{ gueltig_bis: string }[]>(
      `select to_char(gueltig_bis, 'YYYY-MM-DD') as gueltig_bis
         from vertrag_abrechnung where id = $1`, [id]);
    expect(z!.gueltig_bis).toBe('2026-08-15');

    // Und danach passt die Nachfolgerin lückenlos daneben.
    const nachfolger = await legeKonfigurationAn2(bau, '2026-08-16', null);
    expect(nachfolger).not.toBe(id);
  });
});

/** Dieselbe Konfiguration, nur mit Zeitraum — als Kurzform für die Überlappung. */
async function legeKonfigurationAn2(
  bau: Auftragsbau, ab: string, bis: string | null,
): Promise<string> {
  return alsApp(sitzung(bau.mandant), (tx) =>
    schreibeKonfiguration(alsDienst(tx), {
      auftragId: bau.auftrag,
      abrechnungsart: 'monatspauschale',
      parameter: { teilmonat: 'keine' },
      pauschaleNettoCent: cent(100_000n),
      abrechnungsintervall: 'monatlich',
      leistungszeitraumModus: 'kalendermonat',
      gueltigAb: ab,
      gueltigBis: bis,
    }));
}
