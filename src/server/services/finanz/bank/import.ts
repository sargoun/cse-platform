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
    readonly grund: 'kein_bankkonto' | 'falsches_konto' | 'leer',
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
  db: Abfrage, speicher: Speicher, xml: string, jetzt: Date,
): Promise<ImportErgebnis> {
  const mandantId = db.aktiverMandantId;
  const bytes = new TextEncoder().encode(xml);
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

  const [zahlung] = await db.schreibe<{ id: string }>(
    `insert into zahlung
       (mandant_id, richtung, betrag_cent, zahlungsdatum, valuta, zahlungsmittel,
        bankkonto_id, referenz, erstellt_von_art, erstellt_von_dienst)
     values ($1::uuid, 'eingang', $2::bigint, $3::date, $4::date,
             'ueberweisung', $5::uuid, $6, 'system', 'dienst:bankabgleich')
     returning id`,
    [db.aktiverMandantId, umsatz.betragCent.toString(), umsatz.buchungsdatum,
      umsatz.valuta, bankkontoId, umsatz.referenz]);
  if (zahlung === undefined) return;

  await db.schreibe(
    `insert into zahlung_zuordnung
       (mandant_id, zahlung_id, offener_posten_id, art, betrag_cent,
        erstellt_von_art, erstellt_von_dienst)
     values ($1::uuid, $2::uuid, $3::uuid, 'zahlung', $4::bigint,
             'system', 'dienst:bankabgleich')`,
    [db.aktiverMandantId, zahlung.id, posten.id, umsatz.betragCent.toString()]);

  await db.schreibe(
    `insert into umsatz_zuordnung
       (mandant_id, kontoumsatz_id, zahlung_id, automatisch, begruendung,
        erstellt_von_art, erstellt_von_dienst)
     values ($1::uuid, $2::uuid, $3::uuid, $4::boolean, $5,
             'system', 'dienst:bankabgleich')`,
    [db.aktiverMandantId, umsatzId, zahlung.id, automatisch, vorschlag.begruendung]);
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
                             loeschsperre, erstellt_von)
       values ($1::uuid, $2::uuid, 'buchhaltung', $3, $4, true, $5::bigint, $6,
               $7, false, $8::date, $9, app.aktueller_benutzer())`,
      [hoch.dokumentId, db.aktiverMandantId, titel, hoch.mimeTyp,
        String(hoch.groesseBytes), hoch.bucket, hoch.objektSchluessel,
        hoch.aufbewahrungBis, hoch.loeschsperre]);
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
