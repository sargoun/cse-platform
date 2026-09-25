/**
 * Der Antrag des Menschen kommt mit einem Satz zurück, nicht als 500 — und der
 * Schichttausch verlangt die EIGENE kommende Schicht (V-187, EMP-10, O-925).
 *
 * Vorher: `/portal/mein/antraege/neu` bot den Schichttausch an und schickte
 * weder Schicht noch Partner; der Auslöser `antrag_pflichtfelder` (0074) warf
 * `check_violation`, die Route warf ihn weiter. Dasselbe beim Urlaubsantrag
 * ohne Zeitraum oder ohne Abwesenheitsart.
 *
 * Geprüft wird hier der Dienst im ECHTEN Schreibweg des Portals
 * (Personen-Scope → Mandant der Anstellung → `withTenant` mit
 * `portal: 'mitarbeiter'`), gegen die echte RLS.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  withPersonScope, withTenant,
  type LeseKontext, type SchreibKontext, type Sitzung,
} from '../../src/server/kontext/index.js';
import { mandantDerAnstellung } from '../../src/server/services/zeit/einwand.js';
import {
  AntragAbgewiesen, reicheAntragEin,
} from '../../src/server/services/abwesenheit/antrag.js';
import {
  artEinreichbar, listeTauschbareSchichten, TAUSCHBARE_SCHICHT_FELDER,
  TAUSCHPARTNER_QUELLE, type TauschpartnerQuelle,
} from '../../src/server/services/mitarbeiter/tausch.js';
import { leseAntragsarten } from '../../src/server/services/mitarbeiter/antraege.js';
import { datenbankGrund } from '../../src/app/api/mein/formular.js';

let f: Fixtur;
let fatimaKonto: string;
const SITZUNG = '00000000-0000-0000-0000-0000000003b7';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(personId: string): Promise<string> {
  const email = `tausch-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function objekt(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Treppenhaus Nord','Kurfürstendamm 21','10719','Berlin') returning id`,
    [mandant, k!.id, `OBJ-${zufall()}`]);
  return o!.id;
}

/** Eine Schicht, `tage` Tage von heute (Berliner Kalender), 06:00–14:00. */
async function schicht(
  mandant: string, objektId: string, anstellung: string, person: string, tage: number,
): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, objekt_id, quelle, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt,
                          beginn_lokal, ende_lokal, endet_am_folgetag, erstellt_von_art)
     select $1, $2, 'manuell', d,
            (d + time '06:00') at time zone 'Europe/Berlin',
            (d + time '14:00') at time zone 'Europe/Berlin',
            time '06:00', time '14:00', false, 'system'
       from (select ((now() at time zone 'Europe/Berlin')::date + $3::int) as d) t
     returning id`,
    [mandant, objektId, tage] as never[]);
  await sql.unsafe(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, e.id, $3, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'system'
       from einsatz e where e.id = $2`,
    [mandant, e!.id, anstellung, person] as never[]);
  return e!.id;
}

function meineSitzung(aktiverMandantId: string): Sitzung {
  return {
    benutzerId: fatimaKonto, personId: f.fatima, aktiverMandantId,
    ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter', sitzungId: SITZUNG,
  };
}

async function alsPerson<T>(fn: (k: LeseKontext) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) =>
    withPersonScope(tx as never, meineSitzung(f.reinigung), fn)) as Promise<T>;
}

async function alsPersonImMandanten<T>(
  anstellungId: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx: postgres.TransactionSql) => {
    const sitzung = meineSitzung(f.reinigung);
    const mandantId = await withPersonScope(tx as never, sitzung, async (k) =>
      mandantDerAnstellung(k, anstellungId));
    return withTenant(
      tx as never,
      { ...sitzung, ansicht: 'mandant', aktiverMandantId: mandantId, portal: 'mitarbeiter' },
      fn,
    );
  }) as Promise<T>;
}

async function antragsart(schluessel: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `select id from antragsart where schluessel = $1 and mandant_id is null`, [schluessel]);
  return z!.id;
}

async function abwesenheitsart(schluessel: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `select id from abwesenheitsart where schluessel = $1 and mandant_id is null`, [schluessel]);
  return z!.id;
}

/** Wie `reicheAntragEin` abweist — der Grund, oder `null`, wenn es durchging. */
async function grund(
  anstellung: string, eingabe: Parameters<typeof reicheAntragEin>[1],
  quelle?: TauschpartnerQuelle,
): Promise<string | null> {
  try {
    await alsPersonImMandanten(anstellung, (k) => reicheAntragEin(k, eingabe, quelle));
    return null;
  } catch (fehler) {
    if (fehler instanceof AntragAbgewiesen) return fehler.grund;
    throw fehler;
  }
}

beforeEach(async () => {
  f = await seed();
  fatimaKonto = await konto(f.fatima);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [fatimaKonto, m, await rolleId('mitarbeiter')]);
  }
});

afterAll(async () => { await schliessen(); });

describe('(1) die Schichtauswahl: nur eigene, kommende, lebende Schichten', () => {
  it('zeigt die kommende Schicht beider Gesellschaften — nie die vergangene, fremde, entfernte', async () => {
    const oR = await objekt(f.reinigung);
    const oS = await objekt(f.security);
    const morgen = await schicht(f.reinigung, oR, f.fatimaReinigung, f.fatima, 1);
    const inDreiTagen = await schicht(f.security, oS, f.fatimaSecurity, f.fatima, 3);
    const gestern = await schicht(f.reinigung, oR, f.fatimaReinigung, f.fatima, -1);
    const jonasMorgen = await schicht(f.reinigung, oR, f.jonasReinigung, f.jonas, 1);
    const entfernt = await schicht(f.reinigung, oR, f.fatimaReinigung, f.fatima, 2);
    await sql.unsafe(
      `update einsatz_zuordnung set entfernt_am = now() where einsatz_id = $1`, [entfernt]);

    const liste = await alsPerson((k) => listeTauschbareSchichten(k));
    const ids = liste.map((s) => s.einsatzId);
    expect(ids).toEqual([morgen, inDreiTagen]);
    expect(ids).not.toContain(gestern);
    expect(ids).not.toContain(jonasMorgen);
    expect(ids).not.toContain(entfernt);
    // Jede Zeile trägt ihre Gesellschaft (EMP-14) und nur die erlaubten Felder.
    expect(liste.map((s) => s.anstellungId)).toEqual([f.fatimaReinigung, f.fatimaSecurity]);
    for (const s of liste) expect(Object.keys(s).sort()).toEqual([...TAUSCHBARE_SCHICHT_FELDER].sort());
    expect(liste[0]?.beginnUhrzeit).toBe('06:00');
  });
});

describe('(2) der Schichttausch: ohne festgelegte Partnerquelle nicht einreichbar (O-925)', () => {
  it('die ausgelieferte Quelle bietet niemanden an, und das Formular führt die Art nicht', async () => {
    expect(TAUSCHPARTNER_QUELLE.festgelegt).toBe(false);
    const arten = await alsPerson((k) => leseAntragsarten(k, 'de'));
    const tausch = arten.find((a) => a.schluessel === 'schichttausch')!;
    const urlaub = arten.find((a) => a.schluessel === 'urlaub')!;
    expect(artEinreichbar(tausch)).toBe(false);
    expect(artEinreichbar(urlaub)).toBe(true);
  });

  it('ein Tauschantrag ohne Partner — und mit einem nachgebauten — wird mit Grund abgewiesen', async () => {
    const oR = await objekt(f.reinigung);
    const morgen = await schicht(f.reinigung, oR, f.fatimaReinigung, f.fatima, 1);
    const art = await antragsart('schichttausch');
    expect(await grund(f.fatimaReinigung, {
      anstellungId: f.fatimaReinigung, antragsartId: art, einsatzId: morgen,
    })).toBe('tauschpartner_nicht_waehlbar');
    // Jonas' Beschäftigung, mitgeschickt aus einer nachgebauten Anfrage.
    expect(await grund(f.fatimaReinigung, {
      anstellungId: f.fatimaReinigung, antragsartId: art, einsatzId: morgen,
      tauschPartnerAnstellungId: f.jonasReinigung,
    })).toBe('tauschpartner_nicht_waehlbar');
    const [n] = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from antrag`);
    expect(n?.n).toBe('0');
  });

  it('mit festgelegter Quelle: eigene kommende Schicht geht durch, jede andere nicht', async () => {
    const oR = await objekt(f.reinigung);
    const morgen = await schicht(f.reinigung, oR, f.fatimaReinigung, f.fatima, 1);
    const gestern = await schicht(f.reinigung, oR, f.fatimaReinigung, f.fatima, -1);
    const jonasMorgen = await schicht(f.reinigung, oR, f.jonasReinigung, f.jonas, 1);
    const oS = await objekt(f.security);
    const security = await schicht(f.security, oS, f.fatimaSecurity, f.fatima, 1);
    const art = await antragsart('schichttausch');
    /** Nur für diesen Test: eine Quelle, die genau Jonas anbietet. */
    const quelle: TauschpartnerQuelle = {
      festgelegt: true,
      lese: async () => [{ anstellungId: f.jonasReinigung, anzeigename: 'Jonas' }],
    };
    const mit = (einsatzId: string | null) => grund(f.fatimaReinigung, {
      anstellungId: f.fatimaReinigung, antragsartId: art, einsatzId,
      tauschPartnerAnstellungId: f.jonasReinigung,
    }, quelle);

    expect(await mit(null)).toBe('schicht_fehlt');
    expect(await mit(gestern)).toBe('schicht_nicht_waehlbar');
    expect(await mit(jonasMorgen)).toBe('schicht_nicht_waehlbar');
    // Die eigene Schicht der ANDEREN Beschäftigung gehört nicht zu diesem Antrag.
    expect(await mit(security)).toBe('schicht_nicht_waehlbar');
    expect(await mit(morgen)).toBeNull();

    // Ein Partner, den die Quelle nicht anbietet, wird nicht angenommen.
    expect(await grund(f.fatimaReinigung, {
      anstellungId: f.fatimaReinigung, antragsartId: art, einsatzId: morgen,
      tauschPartnerAnstellungId: f.fatimaReinigung,
    }, quelle)).toBe('tauschpartner_nicht_waehlbar');

    const [z] = await sql.unsafe<{ einsatz_id: string; partner: string }[]>(
      `select einsatz_id, tausch_partner_anstellung_id as partner from antrag`);
    expect(z?.einsatz_id).toBe(morgen);
    expect(z?.partner).toBe(f.jonasReinigung);
  });
});

describe('(3) Urlaub: was die Art verlangt, sagt der Dienst vor dem Auslöser', () => {
  it('ohne Zeitraum, verkehrt herum, ohne Abwesenheitsart, archivierte Art', async () => {
    const art = await antragsart('urlaub');
    const ferien = await abwesenheitsart('urlaub');
    const basis = { anstellungId: f.fatimaReinigung, antragsartId: art };
    expect(await grund(f.fatimaReinigung, { ...basis, abwesenheitsartId: ferien }))
      .toBe('zeitraum_fehlt');
    expect(await grund(f.fatimaReinigung, {
      ...basis, abwesenheitsartId: ferien, vonDatum: '2029-07-17', bisDatum: '2029-07-06',
    })).toBe('zeitraum_verkehrt');
    expect(await grund(f.fatimaReinigung, {
      ...basis, vonDatum: '2029-07-06', bisDatum: '2029-07-17',
    })).toBe('abwesenheitsart_fehlt');
    expect(await grund(f.fatimaReinigung, {
      ...basis, abwesenheitsartId: ferien, vonDatum: '2029-07-06', bisDatum: '2029-07-17',
    })).toBeNull();

    await sql.unsafe(`update antragsart set archiviert_am = now() where id = $1`, [art]);
    expect(await grund(f.fatimaReinigung, {
      ...basis, abwesenheitsartId: ferien, vonDatum: '2029-08-06', bisDatum: '2029-08-07',
    })).toBe('art_nicht_waehlbar');
  });

  it('die zweite Linie bleibt: der Auslöser weist ab, und die Route kennt seinen Code', async () => {
    const art = await antragsart('urlaub');
    let gefangen: unknown = null;
    try {
      await alsPersonImMandanten(f.fatimaReinigung, (k) => k.schreibe(
        `insert into antrag (mandant_id, anstellung_id, antragsart_id, eingereicht_von_benutzer_id)
         values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid)`,
        [f.fatimaReinigung, art, fatimaKonto]));
    } catch (fehler) {
      gefangen = fehler;
    }
    expect((gefangen as { code?: string }).code).toBe('23514');
    // Vorher: kein `status` → `throw` → 500. Jetzt: ein Grund für die Maske.
    expect(datenbankGrund(gefangen)).toBe('ungueltige_eingabe');
  });
});
