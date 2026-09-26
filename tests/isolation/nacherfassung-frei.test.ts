/**
 * Eine Arbeitszeit nacherfassen, zu der es KEIN Gerätereignis gibt
 * (V-066, V-067, TIM-09, TIM-11, EMP-07, Invariante 5).
 *
 * **Der Befund, den diese Datei festnagelt.** `uebernimmAnspruch` macht aus
 * einem `offline_ereignis` einen Zeiteintrag — aus der Behauptung eines
 * Telefons ohne Netz. Das war der EINZIGE Weg, auf dem ein Zeiteintrag
 * nachträglich entstand. Zwei Stellen verlangen das Gegenteil: die
 * Wächtermeldung „Kein Zeiteintrag" bei einer Schicht, zu der niemand
 * gestempelt hat, und ein anerkannter Einwand der Art `eintrag_fehlt`, bei
 * dem `zeiteintrag_id` per §6.27 NULL ist — da gibt es nichts zu korrigieren.
 *
 * Geprüft wird, was dabei leise falsch werden kann:
 *
 *  1. **Die Spur.** Eine eingetragene Zeit muss als eingetragen erkennbar
 *     bleiben — sonst sieht sie im Streit aus wie eine gestempelte.
 *  2. **EMP-07.** Niemand erfasst die eigene Zeit nach.
 *  3. **Das Recht.** `zeit.nacherfassung_pruefen` ist die Entscheidung.
 *  4. **Die Zukunft.** Was noch nicht war, wird nicht nacherfasst.
 *  5. **Der Einwand bekommt seine Antwort** (V-067).
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  erfasseZeitNach, NacherfassungFehler,
} from '../../src/server/services/zeit/nacherfassung.js';

let f: Fixtur;
let planer = '';
let jonasKonto = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

function kontextAus(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(b: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: b,
           portal: 'intern', readonly: false }, fn);

beforeAll(async () => {
  f = await seed();

  const email = `nacherfassung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  planer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [planer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1,$2,'Nacherfassung','aktiv',
             (select id from rolle where schluessel='super_admin' and mandant_id is null))`,
    [planer, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [planer, f.reinigung, await rolleId('admin')]);

  /* Jonas bekommt ein Konto — fuer die EMP-07-Pruefung. */
  const jEmail = `jonas-nach-${zufall()}@cse.test`;
  const [ju] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [jEmail]);
  jonasKonto = ju!.id;
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,'Jonas','aktiv',$3)`, [jonasKonto, jEmail, f.jonas]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [jonasKonto, f.reinigung, await rolleId('admin')]);
});
afterAll(schliessen);

async function zeile(id: string): Promise<{
  nacherfasst: boolean; quelle_beginn: string; quelle_ende: string | null;
  erfassungsart_beginn: string; behauptet_beginn: Date | null;
  behauptet_ende: Date | null; status: string; notiz: string | null;
  dauer_netto_minuten: number | null; person_id: string;
}> {
  const [z] = await sql.unsafe(
    `select nacherfasst, quelle_beginn::text as quelle_beginn,
            quelle_ende::text as quelle_ende,
            erfassungsart_beginn::text as erfassungsart_beginn,
            behauptet_beginn, behauptet_ende, status::text as status, notiz,
            dauer_netto_minuten, person_id
       from zeiteintrag where id = $1`, [id]) as never[];
  return z as never;
}

const GRUND = 'Einwand vom 11.03. anerkannt, Zeiten laut Objektleitung.';
const VON = new Date('2026-03-11T06:00:00Z');
const BIS = new Date('2026-03-11T14:00:00Z');

describe('§1 die Spur bleibt sichtbar (Invariante 5)', () => {
  it('legt den Eintrag an und markiert ihn als NACHERFASST', async () => {
    const neu = await als(planer, (tx) => erfasseZeitNach(kontextAus(tx, planer), {
      anstellungId: f.jonasReinigung, beginn: VON, ende: BIS,
      begruendung: GRUND, benutzerId: planer,
    }));
    const z = await zeile(neu.id);
    expect(z.nacherfasst).toBe(true);
    expect(z.quelle_beginn).toBe('planer_entscheidung');
    expect(z.quelle_ende).toBe('planer_entscheidung');
    expect(z.erfassungsart_beginn).toBe('nacherfassung');
    /*
     * `z_anspruch_je_ereignis` verlangt bei `nacherfasst` eine Behauptung —
     * hier stehen beide, weil beide gesetzt wurden.
     */
    expect(z.behauptet_beginn).not.toBeNull();
    expect(z.behauptet_ende).not.toBeNull();
    expect(z.status).toBe('abgeschlossen');
    expect(z.notiz).toBe(GRUND);
    expect(Number(z.dauer_netto_minuten)).toBe(480);
    /* Die Person kommt aus der ANSTELLUNG, nie aus dem Formular (D-09). */
    expect(z.person_id).toBe(f.jonas);
  });

  it('nimmt eine Pause an und zieht sie ab', async () => {
    const neu = await als(planer, (tx) => erfasseZeitNach(kontextAus(tx, planer), {
      anstellungId: f.jonasReinigung,
      beginn: new Date('2026-04-11T06:00:00Z'), ende: new Date('2026-04-11T14:00:00Z'),
      pauseMinuten: 45, begruendung: GRUND, benutzerId: planer,
    }));
    expect(Number((await zeile(neu.id)).dauer_netto_minuten)).toBe(435);
  });

  it('legt OHNE Ende einen laufenden Eintrag an', async () => {
    /*
     * Der Fall „eingestempelt, aber nie gestempelt": die Kraft ist da, das
     * Ende steht noch nicht fest. `z_offen_uk` laesst je Person einen offenen
     * Eintrag zu, deshalb wird er gleich wieder aufgeraeumt.
     */
    await sql.unsafe(
      `update zeiteintrag set status='storniert', storniert_am=now(),
              storno_grund='Aufraeumen der Pruefung'
        where person_id=$1 and status='laufend'`, [f.jonas] as never[]);
    const neu = await als(planer, (tx) => erfasseZeitNach(kontextAus(tx, planer), {
      anstellungId: f.jonasReinigung,
      beginn: new Date('2026-05-11T06:00:00Z'), ende: null,
      begruendung: GRUND, benutzerId: planer,
    }));
    const z = await zeile(neu.id);
    expect(z.status).toBe('laufend');
    expect(z.quelle_ende).toBeNull();
    await sql.unsafe(
      `update zeiteintrag set status='storniert', storniert_am=now(),
              storno_grund='Aufraeumen der Pruefung' where id=$1`, [neu.id] as never[]);
  });
});

describe('§2 die Grenzen', () => {
  it('WEIST eine zu kurze Begründung ab', async () => {
    await expect(als(planer, (tx) => erfasseZeitNach(kontextAus(tx, planer), {
      anstellungId: f.jonasReinigung, beginn: VON, ende: BIS,
      begruendung: 'kurz', benutzerId: planer,
    }))).rejects.toThrow(NacherfassungFehler);
  });

  it('WEIST ein Ende vor dem Beginn ab', async () => {
    await expect(als(planer, (tx) => erfasseZeitNach(kontextAus(tx, planer), {
      anstellungId: f.jonasReinigung, beginn: BIS, ende: VON,
      begruendung: GRUND, benutzerId: planer,
    }))).rejects.toThrow(/vor dem Beginn/u);
  });

  it('WEIST einen Beginn in der ZUKUNFT ab', async () => {
    await expect(als(planer, (tx) => erfasseZeitNach(kontextAus(tx, planer), {
      anstellungId: f.jonasReinigung,
      beginn: new Date(Date.now() + 86_400_000), ende: null,
      begruendung: GRUND, benutzerId: planer,
    }))).rejects.toThrow(/Zukunft/u);
  });

  it('WEIST eine unbekannte Beschäftigung ab', async () => {
    await expect(als(planer, (tx) => erfasseZeitNach(kontextAus(tx, planer), {
      anstellungId: '00000000-0000-0000-0000-000000000000', beginn: VON, ende: BIS,
      begruendung: GRUND, benutzerId: planer,
    }))).rejects.toThrow(NacherfassungFehler);
  });
});

describe('§3 EMP-07 — niemand erfasst die eigene Zeit nach', () => {
  it('WEIST die eigene Beschäftigung ab, auch mit allen Rechten', async () => {
    /*
     * Jonas ist hier `admin` und haelt damit jedes Zeitrecht. Was ihn
     * aufhaelt, ist nicht ein fehlendes Recht, sondern die Sache selbst: was
     * die betroffene Person schreibt, ist ihre Behauptung und keine
     * Aufzeichnung mehr.
     */
    await expect(als(jonasKonto, (tx) => erfasseZeitNach(kontextAus(tx, jonasKonto), {
      anstellungId: f.jonasReinigung, beginn: VON, ende: BIS,
      begruendung: GRUND, benutzerId: jonasKonto,
    }))).rejects.toThrow(/eigene/u);
  });
});

describe('§4 der anerkannte Einwand bekommt seine Antwort (V-067)', () => {
  it('schreibt den neuen Eintrag in die Entscheidungsbegründung', async () => {
    /*
     * Ein Einwand der Art `eintrag_fehlt` — ohne Zeiteintrag (§6.27).
     *
     * `kern.zeit_einwand_status` besteht darauf, dass ein Einwand OFFEN
     * eingereicht wird („Ein Einwand wird offen eingereicht") — ein direkt
     * anerkannter waere eine Entscheidung ohne Vorgang. Also zwei Schritte,
     * wie im echten Leben.
     */
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into zeit_einwand
         (mandant_id, anstellung_id, zeiteintrag_id, art, betrifft_datum,
          begruendung, status, eingereicht_von_benutzer_id)
       values ($1,$2,null,'eintrag_fehlt','2026-06-11',
               'Ich habe gearbeitet, es steht nichts da.','offen',$3)
       returning id`,
      [f.reinigung, f.jonasReinigung, jonasKonto] as never[]);
    await sql.unsafe(
      `update zeit_einwand
          set status='anerkannt', entschieden_von=$2, entschieden_am=now(),
              entscheidung_begruendung='Stimmt, die Schicht war besetzt.'
        where id=$1`, [e!.id, planer] as never[]);

    const neu = await als(planer, (tx) => erfasseZeitNach(kontextAus(tx, planer), {
      anstellungId: f.jonasReinigung,
      beginn: new Date('2026-06-11T06:00:00Z'), ende: new Date('2026-06-11T14:00:00Z'),
      begruendung: GRUND, benutzerId: planer, zeitEinwandId: e!.id,
    }));

    const [nachher] = await sql.unsafe<{ entscheidung_begruendung: string }[]>(
      `select entscheidung_begruendung from zeit_einwand where id = $1`, [e!.id]);
    /*
     * Die urspruengliche Begruendung bleibt stehen — angehaengt wird, was
     * daraus wurde. Eine ueberschriebene Entscheidung waere eine zweite
     * Fassung derselben Aussage.
     */
    expect(nachher!.entscheidung_begruendung).toContain('Stimmt, die Schicht war besetzt.');
    expect(nachher!.entscheidung_begruendung).toContain(neu.id);
  });
});
