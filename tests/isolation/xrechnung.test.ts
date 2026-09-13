/**
 * PR 52 / 52.1 — die XRechnung gegen eine echte Datenbank (FIN-11).
 *
 * Der Bauer selbst steht in `tests/kern/xrechnung.test.ts`, die
 * KoSIT-Prüfung in `tests/compliance/`. Hier stehen die drei Aussagen, die
 * nur die Datenbank halten kann:
 *
 *  1. **Die elektronische Adresse wird beim Festschreiben EINGEFROREN.** Sie
 *     kommt aus dem Stammsatz, sie steht danach auf dem Beleg, und eine
 *     spätere Pflege ändert sie dort nicht mehr (K-12).
 *  2. **Ein Wert AUF dem Beleg gewinnt.** Nennt der Kunde für einen Auftrag
 *     eine andere Eingangsadresse, verwirft das Einfrieren sie nicht.
 *  3. **Die Vorprüfung und das Einfrieren sagen dasselbe.** Was der
 *     §14-Bericht vor dem Festschreiben als vorhanden meldet, muss danach
 *     auch auf dem Beleg stehen — sonst blockiert die Vorprüfung eine
 *     Rechnung, die eine Millisekunde später vollständig wäre, oder sie lässt
 *     eine durch, aus der kein Dokument entsteht.
 *
 * **Der Befund, aus dem diese Datei entstanden ist:** die vier Spalten
 * `verkaeufer_eadresse`, `verkaeufer_eadresse_schema`, `kaeufer_eadresse` und
 * `kaeufer_eadresse_schema` gibt es seit 0075. Gelesen wurden sie von der
 * Nutzlast (BT-34, BT-49). Geschrieben wurden sie von NICHTS — kein Formular,
 * keine Route, keine Funktion, kein Seed. Jede Rechnung hatte damit zwei
 * fehlende Pflichtangaben, und die XRechnung war unerreichbar.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { pruefeRechnung } from '../../src/server/services/finanz/ustg14.js';
import { ublZurRechnung } from '../../src/server/services/finanz/xrechnung/dienst.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

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

/**
 * Eine Gesellschaft, die fakturieren KANN — samt elektronischer Adresse.
 *
 * Die Adresse steht hier und nicht im Seed dieser Datei, weil sie der
 * Gegenstand der Prüfung ist: sie muss von HIER auf den Beleg wandern.
 */
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

/** Ein Entwurf mit einer Leistungszeile, Zahlungsart SEPA-Überweisung. */
async function entwurf(): Promise<string> {
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
    // BT-81. Ohne Zahlungsart weist BR-DE-1 ab, und eine Vorgabe dafür gibt es
    // aus gutem Grund nirgends (§4.2).
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [id] as never[]);
    return id;
  });
}

async function eadressen(id: string): Promise<Record<string, string | null>> {
  const [z] = await sql.unsafe<Record<string, string | null>[]>(
    `select verkaeufer_eadresse, verkaeufer_eadresse_schema,
            kaeufer_eadresse, kaeufer_eadresse_schema
       from rechnung where id = $1`, [id]);
  return z!;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
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

// ---------------------------------------------------------------------------

describe('(1) die elektronische Adresse wird beim Festschreiben eingefroren', () => {
  it('der Entwurf trägt sie NICHT, der festgeschriebene Beleg schon', async () => {
    const id = await entwurf();

    /*
     * Die Vorprobe, und sie ist der halbe Test: stünden die Werte schon auf
     * dem Entwurf, bewiese die Zeile danach nichts — sie wären dann von
     * irgendwoher gekommen und nicht vom Einfrieren.
     */
    expect(await eadressen(id)).toEqual({
      verkaeufer_eadresse: null, verkaeufer_eadresse_schema: null,
      kaeufer_eadresse: null, kaeufer_eadresse_schema: null,
    });

    await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));

    expect(await eadressen(id)).toEqual({
      verkaeufer_eadresse: 'DE123456789', verkaeufer_eadresse_schema: '9930',
      kaeufer_eadresse: '991-12345-67', kaeufer_eadresse_schema: '0204',
    });
  });

  it('und eine spätere Pflege des Stammsatzes ändert den Beleg nicht mehr (K-12)', async () => {
    const id = await entwurf();
    await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));

    await sql.unsafe(
      `update kunde set elektronische_adresse = '992-99999-99' where id = $1`, [kundeId]);

    /*
     * Das ist die ganze Aussage von K-12. Ohne das Einfrieren läse die
     * XRechnung die NEUE Adresse, während die Kettenprüfung weiter „intakt"
     * meldet — zwei Dokumente zu einer Rechnungsnummer.
     */
    expect((await eadressen(id))['kaeufer_eadresse']).toBe('991-12345-67');
  });

  it('ein Wert AUF dem Beleg gewinnt — das Einfrieren überschreibt nichts', async () => {
    const id = await entwurf();
    // Ein Kunde kann für EINEN Auftrag ein anderes Amt als Empfänger nennen.
    await sql.unsafe(
      `update rechnung set kaeufer_eadresse = '993-11111-11', kaeufer_eadresse_schema = '0204'
        where id = $1`, [id]);

    await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));

    expect((await eadressen(id))['kaeufer_eadresse']).toBe('993-11111-11');
    // Die Verkäuferseite war leer und wird trotzdem gefüllt: die beiden
    // Hälften sind unabhängig.
    expect((await eadressen(id))['verkaeufer_eadresse']).toBe('DE123456789');
  });
});

describe('(2) Vorprüfung und Beleg sagen dasselbe', () => {
  it('die §14-Vorprüfung meldet BT-34 und BT-49 NICHT als fehlend', async () => {
    const id = await entwurf();
    const bericht = await alsApp(sitzung(), async (tx) => pruefeRechnung(alsDienst(tx), id));

    /*
     * Der Fall, den 0120 behoben hat: die Spalten sind auf dem Entwurf leer,
     * gefüllt werden sie erst beim Festschreiben. Läse die Vorprüfung stur
     * die Spalte, blockierte sie hier mit zwei Feldern, die in keiner Maske
     * stehen — ein Riegel, den niemand öffnen kann.
     */
    const felder = bericht.fehler.map((b) => b.feld);
    expect(felder).not.toContain('xrechnung.pflichtfelder');
    expect(bericht.fehler).toEqual([]);
  });

  it('ohne elektronische Adresse der Gesellschaft SPERRT sie — mit BT-34 im Text', async () => {
    await sql.unsafe(
      `update mandant set elektronische_adresse = null, elektronische_adresse_schema = null
        where id = $1`, [f.reinigung]);
    const id = await entwurf();
    const bericht = await alsApp(sitzung(), async (tx) => pruefeRechnung(alsDienst(tx), id));

    const befund = bericht.fehler.find((b) => b.feld === 'xrechnung.pflichtfelder');
    expect(befund, 'FIN-11 muss bei einem öffentlichen Auftraggeber sperren').toBeDefined();
    expect(befund!.textDe).toMatch(/BT-34/u);
  });

  it('bei einem NICHT öffentlichen Kunden sperrt dieselbe Lücke nicht', async () => {
    /*
     * Die Gegenprobe. Eine Reinigungsrechnung an eine Hausverwaltung braucht
     * kein BT-34 — greift die Regel auch dort, ist jede Rechnung der Gruppe
     * blockiert, und niemand kann mehr fakturieren.
     */
    await sql.unsafe(
      `update mandant set elektronische_adresse = null, elektronische_adresse_schema = null
        where id = $1`, [f.reinigung]);
    await sql.unsafe(
      `update kunde set typ = 'firma', ist_oeffentlicher_auftraggeber = false,
                        xrechnung_pflicht = false where id = $1`, [kundeId]);
    const id = await entwurf();
    const bericht = await alsApp(sitzung(), async (tx) => pruefeRechnung(alsDienst(tx), id));

    expect(bericht.fehler.map((b) => b.feld)).not.toContain('xrechnung.pflichtfelder');
  });
});

describe('(3) und am Ende steht ein Dokument', () => {
  it('aus dem Snapshot entsteht eine XRechnung mit der Leitweg-ID', async () => {
    const id = await entwurf();
    await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));

    const ergebnis = await alsApp(sitzung(), async (tx) => ublZurRechnung(alsDienst(tx), id));
    expect(ergebnis).not.toBeNull();
    const xml = ergebnis!.xml;

    expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0');
    expect(xml).toContain('<cbc:BuyerReference>991-12345-67</cbc:BuyerReference>');
    // BT-34 und BT-49 — die beiden, die es vor 0120 auf keiner Rechnung gab.
    expect(xml).toContain('<cbc:EndpointID schemeID="9930">DE123456789</cbc:EndpointID>');
    expect(xml).toContain('<cbc:EndpointID schemeID="0204">991-12345-67</cbc:EndpointID>');
    expect(xml).not.toContain('currencyID=""');
  });

  it('ein ENTWURF bekommt keine — die XRechnung entsteht mit der Festschreibung', async () => {
    const id = await entwurf();
    await expect(alsApp(sitzung(), async (tx) => ublZurRechnung(alsDienst(tx), id)))
      .rejects.toThrow(/Entwurf/u);
  });

  it('und die Bytes, aus denen es entsteht, lassen sich nicht ändern', async () => {
    /*
     * **Der Versuch, der diesen Fall geschrieben hat.** Er sollte prüfen,
     * dass ein manipulierter Snapshot kein halbes Dokument ergibt — und die
     * Manipulation ging gar nicht erst durch. Das ist die stärkere Aussage:
     * die XRechnung wird aus genau den Bytes gebaut, die gehasht wurden, und
     * diese Bytes sind unveränderlich (FIN-06, LEG-01). Ein Angreifer, der
     * das Dokument ändern wollte, müsste die Kette brechen — und der
     * nächtliche Lauf meldet das.
     *
     * Dass ein unvollständiger Beleg KEIN Dokument ergibt, prüft
     * `tests/kern/xrechnung.test.ts` an zehn Feldern einzeln; hier wäre es
     * nur noch einmal dasselbe.
     */
    const id = await entwurf();
    await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));

    await expect(sql.unsafe(
      `update rechnung_snapshot
          set nutzlast_bytes = convert_to('{}', 'UTF8') where rechnung_id = $1`, [id]))
      .rejects.toThrow(/nie mehr geaendert/u);
  });
});
