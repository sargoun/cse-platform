import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { ibanGeprueft } from './zahlung/iban.js';

/**
 * Lieferantenstammdaten anlegen und pflegen (V-006, FIN-14, ACC-05, ACC-07).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: ein Pflichtfeld ohne Tabelleninhalt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `/finanzen/eingangsrechnungen/neu` verlangt einen Lieferanten. `lieferant`
 * trägt seit `0123` Policy (`t_mandant`, `eingang.schreiben`), Grant
 * (`insert, update`), Nummernindex, IBAN-Prüfung, §48-Datum und einen
 * Auslöser, der jede Bankdatenänderung ins Protokoll schreibt — und **keinen
 * einzigen Erzeuger**. Ausser dem Seed konnte niemand eine Zeile anlegen. Die
 * Eingangsrechnung, das Herzstück der Kreditorenbuchhaltung, war damit für
 * jede Gesellschaft unbenutzbar, die nicht mit Demodaten lief.
 *
 * **Die Lieferantennummer kommt NICHT aus dem Nummernkreis** (K-12) — dieselbe
 * Begründung wie bei `kunde` und `lead`: die lückenlose Kette gehört
 * Rechnungen, wo eine Lücke ein GoBD-Befund ist. Ein Stammsatz ist kein Beleg,
 * und ein abgebrochenes Formular darf eine Nummer verbrauchen. Sie entsteht in
 * derselben Anweisung wie der `insert`, sonst bekämen zwei gleichzeitige
 * Anlagen dieselbe und die zweite fiele auf `lieferant_nummer_uk`.
 *
 * **Die IBAN wird geprüft, bevor sie ankommt.** Der CHECK in der Tabelle
 * prüft die GESTALT (`^[A-Z]{2}[0-9]{2}…`), nicht die Prüfziffer — die
 * Aufteilung ist Absicht (0121, Entscheidung 4). `ibanGeprueft` rechnet
 * Modulo 97; eine IBAN mit vertauschten Ziffern hat die richtige Gestalt und
 * geht trotzdem an den Falschen.
 *
 * **Was dieser Dienst NICHT tut: die Bankdaten still ändern.** Der Auslöser
 * `fin.lieferant_bankdaten_geaendert` schreibt jede IBAN-Änderung mit
 * `vorher`/`nachher` ins Protokoll — der häufigste Rechnungsbetrug im
 * Mittelstand ist eine E-Mail mit „unsere Bankverbindung hat sich geändert".
 * Die Änderung läuft deshalb über denselben Weg wie alles andere und bekommt
 * keinen Schnellpfad.
 */

export class LieferantFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'LieferantFehler';
  }
}

export type Bauleistungsart = 'bau' | 'gebaeudereinigung';
export const BAULEISTUNGSARTEN: readonly Bauleistungsart[] = ['bau', 'gebaeudereinigung'];

export type LieferantStatus = 'aktiv' | 'gesperrt';

export interface LieferantZeile {
  readonly id: string;
  readonly lieferantennummer: string;
  readonly name: string;
  readonly ort: string | null;
  readonly land: string;
  readonly ustId: string | null;
  readonly status: LieferantStatus;
  readonly leistungsart: Bauleistungsart | null;
  /** Das Datum der Freistellungsbescheinigung nach § 48b EStG. */
  readonly istBauleistenderBis: string | null;
  readonly archiviert: boolean;
  /** Wie viele Eingangsrechnungen auf ihm liegen — die Archivierungsfrage. */
  readonly rechnungen: number;
}

const FELDER = `l.id, l.lieferantennummer, l.name, l.ort, l.land,
                l.ust_id as "ustId", l.status::text as status,
                l.leistungsart::text as leistungsart,
                to_char(l.ist_bauleistender_bis, 'YYYY-MM-DD') as "istBauleistenderBis",
                (l.archiviert_am is not null) as archiviert`;

export async function lieferanten(
  kontext: LeseKontext, auchArchivierte = false,
): Promise<readonly LieferantZeile[]> {
  return kontext.abfrage<LieferantZeile>(
    `select ${FELDER},
            (select count(*)::int from eingangsrechnung e
              where e.mandant_id = l.mandant_id and e.lieferant_id = l.id) as rechnungen
       from lieferant l
      where l.mandant_id = app.aktiver_mandant()
        and ($1::boolean or l.archiviert_am is null)
      order by l.archiviert_am nulls first, l.name`,
    [auchArchivierte]);
}

export async function leseLieferant(
  kontext: LeseKontext, id: string,
): Promise<LieferantZeile | null> {
  const zeilen = await kontext.abfrage<LieferantZeile>(
    `select ${FELDER},
            (select count(*)::int from eingangsrechnung e
              where e.mandant_id = l.mandant_id and e.lieferant_id = l.id) as rechnungen
       from lieferant l
      where l.mandant_id = app.aktiver_mandant() and l.id = $1::uuid`,
    [id]);
  return zeilen[0] ?? null;
}

export interface NeuerLieferant {
  readonly name: string;
  readonly strasse?: string | undefined;
  readonly hausnummer?: string | undefined;
  readonly plz?: string | undefined;
  readonly ort?: string | undefined;
  readonly land?: string | undefined;
  readonly email?: string | undefined;
  readonly telefon?: string | undefined;
  readonly ustId?: string | undefined;
  readonly steuernummer?: string | undefined;
  readonly iban?: string | undefined;
  readonly bic?: string | undefined;
  readonly zahlungszielTage?: string | undefined;
  readonly leistungsart?: string | undefined;
  readonly istBauleistenderBis?: string | undefined;
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

function leer(wert: string | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

/**
 * Das Zahlungsziel — Tage, oder gar nichts.
 *
 * **Kein Vorgabewert** (O-66-Muster): ein Zahlungsziel ist eine Vereinbarung
 * mit diesem Lieferanten, keine Hauspolitik. „30 Tage" voreinzustellen hiesse,
 * für jeden neuen Lieferanten eine Frist zu behaupten, die niemand vereinbart
 * hat — und die Mahnwache rechnete darauf.
 */
function pruefeZahlungsziel(wert: string | undefined): number | null {
  const t = leer(wert);
  if (t === null) return null;
  if (!/^\d+$/u.test(t)) {
    throw new LieferantFehler(
      'Das Zahlungsziel sind ganze Tage — oder nichts.', 'zahlungsziel_ungueltig');
  }
  const tage = Number(t);
  if (tage > 3650) {
    throw new LieferantFehler(
      'Ein Zahlungsziel über zehn Jahre ist keines.', 'zahlungsziel_ungueltig');
  }
  return tage;
}

/**
 * Die IBAN — Gestalt UND Prüfziffer.
 *
 * Die Gestalt prüft der CHECK in der Tabelle; hier kommt Modulo 97 dazu. Eine
 * IBAN mit zwei vertauschten Ziffern hat die richtige Gestalt und geht an den
 * Falschen — und bei einem Lieferanten ist genau das die teure Richtung.
 */
function pruefeIban(wert: string | undefined): string | null {
  const t = leer(wert);
  if (t === null) return null;
  try {
    return ibanGeprueft(t);
  } catch {
    throw new LieferantFehler(
      'Die IBAN stimmt nicht — bitte prüfen Sie sie Zeichen für Zeichen gegen '
      + 'das Schreiben des Lieferanten.', 'iban_ungueltig');
  }
}

function pruefeLeistungsart(wert: string | undefined): Bauleistungsart | null {
  const t = leer(wert);
  if (t === null) return null;
  if (!BAULEISTUNGSARTEN.includes(t as Bauleistungsart)) {
    throw new LieferantFehler('Unbekannte Leistungsart.', 'leistungsart_unbekannt');
  }
  return t as Bauleistungsart;
}

/**
 * Das §48b-Datum.
 *
 * **Es ist DATIERT und kein Häkchen** — eine Freistellungsbescheinigung läuft
 * ab, und ein Häkchen liefe nie ab. Der Einbehalt nach § 48 EStG hängt daran:
 * wer ihn unterlässt, obwohl die Bescheinigung abgelaufen war, haftet für die
 * nicht abgeführten 15 % (§ 48a Abs. 3 EStG).
 */
function pruefeBauleistenderBis(wert: string | undefined): string | null {
  const t = leer(wert);
  if (t === null) return null;
  if (!DATUM.test(t)) {
    throw new LieferantFehler(
      'Das Datum der Freistellungsbescheinigung ist nicht lesbar.',
      'datum_unlesbar');
  }
  return t;
}

export async function legeLieferantAn(
  kontext: SchreibKontext, eingabe: NeuerLieferant,
): Promise<{ readonly id: string; readonly lieferantennummer: string }> {
  const name = eingabe.name.trim();
  if (name === '') {
    throw new LieferantFehler('Ein Lieferant braucht einen Namen.', 'name_fehlt');
  }

  const zahlungsziel = pruefeZahlungsziel(eingabe.zahlungszielTage);
  const iban = pruefeIban(eingabe.iban);
  const leistungsart = pruefeLeistungsart(eingabe.leistungsart);
  const bauBis = pruefeBauleistenderBis(eingabe.istBauleistenderBis);

  const land = (leer(eingabe.land) ?? 'DE').toUpperCase();
  if (!/^[A-Z]{2}$/u.test(land)) {
    throw new LieferantFehler(
      'Das Land ist ein Länderkürzel aus zwei Buchstaben (DE, AT, PL).',
      'land_ungueltig');
  }

  const zeilen = await kontext.schreibe<{ id: string; lieferantennummer: string }>(
    `insert into lieferant
       (mandant_id, lieferantennummer, name, strasse, hausnummer, plz, ort, land,
        email, telefon, ust_id, steuernummer, iban, bic, zahlungsziel_tage,
        leistungsart, ist_bauleistender_bis, erstellt_von_art, erstellt_von)
     select app.aktiver_mandant(),
            -- Aus dem Bestand DIESER Gesellschaft, in derselben Anweisung.
            'L-' || lpad((
              coalesce(max(substring(x.lieferantennummer from '^L-(\\d+)$')::int), 0) + 1
            )::text, 5, '0'),
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::integer,
            $14::bauleistungsart, $15::date, 'mensch', app.aktueller_benutzer()
       from lieferant x
      where x.mandant_id = app.aktiver_mandant()
     returning id, lieferantennummer`,
    [name, leer(eingabe.strasse), leer(eingabe.hausnummer), leer(eingabe.plz),
      leer(eingabe.ort), land, leer(eingabe.email), leer(eingabe.telefon),
      leer(eingabe.ustId), leer(eingabe.steuernummer), iban,
      leer(eingabe.bic)?.toUpperCase() ?? null, zahlungsziel,
      leistungsart, bauBis]);

  const z = zeilen[0];
  if (z === undefined) {
    throw new LieferantFehler(
      'Der Lieferant wurde nicht angelegt — fehlt `eingang.schreiben`?',
      'kein_schreibrecht', 403);
  }
  return { id: z.id, lieferantennummer: z.lieferantennummer };
}

export async function aendereLieferant(
  kontext: SchreibKontext, id: string, eingabe: NeuerLieferant,
): Promise<void> {
  const name = eingabe.name.trim();
  if (name === '') {
    throw new LieferantFehler('Ein Lieferant braucht einen Namen.', 'name_fehlt');
  }
  const zahlungsziel = pruefeZahlungsziel(eingabe.zahlungszielTage);
  const iban = pruefeIban(eingabe.iban);
  const leistungsart = pruefeLeistungsart(eingabe.leistungsart);
  const bauBis = pruefeBauleistenderBis(eingabe.istBauleistenderBis);
  const land = (leer(eingabe.land) ?? 'DE').toUpperCase();

  /*
   * **Die Bankverbindung steht nur dann im `set`, wenn eine kam** — und der
   * Grund ist nicht Bequemlichkeit, sondern ein Rechteentzug.
   *
   * `cse_app` hält auf `lieferant.iban` und `.bic` kein `select`
   * (Spalten-Grant, `0123`); lesbar sind sie nur über
   * `app.lieferant_konditionen`, das den Zugriff protokolliert. Der erste
   * Entwurf schrieb `iban = coalesce($n, iban)` — bequem, und die Datenbank
   * antwortete mit „permission denied for table lieferant": auch die rechte
   * Seite eines `set` LIEST die Spalte. Der Entzug hat den Fehler gefunden,
   * nicht ein Test.
   *
   * Also wird die Zuweisung weggelassen statt umschrieben. Das hat dieselbe
   * Wirkung — ein leeres Feld lässt die hinterlegte Verbindung stehen — und
   * braucht kein Leserecht. Blindes Überschreiben wäre ohnehin der stille
   * Weg, einen Lieferanten unbezahlbar zu machen: das Formular kann die IBAN
   * gar nicht vorbefüllen.
   */
  const sätze = [
    'name = $2', 'strasse = $3', 'hausnummer = $4', 'plz = $5', 'ort = $6',
    'land = $7', 'email = $8', 'telefon = $9', 'ust_id = $10',
    'steuernummer = $11', 'zahlungsziel_tage = $12::integer',
    'leistungsart = $13::bauleistungsart', 'ist_bauleistender_bis = $14::date',
    'geaendert_am = now()', "geaendert_von_art = 'mensch'",
    'geaendert_von = app.aktueller_benutzer()',
  ];
  const werte: unknown[] = [
    id, name, leer(eingabe.strasse), leer(eingabe.hausnummer), leer(eingabe.plz),
    leer(eingabe.ort), land, leer(eingabe.email), leer(eingabe.telefon),
    leer(eingabe.ustId), leer(eingabe.steuernummer), zahlungsziel,
    leistungsart, bauBis,
  ];
  if (iban !== null) {
    werte.push(iban);
    sätze.push(`iban = $${String(werte.length)}`);
  }
  const bic = leer(eingabe.bic)?.toUpperCase() ?? null;
  if (bic !== null) {
    werte.push(bic);
    sätze.push(`bic = $${String(werte.length)}`);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update lieferant set ${sätze.join(', ')}
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and archiviert_am is null
      returning id`,
    werte);

  if (zeilen[0] === undefined) {
    throw new LieferantFehler(
      'Diesen Lieferanten gibt es nicht — oder er ist archiviert.',
      'nicht_gefunden', 404);
  }
}

/**
 * Sperren und entsperren.
 *
 * **`gesperrt` ist keine Archivierung.** Ein gesperrter Lieferant bleibt in
 * der Liste und in jeder Buchung, die auf ihn zeigt; was endet, ist die
 * Bereitschaft, neue Rechnungen von ihm anzunehmen. Das ist der Fall
 * „Qualitätsstreit" oder „Insolvenzverdacht" — und er ist umkehrbar, während
 * die Archivierung es nicht sein soll.
 */
export async function setzeLieferantStatus(
  kontext: SchreibKontext, id: string, status: LieferantStatus,
): Promise<void> {
  if (!['aktiv', 'gesperrt'].includes(status)) {
    throw new LieferantFehler('Unbekannter Status.', 'status_unbekannt');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update lieferant
        set status = $2, geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and archiviert_am is null
      returning id`,
    [id, status]);
  if (zeilen[0] === undefined) {
    throw new LieferantFehler(
      'Diesen Lieferanten gibt es nicht — oder er ist archiviert.',
      'nicht_gefunden', 404);
  }
}

/**
 * Archivieren — und NICHT, solange Rechnungen offen sind.
 *
 * Gelöscht wird nichts (Invariante 8, `KEIN_HARD_DELETE`): an einem
 * Lieferanten hängen Eingangsrechnungen mit zehnjähriger Aufbewahrung und der
 * §48-EStG-Nachweis, wem gegenüber einbehalten wurde.
 *
 * **Offene Rechnungen halten die Archivierung auf.** Ein archivierter
 * Lieferant verschwindet aus jeder Auswahlliste; eine Rechnung, die noch zu
 * zahlen ist, bekäme damit einen Zahlungsempfänger, den niemand mehr
 * auswählen kann. Bezahlte und gebuchte halten nicht auf — die sind fertig.
 */
export async function archiviereLieferant(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const offen = await kontext.abfrage<{ anzahl: number }>(
    `select count(*)::int as anzahl from eingangsrechnung
      where mandant_id = app.aktiver_mandant() and lieferant_id = $1::uuid
        and status not in ('gebucht', 'abgelehnt')`,
    [id]);
  if ((offen[0]?.anzahl ?? 0) > 0) {
    throw new LieferantFehler(
      `Auf diesem Lieferanten liegen ${String(offen[0]?.anzahl)} noch nicht `
      + 'abgeschlossene Eingangsrechnungen. Schliessen Sie die zuerst ab — '
      + 'sonst zeigt eine offene Zahlung auf einen Empfänger, den niemand mehr '
      + 'auswählen kann.', 'rechnungen_offen', 409);
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update lieferant
        set archiviert_am = now(), geaendert_am = now(),
            geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and archiviert_am is null
      returning id`,
    [id]);
  if (zeilen[0] === undefined) {
    throw new LieferantFehler(
      'Diesen Lieferanten gibt es nicht — oder er ist schon archiviert.',
      'nicht_gefunden', 404);
  }
}
