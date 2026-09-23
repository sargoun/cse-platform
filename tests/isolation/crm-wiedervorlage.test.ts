/**
 * Die Wiedervorlage und ihr SPIEGEL — gegen echte Rechte und echte Tabellen
 * (CRM-04, O-663, 0250).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, den diese Datei festschreibt: eine Zusage ohne Prüfung.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `legeWiedervorlageAn` schreibt in DREI Tabellen — `lead_aktivitaet`,
 * `aufgabe`, `kalender_eintrag` — und ist der einzige Grund für den Enumwert
 * `bezug_typ = 'lead_aktivitaet'` aus 0250. Die Oberfläche versprach dem
 * Menschen, dass „beide Vorgänge die gespiegelte Aufgabe mit anfassen";
 * geprüft hat das nichts, und gerufen wurde die Funktion von keinem Formular.
 * Drei INSERTs und ein Enumwert waren damit eine Behauptung.
 *
 * **Was diese Datei beweist:**
 *
 *  1. Mit allen Rechten entstehen ALLE DREI Zeilen, und `nichtGespiegelt` ist
 *     leer.
 *  2. Ohne `aufgabe.schreiben` entsteht die Aufgabe NICHT — und das steht als
 *     deutscher Satz in `nichtGespiegelt`, statt verschwiegen zu werden.
 *  3. Ohne `kalender.schreiben` dasselbe für den Kalendereintrag.
 *  4. `erledige` zieht die gespiegelte Aufgabe mit; sonst stünde derselbe
 *     Vorgang an einer Stelle erledigt und an der anderen offen.
 *  5. `verschiebe` zieht die Fälligkeit der Aufgabe mit — und hält die
 *     Verschiebung als eigene Notizzeile fest.
 *  6. Ohne Bezug (weder Lead noch Kunde) wird abgewiesen, bevor
 *     `lead_aktivitaet_hat_bezug` es tut.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { CrmFehler } from '../../src/server/services/crm/anlegen.js';
import {
  erledige, legeWiedervorlageAn, verschiebe,
} from '../../src/server/services/crm/wiedervorlage.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(): Promise<string> {
  const email = `wv-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht]);
}

async function mitgliedschaft(benutzerId: string, mandantId: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, $3, false)`, [benutzerId, mandantId, await rolleId('admin')]);
}

async function kunde(mandantId: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Wiedervorlage Testfall', 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [mandantId, `K-${zufall()}`]);
  return z!.id;
}

type Abfrager = { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> };

function kontextAus(tx: Abfrager, mandantId: string) {
  return {
    scope: 'mandant',
    portal: 'intern',
    aktiverMandantId: mandantId,
    benutzerId: chef,
    mandantIds: [mandantId],
    abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
    schreibe: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
  } as never;
}

async function alsIntern<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId: chef, portal: 'intern', readonly: false },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal','aal2',true)`);
      return fn(tx);
    },
  );
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await mitgliedschaft(chef, f.reinigung);
});

afterAll(async () => { await schliessen(); });

describe('der Spiegel entsteht — in allen drei Tabellen', () => {
  it('mit allen Rechten: Aufgabe UND Kalendereintrag, nichts unterschlagen', async () => {
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Angebot nachfassen', faelligAm: '2026-10-01T09:00', kundeId: k,
      }));
    expect(spiegel.aufgabeId).not.toBeNull();
    expect(spiegel.kalenderId).not.toBeNull();
    expect(spiegel.nichtGespiegelt).toHaveLength(0);
  });

  it('die Aufgabe trägt den Bezug aus 0250 — `lead_aktivitaet`', async () => {
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Bezug prüfen', faelligAm: '2026-10-01T09:00', kundeId: k,
      }));
    const [z] = await sql.unsafe<{ typ: string; bezug: string }[]>(
      `select bezug_typ::text as typ, bezug_id::text as bezug from aufgabe where id = $1`,
      [spiegel.aufgabeId]);
    expect(z!.typ).toBe('lead_aktivitaet');
    expect(z!.bezug).toBe(spiegel.aktivitaetId);
  });
});

describe('was NICHT entsteht, wird BENANNT — nicht verschwiegen', () => {
  it('ohne `aufgabe.schreiben` fehlt die Aufgabe, und der Satz sagt es', async () => {
    await entziehe('admin', 'aufgabe.schreiben', f.reinigung);
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Ohne Aufgabenrecht', faelligAm: '2026-10-02T09:00', kundeId: k,
      }));
    expect(spiegel.aufgabeId).toBeNull();
    expect(spiegel.kalenderId).not.toBeNull();
    expect(spiegel.nichtGespiegelt).toHaveLength(1);
    expect(spiegel.nichtGespiegelt[0]).toContain('aufgabe.schreiben');
  });

  it('ohne `kalender.schreiben` fehlt der Eintrag, und der Satz sagt es', async () => {
    await entziehe('admin', 'kalender.schreiben', f.reinigung);
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Ohne Kalenderrecht', faelligAm: '2026-10-02T09:00', kundeId: k,
      }));
    expect(spiegel.kalenderId).toBeNull();
    expect(spiegel.nichtGespiegelt.join(' ')).toContain('kalender.schreiben');
  });

  it('ohne BEIDE bleibt die Wiedervorlage selbst stehen', async () => {
    await entziehe('admin', 'aufgabe.schreiben', f.reinigung);
    await entziehe('admin', 'kalender.schreiben', f.reinigung);
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Ohne beide', faelligAm: '2026-10-03T09:00', kundeId: k,
      }));
    expect(spiegel.aktivitaetId).toBeTruthy();
    expect(spiegel.nichtGespiegelt).toHaveLength(2);
  });
});

describe('erledigen und verschieben fassen den Spiegel mit an', () => {
  it('`erledige` schliesst die gespiegelte Aufgabe mit', async () => {
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Erledigen', faelligAm: '2026-10-01T09:00', kundeId: k,
      }));
    await alsIntern(f.reinigung, async (tx) =>
      erledige(kontextAus(tx, f.reinigung), spiegel.aktivitaetId));
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from aufgabe where id = $1`, [spiegel.aufgabeId]);
    expect(z!.status).toBe('erledigt');
  });

  it('`verschiebe` zieht die Fälligkeit der Aufgabe mit', async () => {
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Verschieben', faelligAm: '2026-10-01T09:00', kundeId: k,
      }));
    await alsIntern(f.reinigung, async (tx) =>
      verschiebe(kontextAus(tx, f.reinigung), spiegel.aktivitaetId,
        '2026-11-15T09:00', 'Kunde bittet um später'));
    const [z] = await sql.unsafe<{ tag: string }[]>(
      `select (faellig_am at time zone 'Europe/Berlin')::date::text as tag
         from aufgabe where id = $1`, [spiegel.aufgabeId]);
    expect(z!.tag).toBe('2026-11-15');
  });

  it('die Verschiebung steht als eigene Notiz im Verlauf', async () => {
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Verlauf', faelligAm: '2026-10-01T09:00', kundeId: k,
      }));
    await alsIntern(f.reinigung, async (tx) =>
      verschiebe(kontextAus(tx, f.reinigung), spiegel.aktivitaetId,
        '2026-11-15T09:00', 'Kunde bittet um später'));
    const [z] = await sql.unsafe<{ inhalt: string }[]>(
      `select inhalt from lead_aktivitaet
        where mandant_id = $1 and betreff = 'Wiedervorlage verschoben'`, [f.reinigung]);
    expect(z!.inhalt).toContain('01.10.2026');
    expect(z!.inhalt).toContain('Kunde bittet um später');
  });
});

/**
 * **V-079 — die Wiedervorlage liess sich niemandem zuweisen.**
 *
 * `legeWiedervorlageAn` nimmt `zustaendigBenutzerId` und `leadId` seit je
 * entgegen, und `POST /api/crm/wiedervorlage` reicht beide durch. Das
 * einzige Anlegeformular stand auf dem Kontaktblatt und schickte **weder das
 * eine noch das andere** — jede Wiedervorlage entstand ohne Zustaendigen und
 * ohne Leadbezug. In der Liste stand „niemand zugewiesen", und sie wartete
 * auf niemanden.
 *
 * Gemessen wird hier, dass beides bis in die Zeile UND in den Spiegel
 * durchschlaegt: eine Aufgabe, die auf niemanden zeigt, taucht in keiner
 * persoenlichen Arbeitsliste auf.
 */
describe('V-079 — Zustaendige und Leadbezug kommen an', () => {
  it('der Zustaendige steht in der Aktivitaet UND in der gespiegelten Aufgabe', async () => {
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Zuweisung prüfen', faelligAm: '2026-10-01T09:00', kundeId: k,
        zustaendigBenutzerId: chef,
      }));

    const [a] = await sql.unsafe<{ wer: string | null }[]>(
      `select zustaendig_benutzer_id::text as wer from lead_aktivitaet where id = $1`,
      [spiegel.aktivitaetId]);
    expect(a!.wer).toBe(chef);

    /* Die Aufgabe nennt ihre Spalte `zugewiesen_an` (0230) — dieselbe
       Tatsache, ein anderer Name. Ohne Zuweisung setzt der Dienst dort
       `app.aktueller_benutzer()`, damit die Aufgabe nie auf niemanden zeigt. */
    const [auf] = await sql.unsafe<{ wer: string | null }[]>(
      `select zugewiesen_an::text as wer from aufgabe where id = $1`,
      [spiegel.aufgabeId]);
    expect(auf!.wer).toBe(chef);
  });

  /**
   * **Und die Richtigstellung zum Register.** V-079 sagt „lässt sich
   * niemandem zuweisen". Gemessen stimmt das so nicht: ohne Angabe setzt der
   * Dienst `coalesce($8, app.aktueller_benutzer())` — eine Wiedervorlage
   * fällt an den, der sie anlegt, und liegt nie bei niemandem. Die Lücke war
   * enger und trotzdem echt: sie liess sich niemand ANDEREM zuweisen, weil
   * kein Formular das Feld schickte, und zu einem LEAD gar nicht anlegen.
   */
  it('ohne Angabe fällt sie an den, der sie anlegt — nie an niemanden', async () => {
    const k = await kunde(f.reinigung);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Ohne Zuweisung', faelligAm: '2026-10-01T09:00', kundeId: k,
      }));
    const [a] = await sql.unsafe<{ wer: string | null }[]>(
      `select zustaendig_benutzer_id::text as wer from lead_aktivitaet where id = $1`,
      [spiegel.aktivitaetId]);
    expect(a!.wer).toBe(chef);
  });

  it('eine Wiedervorlage ZUM LEAD traegt seinen Bezug', async () => {
    /* `quelle = 'manuell'`: `lead_herkunft_stimmig` verlangt bei
       `webformular` einen `formular_eingang_id`, bei `vergabe_radar` eine
       Ausschreibung und bei `empfehlung` einen Kunden. Die Fixtur braucht
       keine Herkunft, sondern einen Lead. */
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into lead (mandant_id, leadnummer, betreff, quelle, status,
                         besitzer_benutzer_id, firma_name)
       values ($1, $2, 'Anfrage Treppenhaus', 'manuell', 'neu', $3,
               'Hausverwaltung Probe')
       returning id`,
      [f.reinigung, `L-${zufall()}`, chef]);
    const spiegel = await alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Angebot nachfassen', faelligAm: '2026-10-01T09:00',
        leadId: l!.id, zustaendigBenutzerId: chef,
      }));
    const [a] = await sql.unsafe<{ lead: string | null; wer: string | null }[]>(
      `select lead_id::text as lead, zustaendig_benutzer_id::text as wer
         from lead_aktivitaet where id = $1`, [spiegel.aktivitaetId]);
    expect(a!.lead).toBe(l!.id);
    expect(a!.wer).toBe(chef);
  });
});

describe('ohne Bezug gibt es keine Wiedervorlage', () => {
  it('weder Lead noch Kunde wird mit einem Satz abgewiesen', async () => {
    await expect(alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Ohne Bezug', faelligAm: '2026-10-01T09:00',
      }))).rejects.toThrow(CrmFehler);
  });

  it('ohne Fälligkeit ebenso — es wäre eine Notiz', async () => {
    const k = await kunde(f.reinigung);
    await expect(alsIntern(f.reinigung, async (tx) =>
      legeWiedervorlageAn(kontextAus(tx, f.reinigung), {
        betreff: 'Ohne Frist', faelligAm: '', kundeId: k,
      }))).rejects.toThrow(/Frist|Fälligkeit/u);
  });
});
