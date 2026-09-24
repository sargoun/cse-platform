/**
 * Die ABFRAGEN DER SIEBEN CRM-SEITEN — gegen echtes Postgres, wörtlich.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum diese Datei getrennt von den Dienstprüfungen steht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `crm-kontakt-grundlage` und `crm-kundenzugang` prüfen die DIENSTE: die
 * Definer, die Trigger, die Rechte. Was dort nicht vorkommt, ist der Teil, den
 * jede Seite selbst mitbringt — der Kopf-`select`, der Verlauf, die Liste, der
 * Vorschlag. Diese Abfragen stehen in `page.tsx`, laufen nur beim Aufruf der
 * Seite und wurden von keinem Test je ausgeführt.
 *
 * Das ist genau die Stelle, an der ein Spaltenname oder ein Enumwert geraten
 * wird, ohne dass es auffällt: `tsc` prüft den `select`-Text nicht, und eine
 * Seite, die niemand geöffnet hat, sagt nichts. Der Fehler erscheint dann als
 * `42703` auf einer Seite, die ein Mensch zum ersten Mal braucht — und K-05
 * macht ihn schlimmer, weil ein `42501` auf einer entzogenen Spalte wie
 * „nichts hinterlegt" aussieht statt wie ein Defekt.
 *
 * Jede Abfrage unten ist deshalb WÖRTLICH aus der Seite übernommen, nicht
 * nachgebaut. Eine Kopie, die sich unabhängig weiterentwickelt, prüft die
 * Kopie; darum steht neben jeder die Datei, aus der sie stammt, und die
 * Prüfung „läuft überhaupt" ist hier eine Zusage und keine Formalität.
 *
 * Geprüft wird je Seite dreierlei:
 *
 *  1. **Sie läuft** — als `cse_app`, in einer Bereichssitzung, mit RLS und
 *     FORCE, nicht als Eigentümer.
 *  2. **Sie trennt die Bereiche** — die Zeile der anderen Gesellschaft ist
 *     nicht dabei. Ein `where mandant_id = app.aktiver_mandant()` ist die
 *     erste Verteidigung, RLS die zweite (Invariante 3); beide gehören
 *     geprüft, weil ein Test, der nur eine prüft, die andere einschläfern
 *     lässt.
 *  3. **Sie beantwortet die Frage der Seite** — die gesäte Zeile kommt mit
 *     den Werten zurück, die die Seite anzeigt.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import { leseGrundlagenListe, torAntworten }
  from '../../src/server/services/crm/kontakt-grundlage.js';
import { leseKondition, mahnsperreAktiv }
  from '../../src/server/services/crm/kondition.js';
import { leseZugaenge } from '../../src/server/services/crm/kundenzugang.js';
import { leseZeitanker, listeWiedervorlagen }
  from '../../src/server/services/crm/wiedervorlage.js';
import { leseSteuerblatt } from '../../src/server/services/finanz/kunde-steuer.js';
import { leseKontaktVerlauf } from '../../src/server/services/crm/verlauf.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(): Promise<string> {
  const email = `seite-${zufall()}@cse.test`;
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

async function legeKundeAn(mandantId: string, name: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
     values ($1, $2, $3, 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [mandantId, `K-${zufall()}`, name]);
  return z!.id;
}

/**
 * Ein Ansprechpartner.
 *
 * `haupt` ist nicht Beiwerk: `ansprechpartner_hauptkontakt_uk` lässt je Kunde
 * GENAU EINEN Hauptkontakt zu (partieller Unique-Index über
 * `(mandant_id, kunde_id) where ist_hauptkontakt and archiviert_am is null`).
 * Ein Helfer, der immer `true` setzt, fiele beim zweiten Kontakt desselben
 * Kunden um — und zwar mit einer Meldung über den Index, nicht über den Test.
 */
async function legeKontaktAn(
  mandantId: string, kundeId: string, nachname: string, haupt = true,
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, email,
                                  position, abteilung, telefon, mobil,
                                  ist_hauptkontakt, rechtsgrundlage,
                                  rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Aylin', $3, $4, 'Objektleitung', 'Technik',
             '+49 30 1234567', '+49 170 1234567', $5,
             'bestandskunde', 'Rahmenvertrag', now())
     returning id`,
    [mandantId, kundeId, nachname, `s-${zufall()}@example.test`, haupt]);
  return z!.id;
}

/** Eine Bereichssitzung: intern, zweiter Faktor, schreibend. */
async function alsIntern<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId, benutzerId: chef,
      portal: 'intern', readonly: false,
    },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal','aal2',true)`);
      return fn(tx);
    },
  );
}

/** Der schmale Leseausschnitt, den die Dienste der Seiten erwarten. */
function alsKontext(tx: postgres.TransactionSql, mandantId: string): LeseKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: chef,
    aktiverMandantId: mandantId, mandantIds: [mandantId], abfrage,
  };
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await mitgliedschaft(chef, f.reinigung);
  await mitgliedschaft(chef, f.bau);
});

afterAll(async () => { await schliessen(); });

// ---------------------------------------------------------------------------
// 1. /crm/kontakte — die Liste über alle Kunden
// ---------------------------------------------------------------------------

/**
 * WÖRTLICH aus `src/app/portal/[mandant]/crm/kontakte/page.tsx`.
 *
 * Der `left join` auf `kunde` trägt `k.mandant_id = ap.mandant_id` MIT — ohne
 * das wäre er ein Join über Bereichsgrenzen, den RLS zwar leer zurückgibt,
 * der aber einen Kontakt ohne Kundennamen zeigte statt gar nicht.
 */
const KONTAKTE_SQL = `select ap.id,
                btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
                ap.position, ap.abteilung, ap.kunde_id, k.name as kunde_name,
                ap.email, ap.telefon, ap.ist_hauptkontakt,
                app.darf_kontaktiert_werden(ap.id, 'email', 'werbung') as darf_email
           from ansprechpartner ap
           left join kunde k on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
          where ap.mandant_id = app.aktiver_mandant()
            and ap.archiviert_am is null
            and ($1::text = ''
                 or ap.nachname ilike '%' || $1 || '%'
                 or coalesce(ap.vorname, '') ilike '%' || $1 || '%'
                 or coalesce(ap.email, '') ilike '%' || $1 || '%')
          order by ap.nachname, ap.vorname`;

describe('/crm/kontakte', () => {
  it('die Liste läuft und nennt den Kunden mit', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await legeKontaktAn(f.reinigung, kunde, 'Kellermann');

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      tx.unsafe(KONTAKTE_SQL, ['']));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!['name']).toBe('Aylin Kellermann');
    expect(zeilen[0]!['kunde_name']).toBe('Hausverwaltung Mitte');
    expect(zeilen[0]!['position']).toBe('Objektleitung');
    expect(zeilen[0]!['ist_hauptkontakt']).toBe(true);
    // Das TOR antwortet mit — nicht die Spalte, die K-05 entzogen hat.
    expect(typeof zeilen[0]!['darf_email']).toBe('boolean');
  });

  it('die Namenssuche greift in SQL', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await legeKontaktAn(f.reinigung, kunde, 'Kellermann');
    await legeKontaktAn(f.reinigung, kunde, 'Zawadzki', false);

    const treffer = await alsIntern(f.reinigung, (tx) =>
      tx.unsafe(KONTAKTE_SQL, ['zawad']));
    expect(treffer).toHaveLength(1);
    expect(treffer[0]!['name']).toBe('Aylin Zawadzki');
  });

  /**
   * Die Zeile der anderen Gesellschaft ist nicht dabei — und das ist hier
   * mehr als die übliche Zusage: derselbe Mensch ist in BEIDEN Bereichen
   * Admin. Eine Liste, die nach dem Recht filtert statt nach dem Bereich,
   * fiele genau hier durch.
   */
  it('der Kontakt der anderen Gesellschaft fehlt', async () => {
    const kR = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await legeKontaktAn(f.reinigung, kR, 'Kellermann');
    const kB = await legeKundeAn(f.bau, 'Bauherr Spandau');
    await legeKontaktAn(f.bau, kB, 'Oberstein');

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      tx.unsafe(KONTAKTE_SQL, ['']));
    expect(zeilen.map((z) => z['name'])).toEqual(['Aylin Kellermann']);
  });

  /**
   * Das ENGERE Recht der Liste (O-661): die Seite fragt zuerst
   * `crm.rechtsgrundlage_lesen` und ruft den Definer nur dann. Geprüft wird
   * hier, dass beides zusammenpasst — die Frage der Seite und die Antwort des
   * Definers.
   */
  it('die Einstufungen kommen aus dem Definer, nicht aus der Spalte', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await legeKontaktAn(f.reinigung, kunde, 'Kellermann');

    const { recht, grundlagen } = await alsIntern(f.reinigung, async (tx) => {
      const [r] = await tx.unsafe(
        `select app.hat_recht('crm.rechtsgrundlage_lesen', app.aktiver_mandant())
                  as darf`) as unknown as { darf: boolean }[];
      return {
        recht: r?.darf,
        grundlagen: await leseGrundlagenListe(alsKontext(tx, f.reinigung)),
      };
    });
    expect(recht).toBe(true);
    const meine = grundlagen.find((g) => g.ansprechpartner_id === ap);
    expect(meine?.rechtsgrundlage).toBe('bestandskunde');
    expect(meine?.werbewiderspruch_am).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. /crm/kontakte/[id] — das Kontaktblatt
// ---------------------------------------------------------------------------

/** WÖRTLICH aus `crm/kontakte/[id]/page.tsx`. */
const KONTAKT_KOPF_SQL = `select ap.id, ap.anrede, ap.titel,
                btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
                ap.position, ap.abteilung, ap.email, ap.telefon, ap.mobil,
                ap.sprache::text as sprache, ap.ist_hauptkontakt,
                ap.ausgeschieden_am::text as ausgeschieden_am,
                ap.kunde_id, k.name as kunde_name
           from ansprechpartner ap
           left join kunde k on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
          where ap.mandant_id = app.aktiver_mandant() and ap.id = $1::uuid
            and ap.archiviert_am is null`;

/*
 * Der Verlauf stand hier als WÖRTLICHE Kopie der Seitenabfrage. Seit V-147
 * liest die Seite ihn über `leseKontaktVerlauf` (Aktivitäten UND Nachrichten),
 * und geprüft wird genau diese Funktion — eine Kopie prüfte nur sich selbst.
 */

describe('/crm/kontakte/[id]', () => {
  it('der Kopf läuft und trägt Sprache und Kunde', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await legeKontaktAn(f.reinigung, kunde, 'Kellermann');

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      tx.unsafe(KONTAKT_KOPF_SQL, [ap]));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!['name']).toBe('Aylin Kellermann');
    expect(zeilen[0]!['kunde_name']).toBe('Hausverwaltung Mitte');
    expect(zeilen[0]!['sprache']).toBe('de');
    expect(zeilen[0]!['ausgeschieden_am']).toBeNull();
  });

  /**
   * Der Kontakt der anderen Gesellschaft ist über seine ID nicht erreichbar —
   * die Seite antwortet dann mit 404 und nicht mit 403 (AUT-06): ein 403
   * sagte, dass die ID existiert.
   */
  it('die ID aus der anderen Gesellschaft bleibt leer', async () => {
    const kB = await legeKundeAn(f.bau, 'Bauherr Spandau');
    const apB = await legeKontaktAn(f.bau, kB, 'Oberstein');

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      tx.unsafe(KONTAKT_KOPF_SQL, [apB]));
    expect(zeilen).toHaveLength(0);
  });

  /**
   * Der Verlauf steht auf `lead_aktivitaet` und nennt den Akteur über
   * `benutzer` — die Tabelle hinter `system.benutzer_lesen`. Der Admin hier
   * hält es, also steht ein Name da; die Seite schreibt „—" mit Grund, wenn
   * es fehlt, und genau deshalb ist der `left join` einer und kein `join`.
   */
  it('der Verlauf läuft, in Berliner Zeit, mit Akteur', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await legeKontaktAn(f.reinigung, kunde, 'Kellermann');

    /*
     * Die AUSGEHENDE Zeile wird in einer Bereichssitzung geschrieben, nicht
     * als Eigentümer — und das ist hier keine Stilfrage.
     *
     * `kern.uwg_sendetor` hängt an jedem ausgehenden elektronischen Kontakt
     * und fragt `app.darf_kontaktiert_werden`; die Funktion filtert auf
     * `ap.mandant_id = app.aktiver_mandant()`. Ohne gesetzten Bereich findet
     * sie KEINE Zeile, `coalesce(…, false)` macht daraus ein Nein, und der
     * Insert scheitert mit „nicht zulaessig" — nicht, weil der Kontakt
     * gesperrt wäre, sondern weil niemand gesagt hat, wer fragt. Genau so
     * schreibt die Anwendung: immer in einer Sitzung.
     */
    const gesetzt = await alsIntern(f.reinigung, async (tx) => {
      await tx.unsafe(
        `insert into lead_aktivitaet (mandant_id, kunde_id, ansprechpartner_id, typ,
                                      richtung, zweck, kanal, betreff, benutzer_id,
                                      geschehen_am)
         values (app.aktiver_mandant(), $1::uuid, $2::uuid, 'anruf', 'ausgehend',
                 'vertraglich', 'telefon', 'Rückfrage Treppenhaus', $3::uuid,
                 '2026-01-15 23:30:00+00')`,
        [kunde, ap, chef]);
      return leseKontaktVerlauf(alsKontext(tx, f.reinigung), ap);
    });
    expect(gesetzt).toHaveLength(1);
    expect(gesetzt[0]!.betreff).toBe('Rückfrage Treppenhaus');
    expect(gesetzt[0]!.art).toBe('anruf');
    expect(gesetzt[0]!.zweck).toBe('vertraglich');
    expect(gesetzt[0]!.wer).not.toBeNull();
    // Der Beleg: die Rechtsgrundlage IM MOMENT DES SENDENS, vom Tor gezogen.
    expect(gesetzt[0]!.grundlage).toBe('bestandskunde');

    /*
     * **Der mitgeschickte Zeitpunkt wurde verworfen** — und das ist die
     * Zusage, nicht der Nebeneffekt. `kern.erzwinge_serverzeit_geschehen`
     * hängt als BEFORE INSERT an dieser Tabelle und setzt `geschehen_am` auf
     * die Serveruhr (Invariante 5). Der Januartermin oben ist deshalb NICHT
     * in der Zeile: ein Verlauf, dessen Zeitpunkte ein Client bestimmt, ist
     * als Nachweis wertlos.
     */
    expect(gesetzt[0]!.zeitpunkt).not.toBe('16.01.2026 00:30');

    /*
     * Die Anzeige selbst — auf einer Zeile, deren Zeitpunkt nachträglich
     * gesetzt ist (der Zwang hängt am INSERT, nicht am UPDATE). 23:30 UTC im
     * Januar ist 00:30 des FOLGETAGS in Berlin: das `at time zone` der
     * Abfrage muss den Tag mitdrehen, sonst steht auf jedem Nachtkontakt das
     * falsche Datum (Invariante 2).
     */
    await sql.unsafe(
      `update lead_aktivitaet set geschehen_am = '2026-01-15 23:30:00+00'
        where ansprechpartner_id = $1`, [ap]);
    const zeilen = await alsIntern(f.reinigung, (tx) =>
      leseKontaktVerlauf(alsKontext(tx, f.reinigung), ap));
    expect(zeilen[0]!.zeitpunkt).toBe('16.01.2026 00:30');
  });

  /**
   * Die Sommerzeit, dieselbe Abfrage: im Juli liegt Berlin zwei Stunden vor
   * UTC, im Januar eine. Eine Anzeige mit festem Versatz wäre die Hälfte des
   * Jahres falsch — und niemandem fiele es auf, weil sie im Winter stimmt.
   */
  it('der Verlauf dreht auch im Sommer richtig', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await legeKontaktAn(f.reinigung, kunde, 'Kellermann');
    await alsIntern(f.reinigung, (tx) => tx.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, ansprechpartner_id, typ,
                                    richtung, zweck, betreff, benutzer_id)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, 'notiz', 'intern',
               'intern', 'Sommerfall', $3::uuid)`, [kunde, ap, chef]));
    await sql.unsafe(
      `update lead_aktivitaet set geschehen_am = '2026-07-15 22:30:00+00'
        where ansprechpartner_id = $1`, [ap]);

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      leseKontaktVerlauf(alsKontext(tx, f.reinigung), ap));
    expect(zeilen[0]!.zeitpunkt).toBe('16.07.2026 00:30');
  });

  it('das Tor antwortet je Kanal und Zweck', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await legeKontaktAn(f.reinigung, kunde, 'Kellermann');

    const antworten = await alsIntern(f.reinigung, (tx) =>
      torAntworten(alsKontext(tx, f.reinigung), ap));
    expect(antworten.length).toBeGreaterThan(0);
    // Vertragspost geht an einen Bestandskunden immer — sonst käme seine
    // Rechnung nicht an.
    const email = antworten.find((a) => a.kanal === 'email');
    expect(email?.vertraglich).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. /crm/kontakte/[id]/rechtsgrundlage — das Formular
// ---------------------------------------------------------------------------

/** WÖRTLICH aus `crm/kontakte/[id]/rechtsgrundlage/page.tsx`. */
const GRUNDLAGE_KOPF_SQL = `select ap.id,
                btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
                ap.email, ap.kunde_id, k.name as kunde_name
           from ansprechpartner ap
           left join kunde k on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
          where ap.mandant_id = app.aktiver_mandant() and ap.id = $1::uuid
            and ap.archiviert_am is null`;

describe('/crm/kontakte/[id]/rechtsgrundlage', () => {
  it('der Kopf läuft, und der Stichtag kommt aus der Datenbank', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    const ap = await legeKontaktAn(f.reinigung, kunde, 'Kellermann');

    const { kopf, heute } = await alsIntern(f.reinigung, async (tx) => {
      const k = await tx.unsafe(GRUNDLAGE_KOPF_SQL, [ap]);
      const [h] = await tx.unsafe(
        `select app.berlin_heute()::text as tag`) as unknown as { tag: string }[];
      return { kopf: k, heute: h?.tag };
    });
    expect(kopf).toHaveLength(1);
    expect(kopf[0]!['kunde_name']).toBe('Hausverwaltung Mitte');
    /*
     * Das Vorgabedatum des Formulars ist der BERLINER Tag aus der Datenbank,
     * nie `new Date()` im Node-Prozess: zwischen Mitternacht und 02:00 zeigte
     * die Prozessuhr in UTC den Vortag, und ein Nachweis mit dem falschen
     * Datum ist in einer Abmahnung schlimmer als keiner (K-11).
     */
    expect(heute).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
});

// ---------------------------------------------------------------------------
// 4. /crm/kunden/[id]/konditionen
// ---------------------------------------------------------------------------

/**
 * WÖRTLICH aus `crm/kunden/[id]/konditionen/page.tsx` — und aus
 * `steuer/page.tsx` und `zugang/page.tsx`, die denselben Kopf lesen.
 *
 * Er nennt `typ` mit, und er nennt die entzogenen Spalten NICHT: kein
 * `debitorennummer`, kein `zahlungsziel_tage`, kein `mahnsperre_*` (K-05).
 */
const KUNDE_KOPF_SQL = `select k.id, k.name, k.kundennummer, k.typ::text as typ
           from kunde k
          where k.mandant_id = app.aktiver_mandant() and k.id = $1::uuid
            and k.archiviert_am is null`;

describe('/crm/kunden/[id]/konditionen', () => {
  it('der Kopf läuft ohne die entzogenen Spalten', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      tx.unsafe(KUNDE_KOPF_SQL, [kunde]));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!['name']).toBe('Hausverwaltung Mitte');
    expect(zeilen[0]!['typ']).not.toBeNull();
  });

  /**
   * Die Kondition kommt über den Definer, und sie kommt LEER zurück, solange
   * niemand sie gepflegt hat. „Nicht gesetzt" ist hier eine Antwort und kein
   * Mangel: O-66 ist offen, und ein geratenes 14 wäre eine erfundene
   * Geschäftsregel mit Zinsfolge.
   */
  it('die Kondition ist über den Definer lesbar und anfangs leer', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');

    const kondition = await alsIntern(f.reinigung, (tx) =>
      leseKondition(alsKontext(tx, f.reinigung), kunde));
    expect(kondition).not.toBeNull();
    expect(kondition?.zahlungszielTage).toBeNull();
    expect(kondition?.debitorennummer).toBeNull();
    expect(kondition?.mahnsperreBis).toBeNull();
  });

  it('die gepflegte Kondition kommt mit ihren Werten zurück', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await sql.unsafe(
      `update kunde set debitorennummer = '10042', zahlungsziel_tage = 30
        where id = $1`, [kunde]);

    const kondition = await alsIntern(f.reinigung, (tx) =>
      leseKondition(alsKontext(tx, f.reinigung), kunde));
    expect(kondition?.debitorennummer).toBe('10042');
    expect(kondition?.zahlungszielTage).toBe(30);
  });

  /**
   * Die Mahnsperre wird von derselben Funktion beantwortet, die der Mahnlauf
   * fragt — nicht von einem Vergleich in der Seite. Eine zweite Formulierung
   * derselben Regel wäre die teure Variante: sie stimmte am Tag, an dem sie
   * geschrieben wurde.
   */
  it('die Mahnsperre antwortet aus der Funktion des Mahnlaufs', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await sql.unsafe(
      `update kunde set mahnsperre_bis = (app.berlin_heute() + 30),
                        mahnsperre_grund = 'Stundung bis Quartalsende'
        where id = $1`, [kunde]);

    const aktiv = await alsIntern(f.reinigung, (tx) =>
      mahnsperreAktiv(alsKontext(tx, f.reinigung), kunde));
    expect(aktiv).toBe(true);
  });

  it('eine abgelaufene Sperre hält den Lauf nicht mehr an', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await sql.unsafe(
      `update kunde set mahnsperre_bis = (app.berlin_heute() - 1),
                        mahnsperre_grund = 'Stundung, abgelaufen'
        where id = $1`, [kunde]);

    const aktiv = await alsIntern(f.reinigung, (tx) =>
      mahnsperreAktiv(alsKontext(tx, f.reinigung), kunde));
    expect(aktiv).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. /crm/kunden/[id]/steuer
// ---------------------------------------------------------------------------

describe('/crm/kunden/[id]/steuer', () => {
  /**
   * Das Steuerblatt liest die beiden Spalten aus 0245 mit. Ohne das
   * `grant select (uebertragungsweg, rechnungsformat)` dort wäre dieser Test
   * ein `42501` — und auf der Seite eine leere Auswahl, die wie „nicht
   * verabredet" aussieht, während sie „nicht lesbar" heißt.
   */
  it('das Blatt läuft und trägt Weg und Format', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Bezirksamt Pankow');
    await sql.unsafe(
      `update kunde
          set ist_oeffentlicher_auftraggeber = true, xrechnung_pflicht = true,
              leitweg_id = '991-01234-56', uebertragungsweg = 'ozg_re',
              rechnungsformat = 'xrechnung_ubl'
        where id = $1`, [kunde]);

    const blatt = await alsIntern(f.reinigung, (tx) =>
      leseSteuerblatt(alsKontext(tx, f.reinigung), kunde));
    expect(blatt).not.toBeNull();
    expect(blatt?.kopf.uebertragungsweg).toBe('ozg_re');
    expect(blatt?.kopf.rechnungsformat).toBe('xrechnung_ubl');
    expect(blatt?.kopf.leitweg_id).toBe('991-01234-56');
    expect(blatt?.kopf.xrechnung_pflicht).toBe(true);
    expect(blatt?.heute).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('ohne Pflege bleiben Weg und Format leer — nicht „E-Mail"', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');

    const blatt = await alsIntern(f.reinigung, (tx) =>
      leseSteuerblatt(alsKontext(tx, f.reinigung), kunde));
    expect(blatt?.kopf.uebertragungsweg).toBeNull();
    expect(blatt?.kopf.rechnungsformat).toBeNull();
  });

  it('der Kunde der anderen Gesellschaft ist kein Blatt', async () => {
    const kB = await legeKundeAn(f.bau, 'Bauherr Spandau');

    const blatt = await alsIntern(f.reinigung, (tx) =>
      leseSteuerblatt(alsKontext(tx, f.reinigung), kB));
    expect(blatt).toBeNull();
  });

  /**
   * Die §-13b-Zeitscheiben und die §-48b-Bescheinigungen liegen hinter
   * `finanzen.lesen`, nicht hinter dem Tor der Route. Das Blatt sagt deshalb
   * MIT, welches Recht fehlt — sonst sähe eine leere Liste wie „kein
   * Bauleistender" aus, und das ist eine Aussage über den Kunden.
   */
  it('das Blatt nennt die Rechte der beiden Nachweisblöcke', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');

    const blatt = await alsIntern(f.reinigung, (tx) =>
      leseSteuerblatt(alsKontext(tx, f.reinigung), kunde));
    expect(blatt?.rechte).toBeDefined();
    expect(Object.values(blatt!.rechte).every((w) => typeof w === 'boolean')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. /crm/kunden/[id]/zugang
// ---------------------------------------------------------------------------

/** WÖRTLICH aus `crm/kunden/[id]/zugang/page.tsx` — der Vorschlag. */
const ZUGANG_KONTAKTE_SQL = `select ap.id,
                btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
                ap.email
           from ansprechpartner ap
          where ap.mandant_id = app.aktiver_mandant() and ap.kunde_id = $1::uuid
            and ap.archiviert_am is null and ap.email is not null
          order by ap.nachname`;

describe('/crm/kunden/[id]/zugang', () => {
  it('der Vorschlag nennt nur Kontakte MIT Adresse', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await legeKontaktAn(f.reinigung, kunde, 'Kellermann');
    await sql.unsafe(
      `insert into ansprechpartner (mandant_id, kunde_id, nachname)
       values ($1, $2, 'OhneAdresse')`, [f.reinigung, kunde]);

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      tx.unsafe(ZUGANG_KONTAKTE_SQL, [kunde]));
    expect(zeilen.map((z) => z['name'])).toEqual(['Aylin Kellermann']);
  });

  it('die Zugangsliste läuft und ist anfangs leer', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');

    const zugaenge = await alsIntern(f.reinigung, (tx) =>
      leseZugaenge(alsKontext(tx, f.reinigung), kunde));
    expect(zugaenge).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. /crm/wiedervorlagen
// ---------------------------------------------------------------------------

describe('/crm/wiedervorlagen', () => {
  /**
   * Der Zeitanker kommt aus der Datenbank, und er ist der Grund, warum diese
   * Seite keine Browserzeit anfasst: „überfällig" ist eine Aussage über den
   * Berliner Tag, und der Node-Prozess läuft in UTC.
   */
  it('der Zeitanker kommt aus der Datenbank', async () => {
    const anker = await alsIntern(f.reinigung, (tx) =>
      leseZeitanker(alsKontext(tx, f.reinigung)));
    expect(anker.heute).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(anker.wochenende).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(anker.wochenende >= anker.heute).toBe(true);
  });

  it('die Liste läuft und findet die fällige Zeile', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck,
                                    betreff, zustaendig_benutzer_id, faellig_am)
       values ($1, $2, 'notiz', 'intern', 'intern', 'Angebot nachfassen', $3,
               now() - interval '2 days')`,
      [f.reinigung, kunde, chef]);

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      listeWiedervorlagen(alsKontext(tx, f.reinigung), { nurMeine: true }));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.betreff).toBe('Angebot nachfassen');
    expect(zeilen[0]!.kunde_name).toBe('Hausverwaltung Mitte');
    expect(zeilen[0]!.faellig_tag).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  /** Eine erledigte Wiedervorlage ist keine mehr — sie verschwindet aus der Liste. */
  it('die erledigte Zeile fehlt in der Liste', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck,
                                    betreff, zustaendig_benutzer_id, faellig_am,
                                    erledigt_am)
       values ($1, $2, 'notiz', 'intern', 'intern', 'schon erledigt', $3,
               now() - interval '2 days', now())`,
      [f.reinigung, kunde, chef]);

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      listeWiedervorlagen(alsKontext(tx, f.reinigung), { nurMeine: true }));
    expect(zeilen).toHaveLength(0);
  });

  /**
   * „Nur meine" heißt WIRKLICH meine: die Zeile eines anderen Zuständigen
   * fehlt, und mit `nurMeine: false` ist sie da. Ein Filter, der beides
   * gleich beantwortet, ist der stille Fall — er sieht aus wie ein Filter.
   */
  it('„nur meine" trennt von „alle"', async () => {
    const kunde = await legeKundeAn(f.reinigung, 'Hausverwaltung Mitte');
    const andere = await konto();
    await mitgliedschaft(andere, f.reinigung);
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck,
                                    betreff, zustaendig_benutzer_id, faellig_am)
       values ($1, $2, 'notiz', 'intern', 'intern', 'fremde Zeile', $3,
               now() - interval '1 day')`,
      [f.reinigung, kunde, andere]);

    const { meine, alle } = await alsIntern(f.reinigung, async (tx) => {
      const k = alsKontext(tx, f.reinigung);
      return {
        meine: await listeWiedervorlagen(k, { nurMeine: true }),
        alle: await listeWiedervorlagen(k, { nurMeine: false }),
      };
    });
    expect(meine).toHaveLength(0);
    expect(alle.map((z) => z.betreff)).toEqual(['fremde Zeile']);
  });

  it('die Wiedervorlage der anderen Gesellschaft fehlt', async () => {
    const kB = await legeKundeAn(f.bau, 'Bauherr Spandau');
    await sql.unsafe(
      `insert into lead_aktivitaet (mandant_id, kunde_id, typ, richtung, zweck,
                                    betreff, zustaendig_benutzer_id, faellig_am)
       values ($1, $2, 'notiz', 'intern', 'intern', 'Bau-Zeile', $3,
               now() - interval '1 day')`,
      [f.bau, kB, chef]);

    const zeilen = await alsIntern(f.reinigung, (tx) =>
      listeWiedervorlagen(alsKontext(tx, f.reinigung), { nurMeine: true }));
    expect(zeilen).toHaveLength(0);
  });
});
