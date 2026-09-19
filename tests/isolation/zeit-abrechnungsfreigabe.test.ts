/**
 * Die Freigabe erfasster Zeit zur Abrechnung gegen echtes Postgres
 * (TIM-12, FIN-07, FIN-18, §3.3/§7.3, Invariante 3, Invariante 8, 0366).
 *
 * **Warum diese Datei trotz O-39 existiert.** O-39 fragt, ob es den Schritt
 * als eigenen menschlichen Akt gibt; `zeit.abrechnung_freigeben` ist deshalb
 * an keine Rolle gebunden, und im Betrieb kommt heute niemand hierher. Der
 * WEG dorthin ist aber gebaut und wird von zwei fertigen Lesern benutzt
 * (Stundenkonto §7.3, Rechnungsstellung §3.3). Eine gebaute Funktion ohne
 * Pruefung ist die teuerste Sorte: sie sieht richtig aus, bis jemand das
 * Recht bindet.
 *
 * Geprueft wird deshalb mit einer EIGENS gebundenen Rolle — genau der
 * Handgriff, den die Antwort des Mandanten spaeter im Seed tut.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  FreigabeFehler, gibFrei, ladeFreigabeliste,
} from '../../src/server/services/zeit/abrechnungsfreigabe.js';

let f: Fixtur;
let freigeber = '';   // zeit.lesen + zeit.abrechnung_freigeben
let planer = '';      // nur zeit.lesen
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function rolleMit(
  mandant: string, schluessel: string, rechte: readonly string[],
): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [mandant, `${schluessel}_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, mandant, [...rechte]]);
  return r!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, rolle]);
}

/** Ein ABGESCHLOSSENER Zeiteintrag, als Eigentuemer angelegt. */
async function eintrag(opts: {
  mandant: string; anstellung: string; person: string;
  von: string; bis: string | null; status?: string;
}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
        pause_minuten, erfassungsart_beginn, erfassungsart_ende,
        quelle_beginn, quelle_ende, status, erstellt_von_art)
     values ($1,$2,$3,$4::timestamptz,$5::timestamptz,0,
             'import','import','import','import',$6,'system')
     returning id`,
    [opts.mandant, opts.anstellung, opts.person, opts.von, opts.bis,
      opts.status ?? 'abgeschlossen'] as never[]);
  return z!.id;
}

function als<T>(
  benutzerId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  mandantId = f.reinigung,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false }, fn);
}

function kontextAus(
  tx: postgres.TransactionSql, benutzerId: string, mandantId: string,
): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

beforeEach(async () => {
  f = await seed();
  freigeber = await konto('freigeber');
  planer = await konto('planer');
  await mitglied(freigeber, f.reinigung, await rolleMit(f.reinigung, 'freigeber', [
    'zeit.lesen', 'zeit.schreiben', 'zeit.abrechnung_freigeben',
  ]));
  await mitglied(planer, f.reinigung,
    await rolleMit(f.reinigung, 'planer', ['zeit.lesen', 'zeit.schreiben']));
});
afterAll(schliessen);

describe('(1) das Recht haelt in der DATENBANK, nicht nur in der Route', () => {
  it('ohne `zeit.abrechnung_freigeben` weist die Definer-Funktion ab', async () => {
    const id = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-02T05:00:00Z', bis: '2026-03-02T13:00:00Z',
    });
    await expect(als(planer, (tx) =>
      gibFrei(kontextAus(tx, planer, f.reinigung), [id]),
    )).rejects.toThrow(/nicht berechtigt|permission/iu);

    const [z] = await sql.unsafe<{ frei: Date | null }[]>(
      `select freigegeben_am as frei from zeiteintrag where id = $1`, [id]);
    expect(z?.frei).toBeNull();
  });

  it('mit dem Recht wird freigegeben — mit Zeitstempel UND Mensch', async () => {
    const id = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-02T05:00:00Z', bis: '2026-03-02T13:00:00Z',
    });
    const bericht = await als(freigeber, (tx) =>
      gibFrei(kontextAus(tx, freigeber, f.reinigung), [id]));
    expect(bericht.freigegeben).toBe(1);
    expect(bericht.uebersprungen).toEqual([]);

    const [z] = await sql.unsafe<{ frei: Date | null; von: string | null }[]>(
      `select freigegeben_am as frei, freigegeben_von::text as von
         from zeiteintrag where id = $1`, [id]);
    expect(z?.frei).not.toBeNull();
    // Der Mensch kommt aus der SITZUNG, nicht aus einem Argument.
    expect(z?.von).toBe(freigeber);
  });

  it('und `cse_app` kommt nicht an der Funktion vorbei an die Spalte', async () => {
    /*
     * Die Policy `z_definer_abrechnungsfreigabe` (0366) gehoert `cse_definer`.
     * `cse_app` hat zwar UPDATE auf der Tabelle, aber die Unveraenderlichkeit
     * und die Rechtefrage sitzen in der Funktion — der direkte Weg soll nicht
     * der bequemere sein. Hier zaehlt, dass der Vorgang eine SPUR hinterlaesst:
     * ohne sie waere „wer hat freigegeben" nicht beantwortbar.
     */
    const id = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-03T05:00:00Z', bis: '2026-03-03T13:00:00Z',
    });
    await als(freigeber, (tx) => gibFrei(kontextAus(tx, freigeber, f.reinigung), [id]));
    const [a] = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from audit_log
        where aktion = 'zeit.abrechnung_freigegeben' and objekt_id = $1`, [id]);
    expect(Number(a!.n)).toBe(1);
  });
});

describe('(2) je Zeile ein Ergebnis — kein Alles-oder-nichts', () => {
  it('eine stornierte Zeile bricht den Lauf nicht ab', async () => {
    const gut = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-04T05:00:00Z', bis: '2026-03-04T13:00:00Z',
    });
    const schlecht = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-05T05:00:00Z', bis: '2026-03-05T13:00:00Z',
    });
    await sql.unsafe(
      `update zeiteintrag set storniert_am = now(), storno_grund = 'Test', status = 'storniert'
        where id = $1`, [schlecht]);

    const bericht = await als(freigeber, (tx) =>
      gibFrei(kontextAus(tx, freigeber, f.reinigung), [gut, schlecht]));
    expect(bericht.freigegeben).toBe(1);
    expect(bericht.uebersprungen).toEqual([
      { zeiteintragId: schlecht, ergebnis: 'storniert' },
    ]);
  });

  it('ein LAUFENDER Eintrag wird uebersprungen — er hat keine Dauer', async () => {
    const laufend = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-06T05:00:00Z', bis: null, status: 'laufend',
    });
    const bericht = await als(freigeber, (tx) =>
      gibFrei(kontextAus(tx, freigeber, f.reinigung), [laufend]));
    expect(bericht.freigegeben).toBe(0);
    expect(bericht.uebersprungen[0]?.ergebnis).toBe('nicht_abgeschlossen');
  });

  it('eine zweite Freigabe derselben Zeile ist kein Fehler, sondern eine Auskunft', async () => {
    const id = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-07T05:00:00Z', bis: '2026-03-07T13:00:00Z',
    });
    await als(freigeber, (tx) => gibFrei(kontextAus(tx, freigeber, f.reinigung), [id]));
    const zweitens = await als(freigeber, (tx) =>
      gibFrei(kontextAus(tx, freigeber, f.reinigung), [id]));
    expect(zweitens.freigegeben).toBe(0);
    expect(zweitens.uebersprungen[0]?.ergebnis).toBe('bereits_freigegeben');
  });

  it('eine Zeile aus einer FREMDEN Gesellschaft ist „nicht gefunden" (AUT-06)', async () => {
    const fremd = await eintrag({
      mandant: f.security, anstellung: f.fatimaSecurity, person: f.fatima,
      von: '2026-03-08T05:00:00Z', bis: '2026-03-08T13:00:00Z',
    });
    const bericht = await als(freigeber, (tx) =>
      gibFrei(kontextAus(tx, freigeber, f.reinigung), [fremd]));
    expect(bericht.freigegeben).toBe(0);
    expect(bericht.uebersprungen[0]?.ergebnis).toBe('nicht_gefunden');

    const [z] = await sql.unsafe<{ frei: Date | null }[]>(
      `select freigegeben_am as frei from zeiteintrag where id = $1`, [fremd]);
    expect(z?.frei).toBeNull();
  });

  it('eine leere Auswahl ist ein Abbruch mit Satz, kein stiller Erfolg', async () => {
    await expect(als(freigeber, (tx) =>
      gibFrei(kontextAus(tx, freigeber, f.reinigung), []),
    )).rejects.toThrow(FreigabeFehler);
  });
});

describe('(3) die Liste zeigt genau das, was freigebbar ist', () => {
  it('abgeschlossen und offen: ja — freigegeben, storniert, laufend: nein', async () => {
    const offen = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-09T05:00:00Z', bis: '2026-03-09T13:00:00Z',
    });
    const schon = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-10T05:00:00Z', bis: '2026-03-10T13:00:00Z',
    });
    await sql.unsafe(
      `update zeiteintrag set freigegeben_am = now(), freigegeben_von = $2 where id = $1`,
      [schon, freigeber]);

    const liste = await als(freigeber, (tx) =>
      ladeFreigabeliste(kontextAus(tx, freigeber, f.reinigung), {
        von: '2026-03-09', bis: '2026-03-15',
        personId: null, objektId: null, nurOhneAuftrag: false,
      }));
    const ids = liste.zeilen.map((z) => z.id);
    expect(ids).toContain(offen);
    expect(ids).not.toContain(schon);
    expect(liste.darfFreigeben).toBe(true);
  });

  it('die Nachtschicht über Mitternacht faellt nicht aus dem Fenster (Invariante 2)', async () => {
    /*
     * 22:00–06:00 Berliner Zeit über den Monatswechsel. Ein Fenster auf
     * `beginn::date between …` liesse die Zeile verschwinden, sobald man den
     * Folgetag ansieht — sichtbar leer, und niemand vermisst sie.
     */
    const nacht = await eintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-03-11T21:00:00Z', bis: '2026-03-12T05:00:00Z',
    });
    const amFolgetag = await als(freigeber, (tx) =>
      ladeFreigabeliste(kontextAus(tx, freigeber, f.reinigung), {
        von: '2026-03-12', bis: '2026-03-12',
        personId: null, objektId: null, nurOhneAuftrag: false,
      }));
    expect(amFolgetag.zeilen.map((z) => z.id)).toContain(nacht);
    expect(amFolgetag.zeilen.find((z) => z.id === nacht)?.endeFolgetag).toBe(true);
  });

  it('`darfFreigeben` ist falsch, wo das Recht fehlt (O-39)', async () => {
    const liste = await als(planer, (tx) =>
      ladeFreigabeliste(kontextAus(tx, planer, f.reinigung), {
        von: '2026-03-01', bis: '2026-03-31',
        personId: null, objektId: null, nurOhneAuftrag: false,
      }));
    expect(liste.darfFreigeben).toBe(false);
  });
});
