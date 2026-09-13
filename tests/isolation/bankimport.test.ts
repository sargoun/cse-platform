/**
 * PR 61 — der CAMT.053-Import gegen eine echte Datenbank (ACC-04).
 *
 * Leser und Abgleichsregeln stehen ohne Datenbank in `tests/kern/camt.test.ts`
 * und `tests/kern/bank-abgleich.test.ts`. Hier stehen die vier Saetze der
 * Abnahme, die nur gegen eine Datenbank zu beweisen sind:
 *
 *  1. Derselbe Auszug zweimal eingelesen fuegt NICHTS hinzu.
 *  2. Ein eindeutiger Treffer legt die Zahlung an; ein mehrdeutiger geht in
 *     die Schlange und wird NIE automatisch zugeordnet.
 *  3. Betraege landen als ganze Cent in der Datenbank.
 *  4. Ein unzugeordneter Umsatz bleibt sichtbar; eine Zuordnung ist
 *     widerrufbar, und der Widerruf laesst beide Seiten stehen.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import type { ArchivKontext } from '../../src/server/services/buchhaltung/belegarchiv.js';
import { ImportFehler, importiereAuszug }
  from '../../src/server/services/finanz/bank/import.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage & ArchivKontext {
  const lauf = async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
    (await tx.unsafe(anweisung, werte as never[])) as readonly T[];
  return { aktiverMandantId: f.reinigung, abfrage: lauf, schreibe: lauf };
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
            telefon = '+49 30 5550100', email = 'rechnung@cse.test',
            rechnung_kontakt_name = 'Buchhaltung',
            elektronische_adresse = 'DE123456789', elektronische_adresse_schema = '9930',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B',
            iban = 'DE02120300000000202051'
      where id = $1`, [mandantId]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

/**
 * Kontenrahmen und Zuordnung — im Betrieb O-05, hier Vorrichtung.
 *
 * **Ohne sie stuende jede Zeile ohnehin auf der Unvollstaendigkeitsliste**,
 * und zwar wegen des fehlenden Kontos. Der Test wollte dann beweisen, dass
 * der Beleg die Liste leert, und bewiese nur, dass sie voll bleibt.
 */
async function richteKontenEin(mandantId: string, kundeId: string): Promise<void> {
  await sql.unsafe(
    `insert into datev_konfiguration
       (mandant_id, kontenrahmen, sachkontenlaenge, wj_beginn_monat, wj_beginn_tag,
        ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'skr03'::kontenrahmen, 4, 1, 1, true, 'system', 'job:test')
     on conflict (mandant_id) do nothing`, [mandantId]);

  const [ust19] = await sql.unsafe<{ id: string }[]>(
    `select id from steuersatz_gruppe where schluessel = 'ust_19'`);

  const zuordnung = async (typ: string, konto: string, zusatz: {
    gruppe?: string; schluessel?: string; kunde?: string;
  } = {}): Promise<void> => {
    await sql.unsafe(
      `insert into konto_mapping
         (mandant_id, kontenrahmen, schluessel_typ, steuersatz_gruppe_id,
          erloeskonto_schluessel, kunde_id, konto, gueltig_von, ist_platzhalter,
          erstellt_von_art, erstellt_von_dienst)
       values ($1, 'skr03'::kontenrahmen, $2::konto_schluessel_typ, $3, $4, $5, $6,
               '2020-01-01', false, 'system', 'job:test')`,
      [mandantId, typ, zusatz.gruppe ?? null, zusatz.schluessel ?? null,
        zusatz.kunde ?? null, konto]);
  };

  await zuordnung('erloes_leistung', '8400', { schluessel: 'standard', gruppe: ust19!.id });
  await zuordnung('steuer_gruppe', '1776', { gruppe: ust19!.id });
  await zuordnung('debitor_kunde', '10001', { kunde: kundeId });
}

/** Eine festgeschriebene 19-%-Rechnung mit Erlösschlüssel. */
async function festgeschrieben(preisCent = 100_000n): Promise<string> {
  const id = await alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const neu = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: neu, bezeichnung: 'Unterhaltsreinigung',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(preisCent), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [neu] as never[]);
    await tx.unsafe(
      `update rechnungsposition set erloeskonto_schluessel = 'standard'
        where rechnung_id = $1 and netto_cent is not null`, [neu] as never[]);
    return neu;
  });
  await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));
  return id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`beleg-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort,
                        ist_oeffentlicher_auftraggeber, xrechnung_pflicht, leitweg_id,
                        elektronische_adresse, elektronische_adresse_schema)
     values ($1, $2, 'behoerde', 'Bezirksamt Musterberg', 'Musterplatz', '1', '10178',
             'Berlin', true, true, '991-12345-67', '991-12345-67', '0204')
     returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
  await richteKontenEin(f.reinigung, kundeId);
});

afterAll(schliessen);

const IBAN_HAUS   = 'DE02120300000000202051';
const IBAN_ZAHLER = 'DE89370400440532013000';
const JETZT = new Date(Date.UTC(2026, 8, 20, 9, 0, 0));

/** Das Bankkonto der Gesellschaft — der Auszug muss darauf zeigen koennen. */
async function legeBankkontoAn(mandantId: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into bankkonto (mandant_id, bezeichnung, iban, kontoinhaber,
                            erstellt_von_art, erstellt_von_dienst)
     values ($1, 'Geschaeftskonto', $2, 'CSE Dienstleistungen GmbH',
             'system', 'job:test')
     returning id`, [mandantId, IBAN_HAUS]);
  return k!.id;
}

/** Ein CAMT.053 mit beliebig vielen Zeilen. */
function auszug(eintraege: string, id = 'AUSZUG-1'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt><Stmt>
    <Id>${id}</Id>
    <Acct><Id><IBAN>${IBAN_HAUS}</IBAN></Id><Ccy>EUR</Ccy></Acct>
    <FrToDt><FrDtTm>2026-09-01T00:00:00+02:00</FrDtTm>
            <ToDtTm>2026-09-30T23:59:59+02:00</ToDtTm></FrToDt>
    <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
      <Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
    <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
      <Amt Ccy="EUR">2190.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
    ${eintraege}
  </Stmt></BkToCstmrStmt>
</Document>`;
}

function eingang(betrag: string, zweck: string, iban = IBAN_ZAHLER): string {
  return `
    <Ntry>
      <Amt Ccy="EUR">${betrag}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
      <BookgDt><Dt>2026-09-15</Dt></BookgDt><ValDt><Dt>2026-09-16</Dt></ValDt>
      <NtryDtls><TxDtls>
        <Refs><EndToEndId>${zweck}</EndToEndId></Refs>
        <RltdPties><Dbtr><Nm>Bezirksamt Musterberg</Nm></Dbtr>
          <DbtrAcct><Id><IBAN>${iban}</IBAN></Id></DbtrAcct></RltdPties>
        <RmtInf><Ustrd>${zweck}</Ustrd></RmtInf>
      </TxDtls></NtryDtls>
    </Ntry>`;
}

/** Eine festgeschriebene Rechnung samt ihrem offenen Posten. */
async function offenerPosten(preisCent = 100_000n): Promise<{
  rechnungId: string; nummer: string; bruttoCent: bigint;
}> {
  const rechnungId = await festgeschrieben(preisCent);
  const [r] = await sql.unsafe<{ nummer: string; brutto_cent: string }[]>(
    'select nummer, brutto_cent::text from rechnung where id = $1', [rechnungId]);
  return {
    rechnungId, nummer: r!.nummer, bruttoCent: BigInt(r!.brutto_cent),
  };
}

function alsImport(tx: postgres.TransactionSql) {
  return alsDienst(tx);
}

// ---------------------------------------------------------------------------
// (1) Derselbe Auszug zweimal
// ---------------------------------------------------------------------------

describe('(1) der Import ist idempotent — ueber den Pruefwert der DATEI', () => {
  it('zweimal dieselbe Datei ergibt keine zweite Zeile', async () => {
    await legeBankkontoAn(f.reinigung);
    const p = await offenerPosten();
    const xml = auszug(eingang('1190.00', p.nummer));

    const erst = await alsApp(sitzung(), async (tx) =>
      importiereAuszug(alsImport(tx), new LokalerSpeicher(), xml, JETZT));
    expect(erst.neu).toBe(true);
    expect(erst.zeilen).toBe(1);

    const zweit = await alsApp(sitzung(), async (tx) =>
      importiereAuszug(alsImport(tx), new LokalerSpeicher(), xml, JETZT));
    expect(zweit.neu, 'die zweite Einlesung ist ein Nichtereignis').toBe(false);
    expect(zweit.auszugId).toBe(erst.auszugId);

    const [n] = await sql.unsafe<{ auszuege: string; umsaetze: string }[]>(
      `select (select count(*) from kontoauszug)::text as auszuege,
              (select count(*) from kontoumsatz)::text as umsaetze`);
    expect(n?.auszuege).toBe('1');
    expect(n?.umsaetze).toBe('1');
  });

  it('eine ANDERE Datei mit derselben Auszugsnummer kommt herein', async () => {
    /*
     * Zwei Banken vergeben ihre Auszugsnummern unabhaengig voneinander.
     * Ueber `auszug_id` zu entdoppeln haette den zweiten Auszug als Dublette
     * abgewiesen, die keine ist.
     */
    await legeBankkontoAn(f.reinigung);
    const p = await offenerPosten();
    await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(), auszug(eingang('1190.00', p.nummer)), JETZT));
    const zweit = await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(eingang('500.00', 'Sonstiges')), JETZT));
    expect(zweit.neu).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (2) Eindeutig bucht, mehrdeutig wartet
// ---------------------------------------------------------------------------

describe('(2) ein mehrdeutiger Treffer wird NIE automatisch zugeordnet', () => {
  it('Betrag und Nummer, aber unbekannte IBAN: in Klaerung, keine Zahlung', async () => {
    /*
     * Beim ERSTEN Mal kennt die Plattform die IBAN des Kunden nicht — sie
     * wird gelernt, nicht gepflegt. Also bleibt der Treffer
     * `eindeutig_ohne_iban`, und ein Mensch sieht ihn an.
     */
    await legeBankkontoAn(f.reinigung);
    const p = await offenerPosten();
    const e = await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(eingang('1190.00', p.nummer)), JETZT));

    expect(e.automatischZugeordnet).toBe(0);
    expect(e.inKlaerung).toBe(1);

    const [u] = await sql.unsafe<{ zustand: string; vorschlag_art: string;
                                   vorschlag_text: string }[]>(
      'select zustand, vorschlag_art, vorschlag_text from kontoumsatz');
    expect(u?.zustand).toBe('in_klaerung');
    expect(u?.vorschlag_art).toBe('eindeutig_ohne_iban');
    expect(u?.vorschlag_text).toContain(p.nummer);

    const [z] = await sql.unsafe<{ n: string }[]>(
      'select count(*)::text as n from zahlung');
    expect(z?.n, 'keine Zahlung ohne Menschen').toBe('0');
  });

  it('ein Betrag ohne Nummer im Zweck bleibt in Klaerung — mit Begruendung', async () => {
    await legeBankkontoAn(f.reinigung);
    await offenerPosten();
    await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(eingang('1190.00', 'Zahlung')), JETZT));

    const [u] = await sql.unsafe<{ zustand: string; vorschlag_text: string }[]>(
      'select zustand, vorschlag_text from kontoumsatz');
    expect(u?.zustand).toBe('in_klaerung');
    expect(u?.vorschlag_text).toContain('Ein Betrag allein ordnet nichts zu');
  });

  it('eine Vormerkung wird gar nicht erst abgeglichen', async () => {
    await legeBankkontoAn(f.reinigung);
    const p = await offenerPosten();
    await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(), auszug(`
        <Ntry><Amt Ccy="EUR">1190.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
          <Sts>PDNG</Sts><BookgDt><Dt>2026-09-15</Dt></BookgDt>
          <RmtInf><Ustrd>${p.nummer}</Ustrd></RmtInf></Ntry>`), JETZT));

    const [u] = await sql.unsafe<{ gebucht: boolean; zustand: string;
                                   vorschlag_text: string }[]>(
      'select gebucht, zustand, vorschlag_text from kontoumsatz');
    expect(u?.gebucht).toBe(false);
    expect(u?.zustand).toBe('in_klaerung');
    expect(u?.vorschlag_text).toContain('Vormerkung');
  });
});

// ---------------------------------------------------------------------------
// (3) Betraege als ganze Cent
// ---------------------------------------------------------------------------

describe('(3) der Betrag kommt als ganzer Cent in der Datenbank an', () => {
  it('1190,00 sind 119000 Cent — und 0,01 ist ein Cent', async () => {
    await legeBankkontoAn(f.reinigung);
    await offenerPosten();
    await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(`${eingang('1190.00', 'A')}${eingang('0.01', 'B')}`), JETZT));

    const zeilen = await sql.unsafe<{ betrag_cent: string }[]>(
      'select betrag_cent::text from kontoumsatz order by laufnummer');
    expect(zeilen.map((z) => z.betrag_cent)).toEqual(['119000', '1']);
  });

  it('ein Ausgang traegt seine Richtung in der Spalte, nicht im Vorzeichen', async () => {
    await legeBankkontoAn(f.reinigung);
    await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(), auszug(`
        <Ntry><Amt Ccy="EUR">500.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
          <Sts>BOOK</Sts><BookgDt><Dt>2026-09-15</Dt></BookgDt></Ntry>`), JETZT));

    const [u] = await sql.unsafe<{ richtung: string; betrag_cent: string }[]>(
      'select richtung::text as richtung, betrag_cent::text from kontoumsatz');
    expect(u?.richtung).toBe('ausgang');
    expect(u?.betrag_cent, 'immer positiv').toBe('50000');
  });
});

// ---------------------------------------------------------------------------
// (4) Der Umsatz bleibt, die Zuordnung ist widerrufbar
// ---------------------------------------------------------------------------

describe('(4) nichts verschwindet, und ein Fehlgriff ist zuruecknehmbar', () => {
  it('ein Umsatz ohne jeden Bezug bleibt sichtbar', async () => {
    await legeBankkontoAn(f.reinigung);
    await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(eingang('77.00', 'Bankgebuehr')), JETZT));

    const [u] = await sql.unsafe<{ zustand: string; vorschlag_text: string }[]>(
      'select zustand, vorschlag_text from kontoumsatz');
    expect(u?.zustand).toBe('in_klaerung');
    expect(u?.vorschlag_text).toContain('bleibt in der Schlange');
  });

  it('`ohne_bezug` verlangt einen Grund — ein Haken allein reicht nicht', async () => {
    await legeBankkontoAn(f.reinigung);
    await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(eingang('77.00', 'Bankgebuehr')), JETZT));
    const [u] = await sql.unsafe<{ id: string }[]>('select id from kontoumsatz');

    await expect(sql.unsafe(
      `update kontoumsatz set zustand = 'ohne_bezug' where id = $1`, [u!.id]))
      .rejects.toThrow();

    await sql.unsafe(
      `update kontoumsatz set zustand = 'ohne_bezug',
                              klaerungsnotiz = 'Kontofuehrungsgebuehr der Bank'
        where id = $1`, [u!.id]);
    const [nach] = await sql.unsafe<{ zustand: string }[]>(
      'select zustand::text as zustand from kontoumsatz where id = $1', [u!.id]);
    expect(nach?.zustand).toBe('ohne_bezug');
  });

  it('was die Bank gesagt hat, laesst sich nicht umschreiben', async () => {
    await legeBankkontoAn(f.reinigung);
    await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(eingang('77.00', 'Gebuehr')), JETZT));
    const [u] = await sql.unsafe<{ id: string }[]>('select id from kontoumsatz');

    await expect(sql.unsafe(
      'update kontoumsatz set betrag_cent = 1 where id = $1', [u!.id]))
      .rejects.toThrow(/bleibt stehen/u);
  });

  it('und weder Auszug noch Umsatz lassen sich hart loeschen', async () => {
    await legeBankkontoAn(f.reinigung);
    const e = await alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(eingang('77.00', 'Gebuehr')), JETZT));

    await expect(sql.unsafe('delete from kontoumsatz')).rejects.toThrow();
    await expect(sql.unsafe('delete from kontoauszug where id = $1', [e.auszugId]))
      .rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Der Auszug landet nie auf dem falschen Konto
// ---------------------------------------------------------------------------

describe('der Auszug gehoert zu genau einem Bankkonto', () => {
  it('ohne hinterlegtes Konto zur IBAN wird NICHTS eingelesen', async () => {
    const p = await offenerPosten();
    await expect(alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(),
      auszug(eingang('1190.00', p.nummer)), JETZT)))
      .rejects.toThrow(ImportFehler);

    const [n] = await sql.unsafe<{ n: string }[]>(
      'select count(*)::text as n from kontoauszug');
    expect(n?.n).toBe('0');
  });

  it('ein Auszug ohne IBAN wird abgewiesen, statt geraten zu werden', async () => {
    await legeBankkontoAn(f.reinigung);
    const ohneIban = auszug(eingang('77.00', 'X'))
      .replace(`<Acct><Id><IBAN>${IBAN_HAUS}</IBAN></Id><Ccy>EUR</Ccy></Acct>`, '');
    await expect(alsApp(sitzung(), async (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(), ohneIban, JETZT)))
      .rejects.toThrow(/nennt keine IBAN/u);
  });
});
