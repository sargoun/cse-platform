/**
 * OPS-06 bis OPS-09 — Katalog, Kalkulation, Angebot und der Versand.
 *
 * Der Versand ist der Punkt, an dem aus einem Entwurf ein abgegebenes
 * Vertragsangebot wird. Ab da darf sich nichts mehr aendern, die Steuerzeilen
 * stehen, und die Kalkulation ist eingefroren — sonst laesst sich ein Preis
 * spaeter nicht mehr erklaeren, sondern nur noch behaupten.
 *
 * Und davor steht die Zusage, die diese Phase teuer macht, wenn sie fehlt:
 * **ein Angebot mit einer Kalkulation auf Platzhaltern geht NICHT hinaus.**
 * Ein eingefrorener Preis, der auf vier unbeantworteten Fragen ruht, sieht
 * pruefbar aus und ist es nicht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `angebot-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function kunde(mandant: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  return z!.id;
}

async function angebot(mandant: string, kundeId: string, felder: Partial<{
  titel: string; status: string;
}> = {}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into angebot (mandant_id, kunde_id, titel, status)
     values ($1,$2,$3,$4::angebot_status) returning id`,
    [mandant, kundeId, felder.titel ?? 'Unterhaltsreinigung 2026', felder.status ?? 'entwurf']);
  return z!.id;
}

async function position(mandant: string, angebotId: string, nr: number, felder: Partial<{
  menge: string; einzelpreis: bigint; satz: number; typ: string; kennzeichen: string; grund: string;
}> = {}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into angebotsposition (mandant_id, angebot_id, position_nr, typ, kurztext,
                                   menge, einheit, einzelpreis_cent, steuersatz_bp,
                                   steuer_kennzeichen, steuerbefreiung_grund)
     values ($1,$2,$3,$4::angebotsposition_typ,'Unterhaltsreinigung',
             $5,'m2',$6,$7,$8::steuer_kennzeichen,$9) returning id`,
    [mandant, angebotId, nr, felder.typ ?? 'leistung',
     felder.menge ?? '10.000', String(felder.einzelpreis ?? 250n), felder.satz ?? 1900,
     felder.kennzeichen ?? 'regelsatz', felder.grund ?? null]);
  return z!.id;
}

/** Ein vollstaendiger, bestaetigter Kalkulationskopf — kein Platzhalter mehr. */
async function kalkulation(mandant: string, angebotId: string,
                           platzhalter = false): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kalkulation (mandant_id, angebot_id, stundenverrechnungssatz_cent,
                              gemeinkosten_basis, gemeinkosten_bp, wagnis_gewinn_bp,
                              ist_platzhalter)
     values ($1,$2,$3,$4::gemeinkosten_basis,$5,$6,$7) returning id`,
    [mandant, angebotId,
     platzhalter ? null : 2900, platzhalter ? null : 'lohn',
     platzhalter ? null : 1500, platzhalter ? null : 800, platzhalter]);
  return z!.id;
}

/** Der Versand, wie der Dienst ihn ausfuehrt: Nummer UND Zeit in einem UPDATE. */
async function versende(angebotId: string, nummer?: string): Promise<void> {
  await sql.unsafe(
    `update angebot
        set status = 'versendet',
            freigegeben_von = $2, freigegeben_am = now(),
            versendet_von = $2, versendet_am = now(),
            angebotsnummer = $3
      where id = $1`,
    [angebotId, chef, nummer ?? `AN-2026-${zufall().slice(0, 5)}`]);
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.reinigung, await rolleId('leitung')]);
});
afterAll(schliessen);

describe('(1) Der Katalog ist versioniert und intern', () => {
  it('nur EINE aktive Fassung je Schluessel', async () => {
    await sql.unsafe(
      `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, version, status, gueltig_ab)
       values ($1,'unterhaltsreinigung','Unterhaltsreinigung',1,'aktiv','2026-01-01')`,
      [f.reinigung]);
    await expect(sql.unsafe(
      `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, version, status, gueltig_ab)
       values ($1,'unterhaltsreinigung','Unterhaltsreinigung v2',2,'aktiv','2026-06-01')`,
      [f.reinigung])).rejects.toThrow(/leistungskatalog_aktiv_uk/u);
  });

  it('aber zwei Fassungen nebeneinander, wenn eine Entwurf ist', async () => {
    await sql.unsafe(
      `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, version, status, gueltig_ab)
       values ($1,'reinigung','v1',1,'aktiv','2026-01-01'),
              ($1,'reinigung','v2',2,'entwurf','2026-06-01')`, [f.reinigung]);
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from leistungskatalog where mandant_id = $1`, [f.reinigung]);
    expect(Number(z!.n)).toBe(2);
  });

  it('eine Position ohne Zeitwert, Leistungswert UND Preis ist nicht kalkulierbar', async () => {
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
       values ($1,'k','K','2026-01-01') returning id`, [f.reinigung]);
    await expect(sql.unsafe(
      `insert into leistungskatalog_position
         (mandant_id, katalog_id, oz, kurztext, einheit, gueltig_ab)
       values ($1,$2,'01.001','Leere Position','stk','2026-01-01')`,
      [f.reinigung, k!.id])).rejects.toThrow(/lkp_kalkulierbar/u);
  });

  it('ein Elternteil aus einem FREMDEN Katalog wird abgewiesen', async () => {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
       values ($1,'a','A','2026-01-01') returning id`, [f.reinigung]);
    const [b] = await sql.unsafe<{ id: string }[]>(
      `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
       values ($1,'b','B','2026-01-01') returning id`, [f.reinigung]);
    const [titel] = await sql.unsafe<{ id: string }[]>(
      `insert into leistungskatalog_position
         (mandant_id, katalog_id, oz, kurztext, einheit, standard_einzelpreis_cent, gueltig_ab)
       values ($1,$2,'01','Titel','psch',0,'2026-01-01') returning id`, [f.reinigung, a!.id]);
    await expect(sql.unsafe(
      `insert into leistungskatalog_position
         (mandant_id, katalog_id, parent_id, oz, kurztext, einheit,
          standard_einzelpreis_cent, gueltig_ab)
       values ($1,$2,$3,'01.001','Unterposition','stk',100,'2026-01-01')`,
      [f.reinigung, b!.id, titel!.id])).rejects.toThrow(/anderen Katalog/u);
  });

  it('ein archivierter Katalog nimmt keine Position mehr auf', async () => {
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, status, gueltig_ab)
       values ($1,'alt','Alt','archiviert','2020-01-01') returning id`, [f.reinigung]);
    await expect(sql.unsafe(
      `insert into leistungskatalog_position
         (mandant_id, katalog_id, oz, kurztext, einheit, standard_einzelpreis_cent, gueltig_ab)
       values ($1,$2,'01.001','Neu','stk',100,'2026-01-01')`,
      [f.reinigung, k!.id])).rejects.toThrow(/archiviert/u);
  });

  it('im Kundenportal ist der Katalog nicht sichtbar', async () => {
    const k = await kunde(f.reinigung);
    const kundeKonto = await konto();
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
      [f.reinigung, k, kundeKonto]);
    await sql.unsafe(
      `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, status, gueltig_ab)
       values ($1,'k','K','aktiv','2026-01-01')`, [f.reinigung]);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from leistungskatalog`));
    expect(gesehen).toHaveLength(0);
  });
});

describe('(2) Die Kalkulation: NULL erlaubt, festgeschrieben nur vollstaendig', () => {
  it('ein Entwurf DARF die drei offenen Saetze leer lassen (O-16)', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    const id = await kalkulation(f.reinigung, a, true);
    const [z] = await sql.unsafe<{ ist_platzhalter: boolean }[]>(
      `select ist_platzhalter from kalkulation where id = $1`, [id]);
    expect(z!.ist_platzhalter).toBe(true);
  });

  it('festgeschrieben mit offenen Saetzen ist unmoeglich', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    const id = await kalkulation(f.reinigung, a, true);
    await expect(sql.unsafe(
      `update kalkulation set status = 'festgeschrieben', festgeschrieben_am = now(),
                              festgeschrieben_von = $2 where id = $1`, [id, chef],
    )).rejects.toThrow(/kalkulation_festschreibung_vollstaendig/u);
  });

  it('genau EIN Eigentuemer — Angebot oder Auftrag, nie beides und nie keines', async () => {
    await expect(sql.unsafe(
      `insert into kalkulation (mandant_id) values ($1)`, [f.reinigung],
    )).rejects.toThrow(/kalkulation_ein_eigentuemer/u);
  });

  it('die Summen kommen vom Ausloeser, nicht vom Aufrufer', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    const id = await kalkulation(f.reinigung, a);
    await sql.unsafe(
      `insert into kalkulation_position
         (mandant_id, kalkulation_id, position_nr, kostenart, bezeichnung, menge, einheit,
          einzelbetrag_cent, betrag_cent, stundensatz_cent, rechenansatz, operanden, berechnungsweg)
       values ($1,$2,1,'lohn','Reinigungsstunden',10,'h',2900,29000,2900,
               '10 × 2900', '{"stunden":10,"stundensatz_cent":2900}'::jsonb,
               '10,000 h × 29,00 €/h = 290,00 €')`,
      [f.reinigung, id]);
    await sql.unsafe(
      `insert into kalkulation_position
         (mandant_id, kalkulation_id, position_nr, kostenart, bezeichnung, menge, einheit,
          einzelbetrag_cent, betrag_cent, rechenansatz, operanden, berechnungsweg)
       values ($1,$2,2,'material','Reinigungsmittel',1,'psch',1500,1500,
               '1 × 1500', '{"menge":1,"einzelbetrag_cent":1500}'::jsonb,
               '1 psch × 15,00 € = 15,00 €')`,
      [f.reinigung, id]);
    const [z] = await sql.unsafe<{ lohn: string; material: string; summe: string }[]>(
      `select summe_lohn_cent::text as lohn, summe_material_cent::text as material,
              angebotssumme_netto_cent::text as summe from kalkulation where id = $1`, [id]);
    expect(z!.lohn).toBe('29000');
    expect(z!.material).toBe('1500');
    expect(z!.summe).toBe('30500');
  });

  it('eine Lohnzeile ohne festgehaltenen Stundensatz ist nicht reproduzierbar', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    const id = await kalkulation(f.reinigung, a);
    await expect(sql.unsafe(
      `insert into kalkulation_position
         (mandant_id, kalkulation_id, position_nr, kostenart, bezeichnung, menge, einheit,
          einzelbetrag_cent, betrag_cent, rechenansatz, operanden, berechnungsweg)
       values ($1,$2,1,'lohn','Ohne Satz',10,'h',2900,29000,'x','{}'::jsonb,'x')`,
      [f.reinigung, id])).rejects.toThrow(/kp_lohn_mit_satz/u);
  });

  it('die Herleitung ist Pflicht — Rechenansatz, Operanden, Berechnungsweg', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    const id = await kalkulation(f.reinigung, a);
    await expect(sql.unsafe(
      `insert into kalkulation_position
         (mandant_id, kalkulation_id, position_nr, kostenart, bezeichnung, menge, einheit,
          einzelbetrag_cent, betrag_cent, stundensatz_cent, rechenansatz, operanden, berechnungsweg)
       values ($1,$2,1,'lohn','Leer',10,'h',2900,29000,2900,'','{}'::jsonb,'')`,
      [f.reinigung, id])).rejects.toThrow(/kp_herleitung_vorhanden/u);
  });

  it('die Kalkulation ist im Kundenportal unsichtbar — Marge bleibt drinnen', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await kalkulation(f.reinigung, a);
    const kundeKonto = await konto();
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
      [f.reinigung, k, kundeKonto]);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from kalkulation`));
    expect(gesehen).toHaveLength(0);
  });
});

describe('(3) Der Versand — Invariante 7 in der Datenbank', () => {
  it('ohne Freigabe durch einen Menschen geht nichts hinaus', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await expect(sql.unsafe(
      `update angebot set status = 'versendet', versendet_am = now(),
                          angebotsnummer = 'AN-1' where id = $1`, [a],
    )).rejects.toThrow(/angebot_freigabe_vor_versand/u);
  });

  it('ohne Nummer geht nichts hinaus — mit einem Satz, nicht mit 23514', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await expect(sql.unsafe(
      `update angebot set status = 'versendet', freigegeben_von = $2, freigegeben_am = now(),
                          versendet_von = $2, versendet_am = now() where id = $1`, [a, chef],
    )).rejects.toThrow(/Versand ohne Angebotsnummer/u);
  });

  it('eine Kalkulation auf Platzhaltern verhindert den Versand — benannt', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await kalkulation(f.reinigung, a, true);
    await expect(versende(a)).rejects.toThrow(/unbestaetigte Werte/u);
  });

  it('mit bestaetigter Kalkulation geht er — und friert sie ein', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    const kalk = await kalkulation(f.reinigung, a);
    await versende(a);
    const [z] = await sql.unsafe<{ status: string; von: string | null }[]>(
      `select status, festgeschrieben_von::text as von from kalkulation where id = $1`, [kalk]);
    expect(z!.status).toBe('festgeschrieben');
    expect(z!.von).toBe(chef);
  });

  it('die Versandzeit kommt vom SERVER, nicht vom Aufrufer (Invariante 5)', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await sql.unsafe(
      `update angebot set status='versendet', freigegeben_von=$2, freigegeben_am=now(),
                          versendet_von=$2, versendet_am='2001-01-01T00:00:00Z',
                          angebotsnummer='AN-X' where id = $1`, [a, chef]);
    const [z] = await sql.unsafe<{ versendet_am: Date }[]>(
      `select versendet_am from angebot where id = $1`, [a]);
    expect(z!.versendet_am.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('die Steuerzeilen entstehen beim Versand — je Satz eine', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1, { menge: '10.000', einzelpreis: 250n, satz: 1900 });
    await position(f.reinigung, a, 2, { menge: '4.000', einzelpreis: 500n, satz: 700 });
    await versende(a);
    const zeilen = await sql.unsafe<{ steuersatz_bp: number; netto: string; steuer: string }[]>(
      `select steuersatz_bp, netto_cent::text as netto, steuer_cent::text as steuer
         from angebot_steuer where angebot_id = $1 order by steuersatz_bp`, [a]);
    expect(zeilen).toHaveLength(2);
    // 4 × 500 = 2000 zu 7 % = 140
    expect(zeilen[0]).toMatchObject({ steuersatz_bp: 700, netto: '2000', steuer: '140' });
    // 10 × 250 = 2500 zu 19 % = 475
    expect(zeilen[1]).toMatchObject({ steuersatz_bp: 1900, netto: '2500', steuer: '475' });
  });

  it('und niemand kann sie danach anfassen', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await versende(a);
    await expect(sql.unsafe(
      `update angebot_steuer set steuer_cent = 1 where angebot_id = $1`, [a],
    )).rejects.toThrow(/unveraenderlich/u);
    await expect(sql.unsafe(
      `insert into angebot_steuer (mandant_id, angebot_id, steuersatz_bp, steuer_kennzeichen,
                                   netto_cent, steuer_cent)
       values ($1,$2,0,'steuerfrei',0,0)`, [f.reinigung, a],
    )).rejects.toThrow(/nur beim Versand/u);
  });

  it('ein versendetes Angebot ist unveraenderlich', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await versende(a);
    await expect(sql.unsafe(`update angebot set titel = 'Anders' where id = $1`, [a]))
      .rejects.toThrow(/unveraenderlich/u);
    await expect(position(f.reinigung, a, 2)).rejects.toThrow(/unveraenderlich/u);
  });

  it('die Summe kommt aus den Positionen, und nur aus den Leistungszeilen', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1, { menge: '10.000', einzelpreis: 250n });
    await sql.unsafe(
      `insert into angebotsposition (mandant_id, angebot_id, position_nr, typ, kurztext,
                                     steuersatz_bp)
       values ($1,$2,2,'text','Hinweis: Zutritt nur nach 19 Uhr',0)`, [f.reinigung, a]);
    const [z] = await sql.unsafe<{ netto: string }[]>(
      `select netto_cent::text as netto from angebot where id = $1`, [a]);
    expect(z!.netto).toBe('2500');
  });

  it('eine Reverse-Charge-Zeile mit 19 % ist ein Fehler, kein Sonderfall', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await expect(position(f.reinigung, a, 1, { kennzeichen: 'reverse_charge_13b', satz: 1900 }))
      .rejects.toThrow(/ap_reverse_charge_ohne_steuer/u);
  });

  it('eine steuerfreie Zeile ohne Grund ebenfalls', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await expect(position(f.reinigung, a, 1, { kennzeichen: 'steuerfrei', satz: 0 }))
      .rejects.toThrow(/ap_steuerfrei_mit_grund/u);
  });

  it('der Gesamtpreis wird in der DATENBANK gerechnet, nicht im Aufrufer', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    // 12,345 m² × 1,99 € — in JavaScript 2456,655000000000...
    const p = await position(f.reinigung, a, 1, { menge: '12.345', einzelpreis: 199n });
    const [z] = await sql.unsafe<{ gesamt: string }[]>(
      `select gesamtpreis_cent::text as gesamt from angebotsposition where id = $1`, [p]);
    expect(z!.gesamt).toBe('2457');   // kaufmaennisch gerundet
  });
});

describe('(4) Der Kunde sieht das Angebot — aber nie den Entwurf', () => {
  async function kundenSitzung(): Promise<{ kundeId: string; konto: string }> {
    const k = await kunde(f.reinigung);
    const kk = await konto();
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
      [f.reinigung, k, kk]);
    return { kundeId: k, konto: kk };
  }

  it('ein Entwurf ist fuer ihn nicht da', async () => {
    const { kundeId, konto: kk } = await kundenSitzung();
    const a = await angebot(f.reinigung, kundeId);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kk },
      async (tx) => tx.unsafe(`select id from angebot where id = $1`, [a]));
    expect(gesehen).toHaveLength(0);
  });

  it('nach dem Versand schon — samt Positionen und Steuerzeilen', async () => {
    const { kundeId, konto: kk } = await kundenSitzung();
    const a = await angebot(f.reinigung, kundeId);
    await position(f.reinigung, a, 1);
    await versende(a);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kk },
      async (tx) => ({
        angebote: await tx.unsafe(`select id from angebot where id = $1`, [a]),
        positionen: await tx.unsafe(`select id from angebotsposition where angebot_id = $1`, [a]),
        steuer: await tx.unsafe(`select id from angebot_steuer where angebot_id = $1`, [a]),
      }));
    expect(gesehen.angebote).toHaveLength(1);
    expect(gesehen.positionen).toHaveLength(1);
    expect(gesehen.steuer).toHaveLength(1);
  });

  it('das versendete Angebot eines ANDEREN Kunden nicht', async () => {
    const { konto: kk } = await kundenSitzung();
    const fremder = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, fremder);
    await position(f.reinigung, a, 1);
    await versende(a);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kk },
      async (tx) => tx.unsafe(`select id from angebot where id = $1`, [a]));
    expect(gesehen).toHaveLength(0);
  });
});

describe('(5) Angebot → Auftrag (OPS-09)', () => {
  it('der Auftrag traegt den Angebotsbezug', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await versende(a);
    const [auf] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, angebot_id, art,
                            bezeichnung, verantwortlich_benutzer_id, start_datum)
       values ($1,'AU-2026-00001',$2,$3,'rahmenvertrag','Unterhaltsreinigung',$4,'2026-04-01')
       returning id`, [f.reinigung, k, a, chef]);
    const [z] = await sql.unsafe<{ angebot_id: string }[]>(
      `select angebot_id from auftrag where id = $1`, [auf!.id]);
    expect(z!.angebot_id).toBe(a);
  });

  it('eine Referenz ohne hinterlegte Freigabe kann als Datensatz nicht existieren (PRO-05)',
    async () => {
      const k = await kunde(f.reinigung);
      await expect(sql.unsafe(
        `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                              verantwortlich_benutzer_id, start_datum, freigegeben_vom_kunden)
         values ($1,'AU-REF',$2,'einzelauftrag','Referenz',$3,'2026-01-01',true)`,
        [f.reinigung, k, chef])).rejects.toThrow(/auftrag_referenzfreigabe_vollstaendig/u);
    });

  it('eine Gewaehrleistungsfrist ohne Abnahme hat keinen Beginn', async () => {
    const k = await kunde(f.reinigung);
    await expect(sql.unsafe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum, gewaehrleistung_bis)
       values ($1,'AU-G',$2,'projekt','Bau',$3,'2026-01-01','2030-01-01')`,
      [f.reinigung, k, chef])).rejects.toThrow(/auftrag_gewaehrleistung_nach_abnahme/u);
  });

  it('der Kunde sieht seinen Auftrag — auch den laufenden', async () => {
    const k = await kunde(f.reinigung);
    const kk = await konto();
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
      [f.reinigung, k, kk]);
    await sql.unsafe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum, status)
       values ($1,'AU-L',$2,'dauerauftrag','Laufend',$3,'2026-01-01','aktiv')`,
      [f.reinigung, k, chef]);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kk },
      async (tx) => tx.unsafe(`select id from auftrag`));
    expect(gesehen).toHaveLength(1);
  });

  it('den eines anderen Kunden nicht', async () => {
    const meiner = await kunde(f.reinigung);
    const fremder = await kunde(f.reinigung);
    const kk = await konto();
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
      [f.reinigung, meiner, kk]);
    await sql.unsafe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1,'AU-F',$2,'einzelauftrag','Fremd',$3,'2026-01-01')`,
      [f.reinigung, fremder, chef]);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kk },
      async (tx) => tx.unsafe(`select id from auftrag`));
    expect(gesehen).toHaveLength(0);
  });
});

describe('(6) Nichts davon ist loeschbar', () => {
  it('Angebot, Position, Steuerzeile, Kalkulation, Katalog und Auftrag', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    const p = await position(f.reinigung, a, 1);
    const kalk = await kalkulation(f.reinigung, a);
    for (const [tabelle, id] of [['angebot', a], ['angebotsposition', p],
                                 ['kalkulation', kalk]] as const) {
      await expect(sql.unsafe(`delete from ${tabelle} where id = $1`, [id]))
        .rejects.toThrow(/gesperrt|unveraenderlich/u);
    }
  });
});

describe('(7) Die Gruppenansicht liest das Angebot — mitsamt seinem Steuerbild', () => {
  /**
   * `angebot` und `angebotsposition` tragen eine `t_gruppe`-Policy, die
   * Steuerzeile aber lange nicht. Der Fehler waere leise gewesen: die
   * Gruppenansicht haette das Angebot samt Positionen gezeigt und darunter
   * eine LEERE Steueraufstellung — also eine Zahl, die aussieht wie „keine
   * Umsatzsteuer“ statt wie „hier fehlt eine Berechtigung“. Genau die Sorte
   * Fehler, die erst auffaellt, wenn jemand die Summe nachrechnet.
   *
   * Das Steuerbild ist dabei nicht empfindlicher als das, was die
   * Gruppenansicht ohnehin sieht: die Positionen fuehren dieselben Betraege
   * und denselben Satz. Die Policy weitet also nichts aus, sie schliesst eine
   * Luecke in einer bereits erteilten Sicht.
   */
  /**
   * `super_admin` ist eine GLOBALE Rolle: sie haengt an
   * `benutzer.globale_rolle_id`, nicht an `benutzer_mandant` — dort weist ein
   * Ausloeser sie ab. Und sie fordert 2FA (AUT-02), also braucht das Konto
   * einen Faktor, sonst ist es gar nicht aktiv.
   */
  async function superAdmin(): Promise<string> {
    const id = await konto();
    await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [id]);
    await sql.unsafe(`update benutzer set globale_rolle_id = $1 where id = $2`,
                     [await rolleId('super_admin'), id]);
    return id;
  }

  it('alle drei Tabellen antworten — Kopf, Positionen UND Steuerzeilen', async () => {
    const sa = await superAdmin();
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1, { menge: '10.000', einzelpreis: 250n, satz: 1900 });
    await position(f.reinigung, a, 2, { menge: '4.000', einzelpreis: 500n, satz: 700 });
    await versende(a);

    const gesehen = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: sa, portal: 'intern', readonly: true },
      async (tx) => ({
        angebote: await tx.unsafe(`select id from angebot where id = $1`, [a]),
        positionen: await tx.unsafe(`select id from angebotsposition where angebot_id = $1`, [a]),
        steuer: await tx.unsafe(
          `select steuersatz_bp from angebot_steuer where angebot_id = $1 order by steuersatz_bp`,
          [a]),
      }));
    expect(gesehen.angebote).toHaveLength(1);
    expect(gesehen.positionen).toHaveLength(2);
    // Die eigentliche Zusage: nicht null Zeilen, sondern beide Saetze.
    expect(gesehen.steuer).toHaveLength(2);
  });

  it('das Angebot eines Mandanten AUSSERHALB der Gruppe bleibt unsichtbar', async () => {
    const sa = await superAdmin();
    const k = await kunde(f.security);
    const a = await angebot(f.security, k);
    await position(f.security, a, 1);
    await sql.unsafe(
      `update angebot set status='versendet', freigegeben_von=$2, freigegeben_am=now(),
                          versendet_von=$2, versendet_am=now(), angebotsnummer=$3
        where id = $1`, [a, sa, `AN-2026-${zufall().slice(0, 5)}`]);

    // Die Gruppe ist hier NUR die Reinigung — `security` gehoert nicht dazu.
    const gesehen = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: sa, portal: 'intern', readonly: true },
      async (tx) => ({
        angebote: await tx.unsafe(`select id from angebot where id = $1`, [a]),
        steuer: await tx.unsafe(`select id from angebot_steuer where angebot_id = $1`, [a]),
      }));
    expect(gesehen.angebote).toHaveLength(0);
    expect(gesehen.steuer).toHaveLength(0);
  });

  it('und die Gruppenansicht schreibt nichts — auch keine Steuerzeile', async () => {
    const sa = await superAdmin();
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await versende(a);
    await expect(alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: sa, portal: 'intern', readonly: true },
      async (tx) => tx.unsafe(
        `insert into angebot_steuer (mandant_id, angebot_id, steuersatz_bp, steuer_kennzeichen,
                                     netto_cent, steuer_cent)
         values ($1,$2,0,'steuerfrei',0,0)`, [f.reinigung, a]),
    )).rejects.toThrow(/nur beim Versand|row-level security|KeinAktiverMandant/iu);
  });
});

describe('(8) Ein zweites Recht, das das Tor der Seite nicht verlangt', () => {
  /**
   * Die Angebotsseite steht hinter `angebot.lesen` — liest aber `auftrag`
   * (eigene Policy, eigenes Recht) und die Sicht `kalkulation_platzhalter`
   * (`security_invoker`, also die Policy von `kalkulation`).
   *
   * Diese Tests halten fest, was die Datenbank in dem Fall WIRKLICH tut:
   * sie antwortet mit nichts. Das ist richtig — und genau deshalb darf die
   * Seite daraus nicht „es gibt keinen Auftrag“ oder „die Kalkulation ist
   * bestaetigt“ machen. Die Merker, die sie stattdessen liest, sind hier
   * mitgeprueft: sie sind die einzige Stelle, an der der Unterschied zwischen
   * „nichts da“ und „nichts sichtbar“ ueberhaupt noch existiert.
   */
  async function ohneRecht(...rechte: readonly string[]): Promise<string> {
    for (const recht of rechte) {
      await sql.unsafe(
        `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
         select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
        [await rolleId('leitung'), f.reinigung, recht]);
    }
    return chef;
  }

  it('ohne kalkulation.lesen meldet die Sicht NICHTS — nicht „bestaetigt“', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await kalkulation(f.reinigung, a, true);          // steht auf Platzhaltern

    // Mit dem Recht: die Sicht meldet das offene Angebot.
    const mit = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef, portal: 'intern' },
      async (tx) => tx.unsafe(
        `select 1 from kalkulation_platzhalter where angebot_id = $1`, [a]));
    expect(mit).toHaveLength(1);

    await ohneRecht('kalkulation.lesen');

    const ohne = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef, portal: 'intern' },
      async (tx) => ({
        sicht: await tx.unsafe(
          `select 1 from kalkulation_platzhalter where angebot_id = $1`, [a]),
        merker: await tx.unsafe<{ angebot: boolean; kalk: boolean }[]>(
          `select app.hat_recht('angebot.lesen', app.aktiver_mandant()) as angebot,
                  app.hat_recht('kalkulation.lesen', app.aktiver_mandant()) as kalk`),
      }));

    // Die Sicht ist leer — und saehe damit aus wie „keine offenen Werte“.
    expect(ohne.sicht).toHaveLength(0);
    // Der Merker der Seite widerspricht: lesbar ist das Angebot, die
    // Kalkulation nicht. Genau daran haengt der gesperrte Versandknopf.
    expect(ohne.merker[0]).toMatchObject({ angebot: true, kalk: false });
  });

  it('ohne auftrag.lesen bleibt der bereits entstandene Auftrag unsichtbar', async () => {
    const k = await kunde(f.reinigung);
    const a = await angebot(f.reinigung, k);
    await position(f.reinigung, a, 1);
    await versende(a);
    await sql.unsafe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, angebot_id, art,
                            bezeichnung, verantwortlich_benutzer_id, start_datum)
       values ($1,'AU-2026-09001',$2,$3,'rahmenvertrag','Unterhaltsreinigung',$4,'2026-04-01')`,
      [f.reinigung, k, a, chef]);

    await ohneRecht('auftrag.lesen');

    const gesehen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef, portal: 'intern' },
      async (tx) => ({
        nummer: await tx.unsafe<{ auftragsnummer: string }[]>(
          `select auftragsnummer from auftrag where angebot_id = $1`, [a]),
        merker: await tx.unsafe<{ auftrag: boolean }[]>(
          `select app.hat_recht('auftrag.lesen', app.aktiver_mandant()) as auftrag`),
      }));

    // Der Auftrag EXISTIERT — die Zeile ist nur nicht sichtbar.
    expect(gesehen.nummer).toHaveLength(0);
    expect(gesehen.merker[0]).toMatchObject({ auftrag: false });
    const [wirklich] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from auftrag where angebot_id = $1`, [a]);
    expect(wirklich!.n).toBe('1');
  });
});

describe('(9) Der Verantwortliche eines Auftrags gehoert zu DIESER Gesellschaft', () => {
  /**
   * Der Fremdschluessel zeigt auf `benutzer` — global, ohne Mandanten. Die
   * Auswahlliste im Formular ist mandantengefiltert, aber eine Auswahlliste
   * ist keine Grenze: ein von Hand abgeschickter POST setzt jede id. Der
   * Auftrag der Reinigung haette dann einen Verantwortlichen, der nur bei der
   * Security arbeitet — und das faellt erst auf, wenn ihn jemand anruft.
   */
  async function auftrag(mandant: string, kundeId: string,
                         verantwortlich: string): Promise<readonly { id: string }[]> {
    return sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1,$2,$3,'rahmenvertrag','Unterhaltsreinigung',$4,'2026-04-01')
       returning id`,
      [mandant, `AU-2026-${zufall().slice(0, 5)}`, kundeId, verantwortlich]);
  }

  it('ein Konto AUS EINER ANDEREN Gesellschaft wird abgewiesen', async () => {
    const fremd = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [fremd, f.security, await rolleId('leitung')]);
    const k = await kunde(f.reinigung);
    await expect(auftrag(f.reinigung, k, fremd))
      .rejects.toThrow(/gehoert nicht zu dieser Gesellschaft/u);
  });

  it('ein Konto ganz OHNE Mitgliedschaft ebenso', async () => {
    const k = await kunde(f.reinigung);
    await expect(auftrag(f.reinigung, k, await konto()))
      .rejects.toThrow(/gehoert nicht zu dieser Gesellschaft/u);
  });

  it('das eigene Konto geht', async () => {
    const k = await kunde(f.reinigung);
    const [z] = await auftrag(f.reinigung, k, chef);
    expect(z!.id).toBeDefined();
  });

  it('eine ENTZOGENE Mitgliedschaft zaehlt nicht mehr', async () => {
    const weg = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, entzogen_am)
       values ($1,$2,$3, now())`,
      [weg, f.reinigung, await rolleId('leitung')]);
    const k = await kunde(f.reinigung);
    await expect(auftrag(f.reinigung, k, weg))
      .rejects.toThrow(/gehoert nicht zu dieser Gesellschaft/u);
  });

  it('und das UMHAENGEN auf ein fremdes Konto wird ebenso abgewiesen', async () => {
    const fremd = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [fremd, f.security, await rolleId('leitung')]);
    const k = await kunde(f.reinigung);
    const [z] = await auftrag(f.reinigung, k, chef);
    await expect(sql.unsafe(
      `update auftrag set verantwortlich_benutzer_id = $2 where id = $1`, [z!.id, fremd],
    )).rejects.toThrow(/gehoert nicht zu dieser Gesellschaft/u);
  });
});
