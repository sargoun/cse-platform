/**
 * PR 50 — Abschlags- und Schlussrechnung mit automatischem Abzug (FIN-08).
 *
 * Die fünf Zusagen der Abnahme, gegen eine echte Datenbank mit FORCE RLS.
 * Keine davon ist mockbar: „ein stornierter Abschlag hält an" ist eine Aussage
 * über `rechnung_beziehung` und einen Trigger, „ein Abschlag wird von genau
 * einer Schlussrechnung abgerechnet" eine über einen partiellen
 * Eindeutigkeitsindex.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, storniere, vonHand,
  type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import {
  abschlaegeZumAuftrag, berechneVerrechnung, offeneAbschlaege, schreibeVerrechnung,
  type AbschlagFehler,
} from '../../src/server/services/finanz/abschlag/index.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;
let auftragId: string;
let zweiterAuftragId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

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

async function macheFakturierfaehig(mandantId: string): Promise<void> {
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
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

/** Kunde, Objekt und ein Auftrag — der Anker, an dem Abschläge hängen. */
async function legeAuftragAn(kunde: string): Promise<string> {
  const [vu] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`,
    [`leitung-${zufall()}@cse.test`]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Objektleitung','aktiv')`,
    [vu!.id, `leitung-${zufall()}@cse.test`] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1,$2,(select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
    [vu!.id, f.reinigung]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus Nord','Teststr. 3','10115','Berlin') returning id`,
    [f.reinigung, kunde, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'rahmenvertrag','aktiv','Umbau Nord',$5,'2026-01-01')
     returning id`,
    [f.reinigung, `AU-${zufall()}`, kunde, o!.id, vu!.id] as never[]);
  return a!.id;
}

/**
 * Ein festgeschriebener Beleg über `netto` Cent — Abschlag, Anzahlung oder
 * Schlussrechnung, am selben Auftrag.
 */
async function beleg(
  art: 'abschlag' | 'anzahlung' | 'schluss' | 'standard', netto: bigint,
  auftrag: string = auftragId,
): Promise<string> {
  return alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId, auftragId: auftrag, rechnungsart: art,
      leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: `${art} Umbau Nord`,
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(netto), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    return id;
  });
}

async function festschreiben(id: string): Promise<string> {
  return alsApp(sitzung(), async (tx) => {
    const k = await finalisiere(alsDienst(tx), id);
    return k.nummer;
  });
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
  auftragId = await legeAuftragAn(kundeId);
  zweiterAuftragId = await legeAuftragAn(kundeId);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) drei Abschläge à 10.000,00 € ergeben 30.000,00 € Abzug', () => {
  it('der Abzug steht im Kopf und in drei Bezugszeilen', async () => {
    for (const _ of [1, 2, 3]) {
      void _;
      await festschreiben(await beleg('abschlag', 1_000_000n));
    }
    const schluss = await beleg('schluss', 5_000_000n);

    const v = await alsApp(sitzung(), (tx) => schreibeVerrechnung(alsDienst(tx), schluss));
    expect(v.abzugNettoCent).toBe(3_000_000n);
    expect(v.abzugSteuerCent).toBe(570_000n);
    expect(v.abzugBruttoCent).toBe(3_570_000n);

    const [kopf] = await sql.unsafe<{ abzug: string; zahlbetrag: string; brutto: string }[]>(
      `select abzug_brutto_cent::text as abzug, zahlbetrag_cent::text as zahlbetrag,
              brutto_cent::text as brutto from rechnung where id = $1`, [schluss]);
    expect(kopf!.abzug).toBe('3570000');
    // 50.000,00 € netto + 19 % = 59.500,00 € brutto, abzüglich 35.700,00 €.
    expect(kopf!.brutto).toBe('5950000');
    expect(kopf!.zahlbetrag).toBe('2380000');

    const zeilen = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from abschlagsrechnung_bezug
        where schluss_rechnung_id = $1 and wirksam`, [schluss]);
    expect(zeilen[0]!.n).toBe('3');
  });
});

describe('(2) eine Schlussrechnung ohne einen Abschlag wird nicht festgeschrieben', () => {
  it('die Vorflugprüfung nennt die fehlende Nummer', async () => {
    const nummerA = await festschreiben(await beleg('abschlag', 1_000_000n));
    const nummerB = await festschreiben(await beleg('abschlag', 1_000_000n));
    const schluss = await beleg('schluss', 5_000_000n);

    const offen = await alsApp(sitzung(), (tx) => offeneAbschlaege(alsDienst(tx), schluss));
    expect(offen.map((o) => o.nummer).sort()).toEqual([nummerA, nummerB].sort());
    expect(offen.every((o) => o.verrechnetVon === null)).toBe(true);
  });

  it('nach dem Abzug ist nichts mehr offen', async () => {
    await festschreiben(await beleg('abschlag', 1_000_000n));
    const schluss = await beleg('schluss', 5_000_000n);
    await alsApp(sitzung(), (tx) => schreibeVerrechnung(alsDienst(tx), schluss));

    const offen = await alsApp(sitzung(), (tx) => offeneAbschlaege(alsDienst(tx), schluss));
    expect(offen).toEqual([]);
  });

  /**
   * Die Gegenprobe: ein Abschlag eines ANDEREN Auftrags gehört nicht hierher
   * und darf die Festschreibung nicht blockieren. Ohne sie wäre die Prüfung
   * oben auch dann grün, wenn sie jeden Abschlag der Gesellschaft zählte.
   */
  it('ein Abschlag eines anderen Auftrags hält nicht an', async () => {
    await festschreiben(await beleg('abschlag', 1_000_000n, zweiterAuftragId));
    const schluss = await beleg('schluss', 5_000_000n);
    const offen = await alsApp(sitzung(), (tx) => offeneAbschlaege(alsDienst(tx), schluss));
    expect(offen).toEqual([]);
  });
});

describe('(3) ein stornierter Abschlag hält an, statt still zu verschwinden', () => {
  it('berechneVerrechnung wirft und nennt die Nummer', async () => {
    const id = await beleg('abschlag', 1_000_000n);
    const nummer = await festschreiben(id);
    await alsApp(sitzung(), (tx) =>
      storniere(alsDienst(tx), id, 'Leistung im Abschlag falsch abgegrenzt'));

    const schluss = await beleg('schluss', 5_000_000n);
    const fehler = await alsApp(sitzung(), async (tx) =>
      berechneVerrechnung(alsDienst(tx), schluss).then(
        () => null, (e: AbschlagFehler) => e));

    expect(fehler).not.toBeNull();
    expect(fehler!.grund).toBe('abschlag_storniert');
    expect(fehler!.nummern).toContain(nummer);
  });

  /**
   * Und die Datenbank hält denselben Riegel — ohne den ginge ein Import oder
   * ein Skript daran vorbei.
   */
  it('und der Trigger weist die Bezugszeile auch von Hand ab', async () => {
    const id = await beleg('abschlag', 1_000_000n);
    await festschreiben(id);
    await alsApp(sitzung(), (tx) =>
      storniere(alsDienst(tx), id, 'Leistung im Abschlag falsch abgegrenzt'));
    const schluss = await beleg('schluss', 5_000_000n);

    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `insert into abschlagsrechnung_bezug
         (mandant_id, schluss_rechnung_id, abschlag_rechnung_id, steuersatz_gruppe_id,
          abzug_netto_cent, abzug_steuer_cent, erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1, $2,
               (select id from steuersatz_gruppe limit 1), 100, 19, 'mensch',
               app.aktueller_benutzer())`,
      [schluss, id] as never[],
    ))).rejects.toThrow(/storniert/u);
  });
});

describe('(4) der Abzug wird je Steuergruppe summiert, nie aus einer Bruttosumme', () => {
  it('die Bezugszeilen tragen Netto UND Steuer je Gruppe', async () => {
    await festschreiben(await beleg('abschlag', 333_351n));
    await festschreiben(await beleg('abschlag', 333_350n));
    await festschreiben(await beleg('abschlag', 333_350n));
    const schluss = await beleg('schluss', 5_000_000n);
    const v = await alsApp(sitzung(), (tx) => schreibeVerrechnung(alsDienst(tx), schluss));

    // Die Summe der drei EINZELN gerundeten Steuern — nicht 19 % auf 1.000.051.
    const [einzeln] = await sql.unsafe<{ netto: string; steuer: string }[]>(
      `select sum(rs.netto_cent)::text as netto, sum(rs.steuer_cent)::text as steuer
         from rechnung_steuer rs join rechnung r on r.id = rs.rechnung_id
        where r.auftrag_id = $1 and r.rechnungsart = 'abschlag'`, [auftragId]);
    expect(v.abzugNettoCent.toString()).toBe(einzeln!.netto);
    expect(v.abzugSteuerCent.toString()).toBe(einzeln!.steuer);

    const [summe] = await sql.unsafe<{ netto: string; steuer: string }[]>(
      `select sum(abzug_netto_cent)::text as netto, sum(abzug_steuer_cent)::text as steuer
         from abschlagsrechnung_bezug where schluss_rechnung_id = $1 and wirksam`, [schluss]);
    expect(summe!.netto).toBe('1000051');
    expect(summe!.steuer).toBe(einzeln!.steuer);
  });
});

describe('ein Abschlag wird von GENAU EINER Schlussrechnung abgerechnet', () => {
  /**
   * **Und die zweite Schlussrechnung bekommt keinen leeren Abzug, sondern
   * einen Satz.**
   *
   * Der erste Entwurf des Dienstes filterte den schon abgezogenen Abschlag
   * still heraus: die zweite Schlussrechnung sah vollständig aus, hatte 0,00 €
   * Abzug und verlangte den Auftragswert ein zweites Mal. Der Knopf tat
   * scheinbar etwas, und was er tat, war nichts.
   */
  it('die zweite Schlussrechnung wird abgewiesen und nennt die Nummer', async () => {
    const nummer = await festschreiben(await beleg('abschlag', 1_000_000n));
    const ersteSchluss = await beleg('schluss', 5_000_000n);
    await alsApp(sitzung(), (tx) => schreibeVerrechnung(alsDienst(tx), ersteSchluss));

    const zweiteSchluss = await beleg('schluss', 5_000_000n);
    const fehler = await alsApp(sitzung(), async (tx) =>
      schreibeVerrechnung(alsDienst(tx), zweiteSchluss).then(
        () => null, (e: AbschlagFehler) => e));

    expect(fehler).not.toBeNull();
    expect(fehler!.grund).toBe('abschlag_offen');
    expect(fehler!.nummern).toContain(nummer);
  });

  /**
   * Und der Riegel darunter bleibt: selbst wenn jemand den Dienst umgeht,
   * lässt der partielle Eindeutigkeitsindex keine zweite wirksame Zeile zu.
   */
  it('und der partielle Index hält auch ohne den Dienst', async () => {
    const abschlag = await beleg('abschlag', 1_000_000n);
    await festschreiben(abschlag);
    const ersteSchluss = await beleg('schluss', 5_000_000n);
    await alsApp(sitzung(), (tx) => schreibeVerrechnung(alsDienst(tx), ersteSchluss));

    const zweiteSchluss = await beleg('schluss', 5_000_000n);
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `insert into abschlagsrechnung_bezug
         (mandant_id, schluss_rechnung_id, abschlag_rechnung_id, steuersatz_gruppe_id,
          abzug_netto_cent, abzug_steuer_cent, erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1, $2,
               (select id from steuersatz_gruppe limit 1), 100, 19, 'mensch',
               app.aktueller_benutzer())`,
      [zweiteSchluss, abschlag] as never[],
    ))).rejects.toThrow(/arb_abschlag_einmal_uk/u);
  });

  it('und die zweite sieht den Abschlag als „anderswo abgezogen"', async () => {
    await festschreiben(await beleg('abschlag', 1_000_000n));
    const ersteSchluss = await beleg('schluss', 5_000_000n);
    await alsApp(sitzung(), (tx) => schreibeVerrechnung(alsDienst(tx), ersteSchluss));

    const zweiteSchluss = await beleg('schluss', 5_000_000n);
    const offen = await alsApp(sitzung(), (tx) =>
      offeneAbschlaege(alsDienst(tx), zweiteSchluss));
    expect(offen).toHaveLength(1);
    expect(offen[0]!.verrechnetVon).toBe(ersteSchluss);
  });
});

describe('der Trigger lässt nur echte Abschläge zu', () => {
  it('eine gewöhnliche Rechnung ist kein Abschlag', async () => {
    const standard = await beleg('standard', 1_000_000n);
    await festschreiben(standard);
    const schluss = await beleg('schluss', 5_000_000n);

    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `insert into abschlagsrechnung_bezug
         (mandant_id, schluss_rechnung_id, abschlag_rechnung_id, steuersatz_gruppe_id,
          abzug_netto_cent, abzug_steuer_cent, erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1, $2,
               (select id from steuersatz_gruppe limit 1), 100, 19, 'mensch',
               app.aktueller_benutzer())`,
      [schluss, standard] as never[],
    ))).rejects.toThrow(/kein Abschlag/u);
  });

  it('ein Abschlag im Entwurf hat keine Nummer und wird nicht abgezogen', async () => {
    const entwurf = await beleg('abschlag', 1_000_000n);
    const schluss = await beleg('schluss', 5_000_000n);

    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `insert into abschlagsrechnung_bezug
         (mandant_id, schluss_rechnung_id, abschlag_rechnung_id, steuersatz_gruppe_id,
          abzug_netto_cent, abzug_steuer_cent, erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1, $2,
               (select id from steuersatz_gruppe limit 1), 100, 19, 'mensch',
               app.aktueller_benutzer())`,
      [schluss, entwurf] as never[],
    ))).rejects.toThrow(/keine Nummer/u);
  });

  it('ein Abschlag aus einem anderen Auftrag ebenfalls nicht', async () => {
    const fremd = await beleg('abschlag', 1_000_000n, zweiterAuftragId);
    await festschreiben(fremd);
    const schluss = await beleg('schluss', 5_000_000n);

    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `insert into abschlagsrechnung_bezug
         (mandant_id, schluss_rechnung_id, abschlag_rechnung_id, steuersatz_gruppe_id,
          abzug_netto_cent, abzug_steuer_cent, erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1, $2,
               (select id from steuersatz_gruppe limit 1), 100, 19, 'mensch',
               app.aktueller_benutzer())`,
      [schluss, fremd] as never[],
    ))).rejects.toThrow(/anderen Auftrag/u);
  });
});

describe('der Stand eines Auftrags ist ablesbar', () => {
  it('Abschläge, Verrechnung und Storno stehen in einer Liste', async () => {
    const a1 = await beleg('abschlag', 1_000_000n);
    const n1 = await festschreiben(a1);
    const a2 = await beleg('anzahlung', 500_000n);
    const n2 = await festschreiben(a2);

    const stand = await alsApp(sitzung(), (tx) =>
      abschlaegeZumAuftrag(alsDienst(tx), auftragId));
    expect(stand.map((s) => s.nummer).sort()).toEqual([n1, n2].sort());
    expect(stand.every((s) => !s.storniert && s.verrechnetVon === null)).toBe(true);

    // Eine Anzahlung zählt mit — sie ist wie ein Abschlag vorab gezahltes Geld.
    expect(stand).toHaveLength(2);
  });
});
