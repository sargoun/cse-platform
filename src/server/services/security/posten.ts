/**
 * Der Posten — die zu besetzende Wachposition (SEC-01, SEC-04, TIM-04).
 *
 * **Die Mindestbesetzung ist hier eine Sperre und in der Datenbank keine, und
 * das ist kein Widerspruch.** Ein unterbesetzter Plan muss SPEICHERBAR sein,
 * sonst kann niemand planen: der Generator legt acht Wochen Postenschichten
 * an, bevor irgendwer eingeteilt ist, und der Waechter „morgen unbesetzt"
 * braucht die unbesetzte Zeile, um sie zu finden (`03-GEWERKE.md` §6.3). Was
 * NICHT gehen darf, ist etwas anderes: eine Besetzung als fertig zu melden,
 * die die zugesagte Mindeststaerke nicht erreicht.
 *
 * Beide Auskuenfte kommen deshalb aus EINER Quelle — der Sicht
 * `posten_unterbesetzung` (0069). Zwei Abfragen fuer eine Aussage laufen beim
 * ersten Eingriff auseinander, und dann meldet der Waechter etwas anderes als
 * der Knopf, den der Planer drueckt.
 *
 * **Was dieser Dienst NICHT tut: veroeffentlichen.** Die Freigabe eines
 * Planungszeitraums an die Belegschaft ist `dienstplan.veroeffentlichen`
 * (`04-SEITENKARTE.md` §5.10, TIM-01/NOT-01) und gehoert der Dienstplandomaene.
 * Hier steht ihr TOR: die Zusage, dass ein Zeitraum nicht als besetzt
 * durchgeht, solange eine Postenschicht unter ihrer Mindeststaerke liegt.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { pruefeLeistungsanker } from '../dienstplan/leistungsanker.js';
import { generiereSofort } from '../dienstplan/generator.js';

/** Eine Postenschicht unter ihrer Mindestbesetzung — die Zeile der Sicht. */
export interface Unterbesetzung {
  readonly einsatzId: string;
  readonly postenId: string;
  readonly postenBezeichnung: string;
  readonly objektId: string;
  /** Berliner Ortszeit, fertig aus der Datenbank (Invariante 2). */
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly minBesetzung: number;
  readonly sollBesetzung: number;
  readonly besetztAnzahl: number;
  readonly fehlend: number;
}

interface RohZeile {
  readonly einsatz_id: string;
  readonly posten_id: string;
  readonly posten_bezeichnung: string;
  readonly objekt_id: string;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly min_besetzung: number;
  readonly soll_besetzung: number;
  readonly besetzt_anzahl: number;
  readonly fehlend: number;
}

function ausZeile(z: RohZeile): Unterbesetzung {
  return {
    einsatzId: z.einsatz_id,
    postenId: z.posten_id,
    postenBezeichnung: z.posten_bezeichnung,
    objektId: z.objekt_id,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    minBesetzung: Number(z.min_besetzung),
    sollBesetzung: Number(z.soll_besetzung),
    besetztAnzahl: Number(z.besetzt_anzahl),
    fehlend: Number(z.fehlend),
  };
}

export interface Fenster {
  /** Berliner Kalendertag, `YYYY-MM-DD`. */
  readonly von: string;
  readonly bis: string;
  /** Nur dieser Posten; ohne ihn alle Posten des Mandanten. */
  readonly postenId?: string | null;
}

/**
 * Die Dringlichkeitsabfrage (SPEC §14, SEC-01).
 *
 * Sie liest die Sicht und NICHT die Tabellen: die Sicht traegt
 * `security_invoker`, also gilt die Zeilenpolitik des Aufrufers, und sie
 * vergleicht die Werte, die BEI DER PLANUNG galten — ein spaeter angehobenes
 * Minimum macht eine damals rechtmaessig besetzte Nacht nicht rueckwirkend
 * unterbesetzt.
 *
 * Das Fenster wird in BERLINER Kalendertagen genannt und in der Datenbank zu
 * Zeitpunkten aufgeloest (K-11). `von` schliesst ein, `bis` schliesst den
 * ganzen Tag ein — ein Tagesfenster, das um Mitternacht endet, liesse die
 * Nachtschicht genau des gefragten Tages heraus.
 */
export async function unterbesetzung(
  kontext: LeseKontext, fenster: Fenster,
): Promise<readonly Unterbesetzung[]> {
  const zeilen = await kontext.abfrage<RohZeile>(
    `select u.einsatz_id, u.posten_id, u.posten_bezeichnung, u.objekt_id,
            to_char(u.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as beginn_lokal,
            to_char(u.ende_zeitpunkt   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as ende_lokal,
            u.min_besetzung, u.soll_besetzung, u.besetzt_anzahl, u.fehlend
       from posten_unterbesetzung u
      where u.beginn_zeitpunkt >= ($1::date)::timestamp at time zone 'Europe/Berlin'
        and u.beginn_zeitpunkt <  (($2::date) + 1)::timestamp at time zone 'Europe/Berlin'
        and ($3::uuid is null or u.posten_id = $3::uuid)
      order by u.beginn_zeitpunkt`,
    [fenster.von, fenster.bis, fenster.postenId ?? null],
  );
  return zeilen.map(ausZeile);
}

/**
 * Der Befund, der die Veroeffentlichung anhaelt.
 *
 * Er traegt die Luecken MIT, weil „unterbesetzt" allein nichts ist, woran ein
 * Planer arbeiten koennte: er muss wissen, welche Nacht wie viele Wachen
 * braucht.
 */
export class PostenUnterbesetzt extends Error {
  readonly code = 'unterbesetzt';
  readonly status = 422;
  readonly luecken: readonly Unterbesetzung[];
  constructor(luecken: readonly Unterbesetzung[]) {
    const erste = luecken[0];
    super(
      `${String(luecken.length)} Postenschicht(en) liegen unter ihrer Mindestbesetzung `
      + `und werden nicht als besetzt veröffentlicht`
      + (erste === undefined
        ? '.'
        : ` — zuerst ${erste.postenBezeichnung} am ${erste.beginnLokal}: `
          + `${String(erste.besetztAnzahl)} von ${String(erste.minBesetzung)}.`),
    );
    this.name = 'PostenUnterbesetzt';
    this.luecken = luecken;
  }
}

/**
 * Das Tor vor der Veroeffentlichung (Abnahme 1).
 *
 * Es WIRFT, statt einen Wahrheitswert zurueckzugeben, den ein Aufrufer
 * vergessen kann — dieselbe Entscheidung wie bei `assertZuordnungZulaessig`
 * (SEC-04). Wer den Zeitraum trotzdem freigeben will, muss die Besetzung
 * aendern; es gibt hier keinen Uebergehen-Schalter, weil die Mindestbesetzung
 * eine Zusage an den Auftraggeber ist und keine Warnung an den Planer.
 */
export async function assertBesetzungVeroeffentlichbar(
  kontext: LeseKontext, fenster: Fenster,
): Promise<void> {
  const luecken = await unterbesetzung(kontext, fenster);
  if (luecken.length > 0) throw new PostenUnterbesetzt(luecken);
}

/** Ein Posten mit seiner Abdeckung — die Zeile der Uebersicht. */
export interface PostenZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly kurzzeichen: string | null;
  readonly objektId: string;
  readonly objekt: string;
  readonly art: string | null;
  readonly artIstPlatzhalter: boolean;
  readonly minBesetzung: number;
  readonly sollBesetzung: number;
  readonly abdeckungRrule: string | null;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
  readonly anforderungen: number;
  /** Schichten im Fenster, und wie viele davon unter dem Minimum liegen. */
  readonly schichten: number;
  readonly unterbesetzt: number;
}

interface RohPosten {
  readonly id: string;
  readonly bezeichnung: string;
  readonly kurzzeichen: string | null;
  readonly objekt_id: string;
  readonly objekt: string;
  readonly art: string | null;
  readonly art_platzhalter: boolean | null;
  readonly min_besetzung: number;
  readonly soll_besetzung: number;
  readonly abdeckung_rrule: string | null;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  readonly anforderungen: number;
  readonly schichten: number;
  readonly unterbesetzt: number;
}

/**
 * Die Postenuebersicht mit der Abdeckung im Fenster.
 *
 * EINE Abfrage, nicht eine je Posten: die Seite zeigt je Zeile drei Zahlen,
 * und drei Rundreisen mal N Posten sind der Unterschied zwischen einer Liste
 * und einer Wartezeit.
 */
export async function postenUebersicht(
  kontext: LeseKontext, fenster: { readonly von: string; readonly bis: string },
): Promise<readonly PostenZeile[]> {
  const zeilen = await kontext.abfrage<RohPosten>(
    `select p.id, p.bezeichnung, p.kurzzeichen, p.objekt_id,
            o.bezeichnung as objekt,
            pa.bezeichnung as art, pa.ist_platzhalter as art_platzhalter,
            p.min_besetzung, p.soll_besetzung, p.abdeckung_rrule,
            to_char(p.gueltig_ab,  'YYYY-MM-DD') as gueltig_ab,
            to_char(p.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
            (select count(*) from einsatzanforderung ea
              where ea.posten_id = p.id and ea.archiviert_am is null) as anforderungen,
            (select count(*) from einsatz e
              where e.posten_id = p.id and e.storniert_am is null
                and e.beginn_zeitpunkt >= ($1::date)::timestamp at time zone 'Europe/Berlin'
                and e.beginn_zeitpunkt <  (($2::date) + 1)::timestamp at time zone 'Europe/Berlin')
              as schichten,
            (select count(*) from posten_unterbesetzung u
              where u.posten_id = p.id
                and u.beginn_zeitpunkt >= ($1::date)::timestamp at time zone 'Europe/Berlin'
                and u.beginn_zeitpunkt <  (($2::date) + 1)::timestamp at time zone 'Europe/Berlin')
              as unterbesetzt
       from posten p
       join objekt o on o.id = p.objekt_id and o.mandant_id = p.mandant_id
       left join postenart pa on pa.id = p.postenart_id and pa.mandant_id = p.mandant_id
      where p.archiviert_am is null
      order by o.bezeichnung, p.bezeichnung`,
    [fenster.von, fenster.bis],
  );
  return zeilen.map((z) => ({
    id: z.id,
    bezeichnung: z.bezeichnung,
    kurzzeichen: z.kurzzeichen,
    objektId: z.objekt_id,
    objekt: z.objekt,
    art: z.art,
    // Ohne Art gibt es keine unbestaetigte Art — `false`, nicht `null`.
    artIstPlatzhalter: z.art_platzhalter === true,
    minBesetzung: Number(z.min_besetzung),
    sollBesetzung: Number(z.soll_besetzung),
    abdeckungRrule: z.abdeckung_rrule,
    gueltigAb: z.gueltig_ab,
    gueltigBis: z.gueltig_bis,
    anforderungen: Number(z.anforderungen),
    schichten: Number(z.schichten),
    unterbesetzt: Number(z.unterbesetzt),
  }));
}

export class PostenEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'PostenEingabeFehlt';
  }
}

export interface PostenEingabe {
  readonly objektId: string;
  readonly bezeichnung: string;
  readonly kurzzeichen?: string | null;
  readonly postenartId?: string | null;
  readonly minBesetzung: number;
  readonly sollBesetzung: number;
  readonly abdeckungRrule?: string | null;
  /** Wanduhr ohne Zone, `YYYY-MM-DDTHH:MM` (§10.1) — nur mit einer RRULE. */
  readonly dtstartLokal?: string | null;
  readonly dauerMinuten?: number | null;
  readonly gueltigAb: string;
  readonly gueltigBis?: string | null;
  /**
   * Die Leistungszeile, an deren Abrechnung die Zeit dieses Postens hängt
   * (TIM-12, V-191). Der Generator schreibt sie auf jede Schicht, der
   * Zeiteintrag erbt sie von dort (`z_erben`).
   */
  readonly auftragLeistungId?: string | null;
}

/**
 * Legt einen Posten an.
 *
 * Die Pruefungen hier sind die, die eine gute Meldung brauchen; die Bedingungen
 * in der Datenbank sind die, die gelten muessen, auch wenn dieser Dienst
 * umgangen wird (0069). Beide sind da, und das ist Absicht — nicht die eine
 * statt der anderen.
 */
export async function legePostenAn(
  kontext: SchreibKontext, eingabe: PostenEingabe,
): Promise<string> {
  if (eingabe.bezeichnung.trim() === '') {
    throw new PostenEingabeFehlt('Ein Posten braucht eine Bezeichnung.');
  }
  if (!Number.isInteger(eingabe.minBesetzung) || eingabe.minBesetzung < 1) {
    throw new PostenEingabeFehlt(
      'Die Mindestbesetzung ist mindestens 1 — eine Position wird von einem Menschen besetzt.',
    );
  }
  if (eingabe.sollBesetzung < eingabe.minBesetzung) {
    throw new PostenEingabeFehlt(
      'Die Sollbesetzung liegt nicht unter der Mindestbesetzung.',
    );
  }
  const rrule = eingabe.abdeckungRrule?.trim() ?? '';
  const dtstart = eingabe.dtstartLokal?.trim() ?? '';
  if ((rrule === '') !== (dtstart === '')) {
    throw new PostenEingabeFehlt(
      'Abdeckungsregel und Startanker gehören zusammen: eine Regel ohne Anker zählt '
      + 'nichts auf, ein Anker ohne Regel ist eine Uhrzeit ohne Bedeutung. Ein '
      + 'durchgehend besetzter Posten lässt beide leer.',
    );
  }

  const anker = eingabe.auftragLeistungId ?? null;
  // Vor dem Schreiben, mit Satz — nicht als Fremdschluesselfehler (V-191).
  if (anker !== null) await pruefeLeistungsanker(kontext, anker);

  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into posten
       (mandant_id, objekt_id, postenart_id, bezeichnung, kurzzeichen,
        min_besetzung, soll_besetzung, abdeckung_rrule, dtstart_lokal, dauer_minuten,
        gueltig_ab, gueltig_bis, auftrag_leistung_id, erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5,
             $6::smallint, $7::smallint, $8, $9::timestamp, $10::integer,
             $11::date, $12::date, $14::uuid, 'mensch', $13::uuid)
     returning id`,
    [
      kontext.aktiverMandantId, eingabe.objektId, eingabe.postenartId ?? null,
      eingabe.bezeichnung.trim(),
      eingabe.kurzzeichen?.trim() === '' ? null : eingabe.kurzzeichen ?? null,
      eingabe.minBesetzung, eingabe.sollBesetzung,
      rrule === '' ? null : rrule,
      dtstart === '' ? null : dtstart,
      eingabe.dauerMinuten ?? null,
      eingabe.gueltigAb, eingabe.gueltigBis ?? null,
      kontext.benutzerId, anker,
    ],
  );
  if (zeile === undefined) {
    // Null Zeilen aus einem INSERT heisst: die Zeilenpolitik hat ihn
    // abgewiesen. Das ist kein Erfolg mit leerem Ergebnis.
    throw new PostenEingabeFehlt(
      'Der Posten wurde nicht angelegt — das Objekt gehört nicht zu dieser Gesellschaft, '
      + 'oder die Sitzung darf hier nicht schreiben.',
    );
  }
  return zeile.id;
}

/**
 * Die Leistungszeile eines Postens setzen, ändern oder lösen (V-191, TIM-12).
 *
 * Der Posten hatte keinen Weg dafür: `posten.auftrag_leistung_id` stand seit
 * 0069 samt Fremdschlüssel da, und nur der Seed schrieb ihn. Danach läuft der
 * Generator sofort — er schreibt den Anker auf die KÜNFTIGEN Schichten ohne
 * erfasste Zeit (derselbe Weg wie die Turnuspflege, `aendereTurnus`). Was
 * schon Zeit trägt, behält seinen Anker: der Zeiteintrag hat ihn beim Anlegen
 * übernommen (`z_erben`), und die Vergangenheit wird nicht umgeschrieben.
 *
 * Geprüft wird der neue Anker nur, wenn er sich ändert.
 */
export async function setzePostenLeistung(
  kontext: SchreibKontext, postenId: string, auftragLeistungId: string | null,
): Promise<void> {
  const [bisher] = await kontext.abfrage<{ anker: string | null }>(
    `select auftrag_leistung_id::text as anker from posten
      where id = $1::uuid and archiviert_am is null`, [postenId]);
  if (bisher === undefined) {
    throw new PostenEingabeFehlt('Diesen Posten gibt es in dieser Gesellschaft nicht.');
  }
  if (auftragLeistungId !== null && auftragLeistungId !== bisher.anker) {
    await pruefeLeistungsanker(kontext, auftragLeistungId);
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update posten
        set auftrag_leistung_id = $2::uuid,
            geaendert_am = now(), geaendert_von_art = 'mensch'::akteur_art,
            geaendert_von = $3::uuid
      where id = $1::uuid and archiviert_am is null
      returning id`, [postenId, auftragLeistungId, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new PostenEingabeFehlt(
      'Der Posten wurde nicht geändert — die Sitzung darf hier nicht schreiben.');
  }
  await generiereSofort(
    { unsafe: (sql, werte) => kontext.schreibe<unknown>(sql, werte) },
    kontext.aktiverMandantId);
}
