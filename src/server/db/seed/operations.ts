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
  readonly rechtsform: string;
  readonly nummer: string;
  readonly name: string;
  readonly kontakt: readonly [string, string, string];
}

const KUNDEN: readonly KundeVorgabe[] = [
  { bereich: 'reinigung', firma: 'Berliner Hausverwaltung GmbH', rechtsform: 'GmbH',
    nummer: 'K-10001', name: 'Berliner Hausverwaltung GmbH',
    kontakt: ['Anna', 'Radtke', 'a.radtke@bhv-berlin.example'] },
  { bereich: 'reinigung', firma: 'Charlottenburg Immobilien GmbH', rechtsform: 'GmbH',
    nummer: 'K-10002', name: 'Charlottenburg Immobilien GmbH',
    kontakt: ['Jens', 'Petrow', 'j.petrow@chb-immo.example'] },
  { bereich: 'security', firma: 'Berliner Hausverwaltung GmbH', rechtsform: 'GmbH',
    nummer: 'K-20001', name: 'Berliner Hausverwaltung GmbH',
    kontakt: ['Anna', 'Radtke', 'a.radtke@bhv-berlin.example'] },
  { bereich: 'bau', firma: 'Charlottenburg Immobilien GmbH', rechtsform: 'GmbH',
    nummer: 'K-30001', name: 'Charlottenburg Immobilien GmbH',
    kontakt: ['Jens', 'Petrow', 'j.petrow@chb-immo.example'] },
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
}

const OBJEKTE: readonly ObjektVorgabe[] = [
  { bereich: 'reinigung', kundenNummer: 'K-10001', nummer: 'OBJ-1001',
    bezeichnung: 'Bürohaus Kurfürstendamm', typ: 'Bürogebäude',
    strasse: 'Kurfürstendamm', hausnummer: '21', plz: '10719', ort: 'Berlin',
    etagen: 4, zutritt: 'Schlüsselkasten Hintereingang, Code beim Objektleiter',
    raumbuch: RAUMBUCH_BUEROHAUS },
  { bereich: 'reinigung', kundenNummer: 'K-10002', nummer: 'OBJ-1002',
    bezeichnung: 'Ärztehaus Wilmersdorf', typ: 'Praxis',
    strasse: 'Berliner Straße', hausnummer: '48', plz: '10713', ort: 'Berlin',
    etagen: 1, zutritt: 'Zugang nur nach Praxisschluss ab 19:00',
    raumbuch: RAUMBUCH_AERZTEHAUS },
  { bereich: 'reinigung', kundenNummer: null, nummer: 'OBJ-1003',
    bezeichnung: 'Veranstaltungshalle Tempelhof', typ: 'Veranstaltungsort',
    strasse: 'Columbiadamm', hausnummer: '10', plz: '10965', ort: 'Berlin',
    etagen: 1, zutritt: null, raumbuch: [] },
  { bereich: 'security', kundenNummer: 'K-20001', nummer: 'OBJ-2001',
    bezeichnung: 'Bürohaus Kurfürstendamm — Objektschutz', typ: 'Bürogebäude',
    strasse: 'Kurfürstendamm', hausnummer: '21', plz: '10719', ort: 'Berlin',
    etagen: 4, zutritt: 'Wachbuch im Empfang', raumbuch: [] },
  { bereich: 'bau', kundenNummer: 'K-30001', nummer: 'OBJ-3001',
    bezeichnung: 'Dachgeschossausbau Wilmersdorf', typ: 'Baustelle',
    strasse: 'Berliner Straße', hausnummer: '48', plz: '10713', ort: 'Berlin',
    etagen: null, zutritt: 'Bauzaun Süd, Schlüssel bei der Bauleitung',
    raumbuch: [] },
];

/** Das Kundenkonto aus dem Seed bekommt Zugang zu GENAU EINEM Kunden. */
export const KUNDENZUGANG_NUMMER = 'K-10001';

export async function seedOperations(
  sql: Sql, ids: ReadonlyMap<string, string>, kundenKontoId: string | null,
): Promise<{ objekte: number; raeume: number }> {
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
                           rechtsgrundlage, rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am,
                           status)
        values (${mandant}, ${firma!.id}, ${k.nummer}, 'firma', ${k.name}, ${k.rechtsform},
                'bestandskunde', 'Rahmenvertrag (Demodaten)', now(), 'aktiv')
        returning id`;
      kundeId = neu!.id;
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
                            strasse, hausnummer, plz, ort, etagen_anzahl, zutritt_hinweis)
        values (${mandant}, ${kundeId}, ${o.nummer}, ${o.bezeichnung}, ${o.typ},
                ${o.strasse}, ${o.hausnummer}, ${o.plz}, ${o.ort},
                ${o.etagen}, ${o.zutritt})
        returning id`;
      objektId = neu!.id;
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

  return { objekte, raeume };
}
