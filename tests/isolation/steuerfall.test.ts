/**
 * PR 51 — §13b UStG und §48 EStG gegen eine echte Datenbank (FIN-09, FIN-10).
 *
 * Die reinen Entscheidungen stehen in `tests/kern/steuerfall.test.ts`. Hier
 * stehen die drei Aussagen, die nur die Datenbank halten kann: dass ein
 * §13b-Status keine überlappenden Zeiträume haben KANN, dass ein Reverse
 * Charge ohne Nachweis abgewiesen WIRD — auch an der Anwendung vorbei —, und
 * dass die beiden Regeln zusammen auf einem Beleg das Richtige ergeben.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { ermittleSteuerfall, schreibeSteuerfall }
  from '../../src/server/services/finanz/steuerfall.js';

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
    scope: 'mandant' as const, mandantId: f.bau, benutzerId: benutzer,
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

/** Ein Entwurf über `netto` Cent, mit dem gesetzten §13b-Tatbestand. */
async function entwurf(
  netto: bigint, grundlage: 'bau' | 'gebaeudereinigung' | null,
  steuergruppe = 'ust_19',
): Promise<string> {
  return alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Rückbau Nordflügel',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(netto), steuergruppe,
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    if (grundlage !== null) {
      await tx.unsafe(
        `update rechnung set reverse_charge_grundlage = $2::bauleistungsart where id = $1`,
        [id, grundlage] as never[]);
    }
    return id;
  });
}

async function setzeStatus(
  art: 'bau' | 'gebaeudereinigung', ja: boolean, ab: string, bis: string | null,
): Promise<void> {
  await sql.unsafe(
    `insert into kunde_bauleistender_status
       (mandant_id, kunde_id, leistungsart, ist_bauleistender, gilt_ab, gilt_bis,
        grundlage, erstellt_von_art, erstellt_von_dienst)
     values ($1,$2,$3::bauleistungsart,$4,$5::date,$6::date,'USt 1 TG vom 15.12.2025',
             'system','job:test')`,
    [f.bau, kundeId, art, ja, ab, bis] as never[]);
}

async function legeBescheinigungAn(
  von: string, bis: string, umfang: 'unbeschraenkt' | 'auftragsbezogen' = 'unbeschraenkt',
): Promise<void> {
  await sql.unsafe(
    `insert into freistellungsbescheinigung
       (mandant_id, kunde_id, bescheinigung_nummer, finanzamt, gueltig_von, gueltig_bis,
        umfang, erstellt_von_art, erstellt_von_dienst)
     values ($1,$2,$3,'Finanzamt Berlin-Mitte',$4::date,$5::date,
             $6::freistellung_umfang,'system','job:test')`,
    [f.bau, kundeId, `FSB-${zufall()}`, von, bis, umfang] as never[]);
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bau Nord GmbH','Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [f.bau, `K-${zufall()}`]);
  kundeId = k!.id;
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('der §13b-Status kann sich nicht selbst widersprechen', () => {
  it('zwei überlappende Zeiträume derselben Art sind unmöglich', async () => {
    await setzeStatus('bau', true, '2026-01-01', '2026-12-31');
    await expect(setzeStatus('bau', false, '2026-06-01', '2027-06-01'))
      .rejects.toThrow(/kbs_kein_ueberlapp/u);
  });

  /**
   * Die Gegenprobe: zwei ANGRENZENDE Zeiträume gehen — sonst liesse sich ein
   * Status nie beenden und durch einen neuen ersetzen.
   */
  it('zwei angrenzende gehen', async () => {
    await setzeStatus('bau', true, '2026-01-01', '2026-06-30');
    await expect(setzeStatus('bau', false, '2026-07-01', null)).resolves.not.toThrow();
  });

  /**
   * Und zwei Arten nebeneinander ebenfalls: §13b Abs. 2 Nr. 4 und Nr. 8 sind
   * zwei Tatbestände, und ein Kunde kann beides sein.
   */
  it('Bau und Gebäudereinigung im selben Zeitraum gehen', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    await expect(setzeStatus('gebaeudereinigung', true, '2026-01-01', null))
      .resolves.not.toThrow();
  });
});

describe('§13b greift nur mit Nachweis — und der Riegel sitzt in der Datenbank', () => {
  it('ohne Status bleibt reverse_charge aus', async () => {
    const id = await entwurf(1_000_000n, 'bau');
    const fall = await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));
    expect(fall.reverseCharge.greift).toBe(false);

    const [r] = await sql.unsafe<{ rc: boolean; hinweis: string | null }[]>(
      `select reverse_charge as rc, steuerhinweis as hinweis from rechnung where id = $1`, [id]);
    expect(r!.rc).toBe(false);
    expect(r!.hinweis).toBeNull();
  });

  it('mit Status UND passenden Positionen greift er, mit Pflichthinweis', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    const id = await entwurf(1_000_000n, 'bau', 'ust_0_13b_bau');
    const fall = await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));
    expect(fall.reverseCharge.greift).toBe(true);

    const [r] = await sql.unsafe<{ rc: boolean; hinweis: string | null }[]>(
      `select reverse_charge as rc, steuerhinweis as hinweis from rechnung where id = $1`, [id]);
    expect(r!.rc).toBe(true);
    expect(r!.hinweis).toMatch(/Steuerschuldnerschaft des Leistungsempfängers/u);
  });

  /**
   * **Abnahme (5): §13b auf einen Kunden, der keiner ist, wird abgewiesen** —
   * auch an der Anwendung vorbei. Wer die Steuer zu Unrecht verlagert, weist
   * keine Umsatzsteuer aus, der Empfänger schuldet sie nicht, und der
   * Leistende schuldet sie trotzdem (§13a UStG), ohne sie eingenommen zu
   * haben.
   */
  it('ein von Hand gesetzter Reverse Charge ohne Status prallt am Trigger ab', async () => {
    const id = await entwurf(1_000_000n, 'bau');
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `update rechnung set reverse_charge = true where id = $1`, [id] as never[],
    ))).rejects.toThrow(/kein §13b-Status/u);
  });

  it('und ohne benannten Tatbestand ebenfalls', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    const id = await entwurf(1_000_000n, null);
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `update rechnung set reverse_charge = true where id = $1`, [id] as never[],
    ))).rejects.toThrow(/ohne Tatbestand/u);
  });

  /**
   * Der Status der FALSCHEN Art zählt nicht: ein Gebäudereiniger ist kein
   * Bauleistender, und §13b Abs. 2 Nr. 8 deckt keine Bauleistung.
   */
  it('ein Reinigungs-Status trägt keine Bauleistung', async () => {
    await setzeStatus('gebaeudereinigung', true, '2026-01-01', null);
    const id = await entwurf(1_000_000n, 'bau');
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `update rechnung set reverse_charge = true where id = $1`, [id] as never[],
    ))).rejects.toThrow(/kein §13b-Status/u);
  });

  /**
   * **Der Kopf folgt den Positionen, nicht umgekehrt.**
   *
   * Die Datenbank verlangt (§4.9), dass jede Steuerzeile durch ihre Positionen
   * gedeckt ist. Ein Kopfschalter „§13b" über Positionen mit 19 % wäre ein
   * Beleg, der einen Hinweis und eine Umsatzsteuer trägt, die einander
   * widersprechen — und der zweite Entwurf dieses Dienstes prallte genau
   * daran ab.
   */
  it('Status da, Positionen tragen 19 %: kein Reverse Charge, aber ein Hinweis', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    const id = await entwurf(1_000_000n, 'bau');
    const fall = await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));

    expect(fall.reverseCharge.greift).toBe(true);
    expect(fall.positionenPassen).toBe(false);
    expect(fall.positionenHinweis).toContain('ust_0_13b_bau');

    const [r] = await sql.unsafe<{ rc: boolean; steuer: string }[]>(
      `select reverse_charge as rc, steuer_gesamt_cent::text as steuer
         from rechnung where id = $1`, [id]);
    expect(r!.rc).toBe(false);
    // Und die Umsatzsteuer steht noch da — der Beleg ist in sich stimmig.
    expect(r!.steuer).toBe('190000');
  });

  /** Und die Gegenrichtung: AE-Positionen ohne Status sind ebenso ein Befund. */
  it('AE-Positionen ohne Status: kein Reverse Charge, und der Hinweis sagt warum', async () => {
    const id = await entwurf(1_000_000n, 'bau', 'ust_0_13b_bau');
    const fall = await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));
    expect(fall.reverseCharge.greift).toBe(false);
    expect(fall.positionenPassen).toBe(false);
    expect(fall.positionenHinweis).toContain('§13b-Status hinterlegt');
  });
});

describe('§48 EStG — der Einbehalt steht auf dem Beleg', () => {
  it('ohne Bescheinigung werden 15 % einbehalten', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    const id = await entwurf(1_000_000n, 'bau', 'ust_0_13b_bau');
    const fall = await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));
    expect(fall.bauabzug.einbehalten).toBe(true);

    const [r] = await sql.unsafe<{
      pflichtig: boolean; satz: number | null; einbehalt: string; ueberweisung: string;
      fsb: string | null;
    }[]>(
      `select bauabzugsteuer_pflichtig as pflichtig, bauabzugsteuer_satz_bp as satz,
              einbehalt_bauabzugsteuer_cent::text as einbehalt,
              ueberweisungsbetrag_cent::text as ueberweisung,
              freistellungsbescheinigung_id::text as fsb
         from rechnung where id = $1`, [id]);
    expect(r!.pflichtig).toBe(true);
    expect(r!.satz).toBe(1500);
    expect(r!.fsb).toBeNull();
    // Reverse Charge: 10.000,00 € brutto = netto, davon 15 % = 1.500,00 €.
    expect(r!.einbehalt).toBe('150000');
    expect(r!.ueberweisung).toBe('850000');
  });

  it('mit gültiger Bescheinigung wird nichts einbehalten, und sie steht am Beleg', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    await legeBescheinigungAn('2026-01-01', '2026-12-31');
    const id = await entwurf(1_000_000n, 'bau', 'ust_0_13b_bau');
    await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));

    const [r] = await sql.unsafe<{ einbehalt: string; fsb: string | null }[]>(
      `select einbehalt_bauabzugsteuer_cent::text as einbehalt,
              freistellungsbescheinigung_id::text as fsb from rechnung where id = $1`, [id]);
    expect(r!.einbehalt).toBe('0');
    expect(r!.fsb).not.toBeNull();
  });

  /**
   * **Der Grenztag, gegen die echte Datenbank.** Eine Bescheinigung, die am
   * 30.08. endet, befreit eine Leistung bis 31.08. nicht — eine, die am 31.08.
   * endet, schon. Zwischen beiden liegen 1.500,00 €.
   */
  it('einen Tag zu kurz: es wird einbehalten', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    await legeBescheinigungAn('2026-01-01', '2026-08-30');
    const id = await entwurf(1_000_000n, 'bau', 'ust_0_13b_bau');
    const fall = await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));
    expect(fall.stichtag).toBe('2026-08-31');
    expect(fall.bauabzug.einbehalten).toBe(true);
  });

  it('und einen Tag länger: es wird nicht einbehalten', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    await legeBescheinigungAn('2026-01-01', '2026-08-31');
    const id = await entwurf(1_000_000n, 'bau', 'ust_0_13b_bau');
    const fall = await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));
    expect(fall.bauabzug.einbehalten).toBe(false);
  });

  /**
   * O-21 wird nicht still entschieden: endet die Gültigkeit MITTEN im
   * Leistungszeitraum, steht das als Warnung da — für den Menschen, der
   * unterschreibt.
   */
  it('endet die Gültigkeit im Leistungszeitraum, warnt die Lage (O-21)', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    await legeBescheinigungAn('2026-01-01', '2026-08-15');
    const id = await entwurf(1_000_000n, 'bau', 'ust_0_13b_bau');
    const fall = await alsApp(sitzung(), (tx) => ermittleSteuerfall(alsDienst(tx), id));
    expect(fall.bauabzug.warnung).toContain('O-21');
  });

  /**
   * Gebäudereinigung fällt unter §13b Abs. 2 Nr. 8, aber NICHT unter §48 EStG
   * — dort geht es um Bauleistungen. Ohne diese Trennung behielte die Gruppe
   * bei jeder Reinigungsrechnung 15 % ein, die niemand schuldet.
   */
  it('eine Gebäudereinigungsleistung löst keinen §48-Einbehalt aus', async () => {
    await setzeStatus('gebaeudereinigung', true, '2026-01-01', null);
    const id = await entwurf(1_000_000n, 'gebaeudereinigung', 'ust_0_13b_reinigung');
    const fall = await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));
    expect(fall.reverseCharge.greift).toBe(true);
    expect(fall.bauabzug.einbehalten).toBe(false);
    expect(fall.bauabzug.grund).toContain('nur für Bauleistungen');
  });
});

describe('beide Regeln auf EINEM Beleg', () => {
  it('§13b verlagert die Steuer, §48 behält 15 % ein — zugleich', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    const id = await entwurf(1_000_000n, 'bau', 'ust_0_13b_bau');
    await alsApp(sitzung(), (tx) => schreibeSteuerfall(alsDienst(tx), id));

    const [r] = await sql.unsafe<{
      rc: boolean; steuer: string; brutto: string; einbehalt: string; ueberweisung: string;
    }[]>(
      `select reverse_charge as rc, steuer_gesamt_cent::text as steuer,
              brutto_cent::text as brutto,
              einbehalt_bauabzugsteuer_cent::text as einbehalt,
              ueberweisungsbetrag_cent::text as ueberweisung
         from rechnung where id = $1`, [id]);

    expect(r!.rc).toBe(true);
    expect(r!.einbehalt).toBe('150000');
    // Die Überweisung ist der Zahlbetrag abzüglich des Einbehalts — die Spalte
    // ist `generated always`, also von der Datenbank gerechnet, nicht von uns.
    expect(BigInt(r!.ueberweisung)).toBe(BigInt(r!.brutto) - 150_000n);
  });
});

describe('die Stammdaten gehören der Gesellschaft', () => {
  it('eine fremde Gesellschaft sieht den §13b-Status nicht (K-02)', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    const fremd = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select 1 from kunde_bauleistender_status`));
    expect(fremd).toHaveLength(0);
  });

  it('und die eigene sehr wohl', async () => {
    await setzeStatus('bau', true, '2026-01-01', null);
    const eigen = await alsApp(sitzung(), async (tx) =>
      tx.unsafe(`select 1 from kunde_bauleistender_status`));
    expect(eigen).toHaveLength(1);
  });
});
