/**
 * PR 65 gegen eine echte Datenbank — offene Posten, Altersstruktur,
 * Monatszahlen, Gruppensumme, Periodenschloss (ACC-07, ACC-08, ACC-01,
 * D-484).
 *
 *  1. Die Summe der offenen Forderungen ist die Summe der festgeschriebenen
 *     Rechnungen minus die zugeordneten Zahlungen — auf den Cent, gegen SQL.
 *  2. Die Altersklassen summieren sich zur Summe; das Alter sind
 *     Kalendertage — ueber die Zeitumstellung im Maerz und im Oktober hinweg
 *     bleibt der 30. Tag der 30. Tag.
 *  3. Die Monatszahlen stimmen gegen SQL, und die Gruppensumme ist die Summe
 *     der Gesellschaften.
 *  4. Das Periodenschloss: vorlaeufig, endgueltig mit eingefrorenen Zahlen,
 *     ein laufender Monat schliesst nicht, ein geschlossener oeffnet nicht
 *     und nimmt keine Buchung an; ein nachtraeglicher Beleg faellt auf.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { withGroupScope, type SchreibKontext, type Sitzung } from '../../src/server/kontext/index.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import { monatVerschieben, monatsgrenzen } from '../../src/lib/datum/kalendertag.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand,
} from '../../src/server/services/finanz/rechnung.js';
import { erfasseZahlung, ordneZu, postenZuRechnung } from '../../src/server/services/finanz/zahlung/index.js';
import {
  erfasseEingangsrechnung, freigebe, inPruefung, legeBelegAn, setzeSteuerzeile, buche,
} from '../../src/server/services/finanz/eingangsrechnung.js';
import {
  abstimmungOffenePosten, altersstruktur, klasseFuer, postenListe,
} from '../../src/server/services/buchhaltung/offene-posten.js';
import { monatszahlen } from '../../src/server/services/buchhaltung/monatszahlen.js';
import { KALENDERJAHR } from '../../src/server/services/buchhaltung/wirtschaftsjahr.js';
import { PeriodenschlussFehler, schliessePeriode } from '../../src/server/services/buchhaltung/periodenschluss.js';
import { gruppenFinanzen } from '../../src/server/services/gruppe/finanzen.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const SHA = 'c'.repeat(64);

function sitzung(mandantId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql, mandantId?: string): SchreibKontext {
  const m = mandantId ?? f.reinigung;
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: m, mandantIds: [m], abfrage, schreibe: abfrage,
  };
}

const gruppenSitzung = (benutzerId: string): Sitzung => ({
  benutzerId, personId: null, aktiverMandantId: null, ansicht: 'gruppe',
  aal: 'aal2', portal: 'intern', sitzungId: '00000000-0000-0000-0000-000000000001',
});

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
            telefon = '+49 30 5550100', email = 'rechnung@cse.test',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            iban = 'DE02120300000000202051'
      where id = $1`, [mandantId]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test'),
            ($1, 'eingangsrechnung_beleg', null, 2026, 'Eingangsbelege', true, 'EB-{jahr}-{nr:5}',
             'jaehrlich', '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

async function legeKundeAn(mandantId: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'firma','Beispiel GmbH','Musterweg','7','10178','Berlin') returning id`,
    [mandantId, `K-${zufall()}`]);
  return k!.id;
}

async function festgeschrieben(preisCent: bigint, mandantId?: string, kunde?: string): Promise<string> {
  const m = mandantId ?? f.reinigung;
  const id = await alsApp(sitzung(m), async (tx) => {
    const d = kontextAus(tx, m);
    const neu = await legeEntwurfAn(d, {
      kundeId: kunde ?? kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31',
      zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: neu, bezeichnung: 'Unterhaltsreinigung',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(preisCent), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`, [neu] as never[]);
    return neu;
  });
  await alsApp(sitzung(m), async (tx) => finalisiere(kontextAus(tx, m), id));
  return id;
}

/** Eine freigegebene Eingangsrechnung mit Rechnungsdatum nach Wahl — zaehlt als Aufwand. */
async function eingangsrechnungFreigegeben(
  lieferantId: string, rechnungsdatum: string, nettoCent: bigint, buchen = false,
): Promise<string> {
  const dokId = crypto.randomUUID();
  await sql.unsafe(
    `insert into dokument (id, mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                           groesse_bytes, bucket, objekt_schluessel, exif_entfernt, loeschsperre)
     values ($1, $2, 'buchhaltung', 'Lieferantenrechnung', 'application/pdf', true,
             1024, 'dokumente', $3, true, true)`,
    [dokId, f.reinigung, `${f.reinigung}/buchhaltung/${dokId}`]);
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                   sha256, groesse_bytes, mime_typ)
     values ($1, $2, 1, $3, $4, 1024, 'application/pdf') returning id`,
    [f.reinigung, dokId, `${f.reinigung}/buchhaltung/${dokId}`, SHA]);
  const steuer = nettoCent * 19n / 100n;
  const id = await alsApp(sitzung(), async (tx) => {
    const d = kontextAus(tx);
    const belegId = await legeBelegAn(d, {
      typ: 'eingangsrechnung', quelle: 'upload', dokumentId: dokId, dokumentVersionId: v!.id,
      dateiSha256: SHA, belegdatum: rechnungsdatum,
    });
    const er = await erfasseEingangsrechnung(d, {
      belegId, lieferantId, rechnungsnummerLieferant: `L-${zufall()}`, rechnungsdatum,
      leistungsdatum: rechnungsdatum, nettoCent: cent(nettoCent), steuerCent: cent(steuer),
      bruttoCent: cent(nettoCent + steuer), faelligAm: rechnungsdatum,
    });
    await setzeSteuerzeile(d, { eingangsrechnungId: er, steuergruppe: 'ust_19', nettoCent: cent(nettoCent), steuerCent: cent(steuer) });
    await inPruefung(d, er);
    return er;
  });
  const [fg] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am, erstellt_von)
     values ($1, 'eingangsrechnung_buchen', 'genehmigt', $2, now(), $2) returning id`,
    [f.reinigung, benutzer]);
  await alsApp(sitzung(), async (tx) => {
    const d = kontextAus(tx);
    await freigebe(d, id, fg!.id);
    if (buchen) await buche(d, id);
  });
  return id;
}

async function legeLieferantAn(): Promise<string> {
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into lieferant (mandant_id, lieferantennummer, name, plz, ort, status,
                            erstellt_von_art, erstellt_von_dienst)
     values ($1, $2, 'Hygiene Nord Handels GmbH', '13353', 'Berlin', 'aktiv', 'system', 'job:test')
     returning id`, [f.reinigung, `L-${zufall()}`]);
  return l!.id;
}

async function heute(): Promise<string> {
  const [z] = await sql.unsafe<{ tag: string }[]>(`select app.berlin_heute()::text as tag`);
  return z!.tag;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`posten-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  kundeId = await legeKundeAn(f.reinigung);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) offene Forderungen = Rechnungen − Zahlungen, auf den Cent', () => {
  it('drei Rechnungen, eine Teilzahlung — der Dienst und SQL sagen dasselbe', async () => {
    const a = await festgeschrieben(100_000n);
    await festgeschrieben(250_000n);
    await festgeschrieben(50_000n);
    const tag = await heute();

    const vorher = await alsApp(sitzung(), (tx) => altersstruktur(kontextAus(tx), tag));
    expect(vorher.debitor.gesamt).toBe(476_000n);
    expect(vorher.debitor.anzahl).toBe(3);
    // Faellig in 30 Tagen: alles „nicht faellig", nichts ueberfaellig.
    expect(vorher.debitor.nicht_faellig).toBe(476_000n);
    expect(vorher.debitor.ueberfaellig).toBe(0n);

    const posten = await alsApp(sitzung(), (tx) => postenZuRechnung(kontextAus(tx), a));
    await alsApp(sitzung(), async (tx) => {
      const d = kontextAus(tx);
      const zahlung = await erfasseZahlung(d, {
        richtung: 'eingang', betragCent: cent(50_000n), zahlungsdatum: tag, zahlungsmittel: 'ueberweisung',
      });
      await ordneZu(d, { zahlungId: zahlung, offenerPostenId: posten!.id, art: 'zahlung', betragCent: cent(50_000n) });
    });

    const nachher = await alsApp(sitzung(), (tx) => altersstruktur(kontextAus(tx), tag));
    expect(nachher.debitor.gesamt).toBe(426_000n);

    // Der unabhaengige Weg: SQL ueber die Quellen, nicht ueber die Posten.
    const [q] = await sql.unsafe<{ rechnungen: string; zuordnungen: string }[]>(
      `select (select coalesce(sum(zahlbetrag_cent), 0) from rechnung
                where mandant_id = $1 and status = 'festgeschrieben')::text as rechnungen,
              (select coalesce(sum(betrag_cent), 0) from zahlung_zuordnung
                where mandant_id = $1 and art <> 'ueberzahlung')::text as zuordnungen`, [f.reinigung]);
    expect(BigInt(q!.rechnungen) - BigInt(q!.zuordnungen)).toBe(nachher.debitor.gesamt);

    const abst = await alsApp(sitzung(), (tx) => abstimmungOffenePosten(kontextAus(tx)));
    const deb = abst.find((x) => x.art === 'debitor');
    expect(deb?.stimmt).toBe(true);
    expect(deb?.ausPostenCent).toBe(426_000n);
    expect(deb?.ausBelegenCent).toBe(426_000n);

    const liste = await alsApp(sitzung(), (tx) => postenListe(kontextAus(tx), 'debitor', tag));
    expect(liste).toHaveLength(3);
    expect(liste.find((z) => z.zielPfad === `finanzen/rechnungen/${a}`)?.offenCent).toBe(69_000n);
    expect(liste.every((z) => z.klasse === 'nicht_faellig' && z.zielPfad !== null)).toBe(true);
  });

  it('die Kreditorenseite: eine gebuchte Eingangsrechnung ist eine Verbindlichkeit', async () => {
    const lieferant = await legeLieferantAn();
    const tag = await heute();
    await eingangsrechnungFreigegeben(lieferant, tag, 100_000n, true);
    const a = await alsApp(sitzung(), (tx) => altersstruktur(kontextAus(tx), tag));
    expect(a.kreditor.gesamt).toBe(119_000n);
    expect(a.kreditor.anzahl).toBe(1);
    const liste = await alsApp(sitzung(), (tx) => postenListe(kontextAus(tx), 'kreditor', tag));
    expect(liste[0]?.zielPfad).toMatch(/^finanzen\/eingangsrechnungen\//u);
    expect(liste[0]?.gegenpartei).toBe('Hygiene Nord Handels GmbH');
    const abst = await alsApp(sitzung(), (tx) => abstimmungOffenePosten(kontextAus(tx)));
    expect(abst.find((x) => x.art === 'kreditor')?.stimmt).toBe(true);
  });
});

describe('(2) Altersklassen: Kalendertage, auch ueber die Zeitumstellung', () => {
  async function postenMitFaelligkeit(faellig: string, betrag: bigint): Promise<string> {
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into offener_posten (mandant_id, art, kunde_id, betrag_cent, faellig_am,
                                   erstellt_von_art, erstellt_von_dienst)
       values ($1, 'debitor', $2, $3, $4::date, 'system', 'job:test') returning id`,
      [f.reinigung, kundeId, betrag.toString(), faellig]);
    return p!.id;
  }

  it('Fruehjahr: 27.03. faellig, 26.04. sind 30 Tage (bis 30), 27.04. sind 31 (bis 60)', async () => {
    const id = await postenMitFaelligkeit('2026-03-27', 10_000n);
    const am26 = await alsApp(sitzung(), (tx) => postenListe(kontextAus(tx), 'debitor', '2026-04-26'));
    const am27 = await alsApp(sitzung(), (tx) => postenListe(kontextAus(tx), 'debitor', '2026-04-27'));
    expect(am26.find((z) => z.id === id)).toMatchObject({ tage: 30, klasse: 'bis30' });
    expect(am27.find((z) => z.id === id)).toMatchObject({ tage: 31, klasse: 'bis60' });
    const s = await alsApp(sitzung(), (tx) => altersstruktur(kontextAus(tx), '2026-04-26'));
    expect(s.debitor.bis30).toBe(10_000n);
    expect(s.debitor.bis60).toBe(0n);
  });

  it('Herbst: 10.10. faellig, 09.11. sind 30 Tage, 10.11. sind 31 — und die Klassen summieren sich', async () => {
    const id = await postenMitFaelligkeit('2026-10-10', 7_000n);
    await postenMitFaelligkeit('2026-06-01', 3_000n);   // am 10.11. weit ueber 90 Tage
    await festgeschrieben(100_000n);                     // faellig in 30 Tagen ab heute
    const am09 = await alsApp(sitzung(), (tx) => postenListe(kontextAus(tx), 'debitor', '2026-11-09'));
    const am10 = await alsApp(sitzung(), (tx) => postenListe(kontextAus(tx), 'debitor', '2026-11-10'));
    expect(am09.find((z) => z.id === id)).toMatchObject({ tage: 30, klasse: 'bis30' });
    expect(am10.find((z) => z.id === id)).toMatchObject({ tage: 31, klasse: 'bis60' });
    for (const z of am10) expect(z.klasse).toBe(klasseFuer(z.tage));

    const s = await alsApp(sitzung(), (tx) => altersstruktur(kontextAus(tx), '2026-11-10'));
    const summe = s.debitor.nicht_faellig + s.debitor.bis30 + s.debitor.bis60 + s.debitor.bis90 + s.debitor.ueber90;
    expect(summe).toBe(s.debitor.gesamt);
    expect(s.debitor.ueber90).toBe(3_000n);
    expect(s.debitor.bis60).toBe(7_000n);
    expect(s.debitor.ueberfaellig).toBe(s.debitor.gesamt - s.debitor.nicht_faellig);
  });
});

describe('(3) Monatszahlen — gegen SQL, und die Gruppe ist die Summe', () => {
  it('Erloese und Aufwand des Monats, Ergebnis als Differenz, zwoelf Monate', async () => {
    await festgeschrieben(100_000n);
    await festgeschrieben(250_000n);
    const lieferant = await legeLieferantAn();
    const tag = await heute();
    await eingangsrechnungFreigegeben(lieferant, tag, 40_000n);
    const jahr = Number(tag.slice(0, 4));
    const monat = tag.slice(0, 7);

    const z = await alsApp(sitzung(), (tx) => monatszahlen(kontextAus(tx), jahr, KALENDERJAHR));
    expect(z.monate).toHaveLength(12);
    expect(z.bezeichnung).toBe(String(jahr));
    const m = z.monate.find((x) => x.monat === monat);
    expect(m?.erloeseCent).toBe(350_000n);
    expect(m?.rechnungen).toBe(2);
    expect(m?.aufwandCent).toBe(40_000n);
    expect(m?.ergebnisCent).toBe(310_000n);
    expect(z.summe.ergebnisCent).toBe(z.summe.erloeseCent - z.summe.aufwandCent);

    const [q] = await sql.unsafe<{ erloese: string; aufwand: string }[]>(
      `select (select coalesce(sum(netto_gesamt_cent), 0) from rechnung
                where mandant_id = $1 and status = 'festgeschrieben'
                  and to_char(rechnungsdatum, 'YYYY-MM') = $2)::text as erloese,
              (select coalesce(sum(netto_cent), 0) from eingangsrechnung
                where mandant_id = $1 and status in ('freigegeben', 'gebucht')
                  and to_char(rechnungsdatum, 'YYYY-MM') = $2)::text as aufwand`, [f.reinigung, monat]);
    expect(m?.erloeseCent).toBe(BigInt(q!.erloese));
    expect(m?.aufwandCent).toBe(BigInt(q!.aufwand));
  });

  it('die Gruppensumme je Monat ist die Summe der Gesellschaften', async () => {
    await macheFakturierfaehig(f.security);
    const kundeSecurity = await legeKundeAn(f.security);
    await festgeschrieben(100_000n);
    await festgeschrieben(80_000n, f.security, kundeSecurity);
    const tag = await heute();
    const jahr = Number(tag.slice(0, 4));
    const monat = tag.slice(0, 7);
    const monatNr = Number(tag.slice(5, 7));

    const r = await alsApp(sitzung(), (tx) => monatszahlen(kontextAus(tx), jahr, KALENDERJAHR));
    const s = await alsApp(sitzung(f.security), (tx) => monatszahlen(kontextAus(tx, f.security), jahr, KALENDERJAHR));
    const rM = r.monate.find((x) => x.monat === monat)!;
    const sM = s.monate.find((x) => x.monat === monat)!;
    expect(rM.erloeseCent).toBe(100_000n);
    expect(sM.erloeseCent).toBe(80_000n);

    const g = await sql.begin(async (tx) =>
      withGroupScope(tx as never, gruppenSitzung(benutzer), (k) => gruppenFinanzen(k, jahr)));
    const gM = g.fakturiertJeMonat.find((x) => x.monat === monatNr)!;
    expect(gM.summe).toBe(rM.erloeseCent + sM.erloeseCent);
    // Und ueber das Jahr: die Gruppe ist die Summe aller vier — die beiden anderen sind leer.
    expect(g.summe.fakturiertCent).toBe(r.summe.erloeseCent + s.summe.erloeseCent);
  });
});

describe('(4) das Periodenschloss', () => {
  const schliesse = (jahr: number, monat: number, art: 'vorlaeufig' | 'endgueltig' | 'oeffnen') =>
    alsApp(sitzung(), (tx) => schliessePeriode(kontextAus(tx), { jahr, monat, art }));

  it('ein laufender Monat: vorlaeufig ja, endgueltig nein, wieder oeffnen ja', async () => {
    const tag = await heute();
    const jahr = Number(tag.slice(0, 4)); const monat = Number(tag.slice(5, 7));
    const v = await schliesse(jahr, monat, 'vorlaeufig');
    expect(v.vorher).toBe('offen');
    expect(v.periode.status).toBe('vorlaeufig_geschlossen');
    await expect(schliesse(jahr, monat, 'endgueltig'))
      .rejects.toSatisfy((e: unknown) => e instanceof PeriodenschlussFehler && e.grund === 'laufend');
    const o = await schliesse(jahr, monat, 'oeffnen');
    expect(o.periode.status).toBe('offen');
    const [spur] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log where aktion = 'periode.zustand' and mandant_id = $1`, [f.reinigung]);
    expect(spur?.n).toBe('2');
  });

  it('ein vergangener Monat schliesst mit eingefrorenen Zahlen — und ein spaeter Beleg faellt auf', async () => {
    const tag = await heute();
    const vormonat = monatVerschieben(`${tag.slice(0, 7)}-01`, -1);   // erster Tag des Vormonats
    const grenzen = monatsgrenzen(vormonat);
    const jahr = Number(vormonat.slice(0, 4)); const monat = Number(vormonat.slice(5, 7));
    const lieferant = await legeLieferantAn();
    await eingangsrechnungFreigegeben(lieferant, grenzen.bis, 80_000n);

    const g = await schliesse(jahr, monat, 'endgueltig');
    expect(g.periode.status).toBe('geschlossen');
    const [p] = await sql.unsafe<{ status: string; erloese: string; aufwand: string; ergebnis: string; von: string | null }[]>(
      `select status::text as status, umsatz_erloes_cent::text as erloese, aufwand_cent::text as aufwand,
              ergebnis_cent::text as ergebnis, geschlossen_von as von
         from periode where mandant_id = $1 and jahr = $2 and monat = $3`, [f.reinigung, jahr, monat]);
    expect(p).toMatchObject({ status: 'geschlossen', erloese: '0', aufwand: '80000', ergebnis: '-80000', von: benutzer });

    let z = await alsApp(sitzung(), (tx) => monatszahlen(kontextAus(tx), jahr, KALENDERJAHR));
    let m = z.monate.find((x) => x.monat === vormonat.slice(0, 7))!;
    expect(m.periode?.status).toBe('geschlossen');
    expect(m.periode?.eingefroren?.aufwandCent).toBe(80_000n);
    expect(m.periode?.abweichung).toBe(false);

    // Geschlossen ist geschlossen.
    await expect(schliesse(jahr, monat, 'oeffnen'))
      .rejects.toSatisfy((e: unknown) => e instanceof PeriodenschlussFehler && e.grund === 'endgueltig');
    await expect(schliesse(jahr, monat, 'vorlaeufig'))
      .rejects.toSatisfy((e: unknown) => e instanceof PeriodenschlussFehler && e.grund === 'endgueltig');

    // Eine Buchung in den geschlossenen Monat weist die Datenbank ab.
    const [periode] = await sql.unsafe<{ id: string }[]>(
      `select id from periode where mandant_id = $1 and jahr = $2 and monat = $3`, [f.reinigung, jahr, monat]);
    await expect(sql.unsafe(
      `insert into buchungssatz (mandant_id, buchung_id, buchungsdatum, belegdatum, periode_id,
                                 umsatz_cent, soll_haben, buchungstext, herkunft,
                                 erstellt_von_art, erstellt_von_dienst)
       values ($1, gen_random_uuid(), $2::date, $2::date, $3, 100, 'soll', 'Nachtrag', 'manuell',
               'system', 'job:test')`,
      [f.reinigung, grenzen.bis, periode!.id])).rejects.toThrow(/geschlossen/u);

    // Ein Beleg mit altem Datum, freigegeben nach dem Schliessen: die Zeile sagt es.
    await eingangsrechnungFreigegeben(lieferant, grenzen.von, 20_000n);
    z = await alsApp(sitzung(), (tx) => monatszahlen(kontextAus(tx), jahr, KALENDERJAHR));
    m = z.monate.find((x) => x.monat === vormonat.slice(0, 7))!;
    expect(m.aufwandCent).toBe(100_000n);
    expect(m.periode?.eingefroren?.aufwandCent).toBe(80_000n);
    expect(m.periode?.abweichung).toBe(true);
  });
});
