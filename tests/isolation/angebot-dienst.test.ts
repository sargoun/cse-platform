/**
 * Der Angebotsdienst von Ende zu Ende: Raumbuch → Kalkulation → Angebot →
 * Versand → Auftrag, gegen eine echte Datenbank.
 *
 * Der interessante Teil ist nicht, dass es funktioniert, sondern was
 * passiert, wenn es NICHT funktioniert: eine gezogene Nummer, deren Versand
 * scheitert, darf keine Luecke hinterlassen, und ein zweiter Versuch, aus
 * demselben Angebot einen zweiten Auftrag zu machen, darf nicht gelingen.
 *
 * **Seit der Auftrennung sind Freigabe und Versand ZWEI Schritte.**
 * `versendeAngebot` setzte beides in einem UPDATE; der Rechtekatalog fuehrt
 * aber `angebot.preis_freigeben` (super_admin, leitung) und
 * `angebot.versenden` (zusaetzlich admin) getrennt. Wo dieser Test den Weg
 * eines Menschen geht, geht er ihn jetzt zweifach — `freigebenUndVersenden`
 * unten. Wo er eine SPERRE prueft, ruft er den einzelnen Schritt, den die
 * Sperre betrifft: sonst prueft die Zusicherung den falschen Riegel.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { ladeKalkulationsgrundlage } from '../../src/server/services/kalkulation/raumbuch.js';
import { kalkuliere } from '../../src/server/services/kalkulation/index.js';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF }
  from '../../src/server/services/kalkulation/tarif.js';
import {
  AngebotFehler, gibPreisFrei, legeAngebotAn, uebernimmKalkulation, versendeAngebot,
  wandleInAuftrag,
} from '../../src/server/services/angebot/index.js';
import { bestaetigeKalkulation }
  from '../../src/server/services/kalkulation/bestaetigung.js';

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

/**
 * Die Kalkulation bestaetigen — ueber den ECHTEN Dienst, nicht ueber ein
 * UPDATE im Test.
 *
 * Ein Testhelfer, der die Spalten direkt setzt, prueft die Sperre gegen sich
 * selbst: er umgeht genau den Weg, den ein Mensch nimmt. Was hier laeuft, ist
 * derselbe Code wie hinter `/api/kalkulation`.
 */
async function bestaetige(angebotId: string): Promise<void> {
  await alsChef((db) => bestaetigeKalkulation(db, angebotId, {
    stundensatzEuro: '29,00',
    gemeinkostenBasis: 'lohn',
    gemeinkostenProzent: '15',
    wagnisGewinnProzent: '8',
    frequenzFaktor: '1', leistungswerteBestaetigen: true,
    benutzerId: chef,
  }));
}

/**
 * Der Weg eines Menschen im Portal: erst `/freigabe`, dann `/versand`.
 *
 * Beides mit `chef` — der traegt die Rolle `leitung` und haelt damit BEIDE
 * Rechte. Im Betrieb sind es zwei Menschen, und genau dafuer gibt es die
 * beiden Rechte; fuer die Kette hier genuegt einer, der sie beide gehen darf.
 */
async function freigebenUndVersenden(
  db: ReturnType<typeof kontextAus>, angebotId: string,
): Promise<{ readonly angebotsnummer: string; readonly versendetAm: Date }> {
  await gibPreisFrei(db, angebotId, chef);
  return versendeAngebot(db, angebotId, chef);
}

describe('(1) Vom Raumbuch zum versendeten Angebot', () => {
  /**
   * DAS Abnahmekriterium dieser Phase, und der Grund, aus dem es hier zwei
   * Tests sind statt einem: ein Angebot, dessen Preis auf unbeantworteten
   * Fragen ruht, geht NICHT hinaus.
   *
   * Vorher fehlte die Kalkulationszeile ganz — und ohne sie fragte
   * `kern.angebot_versand_pruefen` eine leere Sicht und liess den Versand
   * durch. Die Sperre war da, es gab nur nichts zu pruefen.
   */
  it('ein Angebot auf Platzhalterwerten geht NICHT hinaus', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);
    await expect(alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
      const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
      const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
      const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
      expect(kalk.istPlatzhalter).toBe(true);
      const angebotId = await legeAngebotAn(db, { kundeId: k, titel: 'Platzhalter', objektId: o });
      await uebernimmKalkulation(db, angebotId, kalk,
        { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
      return freigebenUndVersenden(db, angebotId);
    })).rejects.toThrow(/unbestaetigte Werte/u);
  });

  it('ein bestaetigter Tarif auf einem Platzhalter-Leistungswert reicht NICHT (O-17)',
    async () => {
      const k = await kunde(f.reinigung);
      const o = await objektMitRaumbuch(f.reinigung, k);
      const angebotId = await alsChef(async (db) => {
        const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
        const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
        const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
        const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
        const id = await legeAngebotAn(db, { kundeId: k, titel: 'Nur Tarif', objektId: o });
        await uebernimmKalkulation(db, id, kalk,
          { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
        return id;
      });
      // NUR der Kopf wird bestaetigt — die Belagsart bleibt Platzhalter.
      await sql.unsafe(
        `update kalkulation set ist_platzhalter = false,
                                stundenverrechnungssatz_cent = 2900,
                                gemeinkosten_basis = 'lohn',
                                gemeinkosten_bp = 1500, wagnis_gewinn_bp = 800
          where angebot_id = $1`, [angebotId]);
      await expect(alsChef((db) => freigebenUndVersenden(db, angebotId)))
        .rejects.toThrow(/unbestaetigte Werte/u);
    });

  it('die ganze Kette, in einer Sitzung', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);

    const angelegt = await alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
      const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
      const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
      const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
      const angebotId = await legeAngebotAn(db, {
        kundeId: k, titel: 'Unterhaltsreinigung 2026', objektId: o,
      });
      const positionen = await uebernimmKalkulation(db, angebotId, kalk,
        { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
      return { angebotId, positionen, netto: kalk.netto };
    });
    await bestaetige(angelegt.angebotId);
    const versand = await alsChef((db) => freigebenUndVersenden(db, angelegt.angebotId));
    const ergebnis = { ...angelegt, versand };

    expect(ergebnis.positionen).toBe(1);          // eine Belagsart, eine Zeile
    expect(ergebnis.versand.angebotsnummer).toMatch(/^AN-2026-00001$/u);

    /**
     * 500 m² ÷ 250 m²/h = 2 h × 29,00 € = 58,00 € LOHN — und darauf die
     * Zuschlaege: 15 % Gemeinkosten (8,70 €) und 8 % Wagnis und Gewinn auf
     * die Zwischensumme (5,34 €). Netto 72,04 €.
     *
     * Diese Zusage ist der Kern: der Summentrigger rechnet aus den
     * POSITIONEN, und die Positionen tragen den Nettoanteil. Stuende hier
     * wieder 5800, hiesse das: das Angebot geht zum Selbstkostenpreis hinaus
     * — die Zeilen stimmten, die Summe stimmte zu den Zeilen, und niemand
     * saehe es dem Dokument an.
     *
     * Und warum 7204 und nicht die 7214 der ersten Rechnung: der PLATZHALTER
     * traegt Wagnis (3 %) und Gewinn (5 %) als ZWEI Saetze, die aufeinander
     * rechnen — 1,03 × 1,05 = 1,0815. Bestaetigt wird EIN Satz von 8 %. Die
     * zehn Cent Unterschied sind genau der Punkt der Bestaetigung: seit sie
     * nachrechnet, steht im Angebot der Preis aus den BESTAETIGTEN Zahlen.
     * Vorher blieben die Cent des Platzhalters stehen, waehrend der Kopf die
     * bestaetigten Saetze meldete — ein Preis, der geprueft aussah und es
     * nicht war.
     */
    const [z] = await sql.unsafe<{ netto: string; status: string; nummer: string }[]>(
      `select netto_cent::text as netto, status, angebotsnummer as nummer
         from angebot where id = $1`, [ergebnis.angebotId]);
    expect(z!.netto).toBe('7204');
    // Und die Kalkulationssumme traegt DENSELBEN Betrag — Lohnzeilen plus
    // Zuschlagszeilen. Frueher stand dort der reine Lohn (5800), waehrend das
    // Angebot 7214 nannte: zwei Summen, beide plausibel, in einem Datensatz.
    const [ks] = await sql.unsafe<{ summe: string }[]>(
      `select angebotssumme_netto_cent::text as summe
         from kalkulation where angebot_id = $1`, [ergebnis.angebotId]);
    expect(ks!.summe).toBe(z!.netto);
    expect(z!.status).toBe('versendet');
  });

  /**
   * D-97: Was nicht bepreisbar ist, wird nicht bepreist — und auch nicht
   * weggelassen. Der Fehler waere sonst genau der teure: das Raumbuch ist
   * vollstaendig, die Zeilen stimmen, die Summe stimmt zu den Zeilen, und der
   * Preis gilt fuer weniger Flaeche als der Auftrag umfasst.
   */
  it('ein Raum OHNE Belagsart laesst kein Angebot entstehen', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);
    await sql.unsafe(
      `insert into raum (mandant_id, objekt_id, raumnummer, etage, flaeche_qm)
       values ($1,$2,'103','EG','80.000')`, [f.reinigung, o]);

    await expect(alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
      const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
      const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
      const kalk = kalkuliere({
        posten: grundlage.posten, frequenz, tarif,
        flaecheOhneBelagsart: grundlage.flaecheOhneBelagsart,
        ohneGueltigenLeistungswert: grundlage.ohneGueltigenLeistungswert,
      });
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Luecke', objektId: o });
      return uebernimmKalkulation(db, id, kalk,
        { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
    })).rejects.toThrow(/Nicht bepreisbare Flaeche.*80,00 m² ohne Belagsart/su);
  });

  it('eine Belagsart ohne am Stichtag gueltigen Leistungswert ebenso', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);
    // Die Belagsart gilt erst ab 2026 — zum Stichtag Mitte 2025 also nicht.
    await expect(alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o, new Date('2025-06-01T12:00:00Z'));
      expect(grundlage.posten).toHaveLength(0);
      expect(grundlage.ohneGueltigenLeistungswert).toHaveLength(1);
      const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
      const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
      const kalk = kalkuliere({
        posten: grundlage.posten, frequenz, tarif,
        flaecheOhneBelagsart: grundlage.flaecheOhneBelagsart,
        ohneGueltigenLeistungswert: grundlage.ohneGueltigenLeistungswert,
      });
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Abgelaufen', objektId: o });
      return uebernimmKalkulation(db, id, kalk,
        { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
    })).rejects.toThrow(/ohne gueltigen Leistungswert/u);
  });

  it('die Kalkulation wird MITgespeichert — Kopf, Positionen und Schnappschuss',
    async () => {
      const k = await kunde(f.reinigung);
      const o = await objektMitRaumbuch(f.reinigung, k);
      const angebotId = await alsChef(async (db) => {
        const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
        const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
        const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
        const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
        const id = await legeAngebotAn(db, { kundeId: k, titel: 'Mit Kalk', objektId: o });
        await uebernimmKalkulation(db, id, kalk,
          { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
        return id;
      });

      const [kopf] = await sql.unsafe<{
        id: string; platzhalter: boolean; satz: string | null; basis: string | null;
      }[]>(
        `select id, ist_platzhalter as platzhalter,
                stundenverrechnungssatz_cent::text as satz, basis_objekt_id::text as basis
           from kalkulation where angebot_id = $1`, [angebotId]);
      expect(kopf).toBeDefined();
      expect(kopf!.platzhalter).toBe(true);
      expect(kopf!.satz).toBe('2900');
      expect(kopf!.basis).toBe(o);

      const zeilen = await sql.unsafe<{
        menge: string; einheit: string; einzel: string; betrag: string;
        leistungswert: string; stundensatz: string; operanden: Record<string, string>;
      }[]>(
        `select menge::text, einheit, einzelbetrag_cent::text as einzel,
                betrag_cent::text as betrag,
                leistungswert_qm_pro_stunde::text as leistungswert,
                stundensatz_cent::text as stundensatz, operanden
           from kalkulation_position where kalkulation_id = $1 order by position_nr`,
        [kopf!.id]);
      expect(zeilen).toHaveLength(1);
      // 2 Stunden zu 29,00 € = 58,00 € Lohn — nachrechenbar aus der Zeile.
      expect(zeilen[0]!.menge).toBe('2.000');
      expect(zeilen[0]!.einheit).toBe('std');
      expect(zeilen[0]!.einzel).toBe('2900');
      expect(zeilen[0]!.betrag).toBe('5800');
      expect(zeilen[0]!.leistungswert).toBe('250.000');
      // Der Schnappschuss steht als OBJEKT in jsonb, nicht als Zeichenkette.
      expect(zeilen[0]!.operanden['sekunden_je_periode']).toBe('7200');
      expect(zeilen[0]!.operanden['nettoanteil_cent']).toBe('7214');
    });

  it('der Langtext erklaert den Preis — Flaeche, Leistungswert, Stunden', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);
    const angebotId = await alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
      const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
      const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
      const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Test' });
      await uebernimmKalkulation(db, id, kalk, { turnusLabel: 'monatlich', tarif, frequenz });
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
        gezogen.push((await freigebenUndVersenden(db, id)).angebotsnummer);
      }
      return gezogen;
    });
    expect(nummern).toEqual(['AN-2026-00001', 'AN-2026-00002']);
  });
});

describe('(1b) Preisfreigabe und Versand sind ZWEI Vorgaenge', () => {
  /** Ein Angebot mit einer Position und ohne Kalkulation — freigabefaehig. */
  async function freigabefaehig(): Promise<string> {
    const k = await kunde(f.reinigung);
    return alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Zur Freigabe' });
      await db.abfrage(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp)
         values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 1000, 1900)`, [id]);
      return id;
    });
  }

  /**
   * DER Befund, der die Auftrennung gebracht hat: ein Klick, zwei
   * Entscheidungen. Ohne Freigabe geht nichts hinaus — und zwar mit einem
   * Satz, der den fehlenden Arbeitsschritt nennt, nicht mit einem
   * Bedingungsverstoss.
   */
  it('ohne Preisfreigabe geht kein Angebot hinaus', async () => {
    const id = await freigabefaehig();
    await expect(alsChef((db) => versendeAngebot(db, id, chef)))
      .rejects.toThrow(/Ohne Preisfreigabe/u);
  });

  it('und der Grund heisst `ohne_freigabe`, nicht `kein_entwurf`', async () => {
    const id = await freigabefaehig();
    const fehler = await alsChef((db) => versendeAngebot(db, id, chef))
      .then(() => null, (e: unknown) => e);
    expect(fehler).toBeInstanceOf(AngebotFehler);
    expect((fehler as AngebotFehler).grund).toBe('ohne_freigabe');
  });

  /**
   * **Die Serveruhr, nicht das Formular** (Invariante 5). Der Ausloeser
   * `kern.angebot_preisfreigabe_pruefen` stempelt `freigegeben_am`; ein Wert,
   * den der Dienst mitgeschickt haette, wird ueberschrieben.
   */
  it('die Freigabe stempelt die SERVERZEIT und laesst versendet_* leer', async () => {
    const id = await freigabefaehig();
    const vorher = new Date();
    await alsChef((db) => gibPreisFrei(db, id, chef));
    const [z] = await sql.unsafe<{
      freigegeben_am: Date; freigegeben_von: string; versendet_am: Date | null;
      nummer: string | null; status: string;
    }[]>(
      `select freigegeben_am, freigegeben_von, versendet_am,
              angebotsnummer as nummer, status::text as status
         from angebot where id = $1`, [id]);
    expect(z!.freigegeben_von).toBe(chef);
    expect(z!.freigegeben_am.getTime()).toBeGreaterThanOrEqual(vorher.getTime() - 2000);
    // Der Versand bleibt UNBERUEHRT — das ist der ganze Punkt.
    expect(z!.versendet_am).toBeNull();
    expect(z!.nummer).toBeNull();
    expect(z!.status).toBe('entwurf');
  });

  /** Kein Entwurf mit Nummer (FIN-03) — auch nicht nach der Freigabe. */
  it('ein freigegebener Entwurf traegt weiterhin KEINE Nummer', async () => {
    const id = await freigabefaehig();
    await alsChef((db) => gibPreisFrei(db, id, chef));
    const [z] = await sql.unsafe<{ nummer: string | null }[]>(
      `select angebotsnummer as nummer from angebot where id = $1`, [id]);
    expect(z!.nummer).toBeNull();
  });

  /** Eine erteilte Freigabe ist unveraenderlich — O-732. */
  it('eine zweite Freigabe wird abgewiesen', async () => {
    const id = await freigabefaehig();
    await alsChef((db) => gibPreisFrei(db, id, chef));
    await expect(alsChef((db) => gibPreisFrei(db, id, chef)))
      .rejects.toThrow(/bereits freigegeben/u);
  });

  it('und ein UPDATE an der Route vorbei ebenso — der Ausloeser haelt (O-732)', async () => {
    const id = await freigabefaehig();
    await alsChef((db) => gibPreisFrei(db, id, chef));
    await expect(alsChef((db) => db.abfrage(
      `update angebot set freigegeben_am = now() - interval '1 day' where id = $1`, [id])))
      .rejects.toThrow(/unveraenderlich/u);
  });

  /**
   * Die Freigabe ruht nicht auf Platzhaltern — EINEN Schritt frueher als der
   * Versand. Sonst haette die Leitung einen Preis verantwortet, den die
   * Datenbank nicht hinausliesse, und niemand saehe, warum.
   */
  it('keine Freigabe auf unbestaetigten Werten', async () => {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);
    await expect(alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Offen', objektId: o });
      await db.abfrage(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp)
         values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 1000, 1900)`, [id]);
      await db.abfrage(
        `insert into kalkulation (mandant_id, angebot_id, basis_objekt_id)
         values (app.aktiver_mandant(), $1, $2)`, [id, o]);
      return gibPreisFrei(db, id, chef);
    })).rejects.toThrow(/unbestaetigte Werte/u);
  });

  /**
   * **Die Rollenmengen fallen hier wirklich auseinander** — die einzige der
   * neun Routen dieser Runde, bei der das so ist. `t_mandant` prueft im WITH
   * CHECK `angebot.schreiben` (admin, leitung, super_admin), waehrend
   * `angebot.preis_freigeben` nur leitung und super_admin halten. Eine
   * Administration konnte `freigegeben_von` also an der Route vorbei setzen;
   * 0295 bindet den Uebergang im Ausloeser.
   */
  it('eine Administration darf den Preis NICHT freigeben — auch nicht per UPDATE', async () => {
    const id = await freigabefaehig();
    const verwaltung = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [verwaltung, f.reinigung, await rolleId('admin')]);

    const alsAdmin = <T>(fn: (db: ReturnType<typeof kontextAus>) => Promise<T>) =>
      alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: verwaltung,
               portal: 'intern', readonly: false }, async (tx) => fn(kontextAus(tx)));

    // Erst der Dienst — und dann der rohe Schreibweg daneben.
    await expect(alsAdmin((db) => gibPreisFrei(db, id, verwaltung)))
      .rejects.toThrow(/angebot.preis_freigeben/u);
    await expect(alsAdmin((db) => db.abfrage(
      `update angebot set freigegeben_von = $2, freigegeben_am = now() where id = $1`,
      [id, verwaltung]))).rejects.toThrow(/angebot.preis_freigeben/u);

    // Und die Zeile ist unberuehrt: kein halber Vorgang.
    const [z] = await sql.unsafe<{ freigegeben_von: string | null }[]>(
      `select freigegeben_von from angebot where id = $1`, [id]);
    expect(z!.freigegeben_von).toBeNull();
  });

  /** Dieselbe Administration DARF versenden — sobald die Leitung freigegeben hat. */
  it('dieselbe Administration darf versenden, sobald der Preis freigegeben ist', async () => {
    const id = await freigabefaehig();
    const verwaltung = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [verwaltung, f.reinigung, await rolleId('admin')]);

    await alsChef((db) => gibPreisFrei(db, id, chef));
    const versand = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: verwaltung,
        portal: 'intern', readonly: false },
      (tx) => versendeAngebot(kontextAus(tx), id, verwaltung));
    expect(versand.angebotsnummer).toMatch(/^AN-2026-/u);

    /**
     * Und die Zeile haelt BEIDE Menschen auseinander — das ist der Gewinn der
     * Auftrennung: im Streit steht da, wer den Preis verantwortet hat und wer
     * ihn hinausgeschickt hat.
     */
    const [z] = await sql.unsafe<{ freigeber: string; versender: string }[]>(
      `select freigegeben_von as freigeber, versendet_von as versender
         from angebot where id = $1`, [id]);
    expect(z!.freigeber).toBe(chef);
    expect(z!.versender).toBe(verwaltung);
    expect(z!.freigeber).not.toBe(z!.versender);
  });
});

describe('(2) Was der Dienst verweigert', () => {
  it('ein Angebot ohne Position wird nicht versendet', async () => {
    const k = await kunde(f.reinigung);
    await expect(alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Leer' });
      return freigebenUndVersenden(db, id);
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
      await freigebenUndVersenden(db, id);
      /**
       * Der ZWEITE Aufruf bleibt der rohe Versand. Mit dem Helfer schlug hier
       * `gibPreisFrei` mit „bereits freigegeben" zu — richtig, aber ein
       * anderer Riegel als der, den dieser Test benennt.
       */
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
      /**
       * **Erst freigeben, DANN die Kalkulation kaputt machen** — und in dieser
       * Reihenfolge, weil der Test sonst seine eigene Zusage verliert.
       *
       * Seit der Auftrennung weisen die Vorabpruefungen einen Versand ohne
       * Freigabe und auf Platzhaltern ab, BEVOR `vergebeNummer` die
       * Zaehlerzeile sperrt. Ein Versand, der dort scheitert, zieht keine
       * Nummer — und ein Test, der nur das prueft, prueft nicht mehr, was er
       * behauptet. Hier kommt der Versand deshalb bis zum UPDATE durch und
       * faellt erst am Ausloeser `kern.angebot_versand_pruefen`: genau dann
       * IST eine Nummer gezogen, und genau dann muss sie mit zurueckrollen.
       */
      await gibPreisFrei(db, id, chef);
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
      return (await freigebenUndVersenden(db, id)).angebotsnummer;
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
      await freigebenUndVersenden(db, id);
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
    })).rejects.toThrow(/Status entwurf wird nicht zum Auftrag/u);
  });
});

describe('(4) Zwei Klicks auf „Angenommen“ ergeben EINEN Auftrag', () => {
  /**
   * Der Dienst prueft erst und schreibt dann. Zwischen beidem liegt ein
   * Fenster, und ein Doppelklick auf einem langsamen Netz ist genau die
   * Bedingung, unter der es aufgeht. Zwei Auftraege aus einem Angebot heisst
   * spaeter: zwei Rechnungsstroeme fuer dieselbe Zusage.
   *
   * Dieser Test faehrt beide Transaktionen WIRKLICH parallel. Ein Test, der
   * sie nacheinander ausfuehrt, prueft die Vorabpruefung — nicht das Rennen.
   */
  async function versendetesAngebot(): Promise<string> {
    const k = await kunde(f.reinigung);
    const angebotId = await alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Rennen' });
      await db.abfrage(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp)
         values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 1000, 1900)`, [id]);
      await freigebenUndVersenden(db, id);
      return id;
    });
    return angebotId;
  }

  it('genau einer gewinnt, der andere sieht den benannten Fehler', async () => {
    const angebotId = await versendetesAngebot();
    const wandeln = () => alsChef((db) => wandleInAuftrag(db, angebotId, {
      art: 'rahmenvertrag', verantwortlichBenutzerId: chef, startDatum: '2026-04-01',
    }));

    const ergebnisse = await Promise.allSettled([wandeln(), wandeln()]);
    const erfuellt = ergebnisse.filter((e) => e.status === 'fulfilled');
    const abgelehnt = ergebnisse.filter((e) => e.status === 'rejected');
    expect(erfuellt).toHaveLength(1);
    expect(abgelehnt).toHaveLength(1);
    expect(String((abgelehnt[0] as PromiseRejectedResult).reason))
      .toMatch(/bereits ein Auftrag entstanden/u);

    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from auftrag where angebot_id = $1`, [angebotId]);
    expect(z!.n).toBe('1');
  });

  /**
   * Und dieselbe Zusage noch einmal OHNE den Dienst: der eindeutige Index ist
   * die Stelle, die auch dann haelt, wenn spaeter jemand an `wandleInAuftrag`
   * vorbeischreibt. Ohne diesen Fall waere nur die Vorabpruefung geprueft.
   */
  it('und die DATENBANK selbst laesst keinen zweiten Bezug zu', async () => {
    const angebotId = await versendetesAngebot();
    await alsChef((db) => wandleInAuftrag(db, angebotId, {
      art: 'rahmenvertrag', verantwortlichBenutzerId: chef, startDatum: '2026-04-01',
    }));
    const [a] = await sql.unsafe<{ kunde_id: string }[]>(
      `select kunde_id::text from angebot where id = $1`, [angebotId]);
    await expect(sql.unsafe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, angebot_id, art,
                            bezeichnung, verantwortlich_benutzer_id, start_datum)
       values ($1,'AU-2026-99999',$2,$3,'rahmenvertrag','Zweiter',$4,'2026-04-01')`,
      [f.reinigung, a!.kunde_id, angebotId, chef],
    )).rejects.toThrow(/auftrag_angebot_uk/u);
  });
});

describe('(5) Ein abgelehntes Angebot wird nicht zum Auftrag', () => {
  /**
   * `versendet_am` bleibt gesetzt, wenn ein Angebot spaeter abgelehnt,
   * zurueckgezogen oder abgelaufen ist — es WURDE ja versendet. Die Pruefung
   * hing an diesem Zeitstempel und machte daraus einen Auftrag ueber einen
   * Wert, den der Kunde ausdruecklich nicht angenommen hat. Sie haengt jetzt
   * am STATUS.
   */
  async function versendetesAngebotMit(status: string): Promise<string> {
    const k = await kunde(f.reinigung);
    const angebotId = await alsChef(async (db) => {
      const id = await legeAngebotAn(db, { kundeId: k, titel: `Status ${status}` });
      await db.abfrage(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp)
         values (app.aktiver_mandant(), $1, 1, 'Reinigung', 1, 'psch', 1000, 1900)`, [id]);
      await freigebenUndVersenden(db, id);
      return id;
    });
    await sql.unsafe(
      `update angebot set status = $2::angebot_status where id = $1`, [angebotId, status]);
    return angebotId;
  }

  it.each(['abgelehnt', 'zurueckgezogen', 'abgelaufen'])(
    'Status %s wird abgewiesen — trotz gesetztem versendet_am', async (status) => {
      const angebotId = await versendetesAngebotMit(status);

      const [z] = await sql.unsafe<{ versendet_am: Date | null }[]>(
        `select versendet_am from angebot where id = $1`, [angebotId]);
      // Der Zeitstempel steht noch — genau das war die Falle.
      expect(z!.versendet_am).not.toBeNull();

      await expect(alsChef((db) => wandleInAuftrag(db, angebotId, {
        art: 'rahmenvertrag', verantwortlichBenutzerId: chef, startDatum: '2026-04-01',
      }))).rejects.toThrow(new RegExp(`Status ${status} wird nicht zum Auftrag`, 'u'));
    });

  it('und `versendet` selbst geht weiterhin', async () => {
    const angebotId = await versendetesAngebotMit('versendet');
    const auftrag = await alsChef((db) => wandleInAuftrag(db, angebotId, {
      art: 'rahmenvertrag', verantwortlichBenutzerId: chef, startDatum: '2026-04-01',
    }));
    expect(auftrag.auftragsnummer).toMatch(/^AU-2026-/u);
  });
});

describe('(6) Die Werte bestaetigen — der Weg aus der Sperre (OPS-07)', () => {
  /**
   * Ohne diesen Dienst waere `kern.angebot_versand_pruefen` eine Sackgasse:
   * ein Angebot aus dem Raumbuch stuende auf Platzhaltern und liesse sich
   * nie versenden. Der Ausweg ist ausdruecklich KEIN Schalter — er verlangt
   * die Zahlen, und die Kalkulation haelt fest, wer sie wann genannt hat.
   */
  async function angebotMitKalkulation(): Promise<{ angebotId: string; objektId: string }> {
    const k = await kunde(f.reinigung);
    const o = await objektMitRaumbuch(f.reinigung, k);
    const angebotId = await alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o, new Date());
      const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
      const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
      const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
      const id = await legeAngebotAn(db, { kundeId: k, titel: 'Bestaetigen', objektId: o });
      await uebernimmKalkulation(db, id, kalk,
        { objektId: o, turnusLabel: 'monatlich', tarif, frequenz });
      return id;
    });
    return { angebotId, objektId: o };
  }

  const werte = {
    stundensatzEuro: '31,50',
    gemeinkostenBasis: 'lohn',
    gemeinkostenProzent: '17',
    wagnisGewinnProzent: '9,5',
    frequenzFaktor: '1', leistungswerteBestaetigen: true,
  };

  it('nach der Bestaetigung geht der Versand — vorher nicht', async () => {
    const { angebotId } = await angebotMitKalkulation();
    await expect(alsChef((db) => freigebenUndVersenden(db, angebotId)))
      .rejects.toThrow(/unbestaetigte Werte/u);

    await alsChef((db) =>
      bestaetigeKalkulation(db, angebotId, { ...werte, benutzerId: chef }));

    const versand = await alsChef((db) => freigebenUndVersenden(db, angebotId));
    expect(versand.angebotsnummer).toMatch(/^AN-2026-/u);
  });

  it('die Werte stehen danach in der Kalkulation — ganzzahlig, mit Urheber', async () => {
    const { angebotId } = await angebotMitKalkulation();
    await alsChef((db) =>
      bestaetigeKalkulation(db, angebotId, { ...werte, benutzerId: chef }));

    const [k] = await sql.unsafe<{
      satz: string; basis: string; gk: number; wg: number;
      platzhalter: boolean; von: string | null;
    }[]>(
      `select stundenverrechnungssatz_cent::text as satz, gemeinkosten_basis::text as basis,
              gemeinkosten_bp as gk, wagnis_gewinn_bp as wg,
              ist_platzhalter as platzhalter, geaendert_von::text as von
         from kalkulation where angebot_id = $1`, [angebotId]);
    expect(k).toMatchObject({
      satz: '3150', basis: 'lohn', gk: 1700, wg: 950, platzhalter: false,
    });
    expect(k!.von).toBe(chef);
  });

  it('nur die BENUTZTEN Belagsarten werden mitbestaetigt, nicht der Katalog', async () => {
    const { angebotId } = await angebotMitKalkulation();
    // Eine zweite Belagsart, die in keiner Kalkulationszeile vorkommt.
    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                              quelle, gueltig_ab)
       values ($1,'LINO','Linoleum','300.000','Platzhalter (O-17)','2026-01-01')
       returning id`, [f.reinigung]);

    await alsChef((db) =>
      bestaetigeKalkulation(db, angebotId, { ...werte, benutzerId: chef }));

    const [unberuehrt] = await sql.unsafe<{ platzhalter: boolean }[]>(
      `select ist_platzhalter as platzhalter from belagsart where id = $1`, [fremd!.id]);
    expect(unberuehrt!.platzhalter).toBe(true);
  });

  /**
   * Der teuerste Befund der Copilot-Runde, und er ist rueckwirkend.
   *
   * Die Bestaetigung schrieb `belagsart.ist_platzhalter = false` — in den
   * GETEILTEN Katalog. Die Sperre las den Katalog live. Wer also O-17 fuer
   * EIN Angebot bestaetigte, raeumte im selben Moment jedes ANDERE Angebot
   * auf derselben Belagsart aus der Sperre: Preise, die auf dem Platzhalter
   * gerechnet worden waren, durften hinaus, ohne dass jemand sie je angesehen
   * hatte. Kein Fehler wurde sichtbar; die Sperre hoerte einfach auf, fuer
   * sie zu gelten.
   *
   * Seit 0027 haengt die Sperre am Schnappschuss der Zeile.
   */
  it('die Bestaetigung eines Angebots gibt kein ANDERES Angebot frei', async () => {
    // ZWEI Angebote auf DEMSELBEN Objekt — also auf derselben Belagsart.
    // Genau darin lag der Fehler: der geteilte Katalog verband sie.
    const eins = await angebotMitKalkulation();
    const zwei = await alsChef(async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, eins.objektId, new Date());
      const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
      const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
      const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
      const [kd] = await db.abfrage<{ kunde_id: string }>(
        'select kunde_id from angebot where id = $1', [eins.angebotId]);
      const id = await legeAngebotAn(db, {
        kundeId: kd!.kunde_id, titel: 'Zweites Angebot', objektId: eins.objektId,
      });
      await uebernimmKalkulation(db, id, kalk,
        { objektId: eins.objektId, turnusLabel: 'monatlich', tarif, frequenz });
      return { angebotId: id };
    });

    await alsChef((db) =>
      bestaetigeKalkulation(db, eins.angebotId, { ...werte, benutzerId: chef }));

    // Das erste darf hinaus — es wurde bestaetigt.
    await expect(alsChef((db) => freigebenUndVersenden(db, eins.angebotId)))
      .resolves.toBeDefined();

    // Das zweite NICHT: niemand hat es angesehen.
    await expect(alsChef((db) => freigebenUndVersenden(db, zwei.angebotId)))
      .rejects.toThrow(/unbestaetigte Werte/u);
  });

  /**
   * O-56 hat kein Bestaetigungsfeld gehabt, wurde aber mitgeloescht: die
   * Bestaetigung raeumte `ist_platzhalter` ab, obwohl sie nach dem
   * Frequenzfaktor nie gefragt hatte. Das Angebot ging dann mit einem
   * GERATENEN Turnusfaktor hinaus — und die Seite meldete „bestaetigt“.
   */
  it('ohne Frequenzfaktor bleibt O-56 offen — und der Versand gesperrt', async () => {
    const { angebotId } = await angebotMitKalkulation();
    await alsChef((db) => bestaetigeKalkulation(db, angebotId, {
      ...werte, frequenzFaktor: null, leistungswerteBestaetigen: true, benutzerId: chef,
    }));
    await expect(alsChef((db) => freigebenUndVersenden(db, angebotId)))
      .rejects.toThrow(/unbestaetigte Werte/u);
  });

  /**
   * Ein negativer Stundensatz ergaebe negative Lohnkosten und darauf ein
   * Angebot, das dem Kunden Geld verspricht. `parseGeld` nimmt negatives Geld
   * an — richtig fuer eine Gutschrift, falsch fuer einen Satz.
   */
  it('ein negativer Stundensatz wird abgewiesen, nicht gerechnet', async () => {
    const { angebotId } = await angebotMitKalkulation();
    await expect(alsChef((db) => bestaetigeKalkulation(db, angebotId, {
      ...werte, stundensatzEuro: '-29,00', benutzerId: chef,
    }))).rejects.toThrow(/groesser als null/u);
  });

  it('ohne das Haekchen bleibt der Leistungswert offen — und der Versand gesperrt', async () => {
    const { angebotId } = await angebotMitKalkulation();
    await alsChef((db) => bestaetigeKalkulation(db, angebotId, {
      ...werte, frequenzFaktor: '1', leistungswerteBestaetigen: false, benutzerId: chef,
    }));
    await expect(alsChef((db) => freigebenUndVersenden(db, angebotId)))
      .rejects.toThrow(/unbestaetigte Werte/u);
  });

  it('eine unvollstaendige Eingabe wird abgewiesen, nicht halb gespeichert', async () => {
    const { angebotId } = await angebotMitKalkulation();
    await expect(alsChef((db) => bestaetigeKalkulation(db, angebotId, {
      ...werte, gemeinkostenProzent: null, benutzerId: chef,
    }))).rejects.toThrow(/alle drei/u);

    const [k] = await sql.unsafe<{ platzhalter: boolean }[]>(
      `select ist_platzhalter as platzhalter from kalkulation where angebot_id = $1`,
      [angebotId]);
    expect(k!.platzhalter).toBe(true);
  });

  it('eine unbekannte Gemeinkostenbasis ebenso', async () => {
    const { angebotId } = await angebotMitKalkulation();
    await expect(alsChef((db) => bestaetigeKalkulation(db, angebotId, {
      ...werte, gemeinkostenBasis: 'nach_gefuehl', benutzerId: chef,
    }))).rejects.toThrow(/Unbekannte Gemeinkostenbasis/u);
  });

  it('und eine eingefrorene Kalkulation wird nicht mehr geaendert', async () => {
    const { angebotId } = await angebotMitKalkulation();
    await alsChef((db) =>
      bestaetigeKalkulation(db, angebotId, { ...werte, benutzerId: chef }));
    await alsChef((db) => freigebenUndVersenden(db, angebotId));

    await expect(alsChef((db) => bestaetigeKalkulation(db, angebotId, {
      ...werte, stundensatzEuro: '99,00', benutzerId: chef,
    }))).rejects.toThrow(/festgeschrieben/u);
  });
});
