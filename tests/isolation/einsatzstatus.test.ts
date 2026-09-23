import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';

/**
 * **Der Einsatzstatus folgt der erfassten Zeit** (V-082, TIM-01, TIM-07).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `einsatz_status` kennt seit `0028` vier Werte. Geschrieben wurden ZWEI —
 * `geplant` beim Anlegen und `storniert` beim Absagen. `laufend` und
 * `abgeschlossen` setzte nichts, und trotzdem beschriften beide Oberflächen
 * sie. Eine Schicht, die vor drei Wochen gelaufen und abgerechnet ist, stand
 * als „Geplant" da.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier geprüft wird: die ABLEITUNG, nicht ein Zähler.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `04-PLANUNG-ZEIT.md` warnt an genau dieser Tabelle: „two sources of truth
 * would drift within one sprint". `kern.einsatz_status_ableiten` (`0390`)
 * schreibt den Zustand deshalb nicht fort, sondern rechnet ihn jedes Mal neu
 * aus den Zeiteinträgen. Diese Datei prüft genau das: dass ein Storno den
 * Zustand ZURÜCKNIMMT, dass ein Wechsel der Schicht BEIDE nachzieht, und dass
 * `storniert` unberührt bleibt. Ein Test, der nur „Stempeln macht laufend"
 * prüft, hielte auch für einen Zähler, der beim ersten Storno falsch wird.
 */

let f: Fixtur;
let objektId = '';
let personId = '';
let anstellungId = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function baueObjekt(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin')
     returning id`, [mandant, `K-${zufall()}`] as never[]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus Mitte','Teststr. 7','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`] as never[]);
  return o!.id;
}

/** Eine Schicht, deren Ende sich in Stunden von JETZT aus verschieben lässt. */
async function baueEinsatz(
  mandant: string, vonStunden: number, bisStunden: number,
): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, objekt_id, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                          erstellt_von_art)
     values ($1::uuid, 'manuell', $2::uuid,
             (now() + ($3 || ' hours')::interval)::date,
             now() + ($3 || ' hours')::interval,
             now() + ($4 || ' hours')::interval,
             '08:00', '12:00', 'system')
     returning id`,
    [mandant, objektId, String(vonStunden), String(bisStunden)] as never[]);
  return e!.id;
}

/** Ein Zeiteintrag auf dieser Schicht — offen oder geschlossen. */
async function stempel(
  einsatzId: string, o: { readonly offen?: boolean } = {},
): Promise<string> {
  const offen = o.offen ?? false;
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, einsatz_id, objekt_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art)
     values ($1, $2, $3, $4::uuid, $5::uuid,
             now() - interval '3 hours',
             ${offen ? 'null' : `now() - interval '1 hour'`}, 0,
             'import', ${offen ? 'null' : `'import'`}, 'import',
             ${offen ? 'null' : `'import'`},
             ${offen ? `'laufend'` : `'abgeschlossen'`}, 'system')
     returning id`,
    [f.reinigung, anstellungId, personId, einsatzId, objektId] as never[]);
  return z!.id;
}

async function status(einsatzId: string): Promise<string> {
  const [z] = await sql.unsafe<{ status: string }[]>(
    `select status::text as status from einsatz where id = $1`, [einsatzId] as never[]);
  return z!.status;
}

beforeEach(async () => {
  f = await seed();
  objektId = await baueObjekt(f.reinigung);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Aylin', $1) returning id`,
    [`Demir-${zufall()}`] as never[]);
  personId = p!.id;
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
     values ($1,$2,$3,'2026-01-01') returning id`,
    [f.reinigung, personId, `PN-${zufall()}`] as never[]);
  anstellungId = a!.id;
});
afterAll(schliessen);

describe('§1 die Ableitung', () => {
  it('eine frische Schicht ist `geplant` — es ist nichts erfasst', async () => {
    const e = await baueEinsatz(f.reinigung, -4, 4);
    expect(await status(e)).toBe('geplant');
  });

  it('ein OFFENER Eintrag macht sie `laufend`', async () => {
    const e = await baueEinsatz(f.reinigung, -4, 4);
    await stempel(e, { offen: true });
    expect(await status(e)).toBe('laufend');
  });

  it('ein geschlossener Eintrag VOR dem Schichtende lässt sie `laufend`', async () => {
    /*
     * Wer um 11:00 aus einer Schicht bis 14:00 aussteigt, beendet nicht die
     * SCHICHT — er beendet seinen Eintrag. Erst die Uhr über dem Schichtende
     * macht daraus „abgeschlossen", und genau dieses Fenster schliesst der
     * stündliche Lauf.
     */
    const e = await baueEinsatz(f.reinigung, -4, 4);
    await stempel(e);
    expect(await status(e)).toBe('laufend');
  });

  it('ein geschlossener Eintrag NACH dem Schichtende macht sie `abgeschlossen`', async () => {
    const e = await baueEinsatz(f.reinigung, -6, -2);
    await stempel(e);
    expect(await status(e)).toBe('abgeschlossen');
  });

  it('zwei Menschen: solange EINER stempelt, läuft die Schicht', async () => {
    const e = await baueEinsatz(f.reinigung, -6, -2);
    await stempel(e);
    const offen = await stempel(e, { offen: true });
    expect(await status(e)).toBe('laufend');
    /* Und wenn auch der zweite aussteigt, ist sie fertig. */
    await sql.unsafe(
      `update zeiteintrag set ende_zeitpunkt = now(), status = 'abgeschlossen',
                              erfassungsart_ende = 'import', quelle_ende = 'import'
        where id = $1`, [offen] as never[]);
    expect(await status(e)).toBe('abgeschlossen');
  });
});

describe('§2 die Ableitung nimmt auch ZURÜCK — daran scheitert ein Zähler', () => {
  it('ein storniertes Stempelpaar setzt die Schicht auf `geplant` zurück', async () => {
    const e = await baueEinsatz(f.reinigung, -6, -2);
    const z = await stempel(e);
    expect(await status(e)).toBe('abgeschlossen');

    await sql.unsafe(
      `update zeiteintrag set status = 'storniert', storniert_am = now(),
                              storno_grund = 'Falsche Schicht gestempelt.'
        where id = $1`, [z] as never[]);
    /*
     * **Der Fall, für den die Ableitung gebaut ist.** Ein fortgeschriebener
     * Zustand bliebe hier auf `abgeschlossen` stehen, und die stündliche
     * Wache „Schicht beendet, kein Zeiteintrag" fände die Zeile nie wieder —
     * eine verlorene Schicht, die niemand mehr meldet.
     */
    expect(await status(e)).toBe('geplant');
  });

  it('und ein Wechsel der Schicht zieht BEIDE nach', async () => {
    /*
     * **Der Eintrag muss dafür noch LAUFEN.** `z_unveraenderlich` (0034)
     * verbietet an einem abgeschlossenen Eintrag jede Änderung an
     * `einsatz_id` — Korrekturen sind neue Zeilen (TIM-11). Der Wechsel ist
     * also genau das, was er im Betrieb ist: die Disposition rückt einen
     * gerade laufenden Stempel auf die richtige Schicht.
     */
    const alt = await baueEinsatz(f.reinigung, -6, 2);
    const neu = await baueEinsatz(f.reinigung, -6, 2);
    const z = await stempel(alt, { offen: true });
    expect(await status(alt)).toBe('laufend');
    expect(await status(neu)).toBe('geplant');

    await sql.unsafe(
      `update zeiteintrag set einsatz_id = $2 where id = $1`, [z, neu] as never[]);
    /*
     * Ohne das Nachziehen der ALTEN Zeile bliebe sie auf `laufend`, obwohl
     * dort nichts mehr erfasst ist — und die stündliche Wache „Schicht
     * beendet, kein Zeiteintrag" sähe sie nie wieder.
     */
    expect(await status(alt)).toBe('geplant');
    expect(await status(neu)).toBe('laufend');
  });
});

describe('§3 was die Ableitung NICHT anfasst', () => {
  it('eine stornierte Schicht bleibt storniert — auch mit erfasster Zeit', async () => {
    /*
     * Eine abgesagte Schicht, auf die jemand Zeit erfasst hat, ist ein Befund
     * für die Disposition. Ein Auslöser, der sie stillschweigend wieder
     * aufmacht, räumte den Befund weg, statt ihn zu zeigen.
     */
    const e = await baueEinsatz(f.reinigung, -6, -2);
    await sql.unsafe(
      `update einsatz set status = 'storniert', storniert_am = now(),
                          storno_grund = 'Objekt geschlossen.'
        where id = $1`, [e] as never[]);
    await stempel(e);
    expect(await status(e)).toBe('storniert');
  });

  it('ein Eintrag OHNE Schicht rührt nichts an', async () => {
    const e = await baueEinsatz(f.reinigung, -6, -2);
    await sql.unsafe(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, objekt_id,
          beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
          erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
          status, erstellt_von_art)
       values ($1,$2,$3,$4::uuid, now() - interval '3 hours', now() - interval '1 hour',
               0, 'import','import','import','import','abgeschlossen','system')`,
      [f.reinigung, anstellungId, personId, objektId] as never[]);
    expect(await status(e)).toBe('geplant');
  });
});

describe('§4 der Lauf für den Schwanz', () => {
  it('schliesst die Schicht, deren Ende inzwischen vorbeigegangen ist', async () => {
    /*
     * Der Fall, den kein Auslöser sieht: der letzte Mensch ist ausgestiegen,
     * die Schicht lief noch, und danach stempelt niemand mehr. Die Ableitung
     * ist dieselbe — sie wird nur von aussen angestossen.
     */
    const e = await baueEinsatz(f.reinigung, -4, 4);
    await stempel(e);
    expect(await status(e)).toBe('laufend');

    /* Die Uhr läuft über das Ende: hier vorgeführt, indem das Ende rückt. */
    await sql.unsafe(
      `update einsatz set ende_zeitpunkt = now() - interval '5 minutes'
        where id = $1`, [e] as never[]);
    /* Das UPDATE an `einsatz` löst nichts aus — der Zustand steht noch falsch. */
    expect(await status(e)).toBe('laufend');

    await alsRolle('', (tx) => tx.unsafe(
      `select kern.einsatz_status_ableiten($1::uuid)`, [e] as never[]));
    expect(await status(e)).toBe('abgeschlossen');
  });

  it('und lässt eine Schicht ohne jede Zeit in Ruhe', async () => {
    const e = await baueEinsatz(f.reinigung, -6, -2);
    await alsRolle('', (tx) => tx.unsafe(
      `select kern.einsatz_status_ableiten($1::uuid)`, [e] as never[]));
    /*
     * Sie bleibt `geplant` — und genau so findet die stündliche Wache sie und
     * meldet „Schicht beendet, kein Zeiteintrag".
     */
    expect(await status(e)).toBe('geplant');
  });
});
