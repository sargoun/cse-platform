import type { SchreibKontext } from '../../kontext/index.js';

/**
 * Was die Verwaltung mit einem LAUFENDEN Zeiteintrag tun darf (V-064,
 * TIM-11, EMP-07, Invariante 5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: eine Sackgasse mit freundlicher Beschriftung.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `korrigiereZeiteintrag` weist einen laufenden Eintrag ab — mit dem Satz
 * „Ein laufender Zeiteintrag wird bearbeitet, nicht korrigiert." Der Satz war
 * richtig und der Weg, auf den er verwies, existierte nicht. Die Verwaltung
 * konnte einen laufenden Eintrag weder schliessen noch stornieren.
 *
 * Das ist kein Randfall. Wer am Freitagabend das Ausstempeln vergisst,
 * erzeugt einen Eintrag, der über das Wochenende weiterläuft: `netto_minuten`
 * bleibt NULL, das Stundenkonto zählt ihn nicht, der Monatsnachweis führt
 * eine Zeile ohne Ende — und `z_offen_uk` lässt je Person genau EINEN offenen
 * Eintrag zu, also kann die Person am Montag nicht einmal wieder
 * einstempeln. Ein vergessener Klick legte damit die Erfassung dieses
 * Menschen still.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das kein UPDATE am Beleg ist — und trotzdem eines.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kern.zeiteintrag_unveraenderlich` beginnt mit
 * `if old.status = 'laufend' then return new; end if;`. Ein laufender
 * Eintrag ist noch kein Beleg: er hat kein Ende, also keine Dauer, also
 * nichts, was jemand abgerechnet hätte. Die Versionskette (TIM-11) beginnt
 * erst dort, wo es etwas zu ersetzen gibt.
 *
 * **Und Invariante 5 bleibt.** Der Server bleibt die Quelle für STEMPEL. Was
 * die Verwaltung hier setzt, ist keine Stempelzeit, sondern eine BEHAUPTUNG,
 * und sie wird als solche gespeichert:
 *
 *   `erfassungsart_ende = 'nacherfassung'`
 *   `quelle_ende        = 'planer_entscheidung'`
 *   `nacherfasst        = true`
 *   `behauptet_ende     = <derselbe Zeitpunkt>`
 *
 * Die BEGRÜNDUNG steht in `zeiteintrag.notiz`. Eine eigene Spalte dafür gibt
 * es nicht, und eine zu erfinden hiesse, eine zweite Halde neben
 * `zeiteintrag_korrektur` aufzumachen — jene Tabelle gehört der
 * Versionskette und beginnt erst bei einem abgeschlossenen Beleg (TIM-11).
 *
 * Die letzte Zeile ist nicht Zierde: `z_anspruch_je_ereignis` verlangt bei
 * `nacherfasst` genau eine solche Behauptung, und `z_quelle_ende_belegt`
 * verlangt `nacherfasst`, sobald `quelle_ende = 'planer_entscheidung'` ist.
 * Das Schema erzwingt damit, was der Satz sagt: eine gesetzte Zeit ist
 * jederzeit als gesetzt erkennbar.
 *
 * // TODO(client, O-890): Muss ein von der Verwaltung geschlossener Zeiteintrag gegengezeichnet werden, bevor er abrechenbar ist (Status `offen_nacherfassung` statt `abgeschlossen`)?
 *
 * `zeiteintrag_status` führt `offen_nacherfassung`, und **nichts im Baum
 * schreibt den Wert**. Er wäre der ehrliche Zustand für „gesetzt, aber noch
 * nicht bestätigt" — nur beschreibt kein Dokument, wer ihn wieder wegnimmt
 * und was bis dahin gilt. Ein Eintrag in einem Zustand, aus dem kein Weg
 * herausführt, ist schlimmer als keiner. Bis zur Antwort schliesst diese
 * Funktion nach `abgeschlossen`; die Spur bleibt vollständig, und die Umkehr
 * ist eine Zeile.
 */

export class LaufenderEintragNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // AUT-06: ein fremder Eintrag ist nicht vorhanden, nicht verboten.
    super(`Zeiteintrag ${id} ist nicht vorhanden oder läuft nicht mehr.`);
    this.name = 'LaufenderEintragNichtGefunden';
  }
}

export class LaufenderEintragFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string, readonly grund: string) {
    super(nachricht);
    this.name = 'LaufenderEintragFehler';
  }
}

interface LaufendeZeile {
  readonly id: string;
  readonly beginn_zeitpunkt: Date;
  readonly person_id: string;
  readonly anstellung_id: string;
}

/** Die MINDESTLÄNGE einer Begründung — dieselbe wie bei der Einwandentscheidung. */
export const BEGRUENDUNG_MINDESTLAENGE = 10;

async function ladeLaufenden(
  kontext: SchreibKontext, id: string,
): Promise<LaufendeZeile> {
  const [z] = await kontext.abfrage<LaufendeZeile>(
    `select id, beginn_zeitpunkt, person_id, anstellung_id
       from zeiteintrag
      where id = $1::uuid and status = 'laufend' and ersetzt_am is null`,
    [id],
  );
  if (z === undefined) throw new LaufenderEintragNichtGefunden(id);
  return z;
}

export interface AbschlussEingabe {
  readonly zeiteintragId: string;
  /** Der behauptete Feierabend — UTC-Instant, nie eine Ortszeit-Zeichenkette. */
  readonly endeZeitpunkt: Date;
  readonly pauseMinuten?: number | undefined;
  readonly begruendung: string;
  readonly benutzerId: string;
}

/**
 * Einen laufenden Eintrag schliessen — der Fall „Ausstempeln vergessen".
 *
 * **Die Zeit muss nach dem Beginn liegen und darf nicht in der Zukunft
 * stehen.** Das erste erzwingt `z_fenster`; das zweite erzwingt nichts, und
 * genau deshalb steht es hier: ein Feierabend, der noch nicht war, ist keine
 * Nacherfassung, sondern ein Tippfehler im Jahr.
 */
export async function schliesseLaufendenEintrag(
  kontext: SchreibKontext, eingabe: AbschlussEingabe,
): Promise<{ readonly id: string; readonly nettoMinuten: number | null }> {
  const z = await ladeLaufenden(kontext, eingabe.zeiteintragId);

  if (eingabe.begruendung.trim().length < BEGRUENDUNG_MINDESTLAENGE) {
    throw new LaufenderEintragFehler(
      'Eine gesetzte Arbeitszeit braucht eine Begründung. Im Streitfall steht '
      + 'sonst da, dass jemand eine Zahl eingetragen hat.',
      'begruendung_zu_kurz');
  }
  if (eingabe.endeZeitpunkt.getTime() <= z.beginn_zeitpunkt.getTime()) {
    throw new LaufenderEintragFehler(
      'Das Ende liegt vor dem Beginn oder auf ihm. Eine Nachtschicht endet am '
      + 'Folgetag — dann gehört der nächste Tag in das Feld.',
      'fenster_ungueltig');
  }
  /*
   * **Die Gegenwart kommt von der SERVERUHR, nicht von `Date.now()`**
   * (Invariante 5, R-11). Der Unterschied ist nicht akademisch: der
   * Anwendungsprozess laeuft auf Vercel, die Datenbank in Frankfurt, und ein
   * Wanduhrversatz zwischen beiden entscheidet hier darueber, ob ein
   * Feierabend als „in der Zukunft" abgewiesen wird. Dieselbe Uhr, die den
   * Beginn gestempelt hat, beurteilt auch das Ende.
   */
  const [jetzt] = await kontext.abfrage<{ jetzt: Date }>(`select now() as jetzt`);
  if (jetzt !== undefined && eingabe.endeZeitpunkt.getTime() > jetzt.jetzt.getTime()) {
    throw new LaufenderEintragFehler(
      'Das Ende liegt in der Zukunft. Ein Feierabend, der noch nicht war, '
      + 'lässt sich nicht nacherfassen.',
      'ende_in_zukunft');
  }
  if (eingabe.pauseMinuten !== undefined
    && (!Number.isInteger(eingabe.pauseMinuten) || eingabe.pauseMinuten < 0)) {
    throw new LaufenderEintragFehler(
      'Die Pause ist eine ganze Zahl von Minuten, mindestens null.',
      'pause_ungueltig');
  }

  const zeilen = await kontext.schreibe<{ id: string; dauer_netto_minuten: number | null }>(
    `update zeiteintrag
        set ende_zeitpunkt      = $2::timestamptz,
            behauptet_ende      = $2::timestamptz,
            pause_minuten       = coalesce($3::int, pause_minuten),
            erfassungsart_ende  = 'nacherfassung',
            quelle_ende         = 'planer_entscheidung',
            nacherfasst         = true,
            status              = 'abgeschlossen',
            notiz               = $4,
            geaendert_am        = now(),
            geaendert_von_art   = 'mensch',
            geaendert_von       = $5::uuid
      where id = $1::uuid and status = 'laufend' and ersetzt_am is null
     returning id, dauer_netto_minuten`,
    [eingabe.zeiteintragId, eingabe.endeZeitpunkt.toISOString(),
      eingabe.pauseMinuten ?? null, eingabe.begruendung.trim(), eingabe.benutzerId],
  );
  const neu = zeilen[0];
  if (neu === undefined) {
    // Kein Treffer trotz gefundener Zeile: die RLS liess das UPDATE nicht zu,
    // weil `zeit.schreiben` fehlt. Von aussen dieselbe Antwort (AUT-06).
    throw new LaufenderEintragNichtGefunden(eingabe.zeiteintragId);
  }
  return {
    id: neu.id,
    nettoMinuten: neu.dauer_netto_minuten === null ? null : Number(neu.dauer_netto_minuten),
  };
}

export interface StornoEingabe {
  readonly zeiteintragId: string;
  readonly grund: string;
  readonly benutzerId: string;
}

/**
 * Einen laufenden Eintrag stornieren — der Fall „versehentlich eingestempelt".
 *
 * **Gelöscht wird nichts** (Invariante 8): die Zeile bleibt mit
 * `status = 'storniert'`, Stempel und Grund stehen. `z_storno_begruendet`
 * verlangt beides zusammen — eine Stornierung ohne Grund lässt die Datenbank
 * gar nicht erst zu, und das ist richtig: sie ist der Vorgang, mit dem
 * Arbeitszeit VERSCHWINDET.
 */
export async function storniereLaufendenEintrag(
  kontext: SchreibKontext, eingabe: StornoEingabe,
): Promise<void> {
  await ladeLaufenden(kontext, eingabe.zeiteintragId);

  if (eingabe.grund.trim().length < BEGRUENDUNG_MINDESTLAENGE) {
    throw new LaufenderEintragFehler(
      'Eine Stornierung braucht einen Grund — sie ist der Vorgang, mit dem '
      + 'erfasste Arbeitszeit verschwindet.',
      'grund_zu_kurz');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update zeiteintrag
        set status        = 'storniert',
            storniert_am  = now(),
            storniert_von = $3::uuid,
            storno_grund  = $2,
            geaendert_am  = now(),
            geaendert_von_art = 'mensch',
            geaendert_von = $3::uuid
      where id = $1::uuid and status = 'laufend' and ersetzt_am is null
     returning id`,
    [eingabe.zeiteintragId, eingabe.grund.trim(), eingabe.benutzerId],
  );
  if (zeilen[0] === undefined) {
    throw new LaufenderEintragNichtGefunden(eingabe.zeiteintragId);
  }
}
