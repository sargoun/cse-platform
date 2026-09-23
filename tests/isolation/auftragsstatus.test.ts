import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { WEGE, setzeAuftragsstatus } from '../../src/server/services/auftrag/status.js';

/**
 * **Der Auftragsstatus bewegt sich** (V-081, OPS-05).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `auftrag_status` kennt seit `0025` fünf Zustände. Geschrieben wurde genau
 * EINER — `abgeschlossen`, vom Abschlussdienst. Jeder Auftrag stand von
 * seiner Anlage bis zu seinem Ende auf `angelegt`, während das Auftragsblatt
 * vier weitere Etiketten kannte, die nie jemand sah.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das gegen eine echte Datenbank gehört.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Tabelle der erlaubten Wege steht DREIMAL: in der Oberfläche (damit kein
 * Knopf etwas anbietet, das abgewiesen wird), im Dienst (damit ein Mensch
 * einen Satz bekommt) und im Auslöser `kern.auftrag_status_pruefen` (`0389`,
 * damit sie auch für einen Aufrufer gilt, der den Dienst nie gesehen hat).
 * Ob die drei dasselbe sagen, lässt sich nur hier zeigen — und dass die
 * DRITTE hält, ohnehin nur hier.
 *
 * Und `storniert` ist einwegig: das prüft diese Datei am Auslöser, nicht am
 * Dienst. Ein Dienst, der die einzige Wand ist, ist keine.
 */

let f: Fixtur;
let leitung = '';
let auftragId = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `auftrag-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Disposition','aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [u!.id, mandant, await rolleId(rolle)] as never[]);
  return u!.id;
}

async function baueAuftrag(mandant: string, verantwortlich: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin')
     returning id`, [mandant, `K-${zufall()}`] as never[]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'dauerauftrag','Unterhaltsreinigung',$4,'2026-01-01')
     returning id`,
    [mandant, `AU-${zufall()}`, k!.id, verantwortlich] as never[]);
  return a!.id;
}

function kontext(tx: postgres.TransactionSql, mandantId: string, benutzerId: string): SchreibKontext {
  const lauf = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: lauf, schreibe: lauf,
  };
}

async function alsWer<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
  o: { readonly mandantId?: string; readonly readonly?: boolean } = {},
): Promise<T> {
  const mandantId = o.mandantId ?? f.reinigung;
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern',
      readonly: o.readonly ?? false, aal: 'aal2' },
    (tx) => fn(kontext(tx, mandantId, benutzerId)),
  );
}

interface Stand {
  readonly status: string;
  readonly grund: string | null;
  readonly seit: string | null;
}

async function stand(id = auftragId): Promise<Stand> {
  const [z] = await sql.unsafe<{
    status: string; status_grund: string | null; seit: string | null;
  }[]>(
    `select status::text as status, status_grund,
            status_geaendert_am::text as seit
       from auftrag where id = $1`, [id] as never[]);
  return { status: z!.status, grund: z!.status_grund, seit: z!.seit };
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(f.reinigung, 'leitung');
  auftragId = await baueAuftrag(f.reinigung, leitung);
});
afterAll(schliessen);

describe('§1 die Wege, die offenstehen', () => {
  it('nimmt einen angelegten Auftrag in Arbeit — ohne Grund, das ist der Normalweg', async () => {
    expect((await stand()).status).toBe('angelegt');
    await alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', ''));
    const z = await stand();
    expect(z.status).toBe('aktiv');
    expect(z.grund).toBeNull();
    /* Den Zeitpunkt setzt der AUSLÖSER aus der Serveruhr (Invariante 5). */
    expect(z.seit).not.toBeNull();
  });

  it('lässt ihn ruhen — mit Grund', async () => {
    await alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', ''));
    await alsWer(leitung, (k) => setzeAuftragsstatus(
      k, auftragId, 'pausiert', 'Objekt bis 30.06. geschlossen, Kunde hat unterbrochen.'));
    const z = await stand();
    expect(z.status).toBe('pausiert');
    expect(z.grund).toBe('Objekt bis 30.06. geschlossen, Kunde hat unterbrochen.');
  });

  it('nimmt ihn wieder auf — und räumt den Grund der Pause', async () => {
    await alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'pausiert', 'Winterpause.'));
    await alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', ''));
    const z = await stand();
    expect(z.status).toBe('aktiv');
    /*
     * Der Grund gehört dem AKTUELLEN Zustand. Ein stehengebliebener Satz an
     * einem laufenden Auftrag läse sich wie ein Zustand, der nicht mehr
     * besteht — die Spur bleibt im Protokoll.
     */
    expect(z.grund).toBeNull();
  });

  it('storniert — mit Grund, und aus jedem der drei offenen Zustände', async () => {
    await alsWer(leitung, (k) => setzeAuftragsstatus(
      k, auftragId, 'storniert', 'Der Kunde hat vor Leistungsbeginn gekündigt.'));
    const z = await stand();
    expect(z.status).toBe('storniert');
    expect(z.grund).toBe('Der Kunde hat vor Leistungsbeginn gekündigt.');
  });

  it('schreibt Vorher UND Nachher ins Protokoll', async () => {
    await alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', ''));
    const [z] = await sql.unsafe<{
      vorher: Record<string, unknown> | null; nachher: Record<string, unknown> | null;
    }[]>(
      `select vorher, nachher from audit_log
        where aktion = 'auftrag.status_gesetzt' and mandant_id = $1
        order by id desc limit 1`, [f.reinigung] as never[]);
    expect(z?.vorher?.['status']).toBe('angelegt');
    expect(z?.nachher?.['status']).toBe('aktiv');
  });
});

describe('§2 die Wege, die es nicht gibt', () => {
  it('weist Pausieren und Stornieren OHNE Grund ab — und schreibt nichts', async () => {
    await expect(alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'pausiert', '  ')))
      .rejects.toMatchObject({ grund: 'ohne_begruendung' });
    await expect(alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'storniert', '')))
      .rejects.toMatchObject({ grund: 'ohne_begruendung' });
    expect((await stand()).status).toBe('angelegt');
  });

  it('weist `abgeschlossen` ab — der Abschluss trägt sein eigenes Recht', async () => {
    /*
     * Er hier anzubieten hiesse, ihn an `auftrag.schreiben` zu binden — genau
     * die Vermischung, die `0296` aufgelöst hat: der Abschluss stellt nach
     * D-366 die FIN-18-Warnung im Rechnungsweg scharf.
     */
    await expect(alsWer(leitung, (k) => setzeAuftragsstatus(
      k, auftragId, 'abgeschlossen', 'Fertig.')))
      .rejects.toMatchObject({ grund: 'unbekannter_zustand' });
    expect((await stand()).status).toBe('angelegt');
  });

  it('weist denselben Zustand noch einmal ab, statt still nichts zu tun', async () => {
    await alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', ''));
    await expect(alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', '')))
      .rejects.toMatchObject({ grund: 'unveraendert' });
  });

  it('nimmt einen STORNIERTEN Auftrag nicht wieder auf', async () => {
    await alsWer(leitung, (k) => setzeAuftragsstatus(
      k, auftragId, 'storniert', 'Der Kunde hat gekündigt.'));
    await expect(alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', '')))
      .rejects.toMatchObject({ grund: 'kein_weg' });
    expect((await stand()).status).toBe('storniert');
  });

  it('und der AUSLÖSER hält das auch ohne den Dienst', async () => {
    /*
     * **Die Wand, auf die es ankommt.** Ein Dienst, der die einzige Wand ist,
     * ist keine: er lässt sich umgehen, von einer Migration, von einem Skript,
     * von der nächsten Route, die jemand schreibt. `0389` steht VOR der Zeile.
     */
    await alsWer(leitung, (k) => setzeAuftragsstatus(
      k, auftragId, 'storniert', 'Der Kunde hat gekündigt.'));
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update auftrag set status = 'aktiv' where id = $1`, [auftragId] as never[])))
      .rejects.toThrow(/nicht wieder aufgenommen/u);
  });

  it('ein Grund aus Leerzeichen zählt auch für die Datenbank nicht', async () => {
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update auftrag set status = 'pausiert', status_grund = '   ' where id = $1`,
      [auftragId] as never[]))).rejects.toThrow(/statusgrund_begruendet/u);
  });

  it('und ein Zustand ohne Grund ebenso', async () => {
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update auftrag set status = 'storniert' where id = $1`, [auftragId] as never[])))
      .rejects.toThrow(/statusgrund_begruendet/u);
  });
});

describe('§3 die Wände', () => {
  it('ohne `auftrag.schreiben` geschieht nichts — und es sieht nicht wie Erfolg aus', async () => {
    /*
     * `for update` wendet das `using` der UPDATE-Policy an: eine Sitzung ohne
     * das Recht bekommt NULL Zeilen. Ohne die Sperre stünde weiter unten ein
     * `update`, das null Zeilen trifft und wie ein Erfolg aussieht.
     */
    const ohne = await konto(f.reinigung, 'mitarbeiter');
    await expect(alsWer(ohne, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', '')))
      .rejects.toMatchObject({ grund: 'nicht_gefunden', status: 404 });
    expect((await stand()).status).toBe('angelegt');
  });

  it('ein Auftrag einer FREMDEN Gesellschaft gibt es nicht (Invariante 3)', async () => {
    const imBau = await konto(f.bau, 'leitung');
    const fremd = await baueAuftrag(f.bau, imBau);
    await expect(alsWer(leitung, (k) => setzeAuftragsstatus(k, fremd, 'aktiv', '')))
      .rejects.toMatchObject({ grund: 'nicht_gefunden' });
    expect((await stand(fremd)).status).toBe('angelegt');
  });

  it('in der Nur-Lese-Bindung geschieht nichts (Invariante 10)', async () => {
    await expect(alsWer(leitung, (k) => setzeAuftragsstatus(k, auftragId, 'aktiv', ''),
      { readonly: true })).rejects.toThrow();
    expect((await stand()).status).toBe('angelegt');
  });
});

describe('§4 die Tabelle der Wege sagt dreimal dasselbe', () => {
  it('`WEGE` kennt genau die Zustände, die der Auslöser zulässt', () => {
    expect(WEGE['angelegt']).toEqual(['aktiv', 'pausiert', 'storniert']);
    expect(WEGE['aktiv']).toEqual(['pausiert', 'storniert']);
    expect(WEGE['pausiert']).toEqual(['aktiv', 'storniert']);
    /* Zwei Endstationen — und die Oberfläche zeigt dort kein Formular. */
    expect(WEGE['storniert']).toEqual([]);
    expect(WEGE['abgeschlossen']).toEqual([]);
  });

  it('und jeder darin genannte Weg geht wirklich', async () => {
    /*
     * Die Behauptung von oben, an der Datenbank nachgezählt: was `WEGE` als
     * offen führt, muss der Auslöser durchlassen — sonst böte die Oberfläche
     * einen Knopf an, der abgewiesen wird.
     */
    for (const [von, ziele] of Object.entries(WEGE)) {
      for (const nach of ziele) {
        const id = await baueAuftrag(f.reinigung, leitung);
        if (von !== 'angelegt') {
          await alsWer(leitung, (k) => setzeAuftragsstatus(k, id, von as never, 'Vorstufe.'));
        }
        await expect(alsWer(leitung, (k) => setzeAuftragsstatus(k, id, nach, 'Weg geprüft.')),
          `${von} → ${nach}`).resolves.toBeUndefined();
        expect((await stand(id)).status, `${von} → ${nach}`).toBe(nach);
      }
    }
  });
});
