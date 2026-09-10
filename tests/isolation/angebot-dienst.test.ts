/**
 * Der Angebotsdienst von Ende zu Ende: Raumbuch → Kalkulation → Angebot →
 * Versand → Auftrag, gegen eine echte Datenbank.
 *
 * Der interessante Teil ist nicht, dass es funktioniert, sondern was
 * passiert, wenn es NICHT funktioniert: eine gezogene Nummer, deren Versand
 * scheitert, darf keine Luecke hinterlassen, und ein zweiter Versuch, aus
 * demselben Angebot einen zweiten Auftrag zu machen, darf nicht gelingen.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { ladeKalkulationsgrundlage } from '../../src/server/services/kalkulation/raumbuch.js';
import { kalkuliere } from '../../src/server/services/kalkulation/index.js';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF }
  from '../../src/server/services/kalkulation/tarif.js';
import {
  AngebotFehler, legeAngebotAn, uebernimmKalkulation, versendeAngebot, wandleInAuftrag,
} from '../../src/server/services/angebot/index.js';

let f: Fixtur;
let chef = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `dienst-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

/** Ein Angebotskreis, wie der Seed ihn anlegt — bestaetigt, nicht lueckenlos. */
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

/** Ein Objekt mit einem kleinen, echten Raumbuch. */
async function objektMitRaumbuch(mandant: string, kundeId: string): Promise<string> {
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,'PVC','PVC / Vinyl','250.000','Platzhalter (O-17)','2026-01-01') returning id`,
    [mandant]);
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

function kontextAus(tx: Parameters<Parameters<typeof alsApp>[1]>[0]) {
  return {
    abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[],
    unsafe: async (s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly unknown[],
  };
}

const alsChef = <T>(fn: (db: ReturnType<typeof kontextAus>) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: chef,
           portal: 'intern', readonly: false }, async (tx) => fn(kontextAus(tx)));

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.reinigung, await rolleId('leitung')]);
  await nummernkreis(f.reinigung, 'angebot', 'AN-{jahr}-{nr:5}');
  await nummernkreis(f.reinigung, 'auftrag', 'AU-{jahr}-{nr:5}');
});
afterAll(schliessen);

describe('(1) Vom Raumbuch zum versendeten Angebot', () => {
  it('die ganze Kette, in einer Sitzung', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);

    const ergebnis = await alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
      const kalk = kalkuliere({
        posten: grundlage.posten,
        frequenz: PLATZHALTER_FREQUENZ.frequenz('1_pro_monat'),
        tarif: PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung'),
      });
      const angebotId = await legeAngebotAn(db, {
        kundeId: k, titel: 'Unterhaltsreinigung 2026', objektId: o,
      });
      const positionen = await uebernimmKalkulation(db, angebotId, kalk,
        { objektId: o, turnusLabel: 'monatlich' });
      const versand = await versendeAngebot(db, angebotId, chef);
      return { angebotId, positionen, versand, netto: kalk.netto };
    });

    expect(ergebnis.positionen).toBe(1);          // eine Belagsart, eine Zeile
    expect(ergebnis.versand.angebotsnummer).toMatch(/^AN-2026-00001$/u);

    // 500 m² ÷ 250 m²/h = 2 h × 29,00 € = 58,00 € Lohn.
    const [z] = await sql.unsafe<{ netto: string; status: string; nummer: string }[]>(
      `select netto_cent::text as netto, status, angebotsnummer as nummer
         from angebot where id = $1`, [ergebnis.angebotId]);
    expect(z!.netto).toBe('5800');
    expect(z!.status).toBe('versendet');
  });

  it('der Langtext erklaert den Preis — Flaeche, Leistungswert, Stunden', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);
    const angebotId = await alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
      const kalk = kalkuliere({
        posten: grundlage.posten,
        frequenz: PLATZHALTER_FREQUENZ.frequenz('1_pro_monat'),
        tarif: PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung'),
      });
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Test' });
      await uebernimmKalkulation(db, id, kalk, { turnusLabel: 'monatlich' });
      return id;
    });
    const [p] = await sql.unsafe<{ langtext: string }[]>(
      `select langtext from angebotsposition where angebot_id = $1`, [angebotId]);
    expect(p!.langtext).toContain('500,00 m²');
    expect(p!.langtext).toContain('250,00 m²/h');
    expect(p!.langtext).toContain('2,00 Std.');
    expect(p!.langtext).toContain('monatlich');
  });

  it('die Nummern laufen fort — zwei Angebote, zwei Nummern', async () => {
    const k = await kunde(f.reinigung);
    const nummern = await alsChef(async (db) => {
      const gezogen: string[] = [];
      for (const titel of ['Erstes', 'Zweites']) {
        const id = await legeAngebotAn(db, { kundeId: k, titel });
        await db.abfrage(
          `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                         menge, einheit, einzelpreis_cent, steuersatz_bp)
           values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 1000, 1900)`, [id]);
        gezogen.push((await versendeAngebot(db, id, chef)).angebotsnummer);
      }
      return gezogen;
    });
    expect(nummern).toEqual(['AN-2026-00001', 'AN-2026-00002']);
  });
});

describe('(2) Was der Dienst verweigert', () => {
  it('ein Angebot ohne Position wird nicht versendet', async () => {
    const k = await kunde(f.reinigung);
    await expect(alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Leer' });
      return versendeAngebot(db, id, chef);
    })).rejects.toThrow(AngebotFehler);
  });

  it('ein bereits versendetes Angebot nicht erneut', async () => {
    const k = await kunde(f.reinigung);
    await expect(alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Doppelt' });
      await db.abfrage(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp)
         values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 1000, 1900)`, [id]);
      await versendeAngebot(db, id, chef);
      return versendeAngebot(db, id, chef);
    })).rejects.toThrow(/nicht erneut versendet/u);
  });

  /**
   * Die Zusage hinter FIN-03, hier fuer den Angebotskreis: ein gescheiterter
   * Versand darf keine verbrauchte Nummer hinterlassen. Der Zug und das
   * UPDATE stehen in EINER Transaktion; scheitert das UPDATE, faellt der Zug
   * mit zurueck.
   */
  it('ein gescheiterter Versand verbraucht KEINE Nummer', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);

    await expect(alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Mit Platzhalterkalkulation' });
      await db.abfrage(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp)
         values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 1000, 1900)`, [id]);
      // Eine Kalkulation, die auf Platzhaltern steht — der Versand muss scheitern.
      await db.abfrage(
        `insert into kalkulation (mandant_id, angebot_id, basis_objekt_id)
         values (app.aktiver_mandant(), $1, $2)`, [id, o]);
      return versendeAngebot(db, id, chef);
    })).rejects.toThrow(/unbestaetigte Werte/u);

    // Der naechste erfolgreiche Versand bekommt die ERSTE Nummer.
    const nummer = await alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Sauber' });
      await db.abfrage(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp)
         values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 1000, 1900)`, [id]);
      return (await versendeAngebot(db, id, chef)).angebotsnummer;
    });
    expect(nummer).toBe('AN-2026-00001');
  });
});

describe('(3) Angebot → Auftrag (OPS-09) — in einer Handlung', () => {
  async function versendetesAngebot(kundeId: string): Promise<string> {
    return alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId, titel: 'Unterhaltsreinigung' });
      await db.abfrage(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp)
         values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 250000, 1900)`, [id]);
      await versendeAngebot(db, id, chef);
      return id;
    });
  }

  it('der Auftrag uebernimmt Kunde, Titel und WERT — ungerechnet', async () => {
    const k = await kunde(f.reinigung);
    const a = await versendetesAngebot(k);
    const ergebnis = await alsChef((db) => wandleInAuftrag(db, a, {
      art: 'rahmenvertrag', verantwortlichBenutzerId: chef, startDatum: '2026-04-01',
    }));
    expect(ergebnis.auftragsnummer).toBe('AU-2026-00001');

    const [z] = await sql.unsafe<{ wert: string; titel: string; angebot: string }[]>(
      `select auftragswert_netto_cent::text as wert, bezeichnung as titel,
              angebot_id::text as angebot from auftrag where id = $1`, [ergebnis.auftragId]);
    expect(z!.wert).toBe('250000');
    expect(z!.angebot).toBe(a);
  });

  it('und das Angebot gilt danach als angenommen', async () => {
    const k = await kunde(f.reinigung);
    const a = await versendetesAngebot(k);
    await alsChef((db) => wandleInAuftrag(db, a, {
      art: 'einzelauftrag', verantwortlichBenutzerId: chef, startDatum: '2026-04-01',
    }));
    const [z] = await sql.unsafe<{ status: string; entschieden: Date | null }[]>(
      `select status, entschieden_am as entschieden from angebot where id = $1`, [a]);
    expect(z!.status).toBe('angenommen');
    expect(z!.entschieden).not.toBeNull();
  });

  it('ein zweiter Auftrag aus demselben Angebot entsteht NICHT', async () => {
    const k = await kunde(f.reinigung);
    const a = await versendetesAngebot(k);
    await alsChef((db) => wandleInAuftrag(db, a, {
      art: 'einzelauftrag', verantwortlichBenutzerId: chef, startDatum: '2026-04-01',
    }));
    await expect(alsChef((db) => wandleInAuftrag(db, a, {
      art: 'einzelauftrag', verantwortlichBenutzerId: chef, startDatum: '2026-05-01',
    }))).rejects.toThrow(/bereits ein Auftrag/u);
  });

  it('ein ENTWURF wird nicht zum Auftrag', async () => {
    const k = await kunde(f.reinigung);
    await expect(alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Entwurf' });
      return wandleInAuftrag(db, id, {
        art: 'einzelauftrag', verantwortlichBenutzerId: chef, startDatum: '2026-04-01',
      });
    })).rejects.toThrow(/nicht versendetes Angebot/u);
  });
});
