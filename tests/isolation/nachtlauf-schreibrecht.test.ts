import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsRolle, schliessen, seed, type Fixtur } from './harness.js';

/**
 * **Was ein Nachtlauf wirklich darf** (V-119, EMP-04, EMP-05).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund in eigener Sache.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kontenRollover` (V-008) wurde gebaut, mit zwölf Prüfungen abgedeckt und
 * ausgeliefert. Alle zwölf rufen den DIENST `eroeffneKonto` als `cse_app`.
 * Der Lauf selbst läuft als `cse_job` — und `0060` gab `cse_job` auf
 * `stundenkonto` nur `select`, mit dem Kommentar „liest und schreibt nichts".
 *
 * Der Lauf wäre bei seinem ersten nächtlichen Versuch mit „permission denied
 * for table stundenkonto" abgebrochen, in einem Protokoll, das niemand liest.
 * Genau der Fehler, gegen den er gebaut wurde, eine Ebene tiefer.
 *
 * **Diese Datei prüft deshalb nicht den Dienst, sondern die ROLLE.** Sie
 * bindet dieselben GUCs, die `alsJobSitzung` setzt, schaltet auf `cse_job`
 * und schreibt — ohne eine einzige Zeile Anwendungscode dazwischen. Ein
 * fehlender Grant oder eine fehlende Policy fällt hier auf und nicht um
 * 00:30.
 */

let f: Fixtur;

beforeAll(async () => { f = await seed(); });
afterAll(schliessen);

/**
 * Dieselbe Bindung wie `alsJobSitzung` — Rolle, Mandant, Akteur, Lesemodus.
 *
 * Sie steht hier ausgeschrieben und ruft nicht `alsJobSitzung`: geprüft wird,
 * ob die DATENBANK den Schreibweg öffnet, und eine Hilfsfunktion, die
 * denselben Fehler enthalten könnte, wäre kein Zeuge.
 */
async function alsJob<T>(
  mandantId: string, nurLesen: boolean,
  fn: (tx: Parameters<Parameters<typeof alsRolle>[1]>[0]) => Promise<T>,
): Promise<T> {
  return alsRolle('cse_job', async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [mandantId]);
    await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [mandantId]);
    await tx.unsafe(`select set_config('app.benutzer_id', '', true)`);
    await tx.unsafe(`select set_config('app.person_id', '', true)`);
    await tx.unsafe(`select set_config('app.portal', 'intern', true)`);
    await tx.unsafe(`select set_config('app.akteur_typ', 'system', true)`);
    await tx.unsafe(
      `select set_config('app.readonly', $1, true)`, [nurLesen ? 'on' : 'off']);
    return fn(tx);
  });
}

describe('§1 `job:konten_rollover` darf das Stundenkonto anlegen', () => {
  it('als `cse_job` mit gebundenem Mandanten und Schreibmodus', async () => {
    const zeilen = await alsJob(f.reinigung, false, (tx) => tx.unsafe(
      `insert into stundenkonto
         (mandant_id, anstellung_id, jahr, monat, soll_minuten, saldo_vortrag_minuten)
       values ($1, $2, 2040, 7, 0, 0)
       on conflict (anstellung_id, jahr, monat) do nothing
       returning id`,
      [f.reinigung, f.jonasReinigung])) as unknown as { id: string }[];
    expect(zeilen.length).toBe(1);
  });

  /**
   * **Ohne `nurLesen: false` scheitert er SICHTBAR.** Das ist die Kopplung,
   * die `0380` absichtlich in die Policy gelegt hat: ein Lauf, der den
   * Schreibmodus vergisst, schreibt nicht etwa doch, und er tut auch nicht
   * still nichts — er bricht ab, und das steht im Protokoll.
   */
  it('ohne Schreibmodus wird die Zeile abgewiesen', async () => {
    await expect(alsJob(f.reinigung, true, (tx) => tx.unsafe(
      `insert into stundenkonto
         (mandant_id, anstellung_id, jahr, monat, soll_minuten, saldo_vortrag_minuten)
       values ($1, $2, 2041, 7, 0, 0)`,
      [f.reinigung, f.jonasReinigung]))).rejects.toThrow(/row-level security/u);
  });

  /**
   * **Ohne gebundenen Mandanten ebenso.** Der Lauf findet über alle
   * Gesellschaften (`alsJobRolle`) und schreibt je eine (`alsJobSitzung`);
   * eine Zeile ohne `mandant_id`-Bindung wäre die eine, die keine Abfrage
   * wiederfindet (Invariante 3).
   */
  it('mit fremdem Mandanten wird die Zeile abgewiesen', async () => {
    await expect(alsJob(f.security, false, (tx) => tx.unsafe(
      `insert into stundenkonto
         (mandant_id, anstellung_id, jahr, monat, soll_minuten, saldo_vortrag_minuten)
       values ($1, $2, 2042, 7, 0, 0)`,
      [f.reinigung, f.jonasReinigung]))).rejects.toThrow(/row-level security/u);
  });

  it('löschen darf er nach wie vor nicht (Invariante 8)', async () => {
    await expect(alsJob(f.reinigung, false, (tx) => tx.unsafe(
      `delete from stundenkonto where mandant_id = $1`, [f.reinigung])))
      .rejects.toThrow();
  });
});

describe('§2 `job:urlaubskonten_jahr` darf das Urlaubskonto anlegen', () => {
  it('als `cse_job` mit gebundenem Mandanten und Schreibmodus', async () => {
    const zeilen = await alsJob(f.reinigung, false, (tx) => tx.unsafe(
      `insert into urlaubskonto
         (mandant_id, anstellung_id, jahr, anspruch_tage, uebertrag_tage, zusatz_tage)
       values ($1, $2, 2040, 0, 0, 0)
       on conflict (anstellung_id, jahr) do nothing
       returning id`,
      [f.reinigung, f.jonasReinigung])) as unknown as { id: string }[];
    expect(zeilen.length).toBe(1);
  });

  it('ohne Schreibmodus wird die Zeile abgewiesen', async () => {
    await expect(alsJob(f.reinigung, true, (tx) => tx.unsafe(
      `insert into urlaubskonto
         (mandant_id, anstellung_id, jahr, anspruch_tage, uebertrag_tage, zusatz_tage)
       values ($1, $2, 2041, 0, 0, 0)`,
      [f.reinigung, f.jonasReinigung]))).rejects.toThrow(/row-level security/u);
  });

  /**
   * **Ändern darf er NICHT.** Der Anspruch ist die Zahl aus dem
   * Arbeitsvertrag; ein Nachtlauf, der sie anfassen könnte, wäre der Weg, auf
   * dem sie sich ohne benannten Menschen ändert (O-18).
   */
  it('den Anspruch ändern darf er nicht', async () => {
    await expect(alsJob(f.reinigung, false, (tx) => tx.unsafe(
      `update urlaubskonto set anspruch_tage = 30
        where mandant_id = $1 and jahr = 2040`, [f.reinigung])))
      .rejects.toThrow();
  });
});
