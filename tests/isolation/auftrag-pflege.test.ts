/**
 * Der Auftrag nach der Anlage — und die Prüfungen davor (V-172, V-173,
 * OPS-05, OPS-07, OPS-09, OPS-10).
 *
 * **V-172.** Die Formulare des Assistenten und der Kalkulationsbestätigung
 * bekamen auf jede Abweisung eine weisse JSON-Seite. Die Routen fragen jetzt
 * vorher, was sonst als 22007, 23503 oder 23514 aus der Tiefe käme
 * (`pruefeAuftragsbezug`), und eine `KalkulationFehler` nennt ihr Feld.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { pruefeAuftragsbezug } from '../../src/server/services/auftrag/angaben.js';
import { ladeKalkulationsgrundlage } from '../../src/server/services/kalkulation/raumbuch.js';
import { kalkuliere } from '../../src/server/services/kalkulation/index.js';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF }
  from '../../src/server/services/kalkulation/tarif.js';
import {
  gibPreisFrei, legeAngebotAn, uebernimmKalkulation, versendeAngebot, wandleInAuftrag,
} from '../../src/server/services/angebot/index.js';
import { aendereAuftrag, AuftragPflegeFehler }
  from '../../src/server/services/auftrag/aendern.js';
import { AuftragsangabenFehler } from '../../src/server/services/auftrag/angaben.js';
import { bestaetigeKalkulation, KalkulationFehler }
  from '../../src/server/services/kalkulation/bestaetigung.js';

let f: Fixtur;
let chef = '';
let fremd = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `pflege-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function nummernkreis(mandant: string, typ: string, maske: string): Promise<void> {
  await sql.unsafe(
    `insert into nummernkreis (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos,
                               format_maske, zuruecksetzung, geoeffnet_am, ist_platzhalter,
                               erstellt_von_art, erstellt_von_dienst)
     values ($1,$2::nummernkreis_typ,2026,$3,false,$4,'jaehrlich',current_date,false,
             'system','job:test')`,
    [mandant, typ, typ, maske]);
}

async function kunde(mandant: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Hausverwaltung','bestandskunde','Vertrag', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  return z!.id;
}

async function objektMitRaumbuch(mandant: string, kundeId: string): Promise<string> {
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,$2,'PVC / Vinyl','250.000','Platzhalter (O-17)','2026-01-01') returning id`,
    [mandant, `PVC${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Buerohaus','Kurfuerstendamm 21','10719','Berlin') returning id`,
    [mandant, kundeId, `OBJ-${zufall()}`]);
  for (const [nr, flaeche] of [['101', '300.000'], ['102', '200.000']] as const) {
    await sql.unsafe(
      `insert into raum (mandant_id, objekt_id, raumnummer, etage, flaeche_qm, belagsart_id)
       values ($1,$2,$3,'EG',$4,$5)`, [mandant, o!.id, nr, flaeche, b!.id]);
  }
  return o!.id;
}

function kontextAus(tx: Parameters<Parameters<typeof alsApp>[1]>[0], benutzer: string,
  mandant: string) {
  return {
    aktiverMandantId: mandant,
    benutzerId: benutzer,
    abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[],
    schreibe: async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[],
    unsafe: async (s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly unknown[],
  };
}

const als = <T>(benutzer: string, mandant: string,
  fn: (db: ReturnType<typeof kontextAus>) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: benutzer,
           portal: 'intern', readonly: false }, async (tx) => fn(kontextAus(tx, benutzer, mandant)));
const alsChef = <T>(fn: (db: ReturnType<typeof kontextAus>) => Promise<T>): Promise<T> =>
  als(chef, f.reinigung, fn);

async function angebotMitKalkulation(): Promise<{ angebotId: string; kundeId: string;
  objektId: string }> {
  const k = await kunde(f.reinigung);
  const o = await objektMitRaumbuch(f.reinigung, k);
  const angebotId = await alsChef(async (db) => {
    const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
    const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
    const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
    const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
    const id = await legeAngebotAn(db, { kundeId: k, titel: 'Unterhaltsreinigung', objektId: o });
    await uebernimmKalkulation(db, id, kalk,
      { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
    return id;
  });
  return { angebotId, kundeId: k, objektId: o };
}

beforeAll(async () => {
  f = await seed();
  chef = await konto();
  fremd = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.reinigung, await rolleId('leitung')]);
  // `fremd` leitet die SECURITY — als Verantwortlicher der Reinigung ist er fremd.
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [fremd, f.security, await rolleId('leitung')]);
  await nummernkreis(f.reinigung, 'angebot', 'AN-{jahr}-{nr:5}');
  await nummernkreis(f.reinigung, 'auftrag', 'AU-{jahr}-{nr:5}');
});
afterAll(schliessen);

describe('(1) pruefeAuftragsbezug — was sonst als Datenbankfehler käme (V-172)', () => {
  it('ein gültiger Bezug ergibt null', async () => {
    const k = await kunde(f.reinigung);
    expect(await alsChef((db) => pruefeAuftragsbezug(db, {
      kundeId: k, objektId: null, verantwortlichBenutzerId: chef,
      startDatum: '2026-10-01', laufzeitBis: '2027-09-30',
    }))).toBeNull();
  });

  it('ein Kunde der SECURITY ist in der Reinigung unbekannt (Invariante 3)', async () => {
    const k = await kunde(f.security);
    expect(await alsChef((db) => pruefeAuftragsbezug(db, {
      kundeId: k, verantwortlichBenutzerId: chef, startDatum: '2026-10-01',
    }))).toBe('kunde_unbekannt');
  });

  it('eine Leitung, die hier nicht Mitglied ist, wird genannt — nicht als 23514 geworfen', async () => {
    const k = await kunde(f.reinigung);
    expect(await alsChef((db) => pruefeAuftragsbezug(db, {
      kundeId: k, verantwortlichBenutzerId: fremd, startDatum: '2026-10-01',
    }))).toBe('verantwortlich_fremd');
  });

  it('Laufzeit vor Start und ein Datum, das es nicht gibt', async () => {
    const k = await kunde(f.reinigung);
    expect(await alsChef((db) => pruefeAuftragsbezug(db, {
      kundeId: k, verantwortlichBenutzerId: chef, startDatum: '2026-10-01',
      laufzeitBis: '2026-09-30',
    }))).toBe('laufzeit_vor_start');
    expect(await alsChef((db) => pruefeAuftragsbezug(db, {
      kundeId: k, verantwortlichBenutzerId: chef, startDatum: '2026-02-30',
    }))).toBe('datum_ungueltig');
  });

  it('ein fremdes Objekt ist unbekannt', async () => {
    const k = await kunde(f.reinigung);
    const kSec = await kunde(f.security);
    const oSec = await objektMitRaumbuch(f.security, kSec);
    expect(await alsChef((db) => pruefeAuftragsbezug(db, {
      kundeId: k, objektId: oSec, verantwortlichBenutzerId: chef, startDatum: '2026-10-01',
    }))).toBe('objekt_unbekannt');
  });
});

describe('(2) eine abgewiesene Kalkulationsbestätigung nennt ihr Feld (V-172)', () => {
  const werte = {
    stundensatzEuro: '29,00', gemeinkostenBasis: 'lohn', gemeinkostenProzent: '15',
    wagnisGewinnProzent: '8', frequenzFaktor: '1', leistungswerteBestaetigen: true,
  };

  it.each([
    [{ stundensatzEuro: '29 Euro' }, 'stundensatz'],
    [{ stundensatzEuro: '0,00' }, 'stundensatz'],
    [{ gemeinkostenProzent: 'viel' }, 'gemeinkosten'],
    [{ wagnisGewinnProzent: '1.001' }, 'wagnisGewinn'],
    [{ frequenzFaktor: '0' }, 'frequenzFaktor'],
    [{ gemeinkostenBasis: 'irgendwas' }, 'gemeinkostenBasis'],
  ])('%o → Feld %s, und nichts wird geschrieben', async (abweichung, feld) => {
    const { angebotId } = await angebotMitKalkulation();
    const vorher = await sql.unsafe<{ satz: string | null }[]>(
      `select stundenverrechnungssatz_cent::text as satz from kalkulation
        where angebot_id = $1`, [angebotId]);
    const fehler = await alsChef((db) => bestaetigeKalkulation(db, angebotId, {
      ...werte, ...abweichung, benutzerId: chef,
    })).then(() => null, (e: unknown) => e);
    expect(fehler).toBeInstanceOf(KalkulationFehler);
    expect((fehler as KalkulationFehler).feld).toBe(feld);
    const nachher = await sql.unsafe<{ satz: string | null }[]>(
      `select stundenverrechnungssatz_cent::text as satz from kalkulation
        where angebot_id = $1`, [angebotId]);
    expect(nachher).toEqual(vorher);
  });
});

/* ------------------------------------------------------------------------- */
/* V-173 — der Auftrag lässt sich pflegen, und die Wandlung trägt OPS-10     */
/* ------------------------------------------------------------------------- */

/** Ein von Hand angelegter Auftrag, wie ihn der Assistent schreibt — ohne Wert. */
async function auftragVonHand(): Promise<string> {
  const k = await kunde(f.reinigung);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1, $2, $3, 'rahmenvertrag', 'Unterhaltsreinigung Buero', $4, '2026-10-01')
     returning id`, [f.reinigung, `AU-H-${zufall()}`, k, chef]);
  return a!.id;
}

interface Stand {
  bezeichnung: string; wert: string | null; personal: number | null; stunden: string | null;
  ausstattung: string | null; laufzeit: string | null; leitung: string;
}
async function stand(id: string): Promise<Stand> {
  const [z] = await sql.unsafe<Stand[]>(
    `select bezeichnung, auftragswert_netto_cent::text as wert,
            personalbedarf_anzahl as personal, wochenstunden_soll::text as stunden,
            ausstattung_hinweis as ausstattung,
            to_char(laufzeit_bis, 'YYYY-MM-DD') as laufzeit,
            verantwortlich_benutzer_id::text as leitung
       from auftrag where id = $1`, [id]);
  return z!;
}

const PFLEGE = {
  bezeichnung: 'Unterhaltsreinigung Buero', verantwortlichBenutzerId: '',
  laufzeitBis: '', auftragswertNetto: '', personalbedarfAnzahl: '',
  wochenstundenSoll: '', ausstattungHinweis: '', beschreibung: '',
};

describe('(3) aendereAuftrag — Stammdaten nach der Anlage (V-173, OPS-05, OPS-10)', () => {
  it('trägt Wert, Personalbedarf, Stunden, Ausstattung und Laufzeit nach — Geld in ganzen Cent', async () => {
    const id = await auftragVonHand();
    const geaendert = await alsChef((db) => aendereAuftrag(db as never, {
      ...PFLEGE, auftragId: id, verantwortlichBenutzerId: chef,
      bezeichnung: 'Unterhaltsreinigung Bürohaus', auftragswertNetto: '12.500,00',
      personalbedarfAnzahl: '4', wochenstundenSoll: '38,5',
      ausstattungHinweis: 'Scheuersaugmaschine', laufzeitBis: '2027-09-30',
    }));
    expect([...geaendert].sort()).toEqual([
      'ausstattung_hinweis', 'bezeichnung', 'laufzeit_bis', 'personalbedarf_anzahl',
      'wert', 'wochenstunden_soll']);
    expect(await stand(id)).toEqual({
      bezeichnung: 'Unterhaltsreinigung Bürohaus', wert: '1250000', personal: 4,
      stunden: '38.500', ausstattung: 'Scheuersaugmaschine', laufzeit: '2027-09-30',
      leitung: chef,
    });
  });

  it('schreibt Vorher und Nachher ins Protokoll — nur die geänderten Felder', async () => {
    const id = await auftragVonHand();
    await alsChef((db) => aendereAuftrag(db as never, {
      ...PFLEGE, auftragId: id, verantwortlichBenutzerId: chef, auftragswertNetto: '99,90',
    }));
    const [z] = await sql.unsafe<{
      vorher: Record<string, unknown>; nachher: Record<string, unknown>;
    }[]>(
      `select vorher, nachher from audit_log
        where aktion = 'auftrag.geaendert' and objekt_id = $1
        order by id desc limit 1`, [id]);
    expect(z?.vorher).toMatchObject({ wert: null });
    expect(z?.nachher).toMatchObject({ wert: '9990' });
    expect(Object.keys(z?.nachher ?? {}).sort()).toEqual(['nummer', 'wert']);
  });

  it('ohne Änderung wird nichts geschrieben und nichts protokolliert', async () => {
    const id = await auftragVonHand();
    const geaendert = await alsChef((db) => aendereAuftrag(db as never, {
      ...PFLEGE, auftragId: id, verantwortlichBenutzerId: chef,
    }));
    expect(geaendert).toEqual([]);
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'auftrag.geaendert' and objekt_id = $1`, [id]);
    expect(n!.n).toBe('0');
  });

  it('weist unlesbare Zahlen, einen negativen Wert, eine fremde Leitung und eine Laufzeit vor dem Start ab', async () => {
    const id = await auftragVonHand();
    const vorher = await stand(id);
    for (const [abweichung, grund] of [
      [{ wochenstundenSoll: '40 Std' }, 'keine_zahl'],
      [{ auftragswertNetto: '-5,00' }, 'wert_ungueltig'],
      [{ personalbedarfAnzahl: '5001' }, 'ausserhalb_bereich'],
      [{ verantwortlichBenutzerId: fremd }, 'verantwortlich_fremd'],
      [{ laufzeitBis: '2026-09-30' }, 'laufzeit_vor_start'],
    ] as const) {
      const fehler = await alsChef((db) => aendereAuftrag(db as never, {
        ...PFLEGE, auftragId: id, verantwortlichBenutzerId: chef, ...abweichung,
      })).then(() => null, (e: unknown) => e);
      expect(fehler).toBeInstanceOf(AuftragsangabenFehler);
      expect((fehler as AuftragsangabenFehler).grund).toBe(grund);
    }
    expect(await stand(id)).toEqual(vorher);
  });

  it('ein stornierter Auftrag wird nicht mehr geändert', async () => {
    const id = await auftragVonHand();
    await sql.unsafe(
      `update auftrag set status = 'storniert', status_grund = 'Kunde hat abgesagt'
        where id = $1`, [id]);
    await expect(alsChef((db) => aendereAuftrag(db as never, {
      ...PFLEGE, auftragId: id, verantwortlichBenutzerId: chef, bezeichnung: 'Anders',
    }))).rejects.toMatchObject({ grund: 'gesperrt' });
    expect((await stand(id)).bezeichnung).toBe('Unterhaltsreinigung Buero');
  });

  it('eine fremde Gesellschaft und die Gruppenansicht finden ihn nicht (Invariante 3, 10)', async () => {
    const id = await auftragVonHand();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1, $2, $3) on conflict do nothing`,
      [chef, f.security, await rolleId('leitung')]);
    await expect(als(chef, f.security, (db) => aendereAuftrag(db as never, {
      ...PFLEGE, auftragId: id, verantwortlichBenutzerId: chef, bezeichnung: 'Fremd',
    }))).rejects.toBeInstanceOf(AuftragPflegeFehler);
    await expect(alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.security], benutzerId: chef,
        portal: 'intern', readonly: true },
      (tx) => aendereAuftrag(kontextAus(tx, chef, f.reinigung) as never, {
        ...PFLEGE, auftragId: id, verantwortlichBenutzerId: chef, bezeichnung: 'Gruppe',
      }))).rejects.toBeInstanceOf(AuftragPflegeFehler);
    expect((await stand(id)).bezeichnung).toBe('Unterhaltsreinigung Buero');
  });
});

describe('(4) die Wandlung trägt OPS-10, und der Wert aus dem Angebot bleibt (V-173)', () => {
  async function gewandelt(ops10: {
    personalbedarfAnzahl?: number | null; wochenstundenSoll?: string | null;
    ausstattungHinweis?: string | null;
  }): Promise<{ auftragId: string; netto: string }> {
    const { angebotId } = await angebotMitKalkulation();
    await alsChef((db) => bestaetigeKalkulation(db, angebotId, {
      stundensatzEuro: '29,00', gemeinkostenBasis: 'lohn', gemeinkostenProzent: '15',
      wagnisGewinnProzent: '8', frequenzFaktor: '1', leistungswerteBestaetigen: true,
      benutzerId: chef,
    }));
    const auftrag = await alsChef(async (db) => {
      await gibPreisFrei(db, angebotId, chef);
      await versendeAngebot(db, angebotId, chef);
      return wandleInAuftrag(db, angebotId, {
        art: 'rahmenvertrag', verantwortlichBenutzerId: chef, startDatum: '2026-11-01',
        ...ops10,
      });
    });
    const [a] = await sql.unsafe<{ netto: string }[]>(
      `select netto_cent::text as netto from angebot where id = $1`, [angebotId]);
    return { auftragId: auftrag.auftragId, netto: a!.netto };
  }

  it('Personalbedarf, Stunden und Ausstattung aus der Annahme stehen am Auftrag', async () => {
    const { auftragId, netto } = await gewandelt({
      personalbedarfAnzahl: 3, wochenstundenSoll: '25.500', ausstattungHinweis: 'Leiter, Wagen',
    });
    const z = await stand(auftragId);
    expect(z).toMatchObject({ personal: 3, stunden: '25.500', ausstattung: 'Leiter, Wagen',
                              wert: netto });
  });

  it('ohne Angaben bleiben sie leer — nichts wird geschätzt', async () => {
    const { auftragId } = await gewandelt({});
    expect(await stand(auftragId)).toMatchObject(
      { personal: null, stunden: null, ausstattung: null });
  });

  it('der Wert eines Auftrags aus dem Angebot wird in der Pflege nicht überschrieben', async () => {
    const { auftragId, netto } = await gewandelt({});
    await expect(alsChef((db) => aendereAuftrag(db as never, {
      ...PFLEGE, auftragId, verantwortlichBenutzerId: chef, auftragswertNetto: '1,00',
    }))).rejects.toMatchObject({ grund: 'wert_aus_angebot' });
    // Derselbe Wert, wie die Seite ihn mitschickt, lässt die übrigen Felder zu.
    const euro = `${String(BigInt(netto) / 100n)},${String(BigInt(netto) % 100n).padStart(2, '0')}`;
    const geaendert = await alsChef((db) => aendereAuftrag(db as never, {
      ...PFLEGE, auftragId, verantwortlichBenutzerId: chef, auftragswertNetto: euro,
      bezeichnung: 'Unterhaltsreinigung', personalbedarfAnzahl: '2',
    }));
    expect(geaendert).toEqual(['personalbedarf_anzahl']);
    expect((await stand(auftragId)).wert).toBe(netto);
  });
});
