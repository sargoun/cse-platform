/**
 * Zusagen und Absagen an echtem Postgres (Migration 0374, V-049, V-050, D-622).
 *
 * **Warum das hier steht und nicht in einem Unit-Test.** Jede Zusage dieser
 * Migration ist eine Aussage über die DATENBANK und in TypeScript nicht
 * falsifizierbar:
 *
 *  - dass die Kraft NUR ihre eigene Einteilung beantworten kann, entscheidet
 *    die Personenprüfung in `app.schicht_zusagen`, nicht eine Policy — die
 *    Funktion läuft als `cse_definer` und hat die Policies hinter sich;
 *  - dass der Weg NUR aus dem Arbeiterportal führt, entscheidet
 *    `app.portal()`;
 *  - dass eine Absage einen Grund trägt, entscheidet
 *    `ez_absage_begruendet` — und die Funktion soll VORHER abweisen, mit
 *    einem Satz statt einem Constraint-Namen;
 *  - dass eine Absage **nicht zurücknehmbar** ist (D-622), entscheidet die
 *    Zustandsprüfung, und das ist die betriebliche Regel des Auftraggebers.
 *
 * **Der teuerste Fall steht in §5.** Die Besetzungswarnung zählt ZUSAGEN und
 * nicht Einteilungen. Ohne Schreiber meldete sie für jede Schicht null — sie
 * warnte immer, also warnte sie nie. Der Fall prüft die Zahl, nicht den
 * Spaltenwert.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  withPersonScope, withTenant, type SchreibKontext, type Sitzung,
} from '../../src/server/kontext/index.js';
import { mandantDerZuordnung } from '../../src/server/services/mitarbeiter/stempeluhr.js';
import {
  sageSchichtAb, sageSchichtZu, type ZusageErgebnis,
} from '../../src/server/services/dienstplan/einteilung.js';

let f: Fixtur;
let fatimaKonto: string;
let jonasKonto: string;
const SITZUNG = '00000000-0000-0000-0000-0000000005a1';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(personId: string): Promise<string> {
  const email = `zusage-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function objekt(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus','Kurfürstendamm 21','10719','Berlin') returning id`,
    [mandant, k!.id, `OBJ-${zufall()}`]);
  return o!.id;
}

/**
 * Eine Schicht mit wählbarer Lage — morgen oder gestern.
 *
 * `vorbei` ist kein Beiwerk: beide Funktionen weisen eine beendete Schicht ab,
 * und ohne eine vergangene Fixtur liesse sich das nicht zeigen.
 */
async function schicht(opts: {
  mandant: string; anstellung: string; person: string; objekt: string;
  vorbei?: boolean; sollBesetzung?: number;
}): Promise<{ einsatz: string; zuordnung: string }> {
  const versatz = opts.vorbei === true ? '-2 days' : '1 day';
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, objekt_id, quelle, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          soll_besetzung, min_besetzung, erstellt_von_art)
     values ($1,$2::uuid,'manuell',(now() + $3::interval)::date,
             now() + $3::interval, now() + $3::interval + interval '8 hours',
             '06:00','14:00', false, $4, $4, 'system')
     returning id`,
    [opts.mandant, opts.objekt, versatz, opts.sollBesetzung ?? 1] as never[]);
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, e.id, $3, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'system'
       from einsatz e where e.id = $2
     returning id`,
    [opts.mandant, e!.id, opts.anstellung, opts.person] as never[]);
  return { einsatz: e!.id, zuordnung: z!.id };
}

function sitzungVon(
  benutzerId: string, personId: string, mandantId: string | null,
  portal: 'mitarbeiter' | 'intern' = 'mitarbeiter',
): Sitzung {
  return {
    benutzerId, personId, aktiverMandantId: mandantId,
    ansicht: mandantId === null ? 'person' : 'mandant',
    aal: 'aal1', portal, sitzungId: SITZUNG,
  };
}

/**
 * Genau die Brücke, die `POST /api/mein/schicht` baut: Personen-Scope löst den
 * Mandanten aus der EINTEILUNG auf (K-02), dann Mandanten-Scope.
 *
 * Sie hier nachzubauen statt zu umgehen ist der Punkt — ein Test, der den
 * Mandanten selbst einsetzt, prüft einen Weg, den es nicht gibt.
 */
async function alsKraft<T>(
  benutzerId: string, personId: string, zuordnungId: string,
  fn: (k: SchreibKontext) => Promise<T>,
  portal: 'mitarbeiter' | 'intern' = 'mitarbeiter',
): Promise<T> {
  return sql.begin(async (tx: postgres.TransactionSql) => {
    const mandantId = await withPersonScope(tx, sitzungVon(benutzerId, personId, null),
      async (k) => mandantDerZuordnung(k, zuordnungId));
    return withTenant(tx, sitzungVon(benutzerId, personId, mandantId, portal), fn);
  }) as Promise<T>;
}

const zusagen = (b: string, p: string, z: string): Promise<ZusageErgebnis> =>
  alsKraft(b, p, z, (k) => sageSchichtZu(k, z));
const absagen = (b: string, p: string, z: string, grund: string): Promise<ZusageErgebnis> =>
  alsKraft(b, p, z, (k) => sageSchichtAb(k, z, grund));

async function status(zuordnung: string): Promise<{
  status: string; zugesagt_am: Date | null; abgesagt_am: Date | null;
  absage_grund: string | null; entfernt_am: Date | null;
}> {
  const [z] = await sql.unsafe<{
    status: string; zugesagt_am: Date | null; abgesagt_am: Date | null;
    absage_grund: string | null; entfernt_am: Date | null;
  }[]>(
    `select status::text as status, zugesagt_am, abgesagt_am, absage_grund, entfernt_am
       from einsatz_zuordnung where id = $1`, [zuordnung]);
  return z!;
}

beforeAll(async () => {
  f = await seed();
  fatimaKonto = await konto(f.fatima);
  jonasKonto = await konto(f.jonas);
});
afterAll(schliessen);

describe('§1 zusagen', () => {
  it('setzt den Zustand, den bis hierher NIEMAND geschrieben hat', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    expect((await status(s.zuordnung)).status).toBe('geplant');

    const r = await zusagen(fatimaKonto, f.fatima, s.zuordnung);
    expect(r.art).toBe('zugesagt');

    const nachher = await status(s.zuordnung);
    expect(nachher.status).toBe('zugesagt');
    expect(nachher.zugesagt_am).not.toBeNull();
  });

  it('zweimal zusagen ist kein Fehler, sondern derselbe Wunsch zweimal', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await zusagen(fatimaKonto, f.fatima, s.zuordnung);
    const erstes = (await status(s.zuordnung)).zugesagt_am;

    const r = await zusagen(fatimaKonto, f.fatima, s.zuordnung);
    expect(r.art).toBe('schon_zugesagt');
    // Der Zeitstempel des ERSTEN Males bleibt stehen.
    expect((await status(s.zuordnung)).zugesagt_am).toEqual(erstes);
  });

  it('WEIST eine Schicht ab, die vorbei ist', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      objekt: o, vorbei: true,
    });
    expect((await zusagen(fatimaKonto, f.fatima, s.zuordnung)).art).toBe('vorbei');
    expect((await status(s.zuordnung)).status).toBe('geplant');
  });
});

describe('§2 absagen', () => {
  it('setzt Zustand, Zeitpunkt und Grund', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const r = await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Krank gemeldet');
    expect(r.art).toBe('abgesagt');

    const nachher = await status(s.zuordnung);
    expect(nachher.status).toBe('abgesagt');
    expect(nachher.abgesagt_am).not.toBeNull();
    expect(nachher.absage_grund).toBe('Krank gemeldet');
  });

  it('WEIST eine Absage ohne Grund ab — mit einem Ergebnis, nicht einem Constraint', async () => {
    /*
     * `ez_absage_begruendet` faenge den Fall ohnehin. Der Unterschied ist der
     * Mensch davor: die Bedingung antwortet mit ihrem Namen, die Funktion mit
     * einem Ergebnis, das die Oberflaeche in vier Sprachen beschriftet.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    expect((await absagen(fatimaKonto, f.fatima, s.zuordnung, '   ')).art)
      .toBe('grund_fehlt');
    expect((await status(s.zuordnung)).status).toBe('geplant');
  });

  it('geht auch AUS einer Zusage — wer zusagt und dann krank wird', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await zusagen(fatimaKonto, f.fatima, s.zuordnung);
    expect((await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Kind krank')).art)
      .toBe('abgesagt');
    expect((await status(s.zuordnung)).status).toBe('abgesagt');
  });

  it('nimmt die Zeile NICHT aus dem Plan — das entscheidet das Büro', async () => {
    /*
     * Der Unterschied zur Absage des Bueros (`sageZuordnungAb`), die
     * zusaetzlich `entfernt_am` setzt und damit die Check-in-Marken verbrennt.
     * Die Absage der Kraft ist ein SIGNAL, kein Ausbuchen.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Krank');
    expect((await status(s.zuordnung)).entfernt_am).toBeNull();
  });
});

describe('§3 D-622 — eine Absage laesst sich nicht zurueknehmen', () => {
  it('nach einer Absage fuehrt KEIN Weg zurueck auf zugesagt', async () => {
    /*
     * Die betriebliche Regel des Auftraggebers: sagt eine Kraft ab, besetzt
     * das Buero den Platz nach. Naehme sie die Absage zwei Stunden spaeter
     * zurueck, stuenden vier Menschen auf einer Schicht fuer drei — und einer
     * wird vor Ort weggeschickt.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Arzttermin');

    const r = await zusagen(fatimaKonto, f.fatima, s.zuordnung);
    expect(r.art).toBe('nicht_moeglich');
    expect(r.art === 'nicht_moeglich' ? r.status : null).toBe('abgesagt');
    expect((await status(s.zuordnung)).status).toBe('abgesagt');
  });

  it('zweimal absagen bleibt bei der ersten Absage samt ihrem Grund', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Erster Grund');
    expect((await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Zweiter Grund')).art)
      .toBe('schon_abgesagt');
    expect((await status(s.zuordnung)).absage_grund).toBe('Erster Grund');
  });
});

describe('§4 wem die Schicht gehoert (AUT-06, Invariante 3)', () => {
  it('eine FREMDE Einteilung ist nicht beantwortbar — und nicht unterscheidbar', async () => {
    /*
     * EIN Ausgang fuer „gibt es nicht" und „gehoert dir nicht". Zwei
     * unterscheidbare Antworten machten das Durchprobieren von Kennungen
     * lohnend.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });

    /*
     * Jonas kommt gar nicht bis zur Funktion: `mandantDerZuordnung` laeuft im
     * PERSONEN-Scope, und die Policy gibt ihm Fatimas Zeile nicht. Genau so
     * soll es sein — die Abweisung faellt eine Schicht frueher.
     */
    await expect(zusagen(jonasKonto, f.jonas, s.zuordnung)).rejects.toThrow();
    expect((await status(s.zuordnung)).status).toBe('geplant');
  });

  it('eine erfundene Kennung gibt „unbekannt", keinen Fehler der Datenbank', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    /*
     * Der Mandant kommt aus einer ECHTEN eigenen Zuordnung — geprueft wird die
     * Funktion selbst, mit einer Kennung, die es nicht gibt.
     */
    const r = await alsKraft(fatimaKonto, f.fatima, s.zuordnung, (k) =>
      sageSchichtZu(k, '00000000-0000-0000-0000-000000000000'));
    expect(r.art).toBe('unbekannt');
  });

  it('aus dem VERWALTUNGSportal geht der Weg gar nicht (K-04)', async () => {
    /*
     * Eine Funktion, die aus JEDEM Portal zusagt, waere ein zweiter Weg zu
     * demselben Ziel — der zweite ist der, den niemand prueft.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await expect(alsKraft(fatimaKonto, f.fatima, s.zuordnung,
      (k) => sageSchichtZu(k, s.zuordnung), 'intern')).rejects.toThrow();
    expect((await status(s.zuordnung)).status).toBe('geplant');
  });
});

describe('§5 die Zahl, um die es geht (V-050)', () => {
  it('die Besetzungswarnung zaehlt ZUSAGEN — und zaehlt jetzt ueberhaupt', async () => {
    /*
     * DER teuerste Befund. `besetzungsluecke.ts` und der Nachtwaechter
     * `dienstplan.morgen_unbesetzt` zaehlen ausdruecklich `status =
     * 'zugesagt'`. Ohne Schreiber war diese Zahl fuer JEDE Schicht null — die
     * Warnung warnte immer, also warnte sie nie.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      objekt: o, sollBesetzung: 1,
    });
    const zaehle = async (): Promise<number> => {
      const [z] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from einsatz_zuordnung
          where einsatz_id = $1 and status = 'zugesagt' and entfernt_am is null`,
        [s.einsatz]);
      return z!.n;
    };

    expect(await zaehle()).toBe(0);
    await zusagen(fatimaKonto, f.fatima, s.zuordnung);
    expect(await zaehle()).toBe(1);

    // Und die Absage nimmt sie wieder aus der Zahl — die Luecke wird sichtbar.
    await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Krank');
    expect(await zaehle()).toBe(0);
  });

  it('`besetzt_anzahl` bleibt von der Absage UNBERUEHRT — sie zaehlt Koerper im Plan',
    async () => {
      /*
       * `kern.einsatz_besetzung_zaehlen` zaehlt `entfernt_am is null`, gleich
       * welchen Status. Die Absage der Kraft setzt `entfernt_am` nicht, also
       * bleibt die Zeile im Plan und die Luecke erscheint dort, wo sie
       * hingehoert: in der Zahl der ZUSAGEN.
       */
      const o = await objekt(f.reinigung);
      const s = await schicht({
        mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
      });
      const besetzt = async (): Promise<number> => {
        const [e] = await sql.unsafe<{ n: number }[]>(
          `select besetzt_anzahl as n from einsatz where id = $1`, [s.einsatz]);
        return e!.n;
      };
      expect(await besetzt()).toBe(1);
      await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Krank');
      expect(await besetzt()).toBe(1);
    });
});

describe('§6 die Spur', () => {
  it('beide Handlungen stehen im Protokoll, mit ihrem NAMEN', async () => {
    /*
     * `trg_einsatz_zuordnung_audit` protokolliert die Aenderung ohnehin — aber
     * als „status: geplant → zugesagt". `app.protokolliere` gibt der HANDLUNG
     * einen Namen, und der ist das, wonach jemand spaeter sucht.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await zusagen(fatimaKonto, f.fatima, s.zuordnung);
    await absagen(fatimaKonto, f.fatima, s.zuordnung, 'Krank');

    const zeilen = await sql.unsafe<{ aktion: string }[]>(
      `select aktion from audit_log
        where objekt_typ = 'einsatz_zuordnung' and objekt_id = $1
          and aktion like 'dienstplan.schicht_%'
        order by erstellt_am`, [s.zuordnung]);
    expect(zeilen.map((z) => z.aktion))
      .toEqual(['dienstplan.schicht_zugesagt', 'dienstplan.schicht_abgesagt']);
  });
});
