/**
 * Der Rechnungsdienst (FIN-02, FIN-03, FIN-06, LEG-01, Invarianten 1, 4, 8).
 *
 * `05-FINANZEN.md` §4, §5.6. Vier Uebergaenge, und die Reihenfolge in
 * `finalisiere()` ist der ganze Dienst:
 *
 *   1. Die Rechnung SPERREN. Ab hier aendert sich nichts mehr unter uns.
 *   2. Die Vorabpruefung — in TypeScript, INNERHALB derselben Transaktion und
 *      hinter der Sperre. Davor gelaufen, koennte eine gleichzeitige
 *      Bearbeitung zwischen Pruefung und Sperre eine Rechnung festschreiben,
 *      die §14 UStG nicht erfuellt.
 *   3. Definer-Aufruf A: Kreis aufloesen, sperren, Nummer ziehen, Kopf
 *      stempeln.
 *   4. Die kanonische Nutzlast bauen — HIER, weil sie `nummer` und
 *      `kette_position` enthaelt und deshalb vorher nicht existieren kann.
 *   5. Definer-Aufruf B: Snapshot ablegen, beide Digests in der DATENBANK
 *      rechnen, Kettenkopf fortschreiben.
 *
 * **Beide Definer-Aufrufe laufen in DERSELBEN Transaktion.** Die Sperre auf
 * dem Nummernkreis aus Schritt 3 haelt bis zum COMMIT — also sind
 * Nummernfolge und Kettenreihenfolge dieselbe Reihenfolge. Zoege die
 * Anwendung selbst (als `cse_app`), traefe der UPDATE unter FORCE RLS keine
 * Policy, beruehrte null Zeilen und schriebe geraeuschlos nichts fest.
 *
 * **Was dieser Dienst NICHT tut:** rechnen. Die Umsatzsteuer kommt aus
 * `steuer/satz.ts`, je Steuergruppe und nie aus einer Bruttosumme
 * (Invariante 1); Betraege sind `bigint` Cent.
 */
import { addiere, cent, negiere, type Cent } from './geld.js';
import { mengeAusPostgres, mengeNachPostgres, milliMenge, type MilliMenge } from './menge.js';
import { berechneSteuer, type SteuerZeile } from './steuer/satz.js';
import {
  buildKanonischePayload, SCHEMA_VERSION,
  type Position, type RechnungVollstaendig, type Steuerzeile, type Zuschlag,
} from './kanonisch.js';

/** Derselbe schmale Treiberausschnitt, den jeder Dienst hier benutzt. */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class RechnungFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund:
      | 'nicht_gefunden'
      | 'kein_entwurf'
      | 'nicht_festgeschrieben'
      | 'ohne_positionen'
      | 'kein_zahlungsziel'
      | 'kein_kreis'
      | 'schon_storniert'
      | 'unbekannte_einheit'
      | 'unbekannte_steuergruppe'
      | 'mehrdeutige_steuergruppe'
      | 'basismenge_ungueltig'
      | 'kopf_nicht_uebernehmbar'
      | 'leistungszeitpunkt_fehlt',
  ) {
    super(nachricht);
    this.name = 'RechnungFehler';
  }
}

/**
 * Der Pflichtfeldbericht, den PR 46 ablegt.
 *
 * **Er behauptet nichts.** Die §14-UStG-Vorabpruefung kommt mit PR 47; hier
 * einen leeren Befund „keine Fehler" abzulegen hiesse, im Snapshot zu
 * bezeugen, dass geprueft wurde. `geprueft: false` ist die Wahrheit, und der
 * Snapshot traegt sie mit, damit ein Pruefer spaeter sehen kann, welche
 * Belege vor dem Validator entstanden sind.
 */
export const REGELWERK_VERSION = 'ustg14-nicht-gebaut' as const;

function offenerBericht(): Record<string, unknown> {
  return {
    geprueft: false,
    regelwerk_version: REGELWERK_VERSION,
    grund: 'Die §14-UStG-Vorabpruefung wird mit PR 47 gebaut (FIN-04).',
    fehler: [],
    warnungen: [],
  };
}

// ---------------------------------------------------------------------------
// Entwurf anlegen und bestuecken
// ---------------------------------------------------------------------------

export interface EntwurfAnlegen {
  readonly kundeId: string;
  readonly objektId?: string | null;
  readonly auftragId?: string | null;
  readonly rechnungsart?: 'standard' | 'abschlag' | 'anzahlung' | 'schluss';
  readonly leistungVon?: string | null;
  readonly leistungBis?: string | null;
  readonly zahlungszielTage?: number | null;
  readonly kopftext?: string | null;
  readonly fusstext?: string | null;
}

/**
 * `zahlungsziel_tage` hat KEINEN Default (§4.2) — ein `14` waere ein
 * Produktionswert, der auf jeder Rechnung `faellig_am` setzt und damit den
 * Mahnlauf und die §288-BGB-Zinsen treibt.
 *
 * Aufgeloest wird in der Reihenfolge des §4.2, und jede Stufe, die es nicht
 * gibt, ist hier benannt statt weggelassen:
 *
 *  1. `vertrag_abrechnung.zahlungsziel_tage` — die Tabelle kommt mit PR 48.
 *     // TODO(client, O-04): Die fuenf Abrechnungsarten und ihre Parameter;
 *     erst mit ihnen gibt es eine Vertragsabrechnung, aus der ein
 *     Zahlungsziel kaeme.
 *  2. `kunde.zahlungsziel_tage` — spaltenweise entzogen (K-05), also NUR
 *     ueber `app.zahlungskondition_lesen()`. Wer `crm_entgelt.lesen` nicht
 *     haelt, ueberspringt die Stufe, statt an ihr zu scheitern: das Recht
 *     schuetzt die Kondition, es soll nicht das Fakturieren verhindern.
 *  3. `app.einstellung('finanzen.zahlungsziel_tage_standard')` — gesaet als
 *     NULL (O-66).
 *
 * Sind alle drei NULL, gibt diese Funktion NULL zurueck und die
 * Festschreibung weist mit benanntem Grund ab. Geraten wird nichts.
 */
export async function ermittleZahlungsziel(
  db: Abfrage, kundeId: string,
): Promise<number | null> {
  const [recht] = await db.abfrage<{ darf: boolean }>(
    `select app.hat_recht('crm_entgelt.lesen', app.aktiver_mandant()) as darf`,
  );
  if (recht?.darf === true) {
    const [k] = await db.abfrage<{ zahlungsziel_tage: number | null }>(
      `select zahlungsziel_tage from app.zahlungskondition_lesen($1::uuid)`, [kundeId],
    );
    if (k?.zahlungsziel_tage != null) return k.zahlungsziel_tage;
  }

  /**
   * `#>> '{}'` und nicht `::text`. `app.einstellung` liefert `jsonb`, und
   * dessen Textform ist die JSON-Schreibweise: aus der Zahl `14` wird zwar
   * `'14'`, aus der Zeichenkette `"14"` aber `'"14"'` und aus JSON-`null` das
   * Wort `'null'` — beides scheitert am `::integer` mit einem rohen
   * Postgres-Syntaxfehler, und zwar beim ANLEGEN jedes Entwurfs, also fuer
   * jeden Fakturierenden der Gesellschaft gleichzeitig. Der Pfadoperator
   * holt den Skalar als Text heraus und gibt fuer JSON-`null` SQL-NULL
   * zurueck, was hier die richtige Antwort ist: „nicht gesetzt".
   */
  const [e] = await db.abfrage<{ tage: number | null }>(
    `select (app.einstellung('finanzen.zahlungsziel_tage_standard') #>> '{}')::integer as tage`,
  );
  return e?.tage ?? null;
}

export async function legeEntwurfAn(db: Abfrage, eingabe: EntwurfAnlegen): Promise<string> {
  const ziel = eingabe.zahlungszielTage ?? await ermittleZahlungsziel(db, eingabe.kundeId);

  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into rechnung (mandant_id, kunde_id, objekt_id, auftrag_id, rechnungsart,
                           leistung_von, leistung_bis, zahlungsziel_tage, kopftext, fusstext,
                           erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, $3, coalesce($4,'standard')::rechnungsart,
             $5::date, $6::date, $7, $8, $9, 'mensch', app.aktueller_benutzer())
     returning id`,
    [eingabe.kundeId, eingabe.objektId ?? null, eingabe.auftragId ?? null,
     eingabe.rechnungsart ?? null, eingabe.leistungVon ?? null, eingabe.leistungBis ?? null,
     ziel, eingabe.kopftext ?? null, eingabe.fusstext ?? null],
  );
  if (zeile === undefined) {
    throw new RechnungFehler('Der Entwurf wurde nicht angelegt', 'nicht_gefunden');
  }
  return zeile.id;
}

export interface PositionAnlegen {
  readonly rechnungId: string;
  readonly bezeichnung: string;
  readonly beschreibung?: string | null;
  /** In Tausendsteln (K-16): `25_000n` sind 25,000. */
  readonly menge: MilliMenge;
  /** Der Schluessel aus `masseinheit`, z. B. `h`, `m2`, `stk`. */
  readonly einheit: string;
  readonly einzelpreisCent: Cent;
  readonly rabattBp?: number;
  /** Der Schluessel aus `steuersatz_gruppe`, z. B. `ust_19`. */
  readonly steuergruppe: string;
  readonly preisBasismenge?: MilliMenge;
}

/**
 * Eine Leistungszeile — und der Preis wird HIER gerechnet, nicht uebergeben.
 *
 * `netto = runde(menge / basismenge × einzelpreis × (10000 − rabatt) / 10000)`,
 * ganzzahlig in Cent, halb aufgerundet. Die Rundungsregel steht an der Stelle,
 * an der gerundet wird (K-16).
 */
function berechneNetto(
  menge: MilliMenge, basismenge: MilliMenge, einzelpreis: Cent, rabattBp: number,
): Cent {
  if (basismenge <= 0n) {
    // `rp_basismenge_positiv` (0075) weist das ab — aber erst in der
    // Datenbank. Hier flog vorher ein rohes `RangeError: Division by zero`
    // aus einer Geldrechnung, ohne Rechnung, ohne Position, ohne Spalte im
    // Text. Der benannte Fehler nennt die Bedingung, die gemeint ist.
    throw new RechnungFehler(
      `Die Preisbasismenge muss positiv sein (rp_basismenge_positiv), ist aber `
      + `${basismenge.toString()}.`,
      'basismenge_ungueltig',
    );
  }
  const zaehler = menge * einzelpreis * BigInt(10_000 - rabattBp);
  const nenner = basismenge * 10_000n;
  const negativ = zaehler < 0n;
  const abs = negativ ? -zaehler : zaehler;
  const gerundet = (abs * 2n + nenner) / (nenner * 2n);
  return cent(negativ ? -gerundet : gerundet);
}

export async function fuegePositionHinzu(
  db: Abfrage, eingabe: PositionAnlegen,
): Promise<string> {
  const [einheit] = await db.abfrage<{ id: string }>(
    `select id from masseinheit where schluessel = $1`, [eingabe.einheit],
  );
  if (einheit === undefined) {
    // Nie einen Code erfinden und nie auf `C62` zurueckfallen (§3.2): eine
    // geratene BT-130 macht die XRechnung ungueltig oder falsch.
    throw new RechnungFehler(
      `Unbekannte Mengeneinheit „${eingabe.einheit}" — anzulegen unter Referenzdaten.`,
      'unbekannte_einheit',
    );
  }

  /**
   * Der Stichtag der Satzaufloesung ist das LEISTUNGSdatum, nicht der heutige
   * Tag.
   *
   * Vorher stand hier zweimal `app.berlin_heute()`. §13 Abs. 1 Nr. 1 UStG
   * knuepft die Steuer an den Zeitpunkt der LEISTUNG: eine im Januar
   * geschriebene Rechnung ueber eine Dezemberleistung schuldet den
   * Dezembersatz. Nach einer Satzaenderung haette jede Rechnung, die dem
   * Leistungsmonat hinterherlaeuft — und das tun sie alle —, den NEUEN Satz
   * getragen. Zu hoch ausgewiesene Umsatzsteuer schuldet man nach §14c Abs. 1
   * UStG trotzdem, und der Beleg ist nach dem Festschreiben nicht mehr
   * aenderbar: die Korrektur waere Storno plus Neuausstellung, jeweils an
   * jeden betroffenen Kunden.
   *
   * Massgeblich ist das ENDE des Leistungszeitraums — mit ihm ist die
   * Leistung ausgefuehrt. Fehlt der Zeitraum, weil es eine Abschlags- oder
   * Anzahlungsrechnung ist (§14 Abs. 4 Nr. 6 UStG), zaehlt der geplante
   * Vereinnahmungstag. Hat der Entwurf noch keines von beidem, bleibt der
   * heutige Tag: festschreiben laesst er sich ohnehin erst, wenn
   * `rechnung_leistungszeitpunkt` erfuellt ist.
   */
  const [kopf] = await db.abfrage<{ stichtag: string }>(
    `select to_char(coalesce(leistung_bis, leistung_von, vereinnahmung_geplant_am,
                             app.berlin_heute()), 'YYYY-MM-DD') as stichtag
       from rechnung where id = $1`,
    [eingabe.rechnungId],
  );
  if (kopf === undefined) {
    throw new RechnungFehler(
      `Rechnung ${eingabe.rechnungId} nicht gefunden`, 'nicht_gefunden',
    );
  }

  const [gruppe] = await db.abfrage<{ id: string; satz_bp: number; kategorie: string }>(
    `select id, satz_bp, kategorie::text as kategorie from steuersatz_gruppe
      where schluessel = $1
        and $2::date >= gueltig_von
        and (gueltig_bis is null or $2::date <= gueltig_bis)`,
    [eingabe.steuergruppe, kopf.stichtag],
  );
  if (gruppe === undefined) {
    throw new RechnungFehler(
      `Keine gueltige Steuersatzgruppe „${eingabe.steuergruppe}" am Leistungsdatum `
      + `${kopf.stichtag}.`,
      'unbekannte_steuergruppe',
    );
  }

  const basis = eingabe.preisBasismenge ?? milliMenge(1000n);
  const rabatt = eingabe.rabattBp ?? 0;
  const netto = berechneNetto(eingabe.menge, basis, eingabe.einzelpreisCent, rabatt);

  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into rechnungsposition
       (mandant_id, rechnung_id, position_nr, bezeichnung, beschreibung, menge, einheit,
        masseinheit_id, preis_basismenge, einzelpreis_cent, rabatt_bp, netto_cent,
        steuersatz_gruppe_id, satz_bp, kategorie, erstellt_von_art, erstellt_von)
     select app.aktiver_mandant(), $1,
            coalesce((select max(p.position_nr) from rechnungsposition p
                       where p.rechnung_id = $1), 0) + 1,
            $2, $3, $4::numeric, $5, $6::uuid, $7::numeric, $8::bigint, $9, $10::bigint,
            $11::uuid, $12, $13::en16931_steuerkategorie, 'mensch', app.aktueller_benutzer()
     returning id`,
    [eingabe.rechnungId, eingabe.bezeichnung, eingabe.beschreibung ?? null,
     mengeNachPostgres(eingabe.menge), eingabe.einheit, einheit.id,
     mengeNachPostgres(basis), eingabe.einzelpreisCent.toString(), rabatt, netto.toString(),
     gruppe.id, gruppe.satz_bp, gruppe.kategorie],
  );
  if (zeile === undefined) {
    throw new RechnungFehler('Die Position wurde nicht angelegt', 'nicht_gefunden');
  }

  await schreibeSummen(db, eingabe.rechnungId);
  return zeile.id;
}

interface PositionSumme {
  readonly steuersatz_gruppe_id: string;
  readonly schluessel: string;
  readonly satz_bp: number;
  readonly kategorie: string;
  readonly befreiungsgrund_code: string | null;
  readonly befreiungsgrund_text: string | null;
  readonly netto_cent: string;
}

/**
 * Die Steueraufschluesselung und die Kopfsummen — je Steuergruppe gerechnet,
 * nie aus einem Bruttobetrag (Invariante 1, §14 Abs. 4 Nr. 8 UStG).
 *
 * Geschrieben wird per UPSERT und nicht durch Loeschen und Neuanlegen: in
 * dieser Domaene gibt es keinen Hard Delete (Invariante 8). Eine Gruppe, die
 * nach einer Aenderung nicht mehr vorkommt, faellt auf `netto_cent = 0` und
 * damit aus jeder Summe heraus — sie verschwindet nicht, sie wird leer.
 */
export async function schreibeSummen(db: Abfrage, rechnungId: string): Promise<void> {
  const zeilen = await db.abfrage<PositionSumme>(
    `select g.id as steuersatz_gruppe_id, g.schluessel, p.satz_bp, p.kategorie::text as kategorie,
            g.befreiungsgrund_code, g.befreiungsgrund_text,
            sum(p.netto_cent)::text as netto_cent
       from rechnungsposition p
       join steuersatz_gruppe g on g.id = p.steuersatz_gruppe_id
      where p.rechnung_id = $1 and p.positionsart = 'leistung'
      group by g.id, g.schluessel, p.satz_bp, p.kategorie,
               g.befreiungsgrund_code, g.befreiungsgrund_text`,
    [rechnungId],
  );

  const zuschlaege = await db.abfrage<PositionSumme>(
    `select g.id as steuersatz_gruppe_id, g.schluessel, z.gruppe_satz_bp as satz_bp,
            z.gruppe_kategorie::text as kategorie,
            g.befreiungsgrund_code, g.befreiungsgrund_text,
            sum(case when z.art = 'zuschlag' then z.betrag_cent
                     else -z.betrag_cent end)::text as netto_cent
       from rechnung_zuschlag z
       join steuersatz_gruppe g on g.id = z.steuersatz_gruppe_id
      where z.rechnung_id = $1
      group by g.id, g.schluessel, z.gruppe_satz_bp, z.gruppe_kategorie,
               g.befreiungsgrund_code, g.befreiungsgrund_text`,
    [rechnungId],
  );

  const eingaben: SteuerZeile[] = [...zeilen, ...zuschlaege].map((z) => ({
    nettoCent: cent(BigInt(z.netto_cent)),
    gruppe: {
      schluessel: z.schluessel,
      satzBp: z.satz_bp as never,
      // Die EN-16931-Kategorie (BT-118), nicht das CRM-Kennzeichen: sie steht
      // so in `rechnung_steuer` und so in der Nutzlast (§4.5, §5.3).
      kategorie: z.kategorie,
      befreiungsgrundCode: z.befreiungsgrund_code,
      befreiungsgrundText: z.befreiungsgrund_text,
    },
  }));

  const ergebnis = berechneSteuer(eingaben);

  /**
   * Die Zuordnung Schluessel → `steuersatz_gruppe_id`, und warum sie hier
   * eine Pruefung ist statt einer Map.
   *
   * `berechneSteuer` fasst je SCHLUESSEL zusammen (`steuer/satz.ts`), die
   * Zeile in `rechnung_steuer` haengt aber an der GRUPPEN-ID — bis `0087`
   * war das dasselbe, denn `ssg_schluessel_uk` liess je Schluessel genau eine
   * Zeile zu. `0087` hat diese Bedingung fallen lassen, damit ein Satz eine
   * Geschichte haben kann: `ust_19` mit 19 % bis zum Stichtag und `ust_19`
   * mit dem neuen Satz danach. Ab der ersten Satzaenderung koennen die
   * Positionen EINES Entwurfs auf zwei datierte Zeilen desselben Schluessels
   * zeigen — die Map nahm dann stillschweigend die zuletzt gelesene Id,
   * schrieb beide Nettosummen unter EINE Gruppe und setzte die andere Zeile
   * gleich darauf auf 0. Die Aufschluesselung nach §14 Abs. 4 Nr. 8 UStG
   * wiese damit EINE datierte Gruppe fuer die Nettobetraege zweier Saetze aus,
   * auf einem Beleg, der nach dem Festschreiben unveraenderlich ist.
   *
   * Hier faellt das auf, statt sich zu verrechnen. Aufgeloest gehoert es an
   * der Wurzel — je Position am Leistungsdatum DER POSITION, nicht am
   * Kopfstichtag —, und das ist eine Aenderung an `steuer/satz.ts` und am
   * Einfuegepfad, nicht an dieser Schleife.
   */
  const idJeSchluessel = new Map<string, string>();
  for (const z of [...zeilen, ...zuschlaege]) {
    const vorhanden = idJeSchluessel.get(z.schluessel);
    if (vorhanden !== undefined && vorhanden !== z.steuersatz_gruppe_id) {
      throw new RechnungFehler(
        `Die Steuergruppe „${z.schluessel}" steht auf dieser Rechnung mit zwei `
        + 'datierten Zeilen (0087). Welcher Satz gilt, entscheidet das '
        + 'Leistungsdatum je Position — dieser Beleg muesste neu aufgeloest '
        + 'werden, bevor er eine Aufschluesselung nach §14 Abs. 4 Nr. 8 UStG '
        + 'tragen kann.',
        'mehrdeutige_steuergruppe',
      );
    }
    idJeSchluessel.set(z.schluessel, z.steuersatz_gruppe_id);
  }

  /** Die Gruppen, die diese Rechnung JETZT traegt — gesammelt beim Schreiben. */
  const geschrieben: string[] = [];

  for (const s of ergebnis.zeilen) {
    const gruppeId = idJeSchluessel.get(s.steuersatzGruppe);
    if (gruppeId === undefined) {
      // Unerreichbar: `berechneSteuer` gibt nur Schluessel zurueck, die es
      // bekommen hat. Aber ein `?? null` in der Liste unten machte aus
      // `not (x = any(array[…, null]))` ein NULL — und damit die
      // Nullsetzung geraeuschlos wirkungslos.
      throw new RechnungFehler(
        `Die Steuergruppe „${s.steuersatzGruppe}" hat keine Gruppen-Id.`,
        'unbekannte_steuergruppe',
      );
    }
    geschrieben.push(gruppeId);
    await db.abfrage(
      `insert into rechnung_steuer
         (mandant_id, rechnung_id, steuersatz_gruppe_id, satz_bp, kategorie,
          netto_cent, steuer_cent, befreiungsgrund_code, befreiungsgrund_text)
       values (app.aktiver_mandant(), $1, $2::uuid, $3, $4::en16931_steuerkategorie,
               $5::bigint, $6::bigint, $7, $8)
       on conflict (rechnung_id, steuersatz_gruppe_id) do update
         set satz_bp = excluded.satz_bp, kategorie = excluded.kategorie,
             netto_cent = excluded.netto_cent, steuer_cent = excluded.steuer_cent,
             befreiungsgrund_code = excluded.befreiungsgrund_code,
             befreiungsgrund_text = excluded.befreiungsgrund_text`,
      [rechnungId, gruppeId, s.satzBp, s.kategorie,
       s.nettoCent.toString(), s.steuerCent.toString(),
       s.befreiungsgrundCode, s.befreiungsgrundText],
    );
  }

  // Gruppen, die es nicht mehr gibt, auf null — nicht loeschen (Invariante 8).
  await db.abfrage(
    `update rechnung_steuer
        set netto_cent = 0, steuer_cent = 0
      where rechnung_id = $1
        and not (steuersatz_gruppe_id = any($2::uuid[]))
        and (netto_cent <> 0 or steuer_cent <> 0)`,
    [rechnungId, geschrieben],
  );

  await db.abfrage(
    `update rechnung
        set netto_gesamt_cent = $2::bigint,
            steuer_gesamt_cent = $3::bigint,
            brutto_cent = $4::bigint,
            zahlbetrag_cent = $4::bigint - abzug_brutto_cent
      where id = $1`,
    [rechnungId, ergebnis.nettoGesamtCent.toString(), ergebnis.steuerGesamtCent.toString(),
     ergebnis.bruttoCent.toString()],
  );
}

// ---------------------------------------------------------------------------
// Verwerfen (Invariante 8)
// ---------------------------------------------------------------------------

/**
 * Ein verworfener Entwurf wird NICHT geloescht. Er bekommt einen Zustand,
 * einen Zeitpunkt, einen Menschen und einen Grund — und ist danach ebenso
 * unveraenderlich wie eine festgeschriebene Rechnung.
 *
 * Weil er nie eine Nummer hatte, hinterlaesst er auch keine Luecke: der
 * Zaehler wird erst in der Festschreibungstransaktion beruehrt (§5.5).
 */
export async function verwerfe(
  db: Abfrage, rechnungId: string, grund: string,
): Promise<void> {
  if (grund.trim().length < 3) {
    throw new RechnungFehler('Ein Verwerfungsgrund ist Pflicht (GoBD)', 'kein_entwurf');
  }
  const betroffen = await db.abfrage<{ id: string }>(
    `update rechnung
        set status = 'verworfen', verworfen_am = now(),
            verworfen_von = app.aktueller_benutzer(), verworfen_grund = $2
      where id = $1 and status = 'entwurf'
      returning id`,
    [rechnungId, grund],
  );
  if (betroffen.length === 0) {
    throw new RechnungFehler(
      `Rechnung ${rechnungId} ist kein Entwurf — verworfen wird nur, was noch keine Nummer hat.`,
      'kein_entwurf',
    );
  }
}

// ---------------------------------------------------------------------------
// Laden — alles, was in die Nutzlast eingeht
// ---------------------------------------------------------------------------

interface KopfZeile {
  readonly id: string;
  readonly mandant_id: string;
  readonly nummernkreis_id: string;
  readonly nummer: string;
  readonly nummer_laufend: string;
  readonly rechnungsart: string;
  readonly rechnungsart_code: string;
  readonly rechnungsdatum: string;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
  readonly vereinnahmung_geplant_am: string | null;
  readonly sprache: string;
  readonly waehrung: string;
  readonly kopftext: string | null;
  readonly fusstext: string | null;
  readonly steuerhinweis: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly abzug_brutto_cent: string;
  readonly zahlbetrag_cent: string;
  readonly ueberweisungsbetrag_cent: string;
  readonly bauabzugsteuer_pflichtig: boolean;
  readonly bauabzugsteuer_satz_bp: number | null;
  readonly bauabzugsteuer_grundlage_cent: string | null;
  readonly einbehalt_bauabzugsteuer_cent: string;
  readonly ist_kleinbetrag: boolean;
  readonly reverse_charge: boolean;
  readonly reverse_charge_grundlage: string | null;
  readonly zahlungsmittel_code: string | null;
  readonly zahlungsbedingung_text: string | null;
  readonly zahlungsziel_tage: number | null;
  readonly faellig_am: string | null;
  readonly skonto_bp: number | null;
  readonly skonto_tage: number | null;
  readonly festgeschrieben_am: string;
  readonly festgeschrieben_von: string;
  readonly m_name: string;
  readonly m_rechtsform: string | null;
  readonly m_anschrift: string;
  readonly m_steuernummer: string | null;
  readonly m_ust_id: string | null;
  readonly m_gericht: string | null;
  readonly m_hrb: string | null;
  readonly m_geschaeftsfuehrer: string | null;
  readonly k_id: string;
  readonly k_name: string;
  readonly k_anschrift: string;
  readonly k_ust_id: string | null;
  readonly k_leitweg_id: string | null;
  readonly k_kaeufer_referenz: string | null;
  readonly bestellnummer_kunde: string | null;
  readonly verkaeufer_eadresse: string | null;
  readonly verkaeufer_eadresse_schema: string | null;
  readonly kaeufer_eadresse: string | null;
  readonly kaeufer_eadresse_schema: string | null;
  readonly o_id: string | null;
  readonly o_bezeichnung: string | null;
  readonly o_anschrift: string | null;
}

const KOPF_SQL = `
  select r.id, r.mandant_id, r.nummernkreis_id, r.nummer, r.nummer_laufend::text,
         r.rechnungsart::text as rechnungsart, r.rechnungsart_code,
         to_char(r.rechnungsdatum, 'YYYY-MM-DD') as rechnungsdatum,
         to_char(r.leistung_von, 'YYYY-MM-DD') as leistung_von,
         to_char(r.leistung_bis, 'YYYY-MM-DD') as leistung_bis,
         to_char(r.vereinnahmung_geplant_am, 'YYYY-MM-DD') as vereinnahmung_geplant_am,
         r.sprache, r.waehrung, r.kopftext, r.fusstext, r.steuerhinweis,
         r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text, r.brutto_cent::text,
         r.abzug_brutto_cent::text, r.zahlbetrag_cent::text, r.ueberweisungsbetrag_cent::text,
         r.bauabzugsteuer_pflichtig, r.bauabzugsteuer_satz_bp,
         r.bauabzugsteuer_grundlage_cent::text, r.einbehalt_bauabzugsteuer_cent::text,
         r.ist_kleinbetrag, r.reverse_charge,
         r.reverse_charge_grundlage::text as reverse_charge_grundlage,
         r.zahlungsmittel_code, r.zahlungsbedingung_text, r.zahlungsziel_tage,
         to_char(r.faellig_am, 'YYYY-MM-DD') as faellig_am, r.skonto_bp, r.skonto_tage,
         to_char(r.festgeschrieben_am at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as festgeschrieben_am,
         r.festgeschrieben_von::text as festgeschrieben_von,
         r.bestellnummer_kunde, r.verkaeufer_eadresse, r.verkaeufer_eadresse_schema,
         r.kaeufer_eadresse, r.kaeufer_eadresse_schema,
         m.firma as m_name, m.rechtsform as m_rechtsform,
         concat_ws(', ', m.strasse, concat_ws(' ', m.plz, m.ort), m.land) as m_anschrift,
         m.steuernummer as m_steuernummer, m.ust_id as m_ust_id,
         m.handelsregister_gericht as m_gericht, m.handelsregister_nummer as m_hrb,
         nullif(array_to_string(m.geschaeftsfuehrer, ', '), '') as m_geschaeftsfuehrer,
         k.id::text as k_id,
         coalesce(nullif(k.rechnung_name, ''), k.name) as k_name,
         case when k.rechnungsadresse_abweichend
              then concat_ws(', ', concat_ws(' ', k.rechnung_strasse, k.rechnung_hausnummer),
                             concat_ws(' ', k.rechnung_plz, k.rechnung_ort),
                             coalesce(k.rechnung_land, k.land))
              else concat_ws(', ', concat_ws(' ', k.strasse, k.hausnummer),
                             concat_ws(' ', k.plz, k.ort), k.land)
         end as k_anschrift,
         k.ust_id as k_ust_id, k.leitweg_id as k_leitweg_id,
         k.kaeufer_referenz as k_kaeufer_referenz,
         o.id::text as o_id, o.bezeichnung as o_bezeichnung,
         concat_ws(', ', concat_ws(' ', o.strasse, o.hausnummer),
                   concat_ws(' ', o.plz, o.ort), o.land) as o_anschrift
    from rechnung r
    join mandant m on m.id = r.mandant_id
    join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
    left join objekt o on o.mandant_id = r.mandant_id and o.id = r.objekt_id
   where r.id = $1`;

interface PositionZeile {
  readonly position_nr: number;
  readonly positionsart: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly unece_code: string | null;
  readonly preis_basismenge: string;
  readonly einzelpreis_cent: string | null;
  readonly rabatt_bp: number;
  readonly netto_cent: string | null;
  readonly gruppe: string;
  readonly satz_bp: number;
  readonly kategorie: string;
  readonly abrechnungsart: string | null;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
}

/**
 * Alles, was in die Nutzlast eingeht — aufgeloest, nicht verwiesen (K-12).
 *
 * Mit nur `kunde_id` und `mandant_id` als Verweis aenderte eine spaetere
 * Pflege des Kundenstamms, was diese Rechnung SAGT, waehrend die
 * Kettenpruefung weiter „intakt" meldet.
 */
export async function ladeRechnungVollstaendig(
  db: Abfrage, rechnungId: string,
): Promise<RechnungVollstaendig> {
  const [kopf] = await db.abfrage<KopfZeile>(KOPF_SQL, [rechnungId]);
  if (kopf === undefined) {
    throw new RechnungFehler(`Rechnung ${rechnungId} nicht gefunden`, 'nicht_gefunden');
  }

  const positionen = await db.abfrage<PositionZeile>(
    `select p.position_nr, p.positionsart::text as positionsart, p.bezeichnung, p.beschreibung,
            p.menge::text, p.einheit, e.unece_code, p.preis_basismenge::text,
            p.einzelpreis_cent::text, p.rabatt_bp, p.netto_cent::text,
            g.schluessel as gruppe, p.satz_bp, p.kategorie::text as kategorie,
            p.abrechnungsart,
            to_char(p.leistung_von, 'YYYY-MM-DD') as leistung_von,
            to_char(p.leistung_bis, 'YYYY-MM-DD') as leistung_bis
       from rechnungsposition p
       join steuersatz_gruppe g on g.id = p.steuersatz_gruppe_id
       left join masseinheit e on e.id = p.masseinheit_id
      where p.rechnung_id = $1
      order by p.position_nr`,
    [rechnungId],
  );

  const zuschlaege = await db.abfrage<{
    art: string; bezeichnung: string; grund_code: string | null;
    basis_cent: string | null; satz_bp: number | null; betrag_cent: string;
    gruppe: string; gruppe_satz_bp: number; gruppe_kategorie: string;
  }>(
    `select z.art::text as art, z.bezeichnung, z.grund_code, z.basis_cent::text,
            z.satz_bp, z.betrag_cent::text, g.schluessel as gruppe,
            z.gruppe_satz_bp, z.gruppe_kategorie::text as gruppe_kategorie
       from rechnung_zuschlag z
       join steuersatz_gruppe g on g.id = z.steuersatz_gruppe_id
      where z.rechnung_id = $1`,
    [rechnungId],
  );

  const steuerzeilen = await db.abfrage<{
    gruppe: string; kategorie: string; satz_bp: number;
    netto_cent: string; steuer_cent: string;
    befreiungsgrund_code: string | null; befreiungsgrund_text: string | null;
  }>(
    `select g.schluessel as gruppe, s.kategorie::text as kategorie, s.satz_bp,
            s.netto_cent::text, s.steuer_cent::text,
            s.befreiungsgrund_code, s.befreiungsgrund_text
       from rechnung_steuer s
       join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
      where s.rechnung_id = $1`,
    [rechnungId],
  );

  const alsPosition = (p: PositionZeile): Position => ({
    nr: p.position_nr,
    art: p.positionsart,
    bezeichnung: p.bezeichnung,
    beschreibung: p.beschreibung,
    menge: p.menge === null ? null : mengeAusPostgres(p.menge),
    einheit: p.einheit,
    einheitCode: p.unece_code,
    preisBasismenge: mengeAusPostgres(p.preis_basismenge),
    einzelpreisCent: p.einzelpreis_cent === null ? null : cent(BigInt(p.einzelpreis_cent)),
    rabattBp: p.rabatt_bp,
    nettoCent: p.netto_cent === null ? null : cent(BigInt(p.netto_cent)),
    steuersatzGruppe: p.gruppe,
    satzBp: p.satz_bp,
    kategorie: p.kategorie,
    abrechnungsart: p.abrechnungsart,
    leistungVon: p.leistung_von,
    leistungBis: p.leistung_bis,
    // FIN-07 kommt mit PR 48; ein leeres Array ist die ehrliche Aussage
    // „keine Quelle hinterlegt", und es steht im Hash.
    quellen: [],
  });

  const alsZuschlag = (z: (typeof zuschlaege)[number]): Zuschlag => ({
    art: z.art,
    bezeichnung: z.bezeichnung,
    grundCode: z.grund_code,
    basisCent: z.basis_cent === null ? null : cent(BigInt(z.basis_cent)),
    satzBp: z.satz_bp,
    betragCent: cent(BigInt(z.betrag_cent)),
    steuersatzGruppe: z.gruppe,
    gruppeSatzBp: z.gruppe_satz_bp,
    gruppeKategorie: z.gruppe_kategorie,
  });

  const alsSteuerzeile = (s: (typeof steuerzeilen)[number]): Steuerzeile => ({
    steuersatzGruppe: s.gruppe,
    kategorie: s.kategorie,
    satzBp: s.satz_bp,
    nettoCent: cent(BigInt(s.netto_cent)),
    steuerCent: cent(BigInt(s.steuer_cent)),
    befreiungsgrundCode: s.befreiungsgrund_code,
    befreiungsgrundText: s.befreiungsgrund_text,
  });

  return {
    leistender: {
      id: kopf.mandant_id,
      name: kopf.m_name,
      rechtsform: kopf.m_rechtsform,
      anschrift: kopf.m_anschrift,
      steuernummer: kopf.m_steuernummer,
      ustid: kopf.m_ust_id,
      gericht: kopf.m_gericht,
      hrb: kopf.m_hrb,
      geschaeftsfuehrer: kopf.m_geschaeftsfuehrer,
      eadresse: kopf.verkaeufer_eadresse,
      eadresseSchema: kopf.verkaeufer_eadresse_schema,
    },
    empfaenger: {
      id: kopf.k_id,
      name: kopf.k_name,
      anschrift: kopf.k_anschrift,
      ustid: kopf.k_ust_id,
      leitwegId: kopf.k_leitweg_id,
      kaeuferReferenz: kopf.k_kaeufer_referenz,
      bestellnummer: kopf.bestellnummer_kunde,
      eadresse: kopf.kaeufer_eadresse,
      eadresseSchema: kopf.kaeufer_eadresse_schema,
    },
    nummernkreisId: kopf.nummernkreis_id,
    nummer: kopf.nummer,
    kettePosition: Number(kopf.nummer_laufend),
    rechnungsart: kopf.rechnungsart,
    rechnungsartCode: kopf.rechnungsart_code,
    rechnungsdatum: kopf.rechnungsdatum,
    leistungVon: kopf.leistung_von,
    leistungBis: kopf.leistung_bis,
    vereinnahmungGeplantAm: kopf.vereinnahmung_geplant_am,
    objekt: kopf.o_id === null ? null : {
      id: kopf.o_id,
      bezeichnung: kopf.o_bezeichnung ?? '',
      anschrift: kopf.o_anschrift ?? '',
    },
    sprache: kopf.sprache,
    waehrung: kopf.waehrung,
    kopftext: kopf.kopftext,
    fusstext: kopf.fusstext,
    steuerhinweis: kopf.steuerhinweis,
    hinweise: [],
    positionen: positionen.map(alsPosition),
    zuschlaege: zuschlaege.map(alsZuschlag),
    steuerzeilen: steuerzeilen.map(alsSteuerzeile),
    // FIN-08 kommt mit PR 48.
    abzuege: [],
    nettoGesamtCent: cent(BigInt(kopf.netto_gesamt_cent)),
    steuerGesamtCent: cent(BigInt(kopf.steuer_gesamt_cent)),
    bruttoCent: cent(BigInt(kopf.brutto_cent)),
    abzugBruttoCent: cent(BigInt(kopf.abzug_brutto_cent)),
    zahlbetragCent: cent(BigInt(kopf.zahlbetrag_cent)),
    bauabzugsteuer: {
      pflichtig: kopf.bauabzugsteuer_pflichtig,
      satzBp: kopf.bauabzugsteuer_satz_bp,
      grundlageCent: kopf.bauabzugsteuer_grundlage_cent === null
        ? null : cent(BigInt(kopf.bauabzugsteuer_grundlage_cent)),
      einbehaltCent: cent(BigInt(kopf.einbehalt_bauabzugsteuer_cent)),
      // PR 51 loest die Bescheinigung auf; NULL ist hier die Tatsache, nicht
      // eine Auslassung — und sie steht ausgeschrieben im Hash.
      freistellungsbescheinigung: null,
    },
    ueberweisungsbetragCent: cent(BigInt(kopf.ueberweisungsbetrag_cent)),
    zahlung: {
      // `bankkonto` kommt mit PR 49 (BG-16).
      bankkonto: null,
      zahlungsmittelCode: kopf.zahlungsmittel_code,
      zahlungsbedingungText: kopf.zahlungsbedingung_text,
      zahlungszielTage: kopf.zahlungsziel_tage,
      faelligAm: kopf.faellig_am,
      skontoBp: kopf.skonto_bp,
      skontoTage: kopf.skonto_tage,
    },
    istKleinbetrag: kopf.ist_kleinbetrag,
    // Die Schwelle steht im Snapshot, sobald PR 47 sie auswertet (O-175).
    kleinbetragGrenzeCent: null,
    reverseCharge: kopf.reverse_charge,
    reverseChargeGrundlage: kopf.reverse_charge_grundlage,
    festgeschriebenAm: kopf.festgeschrieben_am,
    festgeschriebenVon: kopf.festgeschrieben_von,
  };
}

// ---------------------------------------------------------------------------
// Festschreiben (§5.6)
// ---------------------------------------------------------------------------

export interface Festschreibung {
  readonly nummer: string;
  readonly nummerLaufend: number;
  readonly nummernkreisId: string;
  readonly kettePosition: number;
  readonly rechnungsdatum: string;
  readonly hash: string;
}

/**
 * Der eine Weg von `entwurf` nach `festgeschrieben`.
 *
 * Er MUSS in der Transaktion des Aufrufers laufen — `db` ist eine
 * Transaktion, keine Verbindung. Beide Definer-Aufrufe darin, sonst faellt die
 * Sperre auf dem Nummernkreis zwischen ihnen, und die Kettenreihenfolge ist
 * nicht mehr die Nummernreihenfolge.
 */
export async function finalisiere(db: Abfrage, rechnungId: string): Promise<Festschreibung> {
  // 1. Sperren. Ab hier aendert sich nichts mehr unter uns.
  const [gesperrt] = await db.abfrage<{ id: string; status: string }>(
    `select id, status::text as status from rechnung where id = $1 for update`,
    [rechnungId],
  );
  if (gesperrt === undefined) {
    throw new RechnungFehler(`Rechnung ${rechnungId} nicht gefunden`, 'nicht_gefunden');
  }
  if (gesperrt.status !== 'entwurf') {
    throw new RechnungFehler(
      `Rechnung ${rechnungId} ist ${gesperrt.status} — festgeschrieben wird genau einmal.`,
      'kein_entwurf',
    );
  }

  const [anzahl] = await db.abfrage<{ n: string }>(
    `select count(*)::text as n from rechnungsposition
      where rechnung_id = $1 and positionsart = 'leistung'`,
    [rechnungId],
  );
  if (Number(anzahl?.n ?? '0') === 0) {
    throw new RechnungFehler(
      'Eine Rechnung ohne Leistungsposition hat nichts abzurechnen (§14 Abs. 4 Nr. 5 UStG).',
      'ohne_positionen',
    );
  }

  // 2. Die Vorabpruefung. Sie behauptet in PR 46 nichts — siehe
  //    `offenerBericht()`; der Validator kommt mit PR 47.
  const bericht = offenerBericht();

  // 3. Definer-Aufruf A.
  const [kopf] = await db.abfrage<{
    nummer: string; nummer_laufend: string; nummernkreis_id: string;
    kette_position: string; rechnungsdatum: string;
  }>(
    `select nummer, nummer_laufend::text, nummernkreis_id::text as nummernkreis_id,
            kette_position::text, to_char(rechnungsdatum, 'YYYY-MM-DD') as rechnungsdatum
       from fin.rechnung_nummer_ziehen($1::uuid, ($2::text)::jsonb)`,
    [rechnungId, JSON.stringify(bericht)],
  );
  if (kopf === undefined) {
    throw new RechnungFehler(
      'Die Nummernvergabe hat nichts zurueckgegeben — die Rechnung ist nicht festgeschrieben.',
      'kein_kreis',
    );
  }

  // 4. Die kanonische Nutzlast. HIER, nicht frueher: sie enthaelt `nummer`
  //    und `kette_position`.
  const vollstaendig = await ladeRechnungVollstaendig(db, rechnungId);
  const bytes = buildKanonischePayload(vollstaendig);

  // 5. Definer-Aufruf B. Die Datenbank rechnet die Digests selbst.
  const [kette] = await db.abfrage<{ hash: string }>(
    `select fin.rechnung_kette_schreiben($1::uuid, $2::bytea,
                                        ($3::text)::jsonb, ($4::text)::jsonb, $5, $6) as hash`,
    [rechnungId, Buffer.from(bytes), Buffer.from(bytes).toString('utf8'),
     JSON.stringify(bericht), SCHEMA_VERSION, REGELWERK_VERSION],
  );
  if (kette?.hash === undefined) {
    throw new RechnungFehler('Der Kettensatz wurde nicht geschrieben', 'nicht_festgeschrieben');
  }

  /**
   * 6. Buchhaltung in derselben Transaktion — `offener_posten`,
   *    `buchungssatz`, `periode` und `markiereQuellenAbgerechnet` (§5.6
   *    Schritt 6). Alle vier Tabellen kommen mit PR 48 bis PR 50. Der Schritt
   *    steht als Kommentar und nicht als stille Auslassung: er gehoert in
   *    DIESE Transaktion, nicht in einen Nachlauf, sonst gibt es
   *    festgeschriebene Rechnungen ohne offenen Posten.
   */

  return {
    nummer: kopf.nummer,
    nummerLaufend: Number(kopf.nummer_laufend),
    nummernkreisId: kopf.nummernkreis_id,
    kettePosition: Number(kopf.kette_position),
    rechnungsdatum: kopf.rechnungsdatum,
    hash: kette.hash,
  };
}

// ---------------------------------------------------------------------------
// Storno und Korrektur (Invariante 4)
// ---------------------------------------------------------------------------

/**
 * Die Kopfmerkmale, die ein Storno und eine Neuausstellung MITNEHMEN.
 *
 * Die Kopierliste stand zweimal als Handzaehlung da — `kunde_id`, `objekt_id`,
 * `auftrag_id`, `rechnungsart`, die Leistungsdaten, `zahlungsziel_tage`, die
 * Texte — und was `rechnung` sonst noch traegt, fiel weg. Es ist derselbe
 * Fehler, den die Zuschlagskopie in `korrigiere()` gerade geschlossen hat, nur
 * eine Ebene hoeher: das Storno hebt den einen Betrag auf, der Ersatzbeleg
 * traegt einen anderen, und beide Belege sind IN SICH stimmig, weil
 * `schreibeSummen()` sauber ueber das rechnet, was da ist. Die Differenz steht
 * nur im Vergleich der drei Belege — und auf einem unveraenderlichen Beleg.
 */
interface KopfMerkmale {
  readonly vereinnahmung_geplant_am: string | null;
  readonly reverse_charge: boolean;
  readonly reverse_charge_grundlage: string | null;
  readonly steuerhinweis: string | null;
  readonly ist_kleinbetrag: boolean;
  readonly bauabzugsteuer_pflichtig: boolean;
  readonly bauabzugsteuer_satz_bp: number | null;
  readonly abzug_brutto_cent: string;
  readonly einbehalt_bauabzugsteuer_cent: string;
  readonly bauabzugsteuer_grundlage_cent: string | null;
}

/** Die Spalten aus `rechnung`, die `KopfMerkmale` fuellen — an EINER Stelle. */
const KOPF_MERKMALE_SQL = `
  to_char(vereinnahmung_geplant_am, 'YYYY-MM-DD') as vereinnahmung_geplant_am,
  reverse_charge, reverse_charge_grundlage::text as reverse_charge_grundlage,
  steuerhinweis, ist_kleinbetrag,
  bauabzugsteuer_pflichtig, bauabzugsteuer_satz_bp,
  abzug_brutto_cent::text, einbehalt_bauabzugsteuer_cent::text,
  bauabzugsteuer_grundlage_cent::text`;

/** Die Werte in der Reihenfolge, in der beide Inserts sie einsetzen. */
function kopfMerkmalWerte(k: KopfMerkmale): readonly unknown[] {
  return [
    k.vereinnahmung_geplant_am, k.reverse_charge, k.reverse_charge_grundlage,
    k.steuerhinweis, k.ist_kleinbetrag,
    k.bauabzugsteuer_pflichtig, k.bauabzugsteuer_satz_bp,
  ];
}

/**
 * Die drei BETRAEGE, die dieser Weg nicht mitnehmen kann — und die er deshalb
 * nicht stillschweigend fallen laesst.
 *
 * `abzug_brutto_cent` geht in `rechnung_zahlbetrag_stimmig` (0075) ein und hat
 * bis FIN-08 keine Quellzeilen: die Nutzlast fuehrt `abzuege: []`. Ein
 * Ersatzbeleg mit dem Betrag, aber ohne die Zeilen dahinter, behauptete einen
 * Abzug, den kein Beleg begruendet; ohne den Betrag fordert er den vollen
 * Rechnungsbetrag, waehrend das Storno nur den geminderten Zahlbetrag
 * aufgehoben hat — eine bereits gezahlte Anzahlung waere dem Kunden ein
 * zweites Mal berechnet.
 *
 * `einbehalt_bauabzugsteuer_cent` und `bauabzugsteuer_grundlage_cent` haengen
 * ueber `rechnung_einbehalt_vorzeichen` und
 * `rechnung_bauabzug_grundlage_vorzeichen` am Vorzeichen von `brutto_cent` —
 * das auf dem frischen Entwurf 0 ist und erst `schreibeSummen()` bekommt. Sie
 * beim Anlegen zu setzen bricht die Bedingung, sie danach zu setzen ist ein
 * eigener Schritt, den §15 (Bauabzugsteuer) noch nicht beschreibt.
 *
 * Heute stehen alle drei ueberall auf 0 — keine Zeile im Dienst schreibt sie.
 * Die Ablehnung kostet also nichts und schlaegt genau dann zu, wenn der erste
 * Schreiber dazukommt.
 */
function pruefeKopfUebernehmbar(nummer: string, k: KopfMerkmale): void {
  const offen: string[] = [];
  if (BigInt(k.abzug_brutto_cent) !== 0n) offen.push('abzug_brutto_cent');
  if (BigInt(k.einbehalt_bauabzugsteuer_cent) !== 0n) {
    offen.push('einbehalt_bauabzugsteuer_cent');
  }
  if (k.bauabzugsteuer_grundlage_cent !== null
      && BigInt(k.bauabzugsteuer_grundlage_cent) !== 0n) {
    offen.push('bauabzugsteuer_grundlage_cent');
  }
  if (offen.length === 0) return;
  throw new RechnungFehler(
    `Rechnung ${nummer} traegt ${offen.join(', ')} — Betraege, die Storno und `
    + 'Neuausstellung hier nicht uebernehmen koennen. Ein Ersatzbeleg ohne sie '
    + 'forderte mehr, als das Storno aufgehoben hat; ein Ersatzbeleg mit ihnen '
    + 'behauptete einen Abzug ohne die Zeilen, die ihn begruenden (FIN-08).',
    'kopf_nicht_uebernehmbar',
  );
}

export interface StornoErgebnis {
  readonly stornoId: string;
  readonly nummer: string;
}

/**
 * Die einzige rechtmaessige Korrektur einer festgeschriebenen Rechnung ist
 * die STORNIERENDE BUCHUNG: eine eigene Rechnung, mit eigener Nummer aus
 * demselben Kreis, die das Original spiegelt — und eine Zeile in
 * `rechnung_beziehung`, die sagt, welche welche aufhebt.
 *
 * Das Original bleibt lesbar und unveraendert. Es gibt keinen Zustand
 * `storniert`; ein solcher waere ein Uebergang, den der
 * Unveraenderlichkeitsausloeser anschliessend nur abzuweisen haette.
 */
export async function storniere(
  db: Abfrage, rechnungId: string, grund: string,
): Promise<StornoErgebnis> {
  if (grund.trim().length < 10) {
    throw new RechnungFehler(
      'Ein Stornogrund ist Pflicht und muss den Vorgang benennen — nicht „Fehler".',
      'nicht_festgeschrieben',
    );
  }

  const [original] = await db.abfrage<{
    id: string; status: string; kunde_id: string; objekt_id: string | null;
    auftrag_id: string | null; zahlungsziel_tage: number | null;
    leistung_von: string | null; leistung_bis: string | null; nummer: string;
  } & KopfMerkmale>(
    `select id, status::text as status, kunde_id::text as kunde_id,
            objekt_id::text as objekt_id, auftrag_id::text as auftrag_id,
            zahlungsziel_tage,
            to_char(leistung_von, 'YYYY-MM-DD') as leistung_von,
            to_char(leistung_bis, 'YYYY-MM-DD') as leistung_bis, nummer,
            ${KOPF_MERKMALE_SQL}
       from rechnung where id = $1`,
    [rechnungId],
  );
  if (original === undefined) {
    throw new RechnungFehler(`Rechnung ${rechnungId} nicht gefunden`, 'nicht_gefunden');
  }
  if (original.status !== 'festgeschrieben') {
    throw new RechnungFehler(
      `Rechnung ${rechnungId} ist ${original.status} — ein Entwurf wird verworfen, nicht storniert.`,
      'nicht_festgeschrieben',
    );
  }
  const [schon] = await db.abfrage<{ id: string }>(
    `select id from rechnung_beziehung
      where zu_rechnung_id = $1 and art = 'storno' and storno_art = 'vollstorno'`,
    [rechnungId],
  );
  if (schon !== undefined) {
    throw new RechnungFehler(
      `Rechnung ${original.nummer} ist bereits vollstaendig storniert.`, 'schon_storniert',
    );
  }
  pruefeKopfUebernehmbar(original.nummer, original);

  /**
   * Der Leistungszeitpunkt des Stornos.
   *
   * `rechnung_leistungszeitpunkt` (0075) laesst die Alternative des §14
   * Abs. 4 Nr. 6 UStG — `vereinnahmung_geplant_am` statt eines
   * Leistungszeitraums — nur fuer `abschlag` und `anzahlung` zu. Ein Storno
   * traegt aber `rechnungsart = 'storno'`, und das MUSS es: nur unter dieser
   * Art laesst `rechnung_nur_storno_negativ` negative Betraege zu. Eine
   * Anzahlungsrechnung ohne Leistungszeitraum ist damit hier nicht
   * stornierbar — vorher fiel das als roher Bedingungsfehler mitten in
   * `finalisiere()` an, nachdem das Storno schon eine Nummer gezogen hatte.
   */
  if (original.leistung_von === null || original.leistung_bis === null) {
    throw new RechnungFehler(
      `Rechnung ${original.nummer} nennt ihren Leistungszeitpunkt nur ueber `
      + 'vereinnahmung_geplant_am. Ein Storno traegt rechnungsart = storno, und '
      + 'rechnung_leistungszeitpunkt laesst diese Alternative nur fuer abschlag '
      + 'und anzahlung zu — der Stornoentwurf waere nicht festschreibbar.',
      'leistungszeitpunkt_fehlt',
    );
  }

  const [entwurf] = await db.abfrage<{ id: string }>(
    `insert into rechnung (mandant_id, kunde_id, objekt_id, auftrag_id, rechnungsart,
                           leistung_von, leistung_bis, zahlungsziel_tage,
                           kopftext,
                           vereinnahmung_geplant_am, reverse_charge,
                           reverse_charge_grundlage, steuerhinweis, ist_kleinbetrag,
                           bauabzugsteuer_pflichtig, bauabzugsteuer_satz_bp,
                           erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, 'storno',
             $4::date, $5::date, $6, $7,
             $8::date, $9, $10::bauleistungsart, $11, $12, $13, $14,
             'mensch', app.aktueller_benutzer())
     returning id`,
    [original.kunde_id, original.objekt_id, original.auftrag_id,
     original.leistung_von, original.leistung_bis, original.zahlungsziel_tage,
     `Storno zu Rechnung ${original.nummer}`,
     ...kopfMerkmalWerte(original)],
  );
  if (entwurf === undefined) {
    throw new RechnungFehler('Der Stornoentwurf wurde nicht angelegt', 'nicht_gefunden');
  }

  /**
   * Die Positionen gespiegelt: NEGATIVE Menge bei unveraendertem
   * Einzelpreis. Den Preis zu negieren waere dieselbe Summe und eine andere
   * Aussage — ein negativer Einheitspreis auf einem Beleg ist keiner, den
   * jemand lesen will, und ein Agent duerfte ihn ohnehin nie schreiben
   * (K-10).
   */
  await db.abfrage(
    `insert into rechnungsposition
       (mandant_id, rechnung_id, position_nr, positionsart, bezeichnung, beschreibung,
        menge, einheit, masseinheit_id, preis_basismenge, einzelpreis_cent, rabatt_bp,
        netto_cent, steuersatz_gruppe_id, satz_bp, kategorie, abrechnungsart,
        leistung_von, leistung_bis, erstellt_von_art, erstellt_von)
     select p.mandant_id, $2::uuid, p.position_nr, p.positionsart, p.bezeichnung,
            p.beschreibung, -p.menge, p.einheit, p.masseinheit_id, p.preis_basismenge,
            p.einzelpreis_cent, p.rabatt_bp, -p.netto_cent, p.steuersatz_gruppe_id,
            p.satz_bp, p.kategorie, p.abrechnungsart, p.leistung_von, p.leistung_bis,
            'mensch', app.aktueller_benutzer()
       from rechnungsposition p
      where p.rechnung_id = $1 and p.positionsart = 'leistung'`,
    [rechnungId, entwurf.id],
  );

  await db.abfrage(
    `insert into rechnung_zuschlag
       (mandant_id, rechnung_id, art, bezeichnung, grund_code, basis_cent, satz_bp,
        betrag_cent, steuersatz_gruppe_id, gruppe_satz_bp, gruppe_kategorie,
        erstellt_von_art, erstellt_von)
     select z.mandant_id, $2::uuid,
            case when z.art = 'zuschlag' then 'nachlass' else 'zuschlag' end::zuschlag_art,
            z.bezeichnung, z.grund_code, z.basis_cent, z.satz_bp, z.betrag_cent,
            z.steuersatz_gruppe_id, z.gruppe_satz_bp, z.gruppe_kategorie,
            'mensch', app.aktueller_benutzer()
       from rechnung_zuschlag z where z.rechnung_id = $1`,
    [rechnungId, entwurf.id],
  );

  await schreibeSummen(db, entwurf.id);
  const festgeschrieben = await finalisiere(db, entwurf.id);

  await db.abfrage(
    `insert into rechnung_beziehung
       (mandant_id, von_rechnung_id, zu_rechnung_id, art, storno_art, grund,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, 'storno', 'vollstorno', $3,
             'mensch', app.aktueller_benutzer())`,
    [entwurf.id, rechnungId, grund],
  );

  return { stornoId: entwurf.id, nummer: festgeschrieben.nummer };
}

export interface KorrekturErgebnis {
  readonly stornoId: string;
  readonly stornoNummer: string;
  readonly neuId: string;
  readonly neuNummer: string;
}

/**
 * Storno PLUS Neuausstellung — die vollstaendige Korrektur (Invariante 4).
 *
 * Drei Belege, drei Nummern aus demselben lueckenlosen Kreis, zwei Zeilen in
 * `rechnung_beziehung`: das Storno zeigt auf das Original (`storno`), die
 * Neuausstellung ebenfalls (`ersetzt`). Das Original bleibt lesbar — es wird
 * nicht geaendert und nicht entfernt, es ist aufgehoben.
 *
 * Die Umkehrlesarten werden NICHT gespeichert: „was hat mich storniert" ist
 * eine Abfrage ueber `zu_rechnung_id`, und eine zweite Zeile waere eine
 * zweite Kopie derselben Tatsache (§4.8).
 */
export async function korrigiere(
  db: Abfrage, rechnungId: string, grund: string,
): Promise<KorrekturErgebnis> {
  const storno = await storniere(db, rechnungId, grund);

  const [original] = await db.abfrage<{
    kunde_id: string; objekt_id: string | null; auftrag_id: string | null;
    zahlungsziel_tage: number | null; leistung_von: string | null;
    leistung_bis: string | null; kopftext: string | null; fusstext: string | null;
    rechnungsart: string; nummer: string;
  } & KopfMerkmale>(
    `select kunde_id::text as kunde_id, objekt_id::text as objekt_id,
            auftrag_id::text as auftrag_id, zahlungsziel_tage,
            to_char(leistung_von, 'YYYY-MM-DD') as leistung_von,
            to_char(leistung_bis, 'YYYY-MM-DD') as leistung_bis,
            kopftext, fusstext, rechnungsart::text as rechnungsart, nummer,
            ${KOPF_MERKMALE_SQL}
       from rechnung where id = $1`,
    [rechnungId],
  );
  if (original === undefined) {
    throw new RechnungFehler(`Rechnung ${rechnungId} nicht gefunden`, 'nicht_gefunden');
  }

  /**
   * Dieselben Kopfmerkmale wie beim Storno — und hier traegt
   * `vereinnahmung_geplant_am` mehr als eine Kopie: die Neuausstellung behaelt
   * die `rechnungsart` des Originals. Ist das eine Abschlags- oder
   * Anzahlungsrechnung, die ihren Leistungszeitpunkt ueber die Vereinnahmung
   * nennt (§14 Abs. 4 Nr. 6 UStG), war sie ohne diese Spalte gar nicht
   * festschreibbar — `rechnung_leistungszeitpunkt` haette sie abgewiesen,
   * nachdem das Storno bereits festgeschrieben war.
   */
  const [neu] = await db.abfrage<{ id: string }>(
    `insert into rechnung (mandant_id, kunde_id, objekt_id, auftrag_id, rechnungsart,
                           leistung_von, leistung_bis, zahlungsziel_tage,
                           kopftext, fusstext,
                           vereinnahmung_geplant_am, reverse_charge,
                           reverse_charge_grundlage, steuerhinweis, ist_kleinbetrag,
                           bauabzugsteuer_pflichtig, bauabzugsteuer_satz_bp,
                           erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, $4::rechnungsart,
             $5::date, $6::date, $7, $8, $9,
             $10::date, $11, $12::bauleistungsart, $13, $14, $15, $16,
             'mensch', app.aktueller_benutzer())
     returning id`,
    [original.kunde_id, original.objekt_id, original.auftrag_id, original.rechnungsart,
     original.leistung_von, original.leistung_bis, original.zahlungsziel_tage,
     original.kopftext, original.fusstext,
     ...kopfMerkmalWerte(original)],
  );
  if (neu === undefined) {
    throw new RechnungFehler('Die Neuausstellung wurde nicht angelegt', 'nicht_gefunden');
  }

  await db.abfrage(
    `insert into rechnungsposition
       (mandant_id, rechnung_id, position_nr, positionsart, bezeichnung, beschreibung,
        menge, einheit, masseinheit_id, preis_basismenge, einzelpreis_cent, rabatt_bp,
        netto_cent, steuersatz_gruppe_id, satz_bp, kategorie, abrechnungsart,
        leistung_von, leistung_bis, erstellt_von_art, erstellt_von)
     select p.mandant_id, $2::uuid, p.position_nr, p.positionsart, p.bezeichnung,
            p.beschreibung, p.menge, p.einheit, p.masseinheit_id, p.preis_basismenge,
            p.einzelpreis_cent, p.rabatt_bp, p.netto_cent, p.steuersatz_gruppe_id,
            p.satz_bp, p.kategorie, p.abrechnungsart, p.leistung_von, p.leistung_bis,
            'mensch', app.aktueller_benutzer()
       from rechnungsposition p
      where p.rechnung_id = $1 and p.positionsart = 'leistung'`,
    [rechnungId, neu.id],
  );

  /**
   * Und die Zu- und Abschlaege — 1:1, mit unveraenderter `art`.
   *
   * Sie fehlten hier. `storniere()` spiegelte sie (Zuschlag wird Nachlass),
   * die Neuausstellung uebernahm nur die Positionen: das Storno hob also den
   * vollen Betrag auf, der Ersatzbeleg trug aber nur noch die Positionssumme.
   * Ein Nachlass von 3 % waere dem Kunden bei jeder Korrektur stillschweigend
   * gestrichen worden, ein Zuschlag — Express, Wochenende, Kleinmengen — dem
   * Haus. Auffallen konnte das nicht: beide Belege sind in sich stimmig,
   * `schreibeSummen()` rechnet sauber ueber das, was DA ist, und die
   * Differenz steht nur im Vergleich der drei Belege.
   *
   * Nicht gespiegelt wird hier: die Neuausstellung ist der Beleg, wie er
   * haette lauten sollen, nicht dessen Aufhebung.
   */
  await db.abfrage(
    `insert into rechnung_zuschlag
       (mandant_id, rechnung_id, art, bezeichnung, grund_code, basis_cent, satz_bp,
        betrag_cent, steuersatz_gruppe_id, gruppe_satz_bp, gruppe_kategorie,
        erstellt_von_art, erstellt_von)
     select z.mandant_id, $2::uuid, z.art, z.bezeichnung, z.grund_code, z.basis_cent,
            z.satz_bp, z.betrag_cent, z.steuersatz_gruppe_id, z.gruppe_satz_bp,
            z.gruppe_kategorie, 'mensch', app.aktueller_benutzer()
       from rechnung_zuschlag z where z.rechnung_id = $1`,
    [rechnungId, neu.id],
  );

  await schreibeSummen(db, neu.id);
  const festgeschrieben = await finalisiere(db, neu.id);

  await db.abfrage(
    `insert into rechnung_beziehung
       (mandant_id, von_rechnung_id, zu_rechnung_id, art, grund,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, 'ersetzt', $3,
             'mensch', app.aktueller_benutzer())`,
    [neu.id, rechnungId, grund],
  );

  return {
    stornoId: storno.stornoId,
    stornoNummer: storno.nummer,
    neuId: neu.id,
    neuNummer: festgeschrieben.nummer,
  };
}

/** Die Summe zweier Cent-Betraege — hier, damit kein Aufrufer sie selbst bildet. */
export function summe(...werte: readonly Cent[]): Cent {
  return addiere(...werte);
}

/** Die Spiegelung eines Betrages fuer eine stornierende Buchung. */
export function spiegele(betrag: Cent): Cent {
  return negiere(betrag);
}
