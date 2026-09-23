import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { FARBEN_BEREICH, type BereichSchluessel } from '../../../lib/design/theme.js';

/**
 * Die Identitaet einer Gesellschaft — lesen und pflegen (TEN-07, TEN-10,
 * PUB-03, PUB-09, PRO-01, DESIGN §1/§6/§9/§11, D-10, K-12).
 *
 * **Die Farbe ist ein TOKEN, kein Wert.** `identitaets_token` traegt einen
 * der vier Namen aus DESIGN §1; den Hex-Wert liefert `globals.css`, und diese
 * Datei kann ihn ANZEIGEN (`farbeVon`), aber niemand kann ihn setzen. Eine
 * freie Hex-Spalte plus Farbwaehler ist genau der Mechanismus, ueber den eine
 * Farbe entsteht, die nicht in `docs/DESIGN.md` steht — und damit eine, deren
 * Kontrast niemand geprueft hat (DESIGN §9).
 *
 * **Bilder setzt nicht diese Datei, sondern `markenbild.ts`** (V-100,
 * D-622): eine Datei ist etwas anderes als ein Textfeld — sie wird am Inhalt
 * erkannt, von Metadaten befreit, im privaten Behaelter `marke` abgelegt und
 * unter ihrem Inhalt benannt. Hier bleiben die Alternativtexte, weil sie Text
 * sind und vor dem Bild da sein koennen.
 *
 * **Ein fuenfter Bereich hat noch keine Farbe — und trotzdem eine Zeile.**
 * TEN-08 sagt zu, dass eine fuenfte Gesellschaft eine Datenbankzeile ist und
 * keine Codeaenderung. DESIGN §1 fuehrt vier Bereichstoene, und einen fuenften
 * zu erfinden ist verboten. Beides gilt: der Anlageausloeser (0336) schreibt
 * `identitaets_token = NULL` statt eines geratenen Tokens, und das heisst hier
 * genau eine Sache — „fuer diesen Bereich steht in DESIGN §1 noch kein
 * Bereichston". `farbeVon` gibt dafuer `null` zurueck, und der Bildschirm
 * sagt es hin.
 * // TODO(client, O-750): Welcher Bereichston (DESIGN §1, Kontrast nach §9) gilt fuer eine fuenfte Gesellschaft, und darf ihr Profil oeffentlich gehen, bevor er eingetragen ist?
 *
 * **K-12 ist eingeloest (V-099).** `rechnung_fuss` wird bei der
 * Festschreibung in den kanonischen Payload KOPIERT (`cse.rechnung.v3`,
 * `Leistender.fusszeile`), `brief_fuss` steht im Mahnbrief und in der
 * Nutzlast seiner Freigabe, `angebot_fuss` auf dem Angebotsblatt. Eine
 * spaetere Aenderung hier wirkt auf keine festgeschriebene Rechnung.
 */

export type IdentitaetsToken =
  'area-reinigung' | 'area-security' | 'area-bau' | 'area-operations';

/**
 * `null` ist der PLATZHALTER, nicht „Datenfehler": die Gesellschaft steht,
 * ihr Bereichston steht noch nicht in DESIGN §1 (TEN-08, O-750).
 */
export type IdentitaetsTokenOderPlatzhalter = IdentitaetsToken | null;

export const IDENTITAETS_TOKEN: readonly IdentitaetsToken[] =
  ['area-reinigung', 'area-security', 'area-bau', 'area-operations'];

export class IdentitaetFehler extends Error {
  constructor(
    readonly grund: 'nicht_hinterlegt' | 'ungueltig' | 'alt_text_fehlt',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'IdentitaetFehler';
  }
}

export interface Identitaet {
  readonly mandantId: string;
  readonly kurzname: string;
  readonly identitaetsToken: IdentitaetsTokenOderPlatzhalter;
  readonly logoHellPfad: string | null;
  readonly logoDunkelPfad: string | null;
  readonly logoDruckPfad: string | null;
  readonly logoAlt: string | null;
  readonly avatarPfad: string | null;
  readonly avatarAlt: string | null;
  readonly coverPfad: string | null;
  readonly coverAlt: string | null;
  readonly claim: string | null;
  readonly kurzbeschreibung: string | null;
  readonly beschreibung: string | null;
  readonly briefFuss: string | null;
  readonly rechnungFuss: string | null;
  readonly angebotFuss: string | null;
  readonly emailAbsender: string | null;
  readonly emailSignatur: string | null;
  readonly domain: string | null;
  readonly oeffentlichSichtbar: boolean;
  readonly platzhalterMedien: boolean;
  readonly geaendertAm: string | null;
  readonly geaendertVon: string | null;
}

interface Roh {
  readonly mandant_id: string;
  readonly kurzname: string;
  readonly identitaets_token: string | null;
  readonly logo_hell_pfad: string | null;
  readonly logo_dunkel_pfad: string | null;
  readonly logo_druck_pfad: string | null;
  readonly logo_alt: string | null;
  readonly avatar_pfad: string | null;
  readonly avatar_alt: string | null;
  readonly cover_pfad: string | null;
  readonly cover_alt: string | null;
  readonly claim: string | null;
  readonly kurzbeschreibung: string | null;
  readonly beschreibung: string | null;
  readonly brief_fuss: string | null;
  readonly rechnung_fuss: string | null;
  readonly angebot_fuss: string | null;
  readonly email_absender: string | null;
  readonly email_signatur: string | null;
  readonly domain: string | null;
  readonly oeffentlich_sichtbar: boolean;
  readonly platzhalter_medien: boolean;
  readonly geaendert_am: string | null;
  readonly geaendert_von: string | null;
}

/**
 * Der Hex-Wert eines Tokens — ZUM ANZEIGEN.
 *
 * Die Zuordnung ist dieselbe wie in `globals.css`, und sie kommt aus
 * `lib/design/theme.ts`, damit es nicht zwei Listen gibt. Ein Token ohne
 * Farbe gibt `null` zurueck und nicht Grau: eine erfundene Ersatzfarbe waere
 * genau der Designwert, den CLAUDE.md verbietet.
 */
export function farbeVon(token: string | null): string | null {
  if (token === null) return null;
  const bereich = token.replace(/^area-/u, '') as BereichSchluessel;
  return FARBEN_BEREICH[bereich] ?? null;
}

function zuIdentitaet(r: Roh): Identitaet {
  return {
    mandantId: r.mandant_id,
    kurzname: r.kurzname,
    identitaetsToken: r.identitaets_token as IdentitaetsTokenOderPlatzhalter,
    logoHellPfad: r.logo_hell_pfad,
    logoDunkelPfad: r.logo_dunkel_pfad,
    logoDruckPfad: r.logo_druck_pfad,
    logoAlt: r.logo_alt,
    avatarPfad: r.avatar_pfad,
    avatarAlt: r.avatar_alt,
    coverPfad: r.cover_pfad,
    coverAlt: r.cover_alt,
    claim: r.claim,
    kurzbeschreibung: r.kurzbeschreibung,
    beschreibung: r.beschreibung,
    briefFuss: r.brief_fuss,
    rechnungFuss: r.rechnung_fuss,
    angebotFuss: r.angebot_fuss,
    emailAbsender: r.email_absender,
    emailSignatur: r.email_signatur,
    domain: r.domain,
    oeffentlichSichtbar: r.oeffentlich_sichtbar,
    platzhalterMedien: r.platzhalter_medien,
    geaendertAm: r.geaendert_am,
    geaendertVon: r.geaendert_von,
  };
}

const SPALTEN = `mi.mandant_id, mi.kurzname, mi.identitaets_token,
       mi.logo_hell_pfad, mi.logo_dunkel_pfad, mi.logo_druck_pfad, mi.logo_alt,
       mi.avatar_pfad, mi.avatar_alt, mi.cover_pfad, mi.cover_alt,
       mi.claim, mi.kurzbeschreibung, mi.beschreibung,
       mi.brief_fuss, mi.rechnung_fuss, mi.angebot_fuss,
       mi.email_absender, mi.email_signatur, mi.domain,
       mi.oeffentlich_sichtbar, mi.platzhalter_medien,
       to_char(mi.geaendert_am at time zone 'Europe/Berlin',
               'DD.MM.YYYY HH24:MI') as geaendert_am,
       b.name as geaendert_von`;

/**
 * Die Identitaet des AKTIVEN Bereichs — oder `null`.
 *
 * `null` heisst hier etwas Genaues: der Ausloeser `mandant_identitaet_anlegen`
 * (0200/0336) legt die Zeile mit dem Mandanten an, fuer JEDEN Mandanten, und
 * die Nachtragungen in denselben Migrationen holen den Bestand nach. Seit 0336
 * gibt es keinen Slug mehr, der keine Zeile bekommt — ein Bereich ohne Eintrag
 * in DESIGN §1 bekommt sie mit `identitaetsToken === null`. Bleibt sie
 * trotzdem aus, ist das ein Datenbefund und die Auskunft, die der Bildschirm
 * geben muss, nicht ein leeres Formular.
 */
export async function ladeIdentitaet(
  kontext: LeseKontext,
): Promise<Identitaet | null> {
  const [r] = await kontext.abfrage<Roh>(
    `select ${SPALTEN}
       from mandant_identitaet mi
       left join benutzer b on b.id = mi.geaendert_von
      where mi.mandant_id = $1::uuid`,
    [kontext.aktiverMandantId]);
  return r === undefined ? null : zuIdentitaet(r);
}

/** Dieselbe Zeile fuer jeden sichtbaren Bereich — die Gruppenansicht liest so. */
export async function ladeIdentitaeten(
  kontext: LeseKontext,
): Promise<readonly Identitaet[]> {
  const roh = await kontext.abfrage<Roh>(
    `select ${SPALTEN}
       from mandant_identitaet mi
       left join benutzer b on b.id = mi.geaendert_von
      order by mi.kurzname`);
  return roh.map(zuIdentitaet);
}

export interface IdentitaetEingabe {
  readonly kurzname: string;
  readonly claim: string | null;
  readonly logoAlt: string | null;
  readonly avatarAlt: string | null;
  readonly coverAlt: string | null;
  readonly briefFuss: string | null;
  readonly rechnungFuss: string | null;
  readonly angebotFuss: string | null;
  readonly emailAbsender: string | null;
  readonly emailSignatur: string | null;
  readonly oeffentlichSichtbar: boolean;
}

/**
 * Die pflegbaren Felder setzen.
 *
 * **Was hier NICHT gesetzt wird, und je einen Satz dazu:**
 *  - `identitaets_token` — die Farbe eines Bereichs ist eine
 *    DESIGN.md-Entscheidung, keine Einstellung (siehe Kopf). Ein fuenfter
 *    Bereich traegt bis dahin `null` und braucht zuerst einen
 *    DESIGN.md-Eintrag, dann eine Migration, die `mi_token` erweitert
 *    (O-750). Ein Farbwaehler an dieser Stelle waere genau der Weg, auf dem
 *    eine ungepruefte Farbe in die Oberflaeche kaeme.
 *  - `logo_*_pfad`, `avatar_pfad`, `cover_pfad` — die setzt
 *    `markenbild.ts` mit der Datei zusammen (V-100). Die Alternativtexte
 *    stehen trotzdem hier: sie sind Text, sie sind nach PUB-09/LEG-07
 *    Pflicht, und sie koennen vor dem Bild da sein.
 *  - `kurzbeschreibung`, `beschreibung` — sie stehen je Sprache in
 *    `unternehmensprofil` (D-82), und das ist der maßgebliche Ort. Zwei
 *    Editoren auf einem Text waeren ein Defekt.
 *  - `domain` — O-08 ist offen.
 *  - `platzhalter_medien` — es ist eine Tatsache ueber die Bilder, keine
 *    Einstellung; es wird `false`, wenn echte Fotografie vorliegt (O-13),
 *    und das entscheidet nicht dieses Formular.
 *
 * **Der Alt-Text-CHECK schlaegt zu, wenn jemand veroeffentlicht, ohne ihn zu
 * setzen** (`mi_alt_text`, 0200). Der Dienst faengt das VORHER ab, damit die
 * Meldung sagt, welches Feld fehlt, statt eine Constraintverletzung
 * durchzulassen — RLS und CHECK sind die zweite Linie, nie die einzige.
 */
export async function setzeIdentitaet(
  kontext: SchreibKontext, e: IdentitaetEingabe,
): Promise<void> {
  if (e.kurzname.trim() === '') {
    throw new IdentitaetFehler('ungueltig',
      'Der Kurzname steht in der Bereichsauswahl und auf jedem Dokument — er bleibt '
      + 'nicht leer.');
  }

  const vorher = await ladeIdentitaet(kontext);
  if (vorher === null) {
    throw new IdentitaetFehler('nicht_hinterlegt',
      'Für diesen Bereich ist keine Identitätszeile hinterlegt. Sie entsteht mit dem '
      + 'Bereich (0200/0336) — seit 0336 für jeden Bereich, auch für einen ohne '
      + 'Eintrag in DESIGN §1. Fehlt sie trotzdem, ist das ein Datenbefund.');
  }

  if (e.oeffentlichSichtbar) {
    const fehlend: string[] = [];
    if (vorher.logoHellPfad !== null && (e.logoAlt ?? '').trim() === '') {
      fehlend.push('Logo');
    }
    if (vorher.avatarPfad !== null && (e.avatarAlt ?? '').trim() === '') {
      fehlend.push('Avatar');
    }
    if (vorher.coverPfad !== null && (e.coverAlt ?? '').trim() === '') {
      fehlend.push('Titelbild');
    }
    if (fehlend.length > 0) {
      throw new IdentitaetFehler('alt_text_fehlt',
        `Ein öffentlich sichtbares Profil braucht für jedes ausgelieferte Bild einen `
        + `Alternativtext (PUB-09, LEG-07, BFSG). Es fehlt: ${fehlend.join(', ')}.`);
    }
  }

  await kontext.schreibe(
    `update mandant_identitaet
        set kurzname             = $2,
            claim                = $3,
            logo_alt             = $4,
            avatar_alt           = $5,
            cover_alt            = $6,
            brief_fuss           = $7,
            rechnung_fuss        = $8,
            angebot_fuss         = $9,
            email_absender       = $10,
            email_signatur       = $11,
            oeffentlich_sichtbar = $12,
            geaendert_von        = $13::uuid
      where mandant_id = $1::uuid`,
    [kontext.aktiverMandantId, e.kurzname.trim(), e.claim,
      e.logoAlt, e.avatarAlt, e.coverAlt,
      e.briefFuss, e.rechnungFuss, e.angebotFuss,
      e.emailAbsender, e.emailSignatur, e.oeffentlichSichtbar,
      kontext.benutzerId]);

  /*
   * Der Audit-Trigger auf der Tabelle schreibt Vorher/Nachher (0200). Diese
   * Zeile daneben nennt den VORGANG: „wer hat die Identitaet gepflegt" ist
   * eine andere Frage als „welches Feld hat sich geaendert", und die
   * Fusszeilen sind rechnungsrelevant.
   */
  await kontext.schreibe(
    `select app.protokolliere('mandant.identitaet_gepflegt', 'mandant_identitaet',
                              $1, null, $2::jsonb, app.aktiver_mandant())`,
    [kontext.aktiverMandantId, {
      kurzname: e.kurzname.trim(),
      oeffentlichSichtbar: e.oeffentlichSichtbar,
      rechnungFussGesetzt: e.rechnungFuss !== null && e.rechnungFuss.trim() !== '',
    }]);
}
