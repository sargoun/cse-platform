import 'server-only';
import { createHash } from 'node:crypto';
import type { Speicher } from '../../../storage/adapter.js';
import { legeErzeugtAb } from '../../dokument/erzeugt.js';
import { leseCamt053, type CamtAuszug } from './camt.js';
import {
  schlageVor, darfAutomatischBuchen, type OffenerPosten, type Vorschlag,
} from './abgleich.js';

/**
 * Einen Kontoauszug einlesen und abgleichen (ACC-04, PR 61).
 *
 * **Der Import ist idempotent über den Prüfwert der DATEI.** Dieselbe Datei
 * ein zweites Mal hochzuladen fügt nichts hinzu und meldet, dass sie schon
 * da ist (Abnahme 1). Über den Inhalt und nicht über `auszug_id`: zwei Banken
 * vergeben ihre Auszugsnummern unabhängig voneinander.
 *
 * **Ein Umsatz wird nie automatisch gebucht, ausser er ist EINDEUTIG.**
 * Betrag UND Rechnungsnummer UND IBAN — alles darunter geht in die Schlange.
 * Der Vorschlag steht mit seiner Begründung an der Zeile, damit dort nicht
 * nur steht, DASS sie wartet, sondern warum.
 *
 * **Nichts wird gerechnet.** Die Beträge kommen als ganze Cent aus dem
 * Leser; dieser Dienst vergleicht sie und legt sie ab (Invariante 1).
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  readonly aktiverMandantId: string;
}

export class ImportFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'kein_bankkonto' | 'falsches_konto' | 'leer' | 'klaerung',
  ) {
    super(nachricht);
    this.name = 'ImportFehler';
  }
}

export interface ImportErgebnis {
  readonly auszugId: string;
  /** `false`, wenn diese Datei schon eingelesen war — dann ist nichts passiert. */
  readonly neu: boolean;
  readonly zeilen: number;
  readonly automatischZugeordnet: number;
  readonly inKlaerung: number;
  readonly dokumentId: string | null;
}

interface BankkontoRoh {
  readonly id: string;
  readonly iban: string;
}

/**
 * Liest, legt ab, gleicht ab.
 *
 * `jetzt` kommt herein und wird nicht hier gelesen — der Aufbewahrungslauf
 * braucht das Jahr der Entstehung, und ein Test soll es setzen können
 * (Invariante 5).
 */
export async function importiereAuszug(
  db: Abfrage, speicher: Speicher, datei: Uint8Array, jetzt: Date,
): Promise<ImportErgebnis> {
  const mandantId = db.aktiverMandantId;
  /*
   * **Gehasht und abgelegt werden die BYTES der Datei, nicht ihr Text.**
   *
   * Die erste Fassung nahm den dekodierten Text entgegen und kodierte ihn
   * fuer Pruefwert und Archiv neu: eine Byte-Order-Mark oder eine ungueltige
   * Sequenz verschwand dabei, zwei verschiedene Dateien konnten denselben
   * Pruefwert tragen, und die Archivkopie war nicht mehr die Datei, die die
   * Bank geliefert hat. Der Text entsteht hier nur zum Lesen.
   */
  const bytes = datei;
  const xml = new TextDecoder('utf-8').decode(datei);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  /*
   * **Der Prüfwert ZUERST.** Vor dem Parsen, vor jeder Abfrage über offene
   * Posten: ist die Datei bekannt, ist der Rest verschwendete Arbeit — und
   * schlimmer, ein zweiter Abgleich könnte Zuordnungen vorschlagen, die es
   * längst gibt.
   */
  const [schon] = await db.abfrage<{ id: string; zeilen: number }>(
    'select id, zeilen from kontoauszug where mandant_id = $1 and datei_sha256 = $2',
    [mandantId, sha256]);
  if (schon !== undefined) {
    return {
      auszugId: schon.id, neu: false, zeilen: schon.zeilen,
      automatischZugeordnet: 0, inKlaerung: 0, dokumentId: null,
    };
  }

  const auszug: CamtAuszug = leseCamt053(xml);
  if (auszug.umsaetze.length === 0) {
    throw new ImportFehler(
      `Der Auszug ${auszug.auszugId} enthält keine Umsätze. Eine leere Datei `
      + 'einzulesen ergäbe einen Auszug, der nichts aussagt.',
      'leer');
  }

  const bankkonto = await findeBankkonto(db, auszug.iban);

  const dokumentId = await legeAb(db, speicher, auszug, bytes, jetzt);

  const [neu] = await db.schreibe<{ id: string }>(
    `insert into kontoauszug
       (mandant_id, bankkonto_id, auszug_id, von, bis, datei_sha256, dokument_id,
        anfangssaldo_cent, endsaldo_cent, zeilen, erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, $3, $4::date, $5::date, $6, $7::uuid,
             $8::bigint, $9::bigint, $10::integer, 'mensch', app.aktueller_benutzer())
     returning id`,
    [mandantId, bankkonto.id, auszug.auszugId, auszug.von, auszug.bis, sha256,
      dokumentId, auszug.anfangssaldoCent?.toString() ?? null,
      auszug.endsaldoCent?.toString() ?? null, auszug.umsaetze.length]);
  if (neu === undefined) {
    throw new ImportFehler(
      'Der Auszug liess sich nicht anlegen — fehlt zahlung.schreiben?', 'leer');
  }

  const offene = await ladeOffenePosten(db);
  let automatisch = 0;
  let klaerung = 0;

  for (const [i, u] of auszug.umsaetze.entries()) {
    /*
     * **Eine Vormerkung wird nicht abgeglichen.** `PDNG` heisst, die Bank hat
     * noch nicht gebucht; der Betrag kann sich ändern oder ganz entfallen.
     * Eine Rechnung darauf als bezahlt zu setzen wäre eine Aussage über Geld,
     * das noch nicht da ist.
     */
    const vorschlag: Vorschlag = u.gebucht
      ? schlageVor(u, offene)
      : {
        art: 'kein_treffer',
        kandidaten: [],
        begruendung:
          'Eine Vormerkung (PDNG) wird nicht zugeordnet — die Bank hat noch '
          + 'nicht gebucht, und der Betrag kann sich noch ändern.',
      };

    const zustand = darfAutomatischBuchen(vorschlag) ? 'zugeordnet' : 'in_klaerung';
    if (zustand === 'zugeordnet') automatisch += 1; else klaerung += 1;

    const [zeile] = await db.schreibe<{ id: string }>(
      `insert into kontoumsatz
         (mandant_id, kontoauszug_id, laufnummer, richtung, betrag_cent,
          buchungsdatum, valuta, referenz, verwendungszweck, gegenpartei,
          gegen_iban, gebucht, zustand, vorschlag_art, vorschlag_text)
       values ($1::uuid, $2::uuid, $3::integer, $4::zahlung_richtung, $5::bigint,
               $6::date, $7::date, $8, $9, $10, $11, $12::boolean,
               $13::umsatz_zustand, $14, $15)
       returning id`,
      [mandantId, neu.id, i + 1, u.richtung, u.betragCent.toString(),
        u.buchungsdatum, u.valuta, u.referenz, u.verwendungszweck,
        u.gegenpartei, u.gegenIban, u.gebucht, zustand,
        vorschlag.art, vorschlag.begruendung]);

    if (zeile !== undefined && zustand === 'zugeordnet') {
      await ordneZu(db, zeile.id, u, vorschlag, bankkonto.id, true);
    }
  }

  return {
    auszugId: neu.id,
    neu: true,
    zeilen: auszug.umsaetze.length,
    automatischZugeordnet: automatisch,
    inKlaerung: klaerung,
    dokumentId,
  };
}

/**
 * Das Bankkonto zur IBAN des Auszugs.
 *
 * **Ein Auszug landet nie auf dem falschen Konto.** Nennt die Datei keine
 * IBAN, wird geraten — und ein geratenes Konto verschiebt jeden Umsatz in
 * die falsche Kasse. Deshalb wirft die Funktion, statt das erste Konto zu
 * nehmen.
 */
async function findeBankkonto(db: Abfrage, iban: string | null): Promise<BankkontoRoh> {
  if (iban === null) {
    throw new ImportFehler(
      'Der Auszug nennt keine IBAN. Welches Bankkonto er betrifft, lässt sich '
      + 'nicht raten — und ein geratenes verschöbe jeden Umsatz in die falsche '
      + 'Kasse.',
      'kein_bankkonto');
  }
  const sauber = iban.toUpperCase().replace(/[^A-Z0-9]/gu, '');
  const [konto] = await db.abfrage<BankkontoRoh>(
    `select id, iban from bankkonto
      where iban = $1 and archiviert_am is null`,
    [sauber]);
  if (konto === undefined) {
    throw new ImportFehler(
      `Für die IBAN ${sauber} ist kein Bankkonto hinterlegt. Der Auszug wird `
      + 'nicht eingelesen, solange nicht feststeht, wohin er gehört.',
      'falsches_konto');
  }
  return konto;
}

/**
 * Die offenen Posten, gegen die abgeglichen wird.
 *
 * **Die IBAN des Kunden ist GELERNT, nicht gepflegt.** `kunde` trägt keine —
 * und das ist richtig so: der Kunde zahlt an uns, wir brauchen seine
 * Bankverbindung für nichts. Als drittes Merkmal des Abgleichs (ACC-04) ist
 * sie trotzdem das stärkste, denn sie lässt sich nicht abtippen.
 *
 * Sie kommt deshalb aus der Vergangenheit: die IBAN, von der derselbe Kunde
 * zuletzt über eine BESTÄTIGTE Zuordnung gezahlt hat. Beim ersten Mal gibt es
 * keine — dann bleibt der Treffer `eindeutig_ohne_iban` und ein Mensch sieht
 * ihn an. Genau so soll es sein: die Regel wird mit jeder bestätigten Zahlung
 * schärfer, statt von Anfang an mehr zu behaupten, als sie weiss.
 *
 * `distinct on` nimmt je Kunde die jüngste; eine widerrufene Zuordnung zählt
 * nicht, denn sie war der Fehlgriff, aus dem nicht gelernt werden soll.
 *
 * **Der Betrag wird an DIESER Grenze in `bigint` verwandelt, nicht später.**
 * `postgres.js` liefert eine `bigint`-Spalte als STRING — die Typannotation
 * `offenCent: bigint` war eine Behauptung, die zur Laufzeit niemand einlöst.
 * Der Vergleich `"119000" === 119000n` ist dann immer falsch, und der
 * Abgleich fand nie einen Treffer: kein Fehler, keine Meldung, nur eine
 * Schlange, die sich nie leerte. Ein Isolationstest hat es gefunden.
 *
 * Deshalb eine eigene Rohzeile mit `string` und eine Umwandlung, die der
 * Übersetzer erzwingt.
 */
interface PostenRoh {
  readonly id: string;
  readonly rechnungId: string;
  readonly nummer: string;
  readonly offenCent: string;
  readonly kundeIban: string | null;
}

async function ladeOffenePosten(db: Abfrage): Promise<readonly OffenerPosten[]> {
  const roh = await db.abfrage<PostenRoh>(
    `with gelernt as (
       select distinct on (r.kunde_id) r.kunde_id, u.gegen_iban
         from umsatz_zuordnung uz
         join kontoumsatz u on u.id = uz.kontoumsatz_id and u.mandant_id = uz.mandant_id
         join zahlung_zuordnung zz on zz.zahlung_id = uz.zahlung_id
                                  and zz.mandant_id = uz.mandant_id
         join offener_posten o on o.id = zz.offener_posten_id and o.mandant_id = zz.mandant_id
         join rechnung r on r.id = o.rechnung_id and r.mandant_id = o.mandant_id
        where uz.widerrufen_am is null and u.gegen_iban is not null
        order by r.kunde_id, uz.erstellt_am desc
     )
     select op.id, op.rechnung_id as "rechnungId", r.nummer,
            op.offen_cent as "offenCent",
            g.gegen_iban as "kundeIban"
       from offener_posten op
       join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
       left join gelernt g on g.kunde_id = r.kunde_id
      where op.offen_cent > 0
        and op.ausgeglichen_am is null
        and r.nummer is not null`);
  return roh.map((z) => ({
    id: z.id,
    rechnungId: z.rechnungId,
    nummer: z.nummer,
    offenCent: BigInt(z.offenCent),
    kundeIban: z.kundeIban,
  }));
}

/**
 * Legt die Zahlung an und verbindet sie mit dem Umsatz.
 *
 * **Die Zahlung entsteht HIER und nicht beim Einlesen.** Ein Umsatz ist die
 * Behauptung der Bank; eine Zahlung ist eine Buchung. Die beiden zu
 * verschmelzen hiesse, dass jeder unzugeordnete Umsatz als Zahlung in der
 * Buchhaltung stünde.
 */
async function ordneZu(
  db: Abfrage, umsatzId: string, umsatz: { betragCent: bigint; buchungsdatum: string;
    valuta: string | null; referenz: string | null },
  vorschlag: Vorschlag, bankkontoId: string, automatisch: boolean,
): Promise<void> {
  const posten = vorschlag.kandidaten[0];
  if (posten === undefined) return;

  /*
   * Der Akteur folgt dem Weg: der Abgleich beim Einlesen ist ein Dienst, die
   * Bestaetigung aus der Klaerung ein Mensch — und `zahlung_akteur_stimmig`
   * verlangt, dass beides zusammenpasst (ein Mensch traegt seine Kennung, ein
   * Dienst seinen Namen).
   */
  const akteur = automatisch
    ? { art: 'system', dienst: 'dienst:bankabgleich', benutzer: 'null' }
    : { art: 'mensch', dienst: 'null', benutzer: 'app.aktueller_benutzer()' };

  const [zahlung] = await db.schreibe<{ id: string }>(
    `insert into zahlung
       (mandant_id, richtung, betrag_cent, zahlungsdatum, valuta, zahlungsmittel,
        bankkonto_id, referenz, erstellt_von_art, erstellt_von_dienst, erstellt_von)
     values ($1::uuid, 'eingang', $2::bigint, $3::date, $4::date,
             'ueberweisung', $5::uuid, $6, '${akteur.art}'::akteur_art,
             ${akteur.dienst === 'null' ? 'null' : `'${akteur.dienst}'`}, ${akteur.benutzer})
     returning id`,
    [db.aktiverMandantId, umsatz.betragCent.toString(), umsatz.buchungsdatum,
      umsatz.valuta, bankkontoId, umsatz.referenz]);
  if (zahlung === undefined) return;

  await db.schreibe(
    `insert into zahlung_zuordnung
       (mandant_id, zahlung_id, offener_posten_id, art, betrag_cent,
        erstellt_von_art, erstellt_von_dienst, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, 'zahlung', $4::bigint,
             '${akteur.art}'::akteur_art,
             ${akteur.dienst === 'null' ? 'null' : `'${akteur.dienst}'`}, ${akteur.benutzer})`,
    [db.aktiverMandantId, zahlung.id, posten.id, umsatz.betragCent.toString()]);

  await db.schreibe(
    `insert into umsatz_zuordnung
       (mandant_id, kontoumsatz_id, zahlung_id, automatisch, begruendung,
        erstellt_von_art, erstellt_von_dienst, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4::boolean, $5,
             '${akteur.art}'::akteur_art,
             ${akteur.dienst === 'null' ? 'null' : `'${akteur.dienst}'`}, ${akteur.benutzer})`,
    [db.aktiverMandantId, umsatzId, zahlung.id, automatisch, vorschlag.begruendung]);
}

// ---------------------------------------------------------------------------
// Die Klaerung — ein Mensch entscheidet, was der Abgleich nicht konnte
// ---------------------------------------------------------------------------

/**
 * Was die Klaerung zurueckgibt: die Zeile, ihren Auszug, und ob der Auszug
 * damit fertig ist.
 */
export interface KlaerungErgebnis {
  readonly umsatzId: string;
  readonly auszugId: string;
  /** `true`, wenn keine Zeile des Auszugs mehr offen oder in Klaerung ist. */
  readonly auszugAbgeglichen: boolean;
}

interface OffenerUmsatzRoh {
  readonly id: string;
  readonly kontoauszug_id: string;
  readonly bankkonto_id: string;
  readonly richtung: string;
  readonly betrag_cent: string;
  readonly buchungsdatum: string;
  readonly valuta: string | null;
  readonly referenz: string | null;
  readonly gebucht: boolean;
  readonly zustand: string;
}

/**
 * Die Zeile, ueber die entschieden wird — GESPERRT, damit zwei Menschen sie
 * nicht gleichzeitig zwei Rechnungen zuordnen.
 */
async function ladeOffenenUmsatz(db: Abfrage, umsatzId: string): Promise<OffenerUmsatzRoh> {
  const [u] = await db.abfrage<OffenerUmsatzRoh>(
    `select u.id, u.kontoauszug_id, a.bankkonto_id, u.richtung::text as richtung,
            u.betrag_cent::text, u.buchungsdatum::text, u.valuta::text, u.referenz,
            u.gebucht, u.zustand::text as zustand
       from kontoumsatz u
       join kontoauszug a on a.id = u.kontoauszug_id and a.mandant_id = u.mandant_id
      where u.id = $1::uuid
      for update of u`,
    [umsatzId]);
  if (u === undefined) {
    throw new ImportFehler('Diesen Umsatz gibt es nicht.', 'klaerung');
  }
  if (u.zustand !== 'offen' && u.zustand !== 'in_klaerung') {
    throw new ImportFehler(
      `Der Umsatz ist bereits entschieden (${u.zustand}). Eine Entscheidung wird `
      + 'nicht ueberschrieben; eine falsche Zuordnung wird widerrufen.',
      'klaerung');
  }
  return u;
}

/**
 * **Ein Mensch bestaetigt eine Zuordnung** — der Weg, den der Abgleich beim
 * Einlesen fuer alles Mehrdeutige offenlaesst (ACC-04).
 *
 * Bis hierher gab es ihn nicht: `in_klaerung` war ein Zustand ohne Ausgang,
 * die Schlange konnte sich nie leeren und kein Auszug je `abgeglichen`
 * werden. Die Seite versprach, dass ein Mensch entscheidet, und bot ihm
 * nichts, womit.
 *
 * Nur ein GEBUCHTER Zahlungseingang wird einer Forderung zugeordnet; eine
 * Vormerkung bleibt, was sie ist. Der Betrag der Zahlung ist der Betrag der
 * Bank — hier wird nichts gerechnet, auch keine Teilzahlung erfunden.
 */
export async function bestaetigeZuordnung(
  db: Abfrage, umsatzId: string, offenerPostenId: string,
): Promise<KlaerungErgebnis> {
  const u = await ladeOffenenUmsatz(db, umsatzId);
  if (!u.gebucht) {
    throw new ImportFehler(
      'Eine Vormerkung (PDNG) wird nicht zugeordnet — die Bank hat noch nicht gebucht.',
      'klaerung');
  }
  if (u.richtung !== 'eingang') {
    throw new ImportFehler(
      'Nur ein Zahlungseingang wird einer Forderung zugeordnet. Ein Ausgang ist '
      + 'keine Kundenzahlung.',
      'klaerung');
  }
  const [posten] = await db.abfrage<{
    id: string; rechnung_id: string; nummer: string; offen_cent: string;
  }>(
    `select op.id, op.rechnung_id, r.nummer, op.offen_cent::text
       from offener_posten op
       join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
      where op.id = $1::uuid and op.ausgeglichen_am is null and op.offen_cent > 0`,
    [offenerPostenId]);
  if (posten === undefined) {
    throw new ImportFehler(
      'Dieser Posten ist nicht offen — er ist ausgeglichen oder gehoert nicht hierher.',
      'klaerung');
  }

  await ordneZu(db, u.id, {
    betragCent: BigInt(u.betrag_cent), buchungsdatum: u.buchungsdatum,
    valuta: u.valuta, referenz: u.referenz,
  }, {
    art: 'eindeutig_ohne_iban',
    kandidaten: [{
      id: posten.id, rechnungId: posten.rechnung_id, nummer: posten.nummer,
      offenCent: BigInt(posten.offen_cent), kundeIban: null,
    }],
    begruendung: `Von Hand zugeordnet zu ${posten.nummer}`,
  }, u.bankkonto_id, false);

  await db.schreibe(
    `update kontoumsatz
        set zustand = 'zugeordnet', klaerungsnotiz = $2,
            geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid`,
    [u.id, `Von Hand zugeordnet zu ${posten.nummer}`]);

  return {
    umsatzId: u.id, auszugId: u.kontoauszug_id,
    auszugAbgeglichen: await schliesseAuszugWennFertig(db, u.kontoauszug_id),
  };
}

/**
 * **Ein Mensch sagt: gehoert zu keiner Rechnung** — Gebuehr, Zins, Privat,
 * Fehlueberweisung. Die Notiz ist Pflicht (0135 erzwingt fuenf Zeichen), weil
 * ein Umsatz ohne Bezug und ohne Grund spaeter niemandem mehr etwas sagt.
 */
export async function markiereOhneBezug(
  db: Abfrage, umsatzId: string, notiz: string,
): Promise<KlaerungErgebnis> {
  const text = notiz.trim();
  if (text.length < 5) {
    throw new ImportFehler(
      'Ohne Begruendung bleibt der Umsatz in Klaerung — „ohne Bezug" braucht '
      + 'einen Satz, der spaeter allein steht.',
      'klaerung');
  }
  const u = await ladeOffenenUmsatz(db, umsatzId);
  await db.schreibe(
    `update kontoumsatz
        set zustand = 'ohne_bezug', klaerungsnotiz = $2,
            geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid`,
    [u.id, text]);
  return {
    umsatzId: u.id, auszugId: u.kontoauszug_id,
    auszugAbgeglichen: await schliesseAuszugWennFertig(db, u.kontoauszug_id),
  };
}

/** Der Auszug ist abgeglichen, wenn keine Zeile mehr wartet — und nur dann. */
async function schliesseAuszugWennFertig(db: Abfrage, auszugId: string): Promise<boolean> {
  const [rest] = await db.abfrage<{ offen: number }>(
    `select count(*)::int as offen from kontoumsatz
      where kontoauszug_id = $1::uuid and zustand in ('offen', 'in_klaerung')`,
    [auszugId]);
  if (rest === undefined || rest.offen > 0) return false;
  await db.schreibe(
    `update kontoauszug set status = 'abgeglichen'
      where id = $1::uuid and status = 'eingelesen'`,
    [auszugId]);
  return true;
}

/** Die Datei ins Archiv — ohne verbundenen Speicher gibt es kein Dokument. */
async function legeAb(
  db: Abfrage, speicher: Speicher, auszug: CamtAuszug, bytes: Uint8Array, jetzt: Date,
): Promise<string | null> {
  if (!speicher.verbunden) return null;

  const titel = `Kontoauszug ${auszug.auszugId}`;
  const hoch = await legeErzeugtAb(
    {
      mandantId: db.aktiverMandantId,
      kategorie: 'buchhaltung',
      titel,
      dateiname: `camt053-${auszug.auszugId.replace(/[^A-Za-z0-9_-]/gu, '-')}.xml`,
      daten: bytes,
      mimeTyp: 'application/xml',
      bucket: 'archiv',
    },
    speicher, Number((auszug.bis ?? auszug.von ?? '').slice(0, 4))
      || jetzt.getUTCFullYear());

  try {
    await db.schreibe(
      `insert into dokument (id, mandant_id, kategorie, titel, mime_typ,
                             mime_verifiziert, groesse_bytes, bucket,
                             objekt_schluessel, exif_entfernt, aufbewahrung_bis,
                             loeschsperre, entstanden_am, erstellt_von)
       values ($1::uuid, $2::uuid, 'buchhaltung', $3, $4, true, $5::bigint, $6,
               $7, false, $8::date, $9, $10::date, app.aktueller_benutzer())`,
      [hoch.dokumentId, db.aktiverMandantId, titel, hoch.mimeTyp,
        String(hoch.groesseBytes), hoch.bucket, hoch.objektSchluessel,
        hoch.aufbewahrungBis, hoch.loeschsperre,
        /* Entstehungstag (§ 147 Abs. 4 AO): der Auszugstag; ohne einen der Tag der Ablage. */
        auszug.bis ?? auszug.von ?? null]);
    await db.schreibe(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ, erstellt_von)
       values ($1::uuid, $2::uuid, 1, $3, $4, $5::bigint, $6, app.aktueller_benutzer())`,
      [db.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
        hoch.sha256, String(hoch.groesseBytes), hoch.mimeTyp]);
    return hoch.dokumentId;
  } catch (fehler) {
    try {
      await speicher.entferne(hoch.bucket, hoch.objektSchluessel);
    } catch {
      /* Der urspruengliche Fehler wird davon nicht verdeckt. */
    }
    throw fehler;
  }
}
