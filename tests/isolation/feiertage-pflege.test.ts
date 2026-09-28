/**
 * Der Feiertagskalender gegen die echte Datenbank (V-178, D-672, CLN-03).
 *
 * **Der Befund.** `feiertag` hatte keinen Schreiber. Der einzige Test, der
 * einen Feiertag sah (`dienstplan-generator.test.ts` §4), trug ihn selbst
 * ein — und bewies damit den Generator, nicht den Weg dorthin. Hier wird
 * KEINE Feiertagszeile von Hand geschrieben: der Kalender entsteht aus dem
 * Dienst, als `cse_job`, und der Generator laeuft darueber.
 *
 * **Die Jahre sind 2033 und 2034**, nicht die laufenden: der 3. Oktober 2033
 * ist ein Montag, und eine Zeile fuer ein Jahr, das andere Dateien benutzen,
 * bliebe nach diesem Lauf in der Arbeiterdatenbank liegen (`feiertag` haengt
 * an keinem Mandanten und wird von `seed()` nicht geleert). Was diese Datei
 * schreibt, raeumt sie am Ende wieder ab — auch den Lauf mit dem echten
 * „heute".
 *
 * **Ein fehlendes Jahr wird benannt — an allen drei Stellen, die D-672 Nr. 5
 * verspricht** (5): an der Serie (`planungsserie.letzte_meldung`), im
 * Laufprotokoll von `einsaetze_generieren` und in der Turnusvorschau
 * (`feiertageFehlen`). Geprueft war vorher nur `ladeFeiertage` selbst; ein
 * Entfernen der Weitergabe haette niemand bemerkt. Das Land dafuer ist `BB`:
 * es wird nicht gepflegt (O-167), also fehlt jedes seiner Jahre.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { pflegeFeiertage } from '../../src/server/services/dienstplan/feiertage.js';
import {
  ladeAusnahmen, ladeFeiertage, ladeSerien, materialisiereSerie,
} from '../../src/server/services/dienstplan/generator.js';
import { alsJobRolle } from '../../src/server/jobs/sitzung.js';
import { registriereFeiertagePflegen } from '../../src/server/jobs/feiertagePflegen.js';
import { registriereEinsatzGenerator } from '../../src/server/jobs/einsaetzeGenerieren.js';
import { leereRegister } from '../../src/server/jobs/registry.js';
import { findeTurnus, ladeVorschau } from '../../src/server/services/reinigung/turnus.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
let vorher: readonly string[] = [];
const zufall = (): string => String(Math.random()).slice(2, 10);

beforeAll(async () => {
  vorher = (await sql.unsafe<{ id: string }[]>(`select id from feiertag`)).map((z) => z.id);
});

beforeEach(async () => {
  f = await seed();
});

afterAll(async () => {
  /*
   * Aufraeumen, was DIESE Datei eingetragen hat — und nur das. `feiertag`
   * traegt die Loeschsperre (Invariante 8); abgeraeumt wird deshalb wie in
   * `harness.ts` unter `session_replication_role = replica`, als Eigentuemer
   * und nur fuer die Dauer dieser Transaktion.
   */
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(`delete from feiertag where not (id = any($1::uuid[]))`, [vorher]);
  });
  await schliessen();
});

/** Der Dienst, gefahren wie im Nachtlauf: als `cse_job`, schreibend. */
async function pflegeAlsJob(jahre: readonly number[]) {
  return alsJobRolle(sql, (jd) => pflegeFeiertage(jd, jahre), { nurLesen: false });
}

/**
 * Ein Turnus der Reinigung, montags 06:00, mit Serie — ab `ab` (Montag), mit
 * dem Feiertagskalender von `land`.
 */
async function turnusserie(
  regel: 'ausfall' | 'unveraendert', ueberspringen: boolean,
  opts: { readonly land?: string; readonly ab?: string } = {},
) {
  const mandant = f.reinigung;
  const ab = opts.ab ?? '2033-09-26';
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, 'Feiertagskunde')
     returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Feiertagsobjekt', 'Teststr. 1', '10115', 'Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  /* Revier und Katalog gelten ab dem 1. Januar des Jahres, in dem der Turnus beginnt. */
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten,
                         aktiv_ab, erstellt_von_art)
     values ($1, $2, 'Revier F', 90, date_trunc('year', $3::date)::date, 'system') returning id`,
    [mandant, o!.id, ab]);
  const [kat] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
     values ($1, $2, 'Feiertagskatalog', date_trunc('year', $3::date)::date) returning id`,
    [mandant, `kat-${zufall()}`, ab]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog_position (mandant_id, katalog_id, oz, kurztext, einheit,
                                            zeitwert_minuten, gueltig_ab)
     values ($1, $2, $3, 'Unterhaltsreinigung', 'h', 60, date_trunc('year', $4::date)::date)
     returning id`,
    [mandant, kat!.id, `01.${zufall().slice(0, 3)}`, ab]);
  const [t] = await sql.unsafe<{ id: string }[]>(
    `insert into turnus (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung,
                         rrule, dtstart_lokal, dauer_minuten, feiertagsregel,
                         gueltig_ab, erstellt_von_art)
     values ($1, $2, $3, 'Montagsreinigung', 'FREQ=WEEKLY;BYDAY=MO',
             ($5::date + time '06:00'), 180, $4::turnus_feiertagsregel,
             $5::date, 'system') returning id`,
    [mandant, r!.id, pos!.id, regel, ab]);
  const [s] = await sql.unsafe<{ id: string }[]>(
    `insert into planungsserie (mandant_id, turnus_id, quelle, zeitzone,
                                feiertage_ueberspringen, feiertag_bundesland,
                                horizont_tage, erstellt_von_art)
     values ($1, $2, 'turnus', 'Europe/Berlin', $3, $4, 21, 'system') returning id`,
    [mandant, t!.id, ueberspringen, opts.land ?? 'BE']);
  return { mandant, serie: s!.id, turnus: t!.id };
}

async function lauf(a: { mandant: string; serie: string }) {
  const serien = await ladeSerien(sql, a.mandant, '2033-09-26', '2033-12-31');
  const serie = serien.find((x) => x.planungsserieId === a.serie)!;
  const ausnahmen = await ladeAusnahmen(sql, serie, '2033-09-26', '2033-12-31');
  return materialisiereSerie(sql, serie, ausnahmen, { heute: '2033-09-26', laufId: null });
}

async function montage(serie: string) {
  return sql.unsafe<{ plan_datum: string; feiertag: string | null }[]>(
    `select to_char(e.plan_datum,'YYYY-MM-DD') as plan_datum, f.bezeichnung as feiertag
       from einsatz e left join feiertag f on f.id = e.feiertag_id
      where e.planungsserie_id = $1 and e.storniert_am is null
      order by e.plan_datum`, [serie]);
}

describe('(1) der Dienst traegt den Kalender ein — als cse_job, idempotent', () => {
  it('ein Jahr: alle gerechneten Tage, der 3. Oktober darunter; ein zweiter Lauf traegt nichts ein',
    async () => {
      const erster = await pflegeAlsJob([2033]);
      /* Zwoelf Tage 2033: zehn gesetzliche (die beiden Weihnachtstage darunter),
         dazu Heiligabend und Silvester mit `gesetzlich = false` (§5.1). */
      expect(erster.eingetragen + erster.unveraendert).toBe(12);
      const tage = await sql.unsafe<{ datum: string; bezeichnung: string; gesetzlich: boolean }[]>(
        `select to_char(datum,'YYYY-MM-DD') as datum, bezeichnung, gesetzlich
           from feiertag where bundesland = 'BE' and extract(year from datum) = 2033
          order by datum`);
      expect(tage.find((t) => t.datum === '2033-10-03')?.bezeichnung)
        .toBe('Tag der Deutschen Einheit');
      expect(tage.find((t) => t.datum === '2033-12-24')?.gesetzlich).toBe(false);

      const zweiter = await pflegeAlsJob([2033]);
      expect(zweiter.eingetragen).toBe(0);
      expect(zweiter.unveraendert).toBe(12);
    });

  it('ein abweichend gefuehrter Tag wird gemeldet und NICHT umgeschrieben', async () => {
    await sql.unsafe(
      `insert into feiertag (bundesland, datum, bezeichnung, gesetzlich, quelle)
       values ('BE', date '2034-03-08', 'Frauentag (Import)', true, 'import')
       on conflict (bundesland, datum) do nothing`);
    const bericht = await pflegeAlsJob([2034]);
    expect(bericht.abweichungen).toEqual([{
      datum: '2034-03-08',
      gespeichert: { bezeichnung: 'Frauentag (Import)', gesetzlich: true },
      berechnet: { bezeichnung: 'Internationaler Frauentag', gesetzlich: true },
    }]);
    const [z] = await sql.unsafe<{ bezeichnung: string }[]>(
      `select bezeichnung from feiertag where bundesland = 'BE' and datum = date '2034-03-08'`);
    expect(z?.bezeichnung).toBe('Frauentag (Import)');
  });

  it('die Anwendungsrolle schreibt keinen Feiertag — nur der Lauf', async () => {
    await expect(alsApp({ scope: 'mandant', mandantId: f.reinigung, readonly: false }, (tx) =>
      tx.unsafe(
        `insert into feiertag (bundesland, datum, bezeichnung, gesetzlich)
         values ('BE', date '2033-06-01', 'Erfunden', true)`)))
      .rejects.toThrow(/permission denied|row-level security/u);
  });
});

describe('(2) der Nachtlauf selbst — „heute" aus der Datenbank', () => {
  it('traegt das laufende und die zwei folgenden Jahre ein und meldet sie', async () => {
    leereRegister();
    const lauf = registriereFeiertagePflegen(sql);
    const [heute] = await sql.unsafe<{ jahr: number }[]>(
      `select extract(year from app.berlin_heute())::int as jahr`);
    const jahr = Number(heute!.jahr);
    const bericht = await lauf.ausfuehren({ mandantId: null, laufId: 'lauf', versuch: 1 });
    expect(bericht['jahre']).toEqual([jahr, jahr + 1, jahr + 2]);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(distinct extract(year from datum))::int as n from feiertag
        where bundesland = 'BE' and extract(year from datum) between $1 and $1 + 2`, [jahr]);
    expect(n!.n).toBe(3);
    leereRegister();
  });
});

describe('(3) der Generator ueber den 3. Oktober — ohne eine Zeile von Hand', () => {
  beforeEach(async () => {
    await pflegeAlsJob([2033]);
  });

  it('`ausfall`: am 3. Oktober 2033 entsteht keine Schicht, und der Bericht sagt warum',
    async () => {
      const a = await turnusserie('ausfall', true);
      const bericht = await lauf(a);
      const tage = (await montage(a.serie)).map((m) => m.plan_datum);
      expect(tage).toEqual(['2033-09-26', '2033-10-10']);
      expect(bericht.uebersprungen.some((u) => u.grund === 'feiertag')).toBe(true);
      expect(bericht.feiertagskalenderFehlt).toEqual([]);
    });

  it('`unveraendert`: die Schicht entsteht und traegt den Feiertag', async () => {
    const a = await turnusserie('unveraendert', false);
    await lauf(a);
    const tag = (await montage(a.serie)).find((m) => m.plan_datum === '2033-10-03');
    expect(tag?.feiertag).toBe('Tag der Deutschen Einheit');
  });

  it('die Regel des Turnus gilt, auch wenn die Serie etwas anderes festhielt', async () => {
    /*
     * Der Fall aus `aendereTurnus`: die Regel wurde am Turnus auf `ausfall`
     * gesetzt, die Serie trug noch `false`. Bisher uebergab der Generator dann
     * eine leere Feiertagskarte — und plante den 3. Oktober.
     */
    const a = await turnusserie('ausfall', false);
    await lauf(a);
    const tage = (await montage(a.serie)).map((m) => m.plan_datum);
    expect(tage).not.toContain('2033-10-03');
  });

  it('eine Postenschicht am Feiertag bleibt — und TRAEGT den Feiertag', async () => {
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, 'Wachkunde')
       returning id`, [f.security, `K-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1, $2, $3, 'Wachobjekt', 'Wachstr. 2', '10117', 'Berlin') returning id`,
      [f.security, k!.id, `O-${zufall()}`]);
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into posten (mandant_id, objekt_id, bezeichnung, kurzzeichen, min_besetzung,
                           soll_besetzung, abdeckung_rrule, dtstart_lokal, zeitzone,
                           dauer_minuten, gueltig_ab, erstellt_von_art)
       values ($1, $2, 'Nachtwache', $3, 1, 1, 'FREQ=WEEKLY;BYDAY=MO',
               timestamp '2033-09-26 22:00', 'Europe/Berlin', 480, date '2033-09-26', 'system')
       returning id`, [f.security, o!.id, `NW-${zufall().slice(0, 4)}`]);
    const [s] = await sql.unsafe<{ id: string }[]>(
      `insert into planungsserie (mandant_id, posten_id, quelle, zeitzone,
                                  feiertage_ueberspringen, feiertag_bundesland,
                                  horizont_tage, erstellt_von_art)
       values ($1, $2, 'posten', 'Europe/Berlin', false, 'BE', 21, 'system') returning id`,
      [f.security, p!.id]);
    await lauf({ mandant: f.security, serie: s!.id });
    const tag = (await montage(s!.id)).find((m) => m.plan_datum === '2033-10-03');
    /* Nicht gestrichen (0028: nie still entfernen, O-167) — aber sichtbar. */
    expect(tag?.feiertag).toBe('Tag der Deutschen Einheit');
  });
});

describe('(4) ein Jahr ohne Kalender wird benannt, nicht verschwiegen', () => {
  it('ein Land, das niemand pflegt, liefert seine Jahre als fehlend', async () => {
    const fenster = await ladeFeiertage(sql, 'BB', '2033-12-20', '2034-01-10');
    expect(fenster.namen.size).toBe(0);
    expect(fenster.fehlendeJahre).toEqual([2033, 2034]);
  });

  it('ein gepflegtes Jahr ohne Feiertag im Fenster fehlt NICHT', async () => {
    await pflegeAlsJob([2033]);
    const fenster = await ladeFeiertage(sql, 'BE', '2033-01-02', '2033-01-20');
    expect(fenster.namen.size).toBe(0);
    expect(fenster.fehlendeJahre).toEqual([]);
  });
});

describe('(5) ein fehlendes Kalenderjahr steht an der Serie, im Laufprotokoll und in der Vorschau', () => {
  beforeEach(async () => {
    await pflegeAlsJob([2033]);
  });

  it('an der Serie: letzte_meldung nennt Land und Jahr — und ein gepflegtes Jahr nennt nichts',
    async () => {
      const ohne = await turnusserie('ausfall', true, { land: 'BB' });
      const bericht = await lauf(ohne);
      expect(bericht.feiertagskalenderFehlt).toEqual([2033]);
      const meldung = async (serie: string) => (await sql.unsafe<{
        meldung: Record<string, unknown> | null;
      }[]>(`select letzte_meldung as meldung from planungsserie where id = $1`, [serie]))[0]
        ?.meldung;
      expect((await meldung(ohne.serie))?.['feiertagskalender_fehlt']).toEqual(['BB 2033']);
      /* Und genau deshalb fiel der 3. Oktober hier NICHT aus — der Kalender fehlt. */
      expect((await montage(ohne.serie)).map((m) => m.plan_datum)).toContain('2033-10-03');

      const mit = await turnusserie('ausfall', true);
      expect((await lauf(mit)).feiertagskalenderFehlt).toEqual([]);
      expect(await meldung(mit.serie)).not.toHaveProperty('feiertagskalender_fehlt');
    });

  it('im Laufprotokoll von einsaetze_generieren — mit dem echten „heute"', async () => {
    const [heute] = await sql.unsafe<{ tag: string; jahr: number }[]>(
      `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as tag,
              extract(year from app.berlin_heute())::int as jahr`);
    await turnusserie('ausfall', true, { land: 'BB', ab: heute!.tag });
    const [lauf] = await sql.unsafe<{ id: string }[]>(
      `insert into job_lauf (job) values ('einsaetze_generieren') returning id`);
    leereRegister();
    try {
      const job = registriereEinsatzGenerator(sql);
      const protokoll = await job.ausfuehren({
        mandantId: f.reinigung, laufId: lauf!.id, versuch: 1,
      });
      expect(protokoll['serien']).toBe(1);
      /* Das Fenster sind 21 Tage — je nach Datum ein Jahr oder der Jahreswechsel dazu. */
      const jahre = protokoll['feiertagskalender_fehlt'] as readonly number[];
      expect(jahre[0]).toBe(Number(heute!.jahr));
      expect(jahre.every((j) => j === Number(heute!.jahr) || j === Number(heute!.jahr) + 1))
        .toBe(true);
    } finally {
      leereRegister();
    }
  });

  it('in der Turnusvorschau: feiertageFehlen, gelesen wie die Seite es liest', async () => {
    const a = await turnusserie('ausfall', true, { land: 'BB' });
    const email = `feiertag-${zufall()}@cse.test`;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1,$2,(select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
      [u!.id, f.reinigung]);

    const vorschau = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: u!.id, portal: 'intern',
        readonly: false },
      async (tx) => {
        const kontext: LeseKontext = {
          scope: 'mandant', portal: 'intern', benutzerId: u!.id,
          aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
          abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
            (await tx.unsafe(s, w as never[])) as readonly R[],
        };
        const { blatt } = await findeTurnus(kontext, a.turnus);
        return ladeVorschau(kontext, blatt!, { vonDatum: '2033-09-26', bisDatum: '2034-01-15' });
      });
    expect(vorschau.bundesland).toBe('BB');
    expect(vorschau.feiertageFehlen).toEqual([2033, 2034]);
  });
});
