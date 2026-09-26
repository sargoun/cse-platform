/**
 * Eine Korrektur erreicht die Mitarbeiterin — gegen echtes Postgres
 * (TIM-11, EMP-07, D-09, 0036, 0350).
 *
 * **Der Befund, den diese Datei festnagelt.** `/portal/[mandant]/zeiten/[id]/korrektur`
 * verlangt Art, Grund und Begruendung als PFLICHTFELDER, und
 * `korrigiereZeiteintrag` schrieb sie sauber in `zeiteintrag_korrektur` — und
 * schwieg. Der Mensch, dessen Stunden sich aenderten, erfuhr davon nur, wenn
 * er zufaellig nachsah. Der Mandant hat es woertlich verlangt.
 *
 * **Warum das ohne Test wiederkaeme.** Eine fehlende Nachricht wirft keine
 * Ausnahme und faerbt keine Zeile rot; sie sieht aus wie eine Korrektur, die
 * geklappt hat. Genau die Sorte Fehler, die `CLAUDE.md` „silent, expensive,
 * late-discovered" nennt.
 *
 * Geprueft wird deshalb VIERFACH: dass die Nachricht entsteht, dass sie beim
 * richtigen Menschen landet, dass sie in SEINER Sprache steht, und dass die
 * Begruendung woertlich durchkommt.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { korrigiereZeiteintrag, KeinNachrichtenRechtFehler }
  from '../../src/server/services/zeit/korrektur.js';

let f: Fixtur;
let planer = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, f.reinigung, await rolleId('admin')]);
  return u!.id;
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

const als = <T>(b: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: b,
           portal: 'intern', readonly: false }, fn);

/** Ein abgeschlossener Eintrag fuer Jonas — die Nachtschicht, wie ueblich. */
async function eintrag(): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
        pause_minuten, erfassungsart_beginn, erfassungsart_ende,
        quelle_beginn, quelle_ende, status, erstellt_von_art)
     values ($1,$2,$3,'2026-03-11T21:00:00Z','2026-03-12T05:00:00Z',0,
             'import','import','import','import','abgeschlossen','system')
     returning id`,
    [f.reinigung, f.jonasReinigung, f.jonas] as never[]);
  return z!.id;
}

/**
 * Die Nachricht, die an dieser Person haengt.
 *
 * **`empfaenger_typ`/`empfaenger_id`, nicht `person_id`.** `0011` legte die
 * Tabelle mit `person_id` an; eine spaetere Migration hat sie auf ein
 * typisiertes Paar umgestellt, weil auch Ansprechpartner, Kandidaten und
 * externe Adressen Empfaenger sein koennen. Wer hier `person_id` schreibt,
 * bekommt „column does not exist" — und zwar erst gegen echtes Postgres.
 */
async function nachrichtAn(personId: string): Promise<
{ betreff: string | null; koerper: string; bezug_typ: string | null } | undefined> {
  const [n] = await sql.unsafe<
  { betreff: string | null; koerper: string; bezug_typ: string | null }[]>(
    `select n.betreff, n.koerper, n.bezug_typ::text as bezug_typ
       from nachricht n
       join nachricht_empfaenger e on e.nachricht_id = n.id
      where e.empfaenger_typ = 'person' and e.empfaenger_id = $1
      order by n.erstellt_am desc
      limit 1`, [personId]);
  return n;
}

async function spracheSetzen(personId: string, sprache: string): Promise<void> {
  await sql.unsafe(`update person set sprache = $2 where id = $1`, [personId, sprache]);
}

beforeEach(async () => {
  f = await seed();
  planer = await konto('planer');
});
afterAll(schliessen);

describe('eine Korrektur schickt der Mitarbeiterin eine Nachricht', () => {
  it('sie entsteht, haengt am Zeiteintrag und nennt die Begruendung woertlich', async () => {
    const id = await eintrag();
    await als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: id, art: 'zeit_korrektur',
      grundKategorie: 'vergessen_auszustempeln',
      begruendung: 'Du hast um 06:00 ausgestempelt, die Schicht endete um 05:00.',
      durchgefuehrtVon: planer,
      endeZeitpunkt: new Date('2026-03-12T04:00:00Z'),
    }));

    const n = await nachrichtAn(f.jonas);
    expect(n, 'ohne Nachricht erfaehrt die Mitarbeiterin nichts').toBeDefined();
    expect(n?.bezug_typ).toBe('zeiteintrag');
    /*
     * Woertlich, in Anfuehrungszeichen. Die Begruendung ist der Wortlaut eines
     * Menschen und kann in einem Streit ueber Lohn zitiert werden; sie
     * maschinell zu uebertragen hiesse, ihm Worte zuzuschreiben.
     */
    expect(n?.koerper).toContain('Du hast um 06:00 ausgestempelt');
  });

  it('sie steht in der Sprache der Mitarbeiterin, nicht in der des Planers', async () => {
    await spracheSetzen(f.jonas, 'ar');
    const id = await eintrag();
    await als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: id, art: 'zeit_korrektur', grundKategorie: 'geraet_defekt',
      begruendung: 'Das Terminal war aus.', durchgefuehrtVon: planer,
      endeZeitpunkt: new Date('2026-03-12T04:00:00Z'),
    }));

    const n = await nachrichtAn(f.jonas);
    /*
     * Der Rahmen arabisch, die Begruendung deutsch — genau diese Mischung ist
     * die Absicht. Ein deutscher Satz an eine Reinigungskraft, die Arabisch
     * eingestellt hat, ist derselbe Fall wie die Statuspille ohne `sprache`:
     * formal zugestellt, tatsaechlich nicht angekommen.
     */
    expect(n?.betreff).toBe('تم تصحيح وقت العمل المسجَّل لك');
    expect(n?.koerper).toContain('عطل في الجهاز');
    expect(n?.koerper).toContain('Das Terminal war aus.');
  });

  it('ein Storno sagt Storno — und nennt den Begriff auf Tuerkisch mit', async () => {
    await spracheSetzen(f.jonas, 'tr');
    const id = await eintrag();
    await als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: id, art: 'storno', grundKategorie: 'falsches_objekt',
      begruendung: 'Doppelt erfasst.', durchgefuehrtVon: planer,
    }));

    const n = await nachrichtAn(f.jonas);
    /* `Storno` traegt Rechtsbedeutung und bleibt deutsch — mit Erklaerung,
       nie mit einer erfundenen Entsprechung. */
    expect(n?.koerper).toContain('Storno');
    expect(n?.betreff).toBe('Kaydedilen çalışma saatiniz iptal edildi');
  });

  it('die Fassungsnummer steigt — das ist, was die Mitarbeiterin auf ihrer Seite sieht', async () => {
    const id = await eintrag();
    const e = await als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: id, art: 'pause_korrektur', grundKategorie: 'sonstiges',
      begruendung: 'Pause nachgetragen.', durchgefuehrtVon: planer,
      pauseMinuten: 30,
    }));
    expect(e.version).toBe(2);

    const [z] = await sql.unsafe<{ version: number }[]>(
      `select version from zeiteintrag where id = $1`, [e.neueFassungId]);
    expect(Number(z?.version)).toBe(2);
  });

  it('ohne `nachricht.versenden` scheitert die Korrektur MIT Grund, nicht stumm', async () => {
    /*
     * Eine Gesellschaft kann der Rolle das Recht entziehen. Dann darf die
     * Korrektur nicht etwa „ohne Nachricht" durchgehen — das waere genau der
     * Zustand zurueck, den diese Datei festnagelt. Sie scheitert, und der Satz
     * sagt warum: sonst meldete die Policy „new row violates row-level
     * security" und zeigte damit auf die Zeiterfassung statt auf das Recht.
     */
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, false from berechtigung b
        where b.schluessel = 'nachricht.versenden'`,
      [await rolleId('admin'), f.reinigung]);

    const id = await eintrag();
    await expect(als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: id, art: 'zeit_korrektur', grundKategorie: 'sonstiges',
      begruendung: 'Egal.', durchgefuehrtVon: planer,
      endeZeitpunkt: new Date('2026-03-12T04:00:00Z'),
    }))).rejects.toThrow(KeinNachrichtenRechtFehler);
  });
});
