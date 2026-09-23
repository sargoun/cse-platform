import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { parseGeld, type Cent } from '../finanz/geld.js';
import { mengeNachPostgres, milliMenge, type MilliMenge } from '../finanz/menge.js';
import { legeAngebotAn } from './index.js';
import {
  LEAD_BINDUNG_SATZ, pruefeLeadBindung, type LeadBindungGrund,
} from '../crm/lead-kette.js';

/**
 * **Ein Angebot von Hand — für Sicherheit und Bau** (V-005, SEC-01, BAU-01,
 * Invariante 1, O-60).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `POST /api/angebot` kennt drei Handlungen: `aus_raumbuch`, `versenden`,
 * `in_auftrag`. Die einzige, die ein Angebot ENTSTEHEN lässt, ist die erste —
 * und sie rechnet aus einem Raumbuch: Flächen, Belagsarten, Leistungswerte,
 * Reinigungsturnus. **Das gibt es in der Sicherheit und im Bau nicht.**
 *
 * `legeAngebotAn` steht seit `0024` da und hatte genau einen Aufrufer: den
 * Seed. Zwei von drei Gesellschaften der Gruppe konnten kein Angebot
 * schreiben — nicht „umständlich", sondern gar nicht.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Vier Regeln, die hier und nicht in der Oberfläche stehen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Geld ist ganzzahliger Cent** (Invariante 1). Der Einzelpreis läuft
 * durch `parseGeld` — dieselbe geprüfte Funktion wie bei jeder Rechnung.
 * `gesamtpreis_cent` rechnet die DATENBANK als `generated always as`; die
 * Anwendung multipliziert nicht, und zwei Rechenwege für dieselbe Zahl gäbe
 * es damit gar nicht erst.
 *
 * **2. Die Steuer kommt aus `steuersatz_gruppe`, nicht aus dem Formular**
 * (Invariante 1: „VAT computed per tax-rate group"). Der Satz, das Kennzeichen
 * und der Befreiungsgrund werden am LEISTUNGSDATUM aufgelöst — `0075` führt
 * die Sätze datiert, weil eine Rechnung aus dem Jahr des 16-Prozent-Satzes mit
 * ihm nachrechenbar bleiben muss. Ein Formular, das den Satz als Zahl
 * schickte, wäre die zweite Wahrheit.
 *
 * **3. § 13b heisst NULL Prozent** — `ap_reverse_charge_ohne_steuer` hält es
 * ohnehin, und für den Bau ist es der Regelfall und kein Sonderfall. Die
 * Zuordnung macht die Gruppe, nicht die Oberfläche.
 *
 * **4. Die Menge ist `numeric(12,3)`** und wird als Tausendstel gelesen —
 * keine Fliesskommazahl, nirgends. Eine vierte Nachkommastelle wird
 * abgewiesen statt gerundet: die Spalte trägt drei, und stilles Runden
 * verstecke, woher der Wert kam.
 */
export class HandAngebotFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'unvollstaendig' | 'keine_position' | 'kein_betrag' | 'keine_menge'
      | 'unbekannter_steuersatz' | 'unbekannte_einheit' | 'kein_kunde' | 'kontakt_fremd'
      | 'zeile_ohne_text' | 'abgewiesen' | LeadBindungGrund,
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'HandAngebotFehler';
  }
}

/** Ein Steuersatz, wie ihn die Maske anbietet — aus der Tabelle, nicht erfunden. */
export interface SteuersatzWahl {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly satzBp: number;
  readonly kennzeichen: string;
  readonly befreiungsgrundText: string | null;
}

/**
 * Die am Stichtag gültigen Sätze.
 *
 * **Am Stichtag und nicht „aktuell":** `steuersatz_gruppe` führt
 * `gueltig_von`/`gueltig_bis`, weil es den Satz von 16 % im Jahr 2020 gegeben
 * hat. Ein Angebot mit einem Leistungsdatum in der Vergangenheit rechnet mit
 * dem Satz von damals.
 */
export async function steuersaetzeAm(
  kontext: LeseKontext, datum: string,
): Promise<readonly SteuersatzWahl[]> {
  const zeilen = await kontext.abfrage<{
    schluessel: string; bezeichnung: string; satz_bp: number;
    steuer_kennzeichen: string; befreiungsgrund_text: string | null;
  }>(
    `select schluessel, bezeichnung, satz_bp, steuer_kennzeichen::text as steuer_kennzeichen,
            befreiungsgrund_text
       from steuersatz_gruppe
      where gueltig_von <= $1::date and (gueltig_bis is null or gueltig_bis >= $1::date)
      order by satz_bp desc, schluessel`, [datum]);
  return zeilen.map((z) => ({
    schluessel: z.schluessel,
    bezeichnung: z.bezeichnung,
    satzBp: z.satz_bp,
    kennzeichen: z.steuer_kennzeichen,
    befreiungsgrundText: z.befreiungsgrund_text,
  }));
}

/** Die Einheiten, wie sie `masseinheit` (0075) führt. */
export async function einheiten(
  kontext: LeseKontext,
): Promise<readonly { readonly schluessel: string; readonly bezeichnung: string }[]> {
  return kontext.abfrage<{ schluessel: string; bezeichnung: string }>(
    `select schluessel, bezeichnung from masseinheit order by bezeichnung`);
}

const MENGE_MUSTER = /^\d{1,9}(?:[.,]\d{1,3})?$/u;

/**
 * `"10,5"` → `10_500n`. Deutsche ODER englische Schreibweise des Dezimaltrenners,
 * höchstens drei Nachkommastellen.
 *
 * **Warum hier beide Trenner zulässig sind und bei GELD nicht.** Bei Geld
 * unterscheidet der Punkt Tausender von Cent: `1.234` ist eintausend­zwei­hundert­
 * vierunddreissig Euro, und wer ihn als Dezimalpunkt läse, verfehlte den Betrag
 * um den Faktor tausend. Eine Menge kennt keine Tausendergruppierung in diesem
 * Feld — `10.5` und `10,5` sind zehneinhalb, in jeder Lesart. Tausender werden
 * darum gar nicht erst angenommen.
 *
 * Getrennt und exportiert, damit die Regel ohne Datenbank prüfbar ist.
 */
export function mengeAusEingabe(eingabe: string): MilliMenge {
  const text = eingabe.trim().replace(/\s/gu, '');
  if (!MENGE_MUSTER.test(text)) {
    throw new HandAngebotFehler(
      `Das ist keine Menge: ${JSON.stringify(eingabe)}. Höchstens drei Nachkommastellen, `
      + 'kein Tausenderpunkt — „10,5" oder „10.5".', 'keine_menge');
  }
  const [ganz = '0', bruch = ''] = text.replace(',', '.').split('.');
  const tausendstel = BigInt(ganz) * 1000n + BigInt(bruch.padEnd(3, '0'));
  if (tausendstel === 0n) {
    throw new HandAngebotFehler(
      'Eine Position mit der Menge null ist keine Position — `ap_leistung_menge_nicht_null` '
      + 'lässt sie ohnehin nicht zu.', 'keine_menge');
  }
  return milliMenge(tausendstel);
}

/** Der Einzelpreis als ganze Cent — über die geprüfte Geldfunktion. */
export function preisAusEingabe(eingabe: string): Cent {
  let betrag: Cent;
  try {
    betrag = parseGeld(eingabe);
  } catch {
    throw new HandAngebotFehler(
      `Das ist kein Betrag in deutscher Schreibweise: ${JSON.stringify(eingabe)}. `
      + 'Punkt trennt die Tausender, Komma die Cent — „1.250,00".', 'kein_betrag');
  }
  if ((betrag as bigint) < 0n) {
    throw new HandAngebotFehler(
      'Ein Einzelpreis ist nicht negativ. Ein Abzug ist eine eigene Position oder eine '
      + 'Gutschrift, keine Zahl mit Minus davor.', 'kein_betrag');
  }
  return betrag;
}

export interface HandPosition {
  readonly kurztext: string;
  readonly langtext?: string | null;
  /** Deutsch oder englisch geschrieben, höchstens drei Nachkommastellen. */
  readonly menge: string;
  /** Der Schlüssel aus `masseinheit`. */
  readonly einheit: string;
  /** In Euro, deutsche Schreibweise. */
  readonly einzelpreisEuro: string;
  /** Der Schlüssel aus `steuersatz_gruppe` — nie ein Satz als Zahl. */
  readonly steuersatzSchluessel: string;
}

export interface HandAngebot {
  readonly kundeId: string;
  readonly titel: string;
  readonly objektId?: string | null;
  readonly ansprechpartnerId?: string | null;
  readonly gueltigBis?: string | null;
  readonly einleitungstext?: string | null;
  /**
   * Die Anfrage, auf die das Angebot antwortet (V-138, CRM-05). Sie muss in
   * dieser Gesellschaft stehen und DEMSELBEN Kunden gehören.
   */
  readonly leadId?: string | null;
  /** Das Datum, zu dem der Steuersatz aufgelöst wird — der Berliner Heute-Tag. */
  readonly stichtag: string;
  readonly positionen: readonly HandPosition[];
}

/**
 * Eine Zeile ist LEER, wenn sie in JEDEM Feld leer ist — nicht, wenn ihr
 * Kurztext fehlt.
 *
 * Das Formular stellt eine feste Zahl Zeilen hin, und die meisten bleiben
 * ungenutzt; die stillschweigend zu überspringen ist richtig. Eine Zeile mit
 * Menge und Preis, aber ohne Kurztext, zu überspringen wäre es nicht: das
 * Angebot entstünde ohne sie, sähe vollständig aus, und die Position wäre
 * weg. Genau solche Fehler heissen später „das stand doch im Angebot".
 */
function istLeer(p: HandPosition): boolean {
  return p.kurztext.trim() === '' && p.menge.trim() === ''
    && p.einzelpreisEuro.trim() === '' && (p.langtext ?? '').trim() === '';
}

export async function legeAngebotVonHandAn(
  kontext: SchreibKontext, e: HandAngebot,
): Promise<{ readonly angebotId: string; readonly positionen: number }> {
  if (e.titel.trim() === '') {
    throw new HandAngebotFehler('Ein Angebot braucht einen Titel.', 'unvollstaendig');
  }
  const zeilen = e.positionen.filter((p) => !istLeer(p));
  if (zeilen.length === 0) {
    throw new HandAngebotFehler(
      'Ein Angebot ohne Position ist kein Angebot. Tragen Sie mindestens eine Leistung ein.',
      'keine_position');
  }
  const ohneText = zeilen.findIndex((p) => p.kurztext.trim() === '');
  if (ohneText >= 0) {
    throw new HandAngebotFehler(
      `Zeile ${String(ohneText + 1)} trägt Menge oder Preis, aber keinen Kurztext. Eine `
      + 'Position ohne Bezeichnung wird hier nicht stillschweigend weggelassen.',
      'zeile_ohne_text');
  }

  /*
   * **Erst alles prüfen, dann schreiben.** Ein Angebot mit zwei von drei
   * Zeilen und einer Fehlermeldung wäre schlimmer als gar keines: es sähe
   * fertig aus.
   *
   * **Das war einmal das einzige Argument, und es ist es nicht mehr** (O-900
   * → D-626, V-130). Als diese Datei entstand, liess sich eine
   * Angebotsposition nicht mehr ändern und nicht entfernen; eine halbe
   * Fassung blieb für immer stehen. Seit `0392` trägt ein ENTWURF beides —
   * `services/angebot/entwurf.ts` berichtigt und entfernt, und der ganze
   * Entwurf lässt sich zurückziehen.
   *
   * Die Reihenfolge bleibt trotzdem: eine Fehlermeldung, nach der man
   * aufräumen muss, ist eine schlechtere Fehlermeldung als eine, nach der
   * nichts entstanden ist. Was jetzt anders ist: sie ist eine Bequemlichkeit
   * und keine Notwendigkeit mehr.
   */
  const [kunde] = await kontext.abfrage<{ id: string }>(
    `select id from kunde
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null`, [e.kundeId]);
  if (kunde === undefined) {
    throw new HandAngebotFehler(
      'Zu diesem Kunden lässt sich kein Angebot schreiben — archiviert, oder nicht in '
      + 'dieser Gesellschaft.', 'kein_kunde');
  }

  /*
   * Der Ansprechpartner muss DIESEM Kunden gehören.
   *
   * `angebot_ansprechpartner_fk` schliesst über `(mandant_id, kunde_id, id)`;
   * ein fremder Kontakt fiele also ohnehin, aber als Fremdschlüsselverstoss —
   * eine 500er-Seite für einen Tippfehler in einer Auswahlliste. Das Formular
   * kann die Liste ohne Javascript nicht am Kunden ausrichten, also prüft es
   * der Dienst und sagt es in einem Satz.
   */
  if (e.ansprechpartnerId !== null && e.ansprechpartnerId !== undefined
      && e.ansprechpartnerId !== '') {
    const [kontakt] = await kontext.abfrage<{ id: string }>(
      `select id from ansprechpartner
        where id = $1::uuid and mandant_id = app.aktiver_mandant()
          and kunde_id = $2::uuid and archiviert_am is null`,
      [e.ansprechpartnerId, e.kundeId]);
    if (kontakt === undefined) {
      throw new HandAngebotFehler(
        'Dieser Ansprechpartner gehört nicht zu diesem Kunden.', 'kontakt_fremd');
    }
  }

  /*
   * Die Anfrage gehört zu DIESEM Kunden (V-138) — vor dem ersten Schreiben,
   * damit der Satz ankommt und nicht ein halbes Angebot.
   */
  const leadId = e.leadId === null || e.leadId === undefined || e.leadId === ''
    ? null : e.leadId;
  if (leadId !== null) {
    const bindung = await pruefeLeadBindung(kontext, leadId, e.kundeId);
    if (!bindung.ok) {
      throw new HandAngebotFehler(LEAD_BINDUNG_SATZ[bindung.grund], bindung.grund);
    }
  }

  const saetze = new Map(
    (await steuersaetzeAm(kontext, e.stichtag)).map((s) => [s.schluessel, s]));
  const bekannteEinheiten = new Set(
    (await einheiten(kontext)).map((m) => m.schluessel));

  const gerechnet = zeilen.map((p) => {
    const satz = saetze.get(p.steuersatzSchluessel);
    if (satz === undefined) {
      throw new HandAngebotFehler(
        `Zum ${e.stichtag} gibt es keinen Steuersatz „${p.steuersatzSchluessel}". Die Sätze `
        + 'stehen datiert in der Referenztabelle; erfunden wird hier keiner.',
        'unbekannter_steuersatz');
    }
    if (!bekannteEinheiten.has(p.einheit)) {
      throw new HandAngebotFehler(
        `Die Einheit „${p.einheit}" steht nicht im Einheitenverzeichnis.`,
        'unbekannte_einheit');
    }
    return {
      kurztext: p.kurztext.trim(),
      langtext: (p.langtext ?? '').trim() === '' ? null : (p.langtext ?? '').trim(),
      menge: mengeAusEingabe(p.menge),
      einheit: p.einheit,
      preis: preisAusEingabe(p.einzelpreisEuro),
      satz,
    };
  });

  const angebotId = await legeAngebotAn(kontext, {
    kundeId: e.kundeId,
    titel: e.titel.trim(),
    ...(e.objektId === null || e.objektId === undefined ? {} : { objektId: e.objektId }),
    ...(e.ansprechpartnerId === null || e.ansprechpartnerId === undefined
      || e.ansprechpartnerId === '' ? {} : { ansprechpartnerId: e.ansprechpartnerId }),
    ...(e.gueltigBis === null || e.gueltigBis === undefined || e.gueltigBis === ''
      ? {} : { gueltigBis: e.gueltigBis }),
    ...(e.einleitungstext === null || e.einleitungstext === undefined
      || e.einleitungstext.trim() === '' ? {} : { einleitungstext: e.einleitungstext.trim() }),
    ...(leadId === null ? {} : { leadId }),
  });

  let nr = 0;
  for (const z of gerechnet) {
    nr += 1;
    /*
     * `gesamtpreis_cent` steht NICHT in der Spaltenliste: die Datenbank
     * rechnet sie als `generated always as (round(menge * einzelpreis))`.
     * Sie hier noch einmal auszurechnen wäre der zweite Rechenweg für
     * dieselbe Zahl — und der erste, der abweicht, gewinnt den Streit.
     */
    const [zeile] = await kontext.schreibe<{ id: string }>(
      `insert into angebotsposition
         (mandant_id, angebot_id, position_nr, typ, kurztext, langtext, objekt_id,
          menge, einheit, einzelpreis_cent, steuersatz_bp, steuer_kennzeichen,
          steuerbefreiung_grund, sortierung)
       values (app.aktiver_mandant(), $1::uuid, $2::integer, 'leistung', $3, $4, $5::uuid,
               $6::numeric, $7, $8::bigint, $9::integer, $10::steuer_kennzeichen,
               $11, $2::integer)
       returning id`,
      [angebotId, nr, z.kurztext, z.langtext, e.objektId ?? null,
        mengeNachPostgres(z.menge), z.einheit, (z.preis as bigint).toString(),
        z.satz.satzBp, z.satz.kennzeichen,
        /*
         * `ap_steuerfrei_mit_grund` verlangt den Grund bei `steuerfrei`, und
         * `angebot_steuer` druckt ihn beim Versand ins Dokument. Er kommt aus
         * der GRUPPE — eine Befreiung, deren Grund die Oberfläche tippt, ist
         * eine Behauptung ohne Rechtsgrundlage.
         */
        z.satz.befreiungsgrundText]);
    if (zeile === undefined) {
      throw new HandAngebotFehler(
        'Die Position wurde nicht angelegt — fehlt `angebot.schreiben` in dieser '
        + 'Gesellschaft?', 'abgewiesen', 403);
    }
  }

  return { angebotId, positionen: nr };
}
