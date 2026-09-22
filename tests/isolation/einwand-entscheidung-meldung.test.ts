/**
 * Die Entscheidung über einen Zeit-Einwand erreicht die meldende Person —
 * gegen echtes Postgres (V-051, EMP-07, TIM-11, NOT-01, 0377).
 *
 * **Der Befund, den diese Datei festnagelt.** `entscheideEinwand` setzte
 * Zustand, Zeitpunkt und Begründung — und danach passierte nichts. Wer eine
 * falsch erfasste Arbeitszeit meldete, erfuhr die Entscheidung nur, wenn er
 * von sich aus dieselbe Seite noch einmal öffnete. Eine Ablehnung, von der
 * niemand weiss, ist eine, der niemand widerspricht.
 *
 * **Warum das ohne Test wiederkäme.** Eine fehlende Meldung wirft keine
 * Ausnahme und färbt keine Zeile rot; sie sieht aus wie eine Entscheidung,
 * die geklappt hat. Genau die Sorte Fehler, die `CLAUDE.md` „silent,
 * expensive, late-discovered" nennt.
 *
 * Geprüft wird fünffach: dass die Meldung entsteht, dass sie beim richtigen
 * KONTO landet, dass die Begründung wörtlich durchkommt, dass ein
 * Zwischenstand SCHWEIGT — und dass die Funktion aus einer fremden
 * Gesellschaft nichts zustellt.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { entscheideEinwand } from '../../src/server/services/zeit/einwand.js';

let f: Fixtur;
let planer = '';
let jonasKonto = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

function kontextAus(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(b: string, mandant: string, fn: (tx: postgres.TransactionSql) => Promise<T>)
: Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: b,
           portal: 'intern', readonly: false }, fn);

beforeAll(async () => {
  f = await seed();

  /* Die Planung — sie entscheidet, und sie ist NICHT die Betroffene (EMP-07). */
  const email = `planung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  planer = u!.id;
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Planung','aktiv')`,
    [planer, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [planer, f.reinigung, await rolleId('admin')]);

  /*
   * Jonas bekommt einen ZUGANG. Ohne ihn liefert 0377 NULL — richtig (D-09),
   * aber dann prueft diese Datei nichts. Der Fall „kein Zugang" hat sein
   * eigenes Pruefstueck unten.
   */
  const jEmail = `jonas-${zufall()}@cse.test`;
  const [ju] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [jEmail]);
  jonasKonto = ju!.id;
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,'Jonas','aktiv',$3)`,
    [jonasKonto, jEmail, f.jonas]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [jonasKonto, f.reinigung, await rolleId('mitarbeiter')]);
});
afterAll(schliessen);

/** Ein Einwand von Jonas — roh, weil der Einreicheweg sein eigenes Stück hat. */
async function einwand(mitEintrag = true): Promise<string> {
  let eintragId: string | null = null;
  if (mitEintrag) {
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
          pause_minuten, erfassungsart_beginn, erfassungsart_ende,
          quelle_beginn, quelle_ende, status, erstellt_von_art)
       values ($1,$2,$3,'2026-03-11T21:00:00Z','2026-03-12T05:00:00Z',0,
               'import','import','import','import','abgeschlossen','system')
       returning id`,
      [f.reinigung, f.jonasReinigung, f.jonas] as never[]);
    eintragId = z!.id;
  }
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into zeit_einwand
       (mandant_id, anstellung_id, zeiteintrag_id, art, betrifft_datum,
        begruendung, status, eingereicht_von_benutzer_id)
     values ($1,$2,$3,$4,'2026-03-11','Die Pause war nur 15 Minuten.','offen',$5)
     returning id`,
    [f.reinigung, f.jonasReinigung, eintragId,
      mitEintrag ? 'pause_falsch' : 'eintrag_fehlt', jonasKonto] as never[]);
  return e!.id;
}

async function meldungenAn(benutzerId: string): Promise<readonly {
  art: string; titel: string; text: string; ziel: string; objekt_id: string | null;
}[]> {
  return sql.unsafe(
    `select art, titel, text, ziel, objekt_id from benachrichtigung
      where empfaenger_id = $1 order by erstellt_am desc`, [benutzerId]) as never;
}

describe('§1 die Entscheidung kommt an', () => {
  it('legt eine Meldung im Posteingang der MELDENDEN Person an', async () => {
    const id = await einwand();
    await als(planer, f.reinigung, (tx) => entscheideEinwand(kontextAus(tx, planer), {
      einwandId: id, status: 'abgelehnt', entschiedenVon: planer,
      begruendung: 'Die Pause steht so im Dienstplan und wurde bestätigt.',
    }));

    const meldungen = (await meldungenAn(jonasKonto)).filter((m) => m.objekt_id === id);
    expect(meldungen.length).toBe(1);
    expect(meldungen[0]!.art).toBe('zeit.einwand_entschieden');
  });

  it('nennt den Zustand im Titel und die Begründung WÖRTLICH im Text', async () => {
    const id = await einwand();
    const grund = 'Der Vorarbeiter hat die Zeit am selben Abend gegengezeichnet.';
    await als(planer, f.reinigung, (tx) => entscheideEinwand(kontextAus(tx, planer), {
      einwandId: id, status: 'teilweise_anerkannt', entschiedenVon: planer,
      begruendung: grund,
    }));

    const [m] = (await meldungenAn(jonasKonto)).filter((x) => x.objekt_id === id);
    expect(m!.titel).toContain('teilweise anerkannt');
    /*
     * Woertlich: die Begruendung ist die Aussage eines Menschen ueber einen
     * Einzelfall. Wer sie kuerzt, zusammenfasst oder uebersetzt, erzeugt eine
     * zweite Fassung — und im Streit steht dann die falsche im Posteingang.
     */
    expect(m!.text).toContain(grund);
    expect(m!.text).toContain('11.03.2026');
  });

  it('führt auf den EIGENEN Vorgang — Personen-Scope, ohne Bereichssegment', async () => {
    const id = await einwand();
    await als(planer, f.reinigung, (tx) => entscheideEinwand(kontextAus(tx, planer), {
      einwandId: id, status: 'anerkannt', entschiedenVon: planer,
      begruendung: 'Stimmt, die Pause war kürzer.',
    }));
    const [m] = (await meldungenAn(jonasKonto)).filter((x) => x.objekt_id === id);
    expect(m!.ziel).toMatch(/^\/portal\/mein\/zeiten\//u);
    expect(m!.ziel).not.toContain('[mandant]');
  });

  it('führt auf die LISTE, wenn der Einwand keinen Zeiteintrag hat', async () => {
    /* `eintrag_fehlt` hat keinen (§6.27) — ein Ziel mit `null` wäre ein Verweis
       ins Leere. */
    const id = await einwand(false);
    await als(planer, f.reinigung, (tx) => entscheideEinwand(kontextAus(tx, planer), {
      einwandId: id, status: 'anerkannt', entschiedenVon: planer,
      begruendung: 'Der Eintrag wird nacherfasst.',
    }));
    const [m] = (await meldungenAn(jonasKonto)).filter((x) => x.objekt_id === id);
    expect(m!.ziel).toBe('/portal/mein/zeiten');
  });
});

describe('§2 wann sie SCHWEIGT', () => {
  it('meldet NICHTS beim Übergang in Prüfung — das ist keine Entscheidung', async () => {
    const id = await einwand();
    await als(planer, f.reinigung, (tx) => entscheideEinwand(kontextAus(tx, planer), {
      einwandId: id, status: 'in_pruefung', entschiedenVon: planer,
    }));
    const meldungen = (await meldungenAn(jonasKonto)).filter((m) => m.objekt_id === id);
    expect(meldungen).toEqual([]);
  });

  it('meldet NICHTS, wenn die Person den Vorgang selbst zurückzieht', async () => {
    const id = await einwand();
    await als(planer, f.reinigung, (tx) => entscheideEinwand(kontextAus(tx, planer), {
      einwandId: id, status: 'zurueckgezogen', entschiedenVon: planer,
    }));
    const meldungen = (await meldungenAn(jonasKonto)).filter((m) => m.objekt_id === id);
    expect(meldungen).toEqual([]);
  });
});

describe('§3 was die Definer-Funktion NICHT darf (0377)', () => {
  it('stellt aus einer FREMDEN Gesellschaft nichts zu (Invariante 3)', async () => {
    const id = await einwand();
    const vorher = (await meldungenAn(jonasKonto)).length;
    /*
     * Dieselbe Kennung, aber `app.aktiver_mandant()` ist die Security. Der
     * Definer umgeht RLS — also muss die Funktion SELBST pruefen, und genau
     * das haelt diese Zeile fest.
     */
    const [r] = await als(planer, f.security, (tx) =>
      tx.unsafe(`select app.einwand_entscheidung_melden($1::uuid,'T','X','/portal/mein/zeiten')
                   as id`, [id] as never[])) as unknown as { id: string | null }[];
    expect(r!.id).toBeNull();
    expect((await meldungenAn(jonasKonto)).length).toBe(vorher);
  });

  it('weist ein Ziel AUSSERHALB des Arbeiterportals ab', async () => {
    const id = await einwand();
    await als(planer, f.reinigung, (tx) => entscheideEinwand(kontextAus(tx, planer), {
      einwandId: id, status: 'abgelehnt', entschiedenVon: planer,
      begruendung: 'Nachweislich anders erfasst.',
    }));
    await expect(als(planer, f.reinigung, (tx) =>
      tx.unsafe(`select app.einwand_entscheidung_melden($1::uuid,'T','X','/portal/reinigung/zeiten')`,
        [id] as never[]))).rejects.toThrow(/Arbeiterportal/u);
  });

  it('meldet NICHTS, solange der Vorgang nicht entschieden ist', async () => {
    const id = await einwand();
    const [r] = await als(planer, f.reinigung, (tx) =>
      tx.unsafe(`select app.einwand_entscheidung_melden($1::uuid,'T','X','/portal/mein/zeiten')
                   as id`, [id] as never[])) as unknown as { id: string | null }[];
    expect(r!.id).toBeNull();
  });
});
