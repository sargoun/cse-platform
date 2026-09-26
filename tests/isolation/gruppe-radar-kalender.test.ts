/**
 * `/portal/gruppe/radar` und `/portal/gruppe/kalender` gegen die echte Policy
 * (TEN-05, Invariante 10, CAL-01, RAD-07).
 *
 * Drei Zusagen, die kein Kerntest zeigen kann:
 *
 *  1. **Die Gruppenansicht ist NUR LESEND.** `gruppenRadar` und
 *     `gruppenKalenderZeilen` nehmen einen `LeseKontext` — ein Schreibversuch
 *     wäre ein Compilerfehler. Die zweite Linie steht trotzdem: dieselbe
 *     Sitzung kann in dieser Ansicht nichts einfügen, auch nicht an den
 *     Diensten vorbei.
 *  2. **Sie zeigt keinen Personenbezug, wo die Mandantengrenze ihn schützt.**
 *     Seit 0370 trägt jeder Bewerbertisch `p_gruppe_kein_personenbezug`. Eine
 *     Gruppensitzung mit JEDEM `gruppe.*`-Recht liest dort null Zeilen — und
 *     der Kalender fragt sie gar nicht erst.
 *  3. **Und sie rechnet je Bereich mit dem Recht DIESES Bereichs** (K-03):
 *     eine Leitung, die den Radar nur in der Reinigung lesen darf, sieht die
 *     Bewertung der Security nicht — und bekommt dort einen Strich und keine
 *     Null.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { withGroupScope, type Sitzung } from '../../src/server/kontext/index.js';
import { gruppenRadar, RADAR_RECHT } from '../../src/server/services/gruppe/radar.js';
import {
  gruppenKalenderZeilen, gruppenPersonen, gruppenTeams, quellenRechte,
  PERSONENFILTER_RECHT, QUELLEN_RECHT,
} from '../../src/server/services/gruppe/kalender.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

const OPTIONEN = { knappTage: 5 } as const;

/** Die sechs Gruppenrechte, die diese beiden Seiten überhaupt brauchen. */
const GRUPPENRECHTE = [
  RADAR_RECHT, PERSONENFILTER_RECHT,
  ...new Set(Object.values(QUELLEN_RECHT)),
] as const;

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function mitglied(b: string, m: string, rolle = 'leitung'): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)]);
}

/** Ein Recht für eine Rolle in GENAU EINEM Bereich (0008, Zweig 5). */
async function gewaehre(recht: string, mandantId: string, rolle = 'leitung'): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, gewaehrt, mandant_id)
     select $1, b.id, true, $3 from berechtigung b where b.schluessel = $2
     on conflict do nothing`,
    [await rolleId(rolle), recht, mandantId]);
}

function gruppe(benutzerId: string): Sitzung {
  return {
    benutzerId, personId: null, aktiverMandantId: null, ansicht: 'gruppe',
    aal: 'aal2', portal: 'intern', sitzungId: '00000000-0000-0000-0000-000000000042',
  };
}

async function imGruppenScope<T>(
  benutzerId: string, fn: Parameters<typeof withGroupScope<T>>[2],
): Promise<T> {
  return sql.begin((tx) => withGroupScope(tx as never, gruppe(benutzerId), fn)) as Promise<T>;
}

/* ------------------------------------------------------------------------- *
 * Daten, die es in der Fixtur nicht gibt
 * ------------------------------------------------------------------------- */

async function objektMit(mandant: string): Promise<{ objekt: string; kunde: string }> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Gruppenkalender-Testkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Objekt ' || $3, 'Teststr. 1', '10115', 'Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  return { objekt: o!.id, kunde: k!.id };
}

/** Eine Schicht HEUTE, 06:00–12:00 Berliner Zeit — mit Besetzung. */
async function schicht(
  mandant: string, anstellung: string | null, person: string | null,
): Promise<string> {
  const { objekt, kunde } = await objektMit(mandant);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, soll_besetzung, min_besetzung,
                          erstellt_von_art, status)
     values ($1, 'manuell', $2, app.berlin_heute(),
             (select zeitpunkt from app.loese_ortszeit(app.berlin_heute(), '06:00', 'Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit(app.berlin_heute(), '12:00', 'Europe/Berlin')),
             'Europe/Berlin', '06:00', '12:00', false,
             $3, $4, 1, 1, 'system', 'geplant')
     returning id`,
    [mandant, `grp:${zufall()}`, objekt, kunde]);
  if (anstellung !== null && person !== null) {
    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      beginn_zeitpunkt, ende_zeitpunkt, status, erstellt_von_art)
       select $1, e.id, $2, $3, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'geplant', 'system'
         from einsatz e where e.id = $4`,
      [mandant, anstellung, person, e!.id]);
  }
  return e!.id;
}

async function termin(mandant: string, titel: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kalender_eintrag (mandant_id, titel, beginn, ende)
     values ($1, $2,
             (select zeitpunkt from app.loese_ortszeit(app.berlin_heute(), '09:00', 'Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit(app.berlin_heute(), '10:00', 'Europe/Berlin')))
     returning id`, [mandant, titel]);
  return k!.id;
}

/** Eine Bekanntmachung (ohne Mandant) — die öffentliche Tatsache. */
async function bekanntmachung(titel: string, tageBisFrist: number): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ausschreibung (quelle, quell_id, titel, rohdaten_hash, quell_status,
                                vergabestelle_name, vergabestelle_ort, cpv_haupt,
                                wert_geschaetzt_cent, waehrung, frist_angebot)
     values ('oeffentlichevergabe', $1, $2, $1, 'aktiv',
             'Bezirksamt Mitte', 'Berlin', '90911200', 250000000, 'EUR',
             now() + make_interval(days => $3::int))
     returning id`, [`demo-${zufall()}`, titel, tageBisFrist]);
  return a!.id;
}

/** Ein Suchprofil plus eine Bewertung dieser Gesellschaft. */
async function bewerte(
  mandant: string, ausschreibung: string, punkte: number, skala = 20,
): Promise<void> {
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into radar_profil (mandant_id, name, ist_aktiv, ist_platzhalter, skala_max)
     values ($1, $2, true, true, $3) returning id`,
    [mandant, `Profil ${zufall()}`, skala]);
  await sql.unsafe(
    `insert into bewertung (mandant_id, ausschreibung_id, radar_profil_id, regel_version,
                            profil_version, punkte, skala_max, begruendung, eingaben_hash)
     values ($1,$2,$3,'v1',1,$4,$5,'Demobewertung', $6)`,
    [mandant, ausschreibung, p!.id, punkte, skala, zufall()]);
}

async function vorgang(
  mandant: string, ausschreibung: string, status: string,
): Promise<void> {
  await sql.unsafe(
    `insert into ausschreibung_vorgang (mandant_id, ausschreibung_id, status, erstellt_von_art)
     values ($1,$2,$3::ausschreibung_status,'mensch')`, [mandant, ausschreibung, status]);
}

/** Eine Bewerbung — der Personenbezug, den die Gruppenansicht nicht sehen darf. */
async function bewerbung(mandant: string, name: string): Promise<string> {
  const [b] = await sql.unsafe<{ id: string }[]>(
    /*
      * `quelle = 'initiativ'` und damit ohne `stelle_id`:
      * `bewerbung_quelle_und_stelle` (0472, vorher `bewerbung_initiativ_ohne_stelle`)
      * verlangt fuer `initiativ` genau dieses Paar, und eine Stelle anzulegen
      * hiesse, fuer diesen Test zwei Dinge zu pruefen.
      */
    `insert into bewerbung (mandant_id, name, email, quelle, aufbewahrung_bis)
     values ($1, $2, $3, 'initiativ', current_date + 180) returning id`,
    [mandant, name, `${zufall()}@bewerber.test`]);
  return b!.id;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

/* ========================================================================= *
 * (1) Invariante 10 — nur lesend
 * ========================================================================= */

describe('Invariante 10 — auf beiden Seiten führt kein Schreibpfad', () => {
  it('der Kalender liest, und dieselbe Sitzung kann keinen Termin anlegen', async () => {
    const chef = await konto(`nurlesen-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    for (const recht of GRUPPENRECHTE) await gewaehre(recht, f.reinigung);
    await termin(f.reinigung, 'Bauberatung');

    const zeilen = await imGruppenScope(chef, async (k) =>
      gruppenKalenderZeilen(k, {
        von: '2020-01-01', bis: '2099-12-31', mandantIds: k.mandantIds, nurQuellen: ['termin'],
      }));
    expect(zeilen.length).toBeGreaterThan(0);

    await expect(imGruppenScope(chef, async (k) => k.abfrage(
      `insert into kalender_eintrag (mandant_id, titel, beginn, ende)
       values ($1,'Heimlich', now(), now() + interval '1 hour')`, [f.reinigung],
    ))).rejects.toThrow(/KeinAktiverMandant|row-level security|readonly|read-only/iu);
  });

  it('und auch keinen Vorgangsstand setzen', async () => {
    const chef = await konto(`radar-nurlesen-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre(RADAR_RECHT, f.reinigung);
    const a = await bekanntmachung('Unterhaltsreinigung Rathaus', 12);
    await bewerte(f.reinigung, a, 18);

    await expect(imGruppenScope(chef, async (k) => k.abfrage(
      `insert into ausschreibung_vorgang (mandant_id, ausschreibung_id, status, erstellt_von_art)
       values ($1,$2,'geprueft','mensch')`, [f.reinigung, a],
    ))).rejects.toThrow(/KeinAktiverMandant|row-level security|readonly|read-only/iu);
  });
});

/* ========================================================================= *
 * (2) p_gruppe_kein_personenbezug (0370)
 * ========================================================================= */

describe('p_gruppe_kein_personenbezug — die Bewerbertische in der Gruppenansicht', () => {
  /**
   * Der Befund, den 0370 behebt: `t_bewerbung_gruppe` gab einer
   * Gruppensitzung mit `gruppe.recruiting.lesen` die vollen Bewerbungszeilen
   * der Schwestergesellschaften — Name, E-Mail, Anschreiben.
   */
  it('mit JEDEM Gruppenrecht sind es null Zeilen — auf allen sechs Tischen', async () => {
    const chef = await konto(`bewerber-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await bewerbung(f.reinigung, 'Fatima Bewerberin');
    await bewerbung(f.security, 'Jonas Bewerber');

    // Jedes `gruppe.*`-Recht, das der Katalog kennt — die Decke haengt an
    // keinem davon.
    const alle = await sql.unsafe<{ schluessel: string }[]>(
      `select schluessel from berechtigung where schluessel like 'gruppe.%'`);
    for (const r of alle) {
      await gewaehre(r.schluessel, f.reinigung);
      await gewaehre(r.schluessel, f.security);
    }

    const zaehle = async (tabelle: string): Promise<number> => imGruppenScope(chef, async (k) => {
      const [z] = await k.abfrage<{ n: string }>(`select count(*) n from ${tabelle}`);
      return Number(z!.n);
    });

    for (const tabelle of ['bewerbung', 'kandidat', 'bewerbung_bewertung',
      'einstellungsentscheidung', 'gespraech', 'bewerbung_antwort']) {
      expect(await zaehle(tabelle), `${tabelle} ist in der Gruppenansicht sichtbar`).toBe(0);
    }
  });

  it('im Bereich liest dieselbe Rolle weiter — die Decke bricht das Recruiting nicht', async () => {
    const chef = await konto(`bewerber-mandant-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await gewaehre('recruiting.bewerbung_lesen', f.reinigung);
    await bewerbung(f.reinigung, 'Fatima Bewerberin');

    const anzahl = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef, portal: 'intern' },
      async (tx) => {
        const [z] = await tx.unsafe<{ n: string }[]>(`select count(*) n from bewerbung`);
        return Number(z!.n);
      });
    expect(anzahl).toBe(1);
  });

  it('die permissive Gruppenpolicy auf `bewerbung` ist fort', async () => {
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from pg_policies
        where tablename = 'bewerbung' and policyname = 't_bewerbung_gruppe'`);
    expect(Number(z!.n)).toBe(0);
  });

  it('und die restriktive Decke steht auf allen sechs', async () => {
    const zeilen = await sql.unsafe<{ tablename: string }[]>(
      `select tablename from pg_policies
        where policyname = 'p_gruppe_kein_personenbezug' and permissive = 'RESTRICTIVE'
        order by tablename`);
    const tische = zeilen.map((z) => z.tablename);
    for (const t of ['bewerbung', 'bewerbung_antwort', 'bewerbung_bewertung',
      'einstellungsentscheidung', 'gespraech', 'kandidat']) {
      expect(tische, `${t} ohne Gruppendecke`).toContain(t);
    }
  });
});

/* ========================================================================= *
 * (3) Der Gruppenkalender
 * ========================================================================= */

describe('der Gruppenkalender', () => {
  const FENSTER = { von: '2020-01-01', bis: '2099-12-31' } as const;

  it('führt Termine und Schichten mehrerer Gesellschaften zusammen — mit ihrer Marke', async () => {
    const chef = await konto(`kalender-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    for (const m of [f.reinigung, f.security]) {
      for (const recht of GRUPPENRECHTE) await gewaehre(recht, m);
    }
    await termin(f.reinigung, 'Objektbegehung');
    await schicht(f.security, f.fatimaSecurity, f.fatima);

    const zeilen = await imGruppenScope(chef, async (k) =>
      gruppenKalenderZeilen(k, { ...FENSTER, mandantIds: k.mandantIds }));

    const quellen = new Set(zeilen.map((z) => z.quelle));
    expect(quellen.has('termin')).toBe(true);
    expect(quellen.has('einsatz')).toBe(true);
    // Jede Zeile weiss, zu welcher Gesellschaft sie gehoert.
    expect(zeilen.every((z) => z.bereichSlug !== '' && z.mandantId !== '')).toBe(true);
    const slugs = new Set(zeilen.map((z) => z.bereichSlug));
    expect([...slugs].sort()).toEqual(['reinigung', 'security']);
  });

  it('der Weg führt in die GESELLSCHAFT der Zeile, nicht in eine feste', async () => {
    const chef = await konto(`weg-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    for (const m of [f.reinigung, f.security]) await gewaehre('gruppe.kalender.lesen', m);
    await termin(f.security, 'Wachdienstbesprechung');

    const zeilen = await imGruppenScope(chef, async (k) =>
      gruppenKalenderZeilen(k, { ...FENSTER, mandantIds: k.mandantIds, nurQuellen: ['termin'] }));
    const eintrag = zeilen.find((z) => z.titel === 'Wachdienstbesprechung');
    expect(eintrag?.weg).toMatch(/^\/portal\/security\/kalender\//u);
  });

  it('ohne `gruppe.dienstplan.lesen` in einem Bereich fehlen dessen Schichten — und die Legende sagt es', async () => {
    const chef = await konto(`luecke-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre('gruppe.dienstplan.lesen', f.reinigung);
    await gewaehre('gruppe.kalender.lesen', f.reinigung);
    await gewaehre('gruppe.kalender.lesen', f.security);
    await schicht(f.reinigung, f.fatimaReinigung, f.fatima);
    await schicht(f.security, f.fatimaSecurity, f.fatima);

    const { zeilen, rechte } = await imGruppenScope(chef, async (k) => ({
      zeilen: await gruppenKalenderZeilen(k, {
        ...FENSTER, mandantIds: k.mandantIds, nurQuellen: ['einsatz'],
      }),
      rechte: await quellenRechte(k),
    }));

    expect(zeilen.map((z) => z.bereichSlug)).toEqual(['reinigung']);
    expect(rechte.get(f.reinigung)?.has('gruppe.dienstplan.lesen')).toBe(true);
    // Die Legende unterscheidet „nichts geplant" von „darf ich nicht sehen".
    expect(rechte.get(f.security)?.has('gruppe.dienstplan.lesen')).toBe(false);
  });

  it('nie eine Zeile aus `gespraech` — auch nicht mit `gruppe.recruiting.lesen`', async () => {
    const chef = await konto(`kein-gespraech-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    for (const m of [f.reinigung, f.security]) {
      for (const recht of [...GRUPPENRECHTE, 'gruppe.recruiting.lesen']) {
        await gewaehre(recht, m);
      }
    }
    const b = await bewerbung(f.reinigung, 'Fatima Bewerberin');
    await sql.unsafe(
      `insert into gespraech (mandant_id, bewerbung_id, termin, dauer_minuten)
       values ($1, $2, now() + interval '2 hours', 60)`, [f.reinigung, b]);

    const zeilen = await imGruppenScope(chef, async (k) =>
      gruppenKalenderZeilen(k, { ...FENSTER, mandantIds: k.mandantIds }));
    expect(zeilen.some((z) => (z.quelle as string) === 'gespraech')).toBe(false);
    expect(zeilen.some((z) => z.titel.includes('Fatima Bewerberin'))).toBe(false);
  });

  it('der Personenfilter zeigt die Schichten EINES Menschen über zwei Gesellschaften (D-09)', async () => {
    const chef = await konto(`personenfilter-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    for (const m of [f.reinigung, f.security]) {
      for (const recht of GRUPPENRECHTE) await gewaehre(recht, m);
    }
    await schicht(f.reinigung, f.fatimaReinigung, f.fatima);
    await schicht(f.security, f.fatimaSecurity, f.fatima);
    await schicht(f.reinigung, f.jonasReinigung, f.jonas);

    const { fatima, jonas } = await imGruppenScope(chef, async (k) => ({
      fatima: await gruppenKalenderZeilen(k, {
        ...FENSTER, mandantIds: k.mandantIds, nurPersonId: f.fatima,
      }),
      jonas: await gruppenKalenderZeilen(k, {
        ...FENSTER, mandantIds: k.mandantIds, nurPersonId: f.jonas,
      }),
    }));

    expect([...new Set(fatima.map((z) => z.bereichSlug))].sort())
      .toEqual(['reinigung', 'security']);
    expect(fatima).toHaveLength(2);
    // Jonas fährt nur für die Reinigung — und seine Schicht ist nicht ihre.
    expect(jonas).toHaveLength(1);
    expect(jonas[0]?.bereichSlug).toBe('reinigung');
  });

  it('eine Schicht mit drei Menschen bleibt EINE Zeile', async () => {
    const chef = await konto(`eine-zeile-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    for (const m of [f.reinigung, f.security]) await gewaehre('gruppe.dienstplan.lesen', m);
    const e = await schicht(f.reinigung, f.fatimaReinigung, f.fatima);
    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      beginn_zeitpunkt, ende_zeitpunkt, status, erstellt_von_art)
       select $1, e.id, $2, $3, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'geplant', 'system'
         from einsatz e where e.id = $4`,
      [f.reinigung, f.jonasReinigung, f.jonas, e]);

    const zeilen = await imGruppenScope(chef, async (k) =>
      gruppenKalenderZeilen(k, { ...FENSTER, mandantIds: k.mandantIds, nurQuellen: ['einsatz'] }));
    expect(zeilen.filter((z) => z.id === e)).toHaveLength(1);
  });

  it('`gruppenPersonen` gibt nur Menschen der Bereiche mit `gruppe.personal.lesen`', async () => {
    const chef = await konto(`personenliste-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre(PERSONENFILTER_RECHT, f.reinigung);

    const personen = await imGruppenScope(chef, async (k) =>
      gruppenPersonen(k, k.mandantIds));
    // Fatima ist in beiden beschaeftigt; sichtbar ist sie ueber die Reinigung.
    expect(personen.every((p) => p.bereiche.includes('reinigung'))).toBe(true);
    expect(personen.map((p) => p.id)).toContain(f.fatima);
  });

  it('ohne `gruppe.personal.lesen` gibt es KEINE Personenliste — also keinen Filter', async () => {
    const chef = await konto(`ohne-personal-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre('gruppe.kalender.lesen', f.reinigung);

    const personen = await imGruppenScope(chef, async (k) =>
      gruppenPersonen(k, k.mandantIds));
    expect(personen).toEqual([]);
  });

  it('`gruppenTeams` folgt `gruppe.kalender.lesen` je Bereich', async () => {
    const chef = await konto(`teams-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre('gruppe.kalender.lesen', f.reinigung);
    await sql.unsafe(
      `insert into team (mandant_id, name) values ($1,'Nordteam'), ($2,'Wachteam')`,
      [f.reinigung, f.security]);

    const teams = await imGruppenScope(chef, async (k) => gruppenTeams(k, k.mandantIds));
    expect(teams.map((t) => t.name)).toEqual(['Nordteam']);
  });
});

/* ========================================================================= *
 * (4) Der Gruppenradar
 * ========================================================================= */

describe('der Gruppenradar', () => {
  it('stellt die Bewertungen zweier Gesellschaften nebeneinander — EINE Zeile', async () => {
    const chef = await konto(`radar-matrix-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre(RADAR_RECHT, f.reinigung);
    await gewaehre(RADAR_RECHT, f.security);

    const a = await bekanntmachung('Objektbetreuung Rathaus', 12);
    await bewerte(f.reinigung, a, 18);
    await bewerte(f.security, a, 9);

    const radar = await imGruppenScope(chef, async (k) =>
      gruppenRadar(k, { ...OPTIONEN, mandantIds: k.mandantIds }));

    const zeile = radar.zeilen.find((z) => z.ausschreibungId === a);
    expect(zeile).toBeDefined();
    expect(zeile!.zellen.filter((c) => c.punkte !== null)
      .map((c) => c.punkte as number).sort((x, y) => x - y))
      .toEqual([9, 18]);
    expect(zeile!.mehrfach).toBe(true);
    expect(radar.summe.mehrfach).toBeGreaterThanOrEqual(1);
  });

  it('ohne Recht in einem Bereich: dort ein Strich, und die fremde Punktzahl kommt gar nicht erst', async () => {
    const chef = await konto(`radar-teilrecht-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre(RADAR_RECHT, f.reinigung);

    const a = await bekanntmachung('Unterhaltsreinigung Schule', 3);
    await bewerte(f.reinigung, a, 17);
    await bewerte(f.security, a, 20);

    const radar = await imGruppenScope(chef, async (k) =>
      gruppenRadar(k, { ...OPTIONEN, mandantIds: k.mandantIds }));

    const reinigung = radar.bereiche.find((b) => b.slug === 'reinigung');
    const security = radar.bereiche.find((b) => b.slug === 'security');
    expect(reinigung?.bewertet).toBeGreaterThanOrEqual(1);
    // Nicht 0 — ein Strich. Der Unterschied ist die ganze Zusage.
    expect(security?.bewertet).toBeNull();
    expect(radar.summe.bereiche).toBe(1);

    const zeile = radar.zeilen.find((z) => z.ausschreibungId === a);
    const securityZelle = zeile?.zellen.find((c) => c.slug === 'security');
    expect(securityZelle?.sichtbar).toBe(false);
    expect(securityZelle?.punkte).toBeNull();
    expect(zeile?.imBlick).toEqual(['reinigung']);
  });

  it('die knappe Frist zählt aus der DATENBANK, nicht aus der Uhr des Servers', async () => {
    const chef = await konto(`radar-frist-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre(RADAR_RECHT, f.reinigung);

    const knapp = await bekanntmachung('Frist in drei Tagen', 3);
    const weit = await bekanntmachung('Frist in dreissig Tagen', 30);
    await bewerte(f.reinigung, knapp, 15);
    await bewerte(f.reinigung, weit, 15);

    const radar = await imGruppenScope(chef, async (k) =>
      gruppenRadar(k, { ...OPTIONEN, mandantIds: k.mandantIds }));

    expect(radar.summe.knapp).toBe(1);
    const z = radar.zeilen.find((r) => r.ausschreibungId === knapp);
    expect(z?.restTage).toBeLessThan(5);
    expect(radar.zeilen.find((r) => r.ausschreibungId === weit)?.restTage)
      .toBeGreaterThanOrEqual(5);
  });

  it('ein Vorgang OHNE Bewertung steht trotzdem in der Liste', async () => {
    const chef = await konto(`radar-vorgang-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre(RADAR_RECHT, f.reinigung);

    const a = await bekanntmachung('Nur ein Vorgang', 20);
    /*
      * `geprueft` und nicht `in_bearbeitung`: der Trigger aus 0147 verlangt
      * fuer den zweiten Stand eine Vergabemappe — eine Regel des Radars, die
      * hier nichts zur Sache tut.
      */
    await vorgang(f.reinigung, a, 'geprueft');

    const radar = await imGruppenScope(chef, async (k) =>
      gruppenRadar(k, { ...OPTIONEN, mandantIds: k.mandantIds }));
    const zeile = radar.zeilen.find((z) => z.ausschreibungId === a);
    expect(zeile).toBeDefined();
    expect(zeile!.zellen.find((c) => c.slug === 'reinigung')?.vorgangStatus)
      .toBe('geprueft');
  });

  it('abgelaufene Fristen erscheinen erst auf Verlangen', async () => {
    const chef = await konto(`radar-abgelaufen-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);
    await gewaehre(RADAR_RECHT, f.reinigung);

    const alt = await bekanntmachung('Frist vorbei', -4);
    await bewerte(f.reinigung, alt, 19);

    const ohne = await imGruppenScope(chef, async (k) =>
      gruppenRadar(k, { ...OPTIONEN, mandantIds: k.mandantIds }));
    expect(ohne.zeilen.some((z) => z.ausschreibungId === alt)).toBe(false);

    const mit = await imGruppenScope(chef, async (k) =>
      gruppenRadar(k, { ...OPTIONEN, mandantIds: k.mandantIds, auchAbgelaufene: true }));
    expect(mit.zeilen.some((z) => z.ausschreibungId === alt)).toBe(true);
  });

  it('ohne jedes Gruppenrecht ist die Bekanntmachung selbst unsichtbar (0146)', async () => {
    const chef = await konto(`radar-ohne-${zufall()}@cse.test`);
    await mitglied(chef, f.reinigung);
    await mitglied(chef, f.security);

    const a = await bekanntmachung('Unsichtbar ohne Recht', 10);
    await bewerte(f.reinigung, a, 12);

    const radar = await imGruppenScope(chef, async (k) =>
      gruppenRadar(k, { ...OPTIONEN, mandantIds: k.mandantIds }));
    expect(radar.zeilen).toEqual([]);
    expect(radar.summe.bereiche).toBe(0);
    expect(radar.bereiche.every((b) => b.bewertet === null)).toBe(true);
  });
});
