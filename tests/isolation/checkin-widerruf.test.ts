/**
 * Der Widerruf einer Check-in-Marke — und der Beweis, dass der Definer TRÄGT
 * (TIM-07, K-01).
 *
 * **Warum es diese Datei zusätzlich zur Sperrklinke gibt.**
 * `definer-eigentum.test.ts` prüft, dass `app.checkin_widerrufen`
 * `cse_definer` gehört. Das ist die halbe Zusicherung. Die andere Hälfte
 * steht im Kopf jener Datei als ausdrückliche Warnung: nach einem
 * Eigentumswechsel „liest die Funktion stillschweigend null Zeilen und
 * schreibt einen falschen Wert ohne Fehlermeldung", wenn `cse_definer` ein
 * Tabellenrecht oder eine Policy fehlt.
 *
 * Eine Prüfung, die nur das Eigentum misst, wäre also grün über einer
 * Funktion, die nichts mehr tut. Deshalb fährt diese Datei den ganzen Weg
 * einmal durch: Marke ausgeben, widerrufen, nachsehen.
 *
 * **Und sie prüft das Recht in beide Richtungen.** Die Funktion prüft
 * `zeit.checkin_verwalten` im Mandanten der MARKE, nicht im aktiven der
 * Sitzung — sonst dürfte ein Aufrufer mit einem anderen aktiven Mandanten
 * fremde Marken widerrufen. Der letzte Fall fährt genau das.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur, type Sitzung } from './harness.js';
import { gibCheckinAus, widerrufeCheckin } from '../../src/server/services/zeit/checkin.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function objektMit(mandant: string): Promise<{ objekt: string; kunde: string }> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Widerruf-Testkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Widerruf-Testobjekt', 'Teststr.', '10115', 'Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  return { objekt: o!.id, kunde: k!.id };
}

/** Eine geplante Schicht MIT Besetzung — nur die kann eine Marke tragen. */
async function zuordnungMit(
  mandant: string, anstellung: string, person: string,
): Promise<string> {
  const { objekt, kunde } = await objektMit(mandant);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, soll_besetzung, min_besetzung,
                          erstellt_von_art, status)
     values ($1, 'manuell', $2, current_date,
             (select zeitpunkt from app.loese_ortszeit(current_date, '06:00', 'Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit(current_date, '12:00', 'Europe/Berlin')),
             'Europe/Berlin', '06:00', '12:00', false,
             $3, $4, 1, 1, 'system', 'geplant')
     returning id`,
    [mandant, `wid:${zufall()}`, objekt, kunde]);
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, $2, $3, $4, beginn_zeitpunkt, ende_zeitpunkt, 'system'
       from einsatz where id = $2
     returning id`,
    [mandant, e!.id, anstellung, person]);
  return z!.id;
}

/** Eine Sitzung mit `zeit.checkin_verwalten` — die Rolle `admin` trägt es. */
async function planerin(mandant: string, rolle = 'admin'): Promise<Sitzung> {
  const email = `widerruf-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [rolle]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [u!.id, mandant, r!.id]);
  return {
    scope: 'mandant', mandantId: mandant, mandantIds: [mandant],
    benutzerId: u!.id, readonly: false, portal: 'intern',
  };
}

function kontext(tx: Parameters<Parameters<typeof alsApp>[1]>[0], sitzung: Sitzung) {
  return {
    scope: 'mandant' as const, portal: 'intern' as const,
    benutzerId: sitzung.benutzerId!, aktiverMandantId: sitzung.mandantId!,
    mandantIds: [sitzung.mandantId!],
    abfrage: async <R,>(q: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(q, w as never[])) as readonly R[],
    schreibe: async <R,>(q: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(q, w as never[])) as readonly R[],
  };
}

async function markeZu(zuordnung: string): Promise<{ id: string; widerrufen: Date | null }> {
  const [t] = await sql.unsafe<{ id: string; widerrufen_am: Date | null }[]>(
    `select id, widerrufen_am from checkin_token
      where einsatz_zuordnung_id = $1::uuid order by erstellt_am desc limit 1`, [zuordnung]);
  return { id: t!.id, widerrufen: t!.widerrufen_am };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('Eine Marke widerrufen — der ganze Weg, nicht nur das Eigentum', () => {
  it('ausgeben, widerrufen, und die Zeile trägt Zeitpunkt UND Grund', async () => {
    const zuordnung = await zuordnungMit(f.reinigung, f.fatimaReinigung, f.fatima);
    const sitzung = await planerin(f.reinigung);

    const marke = await alsApp(sitzung, async (tx) =>
      gibCheckinAus(kontext(tx, sitzung), zuordnung, 'checkin', 'unverbunden'));
    expect(marke, 'die Marke kommt einmal im Klartext').toMatch(/^[0-9a-f]{64}$/u);

    const vorher = await markeZu(zuordnung);
    expect(vorher.widerrufen, 'frisch ausgegeben, also nicht widerrufen').toBeNull();

    const ok = await alsApp(sitzung, async (tx) =>
      widerrufeCheckin(kontext(tx, sitzung), vorher.id, 'Schicht getauscht'));
    expect(ok, 'der Definer TRAEGT — sonst laese er hier null Zeilen').toBe(true);

    const [nachher] = await sql.unsafe<{ widerrufen_am: Date | null; grund: string | null }[]>(
      `select widerrufen_am, widerruf_grund as grund from checkin_token where id = $1::uuid`,
      [vorher.id]);
    expect(nachher!.widerrufen_am).not.toBeNull();
    expect(nachher!.grund).toBe('Schicht getauscht');
  });

  it('und der Vorgang steht im Protokoll — `app.protokolliere` schreibt als eigener Definer',
    async () => {
      const zuordnung = await zuordnungMit(f.reinigung, f.fatimaReinigung, f.fatima);
      const sitzung = await planerin(f.reinigung);
      await alsApp(sitzung, async (tx) =>
        gibCheckinAus(kontext(tx, sitzung), zuordnung, 'checkin', 'unverbunden'));
      const { id } = await markeZu(zuordnung);
      await alsApp(sitzung, async (tx) =>
        widerrufeCheckin(kontext(tx, sitzung), id, 'Objekt abgesagt'));

      const [eintrag] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from audit_log
          where aktion = 'zeit.checkin_marke_widerrufen' and objekt_id = $1`, [id]);
      expect(eintrag!.n, 'ohne Protokollzeile waere der Widerruf nicht nachvollziehbar')
        .toBe(1);
    });

  it('ein zweiter Widerruf tut nichts — und ist trotzdem kein Fehler', async () => {
    const zuordnung = await zuordnungMit(f.reinigung, f.fatimaReinigung, f.fatima);
    const sitzung = await planerin(f.reinigung);
    await alsApp(sitzung, async (tx) =>
      gibCheckinAus(kontext(tx, sitzung), zuordnung, 'checkin', 'unverbunden'));
    const { id } = await markeZu(zuordnung);

    expect(await alsApp(sitzung, async (tx) =>
      widerrufeCheckin(kontext(tx, sitzung), id, 'erster'))).toBe(true);
    expect(await alsApp(sitzung, async (tx) =>
      widerrufeCheckin(kontext(tx, sitzung), id, 'zweiter')), 'schon widerrufen').toBe(false);

    // Der Grund des ERSTEN bleibt stehen: er ist die Auskunft, die gilt.
    const [z] = await sql.unsafe<{ grund: string }[]>(
      `select widerruf_grund as grund from checkin_token where id = $1::uuid`, [id]);
    expect(z!.grund).toBe('erster');
  });

  it('ohne Grund kein Widerruf — ein Widerruf ohne Grund ist keine Auskunft', async () => {
    const zuordnung = await zuordnungMit(f.reinigung, f.fatimaReinigung, f.fatima);
    const sitzung = await planerin(f.reinigung);
    await alsApp(sitzung, async (tx) =>
      gibCheckinAus(kontext(tx, sitzung), zuordnung, 'checkin', 'unverbunden'));
    const { id } = await markeZu(zuordnung);

    await expect(alsApp(sitzung, async (tx) =>
      widerrufeCheckin(kontext(tx, sitzung), id, '   '))).rejects.toThrow(/Grund/u);
  });

  it('eine Marke, die es nicht gibt, antwortet `false` — kein Orakel (AUT-06)', async () => {
    const sitzung = await planerin(f.reinigung);
    expect(await alsApp(sitzung, async (tx) =>
      widerrufeCheckin(kontext(tx, sitzung), '00000000-0000-0000-0000-000000000000', 'x')))
      .toBe(false);
  });

  it('DAS Recht wird im Mandanten der MARKE geprüft, nicht im aktiven der Sitzung',
    async () => {
      /*
       * Der Fall, den die Begründung im Kopf der Funktion nennt: die Marke
       * gehört der Security, die Sitzung steht in der Reinigung. Ohne diese
       * Prüfung dürfte ein Planer der einen Gesellschaft die Marken der
       * anderen widerrufen — die Funktion läuft als Definer, also trägt sie
       * ihre Prüfung selbst.
       */
      const fremd = await zuordnungMit(f.security, f.fatimaSecurity, f.fatima);
      const beiSecurity = await planerin(f.security);
      await alsApp(beiSecurity, async (tx) =>
        gibCheckinAus(kontext(tx, beiSecurity), fremd, 'checkin', 'unverbunden'));
      const { id } = await markeZu(fremd);

      /* Dieselbe Person, aber eine Sitzung in der REINIGUNG. */
      const beiReinigung = await planerin(f.reinigung);
      await expect(alsApp(beiReinigung, async (tx) =>
        widerrufeCheckin(kontext(tx, beiReinigung), id, 'fremd')),
      ).rejects.toThrow(/Kein Recht/u);

      const [z] = await sql.unsafe<{ widerrufen_am: Date | null }[]>(
        `select widerrufen_am from checkin_token where id = $1::uuid`, [id]);
      expect(z!.widerrufen_am, 'die fremde Marke lebt weiter').toBeNull();
    });
});
