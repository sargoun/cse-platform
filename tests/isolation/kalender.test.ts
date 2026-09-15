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
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { kalenderZeilen } from '../../src/server/services/kalender/eintraege.js';

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
