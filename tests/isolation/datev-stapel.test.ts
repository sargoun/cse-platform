import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  GRUND_MINDESTLAENGE, StapelFehler, istStapelVermerk, vermerkeUebergabe, verwirfStapel,
} from '../../src/server/services/buchhaltung/datev/stapel.js';

/**
 * **Der Vermerk am Buchungsstapel** (V-027, ACC-02).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `datev_export_status` kennt seit `0133` drei Werte. Der CHECK hält Zustand
 * und Stempel zusammen, der Unveränderlichkeits-Auslöser lässt ausdrücklich
 * genau diese Spalten beweglich, und die Einzelseite zeigt beide an —
 * **gesetzt hat sie nie jemand.** Jeder Stapel stand für immer auf „erzeugt",
 * und die Liste beantwortete die einzige Frage nicht, für die es sie gibt:
 * welcher Monat liegt beim Steuerbüro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier bewiesen wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §1  Der Vermerk entsteht, mit der SERVERUHR und dem Namen des Menschen.
 * §2  Ein verworfener Stapel trägt seinen Grund — der CHECK verlangt fünf
 *     Zeichen, der Dienst sagt das in einem Satz, statt die Datenbank
 *     antworten zu lassen.
 * §3  Beide Wege führen NUR aus `erzeugt` heraus: was übergeben wurde, wird
 *     nicht nachträglich umgeschrieben.
 * §4  Der Stapel selbst bleibt unverändert — Summen, Stammdaten, Prüfsumme.
 * §5  Ohne `buchhaltung.exportieren` geschieht nichts, auch ohne Tor.
 */

let f: Fixtur;
let exporteur = '';
let ohneRecht = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

/**
 * Ein Stapel als FIXTUR — direkt gesetzt, nicht erzeugt.
 *
 * Der Erzeugungsweg hat seine eigene Datei (`datev-export.test.ts`) und
 * braucht Rechnungen, Belege und eine volle Buchhaltung. Geprüft wird hier
 * der VERMERK, und für den ist der Stapel Ausgangslage, nicht Gegenstand.
 */
async function stapel(mandant: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into datev_export
       (mandant_id, von, bis, berater_nummer, mandanten_nummer, kontenrahmen,
        sachkontenlaenge, wj_beginn_monat, wj_beginn_tag, versteuerungsart,
        extf_version, festschreibung, zeilen, summe_soll_cent, summe_haben_cent,
        datei_sha256, erstellt_von_art, erstellt_von)
     values ($1, date '2026-01-01', date '2026-01-31', '1234567', '12345', 'skr03',
             4, 1, 1, 'soll', '700', false, 12, 250000, 250000, $2, 'mensch', $3)
     returning id`,
    [mandant, zufall().padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/gu, '0'), exporteur]);
  return z!.id;
}

beforeAll(async () => {
  f = await seed();
  exporteur = await konto('datev-stapel@test.invalid', f.reinigung, 'leitung');
  ohneRecht = await konto('datev-stapel-ohne@test.invalid', f.reinigung, 'mitarbeiter');
  for (const r of ['buchhaltung.lesen', 'buchhaltung.exportieren']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.reinigung]);
  }
});
afterAll(schliessen);

interface Db {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

function imKontext<T>(
  fn: (db: Db) => Promise<T>,
  o: { readonly readonly?: boolean; readonly benutzer?: string } = {},
): Promise<T> {
  const benutzer = o.benutzer ?? exporteur;
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern' as const, readonly: o.readonly ?? false,
    },
    async (tx: postgres.TransactionSql) => {
      const lauf = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({ abfrage: lauf, schreibe: lauf });
    },
  ) as Promise<T>;
}

interface Stand {
  readonly status: string;
  readonly uebergeben_am: Date | null;
  readonly uebergeben_notiz: string | null;
  readonly verworfen_am: Date | null;
  readonly verwerfungsgrund: string | null;
  readonly geaendert_von: string | null;
  readonly zeilen: number;
  readonly summe_soll_cent: string;
  readonly datei_sha256: string | null;
}

async function stand(id: string): Promise<Stand> {
  const [z] = await sql.unsafe<Stand[]>(
    `select status::text as status, uebergeben_am, uebergeben_notiz,
            verworfen_am, verwerfungsgrund, geaendert_von, zeilen,
            summe_soll_cent::text as summe_soll_cent, datei_sha256
       from datev_export where id = $1`, [id]);
  return z!;
}

/* ═════════════════════════════════════════════════════════════════════════
 * §1 — Der Vermerk entsteht
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§1 als übergeben vermerken', () => {
  it('setzt Zustand, Zeit und den Menschen — mit Notiz', async () => {
    const id = await stapel(f.reinigung);
    await imKontext((db) => vermerkeUebergabe(db, id, '  per DUO hochgeladen  '));
    const z = await stand(id);
    expect(z.status).toBe('uebergeben');
    expect(z.uebergeben_am).not.toBeNull();
    // Beschnitten gespeichert: „ per DUO “ und „per DUO“ sind dieselbe Notiz.
    expect(z.uebergeben_notiz).toBe('per DUO hochgeladen');
    expect(z.geaendert_von).toBe(exporteur);
    expect(z.verworfen_am).toBeNull();
  });

  it('ohne Notiz bleibt das Feld LEER statt leerer Zeichenkette', async () => {
    const id = await stapel(f.reinigung);
    await imKontext((db) => vermerkeUebergabe(db, id, '   '));
    const z = await stand(id);
    expect(z.status).toBe('uebergeben');
    expect(z.uebergeben_notiz).toBeNull();
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §2 — Verworfen, mit Grund
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§2 verwerfen verlangt einen Grund', () => {
  it('setzt Zustand, Zeit und Grund', async () => {
    const id = await stapel(f.reinigung);
    await imKontext((db) => verwirfStapel(db, id, 'Zeitraum falsch gewählt'));
    const z = await stand(id);
    expect(z.status).toBe('verworfen');
    expect(z.verworfen_am).not.toBeNull();
    expect(z.verwerfungsgrund).toBe('Zeitraum falsch gewählt');
    expect(z.uebergeben_am).toBeNull();
  });

  it('ein zu kurzer Grund fällt im DIENST, nicht im CHECK', async () => {
    /*
     * `datev_export_status_stimmig` fiele ebenfalls — aber mit „violates
     * check constraint", und das ist kein Satz, den ein Mensch lesen soll.
     */
    const id = await stapel(f.reinigung);
    await expect(imKontext((db) => verwirfStapel(db, id, 'ups')))
      .rejects.toThrow(new RegExp(`mindestens ${String(GRUND_MINDESTLAENGE)} Zeichen`, 'u'));
    expect((await stand(id)).status).toBe('erzeugt');
  });

  it('ein leerer Grund ebenso', async () => {
    const id = await stapel(f.reinigung);
    await expect(imKontext((db) => verwirfStapel(db, id, '     ')))
      .rejects.toThrow(StapelFehler);
    expect((await stand(id)).status).toBe('erzeugt');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §3 — Beide Wege nur aus `erzeugt`
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§3 ein Vermerk wird nicht umgeschrieben', () => {
  it('ein übergebener Stapel lässt sich nicht verwerfen', async () => {
    /*
     * Er LIEGT beim Büro. Ihn später auf „verworfen" zu stellen, weil das Büro
     * ihn zurückweist, schriebe um, was geschehen ist — der ehrliche Weg ist
     * ein neuer Stapel für denselben Zeitraum.
     */
    const id = await stapel(f.reinigung);
    await imKontext((db) => vermerkeUebergabe(db, id, null));
    await expect(imKontext((db) => verwirfStapel(db, id, 'Büro hat abgelehnt')))
      .rejects.toThrow(/bereits als übergeben/u);
    const z = await stand(id);
    expect(z.status).toBe('uebergeben');
    expect(z.verwerfungsgrund).toBeNull();
  });

  it('ein verworfener Stapel lässt sich nicht als übergeben vermerken', async () => {
    const id = await stapel(f.reinigung);
    await imKontext((db) => verwirfStapel(db, id, 'Zeitraum falsch gewählt'));
    await expect(imKontext((db) => vermerkeUebergabe(db, id, null)))
      .rejects.toThrow(/verworfen/u);
    expect((await stand(id)).status).toBe('verworfen');
  });

  it('zweimal übergeben ist einmal übergeben', async () => {
    const id = await stapel(f.reinigung);
    await imKontext((db) => vermerkeUebergabe(db, id, 'erste'));
    await expect(imKontext((db) => vermerkeUebergabe(db, id, 'zweite')))
      .rejects.toThrow(StapelFehler);
    expect((await stand(id)).uebergeben_notiz).toBe('erste');
  });

  it('ein Stapel einer anderen Gesellschaft ist von hier aus keiner', async () => {
    const fremd = await stapel(f.security);
    await expect(imKontext((db) => vermerkeUebergabe(db, fremd, null)))
      .rejects.toThrow(/gibt es in dieser Gesellschaft nicht/u);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §4 — Am Stapel selbst ändert sich nichts
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§4 der erzeugte Stapel bleibt, was er war', () => {
  it('Summen, Zeilenzahl und Prüfsumme überstehen den Vermerk', async () => {
    const id = await stapel(f.reinigung);
    const vorher = await stand(id);
    await imKontext((db) => vermerkeUebergabe(db, id, 'übergeben'));
    const nachher = await stand(id);
    expect(nachher.zeilen).toBe(vorher.zeilen);
    expect(nachher.summe_soll_cent).toBe(vorher.summe_soll_cent);
    expect(nachher.datei_sha256).toBe(vorher.datei_sha256);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §5 — Ohne Recht geschieht nichts
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§5 Linie 2 hält auch ohne Linie 1', () => {
  it('ohne `buchhaltung.exportieren` bleibt der Stapel auf „erzeugt"', async () => {
    const id = await stapel(f.reinigung);
    await expect(imKontext((db) => vermerkeUebergabe(db, id, null),
      { benutzer: ohneRecht })).rejects.toThrow();
    expect((await stand(id)).status).toBe('erzeugt');
  });

  it('in der Nur-Lese-Bindung ebenfalls', async () => {
    const id = await stapel(f.reinigung);
    await expect(imKontext((db) => vermerkeUebergabe(db, id, null),
      { readonly: true })).rejects.toThrow();
    expect((await stand(id)).status).toBe('erzeugt');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §6 — Der Wächter der Route
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§6 nur die zwei Vermerke, die es gibt', () => {
  it('kennt „uebergeben" und „verworfen" und sonst nichts', () => {
    expect(istStapelVermerk('uebergeben')).toBe(true);
    expect(istStapelVermerk('verworfen')).toBe(true);
    // „erzeugt" ist der Ausgangszustand, kein Vermerk: ihn über die Route
    // zuzulassen hiesse, einen Vermerk zurücknehmen zu können.
    expect(istStapelVermerk('erzeugt')).toBe(false);
    expect(istStapelVermerk('gesendet')).toBe(false);
  });
});
