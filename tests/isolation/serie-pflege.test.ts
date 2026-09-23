import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  SeriePflegeFehler, aendereSerienlauf, aendereTurnus, archiviereSerie, beendeSerie,
} from '../../src/server/services/dienstplan/serie-pflege.js';

/**
 * **Eine Planungsserie ändern, beenden, archivieren** (V-021, TIM-02, TIM-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `serie.ts` legte Serien an, `leseSerie` zeigte sie, `legeAusnahmeAn` setzte
 * Ausnahmen für einzelne Tage — **und keine Zeile änderte je eine bestehende
 * Serie.** `planungsserie.archiviert_am` stand seit `0028` da, und
 * `ps_carrier_uk` ist eigens partiell darauf; geschrieben hat es nie jemand.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die teuerste Stelle: `app.planungsbedarf` filtert `gueltig_bis >= p_von`.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein beendeter oder archivierter Träger fällt aus der Abfrage — der
 * Generator sieht ihn nicht mehr, und `storniereVerwaiste` läuft für ihn nie.
 * Die Schichten der nächsten Wochen blieben stehen, für eine Serie, die es
 * nicht mehr gibt. §3 und §4 prüfen genau das.
 */

let f: Fixtur;
let admin = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle = 'admin'): Promise<string> {
  const email = `pflege-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel = $3 and mandant_id is null),true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

async function objektMit(mandant: string, wer: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Pflegetestkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort,
                         erstellt_von)
     values ($1,$2,$3,'Pflegetestobjekt','Teststr.','10115','Berlin',$4)
     returning id`, [mandant, k!.id, `O-${zufall()}`, wer]);
  return o!.id;
}

/** Eine TURNUSSERIE, die AB HEUTE gilt — sonst erzeugt der Generator nichts. */
async function turnusserie(mandant: string, wer: string, o: {
  readonly rrule?: string; readonly beginn?: string;
} = {}): Promise<{ serie: string; turnus: string; objekt: string }> {
  const objekt = await objektMit(mandant, wer);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten, aktiv_ab,
                         erstellt_von_art, erstellt_von)
     values ($1,$2,'Revier Probe',120,'2020-01-01','mensch',$3) returning id`,
    [mandant, objekt, wer]);
  const [kat] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
     values ($1,$2,'Probekatalog','2020-01-01') returning id`, [mandant, `kat-${zufall()}`]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog_position (mandant_id, katalog_id, oz, kurztext, einheit,
                                            gueltig_ab, zeitwert_minuten)
     values ($1,$2,'01.01','Unterhaltsreinigung','m2','2020-01-01',5) returning id`,
    [mandant, kat!.id]);
  const [t] = await sql.unsafe<{ id: string }[]>(
    `insert into turnus (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung,
                         rrule, dtstart_lokal, dauer_minuten, feiertagsregel, gueltig_ab,
                         erstellt_von_art, erstellt_von)
     values ($1,$2,$3,'Nachtreinigung',$5,
             ('2020-01-01 ' || $6)::timestamp,480,'unveraendert','2020-01-01','mensch',$4)
     returning id`,
    [mandant, r!.id, pos!.id, wer,
      o.rrule ?? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', o.beginn ?? '22:00']);
  const [ps] = await sql.unsafe<{ id: string }[]>(
    `insert into planungsserie (mandant_id, turnus_id, quelle, zeitzone,
                                feiertage_ueberspringen, feiertag_bundesland, horizont_tage,
                                erstellt_von_art, erstellt_von)
     values ($1,$2,'turnus','Europe/Berlin',false,'BE',28,'mensch',$3) returning id`,
    [mandant, t!.id, wer]);
  return { serie: ps!.id, turnus: t!.id, objekt };
}

async function postenserie(mandant: string, wer: string): Promise<string> {
  const objekt = await objektMit(mandant, wer);
  const [pa] = await sql.unsafe<{ id: string }[]>(
    `insert into postenart (mandant_id, schluessel, bezeichnung, erstellt_von_art, erstellt_von)
     values ($1,$2,'Nachtwache','mensch',$3) returning id`,
    [mandant, `nacht-${zufall()}`, wer]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into posten (mandant_id, objekt_id, postenart_id, bezeichnung, min_besetzung,
                         soll_besetzung, abdeckung_rrule, dtstart_lokal, dauer_minuten,
                         gueltig_ab, erstellt_von_art, erstellt_von)
     values ($1,$2,$3,'Pforte Nacht',1,1,'FREQ=DAILY',
             '2020-01-01 22:00'::timestamp,480,'2020-01-01','mensch',$4)
     returning id`, [mandant, objekt, pa!.id, wer]);
  const [ps] = await sql.unsafe<{ id: string }[]>(
    `insert into planungsserie (mandant_id, posten_id, quelle, zeitzone,
                                feiertage_ueberspringen, feiertag_bundesland, horizont_tage,
                                erstellt_von_art, erstellt_von)
     values ($1,$2,'posten','Europe/Berlin',false,'BE',28,'mensch',$3) returning id`,
    [mandant, p!.id, wer]);
  return ps!.id;
}

beforeAll(async () => {
  f = await seed();
  admin = await konto(f.reinigung);
});
afterAll(schliessen);

function imKontext<T>(fn: (k: LeseKontext & SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: admin,
      portal: 'intern' as const, readonly: false,
    },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: admin,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

async function schichten(serie: string): Promise<{
  lebend: number; storniert: number; gruende: readonly string[]; letzterTag: string | null;
}> {
  const [z] = await sql.unsafe<{
    lebend: number; storniert: number; gruende: string[]; letzter: string | null;
  }[]>(
    `select count(*) filter (where storniert_am is null)::int as lebend,
            count(*) filter (where storniert_am is not null)::int as storniert,
            coalesce(array_agg(distinct storno_grund) filter (where storno_grund is not null),
                     '{}') as gruende,
            to_char(max(plan_datum) filter (where storniert_am is null), 'YYYY-MM-DD') as letzter
       from einsatz where planungsserie_id = $1`, [serie]);
  return {
    lebend: z?.lebend ?? 0, storniert: z?.storniert ?? 0,
    gruende: z?.gruende ?? [], letzterTag: z?.letzter ?? null,
  };
}

const tagePlus = async (n: number): Promise<string> => {
  const [z] = await sql.unsafe<{ t: string }[]>(
    `select to_char(app.berlin_heute() + $1::int, 'YYYY-MM-DD') as t`, [n]);
  return z!.t;
};

describe('§1 der Lauf der Serie — Horizont und Feiertage gehören ihr, nicht dem Turnus', () => {
  it('ein grösserer Horizont erzeugt sofort mehr Schichten', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    /* Der erste Lauf entsteht mit dem Speichern — nicht erst nachts. */
    const klein = await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 7 }));
    expect(klein.erzeugt).toBeGreaterThan(0);
    const nachKlein = await schichten(serie);

    const gross = await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 28 }));
    expect(gross.erzeugt).toBeGreaterThan(0);
    const nachGross = await schichten(serie);
    expect(nachGross.lebend).toBeGreaterThan(nachKlein.lebend);
  });

  it('ein Horizont ausserhalb von 1–400 wird abgewiesen', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await expect(imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 401 })))
      .rejects.toMatchObject({ grund: 'unvollstaendig' });
    await expect(imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 0 })))
      .rejects.toMatchObject({ grund: 'unvollstaendig' });
  });

  it('ein Bundesland, das keines ist, wird abgewiesen', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await expect(imKontext((k) => aendereSerienlauf(k, serie, { bundesland: 'Berlin' })))
      .rejects.toMatchObject({ grund: 'unvollstaendig' });
  });

  it('eine fremde Serie ist nicht vorhanden, nicht verboten (AUT-06)', async () => {
    await expect(imKontext((k) => aendereSerienlauf(
      k, '00000000-0000-0000-0000-000000000000', { horizontTage: 7 })))
      .rejects.toMatchObject({ grund: 'nicht_gefunden', status: 404 });
  });
});

describe('§2 die Regel — sie liegt auf dem Turnus, nicht auf der Serie', () => {
  it('weniger Wochentage bedeuten weniger Schichten, und die übrigen werden storniert',
    async () => {
      const { serie } = await turnusserie(f.reinigung, admin);
      await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 28 }));
      const voll = await schichten(serie);

      const eng = await imKontext((k) => aendereTurnus(k, serie, { wochentage: ['MO'] }));
      const nachher = await schichten(serie);
      expect(eng.storniert).toBeGreaterThan(0);
      expect(nachher.lebend).toBeLessThan(voll.lebend);
      expect(nachher.gruende).toContain('serie_geaendert');
    });

  it('ein neuer Beginn schreibt die künftigen Schichten um', async () => {
    const { serie, turnus } = await turnusserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 14 }));
    await imKontext((k) => aendereTurnus(k, serie, { beginnLokal: '06:00' }));

    const [t] = await sql.unsafe<{ beginn: string }[]>(
      `select to_char(dtstart_lokal, 'HH24:MI') as beginn from turnus where id = $1`, [turnus]);
    expect(t?.beginn).toBe('06:00');
    const [e] = await sql.unsafe<{ anzahl: number }[]>(
      `select count(*)::int as anzahl from einsatz
        where planungsserie_id = $1 and storniert_am is null
          and to_char(beginn_lokal, 'HH24:MI') <> '06:00'`, [serie]);
    expect(e?.anzahl).toBe(0);
  });

  it('eine Dauer ausserhalb von 15 Minuten bis knapp 24 Stunden wird abgewiesen', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await expect(imKontext((k) => aendereTurnus(k, serie, { dauerMinuten: 1440 })))
      .rejects.toMatchObject({ grund: 'unvollstaendig' });
    await expect(imKontext((k) => aendereTurnus(k, serie, { dauerMinuten: 5 })))
      .rejects.toMatchObject({ grund: 'unvollstaendig' });
  });

  /**
   * Eine Postenserie trägt ihre Regel auf dem POSTEN — Dienstzeiten und
   * Abdeckung sind Stammdaten des Objektschutzes. Ein Formular, das sie in
   * der Serienmaske anböte, schriebe an der falschen Tabelle vorbei.
   */
  it('eine Postenserie hat keinen Turnus, und der Satz sagt wohin', async () => {
    const serie = await postenserie(f.reinigung, admin);
    await expect(imKontext((k) => aendereTurnus(k, serie, { beginnLokal: '06:00' })))
      .rejects.toMatchObject({ grund: 'kein_turnus', status: 409 });
  });
});

describe('§3 beenden — und was danach im Plan steht, wird abgesagt', () => {
  it('setzt `gueltig_bis` und sagt ab, was danach liegt', async () => {
    const { serie, turnus } = await turnusserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 28 }));
    const vorher = await schichten(serie);
    expect(vorher.lebend).toBeGreaterThan(10);

    const bis = await tagePlus(7);
    const ergebnis = await imKontext((k) => beendeSerie(k, serie, bis));
    expect(ergebnis.abgesagt).toBeGreaterThan(0);

    const [t] = await sql.unsafe<{ bis: string | null }[]>(
      `select to_char(gueltig_bis, 'YYYY-MM-DD') as bis from turnus where id = $1`, [turnus]);
    expect(t?.bis).toBe(bis);

    const nachher = await schichten(serie);
    expect(nachher.letzterTag).not.toBeNull();
    expect(nachher.letzterTag! <= bis).toBe(true);
    expect(nachher.gruende).toContain('serie_beendet');
  });

  /**
   * **Der Kern des Befunds.** Ein auf GESTERN beendeter Träger fällt aus
   * `app.planungsbedarf` (`gueltig_bis >= p_von`); der Generator sieht ihn
   * nicht mehr und räumt nichts auf. Das Absagen steht deshalb im Dienst.
   */
  it('auch ein Ende in der Vergangenheit räumt den Plan — der Generator könnte es nicht',
    async () => {
      const { serie } = await turnusserie(f.reinigung, admin);
      await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 28 }));
      expect((await schichten(serie)).lebend).toBeGreaterThan(10);

      const gestern = await tagePlus(-1);
      await imKontext((k) => beendeSerie(k, serie, gestern));
      const nachher = await schichten(serie);
      /* Was noch nicht begonnen hat, ist weg; die Vergangenheit bleibt. */
      const [offen] = await sql.unsafe<{ anzahl: number }[]>(
        `select count(*)::int as anzahl from einsatz
          where planungsserie_id = $1 and storniert_am is null and beginn_zeitpunkt > now()`,
        [serie]);
      expect(offen?.anzahl).toBe(0);
      expect(nachher.storniert).toBeGreaterThan(0);
    });

  it('ein Ende vor dem Beginn der Serie wird abgewiesen — mit dem Beginn im Satz', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await expect(imKontext((k) => beendeSerie(k, serie, '2019-01-01')))
      .rejects.toMatchObject({ grund: 'zeitraum' });
  });

  it('ein Ende, das kein Datum ist, wird abgewiesen', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await expect(imKontext((k) => beendeSerie(k, serie, 'morgen')))
      .rejects.toMatchObject({ grund: 'unvollstaendig' });
  });

  it('eine Postenserie lässt sich ebenfalls beenden — über `posten.gueltig_bis`', async () => {
    const serie = await postenserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 14 }));
    const bis = await tagePlus(3);
    await imKontext((k) => beendeSerie(k, serie, bis));
    const [p] = await sql.unsafe<{ bis: string | null }[]>(
      `select to_char(p.gueltig_bis, 'YYYY-MM-DD') as bis
         from posten p join planungsserie ps on ps.posten_id = p.id where ps.id = $1`, [serie]);
    expect(p?.bis).toBe(bis);
  });
});

describe('§4 archivieren — die Serie erzeugt nichts mehr, der Träger bleibt', () => {
  it('setzt `archiviert_am` und sagt jede noch nicht begonnene Schicht ab', async () => {
    const { serie, turnus } = await turnusserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 28 }));
    expect((await schichten(serie)).lebend).toBeGreaterThan(10);

    const ergebnis = await imKontext((k) =>
      archiviereSerie(k, serie, 'Vertrag gekündigt'));
    expect(ergebnis.abgesagt).toBeGreaterThan(0);

    const [ps] = await sql.unsafe<{ archiviert: boolean; von: string | null }[]>(
      `select (archiviert_am is not null) as archiviert, archiviert_von::text as von
         from planungsserie where id = $1`, [serie]);
    expect(ps?.archiviert).toBe(true);
    expect(ps?.von).toBe(admin);

    const [offen] = await sql.unsafe<{ anzahl: number }[]>(
      `select count(*)::int as anzahl from einsatz
        where planungsserie_id = $1 and storniert_am is null and beginn_zeitpunkt > now()`,
      [serie]);
    expect(offen?.anzahl).toBe(0);

    /* Der Träger bleibt — für ihn lässt sich später eine neue Serie anlegen. */
    const [t] = await sql.unsafe<{ archiviert: boolean }[]>(
      `select (archiviert_am is not null) as archiviert from turnus where id = $1`, [turnus]);
    expect(t?.archiviert).toBe(false);
  });

  it('der Grund steht an jeder abgesagten Schicht', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 14 }));
    await imKontext((k) => archiviereSerie(k, serie, 'Objekt abgegeben'));
    const nach = await schichten(serie);
    expect(nach.gruende.some((g) => g.includes('Objekt abgegeben'))).toBe(true);
  });

  it('ohne Grund geht es nicht', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await expect(imKontext((k) => archiviereSerie(k, serie, 'x')))
      .rejects.toMatchObject({ grund: 'grund_fehlt' });
  });

  it('zweimal archivieren ist kein zweiter Vorgang', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await imKontext((k) => archiviereSerie(k, serie, 'Vertrag gekündigt'));
    await expect(imKontext((k) => archiviereSerie(k, serie, 'Vertrag gekündigt')))
      .rejects.toMatchObject({ grund: 'schon_archiviert', status: 409 });
  });

  it('eine archivierte Serie lässt sich nicht mehr ändern', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await imKontext((k) => archiviereSerie(k, serie, 'Vertrag gekündigt'));
    await expect(imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 7 })))
      .rejects.toMatchObject({ grund: 'schon_archiviert', status: 409 });
    await expect(imKontext((k) => aendereTurnus(k, serie, { beginnLokal: '06:00' })))
      .rejects.toMatchObject({ grund: 'schon_archiviert', status: 409 });
  });

  /**
   * Die Gegenprobe zur Archivierung: eine archivierte Serie kommt im
   * Planungsbedarf nicht mehr vor, und der nächste Lauf erzeugt für sie
   * nichts — auch nicht, wenn eine ANDERE Serie den Generator startet.
   */
  it('nach dem Archivieren erzeugt kein Lauf mehr Schichten für diese Serie', async () => {
    const alt = await turnusserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, alt.serie, { horizontTage: 14 }));
    await imKontext((k) => archiviereSerie(k, alt.serie, 'Vertrag gekündigt'));
    const nachArchiv = await schichten(alt.serie);

    const neu = await turnusserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, neu.serie, { horizontTage: 14 }));

    expect((await schichten(alt.serie)).lebend).toBe(nachArchiv.lebend);
  });
});

describe('§5 was nie mitgeht: eine Schicht, auf der Zeit erfasst ist', () => {
  it('sie überlebt Beenden und Archivieren', async () => {
    const { serie, objekt } = await turnusserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 28 }));

    /* Die späteste künftige Schicht bekommt eine Zeiterfassung. */
    const [s] = await sql.unsafe<{ id: string; beginn: string; ende: string }[]>(
      `select id, beginn_zeitpunkt::text as beginn, ende_zeitpunkt::text as ende
         from einsatz
        where planungsserie_id = $1 and storniert_am is null and beginn_zeitpunkt > now()
        order by beginn_zeitpunkt desc limit 1`, [serie]);
    expect(s).toBeDefined();
    await sql.unsafe(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, objekt_id, einsatz_id,
          beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
          erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
          status, erstellt_von_art)
       values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,0,
               'import','import','import','import','abgeschlossen','system')`,
      [f.reinigung, f.jonasReinigung, f.jonas, objekt, s!.id, s!.beginn, s!.ende] as never[]);

    const morgen = await tagePlus(1);
    await imKontext((k) => beendeSerie(k, serie, morgen));
    const [nachBeenden] = await sql.unsafe<{ storniert: boolean }[]>(
      `select (storniert_am is not null) as storniert from einsatz where id = $1`, [s!.id]);
    expect(nachBeenden?.storniert).toBe(false);

    await imKontext((k) => archiviereSerie(k, serie, 'Vertrag gekündigt'));
    const [nachArchiv] = await sql.unsafe<{ storniert: boolean }[]>(
      `select (storniert_am is not null) as storniert from einsatz where id = $1`, [s!.id]);
    expect(nachArchiv?.storniert).toBe(false);
  });
});

describe('§6 die Spur — jede der drei Handlungen steht im Protokoll', () => {
  it('ändern, beenden und archivieren schreiben je eine Auditzeile', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    await imKontext((k) => aendereSerienlauf(k, serie, { horizontTage: 7 }));
    const inDrei = await tagePlus(3);
    await imKontext((k) => beendeSerie(k, serie, inDrei));
    await imKontext((k) => archiviereSerie(k, serie, 'Vertrag gekündigt'));

    const zeilen = await sql.unsafe<{ aktion: string }[]>(
      `select aktion from audit_log
        where objekt_typ = 'planungsserie' and objekt_id = $1
        order by id`, [serie]);
    const aktionen = zeilen.map((z) => z.aktion);
    expect(aktionen).toContain('dienstplan.serie_geaendert');
    expect(aktionen).toContain('dienstplan.serie_beendet');
    expect(aktionen).toContain('dienstplan.serie_archiviert');
  });
});

describe('§7 die Ausnahme ist keine Pflege — SeriePflegeFehler trägt den Grund', () => {
  it('jeder Fehler nennt einen Grund, den die Oberfläche übersetzen kann', async () => {
    const { serie } = await turnusserie(f.reinigung, admin);
    const fehler = await imKontext((k) => beendeSerie(k, serie, 'morgen'))
      .catch((x: unknown) => x);
    expect(fehler).toBeInstanceOf(SeriePflegeFehler);
    expect((fehler as SeriePflegeFehler).grund).toBe('unvollstaendig');
  });
});
