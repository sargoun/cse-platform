/**
 * Die Stapelmappe gegen echtes Postgres (APR-02, APR-03, APR-04, APR-07,
 * Invariante 3, Invariante 7).
 *
 * **Was hier steht und nirgends sonst stehen kann.**
 *
 *  1. Ein unsicheres Feld nimmt den Vorgang aus dem Stapel — und zwar in der
 *     DATENBANK: `trg_freigabe_felder_zaehlen` setzt `stapel_faehig = false`,
 *     und ein CHECK verbietet die Kombination ueberhaupt. Die Mappe zeigt ihn
 *     trotzdem, mit Grund.
 *  2. Eine markierte Zeile, die ein Browser trotzdem mitschickt, wird beim
 *     Entscheiden ein ZWEITES Mal bewertet und bleibt offen (APR-04).
 *  3. Die Mappe zeigt nur, was diese Gesellschaft sieht (AUT-06).
 *  4. `darfStapel` folgt `freigabe.stapel_entscheiden`, nicht
 *     `freigabe.entscheiden` (O-367).
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { createHash } from 'node:crypto';
import { kanonisiere } from '../../src/server/services/finanz/kanonisch.js';
import { alsKanonischerWert } from '../../src/server/services/freigabe/diff-json.js';
import { ladeStapelMappe, teileStapel } from '../../src/server/services/freigabe/stapel-mappe.js';
import { entscheideStapel } from '../../src/server/services/freigabe/stapel.js';

let f: Fixtur;
let stapler = '';    // freigabe.lesen + entscheiden + stapel_entscheiden
let pruefer = '';    // freigabe.lesen + entscheiden, OHNE Stapel
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

/** Die Nutzlast jeder Testfreigabe — und ihr KANONISCHER Hash (APR-07). */
const NUTZLAST: Record<string, unknown> = { aktion: 'interner_hinweis' };

function nutzlastHash(): string {
  return createHash('sha256')
    .update(kanonisiere(alsKanonischerWert(NUTZLAST)))
    .digest('hex');
}

/**
 * Eine offene, stapelfaehige Freigabe — als Eigentuemer angelegt.
 *
 * `freigabe_offen_ist_vorzeigbar` verlangt an einer OFFENEN Zeile mit
 * `vorgang_typ` Titel, Zusammenfassung, Nutzlast, Hash und Risiko: eine
 * Freigabe, die niemand ansehen kann, ist keine (D-468). Und der Hash ist der
 * der KANONISCHEN Bytes — `app.freigabe_entscheiden` prueft beim Entscheiden
 * nach, dass die eingereichte Nutzlast die vorgelegte ist (APR-07).
 */
async function freigabe(
  mandant: string, opts: { stapelFaehig?: boolean; sperre?: string | null } = {},
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                           zusammenfassung, risiko, diff, vorschau_payload,
                           payload_hash, betrag_cent, stapel_faehig, stapel_sperre_grund)
     values ($1, 'interner_hinweis', 'offen', 'interner_hinweis',
             $2, 'Routinevorgang', 'niedrig', '[]'::jsonb, $3::jsonb,
             $4, 1200, $5, $6)
     returning id`,
    /* Das OBJEKT, nicht sein JSON-Text: der Treiber kodiert einen Text ein
       zweites Mal, und der Hash passte danach zu nichts. */
    [mandant, `Hinweis ${zufall()}`, NUTZLAST, nutzlastHash(),
      opts.stapelFaehig ?? true, opts.sperre ?? null] as never[]);
  return z!.id;
}

async function feld(
  mandant: string, freigabeId: string, unsicher: boolean,
): Promise<void> {
  await sql.unsafe(
    /* `ff_hat_eine_quelle`: jedes extrahierte Feld nennt eine Quelle —
       ein Dokument oder wenigstens das Zitat, aus dem der Wert stammt. */
    `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung,
                                wert_vorher, wert_nachher, konfidenz, unsicher, grund,
                                quelle_zitat)
     values ($1,$2,'/betrag','Betrag','1.100,00 €','1.200,00 €',$3,$4,$5,
             'Gesamtbetrag 1.200,00 €')`,
    [mandant, freigabeId, unsicher ? 0.42 : 0.98, unsicher,
      unsicher ? 'Betrag aus dem Anschreiben, nicht aus der Tabelle' : null]);
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
  stapler = await konto('stapler');
  pruefer = await konto('pruefer');
  await mitglied(stapler, f.reinigung, await rolleMit(f.reinigung, 'stapler', [
    'freigabe.lesen', 'freigabe.entscheiden', 'freigabe.stapel_entscheiden',
  ]));
  await mitglied(pruefer, f.reinigung, await rolleMit(f.reinigung, 'pruefer', [
    'freigabe.lesen', 'freigabe.entscheiden',
  ]));
});
afterAll(schliessen);

describe('(1) jeder Fall ist einzeln zu sehen — mit seinen Feldern', () => {
  it('die Mappe legt zu jedem Vorgang seine geaenderten Felder daneben (APR-02)', async () => {
    const id = await freigabe(f.reinigung);
    await feld(f.reinigung, id, false);

    const mappe = await als(stapler, (tx) =>
      ladeStapelMappe(kontextAus(tx, stapler, f.reinigung), new Date()));
    const fall = mappe.faelle.find((x) => x.eintrag.id === id);
    expect(fall).toBeDefined();
    expect(fall?.felder).toHaveLength(1);
    expect(fall?.felder[0]?.bezeichnung).toBe('Betrag');
    expect(fall?.felder[0]?.wertVorher).toBe('1.100,00 €');
    expect(fall?.felder[0]?.wertNachher).toBe('1.200,00 €');
    expect(fall?.grund).toBeNull();
  });

  it('ein unsicheres Feld nimmt den Vorgang aus dem Stapel — und er BLEIBT sichtbar', async () => {
    const id = await freigabe(f.reinigung);
    await feld(f.reinigung, id, true);

    const mappe = await als(stapler, (tx) =>
      ladeStapelMappe(kontextAus(tx, stapler, f.reinigung), new Date()));
    const { stapelbar, ausgenommen } = teileStapel(mappe.faelle);

    expect(stapelbar.map((x) => x.eintrag.id)).not.toContain(id);
    const fall = ausgenommen.find((x) => x.eintrag.id === id);
    expect(fall, 'ein ausgenommener Fall verschwindet nicht').toBeDefined();
    expect(fall?.grund).toMatch(/APR-03|einzeln/u);
    expect(fall?.felder[0]?.unsicher).toBe(true);
  });

  it('ein markierter Vorgang traegt den Grund DES DIENSTES', async () => {
    const id = await freigabe(f.reinigung, {
      stapelFaehig: false, sperre: 'Neuer Lieferant — erste Rechnung',
    });
    const mappe = await als(stapler, (tx) =>
      ladeStapelMappe(kontextAus(tx, stapler, f.reinigung), new Date()));
    expect(mappe.faelle.find((x) => x.eintrag.id === id)?.grund)
      .toBe('Neuer Lieferant — erste Rechnung');
  });
});

describe('(2) die Ausnahme haelt auch gegen den Browser (APR-04)', () => {
  it('eine markierte Zeile im Stapel bleibt offen — der Server bewertet neu', async () => {
    const gut = await freigabe(f.reinigung);
    const markiert = await freigabe(f.reinigung, {
      stapelFaehig: false, sperre: 'Einzeln prüfen',
    });

    const bericht = await als(stapler, (tx) =>
      entscheideStapel(kontextAus(tx, stapler, f.reinigung), [gut, markiert],
        { ip: null, userAgent: null, codeVersion: 'test' }));

    expect(bericht.genehmigt).toBe(1);
    expect(bericht.uebersprungen.map((u) => u.freigabeId)).toEqual([markiert]);
    expect(bericht.uebersprungen[0]?.grund).toBe('Einzeln prüfen');

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from freigabe where id = $1`, [markiert]);
    expect(z?.status).toBe('offen');
  });

  it('und jede genehmigte Zeile hinterlaesst ihre Ansicht mit dem Kanal `stapel` (APR-08)', async () => {
    const id = await freigabe(f.reinigung);
    await als(stapler, (tx) =>
      entscheideStapel(kontextAus(tx, stapler, f.reinigung), [id],
        { ip: null, userAgent: null, codeVersion: 'test' }));

    const [a] = await sql.unsafe<{ kanal: string }[]>(
      `select kanal::text as kanal from freigabe_ansicht where freigabe_id = $1`, [id]);
    expect(a?.kanal).toBe('stapel');
  });
});

describe('(3) Recht und Gesellschaft', () => {
  it('`darfStapel` folgt `freigabe.stapel_entscheiden`, nicht `freigabe.entscheiden`', async () => {
    const mitRecht = await als(stapler, (tx) =>
      ladeStapelMappe(kontextAus(tx, stapler, f.reinigung), new Date()));
    const ohneRecht = await als(pruefer, (tx) =>
      ladeStapelMappe(kontextAus(tx, pruefer, f.reinigung), new Date()));
    expect(mitRecht.darfStapel).toBe(true);
    expect(ohneRecht.darfStapel).toBe(false);
  });

  it('ohne das Recht bricht der Stapel VORN ab, nicht nach fuenfzig Entscheidungen', async () => {
    const id = await freigabe(f.reinigung);
    await expect(als(pruefer, (tx) =>
      entscheideStapel(kontextAus(tx, pruefer, f.reinigung), [id],
        { ip: null, userAgent: null, codeVersion: 'test' }),
    )).rejects.toThrow(/eigene Befugnis/u);

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from freigabe where id = $1`, [id]);
    expect(z?.status).toBe('offen');
  });

  it('eine Freigabe der Security steht nicht in der Mappe der Reinigung (AUT-06)', async () => {
    const fremd = await freigabe(f.security);
    const mappe = await als(stapler, (tx) =>
      ladeStapelMappe(kontextAus(tx, stapler, f.reinigung), new Date()));
    expect(mappe.faelle.map((x) => x.eintrag.id)).not.toContain(fremd);
  });
});
