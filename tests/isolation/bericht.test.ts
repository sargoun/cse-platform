/**
 * Die Berichtsabfragen gegen eine echte Datenbank (REP-01…REP-06).
 *
 * **Der Satz, den diese Datei beweist:** eine Berichtszahl sieht genau die
 * Zeilen, die ihre Gesellschaft sehen darf — und genau die Zustände, die sie
 * zählen soll.
 *
 *  1. **Die Mandantengrenze steht nicht in der Abfrage, sondern in RLS.**
 *     Dieselbe Funktion, zwei Gesellschaften, zwei Antworten — ohne dass ein
 *     `where mandant_id` in `kennzahlen.ts` steht (Invariante 3).
 *  2. **Ein Entwurf ist kein Umsatz, und eine verworfene Rechnung auch nicht**
 *     (Invariante 4). `<> 'entwurf'` hätte die verworfene mitgezählt.
 *  3. **Aufwand zählt ab `freigegeben`** — eingegangen und in Prüfung sind
 *     Behauptungen des Lieferanten.
 *  4. **Die Abschlussquote gehört zur Kohorte**: ein Lead vom Januar zählt im
 *     Januar, auch wenn er im März gewonnen wurde.
 *  5. **Die Pipeline zeigt jede Stufe, auch die leere.**
 *  6. **Die Gruppenfassung teilt auf, statt zu summieren.**
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import {
  attribution, auftragsReihe, pipeline, projektReihe, umsatzReihe,
} from '../../src/server/services/bericht/kennzahlen.js';
import { umsatzJeBereich } from '../../src/server/services/bericht/gruppe.js';
import { abschnitte, ganzesJahr } from '../../src/server/services/bericht/zeitraum.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, verwerfe, vonHand,
} from '../../src/server/services/finanz/rechnung.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/**
 * **Ein ECHTES Konto mit Rechten, kein leerer Benutzer.**
 *
 * `lead`, `projekt` und `zeiteintrag` haengen an `app.hat_recht(...)`, und
 * `hat_recht` antwortet ohne gebundenen Benutzer immer `false`. Ein Test mit
 * `benutzerId: ''` misst deshalb die leere Menge und faellt genau dann nicht
 * auf, wenn die Abfrage kaputt ist.
 */
async function legeLeitungAn(mandantId: string, rolle = 'leitung'): Promise<string> {
  const email = `ber-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung', 'aktiv')`,
    [u!.id, email]);
  await gibMitgliedschaft(u!.id, mandantId, rolle, true);
  return u!.id;
}

async function gibMitgliedschaft(
  benutzerId: string, mandantId: string, rolle: string, standard = false,
): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), $4)`,
    [benutzerId, mandantId, rolle, standard]);
}

/**
 * **Der Gruppenleser ist ein anderer Mensch als der Bereichsadmin.**
 *
 * Die Gruppen-Policies lesen nicht `finanzen.lesen`, sondern
 * `gruppe.finanzen.lesen` — ein eigenes Recht, das nur `super_admin` traegt.
 * Ein Bereichsadmin sieht in der Gruppenansicht deshalb NICHTS, auch nicht
 * seinen eigenen Bereich, und das ist richtig so: wer die Gruppe lesen darf,
 * ist eine eigene Entscheidung und nicht die Summe der Bereichsrollen.
 *
 * **`super_admin` ist eine GLOBALE Rolle** (TEN-08): sie haengt an
 * `benutzer.globale_rolle_id` und gilt ohne Zuweisungszeile in jedem Bereich —
 * `benutzer_mandant` nimmt sie gar nicht an (`geltungsbereich = 'mandant'`).
 * `app.rechte_mandanten` schneidet sie mit `app.sichtbare_mandanten()`, und
 * die sind hier die gebundene Liste; die Gruppenansicht bleibt also auch fuer
 * ihn auf das begrenzt, was die Sitzung traegt.
 */
async function legeGruppenleitungAn(): Promise<string> {
  const email = `chef-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  // `kern.benutzer_2fa_pflicht` laesst ein globales Konto ohne zweiten Faktor
  // nicht `aktiv` werden — die Regel gilt auch in der Fixtur.
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Gruppenleitung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

async function alsBereich<T>(
  mandantId: string, fn: (k: LeseKontext) => Promise<T>,
  benutzerId?: string,
): Promise<T> {
  const wer = benutzerId ?? await legeLeitungAn(mandantId);
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId: wer, portal: 'intern', readonly: true },
    async (tx: postgres.TransactionSql) => {
      const abfrage = async <T2>(a: string, w?: readonly unknown[]): Promise<readonly T2[]> =>
        (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T2[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: wer,
        aktiverMandantId: mandantId, mandantIds: [mandantId], abfrage,
      });
    },
  ) as Promise<T>;
}

async function inGruppe<T>(
  mandantIds: readonly string[], benutzerId: string,
  fn: (k: LeseKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'gruppe', mandantIds, benutzerId, portal: 'intern', readonly: true },
    async (tx: postgres.TransactionSql) => {
      const abfrage = async <T2>(a: string, w?: readonly unknown[]): Promise<readonly T2[]> =>
        (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T2[];
      return fn({
        scope: 'gruppe', portal: 'intern', benutzerId,
        aktiverMandantId: null, mandantIds, abfrage,
      });
    },
  ) as Promise<T>;
}

/**
 * **Rechnungen entstehen über den echten Dienst, nicht per `insert`.**
 *
 * `rechnung` trägt Invariante 4 als CHECK: festgeschrieben heisst Nummer,
 * Nummernkreis, laufende Nummer, Festschreibzeitpunkt, Festschreibender,
 * Zahlungsziel und Fälligkeit — alles zusammen oder gar nicht. Eine Zeile von
 * Hand einzusetzen hiesse, sieben Spalten zu erfinden und dabei genau den
 * Weg zu umgehen, den der Bericht später zählt. `legeEntwurfAn` →
 * `fuegePositionHinzu` → `finalisiere` ist derselbe Weg wie im Portal.
 *
 * **Eingangsrechnungen fehlen hier, und das ist kein Versehen.**
 * `eingangsrechnung.beleg_id` ist `not null`, ein `beleg` verlangt ein
 * `dokument` mit Version und SHA-256, und eine Datei braucht den
 * Objektspeicher — der ist in dieser Suite nicht verbunden (ACC-03). Die
 * Aufwandsseite ist deshalb im Bericht auf ihre Zustände dokumentiert
 * (`freigegeben`, `gebucht`) und wird hier nur darauf geprüft, dass sie
 * ohne Belege null ergibt statt zu scheitern.
 */
async function macheFakturierfaehig(mandantId: string): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B'
      where id = $1`, [mandantId]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

async function legeKundeAn(mandantId: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1::uuid, $2, 'Bezirksamt Mitte', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`,
    [mandantId, `K-${zufall()}`]);
  return k!.id;
}

/**
 * Eine Rechnung über den echten Weg — Entwurf, Position, Festschreiben.
 *
 * **Das Rechnungsdatum lässt sich nicht wählen**, und das ist richtig:
 * `finalisiere` setzt es, und eine festgeschriebene Rechnung ist unveränderlich
 * (Invariante 4). Geprüft wird deshalb der ZUSTAND — welcher zählt und welcher
 * nicht —, nicht die Monatszuordnung; die ist reine Datumsarithmetik und steht
 * in `tests/kern/bericht-ausgabe.test.ts`.
 */
async function legeRechnungAn(
  mandantId: string, benutzerId: string, kundeId: string,
  art: 'festgeschrieben' | 'entwurf' | 'verworfen',
  nettoCent: bigint,
): Promise<void> {
  await alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => {
      const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
        (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
      const d = { abfrage, schreibe: abfrage };
      // Der Leistungszeitraum ist Pflicht (§14 Abs. 4 Nr. 6 UStG) — der Dienst
      // prueft es beim Festschreiben, und das ist richtig so.
      const [heute] = await abfrage<{ tag: string }>(
        `select app.berlin_heute()::text as tag`);
      const id = await legeEntwurfAn(d, {
        kundeId, rechnungsart: 'standard', zahlungszielTage: 30,
        leistungVon: heute!.tag, leistungBis: heute!.tag,
      });
      await fuegePositionHinzu(d, {
        rechnungId: id, bezeichnung: 'Unterhaltsreinigung',
        menge: milliMenge(1000n), einheit: 'm2',
        einzelpreisCent: cent(nettoCent), steuergruppe: 'ust_19',
        quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
      });
      if (art === 'festgeschrieben') await finalisiere(d, id);
      if (art === 'verworfen') await verwerfe(d, id, 'Testfixtur');
    },
  );
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

/** Das laufende Jahr kommt aus der Datenbank, nie aus `new Date()`. */
async function berlinJahr(): Promise<number> {
  const [z] = await sql.unsafe<{ jahr: string }[]>(
    `select extract(year from app.berlin_heute())::text as jahr`);
  return Number(z!.jahr);
}

describe('(1) die Mandantengrenze kommt aus RLS, nicht aus der Abfrage', () => {
  it('dieselbe Funktion, zwei Gesellschaften, zwei Antworten', async () => {
    const jahr = await berlinJahr();
    const wR = await legeLeitungAn(f.reinigung, 'admin');
    const wB = await legeLeitungAn(f.bau, 'admin');
    await macheFakturierfaehig(f.reinigung);
    await macheFakturierfaehig(f.bau);
    await legeRechnungAn(f.reinigung, wR, await legeKundeAn(f.reinigung),
      'festgeschrieben', 1000n);
    await legeRechnungAn(f.bau, wB, await legeKundeAn(f.bau), 'festgeschrieben', 2500n);

    const zeitraum = [ganzesJahr(jahr)];
    const reinigung = await alsBereich(f.reinigung, (k) => umsatzReihe(k, zeitraum), wR);
    const bau = await alsBereich(f.bau, (k) => umsatzReihe(k, zeitraum), wB);

    // Netto 1000 Cent × 1000 Milli-Menge = 1000 Cent, plus 19 % Umsatzsteuer.
    expect(reinigung[0]!.rechnungen).toBe(1);
    expect(bau[0]!.rechnungen).toBe(1);
    expect(reinigung[0]!.erloeseCent).toBeLessThan(bau[0]!.erloeseCent);
  });
});

describe('(2) nur festgeschriebene Rechnungen sind Umsatz (Invariante 4)', () => {
  it('Entwurf und verworfen zählen nicht — auch nicht „alles ausser Entwurf"', async () => {
    const jahr = await berlinJahr();
    const wer = await legeLeitungAn(f.reinigung, 'admin');
    await macheFakturierfaehig(f.reinigung);
    const kunde = await legeKundeAn(f.reinigung);

    await legeRechnungAn(f.reinigung, wer, kunde, 'festgeschrieben', 3000n);
    await legeRechnungAn(f.reinigung, wer, kunde, 'entwurf', 90000n);
    await legeRechnungAn(f.reinigung, wer, kunde, 'verworfen', 50000n);

    const [zeile] = await alsBereich(f.reinigung,
      (k) => umsatzReihe(k, [ganzesJahr(jahr)]), wer);

    /*
     * EINE Rechnung — und der Betrag ist der der festgeschriebenen. Ein
     * `<> 'entwurf'` hätte die verworfene mitgezählt und den Jahresumsatz um
     * das Siebzehnfache erhöht, ohne dass irgendetwas rot geworden wäre.
     */
    expect(zeile!.rechnungen).toBe(1);
    expect(zeile!.erloeseCent).toBeGreaterThan(0n);
    expect(zeile!.erloeseCent).toBeLessThan(90000n);
  });

  it('die Monatssumme ist die Jahressumme — sonst fehlt oder doppelt ein Tag', async () => {
    const jahr = await berlinJahr();
    const wer = await legeLeitungAn(f.reinigung, 'admin');
    await macheFakturierfaehig(f.reinigung);
    const kunde = await legeKundeAn(f.reinigung);
    for (let i = 0; i < 3; i += 1) {
      await legeRechnungAn(f.reinigung, wer, kunde, 'festgeschrieben', 1000n);
    }

    const monate = await alsBereich(f.reinigung,
      (k) => umsatzReihe(k, abschnitte(jahr, 'monat')), wer);
    const [ganz] = await alsBereich(f.reinigung,
      (k) => umsatzReihe(k, [ganzesJahr(jahr)]), wer);

    expect(monate).toHaveLength(12);
    expect(monate.reduce((s, m) => s + m.erloeseCent, 0n)).toBe(ganz!.erloeseCent);
    expect(monate.reduce((s, m) => s + m.rechnungen, 0)).toBe(3);
  });
});

describe('(3) ohne Belege ist der Aufwand null — und kein Fehler', () => {
  it('die Abfrage läuft auch, wenn es keine Eingangsrechnung gibt', async () => {
    const jahr = await berlinJahr();
    const [zeile] = await alsBereich(f.reinigung, (k) => umsatzReihe(k, [ganzesJahr(jahr)]));
    expect(zeile!.aufwandCent).toBe(0n);
    expect(zeile!.eingangsrechnungen).toBe(0);
  });
});

describe('(4) die Abschlussquote gehört zur Kohorte', () => {
  it('ein Lead vom Januar zählt im Januar — auch wenn er im März gewonnen wird', async () => {
    const wer = await legeLeitungAn(f.reinigung);

    const legeLead = async (erstellt: string, status: string): Promise<void> => {
      await sql.unsafe(
        `insert into lead (mandant_id, leadnummer, betreff, firma_name, akteur_art,
                           quelle, besitzer_benutzer_id, status, verloren_grund, erstellt_am)
         values ($1::uuid, $2, 'Anfrage', 'Demo GmbH', 'mensch', 'manuell', $3::uuid,
                 $4::lead_status,
                 case when $4 in ('verloren','kein_bedarf') then 'Demodaten' end,
                 $5::timestamptz)`,
        [f.reinigung, `LD-${zufall()}`, wer, status, `${erstellt}T10:00:00+01:00`]);
    };
    const jahr = await berlinJahr();
    await legeLead(`${String(jahr)}-01-15`, 'gewonnen');
    await legeLead(`${String(jahr)}-01-20`, 'verloren');
    await legeLead(`${String(jahr)}-03-05`, 'neu');

    const monate = await alsBereich(f.reinigung,
      (k) => auftragsReihe(k, abschnitte(jahr, 'monat')), wer);

    expect(monate[0]).toMatchObject({ leads: 2, leadsGewonnen: 1, quoteBp: 5000 });
    expect(monate[2]).toMatchObject({ leads: 1, leadsGewonnen: 0, quoteBp: 0 });
    // Kein NaN und keine Division durch null.
    expect(monate[6]).toMatchObject({ leads: 0, quoteBp: 0 });
  });

  it('die Herkunft nennt „Manuell erfasst", wo kein Formular dahinter steht', async () => {
    const jahr = await berlinJahr();
    const wer = await legeLeitungAn(f.reinigung);
    await sql.unsafe(
      `insert into lead (mandant_id, leadnummer, betreff, firma_name, akteur_art,
                         quelle, besitzer_benutzer_id, erstellt_am)
       values ($1::uuid, $2, 'Telefonat', 'Demo GmbH', 'mensch', 'manuell', $3::uuid,
               $4::timestamptz)`,
      [f.reinigung, `LD-${zufall()}`, wer, `${String(jahr)}-04-04T10:00:00+02:00`]);

    const zeilen = await alsBereich(f.reinigung,
      (k) => attribution(k, ganzesJahr(jahr)), wer);
    expect(zeilen.map((z) => z.kanal)).toContain('Manuell erfasst');
    expect(zeilen.find((z) => z.kanal === 'Manuell erfasst')).toMatchObject({
      leads: 1, auftraege: 0, quoteBp: 0,
    });
  });
});

describe('(5) die Pipeline zeigt jede Stufe', () => {
  it('acht Stufen, auch ohne einen einzigen Vorgang', async () => {
    const jahr = ganzesJahr(await berlinJahr());
    const stufen = await alsBereich(f.reinigung, (k) => pipeline(k, jahr));
    expect(stufen).toHaveLength(8);
    expect(stufen.map((s) => s.status)).toEqual([
      'neu', 'geprueft', 'in_bearbeitung', 'eingereicht',
      'zuschlag', 'nicht_beruecksichtigt', 'verfahren_aufgehoben', 'verworfen',
    ]);
    expect(stufen.every((s) => s.anzahl >= 0)).toBe(true);
  });
});

describe('(6) Projekte: die Abfrage läuft und grenzt den Zeitraum ein', () => {
  it('ein Projekt ausserhalb des Zeitraums erscheint nicht', async () => {
    const zeilen = await alsBereich(f.reinigung, (k) => projektReihe(k, {
      von: '1999-01-01', bis: '1999-12-31', bezeichnung: '1999',
    }));
    expect(zeilen).toEqual([]);
  });

  /**
   * **Invariante 1 am schwierigsten Ort: dem Stundensatz.**
   *
   * Der Satz ist Cent JE STUNDE, die Dauer steht in Minuten — die Division
   * durch 60 geht fast nie auf. Wer sie je Zeile ausführt, rundet je Zeile;
   * bei zweimal 25 Minuten zu 25,50 €/h sind das zweimal 1062,5 Cent, also
   * zweimal aufgerundet **2126**. Richtig ist, erst zu multiplizieren, zu
   * summieren und EINMAL am Ende zu teilen: 50 × 2550 / 60 = **2125**, ohne
   * Rest. Ein Cent, ja — und er wächst mit jeder Zeile, bis niemand mehr
   * erklären kann, warum die Marge nicht stimmt.
   *
   * Der Test steht hier und nicht in `bericht-ausgabe.test.ts`, weil die
   * Rechnung in SQL steht (`app.projekt_lohnkosten`, 0157) — sie steht dort,
   * weil `anstellung.stundensatz_intern` für `cse_app` kein `select` trägt
   * (K-05).
   */
  it('die Lohnkosten runden einmal am Ende, nicht je Zeiteintrag', async () => {
    const jahr = await berlinJahr();
    const wer = await legeLeitungAn(f.bau, 'leitung');
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Tarek', 'Haddad') returning id`);
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt,
                               stundensatz_intern)
       values ($1::uuid, $2::uuid, $3, $4::date, 2550) returning id`,
      [f.bau, p!.id, `PN-${zufall()}`, `${String(jahr)}-01-01`]);

    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name)
       values ($1::uuid, $2, 'Bauherr Nord') returning id`, [f.bau, `K-${zufall()}`]);
    const [au] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1::uuid, $2, $3::uuid, 'projekt', 'aktiv', 'Rohbau Nord', $4::uuid, $5::date)
       returning id`,
      [f.bau, `AU-${zufall()}`, k!.id, wer, `${String(jahr)}-01-01`]);
    const [pr] = await sql.unsafe<{ id: string }[]>(
      `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                            vertragsgrundlage, soll_beginn, soll_ende,
                            auftragssumme_netto_cent)
       values ($1::uuid, $2::uuid, $3, 'Rohbau Nord', $4::uuid, 'hochbau', 'vob_b',
               $5::date, $6::date, 100000) returning id`,
      [f.bau, au!.id, `P-${zufall()}`, k!.id,
        `${String(jahr)}-02-01`, `${String(jahr)}-11-30`]);

    // Zweimal 25 Minuten — der Fall, in dem die Rundungsstelle sichtbar wird.
    for (const tag of ['03-10', '03-11']) {
      await sql.unsafe(
        `insert into zeiteintrag
           (mandant_id, anstellung_id, person_id, projekt_id,
            beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
            erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
            status, freigegeben_am, freigegeben_von, erstellt_von_art)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                 ($5 || ' 08:00')::timestamp at time zone 'Europe/Berlin',
                 ($5 || ' 08:25')::timestamp at time zone 'Europe/Berlin',
                 0, 'import', 'import', 'import', 'import',
                 'abgeschlossen', now(), $6::uuid, 'system')`,
        [f.bau, a!.id, p!.id, pr!.id, `${String(jahr)}-${tag}`, wer]);
    }

    const [zeile] = await alsBereich(f.bau,
      (k2) => projektReihe(k2, ganzesJahr(jahr)), wer);
    expect(zeile, 'das Projekt liegt im Zeitraum').toBeDefined();
    expect(zeile!.kostenCent).toBe(2125n);
    expect(zeile!.kostenCent).not.toBe(2126n);
    // Und die Marge rechnet auf derselben ganzen Zahl weiter.
    expect(zeile!.auftragssummeCent).toBe(100000n);
    expect(zeile!.margeBp).toBe(9787);
  });
});

describe('(7) die Gruppenfassung teilt auf, statt zu summieren', () => {
  it('je Gesellschaft eine Zeile — mit ihrer eigenen Zahl', async () => {
    const jahr = ganzesJahr(await berlinJahr());
    const wR = await legeLeitungAn(f.reinigung, 'admin');
    const wB = await legeLeitungAn(f.bau, 'admin');
    await macheFakturierfaehig(f.reinigung);
    await macheFakturierfaehig(f.bau);
    await legeRechnungAn(f.reinigung, wR, await legeKundeAn(f.reinigung),
      'festgeschrieben', 1000n);
    await legeRechnungAn(f.bau, wB, await legeKundeAn(f.bau), 'festgeschrieben', 2500n);

    const alle = [f.reinigung, f.security, f.bau, f.operations];
    const chef = await legeGruppenleitungAn();
    const zeilen = await inGruppe(alle, chef, (k) => umsatzJeBereich(k, jahr));

    expect(zeilen.length).toBeGreaterThanOrEqual(4);
    const reinigung = zeilen.find((z) => z.slug === 'reinigung');
    const bau = zeilen.find((z) => z.slug === 'bau');
    expect(reinigung?.rechnungen).toBe(1);
    expect(bau?.rechnungen).toBe(1);
    /*
     * **Die Aufteilung ist vollstaendig.** Die Summe ueber alle Zeilen ist die
     * Gesamtsumme — faellt eine Gesellschaft aus der Abfrage, faellt hier die
     * Zahl, und nicht erst dem auf, der den Bericht liest.
     */
    const gesamt = zeilen.reduce((s, z) => s + z.erloeseCent, 0n);
    expect(gesamt).toBe((reinigung?.erloeseCent ?? 0n) + (bau?.erloeseCent ?? 0n));
    expect(gesamt).toBeGreaterThan(0n);
  });

  /**
   * **Die Gegenprobe zur Zeile darueber.** Genau dieselbe Abfrage, genau
   * dieselben Zeilen — ein anderer Mensch. Der Bereichsadmin bekommt die
   * Gesellschaftsnamen (`mandant` ist in der Gruppenansicht lesbar, sonst
   * stuende dort eine Liste ohne Beschriftung), aber keine einzige Zahl:
   * `gruppe.finanzen.lesen` traegt er nicht. Faellt dieser Test, ist die
   * Gruppenansicht offen fuer jeden, der irgendwo Admin ist.
   */
  it('wer nur im Bereich Admin ist, sieht in der Gruppe keine Zahl', async () => {
    const jahr = ganzesJahr(await berlinJahr());
    const wR = await legeLeitungAn(f.reinigung, 'admin');
    await macheFakturierfaehig(f.reinigung);
    await legeRechnungAn(f.reinigung, wR, await legeKundeAn(f.reinigung),
      'festgeschrieben', 1000n);

    const zeilen = await inGruppe(
      [f.reinigung, f.security, f.bau, f.operations], wR,
      (k) => umsatzJeBereich(k, jahr),
    );
    expect(zeilen.every((z) => z.rechnungen === 0)).toBe(true);
    expect(zeilen.reduce((s, z) => s + z.erloeseCent, 0n)).toBe(0n);
  });
});
