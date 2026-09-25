/**
 * Demodaten fuer Phase 4 — CRM und Operations (OPS-01 bis OPS-03).
 *
 * Was hier entsteht, ist die Kette, auf der das Abnahmekriterium steht:
 * Firma → Kunde → Ansprechpartner → Objekt → Raumbuch → Belagsart mit
 * Leistungswert. Ohne sie gibt es nichts zu kalkulieren, und ohne
 * `kunde_zugang` kommt kein Kundenkonto in sein Portal — das war bis hierher
 * der fehlgeschlossene Zustand, und jetzt ist es ein gebauter Weg.
 *
 * **Jeder Leistungswert traegt `ist_platzhalter = true`** (O-17). Sie sind
 * branchenuebliche Groessenordnungen, keine bestaetigten Werte der Gruppe;
 * die Oberflaeche sagt das, und dieser Kommentar sagt, warum.
 *
 * **Idempotent durch LESEN ZUERST**, nicht durch `on conflict`: die
 * natuerlichen Schluessel liegen auf TEILWEISEN Indizes (nur nicht
 * archivierte Zeilen), und ein `on conflict` darauf muesste das Praedikat
 * wiederholen — eine zweite Stelle, an der dieselbe Regel steht.
 */
import type postgres from 'postgres';
import type { Speicher } from '../../storage/adapter.js';
import { demoPdf } from './demo-pdf.js';

type Sql = postgres.Sql<Record<string, unknown>>;

/** Ein realistisches Raumbuch: Etage, Raum, Bezeichnung, m², Belag, Klasse. */
interface RaumVorgabe {
  readonly etage: string;
  readonly nummer: string | null;
  readonly bezeichnung: string;
  readonly flaeche: string;
  readonly belag: string;
  readonly klasse: string;
  readonly fenster?: string;
}

const KLASSEN: readonly (readonly [string, string, number])[] = [
  ['RK1', 'Büro und Besprechung', 10],
  ['RK2', 'Verkehrsfläche', 20],
  ['RK3', 'Sanitär', 30],
  ['RK4', 'Technik und Lager', 40],
];

/**
 * Leistungswerte in m² je Stunde — PLATZHALTER (O-17).
 *
 * Die Spanne ist die uebliche: glatte Boeden gehen schneller als Teppich,
 * Sanitaer ist die Ausnahme nach unten, weil dort nicht die Flaeche die Zeit
 * bestimmt.
 */
const BELAEGE: readonly (readonly [string, string, string])[] = [
  ['PVC', 'PVC / Vinyl', '260.000'],
  ['LINO', 'Linoleum', '240.000'],
  ['TEPPICH', 'Teppichboden', '300.000'],
  ['FLIESE', 'Fliesen', '200.000'],
  ['NATUR', 'Naturstein', '180.000'],
  ['BETON', 'Sichtbeton / Estrich', '320.000'],
];

/**
 * Buerohaus Kurfuerstendamm — mit Absicht MIT dem Fall, der den teuren
 * Fehler ausloest: Raum 101 gibt es im UG und im 1. OG. Ein Raumbuch, dessen
 * Schluessel die Etage vergisst, verliert hier 18 m².
 */
const RAUMBUCH_BUEROHAUS: readonly RaumVorgabe[] = [
  { etage: 'UG', nummer: '101', bezeichnung: 'Lager', flaeche: '18.000', belag: 'BETON', klasse: 'RK4' },
  { etage: 'UG', nummer: '102', bezeichnung: 'Technik', flaeche: '12.500', belag: 'BETON', klasse: 'RK4' },
  { etage: 'UG', nummer: null, bezeichnung: 'Flur Untergeschoss', flaeche: '24.000', belag: 'FLIESE', klasse: 'RK2' },
  { etage: 'EG', nummer: '001', bezeichnung: 'Empfang', flaeche: '46.750', belag: 'NATUR', klasse: 'RK1', fenster: '18.000' },
  { etage: 'EG', nummer: '002', bezeichnung: 'Besprechung klein', flaeche: '22.300', belag: 'TEPPICH', klasse: 'RK1', fenster: '6.500' },
  { etage: 'EG', nummer: '003', bezeichnung: 'WC Damen', flaeche: '9.200', belag: 'FLIESE', klasse: 'RK3' },
  { etage: 'EG', nummer: '004', bezeichnung: 'WC Herren', flaeche: '9.200', belag: 'FLIESE', klasse: 'RK3' },
  { etage: 'EG', nummer: null, bezeichnung: 'Foyer', flaeche: '61.400', belag: 'NATUR', klasse: 'RK2', fenster: '24.000' },
  { etage: '1', nummer: '101', bezeichnung: 'Büro Nord', flaeche: '34.600', belag: 'TEPPICH', klasse: 'RK1', fenster: '9.000' },
  { etage: '1', nummer: '102', bezeichnung: 'Büro Süd', flaeche: '31.200', belag: 'TEPPICH', klasse: 'RK1', fenster: '9.000' },
  { etage: '1', nummer: '103', bezeichnung: 'Teeküche', flaeche: '11.800', belag: 'PVC', klasse: 'RK2' },
  { etage: '1', nummer: null, bezeichnung: 'Flur 1. OG', flaeche: '28.900', belag: 'LINO', klasse: 'RK2' },
  { etage: '2', nummer: '201', bezeichnung: 'Großraum', flaeche: '96.400', belag: 'TEPPICH', klasse: 'RK1', fenster: '22.000' },
  { etage: '2', nummer: '202', bezeichnung: 'Besprechung groß', flaeche: '38.000', belag: 'TEPPICH', klasse: 'RK1', fenster: '11.500' },
  { etage: '2', nummer: null, bezeichnung: 'Flur 2. OG', flaeche: '28.900', belag: 'LINO', klasse: 'RK2' },
];

const RAUMBUCH_AERZTEHAUS: readonly RaumVorgabe[] = [
  { etage: 'EG', nummer: '01', bezeichnung: 'Wartezimmer', flaeche: '42.000', belag: 'LINO', klasse: 'RK1', fenster: '12.000' },
  { etage: 'EG', nummer: '02', bezeichnung: 'Behandlung 1', flaeche: '18.500', belag: 'PVC', klasse: 'RK1' },
  { etage: 'EG', nummer: '03', bezeichnung: 'Behandlung 2', flaeche: '18.500', belag: 'PVC', klasse: 'RK1' },
  { etage: 'EG', nummer: '04', bezeichnung: 'Labor', flaeche: '14.250', belag: 'PVC', klasse: 'RK4' },
  { etage: 'EG', nummer: '05', bezeichnung: 'WC Patienten', flaeche: '7.800', belag: 'FLIESE', klasse: 'RK3' },
  { etage: 'EG', nummer: null, bezeichnung: 'Flur Praxis', flaeche: '31.600', belag: 'LINO', klasse: 'RK2' },
];

interface KundeVorgabe {
  readonly bereich: string;
  readonly firma: string;
  /** `null` bei einer Behoerde: sie hat keine Rechtsform im Sinne des HGB. */
  readonly rechtsform: string | null;
  readonly nummer: string;
  readonly name: string;
  readonly kontakt: readonly [string, string, string];
  /**
   * **Die Anschrift ist keine Zierde, sondern die Bedingung fuer jede
   * Rechnung.** §14 Abs. 4 Nr. 1 UStG verlangt Name UND Anschrift des
   * Leistungsempfaengers; `ustg14.ts` liest sie aus `kunde.strasse`,
   * `kunde.plz`, `kunde.ort` (beziehungsweise der Rechnungsanschrift, wenn
   * eine abweicht) und weist ohne sie ab.
   *
   * Sie fehlte hier ganz — bei ALLEN vier Eintraegen —, und damit war in den
   * Demodaten kein einziger Beleg festschreibbar. Aufgefallen ist das erst,
   * als der §14-Pruefer aus Phase 6 auf den Seed aus Phase 5 traf: drei
   * Browserpruefungen brachen ab, und ihre Meldung machte den offenen
   * Nummernkreis (O-134) dafuer verantwortlich, weil das die einzige Ursache
   * war, die sie kannten.
   *
   * Erfundene Firmen an erfundenen Adressen — dieselbe Machart wie die
   * `.example`-Kennungen daneben. Ein Kunde mit echter Anschrift in einem
   * Repository waere ein Datenschutzproblem und keine Demodatei.
   */
  readonly anschrift: readonly [strasse: string, hausnummer: string, plz: string, ort: string];
  /**
   * **Der oeffentliche Auftraggeber — und warum es ihn in den Demodaten
   * geben MUSS.**
   *
   * ROADMAP Phase 6 nennt als Abnahme „a KoSIT-valid XRechnung is produced
   * for a public buyer", und SPEC §9 sagt, dass die Gruppe oeffentliche
   * Auftraggeber ohne XRechnung gar nicht abrechnen kann. Bis hierher kannte
   * der Seed nur Hausverwaltungen: der ganze FIN-11-Weg liess sich in den
   * Demodaten nicht einmal ansehen, geschweige denn vorfuehren.
   *
   * `typ = 'behoerde'` zieht `kunde_behoerde_ist_oeffentlich` nach sich —
   * die Datenbank verlangt dann `ist_oeffentlicher_auftraggeber`. Die
   * Leitweg-ID ist eine erfundene Demokennung in der FORM der echten
   * (`991-12345-67`: Grobadressierung, Feinadressierung, Pruefziffer); welche
   * Kennung ein wirklicher Auftraggeber hat, ist O-22 und wird nicht geraten.
   */
  readonly behoerde?: {
    readonly leitwegId: string;
    /** BT-49 / BT-49-1. Bei einer Leitweg-ID ist das EAS-Schema 0204. */
    readonly eadresse: string;
    readonly eadresseSchema: string;
  };
  /**
   * Die beiden EN-16931-Angaben, die auch ein PRIVATER Auftraggeber traegt —
   * und ohne die aus einem festgeschriebenen Beleg keine XRechnung und kein
   * ZUGFeRD entsteht.
   *
   * Der Grund, dass sie hier stehen: `fehlendePflichtfelder` meldet BT-10
   * (Kaeuferreferenz, BR-DE-15) UNABHAENGIG davon, ob der Empfaenger ein
   * oeffentlicher Auftraggeber ist — nur der Meldungstext wechselt. Ohne
   * diese Zeilen antwortete `belegAusgabe` fuer JEDE Rechnung des
   * Portalkunden `unvollstaendig`, die beiden Ausgaberouten waeren im ganzen
   * Demobestand unerreichbar, und der aufwendigste Teil des Kundenportals
   * liefe in keinem Durchlauf. „Seed data exercises it" (CLAUDE.md) waere
   * nicht erfuellt.
   *
   * **Demowerte, wie die uebrigen Firmen auch.** Die Kaeuferreferenz eines
   * privaten Auftraggebers ist SEINE Angabe (Bestell-, Kostenstellen- oder
   * Objektkennung) — welche ein wirklicher Kunde fuehrt, ist O-22 und wird
   * nicht geraten; hier steht eine erfundene Kennung in der Form einer
   * echten. `EM` ist der EAS-Code fuer eine E-Mail-Adresse, die ueblichste
   * elektronische Adresse ausserhalb des Behoerdenwegs.
   */
  readonly erechnung?: {
    readonly kaeuferReferenz: string;
    readonly eadresse: string;
    readonly eadresseSchema: string;
  };
}

const KUNDEN: readonly KundeVorgabe[] = [
  /*
   * Der Kunde MIT Portalzugang (`kunde.demo@example.test`). Er traegt als
   * einziger private Auftraggeber die beiden e-Rechnungsangaben — damit im
   * Demobestand wenigstens ein Beleg vorliegt, aus dem ZUGFeRD und XRechnung
   * wirklich entstehen und den die Ausgaberouten des Kundenportals ausliefern
   * koennen.
   */
  { bereich: 'reinigung', firma: 'Berliner Hausverwaltung GmbH', rechtsform: 'GmbH',
    nummer: 'K-10001', name: 'Berliner Hausverwaltung GmbH',
    kontakt: ['Anna', 'Radtke', 'a.radtke@bhv-berlin.example'],
    anschrift: ['Musterallee', '12', '10115', 'Berlin'],
    erechnung: {
      kaeuferReferenz: 'BHV-OBJ-10115',
      eadresse: 'rechnungseingang@bhv-berlin.example',
      eadresseSchema: 'EM',
    } },
  { bereich: 'reinigung', firma: 'Charlottenburg Immobilien GmbH', rechtsform: 'GmbH',
    nummer: 'K-10002', name: 'Charlottenburg Immobilien GmbH',
    kontakt: ['Jens', 'Petrow', 'j.petrow@chb-immo.example'],
    anschrift: ['Beispielstrasse', '48', '10707', 'Berlin'] },
  { bereich: 'security', firma: 'Berliner Hausverwaltung GmbH', rechtsform: 'GmbH',
    nummer: 'K-20001', name: 'Berliner Hausverwaltung GmbH',
    kontakt: ['Anna', 'Radtke', 'a.radtke@bhv-berlin.example'],
    anschrift: ['Musterallee', '12', '10115', 'Berlin'] },
  { bereich: 'bau', firma: 'Charlottenburg Immobilien GmbH', rechtsform: 'GmbH',
    nummer: 'K-30001', name: 'Charlottenburg Immobilien GmbH',
    kontakt: ['Jens', 'Petrow', 'j.petrow@chb-immo.example'],
    anschrift: ['Beispielstrasse', '48', '10707', 'Berlin'] },
  /*
   * Der oeffentliche Auftraggeber (FIN-11). Erfunden wie die uebrigen
   * Demofirmen — ein echtes Bezirksamt mit einer echten Leitweg-ID in einem
   * Repository waere eine Angabe, die jemand fuer bare Muenze nimmt.
   */
  { bereich: 'reinigung', firma: 'Bezirksamt Musterberg von Berlin', rechtsform: null,
    nummer: 'K-10003', name: 'Bezirksamt Musterberg von Berlin',
    kontakt: ['Katrin', 'Oswald', 'rechnungseingang@bezirksamt-musterberg.example'],
    anschrift: ['Musterplatz', '1', '10178', 'Berlin'],
    behoerde: {
      leitwegId: '991-12345-67',
      eadresse: '991-12345-67',
      eadresseSchema: '0204',
    } },
];

interface ObjektVorgabe {
  readonly bereich: string;
  readonly kundenNummer: string | null;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly typ: string;
  readonly strasse: string;
  readonly hausnummer: string;
  readonly plz: string;
  readonly ort: string;
  readonly etagen: number | null;
  readonly zutritt: string | null;
  readonly raumbuch: readonly RaumVorgabe[];
  /**
   * Breiten- und Längengrad als `numeric(9,6)`-Text (V-170, OPS-01).
   *
   * **Näherungswerte für die Vorführung**, aus einer Karte abgelesen, nicht
   * vermessen — sie liegen im richtigen Block, nicht auf der Haustür. Sie
   * stehen hier, damit das Wetter im Bautagebuch (BAU-08) über den Befund
   * „keine Koordinaten" hinaus bis zur Stationsfrage kommt und das Objektblatt
   * das Feld gefüllt zeigt. Eine Geokodierung der Adresse ist das nicht (O-122).
   */
  readonly geo: readonly [lat: string, lon: string];
}

const OBJEKTE: readonly ObjektVorgabe[] = [
  { bereich: 'reinigung', kundenNummer: 'K-10001', nummer: 'OBJ-1001', geo: ['52.503100', '13.332400'],
    bezeichnung: 'Bürohaus Kurfürstendamm', typ: 'Bürogebäude',
    strasse: 'Kurfürstendamm', hausnummer: '21', plz: '10719', ort: 'Berlin',
    etagen: 4, zutritt: 'Schlüsselkasten Hintereingang, Code beim Objektleiter',
    raumbuch: RAUMBUCH_BUEROHAUS },
  { bereich: 'reinigung', kundenNummer: 'K-10002', nummer: 'OBJ-1002', geo: ['52.487300', '13.321000'],
    bezeichnung: 'Ärztehaus Wilmersdorf', typ: 'Praxis',
    strasse: 'Berliner Straße', hausnummer: '48', plz: '10713', ort: 'Berlin',
    etagen: 1, zutritt: 'Zugang nur nach Praxisschluss ab 19:00',
    raumbuch: RAUMBUCH_AERZTEHAUS },
  { bereich: 'reinigung', kundenNummer: null, nummer: 'OBJ-1003', geo: ['52.483800', '13.392000'],
    bezeichnung: 'Veranstaltungshalle Tempelhof', typ: 'Veranstaltungsort',
    strasse: 'Columbiadamm', hausnummer: '10', plz: '10965', ort: 'Berlin',
    etagen: 1, zutritt: null, raumbuch: [] },
  { bereich: 'security', kundenNummer: 'K-20001', nummer: 'OBJ-2001', geo: ['52.503100', '13.332400'],
    bezeichnung: 'Bürohaus Kurfürstendamm — Objektschutz', typ: 'Bürogebäude',
    strasse: 'Kurfürstendamm', hausnummer: '21', plz: '10719', ort: 'Berlin',
    etagen: 4, zutritt: 'Wachbuch im Empfang', raumbuch: [] },
  { bereich: 'bau', kundenNummer: 'K-30001', nummer: 'OBJ-3001', geo: ['52.487300', '13.321000'],
    bezeichnung: 'Dachgeschossausbau Wilmersdorf', typ: 'Baustelle',
    strasse: 'Berliner Straße', hausnummer: '48', plz: '10713', ort: 'Berlin',
    etagen: null, zutritt: 'Bauzaun Süd, Schlüssel bei der Bauleitung',
    raumbuch: [] },
];

/** Das Kundenkonto aus dem Seed bekommt Zugang zu GENAU EINEM Kunden. */
export const KUNDENZUGANG_NUMMER = 'K-10001';

export async function seedOperations(
  sql: Sql, ids: ReadonlyMap<string, string>, kundenKontoId: string | null,
  /**
   * Der Dateispeicher, WENN einer verbunden ist (V-131) — sonst `null`, und
   * die Unterlagen bleiben Metadaten ohne Datei, wie bisher.
   */
  speicher: Speicher | null = null,
): Promise<{
  objekte: number; raeume: number; belegschaftsdokumente: number; mitDatei: number;
}> {
  let mitDatei = 0;
  /**
   * Die Datei hinter einer Demounterlage — geschrieben bei JEDEM Lauf, auch
   * wenn die Zeile schon steht: ein Ordner, der nach dem ersten Lauf geleert
   * wurde, soll beim zweiten wieder passen.
   */
  const legeDatei = async (
    schluessel: string, titel: string, beschreibung: string,
  ): Promise<number | null> => {
    if (speicher === null) return null;
    const bytes = await demoPdf(titel, [beschreibung]);
    await speicher.lege('dokumente', schluessel, bytes);
    mitDatei += 1;
    return bytes.length;
  };
  const heute = new Date().toISOString().slice(0, 10);

  // --- Kataloge je Bereich (nur Reinigung braucht sie heute) ---------------
  const belagIds = new Map<string, string>();
  const klasseIds = new Map<string, string>();
  const reinigung = ids.get('reinigung');
  if (reinigung === undefined) throw new Error('Bereich reinigung fehlt');

  for (const [code, bezeichnung, wert] of BELAEGE) {
    const [da] = await sql<{ id: string }[]>`
      select id from belagsart where mandant_id = ${reinigung} and code = ${code} limit 1`;
    if (da !== undefined) { belagIds.set(code, da.id); continue; }
    const [neu] = await sql<{ id: string }[]>`
      insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                             quelle, ist_platzhalter, gueltig_ab)
      values (${reinigung}, ${code}, ${bezeichnung}, ${wert},
              'Branchenübliche Größenordnung — nicht bestätigt (O-17)', true, ${heute})
      returning id`;
    belagIds.set(code, neu!.id);
  }

  for (const [code, bezeichnung, sortierung] of KLASSEN) {
    const [da] = await sql<{ id: string }[]>`
      select id from reinigungsklasse
       where mandant_id = ${reinigung} and code = ${code} and archiviert_am is null limit 1`;
    if (da !== undefined) { klasseIds.set(code, da.id); continue; }
    const [neu] = await sql<{ id: string }[]>`
      insert into reinigungsklasse (mandant_id, code, bezeichnung, sortierung, ist_platzhalter)
      values (${reinigung}, ${code}, ${bezeichnung}, ${sortierung}, true)
      returning id`;
    klasseIds.set(code, neu!.id);
  }

  // --- Firmen, Kunden, Ansprechpartner ------------------------------------
  const kundenIds = new Map<string, string>();
  for (const k of KUNDEN) {
    const mandant = ids.get(k.bereich);
    if (mandant === undefined) continue;

    /**
     * Die Firma ist die GETEILTE Identitaet: dieselbe Hausverwaltung ist
     * Kundin der Reinigung UND der Security, und beide zeigen auf DIESELBE
     * `firma`-Zeile. Genau das macht spaeter eine Gruppensicht moeglich, die
     * "unser gemeinsamer Kunde" sagen kann.
     *
     * Warum hier nicht `app.firma_aufloesen`: die Funktion verlangt
     * `crm.schreiben` im aktiven Mandanten — sie ist der Weg fuer eine
     * BENUTZERSITZUNG. Der Seed laeuft als Eigentuemer ohne Sitzung, also
     * ohne Rolle, deren Recht zu pruefen waere; er legt die Zeile so an, wie
     * eine Migration es taete, und uebernimmt dieselbe Regel von Hand: EINE
     * Zeile je (Name, Land).
     */
    const [firmaDa] = await sql<{ id: string }[]>`
      select id from firma where name = ${k.firma} and land = 'DE' limit 1`;
    const firma = firmaDa ?? (await sql<{ id: string }[]>`
      insert into firma (name, rechtsform, land) values (${k.firma}, ${k.rechtsform}, 'DE')
      returning id`)[0];

    const [vorhanden] = await sql<{ id: string }[]>`
      select id from kunde where mandant_id = ${mandant} and kundennummer = ${k.nummer} limit 1`;
    let kundeId = vorhanden?.id;
    if (kundeId === undefined) {
      const [neu] = await sql<{ id: string }[]>`
        insert into kunde (mandant_id, firma_id, kundennummer, typ, name, rechtsform,
                           strasse, hausnummer, plz, ort,
                           ist_oeffentlicher_auftraggeber, xrechnung_pflicht, leitweg_id,
                           elektronische_adresse, elektronische_adresse_schema,
                           rechtsgrundlage, rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am,
                           status)
        values (${mandant}, ${firma!.id}, ${k.nummer},
                ${k.behoerde === undefined ? 'firma' : 'behoerde'},
                ${k.name}, ${k.rechtsform},
                ${k.anschrift[0]}, ${k.anschrift[1]}, ${k.anschrift[2]}, ${k.anschrift[3]},
                ${k.behoerde !== undefined}, ${k.behoerde !== undefined},
                ${k.behoerde?.leitwegId ?? null},
                ${k.behoerde?.eadresse ?? k.erechnung?.eadresse ?? null},
                ${k.behoerde?.eadresseSchema ?? k.erechnung?.eadresseSchema ?? null},
                'bestandskunde', 'Rahmenvertrag (Demodaten)', now(), 'aktiv')
        returning id`;
      kundeId = neu!.id;
    } else {
      /**
       * **Nachtragen, aber nur was fehlt.**
       *
       * Der Seed schreibt sonst nichts zurueck — wer eine Demozeile von Hand
       * korrigiert, soll sie behalten. Eine LEERE Anschrift ist aber keine
       * Korrektur, sondern die Luecke, an der §14 Abs. 4 Nr. 1 UStG scheitert:
       * eine bestehende Datenbank aus der Zeit vor diesem Commit bekaeme sonst
       * nie eine Anschrift und bliebe fuer immer ohne festschreibbare
       * Rechnung. `where ... is null` fasst nichts an, was jemand gesetzt hat.
       */
      await sql`
        update kunde
           set strasse = coalesce(strasse, ${k.anschrift[0]}),
               hausnummer = coalesce(hausnummer, ${k.anschrift[1]}),
               plz = coalesce(plz, ${k.anschrift[2]}),
               ort = coalesce(ort, ${k.anschrift[3]})
         where id = ${kundeId}
           and (strasse is null or plz is null or ort is null)`;
      /*
       * Dieselbe Ueberlegung fuer die FIN-11-Felder: eine Datenbank aus der
       * Zeit vor diesem Commit hat den Behoerdenkunden ohne Leitweg-ID, und
       * ohne sie bleibt die XRechnung in den Demodaten unerreichbar. Wieder
       * nur, WAS FEHLT — eine von Hand gesetzte Kennung bleibt stehen.
       */
      if (k.behoerde !== undefined) {
        await sql`
          update kunde
             set typ = 'behoerde',
                 ist_oeffentlicher_auftraggeber = true,
                 xrechnung_pflicht = true,
                 leitweg_id = coalesce(leitweg_id, ${k.behoerde.leitwegId}),
                 elektronische_adresse =
                   coalesce(elektronische_adresse, ${k.behoerde.eadresse}),
                 elektronische_adresse_schema =
                   coalesce(elektronische_adresse_schema, ${k.behoerde.eadresseSchema})
           where id = ${kundeId}
             and (leitweg_id is null or elektronische_adresse is null)`;
      }
      /*
       * Dieselbe Nachtragslogik wie eine Zeile hoeher, fuer den privaten
       * Auftraggeber mit Portalzugang: nur WAS FEHLT, eine von Hand gesetzte
       * Angabe bleibt stehen.
       */
      if (k.erechnung !== undefined) {
        await sql`
          update kunde
             set kaeufer_referenz = coalesce(kaeufer_referenz, ${k.erechnung.kaeuferReferenz}),
                 elektronische_adresse =
                   coalesce(elektronische_adresse, ${k.erechnung.eadresse}),
                 elektronische_adresse_schema =
                   coalesce(elektronische_adresse_schema, ${k.erechnung.eadresseSchema})
           where id = ${kundeId}
             and (kaeufer_referenz is null or elektronische_adresse is null
                  or elektronische_adresse_schema is null)`;
      }
    }
    if (k.erechnung !== undefined) {
      /*
       * `kaeufer_referenz` steht NICHT in der `insert`-Spaltenliste oben (die
       * ist die der Anlage, und die Referenz ist eine Angabe des Kunden, die
       * nachgereicht wird). Fuer den frisch angelegten Fall wird sie hier
       * gesetzt — dieselbe Anweisung deckt beide Wege ab.
       */
      await sql`
        update kunde set kaeufer_referenz = ${k.erechnung.kaeuferReferenz}
         where id = ${kundeId} and kaeufer_referenz is null`;
    }
    kundenIds.set(k.nummer, kundeId);

    const [vorname, nachname, email] = k.kontakt;
    const [kontaktDa] = await sql<{ id: string }[]>`
      select id from ansprechpartner
       where mandant_id = ${mandant} and kunde_id = ${kundeId} and email = ${email} limit 1`;
    if (kontaktDa === undefined) {
      /**
       * `rechtsgrundlage = 'bestandskunde'` und KEINE Einwilligungskanaele:
       * das Tor nach § 7 UWG laesst damit die Bestandskundenwerbung per
       * E-Mail zu und alles andere nicht. Ein Demodatensatz mit
       * `einwilligung` waere eine erfundene Einwilligung.
       */
      await sql`
        insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, email,
                                     rechtsgrundlage, rechtsgrundlage_quelle,
                                     rechtsgrundlage_erfasst_am)
        values (${mandant}, ${kundeId}, ${vorname}, ${nachname}, ${email},
                'bestandskunde', 'Rahmenvertrag (Demodaten)', now())`;
    }
  }

  // --- Kundenzugang: EIN Konto, EIN Kunde ----------------------------------
  const zugangKunde = kundenIds.get(KUNDENZUGANG_NUMMER);
  if (kundenKontoId !== null && zugangKunde !== undefined && reinigung !== undefined) {
    const [da] = await sql<{ id: string }[]>`
      select id from kunde_zugang
       where benutzer_id = ${kundenKontoId} and mandant_id = ${reinigung}
         and entzogen_am is null limit 1`;
    if (da === undefined) {
      await sql`
        insert into kunde_zugang (mandant_id, kunde_id, benutzer_id)
        values (${reinigung}, ${zugangKunde}, ${kundenKontoId})`;
    }
  }

  // --- Objekte und Raumbuecher ---------------------------------------------
  let objekte = 0;
  let raeume = 0;
  /** Die der Belegschaft freigegebenen Unterlagen (EMP-11, DOC-04). */
  let belegschaftsdokumente = 0;
  for (const o of OBJEKTE) {
    const mandant = ids.get(o.bereich);
    if (mandant === undefined) continue;
    const kundeId = o.kundenNummer === null ? null : kundenIds.get(o.kundenNummer) ?? null;

    const [vorhanden] = await sql<{ id: string }[]>`
      select id from objekt
       where mandant_id = ${mandant} and objektnummer = ${o.nummer}
         and archiviert_am is null limit 1`;
    let objektId = vorhanden?.id;
    if (objektId === undefined) {
      const [neu] = await sql<{ id: string }[]>`
        insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, gebaeudetyp,
                            strasse, hausnummer, plz, ort, etagen_anzahl, zutritt_hinweis,
                            geo_lat, geo_lon)
        values (${mandant}, ${kundeId}, ${o.nummer}, ${o.bezeichnung}, ${o.typ},
                ${o.strasse}, ${o.hausnummer}, ${o.plz}, ${o.ort},
                ${o.etagen}, ${o.zutritt},
                ${o.geo[0]}::numeric(9,6), ${o.geo[1]}::numeric(9,6))
        returning id`;
      objektId = neu!.id;
    } else {
      /*
       * Ein Bestand aus einem Seed VOR V-170 bekommt seine Koordinaten nach —
       * aber nur, wo keine stehen: was ein Mensch eingetragen hat, gewinnt.
       */
      await sql`
        update objekt set geo_lat = ${o.geo[0]}::numeric(9,6),
                          geo_lon = ${o.geo[1]}::numeric(9,6)
         where id = ${objektId} and geo_lat is null and geo_lon is null`;
    }
    objekte += 1;

    for (const [i, r] of o.raumbuch.entries()) {
      // Der Quellschluessel macht den Import idempotent — und diesen Seed auch.
      const quelle = `seed:${o.nummer}:${String(i)}`;
      const [da] = await sql<{ id: string }[]>`
        select id from raum where objekt_id = ${objektId} and quell_schluessel = ${quelle} limit 1`;
      if (da !== undefined) { raeume += 1; continue; }
      await sql`
        insert into raum (mandant_id, objekt_id, raumnummer, bezeichnung, etage,
                          flaeche_qm, fenster_flaeche_qm, belagsart_id, reinigungsklasse_id,
                          quell_schluessel, sortierung)
        values (${mandant}, ${objektId}, ${r.nummer}, ${r.bezeichnung}, ${r.etage},
                ${r.flaeche}, ${r.fenster ?? null},
                ${belagIds.get(r.belag) ?? null}, ${klasseIds.get(r.klasse) ?? null},
                ${quelle}, ${i})`;
      raeume += 1;
    }

    /**
     * --- Der Ansprechpartner VOR ORT (EMP-02, OPS-01) ---------------------
     *
     * `objekt.ansprechpartner_id` blieb bisher leer, und damit zeigte
     * `/portal/mein/objekte/[id]` genau das, was `app.mein_objekt_zugang`
     * herausgibt: nichts. Eine Seite, deren Demodaten ihr Hauptfeld nie
     * fuellen, ist eine, die niemand beim Ausprobieren pruefen kann.
     *
     * Die Telefonnummer stammt aus dem Bereich **030 23125 xx**, den die
     * Bundesnetzagentur fuer Film und Demonstration reserviert hat — sie
     * gehoert garantiert niemandem. Eine erfundene Nummer aus dem echten
     * Nummernraum klingelte bei einem Menschen, der nichts damit zu tun hat.
     */
    if (kundeId !== null) {
      await sql`
        update objekt o set ansprechpartner_id = ap.id
          from (select id from ansprechpartner
                 where mandant_id = ${mandant} and kunde_id = ${kundeId}
                   and archiviert_am is null and ausgeschieden_am is null
                   and anonymisiert_am is null
                 order by ist_hauptkontakt desc, nachname limit 1) ap
         where o.id = ${objektId} and o.ansprechpartner_id is null`;
      await sql`
        update ansprechpartner set telefon = '+49 30 23125 174'
         where id = (select ansprechpartner_id from objekt where id = ${objektId})
           and telefon is null`;
    }

    /**
     * --- Eine der Belegschaft freigegebene Unterlage (EMP-11, DOC-04) -----
     *
     * `sichtbar_fuer_mitarbeiter` ist `default false` und wird nur durch eine
     * Handlung wahr. Ohne diese Zeile bleibt `/portal/mein/dokumente` in jeder
     * Demodatenbank leer — und eine leere Liste beweist nicht, dass die
     * Decke richtig sitzt, sondern nur, dass nichts da ist (K-18).
     *
     * **Eine Datei nur, wenn ein Speicher da ist.** `dokument` haelt die
     * Metadaten, die Bytes liegen im privaten Bucket. Ohne Speicher legt der
     * Seed die Zeile an und nichts sonst; mit dem Vorfuehrspeicher (V-131)
     * liegt ein als DEMODATEN beschriftetes Blatt dahinter (`demoPdf`). Einen
     * Abruf behauptet er in keinem Fall: `dokument_zugriff` entsteht beim
     * ECHTEN Abruf ueber die signierte Adresse (CLAUDE.md, „No fake
     * integrations").
     */
    const belegschaftsTitel = `Betriebsanweisung ${o.bezeichnung} (Demodaten)`;
    const belegschaftsText =
      'Aushang für die eingesetzten Kräfte: Zutritt, Meldewege, Notfallnummern.';
    const belegschaftsSchluessel = `demo/betriebsanweisung/${o.nummer}.pdf`;
    const belegschaftsGroesse = await legeDatei(
      belegschaftsSchluessel, belegschaftsTitel, belegschaftsText);
    const [dokDa] = await sql<{ id: string }[]>`
      select id from dokument
       where mandant_id = ${mandant} and titel = ${belegschaftsTitel}
         and geloescht_am is null limit 1`;
    if (dokDa === undefined) {
      await sql`
        insert into dokument
          (mandant_id, kategorie, titel, beschreibung, objekt_id,
           bucket, objekt_schluessel, mime_typ, mime_verifiziert, groesse_bytes,
           exif_entfernt, sichtbar_fuer_kunde, sichtbar_fuer_mitarbeiter,
           entstanden_am)
        values (${mandant}, 'unternehmen', ${belegschaftsTitel},
                ${belegschaftsText},
                ${objektId},
                'dokumente', ${belegschaftsSchluessel},
                'application/pdf', true, ${belegschaftsGroesse ?? 43008}, true, false, true,
                current_date)`;
      belegschaftsdokumente += 1;
    }
  }

  /**
   * Und eine Unterlage OHNE Objektbezug je Gesellschaft.
   *
   * Sie prueft den anderen Weg derselben Seite: `dokument.objekt_id` ist
   * nullbar, und die Liste liest ueber `left join objekt` — ein `join` liesse
   * genau diese Zeile verschwinden, still und ohne Fehler.
   */
  for (const bereich of ['reinigung', 'security', 'bau'] as const) {
    const mandant = ids.get(bereich);
    if (mandant === undefined) continue;
    const titel = 'Notfallnummern und Meldewege (Demodaten)';
    const text = 'Wen rufe ich wann an — Einsatzleitung, Notdienst, Polizei.';
    const schluessel = `demo/notfallnummern/${bereich}.pdf`;
    const groesse = await legeDatei(schluessel, titel, text);
    const [da] = await sql<{ id: string }[]>`
      select id from dokument
       where mandant_id = ${mandant} and titel = ${titel}
         and geloescht_am is null limit 1`;
    if (da !== undefined) continue;
    await sql`
      insert into dokument
        (mandant_id, kategorie, titel, beschreibung,
         bucket, objekt_schluessel, mime_typ, mime_verifiziert, groesse_bytes,
         exif_entfernt, sichtbar_fuer_kunde, sichtbar_fuer_mitarbeiter,
         entstanden_am)
      values (${mandant}, 'unternehmen', ${titel},
              ${text},
              'dokumente', ${schluessel},
              'application/pdf', true, ${groesse ?? 18432}, true, false, true,
              current_date)`;
    belegschaftsdokumente += 1;
  }

  // --- Zwei Anfragen im Posteingang ---------------------------------------
  /**
   * Ohne einen Lead ist der Posteingang eine leere Liste, und eine leere
   * Liste zeigt nicht, ob sie richtig sortiert. Der eine hat eine
   * ueberschrittene Frist und KEINEN naechsten Schritt — genau der Fall, den
   * die Oberflaeche benennen muss, weil er sonst still liegen bleibt.
   */
  /**
   * Der Besitzer ist ein MENSCH mit `crm.schreiben` — nicht der erste Eintrag
   * der Tabelle.
   *
   * Die Abfrage nahm den zuerst angelegten Benutzer der Gesellschaft, und das
   * war seit dem Tag, an dem es Dienstprinzipale gibt, der
   * WEBSITE-RENDERER: er entsteht in `index.ts` vor allen Rollenkonten und
   * bekommt eine `benutzer_mandant`-Zeile in jedem Bereich. Beide Demoleads
   * standen damit auf einem Konto, das `oeffentlich.lesen` haelt, mit
   * `app.readonly = 'on'` laeuft und keinen Lead je oeffnen koennte — der
   * Posteingang zeigte „Website-Renderer" als Zustaendigen, und die
   * SLA-Eskalation zielte auf ein Dienstkonto. Ein Lead ohne erreichbaren
   * Menschen bleibt genau so lange liegen, wie die Frist braucht.
   *
   * `ist_dienstkonto` steht zusaetzlich zum Recht in der Bedingung, denn der
   * Formular-Eingang haelt `crm.schreiben` mit Absicht: er nimmt Anfragen an.
   * Zustaendig ist er deshalb fuer keine.
   */
  const [besitzer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
      join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel = 'crm.schreiben'
       and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
     order by b.email limit 1`;

  if (besitzer !== undefined) {
    /**
     * Der letzte Wert ist die SLA-Frist in Stunden ab jetzt — negativ heisst
     * vorbei.
     *
     * „Der eine hat eine ueberschrittene Frist" war frueher „beide": die
     * Anweisung setzte fest `now() - interval '2 hours'`, also fuer jeden Lead
     * eine Frist in der Vergangenheit. Die Leadliste markiert
     * `frist_ueberschritten` und sortiert danach — in einem Posteingang, in
     * dem ALLES rot ist, sagt die Markierung nichts mehr und die Sortierung
     * hat nichts zu zeigen. Die Frist gehoert deshalb zum Lead und nicht in
     * die Anweisung.
     */
    const leads: readonly (
      readonly [string, string, string, string, string, number | null, number])[] = [
      /**
       * BEIDE `manuell`, und das ist keine Bequemlichkeit: ein Lead mit
       * `quelle = 'webformular'` verlangt einen echten `formular_eingang`
       * (CHECK `lead_herkunft_stimmig`). Einen zu erfinden hiesse, eine
       * Anfrage zu behaupten, die niemand gestellt hat — die Herkunft eines
       * Leads ist genau das, was REQ-07 und REP-03 auswerten. Wer einen
       * Webformular-Lead sehen will, schickt das Angebotsformular ab.
       */
      // Der liegengebliebene: Frist vorbei, niemand hat reagiert.
      ['L-2026-0001', 'Unterhaltsreinigung Buerohaus, 3 Etagen',
       'Telefonisch aufgenommen: rund 470 m² Bueroflaeche, 5x woechentlich, '
       + 'Start zum Quartalsbeginn.', 'manuell', 'neu', 240000, -2],
      // Und der Normalfall daneben — sonst waere „rot" keine Aussage.
      ['L-2026-0002', 'Glasreinigung halbjaehrlich',
       'Telefonisch: Fensterfront Erdgeschoss, zweimal im Jahr.',
       'manuell', 'in_bearbeitung', 85000, 20],
    ];
    for (const [nummer, betreff, bedarf, quelle, status, wert, fristStunden] of leads) {
      const [da] = await sql<{ id: string }[]>`
        select id from lead where mandant_id = ${reinigung} and leadnummer = ${nummer} limit 1`;
      if (da !== undefined) continue;
      await sql`
        insert into lead (mandant_id, leadnummer, quelle, betreff, bedarf_zusammenfassung,
                          status, prioritaet, besitzer_benutzer_id, firma_name,
                          geschaetzter_wert_cent, sla_frist_am, punktzahl,
                          punktzahl_begruendung)
        values (${reinigung}, ${nummer}, ${quelle}::lead_quelle, ${betreff}, ${bedarf},
                ${status}::lead_status, 'hoch'::lead_prioritaet, ${besitzer.id},
                'Berliner Hausverwaltung GmbH', ${wert},
                now() + make_interval(hours => ${fristStunden}::int), 72,
                'Platzhalter: Flaeche und Frequenz bekannt, Budget unbestaetigt (O-73)')`;
    }
  }

  return { objekte, raeume, belegschaftsdokumente, mitDatei };
}
