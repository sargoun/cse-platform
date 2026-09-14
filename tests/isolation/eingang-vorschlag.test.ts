/**
 * PR 63 gegen eine echte Datenbank — die E-Rechnung als Vorschlag, die
 * Freigabe als Tor, die Uebernahme als Handlung (ACC-05, APR-01 … APR-03,
 * Invariante 7).
 *
 *  1. Der Vorschlag ist vollstaendig: Kopf, Betrag, Risiko `hoch`, Bezug auf
 *     den Beleg, `payload_hash` ueber die kanonischen Bytes — und jedes Feld
 *     nennt Element und Zitat der Datei, der Lieferant seinen Weg in den
 *     Stamm.
 *  2. Dieselben Bytes zweimal: derselbe Vorschlag, kein zweiter Beleg.
 *  3. Ein Lieferant, der nicht im Stamm ist, macht Felder unsicher — und die
 *     Entscheidung weist die Genehmigung im DIENST ab, nicht erst im Knopf.
 *  4. Genehmigt heisst uebernommen: Eingangsrechnung, Steuerzeile, Bezug;
 *     ein zweiter Aufruf legt nichts nach.
 *  5. Nicht genehmigt heisst nicht uebernommen; eine fremde Aktion tut nichts.
 *  6. Ueber die Mandantengrenze ist der Vorschlag nicht da (Invariante 3).
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import { kanonisiere } from '../../src/server/services/finanz/kanonisch.js';
import { alsKanonischerWert } from '../../src/server/services/freigabe/diff-json.js';
import { oeffneFreigabe } from '../../src/server/services/freigabe/laden.js';
import { entscheideFreigabe, FreigabeAbgewiesen } from '../../src/server/services/freigabe/entscheiden.js';
import { AusfuehrungAbgewiesen, fuehreAus } from '../../src/server/services/freigabe/ausfuehrung.js';
import { extrahiereERechnung } from '../../src/server/services/finanz/eingang/erechnung.js';
import { legeERechnungAb } from '../../src/server/services/finanz/eingang/ablage.js';
import {
  AKTION_UEBERNEHMEN, VorschlagFehler, uebernehmeEingangsVorschlag,
} from '../../src/server/services/finanz/eingang/vorschlag.js';
import {
  BEISPIEL_REINIGUNG, beispielERechnungUbl, type ERechnungBeispiel,
} from '../../src/server/db/seed/eingang.js';

let f: Fixtur;
let benutzer: string;
let lieferantId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const sha256 = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');

function sitzung(mandantId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(
  tx: postgres.TransactionSql, mandantId?: string, benutzerId?: string,
): SchreibKontext {
  const m = mandantId ?? f.reinigung;
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzerId ?? benutzer,
    aktiverMandantId: m, mandantIds: [m], abfrage, schreibe: abfrage,
  };
}

async function legeBenutzerAn(email: string, globaleRolle: string | null = 'super_admin'): Promise<string> {
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

/**
 * Eine Administration der Reinigung — Mitglied ueber `benutzer_mandant`, ohne
 * globale Rolle. `admin` haelt `eingang.freigeben` (das Recht des Vorschlags)
 * und `freigabe.entscheiden`; `leitung` hielte das erste nicht und kaeme gar
 * nicht bis zur Entscheidung.
 */
async function legeAdministrationAn(): Promise<string> {
  const id = await legeBenutzerAn(`admin-${zufall()}@cse.test`, null);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [id, f.reinigung]);
  return id;
}

/** Entzieht der Systemrolle ein Recht in genau dieser Gesellschaft (der `○`-Fall aus §12). */
async function entziehe(rolle: string, recht: string, mandantId: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select r.id, b.id, $3, false
       from rolle r, berechtigung b
      where r.schluessel = $1 and r.mandant_id is null and b.schluessel = $2`,
    [rolle, recht, mandantId]);
}

/** Der Lieferant aus dem Seed — ohne USt-IdNr. und IBAN (O-183): der Name ist der Weg. */
async function legeLieferantAn(
  mandantId: string, name = BEISPIEL_REINIGUNG.lieferantName, iban: string | null = null,
): Promise<string> {
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into lieferant (mandant_id, lieferantennummer, name, plz, ort, status, iban,
                            erstellt_von_art, erstellt_von_dienst)
     values ($1, $2, $3, '13353', 'Berlin', 'aktiv', $4, 'system', 'job:test')
     returning id`, [mandantId, `L-${zufall()}`, name, iban]);
  return l!.id;
}

/** Die IBAN, die die Beispieldatei nennt (`seed/eingang.ts`). */
const IBAN_DATEI = 'DE02100500000054540402';

/** Ablegen wie die Route: Datei → Dokument → Beleg → Vorschlag, im Testspeicher. */
async function abgelegt(
  teil: Partial<ERechnungBeispiel> = {}, mandantId?: string,
) {
  const beispiel: ERechnungBeispiel = {
    ...BEISPIEL_REINIGUNG, rechnungsnummer: `HN-${zufall()}`, ...teil,
  };
  const xml = beispielERechnungUbl(beispiel);
  const bytes = new TextEncoder().encode(xml);
  const extrakt = extrahiereERechnung(xml);
  const ergebnis = await alsApp(sitzung(mandantId), (tx) =>
    legeERechnungAb(kontextAus(tx, mandantId), new LokalerSpeicher(), {
      dateiname: `${beispiel.rechnungsnummer}.xml`, bytes, behaupteterTyp: 'application/xml',
      xml, quelleAnzeige: `${beispiel.rechnungsnummer}.xml`, extrakt, entstehungsJahr: 2026,
    }));
  return { ...ergebnis, beispiel, xml, bytes };
}

const oeffne = (id: string) => alsApp(sitzung(), (tx) => oeffneFreigabe(kontextAus(tx), id, 'web'));
const entscheide = (id: string, art: 'genehmigt' | 'abgelehnt', begruendung: string | null = null) =>
  alsApp(sitzung(), (tx) => entscheideFreigabe(kontextAus(tx), {
    freigabeId: id, art, begruendung, ip: '203.0.113.7', userAgent: 'vitest', codeVersion: 'test',
  }));

interface FreigabeZeile {
  readonly aktion: string; readonly status: string; readonly vorgang_typ: string;
  readonly risiko: string; readonly betrag_cent: string; readonly externe_ref: string;
  readonly bezug_typ: string; readonly bezug_id: string; readonly unsichere: number;
  readonly stapel_faehig: boolean; readonly recht: string; readonly min_konfidenz: string | null;
  readonly payload_hash: string; readonly vorschau_payload: unknown; readonly ausfuehrung_status: string;
  readonly zusammenfassung: string;
}

async function freigabe(id: string): Promise<FreigabeZeile> {
  const [z] = await sql.unsafe<FreigabeZeile[]>(
    `select aktion, status::text as status, vorgang_typ::text as vorgang_typ, risiko::text as risiko,
            betrag_cent::text as betrag_cent, externe_ref, bezug_typ, bezug_id,
            unsichere_felder_anzahl as unsichere, stapel_faehig, erforderliches_recht as recht,
            min_konfidenz::text as min_konfidenz, payload_hash, vorschau_payload,
            ausfuehrung_status::text as ausfuehrung_status, zusammenfassung
       from freigabe where id = $1`, [id]);
  return z!;
}

interface FeldZeile {
  readonly feld_pfad: string; readonly bezeichnung: string; readonly wert_nachher: string | null;
  readonly unsicher: boolean; readonly grund: string | null; readonly quelle_dokument_id: string | null;
  readonly quelle_tabelle: string | null; readonly quelle_zelle: string | null;
  readonly quelle_zitat: string | null; readonly extraktion_modell: string | null;
}

async function felder(freigabeId: string): Promise<Map<string, FeldZeile>> {
  const zeilen = await sql.unsafe<FeldZeile[]>(
    `select feld_pfad, bezeichnung, wert_nachher, unsicher, grund, quelle_dokument_id,
            quelle_tabelle, quelle_zelle, quelle_zitat, extraktion_modell
       from freigabe_feld where freigabe_id = $1`, [freigabeId]);
  return new Map(zeilen.map((z) => [z.feld_pfad, z]));
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`eingang-${zufall()}@cse.test`);
  lieferantId = await legeLieferantAn(f.reinigung);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) der Vorschlag — vollstaendig, mit Quelle je Feld', () => {
  it('Kopf, Betrag, Risiko, Bezug und Hash stehen so, wie die Entscheidung sie braucht', async () => {
    const a = await abgelegt();
    expect(a.vorschlag.neu).toBe(true);
    expect(a.vorschlag.unsichereFelder).toBe(0);
    expect(a.vorschlag.risiko).toBe('hoch');

    const z = await freigabe(a.vorschlag.freigabeId);
    expect(z.aktion).toBe(AKTION_UEBERNEHMEN);
    expect(z.status).toBe('offen');
    expect(z.vorgang_typ).toBe('buchung_uebernehmen');
    expect(z.risiko).toBe('hoch');
    expect(z.betrag_cent).toBe('148750');
    expect(z.externe_ref).toBe(`erechnung:${a.sha256}`);
    expect(z.bezug_typ).toBe('beleg');
    expect(z.bezug_id).toBe(a.belegId);
    expect(z.unsichere).toBe(0);
    expect(z.stapel_faehig).toBe(false);
    expect(z.recht).toBe('eingang.freigeben');
    expect(z.min_konfidenz).not.toBeNull();
    expect(z.ausfuehrung_status).toBe('offen');
    expect(z.zusammenfassung).toMatch(/^E-Rechnung \(UBL\) von Hygiene Nord Handels GmbH: Netto 1\.250,00\s€ \+ USt 237,50\s€ = 1\.487,50\s€, fällig 27\.09\.2026$/u);

    // Der Hash ist der ueber die gespeicherten Bytes — den rechnet der Definer nach (D-467).
    expect(z.payload_hash).toBe(sha256(kanonisiere(alsKanonischerWert(z.vorschau_payload))));
    const p = z.vorschau_payload as Record<string, unknown>;
    expect(p['aktion']).toBe(AKTION_UEBERNEHMEN);
    expect(p['lieferantId']).toBe(lieferantId);
    expect(p['belegId']).toBe(a.belegId);
    expect(p['nettoCent']).toBe(125_000);
    expect(p['steuerCent']).toBe(23_750);
    expect(p['bruttoCent']).toBe(148_750);
    expect(p['steuerzeilen']).toEqual([
      { steuergruppe: 'ust_19', kategorie: 'S', satzBp: 1900, nettoCent: 125_000, steuerCent: 23_750 },
    ]);
  });

  it('jedes Feld nennt das Element der Datei und das Zitat; der Lieferant seinen Weg', async () => {
    const a = await abgelegt();
    const fe = await felder(a.vorschlag.freigabeId);

    const netto = fe.get('/nettoCent');
    expect(netto?.wert_nachher).toMatch(/^1\.250,00\s€$/u);
    expect(netto?.quelle_dokument_id).toBe(a.dokumentId);
    expect(netto?.quelle_tabelle).toBe('xml');
    expect(netto?.quelle_zelle).toBe('Invoice/LegalMonetaryTotal/TaxExclusiveAmount');
    expect(netto?.quelle_zitat).toBe('1250.00');
    expect(netto?.unsicher).toBe(false);
    expect(netto?.extraktion_modell).toBe('deterministisch:erechnung');

    expect(fe.get('/rechnungsnummer')?.quelle_zelle).toBe('Invoice/ID');
    expect(fe.get('/rechnungsnummer')?.wert_nachher).toBe(a.beispiel.rechnungsnummer);
    expect(fe.get('/rechnungsdatum')?.wert_nachher).toBe('28.08.2026');
    expect(fe.get('/steuerzeilen/0')?.quelle_zelle).toBe('Invoice/TaxTotal/TaxSubtotal[1]');
    expect(fe.get('/steuerzeilen/0')?.unsicher).toBe(false);

    const lieferant = fe.get('/lieferantId');
    expect(lieferant?.wert_nachher).toBe('Hygiene Nord Handels GmbH (über Name)');
    expect(lieferant?.quelle_tabelle).toBe('stamm');
    expect(lieferant?.unsicher).toBe(false);

    // Der Beleg haengt an der Version, die Version an den Bytes.
    const [b] = await sql.unsafe<{ sha: string; typ: string; quelle: string; brutto: string }[]>(
      `select b.datei_sha256 as sha, b.typ::text as typ, b.quelle::text as quelle,
              b.betrag_brutto_cent::text as brutto
         from beleg b where b.id = $1`, [a.belegId]);
    expect(b).toEqual({ sha: a.sha256, typ: 'eingangsrechnung', quelle: 'upload', brutto: '148750' });
  });
});

describe('(2) dieselben Bytes zweimal', () => {
  it('sind derselbe Vorschlag — und kein zweiter Beleg, kein zweites Dokument', async () => {
    const a = await abgelegt({ rechnungsnummer: 'HN-ZWEIMAL' });
    const b = await abgelegt({ rechnungsnummer: 'HN-ZWEIMAL' });
    expect(b.vorschlag.neu).toBe(false);
    expect(b.vorschlag.freigabeId).toBe(a.vorschlag.freigabeId);
    expect(b.belegId).toBe(a.belegId);
    expect(b.dokumentId).toBe(a.dokumentId);

    const [n] = await sql.unsafe<{ freigaben: string; belege: string; dokumente: string }[]>(
      `select (select count(*) from freigabe where externe_ref = $1)::text as freigaben,
              (select count(*) from beleg where datei_sha256 = $2)::text as belege,
              (select count(*) from dokument_version where sha256 = $2)::text as dokumente`,
      [`erechnung:${a.sha256}`, a.sha256]);
    expect(n).toEqual({ freigaben: '1', belege: '1', dokumente: '1' });
  });

  it('eine andere Nummer ist eine andere Datei — und ein eigener Vorschlag', async () => {
    const a = await abgelegt({ rechnungsnummer: 'HN-EINS' });
    const b = await abgelegt({ rechnungsnummer: 'HN-ZWEI' });
    expect(b.vorschlag.neu).toBe(true);
    expect(b.vorschlag.freigabeId).not.toBe(a.vorschlag.freigabeId);
  });
});

describe('(3) ein Lieferant, der nicht im Stamm ist', () => {
  it('macht Name und Zuordnung unsicher — und der Dienst weist die Genehmigung ab', async () => {
    const a = await abgelegt({ lieferantName: 'Fremde Lieferantin GmbH' });
    expect(a.vorschlag.unsichereFelder).toBeGreaterThanOrEqual(2);
    const fe = await felder(a.vorschlag.freigabeId);
    expect(fe.get('/lieferant/name')?.unsicher).toBe(true);
    expect(fe.get('/lieferant/name')?.grund).toMatch(/nicht im Stamm/u);
    expect(fe.get('/lieferantId')?.unsicher).toBe(true);
    expect(fe.get('/lieferantId')?.wert_nachher).toBeNull();
    // Die Zahlen bleiben sicher: die Datei stimmt, nur der Stamm kennt sie nicht.
    expect(fe.get('/nettoCent')?.unsicher).toBe(false);

    await oeffne(a.vorschlag.freigabeId);
    await expect(entscheide(a.vorschlag.freigabeId, 'genehmigt'))
      .rejects.toSatisfy((e: unknown) => e instanceof FreigabeAbgewiesen && e.grund === 'unsichere_felder');
    expect((await freigabe(a.vorschlag.freigabeId)).status).toBe('offen');

    // Ablehnen geht — mit Grund.
    await entscheide(a.vorschlag.freigabeId, 'abgelehnt', 'Lieferant erst im Stamm anlegen.');
    expect((await freigabe(a.vorschlag.freigabeId)).status).toBe('abgelehnt');
  });

  it('zwei Lieferanten desselben Namens sind keiner', async () => {
    await legeLieferantAn(f.reinigung);   // der zweite „Hygiene Nord Handels GmbH"
    const a = await abgelegt();
    const fe = await felder(a.vorschlag.freigabeId);
    expect(fe.get('/lieferantId')?.unsicher).toBe(true);
    expect(fe.get('/lieferantId')?.grund).toMatch(/Mehrere Lieferanten/u);
  });
});

describe('(3b) die Bankverbindung — geprueft, nie gelesen', () => {
  it('stimmt die IBAN der Datei mit dem Stamm, ist das Feld sicher — und die Pruefung steht im audit_log', async () => {
    const id = await legeLieferantAn(f.reinigung, 'Konto Stimmt GmbH', IBAN_DATEI);
    const a = await abgelegt({ lieferantName: 'Konto Stimmt GmbH' });
    const fe = await felder(a.vorschlag.freigabeId);
    expect(fe.get('/lieferantId')?.wert_nachher).toBe('Konto Stimmt GmbH (über Name)');
    expect(fe.get('/lieferant/iban')?.unsicher).toBe(false);
    expect(a.vorschlag.unsichereFelder).toBe(0);

    const [spur] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'lieferant.iban_geprueft' and objekt_id = $1`, [id]);
    expect(spur?.n).toBe('1');
  });

  it('weicht sie ab, ist das Feld unsicher — die echte Rechnung mit der falschen IBAN', async () => {
    await legeLieferantAn(f.reinigung, 'Konto Fremd GmbH', 'DE89370400440532013000');
    const a = await abgelegt({ lieferantName: 'Konto Fremd GmbH' });
    const fe = await felder(a.vorschlag.freigabeId);
    expect(fe.get('/lieferant/iban')?.unsicher).toBe(true);
    expect(fe.get('/lieferant/iban')?.grund).toMatch(/weicht von der Bankverbindung im Stamm ab/u);
    expect(a.vorschlag.unsichereFelder).toBeGreaterThanOrEqual(1);

    await oeffne(a.vorschlag.freigabeId);
    await expect(entscheide(a.vorschlag.freigabeId, 'genehmigt'))
      .rejects.toSatisfy((e: unknown) => e instanceof FreigabeAbgewiesen && e.grund === 'unsichere_felder');
  });

  it('ohne Bankverbindung im Stamm ist nichts zu vergleichen — sicher, mit Hinweis, ohne Spur', async () => {
    // Der Seed-Lieferant traegt keine IBAN (O-183).
    const a = await abgelegt();
    const fe = await felder(a.vorschlag.freigabeId);
    expect(fe.get('/lieferant/iban')?.unsicher).toBe(false);
    const [spur] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'lieferant.iban_geprueft' and objekt_id = $1`, [lieferantId]);
    expect(spur?.n).toBe('0');
  });

  it('die Sitzung liest die IBAN weiterhin nicht — nur das Tor antwortet', async () => {
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(`select iban from lieferant limit 1`)))
      .rejects.toThrow(/permission denied/u);
    const stimmt = await alsApp(sitzung(), async (tx) => {
      const [z] = await tx.unsafe<{ stimmt: boolean | null }[]>(
        `select app.lieferant_iban_stimmt($1::uuid, $2) as stimmt`, [lieferantId, IBAN_DATEI] as never[]);
      return z?.stimmt;
    });
    expect(stimmt).toBeNull();
  });
});

describe('(4) genehmigt heisst uebernommen', () => {
  it('die Eingangsrechnung entsteht mit Kopf, Steuerzeile und Bezug — genau einmal', async () => {
    const a = await abgelegt();
    await oeffne(a.vorschlag.freigabeId);
    await entscheide(a.vorschlag.freigabeId, 'genehmigt', 'Lieferschein liegt vor.');

    const u = await alsApp(sitzung(), (tx) => fuehreAus(kontextAus(tx), a.vorschlag.freigabeId, AKTION_UEBERNEHMEN));
    expect(u.art).toBe('eingangsrechnung');
    expect(u.bezugId).not.toBeNull();

    const [er] = await sql.unsafe<Record<string, string | null>[]>(
      `select er.lieferant_id, er.rechnungsnummer_lieferant as nummer, er.rechnungsdatum::text as datum,
              er.leistung_von::text as von, er.leistung_bis::text as bis, er.faellig_am::text as faellig,
              er.netto_cent::text as netto, er.steuer_cent::text as steuer, er.brutto_cent::text as brutto,
              er.beleg_id, er.status::text as status, er.interne_belegnummer as nr
         from eingangsrechnung er where er.id = $1`, [u.bezugId]);
    expect(er).toEqual({
      lieferant_id: lieferantId, nummer: a.beispiel.rechnungsnummer, datum: '2026-08-28',
      von: '2026-08-01', bis: '2026-08-31', faellig: '2026-09-27',
      netto: '125000', steuer: '23750', brutto: '148750',
      beleg_id: a.belegId, status: 'eingegangen', nr: null,
    });
    const steuer = await sql.unsafe<{ gruppe: string; netto: string; steuer: string }[]>(
      `select g.schluessel as gruppe, st.netto_cent::text as netto, st.steuer_cent::text as steuer
         from eingangsrechnung_steuer st
         join steuersatz_gruppe g on g.id = st.steuersatz_gruppe_id
        where st.eingangsrechnung_id = $1`, [u.bezugId]);
    expect(steuer).toEqual([{ gruppe: 'ust_19', netto: '125000', steuer: '23750' }]);

    const z = await freigabe(a.vorschlag.freigabeId);
    expect(z.status).toBe('genehmigt');
    expect(z.ausfuehrung_status).toBe('ausgefuehrt');
    expect(z.bezug_typ).toBe('eingangsrechnung');
    expect(z.bezug_id).toBe(u.bezugId);

    // Noch einmal: dieselbe Kennung, keine zweite Rechnung.
    const zweite = await alsApp(sitzung(), (tx) => uebernehmeEingangsVorschlag(kontextAus(tx), a.vorschlag.freigabeId));
    expect(zweite).toEqual({ eingangsrechnungId: u.bezugId, neu: false });
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from eingangsrechnung where beleg_id = $1`, [a.belegId]);
    expect(n?.n).toBe('1');
  });

  it('die uebernommene Rechnung traegt ihre Herkunft: die Felder der Freigabe zeigen auf sie', async () => {
    const a = await abgelegt();
    await oeffne(a.vorschlag.freigabeId);
    await entscheide(a.vorschlag.freigabeId, 'genehmigt');
    const u = await alsApp(sitzung(), (tx) => fuehreAus(kontextAus(tx), a.vorschlag.freigabeId, AKTION_UEBERNEHMEN));

    const zeilen = await sql.unsafe<{ pfad: string; zelle: string | null }[]>(
      `select ff.feld_pfad as pfad, ff.quelle_zelle as zelle
         from freigabe f join freigabe_feld ff on ff.freigabe_id = f.id
        where f.bezug_typ = 'eingangsrechnung' and f.bezug_id = $1
        order by ff.feld_pfad`, [u.bezugId]);
    expect(zeilen.map((z) => z.pfad)).toContain('/nettoCent');
    expect(zeilen.find((z) => z.pfad === '/rechnungsnummer')?.zelle).toBe('Invoice/ID');
  });
});

describe('(5) nicht genehmigt heisst nicht uebernommen', () => {
  it('ein offener Vorschlag wird abgewiesen, und es entsteht keine Rechnung', async () => {
    const a = await abgelegt();
    await expect(alsApp(sitzung(), (tx) => fuehreAus(kontextAus(tx), a.vorschlag.freigabeId, AKTION_UEBERNEHMEN)))
      .rejects.toSatisfy((e: unknown) => e instanceof AusfuehrungAbgewiesen && e.grund === 'nicht_genehmigt');
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from eingangsrechnung where beleg_id = $1`, [a.belegId]);
    expect(n?.n).toBe('0');
  });

  it('ein abgelehnter Vorschlag ebenso', async () => {
    const a = await abgelegt();
    await oeffne(a.vorschlag.freigabeId);
    await entscheide(a.vorschlag.freigabeId, 'abgelehnt', 'Doppelt geliefert.');
    await expect(alsApp(sitzung(), (tx) => fuehreAus(kontextAus(tx), a.vorschlag.freigabeId, AKTION_UEBERNEHMEN)))
      .rejects.toSatisfy((e: unknown) => e instanceof AusfuehrungAbgewiesen && e.grund === 'nicht_genehmigt');
  });

  it('wer entscheiden darf, aber nicht erfassen, bekommt einen Satz — und die Entscheidung rollt zurueck', async () => {
    const a = await abgelegt();
    const admin = await legeAdministrationAn();
    await entziehe('admin', 'eingang.schreiben', f.reinigung);
    const alsAdmin = { ...sitzung(), benutzerId: admin };

    await alsApp(alsAdmin, (tx) => oeffneFreigabe(kontextAus(tx, undefined, admin), a.vorschlag.freigabeId, 'web'));
    // Wie die Route: Entscheidung und Handlung in EINER Transaktion.
    await expect(alsApp(alsAdmin, async (tx) => {
      const k = kontextAus(tx, undefined, admin);
      await entscheideFreigabe(k, {
        freigabeId: a.vorschlag.freigabeId, art: 'genehmigt', begruendung: null,
        ip: '203.0.113.7', userAgent: 'vitest', codeVersion: 'test',
      });
      return fuehreAus(k, a.vorschlag.freigabeId, AKTION_UEBERNEHMEN);
    })).rejects.toSatisfy((e: unknown) => e instanceof AusfuehrungAbgewiesen && e.grund === 'kein_recht'
      && /eingang\.schreiben/u.test(e.message));

    expect((await freigabe(a.vorschlag.freigabeId)).status).toBe('offen');
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from eingangsrechnung where beleg_id = $1`, [a.belegId]);
    expect(n?.n).toBe('0');
  });

  it('eine Aktion ohne Ausfuehrer tut nichts — und ist kein Fehler', async () => {
    const a = await abgelegt();
    const u = await alsApp(sitzung(), (tx) => fuehreAus(kontextAus(tx), a.vorschlag.freigabeId, 'rechnung_senden'));
    expect(u).toEqual({ art: 'keine', bezugId: null });
  });
});

describe('(6) Mandantengrenze', () => {
  it('von der Security aus ist der Vorschlag der Reinigung nicht da', async () => {
    const a = await abgelegt();
    await expect(alsApp(sitzung(f.security), (tx) =>
      uebernehmeEingangsVorschlag(kontextAus(tx, f.security), a.vorschlag.freigabeId)))
      .rejects.toSatisfy((e: unknown) => e instanceof VorschlagFehler && e.grund === 'nicht_gefunden');
  });
});
