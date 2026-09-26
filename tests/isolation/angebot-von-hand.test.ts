import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  HandAngebotFehler, einheiten, legeAngebotVonHandAn, mengeAusEingabe, preisAusEingabe,
  steuersaetzeAm, type HandPosition,
} from '../../src/server/services/angebot/von-hand.js';

/**
 * **Ein Angebot ohne Raumbuch** (V-005, SEC-01, BAU-01, Invariante 1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `POST /api/angebot` kannte drei Handlungen, und die einzige, die ein
 * Angebot ENTSTEHEN liess, rechnete aus einem Raumbuch: Flächen mal
 * Leistungswert mal Turnus. In der Sicherheit und im Bau gibt es kein
 * Raumbuch. `legeAngebotAn` stand seit `0024` da und hatte genau einen
 * Aufrufer — den Seed.
 *
 * Diese Datei läuft deshalb im Mandanten `security`: dort war der Mangel
 * echt, nicht theoretisch.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier bewiesen wird, und warum jede Prüfung Geld kostet, wenn sie fehlt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §1  Menge und Preis sind ganzzahlig gelesen — kein Gleitkomma, nirgends.
 * §2  Die Zeilensumme rechnet die DATENBANK; `netto_cent` der Auslöser.
 * §3  §13b heisst null Prozent, und das Kennzeichen kommt aus der Gruppe.
 * §4  Eine Befreiung trägt den Grund aus der Gruppe, nicht aus dem Formular.
 * §5  Alles oder nichts: eine falsche Zeile hinterlässt kein halbes Angebot —
 *     und das zählt hier doppelt, weil eine Position sich nicht löschen lässt.
 * §6  Eine Zeile mit Zahlen, aber ohne Text, wird abgewiesen statt übergangen.
 * §7  Kunde und Ansprechpartner müssen zusammenpassen.
 * §8  Ohne Schreibrecht entsteht nichts — auch nicht die Kopfzeile.
 */

let f: Fixtur;
let leitung = '';
let ohneRecht = '';
let kundeId = '';
let zweiterKunde = '';
let archivierterKunde = '';
let objektId = '';
let kontaktId = '';
let fremderKontakt = '';
let tagHeute = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

async function kunde(mandant: string, name: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,$3,'Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [mandant, `K-${zufall()}`, name]);
  return k!.id;
}

async function kontakt(mandant: string, kundeRef: string, nachname: string): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname)
     values ($1,$2,'Kim',$3) returning id`, [mandant, kundeRef, nachname]);
  return a!.id;
}

beforeAll(async () => {
  f = await seed();
  leitung = await konto('angebot-hand-leitung@test.invalid', f.security, 'leitung');
  ohneRecht = await konto('angebot-hand-ohne@test.invalid', f.security, 'mitarbeiter');
  for (const r of ['angebot.lesen', 'angebot.schreiben']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.security]);
  }
  kundeId = await kunde(f.security, 'Bezirksamt Mitte');
  zweiterKunde = await kunde(f.security, 'Hafen Spandau GmbH');
  archivierterKunde = await kunde(f.security, 'Alt & Weg GmbH');
  await sql.unsafe(`update kunde set archiviert_am = now() where id = $1`,
    [archivierterKunde]);
  kontaktId = await kontakt(f.security, kundeId, 'Bauer');
  fremderKontakt = await kontakt(f.security, zweiterKunde, 'Sommer');
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Lagerhalle Marzahn','Teststr. 3','10115','Berlin') returning id`,
    [f.security, kundeId, `O-${zufall()}`]);
  objektId = o!.id;
  /*
   * Der Stichtag kommt aus der DATENBANK, nicht aus `new Date()`: um 00:30
   * Berliner Zeit im Sommer ist der UTC-Tag noch der gestrige, und ein Satz,
   * der zum Monatsende ausläuft, wäre dann der falsche (Invariante 2).
   */
  const [z] = await imKontext((k) => k.abfrage<{ tag: string }>(
    `select app.berlin_heute()::text as tag`));
  tagHeute = z!.tag;
});
afterAll(schliessen);

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>,
  o: { readonly readonly?: boolean; readonly benutzer?: string } = {},
): Promise<T> {
  const benutzer = o.benutzer ?? leitung;
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.security, benutzerId: benutzer,
      portal: 'intern' as const, readonly: o.readonly ?? false,
    },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: benutzer,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

/** Eine brauchbare Zeile — die Abweichung steht dann jeweils im Test. */
function zeile(teil: Partial<HandPosition> = {}): HandPosition {
  return {
    kurztext: 'Doppelstreife 22:00–06:00',
    menge: '20',
    einheit: 'h',
    einzelpreisEuro: '38,50',
    steuersatzSchluessel: 'ust_19',
    ...teil,
  };
}

interface PositionZeile {
  readonly position_nr: number;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly menge: string;
  readonly einheit: string;
  readonly einzelpreis_cent: string;
  readonly gesamtpreis_cent: string;
  readonly steuersatz_bp: number;
  readonly steuer_kennzeichen: string;
  readonly steuerbefreiung_grund: string | null;
  readonly objekt_id: string | null;
}

async function positionen(angebotId: string): Promise<readonly PositionZeile[]> {
  return imKontext((k) => k.abfrage<PositionZeile>(
    `select position_nr, kurztext, langtext, menge::text as menge, einheit,
            einzelpreis_cent::text as einzelpreis_cent,
            gesamtpreis_cent::text as gesamtpreis_cent,
            steuersatz_bp, steuer_kennzeichen::text as steuer_kennzeichen,
            steuerbefreiung_grund, objekt_id
       from angebotsposition where angebot_id = $1::uuid order by position_nr`,
    [angebotId]));
}


/* ═════════════════════════════════════════════════════════════════════════
 * §1 — Menge und Preis, ohne Datenbank
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§1 die Eingabe wird ganzzahlig gelesen', () => {
  it('deutsche und englische Schreibweise ergeben dieselbe Menge', () => {
    expect(mengeAusEingabe('10,5')).toBe(10_500n);
    expect(mengeAusEingabe('10.5')).toBe(10_500n);
    expect(mengeAusEingabe('10')).toBe(10_000n);
    expect(mengeAusEingabe(' 1 250 ')).toBe(1_250_000n);
  });

  it('drei Nachkommastellen ja, vier nein', () => {
    expect(mengeAusEingabe('0,125')).toBe(125n);
    // Gerundet würde aus 0,1255 stillschweigend 0,126 oder 0,125 — und
    // niemand sähe mehr, dass die Eingabe eine Stelle mehr trug.
    expect(() => mengeAusEingabe('0,1255')).toThrow(HandAngebotFehler);
  });

  it('null ist keine Menge — `ap_leistung_menge_nicht_null` sagt dasselbe', () => {
    expect(() => mengeAusEingabe('0')).toThrow(/Menge null/u);
    expect(() => mengeAusEingabe('0,000')).toThrow(HandAngebotFehler);
  });

  it('ein Tausenderpunkt in der Menge wird nicht geraten', () => {
    // „1.250" wäre als Menge 1250 oder 1,25 — je nach Lesart. Statt zu
    // wählen, weist die Funktion ab.
    expect(() => mengeAusEingabe('1.250,5')).toThrow(HandAngebotFehler);
  });

  it('der Preis läuft durch die geprüfte Geldfunktion', () => {
    expect(preisAusEingabe('1.250,00')).toBe(125_000n);
    expect(preisAusEingabe('38,50')).toBe(3_850n);
    expect(preisAusEingabe('0,01')).toBe(1n);
  });

  it('ein negativer Einzelpreis ist keine Position', () => {
    expect(() => preisAusEingabe('-5,00')).toThrow(/nicht negativ/u);
  });

  it('ein Preis in englischer Schreibweise wird abgewiesen, nicht umgedeutet', () => {
    // „1,250.00" als 1,25 zu lesen verfehlte den Betrag um den Faktor tausend.
    expect(() => preisAusEingabe('1,250.00')).toThrow(HandAngebotFehler);
    expect(() => preisAusEingabe('abc')).toThrow(HandAngebotFehler);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §2 — Der Katalog ist datiert
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§2 Sätze und Einheiten kommen aus der Datenbank', () => {
  it('die heute gültigen Sätze stehen zur Wahl, mit Kennzeichen', async () => {
    const saetze = await imKontext((k) => steuersaetzeAm(k, tagHeute));
    const nach = new Map(saetze.map((s) => [s.schluessel, s]));
    expect(nach.get('ust_19')?.satzBp).toBe(1900);
    expect(nach.get('ust_19')?.kennzeichen).toBe('regelsatz');
    expect(nach.get('ust_0_13b_bau')?.satzBp).toBe(0);
    expect(nach.get('ust_0_13b_bau')?.kennzeichen).toBe('reverse_charge_13b');
  });

  it('vor dem Gültigkeitsbeginn steht kein Satz zur Wahl', async () => {
    // Die Saat beginnt am 1.1.2021 — das Ende der befristeten Senkung. Ein
    // früheres Datum ist eine Behauptung über Sätze, die diese Plattform nie
    // ausgestellt hat.
    const saetze = await imKontext((k) => steuersaetzeAm(k, '2020-06-01'));
    expect(saetze).toEqual([]);
  });

  it('die Einheiten stammen aus `masseinheit`', async () => {
    const liste = await imKontext((k) => einheiten(k));
    expect(liste.map((m) => m.schluessel)).toContain('h');
    expect(liste.map((m) => m.schluessel)).toContain('psch');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §3 — Das Angebot entsteht, und die Datenbank rechnet
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§3 ein Angebot mit eigenen Positionen', () => {
  it('legt Kopf und Zeilen an; die Zeilensumme rechnet die Datenbank', async () => {
    const ergebnis = await imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Objektschutz Lagerhalle', objektId, stichtag: tagHeute,
      einleitungstext: '  Sehr geehrte Damen und Herren,  ',
      positionen: [
        zeile(),
        zeile({ kurztext: 'Schliessdienst', menge: '30,5', einheit: 'h',
          einzelpreisEuro: '41,00', langtext: 'Mo–Fr, 18:00 und 22:00' }),
      ],
    }));
    expect(ergebnis.positionen).toBe(2);

    const zeilen = await positionen(ergebnis.angebotId);
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]!.position_nr).toBe(1);
    expect(zeilen[0]!.menge).toBe('20.000');
    expect(zeilen[0]!.einzelpreis_cent).toBe('3850');
    // 20 × 38,50 € = 770,00 €. Gerechnet in `numeric`, nicht in JavaScript.
    expect(zeilen[0]!.gesamtpreis_cent).toBe('77000');
    expect(zeilen[0]!.objekt_id).toBe(objektId);
    expect(zeilen[0]!.langtext).toBeNull();

    // 30,5 × 41,00 € = 1.250,50 € — der Fall, an dem ein Gleitkomma sichtbar
    // würde: 30.5 * 4100 ist in IEEE-754 nicht exakt 125050.
    expect(zeilen[1]!.menge).toBe('30.500');
    expect(zeilen[1]!.gesamtpreis_cent).toBe('125050');
    expect(zeilen[1]!.langtext).toBe('Mo–Fr, 18:00 und 22:00');
  });

  it('der Auslöser hält `angebot.netto_cent` auf der Summe', async () => {
    const { angebotId } = await imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Summenprobe', stichtag: tagHeute,
      positionen: [
        zeile({ menge: '1', einzelpreisEuro: '100,00' }),
        zeile({ kurztext: 'Zweite', menge: '3', einzelpreisEuro: '0,33' }),
      ],
    }));
    const [kopf] = await imKontext((k) => k.abfrage<{
      netto_cent: string; status: string; angebotsnummer: string | null;
      einleitungstext: string | null;
    }>(
      `select netto_cent::text as netto_cent, status::text as status, angebotsnummer,
              einleitungstext
         from angebot where id = $1::uuid`, [angebotId]));
    // 100,00 € + 3 × 0,33 € = 100,99 €.
    expect(kopf!.netto_cent).toBe('10099');
    // Ein Entwurf hat KEINE Nummer — sie wird beim Versand vergeben
    // (Invariante 4, `angebot_nummer_bei_versand`).
    expect(kopf!.status).toBe('entwurf');
    expect(kopf!.angebotsnummer).toBeNull();
  });

  it('der Einleitungstext wird beschnitten gespeichert', async () => {
    const { angebotId } = await imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Textprobe', stichtag: tagHeute,
      einleitungstext: '   Guten Tag.   ',
      positionen: [zeile()],
    }));
    const [kopf] = await imKontext((k) => k.abfrage<{ einleitungstext: string | null }>(
      `select einleitungstext from angebot where id = $1::uuid`, [angebotId]));
    expect(kopf!.einleitungstext).toBe('Guten Tag.');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §4 — Die Steuer kommt aus der Gruppe
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§4 Steuersatz, Kennzeichen und Befreiungsgrund hängen zusammen', () => {
  it('§13b heisst null Prozent und trägt das Kennzeichen der Gruppe', async () => {
    const { angebotId } = await imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Bauleistung', stichtag: tagHeute,
      positionen: [zeile({ steuersatzSchluessel: 'ust_0_13b_bau' })],
    }));
    const [p] = await positionen(angebotId);
    expect(p!.steuersatz_bp).toBe(0);
    expect(p!.steuer_kennzeichen).toBe('reverse_charge_13b');
    // `ap_reverse_charge_ohne_steuer` liesse 19 % hier gar nicht zu — der
    // Test hält fest, dass die Anwendung gar nicht erst in die Lage kommt.
    expect(p!.steuerbefreiung_grund).toMatch(/Steuerschuldnerschaft/u);
  });

  it('eine Befreiung trägt den Grund aus der Gruppe, nicht aus dem Formular', async () => {
    const { angebotId } = await imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Vermietung', stichtag: tagHeute,
      positionen: [zeile({ steuersatzSchluessel: 'ust_0_4nr12' })],
    }));
    const [p] = await positionen(angebotId);
    expect(p!.steuersatz_bp).toBe(0);
    expect(p!.steuer_kennzeichen).toBe('steuerfrei');
    // `ap_steuerfrei_mit_grund` verlangt ihn; §14 Abs. 4 Nr. 8 UStG druckt ihn.
    expect(p!.steuerbefreiung_grund).toBe('Steuerfreie Vermietung nach §4 Nr. 12 UStG');
  });

  it('zwei Sätze in einem Angebot stehen nebeneinander', async () => {
    const { angebotId } = await imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Gemischt', stichtag: tagHeute,
      positionen: [
        zeile({ steuersatzSchluessel: 'ust_19' }),
        zeile({ kurztext: 'Schulung', steuersatzSchluessel: 'ust_07' }),
      ],
    }));
    const zeilen = await positionen(angebotId);
    expect(zeilen.map((z) => z.steuersatz_bp)).toEqual([1900, 700]);
  });

  it('ein Satz, den es am Stichtag nicht gibt, wird nicht erfunden', async () => {
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Erfundener Satz', stichtag: tagHeute,
      positionen: [zeile({ steuersatzSchluessel: 'ust_16' })],
    }))).rejects.toThrow(/keinen Steuersatz/u);
  });

  it('eine Einheit ausserhalb des Verzeichnisses ebenso wenig', async () => {
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Erfundene Einheit', stichtag: tagHeute,
      positionen: [zeile({ einheit: 'wochen' })],
    }))).rejects.toThrow(/Einheitenverzeichnis/u);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §5 — Alles oder nichts
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§5 eine falsche Zeile hinterlässt kein halbes Angebot', () => {
  it('die zweite Zeile ist kaputt — und auch die erste entsteht nicht', async () => {
    const vorher = await imKontext((k) => k.abfrage<{ n: string }>(
      `select count(*)::text as n from angebot where titel = 'Halbe Fassung'`));
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Halbe Fassung', stichtag: tagHeute,
      positionen: [zeile(), zeile({ kurztext: 'Kaputt', einzelpreisEuro: 'x' })],
    }))).rejects.toThrow(HandAngebotFehler);
    const nachher = await imKontext((k) => k.abfrage<{ n: string }>(
      `select count(*)::text as n from angebot where titel = 'Halbe Fassung'`));
    /*
     * Das zählt hier doppelt: `revoke delete on angebotsposition` (0024)
     * heisst, dass eine halbe Fassung für immer stehen bliebe.
     */
    expect(nachher[0]!.n).toBe(vorher[0]!.n);
  });

  it('ohne Position entsteht kein Angebot', async () => {
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Leer', stichtag: tagHeute, positionen: [],
    }))).rejects.toThrow(/ohne Position/u);
  });

  it('ohne Titel auch nicht', async () => {
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: '   ', stichtag: tagHeute, positionen: [zeile()],
    }))).rejects.toThrow(/einen Titel/u);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §6 — Leere Zeilen und halbleere Zeilen sind nicht dasselbe
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§6 das Formular schickt mehr Zeilen, als getippt wurden', () => {
  it('ganz leere Zeilen werden übergangen', async () => {
    const leer: HandPosition = {
      kurztext: '', menge: '', einheit: '', einzelpreisEuro: '',
      steuersatzSchluessel: 'ust_19',
    };
    const { angebotId, positionen: n } = await imKontext(
      (k) => legeAngebotVonHandAn(k, {
        kundeId, titel: 'Mit Leerzeilen', stichtag: tagHeute,
        positionen: [leer, zeile(), leer, leer],
      }));
    expect(n).toBe(1);
    const zeilen = await positionen(angebotId);
    // Die Nummern sind lückenlos: die übergangenen Zeilen zählen nicht mit.
    expect(zeilen.map((z) => z.position_nr)).toEqual([1]);
  });

  it('eine Zeile mit Preis, aber ohne Kurztext, wird abgewiesen', async () => {
    /*
     * Der teure Fall: stillschweigend übergangen sähe das Angebot fertig
     * aus, und die Position fehlte. Genau so entstehen Sätze wie „das stand
     * doch im Angebot".
     */
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Vergessener Text', stichtag: tagHeute,
      positionen: [zeile(), zeile({ kurztext: '' })],
    }))).rejects.toThrow(/keinen Kurztext/u);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §7 — Kunde und Ansprechpartner
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§7 der Empfänger muss zusammenpassen', () => {
  it('ein Ansprechpartner dieses Kunden wird übernommen', async () => {
    const { angebotId } = await imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, ansprechpartnerId: kontaktId, titel: 'Mit Kontakt',
      stichtag: tagHeute, positionen: [zeile()],
    }));
    const [kopf] = await imKontext((k) => k.abfrage<{ ansprechpartner_id: string | null }>(
      `select ansprechpartner_id from angebot where id = $1::uuid`, [angebotId]));
    expect(kopf!.ansprechpartner_id).toBe(kontaktId);
  });

  it('ein Ansprechpartner eines ANDEREN Kunden wird abgewiesen — als Satz', async () => {
    /*
     * `angebot_ansprechpartner_fk` schliesst über (mandant_id, kunde_id, id)
     * und fiele ohnehin — aber als Fremdschlüsselverstoss, also als 500er
     * Seite für einen Tippfehler in einer Auswahlliste.
     */
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, ansprechpartnerId: fremderKontakt, titel: 'Fremder Kontakt',
      stichtag: tagHeute, positionen: [zeile()],
    }))).rejects.toThrow(/gehört nicht zu diesem Kunden/u);
  });

  it('zu einem archivierten Kunden entsteht kein Angebot', async () => {
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId: archivierterKunde, titel: 'Archiviert',
      stichtag: tagHeute, positionen: [zeile()],
    }))).rejects.toThrow(/archiviert/u);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §8 — Ohne Recht entsteht nichts
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§8 Linie 2 hält auch ohne Linie 1', () => {
  it('ohne `angebot.schreiben` entsteht nicht einmal die Kopfzeile', async () => {
    /*
     * Der Dienst wird hier ABSICHTLICH ohne die Tor-Prüfung gerufen — genau
     * das prüft, ob `t_mandant` auf `angebot` (0024) allein trägt (AUT-05).
     */
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Ohne Recht', stichtag: tagHeute, positionen: [zeile()],
    }), { benutzer: ohneRecht })).rejects.toThrow();
  });

  it('in der Nur-Lese-Bindung ebenfalls nicht', async () => {
    await expect(imKontext((k) => legeAngebotVonHandAn(k, {
      kundeId, titel: 'Nur lesend', stichtag: tagHeute, positionen: [zeile()],
    }), { readonly: true })).rejects.toThrow();
  });
});
