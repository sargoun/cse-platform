/**
 * Die Freigabe eines Dokuments für die Belegschaft — in BEIDE Richtungen
 * (DOC-04, EMP-11, V-219, D-712), an echtem Postgres.
 *
 * **Der Befund.** `sichtbar_fuer_mitarbeiter` liess sich nur beim Ablegen
 * setzen, über ein Kästchen — danach gab es keinen Rückweg. Ein versehentlich
 * freigegebener Vertrag (Löschsperre, 0009) blieb damit dauerhaft für jede
 * Sitzung im Mitarbeiterportal sichtbar: löschen ging nicht, zurücknehmen
 * auch nicht.
 *
 * **Warum hier und nicht in `tests/kern`.** Ob die Rücknahme wirkt, entscheidet
 * die DATENBANK: `p_ma_ceiling` und `t_person` (0009) geben dem
 * Mitarbeiterportal genau das heraus, was den Schalter trägt. Geprüft wird
 * deshalb mit dem echten Personen-Scope (`withPersonScope`) und nicht mit
 * einer nachgebauten Abfrage.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  withPersonScope, type LeseKontext, type Sitzung,
} from '../../src/server/kontext/index.js';
import { findeEigenesDokument } from '../../src/server/services/mitarbeiter/dokumente.js';
import { DokumentfreigabeFehler } from '../../src/server/services/dokument/kundenfreigabe.js';
import { setzeMitarbeiterfreigabe } from '../../src/server/services/dokument/mitarbeiterfreigabe.js';

let f: Fixtur;
let fatimaKonto = '';

const SITZUNG = '00000000-0000-0000-0000-00000000712a';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(personId: string | null = null): Promise<string> {
  const email = `mf-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId(rolle)]);
}

/**
 * Ein Dokument — als Eigentümer angelegt. Die Kategorie `vertrag` trägt eine
 * Löschsperre (0009): genau der Fall des Befunds, in dem die Rücknahme der
 * einzige Rückweg ist.
 */
async function dokument(
  mandant: string, opts: { frei?: boolean; kategorie?: string; geloescht?: boolean } = {},
): Promise<string> {
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument
       (mandant_id, kategorie, titel, bucket, objekt_schluessel, mime_typ,
        mime_verifiziert, groesse_bytes, exif_entfernt, sichtbar_fuer_kunde,
        sichtbar_fuer_mitarbeiter, entstanden_am)
     values ($1, $2::dokument_kategorie, 'Rahmenvertrag (Test)', 'dokumente', $3,
             'application/pdf', true, 24576, true, false, $4, current_date)
     returning id`,
    [mandant, opts.kategorie ?? 'vertrag', `test/${zufall()}.pdf`,
     opts.frei ?? true] as never[]);
  if (opts.geloescht === true) {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(
        `update dokument set geloescht_am = now(), loeschgrund = 'Test' where id = $1`,
        [d!.id]);
    });
  }
  return d!.id;
}

/** Eine interne Sitzung — SCHREIBEND, sonst faellt jede `with check` in die RLS. */
const als = <T>(
  mandant: string, benutzer: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: benutzer,
           portal: 'intern', readonly: false }, fn);

const kontext = (tx: postgres.TransactionSql) => ({
  abfrage: async <T,>(s: string, w: readonly unknown[] = []): Promise<readonly T[]> =>
    (await tx.unsafe(s, w as never[])) as unknown as readonly T[],
});

/** Die Sitzung der Arbeiterin — der ECHTE Personen-Scope des Mitarbeiterportals. */
function arbeiterin(mandant: string): Sitzung {
  return {
    benutzerId: fatimaKonto, personId: f.fatima, aktiverMandantId: mandant,
    ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter', sitzungId: SITZUNG,
  };
}

async function sichtbarFuerArbeiterin(mandant: string, id: string): Promise<boolean> {
  const z = await (sql.begin(async (tx) =>
    withPersonScope(tx as never, arbeiterin(mandant),
      (k: LeseKontext) => findeEigenesDokument(k, id))) as Promise<unknown>);
  return z !== null;
}

beforeEach(async () => {
  f = await seed();
  fatimaKonto = await konto(f.fatima);
  await mitglied(fatimaKonto, f.reinigung, 'mitarbeiter');
});

afterAll(async () => { await schliessen(); });

describe('(1) die Rücknahme wirkt dort, wo die Freigabe wirkte', () => {
  it('ein freigegebener Vertrag mit Löschsperre verschwindet aus dem Mitarbeiterportal', async () => {
    const leitung = await konto();
    await mitglied(leitung, f.reinigung, 'leitung');
    const id = await dokument(f.reinigung);
    const [sperre] = await sql.unsafe<{ loeschsperre: boolean }[]>(
      `select loeschsperre from dokument where id = $1`, [id]);
    expect(sperre!.loeschsperre).toBe(true);
    expect(await sichtbarFuerArbeiterin(f.reinigung, id)).toBe(true);

    const ergebnis = await als(f.reinigung, leitung, (tx) => setzeMitarbeiterfreigabe(
      kontext(tx), id, { sichtbar: false, grund: 'Versehentlich freigegeben' }));
    expect(ergebnis.sichtbar).toBe(false);
    expect(await sichtbarFuerArbeiterin(f.reinigung, id)).toBe(false);

    /* Und zurück — derselbe Schalter, dieselbe Pflicht zum Grund. */
    await als(f.reinigung, leitung, (tx) => setzeMitarbeiterfreigabe(
      kontext(tx), id, { sichtbar: true, grund: 'Aushang für alle Kräfte' }));
    expect(await sichtbarFuerArbeiterin(f.reinigung, id)).toBe(true);
  });

  it('der Grund steht im Prüfprotokoll — mit Kategorie und Richtung', async () => {
    const leitung = await konto();
    await mitglied(leitung, f.reinigung, 'leitung');
    const id = await dokument(f.reinigung);
    await als(f.reinigung, leitung, (tx) => setzeMitarbeiterfreigabe(
      kontext(tx), id, { sichtbar: false, grund: '  Enthält Einzelangaben  ' }));

    const zeilen = await sql.unsafe<{ aktion: string; nachher: Record<string, unknown> }[]>(
      `select aktion, nachher from audit_log
        where objekt_typ = 'dokument' and objekt_id = $1
          and aktion = 'dokument.mitarbeiterfreigabe_zurueckgenommen'`, [id]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.nachher).toMatchObject({
      sichtbar_fuer_mitarbeiter: false, kategorie: 'vertrag', grund: 'Enthält Einzelangaben',
    });
  });
});

describe('(2) die Abweisungen', () => {
  it('ohne Grund, im selben Stand und gelöscht — je ein eigener Grund', async () => {
    const leitung = await konto();
    await mitglied(leitung, f.reinigung, 'leitung');
    const frei = await dokument(f.reinigung);
    const weg = await dokument(f.reinigung, { geloescht: true });

    await expect(als(f.reinigung, leitung, (tx) => setzeMitarbeiterfreigabe(
      kontext(tx), frei, { sichtbar: false, grund: '   ' })))
      .rejects.toMatchObject({ grund: 'ohne_grund' });
    await expect(als(f.reinigung, leitung, (tx) => setzeMitarbeiterfreigabe(
      kontext(tx), frei, { sichtbar: true, grund: 'noch einmal' })))
      .rejects.toMatchObject({ grund: 'schon_so' });
    await expect(als(f.reinigung, leitung, (tx) => setzeMitarbeiterfreigabe(
      kontext(tx), weg, { sichtbar: false, grund: 'zu spät' })))
      .rejects.toMatchObject({ grund: 'geloescht' });
    expect(await sichtbarFuerArbeiterin(f.reinigung, frei)).toBe(true);
  });

  /**
   * **Die zweite Linie** (Invariante 3). Die Rolle `mitarbeiter` hält
   * `dokument.schreiben`, aber nicht `dokument.lesen` — `t_mandant` gibt ihr
   * die Zeile nicht heraus, und der Schalter bleibt, wo er ist.
   */
  it('ein Konto ohne dokument.lesen schaltet nichts um — die Zeile gibt es für es nicht', async () => {
    const kraft = await konto();
    await mitglied(kraft, f.reinigung, 'mitarbeiter');
    const id = await dokument(f.reinigung);
    await expect(als(f.reinigung, kraft, (tx) => setzeMitarbeiterfreigabe(
      kontext(tx), id, { sichtbar: false, grund: 'Versuch' })))
      .rejects.toBeInstanceOf(DokumentfreigabeFehler);
    const [z] = await sql.unsafe<{ frei: boolean }[]>(
      `select sichtbar_fuer_mitarbeiter as frei from dokument where id = $1`, [id]);
    expect(z!.frei).toBe(true);
  });

  it('ein Dokument einer anderen Gesellschaft ist „nicht gefunden" (AUT-06)', async () => {
    const leitung = await konto();
    await mitglied(leitung, f.reinigung, 'leitung');
    const fremd = await dokument(f.security);
    await expect(als(f.reinigung, leitung, (tx) => setzeMitarbeiterfreigabe(
      kontext(tx), fremd, { sichtbar: false, grund: 'fremd' })))
      .rejects.toMatchObject({ grund: 'nicht_gefunden' });
  });
});
