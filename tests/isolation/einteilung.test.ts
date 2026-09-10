/**
 * Die Einteilung gegen eine echte Datenbank — der Schreibweg auf
 * `einsatz_zuordnung`, den es vorher nicht gab (TIM-05, TIM-06, SEC-04,
 * LEG-03, LEG-04, R-08).
 *
 * Geprueft wird, was nur hier zu pruefen ist: dass die beiden Tore
 * verschieden hart sind und dass beide auch dann greifen, wenn die
 * Oberflaeche uebergangen wird.
 *
 * (1) Einteilen schreibt EINE Zeile, zaehlt die Besetzung hoch und legt das
 *     ArbZG-Fenster an, aus dem die Pruefung der anderen Gesellschaft liest.
 * (2) Dieselbe Beschaeftigung zweimal ist ein Fehler, kein zweiter Eintrag.
 * (3) Eine Warnung nach § 3 ArbZG haelt die Einteilung an — und laesst sie
 *     nach ausdruecklicher Bestaetigung zu, mit Konflikt im Eingang.
 * (4) Absagen loescht nichts: die Zeile bleibt mit Grund, die Besetzung faellt.
 * (5) Ein Grund unter drei Zeichen ist kein Grund.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  besetzeEinsatz, pruefeEinteilung, sageZuordnungAb,
  ArbzgWarnungOffen, BereitsEingeteilt, GrundFehlt, SchichtStorniert,
} from '../../src/server/services/dienstplan/einteilung.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

/** Weit genug in der Zukunft, damit keine Fixtur einer anderen Datei danebenliegt. */
const TAG = '2029-07-16';

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `einteilung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function schicht(
  mandant: string, datum: string, von: string, bis: string,
  opts: { readonly folgetag?: boolean; readonly soll?: number } = {},
): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Einteilungskunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Einteilungsobjekt', 'Teststr. 1', '10115', 'Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, soll_besetzung, min_besetzung,
                          erstellt_von_art, status)
     values ($1, 'manuell', $2, $3::date,
             (select zeitpunkt from app.loese_ortszeit($3::date, $4::time, 'Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit(
                ($3::date + case when $6 then 1 else 0 end), $5::time, 'Europe/Berlin')),
             'Europe/Berlin', $4::time, $5::time, $6,
             $7, $8, $9, 1, 'system', 'geplant')
     returning id`,
    [
      mandant, `einteilung:${zufall()}`, datum, von, bis, opts.folgetag === true,
      o!.id, k!.id, opts.soll ?? 1,
    ],
  );
  return e!.id;
}

/** Als Leitung — die Sitzung, die einen Plan besetzt. */
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
    [chef, f.reinigung, await rolleId('leitung')]);
});
afterAll(schliessen);

describe('(1) Einteilen schreibt genau eine Zeile — und alles, was daran haengt', () => {
  it('legt die Zuordnung an, zaehlt die Besetzung und projiziert das ArbZG-Fenster',
    async () => {
      const e = await schicht(f.reinigung, TAG, '06:00', '10:00');

      const befund = await alsChef(f.reinigung, (k) =>
        besetzeEinsatz(k, { einsatzId: e, anstellungId: f.jonasReinigung }));

      expect(befund.zuordnungId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(befund.personId).toBe(f.jonas);

      const [zeile] = await sql.unsafe<{
        person_id: string; status: string; snapshot: unknown; geprueft: Date | null;
        beginn: Date; ende: Date;
      }[]>(
        `select person_id, status::text as status, qualifikation_snapshot as snapshot,
                qualifikation_geprueft_am as geprueft,
                beginn_zeitpunkt as beginn, ende_zeitpunkt as ende
           from einsatz_zuordnung where id = $1`, [befund.zuordnungId]);
      expect(zeile?.person_id).toBe(f.jonas);
      expect(zeile?.status).toBe('geplant');
      /**
       * Der Beweis der Qualifikationspruefung steht IN der Zeile — geschrieben
       * vom Ausloeser, nicht vom Dienst. Eine Zuordnung, die an diesem Dienst
       * vorbei entstuende, traegt ihn deshalb genauso.
       */
      expect(zeile?.geprueft).not.toBeNull();
      expect(zeile?.snapshot).not.toEqual({});

      // Das Fenster der Zuordnung kommt aus der SCHICHT — der Dienst setzt es
      // nicht, damit es nicht zweimal gepflegt wird.
      const [s] = await sql.unsafe<{ beginn: Date; ende: Date }[]>(
        `select beginn_zeitpunkt as beginn, ende_zeitpunkt as ende from einsatz where id = $1`,
        [e]);
      expect(zeile?.beginn.toISOString()).toBe(s?.beginn.toISOString());
      expect(zeile?.ende.toISOString()).toBe(s?.ende.toISOString());

      const [einsatz] = await sql.unsafe<{ besetzt: number }[]>(
        `select besetzt_anzahl::int as besetzt from einsatz where id = $1`, [e]);
      expect(einsatz?.besetzt).toBe(1);

      /**
       * Und das ArbZG-Fenster, aus dem `app.arbzg_belastung` liest. Ohne diese
       * Zeile faende die Pruefung der anderen Gesellschaft die Schicht nicht —
       * und schlosse „kein Verstoss".
       */
      const [fenster] = await sql.unsafe<{ anzahl: string }[]>(
        `select count(*)::text as anzahl from zeit_intern.arbeitszeit_fenster
          where zuordnung_quelle_id = $1 and aktiv`, [befund.zuordnungId]);
      expect(Number(fenster?.anzahl ?? '0')).toBe(1);
    });

  it('und die Vorschau sagt dasselbe, ohne zu schreiben', async () => {
    const e = await schicht(f.reinigung, TAG, '06:00', '10:00');

    const vorschau = await alsChef(f.reinigung, (k) =>
      pruefeEinteilung(k, e, f.jonasReinigung));

    expect(vorschau.qualifikationsfehler).toBeNull();
    expect(vorschau.arbzg).toEqual([]);

    const [zeilen] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from einsatz_zuordnung where einsatz_id = $1`, [e]);
    expect(Number(zeilen?.anzahl ?? '0')).toBe(0);
  });

  it('eine stornierte Schicht wird nicht besetzt', async () => {
    const e = await schicht(f.reinigung, TAG, '06:00', '10:00');
    await sql.unsafe(
      `update einsatz set storniert_am = now(), storno_grund = 'Objekt geschlossen',
                          status = 'storniert' where id = $1`, [e]);

    await expect(alsChef(f.reinigung, (k) =>
      besetzeEinsatz(k, { einsatzId: e, anstellungId: f.jonasReinigung })))
      .rejects.toBeInstanceOf(SchichtStorniert);
  });
});

describe('(2) Dieselbe Beschaeftigung zweimal', () => {
  it('ist ein Fehler und kein zweiter Eintrag', async () => {
    const e = await schicht(f.reinigung, TAG, '06:00', '10:00', { soll: 2 });
    await alsChef(f.reinigung, (k) =>
      besetzeEinsatz(k, { einsatzId: e, anstellungId: f.jonasReinigung }));

    await expect(alsChef(f.reinigung, (k) =>
      besetzeEinsatz(k, { einsatzId: e, anstellungId: f.jonasReinigung })))
      .rejects.toBeInstanceOf(BereitsEingeteilt);

    const [zeilen] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from einsatz_zuordnung
        where einsatz_id = $1 and entfernt_am is null`, [e]);
    expect(Number(zeilen?.anzahl ?? '0')).toBe(1);
  });
});

describe('(3) Der Arbeitszeitbefund haelt an — und laesst sich bestaetigen', () => {
  /**
   * Elf Stunden an einem Tag: sechs am Vormittag, fuenf am Abend. Beide
   * Schichten liegen in DERSELBEN Gesellschaft — der Fall ueber
   * Gesellschaftsgrenzen hat seine eigene Datei; hier geht es darum, dass der
   * Befund die Einteilung anhaelt.
   */
  async function elfStunden(): Promise<{ zweite: string }> {
    const erste = await schicht(f.reinigung, TAG, '06:00', '12:00');
    await alsChef(f.reinigung, (k) =>
      besetzeEinsatz(k, { einsatzId: erste, anstellungId: f.jonasReinigung }));
    const zweite = await schicht(f.reinigung, TAG, '17:00', '22:00');
    return { zweite };
  }

  it('ohne Bestaetigung wird nicht geschrieben', async () => {
    const { zweite } = await elfStunden();

    const fehler = await alsChef(f.reinigung, (k) =>
      besetzeEinsatz(k, { einsatzId: zweite, anstellungId: f.jonasReinigung })
        .then(() => null, (x: unknown) => x));

    expect(fehler).toBeInstanceOf(ArbzgWarnungOffen);
    const warnung = fehler as ArbzgWarnungOffen;
    expect(warnung.befunde.map((b) => b.regel)).toContain('tagesarbeitszeit_ueber_8h');
    expect(warnung.befunde.map((b) => b.regel)).toContain('tagesarbeitszeit_ueber_10h');

    const [zeilen] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from einsatz_zuordnung where einsatz_id = $1`, [zweite]);
    expect(Number(zeilen?.anzahl ?? '0'), 'die Warnung darf nichts geschrieben haben').toBe(0);
  });

  it('mit Bestaetigung wird geschrieben — und der Konflikt steht im Eingang', async () => {
    const { zweite } = await elfStunden();

    const befund = await alsChef(f.reinigung, (k) =>
      besetzeEinsatz(k, {
        einsatzId: zweite, anstellungId: f.jonasReinigung, bestaetigt: true,
      }));
    expect(befund.arbzg.length).toBeGreaterThan(0);

    const [zeilen] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from einsatz_zuordnung
        where einsatz_id = $1 and entfernt_am is null`, [zweite]);
    expect(Number(zeilen?.anzahl ?? '0')).toBe(1);

    /**
     * Uebergangen heisst nicht verschwunden: der Detektor laeuft im selben
     * Aufruf und legt den Konflikt an, der im Eingang mit Begruendung
     * quittiert werden muss.
     */
    const [konflikt] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from planungs_konflikt
        where mandant_id = $1 and person_id = $2 and art = 'arbzg'
          and status = 'offen' and hinfaellig_am is null`,
      [f.reinigung, f.jonas]);
    expect(Number(konflikt?.anzahl ?? '0'),
      'ein bestaetigter Befund gehoert in den Konflikteingang').toBeGreaterThan(0);

    /**
     * Und der Verstoss selbst, ueber `app.arbzg_befund_schreiben` (K-06) — mit
     * Regel, Istwert und Grenzwert. Die Konfliktkarte im Eingang liest ihren
     * Text ueber diese Verbindung; ohne sie stuende dort „Arbeitszeit" und
     * sonst nichts.
     */
    const [verstoss] = await sql.unsafe<{
      id: string; regel: string; ist: number; grenze: number;
    }[]>(
      `select id, regel::text as regel, ist_minuten as ist, grenzwert_minuten as grenze
         from arbeitszeit_verstoss
        where mandant_id = $1 and person_id = $2
          and regel = 'tagesarbeitszeit_ueber_10h'`, [f.reinigung, f.jonas]);
    expect(verstoss, 'der Befund gehoert dauerhaft aufgezeichnet').toBeDefined();
    expect(Number(verstoss?.ist)).toBe(660);
    expect(Number(verstoss?.grenze)).toBe(600);

    const [karte] = await sql.unsafe<{ verstoss_id: string | null }[]>(
      `select arbeitszeit_verstoss_id as verstoss_id from planungs_konflikt
        where mandant_id = $1 and person_id = $2 and art = 'arbzg'
          and hinfaellig_am is null limit 1`, [f.reinigung, f.jonas]);
    expect(karte?.verstoss_id, 'die Karte braucht ihren Beleg').not.toBeNull();
  });
});

describe('(4) Absagen', () => {
  it('behaelt die Zeile mit Grund und senkt die Besetzung', async () => {
    const e = await schicht(f.reinigung, TAG, '06:00', '10:00');
    const befund = await alsChef(f.reinigung, (k) =>
      besetzeEinsatz(k, { einsatzId: e, anstellungId: f.jonasReinigung }));

    await alsChef(f.reinigung, (k) =>
      sageZuordnungAb(k, befund.zuordnungId, 'Krank gemeldet'));

    const [zeile] = await sql.unsafe<{
      status: string; grund: string | null; entfernt: Date | null;
    }[]>(
      `select status::text as status, absage_grund as grund, entfernt_am as entfernt
         from einsatz_zuordnung where id = $1`, [befund.zuordnungId]);
    expect(zeile?.status).toBe('abgesagt');
    expect(zeile?.grund).toBe('Krank gemeldet');
    expect(zeile?.entfernt).not.toBeNull();

    const [einsatz] = await sql.unsafe<{ besetzt: number }[]>(
      `select besetzt_anzahl::int as besetzt from einsatz where id = $1`, [e]);
    expect(einsatz?.besetzt).toBe(0);

    // Und das Fenster ist nicht mehr aktiv — eine abgesagte Einteilung darf
    // in keiner Arbeitszeitrechnung mehr mitzaehlen.
    const [fenster] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from zeit_intern.arbeitszeit_fenster
        where zuordnung_quelle_id = $1 and aktiv`, [befund.zuordnungId]);
    expect(Number(fenster?.anzahl ?? '0')).toBe(0);
  });

  it('(5) und ein leerer Grund ist kein Grund', async () => {
    const e = await schicht(f.reinigung, TAG, '06:00', '10:00');
    const befund = await alsChef(f.reinigung, (k) =>
      besetzeEinsatz(k, { einsatzId: e, anstellungId: f.jonasReinigung }));

    await expect(alsChef(f.reinigung, (k) =>
      sageZuordnungAb(k, befund.zuordnungId, '  ')))
      .rejects.toBeInstanceOf(GrundFehlt);

    const [zeile] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from einsatz_zuordnung where id = $1`,
      [befund.zuordnungId]);
    expect(zeile?.status).toBe('geplant');
  });
});
