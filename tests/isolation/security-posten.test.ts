/**
 * PR 41, Abnahme 1, 2 und 5 — an echtem Postgres.
 *
 * Sie stehen hier und nicht in `tests/kern/`, weil jede der drei Aussagen
 * ueber die DATENBANK ist und in TypeScript nicht falsifizierbar waere:
 *
 *  (1) Ein Posten unter Mindestbesetzung laesst sich nicht als besetzt
 *      veroeffentlichen — und dieselbe Schicht steht in der
 *      Dringlichkeitsabfrage. EINE Quelle, zwei Leser.
 *  (2) Eine unqualifizierte Zuweisung auf einen POSTEN scheitert im DIENST —
 *      PR 31s Sperre, ueber den Sicherheitspfad erneut belegt — und ebenso an
 *      der Datenbank, wenn der Dienst umgangen wird.
 *  (5) Die kurzfristige Eventbesetzung erzeugt `einsatz`-Zeilen und teilt ueber
 *      denselben `besetzeEinsatz` ein wie der Dienstplan: dieselben Tore,
 *      derselbe Beweis in `qualifikation_snapshot`, kein zweiter Schreibweg.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  assertBesetzungVeroeffentlichbar, PostenUnterbesetzt, postenUebersicht, unterbesetzung,
} from '../../src/server/services/security/posten.js';
import {
  besetzeVeranstaltung, erzeugeVeranstaltungsschicht, VeranstaltungOhneObjekt,
} from '../../src/server/services/security/eventbesetzung.js';
import { besetzeEinsatz } from '../../src/server/services/dienstplan/einteilung.js';
import { QualifikationFehlt } from '../../src/server/services/nachweis/tor.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

/** Weit genug in der Zukunft, damit keine Fixtur einer anderen Datei danebenliegt. */
const TAG = '2029-05-14';
const FENSTER = { von: '2029-05-01', bis: '2029-05-31' };

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `posten-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function objekt(mandant: string): Promise<{ objektId: string; kundeId: string }> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Wachkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Werkstor', 'Teststr. 1', '10115', 'Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  return { objektId: o!.id, kundeId: k!.id };
}

async function posten(
  mandant: string, objektId: string,
  opts: { readonly min?: number; readonly soll?: number } = {},
): Promise<string> {
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into posten (mandant_id, objekt_id, bezeichnung, min_besetzung, soll_besetzung,
                         gueltig_ab, erstellt_von_art)
     values ($1,$2,'Nachtwache',$3,$4,'2029-01-01','system') returning id`,
    [mandant, objektId, opts.min ?? 2, opts.soll ?? 2]);
  return p!.id;
}

/**
 * Eine Postenschicht 22:00–04:00 — eine Nacht ueber Mitternacht, sechs Stunden.
 *
 * **Sechs und nicht acht, mit Absicht.** Ab MEHR als sechs Stunden verlangt
 * § 4 ArbZG eine Pause, und die Vorschau in `besetzeEinsatz` kennt die
 * geplante Pause der Schicht nicht (sie prueft ein Fenster, das es als
 * Zuordnung noch nicht gibt) — jede Achtstundenschicht meldete hier also
 * einen Pausenbefund und haelt die Einteilung an. Diese Datei prueft die
 * Postenlogik und die § 34a-Sperre; wo der Arbeitszeitbefund zum Gegenstand
 * gehoert, steht er ausdruecklich da (die Eventbesetzung unten bestaetigt ihn).
 */
async function postenschicht(
  mandant: string, objektId: string, kundeId: string, postenId: string,
  opts: { readonly min?: number; readonly soll?: number; readonly tag?: string } = {},
): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, posten_id, soll_besetzung, min_besetzung,
                          pause_geplant_minuten, erstellt_von_art, status)
     values ($1,'posten',$2,$3::date,
             (select zeitpunkt from app.loese_ortszeit($3::date, '22:00', 'Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit($3::date + 1, '04:00', 'Europe/Berlin')),
             'Europe/Berlin','22:00','04:00',true,
             $4,$5,$6,$7,$8,0,'system','geplant')
     returning id`,
    [
      mandant, `posten:${zufall()}`, opts.tag ?? TAG, objektId, kundeId, postenId,
      opts.soll ?? 2, opts.min ?? 2,
    ],
  );
  return e!.id;
}

/** Eine plattformweite §34a-Qualifikation — sie gehoert dem Menschen (D-09). */
async function qualifikation(): Promise<string> {
  const [q] = await sql.unsafe<{ id: string }[]>(
    `insert into qualifikation (mandant_id, schluessel, bezeichnung, kategorie,
                                rechtsgrundlage, laeuft_ab, blockiert_einsatz)
     values (null, $1, 'Sachkundeprüfung §34a', 'gesetzlich', '§34a GewO', true, true)
     returning id`, [`34a_${zufall()}`]);
  return q!.id;
}

async function anforderung(
  mandant: string, qualifikationId: string,
  bereich: { readonly posten: string } | { readonly veranstaltung: string },
): Promise<void> {
  if ('posten' in bereich) {
    await sql.unsafe(
      `insert into einsatzanforderung (mandant_id, geltungsbereich, posten_id,
                                       qualifikation_id, zwingend, geltung, rechtsgrundlage)
       values ($1,'posten',$2,$3,true,'jeder','§34a Abs. 1a GewO')`,
      [mandant, bereich.posten, qualifikationId]);
    return;
  }
  await sql.unsafe(
    `insert into einsatzanforderung (mandant_id, geltungsbereich, veranstaltung_id,
                                     qualifikation_id, zwingend, geltung, rechtsgrundlage)
     values ($1,'veranstaltung',$2,$3,true,'jeder','§34a Abs. 1a GewO')`,
    [mandant, bereich.veranstaltung, qualifikationId]);
}

async function nachweis(
  personId: string, qualifikationId: string, mandant: string, bis: string,
): Promise<void> {
  await sql.unsafe(
    `insert into nachweis (person_id, qualifikation_id, gueltig_ab, gueltig_bis,
                           status, erfasst_von_mandant_id)
     values ($1,$2,'2020-01-01',$3::date,'gueltig',$4)`,
    [personId, qualifikationId, bis, mandant]);
}

async function veranstaltung(
  mandant: string, kundeId: string, objektId: string | null,
  opts: { readonly soll?: number } = {},
): Promise<string> {
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into veranstaltung (mandant_id, objekt_id, veranstaltungsort_text, kunde_id,
                                bezeichnung, beginn, ende, soll_besetzung, erstellt_von_art)
     values ($1,$2,$3,$4,'Werksfest',
             (select zeitpunkt from app.loese_ortszeit($5::date,'18:00','Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit($5::date + 1,'02:00','Europe/Berlin')),
             $6,'system')
     returning id`,
    [mandant, objektId, objektId === null ? 'Festwiese Nord' : null, kundeId,
     TAG, opts.soll ?? 2]);
  return v!.id;
}

/** Als Leitung der Security — die Sitzung, die einen Wachplan besetzt. */
function alsChef<T>(mandant: string, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, benutzerId: chef, portal: 'intern', readonly: false },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: chef,
        aktiverMandantId: mandant, mandantIds: [mandant],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.security, await rolleId('leitung')]);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) unter Mindestbesetzung: nicht veroeffentlichbar, und in der Abfrage', () => {
  it('die Schicht steht in der Dringlichkeitsabfrage UND haelt die Veroeffentlichung an',
    async () => {
      const { objektId, kundeId } = await objekt(f.security);
      const p = await posten(f.security, objektId, { min: 2, soll: 2 });
      await postenschicht(f.security, objektId, kundeId, p);

      const { luecken, fehler } = await alsChef(f.security, async (k) => ({
        luecken: await unterbesetzung(k, FENSTER),
        fehler: await assertBesetzungVeroeffentlichbar(k, { ...FENSTER, postenId: p })
          .then(() => null, (x: unknown) => x),
      }));

      // Dieselbe Schicht, beide Male — es ist EINE Quelle (die Sicht).
      expect(luecken).toHaveLength(1);
      expect(luecken[0]!.postenId).toBe(p);
      expect(luecken[0]!.besetztAnzahl).toBe(0);
      expect(luecken[0]!.minBesetzung).toBe(2);
      expect(luecken[0]!.fehlend).toBe(2);

      expect(fehler).toBeInstanceOf(PostenUnterbesetzt);
      expect((fehler as PostenUnterbesetzt).luecken.map((l) => l.einsatzId))
        .toEqual(luecken.map((l) => l.einsatzId));
      // Die Meldung nennt, was fehlt — „unterbesetzt" allein ist nichts, woran
      // ein Planer arbeiten koennte.
      expect((fehler as PostenUnterbesetzt).message).toContain('Mindestbesetzung');
    });

  it('die unterbesetzte Zeile bleibt SPEICHERBAR — sonst kann niemand planen', async () => {
    const { objektId, kundeId } = await objekt(f.security);
    const p = await posten(f.security, objektId, { min: 3, soll: 3 });
    // Der Generator legt acht Wochen Postenschichten an, bevor jemand
    // eingeteilt ist. Waere die Mindestbesetzung eine Bedingung, schluege
    // genau dieser INSERT fehl (§6.3).
    const e = await postenschicht(f.security, objektId, kundeId, p, { min: 3, soll: 3 });
    const [zeile] = await sql.unsafe<{ besetzt_anzahl: number }[]>(
      `select besetzt_anzahl from einsatz where id = $1`, [e]);
    expect(Number(zeile!.besetzt_anzahl)).toBe(0);
  });

  it('erreicht die Besetzung das Minimum, ist der Zeitraum veroeffentlichbar', async () => {
    const { objektId, kundeId } = await objekt(f.security);
    const p = await posten(f.security, objektId, { min: 1, soll: 1 });
    const e = await postenschicht(f.security, objektId, kundeId, p, { min: 1, soll: 1 });

    await alsChef(f.security, (k) =>
      besetzeEinsatz(k, { einsatzId: e, anstellungId: f.fatimaSecurity }));

    const { luecken, uebersicht } = await alsChef(f.security, async (k) => ({
      luecken: await unterbesetzung(k, FENSTER),
      uebersicht: await postenUebersicht(k, FENSTER),
    }));
    expect(luecken).toEqual([]);
    expect(uebersicht).toHaveLength(1);
    expect(uebersicht[0]!.schichten).toBe(1);
    expect(uebersicht[0]!.unterbesetzt).toBe(0);

    // Und das Tor laesst durch — ohne zu werfen.
    await expect(alsChef(f.security, (k) =>
      assertBesetzungVeroeffentlichbar(k, { ...FENSTER, postenId: p }))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('(2) die §34a-Sperre greift auch ueber den Sicherheitspfad', () => {
  it('eine abgelaufene Sachkunde laesst die Zuweisung auf den POSTEN scheitern', async () => {
    const { objektId, kundeId } = await objekt(f.security);
    const p = await posten(f.security, objektId, { min: 1, soll: 1 });
    const q = await qualifikation();
    await anforderung(f.security, q, { posten: p });
    // Gueltig bis Maerz — die Schicht liegt im Mai.
    await nachweis(f.fatima, q, f.security, '2029-03-01');
    const e = await postenschicht(f.security, objektId, kundeId, p, { min: 1, soll: 1 });

    const fehler = await alsChef(f.security, (k) =>
      besetzeEinsatz(k, { einsatzId: e, anstellungId: f.fatimaSecurity })
        .then(() => null, (x: unknown) => x));

    expect(fehler).toBeInstanceOf(QualifikationFehlt);
    expect((fehler as QualifikationFehlt).befund.stichtag).toBe(TAG);
    expect((fehler as QualifikationFehlt).befund.fehlend.map((x) => x.qualifikationId))
      .toContain(q);

    // Und es ist KEINE Zeile entstanden — der Dienst schreibt erst nach dem Tor.
    const zeilen = await sql.unsafe<{ id: string }[]>(
      `select id from einsatz_zuordnung where einsatz_id = $1`, [e]);
    expect(zeilen).toEqual([]);
  });

  it('und die Datenbank weist dieselbe Zuweisung auch OHNE den Dienst ab', async () => {
    // Der Umgehungsweg, den es geben koennte: ein Import, ein Skript, eine
    // Konsolensitzung. Sie kommen an derselben Regel nicht vorbei.
    const { objektId, kundeId } = await objekt(f.security);
    const p = await posten(f.security, objektId, { min: 1, soll: 1 });
    const q = await qualifikation();
    await anforderung(f.security, q, { posten: p });
    await nachweis(f.fatima, q, f.security, '2029-03-01');
    const e = await postenschicht(f.security, objektId, kundeId, p, { min: 1, soll: 1 });

    await expect(sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      erstellt_von_art)
       values ($1,$2,$3,$4,'system')`,
      [f.security, e, f.fatimaSecurity, f.fatima],
    )).rejects.toThrow(/SEC-04\/LEG-04/u);
  });

  it('mit gueltigem Nachweis geht dieselbe Zuweisung durch und traegt den Beweis',
    async () => {
      const { objektId, kundeId } = await objekt(f.security);
      const p = await posten(f.security, objektId, { min: 1, soll: 1 });
      const q = await qualifikation();
      await anforderung(f.security, q, { posten: p });
      await nachweis(f.fatima, q, f.security, '2030-12-31');
      const e = await postenschicht(f.security, objektId, kundeId, p, { min: 1, soll: 1 });

      const befund = await alsChef(f.security, (k) =>
        besetzeEinsatz(k, { einsatzId: e, anstellungId: f.fatimaSecurity }));
      expect(befund.qualifikation.erfuellt).toBe(true);
      // §9.5: „geprueft und bestanden" bleibt von „nichts gefunden" unterscheidbar.
      expect(befund.qualifikation.anforderungenGefunden).toBe(1);
    });
});

// ---------------------------------------------------------------------------

describe('(5) die Eventbesetzung laeuft durch dieselben Tore', () => {
  it('legt EINE Schicht an — und beim zweiten Druck keine zweite', async () => {
    const { objektId, kundeId } = await objekt(f.security);
    const v = await veranstaltung(f.security, kundeId, objektId, { soll: 2 });

    const erste = await alsChef(f.security, (k) => erzeugeVeranstaltungsschicht(k, v));
    const zweite = await alsChef(f.security, (k) => erzeugeVeranstaltungsschicht(k, v));

    expect(erste.neu).toBe(true);
    expect(zweite.neu).toBe(false);
    expect(zweite.einsatzId).toBe(erste.einsatzId);

    const zeilen = await sql.unsafe<{ id: string; quelle: string; soll: number }[]>(
      `select id, quelle::text as quelle, soll_besetzung as soll
         from einsatz where veranstaltung_id = $1`, [v]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.quelle).toBe('veranstaltung');
    expect(Number(zeilen[0]!.soll)).toBe(2);
  });

  it('eine unqualifizierte Wache wird NICHT eingeteilt, eine qualifizierte schon',
    async () => {
      const { objektId, kundeId } = await objekt(f.security);
      const v = await veranstaltung(f.security, kundeId, objektId, { soll: 2 });
      const q = await qualifikation();
      await anforderung(f.security, q, { veranstaltung: v });
      // Fatima hat den Nachweis, Jonas nicht — und Jonas arbeitet ausserdem in
      // der Reinigung, also braucht er eine Anstellung in der Security.
      await nachweis(f.fatima, q, f.security, '2030-12-31');
      const [a] = await sql.unsafe<{ id: string }[]>(
        `insert into anstellung (mandant_id, person_id, personalnummer, eintritt,
                                 stundensatz_intern)
         values ($1,$2,$3,'2024-01-01',1700) returning id`,
        [f.security, f.jonas, `S-${zufall()}`]);

      const befund = await alsChef(f.security, (k) =>
        besetzeVeranstaltung(k, {
          veranstaltungId: v, anstellungIds: [f.fatimaSecurity, a!.id],
          /**
           * Der Eventdienst laeuft acht Stunden ohne geplante Pause — § 4 ArbZG
           * meldet das, und der Dienst haelt dafuer an. `bestaetigt` ist genau
           * die ausdrueckliche Entscheidung, die die Oberflaeche verlangt; sie
           * schreibt den Verstoss und den Konflikt mit. Ohne sie waere hier
           * NICHTS besetzt — und das ist die richtige Voreinstellung.
           */
          bestaetigt: true,
        }));

      expect(befund.erzeugt).toBe(1);
      const je = new Map(befund.ergebnisse.map((e) => [e.anstellungId, e.befund]));
      expect(je.get(f.fatimaSecurity)).toBe('besetzt');
      expect(je.get(a!.id)).toBe('qualifikation');

      /**
       * Der eigentliche Beweis: die eine geschriebene Zuordnung traegt den
       * Pruefabdruck, den der Ausloeser auf `einsatz_zuordnung` stempelt. Ein
       * zweiter Schreibweg „fuer Events" haette ihn nicht.
       */
      const zeilen = await sql.unsafe<{
        anstellung_id: string; geprueft: Date | null; schnapp: Record<string, unknown>;
      }[]>(
        `select z.anstellung_id, z.qualifikation_geprueft_am as geprueft,
                z.qualifikation_snapshot as schnapp
           from einsatz_zuordnung z
           join einsatz e on e.id = z.einsatz_id
          where e.veranstaltung_id = $1`, [v]);
      expect(zeilen).toHaveLength(1);
      expect(zeilen[0]!.anstellung_id).toBe(f.fatimaSecurity);
      expect(zeilen[0]!.geprueft).not.toBeNull();
      expect(zeilen[0]!.schnapp['erfuellt']).toBe(true);
      expect(zeilen[0]!.schnapp['anforderungen_gefunden']).toBe(1);
    });

  it('ohne hinterlegtes Objekt wird keine Schicht erfunden', async () => {
    // `einsatz.objekt_id` ist NOT NULL, `veranstaltung.objekt_id` nicht. Die
    // ehrliche Antwort ist eine Meldung, keine erfundene Objektzeile.
    const { kundeId } = await objekt(f.security);
    const v = await veranstaltung(f.security, kundeId, null);

    const fehler = await alsChef(f.security, (k) =>
      erzeugeVeranstaltungsschicht(k, v).then(() => null, (x: unknown) => x));
    expect(fehler).toBeInstanceOf(VeranstaltungOhneObjekt);

    const zeilen = await sql.unsafe<{ id: string }[]>(
      `select id from einsatz where veranstaltung_id = $1`, [v]);
    expect(zeilen).toEqual([]);
  });
});
