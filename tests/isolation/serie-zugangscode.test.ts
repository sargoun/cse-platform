/**
 * D-487 gegen eine echte Datenbank — Serien anlegen, Anmeldecode durch die
 * Einsatzleitung, Abwesenheitsarten fuer den Lohnexport (0143).
 *
 *  1. Eine Turnus-Serie entsteht mit ihren Schichten SOFORT; ein zweiter
 *     Aufruf legt keine zweite Serie an; ein Revier der anderen Gesellschaft
 *     ist nicht erreichbar. Ein Posten mit Dienstzeiten bekommt seine Serie
 *     und seine Schichten.
 *  2. Der Anmeldecode: fuer eine Beschaeftigte der aktiven Gesellschaft
 *     entsteht ein einloesbarer Code, die Nummer bleibt maskiert, die Bremse
 *     haelt bei drei offenen Codes; ohne Zugang, ohne Beschaeftigung und ohne
 *     Recht gibt es keinen.
 *  3. Wem `zeit.exportieren` fehlt, dem verweigert die Datenbank die
 *     Abwesenheitsarten — und damit den Lohnexport.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  SerieEingabeFehlt, legePlanungsserieAn, legeTurnusSerieAn,
} from '../../src/server/services/dienstplan/serie.js';
import { leseZugangsstand, stelleZugangscodeAus } from '../../src/server/services/personal/zugangscode.js';
import { mitarbeiterSitzungAusstellen } from '../../src/server/auth/sitzung.js';
import { codeEinloesen } from '../../src/server/auth/mitarbeiter-anmeldung.js';
import { erstelleLohnexport } from '../../src/server/services/zeit/lohnexport.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function sitzung(mandantId?: string, benutzerId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung, benutzerId: benutzerId ?? benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql, mandantId?: string, benutzerId?: string): SchreibKontext {
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
     values ($1, $2, 'Einsatzleitung', 'aktiv',
             (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, email, globaleRolle]);
  return u!.id;
}

async function legeAdministrationAn(mandantId: string): Promise<string> {
  const id = await legeBenutzerAn(`admin-${zufall()}@cse.test`, null);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [id, mandantId]);
  return id;
}

async function entziehe(rolle: string, recht: string, mandantId: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select r.id, b.id, $3, false
       from rolle r, berechtigung b
      where r.schluessel = $1 and r.mandant_id is null and b.schluessel = $2`,
    [rolle, recht, mandantId]);
}

/** Ein Objekt mit Kunde — der Generator braucht den Kunden (`einsatz.kunde_id`). */
async function objektMitKunde(mandantId: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort)
     values ($1, $2, 'firma', 'Hausverwaltung Nord GmbH', 'Müllerstraße', '12', '13353', 'Berlin')
     returning id`, [mandantId, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, hausnummer, plz, ort)
     values ($1, $2, $3, 'Bürohaus Wedding', 'Müllerstraße', '12', '13353', 'Berlin')
     returning id`, [mandantId, k!.id, `O-${zufall()}`]);
  return o!.id;
}

async function revierUndLeistung(mandantId: string, objektId: string): Promise<{ revier: string; leistung: string }> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten, aktiv_ab, erstellt_von_art)
     values ($1, $2, 'Etage 1', 120, current_date, 'system') returning id`, [mandantId, objektId]);
  const [katalog] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
     values ($1, $2, 'Testkatalog', current_date) returning id`, [mandantId, `test-${zufall()}`]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog_position (mandant_id, katalog_id, oz, kurztext, einheit, zeitwert_minuten, ist_platzhalter, gueltig_ab)
     values ($1, $2, '01.001', 'Unterhaltsreinigung', 'h', 60, true, current_date) returning id`,
    [mandantId, katalog!.id]);
  return { revier: r!.id, leistung: pos!.id };
}

async function heute(): Promise<string> {
  const [z] = await sql.unsafe<{ tag: string }[]>(`select app.berlin_heute()::text as tag`);
  return z!.tag;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`serie-${zufall()}@cse.test`);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) Serien anlegen', () => {
  it('eine Turnus-Serie entsteht mit ihren Schichten sofort — und nur einmal', async () => {
    const objekt = await objektMitKunde(f.reinigung);
    const { revier, leistung } = await revierUndLeistung(f.reinigung, objekt);
    const tag = await heute();
    const a = await alsApp(sitzung(), (tx) => legeTurnusSerieAn(kontextAus(tx), {
      revierId: revier, leistungskatalogPositionId: leistung, bezeichnung: 'Unterhaltsreinigung früh',
      wochentage: ['MO', 'TU', 'WE', 'TH', 'FR'], beginnLokal: '06:00', dauerMinuten: 240,
      gueltigAb: tag, feiertagsregel: 'ausfall',
    }));
    expect(a.bestandSchon).toBe(false);
    expect(a.erzeugt).toBeGreaterThanOrEqual(30);
    /*
     * Höchstens EIN Termin wird übersprungen: der von heute 06:00, wenn die
     * Prüfung nach 06:00 an einem Werktag läuft — er hat schon begonnen und
     * entsteht nicht neu (V-135). Bis V-135 stand hier `toEqual([])`, und das
     * galt nur, weil der Generator diese Schicht in die Vergangenheit legte.
     */
    expect(a.uebersprungen.length).toBeLessThanOrEqual(1);
    expect(a.uebersprungen.every((u) => u.grund === 'vergangen_oder_gearbeitet')).toBe(true);
    const [begonnen] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from einsatz
        where planungsserie_id = $1 and storniert_am is null and beginn_zeitpunkt <= now()`,
      [a.planungsserieId]);
    expect(begonnen!.n).toBe(0);
    const [zahl] = await sql.unsafe<{ n: number; erster: string }[]>(
      `select count(*)::int as n, min(plan_datum)::text as erster from einsatz
        where planungsserie_id = $1 and mandant_id = $2 and objekt_id = $3 and storniert_am is null`,
      [a.planungsserieId, f.reinigung, objekt]);
    expect(zahl!.n).toBe(a.erzeugt);
    expect(zahl!.erster >= tag).toBe(true);
    const [turnus] = await sql.unsafe<{ rrule: string; beginn: string }[]>(
      `select rrule, to_char(dtstart_lokal, 'HH24:MI') as beginn from turnus where id = $1`, [a.traegerId]);
    expect(turnus).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', beginn: '06:00' });

    /* Ein zweiter Aufruf fuer denselben Traeger: keine zweite Serie, keine doppelten Schichten. */
    const b = await alsApp(sitzung(), (tx) => legePlanungsserieAn(kontextAus(tx), {
      quelle: 'turnus', traegerId: a.traegerId, feiertageUeberspringen: true,
    }));
    expect(b.bestandSchon).toBe(true);
    expect(b.planungsserieId).toBe(a.planungsserieId);
    const [serien] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from planungsserie where turnus_id = $1 and archiviert_am is null`, [a.traegerId]);
    expect(serien!.n).toBe(1);
    const [danach] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from einsatz where planungsserie_id = $1 and storniert_am is null`, [a.planungsserieId]);
    expect(danach!.n).toBe(zahl!.n);
    const [protokoll] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log where aktion = 'dienstplan.serie_angelegt' and objekt_id = $1`,
      [a.planungsserieId]);
    expect(protokoll!.n).toBe(2);
  });

  it('das Revier der anderen Gesellschaft ist nicht erreichbar; Eingaben werden geprueft', async () => {
    const objekt = await objektMitKunde(f.reinigung);
    const { revier, leistung } = await revierUndLeistung(f.reinigung, objekt);
    const tag = await heute();
    await expect(alsApp(sitzung(f.security), (tx) => legeTurnusSerieAn(kontextAus(tx, f.security), {
      revierId: revier, leistungskatalogPositionId: leistung, bezeichnung: 'Fremd',
      wochentage: ['MO'], beginnLokal: '06:00', dauerMinuten: 240, gueltigAb: tag, feiertagsregel: 'ausfall',
    }))).rejects.toThrow();
    await expect(alsApp(sitzung(), (tx) => legeTurnusSerieAn(kontextAus(tx), {
      revierId: revier, leistungskatalogPositionId: leistung, bezeichnung: 'Ohne Tage',
      wochentage: [], beginnLokal: '06:00', dauerMinuten: 240, gueltigAb: tag, feiertagsregel: 'ausfall',
    }))).rejects.toThrow(SerieEingabeFehlt);
    await expect(alsApp(sitzung(), (tx) => legeTurnusSerieAn(kontextAus(tx), {
      revierId: revier, leistungskatalogPositionId: leistung, bezeichnung: 'Zu lang',
      wochentage: ['MO'], beginnLokal: '25:00', dauerMinuten: 240, gueltigAb: tag, feiertagsregel: 'ausfall',
    }))).rejects.toThrow(/Uhrzeit/u);
  });

  it('ein Posten mit Dienstzeiten bekommt seine Serie und seine Schichten', async () => {
    const objekt = await objektMitKunde(f.security);
    const tag = await heute();
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into posten (mandant_id, objekt_id, bezeichnung, kurzzeichen, min_besetzung, soll_besetzung,
                           abdeckung_rrule, dtstart_lokal, zeitzone, dauer_minuten, gueltig_ab, erstellt_von_art)
       values ($1, $2, 'Nachtwache', 'NW', 1, 1, 'FREQ=WEEKLY;BYDAY=TU,TH', ($3 || ' 22:00')::timestamp,
               'Europe/Berlin', 480, $3::date, 'system') returning id`, [f.security, objekt, tag]);
    const e = await alsApp(sitzung(f.security), (tx) => legePlanungsserieAn(kontextAus(tx, f.security), {
      quelle: 'posten', traegerId: p!.id, feiertageUeberspringen: false,
    }));
    expect(e.bestandSchon).toBe(false);
    expect(e.erzeugt).toBeGreaterThanOrEqual(14);
    const [zahl] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from einsatz where posten_id = $1 and storniert_am is null`, [p!.id]);
    expect(zahl!.n).toBe(e.erzeugt);
  });
});

describe('(2) der Anmeldecode aus der Hand der Einsatzleitung', () => {
  const TELEFON = '+491701234567';

  it('entsteht fuer eine Beschaeftigte, ist einloesbar, maskiert die Nummer und haelt die Bremse', async () => {
    await sql.unsafe(
      `insert into mitarbeiter_zugang (person_id, telefon_e164) values ($1, $2)
       on conflict (person_id) do update set telefon_e164 = excluded.telefon_e164`, [f.jonas, TELEFON]);
    const a = await alsApp(sitzung(), (tx) => stelleZugangscodeAus(kontextAus(tx), f.jonas));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.code).toMatch(/^[0-9]{6}$/u);
    expect(a.telefonMaskiert).toBe('…567');
    expect(a.gueltigMinuten).toBe(10);
    const [protokoll] = await sql.unsafe<{ n: number; nachher: { weg?: string } }[]>(
      `select count(*)::int as n, min(nachher::text)::jsonb as nachher from audit_log
        where aktion = 'zugang.code_ausgestellt' and objekt_id = $1`, [f.jonas]);
    expect(protokoll!.n).toBe(1);
    expect(protokoll!.nachher.weg).toBe('einsatzleitung');
    expect(JSON.stringify(protokoll!.nachher)).not.toContain(a.code);

    /* Einloesbar wie ein SMS-Code — und genau einmal. */
    const person = await sql.begin(async (tx) => codeEinloesen(tx, TELEFON, a.code, null));
    expect(person).toBe(f.jonas);
    const nochmal = await sql.begin(async (tx) => codeEinloesen(tx, TELEFON, a.code, null));
    expect(nochmal).toBeNull();

    /* Drei offene Codes sind die Grenze — der vierte ist „bremse". */
    for (let i = 0; i < 3; i += 1) {
      const c = await alsApp(sitzung(), (tx) => stelleZugangscodeAus(kontextAus(tx), f.jonas));
      expect(c.ok, `Code ${String(i + 1)}`).toBe(true);
    }
    const vierter = await alsApp(sitzung(), (tx) => stelleZugangscodeAus(kontextAus(tx), f.jonas));
    expect(vierter.ok).toBe(false);
    if (!vierter.ok) expect(vierter.grund).toBe('bremse');
  });

  it('ohne Zugang, ohne Beschaeftigung in der Gesellschaft, ohne Recht: kein Code', async () => {
    const ohne = await alsApp(sitzung(), (tx) => stelleZugangscodeAus(kontextAus(tx), f.jonas));
    expect(ohne.ok).toBe(false);
    if (!ohne.ok) expect(ohne.grund).toBe('kein_zugang');

    const fremd = await alsApp(sitzung(f.security), (tx) => stelleZugangscodeAus(kontextAus(tx, f.security), f.jonas));
    expect(fremd.ok).toBe(false);
    if (!fremd.ok) expect(fremd.grund).toBe('keine_anstellung');

    const admin = await legeAdministrationAn(f.reinigung);
    await entziehe('admin', 'personal.zugang_verwalten', f.reinigung);
    await expect(alsApp(sitzung(undefined, admin), (tx) => stelleZugangscodeAus(kontextAus(tx, undefined, admin), f.jonas)))
      .rejects.toSatisfy((e: unknown) => e instanceof Error && /zugang_verwalten|privilege/u.test(e.message));
  });
});

/**
 * **Der Befund, der den Vormittag gekostet hat** (D-488).
 *
 * „Ich tippe den Code ein, und es passiert nichts." Drei Zustaende sehen am
 * Telefon gleich aus, und keiner stand irgendwo: kein Zugang, kein
 * benutzbares Konto, drei offene Codes. Der schlimmste ist der mittlere: der
 * Code ist RICHTIG, wird eingeloest und verbraucht — und die Sitzung bleibt
 * aus (0115). Hier steht er als Ablauf, nicht als Behauptung.
 */
describe('(2b) der Zugangsstand sagt, woran die Anmeldung haengt', () => {
  const TELEFON = '+491701239876';

  it('richtiger Code, kein benutzbares Konto: eingeloest, aber keine Sitzung — und der Stand sagt es vorher', async () => {
    /* Ein Mensch mit Beschaeftigung und Zugang, aber ohne Benutzerkonto. */
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname, telefon)
       values ('Ohne', 'Konto', '+49 170 1239876') returning id`);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1, $2, $3, current_date - 30, 'aktiv')`,
      [f.reinigung, p!.id, `PN-${zufall()}`]);
    await sql.unsafe(
      `insert into mitarbeiter_zugang (person_id, telefon_e164) values ($1, $2)`, [p!.id, TELEFON]);

    const vorher = await alsApp(sitzung(), (tx) => leseZugangsstand(kontextAus(tx), p!.id));
    expect(vorher.hatAnstellung).toBe(true);
    expect(vorher.hatZugang).toBe(true);
    expect(vorher.hatKonto, 'genau das ist das Hindernis').toBe(false);
    expect(vorher.telefonMaskiert).toBe('…876');
    expect(vorher.offeneCodes).toBe(0);
    expect(vorher.letzteAnmeldung).toBeNull();

    const a = await alsApp(sitzung(), (tx) => stelleZugangscodeAus(kontextAus(tx), p!.id));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const offen = await alsApp(sitzung(), (tx) => leseZugangsstand(kontextAus(tx), p!.id));
    expect(offen.offeneCodes, 'die Bremse zaehlt sichtbar mit').toBe(1);

    /* Der Code stimmt — die Sitzung kommt trotzdem nicht. */
    const ergebnis = await sql.begin(async (tx) => {
      const personId = await codeEinloesen(tx, TELEFON, a.code, null);
      return personId === null ? null : mitarbeiterSitzungAusstellen(tx, personId, null, null);
    });
    expect(ergebnis, 'kein benutzbares Konto (0115) — genau dieser Fall hiess bisher „falscher Code"')
      .toBeNull();
  });

  it('ein Mensch ohne Zugang: der Stand sagt es, statt einen Code anzubieten', async () => {
    const stand = await alsApp(sitzung(), (tx) => leseZugangsstand(kontextAus(tx), f.jonas));
    expect(stand.hatAnstellung).toBe(true);
    expect(stand.hatZugang).toBe(false);
    expect(stand.telefonMaskiert).toBeNull();
  });

  it('ohne das Recht gibt es den Stand nicht', async () => {
    const admin = await legeAdministrationAn(f.reinigung);
    await entziehe('admin', 'personal.zugang_verwalten', f.reinigung);
    await expect(alsApp(sitzung(undefined, admin),
      (tx) => leseZugangsstand(kontextAus(tx, undefined, admin), f.jonas)))
      .rejects.toSatisfy((e: unknown) => e instanceof Error && /zugang_verwalten|privilege/u.test(e.message));
  });
});

describe('(3) Abwesenheitsarten nur fuer den Lohnexport', () => {
  it('ohne zeit.exportieren verweigert die Datenbank die Arten — und damit den Export', async () => {
    const admin = await legeAdministrationAn(f.reinigung);
    await entziehe('admin', 'zeit.exportieren', f.reinigung);
    const tag = await heute();
    await expect(alsApp(sitzung(undefined, admin), (tx) => erstelleLohnexport(kontextAus(tx, undefined, admin), tag.slice(0, 7))))
      .rejects.toSatisfy((e: unknown) => e instanceof Error && /zeit\.exportieren|privilege/u.test(e.message));
    const [direkt] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from abwesenheitsart where mandant_id is null`);
    expect(direkt!.n).toBeGreaterThan(0);
  });
});
