/**
 * PR 39 — das Mitarbeiterportal an echtem Postgres.
 *
 * Fuenf der sechs Abnahmekriterien sind Aussagen ueber die DATENBANK und in
 * TypeScript nicht falsifizierbar: ob eine Anmeldung wirklich beide
 * Gesellschaften sieht, entscheidet die RLS; ob ein Zeiteintrag wirklich nicht
 * aenderbar ist, entscheidet eine restriktive Policy; ob im Ergebnis wirklich
 * kein Lohnsatz steht, entscheiden Spaltenprivilegien. Das sechste
 * (`dir="rtl"`, axe) steht in `tests/kern/mitarbeiter-sprachen.test.ts` und in
 * der e2e-Spezifikation.
 *
 * Jeder Fall ist so gebaut, dass er OHNE die Umsetzung fehlschlaegt.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  withPersonScope, withTenant,
  type LeseKontext, type SchreibKontext, type Sitzung,
} from '../../src/server/kontext/index.js';
import {
  laufendeOderNaechsteSchicht, listeEigeneSchichten, SCHICHT_FELDER,
} from '../../src/server/services/mitarbeiter/schichten.js';
import {
  KONTO_ANSICHT_FELDER, leseStundenFenster, leseStundenkonten, leseUrlaub,
  STUNDEN_FENSTER_FELDER, URLAUB_ANSICHT_FELDER,
} from '../../src/server/services/mitarbeiter/stunden.js';
import {
  findeEigenenZeiteintrag, listeEigeneZeiten, ZEITEINTRAG_FELDER,
} from '../../src/server/services/mitarbeiter/zeiten.js';
import {
  EIGENER_NACHWEIS_FELDER, EIGENE_NACHWEISLAGE_FELDER, leseEigeneNachweise,
} from '../../src/server/services/mitarbeiter/nachweise.js';
import {
  ANSTELLUNG_FELDER, leseEigeneAnstellungen, leseEigenePerson,
} from '../../src/server/services/mitarbeiter/person.js';
import { istVerbotenesFeld } from '../../src/server/services/mitarbeiter/felder.js';
import {
  mandantDerAnstellung, reicheEinwandEin, listeEigeneEinwaende,
} from '../../src/server/services/zeit/einwand.js';
import { reicheAntragEin } from '../../src/server/services/abwesenheit/antrag.js';
import {
  ArtUngeklaertFehler, meldeAbwesenheit,
} from '../../src/server/services/abwesenheit/index.js';
import {
  leseAbwesenheitsarten, leseAntragsarten, listeEigeneAbwesenheiten,
  listeEigeneAntraege,
} from '../../src/server/services/mitarbeiter/antraege.js';
import {
  eroeffneKonto, schliesseMonatAb,
} from '../../src/server/services/zeit/stundenkonto.js';
import { eroeffneUrlaubskonto } from '../../src/server/services/zeit/urlaubskonto.js';
import { leseNachweis } from '../../src/server/services/zeit/milog.js';
import {
  assertZuordnungZulaessig, QualifikationFehlt,
} from '../../src/server/services/nachweis/tor.js';

let f: Fixtur;
/** Das Konto der Person mit ZWEI Beschaeftigungen (D-09). */
let fatimaKonto: string;
let planerReinigung: string;
let planerSecurity: string;

const zufall = (): string => String(Math.random()).slice(2, 10);
const SITZUNG = '00000000-0000-0000-0000-0000000003a9';

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(personId: string | null = null): Promise<string> {
  const email = `ma-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId(rolle)]);
}

async function objekt(mandant: string, name = 'Buerohaus'): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,$4,'Kurfürstendamm 21','10719','Berlin') returning id`,
    [mandant, k!.id, `OBJ-${zufall()}`, name]);
  return o!.id;
}

/** Eine Schicht mit BERLINER Wanduhrzeiten am genannten Tag. */
async function einsatz(
  mandant: string, objektId: string, tag: string, von = '06:00', bis = '14:00',
): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, objekt_id, quelle, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt,
                          beginn_lokal, ende_lokal, endet_am_folgetag, erstellt_von_art)
     values ($1,$2,'manuell',$3::date,
             ($3::date + $4::time) at time zone 'Europe/Berlin',
             ($3::date + $5::time) at time zone 'Europe/Berlin',
             $4::time, $5::time, false, 'system')
     returning id`,
    [mandant, objektId, tag, von, bis] as never[]);
  return e!.id;
}

async function zuordnung(
  mandant: string, einsatzId: string, anstellung: string, person: string,
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, e.id, $3, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'system'
       from einsatz e where e.id = $2
     returning id`,
    [mandant, einsatzId, anstellung, person] as never[]);
  return z!.id;
}

/**
 * Ein abgeschlossener Zeiteintrag mit historischen Zeitpunkten.
 *
 * `quelle_* = 'import'` und nicht `'server_uhr'`: bei `server_uhr` ersetzt
 * `kern.stempel_feldzeit()` den mitgeschickten Wert durch `now()` — voellig zu
 * Recht (Invariante 5), aber dann liesse sich kein Monat der Vergangenheit
 * pruefen.
 */
async function zeiteintrag(opts: {
  mandant: string; anstellung: string; person: string; objekt?: string | null;
  von: string; bis: string; pause?: number; freigebenDurch?: string | null;
  geraetBeginn?: string | null; abweichungSek?: number | null;
}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, objekt_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art, geraete_zeit_beginn, zeitabweichung_beginn_sek,
        freigegeben_am, freigegeben_von)
     values ($1,$2,$3,$4::uuid,$5::timestamptz,$6::timestamptz,$7,
             'import','import','import','import','abgeschlossen','system',
             $8::timestamptz, $9,
             case when $10::uuid is null then null else now() end, $10::uuid)
     returning id`,
    [
      opts.mandant, opts.anstellung, opts.person, opts.objekt ?? null,
      opts.von, opts.bis, opts.pause ?? 0,
      opts.geraetBeginn ?? null, opts.abweichungSek ?? null,
      opts.freigebenDurch ?? null,
    ] as never[]);
  return z!.id;
}

async function qualifikation(opts: {
  blockiert?: boolean; warnstufen?: number[];
} = {}): Promise<string> {
  const [q] = await sql.unsafe<{ id: string }[]>(
    `insert into qualifikation (mandant_id, schluessel, bezeichnung, kategorie,
                                rechtsgrundlage, laeuft_ab, blockiert_einsatz, warnung_tage)
     values (null, $1, 'Sachkundeprüfung §34a', 'gesetzlich', '§34a GewO', true, $2, $3)
     returning id`,
    [`34a_${zufall()}`, opts.blockiert ?? true,
     `{${(opts.warnstufen ?? [60, 30, 7]).join(',')}}`] as never[]);
  return q!.id;
}

async function nachweisZeile(opts: {
  person: string; qualifikation: string; mandant: string;
  ab?: string; bis?: string | null;
}): Promise<string> {
  const [n] = await sql.unsafe<{ id: string }[]>(
    `insert into nachweis (person_id, qualifikation_id, gueltig_ab, gueltig_bis,
                           status, erfasst_von_mandant_id)
     values ($1,$2,$3,$4,'gueltig',$5) returning id`,
    [opts.person, opts.qualifikation, opts.ab ?? '2020-01-01', opts.bis ?? null,
     opts.mandant] as never[]);
  return n!.id;
}

async function anforderung(opts: {
  mandant: string; objekt: string; qualifikation: string;
}): Promise<void> {
  await sql.unsafe(
    `insert into einsatzanforderung (mandant_id, geltungsbereich, objekt_id,
                                     qualifikation_id, zwingend, geltung,
                                     bewacherregister_pflicht, rechtsgrundlage)
     values ($1,'objekt',$2,$3,true,'jeder',false,'§34a Abs. 1a GewO')`,
    [opts.mandant, opts.objekt, opts.qualifikation] as never[]);
}

/** Die Sitzung der Arbeiterin — `ansicht: 'mandant'`, wie sie aus dem Cookie kommt. */
function meineSitzung(aktiverMandantId: string): Sitzung {
  return {
    benutzerId: fatimaKonto, personId: f.fatima, aktiverMandantId,
    ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter', sitzungId: SITZUNG,
  };
}

/** Der ECHTE Personen-Scope — nicht ein nachgebauter Kontext. */
async function alsPerson<T>(fn: (k: LeseKontext) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) =>
    withPersonScope(tx as never, meineSitzung(f.reinigung), fn)) as Promise<T>;
}

/** Der Schreibweg des Portals: Mandant aus der Anstellung, dann `withTenant`. */
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

function planerKontext(tx: postgres.TransactionSql, mandant: string, benutzer: string) {
  const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant' as const, portal: 'intern' as const, benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

beforeEach(async () => {
  f = await seed();
  fatimaKonto = await konto(f.fatima);
  await mitglied(fatimaKonto, f.reinigung, 'mitarbeiter');
  await mitglied(fatimaKonto, f.security, 'mitarbeiter');
  planerReinigung = await konto();
  planerSecurity = await konto();
  await mitglied(planerReinigung, f.reinigung, 'leitung');
  await mitglied(planerSecurity, f.security, 'leitung');
});

afterAll(async () => { await schliessen(); });

// ---------------------------------------------------------------------------

describe('(1) EINE Anmeldung, ZWEI Gesellschaften (EMP-14, EMP-15, D-09)', () => {
  /** Je eine Schicht und je ein Zeiteintrag in beiden Gesellschaften. */
  async function beideBeschaeftigungen(): Promise<void> {
    const oR = await objekt(f.reinigung, 'Treppenhaus Nord');
    const oS = await objekt(f.security, 'Empfang Süd');
    const eR = await einsatz(f.reinigung, oR, '2026-03-05', '06:00', '10:00');
    const eS = await einsatz(f.security, oS, '2026-03-05', '18:00', '22:00');
    await zuordnung(f.reinigung, eR, f.fatimaReinigung, f.fatima);
    await zuordnung(f.security, eS, f.fatimaSecurity, f.fatima);
    await zeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: oR,
      von: '2026-03-05T05:00:00Z', bis: '2026-03-05T09:00:00Z',
      freigebenDurch: planerReinigung });
    await zeiteintrag({
      mandant: f.security, anstellung: f.fatimaSecurity, person: f.fatima, objekt: oS,
      von: '2026-03-05T17:00:00Z', bis: '2026-03-05T21:00:00Z',
      freigebenDurch: planerSecurity });
  }

  it('die Schichtliste zeigt BEIDE, jede mit ihrer Gesellschaft beschriftet', async () => {
    await beideBeschaeftigungen();
    const schichten = await alsPerson(async (k) =>
      listeEigeneSchichten(k, { von: '2026-03-01', bis: '2026-03-31' }));

    expect(schichten).toHaveLength(2);
    // Die Beschriftung ist der Kern von EMP-14: ohne sie steht die Kraft
    // morgen frueh bei der falschen GmbH.
    expect(schichten.map((s) => s.mandantSlug).sort()).toEqual(['reinigung', 'security']);
    for (const s of schichten) {
      expect(s.mandantName, s.mandantSlug).not.toBe('');
      expect(s.objekt, s.mandantSlug).not.toBeNull();
    }
    // Und die Zeiten stehen in BERLINER Ortszeit, fertig aus der Datenbank.
    const reinigung = schichten.find((s) => s.mandantSlug === 'reinigung');
    expect(reinigung?.beginnLokal).toBe('05.03.2026 06:00');
    expect(reinigung?.dauerMinuten).toBe(240);
  });

  it('ohne den Personen-Scope bliebe genau das leer — die Probe dazu', async () => {
    await beideBeschaeftigungen();
    /**
     * Der Kategorienfehler aus K-18, als Test: in der GRUPPENANSICHT trifft
     * nur `t_gruppe` zu, und die verlangt `gruppe.dienstplan.lesen` — ein
     * Leitungsrecht, das `mitarbeiter` nie haelt. Das Ergebnis waere nicht ein
     * Fehler, sondern eine leere Woche.
     */
    const zeilen = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.security], benutzerId: fatimaKonto,
        personId: f.fatima, portal: 'intern', readonly: true },
      async (tx) => tx.unsafe(
        `select count(*)::int as n from einsatz_zuordnung`) as unknown as Promise<
          readonly { n: number }[]>,
    );
    expect(zeilen[0]?.n).toBe(0);
  });

  it('die Kopfzahl summiert BEIDE, die zwei Stundenkonten bleiben getrennt', async () => {
    await beideBeschaeftigungen();

    const fenster = await alsPerson(async (k) => leseStundenFenster(k, {
      heute: '2026-03-31', wochenBeginn: '2026-03-30', monatsBeginn: '2026-03-01',
    }));
    // 4 h Reinigung + 4 h Security = 480 Minuten in EINER Zahl (EMP-15).
    expect(fenster.monatMinuten).toBe(480);
    expect(fenster.jeAnstellung).toHaveLength(2);
    expect(fenster.jeAnstellung.map((a) => a.monatMinuten).sort()).toEqual([240, 240]);

    // Und die Konten: zwei Zeilen, zwei Gesellschaften, eine gerechnete Summe.
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: planerReinigung,
        portal: 'intern', readonly: false },
      async (tx) => eroeffneKonto(planerKontext(tx, f.reinigung, planerReinigung),
        { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3, sollMinuten: 9000 }));
    await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: planerSecurity,
        portal: 'intern', readonly: false },
      async (tx) => eroeffneKonto(planerKontext(tx, f.security, planerSecurity),
        { anstellungId: f.fatimaSecurity, jahr: 2026, monat: 3, sollMinuten: 4800 }));

    const uebersicht = await alsPerson(async (k) => leseStundenkonten(k, 2026, 3));
    expect(uebersicht.konten).toHaveLength(2);
    expect(new Set(uebersicht.konten.map((a) => a.konto.mandantId)).size).toBe(2);
    expect(uebersicht.konten.map((a) => a.konto.sollMinuten).sort((x, y) => x - y))
      .toEqual([4800, 9000]);
    // Die kombinierte Zahl ist GERECHNET und steht neben den Einzelkonten.
    expect(uebersicht.kombiniert?.sollMinuten).toBe(13_800);
    expect(uebersicht.kombiniert?.konten).toHaveLength(2);
    // Keine gespeicherte Gesamtsumme — es gibt kein Konto ohne Anstellung.
    const [fremd] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from stundenkonto where anstellung_id is null`);
    expect(fremd?.n).toBe(0);
  });

  it('„Heute" beantwortet die Frage mit GENAU EINER Schicht', async () => {
    const oR = await objekt(f.reinigung);
    const oS = await objekt(f.security);
    // Zwei kuenftige Schichten; die naechste gewinnt, und sie kennt ihre GmbH.
    const spaet = await einsatz(f.security, oS,
      new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
    const frueh = await einsatz(f.reinigung, oR,
      new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    await zuordnung(f.security, spaet, f.fatimaSecurity, f.fatima);
    await zuordnung(f.reinigung, frueh, f.fatimaReinigung, f.fatima);

    const schicht = await alsPerson(async (k) => laufendeOderNaechsteSchicht(k));
    expect(schicht).not.toBeNull();
    expect(schicht?.mandantSlug).toBe('reinigung');
    expect(schicht?.laeuftJetzt).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('(2) KEIN Bearbeitungsfeld auf einem Zeiteintrag (EMP-07)', () => {
  async function einEintrag(): Promise<string> {
    const o = await objekt(f.reinigung);
    return zeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
      von: '2026-03-05T05:00:00Z', bis: '2026-03-05T13:00:00Z', pause: 30,
      geraetBeginn: '2026-03-05T05:02:00Z', abweichungSek: 120 });
  }

  it('der Dienst des Portals hat ueberhaupt keine Schreibfunktion', async () => {
    const modul = await import('../../src/server/services/mitarbeiter/zeiten.js');
    const schreibend = Object.keys(modul).filter((n) =>
      /^(schreibe|aendere|setze|speichere|korrigiere|loesche|aktualisiere|update)/iu.test(n));
    // Eine Zusage, die sich am Modul selbst pruefen laesst: was es nicht gibt,
    // ruft auch niemand versehentlich auf.
    expect(schreibend).toEqual([]);
  });

  it('das UPDATE scheitert in der DATENBANK, an jedem Dienst vorbei', async () => {
    const id = await einEintrag();
    const betroffen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: fatimaKonto,
        personId: f.fatima, portal: 'mitarbeiter', readonly: false },
      async (tx) => (await tx.unsafe(
        `update zeiteintrag set pause_minuten = 0 where id = $1 returning id`,
        [id] as never[])).length,
    );
    /**
     * `p_ma_kein_update` ist RESTRICTIV: im Mitarbeiterportal trifft kein
     * UPDATE eine Zeile — null betroffene Zeilen, keine Ausnahme. Genau das
     * ist von aussen ununterscheidbar von „gibt es nicht" (AUT-06), und genau
     * deshalb steht daneben der zweite Beleg: der Wert hat sich nicht bewegt.
     */
    expect(betroffen).toBe(0);
    const [danach] = await sql.unsafe<{ pause_minuten: number }[]>(
      `select pause_minuten from zeiteintrag where id = $1`, [id]);
    expect(Number(danach?.pause_minuten)).toBe(30);
  });

  it('und der EINZIGE Weg ist ein `zeit_einwand` — der nichts aendert', async () => {
    const id = await einEintrag();
    const [vorher] = await sql.unsafe<{ abbild: string }[]>(
      `select to_jsonb(z)::text as abbild from zeiteintrag z where z.id = $1`, [id]);

    const einwandId = await alsPersonImMandanten(f.fatimaReinigung, async (k) =>
      reicheEinwandEin(k, {
        anstellungId: f.fatimaReinigung,
        zeiteintragId: id,
        art: 'zeit_falsch',
        betrifftDatum: '2026-03-05',
        behauptetBeginn: new Date('2026-03-05T04:30:00Z'),
        begruendung: 'Ich habe um 05:30 angefangen, nicht um 06:00.',
        eingereichtVonBenutzerId: fatimaKonto,
      }));
    expect(einwandId).toMatch(/^[0-9a-f-]{36}$/u);

    // Der Eintrag steht Byte fuer Byte so da wie vorher — die Behauptung ist
    // eine Behauptung und kein Zeitpunkt (Invariante 5).
    const [nachher] = await sql.unsafe<{ abbild: string }[]>(
      `select to_jsonb(z)::text as abbild from zeiteintrag z where z.id = $1`, [id]);
    expect(nachher?.abbild).toBe(vorher?.abbild);

    // Und die Person sieht ihre eigene Meldung im Portal wieder.
    const eigene = await alsPerson(async (k) => listeEigeneEinwaende(k));
    expect(eigene.map((e) => e.id)).toContain(einwandId);
    expect(eigene[0]?.status).toBe('offen');
  });

  it('ein fremder Eintrag ist fuer diese Anmeldung NICHT VORHANDEN, nicht verboten', async () => {
    const o = await objekt(f.reinigung);
    const fremd = await zeiteintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas, objekt: o,
      von: '2026-03-05T05:00:00Z', bis: '2026-03-05T13:00:00Z' });
    const gefunden = await alsPerson(async (k) => findeEigenenZeiteintrag(k, fremd));
    expect(gefunden).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('(3) Monatsnachweis und Stundenkonto nennen DIESELBE Zahl', () => {
  it('auf die Minute — im abgeschlossenen Monat', async () => {
    const o = await objekt(f.reinigung);
    // Zwei Schichten, eine davon ueber Mitternacht: der Fall, in dem sich
    // zwei Rechnungen unterscheiden wuerden (K-11, §7.4).
    await zeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
      von: '2026-03-05T05:00:00Z', bis: '2026-03-05T13:00:00Z', pause: 45,
      freigebenDurch: planerReinigung });
    await zeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
      von: '2026-03-10T21:00:00Z', bis: '2026-03-11T05:00:00Z', pause: 30,
      freigebenDurch: planerReinigung });

    const abschluss = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: planerReinigung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const k = planerKontext(tx, f.reinigung, planerReinigung);
        await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3,
          sollMinuten: 9000 });
        return schliesseMonatAb(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3 });
      });

    const gelesen = await alsPerson(async (k) => ({
      nachweis: await leseNachweis(k, {
        anstellungId: f.fatimaReinigung, monat: '2026-03-01' }),
      uebersicht: await leseStundenkonten(k, 2026, 3),
    }));

    const konto = gelesen.uebersicht.konten[0];
    expect(konto).toBeDefined();
    // 8 h − 45 min plus 8 h − 30 min = 435 + 450 = 885 Minuten.
    expect(gelesen.nachweis.summeNettoMinuten).toBe(885);
    expect(konto?.konto.istMinuten).toBe(885);
    expect(gelesen.nachweis.summeNettoMinuten).toBe(konto?.konto.istMinuten);
    expect(abschluss.istMinuten).toBe(885);
    // Ein gesperrter Monat wird aus seinem gepraegten Artefakt beantwortet und
    // nicht neu gerechnet (D-152).
    expect(gelesen.nachweis.quelle).toBe('artefakt');
    expect(gelesen.nachweis.hash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

// ---------------------------------------------------------------------------

describe('(4) kein Lohnsatz und nirgends ein Kundenpreis (K-05, EMP-13)', () => {
  it('die Spalte gibt es fuer `cse_app` gar nicht erst', async () => {
    await expect(alsApp(
      { scope: 'person', personId: f.fatima, benutzerId: fatimaKonto, readonly: true },
      async (tx) => tx.unsafe(`select stundensatz_intern from anstellung`),
    )).rejects.toThrow(/permission denied|keine Berechtigung/iu);
  });

  it('und jede Nutzlast des Portals wird FELD FUER FELD geprueft', async () => {
    const o = await objekt(f.reinigung);
    const e = await einsatz(f.reinigung, o, '2026-03-05');
    await zuordnung(f.reinigung, e, f.fatimaReinigung, f.fatima);
    await zeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
      von: '2026-03-05T05:00:00Z', bis: '2026-03-05T13:00:00Z',
      freigebenDurch: planerReinigung });
    const q = await qualifikation();
    await nachweisZeile({ person: f.fatima, qualifikation: q, mandant: f.security,
      ab: '2020-01-01', bis: '2030-01-01' });
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: planerReinigung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const k = planerKontext(tx, f.reinigung, planerReinigung);
        await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3 });
        /**
         * Das Urlaubskonto entsteht OHNE Anspruch — so, wie es ausgeliefert
         * wird (O-18). `anspruchOffen` ist damit wahr, und die Nutzlast traegt
         * trotzdem ihre volle Gestalt; genau das soll geprueft werden.
         */
        return eroeffneUrlaubskonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026 });
      });

    const nutzlast = await alsPerson(async (k) => ({
      anstellung: (await leseEigeneAnstellungen(k))[0],
      schicht: (await listeEigeneSchichten(k, { von: '2026-03-01', bis: '2026-03-31' }))[0],
      stundenFenster: await leseStundenFenster(k, {
        heute: '2026-03-31', wochenBeginn: '2026-03-30', monatsBeginn: '2026-03-01' }),
      kontoAnsicht: (await leseStundenkonten(k, 2026, 3)).konten[0],
      urlaubAnsicht: (await leseUrlaub(k, 2026))[0],
      zeiteintrag: (await listeEigeneZeiten(k, { von: '2026-03-01', bis: '2026-03-31' }))[0],
      nachweislage: await leseEigeneNachweise(k, '2026-03-05', 'de'),
    }));

    /** Erwartete Gestalt je Nutzlast — festgeschrieben im Dienst, nicht hier. */
    const erwartet: readonly (readonly [string, unknown, readonly string[]])[] = [
      ['anstellung', nutzlast.anstellung, ANSTELLUNG_FELDER],
      ['schicht', nutzlast.schicht, SCHICHT_FELDER],
      ['stundenFenster', nutzlast.stundenFenster, STUNDEN_FENSTER_FELDER],
      ['kontoAnsicht', nutzlast.kontoAnsicht, KONTO_ANSICHT_FELDER],
      ['urlaubAnsicht', nutzlast.urlaubAnsicht, URLAUB_ANSICHT_FELDER],
      ['zeiteintrag', nutzlast.zeiteintrag, ZEITEINTRAG_FELDER],
      ['nachweislage', nutzlast.nachweislage, EIGENE_NACHWEISLAGE_FELDER],
    ];

    for (const [name, wert, felder] of erwartet) {
      expect(wert, name).toBeDefined();
      // Die Gestalt ist GENAU die festgeschriebene — ein spaeter angehaengtes
      // Feld faellt hier auf, auch eines mit harmlosem Namen.
      expect(Object.keys(wert as object).sort(), name).toEqual([...felder].sort());
    }
    for (const n of nutzlast.nachweislage.nachweise) {
      expect(Object.keys(n).sort()).toEqual([...EIGENER_NACHWEIS_FELDER].sort());
    }

    /**
     * Und die zweite Probe: kein Feldname, der nach Geld klingt — auch nicht
     * in einem verschachtelten Objekt. Eine Stichprobe nach „stundensatz"
     * faende ein `satz` nicht; dieser Lauf faende es.
     */
    const verdaechtig: string[] = [];
    const gehe = (wert: unknown, pfad: string, tiefe = 0): void => {
      if (tiefe > 4 || wert === null || typeof wert !== 'object') return;
      if (Array.isArray(wert)) {
        for (const [i, v] of wert.entries()) gehe(v, `${pfad}[${String(i)}]`, tiefe + 1);
        return;
      }
      for (const [k, v] of Object.entries(wert)) {
        if (istVerbotenesFeld(k)) verdaechtig.push(`${pfad}.${k}`);
        gehe(v, `${pfad}.${k}`, tiefe + 1);
      }
    };
    gehe(nutzlast, 'nutzlast');
    expect(verdaechtig).toEqual([]);
  });

  it('die Person sieht NUR sich selbst — keine zweite Person im Ergebnis', async () => {
    const gelesen = await alsPerson(async (k) => ({
      person: await leseEigenePerson(k),
      anstellungen: await leseEigeneAnstellungen(k),
    }));
    expect(gelesen.person?.personId).toBe(f.fatima);
    // Jonas arbeitet in derselben Gesellschaft — und taucht nicht auf.
    expect(gelesen.anstellungen).toHaveLength(2);
    expect(gelesen.anstellungen.map((a) => a.anstellungId).sort())
      .toEqual([f.fatimaReinigung, f.fatimaSecurity].sort());
  });
});

// ---------------------------------------------------------------------------

describe('(5) ein abgelaufener Nachweis warnt — aus DERSELBEN Quelle (EMP-08, SEC-04)', () => {
  it('das Tor sperrt, und das Portal warnt — zum selben Stichtag', async () => {
    const q = await qualifikation({ blockiert: true });
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q });
    // Gueltig bis zum 1. Maerz; die Schicht beginnt am 10.
    await nachweisZeile({ person: f.fatima, qualifikation: q, mandant: f.security,
      ab: '2026-01-01', bis: '2026-03-01' });
    const e = await einsatz(f.security, o, '2026-03-10', '22:00', '23:00');

    // Verbraucher 1: das Tor aus PR 31 — es SPERRT die Einteilung.
    const fehler = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: planerSecurity,
        portal: 'intern', readonly: false },
      async (tx) => assertZuordnungZulaessig(
        { unsafe: async (s: string, w: readonly unknown[] = []) =>
          (await tx.unsafe(s, w as never[])) as readonly unknown[] },
        f.fatimaSecurity, e,
      ).then(() => null, (x: unknown) => x));
    expect(fehler).toBeInstanceOf(QualifikationFehlt);
    expect((fehler as QualifikationFehlt).befund.stichtag).toBe('2026-03-10');

    // Verbraucher 2: das Portal — es WARNT die Person, zum selben Stichtag.
    const lage = await alsPerson(async (k) => leseEigeneNachweise(k, '2026-03-10', 'de'));
    const zeile = lage.nachweise.find((n) => n.qualifikationSchluessel !== '');
    expect(zeile?.warnlage).toBe('abgelaufen');
    expect(zeile?.gueltigAmStichtag).toBe(false);
    expect(zeile?.blockiertEinsatz).toBe(true);
    expect(lage.sperrendeAnzahl).toBe(1);
  });

  it('einen Tag VOR dem Ablauf warnt es nicht als abgelaufen — die Grenze', async () => {
    const q = await qualifikation({ blockiert: true, warnstufen: [60, 30, 7] });
    await nachweisZeile({ person: f.fatima, qualifikation: q, mandant: f.security,
      ab: '2026-01-01', bis: '2026-03-10' });

    const amTag = await alsPerson(async (k) => leseEigeneNachweise(k, '2026-03-10', 'de'));
    // Am letzten Gueltigkeitstag deckt er noch — dieselbe Bedingung wie im Tor.
    expect(amTag.nachweise[0]?.gueltigAmStichtag).toBe(true);
    expect(amTag.nachweise[0]?.warnlage).toBe('laeuft_ab');
    expect(amTag.sperrendeAnzahl).toBe(0);

    const tagsDarauf = await alsPerson(async (k) =>
      leseEigeneNachweise(k, '2026-03-11', 'de'));
    expect(tagsDarauf.nachweise[0]?.gueltigAmStichtag).toBe(false);
    expect(tagsDarauf.nachweise[0]?.warnlage).toBe('abgelaufen');
    expect(tagsDarauf.sperrendeAnzahl).toBe(1);
  });

  it('die Warnstufe kommt aus `qualifikation.warnung_tage`, nicht aus einer Zahl hier', async () => {
    const q = await qualifikation({ blockiert: false, warnstufen: [45] });
    await nachweisZeile({ person: f.fatima, qualifikation: q, mandant: f.reinigung,
      ab: '2026-01-01', bis: '2026-04-10' });

    // 40 Tage vorher: die konfigurierte 45er-Stufe ist faellig.
    const nah = await alsPerson(async (k) => leseEigeneNachweise(k, '2026-03-01', 'de'));
    expect(nah.nachweise[0]?.warnlage).toBe('laeuft_ab');
    expect(nah.nachweise[0]?.warnstufeTage).toBe(45);

    // 50 Tage vorher: noch nicht. Eine fest verdrahtete 60 haette hier gewarnt.
    const fern = await alsPerson(async (k) => leseEigeneNachweise(k, '2026-02-19', 'de'));
    expect(fern.nachweise[0]?.warnlage).toBe('gueltig');
    expect(fern.nachweise[0]?.warnstufeTage).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('EMP-10 — die zwei Schreibwege des Menschen ausserhalb der Zeit', () => {
  /** Die Katalogzeile einer Art, ueber die RLS des Menschen gelesen. */
  async function artId(tabelle: 'antragsart' | 'abwesenheitsart', schluessel: string) {
    const [z] = await sql.unsafe<{ id: string }[]>(
      `select id from ${tabelle} where schluessel = $1 and mandant_id is null`,
      [schluessel]);
    return z!.id;
  }

  it('das Formular kennt die Arten — und zeigt die ungeklaerte als ungeklaert (O-139)', async () => {
    const gelesen = await alsPerson(async (k) => ({
      antrag: await leseAntragsarten(k, 'de'),
      abwesenheit: await leseAbwesenheitsarten(k, 'de'),
    }));
    expect(gelesen.antrag.map((a) => a.schluessel).sort())
      .toEqual(['krankmeldung', 'schichttausch', 'urlaub']);
    /**
     * `bezahlt` bleibt im Seed NULL (O-139). Die Art verschwindet deshalb
     * NICHT aus dem Formular — eine fehlende Auswahl erzeugt einen Anruf, eine
     * sichtbar ungeklaerte eine Rueckfrage an der richtigen Stelle.
     */
    const krank = gelesen.abwesenheit.find((a) => a.schluessel === 'krankheit');
    expect(krank).toBeDefined();
    expect(krank?.bezahlt).toBeNull();
  });

  it('ein Antrag entsteht in DER Gesellschaft, deren Beschaeftigung gewaehlt wurde', async () => {
    const urlaub = await artId('antragsart', 'urlaub');
    const ferien = await artId('abwesenheitsart', 'urlaub');

    // Derselbe Mensch, dieselbe Anmeldung — aber der Antrag gehoert der
    // Security, weil ihre Beschaeftigung gewaehlt wurde (D-09).
    const antrag = await alsPersonImMandanten(f.fatimaSecurity, async (k) =>
      reicheAntragEin(k, {
        anstellungId: f.fatimaSecurity,
        antragsartId: urlaub,
        abwesenheitsartId: ferien,
        vonDatum: '2026-07-06',
        bisDatum: '2026-07-17',
        nachricht: 'Sommerurlaub',
      }));
    expect(antrag.anstellungId).toBe(f.fatimaSecurity);

    const [zeile] = await sql.unsafe<{ mandant_id: string }[]>(
      `select mandant_id from antrag where id = $1`, [antrag.id]);
    expect(zeile?.mandant_id).toBe(f.security);

    // Und das Portal zeigt ihn mit seiner Gesellschaft beschriftet.
    const sicht = await alsPerson(async (k) => {
      const anstellungen = await leseEigeneAnstellungen(k);
      return listeEigeneAntraege(k, anstellungen);
    });
    const gefunden = sicht.find((a) => a.antrag.id === antrag.id);
    expect(gefunden?.mandantSlug).toBe('security');
    expect(gefunden?.zurueckziehbar).toBe(true);
  });

  it('eine Abwesenheitsmeldung entsteht — und ohne geklaerte Lohnwirkung nicht', async () => {
    const krank = await artId('abwesenheitsart', 'krankheit');

    // O-139: der Dienst verweigert, solange `bezahlt` NULL ist, und nennt den
    // Grund. Das ist die ausgelieferte Lage.
    await expect(alsPersonImMandanten(f.fatimaReinigung, async (k) =>
      meldeAbwesenheit(k, {
        anstellungId: f.fatimaReinigung, abwesenheitsartId: krank,
        von: '2026-03-02', bis: '2026-03-04',
      }))).rejects.toThrow(ArtUngeklaertFehler);

    // Mit beantworteter Frage geht derselbe Weg durch.
    await sql.unsafe(
      `update abwesenheitsart set bezahlt = true where id = $1`, [krank]);
    const gemeldet = await alsPersonImMandanten(f.fatimaReinigung, async (k) =>
      meldeAbwesenheit(k, {
        anstellungId: f.fatimaReinigung, abwesenheitsartId: krank,
        von: '2026-03-02', bis: '2026-03-04',
      }));
    // Eine MELDUNG, kein Antrag: sie wird zur Kenntnis genommen.
    expect(gemeldet.status).toBe('erfasst');

    const sicht = await alsPerson(async (k) => {
      const anstellungen = await leseEigeneAnstellungen(k);
      return listeEigeneAbwesenheiten(k, anstellungen);
    });
    const gefunden = sicht.find((a) => a.abwesenheit.id === gemeldet.id);
    expect(gefunden?.mandantSlug).toBe('reinigung');
    /**
     * Und der GRUND steht nirgends in der Antwort: `abwesenheitsart_id`,
     * `au_*`, `dokument_id` und `bemerkung` gibt `abwesenheit` der
     * Anwendungsrolle gar nicht erst zu lesen (0073, Art. 9 DSGVO) — auch
     * nicht fuer die eigene Zeile.
     */
    expect(Object.keys(gefunden?.abwesenheit ?? {}))
      .not.toContain('abwesenheitsartId');
    expect(JSON.stringify(gefunden)).not.toContain('bemerkung');
  });

  it('eine FREMDE Beschaeftigung fuehrt zu 404 und nicht zu einem fremden Antrag', async () => {
    const urlaub = await artId('antragsart', 'urlaub');
    // Jonas' Beschaeftigung, aus Fatimas Anmeldung: die Personen-RLS liefert
    // null Zeilen, `mandantDerAnstellung` wirft 404 (AUT-06).
    await expect(alsPersonImMandanten(f.jonasReinigung, async (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung, antragsartId: urlaub,
        vonDatum: '2026-07-06', bisDatum: '2026-07-17',
      }))).rejects.toMatchObject({ status: 404 });
  });
});
