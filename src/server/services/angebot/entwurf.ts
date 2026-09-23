import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { mengeNachPostgres } from '../finanz/menge.js';
import { mengeAusEingabe, preisAusEingabe } from './von-hand.js';

/**
 * **Ein Angebotsentwurf lässt sich berichtigen und zurückziehen** (V-130,
 * D-620, OPS-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `angebotsposition` trägt `revoke delete` (0024:529); das einzige `update`
 * im ganzen Projekt setzte den Einzelpreis nach einer bestätigten
 * Kalkulation. Der Kopf stand genauso da: `archiviert_am` schrieb niemand,
 * und `zurueckgezogen` stand seit 0024 im Aufzählungstyp, ohne dass ein
 * Dienst ihn je setzte.
 *
 * **Ein Tippfehler in einem Entwurf stand damit dauerhaft in der
 * Angebotsliste** — in einem Blatt ohne Nummer, das ausser dem Haus niemand
 * gesehen hat.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Trennlinie ist `versendet_am`, und sie ist nicht neu.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein VERSENDETES Angebot bleibt unveränderlich; eine Änderung ist eine neue
 * Version mit Rückverweis. Das gilt weiter und wird hier nicht angefasst —
 * `ap_unveraenderlich` (0024) weist jeden Schreibversuch darauf ab, und
 * dieser Dienst verlässt sich darauf statt die Regel ein zweites Mal
 * aufzuschreiben.
 *
 * Für den ENTWURF gilt, was Invariante 4 für die Rechnung längst sagt: ohne
 * Nummer frei änderbar, mit Nummer unveränderlich. `angebot_nummer_bei_versand`
 * zieht dieselbe Linie bereits in dieser Tabelle.
 *
 * **Gelöscht wird nichts** (Invariante 8). Eine entfernte Position behält
 * ihre Zeile und trägt Zeitpunkt und Urheber; ein zurückgezogener Entwurf
 * verschwindet aus der Arbeitsliste, nicht aus der Datenbank.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Das Recht wird mit `select … for update` geprüft, nicht mit einer
 * zweiten Abfrage.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `t_mandant` auf `angebot` verlangt `angebot.schreiben` in der `with
 * check`-Klausel. Eine Sperre auf der Kopfzeile prüft damit dasselbe Recht,
 * das der spätere Schreibvorgang verlangt — in DERSELBEN Transaktion und
 * ohne die Lücke zwischen „darf ich" und „ich tue". Findet sie nichts, ist
 * von aussen nicht unterscheidbar, ob es den Entwurf nicht gibt oder ob das
 * Recht fehlt (AUT-06).
 */

export class EntwurfFehler extends Error {
  constructor(
    readonly nachricht: string,
    readonly grund: 'nicht_gefunden' | 'schon_versendet' | 'schon_zurueckgezogen'
      | 'letzte_position' | 'kein_text' | 'keine_menge' | 'kein_betrag' | 'abgewiesen',
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'EntwurfFehler';
  }
}

interface Kopf {
  angebot_id: string;
  versendet_am: string | null;
  status: string;
}

/**
 * Sperrt den Kopf des Entwurfs und gibt ihn zurück — oder wirft.
 *
 * Über die POSITION und nicht über das Angebot: der Aufrufer nennt die
 * Position, und der Kopf dazu ist genau einer. Ein zweiter Parameter
 * `angebotId` wäre eine Angabe, die der Klient bestimmt — und die
 * Gelegenheit, eine fremde Position an ein eigenes Angebot zu hängen.
 */
async function sperreUeberPosition(
  kontext: SchreibKontext, positionId: string,
): Promise<Kopf> {
  const [zeile] = await kontext.schreibe<Kopf>(
    `select a.id as angebot_id, a.versendet_am::text as versendet_am, a.status::text as status
       from angebot a
       join angebotsposition p on p.mandant_id = a.mandant_id and p.angebot_id = a.id
      where p.id = $1::uuid and p.entfernt_am is null
      for update of a`,
    [positionId]);
  if (zeile === undefined) {
    throw new EntwurfFehler(
      'Diese Position gibt es nicht — oder sie ist bereits entfernt.',
      'nicht_gefunden', 404);
  }
  if (zeile.versendet_am !== null) {
    throw new EntwurfFehler(
      'Dieses Angebot ist versendet und damit unveränderlich. Eine Änderung ist '
      + 'eine neue Version mit Rückverweis auf diese.', 'schon_versendet', 409);
  }
  return zeile;
}

export interface Berichtigung {
  readonly positionId: string;
  readonly kurztext: string;
  readonly langtext?: string | null;
  /** Deutsch oder englisch geschrieben — leer heisst: unverändert lassen. */
  readonly menge?: string | null;
  readonly einheit?: string | null;
  /** In Euro, deutsche Schreibweise. */
  readonly einzelpreisEuro?: string | null;
}

/**
 * Berichtigt eine Position eines Entwurfs.
 *
 * **Steuersatz und Typ bleiben, wie sie sind.** Der Satz wurde beim Anlegen
 * am Leistungsdatum aufgelöst (`steuersatz_gruppe`, Invariante 1); ihn hier
 * neu zu setzen hiesse, ihn aus dem Formular zu nehmen — genau die zweite
 * Wahrheit, die `von-hand.ts` ausdrücklich vermeidet. Wer den Satz ändern
 * muss, entfernt die Zeile und legt eine neue an.
 *
 * **`gesamtpreis_cent` wird nicht geschrieben.** Die Spalte ist
 * `generated always as` — die Datenbank multipliziert, nicht JavaScript.
 */
export async function berichtigePosition(
  kontext: SchreibKontext, e: Berichtigung,
): Promise<void> {
  await sperreUeberPosition(kontext, e.positionId);

  const kurztext = e.kurztext.trim();
  if (kurztext === '') {
    throw new EntwurfFehler(
      'Eine Position ohne Kurztext ist keine Position — im Angebot stünde eine '
      + 'Zeile mit Menge und Preis und ohne Leistung.', 'kein_text');
  }

  /*
   * Menge und Preis sind FREIWILLIG: eine Textposition (`typ = 'text'`) hat
   * keine, und `ap_text_ohne_preis` weist sie ab. Ein leeres Feld heisst
   * deshalb „unverändert lassen" und nicht „auf null setzen"; auf null zu
   * setzen bräche `ap_leistung_vollstaendig` bei einer Leistungsposition.
   */
  const menge = (e.menge ?? '').trim() === ''
    ? null : mengeNachPostgres(mengeAusEingabe(e.menge!));
  const preis = (e.einzelpreisEuro ?? '').trim() === ''
    ? null : (preisAusEingabe(e.einzelpreisEuro!) as bigint).toString();
  const einheit = (e.einheit ?? '').trim() === '' ? null : e.einheit!.trim();

  await kontext.schreibe(
    `update angebotsposition
        set kurztext = $2,
            langtext = $3,
            menge = coalesce($4::numeric(12,3), menge),
            einheit = coalesce($5, einheit),
            einzelpreis_cent = coalesce($6::bigint, einzelpreis_cent),
            geaendert_am = now()
      where id = $1::uuid and entfernt_am is null`,
    [e.positionId, kurztext, (e.langtext ?? '').trim() === '' ? null : e.langtext!.trim(),
      menge, einheit, preis]);
}

/**
 * Nimmt eine Position aus dem Entwurf — ohne sie zu löschen.
 *
 * **Die letzte Leistungsposition bleibt stehen.** Ein Angebot ohne Leistung
 * wäre ein Blatt mit Briefkopf, Bindefrist und nichts darin; die Migration
 * weist den Versand eines solchen ab, und dieser Dienst weist schon das
 * Entfernen ab — ein Zustand, aus dem der einzige Weg heraus ein Fehler ist,
 * gehört gar nicht erst erzeugt. Wer das ganze Angebot nicht will, zieht es
 * zurück.
 */
export async function entfernePosition(
  kontext: SchreibKontext, positionId: string, benutzerId: string,
): Promise<void> {
  await sperreUeberPosition(kontext, positionId);

  const [zaehlung] = await kontext.abfrage<{ lebend: number; diese: boolean }>(
    `select count(*) filter (where p.typ = 'leistung' and p.entfernt_am is null)::int as lebend,
            bool_or(p.id = $1::uuid and p.typ = 'leistung') as diese
       from angebotsposition p
      where p.angebot_id = (select angebot_id from angebotsposition where id = $1::uuid)`,
    [positionId]);
  if (zaehlung?.diese === true && Number(zaehlung.lebend) <= 1) {
    throw new EntwurfFehler(
      'Das ist die letzte Leistungsposition. Ein Angebot ohne Leistung ist keines — '
      + 'entweder eine andere Position anlegen oder den ganzen Entwurf zurückziehen.',
      'letzte_position', 409);
  }

  await kontext.schreibe(
    `update angebotsposition
        set entfernt_am = now(), entfernt_von = $2::uuid, geaendert_am = now()
      where id = $1::uuid and entfernt_am is null`,
    [positionId, benutzerId]);
}

/**
 * Zieht einen Entwurf zurück — er verlässt die Arbeitsliste, nicht die
 * Datenbank.
 *
 * `archiviert_am` UND `status` zusammen: die Spalte nimmt ihn aus jeder
 * Liste, die auf sie filtert, der Zustand sagt WARUM er weg ist. Nur eines
 * von beiden zu setzen hiesse, entweder einen Entwurf zu haben, der
 * unsichtbar weiterlebt, oder einen sichtbaren, der nichts mehr wird.
 *
 * **Ein VERSENDETES Angebot zieht man nicht so zurück.** Dafür gibt es den
 * Rückzug nach dem Versand, der eine erklärte Handlung gegenüber dem Kunden
 * ist — `angebot_rueckzug_ehrlich` verlangt dort eine Freigabe. Hier geht es
 * um ein Blatt, das nie jemand gesehen hat.
 */
export async function ziehEntwurfZurueck(
  kontext: SchreibKontext, angebotId: string, benutzerId: string,
): Promise<void> {
  const [kopf] = await kontext.schreibe<{
    versendet_am: string | null; status: string; archiviert_am: string | null;
  }>(
    `select versendet_am::text as versendet_am, status::text as status,
            archiviert_am::text as archiviert_am
       from angebot where id = $1::uuid for update`,
    [angebotId]);
  if (kopf === undefined) {
    throw new EntwurfFehler('Diesen Entwurf gibt es nicht.', 'nicht_gefunden', 404);
  }
  if (kopf.versendet_am !== null) {
    throw new EntwurfFehler(
      'Dieses Angebot ist versendet. Ein abgegebenes Vertragsangebot wird nicht '
      + 'still zurückgezogen — das ist eine Erklärung gegenüber dem Kunden.',
      'schon_versendet', 409);
  }
  if (kopf.status === 'zurueckgezogen') {
    throw new EntwurfFehler(
      'Dieser Entwurf ist bereits zurückgezogen.', 'schon_zurueckgezogen', 409);
  }

  await kontext.schreibe(
    `update angebot
        set status = 'zurueckgezogen', archiviert_am = now(),
            geaendert_am = now(), geaendert_von = $2::uuid
      where id = $1::uuid`,
    [angebotId, benutzerId]);
}
