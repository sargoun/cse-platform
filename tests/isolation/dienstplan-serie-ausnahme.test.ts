/**
 * Die Einzeltermin-Ausnahme einer Serie gegen echte Policies (TIM-02, §5.4,
 * §6.4, 0029, 0069, Invariante 3).
 *
 * **Der Befund, der diese Datei gebracht hat — zwei Stueck:**
 *
 *  1. Die Ausnahmetabellen gehoeren den GEWERKEN, nicht dem Dienstplan.
 *     `turnus_ausnahme` verlangt zum Schreiben `reinigung.schreiben` (0029),
 *     `posten_ausnahme` verlangt `security.schreiben` (0069) — und NICHT
 *     `dienstplan.schreiben`, auf das die Route
 *     `/api/dienstplan/serien/[id]/ausnahmen` getort ist. Wer nur das erste
 *     prueft, schickt das Formular gegen eine Policy, die null Zeilen trifft:
 *     „new row violates row-level security policy". Das ist ein 500er, und
 *     die Oberflaeche sagt „nicht vorhanden", wo „dafuer fehlt das
 *     Gewerkerecht" die Wahrheit ist.
 *  2. `posten_ausnahme` wurde im ganzen `src/`-Baum NIRGENDS gelesen —
 *     `ladeAusnahmen()` kehrte bei einer Postenserie mit `[]` zurueck. Eine
 *     Ausnahme auf einer Sicherheitsserie entstand als Zeile und wirkte nie:
 *     der Wachdienst fiel am 3. Oktober nicht aus, obwohl ihn jemand
 *     ausgetragen hatte. Hier wird geprueft, dass die Serie im
 *     Planungsbedarf steht UND dass die Ausnahme dazu lesbar ist — die zwei
 *     Haelften, aus denen der Generator seine Antwort baut.
 *
 * Die reine Rechnung (drei Arten, reduzierte Staerke, die vier Naechte) steht
 * in `tests/kern/dienstplan-ausnahme-staerke.test.ts`; hier stehen Rechte und
 * Sichtbarkeit.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur, type Sitzung } from './harness.js';
import { ladeAusnahmen } from '../../src/server/services/dienstplan/generator.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle = 'admin'): Promise<string> {
  const email = `sa-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel = $3 and mandant_id is null),true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

function sitzung(mandant: string, benutzerId: string): Sitzung {
  return {
    scope: 'mandant', mandantId: mandant, mandantIds: [mandant],
    benutzerId, readonly: false, portal: 'intern',
  };
}

async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select r.id, b.id, $3, false
       from rolle r, berechtigung b
      where r.schluessel = $1 and r.mandant_id is null and b.schluessel = $2`,
    [rolle, recht, mandant]);
}

async function objektMit(mandant: string, wer: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Serientestkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort,
                         erstellt_von_art, erstellt_von)
     values ($1,$2,$3,'Serientestobjekt','Teststr.','10115','Berlin','mensch',$4)
     returning id`, [mandant, k!.id, `O-${zufall()}`, wer]);
  return o!.id;
}

/** Eine TURNUSSERIE (Reinigung) samt Traeger. */
async function turnusserie(mandant: string, wer: string):
Promise<{ serie: string; turnus: string }> {
  const objekt = await objektMit(mandant, wer);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten, aktiv_ab,
                         erstellt_von_art, erstellt_von)
     values ($1,$2,'Revier Probe',120,'2026-01-01','mensch',$3) returning id`,
    [mandant, objekt, wer]);
  const [kat] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
     values ($1,$2,'Probekatalog','2026-01-01') returning id`, [mandant, `kat-${zufall()}`]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog_position (mandant_id, katalog_id, oz, kurztext, einheit,
                                            gueltig_ab, zeitwert_minuten)
     values ($1,$2,'01.01','Unterhaltsreinigung','m2','2026-01-01',5) returning id`,
    [mandant, kat!.id]);
  const [t] = await sql.unsafe<{ id: string }[]>(
    `insert into turnus (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung,
                         rrule, dtstart_lokal, dauer_minuten, feiertagsregel, gueltig_ab,
                         erstellt_von_art, erstellt_von)
     values ($1,$2,$3,'Nachtreinigung','FREQ=WEEKLY;BYDAY=MO,WE,FR',
             '2028-05-15 22:00'::timestamp,480,'ausfall','2028-01-01','mensch',$4)
     returning id`, [mandant, r!.id, pos!.id, wer]);
  const [ps] = await sql.unsafe<{ id: string }[]>(
    `insert into planungsserie (mandant_id, turnus_id, quelle, zeitzone,
                                feiertage_ueberspringen, feiertag_bundesland, horizont_tage,
                                erstellt_von_art, erstellt_von)
     values ($1,$2,'turnus','Europe/Berlin',true,'BE',56,'mensch',$3) returning id`,
    [mandant, t!.id, wer]);
  return { serie: ps!.id, turnus: t!.id };
}

/** Eine POSTENSERIE (Sicherheit) samt Traeger. */
async function postenserie(mandant: string, wer: string):
Promise<{ serie: string; posten: string }> {
  const objekt = await objektMit(mandant, wer);
  const [pa] = await sql.unsafe<{ id: string }[]>(
    `insert into postenart (mandant_id, schluessel, bezeichnung, erstellt_von_art, erstellt_von)
     values ($1,$2,'Nachtwache','mensch',$3) returning id`,
    [mandant, `nacht-${zufall()}`, wer]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into posten (mandant_id, objekt_id, postenart_id, bezeichnung, min_besetzung,
                         soll_besetzung, abdeckung_rrule, dtstart_lokal, dauer_minuten,
                         gueltig_ab, erstellt_von_art, erstellt_von)
     values ($1,$2,$3,'Pforte Nacht',2,2,'FREQ=DAILY',
             '2028-05-15 22:00'::timestamp,480,'2028-01-01','mensch',$4)
     returning id`, [mandant, objekt, pa!.id, wer]);
  const [ps] = await sql.unsafe<{ id: string }[]>(
    `insert into planungsserie (mandant_id, posten_id, quelle, zeitzone,
                                feiertage_ueberspringen, feiertag_bundesland, horizont_tage,
                                erstellt_von_art, erstellt_von)
     values ($1,$2,'posten','Europe/Berlin',false,'BE',56,'mensch',$3) returning id`,
    [mandant, p!.id, wer]);
  return { serie: ps!.id, posten: p!.id };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('(1) turnus_ausnahme verlangt das GEWERKE-Recht, nicht dienstplan.schreiben', () => {
  it('mit dienstplan.schreiben allein trifft die Policy null Zeilen', async () => {
    const b = await konto(f.reinigung);
    const { turnus } = await turnusserie(f.reinigung, b);
    await entziehe('admin', 'reinigung.schreiben', f.reinigung);

    await alsApp(sitzung(f.reinigung, b), async (tx) => {
      // Das Recht des Dienstplans steht — und traegt hier trotzdem nicht.
      const [z] = await tx.unsafe(
        `select app.hat_recht('dienstplan.schreiben', app.aktiver_mandant()) as dp,
                app.hat_recht('reinigung.schreiben', app.aktiver_mandant()) as rn`,
      ) as { dp: boolean; rn: boolean }[];
      expect(z?.dp).toBe(true);
      expect(z?.rn).toBe(false);
    });

    await expect(alsApp(sitzung(f.reinigung, b), async (tx) => tx.unsafe(
      `insert into turnus_ausnahme (mandant_id, turnus_id, datum, art, grund,
                                    erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-03','ausfall','Objekt geschlossen','mensch',$3)`,
      [f.reinigung, turnus, b],
    ))).rejects.toThrow(/row-level security policy/u);
  });

  it('mit reinigung.schreiben tragen alle DREI Arten', async () => {
    const b = await konto(f.reinigung);
    const { turnus } = await turnusserie(f.reinigung, b);

    await alsApp(sitzung(f.reinigung, b), async (tx) => {
      for (const [datum, art, ersatz] of [
        ['2028-10-03', 'zusatz', '2028-10-03 20:00'],
        ['2028-10-05', 'verschiebung', '2028-10-06 22:00'],
        ['2028-10-07', 'ausfall', null],
      ] as const) {
        await tx.unsafe(
          `insert into turnus_ausnahme (mandant_id, turnus_id, datum, art,
                                        ersatz_beginn_lokal, grund,
                                        erstellt_von_art, erstellt_von)
           values ($1,$2,$3::date,$4::turnus_ausnahme_art,$5::timestamp,
                   'Dokumentierte Abweichung','mensch',$6)`,
          [f.reinigung, turnus, datum, art, ersatz, b],
        );
      }
    });

    const zeilen = await sql.unsafe<{ art: string }[]>(
      `select art::text as art from turnus_ausnahme where turnus_id = $1 order by datum`,
      [turnus]);
    expect(zeilen.map((z) => z.art)).toStrictEqual(['zusatz', 'verschiebung', 'ausfall']);
  });

  it('das Enum hat DREI Werte — `zusatz` ist keiner, den man weglassen darf', async () => {
    const werte = await sql.unsafe<{ enumlabel: string }[]>(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'turnus_ausnahme_art' order by e.enumsortorder`);
    expect(werte.map((w) => w.enumlabel)).toStrictEqual(['ausfall', 'zusatz', 'verschiebung']);
  });

  it('ein Grund ist Pflicht — eine leere Ausnahme ist keine Dokumentation', async () => {
    const b = await konto(f.reinigung);
    const { turnus } = await turnusserie(f.reinigung, b);
    await expect(alsApp(sitzung(f.reinigung, b), async (tx) => tx.unsafe(
      `insert into turnus_ausnahme (mandant_id, turnus_id, datum, art, grund,
                                    erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-03','ausfall','   ','mensch',$3)`,
      [f.reinigung, turnus, b],
    ))).rejects.toThrow(/turnus_ausnahme_grund_gefuellt/u);
  });

  it('eine Verschiebung ohne Ersatzzeit laesst die Tabelle nicht zu', async () => {
    const b = await konto(f.reinigung);
    const { turnus } = await turnusserie(f.reinigung, b);
    await expect(alsApp(sitzung(f.reinigung, b), async (tx) => tx.unsafe(
      `insert into turnus_ausnahme (mandant_id, turnus_id, datum, art, grund,
                                    erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-05','verschiebung','Aufzug ausser Betrieb','mensch',$3)`,
      [f.reinigung, turnus, b],
    ))).rejects.toThrow(/verschiebung_braucht_beginn/u);
  });
});

describe('(2) posten_ausnahme verlangt security.schreiben', () => {
  it('mit dienstplan.schreiben allein trifft die Policy null Zeilen', async () => {
    const b = await konto(f.security);
    const { posten } = await postenserie(f.security, b);
    await entziehe('admin', 'security.schreiben', f.security);

    await expect(alsApp(sitzung(f.security, b), async (tx) => tx.unsafe(
      `insert into posten_ausnahme (mandant_id, posten_id, datum, art, grund,
                                    erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-03','ausfall','Objekt geschlossen','mensch',$3)`,
      [f.security, posten, b],
    ))).rejects.toThrow(/row-level security policy/u);
  });

  it('mit security.schreiben traegt sie — samt reduzierter Staerke (§6.4)', async () => {
    const b = await konto(f.security);
    const { posten } = await postenserie(f.security, b);
    await alsApp(sitzung(f.security, b), async (tx) => tx.unsafe(
      `insert into posten_ausnahme (mandant_id, posten_id, datum, art, ersatz_beginn_lokal,
                                    ersatz_besetzung, grund, erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-03','verschiebung','2028-10-03 23:00'::timestamp,1,
               'Feiertagsbesetzung reduziert','mensch',$3)`,
      [f.security, posten, b]));
    const [z] = await sql.unsafe<{ staerke: number }[]>(
      `select ersatz_besetzung as staerke from posten_ausnahme where posten_id = $1`,
      [posten]);
    expect(Number(z?.staerke)).toBe(1);
  });

  it('eine Staerke unter 1 laesst die Tabelle nicht zu', async () => {
    const b = await konto(f.security);
    const { posten } = await postenserie(f.security, b);
    await expect(alsApp(sitzung(f.security, b), async (tx) => tx.unsafe(
      `insert into posten_ausnahme (mandant_id, posten_id, datum, art, ersatz_besetzung,
                                    grund, erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-03','ausfall',0,'Null Wachen sind kein Dienst','mensch',$3)`,
      [f.security, posten, b],
    ))).rejects.toThrow(/posten_ausnahme_ersatz_besetzung/u);
  });
});

describe('(3) der Generator LIEST die Postenausnahme — der stille Ausfall', () => {
  it('ladeAusnahmen gibt bei einer Postenserie die Zeile zurueck, nicht []', async () => {
    const b = await konto(f.security);
    const { posten } = await postenserie(f.security, b);
    await alsApp(sitzung(f.security, b), async (tx) => tx.unsafe(
      `insert into posten_ausnahme (mandant_id, posten_id, datum, art, ersatz_beginn_lokal,
                                    ersatz_besetzung, grund, erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-03','verschiebung','2028-10-03 23:00'::timestamp,1,
               'Feiertagsbesetzung reduziert','mensch',$3)`,
      [f.security, posten, b]));

    const ausnahmen = await alsApp(sitzung(f.security, b), async (tx) => ladeAusnahmen(
      { unsafe: (s, w) => tx.unsafe(s, w as never[]) },
      {
        planungsserieId: 'egal', quelle: 'posten', mandantId: f.security,
        objektId: 'egal', kundeId: 'egal', auftragId: null, auftragLeistungId: null,
        turnusId: null, postenId: posten, veranstaltungId: null, revierId: null,
        rrule: 'FREQ=DAILY',
        dtstartLokal: { datum: '2028-05-15', stunde: 22, minute: 0 },
        zeitzone: 'Europe/Berlin', dauerMinuten: 480, sollBesetzung: 2, minBesetzung: 2,
        feiertagsregel: 'unveraendert', gueltigAb: '2028-01-01', gueltigBis: null,
        horizontTage: 56, feiertagBundesland: 'BE', feiertageUeberspringen: false,
      },
      '2028-10-01', '2028-10-31',
    ));

    expect(ausnahmen).toHaveLength(1);
    expect(ausnahmen[0]?.art).toBe('verschiebung');
    expect(ausnahmen[0]?.ersatzBeginnLokal).toBe('2028-10-03T23:00');
    // Die vierte Ausnahmeart aus §8.2 kommt MIT, statt still wegzufallen.
    expect(ausnahmen[0]?.ersatzBesetzung).toBe(1);
  });

  it('die Postenserie steht im Planungsbedarf, sonst laeuft sie nie', async () => {
    const b = await konto(f.security);
    const { serie } = await postenserie(f.security, b);
    const zeilen = await alsApp(sitzung(f.security, b), async (tx) => tx.unsafe(
      `select planungsserie_id, quelle::text as quelle, rrule, soll_besetzung, min_besetzung
         from app.planungsbedarf_eigen('2028-05-15'::date, '2028-10-31'::date)`,
    )) as { planungsserie_id: string; quelle: string; min_besetzung: number }[];
    const meine = zeilen.find((z) => z.planungsserie_id === serie);
    expect(meine).toBeDefined();
    expect(meine?.quelle).toBe('posten');
    expect(Number(meine?.min_besetzung)).toBe(2);
  });
});

describe('(4) die Ausnahme gehoert genau einer Gesellschaft (Invariante 3)', () => {
  it('eine Reinigungsausnahme ist in der Sicherheit nicht sichtbar', async () => {
    const rein = await konto(f.reinigung);
    const { turnus } = await turnusserie(f.reinigung, rein);
    await alsApp(sitzung(f.reinigung, rein), async (tx) => tx.unsafe(
      `insert into turnus_ausnahme (mandant_id, turnus_id, datum, art, grund,
                                    erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-07','ausfall','Objekt geschlossen','mensch',$3)`,
      [f.reinigung, turnus, rein]));

    const sec = await konto(f.security);
    const zeilen = await alsApp(sitzung(f.security, sec), async (tx) =>
      tx.unsafe(`select id from turnus_ausnahme`));
    expect(zeilen).toHaveLength(0);
  });

  it('ohne reinigung.lesen ist die Liste LEER, nicht fehlerhaft', async () => {
    const rein = await konto(f.reinigung);
    const { turnus } = await turnusserie(f.reinigung, rein);
    await alsApp(sitzung(f.reinigung, rein), async (tx) => tx.unsafe(
      `insert into turnus_ausnahme (mandant_id, turnus_id, datum, art, grund,
                                    erstellt_von_art, erstellt_von)
       values ($1,$2,'2028-10-07','ausfall','Objekt geschlossen','mensch',$3)`,
      [f.reinigung, turnus, rein]));

    const blind = await konto(f.reinigung, 'leitung');
    await entziehe('leitung', 'reinigung.lesen', f.reinigung);
    const zeilen = await alsApp(sitzung(f.reinigung, blind), async (tx) =>
      tx.unsafe(`select id from turnus_ausnahme`));
    // Genau deshalb sagt die Seite „nicht einsehbar" und nicht „keine Ausnahme":
    // die beiden sehen in den Daten gleich aus.
    expect(zeilen).toHaveLength(0);
  });
});
