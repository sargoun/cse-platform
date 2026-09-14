/**
 * Stapelfreigabe, Einspruchsfenster und Rücknahme gegen eine echte Datenbank
 * (APR-04, APR-05, APR-06, 0152).
 *
 *  1. **Der Stapel überspringt, er scheitert nicht.** Ein markierter oder
 *     unsicherer Vorgang fällt mit GRUND heraus; die übrigen gehen durch.
 *     Ein Stapel, der an der ersten Sonderzeile abbricht, erzieht dazu, den
 *     Stapel nicht zu benutzen.
 *  2. **Jede Zeile bekommt ihren eigenen Schnappschuss** (APR-07) — fünfzig
 *     Genehmigungen sind fünfzig Beweise, nicht einer.
 *  3. **Das Einspruchsfenster gibt es nur bei niedrigem Risiko** und nur für
 *     die Vorgangsarten, die 0136 zulässt. Bei allem darüber löst ein Mensch
 *     aus, nicht eine Uhr (Invariante 7).
 *  4. **Ein Einspruch nach Ablauf ist kein Einspruch**, und einer ohne Grund
 *     auch nicht.
 *  5. **Die Rücknahme nimmt die AUSFÜHRUNG zurück, nicht die Entscheidung** —
 *     der Schnappschuss bleibt, was er war.
 *  6. **`cse_app` kommt an den Definer-Funktionen nicht vorbei**: die Spalten
 *     stehen unter Schreibschutz, und ein fremder Mandant sieht die Freigabe
 *     ohnehin nicht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  STAPEL_HOECHSTZAHL, StapelFehler, FensterFehler,
  armiereRuecknahme, entscheideStapel, erhebeEinspruch, nimmZurueck,
} from '../../src/server/services/freigabe/stapel.js';
import { EINSPRUCH_MINUTEN, RUECKNAHME_MINUTEN }
  from '../../src/server/services/freigabe/fenster.platzhalter.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

const META = { ip: null, userAgent: null, codeVersion: 'test' } as const;

async function legeAdministrationAn(mandantId: string): Promise<string> {
  const email = `ff-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Freigeberin', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

/**
 * **Die vier bindbaren Freigaberechte an die Rolle binden** (O-367).
 *
 * `freigabe.stapel_entscheiden`, `freigabe.einspruch_erheben`,
 * `freigabe.rueckgaengig` und `freigabe.pruefdauer_lesen` sind im Katalog
 * BINDBAR, nicht gebunden: wer einzeln entscheiden darf, darf damit nicht
 * schon fünfzig auf einmal. Der Seed der Anwendung bindet sie ausdrücklich;
 * hier tut es dieser Helfer, und der Test weiter unten beweist die andere
 * Richtung — ohne Bindung geht nichts davon.
 */
async function bindeFreigabeRechte(rolle: string, mandantId: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select r.id, b.id, $2, true
       from rolle r, berechtigung b
      where r.schluessel = $1 and r.mandant_id is null
        and b.schluessel in ('freigabe.stapel_entscheiden', 'freigabe.einspruch_erheben',
                             'freigabe.rueckgaengig', 'freigabe.pruefdauer_lesen')
     on conflict (rolle_id, berechtigung_id, mandant_id) do nothing`, [rolle, mandantId]);
}

/** Ein Konto mit `leitung`-Rolle: entscheiden ja, stapeln nein (bis gebunden). */
async function legeLeitungAn(mandantId: string): Promise<string> {
  const email = `ff-leitung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

/** Ein Konto mit `mitarbeiter`-Rolle — es hält `freigabe.pruefdauer_lesen` nicht. */
async function legeBenutzerOhneRecht(mandantId: string): Promise<string> {
  const email = `ff-ohne-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Ohne Recht', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'mitarbeiter' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

function sitzung(mandantId?: string, benutzerId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung,
    benutzerId: benutzerId ?? benutzer, portal: 'intern' as const, readonly: false,
  };
}

/** Der Schreibkontext über der schon gebundenen Transaktion (wie PR 70). */
function kontext(
  tx: postgres.TransactionSql, mandantId?: string, benutzerId?: string,
): SchreibKontext {
  const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzerId ?? benutzer,
    aktiverMandantId: mandantId ?? f.reinigung, mandantIds: [mandantId ?? f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function alsDienst<T>(
  fn: (k: SchreibKontext) => Promise<T>, mandantId?: string, benutzerId?: string,
): Promise<T> {
  return alsApp(sitzung(mandantId, benutzerId), async (tx: postgres.TransactionSql) =>
    fn(kontext(tx, mandantId, benutzerId))) as Promise<T>;
}

interface FreigabeWunsch {
  readonly risiko?: string;
  readonly vorgangTyp?: string;
  readonly stapelFaehig?: boolean;
  readonly sperrGrund?: string | null;
  readonly mandantId?: string;
  /** Ein unsicheres Feld — die Zahl führt der Zähltrigger, nicht der Test. */
  readonly unsicher?: boolean;
  readonly gesehenVon?: string;
  /** Hat sie jemand EINZELN geöffnet? Der Stapel braucht das nicht. */
  readonly gesehen?: boolean;
  /** Die Handlung, die der Genehmigung folgt (§4.8) — Vorgabe: keine. */
  readonly aktion?: string;
  readonly nutzlast?: Record<string, unknown>;
}

/**
 * Eine offene Freigabe, die entschieden werden KANN: mit Nutzlast, Hash und
 * der Ansicht des Menschen, ohne die `app.freigabe_entscheiden` zu Recht
 * abweist (APR-08).
 */
async function legeFreigabeAn(w: FreigabeWunsch = {}): Promise<string> {
  const mandantId = w.mandantId ?? f.reinigung;
  const nutzlast = w.nutzlast ?? { aktion: 'stapel', nr: zufall() };
  const [h] = await sql.unsafe<{ hash: string }[]>(
    `select encode(digest(convert_to($1, 'UTF8'), 'sha256'), 'hex') as hash`,
    [JSON.stringify(nutzlast)]);
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung,
                           risiko, diff, vorschau_payload, payload_hash, betrag_cent,
                           erstellt_von, stapel_faehig, stapel_sperre_grund)
     values ($1, $9, 'offen', $2::agent_vorgang_typ, 'Stapelzeile',
             'Eine Zeile, wie sie morgens im Posteingang steht',
             $3::risiko_stufe, '[]'::jsonb, $4::jsonb, $5, 1200, $6, $7, $8)
     returning id`,
    [mandantId, w.vorgangTyp ?? 'monatsrechnung_entwurf', w.risiko ?? 'niedrig',
      nutzlast as never, h!.hash, benutzer, w.stapelFaehig ?? true, w.sperrGrund ?? null,
      w.aktion ?? 'rechnung_senden']);

  if (w.unsicher === true) {
    await sql.unsafe(
      `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung,
                                  wert_nachher, konfidenz, unsicher, grund, quelle_zitat)
       values ($1, $2, '/betrag', 'Betrag', '12,00', 0.41, true,
               'Der Betrag stand halb unter dem Stempel', 'Rechnungsbetrag 12,00 EUR')`,
      [mandantId, z!.id]);
  }

  if (w.gesehen !== false) {
    const wer = w.gesehenVon ?? benutzer;
    await alsApp(sitzung(mandantId, wer), async (tx) => {
      await tx.unsafe(
        `insert into freigabe_ansicht (mandant_id, freigabe_id, benutzer_id, kanal)
         values ($1, $2, $3, 'web')`, [mandantId, z!.id, wer]);
    });
  }
  return z!.id;
}

async function stand(id: string): Promise<{
  status: string; ausfuehrung_status: string;
  verzoegerte_freigabe_bis: Date | null; undo_bis: Date | null;
  begruendung: string | null; ausfuehrung_fehler: string | null;
}> {
  const [z] = await sql.unsafe<{
    status: string; ausfuehrung_status: string;
    verzoegerte_freigabe_bis: Date | null; undo_bis: Date | null;
    begruendung: string | null; ausfuehrung_fehler: string | null;
  }[]>(
    `select status::text as status, ausfuehrung_status::text as ausfuehrung_status,
            verzoegerte_freigabe_bis, undo_bis, begruendung, ausfuehrung_fehler
       from freigabe where id = $1`, [id]);
  return z!;
}

/** Was der ausführende Dienst tut, bevor ein Rücknahmefenster Sinn ergibt. */
async function markiereAusgefuehrt(id: string): Promise<void> {
  await sql.unsafe(
    `update freigabe set ausfuehrung_status = 'ausgefuehrt', ausgefuehrt_am = now()
      where id = $1`, [id]);
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeAdministrationAn(f.reinigung);
  for (const m of [f.reinigung, f.security]) await bindeFreigabeRechte('admin', m);
});

afterAll(schliessen);

describe('(1) der Stapel überspringt mit Grund, statt abzubrechen (APR-04)', () => {
  it('drei saubere Zeilen gehen in einem Aufruf durch', async () => {
    const ids = [await legeFreigabeAn(), await legeFreigabeAn(), await legeFreigabeAn()];
    const e = await alsDienst((k) => entscheideStapel(k, ids, META));
    expect(e.genehmigt).toBe(3);
    expect(e.uebersprungen).toEqual([]);
    for (const id of ids) expect((await stand(id)).status).toBe('genehmigt');
  });

  /**
   * **Der Satz, den erst der Browser gefunden hat.** APR-08 weist eine
   * Entscheidung ab, die dieser Mensch nie geöffnet hat — und wer fünfzig
   * Routinezeilen aus der Liste genehmigt, hat keine fünfzig Detailseiten
   * geöffnet. Der Stapel schreibt deshalb selbst eine Ansicht, und sie sagt
   * `stapel`, nicht `web`: gesehen wurde die Liste.
   */
  it('genehmigt auch, was niemand einzeln geöffnet hat — und schreibt die Ansicht als `stapel`', async () => {
    const id = await legeFreigabeAn({ gesehen: false });
    const e = await alsDienst((k) => entscheideStapel(k, [id], META));
    expect(e.genehmigt).toBe(1);
    expect((await stand(id)).status).toBe('genehmigt');

    const ansichten = await sql.unsafe<{ kanal: string | null }[]>(
      `select kanal from freigabe_ansicht where freigabe_id = $1`, [id]);
    expect(ansichten).toHaveLength(1);
    expect(ansichten[0]!.kanal).toBe('stapel');
  });

  it('eine nicht stapelfähige Zeile fällt mit IHRER Begründung heraus', async () => {
    const gut = await legeFreigabeAn();
    const gesperrt = await legeFreigabeAn({
      stapelFaehig: false, sperrGrund: 'Betrag über der Richtlinie',
    });
    const e = await alsDienst((k) => entscheideStapel(k, [gut, gesperrt], META));
    expect(e.genehmigt).toBe(1);
    expect(e.uebersprungen).toEqual([
      { freigabeId: gesperrt, grund: 'Betrag über der Richtlinie' },
    ]);
    expect((await stand(gut)).status).toBe('genehmigt');
    expect((await stand(gesperrt)).status).toBe('offen');
  });

  /**
   * Der Zähltrigger aus 0136 nimmt eine unsichere Zeile selbst aus dem Stapel.
   * Beide Riegel greifen also — der Test hält fest, dass der Dienst den GRUND
   * nennt und nicht bloss „nicht zugelassen".
   */
  it('ein unsicheres Feld nimmt die Zeile aus dem Stapel (APR-03)', async () => {
    const gut = await legeFreigabeAn();
    const unsicher = await legeFreigabeAn({ unsicher: true });
    const e = await alsDienst((k) => entscheideStapel(k, [gut, unsicher], META));
    expect(e.genehmigt).toBe(1);
    expect(e.uebersprungen).toHaveLength(1);
    expect(e.uebersprungen[0]!.freigabeId).toBe(unsicher);
    expect(e.uebersprungen[0]!.grund).toMatch(/unsicher|APR-0[34]/u);
    expect((await stand(unsicher)).status).toBe('offen');
  });

  it('eine bereits entschiedene Zeile wird nicht zweimal entschieden', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    const e = await alsDienst((k) => entscheideStapel(k, [id], META));
    expect(e.genehmigt).toBe(0);
    expect(e.uebersprungen[0]!.grund).toMatch(/bereits entschieden/u);
  });

  it('eine fremde Kennung ist „nicht gefunden", kein Programmfehler', async () => {
    const e = await alsDienst((k) => entscheideStapel(
      k, ['00000000-0000-0000-0000-000000000000'], META));
    expect(e.genehmigt).toBe(0);
    expect(e.uebersprungen[0]!.grund).toMatch(/nicht gefunden/u);
  });

  it('ein leerer Stapel und einer über der Obergrenze werden abgewiesen', async () => {
    await expect(alsDienst((k) => entscheideStapel(k, [], META)))
      .rejects.toBeInstanceOf(StapelFehler);
    const zuviele = Array.from({ length: STAPEL_HOECHSTZAHL + 1 },
      () => '00000000-0000-0000-0000-000000000000');
    await expect(alsDienst((k) => entscheideStapel(k, zuviele, META)))
      .rejects.toThrow(/keine Prüfung/u);
  });

  /**
   * **Der SAVEPOINT-Satz.** Eine Ausführung, die scheitert, nimmt IHRE
   * Entscheidung mit zurück (§4.8) — aber nur ihre. Ohne den Punkt je Zeile
   * stünde am Ende alles oder nichts.
   */
  it('eine gescheiterte Ausführung rollt allein zurück, nicht den Stapel', async () => {
    const gut = await legeFreigabeAn();
    /* Ein Übernahmevorschlag ohne Lieferant, Nummer und Beträge — der
       Ausführer weist ihn ab, und zwar erst NACH der Entscheidung. */
    const kaputt = await legeFreigabeAn({
      vorgangTyp: 'buchung_uebernehmen', aktion: 'eingangsrechnung_uebernehmen',
      nutzlast: { lieferantId: null, rechnungsnummer: null },
    });
    const e = await alsDienst((k) => entscheideStapel(k, [gut, kaputt], META));

    expect(e.genehmigt).toBe(1);
    expect(e.uebersprungen).toHaveLength(1);
    expect(e.uebersprungen[0]!.freigabeId).toBe(kaputt);
    expect(e.uebersprungen[0]!.grund).toMatch(/Nutzlast|unvollständig/u);

    expect((await stand(gut)).status).toBe('genehmigt');
    /* Zurückgerollt heisst: die Freigabe steht wieder offen — und ohne
       Schnappschuss, denn entschieden wurde sie am Ende nicht. */
    expect((await stand(kaputt)).status).toBe('offen');
    const schnappschuesse = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from freigabe_snapshot where freigabe_id = $1`, [kaputt]);
    expect(schnappschuesse[0]!.n).toBe('0');
  });

  /**
   * APR-07 ist der Grund, warum der Stapel eine Schleife ist und kein
   * Sammelupdate: drei Genehmigungen sind drei Schnappschüsse und drei
   * Kettenglieder — nicht ein Stand für drei Sachverhalte.
   */
  it('jede Zeile bekommt ihren eigenen Schnappschuss und ihr eigenes Kettenglied', async () => {
    const ids = [await legeFreigabeAn(), await legeFreigabeAn(), await legeFreigabeAn()];
    await alsDienst((k) => entscheideStapel(k, ids, META));
    const zeilen = await sql.unsafe<{ freigabe_id: string; kette_nr: string }[]>(
      `select freigabe_id, kette_nr::text as kette_nr from freigabe_snapshot
        where freigabe_id = any ($1::uuid[]) order by kette_nr`, [ids]);
    expect(zeilen).toHaveLength(3);
    expect(new Set(zeilen.map((z) => z.freigabe_id)).size).toBe(3);
    expect(new Set(zeilen.map((z) => z.kette_nr)).size).toBe(3);
  });
});

describe('(2) das Einspruchsfenster gibt es nur, wo APR-05 es erlaubt', () => {
  it('eine risikoarme Zeile bekommt es — und zwar in der Zukunft', async () => {
    const id = await legeFreigabeAn({ risiko: 'niedrig' });
    const e = await alsDienst((k) => entscheideStapel(k, [id], META));
    expect(e.verzoegert).toBe(1);
    const s = await stand(id);
    expect(s.verzoegerte_freigabe_bis).not.toBeNull();
    expect(s.verzoegerte_freigabe_bis!.getTime()).toBeGreaterThan(Date.now());
    expect(s.verzoegerte_freigabe_bis!.getTime())
      .toBeLessThanOrEqual(Date.now() + (EINSPRUCH_MINUTEN + 1) * 60_000);
  });

  it('eine Zeile mit erhöhtem Risiko bekommt keines', async () => {
    const id = await legeFreigabeAn({ risiko: 'mittel' });
    const e = await alsDienst((k) => entscheideStapel(k, [id], META));
    expect(e.genehmigt).toBe(1);
    expect(e.verzoegert).toBe(0);
    expect((await stand(id)).verzoegerte_freigabe_bis).toBeNull();
  });

  /**
   * Der Fall, der ohne den `exception`-Zweig in `app.freigabe_verzoegern` die
   * GANZE Stapeltransaktion mitgerissen hätte: `buchung_uebernehmen` ist von
   * der verzögerten Auslösung ausgenommen (0136), auch bei `niedrig`. Die
   * saubere Zeile daneben muss trotzdem genehmigt bleiben.
   */
  it('eine ausgenommene Vorgangsart bekommt keines — und reisst den Stapel nicht mit', async () => {
    const normal = await legeFreigabeAn();
    const ausgenommen = await legeFreigabeAn({
      risiko: 'niedrig', vorgangTyp: 'buchung_uebernehmen',
    });
    const e = await alsDienst((k) => entscheideStapel(k, [normal, ausgenommen], META));
    expect(e.genehmigt).toBe(2);
    expect(e.verzoegert).toBe(1);
    expect((await stand(ausgenommen)).status).toBe('genehmigt');
    expect((await stand(ausgenommen)).verzoegerte_freigabe_bis).toBeNull();
    expect((await stand(normal)).verzoegerte_freigabe_bis).not.toBeNull();
  });

  it('ohne Genehmigung kein Fenster', async () => {
    const id = await legeFreigabeAn();
    await expect(alsDienst(async (k) =>
      k.schreibe(`select app.freigabe_verzoegern($1::uuid, 30)`, [id]),
    )).rejects.toThrow(/Nur eine genehmigte Freigabe/u);
  });

  it('ein Fenster von null Minuten ist kein Fenster', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await expect(alsDienst(async (k) =>
      k.schreibe(`select app.freigabe_verzoegern($1::uuid, 0)`, [id]),
    )).rejects.toThrow(/kein Fenster/u);
  });
});

describe('(3) der Einspruch (APR-05)', () => {
  async function genehmigtMitFenster(): Promise<string> {
    const id = await legeFreigabeAn({ risiko: 'niedrig' });
    await alsDienst((k) => entscheideStapel(k, [id], META));
    return id;
  }

  it('innerhalb des Fensters hält er die Ausführung an', async () => {
    const id = await genehmigtMitFenster();
    await alsDienst((k) => erhebeEinspruch(k, id, 'Kunde hat den Auftrag storniert'));
    const s = await stand(id);
    expect(s.status).toBe('widerrufen');
    expect(s.verzoegerte_freigabe_bis).toBeNull();
    expect(s.begruendung).toBe('Kunde hat den Auftrag storniert');
  });

  it('ohne Grund nicht', async () => {
    const id = await genehmigtMitFenster();
    await expect(alsDienst((k) => erhebeEinspruch(k, id, 'ups')))
      .rejects.toBeInstanceOf(FensterFehler);
    expect((await stand(id)).status).toBe('genehmigt');
  });

  it('nach Ablauf des Fensters nicht', async () => {
    const id = await genehmigtMitFenster();
    await sql.unsafe(
      `update freigabe set verzoegerte_freigabe_bis = now() - interval '1 minute'
        where id = $1`, [id]);
    await expect(alsDienst((k) => erhebeEinspruch(k, id, 'Zu spaet bemerkt')))
      .rejects.toThrow(/abgelaufen/u);
    expect((await stand(id)).status).toBe('genehmigt');
  });

  it('und ohne Fenster erst recht nicht', async () => {
    const id = await legeFreigabeAn({ risiko: 'mittel' });
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await expect(alsDienst((k) => erhebeEinspruch(k, id, 'Doch nicht senden')))
      .rejects.toThrow(/kein Einspruchsfenster/u);
  });

  it('ist die Ausführung schon gelaufen, hilft nur noch die Rücknahme', async () => {
    const id = await genehmigtMitFenster();
    await markiereAusgefuehrt(id);
    await expect(alsDienst((k) => erhebeEinspruch(k, id, 'Bitte anhalten')))
      .rejects.toThrow(/bereits ausgefuehrt/u);
  });

  it('der Schnappschuss der Entscheidung bleibt unangetastet (APR-07)', async () => {
    const id = await genehmigtMitFenster();
    const [vorher] = await sql.unsafe<{ hash: string; art: string }[]>(
      `select hash, art::text as art from freigabe_snapshot where freigabe_id = $1`, [id]);
    await alsDienst((k) => erhebeEinspruch(k, id, 'Kunde hat storniert'));
    const [nachher] = await sql.unsafe<{ hash: string; art: string }[]>(
      `select hash, art::text as art from freigabe_snapshot where freigabe_id = $1`, [id]);
    expect(nachher).toEqual(vorher);
    expect(nachher!.art).toBe('genehmigt');
  });
});

describe('(4) die Rücknahme der AUSFÜHRUNG (APR-06)', () => {
  it('sie gibt es erst nach der Ausführung', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await expect(alsDienst(async (k) =>
      k.schreibe(`select app.freigabe_ruecknahme_fenster($1::uuid, 60)`, [id]),
    )).rejects.toThrow(/erst nach der Ausfuehrung/u);
  });

  /**
   * **Der Satz, der heute zählt: es ist NICHTS umkehrbar** (O-368).
   *
   * Für die einzige Handlung, die ausgeführt wird, gibt es keinen gebauten
   * Rückweg — im Finanzbereich wird nicht hart gelöscht, korrigiert wird durch
   * Storno, und eine Stornofunktion für Eingangsrechnungen existiert nicht.
   * Ein Fenster zu armieren hiesse, einen Knopf anzubieten, der einen Stand
   * umsetzt und die Rechnung stehen lässt. Die Datenbank sagt deshalb für
   * JEDE Vorgangsart „nein", und dieser Test hält das fest: wird eine
   * Rückholung gebaut, schlägt er fehl und verlangt, dass jemand hinsieht.
   */
  it('armiert heute für nichts ein Fenster — und sagt es mit NULL, nicht mit einem Fehler', async () => {
    for (const typ of ['monatsrechnung_entwurf', 'buchung_uebernehmen', 'externer_versand']) {
      const id = await legeFreigabeAn({ vorgangTyp: typ, risiko: 'mittel' });
      await alsDienst((k) => entscheideStapel(k, [id], META));
      await markiereAusgefuehrt(id);
      expect(await alsDienst((k) => armiereRuecknahme(k, id))).toBe(false);
      expect((await stand(id)).undo_bis).toBeNull();
    }
  });

  /**
   * Der Gegenbeweis: der WEG steht. Sobald ein Fenster von Hand gesetzt ist —
   * so, wie es `app.freigabe_ruecknahme_fenster` täte, wenn die Liste eine
   * Vorgangsart nennt —, greift die Rücknahme und dreht die AUSFÜHRUNG
   * zurück, nicht die Entscheidung.
   */
  it('mit gesetztem Fenster dreht sie die Ausführung zurück, nicht die Entscheidung', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await markiereAusgefuehrt(id);
    await sql.unsafe(
      `update freigabe set undo_bis = now() + interval '1 hour' where id = $1`, [id]);

    await alsDienst((k) => nimmZurueck(k, id, 'Falscher Monat erwischt'));
    const s = await stand(id);
    expect(s.ausfuehrung_status).toBe('zurueckgenommen');
    expect(s.ausfuehrung_fehler).toBe('Falscher Monat erwischt');
    expect(s.undo_bis).toBeNull();
    /* Die ENTSCHEIDUNG bleibt genehmigt — eine Umkehr ist eine neue Freigabe. */
    expect(s.status).toBe('genehmigt');
  });

  it('nach Ablauf des Fensters nicht mehr', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await markiereAusgefuehrt(id);
    await sql.unsafe(
      `update freigabe set undo_bis = now() - interval '1 second' where id = $1`, [id]);
    await expect(alsDienst((k) => nimmZurueck(k, id, 'Doch noch zurueck')))
      .rejects.toThrow(/abgelaufen|gab es nie/u);
    expect((await stand(id)).ausfuehrung_status).toBe('ausgefuehrt');
  });

  it('und ohne Grund nie', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await markiereAusgefuehrt(id);
    await sql.unsafe(
      `update freigabe set undo_bis = now() + interval '1 hour' where id = $1`, [id]);
    await expect(alsDienst((k) => nimmZurueck(k, id, '—')))
      .rejects.toThrow(/braucht einen Grund/u);
  });

  it('das Fenster ist so lang wie der Platzhalter sagt (O-108)', async () => {
    expect(RUECKNAHME_MINUTEN).toBeGreaterThan(0);
    expect(EINSPRUCH_MINUTEN).toBeGreaterThan(0);
  });
});

describe('(5) die Verteilung der Prüfdauer — ohne Personenbezug (APR-08, §4.9)', () => {
  it('zählt die Stapelentscheidungen getrennt, damit ein Stapel kein Durchwinken ist', async () => {
    const ids = [await legeFreigabeAn({ gesehen: false }), await legeFreigabeAn({ gesehen: false })];
    await alsDienst((k) => entscheideStapel(k, ids, META));

    const zeilen = await alsDienst((k) => k.abfrage<{
      eimer: string; anzahl: string; davon_stapel: string;
    }>(`select eimer, anzahl::text as anzahl, davon_stapel::text as davon_stapel
          from app.freigabe_pruefdauer_verteilung()`));
    const schnell = zeilen.find((z) => z.eimer === 'unter_3s');
    expect(schnell).toBeDefined();
    expect(Number(schnell!.anzahl)).toBeGreaterThanOrEqual(2);
    expect(Number(schnell!.davon_stapel)).toBeGreaterThanOrEqual(2);
  });

  /**
   * K-05, § 87 Abs. 1 Nr. 6 BetrVG: ohne das Recht kommen KEINE Zeilen —
   * nicht eine Ausnahme, denn eine Ausnahme wäre selbst die Auskunft.
   */
  it('ohne `freigabe.pruefdauer_lesen` kommt gar nichts zurück', async () => {
    const id = await legeFreigabeAn({ gesehen: false });
    await alsDienst((k) => entscheideStapel(k, [id], META));

    const ohneRecht = await legeBenutzerOhneRecht(f.reinigung);
    const zeilen = await alsDienst(
      (k) => k.abfrage(`select * from app.freigabe_pruefdauer_verteilung()`),
      f.reinigung, ohneRecht);
    expect(zeilen).toEqual([]);
  });
});

describe('(6) die Wände', () => {
  /**
   * Der eigentliche Satz dieser Datei: die drei Funktionen sind nicht bequemer
   * als ein `update`, sie sind der EINZIGE Weg. Ginge `cse_app` direkt an die
   * Spalten, liefe jede Prüfung darin ins Leere.
   */
  it('`cse_app` schreibt die Fensterspalten nicht selbst', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update freigabe set verzoegerte_freigabe_bis = now() + interval '1 day'
                  where id = $1`, [id]),
    )).rejects.toThrow(/permission denied|verweigert/u);
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update freigabe set undo_bis = now() + interval '1 day' where id = $1`, [id]),
    )).rejects.toThrow(/permission denied|verweigert/u);
  });

  it('eine fremde Gesellschaft sieht die Freigabe nicht — und nimmt sie nicht zurück', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    const fremder = await legeAdministrationAn(f.security);
    const e = await alsDienst((k) => entscheideStapel(k, [id], META), f.security, fremder);
    expect(e.genehmigt).toBe(0);
    expect(e.uebersprungen[0]!.grund).toMatch(/nicht gefunden/u);
    await expect(alsDienst((k) => erhebeEinspruch(k, id, 'Von nebenan'), f.security, fremder))
      .rejects.toThrow(/nicht gefunden/u);
  });

  it('ohne Sitzung geht keine der drei Funktionen', async () => {
    const id = await legeFreigabeAn();
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await expect(alsRolle('cse_app', async (tx) =>
      tx.unsafe(`select app.freigabe_einspruch($1::uuid, 'Ohne Sitzung')`, [id]),
    )).rejects.toThrow(/Ohne Sitzung/u);
  });

  /**
   * **Wer einzeln entscheiden darf, darf nicht schon fünfzig auf einmal**
   * (O-367). Die drei Befugnisse sind im Katalog eigene, BINDBARE Rechte —
   * eine `leitung` ohne Bindung entscheidet weiter einzeln und kommt an
   * Stapel, Einspruch und Rücknahme nicht heran.
   */
  it('ohne die bindbaren Rechte gibt es weder Stapelfenster noch Einspruch noch Rücknahme', async () => {
    const leitung = await legeLeitungAn(f.reinigung);
    const id = await legeFreigabeAn({ gesehenVon: leitung });

    /* Der Stapel wird VORN abgewiesen, nicht nach fünfzig Entscheidungen. */
    await expect(alsDienst((k) => entscheideStapel(k, [id], META), f.reinigung, leitung))
      .rejects.toThrow(/eigene Befugnis/u);
    expect((await stand(id)).status).toBe('offen');

    /* Einzeln entscheiden geht weiter — nur eben einzeln. */
    await alsDienst((k) => entscheideStapel(k, [id], META));
    await expect(alsDienst((k) => erhebeEinspruch(k, id, 'Bitte anhalten'),
      f.reinigung, leitung)).rejects.toThrow(/Kein Recht/u);
    await markiereAusgefuehrt(id);
    await expect(alsDienst((k) => nimmZurueck(k, id, 'Bitte zurueck'),
      f.reinigung, leitung)).rejects.toThrow(/Kein Recht/u);
  });

  /** K-08: eine Definer-Funktion, die `public` ausführen darf, ist keine Wand. */
  it('keine der drei Funktionen ist für `public` ausführbar (K-08)', async () => {
    const zeilen = await sql.unsafe<{ proname: string; offen: boolean }[]>(
      `select p.proname,
              coalesce(has_function_privilege('public', p.oid, 'execute'), false) as offen
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.proname in ('freigabe_verzoegern', 'freigabe_einspruch',
                            'freigabe_ruecknahme', 'freigabe_ruecknahme_fenster')`);
    expect(zeilen).toHaveLength(4);
    for (const z of zeilen) expect(z.offen).toBe(false);
  });
});
