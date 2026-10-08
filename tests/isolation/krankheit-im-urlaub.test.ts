/**
 * Krankheit im Urlaub gegen eine echte Datenbank (V-319, O-138, D-853,
 * § 9 BUrlG, EMP-05, LEG-09).
 *
 * **Der Befund.** Eine Krankmeldung über einem genehmigten Urlaub ließ sich
 * erfassen, aber das Urlaubskonto behielt die vollen Urlaubstage abgezogen —
 * der Auslöser buchte nur Genehmigung und Stornierung.
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Erfasst mit Bescheinigung: die Krankheit steht als `erfasst` da, der
 *     Urlaub bleibt genehmigt und unverändert, und das Urlaubskonto bekommt
 *     die kranken Arbeitstage zurück — in einer Transaktion.
 *  2. Storniert: die Krankheit gibt die Tage wieder ab. Der Urlaub danach
 *     storniert gibt nur zurück, was er noch kostet — nie zweimal; und eine
 *     Krankheit, deren Urlaub schon storniert ist, bucht beim Stornieren
 *     nichts mehr.
 *  3. Abgewiesen mit Grund, und das Konto bleibt: ohne Bescheinigung,
 *     außerhalb des Urlaubs, nur Wochenende, schon erfasst, kein offenes
 *     Konto des Urlaubsjahres, Urlaub nicht genehmigt.
 *  4. Die Schranken: ohne beide Rechte nicht, auch nicht an der Funktion
 *     vorbei; kein direkter Weg für cse_app; Verweis und Tage bleiben, wie
 *     sie sind; der Urlaub mit geltender Gutschrift behält Zeitraum und Tage;
 *     cse_app liest die zwei Spalten nicht (Art. 9 DSGVO).
 *  5. Der Lohnexport sagt die Gutschrift mit — an der Krankheit und am Urlaub.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  entscheideAntrag, reicheAntragEin,
} from '../../src/server/services/abwesenheit/antrag.js';
import { storniereAbwesenheit } from '../../src/server/services/abwesenheit/index.js';
import {
  erfasseKrankheitImUrlaub, KrankheitImUrlaubFehler, type KrankheitImUrlaubEingabe,
} from '../../src/server/services/abwesenheit/krankheit-im-urlaub.js';

let f: Fixtur;
let chef = '';     // leitung — meldet und genehmigt
let personal = ''; // admin — exportiert, liest den Grund
let jonasKonto = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(praefix: string, personId: string | null = null): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, person_id, status)
     values ($1,$2,$2,$3,'aktiv')`, [u!.id, email, personId]);
  return u!.id;
}

function als<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
  portal: 'intern' | 'mitarbeiter' = 'intern', personId?: string,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId, portal, readonly: false,
      ...(personId === undefined ? {} : { personId }) },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal, benutzerId,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

async function genommen(jahr = 2029): Promise<string> {
  const [k] = await sql.unsafe<{ genommen: string }[]>(
    `select genommen_tage::text as genommen from urlaubskonto
      where anstellung_id = $1 and jahr = $2`, [f.jonasReinigung, jahr]);
  return k!.genommen;
}

/** Ein genehmigter Urlaub über den Antragsweg — Montag, 9., bis Freitag, 20. Juli 2029. */
async function genehmigterUrlaub(
  von = '2029-07-09', bis = '2029-07-20',
): Promise<{ antrag: string; urlaub: string }> {
  const [urlaubsart] = await sql.unsafe<{ id: string }[]>(
    `select id from abwesenheitsart where schluessel = 'urlaub' and mandant_id is null`);
  const [antragsart] = await sql.unsafe<{ id: string }[]>(
    `select id from antragsart where schluessel = 'urlaub' and mandant_id is null`);
  const antrag = await als(jonasKonto, (k) => reicheAntragEin(k, {
    anstellungId: f.jonasReinigung, antragsartId: antragsart!.id,
    vonDatum: von, bisDatum: bis, abwesenheitsartId: urlaubsart!.id,
  }), 'mitarbeiter', f.jonas);
  const e = await als(chef, (k) => entscheideAntrag(k, {
    antragId: antrag.id, entscheidung: 'genehmigt',
  }));
  return { antrag: antrag.id, urlaub: e.abwesenheitId! };
}

const krank = (antragId: string, mehr: Partial<KrankheitImUrlaubEingabe> = {}): KrankheitImUrlaubEingabe => ({
  antragId, von: '2029-07-11', bis: '2029-07-13', auVorliegt: true, ...mehr,
});

async function grund(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(KrankheitImUrlaubFehler);
  return (e as KrankheitImUrlaubFehler).grund;
}

beforeEach(async () => {
  f = await seed();
  chef = await konto('planung');
  personal = await konto('personal');
  jonasKonto = await konto('jonas', f.jonas);
  for (const [wer, rolle] of [[chef, 'leitung'], [personal, 'admin'], [jonasKonto, 'mitarbeiter']] as const) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [wer, f.reinigung, await rolleId(rolle)]);
  }
  await sql.unsafe(
    `insert into urlaubskonto (mandant_id, anstellung_id, jahr, anspruch_tage)
     values ($1, $2, 2029, 30)`, [f.reinigung, f.jonasReinigung]);
});
afterAll(schliessen);

describe('(1) erfasst mit Bescheinigung', () => {
  it('die Krankheit steht da, der Urlaub bleibt, drei Tage gehen zurück', async () => {
    const { antrag, urlaub } = await genehmigterUrlaub();
    expect(await genommen()).toBe('10.000');

    const e = await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag, {
      auBis: '2029-07-13', bemerkung: 'AU per Post',
    })));
    expect(e).toMatchObject({ urlaubId: urlaub, gutgeschrieben: '3.000', jahr: 2029 });
    expect(await genommen()).toBe('7.000');

    const [z] = await sql.unsafe<{
      status: string; art: string; tage: string; au: boolean; au_bis: string;
      verweis: string; gut: string; bemerkung: string;
    }[]>(
      `select a.status::text as status, aa.schluessel as art, a.tage_angerechnet::text as tage,
              a.au_bescheinigung_vorliegt as au, a.au_bis::text as au_bis,
              a.unterbrochener_urlaub_id::text as verweis,
              a.urlaub_gutgeschrieben_tage::text as gut, a.bemerkung
         from abwesenheit a join abwesenheitsart aa on aa.id = a.abwesenheitsart_id
        where a.id = $1`, [e.krankheitId]);
    expect(z).toEqual({
      status: 'erfasst', art: 'krankheit', tage: '3.000', au: true, au_bis: '2029-07-13',
      verweis: urlaub, gut: '3.000', bemerkung: 'AU per Post',
    });
    const [u] = await sql.unsafe<{ status: string; tage: string; von: string; bis: string }[]>(
      `select status::text as status, tage_angerechnet::text as tage, von::text, bis::text
         from abwesenheit where id = $1`, [urlaub]);
    expect(u).toEqual({ status: 'genehmigt', tage: '10.000', von: '2029-07-09', bis: '2029-07-20' });
  });

  it('eine Krankheit über das Urlaubsende hinaus gibt nur die Urlaubstage zurück', async () => {
    const { antrag } = await genehmigterUrlaub();
    const e = await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag, {
      von: '2029-07-18', bis: '2029-07-25',
    })));
    expect(e.gutgeschrieben).toBe('3.000');
    expect(await genommen()).toBe('7.000');
  });
});

describe('(2) storniert', () => {
  it('die Krankheit gibt die Tage wieder ab — der Urlaub danach nur, was er noch kostet', async () => {
    const { antrag, urlaub } = await genehmigterUrlaub();
    const e = await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)));
    expect(await genommen()).toBe('7.000');

    await als(chef, (k) => storniereAbwesenheit(k, e.krankheitId, 'falsch erfasst'));
    expect(await genommen()).toBe('10.000');

    // Neu erfasst, dann der Urlaub storniert: zurück auf null, nicht minus drei.
    await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)));
    expect(await genommen()).toBe('7.000');
    await als(chef, (k) => storniereAbwesenheit(k, urlaub, 'Urlaub ganz zurückgenommen'));
    expect(await genommen()).toBe('0.000');
  });

  it('eine Krankheit, deren Urlaub schon storniert ist, bucht beim Stornieren nichts mehr', async () => {
    const { antrag, urlaub } = await genehmigterUrlaub();
    // Ein zweiter, unberührter Urlaub hält das Konto über null — sonst sähe man nichts.
    await genehmigterUrlaub('2029-08-06', '2029-08-10');
    expect(await genommen()).toBe('15.000');
    const e = await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)));
    await als(chef, (k) => storniereAbwesenheit(k, urlaub, 'Urlaub ganz zurückgenommen'));
    expect(await genommen()).toBe('5.000');
    await als(chef, (k) => storniereAbwesenheit(k, e.krankheitId, 'falsch erfasst'));
    expect(await genommen()).toBe('5.000');
  });

  it('die Arbeitnehmerin zieht ihre eigene Krankmeldung zurück — die Tage gehen wieder ab', async () => {
    const { antrag } = await genehmigterUrlaub();
    const e = await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)));
    await als(jonasKonto, (k) => k.schreibe(
      `update abwesenheit set status = 'storniert', storniert_von = $2::uuid
        where id = $1::uuid`, [e.krankheitId, jonasKonto]), 'mitarbeiter', f.jonas);
    expect(await genommen()).toBe('10.000');
  });
});

describe('(3) abgewiesen mit Grund — und das Konto bleibt', () => {
  it('ohne Bescheinigung, außerhalb, nur Wochenende, schon erfasst', async () => {
    const { antrag } = await genehmigterUrlaub();
    expect(await grund(als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag, { auVorliegt: false })))))
      .toBe('au_fehlt');
    expect(await grund(als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag, {
      von: '2029-07-23', bis: '2029-07-24' })))))
      .toBe('ausserhalb');
    expect(await grund(als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag, {
      von: '2029-07-14', bis: '2029-07-15' })))))
      .toBe('keine_arbeitstage');
    expect(await grund(als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag, {
      auBis: '2029-07-01' })))))
      .toBe('au_bis_vor_von');
    expect(await genommen()).toBe('10.000');

    await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)));
    expect(await grund(als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag, {
      von: '2029-07-13', bis: '2029-07-16' })))))
      .toBe('schon_erfasst');
    expect(await genommen()).toBe('7.000');
  });

  it('ohne genehmigten Urlaub und ohne offenes Konto des Urlaubsjahres', async () => {
    const zurueck = await genehmigterUrlaub();
    await als(chef, (k) => storniereAbwesenheit(k, zurueck.urlaub, 'zurückgenommen'));
    expect(await grund(als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(zurueck.antrag)))))
      .toBe('nicht_genehmigt');

    // Ein abgeschlossenes Jahr bleibt abgeschlossen — die Gutschrift ändert es nicht (O-18).
    const { antrag, urlaub } = await genehmigterUrlaub();
    await sql.unsafe(
      `update urlaubskonto set abgeschlossen_am = now()
        where anstellung_id = $1 and jahr = 2029`, [f.jonasReinigung]);
    expect(await grund(als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)))))
      .toBe('konto_fehlt');
    expect(await genommen()).toBe('10.000');
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from abwesenheit
        where unterbrochener_urlaub_id in ($1, $2)`, [urlaub, zurueck.urlaub]);
    expect(n!.n).toBe(0);
  });
});

describe('(4) die Schranken', () => {
  it('ohne beide Rechte nicht — auch nicht an der Funktion vorbei', async () => {
    const { antrag, urlaub } = await genehmigterUrlaub();
    const [art] = await sql.unsafe<{ id: string }[]>(
      `select id from abwesenheitsart where schluessel = 'krankheit' and mandant_id is null`);
    // mitarbeiter: meldet, genehmigt nicht.
    const e = await als(jonasKonto, (k) => k.schreibe(
      `select app.krankheit_im_urlaub_erfassen($1::uuid, $2::uuid, '2029-07-11', '2029-07-13',
                                               null, null, 3, 3)`, [urlaub, art!.id]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(e?.code).toBe('42501');
    // Auch über den Dienst nicht — sie sieht ihren Antrag, schreibt sich aber nichts gut.
    expect(await grund(als(jonasKonto, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)),
      'mitarbeiter', f.jonas)))
      .toBe('kein_recht');
    expect(await genommen()).toBe('10.000');
  });

  it('kein direkter Weg für cse_app — und die Decke hält auch die Funktion', async () => {
    const { urlaub } = await genehmigterUrlaub();
    const [art] = await sql.unsafe<{ id: string }[]>(
      `select id from abwesenheitsart where schluessel = 'krankheit' and mandant_id is null`);
    const direkt = await als(chef, (k) => k.schreibe(
      `insert into abwesenheit (mandant_id, anstellung_id, abwesenheitsart_id, von, bis,
                                tage_angerechnet, status, au_bescheinigung_vorliegt,
                                unterbrochener_urlaub_id, urlaub_gutgeschrieben_tage)
       values ($1, $2, $3, '2029-07-11', '2029-07-13', 3, 'erfasst', true, $4, 3)`,
      [f.reinigung, f.jonasReinigung, art!.id, urlaub]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(direkt?.code).toBe('42501');

    // Mehr Tage, als Kalendertage im Urlaub krank: die Decke.
    const zuViel = await als(chef, (k) => k.schreibe(
      `select app.krankheit_im_urlaub_erfassen($1::uuid, $2::uuid, '2029-07-11', '2029-07-13',
                                               null, null, 3, 4)`, [urlaub, art!.id]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(zuViel?.code).toBe('23514');
    // Eine Art, die den Urlaub nicht unterbricht („Kind krank").
    const [kind] = await sql.unsafe<{ id: string }[]>(
      `select id from abwesenheitsart where schluessel = 'kind_krank' and mandant_id is null`);
    const kindKrank = await als(chef, (k) => k.schreibe(
      `select app.krankheit_im_urlaub_erfassen($1::uuid, $2::uuid, '2029-07-11', '2029-07-13',
                                               null, null, 3, 3)`, [urlaub, kind!.id]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(kindKrank?.code).toBe('23514');
    expect(await genommen()).toBe('10.000');
  });

  it('Verweis und Tage bleiben; der Urlaub mit geltender Gutschrift behält Zeitraum und Tage', async () => {
    const { antrag, urlaub } = await genehmigterUrlaub();
    const e = await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)));
    const tageAendern = await sql.unsafe(
      `update abwesenheit set urlaub_gutgeschrieben_tage = 5 where id = $1`, [e.krankheitId])
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(tageAendern?.code).toBe('23514');
    const zeitraum = await sql.unsafe(
      `update abwesenheit set bis = '2029-07-12' where id = $1`, [e.krankheitId])
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(zeitraum?.code).toBe('23514');
    const urlaubKuerzen = await als(chef, (k) => k.schreibe(
      `update abwesenheit set bis = '2029-07-13', tage_angerechnet = 5 where id = $1::uuid`, [urlaub]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(urlaubKuerzen?.code).toBe('23514');
    expect(await genommen()).toBe('7.000');
  });

  it('cse_app liest die zwei Spalten nicht (Art. 9 DSGVO)', async () => {
    const { antrag } = await genehmigterUrlaub();
    await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)));
    for (const spalte of ['unterbrochener_urlaub_id', 'urlaub_gutgeschrieben_tage']) {
      const e = await als(chef, (k) => k.abfrage(`select ${spalte} from abwesenheit`))
        .then(() => null, (x: unknown) => x as { code?: string });
      expect(e?.code, spalte).toBe('42501');
    }
  });
});

describe('(5) der Lohnexport sagt die Gutschrift mit', () => {
  it('an der Krankheit ihre Tage, am Urlaub die Summe', async () => {
    const { antrag, urlaub } = await genehmigterUrlaub();
    const e = await als(chef, (k) => erfasseKrankheitImUrlaub(k, krank(antrag)));
    const zeilen = await als(personal, (k) => k.abfrage<{ id: string; gut: string | null }>(
      `select id::text, gutgeschrieben_tage::text as gut
         from app.lohnexport_abwesenheiten('2029-07-01', '2029-07-31')`));
    expect(new Map(zeilen.map((z) => [z.id, z.gut]))).toEqual(new Map([
      [urlaub, '3.000'], [e.krankheitId, '3.000'],
    ]));
  });
});
