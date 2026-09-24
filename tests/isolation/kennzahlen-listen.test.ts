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
 *  (4) Die Übersicht eines Bereichs zeigt eine Kachel nur, wenn sich ihr Ziel
 *      öffnet — Buchung und Rechte aus der Datenbank (V-151, D-645).
 *  (5) Die Listen hinter „Aktive Aufträge", „Offene Angebote", „Neue Anfragen"
 *      und „Frist überschritten" — im Bereich und in der Gruppe, samt der
 *      Summe „Aufträge aktiv" — zeigen genau die gezählten Zeilen (V-152,
 *      D-646). Vorher stand ihre Abfrage in der Seite und war nur am
 *      Quelltext geprüft.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { withGroupScope, type LeseKontext, type Sitzung } from '../../src/server/kontext/index.js';
import { leereKacheln, type Kachel } from '../../src/server/registry/kennzahlen.js';
import { registriereBerichtKacheln } from '../../src/server/services/bericht/kacheln.js';
import { bereichsDashboard, kachelWert } from '../../src/server/services/bericht/dashboard.js';
import { leseAktivitaeten } from '../../src/server/services/crm/verlauf.js';
import { listeProjekte } from '../../src/server/services/bau/lv.js';
import { gruppeImEinsatz } from '../../src/server/services/gruppe/auslastung.js';
import { gruppenUebersicht } from '../../src/server/services/gruppe/uebersicht.js';
import { gruppenAufgaben } from '../../src/server/services/gruppe/aufgaben.js';
import {
  gruppenAngebote, gruppenAuftraege, gruppenLeads, listeAngebote, listeAuftraege, listeLeads,
} from '../../src/server/services/bericht/listen.js';

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

describe('(4) V-151 — eine Kachel erscheint nur, wenn sich ihr Ziel öffnet', () => {
  const kx = (slug: string, id: string) => ({ mandantId: id, mandantSlug: slug, mandantIds: [id] });
  const schluessel = (werte: readonly { kachel: Kachel }[]): readonly string[] =>
    werte.map((w) => w.kachel.schluessel);

  it('„Bauprojekte in Arbeit": dieselbe Leitung, in der Reinigung nicht, im Bau schon', async () => {
    // Die Buchung wie im Seed (`seed/index.ts`): die Reinigung reinigt, der Bau baut.
    await sql.unsafe(
      `update mandant set module = '{reinigung}', module_gepflegt = true where id = $1`,
      [f.reinigung]);
    await sql.unsafe(
      `update mandant set module = '{bau}', module_gepflegt = true where id = $1`, [f.bau]);
    await projekt(f.bau, await kunde(f.bau, 'Wohnungsbau Lichtenberg'), 'in_arbeit');

    // `verantwortlich` ist Leitung in jeder Gesellschaft (beforeEach).
    const { recht, reinigung } = await alsBereich(verantwortlich, f.reinigung, async (k) => ({
      recht: (await k.abfrage<{ ok: boolean }>(
        `select app.hat_recht('bau.lesen', $1::uuid) as ok`, [f.reinigung]))[0]?.ok,
      reinigung: await bereichsDashboard(k, kx('reinigung', f.reinigung)),
    }));
    // DAS war der Befund: das Recht ist da (global) — das Modul nicht.
    expect(recht).toBe(true);
    expect(schluessel(reinigung)).not.toContain('projekte_in_arbeit');
    expect(schluessel(reinigung)).toContain('auftraege_aktiv');

    const bau = await alsBereich(verantwortlich, f.bau,
      (k) => bereichsDashboard(k, kx('bau', f.bau)));
    const kachelBau = bau.find((w) => w.kachel.schluessel === 'projekte_in_arbeit');
    expect(kachelBau?.wert).toBe(1);
    expect(kachelBau?.ziel).toBe('/portal/bau/bau/projekte?status=in_arbeit');
  });

  it('ohne gepflegte Buchung filtert nichts — „nicht eingetragen" ist kein „nicht gebucht"', async () => {
    await sql.unsafe(
      `update mandant set module = '{}', module_gepflegt = false where id = $1`, [f.reinigung]);
    const reinigung = await alsBereich(verantwortlich, f.reinigung,
      (k) => bereichsDashboard(k, kx('reinigung', f.reinigung)));
    expect(schluessel(reinigung)).toContain('projekte_in_arbeit');
  });

  it('„Offene Forderungen" nur mit `zahlung.lesen` — sonst zählte RLS 0', async () => {
    const nurBuchhaltung = await mitRechten(f.reinigung, ['buchhaltung.lesen']);
    const beide = await mitRechten(f.reinigung, ['buchhaltung.lesen', 'zahlung.lesen']);
    const ohne = await alsBereich(nurBuchhaltung, f.reinigung,
      (k) => bereichsDashboard(k, kx('reinigung', f.reinigung)));
    const mit = await alsBereich(beide, f.reinigung,
      (k) => bereichsDashboard(k, kx('reinigung', f.reinigung)));
    expect(schluessel(ohne)).toEqual([]);
    expect(schluessel(mit)).toEqual(['forderungen_offen']);
  });

  it('„Offene Konflikte" nur, wenn die Seite dahinter sich öffnet (`dienstplan.lesen`)', async () => {
    const nurKonflikte = await mitRechten(f.security, ['dienstplan.arbzg_lesen']);
    const beide = await mitRechten(f.security, ['dienstplan.arbzg_lesen', 'dienstplan.lesen']);
    const ohne = await alsBereich(nurKonflikte, f.security,
      (k) => bereichsDashboard(k, kx('security', f.security)));
    const mit = await alsBereich(beide, f.security,
      (k) => bereichsDashboard(k, kx('security', f.security)));
    expect(schluessel(ohne)).not.toContain('konflikte_offen');
    expect(schluessel(mit)).toContain('konflikte_offen');
  });
});

describe('(5) V-152 — die Listen hinter den Zahlen, an echten Zeilen', () => {
  async function auftrag(mandant: string, kundeId: string, status: string): Promise<void> {
    await sql.unsafe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1, $2, $3, 'einzelauftrag', $4::auftrag_status, 'Unterhaltsreinigung', $5,
               '2026-02-01')`,
      [mandant, `AU-${zufall()}`, kundeId, status, verantwortlich]);
  }
  async function angebot(mandant: string, kundeId: string, status: string): Promise<void> {
    await sql.unsafe(
      `insert into angebot (mandant_id, kunde_id, titel, status)
       values ($1, $2, 'Glasreinigung', $3::angebot_status)`, [mandant, kundeId, status]);
  }
  async function lead(mandant: string, status: string, fristVorbei: boolean): Promise<void> {
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into lead (mandant_id, leadnummer, quelle, betreff, besitzer_benutzer_id,
                         firma_name, status)
       values ($1, $2, 'manuell', 'Treppenhaus', $3, 'Anfragende GmbH', $4::lead_status)
       returning id`, [mandant, `L-${zufall()}`, verantwortlich, status]);
    await sql.unsafe(
      `update lead set sla_frist_am = now() + make_interval(hours => $2::int),
                       erste_reaktion_am = null
        where id = $1`, [l!.id, fristVorbei ? -2 : 24]);
  }
  const kx = (slug: string, id: string) => ({ mandantId: id, mandantSlug: slug, mandantIds: [id] });

  it('im Bereich: Aufträge und Angebote ohne `crm.lesen` — Zahl = Liste, der Kunde fehlt nur', async () => {
    const benutzer = await mitRechten(f.reinigung, ['auftrag.lesen', 'angebot.lesen']);
    const k = await kunde(f.reinigung, 'Hausverwaltung Friedrichshain');
    await auftrag(f.reinigung, k, 'aktiv');
    await auftrag(f.reinigung, k, 'aktiv');
    await auftrag(f.reinigung, k, 'angelegt');
    await angebot(f.reinigung, k, 'entwurf');
    await angebot(f.reinigung, k, 'in_pruefung');
    await angebot(f.reinigung, k, 'zurueckgezogen');
    // Dieselben Mengen in einer anderen Gesellschaft — sie zählen hier nicht.
    const fremd = await kunde(f.security, 'Fremd');
    await auftrag(f.security, fremd, 'aktiv');
    await angebot(f.security, fremd, 'entwurf');

    const r = await alsBereich(benutzer, f.reinigung, async (kontext) => ({
      auftraegeWert: await kachelWert(kontext, kachel('auftraege_aktiv'), kx('reinigung', f.reinigung)),
      auftraege: await listeAuftraege(kontext, 'aktiv'),
      alleAuftraege: await listeAuftraege(kontext, null),
      angeboteWert: await kachelWert(kontext, kachel('angebote_offen'), kx('reinigung', f.reinigung)),
      angebote: await listeAngebote(kontext, 'offen'),
      alleAngebote: await listeAngebote(kontext, null),
    }));
    expect(r.auftraegeWert).toBe(2);
    expect(r.auftraege).toHaveLength(r.auftraegeWert);
    expect(r.auftraege.every((z) => z.status === 'aktiv' && z.kunde === null)).toBe(true);
    expect(r.alleAuftraege).toHaveLength(3);
    expect(r.angeboteWert).toBe(2);
    expect(r.angebote).toHaveLength(r.angeboteWert);
    expect(r.angebote.map((z) => z.status).sort()).toEqual(['entwurf', 'in_pruefung']);
    expect(r.alleAngebote).toHaveLength(3);
  });

  it('im Bereich: „Neue Anfragen" und „Frist überschritten" — dieselben Zeilen wie die Kacheln', async () => {
    const benutzer = await mitRechten(f.reinigung, ['crm.lesen']);
    await lead(f.reinigung, 'neu', true);
    await lead(f.reinigung, 'neu', false);
    await lead(f.reinigung, 'in_bearbeitung', true);
    await lead(f.reinigung, 'gewonnen', false);
    await lead(f.security, 'neu', true);

    const r = await alsBereich(benutzer, f.reinigung, async (kontext) => ({
      neuWert: await kachelWert(kontext, kachel('neue_leads'), kx('reinigung', f.reinigung)),
      neu: await listeLeads(kontext, { status: 'neu', frist: null }),
      fristWert: await kachelWert(kontext, kachel('leads_ueber_sla'), kx('reinigung', f.reinigung)),
      frist: await listeLeads(kontext, { status: null, frist: 'ueberschritten' }),
      alle: await listeLeads(kontext, { status: null, frist: null }),
    }));
    expect(r.neuWert).toBe(2);
    expect(r.neu).toHaveLength(r.neuWert);
    expect(r.neu.every((z) => z.status === 'neu')).toBe(true);
    expect(r.fristWert).toBe(2);
    expect(r.frist).toHaveLength(r.fristWert);
    expect(r.frist.every((z) => z.frist_ueberschritten)).toBe(true);
    expect(r.alle).toHaveLength(4);
  });

  it('in der Gruppe: Summe „Aufträge aktiv", „Angebote offen", „Neue Anfragen" = die Listen dahinter', async () => {
    const chef = await konto('gruppe-listen', true);
    const kr = await kunde(f.reinigung, 'Hausverwaltung Mitte');
    const ks = await kunde(f.security, 'Eventhalle Treptow');
    await auftrag(f.reinigung, kr, 'aktiv');
    await auftrag(f.reinigung, kr, 'angelegt');
    await auftrag(f.security, ks, 'aktiv');
    await angebot(f.reinigung, kr, 'entwurf');
    await angebot(f.reinigung, kr, 'zurueckgezogen');
    await angebot(f.security, ks, 'in_pruefung');
    await lead(f.reinigung, 'neu', false);
    await lead(f.reinigung, 'angebot', false);
    await lead(f.security, 'neu', true);

    const r = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(chef), async (k) => ({
        u: await gruppenUebersicht(k),
        auftraege: await gruppenAuftraege(k, k.mandantIds, 'aktiv'),
        alleAuftraege: await gruppenAuftraege(k, k.mandantIds, null),
        angeboteReinigung: await gruppenAngebote(k, [f.reinigung], 'offen'),
        angeboteAlle: await gruppenAngebote(k, k.mandantIds, 'offen'),
        leadsReinigung: await gruppenLeads(k, [f.reinigung], { status: 'neu', frist: null }),
        leadsFrist: await gruppenLeads(k, k.mandantIds, { status: null, frist: 'ueberschritten' }),
      })));
    const je = new Map(r.u.bereiche.map((b) => [b.slug, b]));
    // Die Summenkachel oben: `/gruppe/auftraege?status=aktiv` zeigt genau ihre Zahl.
    expect(r.u.summe.auftraegeAktiv).toBe(2);
    expect(r.auftraege).toHaveLength(r.u.summe.auftraegeAktiv);
    expect(r.alleAuftraege).toHaveLength(3);
    // „Angebote offen" je Bereich und über alle.
    expect(je.get('reinigung')?.angeboteOffen).toBe(1);
    expect(r.angeboteReinigung).toHaveLength(1);
    const angeboteSumme = r.u.bereiche.reduce((n, b) => n + (b.angeboteOffen ?? 0), 0);
    expect(r.angeboteAlle).toHaveLength(angeboteSumme);
    // „Neue Anfragen" → `/gruppe/leads?status=neu&bereich=reinigung`.
    expect(je.get('reinigung')?.leadsNeu).toBe(1);
    expect(r.leadsReinigung).toHaveLength(1);
    expect(r.leadsReinigung[0]?.slug).toBe('reinigung');
    expect(r.leadsFrist.map((z) => z.slug)).toEqual(['security']);
  });
});

describe('(6) V-152 — „Forderungen offen" ist eine Zahl nur, wo sich die Liste öffnet', () => {
  it('mit `gruppe.zahlung.lesen` allein ein Strich; mit `gruppe.buchhaltung.lesen` dazu die Zahl', async () => {
    const leitung = await konto('gruppe-forderung');
    const [r] = await sql.unsafe<{ id: string }[]>(
      `select id from rolle where schluessel = 'leitung' and mandant_id is null`);
    for (const m of [f.reinigung, f.security]) {
      await sql.unsafe(
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
         values ($1, $2, $3, current_date - 1)`, [leitung, m, r!.id]);
    }
    /*
     * `offener_posten` liest die Gruppe mit `gruppe.zahlung.lesen` (0121,
     * `t_gruppe`) — in beiden Bereichen. `/gruppe/offene-posten` öffnet aber
     * nur mit `gruppe.buchhaltung.lesen`, und das hält die Leitung nur in der
     * Reinigung.
     */
    const gewaehre = async (recht: string, mandant: string): Promise<void> => {
      await sql.unsafe(
        `insert into rolle_berechtigung (rolle_id, berechtigung_id, gewaehrt, mandant_id)
         select $1, b.id, true, $3 from berechtigung b where b.schluessel = $2
         on conflict do nothing`, [r!.id, recht, mandant]);
    };
    await gewaehre('gruppe.zahlung.lesen', f.reinigung);
    await gewaehre('gruppe.zahlung.lesen', f.security);
    await gewaehre('gruppe.buchhaltung.lesen', f.reinigung);

    const u = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(leitung), (k) => gruppenUebersicht(k)));
    const je = new Map(u.bereiche.map((b) => [b.slug, b]));
    expect(je.get('reinigung')?.forderungenOffenCent).toBe(0n);
    // DAS war der Befund: hier stand eine Zahl, und ihr Verweis führte auf einen 404.
    expect(je.get('security')?.forderungenOffenCent).toBeNull();
    // Die Summe oben geht über genau den einen Bereich — und ist deshalb ein Verweis.
    expect(u.summe.bereiche.forderungen).toBe(1);
    // Ohne `gruppe.auftrag.lesen` irgendwo geht die Summe „Aufträge aktiv" über
    // keinen Bereich — die Seite zeigt dann einen Strich ohne Verweis.
    expect(u.summe.bereiche.auftraege).toBe(0);
  });
});
