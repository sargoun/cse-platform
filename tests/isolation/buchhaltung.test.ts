/**
 * PR 58 — Kontenrahmen, Kontenzuordnung und automatische Buchungssätze gegen
 * eine echte Datenbank (ACC-01, `05-FINANZEN.md` §9).
 *
 * Die fünf Sätze der Abnahme aus `08-PR-PLAN.md`:
 *
 *  1. Eine festgeschriebene 19-%-Rechnung ergibt eine **ausgeglichene**
 *     Buchung (Soll = Haben auf den Cent); eine unausgeglichene lässt sich
 *     nicht speichern.
 *  2. Ein nicht zugeordneter Geschäftsvorfall erzeugt **kein geratenes
 *     Konto**, sondern eine sichtbare Zeile mit „Kontenzuordnung fehlt".
 *  3. SKR03↔SKR04 ist ein **Zeilenwechsel, keine Codeänderung** — dieselbe
 *     Vorrichtung läuft durch beide Rahmen.
 *  4. Reverse Charge und Bauabzugsteuer bekommen ihre Zuordnungsplätze —
 *     leer und gesperrt, bis jemand sie einrichtet.
 *  5. Ein Storno erzeugt die Gegenbuchung; Buchungssätze sind unveränderlich.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, storniere, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { bucheStorno } from '../../src/server/services/buchhaltung/buchungssatz.js';
import { kontiere } from '../../src/server/services/buchhaltung/kontierung.js';
import { sicherePeriode } from '../../src/server/services/buchhaltung/periode.js';

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

/** Die DATEV-Stammdaten einer Gesellschaft — im Betrieb O-05, hier Vorrichtung. */
async function richteRahmenEin(
  mandantId: string, rahmen: 'skr03' | 'skr04',
): Promise<void> {
  await sql.unsafe(
    `insert into datev_konfiguration
       (mandant_id, kontenrahmen, sachkontenlaenge, wj_beginn_monat, wj_beginn_tag,
        ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, $2::kontenrahmen, 4, 1, 1, true, 'system', 'job:test')
     on conflict (mandant_id) do update set kontenrahmen = excluded.kontenrahmen`,
    [mandantId, rahmen]);
}

/**
 * Eine BESTÄTIGTE Zuordnung — die Vorrichtung, die O-05 im Test ersetzt.
 *
 * Die Kontonummern hier sind Prüfwerte und keine Empfehlung: welche Konten
 * gelten, sagt der Steuerberater. Der Test prüft, dass die Plattform NIMMT,
 * was dasteht — nicht, dass sie die richtigen Nummern kennt.
 */
async function ordneZu(
  mandantId: string, rahmen: 'skr03' | 'skr04', typ: string, konto: string,
  zusatz: {
    kundeId?: string; gruppe?: string; schluessel?: string; platzhalter?: boolean;
  } = {},
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into konto_mapping
       (mandant_id, kontenrahmen, schluessel_typ, kunde_id, steuersatz_gruppe_id,
        erloeskonto_schluessel, konto, gueltig_von, ist_platzhalter,
        erstellt_von_art, erstellt_von_dienst)
     values ($1, $2::kontenrahmen, $3::konto_schluessel_typ, $4, $5, $6, $7,
             '2020-01-01', $8, 'system', 'job:test')
     returning id`,
    [mandantId, rahmen, typ, zusatz.kundeId ?? null, zusatz.gruppe ?? null,
      zusatz.schluessel ?? null, konto, zusatz.platzhalter ?? false]);
  return z!.id;
}

async function gruppeId(schluessel: string): Promise<string> {
  const [g] = await sql.unsafe<{ id: string }[]>(
    `select id from steuersatz_gruppe where schluessel = $1`, [schluessel]);
  return g!.id;
}

async function festgeschrieben(preisCent = 100_000n): Promise<string> {
  const id = await alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const neu = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: neu, bezeichnung: 'Unterhaltsreinigung',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(preisCent), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [neu] as never[]);
    /*
     * **Der Erlösschlüssel auf der Position** — der Schlüssel, auf den
     * `konto_mapping` zeigt (§9.3). Eine von Hand erfasste Position trägt ihn
     * nicht von selbst; im Betrieb kommt er aus dem Leistungskatalog.
     */
    await tx.unsafe(
      `update rechnungsposition set erloeskonto_schluessel = 'standard'
        where rechnung_id = $1 and netto_cent is not null`, [neu] as never[]);
    return neu;
  });
  await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));
  return id;
}

interface ZeileRoh {
  readonly id: string;
  readonly buchung_id: string;
  readonly umsatz_cent: string;
  readonly soll_haben: string;
  readonly konto: string | null;
  readonly pruefhinweis: string | null;
  readonly storniert_durch_id: string | null;
}

async function zeilen(rechnungId: string): Promise<readonly ZeileRoh[]> {
  return sql.unsafe<ZeileRoh[]>(
    `select id, buchung_id, umsatz_cent::text, soll_haben::text as soll_haben, konto,
            pruefhinweis, storniert_durch_id
       from buchungssatz where rechnung_id = $1 order by soll_haben, umsatz_cent desc`,
    [rechnungId]);
}

const summe = (zs: readonly ZeileRoh[], sh: string): bigint =>
  zs.filter((z) => z.soll_haben === sh).reduce((s, z) => s + BigInt(z.umsatz_cent), 0n);

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort)
     values ($1, $2, 'firma', 'Hausverwaltung Mitte', 'Alexanderplatz', '1', '10178', 'Berlin')
     returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
});

afterAll(schliessen);

describe('(1) die Buchung geht auf — und eine schiefe kommt nicht hinein', () => {
  it('eine festgeschriebene 19-%-Rechnung ergibt Soll = Haben auf den Cent', async () => {
    const id = await festgeschrieben(100_000n);
    const zs = await zeilen(id);

    expect(zs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(zs.map((z) => z.buchung_id)).size, 'eine Buchung, nicht drei').toBe(1);
    expect(summe(zs, 'soll')).toBe(summe(zs, 'haben'));

    // Und die Zahlen stammen aus dem Beleg, nicht aus einer zweiten Rechnung.
    const [r] = await sql.unsafe<{ brutto_cent: string; netto: string; steuer: string }[]>(
      `select r.brutto_cent::text,
              (select netto_cent::text from rechnung_steuer where rechnung_id = r.id) as netto,
              (select steuer_cent::text from rechnung_steuer where rechnung_id = r.id) as steuer
         from rechnung r where r.id = $1`, [id]);
    expect(summe(zs, 'soll')).toBe(BigInt(r!.brutto_cent));
    expect(summe(zs, 'haben')).toBe(BigInt(r!.netto) + BigInt(r!.steuer));
  });

  it('eine unausgeglichene Buchung wird beim Commit abgewiesen', async () => {
    const id = await festgeschrieben();
    const [vorhanden] = await zeilen(id);
    const periodeId = await sql.unsafe<{ periode_id: string }[]>(
      `select periode_id from buchungssatz where id = $1`, [vorhanden!.id]);

    await expect(sql.begin(async (tx) => {
      const gemeinsam = (await tx.unsafe<{ b: string }[]>(
        `select gen_random_uuid() as b`))[0]!.b;
      for (const [betrag, sh] of [['10000', 'soll'], ['9999', 'haben']] as const) {
        await tx.unsafe(
          `insert into buchungssatz
             (mandant_id, buchung_id, buchungsdatum, belegdatum, periode_id, umsatz_cent,
              soll_haben, konto, buchungstext, herkunft, erstellt_von_art, erstellt_von_dienst)
           values ($1, $2, current_date, current_date, $3, $4::bigint, $5::soll_haben,
                   '1400', 'Probe', 'manuell', 'system', 'job:test')`,
          [f.reinigung, gemeinsam, periodeId[0]!.periode_id, betrag, sh] as never[]);
      }
    })).rejects.toThrow(/geht nicht auf/u);
  });
});

describe('(2) ohne Zuordnung wird kein Konto geraten', () => {
  it('die Zeilen entstehen — ohne Konto, mit Hinweis', async () => {
    const id = await festgeschrieben();
    const zs = await zeilen(id);

    expect(zs.every((z) => z.konto === null), 'ein Konto ohne Zuordnung wäre geraten')
      .toBe(true);
    expect(zs.every((z) => (z.pruefhinweis ?? '').length > 0)).toBe(true);
    expect(zs[0]?.pruefhinweis).toMatch(/Kontenrahmen nicht festgelegt|Kontenzuordnung fehlt/u);
  });

  it('der Hinweis nennt den fehlenden Rahmen, nicht die fehlende Zeile', async () => {
    const treffer = await alsApp(sitzung(), async (tx) => kontiere(alsDienst(tx), {
      mandantId: f.reinigung, typ: 'debitor_kunde', datum: '2026-08-31', kundeId,
    }));
    expect(treffer.konto).toBeNull();
    expect(treffer.pruefhinweis).toBe('Kontenrahmen nicht festgelegt (O-05)');
  });

  it('mit Rahmen, aber ohne Zeile: „Kontenzuordnung fehlt"', async () => {
    await richteRahmenEin(f.reinigung, 'skr03');
    const treffer = await alsApp(sitzung(), async (tx) => kontiere(alsDienst(tx), {
      mandantId: f.reinigung, typ: 'debitor_kunde', datum: '2026-08-31', kundeId,
    }));
    expect(treffer.pruefhinweis).toBe('Kontenzuordnung fehlt (debitor_kunde)');
  });

  it('eine PLATZHALTER-Zeile gilt nicht als Zuordnung', async () => {
    await richteRahmenEin(f.reinigung, 'skr03');
    await ordneZu(f.reinigung, 'skr03', 'debitor_kunde', '10001',
      { kundeId, platzhalter: true });
    const treffer = await alsApp(sitzung(), async (tx) => kontiere(alsDienst(tx), {
      mandantId: f.reinigung, typ: 'debitor_kunde', datum: '2026-08-31', kundeId,
    }));
    expect(treffer.konto).toBeNull();
    expect(treffer.pruefhinweis).toMatch(/Platzhalter/u);
  });
});

describe('(3) SKR03 und SKR04 sind Zeilen, kein Code', () => {
  for (const rahmen of ['skr03', 'skr04'] as const) {
    it(`dieselbe Rechnung bucht durch ${rahmen}`, async () => {
      const konten = rahmen === 'skr03'
        ? { debitor: '10001', erloes: '8400', steuer: '1776' }
        : { debitor: '10001', erloes: '4400', steuer: '3806' };
      await richteRahmenEin(f.reinigung, rahmen);
      await ordneZu(f.reinigung, rahmen, 'debitor_kunde', konten.debitor, { kundeId });
      const g19 = await gruppeId('ust_19');
      await ordneZu(f.reinigung, rahmen, 'erloes_leistung', konten.erloes,
        { gruppe: g19, schluessel: 'standard' });
      await ordneZu(f.reinigung, rahmen, 'steuer_gruppe', konten.steuer, { gruppe: g19 });

      const id = await festgeschrieben();
      const zs = await zeilen(id);

      expect(zs.every((z) => z.konto !== null), 'alles zugeordnet').toBe(true);
      expect(summe(zs, 'soll')).toBe(summe(zs, 'haben'));
      expect(new Set(zs.map((z) => z.konto))).toEqual(
        new Set([konten.debitor, konten.erloes, konten.steuer]));
    });
  }
});

describe('(4) Reverse Charge und §48 bekommen ihren Platz — leer und gesperrt', () => {
  it('der Zuordnungstyp für die Bauabzugsteuer existiert und ist nicht belegt', async () => {
    await richteRahmenEin(f.reinigung, 'skr03');
    const treffer = await alsApp(sitzung(), async (tx) => kontiere(alsDienst(tx), {
      mandantId: f.reinigung, typ: 'bauabzugsteuer_verbindlichkeit', datum: '2026-08-31',
    }));
    expect(treffer.konto).toBeNull();
    expect(treffer.pruefhinweis)
      .toBe('Kontenzuordnung fehlt (bauabzugsteuer_verbindlichkeit)');
  });

  it('eine Steuergruppe ohne Zuordnung sperrt genau ihre Zeile, nicht die Rechnung',
    async () => {
      await richteRahmenEin(f.reinigung, 'skr03');
      await ordneZu(f.reinigung, 'skr03', 'debitor_kunde', '10001', { kundeId });
      const g19 = await gruppeId('ust_19');
      await ordneZu(f.reinigung, 'skr03', 'erloes_leistung', '8400',
        { gruppe: g19, schluessel: 'standard' });
      // Die Steuerzuordnung fehlt mit Absicht.

      const id = await festgeschrieben();
      const zs = await zeilen(id);

      expect(zs.filter((z) => z.konto === null)).toHaveLength(1);
      expect(zs.filter((z) => z.konto !== null).length).toBeGreaterThanOrEqual(2);
      expect(summe(zs, 'soll'), 'die Buchung geht trotzdem auf').toBe(summe(zs, 'haben'));
    });
});

describe('(5) Storno: Gegenbuchung statt Änderung', () => {
  it('spiegelt jede Zeile und verweist zurück', async () => {
    await richteRahmenEin(f.reinigung, 'skr03');
    await ordneZu(f.reinigung, 'skr03', 'debitor_kunde', '10001', { kundeId });
    const g19 = await gruppeId('ust_19');
    await ordneZu(f.reinigung, 'skr03', 'erloes_leistung', '8400',
      { gruppe: g19, schluessel: 'standard' });
    await ordneZu(f.reinigung, 'skr03', 'steuer_gruppe', '1776', { gruppe: g19 });

    const id = await festgeschrieben();
    const vorher = await zeilen(id);

    const storno = await alsApp(sitzung(), async (tx) =>
      storniere(alsDienst(tx), id,
        'Leistung wurde doppelt abgerechnet — Korrektur der Augustrechnung'));
    const stornoId = storno.stornoId;
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      bucheStorno(alsDienst(tx), stornoId, id));

    expect(ergebnis.gebucht).toBe(true);
    const gegen = await zeilen(stornoId);
    expect(gegen).toHaveLength(vorher.length);
    expect(summe(gegen, 'soll')).toBe(summe(vorher, 'haben'));
    expect(summe(gegen, 'haben')).toBe(summe(vorher, 'soll'));

    const nachher = await zeilen(id);
    expect(nachher.every((z) => z.storniert_durch_id !== null)).toBe(true);
  });

  it('eine festgeschriebene Zeile lässt sich nicht ändern', async () => {
    /*
     * **Eine MANUELLE Buchung, und das ist kein Umweg.** `bs_kein_beleg_ohne_hinweis`
     * verlangt fuer jede festgeschriebene Zeile mit Herkunft `rechnung` ein
     * `beleg_id` — die Belegverknuepfung kommt mit PR 59. Bis dahin ist die
     * manuelle Buchung der einzige Fall, der sich ueberhaupt festschreiben
     * laesst; die Unveraenderlichkeit gilt fuer beide gleich.
     */
    const id = await festgeschrieben();
    const [vorhanden] = await zeilen(id);
    const [p] = await sql.unsafe<{ periode_id: string }[]>(
      `select periode_id from buchungssatz where id = $1`, [vorhanden!.id]);

    // Zwei Zeilen, denn eine einzelne ginge nicht auf — der Ausloeser aus (1).
    const [z] = await sql.begin(async (tx) => {
      const b = (await tx.unsafe<{ b: string }[]>(`select gen_random_uuid() as b`))[0]!.b;
      const angelegt: { id: string }[] = [];
      for (const sh of ['soll', 'haben'] as const) {
        const [zeile] = await tx.unsafe<{ id: string }[]>(
          `insert into buchungssatz
             (mandant_id, buchung_id, buchungsdatum, belegdatum, periode_id, umsatz_cent,
              soll_haben, konto, gegenkonto, buchungstext, herkunft, festgeschrieben,
              festgeschrieben_am, erstellt_von_art, erstellt_von_dienst)
           values ($1, $2, current_date, current_date, $3, 1000, $4::soll_haben,
                   '1400', '8400', 'Handbuchung', 'manuell', true, now(),
                   'system', 'job:test')
           returning id`,
          [f.reinigung, b, p!.periode_id, sh] as never[]);
        angelegt.push(zeile!);
      }
      return angelegt;
    });

    await expect(sql.unsafe(
      `update buchungssatz set umsatz_cent = 1 where id = $1`, [z!.id]))
      .rejects.toThrow(/unveraenderlich/u);
  });
});

describe('die Periode und ihr Schloss', () => {
  it('legt den Monat an, einmal, und findet ihn wieder', async () => {
    const a = await alsApp(sitzung(), async (tx) =>
      sicherePeriode(alsDienst(tx), f.reinigung, '2026-08-31'));
    const b = await alsApp(sitzung(), async (tx) =>
      sicherePeriode(alsDienst(tx), f.reinigung, '2026-08-01'));
    expect(a.id).toBe(b.id);
    expect(a.beginnAm).toBe('2026-08-01');
    expect(a.endeAm).toBe('2026-08-31');
  });

  it('ein geschlossener Monat nimmt nichts mehr auf', async () => {
    const id = await festgeschrieben();
    const [z] = await zeilen(id);
    const [p] = await sql.unsafe<{ periode_id: string }[]>(
      `select periode_id from buchungssatz where id = $1`, [z!.id]);

    // Schliessen geht erst, wenn nichts unkontiert ist (§9.1).
    await expect(sql.unsafe(
      `update periode set status = 'geschlossen', geschlossen_am = now(),
                          geschlossen_von = $2
        where id = $1`, [p!.periode_id, benutzer]))
      .rejects.toThrow(/ohne Konto/u);

    await sql.unsafe(`update buchungssatz set konto = '1400' where rechnung_id = $1`, [id]);
    await sql.unsafe(
      `update periode set status = 'geschlossen', geschlossen_am = now(),
                          geschlossen_von = $2
        where id = $1`, [p!.periode_id, benutzer]);

    await expect(alsApp(sitzung(), async (tx) => festgeschriebenIn(tx)))
      .rejects.toThrow(/geschlossen/u);
  });

  async function festgeschriebenIn(tx: postgres.TransactionSql): Promise<void> {
    const d = alsDienst(tx);
    const neu = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: neu, bezeichnung: 'Zweite Rechnung im geschlossenen Monat',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(50_000n), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [neu] as never[]);
    await finalisiere(d, neu);
  }
});

describe('die Mandantentrennung gilt auch für Buchungen', () => {
  it('eine fremde Gesellschaft sieht keine Zeile', async () => {
    const id = await festgeschrieben();
    expect((await zeilen(id)).length).toBeGreaterThan(0);

    const sichtbar = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from buchungssatz`),
    );
    expect(sichtbar[0]?.n).toBe('0');
  });
});

/**
 * PR 59 — die Herkunftsweiche im Schreiber (0131).
 *
 * `buchungssatz` traegt fuenf Quellspalten und zwei Riegel darueber.
 * `app.buchungssatz_schreiben` bekommt EINE Quelle und die Herkunft und
 * entscheidet die Spalte daraus; ein Aufrufer kann die beiden also nicht mehr
 * in Widerspruch bringen. Diese Sektion prueft die Weiche selbst — nicht den
 * Riegel dahinter, denn ein Riegel, der nie erreicht wird, ist kein Beweis.
 */
describe('(6) die Herkunft entscheidet die Quellspalte', () => {
  interface QuellZeile {
    readonly rechnung_id: string | null;
    readonly eingangsrechnung_id: string | null;
    readonly zahlung_id: string | null;
  }

  /**
   * Schreibt eine Buchung direkt ueber den Schreiber, an jedem Dienst vorbei.
   *
   * **Zwei Zeilen, nicht eine.** Ueber `buchung_id` haengt ein
   * zurueckgestellter Riegel: Soll muss beim Commit gleich Haben sein. Eine
   * einzelne Zeile scheitert dort — und zwar an einer Pruefung, die mit der
   * Herkunftsweiche nichts zu tun hat. Gegengeprueft wird die Sollzeile.
   */
  async function schreibe(herkunft: string, quelle: string | null): Promise<QuellZeile> {
    return alsApp(sitzung(), async (tx) => {
      const p = await sicherePeriode(alsDienst(tx), f.reinigung, '2026-08-15');
      const buchung = crypto.randomUUID();
      const ids: string[] = [];
      for (const sh of ['soll', 'haben']) {
        const [neu] = await tx.unsafe<{ id: string }[]>(
          `select app.buchungssatz_schreiben($1, $2, '2026-08-15'::date, $3,
                    1000::bigint, $4::soll_haben, '4400', null, null, null,
                    'Weichenprobe', 'B-1', $5::buchung_herkunft, $6, null,
                    'dienst:test') as id`,
          [f.reinigung, buchung, p.id, sh, herkunft, quelle] as never[]);
        ids.push(neu!.id);
      }
      const [z] = await tx.unsafe<QuellZeile[]>(
        `select rechnung_id, eingangsrechnung_id, zahlung_id
           from buchungssatz where id = $1`, [ids[0]!] as never[]);
      return z!;
    });
  }

  it('eine Zahlung landet in zahlung_id — nicht in rechnung_id', async () => {
    const [zahlung] = await sql.unsafe<{ id: string }[]>(
      `insert into zahlung (mandant_id, richtung, betrag_cent, zahlungsdatum,
                            zahlungsmittel, erstellt_von)
       values ($1, 'eingang', 1000, '2026-08-15', 'ueberweisung', $2) returning id`,
      [f.reinigung, benutzer]);

    const z = await schreibe('zahlung', zahlung!.id);
    expect(z.zahlung_id).toBe(zahlung!.id);
    expect(z.rechnung_id).toBeNull();
    expect(z.eingangsrechnung_id).toBeNull();
  });

  it('eine manuelle Buchung traegt gar keine Quelle', async () => {
    const z = await schreibe('manuell', null);
    expect(z.rechnung_id).toBeNull();
    expect(z.eingangsrechnung_id).toBeNull();
    expect(z.zahlung_id).toBeNull();
  });

  /*
   * Die zwei Widersprueche, die die alte Signatur zugelassen haette. Beide
   * scheitern hier VOR dem Einfuegen, mit einem Satz, der auf den Aufruf zeigt
   * — der Riegel der Tabelle haette nur seinen eigenen Namen genannt.
   */
  it('eine Herkunft ohne Quelle wird abgewiesen, und zwar benannt', async () => {
    await expect(schreibe('eingangsrechnung', null))
      .rejects.toThrow(/ohne Quelle/u);
  });

  it('und eine manuelle Buchung MIT Quelle ebenso', async () => {
    const id = await festgeschrieben();
    await expect(schreibe('manuell', id))
      .rejects.toThrow(/keine Quelle/u);
  });
});
