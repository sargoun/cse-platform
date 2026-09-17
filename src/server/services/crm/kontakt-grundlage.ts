import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { CrmFehler, type Rechtsgrundlage } from './anlegen.js';
import { KANAELE, type Kanal, type KontaktLage } from './uwg-matrix.js';

/**
 * Der Rechtsgrundlagen-Block eines Ansprechpartners — lesen und setzen
 * (CRM-03, CRM-08, LEG-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **K-05 gilt hier genauso wie bei den Zahlungskonditionen, und das ist der
 * Grund für fast jede Zeile dieser Datei.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `cse_app` hat auf `ansprechpartner.rechtsgrundlage`, `.._quelle`,
 * `.._erfasst_am`, `.._beleg_dokument_id`, `einwilligung_kanaele`,
 * `werbewiderspruch_am`, `widerspruch_am`, `aehnliche_leistung` und
 * `.._begruendung` **nur INSERT und UPDATE — kein SELECT**. Daraus folgt
 * zweierlei, und beides ist eine Falle, die zur Laufzeit mit `42501`
 * zuschlägt:
 *
 *  1. **Gelesen wird ausschliesslich über die Definer aus 0247.**
 *     `app.kontakt_rechtsgrundlage_liste()` für die Liste (EINE
 *     Protokollzeile je Abruf, nicht eine je Kontakt),
 *     `app.kontakt_rechtsgrundlage_blatt(uuid)` für ein Blatt.
 *  2. **Ein `update` nennt diese Spalten weder in `RETURNING` noch in
 *     `WHERE`.** Auch ein `order by` oder ein `where rechtsgrundlage = …`
 *     scheitert — der Entzug gilt für jeden Zugriff, nicht nur für die
 *     Auswahlliste. Deshalb steht hier überall `returning id`, genau wie in
 *     `legeKontaktAn`.
 *
 * **Zwei Rechte, nicht eines.** Die Route trägt `crm.rechtsgrundlage_setzen`;
 * die `WITH CHECK`-Klausel von `t_mandant` auf `ansprechpartner` verlangt
 * aber `crm.schreiben`. Wer nur das erste hält, bekäme „new row violates
 * row-level security policy" — richtig gesperrt, an der falschen Stelle
 * erklärt. Diese Datei prüft deshalb beide und nennt das fehlende.
 */

export interface GrundlageStand {
  readonly rechtsgrundlage: Rechtsgrundlage;
  readonly quelle: string | null;
  readonly erfasstAm: Date | null;
  readonly belegDokumentId: string | null;
  readonly einwilligungKanaele: readonly string[];
  readonly werbewiderspruchAm: Date | null;
  readonly widerspruchAm: Date | null;
  readonly aehnlicheLeistung: boolean;
  readonly aehnlicheBegruendung: string | null;
}

interface BlattZeile {
  readonly rechtsgrundlage: string;
  readonly quelle: string | null;
  readonly erfasst_am: Date | null;
  readonly beleg_dokument_id: string | null;
  readonly einwilligung_kanaele: readonly string[] | null;
  readonly werbewiderspruch_am: Date | null;
  readonly widerspruch_am: Date | null;
  readonly aehnliche_leistung: boolean;
  readonly aehnliche_begruendung: string | null;
}

const GRUNDLAGEN = ['einwilligung', 'bestandskunde', 'anfrage', 'keine'] as const;

function alsGrundlage(wert: string): Rechtsgrundlage {
  const g = GRUNDLAGEN.find((x) => x === wert);
  if (g === undefined) {
    throw new CrmFehler(`Diese Rechtsgrundlage gibt es nicht: ${wert}`, 'unbekannte_grundlage');
  }
  return g;
}

/**
 * Der Nachweis EINES Kontakts — über den Definer aus 0247.
 *
 * **Jeder Aufruf schreibt eine Protokollzeile** (LEG-08). Das ist gewollt:
 * wer den Einwilligungsnachweis einer Person liest, hinterlässt eine Spur.
 * Deshalb wird diese Funktion auf einem BLATT gerufen und nie in einer
 * Schleife über eine Liste — dafür gibt es `leseGrundlagenListe`.
 *
 * `null` heisst „nicht lesbar oder nicht vorhanden", und die Seite
 * unterscheidet beides nicht (AUT-06).
 */
export async function leseGrundlage(
  kontext: LeseKontext, ansprechpartnerId: string,
): Promise<GrundlageStand | null> {
  const [z] = await kontext.abfrage<BlattZeile>(
    `select rechtsgrundlage, quelle, erfasst_am, beleg_dokument_id,
            einwilligung_kanaele, werbewiderspruch_am, widerspruch_am,
            aehnliche_leistung, aehnliche_begruendung
       from app.kontakt_rechtsgrundlage_blatt($1::uuid)`, [ansprechpartnerId]);
  if (z === undefined) return null;
  return {
    rechtsgrundlage: alsGrundlage(z.rechtsgrundlage),
    quelle: z.quelle,
    erfasstAm: z.erfasst_am,
    belegDokumentId: z.beleg_dokument_id,
    einwilligungKanaele: z.einwilligung_kanaele ?? [],
    werbewiderspruchAm: z.werbewiderspruch_am,
    widerspruchAm: z.widerspruch_am,
    aehnlicheLeistung: z.aehnliche_leistung,
    aehnlicheBegruendung: z.aehnliche_begruendung,
  };
}

/** Der Stand als Eingabe für die geprüfte §7-Matrix. */
export function alsKontaktLage(
  stand: GrundlageStand, abmeldezeileGerendert = true,
): KontaktLage {
  return {
    grundlage: stand.rechtsgrundlage,
    aehnlicheLeistung: stand.aehnlicheLeistung,
    widerspruch: stand.widerspruchAm !== null,
    werbewiderspruch: stand.werbewiderspruchAm !== null,
    einwilligungKanaele: stand.einwilligungKanaele,
    abmeldezeileGerendert,
  };
}

export interface GrundlageListenZeile {
  readonly ansprechpartner_id: string;
  readonly name: string;
  readonly kunde_id: string | null;
  readonly kunde_name: string | null;
  readonly email: string | null;
  readonly rechtsgrundlage: string;
  readonly werbewiderspruch_am: Date | null;
  readonly widerspruch_am: Date | null;
  readonly aehnliche_leistung: boolean;
  readonly kanaele: readonly string[] | null;
}

/**
 * Die Einstufung ALLER Kontakte des Bereichs — ein Abruf, eine Protokollzeile.
 *
 * Wirft `insufficient_privilege`, wenn `crm.rechtsgrundlage_lesen` fehlt. Die
 * Seite fängt das ab und schreibt, welches Recht fehlt, statt eine leere
 * Spalte zu zeigen: eine leere Spalte sähe aus wie „keine Grundlage
 * hinterlegt", und das ist eine Aussage über den Kontakt statt über die
 * Berechtigung.
 */
export async function leseGrundlagenListe(
  kontext: LeseKontext,
): Promise<readonly GrundlageListenZeile[]> {
  return kontext.abfrage<GrundlageListenZeile>(
    `select ansprechpartner_id, name, kunde_id, kunde_name, email, rechtsgrundlage,
            werbewiderspruch_am, widerspruch_am, aehnliche_leistung, kanaele
       from app.kontakt_rechtsgrundlage_liste()`);
}

/** Die Antwort des WIRKSAMEN Tores, je Kanal und Zweck. */
export interface TorAntwort {
  readonly kanal: Kanal;
  readonly werbung: boolean;
  readonly vertraglich: boolean;
}

/**
 * Was das Tor sagt — dieselbe Funktion, die auch der Sendepfad fragt.
 *
 * In EINER Abfrage über alle fünf Kanäle: fünf Rundreisen für eine Anzeige
 * wären fünfmal dieselbe Frage, und `app.darf_kontaktiert_werden` ist
 * `stable`, also darf Postgres sie zusammenfassen.
 */
export async function torAntworten(
  kontext: LeseKontext, ansprechpartnerId: string,
): Promise<readonly TorAntwort[]> {
  const zeilen = await kontext.abfrage<{
    kanal: string; werbung: boolean; vertraglich: boolean;
  }>(
    `select k as kanal,
            app.darf_kontaktiert_werden($1::uuid, k, 'werbung') as werbung,
            app.darf_kontaktiert_werden($1::uuid, k, 'vertraglich') as vertraglich
       from unnest($2::text[]) as k`,
    [ansprechpartnerId, [...KANAELE]]);
  return zeilen.map((z) => ({
    kanal: (KANAELE.find((k) => k === z.kanal) ?? 'email'),
    werbung: z.werbung,
    vertraglich: z.vertraglich,
  }));
}

/* --------------------------------------------------------------- Schreiben */

async function pruefeSchreibrecht(kontext: SchreibKontext): Promise<void> {
  const [r] = await kontext.abfrage<{ setzen: boolean; schreiben: boolean }>(
    `select app.hat_recht('crm.rechtsgrundlage_setzen', app.aktiver_mandant()) as setzen,
            app.hat_recht('crm.schreiben', app.aktiver_mandant()) as schreiben`);
  if (r?.setzen !== true) {
    throw new CrmFehler(
      'Die Rechtsgrundlage setzt nur, wer `crm.rechtsgrundlage_setzen` hält.',
      'kein_setzrecht', 403);
  }
  if (r.schreiben !== true) {
    throw new CrmFehler(
      'Zum Speichern fehlt `crm.schreiben`. Die Policy auf `ansprechpartner` '
      + 'verlangt es zusätzlich zu `crm.rechtsgrundlage_setzen` — ohne es weist die '
      + 'Datenbank den Schreibvorgang ab. Beide Rechte gehören zusammen erteilt.',
      'kein_schreibrecht', 403);
  }
}

export interface GrundlageSetzen {
  readonly ansprechpartnerId: string;
  readonly rechtsgrundlage: Rechtsgrundlage;
  /** Woher sie stammt. Pflicht, sobald sie nicht `keine` ist. */
  readonly nachweisQuelle?: string | undefined;
  /**
   * Seit wann sie belegt ist, als Berliner Kalendertag (`YYYY-MM-DD`).
   *
   * Leer heisst „jetzt" — und „jetzt" ist die SERVERZEIT, nie die des
   * Geräts (Invariante 5).
   */
  readonly nachweisAm?: string | undefined;
  readonly belegDokumentId?: string | undefined;
  /** Nur bei `einwilligung`: worein eingewilligt wurde. */
  readonly einwilligungKanaele?: readonly string[] | undefined;
  /** § 7 Abs. 3 Nr. 2 UWG — die festgehaltene Wertung (O-95). */
  readonly aehnlicheLeistung?: boolean | undefined;
  readonly aehnlicheBegruendung?: string | undefined;
}

/**
 * Die Rechtsgrundlage eines Kontakts setzen.
 *
 * **Der Widerspruch wird hier NICHT gesetzt.** Er ist ein eigener Vorgang mit
 * eigenem Nachweis und eigener Einbahnstrasse (`erfasseWerbewiderspruch`
 * darunter, `app.widerspruch_verarbeitung_setzen` für Art. 21 DSGVO). In
 * dieses Formular gefaltet wäre er ein Häkchen, das sich nicht abwählen lässt
 * — der Auslöser `kern.erzwinge_widerspruch` wirft `restrict_violation`, und
 * der Mensch davor sähe einen rohen Datenbankfehler für eine Handlung, die
 * ihm niemand verboten hatte.
 */
export async function setzeGrundlage(
  kontext: SchreibKontext, eingabe: GrundlageSetzen,
): Promise<void> {
  await pruefeSchreibrecht(kontext);

  const grundlage = eingabe.rechtsgrundlage;
  const quelle = eingabe.nachweisQuelle?.trim() ?? '';
  if (grundlage !== 'keine' && quelle === '') {
    throw new CrmFehler(
      'Zu einer Rechtsgrundlage gehört, woher sie kommt (§ 7 UWG, LEG-08) — sonst '
      + 'ist sie in einer Abmahnung nichts wert. Beispiel: „Häkchen im '
      + 'Angebotsformular vom 12.03." oder „bestehender Rahmenvertrag RV-2024-08".',
      'grundlage_ohne_quelle');
  }

  const kanaele = (eingabe.einwilligungKanaele ?? [])
    .filter((k) => (KANAELE as readonly string[]).includes(k));
  if (grundlage === 'einwilligung' && kanaele.length === 0) {
    throw new CrmFehler(
      'Eine Einwilligung gilt für bestimmte Wege. Ohne Kanal ist sie eine '
      + 'Einwilligung in nichts — das Tor weist dann jede elektronische Nachricht '
      + 'ab.', 'einwilligung_ohne_kanal');
  }

  const aehnlich = eingabe.aehnlicheLeistung === true;
  const begruendung = eingabe.aehnlicheBegruendung?.trim() ?? '';
  if (aehnlich && begruendung === '') {
    throw new CrmFehler(
      'Die Feststellung „ähnliche eigene Leistung" (§ 7 Abs. 3 Nr. 2 UWG) ist eine '
      + 'rechtliche Wertung und braucht ihre Begründung — der CHECK '
      + '`ansprechpartner_aehnliche_leistung_begruendet` verlangt sie ohnehin, und '
      + 'eine Wertung, die niemand begründet hat, ist kein Nachweis.',
      'aehnlich_ohne_begruendung');
  }

  /*
   * `returning id` und NICHTS aus dem entzogenen Block — siehe Kopf. Die
   * WHERE-Klausel nennt nur lesbare Spalten (`id`, `mandant_id`,
   * `archiviert_am`).
   *
   * `rechtsgrundlage_erfasst_am` kommt aus `now()`, wenn kein Tag angegeben
   * ist. Ist einer angegeben, wird er als Berliner Tagesbeginn gelesen — ein
   * belegter Tag in der Vergangenheit ist eine legitime Angabe (der Vertrag
   * ist vom 12.03.), die Zukunft nicht.
   */
  if (eingabe.nachweisAm !== undefined && eingabe.nachweisAm !== '') {
    const [pruefung] = await kontext.abfrage<{ zukunft: boolean }>(
      `select ($1::date > app.berlin_heute()) as zukunft`, [eingabe.nachweisAm]);
    if (pruefung?.zukunft === true) {
      throw new CrmFehler(
        'Ein Nachweis kann nicht in der Zukunft erbracht worden sein.',
        'nachweis_in_zukunft');
    }
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update ansprechpartner
        set rechtsgrundlage = $2::rechtsgrundlage,
            rechtsgrundlage_quelle = case when $2::rechtsgrundlage = 'keine'
                                          then null else $3 end,
            rechtsgrundlage_erfasst_am = case
              when $2::rechtsgrundlage = 'keine' then null
              when $4::date is null then now()
              else ($4::date::timestamp at time zone 'Europe/Berlin') end,
            rechtsgrundlage_beleg_dokument_id = $5::uuid,
            einwilligung_kanaele = case when $2::rechtsgrundlage = 'einwilligung'
                                        then $6::text[] else null end,
            aehnliche_leistung = $7::boolean,
            aehnliche_leistung_begruendung = case when $7::boolean
                                                  then $8 else null end,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and archiviert_am is null
      returning id`,
    [eingabe.ansprechpartnerId, grundlage, quelle === '' ? null : quelle,
      eingabe.nachweisAm === undefined || eingabe.nachweisAm === ''
        ? null : eingabe.nachweisAm,
      eingabe.belegDokumentId ?? null, kanaele, aehnlich,
      begruendung === '' ? null : begruendung]);

  if (zeilen[0] === undefined) {
    throw new CrmFehler('Diesen Kontakt gibt es nicht.', 'nicht_gefunden', 404);
  }

  /*
   * Der Vorgang steht im Protokoll — nicht der WERT. `app.protokolliere`
   * nimmt eine Nutzlast; die Einstufung selbst gehört nicht hinein, weil das
   * Protokoll dann eine zweite, ungeschützte Kopie des Nachweises wäre
   * (LEG-08, dieselbe Begründung wie beim spaltenweisen Entzug).
   */
  await kontext.schreibe(
    `select app.protokolliere('ansprechpartner.rechtsgrundlage_gesetzt',
              'ansprechpartner', $1::text, null,
              jsonb_build_object('quelle_gesetzt', $2::boolean,
                                 'kanaele_anzahl', $3::int),
              app.aktiver_mandant())`,
    [eingabe.ansprechpartnerId, quelle !== '', kanaele.length]);
}

export interface WerbewiderspruchErfassen {
  readonly ansprechpartnerId?: string | undefined;
  readonly kundeId?: string | undefined;
  /** Über welchen Weg er eingegangen ist — `null`, wenn unbekannt. */
  readonly kanal?: string | undefined;
  /** Der Berliner Kalendertag des Eingangs (`YYYY-MM-DD`); leer heisst heute. */
  readonly eingegangenAm?: string | undefined;
  readonly bemerkung?: string | undefined;
}

/**
 * Einen Werbewiderspruch von Hand erfassen (§ 7 Abs. 3 Nr. 3 UWG).
 *
 * Läuft über `app.werbewiderspruch_manuell_setzen` (0248): dort wird das Recht
 * geprüft, `werbewiderspruch_am` auf den FRÜHESTEN bekannten Eingang gesetzt
 * und die Nachweiszeile in `werbewiderspruch` angelegt. Diese Datei
 * formuliert die Regel nicht nach — sie reicht die Eingabe weiter.
 *
 * **Das ist ein Einwegvorgang.** Der Auslöser `kern.erzwinge_widerspruch`
 * lässt `werbewiderspruch_am` nicht wieder leeren. Die Oberfläche sagt das
 * vor dem Absenden, nicht danach.
 */
export async function erfasseWerbewiderspruch(
  kontext: SchreibKontext, eingabe: WerbewiderspruchErfassen,
): Promise<void> {
  if (eingabe.ansprechpartnerId === undefined && eingabe.kundeId === undefined) {
    throw new CrmFehler('Ohne Betroffenen gibt es keinen Widerspruch.', 'ohne_betroffenen');
  }
  /*
   * **Die Leerzeichenkette wird HIER zu `null`, nicht im SQL.**
   *
   * Der erste Entwurf schrieb `case when $4::text = '' then now() else
   * $4::date … end`. Postgres faltet konstante Teilausdrücke beim Planen, und
   * der Plan scheiterte mit `invalid input syntax for type date: ""` — bei
   * einem leeren Datumsfeld, also im häufigsten Fall. Ein `case`, dessen
   * ungenutzter Zweig trotzdem geprüft wird, ist kein Schutz.
   */
  const tag = eingabe.eingegangenAm?.trim();
  const [z] = await kontext.schreibe<{ anzahl: number }>(
    `select app.werbewiderspruch_manuell_setzen(
              $1::uuid, $2::uuid, $3,
              coalesce(($4::date::timestamp at time zone 'Europe/Berlin'), now()),
              $5) as anzahl`,
    [eingabe.ansprechpartnerId ?? null, eingabe.kundeId ?? null,
      eingabe.kanal === undefined || eingabe.kanal === '' ? null : eingabe.kanal,
      tag === undefined || tag === '' ? null : tag, eingabe.bemerkung ?? null]);
  if ((z?.anzahl ?? 0) === 0) {
    throw new CrmFehler('Der Widerspruch wurde nicht erfasst.', 'nicht_erfasst', 400);
  }
}

/**
 * Den Vollwiderspruch nach Art. 21 DSGVO erfassen.
 *
 * **Ein anderes Recht, und das ist Absicht.**
 * `app.widerspruch_verarbeitung_setzen` (0222) verlangt
 * `datenschutz.auskunft_erstellen`, nicht `crm.rechtsgrundlage_setzen`: der
 * Werbewiderspruch ist die tägliche Arbeit des Vertriebs, der Vollwiderspruch
 * die Entscheidung der Datenschutzstelle. Wer nur das erste Recht hält, kann
 * den unwiderruflichen zweiten Vorgang nicht versehentlich auslösen — die
 * Oberfläche zeigt den Knopf dann gar nicht.
 */
export async function erfasseVollwiderspruch(
  kontext: SchreibKontext, ansprechpartnerId: string, bemerkung: string,
): Promise<void> {
  if (bemerkung.trim() === '') {
    throw new CrmFehler(
      'Ein Widerspruch nach Art. 21 DSGVO wird begründet festgehalten — er wird '
      + 'nicht zurückgenommen.', 'ohne_begruendung');
  }
  const [z] = await kontext.schreibe<{ anzahl: number }>(
    `select app.widerspruch_verarbeitung_setzen($1::uuid, null, $2) as anzahl`,
    [ansprechpartnerId, bemerkung.trim()]);
  if ((z?.anzahl ?? 0) === 0) {
    throw new CrmFehler('Der Widerspruch wurde nicht erfasst.', 'nicht_erfasst', 400);
  }
}
