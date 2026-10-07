/**
 * **Eine Korrektur ändert die Zuordnung** (V-351, O-927 (1), O-891, D-827) —
 * an echtem Postgres.
 *
 * Bis hierher übernahm `korrigiereZeiteintrag` Objekt, Leistungszeile und
 * Revier der alten Fassung, obwohl das Formular „Zuordnung korrigieren"
 * anbot; Zeit ohne Leistungszeile blieb ohne. Geprüft wird: die neue Fassung
 * trägt die neue Leistungszeile (auch auf einer Schicht — der Auslöser
 * `z_erben` überschreibt sie nicht), ein neues Objekt nur ohne Schicht, das
 * Revier nur, wenn es am neuen Objekt liegt; und jede Abweisung — falsche
 * Art, nichts geändert, gesperrter Monat, abgerechnet, im Rechnungsentwurf,
 * Zeile ausserhalb ihres Zeitraums, Auftrag läuft nicht — schreibt nichts.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  ZuordnungsFehler, korrigiereZeiteintrag, type KorrekturEingabe,
} from '../../src/server/services/zeit/korrektur.js';

let f: Fixtur;
let planer = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(rolle: string): Promise<string> {
  const email = `zuordnung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null),
             current_date - 1)`,
    [u!.id, f.reinigung, rolle]);
  return u!.id;
}

function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: planer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const korrigiere = (e: Partial<KorrekturEingabe> & Pick<KorrekturEingabe, 'zeiteintragId'>) =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
           portal: 'intern', readonly: false },
  (tx) => korrigiereZeiteintrag(kontextAus(tx), {
    art: 'zuordnung_korrektur', grundKategorie: 'falsches_objekt',
    begruendung: 'Falsch zugeordnet.', durchgefuehrtVon: planer, ...e,
  }));

async function grund(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (fehler) {
    if (fehler instanceof ZuordnungsFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

interface Aufbau {
  readonly objektA: string; readonly objektB: string; readonly revierA: string;
  readonly kunde: string;
  readonly ganzjahr: string; readonly abJuni: string; readonly bisMaerz: string;
  readonly storniert: string;
}

async function baue(): Promise<Aufbau> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Zuordnungskunde') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  const objekt = async (name: string): Promise<string> => {
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1,$2,$3,$4,'Teststr. 1','10115','Berlin') returning id`,
      [f.reinigung, k!.id, `O-${zufall()}`, name]);
    return o!.id;
  };
  const objektA = await objekt('Objekt A');
  const objektB = await objekt('Objekt B');
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten, aktiv_ab,
                         erstellt_von_art)
     values ($1,$2,'Revier A',60,'2020-01-01','system') returning id`, [f.reinigung, objektA]);
  const auftrag = async (status: string): Promise<string> => {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                            status_grund, bezeichnung, verantwortlich_benutzer_id, start_datum)
       values ($1,$2,$3,$4,'rahmenvertrag',$5::auftrag_status,
               case when $5 = 'storniert' then 'Probe' end,
               'Unterhaltsreinigung',$6,'2026-01-01')
       returning id`, [f.reinigung, `AU-${zufall()}`, k!.id, objektA, status, planer] as never[]);
    return a!.id;
  };
  const laufend = await auftrag('aktiv');
  const weg = await auftrag('storniert');
  let nr = 0;
  const zeile = async (auftragId: string, ab: string, bis: string | null): Promise<string> => {
    nr += 1;
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung, menge,
                                     einheit, einzelpreis_cent, steuersatz_bp, gueltig_ab,
                                     gueltig_bis)
       values ($1,$2,$3,'Unterhaltsreinigung',1,'Stunde',3200,1900,$4::date,$5::date)
       returning id`, [f.reinigung, auftragId, nr, ab, bis] as never[]);
    return l!.id;
  };
  return {
    objektA, objektB, revierA: r!.id, kunde: k!.id,
    ganzjahr: await zeile(laufend, '2026-01-01', null),
    abJuni: await zeile(laufend, '2026-06-01', null),
    bisMaerz: await zeile(laufend, '2026-01-01', '2026-03-31'),
    storniert: await zeile(weg, '2026-01-01', null),
  };
}

/** Eine abgeschlossene Zeit am 10.09.2026, ohne Schicht, an Objekt A und Revier A. */
async function zeitOhneSchicht(bau: Aufbau): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, objekt_id, revier_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art)
     values ($1,$2,$3,$4,$5,'2026-09-10T06:00:00Z','2026-09-10T10:00:00Z',0,
             'import','import','import','import','abgeschlossen','system')
     returning id`,
    [f.reinigung, f.jonasReinigung, f.jonas, bau.objektA, bau.revierA] as never[]);
  return z!.id;
}

/** Dieselbe Zeit auf einer Schicht an Objekt A — ohne Leistungszeile. */
async function zeitAufSchicht(bau: Aufbau): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone, beginn_lokal, ende_lokal,
                          objekt_id, kunde_id, revier_id, erstellt_von_art, status)
     values ($1,'manuell',$2,'2026-09-10','2026-09-10T06:00:00Z','2026-09-10T10:00:00Z',
             'Europe/Berlin',time '08:00',time '12:00',$3,$4,$5,'system','geplant')
     returning id`, [f.reinigung, `zuordnung:${zufall()}`, bau.objektA, bau.kunde, bau.revierA]);
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, einsatz_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art)
     values ($1,$2,$3,$4,'2026-09-10T06:00:00Z','2026-09-10T10:00:00Z',0,
             'import','import','import','import','abgeschlossen','system')
     returning id`, [f.reinigung, f.jonasReinigung, f.jonas, e!.id] as never[]);
  return z!.id;
}

async function fassung(id: string): Promise<{
  objekt: string | null; leistung: string | null; revier: string | null; ersetzt: boolean;
}> {
  const [z] = await sql.unsafe<{
    objekt: string | null; leistung: string | null; revier: string | null; ersetzt: boolean;
  }[]>(
    `select objekt_id as objekt, auftrag_leistung_id as leistung, revier_id as revier,
            ersetzt_am is not null as ersetzt
       from zeiteintrag where id = $1`, [id]);
  return z!;
}

beforeEach(async () => {
  f = await seed();
  planer = await konto('admin');
});
afterAll(schliessen);

describe('V-351 — die Korrektur setzt Leistungszeile und Objekt', () => {
  it('Zeit ohne Schicht: Leistungszeile, dann Objekt — das Revier bleibt nur am eigenen Objekt', async () => {
    const bau = await baue();
    const z = await zeitOhneSchicht(bau);
    const eins = await korrigiere({ zeiteintragId: z, zuordnung: { auftragLeistungId: bau.ganzjahr } });
    expect(await fassung(z)).toMatchObject({ ersetzt: true, leistung: null });
    expect(await fassung(eins.neueFassungId)).toEqual({
      objekt: bau.objektA, leistung: bau.ganzjahr, revier: bau.revierA, ersetzt: false,
    });
    const zwei = await korrigiere({ zeiteintragId: eins.neueFassungId, zuordnung: { objektId: bau.objektB } });
    expect(await fassung(zwei.neueFassungId)).toEqual({
      objekt: bau.objektB, leistung: bau.ganzjahr, revier: null, ersetzt: false,
    });
  });

  it('Zeit auf einer Schicht: die neue Leistungszeile bleibt — ein anderes Objekt nicht', async () => {
    const bau = await baue();
    const z = await zeitAufSchicht(bau);
    expect(await grund(() => korrigiere({ zeiteintragId: z, zuordnung: { objektId: bau.objektB } })))
      .toBe('objekt_aus_schicht');
    const neu = await korrigiere({ zeiteintragId: z, zuordnung: { auftragLeistungId: bau.abJuni } });
    expect(await fassung(neu.neueFassungId)).toMatchObject({
      objekt: bau.objektA, leistung: bau.abJuni, revier: bau.revierA,
    });
  });

  it('die Zeile muss am Tag der Zeit gelten, ihr Auftrag Zeit annehmen', async () => {
    const bau = await baue();
    const z = await zeitOhneSchicht(bau);
    expect(await grund(() => korrigiere({ zeiteintragId: z, zuordnung: { auftragLeistungId: bau.bisMaerz } })))
      .toBe('leistung_ausserhalb');
    expect(await grund(() => korrigiere({ zeiteintragId: z, zuordnung: { auftragLeistungId: bau.storniert } })))
      .toBe('leistung_auftrag_laeuft_nicht');
    expect(await grund(() => korrigiere({
      zeiteintragId: z, zuordnung: { auftragLeistungId: '00000000-0000-4000-8000-000000000000' },
    }))).toBe('leistung_unbekannt');
    expect(await grund(() => korrigiere({
      zeiteintragId: z, zuordnung: { objektId: '00000000-0000-4000-8000-000000000000' },
    }))).toBe('objekt_unbekannt');
    expect(await fassung(z)).toMatchObject({ ersetzt: false, leistung: null });
  });

  it('nur mit der Art „Zuordnung korrigieren", und nur wenn sich etwas ändert', async () => {
    const bau = await baue();
    const z = await zeitOhneSchicht(bau);
    expect(await grund(() => korrigiere({
      zeiteintragId: z, art: 'zeit_korrektur', zuordnung: { auftragLeistungId: bau.ganzjahr },
    }))).toBe('zuordnung_falsche_art');
    expect(await grund(() => korrigiere({ zeiteintragId: z, zuordnung: { objektId: bau.objektA } })))
      .toBe('zuordnung_unveraendert');
    // Ohne Zuordnungsfelder bleibt eine Zeitkorrektur, was sie war.
    const zeit = await korrigiere({
      zeiteintragId: z, art: 'zeit_korrektur', grundKategorie: 'geraet_defekt',
      endeZeitpunkt: new Date('2026-09-10T11:00:00Z'),
    });
    expect(await fassung(zeit.neueFassungId)).toMatchObject({
      objekt: bau.objektA, leistung: null, revier: bau.revierA,
    });
  });

  it('nicht im gesperrten Monat, nicht abgerechnet, nicht im Rechnungsentwurf', async () => {
    const bau = await baue();
    const replica = async (anweisung: string, werte: readonly unknown[]): Promise<void> => {
      await sql.begin(async (tx) => {
        await tx.unsafe(`set local session_replication_role = replica`);
        await tx.unsafe(anweisung, werte as never[]);
      });
    };
    const gesperrt = await zeitOhneSchicht(bau);
    await replica(`update zeiteintrag set gesperrt_am = now() where id = $1`, [gesperrt]);
    expect(await grund(() => korrigiere({
      zeiteintragId: gesperrt, zuordnung: { auftragLeistungId: bau.ganzjahr },
    }))).toBe('zuordnung_gesperrt');

    const abgerechnet = await zeitOhneSchicht(bau);
    await replica(`update zeiteintrag set abgerechnet_am = now() where id = $1`, [abgerechnet]);
    expect(await grund(() => korrigiere({
      zeiteintragId: abgerechnet, zuordnung: { auftragLeistungId: bau.ganzjahr },
    }))).toBe('zuordnung_abgerechnet');

    // Der Entwurf führt eine FRÜHERE Fassung der Kette — gefragt wird die Kette.
    const imEntwurf = await zeitOhneSchicht(bau);
    const neu = await korrigiere({
      zeiteintragId: imEntwurf, art: 'zeit_korrektur', grundKategorie: 'geraet_defekt',
      endeZeitpunkt: new Date('2026-09-10T11:00:00Z'),
    });
    await replica(
      `insert into rechnungsposition_quelle (mandant_id, rechnungsposition_id, rechnung_id,
                                             quelle_typ, zeiteintrag_id, wirksam,
                                             erstellt_von_art, erstellt_von_dienst)
       values ($1, gen_random_uuid(), gen_random_uuid(), 'zeiteintrag', $2, true,
               'system', 'job:test')`, [f.reinigung, imEntwurf]);
    expect(await grund(() => korrigiere({
      zeiteintragId: neu.neueFassungId, zuordnung: { auftragLeistungId: bau.ganzjahr },
    }))).toBe('zuordnung_in_rechnung');
    expect(await fassung(neu.neueFassungId)).toMatchObject({ ersetzt: false, leistung: null });
  });
});
