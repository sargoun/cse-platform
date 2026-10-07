/**
 * **Eine Position verlässt den Rechnungsentwurf** (V-356, O-212, D-831) — an
 * echtem Postgres mit FORCE RLS.
 *
 * Die Zusage aus der Voreinstellung, Satz für Satz:
 *
 *  1. Die entfernte Zeile fehlt in Summe, Nutzlast, XRechnung und Buchung —
 *     auch wenn mit ihr eine ganze Steuergruppe den Beleg verlässt, und auch
 *     im Vollstorno, das den Beleg spiegelt.
 *  2. Ihre Herkunft wird frei: dieselbe Stunde lässt sich wieder abrechnen.
 *  3. Nur mit Grund, nur einmal, nur im Entwurf, und nie die letzte
 *     Leistungszeile; zurückholen lässt sie sich nicht, und ihre Herkunft
 *     wird nicht wieder wirksam — auch nicht am Dienst vorbei.
 *  4. Der Kunde sieht sie nicht.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, fuegeZeitPositionHinzu, legeEntwurfAn, RechnungFehler,
  storniere, vonHand,
} from '../../src/server/services/finanz/rechnung.js';
import { entfernePosition } from '../../src/server/services/finanz/entwurf.js';
import type { Abfrage } from '../../src/server/services/finanz/positionsquelle.js';
import { ublZurRechnung } from '../../src/server/services/finanz/xrechnung/dienst.js';

let f: Fixtur;
let benutzer = '';
let kundeId = '';
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

const imDienst = <T,>(fn: (d: Abfrage, tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  alsApp(sitzung(), async (tx) => fn(alsDienst(tx), tx));

async function grundVon(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RechnungFehler) return e.grund;
    throw e;
  }
  return 'kein Fehler';
}

beforeEach(async () => {
  f = await seed();
  const email = `entfernen-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer, email]);
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            telefon = '+49 30 5550100', email = 'rechnung@cse.test',
            rechnung_kontakt_name = 'Buchhaltung',
            elektronische_adresse = 'DE123456789', elektronische_adresse_schema = '9930',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B',
            iban = 'DE02120300000000202051'
      where id = $1`, [f.reinigung]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`, [f.reinigung]);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort,
                        ist_oeffentlicher_auftraggeber, xrechnung_pflicht, leitweg_id,
                        elektronische_adresse, elektronische_adresse_schema)
     values ($1,$2,'behoerde','Bezirksamt Musterberg','Musterplatz','1','10178','Berlin',
             true, true, '991-12345-67', '991-12345-67', '0204') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
}, 120_000);
afterAll(schliessen);

/** Ein Entwurf mit zwei Zeilen von Hand: 1.000,00 € zu 19 % und 200,00 € zu 7 %. */
async function entwurfZweiSaetze(): Promise<{ id: string; voll: string; ermaessigt: string }> {
  return imDienst(async (d, tx) => {
    const id = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    const voll = await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung August 2026',
      menge: milliMenge(1000n), einheit: 'm2', einzelpreisCent: cent(100_000n),
      steuergruppe: 'ust_19', quellen: vonHand('Testfixtur — von Hand erfasst'),
    });
    const ermaessigt = await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Doppelt erfasste Zeile',
      menge: milliMenge(1000n), einheit: 'm2', einzelpreisCent: cent(20_000n),
      steuergruppe: 'ust_07', quellen: vonHand('Testfixtur — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [id] as never[]);
    return { id, voll, ermaessigt };
  });
}

async function kopf(id: string): Promise<{ netto: string; steuer: string; brutto: string }> {
  const [z] = await sql.unsafe<{ netto: string; steuer: string; brutto: string }[]>(
    `select netto_gesamt_cent::text as netto, steuer_gesamt_cent::text as steuer,
            brutto_cent::text as brutto from rechnung where id = $1`, [id]);
  return z!;
}

describe('(1) die entfernte Zeile fehlt in Summe, Nutzlast, XRechnung und Buchung', () => {
  it('auch wenn mit ihr eine ganze Steuergruppe den Beleg verlässt', async () => {
    const r = await entwurfZweiSaetze();
    expect(await kopf(r.id)).toEqual({ netto: '120000', steuer: '20400', brutto: '140400' });

    const ergebnis = await imDienst((d) => entfernePosition(d, r.ermaessigt, 'doppelt erfasst'));
    expect(ergebnis).toEqual({ rechnungId: r.id, freigegeben: 1 });
    expect(await kopf(r.id)).toEqual({ netto: '100000', steuer: '19000', brutto: '119000' });

    // Die Zeile bleibt stehen (Invariante 8) — mit Grund, Zeit und Person.
    const [zeile] = await sql.unsafe<{ grund: string; von: string; am: boolean }[]>(
      `select entfernt_grund as grund, entfernt_von::text as von, entfernt_am is not null as am
         from rechnungsposition where id = $1`, [r.ermaessigt]);
    expect(zeile).toEqual({ grund: 'doppelt erfasst', von: benutzer, am: true });
    // Die 7-%-Gruppe steht leer da — gelöscht wird auch sie nicht.
    const steuer = await sql.unsafe<{ satz: number; netto: string; steuer: string }[]>(
      `select satz_bp as satz, netto_cent::text as netto, steuer_cent::text as steuer
         from rechnung_steuer where rechnung_id = $1 order by satz_bp`, [r.id]);
    expect(steuer).toEqual([
      { satz: 700, netto: '0', steuer: '0' },
      { satz: 1900, netto: '100000', steuer: '19000' },
    ]);

    await imDienst((d) => finalisiere(d, r.id));

    // Nutzlast und Hash: nur die lebende Zeile, nur die 19-%-Gruppe.
    const [snap] = await sql.unsafe<{ nutzlast: string }[]>(
      `select convert_from(nutzlast_bytes, 'UTF8') as nutzlast
         from rechnung_snapshot where rechnung_id = $1`, [r.id]);
    const nutzlast = JSON.parse(snap!.nutzlast) as {
      positionen: { bezeichnung: string }[]; steuerzeilen?: unknown[];
    };
    expect(nutzlast.positionen.map((p) => p.bezeichnung))
      .toEqual(['Unterhaltsreinigung August 2026']);
    expect(snap!.nutzlast).not.toContain('Doppelt erfasste Zeile');
    expect(snap!.nutzlast).not.toContain('ust_07');

    // Die XRechnung entsteht aus dem Snapshot: eine Zeile, keine 7-%-Aufschlüsselung.
    const xml = (await imDienst((d) => ublZurRechnung(d, r.id)))!.xml;
    expect(xml.match(/<cac:InvoiceLine>/gu)?.length).toBe(1);
    expect(xml).not.toContain('Doppelt erfasste Zeile');
    expect(xml).not.toMatch(/<cbc:Percent>7(?:\.0+)?<\/cbc:Percent>/u);

    // Gebucht wird, was auf dem Beleg steht: Soll = Haben = brutto (0127), ohne die 200,00 €.
    const [buchung] = await sql.unsafe<{ soll: string; haben: string }[]>(
      `select coalesce(sum(umsatz_cent) filter (where soll_haben = 'soll'), 0)::text as soll,
              coalesce(sum(umsatz_cent) filter (where soll_haben = 'haben'), 0)::text as haben
         from buchungssatz where rechnung_id = $1`, [r.id]);
    expect(buchung).toEqual({ soll: '119000', haben: '119000' });

    // Und der Vollstorno spiegelt den Beleg — die leere Gruppe zählt nicht.
    await imDienst((d) => storniere(d, r.id, 'Leistungsmonat falsch — mit dem Kunden geklärt'));
    const [storno] = await sql.unsafe<{ n: string; netto: string }[]>(
      `select (select count(*) from rechnungsposition p where p.rechnung_id = s.id)::text as n,
              s.netto_gesamt_cent::text as netto
         from rechnung s
         join rechnung_beziehung b on b.von_rechnung_id = s.id
        where b.zu_rechnung_id = $1 and b.art = 'storno'`, [r.id]);
    expect(storno).toEqual({ n: '1', netto: '-100000' });
  });
});

describe('(2) die Herkunft wird frei', () => {
  it('dieselbe Stunde lässt sich nach dem Entfernen wieder abrechnen', async () => {
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Amira', $1) returning id`, [zufall()]);
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
       values ($1,$2,$3,'2026-01-01') returning id`, [f.reinigung, p!.id, `PN-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1,$2,$3,'Rathaus','Musterplatz 1','10178','Berlin') returning id`,
      [f.reinigung, kundeId, `O-${zufall()}`]);
    // Die Objektleitung ist ein eigenes Mitglied der Gesellschaft (auftrag prüft das).
    const [vu] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [`leitung-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,$2,'Objektleitung','aktiv')`,
      [vu!.id, `leitung-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1,$2,(select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
      [vu!.id, f.reinigung]);
    const [au] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                            bezeichnung, verantwortlich_benutzer_id, start_datum)
       values ($1,$2,$3,$4,'rahmenvertrag','aktiv','Unterhaltsreinigung',$5,'2026-01-01')
       returning id`, [f.reinigung, `AU-${zufall()}`, kundeId, o!.id, vu!.id] as never[]);
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                     bezeichnung, menge, einheit, einzelpreis_cent,
                                     steuersatz_bp, gueltig_ab)
       values ($1,$2,1,$3,'Unterhaltsreinigung',1,'Monat',189000,1900,'2026-01-01')
       returning id`, [f.reinigung, au!.id, o!.id] as never[]);
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, auftrag_leistung_id, objekt_id,
          beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
          erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
          status, freigegeben_am, freigegeben_von, erstellt_von_art)
       values ($1,$2,$3,$4,$5,'2026-08-03T06:00:00Z','2026-08-03T14:00:00Z',0,
               'import','import','import','import','abgeschlossen', now(), $6, 'system')
       returning id`, [f.reinigung, a!.id, p!.id, l!.id, o!.id, benutzer] as never[]);

    const zeitZeile = async (): Promise<{ rechnung: string; position: string }> =>
      imDienst(async (d) => {
        const id = await legeEntwurfAn(d, {
          kundeId, objektId: o!.id, auftragId: au!.id,
          leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
        });
        await fuegePositionHinzu(d, {
          rechnungId: id, bezeichnung: 'Material', menge: milliMenge(1000n), einheit: 'm2',
          einzelpreisCent: cent(5_000n), steuergruppe: 'ust_19',
          quellen: vonHand('Testfixtur — von Hand erfasst'),
        });
        const zeit = await fuegeZeitPositionHinzu(d, {
          rechnungId: id, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
          steuergruppe: 'ust_19', auftragLeistungId: l!.id,
        });
        return { rechnung: id, position: zeit.positionId };
      });

    const erste = await zeitZeile();
    // Solange die erste Zeile lebt, ist die Stunde beansprucht.
    await expect(zeitZeile()).rejects.toThrow();

    const ergebnis = await imDienst((d) =>
      entfernePosition(d, erste.position, 'falscher Entwurf — gehört auf die Sammelrechnung'));
    expect(ergebnis.freigegeben).toBe(1);
    const [frei] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from rechnungsposition_quelle
        where zeiteintrag_id = $1 and wirksam`, [z!.id]);
    expect(frei!.n).toBe('0');

    // Jetzt nimmt ein zweiter Entwurf dieselbe Stunde.
    const zweite = await zeitZeile();
    const [jetzt] = await sql.unsafe<{ rechnung: string }[]>(
      `select rechnung_id::text as rechnung from rechnungsposition_quelle
        where zeiteintrag_id = $1 and wirksam`, [z!.id]);
    expect(jetzt!.rechnung).toBe(zweite.rechnung);
  });
});

describe('(3) nur mit Grund, nur einmal, nur im Entwurf — und nie die letzte Leistungszeile', () => {
  it('jede Abweisung ist benannt und ändert nichts', async () => {
    const r = await entwurfZweiSaetze();
    expect(await grundVon(imDienst((d) => entfernePosition(d, r.ermaessigt, '  x ')))).toBe('grund_zu_kurz');
    expect(await kopf(r.id)).toEqual({ netto: '120000', steuer: '20400', brutto: '140400' });

    await imDienst((d) => entfernePosition(d, r.ermaessigt, 'doppelt erfasst'));
    expect(await grundVon(imDienst((d) => entfernePosition(d, r.ermaessigt, 'noch einmal'))))
      .toBe('schon_entfernt');
    expect(await grundVon(imDienst((d) => entfernePosition(d, r.voll, 'alles weg'))))
      .toBe('letzte_position');

    await imDienst((d) => finalisiere(d, r.id));
    expect(await grundVon(imDienst((d) => entfernePosition(d, r.voll, 'nach dem Festschreiben'))))
      .toBe('kein_entwurf');
    expect(await grundVon(imDienst((d) =>
      entfernePosition(d, '00000000-0000-4000-8000-000000000000', 'gibt es nicht'))))
      .toBe('nicht_gefunden');
  });

  it('am Dienst vorbei: keine Rückkehr, keine wieder wirksame Herkunft, kein Entfernen ohne Grund', async () => {
    const r = await entwurfZweiSaetze();
    await imDienst((d) => entfernePosition(d, r.ermaessigt, 'doppelt erfasst'));

    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `update rechnungsposition set entfernt_am = null, entfernt_von = null,
                                    entfernt_grund = null where id = $1`, [r.ermaessigt])))
      .rejects.toThrow(/entfernt und bleibt so/u);
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `update rechnungsposition_quelle set wirksam = true where rechnungsposition_id = $1`,
      [r.ermaessigt]))).rejects.toThrow(/Herkunft bleibt frei/u);
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `update rechnungsposition set entfernt_am = now(), entfernt_von = app.aktueller_benutzer()
        where id = $1`, [r.voll]))).rejects.toThrow(/rp_entfernung_benannt/u);
  });
});

describe('(4) der Kunde sieht die entfernte Zeile nicht', () => {
  it('auch nicht auf dem festgeschriebenen Beleg', async () => {
    const r = await entwurfZweiSaetze();
    await imDienst((d) => entfernePosition(d, r.ermaessigt, 'doppelt erfasst'));
    await imDienst((d) => finalisiere(d, r.id));
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1, $2, $3)`,
      [f.reinigung, kundeId, benutzer]);
    const sieht = await alsApp(
      { scope: 'kunde', mandantIds: [f.reinigung], benutzerId: benutzer, portal: 'kunde' },
      (tx) => tx.unsafe<{ bezeichnung: string }[]>(
        `select bezeichnung from rechnungsposition where rechnung_id = $1 order by position_nr`,
        [r.id]));
    expect(sieht.map((z) => z.bezeichnung)).toEqual(['Unterhaltsreinigung August 2026']);
  });
});
