/**
 * Der Archivlauf ALS JOB — unter `set local role cse_job`, wie ihn der
 * Nachtlauf bindet (Copilot-Befund PR 12, 0139).
 *
 * `belegverknuepfung.test.ts` prueft `archiviereRechnungsbeleg` als `cse_app`
 * und bewies damit den Dienst, nicht den Lauf: der Job schreibt `dokument`,
 * `dokument_version` und `beleg` unter einer Rolle, die bis 0139 auf keiner
 * der drei Tabellen ein Recht hatte. Mit verbundenem Speicher waere jede
 * Rechnung in `fehler` gezaehlt worden, und der Lauf haette „ok" gemeldet.
 *
 * Hier laeuft `laufe()` aus `jobs/belegarchiv.ts` gegen einen lokalen
 * Speicher — die Funktion, die der Zeitplan ruft, mit der Rolle, die er
 * setzt.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { laufe } from '../../src/server/jobs/belegarchiv.js';
import { alsJobSitzung } from '../../src/server/jobs/sitzung.js';
import type { ArchivKontext } from '../../src/server/services/buchhaltung/belegarchiv.js';

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
            strasse = 'Kurfürstendamm 201', plz = '10719', ort = 'Berlin',
            telefon = '+49 30 91203341', email = 'rechnung@cse.test',
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

async function richteKontenEin(mandantId: string, kunde: string): Promise<void> {
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
  await zuordnung('debitor_kunde', '10001', { kunde });
}

async function festgeschrieben(): Promise<string> {
  const id = await alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const neu = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: neu, bezeichnung: 'Unterhaltsreinigung',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(100_000n), steuergruppe: 'ust_19',
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
  benutzer = await legeBenutzerAn(`archiv-job-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  /* Ein oeffentlicher Auftraggeber mit Leitweg-ID: die XRechnung im PDF braucht BT-10 und BT-49. */
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

describe('der Archivlauf als cse_job', () => {
  it('legt Dokument, Version und Beleg an — und die Rechnung traegt ihren Beleg', async () => {
    const id = await festgeschrieben();

    const befund = await laufe(sql, f.reinigung, new LokalerSpeicher());
    expect(befund.offen).toBe(1);
    expect(befund.fehler, `kein Fehler unter cse_job — gemeldet: ${befund.letzterFehler ?? '—'}`).toBe(0);
    expect(befund.abgelegt).toBe(1);

    const [r] = await sql.unsafe<{ beleg_id: string | null }[]>(
      'select beleg_id from rechnung where id = $1', [id]);
    expect(r?.beleg_id).not.toBeNull();

    const [d] = await sql.unsafe<{ n: string; v: string; b: string }[]>(
      `select (select count(*) from dokument where mandant_id = $1 and kategorie = 'buchhaltung')::text as n,
              (select count(*) from dokument_version where mandant_id = $1)::text as v,
              (select count(*) from beleg where mandant_id = $1 and quelle = 'erzeugt')::text as b`,
      [f.reinigung]);
    expect(d).toEqual({ n: '1', v: '1', b: '1' });
  });

  it('ein zweiter Lauf findet nichts mehr — und legt nichts doppelt an', async () => {
    await festgeschrieben();
    const speicher = new LokalerSpeicher();
    await laufe(sql, f.reinigung, speicher);
    const zweit = await laufe(sql, f.reinigung, speicher);
    expect(zweit.offen).toBe(0);
    expect(zweit.abgelegt).toBe(0);
  });

  /**
   * **Der Befund, aus dem 0325 kam.** Seit 0297 haengt an `dokument` der
   * Ausloeser `dokument_05_kundenfreigabe`, und der fragte in EINEM Ausdruck
   * `new.sichtbar_fuer_kunde and not app.hat_recht(...)`. `cse_job` haelt auf
   * `app.hat_recht(text, uuid)` kein `execute` (0093), und PostgreSQL prueft
   * das Recht beim Vorbereiten des Ausdrucks — die Abkuerzung ueber `and`
   * gibt es also nicht. JEDES Ablegen endete mit
   * `permission denied for function hat_recht`, der Lauf zaehlte es als
   * Fehler und meldete sich weiter als gelaufen.
   *
   * Dieser Fall haelt die Loesung fest, und zwar in BEIDE Richtungen: der
   * Lauf legt ab, und freigeben kann er trotzdem nicht.
   */
  it('legt ab, gibt aber NICHT frei — ein Lauf ist kein Mensch (Invariante 7)', async () => {
    await festgeschrieben();
    const befund = await laufe(sql, f.reinigung, new LokalerSpeicher());
    expect(befund.abgelegt).toBe(1);

    const [d] = await sql.unsafe<{ sichtbar: boolean }[]>(
      `select sichtbar_fuer_kunde as sichtbar from dokument
        where mandant_id = $1 and kategorie = 'buchhaltung'`, [f.reinigung]);
    expect(d?.sichtbar).toBe(false);

    /*
     * Und der Weg dorthin steht dem Lauf auch ausdruecklich nicht offen — mit
     * einem Satz, den man lesen kann, statt mit `permission denied`.
     */
    await expect(alsJobSitzung(sql, f.reinigung, async (db) => db.abfrage(
      `insert into dokument (mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                             groesse_bytes, objekt_schluessel, exif_entfernt,
                             sichtbar_fuer_kunde)
       values ($1::uuid, 'buchhaltung', 'Vom Lauf freigegeben', 'application/pdf', true,
               10, $2, true, true)`,
      [f.reinigung, `lauf/${zufall()}.pdf`]), { nurLesen: false }))
      .rejects.toThrow(/keine Benutzersitzung/u);
  });

  it('ohne verbundenen Speicher wird NICHTS geschrieben, und der Lauf sagt es', async () => {
    await festgeschrieben();
    const getrennt = { ...new LokalerSpeicher(), verbunden: false } as unknown as LokalerSpeicher;
    await expect(laufe(sql, f.reinigung, getrennt)).rejects.toThrow(/Supabase Storage/u);
    const [d] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from dokument where mandant_id = $1`, [f.reinigung]);
    expect(d?.n).toBe('0');
  });
});
