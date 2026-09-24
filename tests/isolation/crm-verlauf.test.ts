/**
 * Der Kommunikationsverlauf am Kunden und am Ansprechpartner — und das
 * Festhalten dort (CRM-03, V-147, D-641), gegen echte Zeilen und echte RLS.
 *
 * **Der Befund, den diese Datei festschreibt.** Das Kundenblatt zeigte gar
 * keinen Verlauf, das Kontaktblatt nur `lead_aktivitaet` — was über
 * „Nachricht senden" hinausgeht und was im Kundenportal am Kunden hängt, steht
 * aber in `nachricht`. Eine Notiz liess sich nur an einen Lead hängen.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { CrmFehler } from '../../src/server/services/crm/anlegen.js';
import {
  halteFest, leseKontaktVerlauf, leseKundenVerlauf,
} from '../../src/server/services/crm/verlauf.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(): Promise<string> {
  const email = `verlauf-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function mitgliedschaft(benutzerId: string, mandantId: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, $3, false)`, [benutzerId, mandantId, await rolleId('admin')]);
}

async function entziehe(recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId('admin'), mandant, recht]);
}

async function kunde(mandantId: string, name: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
     values ($1, $2, $3, 'bestandskunde', 'Rahmenvertrag', now()) returning id`,
    [mandantId, `K-${zufall()}`, name]);
  return z!.id;
}

async function kontakt(
  mandantId: string, kundeId: string | null, nachname: string,
  grundlage: 'bestandskunde' | 'keine' = 'bestandskunde',
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, email,
                                  rechtsgrundlage, rechtsgrundlage_quelle,
                                  rechtsgrundlage_erfasst_am)
     values ($1, $2::uuid, 'Aylin', $3, $4, $5::rechtsgrundlage,
             case when $5 = 'keine' then null else 'Rahmenvertrag' end,
             case when $5 = 'keine' then null else now() end)
     returning id`,
    [mandantId, kundeId, nachname, `v-${zufall()}@example.test`, grundlage]);
  return z!.id;
}

async function lead(mandantId: string, kundeId: string | null): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into lead (mandant_id, leadnummer, quelle, betreff, besitzer_benutzer_id,
                       kunde_id, firma_name, status)
     values ($1, $2, 'manuell', 'Treppenhaus', $3, $4::uuid, 'Anfragende GmbH', 'neu')
     returning id`,
    [mandantId, `L-${zufall()}`, chef, kundeId]);
  return z!.id;
}

/** Eine Nachricht im Portal an einen Ansprechpartner — ohne Versender, wie heute. */
async function nachricht(o: {
  mandantId: string; betreff: string; kundeId: string | null;
  kontaktId: string | null; empfaenger: string | null;
}): Promise<string> {
  const [n] = await sql.unsafe<{ id: string }[]>(
    `insert into nachricht (mandant_id, betreff, koerper, richtung, kanal, akteur_art,
                            absender_benutzer_id, kunde_id, rechtsgrundlage,
                            rechtsgrundlage_kontakt_id, zweck, erstellt_von)
     values ($1, $2, 'Der Termin steht.', 'ausgehend', 'portal', 'mensch', $3,
             $4::uuid, 'bestandskunde', $5::uuid, 'vertraglich', $3)
     returning id`,
    [o.mandantId, o.betreff, chef, o.kundeId, o.kontaktId]);
  if (o.empfaenger !== null) {
    await sql.unsafe(
      `insert into nachricht_empfaenger (mandant_id, nachricht_id, empfaenger_typ,
                                         empfaenger_id, art)
       values ($1, $2, 'ansprechpartner', $3, 'an')`, [o.mandantId, n!.id, o.empfaenger]);
  }
  return n!.id;
}

function kontextAus(tx: postgres.TransactionSql, mandantId: string) {
  const abfrage = async <T,>(s: string, w: readonly unknown[] = []) =>
    (await tx.unsafe(s, w as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', aktiverMandantId: mandantId,
    benutzerId: chef, mandantIds: [mandantId], abfrage, schreibe: abfrage,
  } as never;
}

async function alsIntern<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId: chef, portal: 'intern', readonly: false },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal','aal2',true)`);
      return fn(tx);
    },
  );
}

async function crmFehler(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: unknown) {
    if (e instanceof CrmFehler) return e.grund;
    throw e;
  }
  throw new Error('kein CrmFehler');
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await mitgliedschaft(chef, f.reinigung);
  await mitgliedschaft(chef, f.bau);
});

afterAll(async () => { await schliessen(); });

describe('§1 der Verlauf am KUNDEN — Aktivitäten und Nachrichten, eine Liste', () => {
  it('am Kunden, an seinem Lead, an seinem Kontakt, und seine Nachrichten', async () => {
    const k = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await kontakt(f.reinigung, k, 'Kellermann');
    const l = await lead(f.reinigung, k);
    /* Ein Lead OHNE Kundenbezug, aber mit dem Kontakt dieses Kunden. */
    const lOhne = await lead(f.reinigung, null);

    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck, betreff)
       values ($1, $2, 'notiz', 'intern', 'intern', 'Am Kunden')`, [f.reinigung, k]);
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, lead_id, typ, richtung, zweck, betreff)
       values ($1, $2, 'notiz', 'intern', 'intern', 'Am Lead')`, [f.reinigung, l]);
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, lead_id, ansprechpartner_id, typ,
                                    richtung, zweck, betreff)
       values ($1, $2, $3, 'termin', 'intern', 'intern', 'Am Kontakt')`,
      [f.reinigung, lOhne, ap]);
    await nachricht({ mandantId: f.reinigung, betreff: 'Portalnachricht am Kunden',
      kundeId: k, kontaktId: null, empfaenger: null });
    await nachricht({ mandantId: f.reinigung, betreff: 'An den Objektleiter',
      kundeId: null, kontaktId: ap, empfaenger: ap });

    const verlauf = await alsIntern(f.reinigung, (tx) =>
      leseKundenVerlauf(kontextAus(tx, f.reinigung), k));
    const betreffe = verlauf.map((e) => e.betreff).sort();
    expect(betreffe).toEqual([
      'Am Kontakt', 'Am Kunden', 'Am Lead', 'An den Objektleiter', 'Portalnachricht am Kunden',
    ]);
    const n = verlauf.find((e) => e.betreff === 'An den Objektleiter');
    expect(n?.quelle).toBe('nachricht');
    expect(n?.richtung).toBe('ausgehend');
    expect(n?.grundlage).toBe('bestandskunde');
    // Ohne Versender ist nichts hinausgegangen — und so steht es auch da (O-36).
    expect(n?.zustellung).toBe('ausstehend');
    expect(n?.ansprechpartnerId).toBe(ap);
    expect(verlauf.find((e) => e.betreff === 'Am Lead')?.leadId).toBe(l);
  });

  it('nichts von einem ANDEREN Kunden und nichts aus einer anderen Gesellschaft', async () => {
    const k = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    const fremd = await kunde(f.reinigung, 'Nachbarhaus');
    const apFremd = await kontakt(f.reinigung, fremd, 'Nachbar');
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck, betreff)
       values ($1, $2, 'notiz', 'intern', 'intern', 'Fremder Kunde')`, [f.reinigung, fremd]);
    await nachricht({ mandantId: f.reinigung, betreff: 'Fremde Nachricht',
      kundeId: null, kontaktId: apFremd, empfaenger: apFremd });

    const kBau = await kunde(f.bau, 'Bauherr Spandau');
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck, betreff)
       values ($1, $2, 'notiz', 'intern', 'intern', 'Andere Gesellschaft')`, [f.bau, kBau]);

    const eigen = await alsIntern(f.reinigung, (tx) =>
      leseKundenVerlauf(kontextAus(tx, f.reinigung), k));
    expect(eigen).toEqual([]);
    /* Die ID aus der anderen Gesellschaft, aus der Reinigung gelesen: leer. */
    const quer = await alsIntern(f.reinigung, (tx) =>
      leseKundenVerlauf(kontextAus(tx, f.reinigung), kBau));
    expect(quer).toEqual([]);
  });

  it('ohne nachricht.lesen bleiben die Aktivitäten — die fremden Nachrichten nicht', async () => {
    const k = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck, betreff)
       values ($1, $2, 'notiz', 'intern', 'intern', 'Am Kunden')`, [f.reinigung, k]);
    /* Von einem ANDEREN Konto geschrieben — sonst sähe der Absender sie ohnehin. */
    const kollege = await konto();
    const [n] = await sql.unsafe<{ id: string }[]>(
      `insert into nachricht (mandant_id, betreff, koerper, richtung, kanal, akteur_art,
                              absender_benutzer_id, kunde_id, erstellt_von)
       values ($1, 'Vom Kollegen', 'x', 'intern', 'portal', 'mensch', $2, $3, $2)
       returning id`, [f.reinigung, kollege, k]);
    expect(n?.id).toBeDefined();
    await entziehe('nachricht.lesen', f.reinigung);

    const verlauf = await alsIntern(f.reinigung, (tx) =>
      leseKundenVerlauf(kontextAus(tx, f.reinigung), k));
    expect(verlauf.map((e) => e.betreff)).toEqual(['Am Kunden']);
  });
});

describe('§2 der Verlauf am ANSPRECHPARTNER enthält seine Nachrichten', () => {
  it('als Empfänger und als Rechtsgrundlage-Kontakt', async () => {
    const k = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await kontakt(f.reinigung, k, 'Kellermann');
    const andere = await kontakt(f.reinigung, k, 'Kollegin');
    await nachricht({ mandantId: f.reinigung, betreff: 'An ihn adressiert',
      kundeId: k, kontaktId: null, empfaenger: ap });
    await nachricht({ mandantId: f.reinigung, betreff: 'Seine Grundlage',
      kundeId: null, kontaktId: ap, empfaenger: null });
    await nachricht({ mandantId: f.reinigung, betreff: 'An die Kollegin',
      kundeId: k, kontaktId: andere, empfaenger: andere });

    const verlauf = await alsIntern(f.reinigung, (tx) =>
      leseKontaktVerlauf(kontextAus(tx, f.reinigung), ap));
    expect(verlauf.map((e) => e.betreff).sort()).toEqual(['An ihn adressiert', 'Seine Grundlage']);
    for (const e of verlauf) expect(e.quelle).toBe('nachricht');
  });
});

describe('§3 festhalten am Kunden und am Kontakt — durch das UWG-Tor', () => {
  it('eine Notiz am Kunden: intern, mit Serverzeit und dem Menschen', async () => {
    const k = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    const id = await alsIntern(f.reinigung, (tx) => halteFest(kontextAus(tx, f.reinigung), {
      kundeId: k, art: 'notiz', richtung: 'ausgehend', inhalt: 'Schlüssel liegt beim Hausmeister',
    }));
    const [z] = await sql.unsafe<{
      kunde_id: string; richtung: string; zweck: string; kanal: string | null;
      benutzer_id: string; frisch: boolean; betreff: string;
    }[]>(
      `select kunde_id, richtung::text as richtung, zweck::text as zweck, kanal, benutzer_id,
              (now() - geschehen_am) < interval '1 minute' as frisch, betreff
         from lead_aktivitaet where id = $1`, [id]);
    expect(z).toMatchObject({ kunde_id: k, richtung: 'intern', zweck: 'intern', kanal: null,
      benutzer_id: chef, frisch: true, betreff: 'Schlüssel liegt beim Hausmeister' });
  });

  it('ein ausgehender Anruf am Kontakt trägt den Kunden und den Beleg des Tores', async () => {
    const k = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await kontakt(f.reinigung, k, 'Kellermann');
    const id = await alsIntern(f.reinigung, (tx) => halteFest(kontextAus(tx, f.reinigung), {
      ansprechpartnerId: ap, art: 'anruf', richtung: 'ausgehend', zweck: 'vertraglich',
      inhalt: 'Fensterturnus besprochen',
    }));
    const [z] = await sql.unsafe<{ kunde_id: string; kanal: string; grundlage: string }[]>(
      `select kunde_id, kanal, rechtsgrundlage_snapshot::text as grundlage
         from lead_aktivitaet where id = $1`, [id]);
    expect(z).toEqual({ kunde_id: k, kanal: 'telefon', grundlage: 'bestandskunde' });
  });

  it('Werbung an einen Kontakt ohne Grundlage: abgewiesen, nichts geschrieben', async () => {
    const k = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await kontakt(f.reinigung, k, 'Ohnegrund', 'keine');
    const grund = await crmFehler(alsIntern(f.reinigung, (tx) =>
      halteFest(kontextAus(tx, f.reinigung), {
        ansprechpartnerId: ap, art: 'email', richtung: 'ausgehend', zweck: 'werbung',
        inhalt: 'Neues Angebot Glasreinigung',
      })));
    expect(grund).toBe('uwg');
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from lead_aktivitaet where ansprechpartner_id = $1`, [ap]);
    expect(n?.n).toBe(0);
  });

  it('ausgehend ohne Ansprechpartner, Kontakt ohne Kunde, fremder Kontakt', async () => {
    const k = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    const anderer = await kunde(f.reinigung, 'Nachbarhaus');
    const apAnders = await kontakt(f.reinigung, anderer, 'Nachbar');
    const apOhne = await kontakt(f.reinigung, null, 'Webanfrage');
    const kBau = await kunde(f.bau, 'Bauherr Spandau');
    const apBau = await kontakt(f.bau, kBau, 'Oberstein');

    const halte = (e: Parameters<typeof halteFest>[1]) => crmFehler(
      alsIntern(f.reinigung, (tx) => halteFest(kontextAus(tx, f.reinigung), e)));

    expect(await halte({ kundeId: k, art: 'anruf', richtung: 'ausgehend', zweck: 'vertraglich',
      inhalt: 'x' })).toBe('ohne_ansprechpartner');
    // V-153: ohne Zweck kein ausgehender Eintrag — keine Vorgabe „vertraglich" mehr.
    expect(await halte({ kundeId: k, art: 'anruf', richtung: 'ausgehend', inhalt: 'x' }))
      .toBe('ohne_zweck');
    expect(await halte({ ansprechpartnerId: apOhne, art: 'notiz', richtung: 'intern',
      inhalt: 'x' })).toBe('kontakt_ohne_kunde');
    expect(await halte({ kundeId: k, ansprechpartnerId: apAnders, art: 'notiz',
      richtung: 'intern', inhalt: 'x' })).toBe('fremder_kontakt');
    /* Der Kontakt einer anderen Gesellschaft ist hier nicht da (RLS) — 404, nie 403. */
    expect(await halte({ ansprechpartnerId: apBau, art: 'notiz', richtung: 'intern',
      inhalt: 'x' })).toBe('kein_kontakt');
    expect(await halte({ art: 'notiz', richtung: 'intern', inhalt: 'x' })).toBe('ohne_bezug');
  });

  it('V-153: ein veränderter Kundenbezug legt keine verwaiste Notiz an', async () => {
    const kBau = await kunde(f.bau, 'Bauherr Spandau');
    const halte = (e: Parameters<typeof halteFest>[1]) => crmFehler(
      alsIntern(f.reinigung, (tx) => halteFest(kontextAus(tx, f.reinigung), e)));
    /*
     * `lead_aktivitaet.kunde_id` trägt keinen Fremdschlüssel (0017). Vorher
     * entstand hier eine Zeile im Mandanten der Sitzung mit der Kennung eines
     * Kunden der Bau-GmbH — und eine mit einer Kennung, die es gar nicht gibt.
     */
    expect(await halte({ kundeId: kBau, art: 'notiz', richtung: 'intern', inhalt: 'x' }))
      .toBe('kein_kunde');
    expect(await halte({ kundeId: '00000000-0000-4000-8000-000000000000', art: 'notiz',
      richtung: 'intern', inhalt: 'x' })).toBe('kein_kunde');
    // Keine UUID: vorher 22P02 am `::uuid`, also 500 — jetzt ein Satz.
    expect(await halte({ kundeId: 'kein-bezug', art: 'notiz', richtung: 'intern', inhalt: 'x' }))
      .toBe('ungueltiger_bezug');
    expect(await halte({ ansprechpartnerId: 'x', art: 'notiz', richtung: 'intern', inhalt: 'x' }))
      .toBe('ungueltiger_bezug');
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from lead_aktivitaet
        where mandant_id = $1 and kunde_id = $2`, [f.reinigung, kBau]);
    expect(n?.n).toBe(0);
  });
});
