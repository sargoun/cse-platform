import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, storniere, verwerfe, vonHand, type Abfrage,
  type EntwurfRechnungsart,
} from '../../src/server/services/finanz/rechnung.js';
import { pruefeZeiterfassung } from '../../src/server/services/finanz/positionsquelle.js';
import { offenePruefungen } from '../../src/server/services/finanz/vorabpruefung.js';
import { schreibeVerrechnung } from '../../src/server/services/finanz/abschlag/index.js';
import {
  aendereEntwurfKopf, fuegeMaterialPositionHinzu, uebernimmAbrechnungsart,
  vorschauAbrechnungsart, weiterberechenbareAusgaben, type EntwurfKopf,
} from '../../src/server/services/finanz/entwurf.js';

/**
 * **Der Rechnungsentwurf nach dem Anlegen** — gegen echtes Postgres (V-204,
 * V-205, V-206; D-697, D-698, D-699; FIN-01, FIN-04, FIN-05, FIN-07, FIN-08,
 * FIN-18; Invarianten 1, 4, 8).
 *
 *  §1 Anlegen mit Auftrag und Rechnungsart — und was nicht zusammenpasst,
 *     wird abgewiesen, bevor eine Zeile entsteht.
 *  §2 Der Kopf eines Entwurfs lässt sich ändern: die Sackgasse „fehlender
 *     Zeitraum / fehlendes Zahlungsziel" hat einen Ausweg. Ein
 *     festgeschriebener Beleg ändert sich nicht.
 *  §3 Die Zuordnung: ein Auftrag mit Belegen darunter wechselt nicht; ohne
 *     Belege schon — und dann greifen FIN-18 und die Vorabprüfung.
 *  §4 Abschlag und Schlussrechnung am Auftrag: der Abzug, sein Rückzug beim
 *     Wechsel der Art, und die festgeschriebene Schlussrechnung.
 *  §5 Die Abrechnungsart rechnet auf einer Rechnung — einmal je Entwurf.
 *  §6 Material aus einer Ausgabe — genau einmal, und nur die passende.
 *  §7 Dieselbe Vereinbarung auf ZWEI Belegen (V-207, D-700): derselbe
 *     Monat, dasselbe Los wird nicht noch einmal berechnet — frei erst nach
 *     Storno oder Verwerfen; der Fertigstellungsgrad ist der Gesamtstand;
 *     eine Schlussrechnung führt, was ihre Abschläge schon trugen.
 */

let f: Fixtur;
let benutzer = '';
let kundeId = '';
let fremderKundeId = '';
let auftragId = '';
let leistungId = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

function imDienst<T>(fn: (d: Abfrage, tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return alsApp(sitzung(), async (tx) => fn(alsDienst(tx), tx)) as Promise<T>;
}

/** Den Fehler eines Aufrufs fangen — `null`, wenn er durchging. */
async function fehlerVon(
  p: Promise<unknown>,
): Promise<(Error & { grund?: string }) | null> {
  return p.then(() => null, (x: unknown) => x as Error & { grund?: string });
}

async function legeAuftragAn(kunde: string, status = 'aktiv'): Promise<string> {
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus Nord','Teststr. 3','10115','Berlin') returning id`,
    [f.reinigung, kunde, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'dauerauftrag',$5::auftrag_status,'Unterhaltsreinigung Nord',$6,
             '2026-01-01')
     returning id`,
    [f.reinigung, `AU-${zufall()}`, kunde, o!.id, status, benutzer] as never[]);
  return a!.id;
}

interface Anlage {
  readonly auftrag?: string | null;
  readonly art?: EntwurfRechnungsart;
  readonly von?: string | null;
  readonly bis?: string | null;
  readonly vereinnahmung?: string | null;
  readonly ziel?: number | null;
  readonly netto?: bigint;
  readonly kunde?: string;
}

/** Ein Entwurf mit einer von Hand erfassten Zeile. */
async function entwurf(a: Anlage = {}): Promise<string> {
  return imDienst(async (d) => {
    const id = await legeEntwurfAn(d, {
      kundeId: a.kunde ?? kundeId,
      auftragId: a.auftrag ?? null,
      rechnungsart: a.art ?? 'standard',
      leistungVon: a.von === undefined ? '2026-08-01' : a.von,
      leistungBis: a.bis === undefined ? '2026-08-31' : a.bis,
      vereinnahmungGeplantAm: a.vereinnahmung ?? null,
      zahlungszielTage: a.ziel === undefined ? 30 : a.ziel,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung August',
      menge: milliMenge(1000n), einheit: 'psch',
      einzelpreisCent: cent(a.netto ?? 1_000_000n), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur — von Hand erfasst'),
    });
    return id;
  });
}

interface KopfZeile {
  status: string; rechnungsart: string; auftrag_id: string | null;
  leistung_von: string | null; leistung_bis: string | null; vereinnahmung: string | null;
  zahlungsziel_tage: number | null; objekt_id: string | null; kopftext: string | null;
  fusstext: string | null; zahlungsmittel_code: string | null;
  brutto: string; abzug: string; zahlbetrag: string; nummer: string | null;
}

async function kopf(id: string): Promise<KopfZeile> {
  const [k] = await sql.unsafe<KopfZeile[]>(
    `select status::text as status, rechnungsart::text as rechnungsart,
            auftrag_id::text as auftrag_id,
            to_char(leistung_von, 'YYYY-MM-DD') as leistung_von,
            to_char(leistung_bis, 'YYYY-MM-DD') as leistung_bis,
            to_char(vereinnahmung_geplant_am, 'YYYY-MM-DD') as vereinnahmung,
            zahlungsziel_tage, objekt_id::text as objekt_id, kopftext, fusstext,
            zahlungsmittel_code, brutto_cent::text as brutto,
            abzug_brutto_cent::text as abzug, zahlbetrag_cent::text as zahlbetrag, nummer
       from rechnung where id = $1`, [id]);
  return k!;
}

/** Der Kopf, wie ihn die Maske schickt: der heutige Stand, dann die Änderung. */
async function kopfMit(id: string, aenderung: Partial<EntwurfKopf>): Promise<EntwurfKopf> {
  const k = await kopf(id);
  return {
    objektId: k.objekt_id, auftragId: k.auftrag_id, rechnungsart: k.rechnungsart,
    leistungVon: k.leistung_von, leistungBis: k.leistung_bis,
    vereinnahmungGeplantAm: k.vereinnahmung, zahlungszielTage: k.zahlungsziel_tage,
    zahlungsmittelCode: k.zahlungsmittel_code, kopftext: k.kopftext, fusstext: k.fusstext,
    ...aenderung,
  };
}

async function festschreiben(id: string): Promise<string> {
  return imDienst(async (d) => (await finalisiere(d, id)).nummer);
}

beforeAll(async () => {
  f = await seed();
  const email = `buchhaltung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  benutzer = u!.id;
  /*
   * Die Mitgliedschaft ist Voraussetzung, nicht Zierde:
   * `kern.auftrag_verantwortlich_im_mandant()` (0025) weist jeden Auftrag ab,
   * dessen Verantwortliche hier keine gültige Zeile hat.
   */
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
             current_date - 1)`,
    [benutzer, f.reinigung]);
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B'
      where id = $1`, [f.reinigung]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [f.reinigung]);
  const [k1] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k1!.id;
  const [k2] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Charlottenburg Immobilien','Bismarckstr','1','10625','Berlin')
     returning id`,
    [f.reinigung, `K-${zufall()}`]);
  fremderKundeId = k2!.id;
  auftragId = await legeAuftragAn(kundeId);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung, einheit,
                                   einzelpreis_cent, steuersatz_bp, steuer_kennzeichen,
                                   gueltig_ab)
     values ($1,$2,1,'Unterhaltsreinigung Nord','psch',150000,1900,'regelsatz','2026-01-01')
     returning id`,
    [f.reinigung, auftragId] as never[]);
  leistungId = l!.id;
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('§1 ein Entwurf entsteht mit Auftrag und Rechnungsart (V-205)', () => {
  it('Auftrag, Art und Vereinnahmung stehen im Kopf', async () => {
    const id = await entwurf({
      auftrag: auftragId, art: 'abschlag', von: null, bis: null, vereinnahmung: '2026-09-15',
    });
    const k = await kopf(id);
    expect(k.auftrag_id).toBe(auftragId);
    expect(k.rechnungsart).toBe('abschlag');
    expect(k.vereinnahmung).toBe('2026-09-15');
    expect(k.nummer).toBeNull();
  });

  it('eine Abschlagsrechnung mit Vereinnahmung statt Zeitraum lässt sich festschreiben', async () => {
    const id = await entwurf({
      auftrag: auftragId, art: 'anzahlung', von: null, bis: null, vereinnahmung: '2026-09-15',
    });
    const nummer = await festschreiben(id);
    expect(nummer).toMatch(/^RE-/u);
  });

  it('eine Standardrechnung trägt keinen Vereinnahmungstag', async () => {
    const id = await entwurf({ vereinnahmung: '2026-09-15' });
    expect((await kopf(id)).vereinnahmung).toBeNull();
  });

  it('der Auftrag eines anderen Kunden wird abgewiesen', async () => {
    const fremd = await legeAuftragAn(fremderKundeId);
    const fehler = await fehlerVon(entwurf({ auftrag: fremd }));
    expect(fehler?.grund).toBe('auftrag_passt_nicht');
    expect(fehler?.message).toMatch(/anderen Kunden/u);
  });

  it('ein stornierter Auftrag wird nicht mehr abgerechnet', async () => {
    const storniert = await legeAuftragAn(kundeId);
    await alsApp(sitzung(), async (tx) => tx.unsafe(
      `update auftrag set status = 'storniert', status_grund = 'Kunde hat gekündigt'
        where id = $1`, [storniert]));
    const fehler = await fehlerVon(entwurf({ auftrag: storniert }));
    expect(fehler?.grund).toBe('auftrag_passt_nicht');
  });

  it('„storno" ist keine Art, die ein Entwurf tragen kann', async () => {
    const fehler = await fehlerVon(entwurf({ art: 'storno' as EntwurfRechnungsart }));
    expect(fehler?.grund).toBe('rechnungsart_unbekannt');
  });

  it('ein Zeitraum, der vor seinem Beginn endet, wird abgewiesen', async () => {
    const fehler = await fehlerVon(entwurf({ von: '2026-08-31', bis: '2026-08-01' }));
    expect(fehler?.grund).toBe('zeitraum_verkehrt');
  });
});

describe('§2 der Kopf eines Entwurfs ist änderbar (V-204)', () => {
  it('die Sackgasse: ohne Zeitraum und Zahlungsziel sperrt die Festschreibung — '
    + 'der Kopf behebt beides, ohne eine Zeile neu zu erfassen', async () => {
    const id = await entwurf({ von: null, bis: null, ziel: null });
    expect((await kopf(id)).zahlungsziel_tage).toBeNull();
    const gesperrt = await fehlerVon(festschreiben(id));
    expect(gesperrt).not.toBeNull();

    const ergebnis = await imDienst(async (d) => aendereEntwurfKopf(d, id, await kopfMit(id, {
      leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 14,
      zahlungsmittelCode: '58', kopftext: 'Leistung August', fusstext: 'Danke.',
    })));
    expect(ergebnis.abzugZurueckgenommen).toBe(false);
    const k = await kopf(id);
    expect([k.leistung_von, k.leistung_bis, k.zahlungsziel_tage]).toEqual(
      ['2026-08-01', '2026-08-31', 14]);
    expect([k.kopftext, k.fusstext, k.zahlungsmittel_code]).toEqual(
      ['Leistung August', 'Danke.', '58']);

    expect(await festschreiben(id)).toMatch(/^RE-/u);
  });

  it('ein leeres Zahlungsziel wird neu aufgelöst — aus der Kondition des Kunden', async () => {
    const kunde = (await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort,
                          zahlungsziel_tage)
       values ($1,$2,'Hausverwaltung Süd','Hauptstr.','5','10827','Berlin',21) returning id`,
      [f.reinigung, `K-${zufall()}`]))[0]!.id;
    const id = await entwurf({ kunde, ziel: 45 });
    expect((await kopf(id)).zahlungsziel_tage).toBe(45);
    const ergebnis = await imDienst(async (d) =>
      aendereEntwurfKopf(d, id, await kopfMit(id, { zahlungszielTage: null })));
    expect(ergebnis.zahlungszielAufgeloest).toBe(true);
    expect((await kopf(id)).zahlungsziel_tage).toBe(21);
  });

  it('ein festgeschriebener Beleg ändert seinen Kopf nicht (Invariante 4)', async () => {
    const id = await entwurf();
    await festschreiben(id);
    const vorher = await kopf(id);
    const fehler = await fehlerVon(imDienst(async (d) =>
      aendereEntwurfKopf(d, id, await kopfMit(id, { kopftext: 'nachträglich' }))));
    expect(fehler?.grund).toBe('kein_entwurf');
    expect(await kopf(id)).toEqual(vorher);
  });

  it('ein Stichtag, an dem die Steuergruppe einer Zeile nicht gilt, wird abgewiesen', async () => {
    /* `ust_19` gilt ab 2021-01-01 (0075) — der Satz der Zeile wird nicht still umgeschrieben. */
    const id = await entwurf();
    const fehler = await fehlerVon(imDienst(async (d) => aendereEntwurfKopf(d, id,
      await kopfMit(id, { leistungVon: '2020-06-01', leistungBis: '2020-06-30' }))));
    expect(fehler?.grund).toBe('unbekannte_steuergruppe');
    expect((await kopf(id)).leistung_von).toBe('2026-08-01');
  });

  it('ein verkehrter Zeitraum wird abgewiesen, ein unvollständiger nicht', async () => {
    const id = await entwurf();
    const verkehrt = await fehlerVon(imDienst(async (d) => aendereEntwurfKopf(d, id,
      await kopfMit(id, { leistungVon: '2026-08-31', leistungBis: '2026-08-01' }))));
    expect(verkehrt?.grund).toBe('zeitraum_verkehrt');
    await imDienst(async (d) => aendereEntwurfKopf(d, id,
      await kopfMit(id, { leistungVon: null, leistungBis: null })));
    expect((await kopf(id)).leistung_von).toBeNull();
  });
});

describe('§3 die Zuordnung zum Auftrag (V-205)', () => {
  it('ohne Beleg aus dem Auftrag wechselt die Zuordnung — und FIN-18 greift danach', async () => {
    const auftrag = await legeAuftragAn(kundeId);
    const id = await entwurf();
    await imDienst(async (d) => aendereEntwurfKopf(d, id, await kopfMit(id, { auftragId: auftrag })));
    expect((await kopf(id)).auftrag_id).toBe(auftrag);

    /* Abgeschlossen ohne eine erfasste Minute — der Fall, den FIN-18 benennt. */
    await alsApp(sitzung(), async (tx) => tx.unsafe(
      `update auftrag set status = 'abgeschlossen' where id = $1`, [auftrag]));
    const befund = await imDienst((d) => pruefeZeiterfassung(d, id));
    expect(befund?.auftragId).toBe(auftrag);
  });

  it('die Prüfliste „Auftrag ohne Rechnung" kennt die Rechnung am Auftrag', async () => {
    const auftrag = await legeAuftragAn(kundeId);
    await alsApp(sitzung(), async (tx) => tx.unsafe(
      `update auftrag set status = 'abgeschlossen' where id = $1`, [auftrag]));
    const offen = async (): Promise<boolean> => (await imDienst((d) => offenePruefungen(d)))
      .befunde.some((b) => b.regel === 'auftrag_ohne_rechnung' && b.zielId === auftrag);
    expect(await offen()).toBe(true);
    await entwurf({ auftrag });
    expect(await offen()).toBe(false);
  });

  it('hängt ein Beleg des Auftrags an einer Zeile, wechselt der Auftrag nicht', async () => {
    const id = await entwurf({ auftrag: auftragId });
    await imDienst((d) => fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung laut Vertrag',
      menge: milliMenge(1000n), einheit: 'psch', einzelpreisCent: cent(150_000n),
      steuergruppe: 'ust_19', auftragLeistungId: leistungId,
      quellen: [{ typ: 'vertrag', id: leistungId }],
    }));
    const anderer = await legeAuftragAn(kundeId);
    const fehler = await fehlerVon(imDienst(async (d) =>
      aendereEntwurfKopf(d, id, await kopfMit(id, { auftragId: anderer }))));
    expect(fehler?.grund).toBe('zuordnung_gebunden');
    expect((await kopf(id)).auftrag_id).toBe(auftragId);
  });

  it('ein UNVERÄNDERTER Auftrag wird nicht neu geprüft — der übrige Kopf bleibt pflegbar', async () => {
    /*
     * Der Auftrag wurde beim Setzen geprüft. Wird er danach storniert (oder
     * darf der Pflegende ihn nicht lesen), darf das den Zeitraum oder das
     * Zahlungsziel nicht sperren — sonst wäre die Sackgasse aus V-204 zurück.
     */
    const auftrag = await legeAuftragAn(kundeId);
    const id = await entwurf({ auftrag });
    await alsApp(sitzung(), async (tx) => tx.unsafe(
      `update auftrag set status = 'storniert', status_grund = 'Kunde hat gekündigt'
        where id = $1`, [auftrag]));
    await imDienst(async (d) => aendereEntwurfKopf(d, id, await kopfMit(id, { zahlungszielTage: 10 })));
    const k = await kopf(id);
    expect([k.auftrag_id, k.zahlungsziel_tage]).toEqual([auftrag, 10]);
  });

  it('der Auftrag eines anderen Kunden wird auch im Kopf abgewiesen', async () => {
    const id = await entwurf();
    const fremd = await legeAuftragAn(fremderKundeId);
    const fehler = await fehlerVon(imDienst(async (d) =>
      aendereEntwurfKopf(d, id, await kopfMit(id, { auftragId: fremd }))));
    expect(fehler?.grund).toBe('auftrag_passt_nicht');
  });
});

describe('§4 Abschlag und Schlussrechnung am Auftrag (V-205, FIN-08)', () => {
  it('der Abzug steht, fällt mit dem Wechsel der Art und kommt wieder — '
    + 'und die festgeschriebene Schlussrechnung zahlt brutto minus Abzug', async () => {
    const auftrag = await legeAuftragAn(kundeId);
    /* 10.000,00 € netto, 11.900,00 € brutto — ohne Leistungszeitraum, mit Vereinnahmung. */
    await festschreiben(await entwurf({
      auftrag, art: 'abschlag', von: null, bis: null, vereinnahmung: '2026-07-15',
    }));
    const schluss = await entwurf({ auftrag, art: 'schluss', netto: 3_000_000n });

    await imDienst((d) => schreibeVerrechnung(d, schluss));
    expect((await kopf(schluss)).abzug).toBe('1190000');
    expect((await kopf(schluss)).zahlbetrag).toBe(String(3_570_000 - 1_190_000));

    const zurueck = await imDienst(async (d) => aendereEntwurfKopf(d, schluss,
      await kopfMit(schluss, { rechnungsart: 'standard' })));
    expect(zurueck.abzugZurueckgenommen).toBe(true);
    const ohne = await kopf(schluss);
    expect([ohne.abzug, ohne.zahlbetrag]).toEqual(['0', ohne.brutto]);
    const wirksam = await sql.unsafe<{ n: string }[]>(
      `select count(*) filter (where wirksam)::text as n from abschlagsrechnung_bezug
        where schluss_rechnung_id = $1`, [schluss]);
    expect(wirksam[0]!.n).toBe('0');

    await imDienst(async (d) => aendereEntwurfKopf(d, schluss,
      await kopfMit(schluss, { rechnungsart: 'schluss' })));
    await imDienst((d) => schreibeVerrechnung(d, schluss));
    await festschreiben(schluss);
    const fest = await kopf(schluss);
    expect(fest.status).toBe('festgeschrieben');
    expect(fest.abzug).toBe('1190000');
    expect(BigInt(fest.zahlbetrag)).toBe(BigInt(fest.brutto) - 1_190_000n);
  });

  it('ein inzwischen stornierter Abschlag hält den Kopf nicht fest (0441) — der Abzug '
    + 'fällt mit dem Wechsel, statt als Datenbankfehler zu enden', async () => {
    const auftrag = await legeAuftragAn(kundeId);
    /* Mit Zeitraum: ein Abschlag nur mit Vereinnahmung lässt sich nicht stornieren. */
    const abschlag = await entwurf({
      auftrag, art: 'abschlag', von: '2026-07-01', bis: '2026-07-31',
    });
    await festschreiben(abschlag);
    const schluss = await entwurf({ auftrag, art: 'schluss', netto: 3_000_000n });
    await imDienst((d) => schreibeVerrechnung(d, schluss));
    await imDienst((d) => storniere(d, abschlag, 'Abschlag mit falschem Betrag gestellt'));

    const zurueck = await imDienst(async (d) => aendereEntwurfKopf(d, schluss,
      await kopfMit(schluss, { rechnungsart: 'standard' })));
    expect(zurueck.abzugZurueckgenommen).toBe(true);
    expect((await kopf(schluss)).abzug).toBe('0');
  });

  it('ein verworfener Schlussrechnungsentwurf gibt seine Abschläge frei (0442)', async () => {
    const auftrag = await legeAuftragAn(kundeId);
    await festschreiben(await entwurf({
      auftrag, art: 'abschlag', von: null, bis: null, vereinnahmung: '2026-07-15',
    }));
    const erste = await entwurf({ auftrag, art: 'schluss', netto: 3_000_000n });
    await imDienst((d) => schreibeVerrechnung(d, erste));
    await imDienst((d) => verwerfe(d, erste, 'Falsche Leistungsbeschreibung'));

    const zweite = await entwurf({ auftrag, art: 'schluss', netto: 3_000_000n });
    await imDienst((d) => schreibeVerrechnung(d, zweite));
    expect((await kopf(zweite)).abzug).toBe('1190000');
    const [alt] = await sql.unsafe<{ n: string }[]>(
      `select count(*) filter (where wirksam)::text as n from abschlagsrechnung_bezug
        where schluss_rechnung_id = $1`, [erste]);
    expect(alt!.n).toBe('0');
  });
});

describe('§5 die Abrechnungsart rechnet auf einer Rechnung (V-206, FIN-01)', () => {
  async function pauschalAuftrag(): Promise<string> {
    const auftrag = await legeAuftragAn(kundeId);
    await sql.unsafe(
      `insert into vertrag_abrechnung
         (mandant_id, auftrag_id, abrechnungsart, parameter, pauschale_netto_cent,
          abrechnungsintervall, leistungszeitraum_modus, gueltig_ab)
       values ($1,$2,'monatspauschale','{"teilmonat":"keine"}'::jsonb,240000,
               'monatlich','kalendermonat','2026-01-01')`,
      [f.reinigung, auftrag] as never[]);
    /* Der Steuersatz der Pauschale kommt aus der Vertragszeile des Auftrags. */
    await sql.unsafe(
      `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung, einheit,
                                     einzelpreis_cent, steuersatz_bp, steuer_kennzeichen,
                                     gueltig_ab)
       values ($1,$2,1,'Unterhaltsreinigung pauschal','psch',240000,1900,'regelsatz',
               '2026-01-01')`,
      [f.reinigung, auftrag] as never[]);
    return auftrag;
  }

  it('Vorschau und Übernahme zeigen dieselbe Zeile — mit lesbarer Herkunft', async () => {
    const auftrag = await pauschalAuftrag();
    const id = await imDienst((d) => legeEntwurfAn(d, {
      kundeId, auftragId: auftrag, leistungVon: '2026-08-01', leistungBis: '2026-08-31',
      zahlungszielTage: 30,
    }));
    const vorschau = await imDienst((d) => vorschauAbrechnungsart(d, id));
    expect(vorschau.grund).toBeNull();
    expect(vorschau.art?.schluessel).toBe('monatspauschale');
    expect(vorschau.positionen.map((p) => p.nettoCent)).toEqual([240_000n]);

    const { positionIds } = await imDienst((d) => uebernimmAbrechnungsart(d, id, {}));
    expect(positionIds).toHaveLength(1);
    const [zeile] = await sql.unsafe<{ netto: string; notiz: string | null }[]>(
      `select p.netto_cent::text as netto, q.notiz
         from rechnungsposition p
         join rechnungsposition_quelle q on q.rechnungsposition_id = p.id
        where p.rechnung_id = $1`, [id]);
    expect(zeile!.netto).toBe('240000');
    /* Die Herkunft steht auf dem Blatt: Art beim Namen, Tage deutsch, keine Kennung. */
    expect(zeile!.notiz).toMatch(/01\.08\.2026 bis 31\.08\.2026/u);
    expect(zeile!.notiz).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u);

    const zweimal = await fehlerVon(imDienst((d) => uebernimmAbrechnungsart(d, id, {})));
    expect(zweimal?.grund).toBe('schon_uebernommen');
    expect((await imDienst((d) => vorschauAbrechnungsart(d, id))).schonUebernommen).toBe(1);
  });

  it('ohne Auftrag oder ohne Zeitraum rechnet nichts — und es entsteht keine Zeile', async () => {
    const ohneAuftrag = await entwurf();
    expect((await fehlerVon(imDienst((d) => uebernimmAbrechnungsart(d, ohneAuftrag, {}))))
      ?.grund).toBe('auftrag_passt_nicht');

    const auftrag = await pauschalAuftrag();
    const ohneZeitraum = await entwurf({ auftrag, von: null, bis: null });
    expect((await fehlerVon(imDienst((d) => uebernimmAbrechnungsart(d, ohneZeitraum, {}))))
      ?.grund).toBe('leistungszeitpunkt_fehlt');
    const vorschau = await imDienst((d) => vorschauAbrechnungsart(d, ohneZeitraum));
    expect(vorschau.grund).toBe('leistungszeitpunkt_fehlt');
  });

  it('ohne hinterlegte Art gibt es keinen Vorgabewert (FIN-01, O-04)', async () => {
    const id = await entwurf({ auftrag: auftragId });
    const fehler = await fehlerVon(imDienst((d) => uebernimmAbrechnungsart(d, id, {})));
    expect(fehler?.grund).toBe('keine_abrechnungsart');
    const n = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from rechnungsposition where rechnung_id = $1`, [id]);
    expect(n[0]!.n).toBe('1');
  });

  it('eine Leistungszeile eines anderen Auftrags wird abgewiesen', async () => {
    const auftrag = await pauschalAuftrag();
    const id = await entwurf({ auftrag });
    const fehler = await fehlerVon(imDienst((d) =>
      uebernimmAbrechnungsart(d, id, { auftragLeistungId: leistungId })));
    expect(fehler?.grund).toBe('auftrag_passt_nicht');
  });
});

describe('§6 Material aus einer Ausgabe (V-206, FIN-07)', () => {
  let kategorie = '';

  async function beleg(): Promise<string> {
    const schluessel = `mandant/${f.reinigung}/beleg/${zufall()}.pdf`;
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                             mime_verifiziert, groesse_bytes, entstanden_am, exif_entfernt)
       values ($1,'buchhaltung','Lieferschein',$2,'application/pdf',true,2048,'2026-08-04',true)
       returning id`, [f.reinigung, schluessel]);
    const hash = `${zufall()}${zufall()}`.padEnd(64, 'a').replace(/[^0-9a-f]/gu, 'b');
    const [v] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ)
       values ($1,$2,1,$3,$4,2048,'application/pdf') returning id`,
      [f.reinigung, d!.id, schluessel, hash]);
    const [b] = await sql.unsafe<{ id: string }[]>(
      `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                          dokument_version_id, datei_sha256, seiten, belegdatum,
                          betrag_brutto_cent, erstellt_von_art, erstellt_von)
       values ($1,$2,'kassenbeleg','scan',$3,$4,$5,1,'2026-08-04',11900,'mensch',$6)
       returning id`,
      [f.reinigung, `B-${zufall()}`, d!.id, v!.id, hash, benutzer]);
    return b!.id;
  }

  async function ausgabe(
    { weiter = true, status = 'freigegeben', auftrag = null }:
    { weiter?: boolean; status?: string; auftrag?: string | null } = {},
  ): Promise<string> {
    if (kategorie === '') {
      kategorie = (await sql.unsafe<{ id: string }[]>(
        `insert into ausgabe_kategorie (mandant_id, schluessel, bezeichnung,
                                        erstellt_von_art, erstellt_von)
         values ($1,$2,'Material','mensch',$3) returning id`,
        [f.reinigung, `material-${zufall()}`, benutzer]))[0]!.id;
    }
    const belegId = status === 'erfasst' ? null : await beleg();
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into ausgabe (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
                            netto_cent, steuer_cent, brutto_cent, zahlungsmittel,
                            beleg_id, weiterberechenbar, status, auftrag_id,
                            freigegeben_von, freigegeben_am, erstellt_von_art, erstellt_von)
       values ($1,$2,'Reinigungsmittel Sonderposten','2026-08-04',10000,1900,11900,'karte',
               $3,$4,$5::ausgabe_status,$6::uuid,
               case when $5 in ('freigegeben','gebucht') then $7::uuid end,
               case when $5 in ('freigegeben','gebucht') then now() end,
               'mensch',$7)
       returning id`,
      [f.reinigung, kategorie, belegId, weiter, status, auftrag, benutzer] as never[]);
    return a!.id;
  }

  const zeile = (rechnungId: string, ausgabeId: string) => ({
    rechnungId, ausgabeId, bezeichnung: 'Reinigungsmittel, weiterberechnet',
    menge: milliMenge(1000n), einheit: 'psch', einzelpreisCent: cent(12_500n),
    steuergruppe: 'ust_19',
  });

  it('eine freigegebene, weiterberechenbare Ausgabe wird Materialzeile — genau einmal', async () => {
    const id = await entwurf({ auftrag: auftragId });
    const a = await ausgabe({ auftrag: auftragId });
    const angeboten = await imDienst((d) => weiterberechenbareAusgaben(d, id)).then((x) => x.ausgaben);
    expect(angeboten.map((x) => x.id)).toContain(a);

    await imDienst((d) => fuegeMaterialPositionHinzu(d, zeile(id, a)));
    const [q] = await sql.unsafe<{ typ: string; netto: string }[]>(
      `select q.quelle_typ::text as typ, p.netto_cent::text as netto
         from rechnungsposition_quelle q
         join rechnungsposition p on p.id = q.rechnungsposition_id
        where q.ausgabe_id = $1`, [a]);
    /* Der Preis ist die Eingabe des Menschen (O-931) — nicht der Einstand von 100,00 €. */
    expect(q).toEqual({ typ: 'material', netto: '12500' });

    const zweites = await entwurf({ auftrag: auftragId });
    expect((await imDienst((d) => weiterberechenbareAusgaben(d, zweites))).ausgaben.map((x) => x.id))
      .not.toContain(a);
    const fehler = await fehlerVon(imDienst((d) =>
      fuegeMaterialPositionHinzu(d, zeile(zweites, a))));
    expect(fehler?.grund).toBe('schon_abgerechnet');
  });

  it('nicht weiterberechenbar, nicht freigegeben oder ein anderer Auftrag: abgewiesen', async () => {
    const id = await entwurf({ auftrag: auftragId });
    const nichtWeiter = await ausgabe({ weiter: false });
    const erfasst = await ausgabe({ status: 'erfasst' });
    const fremd = await ausgabe({ auftrag: await legeAuftragAn(kundeId) });
    for (const a of [nichtWeiter, erfasst, fremd]) {
      const fehler = await fehlerVon(imDienst((d) => fuegeMaterialPositionHinzu(d, zeile(id, a))));
      expect(fehler?.grund).toBe('quelle_passt_nicht');
    }
    const angeboten = (await imDienst((d) => weiterberechenbareAusgaben(d, id)))
      .ausgaben.map((x) => x.id);
    expect(angeboten).not.toContain(nichtWeiter);
    expect(angeboten).not.toContain(erfasst);
    expect(angeboten).not.toContain(fremd);
  });

  it('erst prüfen, dann begrenzen: 250 neuere FREMDE Ausgaben verdrängen die alte passende '
    + 'nicht (V-208)', async () => {
    const id = await entwurf({ auftrag: auftragId });
    const alt = await ausgabe({ auftrag: auftragId });
    await sql.unsafe(`update ausgabe set ausgabedatum = '2026-01-05' where id = $1`, [alt]);
    /* 250 neuere, weiterberechenbare Ausgaben am Auftrag eines ANDEREN Kunden. */
    const fremd = await legeAuftragAn(fremderKundeId);
    const vorlage = await ausgabe({ auftrag: fremd });
    await sql.unsafe(
      `insert into ausgabe (mandant_id, kategorie_id, bezeichnung, ausgabedatum, netto_cent,
                            steuer_cent, brutto_cent, zahlungsmittel, beleg_id,
                            weiterberechenbar, status, auftrag_id, freigegeben_von,
                            freigegeben_am, erstellt_von_art, erstellt_von)
       select v.mandant_id, v.kategorie_id, 'Fremdes Material ' || g, date '2026-09-01' + g % 20,
              v.netto_cent, v.steuer_cent, v.brutto_cent, v.zahlungsmittel, v.beleg_id,
              true, v.status, v.auftrag_id, v.freigegeben_von, v.freigegeben_am,
              'mensch', v.erstellt_von
         from ausgabe v, generate_series(1, 250) g
        where v.id = $1`, [vorlage]);

    const angebot = await imDienst((d) => weiterberechenbareAusgaben(d, id));
    expect(angebot.ausgaben.map((x) => x.id)).toContain(alt);
    expect(angebot.ausgaben.map((x) => x.id)).not.toContain(vorlage);
    expect(angebot.abgeschnitten).toBe(false);
  });

  it('ein Bezug, den der Mensch nicht sieht, passt nie — statt „kein Kunde" (V-208)', async () => {
    /* Eine Ausgabe am Auftrag eines ANDEREN Kunden. */
    const fremd = await ausgabe({ auftrag: await legeAuftragAn(fremderKundeId) });
    const id = await entwurf();

    const email = `buchhaltung-ohne-auftrag-${zufall()}@cse.test`;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,$2,'Buchhaltung','aktiv')`,
      [u!.id, email]);
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
       values ($1, $2, $2, 'mandant', 'intern') returning id`,
      [f.reinigung, `ohne_auftrag_${zufall()}`]);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
      [r!.id, f.reinigung, ['finanzen.lesen', 'finanzen.schreiben', 'eingang.lesen']]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
       values ($1,$2,$3,current_date - 1)`, [u!.id, f.reinigung, r!.id]);
    const ohneAuftrag = <T,>(fn: (d: Abfrage) => Promise<T>): Promise<T> => alsApp({
      scope: 'mandant', mandantId: f.reinigung, benutzerId: u!.id, portal: 'intern',
      readonly: false,
    }, (tx) => fn(alsDienst(tx))) as Promise<T>;

    const angebot = await ohneAuftrag((d) => weiterberechenbareAusgaben(d, id));
    expect(angebot.ausgaben.map((x) => x.id)).not.toContain(fremd);
    expect(angebot.verdeckt).toBeGreaterThan(0);
    const fehler = await fehlerVon(ohneAuftrag((d) => fuegeMaterialPositionHinzu(d, zeile(id, fremd))));
    expect(fehler?.grund).toBe('quelle_passt_nicht');
    expect(fehler?.message).toMatch(/nicht sehen/u);
  });

  it('nach einem Storno ist die Ausgabe wieder frei (Invariante 8: die Zeile bleibt)', async () => {
    const id = await entwurf({ auftrag: auftragId });
    const a = await ausgabe({ auftrag: auftragId });
    await imDienst((d) => fuegeMaterialPositionHinzu(d, zeile(id, a)));
    await festschreiben(id);
    await imDienst((d) => storniere(d, id, 'Falscher Leistungsempfänger im Kopf der Rechnung'));
    const zweites = await entwurf({ auftrag: auftragId });
    await imDienst((d) => fuegeMaterialPositionHinzu(d, zeile(zweites, a)));
    const zeilen = await sql.unsafe<{ wirksam: boolean }[]>(
      `select wirksam from rechnungsposition_quelle where ausgabe_id = $1
        order by erstellt_am`, [a]);
    expect(zeilen.map((z) => z.wirksam)).toContain(true);
    expect(zeilen.length).toBeGreaterThanOrEqual(2);
  });
});

describe('§7 dieselbe Vereinbarung auf zwei Belegen (V-207, D-700)', () => {
  /** Ein Auftrag mit EINER Vereinbarung und einer Vertragszeile für den Satz. */
  async function vereinbarung(
    art: 'monatspauschale' | 'festpreis_los', parameter: Record<string, string>,
  ): Promise<string> {
    const auftrag = await legeAuftragAn(kundeId);
    const pauschal = art === 'monatspauschale';
    await sql.unsafe(
      `insert into vertrag_abrechnung
         (mandant_id, auftrag_id, abrechnungsart, parameter, pauschale_netto_cent,
          festpreis_netto_cent, abrechnungsintervall, leistungszeitraum_modus, gueltig_ab)
       values ($1,$2,$3::abrechnungsart,($4::text)::jsonb,$5::bigint,$6::bigint,
               $7::abrechnungsintervall,$8::leistungszeitraum_modus,'2026-01-01')`,
      [f.reinigung, auftrag, art, JSON.stringify(parameter),
       pauschal ? 240_000 : null, pauschal ? null : 1_000_000,
       pauschal ? 'monatlich' : 'einmalig', pauschal ? 'kalendermonat' : 'manuell'] as never[]);
    await sql.unsafe(
      `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung, einheit,
                                     einzelpreis_cent, steuersatz_bp, steuer_kennzeichen,
                                     gueltig_ab)
       values ($1,$2,1,'Leistung laut Vereinbarung','psch',240000,1900,'regelsatz',
               '2026-01-01')`,
      [f.reinigung, auftrag] as never[]);
    return auftrag;
  }

  /** Ein leerer Entwurf am Auftrag — ohne Zeile von Hand. */
  async function leer(
    auftrag: string, von: string, bis: string, art: EntwurfRechnungsart = 'standard',
  ): Promise<string> {
    return imDienst((d) => legeEntwurfAn(d, {
      kundeId, auftragId: auftrag, rechnungsart: art, leistungVon: von, leistungBis: bis,
      zahlungszielTage: 30,
    }));
  }

  async function netto(rechnungId: string): Promise<readonly string[]> {
    return (await sql.unsafe<{ n: string }[]>(
      `select netto_cent::text as n from rechnungsposition where rechnung_id = $1
        order by position_nr`, [rechnungId])).map((z) => z.n);
  }

  it('Monatspauschale: derselbe August auf einer zweiten Rechnung wird abgewiesen — '
    + 'der September nicht, und nach dem Storno ist der August wieder frei', async () => {
    const auftrag = await vereinbarung('monatspauschale', { teilmonat: 'keine' });
    const a = await leer(auftrag, '2026-08-01', '2026-08-31');
    await imDienst((d) => uebernimmAbrechnungsart(d, a, {}));
    const nummerA = await festschreiben(a);

    const b = await leer(auftrag, '2026-08-01', '2026-08-31');
    const vorschau = await imDienst((d) => vorschauAbrechnungsart(d, b));
    expect(vorschau.positionen).toEqual([]);
    expect(vorschau.bisherAnderswo.map((x) => x.nummer)).toEqual([nummerA]);
    const befund = vorschau.befunde.find((x) => x.art === 'fehler');
    expect(befund?.textDe).toContain(nummerA);
    expect(befund?.textDe).toMatch(/01\.08\.2026 bis 31\.08\.2026/u);
    const fehler = await fehlerVon(imDienst((d) => uebernimmAbrechnungsart(d, b, {})));
    expect(fehler?.grund).toBe('befund_blockiert');
    expect(await netto(b)).toEqual([]);

    /* Juli bis September: der August steckt mittendrin — die ganze Übernahme hält an. */
    const quartal = await leer(auftrag, '2026-07-01', '2026-09-30');
    expect((await fehlerVon(imDienst((d) => uebernimmAbrechnungsart(d, quartal, {}))))?.grund)
      .toBe('befund_blockiert');
    expect(await netto(quartal)).toEqual([]);

    const september = await leer(auftrag, '2026-09-01', '2026-09-30');
    await imDienst((d) => uebernimmAbrechnungsart(d, september, {}));
    expect(await netto(september)).toEqual(['240000']);

    await imDienst((d) => storniere(d, a, 'Pauschale mit falschem Leistungsempfänger'));
    await imDienst((d) => uebernimmAbrechnungsart(d, b, {}));
    expect(await netto(b)).toEqual(['240000']);
  });

  it('„teilmonat = keine": zwei Hälften desselben Monats sind nicht zwei Pauschalen', async () => {
    const auftrag = await vereinbarung('monatspauschale', { teilmonat: 'keine' });
    const ersteHaelfte = await leer(auftrag, '2026-10-01', '2026-10-15');
    await imDienst((d) => uebernimmAbrechnungsart(d, ersteHaelfte, {}));
    expect(await netto(ersteHaelfte)).toEqual(['240000']);
    const zweiteHaelfte = await leer(auftrag, '2026-10-16', '2026-10-31');
    expect((await fehlerVon(imDienst((d) =>
      uebernimmAbrechnungsart(d, zweiteHaelfte, {}))))?.grund).toBe('befund_blockiert');
  });

  it('anteilig nach Kalendertagen deckt nur seine Tage — die zweite Hälfte bleibt abrechenbar',
    async () => {
      const auftrag = await vereinbarung('monatspauschale', { teilmonat: 'kalendertage' });
      const ersteHaelfte = await leer(auftrag, '2026-11-01', '2026-11-15');
      await imDienst((d) => uebernimmAbrechnungsart(d, ersteHaelfte, {}));
      const zweiteHaelfte = await leer(auftrag, '2026-11-16', '2026-11-30');
      await imDienst((d) => uebernimmAbrechnungsart(d, zweiteHaelfte, {}));
      /* 15/30 und 15/30 von 2.400,00 € — zusammen genau eine Pauschale. */
      expect([...await netto(ersteHaelfte), ...await netto(zweiteHaelfte)])
        .toEqual(['120000', '120000']);
      const nochmal = await leer(auftrag, '2026-11-10', '2026-11-20');
      expect((await fehlerVon(imDienst((d) => uebernimmAbrechnungsart(d, nochmal, {}))))
        ?.grund).toBe('befund_blockiert');
    });

  it('ein ENTWURF beansprucht den Monat schon — verworfen gibt er ihn frei', async () => {
    const auftrag = await vereinbarung('monatspauschale', { teilmonat: 'keine' });
    const erster = await leer(auftrag, '2026-12-01', '2026-12-31');
    await imDienst((d) => uebernimmAbrechnungsart(d, erster, {}));
    const zweiter = await leer(auftrag, '2026-12-01', '2026-12-31');
    const vorschau = await imDienst((d) => vorschauAbrechnungsart(d, zweiter));
    expect(vorschau.bisherAnderswo.map((x) => x.nummer)).toEqual([null]);
    expect(vorschau.befunde.find((x) => x.art === 'fehler')?.textDe).toMatch(/Entwurf vom/u);

    await imDienst((d) => verwerfe(d, erster, 'Doppelt angelegt'));
    await imDienst((d) => uebernimmAbrechnungsart(d, zweiter, {}));
    expect(await netto(zweiter)).toEqual(['240000']);
    /* Die Zeile des verworfenen Entwurfs steht noch da (Invariante 8) — unwirksam. */
    const alt = await sql.unsafe<{ wirksam: boolean }[]>(
      `select q.wirksam from rechnungsposition_quelle q where q.rechnung_id = $1`, [erster]);
    expect(alt.map((z) => z.wirksam)).toEqual([false]);
  });

  it('verwerfen darf auch, wer nur das Verwerfen hält — und die Ansprüche werden frei (0442)',
    async () => {
      const auftrag = await vereinbarung('monatspauschale', { teilmonat: 'keine' });
      const entwurfId = await leer(auftrag, '2027-01-01', '2027-01-31');
      await imDienst((d) => uebernimmAbrechnungsart(d, entwurfId, {}));

      const email = `verwerfen-${zufall()}@cse.test`;
      const [u] = await sql.unsafe<{ id: string }[]>(
        `insert into auth.users (email) values ($1) returning id`, [email]);
      await sql.unsafe(
        `insert into benutzer (id, email, name, status) values ($1,$2,'Leitung','aktiv')`,
        [u!.id, email]);
      const [r] = await sql.unsafe<{ id: string }[]>(
        `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
         values ($1, $2, $2, 'mandant', 'intern') returning id`,
        [f.reinigung, `nur_verwerfen_${zufall()}`]);
      await sql.unsafe(
        `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
         select $1, b.id, $2, true from berechtigung b
          where b.schluessel = any($3::text[])`,
        [r!.id, f.reinigung, ['finanzen.lesen', 'finanzen.entwurf_verwerfen']]);
      await sql.unsafe(
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
         values ($1,$2,$3,current_date - 1)`, [u!.id, f.reinigung, r!.id]);

      await alsApp({
        scope: 'mandant', mandantId: f.reinigung, benutzerId: u!.id, portal: 'intern',
        readonly: false,
      }, (tx) => verwerfe(alsDienst(tx), entwurfId, 'Kunde hat gekündigt'));

      expect((await kopf(entwurfId)).status).toBe('verworfen');
      const quellen = await sql.unsafe<{ wirksam: boolean }[]>(
        `select wirksam from rechnungsposition_quelle where rechnung_id = $1`, [entwurfId]);
      expect(quellen.map((q) => q.wirksam)).toEqual([false]);
      const neu = await leer(auftrag, '2027-01-01', '2027-01-31');
      await imDienst((d) => uebernimmAbrechnungsart(d, neu, {}));
      expect(await netto(neu)).toEqual(['240000']);
    });

  it('Festpreis-Los nach Abnahme: EINMAL — auch nicht auf einer Rechnung für später', async () => {
    const auftrag = await vereinbarung('festpreis_los', { teilleistung: 'erst_bei_abnahme' });
    await sql.unsafe(`update auftrag set abnahme_am = '2026-08-15' where id = $1`, [auftrag]);
    const august = await leer(auftrag, '2026-08-01', '2026-08-31');
    await imDienst((d) => uebernimmAbrechnungsart(d, august, {}));
    expect(await netto(august)).toEqual(['1000000']);
    const nummer = await festschreiben(august);

    const september = await leer(auftrag, '2026-09-01', '2026-09-30');
    const vorschau = await imDienst((d) => vorschauAbrechnungsart(d, september));
    expect(vorschau.befunde.find((x) => x.art === 'fehler')?.textDe).toContain(nummer);
    expect((await fehlerVon(imDienst((d) => uebernimmAbrechnungsart(d, september, {}))))
      ?.grund).toBe('befund_blockiert');
    expect(await netto(september)).toEqual([]);
  });

  it('Festpreis-Los anteilig: der Grad ist der Gesamtstand — 30 %, dann 60 %, dann 100 % '
    + 'ergeben zusammen genau den Festpreis', async () => {
    const auftrag = await vereinbarung('festpreis_los', { teilleistung: 'anteilig' });
    const erste = await leer(auftrag, '2026-06-01', '2026-06-30');
    await imDienst((d) => uebernimmAbrechnungsart(d, erste, { fertigstellungBp: 3000 }));
    const zweite = await leer(auftrag, '2026-07-01', '2026-07-31');
    await imDienst((d) => uebernimmAbrechnungsart(d, zweite, { fertigstellungBp: 6000 }));
    expect([...await netto(erste), ...await netto(zweite)]).toEqual(['300000', '300000']);

    /* Kein Zuwachs: 50 % sind weniger als die berechneten 60 % — keine Zeile. */
    const rueckschritt = await leer(auftrag, '2026-08-01', '2026-08-31');
    const fehler = await fehlerVon(imDienst((d) =>
      uebernimmAbrechnungsart(d, rueckschritt, { fertigstellungBp: 5000 })));
    expect(fehler?.grund).toBe('befund_blockiert');
    expect(fehler?.message).toMatch(/Gesamtstand/u);
    expect(await netto(rueckschritt)).toEqual([]);

    await imDienst((d) => uebernimmAbrechnungsart(d, rueckschritt, { fertigstellungBp: 10_000 }));
    expect(await netto(rueckschritt)).toEqual(['400000']);
    const summe = (await sql.unsafe<{ s: string }[]>(
      `select sum(p.netto_cent)::text as s from rechnungsposition p
         join vertrag_abrechnung v on v.id = p.vertrag_abrechnung_id
        where v.auftrag_id = $1`, [auftrag]))[0]!.s;
    expect(summe).toBe('1000000');
  });

  it('eine Schlussrechnung führt die Gesamtleistung — die Abschläge zieht sie ab, '
    + 'statt sie wegzulassen (FIN-08)', async () => {
    const auftrag = await vereinbarung('festpreis_los', { teilleistung: 'anteilig' });
    const abschlag = await leer(auftrag, '2026-05-01', '2026-05-31', 'abschlag');
    await imDienst((d) => uebernimmAbrechnungsart(d, abschlag, { fertigstellungBp: 4000 }));
    await festschreiben(abschlag);

    /* Ein zweiter Abschlag sieht den ersten: 70 % Gesamtstand ergeben 30 % neu. */
    const zweiterAbschlag = await leer(auftrag, '2026-06-01', '2026-06-30', 'abschlag');
    await imDienst((d) =>
      uebernimmAbrechnungsart(d, zweiterAbschlag, { fertigstellungBp: 7000 }));
    expect(await netto(zweiterAbschlag)).toEqual(['300000']);
    await festschreiben(zweiterAbschlag);

    const schluss = await leer(auftrag, '2026-05-01', '2026-07-31', 'schluss');
    expect((await imDienst((d) => vorschauAbrechnungsart(d, schluss))).bisherAnderswo)
      .toEqual([]);
    await imDienst((d) => uebernimmAbrechnungsart(d, schluss, { fertigstellungBp: 10_000 }));
    expect(await netto(schluss)).toEqual(['1000000']);
    await imDienst((d) => schreibeVerrechnung(d, schluss));
    /* Zahlbetrag: 11.900,00 € brutto minus 4.760,00 € und 3.570,00 € Abschläge. */
    expect((await kopf(schluss)).zahlbetrag).toBe(String(1_190_000 - 476_000 - 357_000));

    /* Eine STANDARDrechnung danach sieht alles: 100 % sind längst berechnet. */
    const danach = await leer(auftrag, '2026-08-01', '2026-08-31');
    expect((await fehlerVon(imDienst((d) =>
      uebernimmAbrechnungsart(d, danach, { fertigstellungBp: 10_000 }))))?.grund)
      .toBe('befund_blockiert');
  });
});
