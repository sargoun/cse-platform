/**
 * Die Zahl und die Liste, auf die sie führt — an echten Zeilen, als `cse_app`
 * (V-149, V-150, DSH-01, DSH-04, D-643, D-644).
 *
 * `kennzahlen.test.ts` prüft jede Kachel gegen ihre EIGENE Zeilenabfrage aus
 * dem Register. Das beweist nicht, dass die Seite hinter dem Link dieselbe
 * Menge zeigt — die Seite hat ihre eigene Abfrage. Genau dort lagen die
 * Befunde: die Kachel „Aktivität (7 Tage)" führte auf die Kundenliste, und
 * eine Projektliste mit innerem Kunden-Join verlöre ein Projekt, das die
 * Kachel zählt. Diese Datei stellt deshalb die LISTEN-Dienste neben die
 * Kacheln und die Gruppenübersicht:
 *
 *  (1) `leseAktivitaeten` zeigt genau so viele Zeilen, wie `letzte_aktivitaet`
 *      zählt — und keine ältere.
 *  (2) `listeProjekte({ status: 'in_arbeit' })` zeigt genau die Projekte, die
 *      `projekte_in_arbeit` zählt — auch wenn der Kunde nicht lesbar ist.
 *  (3) Die Gruppenübersicht zählt Projekte, „im Einsatz" und offene Aufgaben
 *      je Bereich so, wie `gruppeImEinsatz` und `gruppenAufgaben` sie listen —
 *      und ohne Recht steht `null`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { withGroupScope, type LeseKontext, type Sitzung } from '../../src/server/kontext/index.js';
import { leereKacheln, type Kachel } from '../../src/server/registry/kennzahlen.js';
import { registriereBerichtKacheln } from '../../src/server/services/bericht/kacheln.js';
import { kachelWert } from '../../src/server/services/bericht/dashboard.js';
import { leseAktivitaeten } from '../../src/server/services/crm/verlauf.js';
import { listeProjekte } from '../../src/server/services/bau/lv.js';
import { gruppeImEinsatz } from '../../src/server/services/gruppe/auslastung.js';
import { gruppenUebersicht } from '../../src/server/services/gruppe/uebersicht.js';
import { gruppenAufgaben } from '../../src/server/services/gruppe/aufgaben.js';

let f: Fixtur;
let alle: readonly Kachel[] = [];
/** `auftrag.verantwortlich_benutzer_id` ist Pflicht — ein Konto dafür. */
let verantwortlich = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function kachel(schluessel: string): Kachel {
  const k = alle.find((x) => x.schluessel === schluessel);
  if (k === undefined) throw new Error(`Kachel ${schluessel} fehlt im Register.`);
  return k;
}

async function konto(praefix: string, superAdmin = false): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  if (superAdmin) {
    // AUT-02: ein Konto mit globaler Rolle wird erst mit zweitem Faktor aktiv.
    await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  }
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, $2, 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null
                and $3::boolean))`,
    [u!.id, email, superAdmin]);
  return u!.id;
}

/**
 * Ein Konto mit GENAU diesen Rechten in einem Bereich — eine eigene Rolle.
 * `gueltig_ab` auf gestern: siehe `bau-seiten-abfragen.test.ts` (Berliner
 * Kalendertag gegen `current_date` zwischen 22 und 24 Uhr UTC).
 */
async function mitRechten(mandant: string, rechte: readonly string[]): Promise<string> {
  const benutzer = await konto('kachel-liste');
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [mandant, `kachel_liste_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, mandant, [...rechte]]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1, $2, $3, current_date - 1)`, [benutzer, mandant, r!.id]);
  return benutzer;
}

function kontextAus(tx: postgres.TransactionSql, benutzerId: string, mandantId: string): LeseKontext {
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: async <T,>(q: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(q, w as never[])) as unknown as readonly T[],
  };
}

function alsBereich<T>(
  benutzerId: string, mandantId: string, fn: (k: LeseKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: true },
    (tx) => fn(kontextAus(tx, benutzerId, mandantId)));
}

function gruppe(benutzerId: string): Sitzung {
  return {
    benutzerId, personId: null, aktiverMandantId: null, ansicht: 'gruppe',
    aal: 'aal2', portal: 'intern', sitzungId: '00000000-0000-0000-0000-000000000003',
  };
}

async function kunde(mandant: string, name: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, $3) returning id`,
    [mandant, `K-${zufall()}`, name]);
  return k!.id;
}

/** Ein Bauprojekt in einem Stand — mit Auftrag, weil `projekt` einen verlangt. */
async function projekt(
  mandant: string, kundeId: string, status: string, archiviert = false,
): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1, $2, $3, 'projekt', 'aktiv', 'Dachgeschossausbau', $4, '2026-01-01')
     returning id`,
    [mandant, `AU-${zufall()}`, kundeId, verantwortlich]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, status, auftragssumme_netto_cent,
                          sicherheitseinbehalt_bp, archiviert_am, archiviert_von)
     values ($1, $2, $3, 'Dachgeschossausbau', $4, 'ausbau', 'vob_b', $5::projekt_status,
             4200000, 500, case when $6::boolean then now() end,
             case when $6::boolean then $7::uuid end) returning id`,
    [mandant, a!.id, `P-${zufall()}`, kundeId, status, archiviert, verantwortlich]);
  return p!.id;
}

/** Ein offener Zeiteintrag — jemand ist JETZT eingestempelt (`zeiteintrag_offen`). */
async function eingestempelt(mandant: string, anstellung: string, person: string): Promise<void> {
  const k = await kunde(mandant, 'Bezirksamt Mitte');
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Bürohaus Mitte', 'Teststr. 7', '10115', 'Berlin') returning id`,
    [mandant, k, `O-${zufall()}`]);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, objekt_id, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                          erstellt_von_art)
     values ($1, 'manuell', $2, (now() - interval '3 hours')::date,
             now() - interval '3 hours', now() + interval '1 hour',
             '08:00', '12:00', 'system') returning id`,
    [mandant, o!.id]);
  await sql.unsafe(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, einsatz_id, objekt_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art)
     values ($1, $2, $3, $4, $5, now() - interval '2 hours', null, 0,
             'import', null, 'import', null, 'laufend', 'system')`,
    [mandant, anstellung, person, e!.id, o!.id]);
}

beforeEach(async () => {
  f = await seed();
  /*
   * Der Verantwortliche eines Auftrags muss der Gesellschaft angehören
   * (0025) — ein Konto mit Mitgliedschaft in jeder.
   */
  verantwortlich = await konto('bauleitung');
  for (const m of [f.reinigung, f.security, f.bau, f.operations]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
       select $1, $2, r.id, current_date - 1 from rolle r
        where r.schluessel = 'leitung' and r.mandant_id is null`, [verantwortlich, m]);
  }
  leereKacheln();
  alle = registriereBerichtKacheln();
});
afterAll(schliessen);

describe('(1) „Aktivität (7 Tage)" führt auf eine Liste mit genau diesen Zeilen', () => {
  it('Kachel und Aktivitätsliste zählen dasselbe — die achttägige fehlt in beiden', async () => {
    const benutzer = await mitRechten(f.reinigung, ['crm.lesen']);
    const k = await kunde(f.reinigung, 'Hausverwaltung Prenzlauer Berg');
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into lead (mandant_id, leadnummer, quelle, betreff, besitzer_benutzer_id,
                         firma_name, status)
       values ($1, $2, 'manuell', 'Treppenhaus', $3, 'Anfragende GmbH', 'neu') returning id`,
      [f.reinigung, `L-${zufall()}`, benutzer]);
    /*
     * `geschehen_am` stempelt der Einfüge-Auslöser mit der Serveruhr
     * (0017, Invariante 5) — ein Wert im INSERT wird überschrieben. Die
     * Vergangenheit entsteht deshalb erst danach, als Eigentümer.
     */
    for (const [tage, betreff] of [[1, 'Gestern'], [6, 'Vor sechs Tagen'], [8, 'Zu alt']] as const) {
      const [a] = await sql.unsafe<{ id: string }[]>(
        `insert into lead_aktivitaet (mandant_id, lead_id, typ, richtung, zweck, betreff)
         values ($1, $2, 'notiz', 'intern', 'intern', $3) returning id`,
        [f.reinigung, l!.id, betreff]);
      await sql.unsafe(
        `update lead_aktivitaet set geschehen_am = now() - make_interval(days => $2::int)
          where id = $1`, [a!.id, tage]);
    }
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck, betreff)
       values ($1, $2, 'anruf', 'eingehend', 'intern', 'Am Kunden')`,
      [f.reinigung, k]);
    // Eine Aktivität der anderen Gesellschaft — sie darf in keiner der Zahlen stehen.
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck, betreff)
       values ($1, $2, 'notiz', 'intern', 'intern', 'Fremd')`,
      [f.bau, await kunde(f.bau, 'Bauherr Spandau')]);

    const { wert, liste } = await alsBereich(benutzer, f.reinigung, async (kx) => ({
      wert: await kachelWert(kx, kachel('letzte_aktivitaet'),
        { mandantId: f.reinigung, mandantSlug: 'reinigung', mandantIds: [f.reinigung] }),
      liste: await leseAktivitaeten(kx),
    }));
    /*
     * Die Zahl gegen eine DIREKTE Zählung — das Anlegen des Leads schreibt
     * selbst eine Aktivität, die Zahl ist also nicht die der Einfügungen hier.
     */
    const [direkt] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from lead_aktivitaet
        where mandant_id = $1 and geschehen_am > now() - interval '7 days'`, [f.reinigung]);
    expect(wert).toBe(direkt!.n);
    expect(liste).toHaveLength(wert);
    const betreffe = liste.map((e) => e.betreff);
    expect(betreffe).toEqual(expect.arrayContaining(['Am Kunden', 'Gestern', 'Vor sechs Tagen']));
    expect(betreffe).not.toContain('Zu alt');
    expect(betreffe).not.toContain('Fremd');
    // Der Kunde der Zeile — am Kunden selbst, beim Lead ohne Kunde keiner.
    expect(liste.find((e) => e.betreff === 'Am Kunden')?.kunde)
      .toBe('Hausverwaltung Prenzlauer Berg');
    expect(liste.find((e) => e.betreff === 'Gestern')?.kundeId).toBeNull();
  });

  it('das Ziel der Kachel ist die Aktivitätsliste, nicht die Kundenliste', () => {
    const ziel = kachel('letzte_aktivitaet').ziel(
      { mandantId: f.reinigung, mandantSlug: 'reinigung', mandantIds: [f.reinigung] });
    expect(ziel).toBe('/portal/reinigung/crm/aktivitaet');
  });
});

describe('(2) „Bauprojekte in Arbeit" und die gefilterte Projektliste', () => {
  it('ohne Leserecht auf den Kunden bleibt das Projekt in der Liste — mit Strich', async () => {
    // `bau.lesen` OHNE `crm.lesen`: das Projekt ist lesbar, sein Kunde nicht.
    const benutzer = await mitRechten(f.bau, ['bau.lesen']);
    const k = await kunde(f.bau, 'Wohnungsbau Lichtenberg');
    await projekt(f.bau, k, 'in_arbeit');
    await projekt(f.bau, k, 'in_arbeit');
    await projekt(f.bau, k, 'geplant');
    await projekt(f.bau, k, 'in_arbeit', true);
    // Dieselbe Menge in einer anderen Gesellschaft — zählt hier nicht.
    await projekt(f.reinigung, await kunde(f.reinigung, 'Fremd'), 'in_arbeit');

    const { wert, gefiltert, alleProjekte } = await alsBereich(benutzer, f.bau, async (kx) => ({
      wert: await kachelWert(kx, kachel('projekte_in_arbeit'),
        { mandantId: f.bau, mandantSlug: 'bau', mandantIds: [f.bau] }),
      gefiltert: await listeProjekte(kx, { status: 'in_arbeit' }),
      alleProjekte: await listeProjekte(kx),
    }));
    expect(wert).toBe(2);
    expect(gefiltert).toHaveLength(wert);
    expect(gefiltert.every((p) => p.status === 'in_arbeit')).toBe(true);
    /*
     * DAS ist der Grund für den LEFT JOIN: mit dem inneren Join stünden hier
     * null Zeilen, und die Kachel zeigte trotzdem 2.
     */
    expect(gefiltert.every((p) => p.kunde === null)).toBe(true);
    expect(alleProjekte).toHaveLength(3);
  });

  it('mit Leserecht auf den Kunden steht sein Name in der Zeile', async () => {
    const benutzer = await mitRechten(f.bau, ['bau.lesen', 'crm.lesen']);
    const k = await kunde(f.bau, 'Wohnungsbau Lichtenberg');
    await projekt(f.bau, k, 'in_arbeit');
    const zeilen = await alsBereich(benutzer, f.bau,
      (kx) => listeProjekte(kx, { status: 'in_arbeit' }));
    expect(zeilen.map((z) => z.kunde)).toEqual(['Wohnungsbau Lichtenberg']);
  });
});

describe('(3) die Gruppenübersicht: Projekte in Arbeit und „aktuell im Einsatz"', () => {
  it('ein Super-Admin: Zahl je Bereich gleich der Liste dahinter', async () => {
    const chef = await konto('gruppe-kachel', true);
    await projekt(f.bau, await kunde(f.bau, 'Bauherr Mitte'), 'in_arbeit');
    await projekt(f.bau, await kunde(f.bau, 'Bauherr Nord'), 'abgenommen');
    await eingestempelt(f.reinigung, f.jonasReinigung, f.jonas);
    await eingestempelt(f.security, f.fatimaSecurity, f.fatima);
    // Zwei offene Aufgaben, eine erledigte, eine gelöschte — gezählt werden zwei.
    await sql.unsafe(
      `insert into aufgabe (mandant_id, titel, faellig_datum) values
         ($1, 'Schlüsselübergabe Treppenhaus', '2026-10-01'),
         ($1, 'Reinigungsplan prüfen', null)`, [f.reinigung]);
    await sql.unsafe(
      `insert into aufgabe (mandant_id, titel, status, erledigt_am, erledigt_von)
       values ($1, 'Schon erledigt', 'erledigt', now(), $2)`, [f.reinigung, chef]);
    await sql.unsafe(
      `insert into aufgabe (mandant_id, titel, geloescht_am) values ($1, 'Gelöscht', now())`,
      [f.reinigung]);

    const { u, reinigung, alleImEinsatz, aufgaben } = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(chef), async (k) => ({
        u: await gruppenUebersicht(k),
        reinigung: await gruppeImEinsatz(k, [f.reinigung]),
        alleImEinsatz: await gruppeImEinsatz(k, k.mandantIds),
        aufgaben: await gruppenAufgaben(k, [f.reinigung]),
      })));
    const je = new Map(u.bereiche.map((b) => [b.slug, b]));
    expect(je.get('bau')?.projekteInArbeit).toBe(1);
    expect(je.get('reinigung')?.projekteInArbeit).toBe(0);
    expect(je.get('reinigung')?.imEinsatz).toBe(1);
    expect(je.get('security')?.imEinsatz).toBe(1);
    expect(je.get('bau')?.imEinsatz).toBe(0);

    // Die Liste hinter der Zahl: `?bereich=reinigung#im-einsatz` zeigt genau die eine.
    expect(reinigung).toHaveLength(je.get('reinigung')!.imEinsatz!);
    expect(reinigung[0]?.slug).toBe('reinigung');
    expect(reinigung[0]?.seit).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u);
    const summe = u.bereiche.reduce((s, b) => s + (b.imEinsatz ?? 0), 0);
    expect(alleImEinsatz).toHaveLength(summe);

    // „Offene Aufgaben" → `/gruppe/aufgaben?bereich=reinigung`: dieselben Zeilen.
    expect(je.get('reinigung')?.aufgabenOffen).toBe(2);
    expect(aufgaben).toHaveLength(2);
    expect(aufgaben.map((a) => a.titel))
      .toEqual(['Schlüsselübergabe Treppenhaus', 'Reinigungsplan prüfen']);
    expect(aufgaben[0]?.faellig).toBe('01.10.2026');
    expect(aufgaben[1]?.faellig).toBeNull();
  });

  it('ohne `gruppe.zeit.lesen` und `gruppe.aufgabe.lesen` steht ein Strich, keine Null', async () => {
    const leitung = await konto('gruppe-strich');
    for (const m of [f.reinigung, f.bau]) {
      const [r] = await sql.unsafe<{ id: string }[]>(
        `select id from rolle where schluessel = 'leitung' and mandant_id is null`);
      await sql.unsafe(
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
         values ($1, $2, $3, current_date - 1)`, [leitung, m, r!.id]);
    }
    // Genau ein Recht, in genau einem Bereich (0008, Zweig 5).
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, gewaehrt, mandant_id)
       select r.id, b.id, true, $1 from rolle r, berechtigung b
        where r.schluessel = 'leitung' and r.mandant_id is null
          and b.schluessel = 'gruppe.bau.lesen'`, [f.bau]);
    await projekt(f.bau, await kunde(f.bau, 'Bauherr Mitte'), 'in_arbeit');
    await eingestempelt(f.reinigung, f.jonasReinigung, f.jonas);
    await sql.unsafe(`insert into aufgabe (mandant_id, titel) values ($1, 'Fremd')`, [f.reinigung]);

    const { u, liste, aufgaben } = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(leitung), async (k) => ({
        u: await gruppenUebersicht(k),
        liste: await gruppeImEinsatz(k, k.mandantIds),
        aufgaben: await gruppenAufgaben(k, k.mandantIds),
      })));
    const je = new Map(u.bereiche.map((b) => [b.slug, b]));
    expect(je.get('bau')?.projekteInArbeit).toBe(1);
    expect(je.get('reinigung')?.projekteInArbeit).toBeNull();
    // Kein Zeit-Leserecht: kein Wert — und die Liste zeigt ebenso nichts (RLS).
    expect(je.get('reinigung')?.imEinsatz).toBeNull();
    expect(liste).toEqual([]);
    // Ohne `gruppe.aufgabe.lesen`: Strich in der Zelle, keine Zeile in der Liste.
    expect(je.get('reinigung')?.aufgabenOffen).toBeNull();
    expect(aufgaben).toEqual([]);
  });
});
