import 'server-only';
import { cent, type Cent } from '../geld.js';
import { ibanGeprueft } from './iban.js';
import { tagDeutsch } from '../../../../lib/datum/kalendertag.js';

/**
 * Zahlungen, offene Posten und ihr Ausgleich (FIN-14, `05-FINANZEN.md`
 * §7.1–§7.4, PR 54.1).
 *
 * **Die Plattform ERFASST Zahlungen. Sie loest keine aus.** Es gibt keine
 * Bankanbindung; ein „ueberwiesen"-Zustand waere eine Behauptung ueber die
 * Aussenwelt, die niemand geprueft hat (keine erfundenen Integrationen). Was
 * hier entsteht, ist die Buchhaltung um einen Beleg herum: wieviel kam an,
 * worauf entfaellt es, was bleibt offen.
 *
 * **Gerechnet wird hier, entschieden in der Datenbank.** Die Ausloeser aus
 * 0121 weisen jede Zuordnung ab, die einen Posten ueberzahlt, und schreiben
 * `bezahlt_cent` fort. Dieser Dienst legt die Zeilen an und uebersetzt die
 * Ablehnungen in Saetze, die ein Mensch lesen kann. Er rechnet NIE nach, was
 * die Datenbank schon weiss — zwei Wahrheiten ueber denselben Betrag sind
 * eine zuviel.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type Zahlungsart =
  'ueberweisung' | 'lastschrift' | 'bar' | 'karte' | 'verrechnung';

export type ZuordnungArt =
  | 'zahlung' | 'skonto' | 'gebuehr' | 'differenz' | 'mahngebuehr' | 'zins'
  | 'bauabzugsteuer_einbehalt' | 'ueberzahlung';

export type PostenArt =
  'debitor' | 'kreditor' | 'debitor_guthaben' | 'kreditor_guthaben';

export class ZahlungFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund:
      | 'nicht_gefunden'
      | 'kein_posten'
      | 'schon_ausgeglichen'
      | 'storniert'
      | 'abgewiesen',
  ) {
    super(nachricht);
    this.name = 'ZahlungFehler';
  }
}

// ---------------------------------------------------------------------------
// Bankkonten
// ---------------------------------------------------------------------------

export interface Bankkonto {
  readonly id: string;
  readonly bezeichnung: string;
  readonly iban: string;
  readonly bic: string | null;
  readonly kontoinhaber: string;
  readonly istStandard: boolean;
}

interface BankkontoZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly iban: string;
  readonly bic: string | null;
  readonly kontoinhaber: string;
  readonly ist_standard: boolean;
}

export async function bankkonten(db: Abfrage): Promise<readonly Bankkonto[]> {
  const zeilen = await db.abfrage<BankkontoZeile>(
    `select id, bezeichnung, iban, bic, kontoinhaber, ist_standard
       from bankkonto
      where archiviert_am is null
      order by ist_standard desc, bezeichnung`);
  return zeilen.map((z) => ({
    id: z.id,
    bezeichnung: z.bezeichnung,
    iban: z.iban,
    bic: z.bic,
    kontoinhaber: z.kontoinhaber,
    istStandard: z.ist_standard,
  }));
}

export interface BankkontoAnlegen {
  readonly bezeichnung: string;
  readonly iban: string;
  readonly bic?: string | null;
  readonly kontoinhaber: string;
  readonly istStandard?: boolean;
}

/**
 * Die Pruefziffer wird HIER gerechnet und nicht in einem CHECK (§3.2). Eine
 * IBAN mit Zahlendreher steht sonst auf jeder Rechnung, die das Konto nennt —
 * und die sind nach dem Festschreiben unveraenderlich.
 */
export async function legeBankkontoAn(
  db: Abfrage, eingabe: BankkontoAnlegen,
): Promise<string> {
  const iban = ibanGeprueft(eingabe.iban);
  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into bankkonto (mandant_id, bezeichnung, iban, bic, kontoinhaber,
                            ist_standard, erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, $3, $4, coalesce($5, false),
             'mensch', app.aktueller_benutzer())
     returning id`,
    [eingabe.bezeichnung.trim(), iban,
     eingabe.bic === null || eingabe.bic === undefined || eingabe.bic.trim() === ''
       ? null : eingabe.bic.replace(/\s/gu, '').toUpperCase(),
     eingabe.kontoinhaber.trim(), eingabe.istStandard ?? false]);
  if (zeile === undefined) {
    throw new ZahlungFehler('Das Bankkonto wurde nicht angelegt.', 'abgewiesen');
  }
  return zeile.id;
}

// ---------------------------------------------------------------------------
// Offene Posten
// ---------------------------------------------------------------------------

export interface OffenerPosten {
  readonly id: string;
  readonly art: PostenArt;
  readonly rechnungId: string | null;
  readonly rechnungsnummer: string | null;
  readonly kundeId: string | null;
  readonly kundeName: string | null;
  readonly betragCent: Cent;
  readonly bezahltCent: Cent;
  readonly offenCent: Cent;
  readonly faelligAm: string;
  readonly ausgeglichenAm: string | null;
  /** Tage ueber die Faelligkeit hinaus; 0, solange nichts ueberfaellig ist. */
  readonly ueberfaelligTage: number;
}

interface PostenZeile {
  readonly id: string;
  readonly art: PostenArt;
  readonly rechnung_id: string | null;
  readonly rechnungsnummer: string | null;
  readonly kunde_id: string | null;
  readonly kunde_name: string | null;
  readonly betrag_cent: string;
  readonly bezahlt_cent: string;
  readonly offen_cent: string;
  readonly faellig_am: string;
  readonly ausgeglichen_am: string | null;
  readonly ueberfaellig_tage: number;
}

/**
 * `app.berlin_heute()` und nicht `current_date`: Invariante 2 und K-11. Ein
 * Server in UTC zaehlte den 1. Januar um 00:30 Berliner Zeit noch als
 * 31. Dezember, und ein Mahnlauf um Mitternacht mahnte einen Tag zu frueh.
 */
const POSTEN_SQL = `
  select op.id, op.art, op.rechnung_id, r.nummer as rechnungsnummer,
         op.kunde_id, k.name as kunde_name,
         op.betrag_cent::text, op.bezahlt_cent::text, op.offen_cent::text,
         op.faellig_am::text, op.ausgeglichen_am::text,
         greatest(0, app.berlin_heute() - op.faellig_am) as ueberfaellig_tage
    from offener_posten op
    left join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
    left join kunde    k on k.id = op.kunde_id    and k.mandant_id = op.mandant_id`;

function alsPosten(z: PostenZeile): OffenerPosten {
  return {
    id: z.id,
    art: z.art,
    rechnungId: z.rechnung_id,
    rechnungsnummer: z.rechnungsnummer,
    kundeId: z.kunde_id,
    kundeName: z.kunde_name,
    betragCent: cent(BigInt(z.betrag_cent)),
    bezahltCent: cent(BigInt(z.bezahlt_cent)),
    offenCent: cent(BigInt(z.offen_cent)),
    faelligAm: z.faellig_am,
    ausgeglichenAm: z.ausgeglichen_am,
    ueberfaelligTage: Number(z.ueberfaellig_tage),
  };
}

export interface PostenFilter {
  /** `false` zeigt auch die ausgeglichenen — die Liste eines Kunden. */
  readonly nurOffene?: boolean;
  readonly kundeId?: string | null;
}

export async function offenePosten(
  db: Abfrage, filter: PostenFilter = {},
): Promise<readonly OffenerPosten[]> {
  const zeilen = await db.abfrage<PostenZeile>(
    `${POSTEN_SQL}
      where ($1::boolean is not true or op.ausgeglichen_am is null)
        and ($2::uuid is null or op.kunde_id = $2::uuid)
      order by op.faellig_am, r.nummer nulls last`,
    [filter.nurOffene ?? true, filter.kundeId ?? null]);
  return zeilen.map(alsPosten);
}

export async function postenZuRechnung(
  db: Abfrage, rechnungId: string,
): Promise<OffenerPosten | null> {
  const [zeile] = await db.abfrage<PostenZeile>(
    `${POSTEN_SQL} where op.rechnung_id = $1::uuid`, [rechnungId]);
  return zeile === undefined ? null : alsPosten(zeile);
}

async function postenGeladen(db: Abfrage, id: string): Promise<OffenerPosten> {
  const [zeile] = await db.abfrage<PostenZeile>(
    `${POSTEN_SQL} where op.id = $1::uuid`, [id]);
  if (zeile === undefined) {
    throw new ZahlungFehler('Der offene Posten ist nicht erreichbar.', 'nicht_gefunden');
  }
  return alsPosten(zeile);
}

// ---------------------------------------------------------------------------
// Zahlungen
// ---------------------------------------------------------------------------

export interface ZahlungErfassen {
  readonly richtung: 'eingang' | 'ausgang';
  readonly betragCent: Cent;
  /** Berliner Kalendertag als `YYYY-MM-DD`. */
  readonly zahlungsdatum: string;
  readonly valuta?: string | null;
  readonly zahlungsmittel: Zahlungsart;
  readonly bankkontoId?: string | null;
  readonly kasseId?: string | null;
  readonly referenz?: string | null;
  readonly notiz?: string | null;
}

export async function erfasseZahlung(
  db: Abfrage, eingabe: ZahlungErfassen,
): Promise<string> {
  if (eingabe.betragCent <= 0n) {
    throw new ZahlungFehler(
      'Eine Zahlung ueber null oder weniger ist keine. Die Richtung steht in '
      + '`richtung`, nicht im Vorzeichen.', 'abgewiesen');
  }
  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into zahlung (mandant_id, richtung, betrag_cent, zahlungsdatum, valuta,
                          zahlungsmittel, bankkonto_id, kasse_id, referenz, notiz,
                          erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::zahlung_richtung, $2::bigint, $3::date, $4::date,
             $5::zahlungsmittel, $6::uuid, $7::uuid, $8, $9,
             'mensch', app.aktueller_benutzer())
     returning id`,
    [eingabe.richtung, eingabe.betragCent.toString(), eingabe.zahlungsdatum,
     eingabe.valuta ?? null, eingabe.zahlungsmittel,
     eingabe.bankkontoId ?? null, eingabe.kasseId ?? null,
     eingabe.referenz ?? null, eingabe.notiz ?? null]);
  if (zeile === undefined) {
    throw new ZahlungFehler('Die Zahlung wurde nicht erfasst.', 'abgewiesen');
  }
  return zeile.id;
}

export interface ZuordnungEingabe {
  /** `null` nur bei `skonto` und `bauabzugsteuer_einbehalt` (§7.2). */
  readonly zahlungId: string | null;
  readonly offenerPostenId: string;
  readonly art: ZuordnungArt;
  readonly betragCent: Cent;
  readonly notiz?: string | null;
  readonly steuersatzGruppeId?: string | null;
  readonly skontoNettoCent?: Cent | null;
  readonly skontoSteuerCent?: Cent | null;
}

export async function ordneZu(
  db: Abfrage, eingabe: ZuordnungEingabe,
): Promise<string> {
  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into zahlung_zuordnung
       (mandant_id, zahlung_id, offener_posten_id, art, betrag_cent, notiz,
        steuersatz_gruppe_id, skonto_netto_cent, skonto_steuer_cent,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::zahlung_zuordnung_art,
             $4::bigint, $5, $6::uuid, $7::bigint, $8::bigint,
             'mensch', app.aktueller_benutzer())
     returning id`,
    [eingabe.zahlungId, eingabe.offenerPostenId, eingabe.art,
     eingabe.betragCent.toString(), eingabe.notiz ?? null,
     eingabe.steuersatzGruppeId ?? null,
     eingabe.skontoNettoCent?.toString() ?? null,
     eingabe.skontoSteuerCent?.toString() ?? null]);
  if (zeile === undefined) {
    throw new ZahlungFehler('Die Zuordnung wurde nicht angelegt.', 'abgewiesen');
  }
  return zeile.id;
}

// ---------------------------------------------------------------------------
// Der Zahlungseingang auf eine Rechnung — der Weg, den das Portal geht
// ---------------------------------------------------------------------------

export interface ZahlungseingangEingabe {
  readonly rechnungId: string;
  readonly betragCent: Cent;
  readonly zahlungsdatum: string;
  readonly valuta?: string | null;
  readonly zahlungsmittel: Zahlungsart;
  readonly bankkontoId?: string | null;
  readonly kasseId?: string | null;
  readonly referenz?: string | null;
  readonly notiz?: string | null;
}

export interface Zahlungseingang {
  readonly zahlungId: string;
  /** Was auf die Rechnung entfaellt. */
  readonly angerechnetCent: Cent;
  /** Was darueber hinaus kam — 0, wenn nichts. */
  readonly ueberzahlungCent: Cent;
  /** Der Guthabenposten, falls eine Ueberzahlung entstand. */
  readonly guthabenPostenId: string | null;
  /** Was nach dieser Zahlung offen bleibt. */
  readonly offenCent: Cent;
  readonly ausgeglichen: boolean;
}

/**
 * Eine Zahlung auf eine Rechnung buchen — mit dem einen Fall, den ein
 * Buchhaltungssystem nie stillschweigend behandeln darf.
 *
 * **Die Ueberzahlung.** Kommen 1.200 EUR auf eine Rechnung ueber 1.000 EUR,
 * gibt es drei Moeglichkeiten, und zwei davon sind falsch: den Rest
 * wegzuwerfen (der Kunde bekommt sein Geld nie zurueck) oder ihn auf die
 * Rechnung zu buchen (der Posten waere „mehr als bezahlt", und die
 * Forderungsliste stimmte nicht mehr). Richtig ist die dritte: 1.000 EUR auf
 * die Rechnung, 200 EUR als GUTHABEN des Kunden — eine Verbindlichkeit, die
 * offen bleibt, bis sie verrechnet oder erstattet wird. Der Rueckgabewert
 * nennt sie, damit die Oberflaeche sie zeigen kann und niemand erst im
 * naechsten Kontoauszug davon erfaehrt.
 *
 * **Warum das eine Transaktion sein muss.** Zahlung, Anrechnung, Guthaben und
 * dessen Zuordnung sind vier Schreibvorgaenge. Bricht es nach dem ersten ab,
 * steht eine Zahlung ohne Zuordnung in den Buechern und die Rechnung gilt
 * weiter als unbezahlt. `withTenant` haelt die ganze Anfrage in EINER
 * Transaktion — dieser Dienst verlaesst sich darauf und oeffnet keine zweite.
 */
export async function verbucheZahlungseingang(
  db: Abfrage, eingabe: ZahlungseingangEingabe,
): Promise<Zahlungseingang> {
  const posten = await postenZuRechnung(db, eingabe.rechnungId);
  if (posten === null) {
    throw new ZahlungFehler(
      'Zu dieser Rechnung gibt es keinen offenen Posten. Ein Entwurf fordert '
      + 'nichts; erst das Festschreiben eroeffnet die Forderung.', 'kein_posten');
  }
  if (posten.ausgeglichenAm !== null) {
    throw new ZahlungFehler(
      `Die Rechnung ist seit dem ${posten.ausgeglichenAm} ausgeglichen.`,
      'schon_ausgeglichen');
  }

  const zahlungId = await erfasseZahlung(db, {
    richtung: 'eingang',
    betragCent: eingabe.betragCent,
    zahlungsdatum: eingabe.zahlungsdatum,
    valuta: eingabe.valuta ?? null,
    zahlungsmittel: eingabe.zahlungsmittel,
    bankkontoId: eingabe.bankkontoId ?? null,
    kasseId: eingabe.kasseId ?? null,
    referenz: eingabe.referenz ?? null,
    notiz: eingabe.notiz ?? null,
  });

  const angerechnet = eingabe.betragCent > posten.offenCent
    ? posten.offenCent : eingabe.betragCent;
  const ueber = cent(eingabe.betragCent - angerechnet);

  await ordneZu(db, {
    zahlungId,
    offenerPostenId: posten.id,
    art: 'zahlung',
    betragCent: angerechnet,
  });

  let guthabenId: string | null = null;
  if (ueber > 0n) {
    if (posten.kundeId === null) {
      throw new ZahlungFehler(
        'Eine Ueberzahlung ohne Kunden laesst sich keinem Guthaben zuordnen.',
        'abgewiesen');
    }
    const [zeile] = await db.abfrage<{ id: string }>(
      `select fin.op_guthaben_eroeffnen($1::uuid, $2::bigint) as id`,
      [posten.kundeId, ueber.toString()]);
    if (zeile === undefined) {
      throw new ZahlungFehler('Das Guthaben wurde nicht eroeffnet.', 'abgewiesen');
    }
    guthabenId = zeile.id;
    await ordneZu(db, {
      zahlungId,
      offenerPostenId: guthabenId,
      art: 'ueberzahlung',
      betragCent: ueber,
    });
  }

  const danach = await postenGeladen(db, posten.id);
  return {
    zahlungId,
    angerechnetCent: angerechnet,
    ueberzahlungCent: ueber,
    guthabenPostenId: guthabenId,
    offenCent: danach.offenCent,
    ausgeglichen: danach.ausgeglichenAm !== null,
  };
}

// ---------------------------------------------------------------------------
// Der Zahlungsausgang an einen Lieferanten (V-216, D-707)
// ---------------------------------------------------------------------------

/**
 * Der Kreditorposten einer Eingangsrechnung — `null`, solange sie nicht
 * gebucht ist (erst `fin.op_kreditor_eroeffnen` eroeffnet ihn, 0123).
 */
export interface Kreditorposten {
  readonly id: string;
  readonly eingangsrechnungId: string;
  readonly lieferantId: string;
  readonly betragCent: Cent;
  readonly offenCent: Cent;
  readonly ausgeglichenAm: string | null;
}

export async function postenZuEingangsrechnung(
  db: Abfrage, eingangsrechnungId: string,
): Promise<Kreditorposten | null> {
  const [z] = await db.abfrage<{
    id: string; eingangsrechnung_id: string; lieferant_id: string;
    betrag_cent: string; offen_cent: string; ausgeglichen_am: string | null;
  }>(
    `select op.id, op.eingangsrechnung_id, op.lieferant_id,
            op.betrag_cent::text, op.offen_cent::text, op.ausgeglichen_am::text
       from offener_posten op
      where op.eingangsrechnung_id = $1::uuid and op.art = 'kreditor'`,
    [eingangsrechnungId]);
  if (z === undefined) return null;
  return {
    id: z.id, eingangsrechnungId: z.eingangsrechnung_id, lieferantId: z.lieferant_id,
    betragCent: cent(BigInt(z.betrag_cent)), offenCent: cent(BigInt(z.offen_cent)),
    ausgeglichenAm: z.ausgeglichen_am,
  };
}

export interface ZahlungsausgangEingabe {
  readonly eingangsrechnungId: string;
  readonly betragCent: Cent;
  /** Berliner Kalendertag als `YYYY-MM-DD`. */
  readonly zahlungsdatum: string;
  readonly valuta?: string | null;
  readonly zahlungsmittel: Zahlungsart;
  readonly bankkontoId?: string | null;
  readonly kasseId?: string | null;
  readonly referenz?: string | null;
  readonly notiz?: string | null;
}

export interface Zahlungsausgang {
  readonly zahlungId: string;
  /** Was auf die Eingangsrechnung entfaellt. */
  readonly angerechnetCent: Cent;
  /** Was darueber hinaus gezahlt wurde — 0, wenn nichts. */
  readonly ueberzahlungCent: Cent;
  /** Das Guthaben beim Lieferanten, falls eine Ueberzahlung entstand. */
  readonly guthabenPostenId: string | null;
  /** Was nach dieser Zahlung an den Lieferanten offen bleibt. */
  readonly offenCent: Cent;
  readonly ausgeglichen: boolean;
}

/**
 * **Eine Zahlung an einen Lieferanten erfassen** — das Gegenstück zu
 * `verbucheZahlungseingang` auf der Kreditorenseite (V-216, FIN-14).
 *
 * Bis hierher gab es ihn nicht: `fin.op_kreditor_eroeffnen` eröffnete beim
 * Buchen einer Eingangsrechnung einen Kreditorposten, und kein Weg glich ihn
 * je aus. Jede gebuchte Eingangsrechnung stand für immer als unbezahlt in
 * Offene Posten, Altersstruktur, Gruppensumme und Jahrespaket.
 *
 * **Erfasst wird, was geschehen ist — ausgelöst wird nichts.** Es gibt keine
 * Bankanbindung; die Überweisung macht ein Mensch in seinem Bankprogramm, und
 * hier steht danach, dass sie hinausging. Deshalb braucht es auch keine
 * Freigabe nach Invariante 7: nichts verlässt das System. Freigegeben wurde
 * die Rechnung selbst, bevor sie gebucht wurde.
 *
 * **Die Überzahlung** wie beim Eingang: der Teil über dem offenen Betrag
 * wird nicht auf die Rechnung gebucht (die Datenbank weist das ab) und nicht
 * weggeworfen, sondern ein GUTHABEN BEIM LIEFERANTEN (`kreditor_guthaben`,
 * 0447) — eine Forderung, bis sie verrechnet oder erstattet ist.
 *
 * Eine Transaktion mit dem Aufrufer (`withTenant`), wie beim Eingang: Zahlung,
 * Anrechnung, Guthaben und dessen Zuordnung stehen zusammen oder gar nicht.
 */
export async function verbucheZahlungsausgang(
  db: Abfrage, eingabe: ZahlungsausgangEingabe,
): Promise<Zahlungsausgang> {
  const posten = await postenZuEingangsrechnung(db, eingabe.eingangsrechnungId);
  if (posten === null) {
    throw new ZahlungFehler(
      'Zu dieser Eingangsrechnung gibt es keinen offenen Posten. Erst das Buchen '
      + 'eröffnet die Verbindlichkeit gegenüber dem Lieferanten.', 'kein_posten');
  }
  if (posten.ausgeglichenAm !== null) {
    throw new ZahlungFehler(
      `Die Eingangsrechnung ist seit dem ${tagDeutsch(posten.ausgeglichenAm)} bezahlt.`,
      'schon_ausgeglichen');
  }

  const zahlungId = await erfasseZahlung(db, {
    richtung: 'ausgang',
    betragCent: eingabe.betragCent,
    zahlungsdatum: eingabe.zahlungsdatum,
    valuta: eingabe.valuta ?? null,
    zahlungsmittel: eingabe.zahlungsmittel,
    bankkontoId: eingabe.bankkontoId ?? null,
    kasseId: eingabe.kasseId ?? null,
    referenz: eingabe.referenz ?? null,
    notiz: eingabe.notiz ?? null,
  });

  const angerechnet = eingabe.betragCent > posten.offenCent
    ? posten.offenCent : eingabe.betragCent;
  const ueber = cent(eingabe.betragCent - angerechnet);

  await ordneZu(db, {
    zahlungId,
    offenerPostenId: posten.id,
    art: 'zahlung',
    betragCent: angerechnet,
  });

  let guthabenId: string | null = null;
  if (ueber > 0n) {
    const [zeile] = await db.abfrage<{ id: string }>(
      `select fin.op_kreditor_guthaben_eroeffnen($1::uuid, $2::bigint) as id`,
      [posten.lieferantId, ueber.toString()]);
    if (zeile === undefined) {
      throw new ZahlungFehler('Das Guthaben beim Lieferanten wurde nicht eroeffnet.',
        'abgewiesen');
    }
    guthabenId = zeile.id;
    await ordneZu(db, {
      zahlungId,
      offenerPostenId: guthabenId,
      art: 'ueberzahlung',
      betragCent: ueber,
    });
  }

  const danach = await postenZuEingangsrechnung(db, eingabe.eingangsrechnungId);
  return {
    zahlungId,
    angerechnetCent: angerechnet,
    ueberzahlungCent: ueber,
    guthabenPostenId: guthabenId,
    offenCent: danach?.offenCent ?? cent(0n),
    ausgeglichen: danach !== null && danach.ausgeglichenAm !== null,
  };
}

/**
 * Der §48-EStG-Einbehalt loescht den Rest, ohne dass Geld kommt (§7.2).
 *
 * Ohne diesen Weg bliebe auf jeder Rechnung eines bauabzugspflichtigen Kunden
 * genau der Einbehalt offen — 15 % der Rechnungssumme, dauerhaft, in jeder
 * Altersliste und in jedem Mahnlauf. Der Kunde hat ihn ans Finanzamt abgefuehrt
 * und schuldet ihn nicht mehr.
 *
 * Er wird NICHT beim Festschreiben gebucht: ob und wann der Kunde ihn
 * tatsaechlich einbehaelt, weiss die Gesellschaft erst, wenn sie den
 * Zahlungseingang sieht.
 */
export async function bucheBauabzug(
  db: Abfrage, rechnungId: string,
): Promise<{ readonly betragCent: Cent; readonly offenCent: Cent }> {
  const [kopf] = await db.abfrage<{ einbehalt: string; posten_id: string | null }>(
    `select r.einbehalt_bauabzugsteuer_cent::text as einbehalt,
            op.id as posten_id
       from rechnung r
       left join offener_posten op
              on op.rechnung_id = r.id and op.mandant_id = r.mandant_id
      where r.id = $1::uuid`, [rechnungId]);
  if (kopf === undefined) {
    throw new ZahlungFehler('Die Rechnung ist nicht erreichbar.', 'nicht_gefunden');
  }
  if (kopf.posten_id === null) {
    throw new ZahlungFehler('Zu dieser Rechnung gibt es keinen offenen Posten.', 'kein_posten');
  }
  const einbehalt = cent(BigInt(kopf.einbehalt));
  if (einbehalt <= 0n) {
    throw new ZahlungFehler(
      'Diese Rechnung weist keinen Bauabzugsteuer-Einbehalt aus.', 'abgewiesen');
  }

  /**
   * **Einmal, nicht je Klick.**
   *
   * Auf der Rechnung steht EIN Einbehaltsbetrag. Zweimal gebucht — zwei
   * Klicks, ein Wiederholungsversuch nach einer Zeitüberschreitung — tilgte
   * die zweite Zeile einen Rest, den niemand bezahlt hat, und die Forderung
   * gälte als ausgeglichen.
   *
   * Die eigentliche Sperre ist der Teilindex `zz_bauabzug_je_posten` (0130):
   * zwei gleichzeitige Aufrufe finden hier beide nichts, und genau dann muss
   * die Datenbank den zweiten auflaufen lassen. Diese Abfrage ist für die
   * MELDUNG da — „schon gebucht" statt eines Indexfehlers, den niemand liest.
   */
  const [schon] = await db.abfrage<{ n: string }>(
    `select count(*)::text as n from zahlung_zuordnung
      where offener_posten_id = $1::uuid and art = 'bauabzugsteuer_einbehalt'`,
    [kopf.posten_id]);
  if (schon !== undefined && schon.n !== '0') {
    throw new ZahlungFehler(
      'Der Einbehalt nach §48 EStG ist für diese Rechnung bereits gebucht. '
      + 'Eine Rechnung weist genau einen aus.', 'abgewiesen');
  }

  await ordneZu(db, {
    zahlungId: null,
    offenerPostenId: kopf.posten_id,
    art: 'bauabzugsteuer_einbehalt',
    betragCent: einbehalt,
    notiz: 'Einbehalt nach §48 EStG, abgefuehrt vom Leistungsempfaenger.',
  });

  const danach = await postenGeladen(db, kopf.posten_id);
  return { betragCent: einbehalt, offenCent: danach.offenCent };
}

/**
 * Eine falsch erfasste Zahlung zurueckhemen — durch Storno, nie durch Loeschen
 * (Invariante 8). Der Ausloeser `fin.zahlung_storniert` gibt die Posten
 * wieder frei; hier steht nur der Grund, den er nicht kennen kann.
 */
export async function storniereZahlung(
  db: Abfrage, zahlungId: string, grund: string,
): Promise<void> {
  if (grund.trim().length < 5) {
    throw new ZahlungFehler(
      'Ein Zahlungsstorno nennt seinen Grund — er steht spaeter allein in den '
      + 'Buechern.', 'abgewiesen');
  }
  const zeilen = await db.abfrage<{ id: string }>(
    `update zahlung
        set storniert_am = now(), storno_grund = $2,
            geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and storniert_am is null
      returning id`, [zahlungId, grund.trim()]);
  if (zeilen.length === 0) {
    throw new ZahlungFehler(
      'Die Zahlung ist nicht erreichbar oder bereits storniert.', 'storniert');
  }
}

// ---------------------------------------------------------------------------
// Posten gegen Posten (§7.4)
// ---------------------------------------------------------------------------

export interface AusgleichEingabe {
  readonly sollPostenId: string;
  readonly habenPostenId: string;
  readonly betragCent: Cent;
  readonly grund: string;
  readonly rechnungBeziehungId?: string | null;
}

export async function gleicheAus(
  db: Abfrage, eingabe: AusgleichEingabe,
): Promise<string> {
  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into op_ausgleich (mandant_id, op_soll_id, op_haben_id, betrag_cent,
                               grund, rechnung_beziehung_id,
                               erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::bigint, $4, $5::uuid,
             'mensch', app.aktueller_benutzer())
     returning id`,
    [eingabe.sollPostenId, eingabe.habenPostenId, eingabe.betragCent.toString(),
     eingabe.grund.trim(), eingabe.rechnungBeziehungId ?? null]);
  if (zeile === undefined) {
    throw new ZahlungFehler('Der Ausgleich wurde nicht gebucht.', 'abgewiesen');
  }
  return zeile.id;
}

// ---------------------------------------------------------------------------
// Was zu einer Rechnung gebucht wurde — fuer die Belegansicht
// ---------------------------------------------------------------------------

export interface Buchungszeile {
  readonly id: string;
  /** Die Zahlung dahinter — `null` bei Skonto und Einbehalt (V-216: für den Verweis). */
  readonly zahlungId: string | null;
  readonly art: ZuordnungArt;
  readonly betragCent: Cent;
  readonly zahlungsdatum: string | null;
  readonly zahlungsmittel: Zahlungsart | null;
  readonly storniertAm: string | null;
  readonly notiz: string | null;
}

export async function buchungenZuPosten(
  db: Abfrage, postenId: string,
): Promise<readonly Buchungszeile[]> {
  const zeilen = await db.abfrage<{
    id: string; zahlung_id: string | null; art: ZuordnungArt; betrag_cent: string;
    zahlungsdatum: string | null; zahlungsmittel: Zahlungsart | null;
    storniert_am: string | null; notiz: string | null;
  }>(
    `select zz.id, zz.zahlung_id, zz.art, zz.betrag_cent::text,
            z.zahlungsdatum::text, z.zahlungsmittel, z.storniert_am::text, zz.notiz
       from zahlung_zuordnung zz
       left join zahlung z on z.id = zz.zahlung_id and z.mandant_id = zz.mandant_id
      where zz.offener_posten_id = $1::uuid
      order by zz.erstellt_am`, [postenId]);
  return zeilen.map((z) => ({
    id: z.id,
    zahlungId: z.zahlung_id,
    art: z.art,
    betragCent: cent(BigInt(z.betrag_cent)),
    zahlungsdatum: z.zahlungsdatum,
    zahlungsmittel: z.zahlungsmittel,
    storniertAm: z.storniert_am,
    notiz: z.notiz,
  }));
}
