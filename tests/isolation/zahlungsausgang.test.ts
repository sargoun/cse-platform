/**
 * V-216 — der Zahlungsausgang an Lieferanten (FIN-14, ACC-04, ACC-07, D-707).
 *
 * Bis hierher eroeffnete das Buchen einer Eingangsrechnung einen
 * Kreditorposten, und kein Weg glich ihn je aus. Hier stehen die Saetze, die
 * nur gegen eine Datenbank zu beweisen sind:
 *
 *  1. Eine Zahlung an den Lieferanten schliesst den Posten — ganz, teilweise,
 *     und eine Ueberzahlung wird ein Guthaben beim Lieferanten.
 *  2. Ohne gebuchte Rechnung kein Posten, und ein bezahlter wird nicht noch
 *     einmal bezahlt.
 *  3. Die Datenbank laesst einen Eingang keinen Kreditorposten und einen
 *     Ausgang keinen Debitorposten ausgleichen (0130) — auch auf dem neuen Weg.
 *  4. Ein Storno oeffnet den Posten wieder.
 *  5. Der Bankabgleich schlaegt fuer einen Ausgang die Verbindlichkeit vor,
 *     bucht ihn nie automatisch, und die Klaerung schliesst den Posten.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand,
} from '../../src/server/services/finanz/rechnung.js';
import {
  ZahlungFehler, erfasseZahlung, ordneZu, postenZuEingangsrechnung, postenZuRechnung,
  storniereZahlung, verbucheZahlungsausgang,
} from '../../src/server/services/finanz/zahlung/index.js';
import {
  erfasseEingangsrechnung, freigebe, inPruefung, legeBelegAn, setzeSteuerzeile, buche,
} from '../../src/server/services/finanz/eingangsrechnung.js';
import { abstimmungOffenePosten } from '../../src/server/services/buchhaltung/offene-posten.js';
import { ImportFehler, bestaetigeZuordnung, importiereAuszug }
  from '../../src/server/services/finanz/bank/import.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;
let lieferantId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const SHA = 'd'.repeat(64);
const IBAN_HAUS = 'DE02120300000000202051';
const JETZT = new Date(Date.UTC(2026, 8, 20, 9, 0, 0));

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung], abfrage, schreibe: abfrage,
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

async function richteEin(): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            telefon = '+49 30 5550100', email = 'rechnung@cse.test',
            ust_id = 'DE123456789', steuernummer = '30/123/45678', iban = $2
      where id = $1`, [f.reinigung, IBAN_HAUS]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test'),
            ($1, 'eingangsrechnung_beleg', null, 2026, 'Eingangsbelege', true, 'EB-{jahr}-{nr:5}',
             'jaehrlich', '2026-01-01', false, 'system', 'job:test')`,
    [f.reinigung]);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'firma','Beispiel GmbH','Musterweg','7','10178','Berlin') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into lieferant (mandant_id, lieferantennummer, name, plz, ort, status,
                            erstellt_von_art, erstellt_von_dienst)
     values ($1, $2, 'Hygiene Nord Handels GmbH', '13353', 'Berlin', 'aktiv', 'system', 'job:test')
     returning id`, [f.reinigung, `L-${zufall()}`]);
  lieferantId = l!.id;
}

async function heute(): Promise<string> {
  const [z] = await sql.unsafe<{ tag: string }[]>(`select app.berlin_heute()::text as tag`);
  return z!.tag;
}

/** Eine GEBUCHTE Eingangsrechnung — erst das Buchen eroeffnet den Kreditorposten. */
async function eingangsrechnung(
  nettoCent: bigint, { buchen = true, nummer = `L-${zufall()}` } = {},
): Promise<{ id: string; bruttoCent: bigint; nummer: string }> {
  const tag = await heute();
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
      dateiSha256: SHA, belegdatum: tag,
    });
    const er = await erfasseEingangsrechnung(d, {
      belegId, lieferantId, rechnungsnummerLieferant: nummer, rechnungsdatum: tag,
      leistungsdatum: tag, nettoCent: cent(nettoCent), steuerCent: cent(steuer),
      bruttoCent: cent(nettoCent + steuer), faelligAm: tag,
    });
    await setzeSteuerzeile(d, {
      eingangsrechnungId: er, steuergruppe: 'ust_19', nettoCent: cent(nettoCent), steuerCent: cent(steuer),
    });
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
  return { id, bruttoCent: nettoCent + steuer, nummer };
}

async function festgeschrieben(preisCent: bigint): Promise<string> {
  const id = await alsApp(sitzung(), async (tx) => {
    const d = kontextAus(tx);
    const neu = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
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
  await alsApp(sitzung(), async (tx) => finalisiere(kontextAus(tx), id));
  return id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`kreditor-${zufall()}@cse.test`);
  await richteEin();
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) eine Zahlung an den Lieferanten schliesst den Kreditorposten', () => {
  it('ganz — der Posten ist ausgeglichen, die Zahlung ist ein Ausgang, die Abstimmung geht auf', async () => {
    const er = await eingangsrechnung(100_000n);
    const tag = await heute();
    const e = await alsApp(sitzung(), (tx) => verbucheZahlungsausgang(kontextAus(tx), {
      eingangsrechnungId: er.id, betragCent: cent(er.bruttoCent), zahlungsdatum: tag,
      zahlungsmittel: 'ueberweisung', referenz: er.nummer,
    }));
    expect(e.angerechnetCent).toBe(er.bruttoCent);
    expect(e.ueberzahlungCent).toBe(0n);
    expect(e.offenCent).toBe(0n);
    expect(e.ausgeglichen).toBe(true);

    const [z] = await sql.unsafe<{ richtung: string; von: string | null }[]>(
      `select richtung::text as richtung, erstellt_von::text as von from zahlung where id = $1`,
      [e.zahlungId]);
    expect(z).toEqual({ richtung: 'ausgang', von: benutzer });

    const abstimmung = await alsApp(sitzung(), (tx) => abstimmungOffenePosten(kontextAus(tx)));
    const kreditor = abstimmung.find((a) => a.art === 'kreditor')!;
    expect(kreditor.ausPostenCent).toBe(0n);
    expect(kreditor.ausPostenCent).toBe(kreditor.ausBelegenCent);
  });

  it('teilweise — der Rest bleibt offen', async () => {
    const er = await eingangsrechnung(100_000n);
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungsausgang(kontextAus(tx), {
      eingangsrechnungId: er.id, betragCent: cent(50_000n), zahlungsdatum: await heute(),
      zahlungsmittel: 'ueberweisung',
    }));
    expect(e.offenCent).toBe(er.bruttoCent - 50_000n);
    expect(e.ausgeglichen).toBe(false);
  });

  it('zu viel — der Rest wird ein Guthaben beim Lieferanten, nicht weggeworfen', async () => {
    const er = await eingangsrechnung(100_000n);
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungsausgang(kontextAus(tx), {
      eingangsrechnungId: er.id, betragCent: cent(er.bruttoCent + 1_000n),
      zahlungsdatum: await heute(), zahlungsmittel: 'ueberweisung',
    }));
    expect(e.ueberzahlungCent).toBe(1_000n);
    expect(e.ausgeglichen).toBe(true);
    const [g] = await sql.unsafe<{ art: string; lieferant_id: string; betrag: string; offen: string }[]>(
      `select art::text as art, lieferant_id::text as lieferant_id, betrag_cent::text as betrag,
              offen_cent::text as offen
         from offener_posten where id = $1`, [e.guthabenPostenId]);
    expect(g).toEqual({ art: 'kreditor_guthaben', lieferant_id: lieferantId, betrag: '1000', offen: '1000' });
    const [spur] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'offener_posten.guthaben_eroeffnet' and objekt_id = $1`, [e.guthabenPostenId]);
    expect(spur?.n).toBe('1');
  });
});

describe('(2) kein Posten ohne Buchung, keine zweite Zahlung auf eine bezahlte Rechnung', () => {
  it('eine nur freigegebene Eingangsrechnung hat keinen Posten', async () => {
    const er = await eingangsrechnung(100_000n, { buchen: false });
    await expect(alsApp(sitzung(), async (tx) => verbucheZahlungsausgang(kontextAus(tx), {
      eingangsrechnungId: er.id, betragCent: cent(1_000n), zahlungsdatum: await heute(),
      zahlungsmittel: 'ueberweisung',
    }))).rejects.toSatisfy((e: unknown) => e instanceof ZahlungFehler && e.grund === 'kein_posten');
  });

  it('eine bezahlte wird nicht noch einmal bezahlt — und es entsteht keine Zahlung', async () => {
    const er = await eingangsrechnung(100_000n);
    const tag = await heute();
    await alsApp(sitzung(), (tx) => verbucheZahlungsausgang(kontextAus(tx), {
      eingangsrechnungId: er.id, betragCent: cent(er.bruttoCent), zahlungsdatum: tag,
      zahlungsmittel: 'ueberweisung',
    }));
    await expect(alsApp(sitzung(), (tx) => verbucheZahlungsausgang(kontextAus(tx), {
      eingangsrechnungId: er.id, betragCent: cent(100n), zahlungsdatum: tag,
      zahlungsmittel: 'ueberweisung',
    }))).rejects.toSatisfy((e: unknown) => e instanceof ZahlungFehler && e.grund === 'schon_ausgeglichen');
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from zahlung where richtung = 'ausgang'`);
    expect(n?.n).toBe('1');
  });
});

describe('(3) die Richtung passt zum Posten (0130)', () => {
  it('ein Eingang gleicht keinen Kreditorposten aus', async () => {
    const er = await eingangsrechnung(100_000n);
    const tag = await heute();
    await expect(alsApp(sitzung(), async (tx) => {
      const d = kontextAus(tx);
      const posten = await postenZuEingangsrechnung(d, er.id);
      const zahlungId = await erfasseZahlung(d, {
        richtung: 'eingang', betragCent: cent(1_000n), zahlungsdatum: tag, zahlungsmittel: 'ueberweisung',
      });
      await ordneZu(d, { zahlungId, offenerPostenId: posten!.id, art: 'zahlung', betragCent: cent(1_000n) });
    })).rejects.toThrow(/Richtung eingang gehoert nicht auf einen Posten der Art kreditor/u);
  });

  it('ein Ausgang gleicht keine Forderung gegen einen Kunden aus — die Rueckbuchung', async () => {
    const r = await festgeschrieben(100_000n);
    const tag = await heute();
    await expect(alsApp(sitzung(), async (tx) => {
      const d = kontextAus(tx);
      const posten = await postenZuRechnung(d, r);
      const zahlungId = await erfasseZahlung(d, {
        richtung: 'ausgang', betragCent: cent(1_000n), zahlungsdatum: tag, zahlungsmittel: 'ueberweisung',
      });
      await ordneZu(d, { zahlungId, offenerPostenId: posten!.id, art: 'zahlung', betragCent: cent(1_000n) });
    })).rejects.toThrow(/Richtung ausgang gehoert nicht auf einen Posten der Art debitor/u);
  });
});

describe('(4) ein Storno oeffnet den Posten wieder', () => {
  it('die stornierte Zahlung gibt den Kreditorposten frei', async () => {
    const er = await eingangsrechnung(100_000n);
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungsausgang(kontextAus(tx), {
      eingangsrechnungId: er.id, betragCent: cent(er.bruttoCent), zahlungsdatum: await heute(),
      zahlungsmittel: 'ueberweisung',
    }));
    await alsApp(sitzung(), (tx) =>
      storniereZahlung(kontextAus(tx), e.zahlungId, 'Doppelt erfasst, Auszug zeigt eine Zahlung'));
    const posten = await alsApp(sitzung(), (tx) => postenZuEingangsrechnung(kontextAus(tx), er.id));
    expect(posten?.offenCent).toBe(er.bruttoCent);
    expect(posten?.ausgeglichenAm).toBeNull();
  });
});

describe('(5) der Bankabgleich: ein Ausgang an einen Lieferanten', () => {
  async function bankkonto(): Promise<string> {
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into bankkonto (mandant_id, bezeichnung, iban, kontoinhaber,
                              erstellt_von_art, erstellt_von_dienst)
       values ($1, 'Geschaeftskonto', $2, 'CSE Dienstleistungen GmbH', 'system', 'job:test')
       returning id`, [f.reinigung, IBAN_HAUS]);
    return k!.id;
  }

  function auszugMitAusgang(betrag: string, zweck: string): Uint8Array {
    return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt><Stmt>
    <Id>AUSZUG-A-${zufall()}</Id>
    <Acct><Id><IBAN>${IBAN_HAUS}</IBAN></Id><Ccy>EUR</Ccy></Acct>
    <FrToDt><FrDtTm>2026-09-01T00:00:00+02:00</FrDtTm>
            <ToDtTm>2026-09-30T23:59:59+02:00</ToDtTm></FrToDt>
    <Ntry>
      <Amt Ccy="EUR">${betrag}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
      <BookgDt><Dt>2026-09-15</Dt></BookgDt><ValDt><Dt>2026-09-15</Dt></ValDt>
      <NtryDtls><TxDtls>
        <RltdPties><Cdtr><Nm>Hygiene Nord Handels GmbH</Nm></Cdtr></RltdPties>
        <RmtInf><Ustrd>${zweck}</Ustrd></RmtInf>
      </TxDtls></NtryDtls>
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`);
  }

  function alsImport(tx: postgres.TransactionSql) {
    const lauf = async <T,>(a: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(a, w as never[])) as readonly T[];
    return { aktiverMandantId: f.reinigung, abfrage: lauf, schreibe: lauf };
  }

  it('der Vorschlag nennt die Verbindlichkeit, gebucht wird nichts — die Klaerung schliesst den Posten', async () => {
    await bankkonto();
    const er = await eingangsrechnung(100_000n, { nummer: 'HN-2026-4711' });
    const betrag = `${(er.bruttoCent / 100n).toString()}.${(er.bruttoCent % 100n).toString().padStart(2, '0')}`;

    const ergebnis = await alsApp(sitzung(), (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(), auszugMitAusgang(betrag, 'Rechnung HN-2026-4711'), JETZT));
    expect(ergebnis.automatischZugeordnet).toBe(0);
    expect(ergebnis.inKlaerung).toBe(1);
    const [u] = await sql.unsafe<{ id: string; zustand: string; text: string }[]>(
      `select id, zustand::text as zustand, vorschlag_text as text from kontoumsatz
        where kontoauszug_id = $1`, [ergebnis.auszugId]);
    expect(u?.zustand).toBe('in_klaerung');
    expect(u?.text).toContain('Hygiene Nord Handels GmbH');
    expect(u?.text).toContain('HN-2026-4711');
    const [ohne] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from zahlung where richtung = 'ausgang'`);
    expect(ohne?.n, 'vor der Bestaetigung keine Zahlung').toBe('0');

    const posten = await alsApp(sitzung(), (tx) => postenZuEingangsrechnung(kontextAus(tx), er.id));
    const k = await alsApp(sitzung(), (tx) => bestaetigeZuordnung(alsImport(tx), u!.id, posten!.id));
    expect(k.auszugAbgeglichen).toBe(true);

    const danach = await alsApp(sitzung(), (tx) => postenZuEingangsrechnung(kontextAus(tx), er.id));
    expect(danach?.offenCent).toBe(0n);
    const [z] = await sql.unsafe<{ richtung: string; art: string; konto: string | null }[]>(
      `select z.richtung::text as richtung, z.erstellt_von_art::text as art,
              z.bankkonto_id::text as konto
         from zahlung z join umsatz_zuordnung uz on uz.zahlung_id = z.id
        where uz.kontoumsatz_id = $1`, [u!.id]);
    expect(z?.richtung).toBe('ausgang');
    expect(z?.art).toBe('mensch');
    expect(z?.konto).not.toBeNull();
  });

  it('ein Ausgang wird keiner Ausgangsrechnung zugeordnet — auch nicht von Hand', async () => {
    await bankkonto();
    const r = await festgeschrieben(100_000n);
    const ergebnis = await alsApp(sitzung(), (tx) => importiereAuszug(
      alsImport(tx), new LokalerSpeicher(), auszugMitAusgang('1190.00', 'Rueckbuchung'), JETZT));
    const [u] = await sql.unsafe<{ id: string }[]>(
      'select id from kontoumsatz where kontoauszug_id = $1', [ergebnis.auszugId]);
    const debitor = await alsApp(sitzung(), (tx) => postenZuRechnung(kontextAus(tx), r));
    await expect(alsApp(sitzung(), (tx) => bestaetigeZuordnung(alsImport(tx), u!.id, debitor!.id)))
      .rejects.toThrow(ImportFehler);
  });
});
