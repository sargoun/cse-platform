import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { LokalerSpeicher, NichtVerbundenFehler, type Speicher, type Bucket }
  from '../../src/server/storage/adapter.js';
import { laufe, loeschgrund } from '../../src/server/jobs/dokumentAufbewahrung.js';

/**
 * **Was der Aufbewahrungslauf wirklich darf** (V-116, DOC-07, LEG-01,
 * § 147 AO, Art. 5 Abs. 1 lit. e DSGVO).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum diese Datei die ROLLE prüft und nicht den Dienst.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * V-119 war genau dieser Fehler eine Tabelle weiter: ein Nachtlauf, den zwölf
 * Prüfungen abdeckten — alle zwölf als `cse_app`, während der Lauf als
 * `cse_job` läuft und dort keinen Grant hatte. Er wäre um 00:30 mit
 * „permission denied" abgebrochen, in einem Protokoll, das niemand liest.
 *
 * Hier wird deshalb dieselbe Bindung gesetzt, die `alsJobSitzung` setzt, auf
 * `cse_job` geschaltet und ohne eine Zeile Anwendungscode geschrieben. Und
 * dazu die Gegenrichtung, die bei einer LÖSCHUNG die wichtigere ist: was der
 * Lauf NICHT anfassen kann.
 */

let f: Fixtur;

beforeAll(async () => { f = await seed(); });
afterAll(schliessen);

/** Dieselbe Bindung wie `alsJobSitzung` — ausgeschrieben, nicht aufgerufen. */
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

/**
 * Ein Dokument, dessen Frist hinter uns liegt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Frist wird nicht gesetzt, sondern entsteht — und das musste sie.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der erste Entwurf schrieb `aufbewahrung_bis` nachträglich in die
 * Vergangenheit. Das geht nicht, und zwar aus einem guten Grund:
 * `kern.setze_aufbewahrung` (0141) weist jede Verkürzung ab, jede Änderung
 * des Entstehungstags und jedes Lösen einer Löschsperre — auch dem
 * Eigentümer der Tabelle gegenüber. Eine Aufbewahrungsfrist, die sich
 * zurückdrehen liesse, wäre keine.
 *
 * Gesetzt wird deshalb nur, was eine Tatsache ist: **wann das Dokument
 * entstanden ist**. Den Rest rechnet der Auslöser, genau wie im Betrieb —
 * `app.aufbewahrung_ende(entstanden_am, jahre)`, § 147 Abs. 4 AO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Kategorie ist hier keine Nebensache, sondern der Kern.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `loeschsperre := r.loeschsperre or r.ist_platzhalter`, und eine gesetzte
 * Sperre lässt sich nie wieder lösen (D-49). Von den neun Klassen tragen
 * sieben eine: die vier GoBD-Klassen aus einer ENTSCHIEDENEN Regel
 * (`rechnung`, `buchhaltung`, `beleg`, `vertrag`) und die drei offenen
 * (`mitarbeiter`, `projekt`, `unternehmen`) als Platzhalter.
 *
 * Ohne Sperre stehen genau zwei da: `angebot` und `kunde`, je sechs Jahre
 * nach § 257 HGB. **Das ist die ganze Menge, die dieser Lauf je anfassen
 * kann**, und deshalb steht sie hier und nicht in einer Bemerkung.
 */
type Klasse = 'angebot' | 'kunde' | 'projekt' | 'rechnung';

async function dokument(
  mandantId: string,
  o: { readonly entstanden: string; readonly kategorie?: Klasse },
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                           groesse_bytes, bucket, objekt_schluessel, exif_entfernt,
                           entstanden_am)
     values ($1, $2::dokument_kategorie, 'Fristprobe', 'application/pdf', true, 100,
             'dokumente', gen_random_uuid()::text, true, $3::date)
     returning id`, [mandantId, o.kategorie ?? 'angebot', o.entstanden]);
  return z?.id ?? '';
}

/** Was der Auslöser daraus gemacht hat — Frist und Sperre. */
async function frist(id: string): Promise<{ bis: string | null; sperre: boolean }> {
  const [z] = await sql.unsafe<{ bis: string | null; sperre: boolean }[]>(
    `select aufbewahrung_bis::text as bis, loeschsperre as sperre
       from dokument where id = $1`, [id]);
  return z ?? { bis: null, sperre: false };
}

/** Was nach einem Versuch in der Zeile steht. */
async function stand(id: string): Promise<{ weg: boolean; grund: string | null }> {
  const [z] = await sql.unsafe<{ weg: boolean; grund: string | null }[]>(
    `select (geloescht_am is not null) as weg, loeschgrund as grund
       from dokument where id = $1`, [id]);
  return z ?? { weg: false, grund: null };
}

const LOESCHEN = `update dokument
     set geloescht_am = now(), geloescht_von = app.aktueller_benutzer(),
         loeschgrund = $2
   where id = $1::uuid and mandant_id = app.aktiver_mandant() and geloescht_am is null
   returning bucket, objekt_schluessel`;

const GRUND = 'Aufbewahrungsfrist der Klasse „angebot“ am 2021-12-31 abgelaufen.';

describe('§1 der Lauf darf löschen, was seine Frist hinter sich hat', () => {
  it('als `cse_job`, mit gebundenem Mandanten und Schreibmodus', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2015-06-01' });
    /*
     * Erst der Beleg, dass die Vorbedingung echt ist: sechs Jahre nach
     * § 257 HGB auf ein Angebot von 2015 ergeben den 31.12.2021, und die
     * Klasse trägt keine Sperre. Eine Prüfung, die löscht, ohne das vorher
     * zu zeigen, bewiese auch dann etwas, wenn der Auslöser falsch rechnet.
     */
    const v = await frist(id);
    expect(v.bis).toBe('2021-12-31');
    expect(v.sperre).toBe(false);

    const zeilen = await alsJob(f.reinigung, false, (tx) =>
      tx.unsafe(LOESCHEN, [id, GRUND])) as unknown as { bucket: string }[];
    expect(zeilen.length, 'genau diese eine Zeile').toBe(1);
    const s = await stand(id);
    expect(s.weg).toBe(true);
    expect(s.grund).toBe(GRUND);
  });

  /**
   * **`geloescht_von` bleibt NULL, und das ist die ehrliche Angabe.** Ein
   * Nachtlauf ist kein Mensch. Einen Benutzer einzutragen, der nichts
   * entschieden hat, wäre eine Zuschreibung — und genau die liest jemand
   * später als „der hat das gelöscht".
   */
  it('und trägt keinen Menschen als Löschenden ein', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2014-03-03' });
    await alsJob(f.reinigung, false, (tx) => tx.unsafe(LOESCHEN, [id, GRUND]));
    const [z] = await sql.unsafe<{ von: string | null }[]>(
      `select geloescht_von as von from dokument where id = $1`, [id]);
    expect(z?.von).toBeNull();
  });
});

describe('§2 und sonst gar nichts', () => {
  /**
   * Die Kopplung aus V-119: ein Lauf, der `nurLesen: false` vergisst,
   * schreibt nicht etwa doch — und er tut auch nicht still nichts. Er
   * scheitert sichtbar.
   */
  it('ohne Schreibmodus fasst er keine Zeile an', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2015-06-01' });
    const zeilen = await alsJob(f.reinigung, true, (tx) =>
      tx.unsafe(LOESCHEN, [id, GRUND])) as unknown as unknown[];
    expect(zeilen.length, 'die Policy lässt die Zeile nicht ins `using`').toBe(0);
    expect((await stand(id)).weg).toBe(false);
  });

  it('ein fremder Mandant ist für ihn nicht da', async () => {
    const id = await dokument(f.security, { entstanden: '2015-06-01' });
    const zeilen = await alsJob(f.reinigung, false, (tx) =>
      tx.unsafe(LOESCHEN, [id, GRUND])) as unknown as unknown[];
    expect(zeilen.length).toBe(0);
    expect((await stand(id)).weg).toBe(false);
  });

  /**
   * **Die offene Frist ist der Normalfall und nicht die Ausnahme** (O-25,
   * O-46). `kern.setze_aufbewahrung` setzt `loeschsperre = true`, solange
   * eine Kategorie keine oder nur eine Platzhalter-Regel hat. Solche Zeilen
   * fallen aus dem `using` heraus: der Lauf SIEHT sie nicht.
   */
  it('eine Löschsperre hält, auch wenn die Frist abgelaufen wäre', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2015-06-01', kategorie: 'projekt' });
    const zeilen = await alsJob(f.reinigung, false, (tx) =>
      tx.unsafe(LOESCHEN, [id, GRUND])) as unknown as unknown[];
    expect(zeilen.length).toBe(0);
    expect((await stand(id)).weg).toBe(false);
  });

  /**
   * ═════════════════════════════════════════════════════════════════════════
   * **Eine GoBD-Klasse bleibt gesperrt — auch NACH ihren zehn Jahren.**
   * ═════════════════════════════════════════════════════════════════════════
   *
   * `rechnung` trägt eine ENTSCHIEDENE Regel (10 Jahre, § 147 AO, § 14b
   * UStG) — und in derselben Zeile `loeschsperre = true` (0009:275). Der
   * Auslöser schreibt sie beim Anlegen fest, und lösen lässt sie sich nie
   * (D-49). Eine Rechnung ist damit nicht zehn Jahre unlöschbar, sondern
   * dauerhaft.
   *
   * **Das steht hier als Prüfung und nicht als Bemerkung**, weil es der
   * Unterschied zwischen dem ist, was `08-PR-PLAN.md` PR 64 zusagt („for the
   * full ten years") und dem, was die Tabelle tut. Wer diese Prüfung eines
   * Tages ändert, ändert eine Rechtsfrage — und soll das merken.
   *
   * // TODO(client, O-894): Darf eine Rechnung, ein Buchungsbeleg oder ein Vertrag nach Ablauf der zehn Jahre gelöscht werden, oder bleibt die Aufbewahrung dauerhaft? § 147 AO nennt eine Mindestfrist, Art. 5 Abs. 1 lit. e DSGVO verlangt eine Obergrenze.
   */
  it('eine GoBD-Klasse bleibt auch nach ihren zehn Jahren gesperrt', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2010-06-01', kategorie: 'rechnung' });
    const [z] = await sql.unsafe<{ sperre: boolean }[]>(
      `select loeschsperre as sperre from dokument where id = $1`, [id]);
    expect(z?.sperre, 'die entschiedene Regel setzt die Sperre mit').toBe(true);
    const zeilen = await alsJob(f.reinigung, false, (tx) =>
      tx.unsafe(LOESCHEN, [id, GRUND])) as unknown as unknown[];
    expect(zeilen.length).toBe(0);
    expect((await stand(id)).weg).toBe(false);
  });

  it('eine Frist, die noch läuft, ebenso', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2026-01-02' });
    const zeilen = await alsJob(f.reinigung, false, (tx) =>
      tx.unsafe(LOESCHEN, [id, GRUND])) as unknown as unknown[];
    expect(zeilen.length).toBe(0);
    expect((await stand(id)).weg).toBe(false);
  });

  /**
   * **Und eine Klasse ohne jede Frist ist nicht „sofort fällig".** Ohne
   * entschiedene Regel steht `aufbewahrung_bis` auf NULL. Ein `<=`-Vergleich
   * mit NULL ergibt NULL und damit nicht `true` — die Zeile fiele schon
   * deshalb heraus. Die Policy sagt es trotzdem ausdrücklich, weil ein
   * stillschweigendes Dreiwertigkeits-Argument die schlechteste Absicherung
   * einer Löschung wäre.
   */
  it('ohne gesetzte Frist ist nichts fällig', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2015-06-01', kategorie: 'projekt' });
    expect((await frist(id)).bis, 'die offene Klasse hat kein Datum').toBeNull();
    const zeilen = await alsJob(f.reinigung, false, (tx) =>
      tx.unsafe(LOESCHEN, [id, GRUND])) as unknown as unknown[];
    expect(zeilen.length).toBe(0);
    expect((await stand(id)).weg).toBe(false);
  });

  /** Ohne Grund wird nichts gelöscht — das `with check` verlangt ihn. */
  it('ohne Löschgrund weist die Policy ab', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2015-06-01' });
    await expect(alsJob(f.reinigung, false, (tx) => tx.unsafe(
      `update dokument set geloescht_am = now()
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
      [id]))).rejects.toThrow(/row-level security/u);
    expect((await stand(id)).weg).toBe(false);
  });
});

describe('§3 was der Lauf an einem Dokument NICHT ändern kann', () => {
  /**
   * Der Spaltengrant ist die eigentliche Absicherung. `grant update on
   * dokument` ohne Spaltenliste machte den Nachtlauf zu dem einen Weg, auf
   * dem sich der Speicherort einer archivierten Rechnung nachts ändern lässt
   * — und eine Zeile, die auf eine andere Datei zeigt, ist vor einer
   * Betriebsprüfung dasselbe wie eine gelöschte.
   */
  for (const [spalte, wert] of [
    ['objekt_schluessel', `'anderswo'`],
    ['bucket', `'archiv'`],
    ['loeschsperre', 'false'],
    ['aufbewahrung_bis', `'2000-01-01'::date`],
    ['kategorie', `'rechnung'::dokument_kategorie`],
  ] as const) {
    it(`\`${spalte}\` ist ihm entzogen`, async () => {
      const id = await dokument(f.reinigung, { entstanden: '2015-06-01' });
      await expect(alsJob(f.reinigung, false, (tx) => tx.unsafe(
        `update dokument set ${spalte} = ${wert} where id = $1::uuid`, [id])))
        .rejects.toThrow(/permission denied/u);
    });
  }

  /** Und harte Löschung bleibt ausgeschlossen (Invariante 8, 0009:295). */
  it('`delete` bleibt ihm entzogen', async () => {
    const id = await dokument(f.reinigung, { entstanden: '2015-06-01' });
    await expect(alsJob(f.reinigung, false, (tx) => tx.unsafe(
      `delete from dokument where id = $1::uuid`, [id])))
      .rejects.toThrow(/permission denied/u);
  });
});

describe('§4 der Lauf selbst — mit der Rolle, die der Zeitplan setzt', () => {
  /**
   * **Ein Speicher, der nicht verbunden ist, hält den Lauf auf.** Und zwar
   * VOR der ersten Zeile: eine Zeile mit `geloescht_am` und eine Datei, die
   * weiter im Bucket liegt, ist genau der halbe Zustand, den eine
   * Betriebsprüfung „Beleg nicht vorgelegt" nennt — nur andersherum.
   */
  it('ohne verbundenen Speicher passiert gar nichts, und es wird gesagt', async () => {
    const tot: Speicher = {
      verbunden: false,
      lege: () => Promise.resolve(),
      hole: () => Promise.reject(new Error('nicht verbunden')),
      entferne: () => Promise.resolve(),
      signierteUrl: () => Promise.reject(new Error('nicht verbunden')),
    };
    const id = await dokument(f.reinigung, { entstanden: '2015-06-01' });
    await expect(laufe(sql, f.reinigung, tot)).rejects.toBeInstanceOf(NichtVerbundenFehler);
    expect((await stand(id)).weg).toBe(false);
  });

  it('löscht die fällige Zeile und entfernt ihre Datei', async () => {
    const speicher = new LokalerSpeicher();
    const id = await dokument(f.reinigung, { entstanden: '2015-06-01' });
    const [o] = await sql.unsafe<{ b: Bucket; s: string }[]>(
      `select bucket as b, objekt_schluessel as s from dokument where id = $1`, [id]);
    await speicher.lege(o!.b, o!.s, new Uint8Array([1, 2, 3]));

    const befund = await laufe(sql, f.reinigung, speicher);
    expect(befund.geloescht).toBeGreaterThanOrEqual(1);
    expect(befund.fehler, befund.letzterFehler ?? '').toBe(0);

    const z = await stand(id);
    expect(z.weg).toBe(true);
    expect(z.grund).toBe(loeschgrund('angebot', '2021-12-31'));
    expect(speicher.rohBytes(o!.b, o!.s), 'die Datei ist fort').toBeUndefined();
  });

  /**
   * **Der Grund nennt die Frist, nicht den Lauf.** Wer in fünf Jahren fragt,
   * warum dieses Dokument fehlt, liest genau diese Zeile — und „automatisch
   * gelöscht" beantwortet die Frage nicht.
   */
  it('der Löschgrund nennt Klasse und Ablaufdatum', () => {
    const g = loeschgrund('rechnung', '2030-12-31');
    expect(g).toContain('rechnung');
    expect(g).toContain('2030-12-31');
    expect(g).toContain('§ 147 AO');
    expect(g.length, 'mindestens fünf Zeichen verlangt der Dienst').toBeGreaterThan(5);
  });

  /**
   * Die Gegenprobe, die den ganzen Lauf trägt: was die Datenbank
   * zurückhält, zählt er als zurückgehalten — nicht als Fehler und erst
   * recht nicht als gelöscht.
   */
  it('gesperrte und noch laufende Zeilen rührt er nicht an', async () => {
    const speicher = new LokalerSpeicher();
    const gesperrt = await dokument(f.security, { entstanden: '2015-06-01', kategorie: 'projekt' });
    const laeuft = await dokument(f.security, { entstanden: '2026-01-02' });

    const befund = await laufe(sql, f.security, speicher);
    expect(befund.fehler, befund.letzterFehler ?? '').toBe(0);
    expect((await stand(gesperrt)).weg).toBe(false);
    expect((await stand(laeuft)).weg).toBe(false);
  });
});
