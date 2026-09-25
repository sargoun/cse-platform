/**
 * PR 60 — der DATEV-EXTF-Export gegen eine echte Datenbank (ACC-02).
 *
 * Der Schreiber selbst steht in `tests/kern/datev-extf.test.ts` und wird dort
 * byteweise geprüft. Hier stehen die vier Sätze, die nur gegen eine Datenbank
 * zu beweisen sind:
 *
 *  1. Mit LEEREN O-05-Stammdaten entsteht **keine Datei** — die API
 *     verweigert und nennt jedes fehlende Feld auf Deutsch.
 *  2. Eine unvollständige Buchungszeile im Zeitraum sperrt den Export
 *     (PR 59), auch wenn die Stammdaten stimmen.
 *  3. Der Rückweg: die Datei wird wieder eingelesen und jede Buchung auf den
 *     Cent abgestimmt; derselbe Zeitraum zweimal ergibt identische Bytes.
 *  4. Der Vorgang friert die Stammdaten ein und stempelt seine Zeilen; ein
 *     zweiter Lauf stempelt keine davon erneut.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { archiviereRechnungsbeleg, type ArchivKontext }
  from '../../src/server/services/buchhaltung/belegarchiv.js';
import {
  ExportFehler, erzeugeDatevExport, exportDateiname, wirtschaftsjahrBeginn,
} from '../../src/server/services/buchhaltung/datev/export.js';
import { SPALTEN } from '../../src/server/services/buchhaltung/datev/extf.js';

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

/**
 * Der Zeitraum, in dem die Zeilen dieser Rechnung wirklich liegen.
 *
 * `belegdatum` ist das Rechnungsdatum, und das setzt `finalisiere` aus der
 * Serveruhr (Invariante 5) — nicht aus dem Leistungszeitraum. Ein fest
 * hingeschriebener August haette hier je nach Testtag gepasst oder nicht,
 * und die Exportsperre saehe null Zeilen und liesse durch: ein gruener Test,
 * der nichts prueft.
 */
async function zeitraum(rechnungId: string): Promise<{ von: string; bis: string }> {
  const [z] = await sql.unsafe<{ von: string; bis: string }[]>(
    `select min(belegdatum)::text as von, max(belegdatum)::text as bis
       from buchungssatz where rechnung_id = $1`, [rechnungId]);
  return { von: z!.von, bis: z!.bis };
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

/** Die O-05-Stammdaten vollständig UND bestätigt — im Betrieb macht das ein Mensch. */
async function stammdatenBestaetigen(mandantId: string): Promise<void> {
  await sql.unsafe(
    `update datev_konfiguration
        set berater_nummer = '1234567', mandanten_nummer = '55555',
            kontenrahmen = 'skr03'::kontenrahmen, sachkontenlaenge = 4,
            wj_beginn_monat = 1, wj_beginn_tag = 1,
            versteuerungsart = 'soll'::versteuerungsart, extf_version = '700'
      where mandant_id = $1`, [mandantId]);
  // Der Auslöser aus 0126 lässt das erst zu, wenn nichts mehr fehlt.
  await sql.unsafe(
    `update datev_konfiguration set ist_platzhalter = false where mandant_id = $1`,
    [mandantId]);
}

/** Eine festgeschriebene, gebuchte UND archivierte Rechnung — exportfähig. */
async function exportfaehig(preisCent = 100_000n): Promise<string> {
  const id = await festgeschrieben(preisCent);
  await alsApp(sitzung(), async (tx) =>
    archiviereRechnungsbeleg(alsDienst(tx), new LokalerSpeicher(), id));
  return id;
}

const STUNDE = new Date(Date.UTC(2026, 8, 13, 9, 0, 0, 0));

// ---------------------------------------------------------------------------
// (1) Leere Stammdaten: keine Datei, und der Satz nennt die Felder
// ---------------------------------------------------------------------------

describe('(1) ohne O-05-Stammdaten entsteht nichts', () => {
  it('der Aufruf nennt JEDES fehlende Feld auf Deutsch', async () => {
    await exportfaehig();
    const { von, bis } = await zeitraum(await festgeschrieben(1n));

    /*
     * Gefangen wird AUSSERHALB von `alsApp`. Ein Fehler aus der Datenbank
     * bricht die Transaktion ab; ihn innen wegzufangen und weiterzulaufen
     * ergibt beim Commit einen zweiten, anderen Fehler — und der Test prüfte
     * dann den falschen Satz.
     */
    const fehler: unknown = await alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'))
      .then(() => null, (f: unknown) => f);

    expect(fehler).toBeInstanceOf(Error);
    const text = (fehler as Error).message;
    for (const feld of ['Beraternummer', 'Mandantennummer', 'EXTF-Fassung',
      'Versteuerungsart']) {
      expect(text, feld).toContain(feld);
    }
  });

  it('und mit vollständigen, aber UNBESTÄTIGTEN Stammdaten ebenso', async () => {
    const id = await exportfaehig();
    const { von, bis } = await zeitraum(id);
    // Alles gefüllt — aber `ist_platzhalter` bleibt stehen.
    await sql.unsafe(
      `update datev_konfiguration
          set berater_nummer = '1234567', mandanten_nummer = '55555',
              kontenrahmen = 'skr03'::kontenrahmen, sachkontenlaenge = 4,
              wj_beginn_monat = 1, wj_beginn_tag = 1,
              versteuerungsart = 'soll'::versteuerungsart, extf_version = '700'
        where mandant_id = $1`, [f.reinigung]);

    await expect(alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test')))
      .rejects.toThrow(/PLATZHALTER/u);
  });

  it('nichts wird gestempelt, wenn nichts entsteht', async () => {
    const id = await exportfaehig();
    const { von, bis } = await zeitraum(id);
    await alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'))
      .catch(() => null);

    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from buchungssatz
        where rechnung_id = $1 and datev_export_id is not null`, [id]);
    expect(z?.n).toBe('0');
    const [e] = await sql.unsafe<{ n: string }[]>(
      'select count(*)::text as n from datev_export');
    expect(e?.n).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// (2) Die Belegsperre aus PR 59 gilt auch mit guten Stammdaten
// ---------------------------------------------------------------------------

describe('(2) eine unvollständige Zeile sperrt den Export', () => {
  it('eine gebuchte, aber NICHT archivierte Rechnung verhindert die Datei', async () => {
    await stammdatenBestaetigen(f.reinigung);
    const id = await festgeschrieben();          // gebucht, aber kein Beleg abgelegt
    const { von, bis } = await zeitraum(id);

    await expect(alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test')))
      .rejects.toThrow(/ohne Beleg oder ohne Konto/u);
  });

  it('und ein leerer Zeitraum ergibt keine leere Datei, sondern einen Satz', async () => {
    await stammdatenBestaetigen(f.reinigung);
    await expect(alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(),
        '2019-01-01', '2019-01-31', STUNDE, 'Test')))
      .rejects.toThrow(ExportFehler);
  });
});

// ---------------------------------------------------------------------------
// (2a) Ein Stapel, ein Wirtschaftsjahr (V-212)
// ---------------------------------------------------------------------------

describe('(2a) ein Stapel umfasst höchstens ein Wirtschaftsjahr', () => {
  it('ein Zeitraum über den 1. Januar wird bei Kalender-WJ abgewiesen — und nichts gestempelt',
    async () => {
      await stammdatenBestaetigen(f.reinigung);
      const id = await exportfaehig();
      const { bis } = await zeitraum(id);
      const jahr = Number(bis.slice(0, 4));
      const von = `${String(jahr - 1)}-12-01`;

      const fehler: unknown = await alsApp(sitzung(), async (tx) =>
        erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'))
        .then(() => null, (e: unknown) => e);

      expect(fehler).toBeInstanceOf(ExportFehler);
      expect((fehler as ExportFehler).grund).toBe('wirtschaftsjahr');
      expect((fehler as ExportFehler).message).toContain(`01.01.${String(jahr)}`);

      const [z] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from buchungssatz
          where rechnung_id = $1 and datev_export_id is not null`, [id]);
      expect(z?.n).toBe('0');
      const [e] = await sql.unsafe<{ n: string }[]>(
        'select count(*)::text as n from datev_export');
      expect(e?.n).toBe('0');
    });

  it('bei abweichendem WJ zählt dessen Beginn, nicht der 1. Januar', async () => {
    await stammdatenBestaetigen(f.reinigung);
    const id = await exportfaehig();
    const { bis } = await zeitraum(id);
    /*
     * Das WJ beginnt am Tag der Buchung: der Vortag liegt im alten, der Tag
     * selbst im neuen Wirtschaftsjahr. Ein Kalender-WJ liesse diesen Zeitraum
     * durch — die Prüfung liest also wirklich die Stammdaten.
     */
    const monat = Number(bis.slice(5, 7));
    const tag = Number(bis.slice(8, 10));
    await sql.unsafe(
      `update datev_konfiguration set wj_beginn_monat = $2, wj_beginn_tag = $3
        where mandant_id = $1`, [f.reinigung, monat, tag]);
    const vortag = await sql.unsafe<{ d: string }[]>(
      `select ($1::date - 1)::text as d`, [bis]);

    await expect(alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), vortag[0]!.d, bis, STUNDE,
        'Test'))).rejects.toThrow(/Wirtschaftsjahres/u);
  });

  it('die Tabelle selbst weist einen Stapel über die WJ-Grenze ab (0445)', async () => {
    const zeile = (von: string, bis: string, monat: number, tag: number) => sql.unsafe(
      `insert into datev_export
         (mandant_id, von, bis, berater_nummer, mandanten_nummer, kontenrahmen,
          sachkontenlaenge, wj_beginn_monat, wj_beginn_tag, versteuerungsart,
          extf_version, festschreibung, zeilen, summe_soll_cent, summe_haben_cent,
          datei_sha256, erstellt_von_art, erstellt_von)
       values ($1, $2::date, $3::date, '1234567', '12345', 'skr03', 4, $4, $5, 'soll',
               '700', false, 1, 100, 100, $6, 'mensch', $7)
       returning id`,
      [f.reinigung, von, bis, monat, tag, 'a'.repeat(64), benutzer]);

    await expect(zeile('2025-12-01', '2026-01-31', 1, 1))
      .rejects.toThrow(/datev_export_ein_wirtschaftsjahr/u);
    // WJ ab 1. Juli: Dezember und Januar liegen im selben WJ 2025/2026.
    await expect(zeile('2025-12-01', '2026-01-31', 7, 1)).resolves.toHaveLength(1);
    // WJ ab 1. Juli: Juni und Juli nicht.
    await expect(zeile('2026-06-15', '2026-07-15', 7, 1))
      .rejects.toThrow(/datev_export_ein_wirtschaftsjahr/u);
    // Ein WJ-Beginn, den es nicht in jedem Monat gibt, führt nicht in einen Datumsfehler.
    await expect(zeile('2026-02-01', '2026-02-28', 2, 30)).resolves.toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (3) Der Rückweg und die Wiederholbarkeit
// ---------------------------------------------------------------------------

describe('(3) die Datei lässt sich zurücklesen und stimmt auf den Cent', () => {
  it('jede Zeile der Datei findet ihre Buchung wieder, Betrag und Richtung gleich',
    async () => {
      await stammdatenBestaetigen(f.reinigung);
      const id = await exportfaehig();
      const { von, bis } = await zeitraum(id);

      const ergebnis = await alsApp(sitzung(), async (tx) =>
        erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));

      const text = Buffer.from(ergebnis.bytes).toString('latin1');
      const zeilen = text.split('\r\n').filter((z) => z !== '').slice(2);
      expect(zeilen).toHaveLength(ergebnis.zeilen);

      const iBetrag = SPALTEN.indexOf('Umsatz (ohne Soll/Haben-Kz)');
      const iSh = SPALTEN.indexOf('Soll/Haben-Kennzeichen');
      const iGuid = SPALTEN.indexOf('Buchungs GUID');

      /* Was die Datenbank sagt — die Wahrheit, gegen die abgestimmt wird. */
      const gebucht = await alsApp(sitzung(), async (tx) =>
        tx.unsafe<{ id: string; umsatz_cent: string; soll_haben: string }[]>(
          `select id, umsatz_cent::text, soll_haben::text as soll_haben
             from buchungssatz where rechnung_id = $1`, [id] as never[]));
      const nachId = new Map(gebucht.map((g) => [g.id, g]));

      let summeSoll = 0n;
      let summeHaben = 0n;
      for (const zeile of zeilen) {
        const felder = zeile.split(';');
        const guid = felder[iGuid]!.replace(/^"|"$/gu, '');
        const quelle = nachId.get(guid);
        expect(quelle, `Zeile ohne Buchung: ${guid}`).toBeDefined();

        /* Der Betrag zurück in Cent — über Zeichenketten, nie über `Number`. */
        const cent = BigInt(felder[iBetrag]!.replace(',', ''));
        expect(cent).toBe(BigInt(quelle!.umsatz_cent));

        const sh = felder[iSh]!.replace(/"/gu, '');
        expect(sh).toBe(quelle!.soll_haben === 'soll' ? 'S' : 'H');
        if (sh === 'S') summeSoll += cent; else summeHaben += cent;
      }

      expect(summeSoll).toBe(ergebnis.summeSollCent);
      expect(summeHaben).toBe(ergebnis.summeHabenCent);
      expect(summeSoll, 'die Datei geht auf').toBe(summeHaben);
    });

  it('der Prüfwert in der Zeile ist der der Bytes', async () => {
    await stammdatenBestaetigen(f.reinigung);
    const id = await exportfaehig();
    const { von, bis } = await zeitraum(id);
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));

    expect(createHash('sha256').update(ergebnis.bytes).digest('hex'))
      .toBe(ergebnis.sha256);

    const [zeile] = await sql.unsafe<{ datei_sha256: string; zeilen: number }[]>(
      'select datei_sha256, zeilen from datev_export where id = $1', [ergebnis.exportId]);
    expect(zeile?.datei_sha256).toBe(ergebnis.sha256);
    expect(zeile?.zeilen).toBe(ergebnis.zeilen);
  });

  it('derselbe Zeitraum zweimal ergibt identische Bytes', async () => {
    await stammdatenBestaetigen(f.reinigung);
    const id = await exportfaehig();
    const { von, bis } = await zeitraum(id);

    const erst = await alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));
    /*
     * Der zweite Lauf über denselben Zeitraum: dieselben Zeilen, derselbe
     * Erzeugungszeitpunkt — also byte-gleich. Dass die Zeilen beim zweiten
     * Mal schon gestempelt sind, ändert die DATEI nicht; es ändert nur, wie
     * viele Zeilen der Stempel bewegt (siehe (4)).
     */
    const zweit = await alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));

    expect(Buffer.from(erst.bytes).equals(Buffer.from(zweit.bytes))).toBe(true);
    expect(zweit.sha256).toBe(erst.sha256);
    expect(zweit.exportId).not.toBe(erst.exportId);
  });
});

// ---------------------------------------------------------------------------
// (4) Der Vorgang friert ein und stempelt
// ---------------------------------------------------------------------------

describe('(4) der Vorgang hält fest, was galt', () => {
  it('die Stammdaten stehen auf der Zeile — eine spätere Änderung bewegt sie nicht',
    async () => {
      await stammdatenBestaetigen(f.reinigung);
      const id = await exportfaehig();
      const { von, bis } = await zeitraum(id);
      const ergebnis = await alsApp(sitzung(), async (tx) =>
        erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));

      // Das Büro wechselt.
      await sql.unsafe(
        `update datev_konfiguration set berater_nummer = '7654321' where mandant_id = $1`,
        [f.reinigung]);

      const [zeile] = await sql.unsafe<{ berater_nummer: string; format_ungeprueft: boolean }[]>(
        'select berater_nummer, format_ungeprueft from datev_export where id = $1',
        [ergebnis.exportId]);
      expect(zeile?.berater_nummer, 'eingefroren, nicht verwiesen').toBe('1234567');
      // ⚑ O-05: solange keine Kundenmusterdatei vorliegt.
      expect(zeile?.format_ungeprueft).toBe(true);
    });

  it('die exportierten Zeilen tragen den Stapel — und kein zweiter nimmt sie erneut',
    async () => {
      await stammdatenBestaetigen(f.reinigung);
      const id = await exportfaehig();
      const { von, bis } = await zeitraum(id);
      const erst = await alsApp(sitzung(), async (tx) =>
        erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));

      const [gestempelt] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from buchungssatz
          where rechnung_id = $1 and datev_export_id = $2`, [id, erst.exportId]);
      expect(Number(gestempelt?.n)).toBe(erst.zeilen);

      const zweit = await alsApp(sitzung(), async (tx) =>
        erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));
      const [nochmal] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from buchungssatz where datev_export_id = $1`,
        [zweit.exportId]);
      expect(nochmal?.n, 'der zweite Stapel stempelt nichts um').toBe('0');
    });

  it('der erzeugte Stapel lässt sich nicht umschreiben — nur verwerfen', async () => {
    await stammdatenBestaetigen(f.reinigung);
    const id = await exportfaehig();
    const { von, bis } = await zeitraum(id);
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));

    await expect(sql.unsafe(
      `update datev_export set summe_soll_cent = 1, summe_haben_cent = 1 where id = $1`,
      [ergebnis.exportId])).rejects.toThrow(/unveraenderlich/u);

    // Verwerfen geht — mit Grund.
    await sql.unsafe(
      `update datev_export set status = 'verworfen', verworfen_am = now(),
                               verwerfungsgrund = 'Falscher Zeitraum gewaehlt'
        where id = $1`, [ergebnis.exportId]);

    // Und ohne Grund nicht.
    const zweiter = await alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));
    await expect(sql.unsafe(
      `update datev_export set status = 'verworfen', verworfen_am = now() where id = $1`,
      [zweiter.exportId])).rejects.toThrow();
  });

  it('und er lässt sich nicht hart löschen', async () => {
    await stammdatenBestaetigen(f.reinigung);
    const id = await exportfaehig();
    const { von, bis } = await zeitraum(id);
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      erzeugeDatevExport(alsDienst(tx), new LokalerSpeicher(), von, bis, STUNDE, 'Test'));

    await expect(sql.unsafe('delete from datev_export where id = $1', [ergebnis.exportId]))
      .rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Das Wirtschaftsjahr und der Dateiname
// ---------------------------------------------------------------------------

describe('das Wirtschaftsjahr liegt VOR dem Zeitraum', () => {
  it('Kalenderjahr: der 1. Januar desselben Jahres', () => {
    expect(wirtschaftsjahrBeginn('2026-08-01', 1, 1)).toBe('2026-01-01');
  });

  it('abweichendes Wirtschaftsjahr: der 1. Juli des VORjahres, wenn der Mai exportiert wird',
    () => {
      expect(wirtschaftsjahrBeginn('2027-05-01', 7, 1)).toBe('2026-07-01');
      expect(wirtschaftsjahrBeginn('2027-08-01', 7, 1)).toBe('2027-07-01');
    });

  it('der Dateiname trägt keinen Umlaut und kein Leerzeichen', () => {
    const name = exportDateiname('2026-08-01', '2026-08-31');
    expect(name).toBe('EXTF_Buchungsstapel_2026-08-01_2026-08-31.csv');
    expect(/^[A-Za-z0-9_.-]+$/u.test(name)).toBe(true);
  });
});
