/**
 * PR 56 — das Rechnungsausgangsbuch (FIN-16, FIN-06, LEG-01).
 *
 * Die vier Sätze, die eine Betriebsprüfung hier liest:
 *
 *  1. Die Folge je Kreis ist lückenlos und geordnet, und die Summe des Buches
 *     ist die Summe der Belege — auf den Cent, zweimal unabhängig gebildet.
 *  2. **Ein Entwurf steht NICHT darin.** Er hat keine Nummer und keine
 *     rechtliche Existenz; ein verworfener bewegt deshalb auch keine Zahl.
 *  3. Ein Storno steht als EIGENE Zeile mit negativem Betrag, und die
 *     ursprüngliche Rechnung bleibt Zeichen für Zeichen, wie sie war.
 *  4. Der Kundenname stammt aus dem eingefrorenen Beleg (K-12): eine spätere
 *     Umbenennung ändert das Buch nicht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, storniere, verwerfe, vonHand,
  type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { leseAusgangsbuch, stimmeAb } from '../../src/server/services/finanz/ausgangsbuch.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

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

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

async function macheFakturierfaehig(mandantId: string): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            telefon = '+49 30 5550100', email = 'rechnung@cse.test',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            iban = 'DE02120300000000202051'
      where id = $1`, [mandantId]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

async function entwurf(preisCent = 100_000n): Promise<string> {
  return alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(preisCent), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [id] as never[]);
    return id;
  });
}

async function festgeschrieben(preisCent = 100_000n): Promise<string> {
  const id = await entwurf(preisCent);
  await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));
  return id;
}

function buch() {
  return alsApp(sitzung(), async (tx) => leseAusgangsbuch(alsDienst(tx)));
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'firma','Beispiel GmbH','Musterweg','7','10178','Berlin') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) Lückenlos, geordnet, und die Summe stimmt zweimal', () => {
  it('drei Rechnungen ergeben drei Zeilen in Nummernfolge', async () => {
    await festgeschrieben(100_000n);
    await festgeschrieben(200_000n);
    await festgeschrieben(300_000n);

    const zeilen = await buch();
    expect(zeilen.map((z) => z.nummer)).toEqual(['RE-00001', 'RE-00002', 'RE-00003']);
    expect(zeilen.map((z) => z.nummerLaufend)).toEqual([1, 2, 3]);
    /*
     * **`toEqual([false, false, false])` und NICHT `every(z => !z.luecke)`.**
     *
     * Genau das ist die Falle, vor der §10 warnt: ohne `coalesce` ist
     * `luecke` auf der ERSTEN Zeile jeder Gruppe NULL, nicht false — und
     * `!null` ist true. Die schwache Fassung dieser Prüfung lief grün durch,
     * als der `coalesce` zum Versuch aus der Sicht entfernt wurde. Sie prüfte
     * „nicht wahr", die Zusage lautet aber „falsch".
     */
    expect(zeilen.map((z) => z.luecke)).toEqual([false, false, false]);
    // Jede Zeile trägt ihr Kettenglied — sonst ist der Beleg nicht bezeugt.
    expect(zeilen.every((z) => z.hash !== null && z.kettePosition !== null)).toBe(true);
  });

  it('die Abstimmung sagt „ok" und nennt Spanne und Summe', async () => {
    await festgeschrieben(100_000n);   // 1.190,00 brutto
    await festgeschrieben(200_000n);   // 2.380,00 brutto

    const ab = await alsApp(sitzung(), async (tx) => stimmeAb(alsDienst(tx)));
    expect(ab.ok).toBe(true);
    expect(ab.kreise).toHaveLength(1);
    expect(ab.kreise[0]!.anzahl).toBe(2);
    expect(ab.kreise[0]!.ersteNummer).toBe(1);
    expect(ab.kreise[0]!.letzteNummer).toBe(2);
    expect(ab.kreise[0]!.summeBuchCent).toBe(357_000n);
    /*
     * Der zweite, unabhängige Weg: dieselbe Zahl aus der Belegtabelle, ohne
     * die Sicht. Weichen sie ab, liegt der Fehler in der Sicht — und den
     * findet sonst niemand, weil eine falsche Sicht plausible Zahlen zeigt.
     */
    expect(ab.kreise[0]!.summeBelegeCent).toBe(ab.kreise[0]!.summeBuchCent);
    expect(ab.kreise[0]!.luecken).toEqual([]);
    expect(ab.kreise[0]!.ohneKettenglied).toBe(0);
  });

  /**
   * **Wie eine Lücke überhaupt entstehen kann — und wie nicht.**
   *
   * Eine festgeschriebene Rechnung lässt sich nicht mehr verwerfen (0076
   * weist `festgeschrieben → verworfen` ab), und löschen lässt sie sich auch
   * nicht (Invariante 8). Der einzige verbleibende Weg zu einer Lücke ist der
   * ZÄHLER: wer `naechste_nummer` vorstellt, überspringt eine Nummer, ohne
   * dass irgendein Beleg sich bewegt. Genau dafür gibt es dieses Buch — und
   * genau das wird hier nachgestellt.
   */
  it('eine übersprungene Nummer wird benannt', async () => {
    await festgeschrieben();
    await sql.unsafe(
      `update nummernkreis set naechste_nummer = naechste_nummer + 1
        where kreis_typ = 'ausgangsrechnung' and mandant_id = $1`, [f.reinigung]);
    await festgeschrieben();

    const zeilen = await buch();
    expect(zeilen.map((z) => z.nummerLaufend)).toEqual([1, 3]);
    expect(zeilen[0]!.luecke).toBe(false);
    expect(zeilen[1]!.luecke, 'Nummer 2 fehlt — das muss auffallen').toBe(true);

    const ab = await alsApp(sitzung(), async (tx) => stimmeAb(alsDienst(tx)));
    expect(ab.ok).toBe(false);
    expect(ab.kreise[0]!.luecken).toContain(3);
  });
});

describe('(2) Ein Entwurf steht nicht im Buch — und bewegt keine Zahl', () => {
  it('der Entwurf fehlt, die festgeschriebene Rechnung steht da', async () => {
    await entwurf();
    const nurEntwuerfe = await buch();
    expect(nurEntwuerfe).toHaveLength(0);

    await festgeschrieben();
    const zeilen = await buch();
    expect(zeilen).toHaveLength(1);

    /*
     * **Und die Eigenschaft, die dahintersteht, ausdrücklich.**
     *
     * Ein Entwurf hat keinen Nummernkreis, also fällt er schon am Join heraus
     * — die `where`-Bedingung der Sicht ist zweite Sicherung, nicht erste.
     * Eine Prüfung, die nur zählt, liefe deshalb auch dann grün, wenn beides
     * wegfiele und stattdessen ein LEFT JOIN dastünde. Geprüft wird darum,
     * was das Buch ZUSAGT: jede Zeile trägt eine Nummer und ein Kettenglied.
     */
    for (const z of zeilen) {
      expect(z.nummer, 'eine Zeile ohne Nummer gehört nicht ins Buch').toBeTruthy();
      expect(z.kettePosition).not.toBeNull();
    }
  });

  it('und ein VERWORFENER Entwurf ändert die Summe um keinen Cent', async () => {
    await festgeschrieben(100_000n);
    const vorher = await alsApp(sitzung(), async (tx) => stimmeAb(alsDienst(tx)));

    const weg = await entwurf(999_999n);
    await alsApp(sitzung(), async (tx) =>
      verwerfe(alsDienst(tx), weg, 'Kunde hat den Auftrag zurückgezogen.'));

    const nachher = await alsApp(sitzung(), async (tx) => stimmeAb(alsDienst(tx)));
    expect(nachher.kreise[0]!.summeBuchCent).toBe(vorher.kreise[0]!.summeBuchCent);
    expect(nachher.kreise[0]!.anzahl).toBe(vorher.kreise[0]!.anzahl);
    expect(nachher.ok).toBe(true);
  });
});

describe('(3) Ein Storno ist eine eigene Zeile — die alte bleibt, wie sie war', () => {
  it('das Original bleibt unverändert, der Storno steht daneben und ist negativ',
    async () => {
      const id = await festgeschrieben(100_000n);
      const vorher = (await buch())[0]!;

      await alsApp(sitzung(), async (tx) =>
        storniere(alsDienst(tx), id, 'Leistung wurde nicht erbracht.'));

      const zeilen = await buch();
      expect(zeilen.length).toBeGreaterThanOrEqual(2);

      const original = zeilen.find((z) => z.rechnungId === id)!;
      expect(original.bruttoCent).toBe(vorher.bruttoCent);
      expect(original.hash).toBe(vorher.hash);
      expect(original.storniert).toBe(true);

      const storno = zeilen.find((z) => z.rechnungsart === 'storno')!;
      expect(storno.bruttoCent).toBe(-vorher.bruttoCent);

      // Und die Summe des Buches ist danach null — der Vorgang hebt sich auf.
      const ab = await alsApp(sitzung(), async (tx) => stimmeAb(alsDienst(tx)));
      expect(ab.kreise[0]!.summeBuchCent).toBe(0n);
      expect(ab.ok).toBe(true);
    });
});

describe('(4) Der Name stammt vom BELEG, nicht vom Stammsatz (K-12)', () => {
  it('eine spätere Umbenennung des Kunden ändert das Buch nicht', async () => {
    await festgeschrieben();
    expect((await buch())[0]!.kundeName).toBe('Beispiel GmbH');

    await sql.unsafe(`update kunde set name = 'Ganz anders AG' where id = $1`, [kundeId]);

    /*
     * Das ist die ganze Aussage von K-12. Läse das Buch den Stammsatz, änderte
     * sich ein zehn Jahre aufzubewahrender Beleg rückwirkend — und die
     * Hashkette meldete weiter „intakt", weil die Rechnung selbst sich nicht
     * bewegt hat.
     */
    expect((await buch())[0]!.kundeName).toBe('Beispiel GmbH');
  });

  it('ein fremder Mandant sieht das Buch nicht', async () => {
    await festgeschrieben();
    const fremd = await alsApp(
      { ...sitzung(), mandantId: f.security },
      async (tx) => leseAusgangsbuch(alsDienst(tx)));
    expect(fremd).toHaveLength(0);
  });
});
