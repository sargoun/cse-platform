/**
 * Die eigenen Anmeldungen sehen und beenden (V-039, V-076, AUT-05).
 *
 * **Der Befund, den diese Datei festnagelt.** `benutzer_sitzung` hat seit je
 * zwei Policies für `cse_app` — `t_sitzung_eigene` (lesen) und
 * `t_sitzung_eigene_schreiben` (beenden). Keine wurde je benutzt. Wer sein
 * Telefon verlor, hatte keinen Weg, die Anmeldung darauf zu beenden.
 *
 * Geprüft wird das, was dabei schiefgehen kann und nicht rot wird:
 *
 *  1. **Fremde Anmeldungen bleiben unsichtbar** — die Policy ist die Grenze,
 *     nicht ein `where` im Dienst.
 *  2. **Eine fremde Anmeldung lässt sich nicht beenden**, und die Antwort ist
 *     dieselbe wie bei einer, die es nicht gibt (AUT-06).
 *  3. **Die laufende Anmeldung wird nicht beendet** — sonst zeigte das
 *     Sitzungsplätzchen im Browser auf etwas, das es nicht mehr gibt.
 *  4. **Beendet heisst beendet**: die Zeile bleibt mit Grund und Zeitpunkt
 *     stehen (Invariante 8) und fällt aus der Liste.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  beendeEigeneSitzung, meineSitzungen, SitzungFehler,
} from '../../src/server/services/konto/sitzungen.js';

let f: Fixtur;
let ich = '';
let jemandAnders = '';
let meineA = '';
let meineB = '';
let fremde = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

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

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1,$2,(select id from rolle where schluessel='admin' and mandant_id is null))`,
    [u!.id, f.reinigung]);
  return u!.id;
}

/**
 * Eine Anmeldung, wie die Datenbank sie verlangt.
 *
 * `benutzer_sitzung_token_hash_check` besteht auf 64 Hexziffern — das ist ein
 * SHA-256, und die Zwangsbedingung haelt fest, dass hier nie ein Klartext
 * landet. Die Pruefung erzeugt deshalb einen echten Hash und nicht eine
 * Zufallszeichenkette.
 */
async function anmeldung(benutzerId: string, geraet: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(`${benutzerId}-${geraet}-${zufall()}`).digest('hex');
  const [s] = await sql.unsafe<{ id: string }[]>(
    `insert into benutzer_sitzung
       (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal, geraet,
        letzte_aktivitaet_am, ablauf_am)
     values ($1,$2,$3,'mandant','aal1',$4, now(), now() + interval '8 hours')
     returning id`,
    [benutzerId, hash, f.reinigung, geraet] as never[]);
  return s!.id;
}

beforeAll(async () => {
  f = await seed();
  ich = await konto('ich');
  jemandAnders = await konto('anders');
  meineA = await anmeldung(ich, 'Telefon im Treppenhaus');
  meineB = await anmeldung(ich, 'Rechner im Büro');
  fremde = await anmeldung(jemandAnders, 'Fremdes Gerät');
});
afterAll(schliessen);

describe('§1 die Liste zeigt genau die eigenen', () => {
  it('führt beide eigenen Anmeldungen und die fremde NICHT', async () => {
    const liste = await als(ich, (tx) => meineSitzungen(kontextAus(tx, ich), meineA));
    const ids = liste.map((s) => s.id);
    expect(ids).toContain(meineA);
    expect(ids).toContain(meineB);
    /*
     * Die Grenze ist die Policy `t_sitzung_eigene`, nicht ein `where` im
     * Dienst — die Abfrage nennt `benutzer_id` gar nicht.
     */
    expect(ids).not.toContain(fremde);
  });

  it('markiert die LAUFENDE Anmeldung', async () => {
    const liste = await als(ich, (tx) => meineSitzungen(kontextAus(tx, ich), meineA));
    expect(liste.find((s) => s.id === meineA)?.istDiese).toBe(true);
    expect(liste.find((s) => s.id === meineB)?.istDiese).toBe(false);
  });

  it('gibt den Token-Hash NICHT heraus', async () => {
    const liste = await als(ich, (tx) => meineSitzungen(kontextAus(tx, ich), meineA));
    /*
     * Er ist das Geheimnis; eine Liste, die ihn zeigt, gibt die Sitzungen
     * her, die sie schuetzen soll. Geprueft wird der TYP, nicht ein Wert:
     * eine spaeter ergaenzte Spalte faellt so auf.
     */
    for (const s of liste) {
      expect(Object.keys(s)).not.toContain('tokenHash');
      expect(JSON.stringify(s)).not.toContain('token');
    }
  });
});

describe('§2 beenden', () => {
  it('beendet eine andere eigene Anmeldung und lässt die Zeile stehen', async () => {
    const weg = await anmeldung(ich, 'Altes Telefon');
    await als(ich, (tx) => beendeEigeneSitzung(kontextAus(tx, ich), weg, meineA));

    const [z] = await sql.unsafe<{ beendet_am: Date | null; ende_grund: string | null }[]>(
      `select beendet_am, ende_grund::text as ende_grund
         from benutzer_sitzung where id = $1`, [weg]);
    expect(z!.beendet_am).not.toBeNull();
    expect(z!.ende_grund).toBe('abmeldung');

    const liste = await als(ich, (tx) => meineSitzungen(kontextAus(tx, ich), meineA));
    expect(liste.map((s) => s.id)).not.toContain(weg);
  });

  it('WEIST die laufende Anmeldung ab — dafür gibt es „Abmelden"', async () => {
    await expect(als(ich, (tx) =>
      beendeEigeneSitzung(kontextAus(tx, ich), meineA, meineA)))
      .rejects.toThrow(/gerade/u);
  });

  it('WEIST eine FREMDE Anmeldung ab, und zwar wie eine, die es nicht gibt', async () => {
    await expect(als(ich, (tx) =>
      beendeEigeneSitzung(kontextAus(tx, ich), fremde, meineA)))
      .rejects.toThrow(SitzungFehler);
    /* Und sie lebt weiter — die Policy hat sie gar nicht erst erreicht. */
    const [z] = await sql.unsafe<{ beendet_am: Date | null }[]>(
      `select beendet_am from benutzer_sitzung where id = $1`, [fremde]);
    expect(z!.beendet_am).toBeNull();
  });

  it('WEIST ein zweites Beenden ab', async () => {
    const weg = await anmeldung(ich, 'Nur einmal');
    await als(ich, (tx) => beendeEigeneSitzung(kontextAus(tx, ich), weg, meineA));
    await expect(als(ich, (tx) =>
      beendeEigeneSitzung(kontextAus(tx, ich), weg, meineA))).rejects.toThrow(SitzungFehler);
  });
});
