/**
 * **Das Logo auf der Rechnung, gegen echtes Postgres** (V-132, D-625, K-12).
 *
 * Der Bauer und der Leser stehen in `tests/kern/rechnung-logo.test.ts`, die
 * PDF/A-Prüfung in `tests/compliance/zugferd/verapdf.test.ts`. Hier steht,
 * was nur die Datenbank halten kann:
 *
 *  1. **Die Festschreibung kopiert das Logo in die Nutzlast** — aus
 *     `mandant_identitaet`, in `cse.rechnung.v4`, mit Schlüssel und Prüfsumme.
 *  2. **Ein späteres Logo ändert die festgeschriebene Rechnung nicht**: ihr
 *     PDF entsteht danach Byte für Byte wie vorher.
 *  3. **Ohne die festgehaltenen Bytes entsteht kein Blatt** — nicht verbunden,
 *     nicht gefunden, oder andere Bytes unter demselben Schlüssel.
 *  4. **Eine Rechnung ohne Logo braucht keinen Speicher.**
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { zugferdZurRechnung } from '../../src/server/services/finanz/xrechnung/dienst.js';
import { RechnungslogoFehler } from '../../src/server/services/finanz/zugferd/pdfa3.js';
import {
  LokalerSpeicher, NichtVerbundenFehler, SupabaseSpeicher,
} from '../../src/server/storage/adapter.js';
import { pngMitAlpha } from '../kern/hilfen/bild.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const summe = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

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

/** Dieselbe fakturierfähige Gesellschaft wie in `xrechnung.test.ts`. */
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
  /* Im Seed feuert der Anlageauslöser nicht (siehe mandant-identitaet.test.ts). */
  await sql.unsafe(
    `insert into mandant_identitaet (mandant_id, kurzname, identitaets_token)
     values ($1, 'Reinigung', 'area-reinigung') on conflict (mandant_id) do nothing`,
    [mandantId]);
}

/**
 * Ein Logo setzen, wie `setzeMarkenbild` es hinterlässt: Schlüssel aus dem
 * Inhalt, Datei im Behälter `marke`. Direkt geschrieben, weil der Hochladeweg
 * seine eigene Prüfung hat (`markenbild.test.ts`) — hier geht es um das,
 * was die Festschreibung daraus macht.
 */
async function setzeLogo(
  speicher: LokalerSpeicher, art: 'logo_druck' | 'logo_hell', bytes: Uint8Array,
  endung: 'png' | 'svg' = 'png',
): Promise<string> {
  const schluessel = `${f.reinigung}/${art}/${summe(bytes)}.${endung}`;
  await speicher.lege('marke', schluessel, bytes);
  await sql.unsafe(
    `update mandant_identitaet set ${art}_pfad = $2, logo_alt = 'Logo der Reinigung'
      where mandant_id = $1`, [f.reinigung, schluessel]);
  return schluessel;
}

async function festgeschriebeneRechnung(): Promise<string> {
  return alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung August 2026',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(100_000n), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [id] as never[]);
    await finalisiere(d, id);
    return id;
  });
}

async function snapshot(id: string): Promise<{ version: string; logo: unknown }> {
  const [z] = await sql.unsafe<{ schema_version: string; nutzlast_bytes: Uint8Array }[]>(
    `select schema_version, nutzlast_bytes from rechnung_snapshot where rechnung_id = $1`, [id]);
  const o = JSON.parse(Buffer.from(z!.nutzlast_bytes).toString('utf8')) as
    { leistender: { logo: unknown } };
  return { version: z!.schema_version, logo: o.leistender.logo };
}

async function pdf(id: string, speicher: LokalerSpeicher | SupabaseSpeicher): Promise<Uint8Array> {
  const e = await alsApp(sitzung(), async (tx) =>
    zugferdZurRechnung(alsDienst(tx), id, speicher));
  return e!.pdf;
}

async function bildbreiten(d: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(d);
  const breiten: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
        && obj.dict.get(PDFName.of('SMask')) !== undefined) {
      breiten.push(obj.dict.get(PDFName.of('Width'))?.toString() ?? '');
    }
  }
  return breiten;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`logo-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort,
                        ist_oeffentlicher_auftraggeber, xrechnung_pflicht, leitweg_id,
                        elektronische_adresse, elektronische_adresse_schema)
     values ($1,$2,'behoerde','Bezirksamt Musterberg','Musterplatz','1','10178','Berlin',
             true, true, '991-12345-67', '991-12345-67', '0204') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
});
afterAll(schliessen);

describe('§1 die Festschreibung hält das Logo fest', () => {
  it('v4 mit Schlüssel, Prüfsumme und Typ — und das PDF trägt das Bild', async () => {
    const speicher = new LokalerSpeicher();
    const png = pngMitAlpha(240, 80);
    const schluessel = await setzeLogo(speicher, 'logo_druck', png);
    const id = await festgeschriebeneRechnung();

    expect(await snapshot(id)).toEqual({
      version: 'cse.rechnung.v4',
      logo: { schluessel, sha256: summe(png), mime: 'image/png' },
    });
    expect(await bildbreiten(await pdf(id, speicher))).toEqual(['240']);
  });

  it('das helle Logo, wenn das Drucklogo nur als SVG vorliegt (DESIGN §4)', async () => {
    const speicher = new LokalerSpeicher();
    await setzeLogo(speicher, 'logo_druck', new TextEncoder().encode('<svg/>'), 'svg');
    const hell = pngMitAlpha(120, 40);
    const schluessel = await setzeLogo(speicher, 'logo_hell', hell);
    const id = await festgeschriebeneRechnung();
    expect((await snapshot(id)).logo).toEqual(
      { schluessel, sha256: summe(hell), mime: 'image/png' });
  });

  it('kein Rasterlogo → `logo: null`, und das PDF braucht keinen Speicher', async () => {
    const id = await festgeschriebeneRechnung();
    expect(await snapshot(id)).toEqual({ version: 'cse.rechnung.v4', logo: null });
    /* Nicht verbunden — und trotzdem ein Blatt: es gibt nichts zu holen. */
    expect(await bildbreiten(await pdf(id, new SupabaseSpeicher('', '')))).toEqual([]);
  });
});

describe('§2 ein neues Logo ändert keine festgeschriebene Rechnung (K-12)', () => {
  it('das PDF entsteht danach Byte für Byte wie vorher', async () => {
    const speicher = new LokalerSpeicher();
    await setzeLogo(speicher, 'logo_druck', pngMitAlpha(240, 80));
    const id = await festgeschriebeneRechnung();
    const vorher = await pdf(id, speicher);

    await setzeLogo(speicher, 'logo_druck', pngMitAlpha(300, 60));
    const nachher = await pdf(id, speicher);
    expect(summe(nachher)).toBe(summe(vorher));
    expect(await bildbreiten(nachher)).toEqual(['240']);

    /* Und die NÄCHSTE Rechnung trägt das neue. */
    const neu = await festgeschriebeneRechnung();
    expect(await bildbreiten(await pdf(neu, speicher))).toEqual(['300']);
  });
});

describe('§3 ohne die festgehaltenen Bytes entsteht kein Blatt', () => {
  it('Speicher nicht verbunden → NichtVerbundenFehler', async () => {
    await setzeLogo(new LokalerSpeicher(), 'logo_druck', pngMitAlpha(240, 80));
    const id = await festgeschriebeneRechnung();
    await expect(pdf(id, new SupabaseSpeicher('', ''))).rejects
      .toBeInstanceOf(NichtVerbundenFehler);
  });

  it('die Datei fehlt im Speicher → RechnungslogoFehler', async () => {
    await setzeLogo(new LokalerSpeicher(), 'logo_druck', pngMitAlpha(240, 80));
    const id = await festgeschriebeneRechnung();
    await expect(pdf(id, new LokalerSpeicher())).rejects.toBeInstanceOf(RechnungslogoFehler);
  });

  it('andere Bytes unter demselben Schlüssel → RechnungslogoFehler', async () => {
    const speicher = new LokalerSpeicher();
    const schluessel = await setzeLogo(speicher, 'logo_druck', pngMitAlpha(240, 80));
    const id = await festgeschriebeneRechnung();
    await speicher.lege('marke', schluessel, pngMitAlpha(240, 81));
    await expect(pdf(id, speicher)).rejects.toThrow(/nicht das festgeschriebene/u);
  });
});
