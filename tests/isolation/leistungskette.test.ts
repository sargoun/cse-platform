/**
 * **Die Kette der Leistungszeilen, der Anker des Reviers und die
 * Vertragszeile eines Abrufs** (D-826; V-360 Nachtrag, V-352, V-325) — an
 * echtem Postgres, unter der RLS der Sitzung.
 *
 * Geprüft wird:
 *  1. die Preisanpassung als Nachfolgerin (`passePreisAn`): die neue Zeile
 *     übernimmt alles ausser dem Preis, die bisherige endet am Vortag, die
 *     geplanten Schichten ab dem Stichtag hängen um — und jede Abweisung
 *     lässt alles, wie es war;
 *  2. der Auslöser gibt jeder Schicht die Fassung ihres Plantags, vorwärts
 *     wie rückwärts, und der Generator legt umgehängte Schichten nicht auf die
 *     alte Zeile zurück;
 *  3. was an einer Zeile hängt, zählt die Datenbank unabhängig von den
 *     Leserechten des Aufrufers (`app.leistung_bindung`);
 *  4. ein Turnus ohne eigene Zeile übernimmt die seines Reviers, der eigene
 *     Anker geht vor (`app.planungsbedarf`, `setzeRevierLeistung`);
 *  5. die Vertragszeile eines Abrufs lässt sich bis zur Abrechnung
 *     nachtragen, ändern und lösen — nicht danach, nicht im Rechnungsentwurf,
 *     nicht mit einer Zeile, die am Tag des Abrufs nicht gilt.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  LeistungFehler, beendeLeistungszeile, leseLeistungszeilen, passePreisAn,
} from '../../src/server/services/auftrag/leistung.js';
import { legeEinzelschichtAn } from '../../src/server/services/dienstplan/einzelschicht.js';
import { LeistungsankerFehler } from '../../src/server/services/dienstplan/leistungsanker.js';
import { legeTurnusSerieAn } from '../../src/server/services/dienstplan/serie.js';
import { generiereSofort } from '../../src/server/services/dienstplan/generator.js';
import {
  RevierFehler, archiviereRevier, setzeRevierLeistung,
} from '../../src/server/services/reinigung/revier.js';
import {
  ZuordnungAbgewiesen, erfasseAbruf, ordneVertragszeileZu,
} from '../../src/server/services/reinigung/sonderleistung.js';

let f: Fixtur;
let admin = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `kette-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [u!.id, mandant, rolle]);
  return u!.id;
}

async function globaleRolle(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Eine Rolle dieser Gesellschaft, die nur die genannten Rechte hält. */
async function eigeneRolle(rechte: readonly string[]): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, 'Nur Aufträge', 'mandant', 'intern') returning id`,
    [f.reinigung, `auftraege_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, f.reinigung, rechte] as never[]);
  return r!.id;
}

type Kontext = LeseKontext & SchreibKontext;

function als<T>(wer: string, fn: (k: Kontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: wer, portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: wer,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies Kontext);
    },
  ) as Promise<T>;
}

async function grund(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (fehler) {
    if (fehler instanceof LeistungFehler || fehler instanceof LeistungsankerFehler
      || fehler instanceof RevierFehler || fehler instanceof ZuordnungAbgewiesen) {
      return fehler.grund;
    }
    throw fehler;
  }
  return 'kein_fehler';
}

const tagePlus = async (n: number): Promise<string> => {
  const [z] = await sql.unsafe<{ t: string }[]>(
    `select to_char(app.berlin_heute() + $1::int, 'YYYY-MM-DD') as t`, [n]);
  return z!.t;
};

interface Aufbau {
  readonly kunde: string;
  readonly objekt: string;
  readonly auftrag: string;
  /** Legt eine Zeile am Auftrag an — ab `ab`, mit 32,00 € je Stunde. */
  zeile(ab?: string, bis?: string | null): Promise<string>;
}

async function baue(): Promise<Aufbau> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Kettenkunde') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Kettenobjekt','Teststr. 7','10115','Berlin') returning id`,
    [f.reinigung, k!.id, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'rahmenvertrag','aktiv','Unterhaltsreinigung',$5,'2026-01-01')
     returning id`,
    [f.reinigung, `AU-${zufall()}`, k!.id, o!.id, admin] as never[]);
  let nr = 0;
  return {
    kunde: k!.id, objekt: o!.id, auftrag: a!.id,
    async zeile(ab = '2026-01-01', bis: string | null = null) {
      nr += 1;
      const [l] = await sql.unsafe<{ id: string }[]>(
        `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                       bezeichnung, beschreibung, menge, einheit,
                                       einzelpreis_cent, steuersatz_bp, erloeskonto_schluessel,
                                       leistungsfrequenz_text, gueltig_ab, gueltig_bis)
         values ($1,$2,$3,$4,'Unterhaltsreinigung','Büro',1,'Stunde',3200,1900,'8400',
                 '3× wöchentlich',$5::date,$6::date)
         returning id`,
        [f.reinigung, a!.id, nr, o!.id, ab, bis] as never[]);
      return l!.id;
    },
  };
}

/** Eine Einzelschicht am Objekt, mit Anker — über den echten Dienst. */
async function schicht(objekt: string, zeile: string, tag: string): Promise<string> {
  const { einsatzId } = await als(admin, (k) => legeEinzelschichtAn(k, {
    objektId: objekt, auftragLeistungId: zeile, planDatum: tag, beginnLokal: '06:00',
    endeLokal: '10:00', endetAmFolgetag: false, sollBesetzung: 1, minBesetzung: 1,
  }));
  return einsatzId;
}

/** Eine vergangene Schicht direkt in der Datenbank — der Dienst legt keine an. */
async function alteSchicht(objekt: string, kunde: string, zeile: string, tag: string): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone, beginn_lokal, ende_lokal,
                          objekt_id, kunde_id, auftrag_leistung_id, erstellt_von_art, status)
     values ($1, 'manuell', $2, $3::date,
             ($3::date + time '08:00') at time zone 'Europe/Berlin',
             ($3::date + time '12:00') at time zone 'Europe/Berlin',
             'Europe/Berlin', time '08:00', time '12:00', $4, $5, $6, 'system', 'geplant')
     returning id`,
    [f.reinigung, `kette:${zufall()}`, tag, objekt, kunde, zeile]);
  return e!.id;
}

async function zeitAuf(einsatz: string): Promise<void> {
  await sql.unsafe(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, einsatz_id, beginn_zeitpunkt, ende_zeitpunkt,
        pause_minuten, erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art)
     select $1, $2, $3, e.id, e.beginn_zeitpunkt, e.ende_zeitpunkt, 0,
            'import','import','import','import','abgeschlossen','system'
       from einsatz e where e.id = $4`,
    [f.reinigung, f.jonasReinigung, f.jonas, einsatz] as never[]);
}

async function ankerVon(einsatz: string): Promise<{ anker: string | null; auftrag: string | null }> {
  const [z] = await sql.unsafe<{ anker: string | null; auftrag: string | null }[]>(
    `select auftrag_leistung_id as anker, auftrag_id as auftrag from einsatz where id = $1`,
    [einsatz]);
  return z!;
}

async function zeileRoh(id: string): Promise<Record<string, unknown>> {
  const [z] = await sql.unsafe<Record<string, unknown>[]>(
    `select position_nr, ersetzt_id, bezeichnung, beschreibung, menge::text as menge, einheit,
            einzelpreis_cent::text as preis, steuersatz_bp, steuer_kennzeichen::text as steuer,
            objekt_id, erloeskonto_schluessel, leistungsfrequenz_text,
            gueltig_ab::text as ab, gueltig_bis::text as bis
       from auftrag_leistung where id = $1`, [id]);
  return z!;
}

beforeAll(async () => {
  f = await seed();
  admin = await konto(f.reinigung, await globaleRolle('admin'));
});
afterAll(schliessen);

describe('D-826 — die Preisanpassung ist eine Nachfolgerin', () => {
  it('die neue Zeile übernimmt alles ausser dem Preis, die bisherige endet am Vortag', async () => {
    const bau = await baue();
    const alt = await bau.zeile();
    const stichtag = await tagePlus(10);
    const vortag = await tagePlus(9);
    const frueh = await schicht(bau.objekt, alt, await tagePlus(3));
    const spaet = await schicht(bau.objekt, alt, await tagePlus(20));

    const neu = await als(admin, (k) => passePreisAn(k, bau.auftrag, alt, {
      einzelpreis: '35,00', stichtag,
    }));

    const vorher = await zeileRoh(alt);
    const nachher = await zeileRoh(neu);
    expect(vorher).toMatchObject({ bis: vortag, preis: '3200', ersetzt_id: null });
    expect(nachher).toMatchObject({
      ersetzt_id: alt, ab: stichtag, bis: null, preis: '3500', position_nr: 2,
      bezeichnung: vorher['bezeichnung'], beschreibung: vorher['beschreibung'],
      menge: vorher['menge'], einheit: vorher['einheit'], steuersatz_bp: vorher['steuersatz_bp'],
      steuer: vorher['steuer'], objekt_id: vorher['objekt_id'],
      erloeskonto_schluessel: vorher['erloeskonto_schluessel'],
      leistungsfrequenz_text: vorher['leistungsfrequenz_text'],
    });

    // Die Schicht vor dem Stichtag bleibt, die danach hängt um — am selben Auftrag.
    expect(await ankerVon(frueh)).toEqual({ anker: alt, auftrag: bau.auftrag });
    expect(await ankerVon(spaet)).toEqual({ anker: neu, auftrag: bau.auftrag });

    const zeilen = await als(admin, (k) => leseLeistungszeilen(k, bau.auftrag));
    expect(zeilen.find((z) => z.id === alt)).toMatchObject({ ersetztDurchPosition: 2, ersetztPosition: null });
    expect(zeilen.find((z) => z.id === neu)).toMatchObject({ ersetztPosition: 1, ersetztDurchPosition: null });

    // Ein zweites Mal an der alten Zeile nicht, und Beenden auch nicht.
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, alt, {
      einzelpreis: '36,00', stichtag: vortag,
    })))).toBe('schon_ersetzt');
    expect(await grund(() => als(admin, (k) => beendeLeistungszeile(k, bau.auftrag, alt, '2026-06-30'))))
      .toBe('schon_ersetzt');
    // An der neuen: nicht ab ihrem ersten Tag, nicht zum selben Preis.
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, neu, {
      einzelpreis: '36,00', stichtag,
    })))).toBe('stichtag_zu_frueh');
    const spaeter = await tagePlus(30);
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, neu, {
      einzelpreis: '35,00', stichtag: spaeter,
    })))).toBe('gleicher_preis');
  });

  it('die Kette wird nach dem Anlegen nicht umgeschrieben — auch nicht von der App', async () => {
    const bau = await baue();
    const alt = await bau.zeile();
    const andere = await bau.zeile();
    const neu = await als(admin, async (k) => passePreisAn(k, bau.auftrag, alt, {
      einzelpreis: '33,00', stichtag: await tagePlus(10),
    }));
    for (const wert of [null, andere]) {
      await expect(als(admin, (k) => k.schreibe(
        `update auftrag_leistung set ersetzt_id = $2::uuid where id = $1::uuid`, [neu, wert])))
        .rejects.toMatchObject({ code: '23514' });
    }
    expect(await zeileRoh(neu)).toMatchObject({ ersetzt_id: alt });
  });

  it('der Auslöser gibt jeder Schicht die Fassung ihres Plantags — vorwärts und rückwärts', async () => {
    const bau = await baue();
    const alt = await bau.zeile();
    const stichtag = await tagePlus(10);
    const neu = await als(admin, (k) => passePreisAn(k, bau.auftrag, alt, {
      einzelpreis: '33,50', stichtag,
    }));
    // Mit der alten Zeile nach dem Stichtag angelegt: die neue.
    expect((await ankerVon(await schicht(bau.objekt, alt, await tagePlus(25)))).anker).toBe(neu);
    // Mit der neuen vor dem Stichtag angelegt: die alte.
    const vorne = await schicht(bau.objekt, neu, await tagePlus(5));
    expect(await ankerVon(vorne)).toEqual({ anker: alt, auftrag: bau.auftrag });
    // Wandert die Schicht über den Stichtag, wandert die Zeile mit.
    await sql.unsafe(`update einsatz set plan_datum = $2::date where id = $1`,
      [vorne, await tagePlus(15)]);
    expect((await ankerVon(vorne)).anker).toBe(neu);
  });

  it('der Generator legt die umgehängten Schichten eines Turnus nicht zurück', async () => {
    const bau = await baue();
    const alt = await bau.zeile();
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten, aktiv_ab,
                           erstellt_von_art, erstellt_von)
       values ($1,$2,'Revier Kette',120,'2020-01-01','mensch',$3) returning id`,
      [f.reinigung, bau.objekt, admin]);
    const position = await katalogposition();
    const serie = await als(admin, async (k) => legeTurnusSerieAn(k, {
      revierId: r!.id, leistungskatalogPositionId: position, bezeichnung: 'Abendreinigung',
      wochentage: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'], beginnLokal: '18:00',
      dauerMinuten: 120, gueltigAb: await tagePlus(1), feiertagsregel: 'unveraendert',
      auftragLeistungId: alt,
    }));
    const stichtag = await tagePlus(10);
    const neu = await als(admin, (k) => passePreisAn(k, bau.auftrag, alt, {
      einzelpreis: '34,00', stichtag,
    }));
    const pruefe = async (): Promise<void> => {
      const schichten = await sql.unsafe<{ tag: string; anker: string }[]>(
        `select plan_datum::text as tag, auftrag_leistung_id as anker from einsatz
          where planungsserie_id = $1 and storniert_am is null order by plan_datum`,
        [serie.planungsserieId]);
      expect(schichten.length).toBeGreaterThan(15);
      for (const s of schichten) expect(s.anker, s.tag).toBe(s.tag < stichtag ? alt : neu);
    };
    await pruefe();
    // Der nächste Lauf schreibt den Anker des Turnus (die alte Zeile) — und
    // der Auslöser löst ihn je Tag auf.
    await als(admin, (k) => generiereSofort(
      { unsafe: (s, w) => k.schreibe<unknown>(s, w) }, f.reinigung));
    await pruefe();
    const [t] = await sql.unsafe<{ anker: string }[]>(
      `select t.auftrag_leistung_id as anker from turnus t
         join planungsserie ps on ps.turnus_id = t.id where ps.id = $1`, [serie.planungsserieId]);
    expect(t!.anker).toBe(alt);
  });

  it('jede Abweisung lässt alles, wie es war', async () => {
    const bau = await baue();
    const ohneSchicht = await bau.zeile();
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, ohneSchicht, {
      einzelpreis: '-1,00', stichtag: '2026-12-01',
    })))).toBe('kein_betrag');
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, ohneSchicht, {
      einzelpreis: '40,00', stichtag: '2026-02-30',
    })))).toBe('kein_datum');
    await sql.unsafe(`update auftrag set laufzeit_bis = '2026-12-31' where id = $1`, [bau.auftrag]);
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, ohneSchicht, {
      einzelpreis: '40,00', stichtag: '2027-01-01',
    })))).toBe('nach_laufzeit');
    const geendet = await bau.zeile('2026-01-01', '2026-03-31');
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, geendet, {
      einzelpreis: '40,00', stichtag: '2026-04-01',
    })))).toBe('schon_beendet');

    // Erfasste Zeit ab dem Stichtag: sie bleibt, wo sie ist.
    const mitZeit = await bau.zeile();
    await zeitAuf(await alteSchicht(bau.objekt, bau.kunde, mitZeit, '2026-09-10'));
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, mitZeit, {
      einzelpreis: '40,00', stichtag: '2026-09-01',
    })))).toBe('zeit_danach');

    // Eine begonnene Schicht ohne Zeit lässt sich nicht umhängen.
    const begonnen = await bau.zeile();
    await alteSchicht(bau.objekt, bau.kunde, begonnen, '2026-09-10');
    expect(await grund(() => als(admin, (k) => passePreisAn(k, bau.auftrag, begonnen, {
      einzelpreis: '40,00', stichtag: '2026-09-01',
    })))).toBe('schichten_nicht_umhaengbar');

    for (const id of [ohneSchicht, mitZeit, begonnen]) {
      expect(await zeileRoh(id), id).toMatchObject({ bis: null, preis: '3200' });
    }
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from auftrag_leistung where ersetzt_id = any($1::uuid[])`,
      [[ohneSchicht, geendet, mitZeit, begonnen]] as never[]);
    expect(n!.n).toBe(0);
  });
});

describe('D-826 — gezählt wird, was an der Zeile hängt, nicht was der Aufrufer sieht', () => {
  it('ohne Dienstplan- und Zeitrechte: Beenden und Anpassen sehen trotzdem Zeit und Schichten', async () => {
    const bau = await baue();
    const nurAuftraege = await konto(f.reinigung,
      await eigeneRolle(['auftrag.lesen', 'auftrag.schreiben']));

    const mitZeit = await bau.zeile();
    await zeitAuf(await alteSchicht(bau.objekt, bau.kunde, mitZeit, '2026-09-10'));
    expect(await grund(() => als(nurAuftraege,
      (k) => beendeLeistungszeile(k, bau.auftrag, mitZeit, '2026-08-31')))).toBe('zeit_danach');

    // Eine künftige Schicht, die diese Sitzung nicht umhängen darf.
    const geplant = await bau.zeile();
    const kuenftig = await schicht(bau.objekt, geplant, await tagePlus(20));
    expect(await grund(() => als(nurAuftraege, async (k) => passePreisAn(k, bau.auftrag, geplant, {
      einzelpreis: '40,00', stichtag: await tagePlus(10),
    })))).toBe('schichten_nicht_umhaengbar');
    expect((await ankerVon(kuenftig)).anker).toBe(geplant);
    expect(await zeileRoh(geplant)).toMatchObject({ bis: null });
  });

  it('die Zählung gibt es nur unter auftrag.schreiben', async () => {
    const bau = await baue();
    const zeile = await bau.zeile();
    const nurLesen = await konto(f.reinigung, await eigeneRolle(['auftrag.lesen']));
    await expect(als(nurLesen, (k) => k.abfrage(
      `select * from app.leistung_bindung($1::uuid, '2026-01-01')`, [zeile])))
      .rejects.toMatchObject({ code: '42501' });
  });
});

async function katalogposition(): Promise<string> {
  const [kat] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
     values ($1,$2,'Kettenkatalog','2020-01-01') returning id`, [f.reinigung, `kat-${zufall()}`]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog_position (mandant_id, katalog_id, oz, kurztext, einheit,
                                            gueltig_ab, zeitwert_minuten)
     values ($1,$2,'01.01','Unterhaltsreinigung','m2','2020-01-01',5) returning id`,
    [f.reinigung, kat!.id]);
  return pos!.id;
}

describe('V-352 — ein Turnus ohne eigene Zeile übernimmt die seines Reviers', () => {
  it('Revieranker setzen, ändern, lösen — der eigene Anker des Turnus geht vor', async () => {
    const bau = await baue();
    const revierZeile = await bau.zeile();
    const eigeneZeile = await bau.zeile();
    const andere = await bau.zeile();
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten, aktiv_ab,
                           erstellt_von_art, erstellt_von)
       values ($1,$2,'Revier Anker',120,'2020-01-01','mensch',$3) returning id`,
      [f.reinigung, bau.objekt, admin]);
    const position = await katalogposition();

    expect(await als(admin, (k) => setzeRevierLeistung(k, r!.id, revierZeile)))
      .toEqual({ sofortGeplant: true });
    const turnus = async (anker?: string): Promise<string> => (await als(admin, async (k) =>
      legeTurnusSerieAn(k, {
        revierId: r!.id, leistungskatalogPositionId: position, bezeichnung: 'Frühreinigung',
        wochentage: ['MO', 'WE', 'FR'], beginnLokal: '06:00', dauerMinuten: 120,
        gueltigAb: await tagePlus(1), feiertagsregel: 'unveraendert',
        ...(anker === undefined ? {} : { auftragLeistungId: anker }),
      }))).planungsserieId;
    const ohne = await turnus();
    const mit = await turnus(eigeneZeile);
    const anker = async (serie: string): Promise<readonly (string | null)[]> =>
      [...new Set((await sql.unsafe<{ anker: string | null }[]>(
        `select auftrag_leistung_id as anker from einsatz
          where planungsserie_id = $1 and storniert_am is null`, [serie])).map((z) => z.anker))];

    expect(await anker(ohne)).toEqual([revierZeile]);
    expect(await anker(mit)).toEqual([eigeneZeile]);

    // Der Planungsbedarf selbst: Revier, wo der Turnus keine hat.
    const bedarf = await sql.unsafe<{ serie: string; anker: string | null }[]>(
      `select planungsserie_id as serie, auftrag_leistung_id as anker
         from app.planungsbedarf($1::uuid, $2::date, $3::date)
        where planungsserie_id = any($4::uuid[])`,
      [f.reinigung, await tagePlus(1), await tagePlus(30), [ohne, mit]] as never[]);
    expect(Object.fromEntries(bedarf.map((b) => [b.serie, b.anker])))
      .toEqual({ [ohne]: revierZeile, [mit]: eigeneZeile });

    await als(admin, (k) => setzeRevierLeistung(k, r!.id, andere));
    expect(await anker(ohne)).toEqual([andere]);
    expect(await anker(mit)).toEqual([eigeneZeile]);
    await als(admin, (k) => setzeRevierLeistung(k, r!.id, null));
    expect(await anker(ohne)).toEqual([null]);
    expect(await anker(mit)).toEqual([eigeneZeile]);
  });

  it('eine beendete Zeile und ein archiviertes Revier werden abgewiesen', async () => {
    const bau = await baue();
    const beendet = await bau.zeile('2026-01-01', '2026-01-31');
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten, aktiv_ab,
                           erstellt_von_art, erstellt_von)
       values ($1,$2,'Revier Ende',60,'2020-01-01','mensch',$3) returning id`,
      [f.reinigung, bau.objekt, admin]);
    expect(await grund(() => als(admin, (k) => setzeRevierLeistung(k, r!.id, beendet))))
      .toBe('leistung_beendet');
    await als(admin, (k) => archiviereRevier(k, r!.id));
    expect(await grund(() => als(admin, (k) => setzeRevierLeistung(k, r!.id, null))))
      .toBe('revier_unbekannt');
  });
});

describe('V-325 — die Vertragszeile eines Abrufs bis zur Abrechnung', () => {
  async function abruf(bau: Aufbau, tag = '2026-09-15'): Promise<string> {
    const position = await katalogposition();
    const { id } = await als(admin, (k) => erfasseAbruf(k, {
      objektId: bau.objekt, kundeId: bau.kunde, leistungskatalogPositionId: position,
      bezeichnung: 'Glasreinigung Eingang', beauftragtAm: tag, menge: '2', einheit: 'Stunde',
      status: 'erbracht',
    }));
    return id;
  }
  const zeileDes = async (id: string): Promise<string | null> => {
    const [z] = await sql.unsafe<{ zeile: string | null }[]>(
      `select auftrag_leistung_id as zeile from sonderleistung where id = $1`, [id]);
    return z!.zeile;
  };

  it('nachtragen, ändern, lösen', async () => {
    const bau = await baue();
    const a = await abruf(bau);
    const eins = await bau.zeile();
    const zwei = await bau.zeile();
    await als(admin, (k) => ordneVertragszeileZu(k, { id: a, auftragLeistungId: eins }));
    expect(await zeileDes(a)).toBe(eins);
    await als(admin, (k) => ordneVertragszeileZu(k, { id: a, auftragLeistungId: zwei }));
    expect(await zeileDes(a)).toBe(zwei);
    await als(admin, (k) => ordneVertragszeileZu(k, { id: a, auftragLeistungId: null }));
    expect(await zeileDes(a)).toBeNull();
  });

  it('die Zeile muss am Tag des Abrufs gelten, ihr Auftrag darf nicht storniert sein', async () => {
    const bau = await baue();
    const a = await abruf(bau, '2026-03-15');
    const spaeter = await bau.zeile('2026-06-01');
    expect(await grund(() => als(admin,
      (k) => ordneVertragszeileZu(k, { id: a, auftragLeistungId: spaeter }))))
      .toBe('vertragszeile_ausserhalb');
    const frueher = await bau.zeile('2026-01-01', '2026-02-28');
    expect(await grund(() => als(admin,
      (k) => ordneVertragszeileZu(k, { id: a, auftragLeistungId: frueher }))))
      .toBe('vertragszeile_ausserhalb');

    const storniert = await baue();
    const zeile = await storniert.zeile();
    await sql.unsafe(
      `update auftrag set status = 'storniert', status_grund = 'Probe' where id = $1`,
      [storniert.auftrag]);
    expect(await grund(() => als(admin,
      (k) => ordneVertragszeileZu(k, { id: a, auftragLeistungId: zeile }))))
      .toBe('vertragszeile_auftrag_storniert');
    expect(await grund(() => als(admin, (k) => ordneVertragszeileZu(k, {
      id: a, auftragLeistungId: '00000000-0000-4000-8000-000000000000',
    })))).toBe('vertragszeile_unbekannt');
    expect(await zeileDes(a)).toBeNull();
  });

  it('nicht nach der Abrechnung, nicht storniert, nicht im Rechnungsentwurf', async () => {
    const bau = await baue();
    const zeile = await bau.zeile();
    const andere = await bau.zeile();

    const imEntwurf = await abruf(bau);
    await als(admin, (k) => ordneVertragszeileZu(k, { id: imEntwurf, auftragLeistungId: zeile }));
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(
        `insert into rechnungsposition_quelle (mandant_id, rechnungsposition_id, rechnung_id,
                                               quelle_typ, sonderleistung_id, wirksam,
                                               erstellt_von_art, erstellt_von_dienst)
         values ($1, gen_random_uuid(), gen_random_uuid(), 'sonderleistung', $2, true,
                 'system', 'job:test')`, [f.reinigung, imEntwurf]);
    });
    expect(await grund(() => als(admin,
      (k) => ordneVertragszeileZu(k, { id: imEntwurf, auftragLeistungId: andere }))))
      .toBe('zuordnung_in_rechnung');
    expect(await zeileDes(imEntwurf)).toBe(zeile);

    const abgerechnet = await abruf(bau);
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(`update sonderleistung set status = 'abgerechnet' where id = $1`, [abgerechnet]);
    });
    expect(await grund(() => als(admin,
      (k) => ordneVertragszeileZu(k, { id: abgerechnet, auftragLeistungId: zeile }))))
      .toBe('zuordnung_abgerechnet');

    const storniert = await abruf(bau);
    await sql.unsafe(
      `update sonderleistung set status = 'storniert', storniert_am = now(), storniert_von = $2,
                                 storno_grund = 'Probe'
        where id = $1`, [storniert, admin]);
    expect(await grund(() => als(admin,
      (k) => ordneVertragszeileZu(k, { id: storniert, auftragLeistungId: zeile }))))
      .toBe('zuordnung_storniert');
  });
});
