/**
 * Die Behinderungsanzeige nach § 6 VOB/B (BAU-06, 03-GEWERKE §7.11).
 *
 * Vier Zusagen, und jede hat einen konkreten Ausfall dahinter:
 *
 *  1. **Sie entsteht aus einer VORLAGE.** Der Text kommt aus
 *     `behinderung_vorlage` und die Platzhalter werden hier gesetzt — ein
 *     unbekannter Platzhalter wird ABGEWIESEN, nie leer gelassen. Ein
 *     Schreiben mit `{ursache}` darin geht an den Auftraggeber und ist
 *     peinlich; eines mit einer stillschweigend geleerten Angabe ist
 *     gefaehrlich, weil § 6 Abs. 1 VOB/B genau diese Angaben verlangt.
 *  2. **Das Absendedatum ist dokumentiert und kommt vom SERVER.** Es wird
 *     nur gesetzt, wenn ein freigegebener Versand TATSAECHLICH stattgefunden
 *     hat (API-KARTE §C), und der Ausloeser `behinderung_versandzeit` stempelt
 *     den Berliner Kalendertag des Servers. Ein zurueckdatiertes
 *     Behinderungsschreiben waere im Bauzeitenstreit bares Geld wert — und
 *     genau deshalb darf es diesen Weg nicht geben.
 *  3. **Sie wird als DOKUMENT archiviert.** Nicht als Datenbankzeile, die
 *     behauptet, es gebe eines: `ladeHoch` legt das erzeugte PDF im privaten
 *     Bucket ab (DOC-01, DOC-03), und `versand_dokument_id` zeigt darauf.
 *     Ist der Speicher nicht verbunden, wird NICHTS dokumentiert — kein
 *     Absendedatum, kein Zustandswechsel, kein vorgetaeuschter Erfolg.
 *  4. **Der Versand laeuft durch `server/agent/policy.ts`.** Ohne genehmigte
 *     Freigabe mit benanntem Menschen und mit einem Hash, der zum ANGEZEIGTEN
 *     Text passt, geht nichts hinaus (Invariante 7, APR-07). Wer nach der
 *     Freigabe den Text aendert, hat keine Freigabe mehr fuer das, was er
 *     sendet.
 *
 * **Die elektronischen Kanaele sind nicht verbunden.** Es gibt in dieser
 * Anwendung keinen Mailversand — `MailerPort` existiert nicht (O-116,
 * 07-INTEGRATIONEN §9). `e_mail` und `portal` werden deshalb mit
 * `KanalNichtVerbundenFehler` abgewiesen und nicht simuliert (CLAUDE.md:
 * keine Schein-Integrationen). Brief, Einschreiben, Bote und
 * Bauleiterprotokoll dagegen sind MENSCHLICHE Kanaele: dort versendet ein
 * Mensch und dokumentiert es hier — das ist kein nachgebauter Erfolg, sondern
 * der reale Vorgang.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { gate, nutzlastHash, type Freigabe, type Nutzlast, type Richtlinie }
  from '../../agent/policy.js';
import type { Speicher } from '../../storage/adapter.js';
import { ladeHoch } from '../dokument/upload.js';
import { schreibeTextPdf } from '../dokument/pdf.js';

export type BehinderungStatus =
  | 'entwurf' | 'freigegeben' | 'angezeigt' | 'weggefallen' | 'abgeschlossen';

/** § 6 Abs. 2 VOB/B kennt genau diese drei Risikosphaeren. */
export type BehinderungGrund = 'risikobereich_ag' | 'streik_aussperrung' | 'hoehere_gewalt';

export type Versandart =
  | 'e_mail' | 'brief' | 'einschreiben' | 'bote' | 'bauleiterprotokoll' | 'portal';

/**
 * Die Kanaele, die ein MENSCH bedient — hier wird dokumentiert, was er getan
 * hat, nicht ein Versand nachgebaut.
 */
export const MENSCHLICHE_KANAELE: readonly Versandart[] =
  ['brief', 'einschreiben', 'bote', 'bauleiterprotokoll'];

/** Die Kanaele, fuer die es in dieser Anwendung keinen Anschluss gibt. */
export const ELEKTRONISCHE_KANAELE: readonly Versandart[] = ['e_mail', 'portal'];

export const GRUND_TEXT: Readonly<Record<BehinderungGrund, string>> = {
  risikobereich_ag: 'Umstand aus dem Risikobereich des Auftraggebers (§ 6 Abs. 2 Nr. 1 a VOB/B)',
  streik_aussperrung: 'Streik oder Aussperrung (§ 6 Abs. 2 Nr. 1 b VOB/B)',
  hoehere_gewalt: 'Höhere Gewalt oder andere unabwendbare Umstände (§ 6 Abs. 2 Nr. 1 c VOB/B)',
};

export const VERSANDART_TEXT: Readonly<Record<Versandart, string>> = {
  e_mail: 'E-Mail',
  brief: 'Brief',
  einschreiben: 'Einschreiben',
  bote: 'Bote',
  bauleiterprotokoll: 'Bauleiterprotokoll',
  portal: 'Vergabe-/Projektportal',
};

export class BehinderungFehler extends Error {
  readonly status = 409 as const;
  constructor(
    readonly grund:
      | 'nicht_gefunden' | 'keine_vorlage' | 'platzhalter_unbekannt'
      | 'bereits_angezeigt' | 'ohne_freigabe' | 'ohne_text',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'BehinderungFehler';
  }
}

/** Der Kanal ist nicht angeschlossen — und es wird nichts vorgetaeuscht. */
export class KanalNichtVerbundenFehler extends Error {
  readonly status = 409 as const;
  readonly code = 'KANAL_NICHT_VERBUNDEN' as const;
  constructor(readonly kanal: Versandart) {
    super(
      `Der Kanal „${VERSANDART_TEXT[kanal]}" ist nicht verbunden — es sind keine `
      + 'Zugangsdaten konfiguriert (O-116). Es wurde NICHTS versendet und nichts '
      + 'dokumentiert. Brief, Einschreiben, Bote und Bauleiterprotokoll gehen.',
    );
    this.name = 'KanalNichtVerbundenFehler';
  }
}

/* ---------------------------------------------------------------------------
 * 1. Die Vorlage (BAU-06)
 * ------------------------------------------------------------------------ */

export interface VorlageZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly fundstelle: string;
  readonly betreff: string;
  readonly rumpf: string;
  /** §1.16: unbestaetigt, solange O-23 offen ist. */
  readonly ist_platzhalter: boolean;
}

export async function ladeVorlagen(
  kontext: LeseKontext,
): Promise<readonly VorlageZeile[]> {
  return kontext.abfrage<VorlageZeile>(
    `select v.id, v.schluessel, v.bezeichnung, v.fundstelle, v.betreff, v.rumpf,
            v.ist_platzhalter
       from behinderung_vorlage v
      where v.archiviert_am is null
      order by v.schluessel`,
  );
}

export async function findeVorlage(
  kontext: LeseKontext, schluessel: string,
): Promise<VorlageZeile | null> {
  const [zeile] = await kontext.abfrage<VorlageZeile>(
    `select v.id, v.schluessel, v.bezeichnung, v.fundstelle, v.betreff, v.rumpf,
            v.ist_platzhalter
       from behinderung_vorlage v
      where v.schluessel = $1 and v.archiviert_am is null`,
    [schluessel],
  );
  return zeile ?? null;
}

/** Die Angaben, die § 6 Abs. 1 VOB/B selbst verlangt, plus Absender. */
export interface Vorlagenwerte {
  readonly projekt: string;
  readonly ursache: string;
  readonly grund: string;
  readonly beginn: string;
  readonly auswirkung: string;
  readonly absender: string;
}

/**
 * Setzt die Platzhalter — und weist einen unbekannten AB.
 *
 * Die naheliegende Fassung — unbekannte Platzhalter stehen lassen oder leeren
 * — hat zwei Ausfaelle, und beide gehen an den Auftraggeber hinaus: eine
 * offene geschweifte Klammer im Schreiben, oder eine fehlende Angabe, die § 6
 * Abs. 1 VOB/B ausdruecklich verlangt. Beides faellt erst auf, wenn das
 * Schreiben draussen ist.
 */
export function setzeVorlage(text: string, werte: Vorlagenwerte): string {
  const bekannt = werte as unknown as Record<string, string>;
  return text.replace(/\{([a-z_]+)\}/gu, (_treffer, name: string) => {
    const wert = bekannt[name];
    if (typeof wert !== 'string') {
      throw new BehinderungFehler(
        'platzhalter_unbekannt',
        `Die Vorlage verlangt den Platzhalter „{${name}}", den dieser Vorgang nicht `
        + 'kennt. Das Schreiben wird NICHT erzeugt — eine Behinderungsanzeige mit '
        + 'einer offenen Klammer oder einer stillschweigend geleerten Angabe geht '
        + 'an den Auftraggeber hinaus (§ 6 Abs. 1 VOB/B).',
      );
    }
    return wert;
  });
}

/** Betreff und Rumpf zusammen — genau das, was archiviert und gesendet wird. */
export function baueAnzeigetext(vorlage: VorlageZeile, werte: Vorlagenwerte): string {
  return `${setzeVorlage(vorlage.betreff, werte)}\n\n${setzeVorlage(vorlage.rumpf, werte)}`;
}

/* ---------------------------------------------------------------------------
 * 2. Lesen
 * ------------------------------------------------------------------------ */

export interface BehinderungZeile {
  readonly id: string;
  readonly nummer: string;
  readonly status: BehinderungStatus;
  readonly projekt_id: string;
  readonly projekt: string;
  readonly projekt_nummer: string;
  readonly grund_kategorie: BehinderungGrund;
  readonly ursache: string;
  readonly beginn_lokal: string;
  readonly ende_lokal: string | null;
  /** BAU-06: das dokumentierte Absendedatum. */
  readonly angezeigt_lokal: string | null;
  readonly versandart: Versandart | null;
  readonly empfaenger: string | null;
  readonly versand_dokument_id: string | null;
  readonly wegfall_lokal: string | null;
  readonly anzeigetext: string | null;
  readonly vorlage_schluessel: string | null;
  readonly auswirkung_tage: number | null;
  readonly freigabe_id: string | null;
  readonly freigegeben_lokal: string | null;
  readonly storniert: boolean;
}

const B_SPALTEN = `
  b.id, b.nummer, b.status::text as status, b.projekt_id,
  p.bezeichnung as projekt, p.nummer as projekt_nummer,
  b.grund_kategorie::text as grund_kategorie, b.ursache,
  to_char(b.beginn_am, 'DD.MM.YYYY') as beginn_lokal,
  to_char(b.ende_am, 'DD.MM.YYYY') as ende_lokal,
  to_char(b.angezeigt_am, 'DD.MM.YYYY') as angezeigt_lokal,
  b.versandart::text as versandart, b.empfaenger, b.versand_dokument_id,
  to_char(b.wegfall_angezeigt_am, 'DD.MM.YYYY') as wegfall_lokal,
  b.anzeigetext, b.vorlage_schluessel, b.auswirkung_tage, b.freigabe_id,
  to_char(b.freigegeben_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
    as freigegeben_lokal,
  (b.storniert_am is not null) as storniert`;

export async function listeBehinderungen(
  kontext: LeseKontext,
  filter: { readonly projektId?: string | null } = {},
): Promise<readonly BehinderungZeile[]> {
  return kontext.abfrage<BehinderungZeile>(
    `select ${B_SPALTEN}
       from behinderung b
       join projekt p on p.id = b.projekt_id and p.mandant_id = b.mandant_id
      where ($1::uuid is null or b.projekt_id = $1::uuid)
      order by b.beginn_am desc, b.nummer desc`,
    [filter.projektId ?? null],
  );
}

export async function findeBehinderung(
  kontext: LeseKontext, id: string,
): Promise<BehinderungZeile | null> {
  const [zeile] = await kontext.abfrage<BehinderungZeile>(
    `select ${B_SPALTEN}
       from behinderung b
       join projekt p on p.id = b.projekt_id and p.mandant_id = b.mandant_id
      where b.id = $1`,
    [id],
  );
  return zeile ?? null;
}

/* ---------------------------------------------------------------------------
 * 3. Anlegen — aus der Vorlage
 * ------------------------------------------------------------------------ */

export interface BehinderungEingabe {
  readonly projektId: string;
  readonly vorlageSchluessel: string;
  readonly grundKategorie: BehinderungGrund;
  readonly ursache: string;
  /** Berliner Kalendertag `YYYY-MM-DD`. */
  readonly beginnAm: string;
  readonly auswirkung: string;
  readonly auswirkungTage?: number | null;
  readonly absender: string;
}

/**
 * Legt den ENTWURF an — mit dem erzeugten Text, ohne Absendedatum.
 *
 * `angezeigt_am` bleibt hier leer. Eine Anzeige wirkt, wenn sie beim
 * Auftraggeber ist, nicht wenn sie geschrieben wurde; ein beim Anlegen
 * gesetztes Datum waere die Behauptung, sie sei hinausgegangen.
 */
export async function erstelleBehinderung(
  kontext: SchreibKontext, eingabe: BehinderungEingabe,
): Promise<{ readonly id: string; readonly nummer: string; readonly anzeigetext: string }> {
  const vorlage = await findeVorlage(kontext, eingabe.vorlageSchluessel);
  if (vorlage === null) {
    throw new BehinderungFehler(
      'keine_vorlage',
      `Zu „${eingabe.vorlageSchluessel}" gibt es keine Vorlage. BAU-06 verlangt, dass `
      + 'die Anzeige aus einer Vorlage entsteht — freien Text gibt es hier nicht.',
    );
  }
  if (eingabe.ursache.trim() === '') {
    throw new BehinderungFehler(
      'ohne_text',
      'Die hindernden Umstände sind Pflicht (§ 6 Abs. 1 VOB/B) — ohne sie ist die '
      + 'Anzeige unwirksam.',
    );
  }

  const [projekt] = await kontext.abfrage<{ bezeichnung: string; nummer: string }>(
    `select p.bezeichnung, p.nummer from projekt p where p.id = $1`,
    [eingabe.projektId],
  );
  if (projekt === undefined) {
    throw new BehinderungFehler('nicht_gefunden', 'Projekt nicht gefunden.');
  }

  /**
   * Das Datum wird fuer den Text in Berliner Schreibweise formatiert — von
   * POSTGRES, nicht von Node (Invariante 2, PHASE-5-STAND). Ein Node-Prozess
   * in UTC formatierte denselben Tag gelegentlich als den davor.
   */
  const [datum] = await kontext.abfrage<{ lokal: string }>(
    `select to_char($1::date, 'DD.MM.YYYY') as lokal`, [eingabe.beginnAm],
  );

  const anzeigetext = baueAnzeigetext(vorlage, {
    projekt: `${projekt.nummer} · ${projekt.bezeichnung}`,
    ursache: eingabe.ursache.trim(),
    grund: GRUND_TEXT[eingabe.grundKategorie],
    beginn: datum?.lokal ?? eingabe.beginnAm,
    auswirkung: eingabe.auswirkung.trim() === ''
      ? 'noch nicht abschließend bezifferbar'
      : eingabe.auswirkung.trim(),
    absender: eingabe.absender,
  });

  const [kopf] = await kontext.schreibe<{ id: string; nummer: string }>(
    `insert into behinderung (mandant_id, projekt_id, nummer, status, grund_kategorie,
                              ursache, beginn_am, anzeigetext, vorlage_schluessel,
                              auswirkung_tage, erstellt_von)
     select $1, p.id,
            'B' || lpad((coalesce(
              (select max(nullif(regexp_replace(b2.nummer, '\\D', '', 'g'), '')::bigint)
                 from behinderung b2 where b2.projekt_id = p.id), 0) + 1)::text, 3, '0'),
            'entwurf', $3::behinderung_grund, $4, $5::date, $6, $7, $8::int,
            app.aktueller_benutzer()
       from projekt p
      where p.id = $2 and p.mandant_id = $1
     returning id, nummer`,
    [
      kontext.aktiverMandantId, eingabe.projektId, eingabe.grundKategorie,
      eingabe.ursache.trim(), eingabe.beginnAm, anzeigetext, vorlage.schluessel,
      eingabe.auswirkungTage ?? null,
    ],
  );
  if (kopf === undefined) {
    throw new BehinderungFehler('nicht_gefunden', 'Projekt nicht gefunden.');
  }
  return { ...kopf, anzeigetext };
}

/* ---------------------------------------------------------------------------
 * 4. Der Versand — durch das Tor, und nur durch das Tor
 * ------------------------------------------------------------------------ */

/**
 * Die Nutzlast, die freigegeben und deren Hash gebunden wird.
 *
 * Sie enthaelt den TEXT und den EMPFAENGER. Beides gehoert hinein, weil eine
 * Freigabe, die den Empfaenger nicht bindet, ein freigegebenes Schreiben an
 * eine andere Adresse zulaesst (07-INTEGRATIONEN §8, `MailerPort.sende`).
 */
export function behinderungNutzlast(
  mandantId: string,
  daten: {
    readonly behinderungId: string;
    readonly nummer: string;
    readonly projekt: string;
    readonly empfaenger: string;
    readonly versandart: Versandart;
    readonly anzeigetext: string;
  },
): Nutzlast {
  return {
    aktion: 'behinderung_senden',
    mandantId,
    /**
     * `vertrag` und nicht `keine`: § 7 UWG trifft Werbung. Eine
     * Behinderungsanzeige ist eine vertraglich geschuldete Erklaerung nach
     * § 6 Abs. 1 VOB/B an den Vertragspartner — sie bewirbt nichts.
     * // TODO(client, O-65): Fuer welche ausgehenden Nachrichtenarten gilt die
     * §-7-UWG-Einwilligungsschranke und fuer welche nicht — Mahnung,
     * Behinderungsanzeige, Bewerberantwort, Lieferantenrueckfrage?
     */
    empfaengerRechtsgrundlage: 'vertrag',
    inhalt: {
      behinderungId: daten.behinderungId,
      nummer: daten.nummer,
      projekt: daten.projekt,
      empfaenger: daten.empfaenger,
      versandart: daten.versandart,
      anzeigetext: daten.anzeigetext,
    },
  };
}

export { nutzlastHash };

export interface VersandEingabe {
  readonly id: string;
  readonly versandart: Versandart;
  readonly empfaenger: string;
  readonly freigabeId: string;
}

/**
 * Dokumentiert den Versand — nach dem Tor, nicht davor.
 *
 * Die Reihenfolge ist die ganze Zusage, und sie ist bewusst so:
 *
 *   1. Kanal pruefen — ein nicht verbundener wird abgewiesen, BEVOR
 *      irgendetwas entsteht.
 *   2. Freigabe laden und `gate()` fragen — mit dem Hash ueber DEN Text, der
 *      in der Zeile steht, nicht ueber einen mitgeschickten.
 *   3. Das PDF erzeugen und ablegen — ist der Speicher nicht verbunden,
 *      bricht es hier ab, und die Zeile bleibt unveraendert.
 *   4. Erst danach das Absendedatum. Der Ausloeser stempelt es mit dem
 *      Berliner Kalendertag des Servers und friert die Anzeige ein.
 *
 * Wer 4 vor 3 stellt, hat eine angezeigte Behinderung ohne archiviertes
 * Schreiben; wer 2 nach 4 stellt, hat sie ohne Freigabe verschickt.
 */
export async function dokumentiereVersand(
  kontext: SchreibKontext,
  eingabe: VersandEingabe,
  speicher: Speicher,
  richtlinie: Richtlinie | null = null,
): Promise<{ readonly dokumentId: string; readonly angezeigtAm: string }> {
  if (!MENSCHLICHE_KANAELE.includes(eingabe.versandart)) {
    // CLAUDE.md: kein vorgetaeuschter Erfolg. Es gibt keinen Mailversand.
    throw new KanalNichtVerbundenFehler(eingabe.versandart);
  }

  const zeile = await findeBehinderung(kontext, eingabe.id);
  if (zeile === null) throw new BehinderungFehler('nicht_gefunden', 'Nicht gefunden.');
  if (zeile.angezeigt_lokal !== null) {
    throw new BehinderungFehler(
      'bereits_angezeigt',
      `Diese Anzeige ist am ${zeile.angezeigt_lokal} hinausgegangen. Eine Korrektur `
      + 'ist eine neue Anzeige, kein zweiter Versand (§ 6 VOB/B).',
    );
  }
  if (zeile.anzeigetext === null || zeile.anzeigetext.trim() === '') {
    throw new BehinderungFehler(
      'ohne_text', 'Zu dieser Behinderung wurde noch kein Anzeigetext erzeugt.',
    );
  }

  const [freigabeZeile] = await kontext.abfrage<{
    id: string; aktion: string; status: string; freigegeben_von: string | null;
    nutzlast_hash: string | null;
  }>(
    `select f.id, f.aktion, f.status::text as status, f.freigegeben_von,
            (select s.nutzlast_hash from freigabe_snapshot s
              where s.freigabe_id = f.id and s.mandant_id = f.mandant_id
              order by s.kette_nr desc limit 1) as nutzlast_hash
       from freigabe f
      where f.id = $1::uuid`,
    [eingabe.freigabeId],
  );

  const nutzlast = behinderungNutzlast(kontext.aktiverMandantId, {
    behinderungId: zeile.id,
    nummer: zeile.nummer,
    projekt: `${zeile.projekt_nummer} · ${zeile.projekt}`,
    empfaenger: eingabe.empfaenger,
    versandart: eingabe.versandart,
    anzeigetext: zeile.anzeigetext,
  });

  const freigabe: Freigabe | null = freigabeZeile === undefined ? null : {
    id: freigabeZeile.id,
    aktion: freigabeZeile.aktion as Freigabe['aktion'],
    mandantId: kontext.aktiverMandantId,
    status: freigabeZeile.status as Freigabe['status'],
    freigegebenVon: freigabeZeile.freigegeben_von,
    nutzlastHash: freigabeZeile.nutzlast_hash ?? '',
  };

  const entscheidung = gate(nutzlast, freigabe, richtlinie);
  if (!entscheidung.erlaubt) {
    // Der Fehler des Tors WOERTLICH weiter: er sagt, was fehlt.
    throw entscheidung.fehler;
  }

  /**
   * Das Schreiben, wie es hinausgegangen ist — als echte Datei im privaten
   * Bucket (DOC-01, DOC-03). Nicht verbunden heisst: es entsteht nichts, und
   * die Zeile bleibt im Entwurf.
   */
  const pdf = schreibeTextPdf({
    titel: `Behinderungsanzeige ${zeile.nummer} — ${zeile.projekt_nummer}`,
    text: zeile.anzeigetext,
  });
  const [jahr] = await kontext.abfrage<{ jahr: number }>(
    `select extract(year from app.berlin_heute())::int as jahr`,
  );
  /**
   * KEIN Rueckfall auf `new Date()`.
   *
   * Die Abfrage darueber liefert immer genau eine Zeile — `select extract(…)`
   * ohne `from` tut das. Kommt trotzdem keine, ist die Datenbank kaputt, und
   * die Uhr des Node-Prozesses waere die falsche Antwort darauf: sie liest UTC
   * und legte eine Anzeige vom 31.12., 23:30 Berliner Zeit, in das FOLGENDE
   * Jahr (K-11, Invariante 2, Lintregel `cse/no-client-clock`).
   */
  if (jahr === undefined) {
    throw new Error('Die Datenbank lieferte kein Berliner Kalenderjahr.');
  }

  const hoch = await ladeHoch(
    {
      mandantId: kontext.aktiverMandantId,
      kategorie: 'projekt',
      titel: `Behinderungsanzeige ${zeile.nummer} (${zeile.projekt_nummer})`,
      dateiname: `behinderungsanzeige-${zeile.nummer}.pdf`,
      daten: pdf.bytes,
      behaupteterTyp: 'application/pdf',
    },
    speicher,
    jahr.jahr,
  );

  await kontext.schreibe(
    `insert into dokument (id, mandant_id, kategorie, titel, dateiname, mime_typ,
                           mime_verifiziert, groesse_bytes, sha256, bucket,
                           objekt_schluessel, exif_entfernt, aufbewahrung_bis, loeschsperre)
     values ($1, $2, 'projekt', $3, $4, $5, true, $6, $7, $8, $9, $10, $11::date, $12)`,
    [
      hoch.dokumentId, kontext.aktiverMandantId,
      `Behinderungsanzeige ${zeile.nummer} (${zeile.projekt_nummer})`,
      `behinderungsanzeige-${zeile.nummer}.pdf`, hoch.mimeTyp,
      hoch.groesseBytes, hoch.sha256, hoch.bucket, hoch.objektSchluessel,
      hoch.exifEntfernt, hoch.aufbewahrungBis, hoch.loeschsperre,
    ],
  );

  /**
   * `angezeigt_am` wird mit `app.berlin_heute()` gesetzt — der Ausloeser
   * `behinderung_versandzeit` ueberschreibt jeden mitgeschickten Wert
   * ohnehin, und ein Platzhalter hier macht sichtbar, dass der Server das
   * Datum bestimmt (Invariante 5).
   */
  await kontext.schreibe(
    `update behinderung
        set status = 'angezeigt', angezeigt_am = app.berlin_heute(),
            versandart = $2::behinderung_versandart, empfaenger = $3,
            versand_dokument_id = $4::uuid, freigabe_id = $5::uuid,
            freigegeben_am = f.freigegeben_am, freigegeben_von = f.freigegeben_von,
            geaendert_von = app.aktueller_benutzer()
       from freigabe f
      where behinderung.id = $1 and f.id = $5::uuid
        and f.mandant_id = behinderung.mandant_id`,
    [
      eingabe.id, eingabe.versandart, eingabe.empfaenger,
      hoch.dokumentId, eingabe.freigabeId,
    ],
  );

  const danach = await findeBehinderung(kontext, eingabe.id);
  if (danach === null || danach.angezeigt_lokal === null) {
    throw new BehinderungFehler(
      'ohne_freigabe',
      'Der Versand wurde nicht dokumentiert — die Freigabe gehört nicht zu diesem '
      + 'Mandanten (Invariante 7).',
    );
  }
  return { dokumentId: hoch.dokumentId, angezeigtAm: danach.angezeigt_lokal };
}

/**
 * § 6 Abs. 3 VOB/B: der Wegfall ist ebenfalls anzuzeigen.
 *
 * Er aendert die Anzeige NICHT — die ist eingefroren —, sondern setzt das
 * Ende und den Zustand. Ohne diesen Weg bliebe jede Behinderung fuer immer
 * laufend, und `behinderung_laufend_idx` waere eine Liste, die nur waechst.
 */
export async function zeigeWegfallAn(
  kontext: SchreibKontext,
  eingabe: { readonly id: string; readonly endeAm: string; readonly angezeigtAm: string },
): Promise<void> {
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update behinderung
        set status = 'weggefallen', ende_am = $2::date, wegfall_angezeigt_am = $3::date,
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and status = 'angezeigt' and storniert_am is null
     returning id`,
    [eingabe.id, eingabe.endeAm, eingabe.angezeigtAm],
  );
  if (zeile === undefined) {
    throw new BehinderungFehler(
      'nicht_gefunden',
      'Es gibt keine angezeigte Behinderung mit dieser Kennung — der Wegfall setzt '
      + 'die Anzeige voraus (§ 6 Abs. 3 VOB/B).',
    );
  }
}
