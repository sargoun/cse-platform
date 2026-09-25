/**
 * Der zentrale Kalender gegen echte Rechte (CAL-01, CAL-02).
 *
 * **Der Satz, den diese Datei beweist:** der Kalender zeigt genau die Zeilen,
 * die dieser Mensch in seiner Gesellschaft sehen darf — und er zeigt sie aus
 * ihrer QUELLE, nicht aus einer Kopie.
 *
 *  1. Ein Termin der einen Gesellschaft erscheint nicht in der anderen.
 *  2. Eine im Dienstplan verschobene Schicht ist im Kalender verschoben,
 *     ohne dass irgendjemand den Kalender angefasst hätte.
 *  3. Der persönliche Kalender ist persönlich: fremde Schichten fehlen.
 *  4. Ohne `kalender.lesen` ist er leer — und zwar leer, nicht fehlerhaft.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { kalenderZeilen, type Quelle } from '../../src/server/services/kalender/eintraege.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeKontoAn(mandantId: string, rolle = 'leitung'): Promise<string> {
  const email = `kal-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

async function legeTerminAn(
  mandantId: string, besitzer: string, titel: string,
  inStunden = 4, teilnehmer: readonly string[] = [],
): Promise<string> {
  const [t] = await sql.unsafe<{ id: string }[]>(
    `insert into kalender_eintrag
       (mandant_id, art, titel, beginn, ende, besitzer_benutzer_id, teilnehmer, ort)
     values ($1::uuid, 'besprechung', $2,
             now() + ($3 || ' hours')::interval,
             now() + (($3::int + 1) || ' hours')::interval,
             $4::uuid, $5::uuid[], 'Kurfürstendamm 21')
     returning id`,
    [mandantId, titel, String(inStunden), besitzer, teilnehmer as never]);
  return t!.id;
}

/** Heute ± sieben Tage, als Berliner Kalendertage. */
async function fenster(): Promise<{ von: string; bis: string; bezeichnung: string }> {
  const [z] = await sql.unsafe<{ von: string; bis: string }[]>(
    `select (app.berlin_heute() - 7)::text as von, (app.berlin_heute() + 7)::text as bis`);
  return { von: z!.von, bis: z!.bis, bezeichnung: 'Fenster' };
}

async function alsBereich<T>(
  mandantId: string, benutzerId: string,
  fn: (k: { abfrage: <R>(s: string, w?: readonly unknown[]) => Promise<readonly R[]> })
    => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: true },
    async (tx: postgres.TransactionSql) => fn({
      abfrage: async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        (await tx.unsafe(s, (w ?? []) as never[])) as unknown as readonly R[],
    }),
  ) as Promise<T>;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) die Mandantengrenze gilt auch für Termine', () => {
  it('ein Termin der Reinigung erscheint nicht im Kalender des Baus', async () => {
    const wR = await legeKontoAn(f.reinigung);
    const wB = await legeKontoAn(f.bau);
    await legeTerminAn(f.reinigung, wR, 'Objektbegehung Mitte');

    const z = await fenster();
    const inReinigung = await alsBereich(f.reinigung, wR,
      (k) => kalenderZeilen(k, { zeitraum: z }));
    const imBau = await alsBereich(f.bau, wB,
      (k) => kalenderZeilen(k, { zeitraum: z }));

    expect(inReinigung.map((e) => e.titel)).toContain('Objektbegehung Mitte');
    expect(imBau.map((e) => e.titel)).not.toContain('Objektbegehung Mitte');
  });

  /**
   * **Ohne `kalender.lesen` ist der Kalender leer, nicht kaputt.**
   * `mitarbeiter` hält das Recht nicht; die Policy `t_kalender_eigene` lässt
   * ihn trotzdem seine EIGENEN Termine sehen — und genau nur die.
   */
  it('ein Mitarbeiterkonto sieht seinen eigenen Termin und keinen fremden', async () => {
    const chef = await legeKontoAn(f.reinigung);
    const mensch = await legeKontoAn(f.reinigung, 'mitarbeiter');
    await legeTerminAn(f.reinigung, chef, 'Leitungsrunde');
    await legeTerminAn(f.reinigung, chef, 'Einweisung', 5, [mensch]);

    const z = await fenster();
    const titel = (await alsBereich(f.reinigung, mensch,
      (k) => kalenderZeilen(k, { zeitraum: z, nurQuellen: ['termin'] })))
      .map((e) => e.titel);

    expect(titel, 'als Teilnehmer geladen').toContain('Einweisung');
    expect(titel, 'die Leitungsrunde geht ihn nichts an').not.toContain('Leitungsrunde');
  });
});

describe('(2) der Kalender liest die Quelle, er kopiert sie nicht', () => {
  /**
   * **Der Kern von CAL-01.** Die Schicht wird im DIENSTPLAN verschoben —
   * niemand fasst den Kalender an. Zeigte er eine Kopie, stünde sie weiterhin
   * zur alten Zeit, und die Frage „wann arbeitet dieser Mensch" hätte zwei
   * Antworten.
   */
  it('eine verschobene Schicht ist im Kalender verschoben', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name)
       values ($1::uuid, $2, 'Bezirksamt') returning id`, [f.reinigung, `K-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort, kunde_id)
       values ($1::uuid, $2, 'Dienstgebäude Mitte', 'Musterweg 1', '10178', 'Berlin', $3::uuid)
       returning id`, [f.reinigung, `OBJ-${zufall()}`, k!.id]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz
         (mandant_id, quelle, quell_schluessel, plan_datum, beginn_zeitpunkt, ende_zeitpunkt,
          zeitzone, beginn_lokal, ende_lokal, endet_am_folgetag, objekt_id,
          soll_besetzung, min_besetzung, status, erstellt_von_art)
       select $1::uuid, 'manuell', $2, app.berlin_heute(),
              (app.berlin_heute()::timestamp + interval '8 hours') at time zone 'Europe/Berlin',
              (app.berlin_heute()::timestamp + interval '12 hours') at time zone 'Europe/Berlin',
              'Europe/Berlin',
              app.berlin_heute()::timestamp + interval '8 hours',
              app.berlin_heute()::timestamp + interval '12 hours',
              false, $3::uuid, 1, 1, 'geplant', 'system'
       returning id`, [f.reinigung, `k-${zufall()}`, o!.id]);

    const z = await fenster();
    const vorher = (await alsBereich(f.reinigung, wer,
      (kk) => kalenderZeilen(kk, { zeitraum: z, nurQuellen: ['einsatz'] })))
      .find((x) => x.id === e!.id);
    expect(vorher, 'die Schicht steht im Kalender').toBeDefined();
    const alt = vorher!.beginn;

    // Verschoben wird im DIENSTPLAN — der Kalender wird nicht angefasst.
    await sql.unsafe(
      `update einsatz
          set beginn_zeitpunkt = beginn_zeitpunkt + interval '3 hours',
              ende_zeitpunkt   = ende_zeitpunkt   + interval '3 hours',
              beginn_lokal = beginn_lokal + interval '3 hours',
              ende_lokal   = ende_lokal   + interval '3 hours'
        where id = $1::uuid`, [e!.id]);

    const nachher = (await alsBereich(f.reinigung, wer,
      (kk) => kalenderZeilen(kk, { zeitraum: z, nurQuellen: ['einsatz'] })))
      .find((x) => x.id === e!.id);
    expect(nachher!.beginn, 'dieselbe Zeile, also dieselbe Wahrheit').not.toBe(alt);
  });
});

/**
 * **Das Bewerbungsgespräch steht im Kalender — die Zusage hatte keine
 * Deckung** (CAL-01, REC-06, D-578).
 *
 * Das Bewerbungsblatt meldete nach dem Anlegen: „Er erscheint in der
 * Gesprächsliste und im Kalender dieser Gesellschaft." Der erste Halbsatz
 * stimmte. Der zweite war falsch: der Kalender las `kalender_eintrag`,
 * `einsatz`, `projekt`, `ausschreibung_vorgang`, `freigabe` und `lead` —
 * `gespraech` stand nicht darunter, und keine Prüfung hat je danach gesehen.
 * Gemeldet hat es die Copilot-Runde auf PR 16.
 *
 * Dieser Fall geht denselben Weg wie die Zusage: Gespräch anlegen, Kalender
 * lesen, Zeile finden.
 */
describe('(2b) ein Bewerbungsgespraech steht im Kalender (CAL-01, REC-06)', () => {
  async function legeGespraechAn(
    mandantId: string, wer: string, name: string, inTagen = 2,
  ): Promise<string> {
    const [st] = await sql.unsafe<{ id: string }[]>(
      `insert into stelle (mandant_id, titel, beschreibung, einsatzort, wochenstunden,
                           status, entwurf_von_art)
       values ($1::uuid, 'Reinigungskraft', 'Beschreibung', 'Berlin', 30,
               'entwurf'::stelle_status, 'mensch'::akteur_art)
       returning id`, [mandantId]);
    const [bw] = await sql.unsafe<{ id: string }[]>(
      `insert into bewerbung (mandant_id, stelle_id, quelle, status, name, email,
                              eingegangen_am, aufbewahrung_bis)
       values ($1::uuid, $2::uuid, 'karriereseite'::bewerbung_quelle,
               'eingegangen'::bewerbung_status, $3, 'probe@example.org',
               now(), app.berlin_heute() + 180)
       returning id`, [mandantId, st!.id, name]);
    const [g] = await sql.unsafe<{ id: string }[]>(
      `insert into gespraech (mandant_id, bewerbung_id, termin, dauer_minuten,
                              ort, erstellt_von)
       values ($1::uuid, $2::uuid, now() + ($3::int * interval '1 day'), 45,
               'Büro Neukölln', $4::uuid)
       returning id`, [mandantId, bw!.id, inTagen, wer]);
    return g!.id;
  }

  it('der Termin erscheint, mit Namen, Ort und einem Weg zur Bewerbung', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    const gespraechId = await legeGespraechAn(f.reinigung, wer, 'Fatima Nasser');

    const z = await fenster();
    const zeilen = await alsBereich(f.reinigung, wer,
      (k) => kalenderZeilen(k, { zeitraum: z }));
    const zeile = zeilen.find((e) => e.id === gespraechId);

    expect(zeile, 'das Gespraech fehlte im Kalender — genau der Befund').toBeDefined();
    expect(zeile!.quelle).toBe('gespraech');
    expect(zeile!.titel, 'der Name steht dran, sonst ist es ein Balken').toContain('Fatima');
    expect(zeile!.ort).toBe('Büro Neukölln');
    expect(zeile!.weg, 'von der Zeile zur Bewerbung').toContain('/recruiting/bewerbungen/');
    expect(zeile!.abgesagt).toBe(false);
  });

  /**
   * **Die Wand ist die Policy, nicht diese Datei.** `t_gespraech_lesen` (0166)
   * verlangt `recruiting.bewerbung_lesen`. Ein Kalender, der „Gespräch mit
   * Frau X" zeigt, verriete sonst eine Bewerbung an jeden, der Termine sehen
   * darf.
   */
  it('eine fremde Gesellschaft sieht das Gespraech nicht', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    const gespraechId = await legeGespraechAn(f.reinigung, wer, 'Fatima Nasser');
    const fremd = await legeKontoAn(f.bau, 'admin');

    const z = await fenster();
    const zeilen = await alsBereich(f.bau, fremd, (k) => kalenderZeilen(k, { zeitraum: z }));
    expect(zeilen.find((e) => e.id === gespraechId)).toBeUndefined();
  });

  it('ein abgesagtes Gespraech steht als abgesagt da, nicht als geloescht', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    const gespraechId = await legeGespraechAn(f.reinigung, wer, 'Fatima Nasser');
    /*
     * Seit 0471 (V-220) gibt es „abgesagt" nur mit Zeitpunkt und Grund
     * (`gespraech_absage_vollstaendig`) — der Weg des Dienstes steht in
     * `recruiting-gespraech.test.ts`; hier zählt nur, was der Kalender zeigt.
     */
    await sql.unsafe(
      `update gespraech set status = 'abgesagt'::gespraech_status, abgesagt_am = now(),
              abgesagt_grund = 'Bewerberin hat abgesagt'
        where id = $1::uuid`,
      [gespraechId]);

    const z = await fenster();
    const zeilen = await alsBereich(f.reinigung, wer,
      (k) => kalenderZeilen(k, { zeitraum: z }));
    const zeile = zeilen.find((e) => e.id === gespraechId);
    expect(zeile, 'es verschwindet nicht — wer hinsieht, soll die Absage sehen')
      .toBeDefined();
    expect(zeile!.abgesagt).toBe(true);
  });
});

describe('(3) die Filter der Seite (CAL-02)', () => {
  it('nach Herkunft gefiltert bleibt nur die gewählte', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    await legeTerminAn(f.reinigung, wer, 'Besprechung');

    const z = await fenster();
    const nurTermine = await alsBereich(f.reinigung, wer,
      (k) => kalenderZeilen(k, { zeitraum: z, nurQuellen: ['termin'] }));
    expect(nurTermine.every((e) => e.quelle === 'termin')).toBe(true);

    const nurSchichten = await alsBereich(f.reinigung, wer,
      (k) => kalenderZeilen(k, { zeitraum: z, nurQuellen: ['einsatz'] }));
    expect(nurSchichten.every((e) => e.quelle === 'einsatz')).toBe(true);
  });

  it('nach Mensch gefiltert bleibt, woran er beteiligt ist', async () => {
    const chef = await legeKontoAn(f.reinigung, 'admin');
    const andere = await legeKontoAn(f.reinigung, 'leitung');
    await legeTerminAn(f.reinigung, chef, 'Nur Chef');
    await legeTerminAn(f.reinigung, andere, 'Nur andere', 6);

    const z = await fenster();
    const seine = await alsBereich(f.reinigung, chef,
      (k) => kalenderZeilen(k, { zeitraum: z, nurBenutzerId: chef }));
    expect(seine.map((e) => e.titel)).toContain('Nur Chef');
    expect(seine.map((e) => e.titel)).not.toContain('Nur andere');
  });

  /**
   * **Jede Zeile trägt einen Weg.** Ein Kalender, aus dem man nicht zum
   * Vorgang kommt, ist ein Bild: man sieht, dass etwas ansteht, und muss es
   * anderswo suchen.
   */
  it('jede Zeile führt zu ihrem Vorgang', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    await legeTerminAn(f.reinigung, wer, 'Mit Weg');
    const z = await fenster();
    const zeilen = await alsBereich(f.reinigung, wer,
      (k) => kalenderZeilen(k, { zeitraum: z }));
    for (const e of zeilen) {
      expect(e.weg, e.titel).not.toBeNull();
      expect(e.weg!.startsWith('/portal/reinigung/')).toBe(true);
    }
  });
});

describe('(4) eine Absage verschwindet nicht, sie ist abgesagt', () => {
  it('der abgesagte Termin bleibt in der Liste und trägt das Kennzeichen', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    const id = await legeTerminAn(f.reinigung, wer, 'Fällt aus');
    await sql.unsafe(
      `update kalender_eintrag set abgesagt_am = now(),
              abgesagt_grund = 'Kunde hat verschoben.' where id = $1::uuid`, [id]);

    const z = await fenster();
    const zeile = (await alsBereich(f.reinigung, wer,
      (k) => kalenderZeilen(k, { zeitraum: z, nurQuellen: ['termin'] })))
      .find((e) => e.id === id);
    expect(zeile, 'wer ihn im Kalender hat, bekommt ihn sonst nie los').toBeDefined();
    expect(zeile!.abgesagt).toBe(true);
  });
});

/**
 * **(5) Die Nacht zwischen Mitternacht und zwei Uhr** (Invariante 2).
 *
 * `freigabe.frist`, `ausschreibung.frist_angebot` und `lead.sla_frist_am` sind
 * `timestamptz`. Ein `::date` darauf rechnet in der Zeitzone der
 * DATENBANKSITZUNG — und die ist UTC: weder `db/pool.ts` noch eine Migration
 * setzt `TimeZone`. Eine Frist am 25. Oktober um 00:30 Berliner Zeit hat das
 * UTC-Datum 2026-10-24: sie fiel in den Vortag und wurde vom Fenster eines
 * Tages früher gefangen, während die Seite sie berlinerisch am 25. zeichnete.
 */
describe('(5) eine Frist kurz nach Mitternacht gehört dem Berliner Tag', () => {
  async function legeFreigabeAn(mandantId: string, frist: string): Promise<string> {
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, titel, status, frist)
       values ($1::uuid, 'pruefen', 'Frist um halb eins', 'offen', $2::timestamptz)
       returning id`, [mandantId, frist]);
    return z!.id;
  }

  it('00:30 Berliner Zeit steht am Berliner Tag, nicht am UTC-Vortag', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    /*
     * Ein Tag im Fenster, dessen Berliner und UTC-Datum auseinanderfallen —
     * gerechnet aus dem heutigen Berliner Tag, damit der Test nicht an einem
     * festen Datum hängt.
     */
    const [t] = await sql.unsafe<{ tag: string; instant: string }[]>(
      `select (app.berlin_heute() + 3)::text as tag,
              (((app.berlin_heute() + 3)::timestamp + interval '30 minutes')
                at time zone 'Europe/Berlin')::text as instant`);
    const id = await legeFreigabeAn(f.reinigung, t!.instant);

    /* Ein Fenster, das GENAU diesen einen Berliner Tag umfasst. */
    const zeilen = await alsBereich(f.reinigung, wer, (k) => kalenderZeilen(k, {
      zeitraum: { von: t!.tag, bis: t!.tag, bezeichnung: 'ein Tag' },
      nurQuellen: ['freigabe'],
    }));
    expect(zeilen.map((e) => e.id), 'der Berliner Tag findet sie').toContain(id);

    /* Und der Vortag, auf dem sie als UTC-Datum gestanden hätte, findet sie nicht. */
    const [v] = await sql.unsafe<{ tag: string }[]>(
      `select (app.berlin_heute() + 2)::text as tag`);
    const vortag = await alsBereich(f.reinigung, wer, (k) => kalenderZeilen(k, {
      zeitraum: { von: v!.tag, bis: v!.tag, bezeichnung: 'Vortag' },
      nurQuellen: ['freigabe'],
    }));
    expect(vortag.map((e) => e.id), 'und der Vortag nicht').not.toContain(id);
  });
});

/**
 * **(6) Der Weg trägt den Slug der ZEILE.**
 *
 * Er kam vorher als Zeichenkette aus der Anfrage und stand unmaskiert in sechs
 * Abfragen — ein Wert aus einer Anfrage in einer SQL-Zeichenkette, und
 * ausserdem EIN Slug für alle Zeilen. Im persönlichen Kalender eines
 * Menschen, der in zwei Gesellschaften arbeitet, stammen die Zeilen aus
 * beiden, und die Hälfte der Wege zeigte auf die falsche.
 */
describe('(6) der Weg kommt aus der Zeile, nicht aus einem Textbaustein', () => {
  it('jede Zeile führt in die Gesellschaft, in der sie steht', async () => {
    const wB = await legeKontoAn(f.bau, 'admin');
    await legeTerminAn(f.bau, wB, 'Bauanlauf');
    const z = await fenster();
    const zeilen = await alsBereich(f.bau, wB,
      (k) => kalenderZeilen(k, { zeitraum: z, nurQuellen: ['termin'] }));
    expect(zeilen.length).toBeGreaterThan(0);
    for (const e of zeilen) {
      expect(e.weg, e.titel).toMatch(/^\/portal\/bau\//u);
    }
  });
});

/**
 * **Jeder Weg ist eine gebaute Seite** (V-243, D-737).
 *
 * `(3)` prüfte, DASS jede Zeile einen Weg trägt, und `(6)`, dass er in die
 * richtige Gesellschaft zeigt — nicht, dass es die Seite am Ende gibt. So
 * standen zwei tote Ziele unbemerkt im Dienst: eine Schicht führte auf
 * `/dienstplan` (keine Wurzelseite), eine Vergabefrist auf
 * `/radar/vorgaenge/<id>` (nie gebaut). Gefunden hat es erst der Verweislauf
 * der Browsersuite. Hier wird jede Zeile auf eine Datei unter `src/app`
 * abgebildet — eine Kennung wird `[id]`, der Slug `[mandant]` —, und die
 * Schicht und die Frist tragen ihr genaues Ziel.
 */
describe('(7) jeder Weg führt auf eine Seite, die es gibt', () => {
  it('Schicht → ihre Einsatzseite, Vergabefrist → die Bekanntmachung', async () => {
    const wer = await legeKontoAn(f.reinigung, 'admin');
    await legeTerminAn(f.reinigung, wer, 'Mit Seite');
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name)
       values ($1::uuid, $2, 'Bezirksamt') returning id`, [f.reinigung, `K-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort, kunde_id)
       values ($1::uuid, $2, 'Dienstgebäude Süd', 'Musterweg 2', '10178', 'Berlin', $3::uuid)
       returning id`, [f.reinigung, `OBJ-${zufall()}`, k!.id]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz
         (mandant_id, quelle, quell_schluessel, plan_datum, beginn_zeitpunkt, ende_zeitpunkt,
          zeitzone, beginn_lokal, ende_lokal, endet_am_folgetag, objekt_id,
          soll_besetzung, min_besetzung, status, erstellt_von_art)
       select $1::uuid, 'manuell', $2, app.berlin_heute(),
              (app.berlin_heute()::timestamp + interval '8 hours') at time zone 'Europe/Berlin',
              (app.berlin_heute()::timestamp + interval '12 hours') at time zone 'Europe/Berlin',
              'Europe/Berlin',
              app.berlin_heute()::timestamp + interval '8 hours',
              app.berlin_heute()::timestamp + interval '12 hours',
              false, $3::uuid, 1, 1, 'geplant', 'system'
       returning id`, [f.reinigung, `k-${zufall()}`, o!.id]);
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into ausschreibung (quelle, quell_id, titel, sprache, rohdaten_hash, frist_angebot)
       values ('oeffentlichevergabe', $1, 'Glasreinigung Rathaus', 'de', $2,
               now() + interval '3 days')
       returning id`, [`kal-${zufall()}`, `${zufall()}${zufall()}`]);
    await sql.unsafe(
      `insert into ausschreibung_vorgang (mandant_id, ausschreibung_id)
       values ($1::uuid, $2::uuid)`, [f.reinigung, a!.id]);

    const z = await fenster();
    const zeilen = await alsBereich(f.reinigung, wer,
      (kk) => kalenderZeilen(kk, { zeitraum: z }));

    const schicht = zeilen.find((x) => x.quelle === 'einsatz' && x.id === e!.id);
    expect(schicht?.weg).toBe(`/portal/reinigung/dienstplan/einsatz/${e!.id}`);
    const frist = zeilen.find((x) => x.quelle === 'vergabe' && x.weg?.endsWith(a!.id) === true);
    expect(frist?.weg).toBe(`/portal/reinigung/radar/${a!.id}`);

    const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
    const wurzel = fileURLToPath(new URL('../../src/app', import.meta.url));
    expect(zeilen.length).toBeGreaterThanOrEqual(3);
    for (const zeile of zeilen) {
      const teile = zeile.weg!.split('/').filter((t) => t !== '');
      expect(teile[0], zeile.weg!).toBe('portal');
      const form = ['portal', '[mandant]',
        ...teile.slice(2).map((t) => (KENNUNG.test(t) ? '[id]' : t))];
      expect(existsSync(join(wurzel, ...form, 'page.tsx')), `${zeile.quelle}: ${zeile.weg!}`)
        .toBe(true);
    }
  });

  /**
   * **Alle sieben Quellen — nicht die drei, die zufällig da sind** (V-253).
   *
   * Der Fall darüber legt Termin, Schicht und Frist an und prüft danach
   * „jede Zeile". Projektende, Freigabe, Anfrage und Gespräch kamen darin
   * nur vor, wenn der Seed des Harness zufällig eine solche Zeile im Fenster
   * hatte — die Überschrift versprach mehr, als der Fall prüfte. Hier legt
   * die Fixtur jede Quelle selbst an, im Bau (dort gibt es Projekte), und
   * `ZIEL` ist ein `Record<Quelle, …>`: eine achte Quelle ohne Eintrag ist
   * ein Typfehler dieser Datei (tsc) und kein stilles Auslassen.
   */
  it('jede der sieben Quellen führt auf ihr genaues Ziel, und das Ziel ist gebaut', async () => {
    /*
     * `gueltig_ab` ausdrücklich gestern: der Auftrag des Projekts verlangt
     * einen Verantwortlichen, und dessen Prüfung (0025) fragt mit
     * `current_date` — zwischen 22:00 und 24:00 UTC ist der Berliner
     * Vorgabewert der Mitgliedschaft schon morgen (siehe bau-abnahme.test.ts).
     */
    const email = `kal-${zufall()}@cse.test`;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    const wer = u!.id;
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1, $2, 'Bauleitung', 'aktiv')`,
      [wer, email]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard, gueltig_ab)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
               true, current_date - 1)`, [wer, f.bau]);

    const termin = await legeTerminAn(f.bau, wer, 'Baubesprechung');

    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name)
       values ($1::uuid, $2, 'Bauherr Nord') returning id`, [f.bau, `K-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort, kunde_id)
       values ($1::uuid, $2, 'Baustelle Nord', 'Musterweg 3', '10178', 'Berlin', $3::uuid)
       returning id`, [f.bau, `OBJ-${zufall()}`, k!.id]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz
         (mandant_id, quelle, quell_schluessel, plan_datum, beginn_zeitpunkt, ende_zeitpunkt,
          zeitzone, beginn_lokal, ende_lokal, endet_am_folgetag, objekt_id,
          soll_besetzung, min_besetzung, status, erstellt_von_art)
       select $1::uuid, 'manuell', $2, app.berlin_heute(),
              (app.berlin_heute()::timestamp + interval '8 hours') at time zone 'Europe/Berlin',
              (app.berlin_heute()::timestamp + interval '12 hours') at time zone 'Europe/Berlin',
              'Europe/Berlin',
              app.berlin_heute()::timestamp + interval '8 hours',
              app.berlin_heute()::timestamp + interval '12 hours',
              false, $3::uuid, 1, 1, 'geplant', 'system'
       returning id`, [f.bau, `k-${zufall()}`, o!.id]);

    const [au] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1::uuid, $2, $3::uuid, 'projekt', 'aktiv', 'Rohbau Nord', $4::uuid,
               '2026-01-01')
       returning id`, [f.bau, `AU-${zufall()}`, k!.id, wer]);
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                            vertragsgrundlage, soll_ende)
       values ($1::uuid, $2::uuid, $3, 'Rohbau Nord', $4::uuid, 'hochbau', 'vob_b',
               app.berlin_heute() + 2)
       returning id`, [f.bau, au!.id, `P-${zufall()}`, k!.id]);

    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into ausschreibung (quelle, quell_id, titel, sprache, rohdaten_hash, frist_angebot)
       values ('oeffentlichevergabe', $1, 'Rohbau Schule', 'de', $2, now() + interval '3 days')
       returning id`, [`kal-${zufall()}`, `${zufall()}${zufall()}`]);
    const [v] = await sql.unsafe<{ id: string }[]>(
      `insert into ausschreibung_vorgang (mandant_id, ausschreibung_id)
       values ($1::uuid, $2::uuid) returning id`, [f.bau, a!.id]);

    const [fr] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, titel, status, frist)
       values ($1::uuid, 'pruefen', 'Nachtrag prüfen', 'offen', now() + interval '2 days')
       returning id`, [f.bau]);

    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into lead (mandant_id, leadnummer, betreff, firma_name, akteur_art, quelle,
                         besitzer_benutzer_id, sla_frist_am)
       values ($1::uuid, $2, 'Anfrage Rohbau', 'Bauherr GmbH', 'mensch', 'manuell', $3::uuid,
               now() + interval '1 day')
       returning id`, [f.bau, `LD-${zufall()}`, wer]);

    const [st] = await sql.unsafe<{ id: string }[]>(
      `insert into stelle (mandant_id, titel, beschreibung, einsatzort, wochenstunden,
                           status, entwurf_von_art)
       values ($1::uuid, 'Polier', 'Beschreibung', 'Berlin', 40,
               'entwurf'::stelle_status, 'mensch'::akteur_art)
       returning id`, [f.bau]);
    const [bw] = await sql.unsafe<{ id: string }[]>(
      `insert into bewerbung (mandant_id, stelle_id, quelle, status, name, email,
                              eingegangen_am, aufbewahrung_bis)
       values ($1::uuid, $2::uuid, 'karriereseite'::bewerbung_quelle,
               'eingegangen'::bewerbung_status, 'Jonas Probe', 'probe@example.org',
               now(), app.berlin_heute() + 180)
       returning id`, [f.bau, st!.id]);
    const [g] = await sql.unsafe<{ id: string }[]>(
      `insert into gespraech (mandant_id, bewerbung_id, termin, dauer_minuten, ort, erstellt_von)
       values ($1::uuid, $2::uuid, now() + interval '2 days', 45, 'Baubüro', $3::uuid)
       returning id`, [f.bau, bw!.id, wer]);

    const ZIEL: Readonly<Record<Quelle, { readonly id: string; readonly weg: string }>> = {
      termin: { id: termin, weg: `/portal/bau/kalender/${termin}` },
      einsatz: { id: e!.id, weg: `/portal/bau/dienstplan/einsatz/${e!.id}` },
      projekt: { id: p!.id, weg: `/portal/bau/bau/projekte/${p!.id}` },
      vergabe: { id: v!.id, weg: `/portal/bau/radar/${a!.id}` },
      freigabe: { id: fr!.id, weg: `/portal/bau/freigaben/${fr!.id}` },
      gespraech: { id: g!.id, weg: `/portal/bau/recruiting/bewerbungen/${bw!.id}` },
      lead: { id: l!.id, weg: `/portal/bau/crm/leads/${l!.id}` },
    };

    const z = await fenster();
    const zeilen = await alsBereich(f.bau, wer, (kk) => kalenderZeilen(kk, { zeitraum: z }));

    const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
    const wurzel = fileURLToPath(new URL('../../src/app', import.meta.url));
    for (const [quelle, ziel] of Object.entries(ZIEL) as [Quelle, typeof ZIEL[Quelle]][]) {
      const zeile = zeilen.find((x) => x.quelle === quelle && x.id === ziel.id);
      expect(zeile, `${quelle}: die Zeile der Fixtur fehlt im Kalender`).toBeDefined();
      expect(zeile!.weg, quelle).toBe(ziel.weg);

      const teile = ziel.weg.split('/').filter((t) => t !== '');
      const form = ['portal', '[mandant]',
        ...teile.slice(2).map((t) => (KENNUNG.test(t) ? '[id]' : t))];
      expect(existsSync(join(wurzel, ...form, 'page.tsx')), `${quelle}: ${ziel.weg}`)
        .toBe(true);
    }
  });
});
