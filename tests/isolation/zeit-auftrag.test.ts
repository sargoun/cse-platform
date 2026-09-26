/**
 * PR 36 gegen die echte Datenbank — die fuenf Abnahmekriterien, jedes als
 * eigener Fall und jedes so gebaut, dass es OHNE die Umsetzung fehlschlaegt.
 *
 * Drei davon entscheiden diesen PR, und sie sind hier die ausfuehrlichsten:
 * die Monatsgrenze ueber eine DST-Nacht, der Mandantenriegel zwischen
 * Beschaeftigung und Auftrag, und das Artefakt eines gesperrten Monats. Alle
 * drei sind Fehler, die in Produktion NICHT auffallen — sie erzeugen
 * plausible Zahlen, keine Ausnahmen.
 *
 * Der Test legt seine Stammdaten selbst an (Kunde, Objekt, Auftrag,
 * Leistungszeile, Einsatz, Zuordnung), weil der Seed sie in dieser Form nicht
 * kennt.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { listeMitAuftrag, listeOhneAuftrag } from '../../src/server/services/zeit/auftrag.js';
import { leseMonatsanteile } from '../../src/server/services/zeit/monatsanteil.js';
import {
  leseNachweis, praegeNachweis, summeDerEintraege,
} from '../../src/server/services/zeit/milog.js';
import {
  entscheideEinwand, leseEinwand, listeOffeneEinwaende, reicheEinwandEin,
} from '../../src/server/services/zeit/einwand.js';
import { korrigiereZeiteintrag } from '../../src/server/services/zeit/korrektur.js';
import { splitteNachMonat } from '../../src/server/services/zeit/dauer.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Die Zeitpunkte, an denen sich dieser PR entscheidet. */
const OKT_NOV = { von: '2026-10-31T21:00:00Z', bis: '2026-11-01T05:00:00Z' } as const;
const MRZ_APR = { von: '2026-03-31T20:00:00Z', bis: '2026-04-01T04:00:00Z' } as const;

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly objekt: string;
  readonly auftrag: string;
  readonly leistung: string;
  readonly planer: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string, personId: string | null = null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)]);
}

/** Kunde, Objekt, Auftrag und eine Leistungszeile — die FIN-07-Kette. */
async function baueAuftrag(mandant: string): Promise<Aufbau> {
  const planer = await konto(`planung-${zufall()}@cse.test`);
  await mitglied(planer, mandant, 'leitung');

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Testkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Buerohaus Nord','Teststr. 3','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'rahmenvertrag','aktiv','Unterhaltsreinigung',$5,'2026-01-01')
     returning id`,
    [mandant, `AU-${zufall()}`, k!.id, o!.id, planer] as never[]);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                   bezeichnung, menge, einheit, einzelpreis_cent,
                                   steuersatz_bp, gueltig_ab)
     values ($1,$2,1,$3,'Unterhaltsreinigung',1,'Monat',189000,1900,'2026-01-01')
     returning id`,
    [mandant, a!.id, o!.id] as never[]);

  return {
    mandant, kunde: k!.id, objekt: o!.id, auftrag: a!.id, leistung: l!.id, planer,
  };
}

/**
 * Eine Schicht mit ihrer Einteilung. Die Wanduhrspalten werden AUS den
 * Zeitpunkten abgeleitet und nicht danebengetippt — sonst behauptet die
 * Fixtur eine Schicht, die es so nicht gibt.
 */
async function baueEinsatz(
  bau: Aufbau, von: string, bis: string, mitLeistung = true,
): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                          endet_am_folgetag, objekt_id, kunde_id,
                          auftrag_id, auftrag_leistung_id, erstellt_von_art)
     values ($1,'manuell',$2, (($3::timestamptz) at time zone 'Europe/Berlin')::date,
             $3::timestamptz, $4::timestamptz,
             (($3::timestamptz) at time zone 'Europe/Berlin')::time,
             (($4::timestamptz) at time zone 'Europe/Berlin')::time,
             (($4::timestamptz) at time zone 'Europe/Berlin')::date
               > (($3::timestamptz) at time zone 'Europe/Berlin')::date,
             $5, $6, $7::uuid, $8::uuid, 'system')
     returning id`,
    [
      bau.mandant, `manuell:${zufall()}${zufall()}`, von, bis, bau.objekt, bau.kunde,
      mitLeistung ? bau.auftrag : null, mitLeistung ? bau.leistung : null,
    ] as never[]);
  return e!.id;
}

/**
 * Ein abgeschlossener Zeiteintrag mit historischen Zeitpunkten.
 *
 * `quelle_* = 'import'` und nicht `'server_uhr'`: `kern.stempel_feldzeit()`
 * ersetzt bei `server_uhr` den mitgeschickten Wert durch `now()` — voellig zu
 * Recht (Invariante 5), aber dann liesse sich kein Fall der Zeitumstellung
 * pruefen. Der Import ist die dritte erlaubte Quelle und genau dafuer da.
 */
async function baueZeiteintrag(opts: {
  mandant: string; anstellung: string; person: string;
  von: string; bis: string; einsatz?: string | null; pause?: number;
  leistung?: string | null;
}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, einsatz_id, auftrag_leistung_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art)
     values ($1,$2,$3,$4::uuid,$5::uuid,$6::timestamptz,$7::timestamptz,$8,
             'import','import','import','import','abgeschlossen','system')
     returning id`,
    [
      opts.mandant, opts.anstellung, opts.person, opts.einsatz ?? null,
      opts.leistung ?? null, opts.von, opts.bis, opts.pause ?? 0,
    ] as never[]);
  return z!.id;
}

/** Der Kontext, den ein Dienst erwartet — auf der Transaktion der Sitzung. */
function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
  portal: 'intern' | 'mitarbeiter' = 'intern',
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal, benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage, schreibe: abfrage,
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

// ---------------------------------------------------------------------------

describe('(1) jeder Zeiteintrag löst auf genau einen Auftrag auf — oder wird gemeldet', () => {
  it('die Leistungszeile wird von der Schicht GEERBT, nicht übertragen', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const einsatz = await baueEinsatz(bau, OKT_NOV.von, OKT_NOV.bis);
    // Ausdruecklich OHNE `auftrag_leistung_id`: das ist der Punkt von TIM-12.
    const id = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-10-12T05:00:00Z', bis: '2026-10-12T09:00:00Z', einsatz,
    });

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => listeMitAuftrag(kontextAus(tx, f.reinigung, bau.planer)),
    );
    const treffer = zeilen.filter((z) => z.zeiteintragId === id);
    // GENAU einer — nicht „mindestens einer": ein doppelter Join haette hier
    // zwei Zeilen und damit eine doppelt abgerechnete Stunde.
    expect(treffer).toHaveLength(1);
    expect(treffer[0]?.auftragId).toBe(bau.auftrag);
    expect(treffer[0]?.auftragLeistungId).toBe(bau.leistung);
  });

  it('ein Eintrag ohne Auftrag wird GEMELDET, nicht verschwiegen', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const ohne = await baueEinsatz(bau, '2026-10-13T05:00:00Z', '2026-10-13T09:00:00Z', false);
    const mitEinsatz = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-10-13T05:00:00Z', bis: '2026-10-13T09:00:00Z', einsatz: ohne,
    });
    const ungeplant = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-10-14T05:00:00Z', bis: '2026-10-14T09:00:00Z',
    });

    const { berichtet, aufgeloest } = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => {
        const k = kontextAus(tx, f.reinigung, bau.planer);
        return { berichtet: await listeOhneAuftrag(k), aufgeloest: await listeMitAuftrag(k) };
      },
    );

    const ursachen = new Map(berichtet.map((b) => [b.zeiteintragId, b.ursache]));
    expect(ursachen.get(mitEinsatz)).toBe('einsatz_ohne_leistung');
    expect(ursachen.get(ungeplant)).toBe('ohne_einsatz');
    // Und keiner der beiden ist im aufgeloesten Strom gelandet: sonst waere
    // „genau ein Auftrag" durch eine Zeile ohne Auftrag erkauft.
    expect(aufgeloest.map((a) => a.zeiteintragId)).not.toContain(mitEinsatz);
    expect(aufgeloest.map((a) => a.zeiteintragId)).not.toContain(ungeplant);
  });

  it('kein Eintrag fällt zwischen die beiden Listen', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const einsatz = await baueEinsatz(bau, '2026-10-15T05:00:00Z', '2026-10-15T09:00:00Z');
    await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-10-15T05:00:00Z', bis: '2026-10-15T09:00:00Z', einsatz,
    });
    await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      von: '2026-10-16T05:00:00Z', bis: '2026-10-16T09:00:00Z',
    });

    const [zahlen] = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => tx.unsafe<{ eintraege: string; mit: string; ohne: string }[]>(
        `select (select count(*)::text from zeiteintrag
                  where storniert_am is null and ersetzt_am is null) as eintraege,
                (select count(*)::text from zeiteintrag_auftrag)     as mit,
                (select count(*)::text from zeiteintrag_ohne_auftrag) as ohne`),
    );
    // Die Zerlegung ist vollstaendig und ueberschneidungsfrei. Ohne diese
    // Zusage koennte ein Eintrag in KEINER der beiden Listen stehen — und
    // genau der waere der, den niemand abrechnet.
    expect(Number(zahlen!.mit) + Number(zahlen!.ohne)).toBe(Number(zahlen!.eintraege));
  });
});

// ---------------------------------------------------------------------------

describe('(2) die Monatsgrenze ist eine Berliner Mitternacht', () => {
  for (const fall of [
    { name: '31.10. → 01.11. (nach der Rückstellung, Grenze 23:00Z)', ...OKT_NOV,
      grenze: '2026-10-31T23:00:00.000Z', monate: ['2026-10-01', '2026-11-01'] },
    { name: '31.03. → 01.04. (nach der Vorstellung, Grenze 22:00Z)', ...MRZ_APR,
      grenze: '2026-03-31T22:00:00.000Z', monate: ['2026-03-01', '2026-04-01'] },
  ]) {
    it(`${fall.name} teilt 120/360 und ergibt zusammen 480`, async () => {
      const bau = await baueAuftrag(f.reinigung);
      const einsatz = await baueEinsatz(bau, fall.von, fall.bis);
      const id = await baueZeiteintrag({
        mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
        von: fall.von, bis: fall.bis, einsatz, pause: 30,
      });

      const anteile = await alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
        async (tx) => leseMonatsanteile(kontextAus(tx, f.reinigung, bau.planer)),
      );
      const meine = anteile.filter((a) => a.zeiteintragId === id);

      expect(meine.map((a) => a.monat)).toEqual(fall.monate);
      expect(meine.map((a) => a.bruttoMinuten)).toEqual([120, 360]);
      // Der Teilungspunkt selbst — nicht nur die Minutenzahl. Bei UTC-Teilung
      // stuende hier 00:00Z und die Zahlen waeren 180/300.
      expect(meine[0]?.anteilEnde.toISOString()).toBe(fall.grenze);
      expect(meine[1]?.anteilBeginn.toISOString()).toBe(fall.grenze);

      const [z] = await sql.unsafe<{ brutto: number }[]>(
        `select dauer_brutto_minuten as brutto from zeiteintrag where id = $1`, [id]);
      expect(meine.reduce((s, a) => s + a.bruttoMinuten, 0)).toBe(Number(z!.brutto));
    });
  }

  it('die Sicht und `splitteNachMonat` sagen dasselbe — zwei Umsetzungen, eine Regel', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const einsatz = await baueEinsatz(bau, OKT_NOV.von, OKT_NOV.bis);
    const id = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: OKT_NOV.von, bis: OKT_NOV.bis, einsatz,
    });
    const anteile = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => leseMonatsanteile(kontextAus(tx, f.reinigung, bau.planer)),
    );
    const meine = anteile.filter((a) => a.zeiteintragId === id);
    const gerechnet = splitteNachMonat(new Date(OKT_NOV.von), new Date(OKT_NOV.bis));
    expect(meine.map((a) => a.bruttoMinuten)).toEqual(gerechnet.map((g) => g.minuten));
  });

  it('die Rückstellungsnacht bleibt 540 Minuten und EIN Monat (K-11)', async () => {
    const bau = await baueAuftrag(f.reinigung);
    // K-11 woertlich: 24.10. 22:00 → 25.10. 06:00 Berlin sind 540 Minuten.
    const einsatz = await baueEinsatz(bau, '2026-10-24T20:00:00Z', '2026-10-25T05:00:00Z');
    const id = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-10-24T20:00:00Z', bis: '2026-10-25T05:00:00Z', einsatz,
    });
    const anteile = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => leseMonatsanteile(kontextAus(tx, f.reinigung, bau.planer)),
    );
    const meine = anteile.filter((a) => a.zeiteintragId === id);
    expect(meine).toHaveLength(1);
    expect(meine[0]?.bruttoMinuten).toBe(540);
  });
});

// ---------------------------------------------------------------------------

describe('(3) Beschäftigung und Auftrag gehören derselben Gesellschaft (D-09.5)', () => {
  it('eine fremde Beschäftigung lässt sich nicht buchen', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const einsatz = await baueEinsatz(bau, '2026-10-17T05:00:00Z', '2026-10-17T09:00:00Z');
    // Fatimas SECURITY-Beschaeftigung auf einer Schicht der REINIGUNG.
    await expect(baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaSecurity, person: f.fatima,
      von: '2026-10-17T05:00:00Z', bis: '2026-10-17T09:00:00Z', einsatz,
    })).rejects.toThrow(/z_anstellung_fk|foreign key/iu);
  });

  it('und eine fremde Leistungszeile ebenso wenig', async () => {
    await baueAuftrag(f.reinigung);
    const fremd = await baueAuftrag(f.security);
    // Der Riegel ist der zusammengesetzte Schluessel `z_leistung_fk` (0050):
    // (mandant_id, auftrag_leistung_id). Einspaltig gebaut liesse er genau
    // diese Zeile durch — und RLS faende daran nichts auszusetzen, weil beide
    // Seiten fuer sich stimmig sind.
    await expect(baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-10-18T05:00:00Z', bis: '2026-10-18T09:00:00Z', leistung: fremd.leistung,
    })).rejects.toThrow(/z_leistung_fk|foreign key/iu);
  });

  it('auch keine Schicht auf der Leistungszeile eines fremden Auftrags', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const zweiter = await baueAuftrag(f.reinigung);
    // Beide Auftraege in derselben Gesellschaft — nur eben verschiedene
    // Auftraege. Der ENKEL-Schluessel (mandant, auftrag, leistung) faengt das;
    // ein Schluessel auf (mandant, leistung) allein taete es nicht, und die
    // Rechnung ginge an den falschen Kunden.
    await expect(sql.unsafe(
      `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                            objekt_id, kunde_id, auftrag_id, auftrag_leistung_id,
                            erstellt_von_art)
       values ($1,'manuell',$2,'2026-10-19','2026-10-19T05:00:00Z','2026-10-19T09:00:00Z',
               '07:00','11:00',$3,$4,$5,$6,'system')`,
      [bau.mandant, `manuell:${zufall()}`, bau.objekt, bau.kunde,
        bau.auftrag, zweiter.leistung] as never[],
    )).rejects.toThrow(/einsatz_leistung_fk|foreign key/iu);
  });
});

// ---------------------------------------------------------------------------

describe('(4) ein Mitarbeitender ändert keinen Zeiteintrag — unter keiner Rollenkonfiguration', () => {
  it('auch mit `zeit.schreiben` an der Rolle bleibt das UPDATE wirkungslos', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const einsatz = await baueEinsatz(bau, '2026-10-20T05:00:00Z', '2026-10-20T09:00:00Z');
    const id = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-10-20T05:00:00Z', bis: '2026-10-20T09:00:00Z', einsatz, pause: 30,
    });
    const kraft = await konto(`kraft-${zufall()}@cse.test`, f.fatima);
    await mitglied(kraft, f.reinigung, 'mitarbeiter');

    /**
     * Der Fall, den die Abnahme meint: jemand bindet der Mitarbeiterrolle
     * `zeit.lesen` UND `zeit.schreiben`. Ohne die restriktive Policy waere
     * `t_mandant` damit ein Schreibweg auf die eigenen Zeilen.
     */
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select r.id, b.id, null, true
         from rolle r, berechtigung b
        where r.schluessel = 'mitarbeiter' and r.mandant_id is null
          and b.schluessel in ('zeit.lesen','zeit.schreiben')
       on conflict do nothing`);

    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: kraft,
      personId: f.fatima, portal: 'mitarbeiter' as const, readonly: false,
    };
    // Zuerst: das Recht ist wirklich da. Ohne diese Zusage prueft der Fall
    // darunter nur, dass ein Recht fehlt — also gar nichts.
    const [recht] = await alsApp(sitzung, async (tx) =>
      tx.unsafe<{ hat: boolean }[]>(
        `select app.hat_recht('zeit.schreiben', app.aktiver_mandant()) as hat`));
    expect(recht!.hat).toBe(true);

    const betroffen = await alsApp(sitzung, async (tx) =>
      tx.unsafe(`update zeiteintrag set notiz = 'von der Kraft' where id = $1 returning id`,
        [id]));
    expect(betroffen).toHaveLength(0);

    // Und nichts hat sich bewegt — auch nicht die Pause.
    const [danach] = await sql.unsafe<{ notiz: string | null; pause: number }[]>(
      `select notiz, pause_minuten as pause from zeiteintrag where id = $1`, [id]);
    expect(danach!.notiz).toBeNull();
    expect(Number(danach!.pause)).toBe(30);
  });

  /*
   * Die Einwandfälle liegen im SEPTEMBER, nicht im Oktober wie der Rest der
   * Datei: ein Einwand behauptet geleistete Arbeit, und seit V-193 weist der
   * Dienst einen Tag nach heute und eine Zeit nach jetzt ab (Uhr der
   * Datenbank). Ein Zeiteintrag in der Zukunft entsteht im Betrieb nicht.
   */
  it('was sie hat, ist der Einwand — und er erreicht die Planung', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const einsatz = await baueEinsatz(bau, '2026-09-21T05:00:00Z', '2026-09-21T09:00:00Z');
    const id = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-09-21T05:00:00Z', bis: '2026-09-21T09:00:00Z', einsatz,
    });
    const kraft = await konto(`kraft-${zufall()}@cse.test`, f.fatima);
    await mitglied(kraft, f.reinigung, 'mitarbeiter');

    const einwandId = await alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: kraft,
        personId: f.fatima, portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => reicheEinwandEin(
        kontextAus(tx, f.reinigung, kraft, 'mitarbeiter'),
        {
          anstellungId: f.fatimaReinigung, zeiteintragId: id, art: 'zeit_falsch',
          betrifftDatum: '2026-09-21',
          behauptetEnde: new Date('2026-09-21T10:00:00Z'),
          begruendung: 'Ich habe bis 12 Uhr gearbeitet.',
          eingereichtVonBenutzerId: kraft,
        },
      ),
    );
    expect(einwandId).toMatch(/^[0-9a-f-]{36}$/u);

    // Der Zeiteintrag ist unveraendert — das ist der ganze Punkt.
    const [z] = await sql.unsafe<{ ende: Date }[]>(
      `select ende_zeitpunkt as ende from zeiteintrag where id = $1`, [id]);
    expect(z!.ende.toISOString()).toBe('2026-09-21T09:00:00.000Z');

    // Und er liegt im Eingang der Planung.
    const eingang = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => listeOffeneEinwaende(kontextAus(tx, f.reinigung, bau.planer)),
    );
    expect(eingang.map((e) => e.id)).toContain(einwandId);
  });

  it('für eine fremde Beschäftigung kann sie keinen Einwand schreiben', async () => {
    await baueAuftrag(f.reinigung);
    const kraft = await konto(`kraft-${zufall()}@cse.test`, f.fatima);
    await mitglied(kraft, f.reinigung, 'mitarbeiter');
    await expect(alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: kraft,
        personId: f.fatima, portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => reicheEinwandEin(
        kontextAus(tx, f.reinigung, kraft, 'mitarbeiter'),
        {
          // Jonas' Beschaeftigung, dieselbe Gesellschaft.
          anstellungId: f.jonasReinigung, art: 'eintrag_fehlt',
          betrifftDatum: '2026-09-21', begruendung: 'Für einen Kollegen.',
          eingereichtVonBenutzerId: kraft,
        },
      ),
    )).rejects.toThrow(/row-level security|policy/iu);
  });

  it('über den eigenen Einwand entscheidet sie nicht', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const kraft = await konto(`kraft-${zufall()}@cse.test`, f.fatima);
    await mitglied(kraft, f.reinigung, 'mitarbeiter');
    const einwandId = await alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: kraft,
        personId: f.fatima, portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => reicheEinwandEin(
        kontextAus(tx, f.reinigung, kraft, 'mitarbeiter'),
        {
          anstellungId: f.fatimaReinigung, art: 'eintrag_fehlt',
          betrifftDatum: '2026-09-22', begruendung: 'Ich war da.',
          eingereichtVonBenutzerId: kraft,
        },
      ),
    );

    // Dasselbe Konto bekommt zusaetzlich das Entscheidungsrecht — und scheitert
    // trotzdem: der Riegel haengt an der PERSON, nicht am Recht.
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select r.id, b.id, null, true
         from rolle r, berechtigung b
        where r.schluessel = 'mitarbeiter' and r.mandant_id is null
          and b.schluessel in ('zeit.lesen','zeit.einwand_entscheiden')
       on conflict do nothing`);
    await expect(alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: kraft,
        personId: f.fatima, portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => entscheideEinwand(kontextAus(tx, f.reinigung, kraft, 'mitarbeiter'), {
        einwandId, status: 'abgelehnt',
        begruendung: 'Doch nicht so wichtig.', entschiedenVon: kraft,
      }),
    )).rejects.toThrow(/eigenen Einwand/iu);

    // Die Planung darf es.
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => entscheideEinwand(kontextAus(tx, f.reinigung, bau.planer), {
        einwandId, status: 'anerkannt',
        begruendung: 'Schicht war belegt, Nachtrag folgt.', entschiedenVon: bau.planer,
      }),
    );
    const [nachher] = await sql.unsafe<{ status: string; am: Date | null }[]>(
      `select status::text as status, entschieden_am as am from zeit_einwand where id = $1`,
      [einwandId]);
    expect(nachher!.status).toBe('anerkannt');
    expect(nachher!.am).not.toBeNull();
  });

  /**
   * **Die Korrektur weiss, welche Meldung sie beantwortet** (TIM-11).
   *
   * `zeiteintrag_korrektur.zeit_einwand_id` gibt es seit der Anlage der
   * Tabelle, mit eigenem Fremdschluessel `zk_einwand_fk`. Gelesen wurde sie
   * (`leseEinwand` haengt daran den Abschnitt „Ist eine Korrektur gefolgt?"),
   * geschrieben hat sie niemand: `korrigiereZeiteintrag` fuehrte die Spalte
   * nicht in seinem `insert`. Die Folge war ein Einwandblatt, das IMMER
   * „anerkannt, aber keine Korrektur" sagte — auch fuer die Korrektur, die
   * genau diese Meldung beantwortet.
   *
   * Der Fall geht den Weg zu Ende und prueft danach BEIDE Richtungen: die
   * Spalte, und was das Blatt daraus liest.
   */
  it('die anerkannte Meldung findet ihre Korrektur wieder', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const kraft = await konto(`kraft-${zufall()}@cse.test`, f.fatima);
    await mitglied(kraft, f.reinigung, 'mitarbeiter');
    const eintrag = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-09-22T05:00:00Z', bis: '2026-09-22T13:00:00Z', pause: 30,
    });

    const einwandId = await alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: kraft,
        personId: f.fatima, portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => reicheEinwandEin(
        kontextAus(tx, f.reinigung, kraft, 'mitarbeiter'),
        {
          anstellungId: f.fatimaReinigung, zeiteintragId: eintrag, art: 'zeit_falsch',
          betrifftDatum: '2026-09-22',
          begruendung: 'Ich habe eine halbe Stunde vor dem Stempeln angefangen.',
          eingereichtVonBenutzerId: kraft,
        },
      ),
    );

    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => entscheideEinwand(kontextAus(tx, f.reinigung, bau.planer), {
        einwandId, status: 'anerkannt',
        begruendung: 'Die Objektleitung bestaetigt den fruehen Beginn.',
        entschiedenVon: bau.planer,
      }),
    );

    const erg = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => korrigiereZeiteintrag(kontextAus(tx, f.reinigung, bau.planer), {
        zeiteintragId: eintrag, art: 'zeit_korrektur',
        grundKategorie: 'einwand_mitarbeiter',
        begruendung: 'Beginn um 30 Minuten vorverlegt, wie gemeldet und bestaetigt.',
        durchgefuehrtVon: bau.planer,
        zeitEinwandId: einwandId,
        beginnZeitpunkt: new Date('2026-09-22T04:30:00Z'),
        behauptetBeginn: new Date('2026-09-22T04:30:00Z'),
      }),
    );

    // Die Spalte selbst — nachgesehen und nicht aus dem Rueckgabewert geschlossen.
    const [k] = await sql.unsafe<{ einwand: string | null }[]>(
      `select zeit_einwand_id as einwand from zeiteintrag_korrektur where id = $1`,
      [erg.korrekturId] as never[]);
    expect(k!.einwand).toBe(einwandId);

    // Und was das Blatt daraus liest: eine Korrektur, nicht „keine".
    const blatt = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => leseEinwand(kontextAus(tx, f.reinigung, bau.planer), einwandId),
    );
    expect(blatt?.status).toBe('anerkannt');
    expect(blatt?.korrektur?.id).toBe(erg.korrekturId);
    expect(blatt?.korrektur?.art).toBe('zeit_korrektur');
    expect(blatt?.korrektur?.ersatzZeiteintragId).toBe(erg.neueFassungId);
  });

  /**
   * Die Gegenprobe: eine Kennung, die es in diesem Mandanten nicht gibt,
   * scheitert am Fremdschluessel — sie wird nicht still als `null`
   * geschrieben. Ein stilles Fallenlassen waere dieselbe Luecke noch einmal.
   */
  it('eine erfundene Meldung wird abgewiesen, nicht stillschweigend weggelassen', async () => {
    const bau = await baueAuftrag(f.reinigung);
    const eintrag = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-10-23T05:00:00Z', bis: '2026-10-23T13:00:00Z', pause: 30,
    });
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => korrigiereZeiteintrag(kontextAus(tx, f.reinigung, bau.planer), {
        zeiteintragId: eintrag, art: 'pause_korrektur',
        grundKategorie: 'sonstiges', begruendung: 'Probe.',
        durchgefuehrtVon: bau.planer,
        zeitEinwandId: '00000000-0000-4000-8000-000000000000',
        pauseMinuten: 45,
      }),
    )).rejects.toMatchObject({ code: '23503' });
  });
});

// ---------------------------------------------------------------------------

describe('(5) die § 17-MiLoG-Aufzeichnung', () => {
  async function monatAufbauen(): Promise<{ bau: Aufbau; ids: readonly string[] }> {
    const bau = await baueAuftrag(f.reinigung);
    const ids: string[] = [];
    for (const [von, bis] of [
      ['2026-10-05T05:00:00Z', '2026-10-05T13:00:00Z'],
      ['2026-10-06T05:00:00Z', '2026-10-06T13:00:00Z'],
      [OKT_NOV.von, OKT_NOV.bis],
    ]) {
      const einsatz = await baueEinsatz(bau, von!, bis!);
      ids.push(await baueZeiteintrag({
        mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
        von: von!, bis: bis!, einsatz, pause: 30,
      }));
    }
    return { bau, ids };
  }

  it('nennt Beginn, Ende und Dauer je Zeile — und die WAHREN Zeitpunkte', async () => {
    const { bau } = await monatAufbauen();
    const nachweis = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => leseNachweis(kontextAus(tx, f.reinigung, bau.planer),
        { anstellungId: f.fatimaReinigung, monat: '2026-10-01' }),
    );
    expect(nachweis.zeilen).toHaveLength(3);
    for (const z of nachweis.zeilen) {
      expect(z.beginn).toMatch(/^2026-/u);
      expect(z.ende).toMatch(/^2026-/u);
      expect(z.bruttoMinuten).toBeGreaterThan(0);
    }
    // Die Nachtschicht steht mit ihrem WAHREN Ende da (01.11. 05:00Z), nicht
    // mit der Monatsgrenze. Wer hier die Grenze ausgibt, legt der Aufsicht
    // eine Aufzeichnung vor, die um Mitternacht Feierabend behauptet.
    const grenzfall = nachweis.zeilen.find((z) => z.beginn === '2026-10-31T21:00:00.000Z');
    expect(grenzfall?.ende).toBe('2026-11-01T05:00:00.000Z');
    expect(grenzfall?.bruttoMinuten).toBe(480);
    expect(grenzfall?.anteilBruttoMinuten).toBe(120);
    expect(nachweis.quelle).toBe('live');
  });

  it('die Summe stimmt auf die Minute mit den Einträgen überein', async () => {
    const { bau, ids } = await monatAufbauen();
    const { okt, nov, summe } = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => {
        const k = kontextAus(tx, f.reinigung, bau.planer);
        return {
          okt: await leseNachweis(k, { anstellungId: f.fatimaReinigung, monat: '2026-10-01' }),
          nov: await leseNachweis(k, { anstellungId: f.fatimaReinigung, monat: '2026-11-01' }),
          summe: await summeDerEintraege(k,
            { anstellungId: f.fatimaReinigung, monat: '2026-10-01' }),
        };
      },
    );

    const [eintraege] = await sql.unsafe<{ brutto: string; netto: string }[]>(
      `select sum(dauer_brutto_minuten)::text as brutto,
              sum(dauer_netto_minuten)::text  as netto
         from zeiteintrag where id = any($1::uuid[])`, [ids] as never[]);

    // Beide Monatsblaetter zusammen ergeben die Eintraege — exakt.
    expect(okt.summeBruttoMinuten + nov.summeBruttoMinuten).toBe(Number(eintraege!.brutto));
    expect(okt.summeNettoMinuten + nov.summeNettoMinuten).toBe(Number(eintraege!.netto));
    // 2 × 480 volle Tage + 120 Minuten Anteil der Nachtschicht.
    expect(okt.summeBruttoMinuten).toBe(1080);
    expect(summe.bruttoMinuten).toBe(1080);
  });

  it('DELETE auf der Aufzeichnung schlägt fehl', async () => {
    await monatAufbauen();
    // Die Sicht ist nicht loeschbar — und die Tabelle darunter traegt
    // `kern.verhindere_loeschung()`. Zwei Riegel, nicht einer.
    await expect(sql.unsafe(`delete from milog_aufzeichnung`)).rejects.toThrow();
    await expect(sql.unsafe(`delete from zeiteintrag`)).rejects.toThrow(/Hard delete/iu);
  });

  it('ein gesperrter Monat wird geprägt und danach byte-gleich wieder ausgegeben', async () => {
    const { bau, ids } = await monatAufbauen();

    // Die Sperre setzt in Produktion `z_monat_sperren` auf `stundenkonto`
    // (PR 37). Hier wird sie gesetzt, weil der Ausloeser noch fehlt — die
    // REGEL gilt trotzdem schon, und sie ist genau die, die still falsch wird.
    await sql.unsafe(
      `update zeiteintrag set gesperrt_am = now() where id = any($1::uuid[])`,
      [ids] as never[]);

    const gepraegt = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => praegeNachweis(kontextAus(tx, f.reinigung, bau.planer),
        { anstellungId: f.fatimaReinigung, monat: '2026-10-01' }),
    );
    expect(gepraegt.quelle).toBe('artefakt');
    expect(gepraegt.hash).toMatch(/^[0-9a-f]{64}$/u);

    /**
     * Und jetzt der Fall, um den es geht: eine Korrektur IM MAI an einem
     * Eintrag des gesperrten Oktobers. Sie praegt eine neue Fassung mit
     * Oktober-Zeitpunkten — die lebende Sicht saehe danach anders aus.
     */
    /**
     * PR 37 hat `stundenkonto_bewegung` gebaut und mit ihr den
     * Fremdschluessel, den 0036 §5 woertlich angekuendigt hatte. Die
     * Platzhalter-UUID, die hier stand, ist damit keine mehr: die Gegenbuchung
     * muss existieren. Sie entsteht hier von Hand, weil DIESER Test das
     * Artefakt prueft und nicht den Buchungsweg — der steht in
     * `stundenkonto.test.ts`.
     */
    const [ausgleichKonto] = await sql.unsafe<{ id: string }[]>(
      `insert into stundenkonto (mandant_id, anstellung_id, jahr, monat)
       values ($1, $2, 2027, 5) returning id`,
      [f.reinigung, f.fatimaReinigung]);
    const [ausgleich] = await sql.unsafe<{ id: string }[]>(
      `insert into stundenkonto_bewegung
         (mandant_id, stundenkonto_id, art, minuten, wirksam_am, quelle,
          begruendung, erstellt_von)
       values ($1, $2, 'korrektur', 60, '2027-05-01', 'manuell',
               'Ausgleich fuer den gesperrten Oktober', $3)
       returning id`,
      [f.reinigung, ausgleichKonto!.id, bau.planer]);

    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => korrigiereZeiteintrag(kontextAus(tx, f.reinigung, bau.planer), {
        zeiteintragId: ids[0]!, art: 'zeit_korrektur', grundKategorie: 'einwand_mitarbeiter',
        begruendung: 'Schicht ging eine Stunde länger.', durchgefuehrtVon: bau.planer,
        /**
         * Eine ZEIT-Korrektur, keine reine Pausenkorrektur: `nacherfasst`
         * verlangt nach `z_anspruch_je_ereignis` (0034) mindestens einen
         * behaupteten Zeitpunkt, und den setzt `korrigiereZeiteintrag` nur
         * fuer die Seite, die sich aendert. Eine Korrektur, die nur die Pause
         * berichtigt, laesst sich damit heute nicht aufschreiben — vermerkt
         * im Bericht zu diesem PR, nicht hier stillschweigend umgangen.
         */
        endeZeitpunkt: new Date('2026-10-05T14:00:00Z'),
        // Die Gegenbuchung im ersten offenen Monat. `zk_sperre_ausgleich`
        // verlangt den Verweis, damit keine Korrektur an einem gesperrten
        // Monat ohne Ausgleich entstehen kann — und seit PR 37 verlangt
        // `zk_ausgleich_fk` (0060) zusaetzlich, dass es die Buchung GIBT.
        ausgleichBewegungId: ausgleich!.id,
      }),
    );

    const danach = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer, portal: 'intern' },
      async (tx) => leseNachweis(kontextAus(tx, f.reinigung, bau.planer),
        { anstellungId: f.fatimaReinigung, monat: '2026-10-01' }),
    );

    // Byte-gleich: derselbe Digest, dieselben Zeilen, dieselbe Summe.
    expect(danach.quelle).toBe('artefakt');
    expect(danach.hash).toBe(gepraegt.hash);
    expect(danach.zeilen).toEqual(gepraegt.zeilen);
    expect(danach.summeNettoMinuten).toBe(gepraegt.summeNettoMinuten);

    // Die Korrektur ist trotzdem da — in der Spur, wo sie hingehoert.
    const [spur] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from zeiteintrag_korrektur
        where ursprung_zeiteintrag_id = $1`, [ids[0]!]);
    expect(Number(spur!.anzahl)).toBe(1);
  });

  it('ein offener Monat bekommt kein Artefakt', async () => {
    const { bau } = await monatAufbauen();
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => praegeNachweis(kontextAus(tx, f.reinigung, bau.planer),
        { anstellungId: f.fatimaReinigung, monat: '2026-10-01' }),
    )).rejects.toThrow(/nicht gesperrt/iu);
  });

  it('ein verändertes Artefakt fällt beim Lesen auf', async () => {
    const { bau, ids } = await monatAufbauen();
    await sql.unsafe(
      `update zeiteintrag set gesperrt_am = now() where id = any($1::uuid[])`,
      [ids] as never[]);
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: bau.planer,
        portal: 'intern', readonly: false },
      async (tx) => praegeNachweis(kontextAus(tx, f.reinigung, bau.planer),
        { anstellungId: f.fatimaReinigung, monat: '2026-10-01' }),
    );

    // Der Ausloeser weist jedes UPDATE ab — auch das des Eigentuemers. Das ist
    // der Unterschied zwischen „abgelegt" und „nachweisbar unveraendert".
    await expect(sql.unsafe(
      `update zeitnachweis set summe_netto_minuten = 1 where anstellung_id = $1`,
      [f.fatimaReinigung])).rejects.toThrow(/nicht geaendert/iu);
    await expect(sql.unsafe(
      `delete from zeitnachweis where anstellung_id = $1`,
      [f.fatimaReinigung])).rejects.toThrow(/Hard delete/iu);
  });
});
