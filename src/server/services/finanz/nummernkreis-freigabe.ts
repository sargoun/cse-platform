import type { SchreibKontext } from '../../kontext/index.js';
import { formatiereNummer } from './nummernkreis.js';

/**
 * Einen Platzhalterkreis freigeben — Maske festlegen und bestätigen
 * (FIN-03, LEG-01, TEN-02, V-284, O-134, O-352, D-779, D-848).
 *
 * **Warum es sie braucht.** Der Betriebs-Seed legt den Rechnungskreis mit der
 * Voreinstellung `RE-{jahr}-{nr:5}` an, aber als Platzhalter: eine
 * Rechnungsnummer ist unumkehrbar, und solange `ist_platzhalter` steht, zieht
 * `fin.rechnung_nummer_ziehen` keine Nummer — es wird nichts festgeschrieben.
 * Bis V-284 hob das nur eine Migration auf.
 *
 * // TODO(client, O-134): Voreinstellung — ein Kreis je Gesellschaft und Belegart, Maske `RE-{jahr}-{nr:5}`, Neustart am 1. Januar; die Administration (`nummernkreis.verwalten`, O-352) bestätigt sie oder passt Maske und Rücksetzung an, bevor die erste Nummer vergeben ist. D-779, D-848.
 *
 * **Der Vorgang steht in der Datenbank** (0532, `fin.nummernkreis_freigeben`)
 * und prüft dort dieselbe Grammatik; dieser Dienst prüft vorher, was er mit
 * einem Grund beantworten kann, und schreibt das Protokoll.
 */

const AUDIT_FREIGABE = 'nummernkreis.freigegeben';

export type FreigabeGrund =
  | 'nicht_gefunden' | 'geschlossen' | 'schon_freigegeben' | 'maske_unbestaetigt'
  | 'maske_ungueltig' | 'ruecksetzung_ungueltig' | 'bezeichnung_fehlt'
  | 'bezeichnung_vorbehalt' | 'schon_vorhanden' | 'kein_recht';

export class FreigabeFehler extends Error {
  constructor(readonly grund: FreigabeGrund, nachricht: string) {
    super(nachricht);
    this.name = 'FreigabeFehler';
  }
}

export type Ruecksetzung = 'jaehrlich' | 'nie';

/** Die längste Maske — eine Rechnungsnummer steht in BT-1 und im Dateinamen. */
export const MASKE_HOECHSTENS = 40;
/** Die längste Bezeichnung. */
export const BEZEICHNUNG_HOECHSTENS = 120;

/** Warum eine Maske nicht taugt — oder `null`, wenn sie taugt. */
export type MaskenMangel =
  | 'leer' | 'zu_lang' | 'nr_fehlt' | 'nr_breite' | 'nr_mehrfach' | 'jahr_fehlt'
  | 'jahr_ohne_ruecksetzung' | 'zeichen';

const NR = /\{nr(?::[1-9])?\}/gu;
const PLATZHALTER = /\{nr(?::[1-9])?\}|\{jahr\}/gu;
const ERLAUBT = /^[A-Za-z0-9/_.-]*$/u;

/**
 * Rein: dieselbe Grammatik wie `fin.nummernkreis_freigeben` (0532) — genau
 * ein `{nr}` oder `{nr:1}` bis `{nr:9}`, `{jahr}` genau dann, wenn jährlich
 * zurückgesetzt wird, sonst nur Buchstaben, Ziffern und `- / _ .`.
 *
 * Enger als `formatiereNummer`, mit Absicht: die SQL-Fassung
 * (`fin.nummer_formatieren`, 0077) ersetzt nur das ERSTE `{nr}` — zwei
 * davon lösten die zwei Fassungen verschieden auf.
 */
export function maskenMangel(maske: string, ruecksetzung: Ruecksetzung): MaskenMangel | null {
  if (maske.length === 0) return 'leer';
  if (maske.length > MASKE_HOECHSTENS) return 'zu_lang';
  const nr = maske.match(NR)?.length ?? 0;
  if (nr === 0) return /\{nr:\d*\}/u.test(maske) ? 'nr_breite' : 'nr_fehlt';
  if (nr > 1) return 'nr_mehrfach';
  const mitJahr = maske.includes('{jahr}');
  if (ruecksetzung === 'jaehrlich' && !mitJahr) return 'jahr_fehlt';
  if (ruecksetzung === 'nie' && mitJahr) return 'jahr_ohne_ruecksetzung';
  if (!ERLAUBT.test(maske.replace(PLATZHALTER, ''))) return 'zeichen';
  return null;
}

/**
 * Rein: das Jahr, in dem der freigegebene Kreis zählt. Ein Platzhalter hat
 * nichts vergeben, sein Jahr ist nur vorgemerkt — jährlich zählt er ab dem
 * laufenden (ein schon vorgemerktes späteres bleibt), fortlaufend mit 0.
 */
export function freigabeJahr(kreisJahr: number, ruecksetzung: Ruecksetzung, heuteJahr: number): number {
  return ruecksetzung === 'jaehrlich' ? Math.max(kreisJahr, heuteJahr) : 0;
}

/** Rein: die erste Nummer nach der Freigabe — wie sie auf dem ersten Beleg stünde. */
export function ersteFreigegebeneNummer(
  maske: string, ruecksetzung: Ruecksetzung, kreisJahr: number, heuteJahr: number,
): string | null {
  if (maskenMangel(maske, ruecksetzung) !== null) return null;
  return formatiereNummer(maske, 1, freigabeJahr(kreisJahr, ruecksetzung, heuteJahr));
}

/**
 * Rein: behauptet die Bezeichnung einen Vorbehalt — unbestätigt, Platzhalter,
 * zur Freigabe, Demo, O-134? Ein freigegebener Kreis mit so einem Namen
 * behauptete einen Schutz, den die Spalte nicht gibt (O-606).
 */
export function behauptetVorbehalt(bezeichnung: string): boolean {
  return /unbest(?:ä|ae)tigt|platzhalter|zur freigabe|\bdemo\b|\bO-134\b/iu.test(bezeichnung);
}

/**
 * Rein: der Vorschlag für die Bezeichnung nach der Freigabe — die Klammern
 * der Voreinstellung fallen weg („Ausgangsrechnungen (Voreinstellung … —
 * zur Freigabe, O-134)" → „Ausgangsrechnungen").
 */
export function vorgeschlageneBezeichnung(bezeichnung: string): string {
  const ohne = bezeichnung.replace(/\s*\([^)]*\)/gu, '').replace(/\s+/gu, ' ').trim();
  return ohne === '' ? bezeichnung.trim() : ohne;
}

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface Kopf {
  id: string; jahr: number; platzhalter: boolean; geschlossen: boolean;
  naechste_nummer: string; bezeichnung: string; format_maske: string;
  zuruecksetzung: string | null; kreis_typ: string; kontext_id: string | null;
  heute_jahr: number; darf: boolean;
}

export interface FreigabeEingabe {
  readonly kreisId: string;
  readonly maske: string;
  readonly ruecksetzung: string;
  readonly bezeichnung: string;
  readonly bestaetigt: boolean;
}

/** Gibt einen Platzhalterkreis frei — gibt sein Jahr und die erste Nummer zurück. */
export async function gibKreisFrei(
  kontext: SchreibKontext, e: FreigabeEingabe,
): Promise<{ readonly jahr: number; readonly ersteNummer: string }> {
  if (!KENNUNG.test(e.kreisId)) {
    throw new FreigabeFehler('nicht_gefunden', 'Diesen Nummernkreis gibt es hier nicht.');
  }
  const [k] = await kontext.abfrage<Kopf>(
    `select n.id::text as id, n.jahr, n.ist_platzhalter as platzhalter,
            (n.geschlossen_am is not null) as geschlossen, n.naechste_nummer::text,
            n.bezeichnung, n.format_maske, n.zuruecksetzung::text as zuruecksetzung,
            n.kreis_typ::text as kreis_typ, n.kontext_id::text as kontext_id,
            extract(year from app.berlin_heute())::int as heute_jahr,
            app.hat_recht('nummernkreis.verwalten', app.aktiver_mandant()) as darf
       from nummernkreis n
      where n.id = $1::uuid and n.mandant_id = app.aktiver_mandant()`, [e.kreisId]);
  if (k === undefined) {
    throw new FreigabeFehler('nicht_gefunden', 'Diesen Nummernkreis gibt es hier nicht.');
  }
  if (!k.darf) {
    throw new FreigabeFehler('kein_recht', 'Frei gibt, wer nummernkreis.verwalten hält.');
  }
  if (k.geschlossen) throw new FreigabeFehler('geschlossen', 'Dieser Kreis ist geschlossen.');
  if (!k.platzhalter || k.naechste_nummer !== '1') {
    throw new FreigabeFehler('schon_freigegeben', 'Dieser Kreis ist schon freigegeben.');
  }
  if (e.ruecksetzung !== 'jaehrlich' && e.ruecksetzung !== 'nie') {
    throw new FreigabeFehler('ruecksetzung_ungueltig',
      'Zurückgesetzt wird am 1. Januar oder nie.');
  }
  const ruecksetzung: Ruecksetzung = e.ruecksetzung;
  const maske = e.maske.trim();
  if (maskenMangel(maske, ruecksetzung) !== null) {
    throw new FreigabeFehler('maske_ungueltig', `„${maske}" ist keine gültige Maske.`);
  }
  const bezeichnung = e.bezeichnung.trim();
  if (bezeichnung === '' || bezeichnung.length > BEZEICHNUNG_HOECHSTENS) {
    throw new FreigabeFehler('bezeichnung_fehlt',
      `Die Bezeichnung fehlt oder ist länger als ${String(BEZEICHNUNG_HOECHSTENS)} Zeichen.`);
  }
  if (behauptetVorbehalt(bezeichnung)) {
    throw new FreigabeFehler('bezeichnung_vorbehalt',
      'Die Bezeichnung nennt einen Vorbehalt, den der freigegebene Kreis nicht mehr hat.');
  }
  if (!e.bestaetigt) {
    throw new FreigabeFehler('maske_unbestaetigt',
      'Bitte bestätigen Sie die Maske — nach der ersten Nummer lässt sie sich nicht mehr ändern.');
  }
  const jahr = freigabeJahr(k.jahr, ruecksetzung, k.heute_jahr);
  const [schon] = await kontext.abfrage<{ id: string }>(
    `select id::text as id from nummernkreis
      where mandant_id = app.aktiver_mandant() and kreis_typ = $1::nummernkreis_typ
        and kontext_id is not distinct from $2::uuid and jahr = $3 and id <> $4::uuid`,
    [k.kreis_typ, k.kontext_id, jahr, k.id]);
  if (schon !== undefined) {
    throw new FreigabeFehler('schon_vorhanden',
      'Für dieses Jahr gibt es schon einen Kreis dieses Geltungsbereichs.');
  }

  await kontext.schreibe(
    `select fin.nummernkreis_freigeben($1::uuid, $2, $3, $4, true)`,
    [k.id, maske, ruecksetzung, bezeichnung]);
  await kontext.schreibe(
    `select app.protokolliere($1, 'nummernkreis', $2, $3::jsonb, $4::jsonb, app.aktiver_mandant())`,
    // Die OBJEKTE, nicht ihr JSON-Text (D-467).
    [AUDIT_FREIGABE, k.id,
      { format_maske: k.format_maske, zuruecksetzung: k.zuruecksetzung, jahr: k.jahr,
        bezeichnung: k.bezeichnung, ist_platzhalter: true },
      { format_maske: maske, zuruecksetzung: ruecksetzung, jahr, bezeichnung,
        ist_platzhalter: false }]);
  return { jahr, ersteNummer: formatiereNummer(maske, 1, jahr) };
}
