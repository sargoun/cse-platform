/**
 * PR 55 — das Mahnwesen gegen eine echte Datenbank (FIN-15, §286/§288 BGB).
 *
 * Die vier Sätze der Abnahme:
 *
 *  1. Eine überfällige Rechnung ergibt einen **Vorschlag**, nie einen
 *     versendeten Brief (Invariante 7).
 *  2. Eine Zahlung zwischen Vorschlag und Freigabe verwirft den Entwurf von
 *     selbst — und wird sie storniert, ist die Forderung wieder mahnbar.
 *  3. Gebühr und Zins kommen aus **bestätigten** Werten. Ohne sie nennt der
 *     Brief nur die Hauptforderung und keine erfundene Gebühr.
 *  4. Eine Stufe wird nicht übersprungen — ausser mit genanntem, protokolliertem
 *     Grund — und dieselbe Stufe geht für einen Beleg nie zweimal hinaus.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { verbucheZahlungseingang, storniereZahlung }
  from '../../src/server/services/finanz/zahlung/index.js';
import { ermittleVorschlaege, legeMahnentwurfAn }
  from '../../src/server/services/finanz/mahnung/lauf.js';
import {
  KanalNichtVerbundenFehler, MahnungFehler, dokumentiereVersand, findeMahnung,
  gibFrei, mahnungNutzlast, mahnungstext, verwirf,
} from '../../src/server/services/finanz/mahnung/index.js';
import { StufenFehler, bestaetigeStufe, mahnstufen }
  from '../../src/server/services/finanz/mahnung/stufen.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import { FreigabeErforderlich, nutzlastHash } from '../../src/server/agent/policy.js';
import { erteileFreigabe } from '../../src/server/services/freigabe/erteilen.js';

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

/** Derselbe Schreibkontext, den eine Route baut — der Dienst kennt kein `tx`. */
function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
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
  for (const [typ, maske, bez] of [
    ['ausgangsrechnung', 'RE-{nr:5}', 'Rechnungen'],
    ['mahnung', 'MA-{nr:5}', 'Mahnungen'],
  ] as const) {
    await sql.unsafe(
      `insert into nummernkreis
         (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
          zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
       values ($1, $2::nummernkreis_typ, null, 0, $3, true, $4, 'nie',
               '2026-01-01', false, 'system', 'job:test')`,
      [mandantId, typ, bez, maske]);
  }
}

/** Eine bestätigte Stufe — der Gegenstand von O-19, hier als Vorrichtung. */
async function legeStufeAn(
  stufe: number, tage: number,
  optionen: { gebuehrCent?: bigint; zins?: 'keine' | 'gesetzlich_b2b' } = {},
): Promise<string> {
  const [s] = await sql.unsafe<{ id: string }[]>(
    `insert into mahnstufe
       (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit, gebuehr_cent,
        zinsberechnung, zins_methode, ist_platzhalter, gueltig_ab,
        erstellt_von_art, erstellt_von_dienst)
     values ($1, $2, $3, $4, $5, $6::mahn_zinsberechnung,
             case when $6 = 'keine' then null else 'act_365'::zins_methode end,
             false, '2026-01-01', 'system', 'job:test')
     returning id`,
    [f.reinigung, stufe, `Stufe ${String(stufe)}`, tage,
     (optionen.gebuehrCent ?? 0n).toString(), optionen.zins ?? 'keine']);
  return s!.id;
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
    return neu;
  });
  await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));
  return id;
}

/**
 * **Die Fälligkeit in die Vergangenheit schieben — eine Vorrichtung, kein
 * Weg der Plattform.**
 *
 * `fin.rechnung_nummer_ziehen` datiert jede Rechnung auf HEUTE, und
 * `fin.op_unveraenderlich` friert `faellig_am` auf dem Posten ein: aus dem
 * System heraus kann in derselben Sekunde nichts überfällig sein. Der Test
 * setzt das Datum deshalb als Eigentümer und mit abgeschalteten Auslösern —
 * `session_replication_role = replica` ist der Postgres-Modus für genau
 * solche Ladevorgänge, und `set local` gibt ihn mit der Transaktion wieder
 * frei.
 */
async function macheUeberfaellig(rechnungId: string, tage: number): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(
      `update offener_posten
          set faellig_am = app.berlin_heute() - $2::integer
        where rechnung_id = $1`, [rechnungId, tage] as never[]);
  });
}

beforeEach(async () => {
  f = await seed();
  /*
   * `basiszinssatz` ist global (§3.2) und ueberlebt `seed()`: der setzt
   * Mandantendaten zurueck, keine plattformweiten Referenzwerte. Ohne diese
   * Zeile traegt ein Test den Satz des vorigen — und „ohne Basiszinssatz
   * entsteht kein Zins" bewiese dann nur die Reihenfolge der Faelle.
   */
  await sql.unsafe(`delete from basiszinssatz`);
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

describe('(1) Der Lauf erzeugt einen VORSCHLAG, nie einen Brief', () => {
  it('eine 15 Tage überfällige Rechnung ergibt einen Entwurf im Zustand `entwurf`',
    async () => {
      const id = await festgeschrieben();
      await macheUeberfaellig(id, 15);
      await legeStufeAn(1, 14);

      const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
      expect(lage.vorschlaege).toHaveLength(1);
      expect(lage.vorschlaege[0]!.stufe).toBe(1);
      expect(lage.vorschlaege[0]!.forderungCent).toBe(119_000n);

      const mahnungId = await alsApp(sitzung(), async (tx) =>
        legeMahnentwurfAn(alsDienst(tx), lage.vorschlaege[0]!));
      const [m] = await sql.unsafe<{ status: string; nummer: string | null }[]>(
        `select status::text as status, nummer from mahnung where id = $1`, [mahnungId]);
      expect(m!.status).toBe('entwurf');
      /* Keine Nummer, solange niemand freigegeben hat — der Brief existiert
         rechtlich noch nicht. */
      expect(m!.nummer).toBeNull();
    });

  it('und ohne bestätigte Stufe entsteht NICHTS — mit genanntem Grund (O-19)', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await sql.unsafe(
      `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                              ist_platzhalter, gueltig_ab, erstellt_von_art, erstellt_von_dienst)
       values ($1, 1, 'Zahlungserinnerung (unbestätigt)', 14, true, '2026-01-01',
               'system', 'job:test')`, [f.reinigung]);

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    expect(lage.vorschlaege).toHaveLength(0);
    expect(lage.uebergangen[0]!.grund).toContain('unbestätigt');
    expect(lage.uebergangen[0]!.grund).toContain('O-19');
  });

  it('eine Mahnsperre beim Kunden übergeht die Forderung — mit Grund', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14);
    await sql.unsafe(
      `update kunde set mahnsperre_bis = app.berlin_heute() + 30,
                        mahnsperre_grund = 'Klärung der Reklamation läuft'
        where id = $1`, [kundeId]);

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    expect(lage.vorschlaege).toHaveLength(0);
    expect(lage.uebergangen[0]!.grund).toContain('Mahnsperre beim Kunden');
  });

  it('und eine Forderung, die die Frist der Stufe noch nicht erreicht, ebenso', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 3);
    await legeStufeAn(1, 14);

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    expect(lage.vorschlaege).toHaveLength(0);
    expect(lage.uebergangen[0]!.grund).toContain('greift ab 14');
  });
});

describe('(2) Ohne bestätigte Werte nennt der Brief nur die Hauptforderung', () => {
  it('keine Gebühr, kein Zins — und der Hinweis sagt es', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14);   // gebuehr 0, zinsberechnung keine

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    const v = lage.vorschlaege[0]!;
    expect(v.gebuehrCent).toBe(0n);
    expect(v.zinsenCent).toBe(0n);
    expect(v.gesamtCent).toBe(v.forderungCent);
    expect(v.hinweise.join(' ')).toContain('keine Mahngebühr');
  });

  it('mit bestätigter Gebühr steht sie im Vorschlag — und in der Summe', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14, { gebuehrCent: 500n });

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    const v = lage.vorschlaege[0]!;
    expect(v.gebuehrCent).toBe(500n);
    expect(v.gesamtCent).toBe(119_500n);
  });

  /**
   * **§286 Abs. 1 BGB: der Verzug tritt durch die MAHNUNG ein.**
   *
   * Vor der ersten Mahnung gibt es deshalb keinen Zins — auch nicht, wenn die
   * Stufe einen vorsieht. Die Ausnahmen des Abs. 2 und 3 hängen an
   * Vereinbarungen und am Zugang der Rechnung; beides ist offen und bleibt
   * unangewandt.
   */
  it('vor der ersten Mahnung läuft kein Verzug — auch mit Zinsstufe nicht', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14, { zins: 'gesetzlich_b2b' });
    await sql.unsafe(
      `insert into basiszinssatz (gueltig_von, satz_bp) values ('2020-01-01', 127)
       on conflict do nothing`);

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    const v = lage.vorschlaege[0]!;
    expect(v.zinsenCent).toBe(0n);
    expect(v.positionen[0]!.verzugsbeginnAm).toBeNull();
    expect(v.hinweise.join(' ')).toContain('§286 Abs. 1 BGB');
  });

  it('ohne Basiszinssatz wird kein Zins gefordert — und der Hinweis nennt es', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(2, 14, { zins: 'gesetzlich_b2b' });
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(
        `update offener_posten set letzte_mahnstufe = 1,
                                   letzte_mahnung_am = app.berlin_heute() - 20
          where rechnung_id = $1`, [id] as never[]);
    });

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    const v = lage.vorschlaege[0]!;
    expect(v.zinsenCent).toBe(0n);
    expect(v.hinweise.join(' ')).toContain('Kein Basiszinssatz');
  });

  it('mit Basiszinssatz UND vorausgegangener Mahnung entsteht ein Zins', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(2, 14, { zins: 'gesetzlich_b2b' });
    await sql.unsafe(
      `insert into basiszinssatz (gueltig_von, satz_bp) values ('2020-01-01', 127)
       on conflict do nothing`);
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(
        `update offener_posten set letzte_mahnstufe = 1,
                                   letzte_mahnung_am = app.berlin_heute() - 20
          where rechnung_id = $1`, [id] as never[]);
    });

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    const p = lage.vorschlaege[0]!.positionen[0]!;
    // 1.190,00 € · (127 + 900) bp · 20/365 = 6,70 €
    expect(p.zinsBp).toBe(1027);
    expect(p.verzugstage).toBe(20);
    expect(p.zinsMethode).toBe('act_365');
    expect(p.zinsCent).toBe(670n);
  });
});

describe('(3) Eine Zahlung zwischen Vorschlag und Freigabe verwirft den Entwurf', () => {
  it('der Entwurf wird von selbst verworfen — mit Grund', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14);

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    const mahnungId = await alsApp(sitzung(), async (tx) =>
      legeMahnentwurfAn(alsDienst(tx), lage.vorschlaege[0]!));

    await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(119_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));

    const [m] = await sql.unsafe<{ status: string; grund: string | null }[]>(
      `select status::text as status, verworfen_grund as grund from mahnung where id = $1`,
      [mahnungId]);
    expect(m!.status).toBe('verworfen');
    expect(m!.grund).toContain('ausgeglichen');
  });

  it('und wird die Zahlung storniert, ist die Forderung wieder mahnbar', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14);

    const lage = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    await alsApp(sitzung(), async (tx) =>
      legeMahnentwurfAn(alsDienst(tx), lage.vorschlaege[0]!));

    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(119_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'lastschrift',
    }));
    await alsApp(sitzung(), async (tx) =>
      storniereZahlung(alsDienst(tx), e.zahlungId, 'Lastschrift zurückgegeben.'));

    /*
     * Der alte Entwurf bleibt verworfen stehen (Invariante 8) — und die
     * Forderung ist wieder offen, also erzeugt der Lauf einen NEUEN.
     */
    const danach = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    expect(danach.vorschlaege).toHaveLength(1);
    expect(danach.vorschlaege[0]!.forderungCent).toBe(119_000n);
  });
});

describe('(4) Keine Stufe wird übersprungen, und keine zweimal gemahnt', () => {
  it('dieselbe Stufe geht für denselben Posten nicht zweimal hinaus', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14);
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(
        `update offener_posten set letzte_mahnstufe = 1 where rechnung_id = $1`,
        [id] as never[]);
    });

    const [m] = await sql.unsafe<{ id: string; stufe_id: string }[]>(
      `insert into mahnung (mandant_id, kunde_id, mahnstufe_id, stufe, mahndatum,
                            zahlbar_bis, erstellt_von_art, erstellt_von_dienst)
       select $1, $2, s.id, 1, app.berlin_heute(), app.berlin_heute(), 'system', 'job:test'
         from mahnstufe s where s.mandant_id = $1 and s.stufe = 1
       returning id, mahnstufe_id as stufe_id`, [f.reinigung, kundeId]);

    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `insert into mahnung_position
         (mandant_id, mahnung_id, rechnung_id, offener_posten_id, offener_betrag_cent,
          faellig_am, verzugsbeginn_regel, erstellt_von_art, erstellt_von)
       select app.aktiver_mandant(), $1::uuid, op.rechnung_id, op.id, op.offen_cent,
              op.faellig_am, 'nach_mahnung', 'mensch', app.aktueller_benutzer()
         from offener_posten op where op.rechnung_id = $2::uuid`,
      [m!.id, id] as never[]))).rejects.toThrow(/bereits gemahnt/u);
  });

  it('ein Sprung von Stufe 0 auf 3 wird ohne genannten Grund abgewiesen', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 60);
    await legeStufeAn(3, 14);

    const [m] = await sql.unsafe<{ id: string }[]>(
      `insert into mahnung (mandant_id, kunde_id, mahnstufe_id, stufe, mahndatum,
                            zahlbar_bis, erstellt_von_art, erstellt_von_dienst)
       select $1, $2, s.id, 3, app.berlin_heute(), app.berlin_heute(), 'system', 'job:test'
         from mahnstufe s where s.mandant_id = $1 and s.stufe = 3
       returning id`, [f.reinigung, kundeId]);

    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `insert into mahnung_position
         (mandant_id, mahnung_id, rechnung_id, offener_posten_id, offener_betrag_cent,
          faellig_am, verzugsbeginn_regel, erstellt_von_art, erstellt_von)
       select app.aktiver_mandant(), $1::uuid, op.rechnung_id, op.id, op.offen_cent,
              op.faellig_am, 'nach_mahnung', 'mensch', app.aktueller_benutzer()
         from offener_posten op where op.rechnung_id = $2::uuid`,
      [m!.id, id] as never[]))).rejects.toThrow(/verlangt einen genannten Grund/u);
  });

  it('mit genanntem Grund geht er durch — und steht im Protokoll', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 60);
    await legeStufeAn(3, 14);

    const [m] = await sql.unsafe<{ id: string }[]>(
      `insert into mahnung (mandant_id, kunde_id, mahnstufe_id, stufe, mahndatum,
                            zahlbar_bis, stufensprung_grund,
                            erstellt_von_art, erstellt_von_dienst)
       select $1, $2, s.id, 3, app.berlin_heute(), app.berlin_heute(),
              'Kunde hat den Eingang zweimal schriftlich bestätigt und nicht gezahlt.',
              'system', 'job:test'
         from mahnstufe s where s.mandant_id = $1 and s.stufe = 3
       returning id`, [f.reinigung, kundeId]);

    await alsApp(sitzung(), async (tx) => tx.unsafe(
      `insert into mahnung_position
         (mandant_id, mahnung_id, rechnung_id, offener_posten_id, offener_betrag_cent,
          faellig_am, verzugsbeginn_regel, erstellt_von_art, erstellt_von)
       select app.aktiver_mandant(), $1::uuid, op.rechnung_id, op.id, op.offen_cent,
              op.faellig_am, 'nach_mahnung', 'mensch', app.aktueller_benutzer()
         from offener_posten op where op.rechnung_id = $2::uuid`,
      [m!.id, id] as never[]));

    const [spur] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from audit_log
        where aktion = 'mahnung.stufe_uebersprungen' and objekt_id = $1`, [m!.id]);
    expect(spur!.anzahl).toBe('1');
  });
});

// ---------------------------------------------------------------------------

/**
 * **(5) Nichts geht hinaus, was nicht genau so freigegeben wurde.**
 *
 * Invariante 7 und §286 BGB an derselben Stelle: der Verzug knuepft an die
 * Mahnung an, und die Mahnung ist erst eine, wenn ein Mensch sie freigegeben
 * hat. Die vier Faelle hier sind die vier Arten, wie das schiefgeht.
 */
describe('(5) Nichts geht ohne passende Freigabe hinaus', () => {
  async function entwurfMitStufe(): Promise<string> {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14, { gebuehrCent: 500n });
    return alsApp(sitzung(), async (tx) => {
      const lage = await ermittleVorschlaege(alsDienst(tx));
      return legeMahnentwurfAn(alsDienst(tx), lage.vorschlaege[0]!);
    });
  }

  it('die Freigabe zieht die Nummer — und der Abdruck passt zur Nutzlast', async () => {
    const mahnungId = await entwurfMitStufe();

    const ergebnis = await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Nach Rücksprache mit der Leitung freigegeben.'));
    /* Die Maske der Vorrichtung ist `MA-{nr:5}` (oben), nicht die des Seeds. */
    expect(ergebnis.nummer).toMatch(/^MA-\d{5}$/);

    const [zeile] = await sql.unsafe<{
      status: string; nummer: string; freigabe_id: string; freigegeben_von: string | null;
    }[]>(
      `select status::text as status, nummer, freigabe_id, freigegeben_von
         from mahnung where id = $1`, [mahnungId]);
    expect(zeile!.status).toBe('freigegeben');
    expect(zeile!.freigegeben_von).toBe(benutzer);

    /* Der Schnappschuss traegt den Abdruck des TORS, nicht irgendeinen. */
    const vorgang = await alsApp(sitzung(), async (tx) =>
      findeMahnung(kontextAus(tx), mahnungId));
    const erwartet = nutzlastHash(
      mahnungNutzlast(f.reinigung, vorgang!.kopf, vorgang!.positionen));
    const [schnappschuss] = await sql.unsafe<{ nutzlast_hash: string; entscheidung: string }[]>(
      `select nutzlast_hash, entscheidung::text as entscheidung
         from freigabe_snapshot where freigabe_id = $1`, [zeile!.freigabe_id]);
    expect(schnappschuss!.entscheidung).toBe('genehmigt');
    expect(schnappschuss!.nutzlast_hash).toBe(erwartet);
  });

  it('ohne Freigabesatz weist die Datenbank den Zustandswechsel ab (K-13)', async () => {
    const mahnungId = await entwurfMitStufe();
    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `update mahnung set status = 'freigegeben' where id = $1`,
      [mahnungId] as never[]))).rejects.toThrow(/Freigabesatz/);

    const [zeile] = await sql.unsafe<{ status: string; nummer: string | null }[]>(
      `select status::text as status, nummer from mahnung where id = $1`, [mahnungId]);
    expect(zeile!.status).toBe('entwurf');
    expect(zeile!.nummer).toBeNull();
  });

  /**
   * **Eine ABGELEHNTE Freigabe ist keine.** Der Ausloeser prueft den Zustand
   * des Satzes, nicht nur seine Kennung — sonst genuegte irgendein Vorgang
   * aus dem Freigabekorb, um einen Brief hinauszulassen.
   */
  it('ein abgelehnter Freigabesatz laesst den Zustand stehen (K-13)', async () => {
    const mahnungId = await entwurfMitStufe();
    const [abgelehnt] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, begruendung, erstellt_von)
       values ($1, 'mahnung_senden', 'abgelehnt', 'Betrag strittig — nicht mahnen.', $2)
       returning id`, [f.reinigung, benutzer]);

    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `update mahnung set status = 'freigegeben', freigabe_id = $2 where id = $1`,
      [mahnungId, abgelehnt!.id] as never[]))).rejects.toThrow(/genehmigt/);

    const [zeile] = await sql.unsafe<{ status: string; nummer: string | null }[]>(
      `select status::text as status, nummer from mahnung where id = $1`, [mahnungId]);
    expect(zeile!.status).toBe('entwurf');
    expect(zeile!.nummer).toBeNull();
  });

  it('ein nicht verbundener Kanal wird abgewiesen, nicht nachgebaut', async () => {
    const mahnungId = await entwurfMitStufe();
    await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Freigegeben zur Versendung als Brief.'));

    await expect(alsApp(sitzung(), async (tx) => dokumentiereVersand(
      kontextAus(tx),
      { id: mahnungId, versandart: 'e_mail', empfaenger: 'buchhaltung@beispiel.test' },
      new LokalerSpeicher(),
    ))).rejects.toThrow(KanalNichtVerbundenFehler);

    const [zeile] = await sql.unsafe<{ status: string; versendet_am: string | null }[]>(
      `select status::text as status, versendet_am from mahnung where id = $1`, [mahnungId]);
    expect(zeile!.status).toBe('freigegeben');
    expect(zeile!.versendet_am).toBeNull();
  });

  /**
   * **Der teuerste Fall: der Betrag wird NACH der Freigabe geändert.**
   *
   * Wer den Brief danach hinausliesse, versendete eine Forderung, die
   * niemand genehmigt hat — und die Freigabe in der Kette bewiese das
   * Gegenteil. Das Tor vergleicht deshalb den Abdruck, nicht die Kennung.
   */
  it('wird nach der Freigabe der Betrag geändert, geht nichts mehr hinaus', async () => {
    const mahnungId = await entwurfMitStufe();
    await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Freigegeben mit der geprüften Summe.'));

    await sql.unsafe(
      `update mahnung set gebuehr_cent = 9900,
                          gesamt_cent = forderung_cent + 9900 + zinsen_cent
        where id = $1`, [mahnungId]);

    await expect(alsApp(sitzung(), async (tx) => dokumentiereVersand(
      kontextAus(tx),
      { id: mahnungId, versandart: 'brief', empfaenger: 'Beispiel GmbH' },
      new LokalerSpeicher(),
    ))).rejects.toThrow(FreigabeErforderlich);

    const [zeile] = await sql.unsafe<{ versendet_am: string | null; dokument_id: string | null }[]>(
      `select versendet_am, dokument_id from mahnung where id = $1`, [mahnungId]);
    expect(zeile!.versendet_am).toBeNull();
    expect(zeile!.dokument_id).toBeNull();
  });

  it('der dokumentierte Versand legt den Brief ab und schreibt den Posten fort', async () => {
    const mahnungId = await entwurfMitStufe();
    await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Freigegeben zur Versendung als Einschreiben.'));

    const ergebnis = await alsApp(sitzung(), async (tx) => dokumentiereVersand(
      kontextAus(tx),
      { id: mahnungId, versandart: 'einschreiben', empfaenger: 'Beispiel GmbH' },
      new LokalerSpeicher(),
    ));
    expect(ergebnis.dokumentId).toMatch(/^[0-9a-f-]{36}$/);

    const [zeile] = await sql.unsafe<{ status: string; dokument_id: string | null }[]>(
      `select status::text as status, dokument_id from mahnung where id = $1`, [mahnungId]);
    expect(zeile!.status).toBe('versendet');
    expect(zeile!.dokument_id).toBe(ergebnis.dokumentId);

    /* Der Ausloeser schreibt den Posten fort — ab hier laeuft der Verzug. */
    const [posten] = await sql.unsafe<{ letzte_mahnstufe: number; letzte_mahnung_am: string }[]>(
      `select op.letzte_mahnstufe, op.letzte_mahnung_am::text as letzte_mahnung_am
         from offener_posten op
         join mahnung_position mp on mp.offener_posten_id = op.id
        where mp.mahnung_id = $1`, [mahnungId]);
    expect(posten!.letzte_mahnstufe).toBe(1);

    /* Und der einzige Ausgang traegt seine Freigabe (0012). */
    const [versand] = await sql.unsafe<{ aktion: string; kanal: string; freigabe_id: string }[]>(
      `select aktion, kanal, freigabe_id from versand
        where aktion = 'mahnung_senden' order by erstellt_am desc limit 1`);
    expect(versand!.kanal).toBe('einschreiben');
    expect(versand!.freigabe_id).not.toBeNull();
  });

  /**
   * **Der Verzug beginnt am Versandtag, nicht am Entwurfstag.**
   *
   * Zwischen Lauf und Freigabe können Tage liegen. Nähme der Posten das
   * `mahndatum`, forderte die nächste Stufe Zinsen für Tage, an denen noch
   * gar nichts hinausgegangen war — zu unseren Gunsten und ohne Grundlage.
   */
  it('der Posten trägt den Versandtag als Verzugsbeginn, nicht das Mahndatum', async () => {
    const mahnungId = await entwurfMitStufe();
    /* Den Entwurf zurückdatieren — als Eigentümer, mit abgeschalteten Auslösern. */
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(
        `update mahnung set mahndatum = app.berlin_heute() - 5,
                            zahlbar_bis = app.berlin_heute() - 5
          where id = $1`, [mahnungId] as never[]);
    });
    await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Freigegeben, fünf Tage nach dem Lauf.'));
    await alsApp(sitzung(), async (tx) => dokumentiereVersand(
      kontextAus(tx), { id: mahnungId, versandart: 'brief', empfaenger: 'Beispiel GmbH' },
      new LokalerSpeicher()));

    const [posten] = await sql.unsafe<{ beginn: string; heute: string; datum: string }[]>(
      `select op.letzte_mahnung_am::text as beginn,
              app.berlin_heute()::text   as heute,
              m.mahndatum::text          as datum
         from offener_posten op
         join mahnung_position mp on mp.offener_posten_id = op.id
         join mahnung m on m.id = mp.mahnung_id
        where mp.mahnung_id = $1`, [mahnungId]);
    expect(posten!.beginn).toBe(posten!.heute);
    expect(posten!.beginn).not.toBe(posten!.datum);
  });

  it('ein zweiter Versand derselben Mahnung wird abgewiesen', async () => {
    const mahnungId = await entwurfMitStufe();
    await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Freigegeben zur Versendung als Brief.'));
    await alsApp(sitzung(), async (tx) => dokumentiereVersand(
      kontextAus(tx), { id: mahnungId, versandart: 'brief', empfaenger: 'Beispiel GmbH' },
      new LokalerSpeicher()));

    /*
     * `toThrow(MahnungFehler)` allein bewiese nichts: die Zeile steht danach
     * auf `versendet` und scheiterte auch an der Zustandspruefung — mit einem
     * ANDEREN Satz. Eine Sabotage, die den Wiederholungsschutz entfernte,
     * blieb dann gruen. Der Test nennt deshalb den Grund.
     */
    const fehler = await alsApp(sitzung(), async (tx) => dokumentiereVersand(
      kontextAus(tx), { id: mahnungId, versandart: 'brief', empfaenger: 'Beispiel GmbH' },
      new LokalerSpeicher())).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(MahnungFehler);
    expect((fehler as MahnungFehler).grund).toBe('schon_versendet');
    expect((fehler as MahnungFehler).message).toContain('nächste Stufe');
  });

  it('ein verworfener Entwurf behält seinen Grund und zieht keine Nummer', async () => {
    const mahnungId = await entwurfMitStufe();
    await alsApp(sitzung(), async (tx) =>
      verwirf(kontextAus(tx), mahnungId, 'Kunde hat am Vortag nachweislich gezahlt.'));

    const [zeile] = await sql.unsafe<{
      status: string; nummer: string | null; verworfen_grund: string | null;
    }[]>(
      `select status::text as status, nummer, verworfen_grund from mahnung where id = $1`,
      [mahnungId]);
    expect(zeile!.status).toBe('verworfen');
    expect(zeile!.nummer).toBeNull();
    expect(zeile!.verworfen_grund).toContain('nachweislich');
  });
});

// ---------------------------------------------------------------------------

/**
 * **(6) Die Stufen sind eine Einstellung, keine Annahme (O-19).**
 *
 * Bis jemand sie bestätigt, mahnt nichts. Danach gilt die bestätigte Fassung
 * — und die vorherige bleibt lesbar, weil eine versendete Mahnung sich auf
 * die Stufe beruft, wie sie GALT.
 */
describe('(6) Bestätigte Stufen lösen ab, sie überschreiben nicht', () => {
  it('eine Bestätigung schliesst die Platzhalterfassung am Vortag', async () => {
    await sql.unsafe(
      `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                              ist_platzhalter, gueltig_ab, erstellt_von_art,
                              erstellt_von_dienst)
       values ($1, 1, 'Zahlungserinnerung (unbestätigt)', 14, true, '2026-01-01',
               'system', 'job:test')`, [f.reinigung]);

    const neu = await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 1, bezeichnung: 'Zahlungserinnerung', tageNachFaelligkeit: 14,
      gebuehrCent: cent(500n), zinsberechnung: 'gesetzlich_b2b', gueltigAb: '2026-09-01',
    }));

    const zeilen = await alsApp(sitzung(), async (tx) => mahnstufen(kontextAus(tx)));
    const bestaetigt = zeilen.find((z) => z.id === neu);
    const alt = zeilen.find((z) => z.id !== neu);
    expect(bestaetigt?.istPlatzhalter).toBe(false);
    expect(bestaetigt?.gebuehrCent).toBe(500n);
    /* act/365 als Vorgabe — genannt, nicht stillschweigend. */
    expect(bestaetigt?.zinsMethode).toBe('act_365');
    expect(alt?.gueltigBis).toBe('2026-08-31');
    expect(alt?.istPlatzhalter).toBe(true);
  });

  /**
   * **Zwei gültige Fassungen derselben Stufe an einem Tag gibt es nicht.**
   * Sonst hinge der geforderte Betrag an der Sortierung, und beide Antworten
   * sähen richtig aus.
   */
  it('eine überlappende Fassung wird von der Datenbank abgewiesen', async () => {
    await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 2, bezeichnung: 'Erste Mahnung', tageNachFaelligkeit: 28,
      gebuehrCent: cent(500n), zinsberechnung: 'keine', gueltigAb: '2026-09-01',
    }));

    await expect(sql.unsafe(
      `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                              ist_platzhalter, gueltig_ab, erstellt_von_art,
                              erstellt_von_dienst)
       values ($1, 2, 'Zweite Wahrheit', 30, false, '2026-10-01', 'system', 'job:test')`,
      [f.reinigung])).rejects.toThrow(/mahnstufe_kein_ueberlapp/);
  });

  /**
   * **Rückwärts geht keine Fassung** — und der Satz nennt den Tag, der geht.
   *
   * Ohne diese Prüfung schlüge die Ablösung fehl (die alte Fassung beginnt
   * später und wird von der `update`-Bedingung nicht erfasst), der Einschub
   * liefe in `mahnstufe_kein_ueberlapp`, und der Mensch am Bildschirm bekäme
   * einen Datenbankfehler über eine Schranke, von der er nichts weiss.
   */
  it('eine Fassung, die nicht später beginnt, wird mit dem frühesten Tag abgewiesen',
    async () => {
      const [tage] = await sql.unsafe<{ heute: string }[]>(
        `select app.berlin_heute()::text as heute`);
      await sql.unsafe(
        `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                                ist_platzhalter, gueltig_ab, erstellt_von_art,
                                erstellt_von_dienst)
         values ($1, 4, 'Läuft seit heute', 14, true, $2::date, 'system', 'job:test')`,
        [f.reinigung, tage!.heute]);

      const fehler = await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
        stufe: 4, bezeichnung: 'Rückwirkend', tageNachFaelligkeit: 14,
        gebuehrCent: cent(500n), zinsberechnung: 'keine', gueltigAb: tage!.heute,
      })).catch((e: unknown) => e);

      expect(fehler).toBeInstanceOf(StufenFehler);
      expect((fehler as StufenFehler).grund).toBe('ueberlappt');
      expect((fehler as StufenFehler).message).toContain('frühestens');

      /* Und nichts ist entstanden — auch die laufende Fassung steht unverändert. */
      const zeilen = await alsApp(sitzung(), async (tx) => mahnstufen(kontextAus(tx)));
      const vier = zeilen.filter((z) => z.stufe === 4);
      expect(vier).toHaveLength(1);
      expect(vier[0]!.istPlatzhalter).toBe(true);
      expect(vier[0]!.gueltigBis).toBeNull();
    });

  it('ein vertraglicher Zins ohne vereinbarten Satz wird abgelehnt', async () => {
    await expect(alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 3, bezeichnung: 'Letzte Mahnung', tageNachFaelligkeit: 42,
      gebuehrCent: cent(0n), zinsberechnung: 'vertraglich', gueltigAb: '2026-09-01',
    }))).rejects.toThrow(/Basispunkten/);
  });

  it('nach der Bestätigung schlägt der Lauf vor, was vorher übergangen wurde', async () => {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await sql.unsafe(
      `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                              ist_platzhalter, gueltig_ab, erstellt_von_art,
                              erstellt_von_dienst)
       values ($1, 1, 'Zahlungserinnerung (unbestätigt)', 14, true, '2026-01-01',
               'system', 'job:test')`, [f.reinigung]);

    const vorher = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    expect(vorher.vorschlaege).toHaveLength(0);
    expect(vorher.uebergangen[0]!.grund).toContain('unbestätigt');

    /* Ab GESTERN gültig — der Lauf liest die Fassung, die HEUTE gilt. */
    const [gestern] = await sql.unsafe<{ tag: string }[]>(
      `select (app.berlin_heute() - 1)::text as tag`);
    await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 1, bezeichnung: 'Zahlungserinnerung', tageNachFaelligkeit: 14,
      gebuehrCent: cent(500n), zinsberechnung: 'keine', gueltigAb: gestern!.tag,
    }));

    const nachher = await alsApp(sitzung(), async (tx) => ermittleVorschlaege(alsDienst(tx)));
    expect(nachher.vorschlaege).toHaveLength(1);
    expect(nachher.vorschlaege[0]!.gebuehrCent).toBe(500n);
    expect(nachher.uebergangen).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (7) Der Mahntext je Stufe erreicht das Schreiben (V-214)
// ---------------------------------------------------------------------------

describe('(7) der Mahntext je Stufe wird gepflegt und steht im Schreiben', () => {
  it('eine bestätigte Fassung trägt ihren Mahntext — die nächste übernimmt ihn', async () => {
    await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 1, bezeichnung: 'Zahlungserinnerung', tageNachFaelligkeit: 14,
      gebuehrCent: cent(0n), zinsberechnung: 'keine', gueltigAb: '2026-09-01',
      textbaustein: '  Sicher haben Sie die Rechnung übersehen.\r\nBitte prüfen Sie. ',
    }));
    /* Eine neue Gebühr, KEIN Text angegeben: der Text der laufenden bleibt. */
    await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 1, bezeichnung: 'Zahlungserinnerung', tageNachFaelligkeit: 14,
      gebuehrCent: cent(250n), zinsberechnung: 'keine', gueltigAb: '2026-10-01',
    }));
    /* Ausdrücklich ohne Text. */
    await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 1, bezeichnung: 'Zahlungserinnerung', tageNachFaelligkeit: 14,
      gebuehrCent: cent(250n), zinsberechnung: 'keine', gueltigAb: '2026-11-01',
      textbaustein: null,
    }));

    const zeilen = await alsApp(sitzung(), async (tx) => mahnstufen(kontextAus(tx)));
    const nachTag = new Map(zeilen.map((z) => [z.gueltigAb, z.textbaustein]));
    const text = 'Sicher haben Sie die Rechnung übersehen.\nBitte prüfen Sie.';
    expect(nachTag.get('2026-09-01')).toBe(text);
    expect(nachTag.get('2026-10-01')).toBe(text);
    expect(nachTag.get('2026-11-01')).toBeNull();
  });

  /*
   * V-217: „weggelassen = übernommen" holte den Text auch aus einer
   * Platzhalterfassung. Mit dem Seed stand „PLATZHALTER (O-19): …" in jeder
   * Stufe, und die erste echte Fassung ohne eigenen Text erbte ihn — in den
   * Brief an den Kunden.
   */
  it('der Text einer PLATZHALTERfassung wird nicht übernommen', async () => {
    await sql.unsafe(
      `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                              textbaustein, ist_platzhalter, gueltig_ab, erstellt_von_art,
                              erstellt_von_dienst)
       values ($1, 1, 'Zahlungserinnerung (unbestätigt)', 14,
               'PLATZHALTER (O-19): kein Wortlaut der Gesellschaft.', true, '2026-01-01',
               'system', 'job:test')`, [f.reinigung]);
    const neu = await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 1, bezeichnung: 'Zahlungserinnerung', tageNachFaelligkeit: 14,
      gebuehrCent: cent(0n), zinsberechnung: 'keine', gueltigAb: '2026-09-01',
    }));
    const zeilen = await alsApp(sitzung(), async (tx) => mahnstufen(kontextAus(tx)));
    expect(zeilen.find((z) => z.id === neu)?.textbaustein).toBeNull();
    /* Die Platzhalterfassung selbst behält ihren Text — umgeschrieben wird nichts. */
    expect(zeilen.find((z) => z.id !== neu)?.textbaustein)
      .toBe('PLATZHALTER (O-19): kein Wortlaut der Gesellschaft.');
  });

  it('die Abweisung einer zu frühen Fassung nennt die Tage als TT.MM.JJJJ', async () => {
    await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 3, bezeichnung: 'Letzte Mahnung', tageNachFaelligkeit: 42,
      gebuehrCent: cent(0n), zinsberechnung: 'keine', gueltigAb: '2026-09-01',
    }));
    const fehler: unknown = await alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 3, bezeichnung: 'Letzte Mahnung', tageNachFaelligkeit: 42,
      gebuehrCent: cent(0n), zinsberechnung: 'keine', gueltigAb: '2026-08-01',
    })).then(() => null, (e: unknown) => e);
    expect(fehler).toBeInstanceOf(StufenFehler);
    expect((fehler as StufenFehler).message).toContain('seit dem 01.09.2026');
    expect((fehler as StufenFehler).message).toContain('frühestens am 02.09.2026');
    expect((fehler as StufenFehler).message).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
  });

  it('ein zu langer Mahntext wird mit Satz abgewiesen, nicht gekürzt', async () => {
    await expect(alsApp(sitzung(), async (tx) => bestaetigeStufe(kontextAus(tx), {
      stufe: 2, bezeichnung: 'Erste Mahnung', tageNachFaelligkeit: 28,
      gebuehrCent: cent(0n), zinsberechnung: 'keine', gueltigAb: '2026-09-01',
      textbaustein: 'x'.repeat(1001),
    }))).rejects.toThrow(StufenFehler);
  });

  it('die Mahnung liest den Text der Fassung, auf die sie zeigt — zwischen Datum und Forderungen',
    async () => {
      const id = await festgeschrieben();
      await macheUeberfaellig(id, 40);
      const stufeId = await legeStufeAn(1, 14);
      await sql.unsafe('update mahnstufe set textbaustein = $2 where id = $1',
        [stufeId, 'Wir bitten Sie, den offenen Betrag zu begleichen.']);
      const mahnungId = await alsApp(sitzung(), async (tx) => {
        const lage = await ermittleVorschlaege(alsDienst(tx));
        return legeMahnentwurfAn(alsDienst(tx), lage.vorschlaege[0]!);
      });

      const vorgang = await alsApp(sitzung(), async (tx) =>
        findeMahnung(kontextAus(tx), mahnungId));
      expect(vorgang!.kopf.textbaustein).toBe('Wir bitten Sie, den offenen Betrag zu begleichen.');

      const text = mahnungstext(vorgang!.kopf, vorgang!.positionen);
      const datum = text.indexOf('Datum:');
      const mahntext = text.indexOf('Wir bitten Sie, den offenen Betrag');
      const liste = text.indexOf('Offene Forderungen:');
      expect(datum).toBeGreaterThan(-1);
      expect(mahntext).toBeGreaterThan(datum);
      expect(liste).toBeGreaterThan(mahntext);

      /* Und die Freigabe bindet ihn (Invariante 7). */
      const nutzlast = mahnungNutzlast(f.reinigung, vorgang!.kopf, vorgang!.positionen);
      expect(nutzlast.inhalt['textbaustein'])
        .toBe('Wir bitten Sie, den offenen Betrag zu begleichen.');
    });
});

// ---------------------------------------------------------------------------
// (8) Das Schreiben ist ein Geschäftsbrief (V-213)
// ---------------------------------------------------------------------------

describe('(8) das Schreiben trägt Briefkopf, Anschrift und Pflichtangaben', () => {
  async function entwurf(): Promise<string> {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14, { gebuehrCent: 500n });
    return alsApp(sitzung(), async (tx) => {
      const lage = await ermittleVorschlaege(alsDienst(tx));
      return legeMahnentwurfAn(alsDienst(tx), lage.vorschlaege[0]!);
    });
  }

  beforeEach(async () => {
    await sql.unsafe(
      `update mandant
          set handelsregister_gericht = 'Amtsgericht Charlottenburg',
              handelsregister_nummer = 'HRB 12345 B',
              geschaeftsfuehrer = array['Max Muster', 'Erika Beispiel']
        where id = $1`, [f.reinigung]);
  });

  it('Absender, Empfängeranschrift, Pflichtangaben — und kein Tag als JJJJ-MM-TT', async () => {
    const mahnungId = await entwurf();
    const vorgang = await alsApp(sitzung(), async (tx) =>
      findeMahnung(kontextAus(tx), mahnungId));
    const text = mahnungstext(vorgang!.kopf, vorgang!.positionen);
    const [firma] = await sql.unsafe<{ firma: string }[]>(
      'select firma from mandant where id = $1', [f.reinigung]);

    const zeilen = text.split('\n');
    /* Die Absenderzeile zuerst, dann die Anschrift des Empfängers. */
    expect(zeilen[0]).toBe(`${firma!.firma} · Kurfürstendamm 21 · 10719 Berlin`);
    expect(zeilen.slice(2, 5)).toEqual(['Beispiel GmbH', 'Musterweg 7', '10178 Berlin']);
    /* Die Pflichtangaben (§ 35a GmbHG) am Ende. */
    expect(text).toContain('Amtsgericht Charlottenburg HRB 12345 B');
    expect(text).toContain('Geschäftsführung: Max Muster, Erika Beispiel');
    expect(text).toContain('USt-IdNr. DE123456789');
    expect(text).toContain('Steuernummer 30/123/45678');
    expect(text).toContain('IBAN DE02120300000000202051');
    /* Die Hausschreibweise — der Test fände jedes ISO-Datum im Brief. */
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
    expect(text).toMatch(/Datum: \d{2}\.\d{2}\.\d{4}/u);
    expect(text).toMatch(/fällig am \d{2}\.\d{2}\.\d{4}/u);
    expect(text).toMatch(/Ausgleich bis zum \d{2}\.\d{2}\.\d{4}\./u);
    expect(text).not.toContain('Basispunkte');
  });

  it('eine abweichende Rechnungsanschrift ist die Anschrift des Schreibens', async () => {
    await sql.unsafe(
      `update kunde
          set rechnungsadresse_abweichend = true, rechnung_name = 'Beispiel GmbH Buchhaltung',
              rechnung_strasse = 'Postfach', rechnung_hausnummer = '12 34',
              rechnung_plz = '10001', rechnung_ort = 'Berlin', rechnung_land = 'AT'
        where id = $1`, [kundeId]);
    const mahnungId = await entwurf();
    const vorgang = await alsApp(sitzung(), async (tx) =>
      findeMahnung(kontextAus(tx), mahnungId));
    expect(vorgang!.kopf.empfaenger).toEqual({
      name: 'Beispiel GmbH Buchhaltung', strasse: 'Postfach 12 34', plz: '10001',
      ort: 'Berlin', land: 'AT',
    });
    const text = mahnungstext(vorgang!.kopf, vorgang!.positionen);
    /* Das Land als Name in der letzten Zeile, nicht als Code (V-217). */
    expect(text.split('\n').slice(2, 6))
      .toEqual(['Beispiel GmbH Buchhaltung', 'Postfach 12 34', '10001 Berlin', 'ÖSTERREICH']);
  });

  it('der Versand meldet Berliner Ortszeit und das Blatt findet das abgelegte Schreiben',
    async () => {
      const mahnungId = await entwurf();
      await alsApp(sitzung(), async (tx) =>
        gibFrei(kontextAus(tx), mahnungId, 'Freigegeben zur Versendung als Brief.'));
      const ergebnis = await alsApp(sitzung(), async (tx) => dokumentiereVersand(
        kontextAus(tx),
        { id: mahnungId, versandart: 'brief', empfaenger: 'Beispiel GmbH' },
        new LokalerSpeicher(),
      ));
      expect(ergebnis.versendetAm).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u);
      const [berlin] = await sql.unsafe<{ t: string }[]>(
        `select to_char(versendet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as t
           from mahnung where id = $1`, [mahnungId]);
      expect(ergebnis.versendetAm).toBe(berlin!.t);

      const vorgang = await alsApp(sitzung(), async (tx) =>
        findeMahnung(kontextAus(tx), mahnungId));
      expect(vorgang!.kopf.dokumentId).toBe(ergebnis.dokumentId);
    });
});

// ---------------------------------------------------------------------------
// (9) Die Freigabe friert den Brief ein (V-217, 0449, D-709)
// ---------------------------------------------------------------------------

/**
 * **Der Befund der Prüfung von V-213.** Briefkopf und Anschrift wurden live
 * gelesen und von der Freigabe gebunden; aus `freigegeben` führt kein Weg
 * zurück. Wer nach der Freigabe die Kundenanschrift, eine Telefonnummer oder
 * die Geschäftsführung pflegte, hatte eine Mahnung, die nie mehr hinausging,
 * nicht verworfen werden konnte und ihre Posten für immer sperrte. (8) hielt
 * das vorher als „geht nichts hinaus" fest.
 */
describe('(9) die Freigabe friert den Brief ein', () => {
  async function entwurf(): Promise<string> {
    const id = await festgeschrieben();
    await macheUeberfaellig(id, 40);
    await legeStufeAn(1, 14, { gebuehrCent: 500n });
    return alsApp(sitzung(), async (tx) => {
      const lage = await ermittleVorschlaege(alsDienst(tx));
      return legeMahnentwurfAn(alsDienst(tx), lage.vorschlaege[0]!);
    });
  }

  it('Stammdaten nach der Freigabe gepflegt: der FREIGEGEBENE Brief geht hinaus', async () => {
    const mahnungId = await entwurf();
    await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Freigegeben zur Versendung als Brief.'));
    const vorher = await alsApp(sitzung(), async (tx) => findeMahnung(kontextAus(tx), mahnungId));
    expect(vorher!.kopf.briefEingefroren).toBe(true);

    /* Die Pflege, die vorher jede freigegebene Mahnung festhielt. */
    await sql.unsafe(
      "update kunde set strasse = 'Andere Strasse', name = 'Beispiel GmbH (neu)' where id = $1",
      [kundeId]);
    await sql.unsafe(
      `update mandant set telefon = '+49 30 9999999', geschaeftsfuehrer = array['Neu Person']
        where id = $1`, [f.reinigung]);
    await sql.unsafe(
      `update mandant_identitaet set brief_fuss = 'Neue Fusszeile.' where mandant_id = $1`,
      [f.reinigung]);

    const nachher = await alsApp(sitzung(), async (tx) => findeMahnung(kontextAus(tx), mahnungId));
    expect(nachher!.kopf.empfaenger).toEqual(vorher!.kopf.empfaenger);
    expect(nachher!.kopf.absender).toEqual(vorher!.kopf.absender);
    expect(nachher!.kopf.kundeName).toBe(vorher!.kopf.kundeName);
    expect(nachher!.kopf.briefFuss).toBe(vorher!.kopf.briefFuss);
    const text = mahnungstext(nachher!.kopf, nachher!.positionen);
    expect(text).toContain('Musterweg 7');
    expect(text).not.toContain('Andere Strasse');
    expect(text).not.toContain('Neu Person');
    expect(text).not.toContain('Neue Fusszeile.');

    const ergebnis = await alsApp(sitzung(), async (tx) => dokumentiereVersand(
      kontextAus(tx),
      { id: mahnungId, versandart: 'brief', empfaenger: 'Beispiel GmbH' },
      new LokalerSpeicher(),
    ));
    expect(ergebnis.dokumentId).toMatch(/^[0-9a-f-]{36}$/u);

    /* Was hinausging, hat den Abdruck, den die Freigabe trägt (Invariante 7). */
    const [abdruck] = await sql.unsafe<{ versand: string; freigabe: string }[]>(
      `select v.nutzlast_hash as versand,
              (select s.nutzlast_hash from freigabe_snapshot s
                where s.freigabe_id = m.freigabe_id order by s.kette_nr desc limit 1) as freigabe
         from mahnung m join versand v on v.freigabe_id = m.freigabe_id
        where m.id = $1`, [mahnungId]);
    expect(abdruck!.versand).toBe(abdruck!.freigabe);

    /* Und die versendete Mahnung zeigt weiter den Brief, der hinausging. */
    const danach = await alsApp(sitzung(), async (tx) => findeMahnung(kontextAus(tx), mahnungId));
    expect(mahnungstext(danach!.kopf, danach!.positionen)).toBe(text);
  });

  it('ein geänderter BETRAG hält die Mahnung weiter am Tor', async () => {
    const mahnungId = await entwurf();
    await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Freigegeben mit der geprüften Summe.'));
    await sql.unsafe(
      `update mahnung set gebuehr_cent = 9900,
                          gesamt_cent = forderung_cent + 9900 + zinsen_cent
        where id = $1`, [mahnungId]);
    await expect(alsApp(sitzung(), async (tx) => dokumentiereVersand(
      kontextAus(tx),
      { id: mahnungId, versandart: 'brief', empfaenger: 'Beispiel GmbH' },
      new LokalerSpeicher(),
    ))).rejects.toThrow(FreigabeErforderlich);
  });

  it('der eingefrorene Brief ändert sich nicht mehr — auch nicht vor dem Versand', async () => {
    const mahnungId = await entwurf();
    await alsApp(sitzung(), async (tx) =>
      gibFrei(kontextAus(tx), mahnungId, 'Freigegeben zur Versendung als Brief.'));
    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `update mahnung set brief = jsonb_set(brief, '{empfaenger,strasse}', '"Andere Strasse"')
        where id = $1`, [mahnungId] as never[]))).rejects.toThrow(/eingefroren/u);
  });

  it('ein Entwurf trägt keinen eingefrorenen Brief', async () => {
    const mahnungId = await entwurf();
    const vorgang = await alsApp(sitzung(), async (tx) => findeMahnung(kontextAus(tx), mahnungId));
    expect(vorgang!.kopf.briefEingefroren).toBe(false);
    await expect(sql.unsafe(
      `update mahnung set brief = '{"kunde":"X"}'::jsonb where id = $1`, [mahnungId]))
      .rejects.toThrow(/mahnung_brief_erst_mit_freigabe|eingefroren/u);
  });

  it('eine Freigabe ohne Brief weist die Datenbank ab (0449)', async () => {
    const mahnungId = await entwurf();
    await expect(alsApp(sitzung(), async (tx) => {
      const freigabeId = await erteileFreigabe(alsDienst(tx), {
        aktion: 'mahnung_senden', inhalt: { mahnungId },
        begruendung: 'Freigabe am Dienst vorbei, ohne Brief.', abdruck: 'a'.repeat(64),
      });
      return tx.unsafe(
        `update mahnung set status = 'freigegeben', freigabe_id = $2 where id = $1`,
        [mahnungId, freigabeId] as never[]);
    })).rejects.toThrow(/friert den Brief ein/u);
    const [zeile] = await sql.unsafe<{ status: string; nummer: string | null }[]>(
      'select status::text as status, nummer from mahnung where id = $1', [mahnungId]);
    expect(zeile!.status).toBe('entwurf');
    expect(zeile!.nummer).toBeNull();
  });
});
