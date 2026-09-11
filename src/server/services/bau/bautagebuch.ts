/**
 * Das Bautagebuch (BAU-07, BAU-08, 03-GEWERKE §7.12 – §7.15, LEG-01).
 *
 * Ein Bautagebuch ist die laufende Beweisfuehrung einer Baustelle. Aus ihm
 * werden im Streitfall die Bauzeit, die Behinderung und der
 * Mehrverguetungsanspruch hergeleitet — und es ist genau so viel wert, wie
 * sich zeigen laesst, dass niemand eine Seite nachtraeglich geglaettet hat.
 * Deshalb tut dieser Dienst drei Dinge, und keines davon nebenbei:
 *
 *  1. **Er fuegt AN.** `bautagebuch_mannstunden` und `bautagebuch_position`
 *     kennen kein inhaltliches UPDATE (0082). Eine falsche Zeile wird
 *     storniert und durch eine neue ersetzt, die sie nennt
 *     (`ersetzt_durch_id`) — genau das Muster von `wachbuch_eintrag` (0070,
 *     PR 41). Die falsche Zeile bleibt lesbar stehen, denn dass zuerst etwas
 *     anderes dastand, gehoert zur Wahrheit des Tages.
 *  2. **Er meldet die Abweichung, statt sie zu verstecken.** Die Mannstunden
 *     der EIGENEN Kraefte werden gegen `zeiteintrag` desselben Tages und
 *     derselben Baustelle gehalten. §7.13 ist ausdruecklich: das ist ein
 *     BERICHT und keine Bedingung — das Tagebuch zaehlt auch Nachunternehmer,
 *     und die schreiben keinen `zeiteintrag`. Eine Bedingung daraus zu machen
 *     hiesse, die Zeile eines Nachunternehmers unspeicherbar zu machen.
 *  3. **Er erfindet nichts.** Kein Wetter (das steht in `wetter.ts`), keine
 *     Toleranz, keine hochgerechnete Stunde. Wo eine Zahl fehlt, steht, dass
 *     sie fehlt, und warum.
 *
 * **Die harten Zusagen stehen in der Datenbank.** Die Serverzeit auf Abschluss
 * und Storno, das Einfrieren ab `abgeschlossen_am`, das Ableiten des Projekts
 * auf die Kindzeilen und das Loeschverbot sind Ausloeser in 0082 — nicht
 * Hoeflichkeiten dieses Moduls. Was hier steht, ist die LESBARE erste Linie:
 * ein Mensch soll einen Satz sehen und keinen Datenbankfehler.
 */
import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/* ---------------------------------------------------------------------------
 * 0. Fehler und Vokabular
 * ------------------------------------------------------------------------ */

export type BautagFehlerGrund =
  | 'nicht_gefunden'
  | 'ungueltige_eingabe'
  | 'tag_abgeschlossen'
  | 'tag_storniert'
  | 'schon_storniert'
  | 'tag_vorhanden'
  | 'kein_gewerk';

export class BautagebuchFehler extends Error {
  readonly status: number;
  constructor(readonly code: BautagFehlerGrund, nachricht: string) {
    super(nachricht);
    this.name = 'BautagebuchFehler';
    // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
    this.status = code === 'nicht_gefunden' ? 404 : code === 'ungueltige_eingabe' ? 422 : 409;
  }
}

export const BAUTAGEBUCH_STATUS = ['entwurf', 'abgeschlossen', 'gegengezeichnet'] as const;
export type BautagebuchStatus = (typeof BAUTAGEBUCH_STATUS)[number];

export const POSITION_ARTEN = ['geraet', 'lieferung', 'vorkommnis'] as const;
export type PositionArt = (typeof POSITION_ARTEN)[number];

export const HERKUENFTE = ['eigen', 'nachunternehmer'] as const;
export type MannstundenHerkunft = (typeof HERKUENFTE)[number];

export function istPositionArt(wert: unknown): wert is PositionArt {
  return typeof wert === 'string' && (POSITION_ARTEN as readonly string[]).includes(wert);
}

export function istHerkunft(wert: unknown): wert is MannstundenHerkunft {
  return typeof wert === 'string' && (HERKUENFTE as readonly string[]).includes(wert);
}

/** Die deutschen Bezeichnungen — die Oberflaeche des Portals ist deutsch. */
export const POSITION_ART_TEXT: Readonly<Record<PositionArt, string>> = {
  geraet: 'Gerät',
  lieferung: 'Lieferung',
  vorkommnis: 'Vorkommnis',
};

export const HERKUNFT_TEXT: Readonly<Record<MannstundenHerkunft, string>> = {
  eigen: 'eigene Kräfte',
  nachunternehmer: 'Nachunternehmer',
};

/** So kurz darf ein Stornogrund sein — „Zahlendreher" ist einer. */
const GRUND_MINDESTLAENGE = 5;

/** `JJJJ-MM-TT`, ein Berliner Kalendertag (K-11) — nie ein Zeitpunkt. */
const TAG_MUSTER = /^\d{4}-\d{2}-\d{2}$/u;

export function istKalendertag(wert: unknown): wert is string {
  return typeof wert === 'string' && TAG_MUSTER.test(wert);
}

/* ---------------------------------------------------------------------------
 * 1. Der Tageskopf
 * ------------------------------------------------------------------------ */

interface KopfZustand {
  readonly id: string;
  readonly projekt_id: string;
  readonly datum: string;
  readonly status: BautagebuchStatus;
  readonly abgeschlossen: boolean;
  readonly storniert: boolean;
}

/**
 * Der Zustand des Kopfes — die Frage, die vor jeder Anfuegung steht.
 *
 * Sie wird GESTELLT und nicht erraten: der Ausloeser in 0082 weist eine
 * Kindzeile zu einem abgeschlossenen Tag ab, aber mit einer
 * Datenbankmeldung. Wer hier zuerst fragt, kann dem Menschen sagen, was
 * stattdessen zu tun ist — Storno des Tages und ein Ersatztag.
 */
async function kopfZustand(
  kontext: LeseKontext, bautagebuchId: string,
): Promise<KopfZustand | null> {
  const [zeile] = await kontext.abfrage<KopfZustand>(
    `select b.id, b.projekt_id, to_char(b.datum, 'YYYY-MM-DD') as datum,
            b.status::text as status,
            (b.abgeschlossen_am is not null) as abgeschlossen,
            (b.storniert_am is not null) as storniert
       from bautagebuch b
      where b.id = $1::uuid`,
    [bautagebuchId],
  );
  return zeile ?? null;
}

/** Wirft, wenn an diesem Tag nichts mehr angefuegt werden darf. */
async function offenerKopf(
  kontext: LeseKontext, bautagebuchId: string,
): Promise<KopfZustand> {
  const kopf = await kopfZustand(kontext, bautagebuchId);
  if (kopf === null) {
    throw new BautagebuchFehler(
      'nicht_gefunden', 'Diesen Bautag gibt es in dieser Gesellschaft nicht.',
    );
  }
  if (kopf.storniert) {
    throw new BautagebuchFehler(
      'tag_storniert',
      'Zu einem stornierten Bautag wird nichts mehr erfasst. Der Ersatztag nimmt die '
      + 'Eintragung auf.',
    );
  }
  if (kopf.abgeschlossen) {
    throw new BautagebuchFehler(
      'tag_abgeschlossen',
      'Der Bautag ist abgeschlossen — es kommt nichts mehr hinzu. Korrigiert wird durch '
      + 'Storno des Tages und einen Ersatztag, nie durch Ändern (BAU-07, LEG-01).',
    );
  }
  return kopf;
}

export interface BautagEingabe {
  readonly projektId: string;
  /** Berliner Kalendertag `JJJJ-MM-TT` (K-11). */
  readonly datum: string;
  /** UTC-Zeitpunkte; die Anzeige rechnet nach Europe/Berlin (Invariante 2). */
  readonly arbeitsbeginn?: string | null;
  readonly arbeitsende?: string | null;
  readonly besondereVorkommnisse?: string | null;
  readonly bemerkungen?: string | null;
  readonly wetterNotiz?: string | null;
}

/**
 * Legt den Tageskopf an.
 *
 * **Die Kennung entsteht in der Anwendung** — dieselbe Begruendung wie im
 * Wachbuch (PR 41): `insert … returning id` zieht die SELECT-Policy der
 * Tabelle mit hinein, und ein Zugang, der schreiben aber nicht lesen darf,
 * bekaeme „null Zeilen" und damit einen Rechtefehler, der keiner ist.
 *
 * Das Projekt wird VORHER gefragt. Ohne die Frage antwortete der
 * zusammengesetzte Fremdschluessel mit einer Verletzungsmeldung, und ein
 * fremdes Projekt saehe anders aus als ein nicht vorhandenes — AUT-06 will
 * genau das nicht.
 */
export async function legeBautagAn(
  kontext: SchreibKontext, eingabe: BautagEingabe,
): Promise<string> {
  if (!istKalendertag(eingabe.datum)) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe', 'Ein Bautag trägt einen Kalendertag in der Form JJJJ-MM-TT.',
    );
  }

  const [projekt] = await kontext.abfrage<{ id: string }>(
    `select p.id from projekt p where p.id = $1::uuid and p.mandant_id = $2::uuid`,
    [eingabe.projektId, kontext.aktiverMandantId],
  );
  if (projekt === undefined) {
    throw new BautagebuchFehler('nicht_gefunden', 'Dieses Projekt gibt es hier nicht.');
  }

  const id = randomUUID();
  try {
    await kontext.schreibe(
      `insert into bautagebuch
         (id, mandant_id, projekt_id, datum, arbeitsbeginn, arbeitsende,
          besondere_vorkommnisse, bemerkungen, wetter_notiz,
          erstellt_von_art, erstellt_von, erstellt_von_person_id)
       values ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::timestamptz, $6::timestamptz,
               $7, $8, $9, 'mensch', app.aktueller_benutzer(), app.aktuelle_person())`,
      [
        id, kontext.aktiverMandantId, eingabe.projektId, eingabe.datum,
        eingabe.arbeitsbeginn ?? null, eingabe.arbeitsende ?? null,
        leerZuNull(eingabe.besondereVorkommnisse), leerZuNull(eingabe.bemerkungen),
        leerZuNull(eingabe.wetterNotiz),
      ],
    );
  } catch (fehler: unknown) {
    if (istEindeutigkeitsverstoss(fehler, 'bautagebuch_tag_uk')) {
      /**
       * Ein LEBENDER Tag je Projekt und Kalendertag (0082). Der zweite
       * Versuch ist fast immer ein zweiter Browsertab, kein Fehler des
       * Menschen — also sagt die Meldung, wohin er gehoert.
       */
      throw new BautagebuchFehler(
        'tag_vorhanden',
        `Zum ${eingabe.datum} gibt es auf dieser Baustelle bereits einen Bautag. `
        + 'Er nimmt die Eintragung auf.',
      );
    }
    throw fehler;
  }
  return id;
}

/**
 * Der Tag zu einem Datum — vorhanden oder neu.
 *
 * Die Tagesseite wird ueber ihr DATUM adressiert (SEITENKARTE §5.9), nicht
 * ueber eine Kennung: die Bauleitung tippt „heute" und nicht eine UUID. Ohne
 * diese Funktion muesste jede Seite erst suchen und dann anlegen, mit dem
 * Wettlauf zweier Telefone dazwischen.
 */
export async function findeOderLegeBautagAn(
  kontext: SchreibKontext, projektId: string, datum: string,
): Promise<string> {
  const vorhanden = await findeBautagZuDatum(kontext, projektId, datum);
  if (vorhanden !== null) return vorhanden.id;
  try {
    return await legeBautagAn(kontext, { projektId, datum });
  } catch (fehler: unknown) {
    if (fehler instanceof BautagebuchFehler && fehler.code === 'tag_vorhanden') {
      const jetzt = await findeBautagZuDatum(kontext, projektId, datum);
      if (jetzt !== null) return jetzt.id;
    }
    throw fehler;
  }
}

/**
 * Schliesst den Tag (§7.12: „immutable after the day is closed").
 *
 * `abgeschlossen_am` wird nicht MITGESCHICKT: der Ausloeser `bautagebuch_stempeln`
 * ersetzt jeden uebergebenen Zeitpunkt durch `now()` (Invariante 5). Ein
 * Zeitpunkt aus dem Browser waere die Antwort auf „wann wurde der Tag
 * geschlossen" — und die gehoert nicht dem Aufrufer: mit ihr liesse sich ein
 * Tagebuch drei Wochen spaeter schreiben und zurueckdatieren.
 */
export async function schliesseBautag(
  kontext: SchreibKontext, bautagebuchId: string,
): Promise<void> {
  await offenerKopf(kontext, bautagebuchId);
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update bautagebuch
        set status = 'abgeschlossen', abgeschlossen_am = now(),
            geaendert_von = app.aktueller_benutzer(), geaendert_von_art = 'mensch'
      where id = $1::uuid and mandant_id = $2::uuid
        and abgeschlossen_am is null and storniert_am is null
      returning id`,
    [bautagebuchId, kontext.aktiverMandantId],
  );
  if (zeilen.length === 0) {
    throw new BautagebuchFehler(
      'tag_abgeschlossen', 'Dieser Bautag wurde inzwischen von jemand anderem geschlossen.',
    );
  }
}

/**
 * Die Gegenzeichnung durch die BAULEITUNG DES AUFTRAGGEBERS (§3.3).
 *
 * Sie ist im Werklohnprozess etwas anderes als ein vom Auftragnehmer
 * abgeschlossener Tag — deshalb ein eigener Status und nicht eine Spalte
 * daneben. Der Zeitpunkt kommt wieder von der Serveruhr.
 */
export async function gegenzeichneBautag(
  kontext: SchreibKontext,
  eingabe: { readonly bautagebuchId: string; readonly name: string },
): Promise<void> {
  const name = eingabe.name.trim();
  if (name === '') {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Eine Gegenzeichnung ohne Namen belegt nichts. Wer hat den Tag anerkannt?',
    );
  }
  const kopf = await kopfZustand(kontext, eingabe.bautagebuchId);
  if (kopf === null) {
    throw new BautagebuchFehler('nicht_gefunden', 'Diesen Bautag gibt es hier nicht.');
  }
  if (kopf.storniert) {
    throw new BautagebuchFehler(
      'tag_storniert', 'Ein stornierter Bautag wird nicht gegengezeichnet.',
    );
  }
  if (!kopf.abgeschlossen) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Gegengezeichnet wird ein abgeschlossener Tag. Solange er ein Entwurf ist, kann '
      + 'sich sein Inhalt noch ändern — und die Anerkennung bezöge sich auf etwas anderes.',
    );
  }
  await kontext.schreibe(
    `update bautagebuch
        set status = 'gegengezeichnet',
            gegengezeichnet_von_name = $3, gegengezeichnet_am = now(),
            geaendert_von = app.aktueller_benutzer(), geaendert_von_art = 'mensch'
      where id = $1::uuid and mandant_id = $2::uuid and storniert_am is null`,
    [eingabe.bautagebuchId, kontext.aktiverMandantId, name],
  );
}

/**
 * Storno des Tages, mit Ersatztag — die Korrekturspur auf Kopfebene.
 *
 * Drei Schritte in EINER Transaktion, und die Reihenfolge ist nicht beliebig:
 *
 *  1. der alte Tag wird storniert — erst danach laesst der eindeutige Index
 *     `bautagebuch_tag_uk` (lebender Tag je Projekt und Kalendertag) einen
 *     zweiten Tag desselben Datums zu;
 *  2. der Ersatztag entsteht;
 *  3. der alte zeigt auf ihn (`ersetzt_durch_id`).
 *
 * Der alte Tag bleibt LESBAR — das ist der ganze Punkt. Ein Bautagebuch, aus
 * dem sich die falsche Seite entfernen laesst, beweist nichts; erst das
 * Nebeneinander von Irrtum und Richtigstellung tut es.
 *
 * Der Inhalt wird NICHT uebernommen. Was am falschen Tag stand, war falsch;
 * ihn stillschweigend zu kopieren erzeugte eine zweite Seite mit demselben
 * Irrtum und der Behauptung, sie sei die Richtigstellung.
 */
export async function ersetzeBautag(
  kontext: SchreibKontext,
  eingabe: { readonly bautagebuchId: string; readonly grund: string },
): Promise<string> {
  const grund = eingabe.grund.trim();
  if (grund.length < GRUND_MINDESTLAENGE) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Ein Storno ohne Grund ist im Streitfall keine Auskunft. Warum war der Tag falsch?',
    );
  }
  const kopf = await kopfZustand(kontext, eingabe.bautagebuchId);
  if (kopf === null) {
    throw new BautagebuchFehler('nicht_gefunden', 'Diesen Bautag gibt es hier nicht.');
  }
  if (kopf.storniert) {
    throw new BautagebuchFehler(
      'schon_storniert',
      'Dieser Tag ist bereits storniert. Eine zweite Korrektur knüpft an den Tag an, der '
      + 'ihn ersetzt hat — nicht an diesen.',
    );
  }

  const storniert = await kontext.schreibe<{ id: string }>(
    `update bautagebuch
        set storniert_am = now(), storniert_von = app.aktueller_benutzer(),
            storno_grund = $3
      where id = $1::uuid and mandant_id = $2::uuid and storniert_am is null
      returning id`,
    [eingabe.bautagebuchId, kontext.aktiverMandantId, grund],
  );
  if (storniert.length === 0) {
    // Zwischen Lesen und Schreiben hat jemand anderes storniert. Werfen, damit
    // die Transaktion zurueckrollt — sonst entstuende ein zweiter Ersatztag.
    throw new BautagebuchFehler('schon_storniert', 'Dieser Tag wurde inzwischen storniert.');
  }

  const ersatz = await legeBautagAn(kontext, {
    projektId: kopf.projekt_id,
    datum: kopf.datum,
  });

  /**
   * `ersetzt_durch_id` bewegt sich auch nach dem Abschluss noch: das
   * Einfrieren aus 0082 nennt die Inhaltsspalten und den Abschlusszeitpunkt,
   * und der Verweis auf die Richtigstellung ist keine davon. Waere er
   * eingefroren, gaebe es fuer einen geschlossenen Tag gar keine Spur.
   */
  await kontext.schreibe(
    `update bautagebuch set ersetzt_durch_id = $3::uuid
      where id = $1::uuid and mandant_id = $2::uuid`,
    [eingabe.bautagebuchId, kontext.aktiverMandantId, ersatz],
  );
  return ersatz;
}

/* ---------------------------------------------------------------------------
 * 2. Mannstunden je Gewerk — anfuegend
 * ------------------------------------------------------------------------ */

export interface MannstundenEingabe {
  readonly bautagebuchId: string;
  readonly gewerkId: string;
  readonly herkunft: MannstundenHerkunft;
  readonly anzahlPersonen: number;
  /** Eine GEMESSENE Dauer in ganzen Minuten (K-16), nie eine Bruchzahl Stunden. */
  readonly dauerMinuten: number;
  readonly nachunternehmerFirmaId?: string | null;
  readonly nachunternehmerName?: string | null;
  readonly taetigkeit?: string | null;
  readonly bereich?: string | null;
}

function pruefeMannstunden(eingabe: MannstundenEingabe): void {
  if (!Number.isInteger(eingabe.anzahlPersonen) || eingabe.anzahlPersonen <= 0) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe', 'Eine Kolonne besteht aus mindestens einem Menschen.',
    );
  }
  if (!Number.isInteger(eingabe.dauerMinuten)
      || eingabe.dauerMinuten < 0 || eingabe.dauerMinuten > 1440) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Die Dauer wird in ganzen Minuten erfasst und liegt zwischen 0 und 1440 — ein '
      + 'Kalendertag hat 1440 Minuten. Das ist eine Eingabeplausibilität und '
      + 'ausdrücklich keine ArbZG-Grenze: die gilt je Person über alle Gesellschaften.',
    );
  }
  const firma = (eingabe.nachunternehmerFirmaId ?? '').trim();
  const name = (eingabe.nachunternehmerName ?? '').trim();
  if (eingabe.herkunft === 'nachunternehmer' && firma === '' && name === '') {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Ein Nachunternehmer ohne Namen ist keiner. Welche Firma hat die Stunden geleistet?',
    );
  }
  if (eingabe.herkunft === 'eigen' && (firma !== '' || name !== '')) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Eigene Kräfte tragen keinen Nachunternehmer. Die Unterscheidung trägt den '
      + 'Abgleich mit der Zeiterfassung — nur eigene Stunden erzeugen einen Zeiteintrag.',
    );
  }
}

/**
 * Fuegt eine Mannstundenzeile an.
 *
 * `projekt_id` wird NICHT mitgeschickt: `kern.bautagebuch_kind_erben` leitet
 * es vom Kopf ab (0082). Waere es eine Eingabe, koennte eine Zeile
 * behaupten, zu einem anderen Projekt zu gehoeren als ihr Tag — und genau
 * darauf ruhen die Mitarbeiterdecke und `t_person`, die nach §1.8 nicht ueber
 * den Elternteil joinen duerfen.
 */
export async function hefteMannstundenAn(
  kontext: SchreibKontext, eingabe: MannstundenEingabe,
): Promise<string> {
  pruefeMannstunden(eingabe);
  await offenerKopf(kontext, eingabe.bautagebuchId);

  const [gewerk] = await kontext.abfrage<{ id: string }>(
    `select g.id from gewerk g
      where g.id = $1::uuid and g.mandant_id = $2::uuid and g.archiviert_am is null`,
    [eingabe.gewerkId, kontext.aktiverMandantId],
  );
  if (gewerk === undefined) {
    /**
     * Der Gewerkekatalog wird LEER ausgeliefert (O-159). Das hier ist deshalb
     * der haeufigste erste Fehler — und eine Meldung, die den Grund nennt,
     * erspart die Suche nach einer Zeile, die es noch gar nicht geben kann.
     */
    throw new BautagebuchFehler(
      'kein_gewerk',
      'Dieses Gewerk gibt es in dieser Gesellschaft nicht. Der Gewerkekatalog wird leer '
      + 'ausgeliefert, bis feststeht, welche Gewerke geführt werden (O-159).',
    );
  }

  const id = randomUUID();
  await kontext.schreibe(
    `insert into bautagebuch_mannstunden
       (id, mandant_id, bautagebuch_id, gewerk_id, herkunft,
        nachunternehmer_firma_id, nachunternehmer_name,
        anzahl_personen, dauer_minuten, taetigkeit, bereich,
        erstellt_von_art, erstellt_von, erstellt_von_person_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::mannstunden_herkunft,
             $6::uuid, $7, $8::smallint, $9::integer, $10, $11,
             'mensch', app.aktueller_benutzer(), app.aktuelle_person())`,
    [
      id, kontext.aktiverMandantId, eingabe.bautagebuchId, eingabe.gewerkId,
      eingabe.herkunft,
      leerZuNull(eingabe.nachunternehmerFirmaId), leerZuNull(eingabe.nachunternehmerName),
      eingabe.anzahlPersonen, eingabe.dauerMinuten,
      leerZuNull(eingabe.taetigkeit), leerZuNull(eingabe.bereich),
    ],
  );
  return id;
}

export interface PositionEingabe {
  readonly bautagebuchId: string;
  readonly art: PositionArt;
  readonly bezeichnung: string;
  readonly reihenfolge?: number;
  /** Menge als MENGE (§1.1) — Stueck, t, m³. Nie Geld. */
  readonly menge?: string | null;
  readonly einheit?: string | null;
  readonly lieferantFirmaId?: string | null;
  readonly lieferscheinNummer?: string | null;
  readonly gewerkId?: string | null;
  /** UTC-Zeitpunkt des Vorkommnisses (Invariante 2). */
  readonly zeitpunkt?: string | null;
  readonly beschreibung?: string | null;
}

/**
 * Fuegt eine Zeile fuer Geraet, Lieferung oder Vorkommnis an.
 *
 * Eine Zeile je Sache statt eines Fliesstextfelds (§7.14): „3 t Bewehrung,
 * Lieferschein 4711" bleibt auswertbar — derselbe Satz in `bemerkungen` ist
 * nur noch lesbar.
 */
export async function heftePositionAn(
  kontext: SchreibKontext, eingabe: PositionEingabe,
): Promise<string> {
  const bezeichnung = eingabe.bezeichnung.trim();
  if (bezeichnung === '') {
    throw new BautagebuchFehler(
      'ungueltige_eingabe', 'Die Zeile braucht eine Bezeichnung — „Turmdrehkran", nicht „Gerät".',
    );
  }
  const menge = leerZuNull(eingabe.menge);
  const einheit = leerZuNull(eingabe.einheit);
  if ((menge === null) !== (einheit === null)) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Eine Zahl ohne Einheit ist keine Menge, und eine Einheit ohne Zahl auch nicht.',
    );
  }
  const beschreibung = leerZuNull(eingabe.beschreibung);
  if (eingabe.art === 'vorkommnis' && beschreibung === null) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Ein Vorkommnis ohne Beschreibung dokumentiert nichts. Was ist passiert?',
    );
  }
  await offenerKopf(kontext, eingabe.bautagebuchId);

  const id = randomUUID();
  await kontext.schreibe(
    `insert into bautagebuch_position
       (id, mandant_id, bautagebuch_id, art, reihenfolge, bezeichnung, menge, einheit,
        lieferant_firma_id, lieferschein_nummer, gewerk_id, zeitpunkt, beschreibung,
        erstellt_von_art, erstellt_von, erstellt_von_person_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4::bautagebuch_position_art, $5::smallint,
             $6, $7::numeric, $8, $9::uuid, $10, $11::uuid, $12::timestamptz, $13,
             'mensch', app.aktueller_benutzer(), app.aktuelle_person())`,
    [
      id, kontext.aktiverMandantId, eingabe.bautagebuchId, eingabe.art,
      eingabe.reihenfolge ?? 0, bezeichnung, menge, einheit,
      leerZuNull(eingabe.lieferantFirmaId), leerZuNull(eingabe.lieferscheinNummer),
      leerZuNull(eingabe.gewerkId), eingabe.zeitpunkt ?? null, beschreibung,
    ],
  );
  return id;
}

/* ---------------------------------------------------------------------------
 * 3. Die Korrekturspur
 * ------------------------------------------------------------------------ */

/**
 * Storniert eine Zeile und setzt die neue daneben — in EINER Transaktion.
 *
 * Die Reihenfolge ist dieselbe wie im Wachbuch und aus demselben Grund: erst
 * die Ersatzzeile, dann das Storno, das auf sie zeigt. Andersherum stuende
 * zwischendurch ein `ersetzt_durch_id` auf einer Zeile, die es noch nicht
 * gibt — und ein Abbruch dazwischen hinterliesse ein Storno ohne
 * Richtigstellung.
 *
 * Nach dem Abschluss des Tages geht das NICHT mehr, und zwar nicht aus
 * Strenge: der Ausloeser laesst keine neue Kindzeile mehr zu, das Storno
 * allein bliebe also eine Loeschung mit Begruendung. Dann ist der Ersatztag
 * der Weg (`ersetzeBautag`).
 */
async function korrigiereZeile(
  kontext: SchreibKontext,
  tabelle: 'bautagebuch_mannstunden' | 'bautagebuch_position',
  zeileId: string,
  grund: string,
  ersatz: () => Promise<string>,
): Promise<string> {
  if (grund.trim().length < GRUND_MINDESTLAENGE) {
    throw new BautagebuchFehler(
      'ungueltige_eingabe',
      'Eine Korrektur ohne Grund ist im Streitfall keine Auskunft. Warum war die Zeile falsch?',
    );
  }
  const [alt] = await kontext.abfrage<{ bautagebuch_id: string; storniert: boolean }>(
    `select z.bautagebuch_id, (z.storniert_am is not null) as storniert
       from ${tabelle} z where z.id = $1::uuid`,
    [zeileId],
  );
  if (alt === undefined) {
    throw new BautagebuchFehler('nicht_gefunden', 'Diese Zeile gibt es hier nicht.');
  }
  if (alt.storniert) {
    throw new BautagebuchFehler(
      'schon_storniert',
      'Diese Zeile ist bereits storniert. Eine zweite Korrektur knüpft an die Zeile an, '
      + 'die sie ersetzt hat — nicht an diese.',
    );
  }
  // Wirft, wenn der Tag geschlossen oder storniert ist — vor der Ersatzzeile,
  // damit nicht erst eine entsteht und dann das Storno scheitert.
  await offenerKopf(kontext, alt.bautagebuch_id);

  const neu = await ersatz();
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update ${tabelle}
        set storniert_am = now(), storniert_von = app.aktueller_benutzer(),
            storno_grund = $2, ersetzt_durch_id = $3::uuid
      where id = $1::uuid and storniert_am is null
      returning id`,
    [zeileId, grund.trim(), neu],
  );
  if (zeilen.length === 0) {
    /**
     * Null Zeilen heisst: zwischen Lesen und Schreiben hat jemand anderes
     * storniert. Werfen, damit die Transaktion zurueckrollt — sonst stuenden
     * zwei Zeilen im Buch, ohne dass die eine auf die andere zeigt.
     */
    throw new BautagebuchFehler('schon_storniert', 'Diese Zeile wurde inzwischen storniert.');
  }
  return neu;
}

export async function korrigiereMannstunden(
  kontext: SchreibKontext,
  eingabe: { readonly zeileId: string; readonly grund: string;
    readonly ersatz: Omit<MannstundenEingabe, 'bautagebuchId'> },
): Promise<string> {
  const [alt] = await kontext.abfrage<{ bautagebuch_id: string }>(
    `select bautagebuch_id from bautagebuch_mannstunden where id = $1::uuid`,
    [eingabe.zeileId],
  );
  if (alt === undefined) {
    throw new BautagebuchFehler('nicht_gefunden', 'Diese Mannstundenzeile gibt es hier nicht.');
  }
  return korrigiereZeile(
    kontext, 'bautagebuch_mannstunden', eingabe.zeileId, eingabe.grund,
    async () => hefteMannstundenAn(kontext, {
      ...eingabe.ersatz, bautagebuchId: alt.bautagebuch_id,
    }),
  );
}

export async function korrigierePosition(
  kontext: SchreibKontext,
  eingabe: { readonly zeileId: string; readonly grund: string;
    readonly ersatz: Omit<PositionEingabe, 'bautagebuchId'> },
): Promise<string> {
  const [alt] = await kontext.abfrage<{ bautagebuch_id: string }>(
    `select bautagebuch_id from bautagebuch_position where id = $1::uuid`,
    [eingabe.zeileId],
  );
  if (alt === undefined) {
    throw new BautagebuchFehler('nicht_gefunden', 'Diese Tagebuchzeile gibt es hier nicht.');
  }
  return korrigiereZeile(
    kontext, 'bautagebuch_position', eingabe.zeileId, eingabe.grund,
    async () => heftePositionAn(kontext, {
      ...eingabe.ersatz, bautagebuchId: alt.bautagebuch_id,
    }),
  );
}

/* ---------------------------------------------------------------------------
 * 4. Fotos
 * ------------------------------------------------------------------------ */

/**
 * Haengt eine bereits abgelegte Aufnahme an den Tag (BAU-07, TIM-10).
 *
 * Die Datei selbst ist vorher durch `legeMediumAb` gegangen — Groesse, Typ aus
 * den Magic Bytes, Metadaten entfernt, privater Bucket. Hier entsteht nur die
 * Verbindung. `bautagebuch` steht seit 0082 im Register
 * `einsatz_medien_bezug`, und die beiden schmalen Policies dort sind der
 * Grund, warum eine Bauleitung mit `bau.schreiben` und ohne Zeitrecht ein
 * Tagebuchfoto ueberhaupt ablegen kann.
 */
export async function hefteTagesfotoAn(
  kontext: SchreibKontext,
  eingabe: {
    readonly bautagebuchId: string;
    readonly medienId: string;
    readonly art: string;
    readonly bucket: string;
    readonly pfad: string;
    readonly mimeTyp: string;
    readonly groesseBytes: number;
    readonly sha256: string;
    readonly beschreibung?: string | null;
  },
): Promise<void> {
  await offenerKopf(kontext, eingabe.bautagebuchId);
  await kontext.schreibe(
    `insert into einsatz_medien
       (id, mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad, mime_typ,
        groesse_bytes, sha256, beschreibung, erstellt_von, erstellt_von_person_id)
     values ($1::uuid, $2::uuid, 'bautagebuch', $3::uuid, $4::medien_art, $5, $6, $7,
             $8::bigint, $9, $10, app.aktueller_benutzer(), app.aktuelle_person())`,
    [
      eingabe.medienId, kontext.aktiverMandantId, eingabe.bautagebuchId, eingabe.art,
      eingabe.bucket, eingabe.pfad, eingabe.mimeTyp, eingabe.groesseBytes, eingabe.sha256,
      leerZuNull(eingabe.beschreibung),
    ],
  );
}

/* ---------------------------------------------------------------------------
 * 5. Der Abgleich gegen die Zeiterfassung (Abnahme 3)
 * ------------------------------------------------------------------------ */

export interface GewerkStunden {
  readonly gewerkId: string;
  readonly code: string;
  readonly bezeichnung: string;
  /** Personenminuten — `anzahl_personen × dauer_minuten`, als ganze Zahl. */
  readonly eigenMinuten: number;
  readonly nachunternehmerMinuten: number;
  readonly zeilen: number;
}

export type AbgleichBefund =
  /** Tagebuch und Zeiterfassung stimmen auf die Minute ueberein. */
  | 'deckungsgleich'
  /** Sie stimmen nicht überein — die Zahl steht daneben. */
  | 'abweichung'
  /** Beide Seiten leer: es gibt nichts zu vergleichen. */
  | 'ohne_angabe'
  /** Dieser Zugang darf `zeiteintrag` nicht lesen — es gibt keinen Befund. */
  | 'zeit_nicht_lesbar';

export interface MannstundenAbgleich {
  readonly bautagebuchId: string;
  readonly projektId: string;
  /** Berliner Kalendertag des Bautags (K-11). */
  readonly datum: string;
  readonly jeGewerk: readonly GewerkStunden[];
  /** Personenminuten der EIGENEN Kräfte laut Tagebuch. */
  readonly tagebuchEigenMinuten: number;
  readonly tagebuchNachunternehmerMinuten: number;
  /** Nettominuten aus `zeiteintrag` desselben Tages und derselben Baustelle. */
  readonly zeiteintragMinuten: number;
  readonly zeiteintraege: number;
  /** Noch laufende Einträge — ohne Ende gibt es keine Dauer, und keine Null. */
  readonly laufendeZeiteintraege: number;
  /** Tagebuch minus Zeiterfassung. Das Vorzeichen bleibt stehen. */
  readonly abweichungMinuten: number;
  readonly befund: AbgleichBefund;
  /** Der Satz, der über der Zahl steht. Nie leer. */
  readonly text: string;
}

/** Personenminuten als Stundenangabe mit zwei Stellen — rein für die Anzeige. */
export function alsStunden(minuten: number): string {
  return (minuten / 60).toFixed(2).replace('.', ',');
}

/**
 * Haelt die Mannstunden des Tages gegen `zeiteintrag` (Abnahme 3).
 *
 * **Verglichen werden EIGENE Stunden, nie die Summe.** Nur `herkunft = 'eigen'`
 * erzeugt einen `zeiteintrag`; wer beide Herkuenfte in eine Summe legt, meldet
 * jeden Tag mit Nachunternehmern als Abweichung — und bringt damit genau die
 * Meldung zum Verstummen, um die es geht.
 *
 * **Verglichen wird die TAGESSUMME, nicht jedes Gewerk einzeln** — und das ist
 * eine Grenze der Daten, keine Bequemlichkeit: `zeiteintrag` traegt `objekt_id`,
 * `revier_id`, `posten_id` und `projekt_id`, aber kein `gewerk_id`. Die Stunden
 * je Gewerk stehen deshalb DANEBEN, statt dass hier eine Zuordnung erfunden
 * wird, die es nicht gibt.
 * // TODO(client, O-282): Soll die Zeiterfassung das Gewerk mitfuehren, damit
 * der Abgleich je Gewerk statt nur in der Tagessumme laufen kann?
 *
 * **Verglichen wird in ganzen MINUTEN.** Beide Seiten fuehren ganze Minuten;
 * in Stunden umzurechnen und dann zu vergleichen erzeugte eine Differenz aus
 * der Rundung, die wie ein Befund aussieht.
 *
 * **Der Tag ist der BERLINER Kalendertag des Schichtbeginns** (K-11) — dieselbe
 * Zuordnung wie in `milog_aufzeichnung` (0051). Ein UTC-Mitternachtsschnitt
 * verschoebe jeden Tag ein bis zwei Stunden in den Nachbartag, und in der
 * Sommerzeit zwei.
 *
 * **Ohne `zeit.lesen` gibt es KEINEN Befund**, und das ist die eigentliche
 * Falle dieser Funktion: die RLS auf `zeiteintrag` verlangt `zeit.lesen`, und
 * ohne das Recht antwortet sie mit null Zeilen — nicht mit einem Fehler. Die
 * naheliegende Fassung meldete dann „100 % Abweichung" an einen Menschen, der
 * nichts falsch gemacht hat. Deshalb wird das Recht ZUERST gefragt.
 *
 * // TODO(client, O-280): Ab welcher Abweichung gilt der Abgleich als
 * auffällig — und ist überhaupt eine Toleranz gewollt? Bis zur Antwort wird
 * jede Differenz ab einer Minute gemeldet und keine geglättet.
 * // TODO(client, O-281): Zählen die Mannstunden im Bautagebuch die
 * Anwesenheit auf der Baustelle (brutto) oder die Arbeitszeit ohne Pausen
 * (netto)? Verglichen wird derzeit gegen `dauer_netto_minuten`, und die Seite
 * sagt es dazu.
 */
export async function gleicheMannstundenAb(
  kontext: LeseKontext, bautagebuchId: string,
): Promise<MannstundenAbgleich | null> {
  const kopf = await kopfZustand(kontext, bautagebuchId);
  if (kopf === null) return null;

  const jeGewerk = await kontext.abfrage<{
    gewerkId: string; code: string; bezeichnung: string;
    eigenMinuten: string; nachunternehmerMinuten: string; zeilen: string;
  }>(
    `select g.id as "gewerkId", g.code, g.bezeichnung,
            coalesce(sum(m.anzahl_personen::bigint * m.dauer_minuten)
                     filter (where m.herkunft = 'eigen'), 0)::text as "eigenMinuten",
            coalesce(sum(m.anzahl_personen::bigint * m.dauer_minuten)
                     filter (where m.herkunft = 'nachunternehmer'), 0)::text
              as "nachunternehmerMinuten",
            count(*)::text as zeilen
       from bautagebuch_mannstunden m
       join gewerk g on g.id = m.gewerk_id and g.mandant_id = m.mandant_id
      where m.bautagebuch_id = $1::uuid and m.storniert_am is null
      group by g.id, g.code, g.bezeichnung, g.sortierung
      order by g.sortierung, g.code`,
    [bautagebuchId],
  );

  const eigen = jeGewerk.reduce((summe, g) => summe + Number(g.eigenMinuten), 0);
  const nachunternehmer = jeGewerk.reduce(
    (summe, g) => summe + Number(g.nachunternehmerMinuten), 0,
  );

  const gewerke: readonly GewerkStunden[] = jeGewerk.map((g) => ({
    gewerkId: g.gewerkId,
    code: g.code,
    bezeichnung: g.bezeichnung,
    eigenMinuten: Number(g.eigenMinuten),
    nachunternehmerMinuten: Number(g.nachunternehmerMinuten),
    zeilen: Number(g.zeilen),
  }));

  const grundlage = {
    bautagebuchId,
    projektId: kopf.projekt_id,
    datum: kopf.datum,
    jeGewerk: gewerke,
    tagebuchEigenMinuten: eigen,
    tagebuchNachunternehmerMinuten: nachunternehmer,
  };

  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('zeit.lesen', app.aktiver_mandant()) as darf`,
  );
  if (recht?.darf !== true) {
    return {
      ...grundlage,
      zeiteintragMinuten: 0, zeiteintraege: 0, laufendeZeiteintraege: 0,
      abweichungMinuten: 0,
      befund: 'zeit_nicht_lesbar',
      text:
        'Der Abgleich mit der Zeiterfassung verlangt zusätzlich das Recht „zeit.lesen". '
        + 'Dieser Zugang hat es nicht — es wird deshalb KEIN Befund gezeigt, denn eine '
        + 'leere Zeiterfassung sähe hier aus wie eine hundertprozentige Abweichung.',
    };
  }

  const [zeit] = await kontext.abfrage<{
    minuten: string; abgeschlossen: string; laufend: string;
  }>(
    `select coalesce(sum(z.dauer_netto_minuten)
                     filter (where z.ende_zeitpunkt is not null), 0)::text as minuten,
            (count(*) filter (where z.ende_zeitpunkt is not null))::text as abgeschlossen,
            (count(*) filter (where z.ende_zeitpunkt is null))::text as laufend
       from zeiteintrag z
      where z.mandant_id = $1::uuid
        and z.projekt_id = $2::uuid
        and z.ersetzt_am is null
        and z.storniert_am is null
        /**
         * `::timestamp` VOR `at time zone`, und das ist kein Zierrat:
         * `date at time zone 'Europe/Berlin'` waehlt die Ueberladung
         * `timestamptz → timestamp` — der Tag wird also als UTC-Mitternacht
         * gelesen und nach Berlin GERECHNET, statt als Berliner Mitternacht
         * gelesen zu werden. Das Fenster liegt dann zwei Stunden falsch, in
         * der Winterzeit eine, und beides sieht auf dem Bildschirm plausibel
         * aus. Mit `::timestamp` greift die richtige Ueberladung.
         */
        and z.beginn_zeitpunkt >= ($3::date)::timestamp at time zone 'Europe/Berlin'
        and z.beginn_zeitpunkt <  (($3::date) + 1)::timestamp at time zone 'Europe/Berlin'`,
    [kontext.aktiverMandantId, kopf.projekt_id, kopf.datum],
  );

  const zeitMinuten = Number(zeit?.minuten ?? '0');
  const zeiteintraege = Number(zeit?.abgeschlossen ?? '0');
  const laufend = Number(zeit?.laufend ?? '0');
  const abweichung = eigen - zeitMinuten;

  const befund: AbgleichBefund = eigen === 0 && zeitMinuten === 0 && laufend === 0
    ? 'ohne_angabe'
    : abweichung === 0 ? 'deckungsgleich' : 'abweichung';

  return {
    ...grundlage,
    zeiteintragMinuten: zeitMinuten,
    zeiteintraege,
    laufendeZeiteintraege: laufend,
    abweichungMinuten: abweichung,
    befund,
    text: abgleichText(befund, abweichung, laufend, nachunternehmer),
  };
}

/**
 * Der Satz zum Befund — und er BENENNT die Abweichung.
 *
 * Die Versuchung ist, eine kleine Differenz „im Rahmen" zu nennen. Genau das
 * ist die Stelle, an der aus einem Bericht eine Beruhigung wird: eine
 * Toleranz, die niemand beschlossen hat, verschweigt ab dem ersten Tag genau
 * die Faelle, wegen derer der Abgleich existiert.
 */
function abgleichText(
  befund: AbgleichBefund, abweichungMinuten: number,
  laufend: number, nachunternehmer: number,
): string {
  const nachsatz = [
    nachunternehmer > 0
      ? `Die ${alsStunden(nachunternehmer)} h der Nachunternehmer bleiben außen vor — sie `
        + 'erzeugen keinen Zeiteintrag.'
      : null,
    laufend > 0
      ? `${String(laufend)} Zeiteintrag/-einträge laufen noch; ohne Ende gibt es keine `
        + 'Dauer, und sie werden nicht als Null gezählt.'
      : null,
  ].filter((s): s is string => s !== null).join(' ');

  const kern = befund === 'ohne_angabe'
    ? 'Für diesen Tag sind weder Mannstunden noch Zeiteinträge erfasst.'
    : befund === 'deckungsgleich'
      ? 'Die eigenen Mannstunden decken sich mit der Zeiterfassung dieses Tages.'
      : abweichungMinuten > 0
        ? `Das Bautagebuch weist ${alsStunden(abweichungMinuten)} h mehr eigene Stunden aus `
          + 'als die Zeiterfassung dieses Tages.'
        : `Die Zeiterfassung dieses Tages weist ${alsStunden(-abweichungMinuten)} h mehr aus `
          + 'als das Bautagebuch.';

  return nachsatz === '' ? kern : `${kern} ${nachsatz}`;
}

/* ---------------------------------------------------------------------------
 * 6. Lesen
 * ------------------------------------------------------------------------ */

export interface GewerkZeile {
  readonly id: string;
  readonly code: string;
  readonly bezeichnung: string;
  readonly istPlatzhalter: boolean;
}

/** Der Gewerkekatalog des Mandanten — heute leer (O-159). */
export async function listeGewerke(kontext: LeseKontext): Promise<readonly GewerkZeile[]> {
  return kontext.abfrage<GewerkZeile>(
    `select g.id, g.code, g.bezeichnung, g.ist_platzhalter as "istPlatzhalter"
       from gewerk g
      where g.archiviert_am is null
      order by g.sortierung, g.code`,
  );
}

export interface BautagKopfZeile {
  readonly id: string;
  readonly projekt_id: string;
  readonly projekt: string;
  readonly projekt_nummer: string;
  readonly datum: string;
  readonly datum_lokal: string;
  readonly status: BautagebuchStatus;
  readonly arbeitsbeginn_lokal: string | null;
  readonly arbeitsende_lokal: string | null;
  readonly abgeschlossen_lokal: string | null;
  readonly gegengezeichnet_von_name: string | null;
  readonly gegengezeichnet_lokal: string | null;
  readonly besondere_vorkommnisse: string | null;
  readonly bemerkungen: string | null;
  readonly storniert: boolean;
  readonly storno_grund: string | null;
  readonly ersetzt_durch_id: string | null;
  readonly ersetzt_id: string | null;
  readonly wetter_quelle: 'dwd' | 'manuell' | 'keine';
  readonly mannstunden_zeilen: number;
  readonly positionen: number;
  readonly fotos: number;
}

/**
 * Die Felder des Kopfes — Ortszeit kommt aus der DATENBANK.
 *
 * `to_char(… at time zone 'Europe/Berlin')` und nicht `toLocaleString` im
 * Node-Prozess: auf Vercel laeuft der in UTC, und die Anzeige waere im Sommer
 * um zwei Stunden falsch (Invariante 2).
 */
const KOPF_FELDER = `
  b.id, b.projekt_id, p.bezeichnung as projekt, p.nummer as projekt_nummer,
  to_char(b.datum, 'YYYY-MM-DD') as datum,
  to_char(b.datum, 'DD.MM.YYYY') as datum_lokal,
  b.status::text as status,
  to_char(b.arbeitsbeginn at time zone 'Europe/Berlin', 'HH24:MI') as arbeitsbeginn_lokal,
  to_char(b.arbeitsende   at time zone 'Europe/Berlin', 'HH24:MI') as arbeitsende_lokal,
  to_char(b.abgeschlossen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
    as abgeschlossen_lokal,
  b.gegengezeichnet_von_name,
  to_char(b.gegengezeichnet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
    as gegengezeichnet_lokal,
  b.besondere_vorkommnisse, b.bemerkungen,
  (b.storniert_am is not null) as storniert, b.storno_grund, b.ersetzt_durch_id,
  (select v.id from bautagebuch v where v.ersetzt_durch_id = b.id
    order by v.erstellt_am limit 1) as ersetzt_id,
  b.wetter_quelle::text as wetter_quelle,
  (select count(*) from bautagebuch_mannstunden m
    where m.bautagebuch_id = b.id and m.storniert_am is null)::int as mannstunden_zeilen,
  (select count(*) from bautagebuch_position q
    where q.bautagebuch_id = b.id and q.storniert_am is null)::int as positionen,
  (select count(*) from einsatz_medien e
    where e.bezug_tabelle = 'bautagebuch' and e.bezug_id = b.id)::int as fotos
  from bautagebuch b
  join projekt p on p.id = b.projekt_id and p.mandant_id = b.mandant_id`;

export async function findeBautag(
  kontext: LeseKontext, id: string,
): Promise<BautagKopfZeile | null> {
  const [zeile] = await kontext.abfrage<BautagKopfZeile>(
    `select ${KOPF_FELDER} where b.id = $1::uuid`, [id],
  );
  return zeile ?? null;
}

/** Der LEBENDE Tag zu einem Projekt und Kalendertag — oder keiner. */
export async function findeBautagZuDatum(
  kontext: LeseKontext, projektId: string, datum: string,
): Promise<BautagKopfZeile | null> {
  if (!istKalendertag(datum)) return null;
  const [zeile] = await kontext.abfrage<BautagKopfZeile>(
    `select ${KOPF_FELDER}
      where b.projekt_id = $1::uuid and b.datum = $2::date and b.storniert_am is null`,
    [projektId, datum],
  );
  return zeile ?? null;
}

export interface BautagFilter {
  readonly projektId?: string | null;
  readonly von?: string | null;
  readonly bis?: string | null;
  readonly nurOffene?: boolean;
  readonly grenze?: number;
}

/**
 * Die Tage — eines Projekts oder ueber alle (SEITENKARTE §5.9).
 *
 * Stornierte Tage bleiben SICHTBAR. Sie herauszufiltern waere bequem und
 * naehme der Liste genau das, was sie beweist: dass an diesem Datum zuerst
 * etwas anderes stand.
 */
export async function listeBautage(
  kontext: LeseKontext, filter: BautagFilter = {},
): Promise<readonly BautagKopfZeile[]> {
  return kontext.abfrage<BautagKopfZeile>(
    `select ${KOPF_FELDER}
      where ($1::uuid is null or b.projekt_id = $1::uuid)
        and ($2::date is null or b.datum >= $2::date)
        and ($3::date is null or b.datum <= $3::date)
        and ($4::boolean is false or b.status = 'entwurf')
      order by b.datum desc, p.nummer
      limit $5::integer`,
    [
      filter.projektId ?? null, filter.von ?? null, filter.bis ?? null,
      filter.nurOffene === true, filter.grenze ?? 200,
    ],
  );
}

export interface MannstundenZeile {
  readonly id: string;
  readonly gewerk_id: string;
  readonly gewerk: string;
  readonly gewerk_code: string;
  readonly herkunft: MannstundenHerkunft;
  readonly nachunternehmer: string | null;
  readonly anzahl_personen: number;
  readonly dauer_minuten: number;
  /** `numeric(10,2)` als Text — nie als Gleitkommazahl durch die Schicht. */
  readonly mannstunden: string;
  readonly taetigkeit: string | null;
  readonly bereich: string | null;
  readonly erfasst_lokal: string;
  readonly storniert: boolean;
  readonly storno_grund: string | null;
  readonly ersetzt_durch_id: string | null;
  readonly ersetzt_id: string | null;
}

/**
 * Die Mannstunden eines Tages — MIT den stornierten Zeilen.
 *
 * Das ist keine Nachlaessigkeit, sondern die Korrekturspur: die falsche Zeile
 * steht neben ihrer Richtigstellung, und beide tragen den Verweis aufeinander.
 * Eine Liste, die nur die gueltigen Zeilen zeigt, ist ein geglaettetes
 * Bautagebuch — und ein geglaettetes beweist nichts.
 */
export async function leseMannstunden(
  kontext: LeseKontext, bautagebuchId: string,
): Promise<readonly MannstundenZeile[]> {
  return kontext.abfrage<MannstundenZeile>(
    `select m.id, m.gewerk_id, g.bezeichnung as gewerk, g.code as gewerk_code,
            m.herkunft::text as herkunft,
            -- Der SCHNAPPSCHUSS zuerst: firma ist ueber kunde gedeckt (CRM), und
            -- ein Nachunternehmer ist selten ein Kunde — die Policy gaebe dann NULL
            -- zurueck, und der Name verschwaende still aus dem Bautagebuch.
            coalesce(m.nachunternehmer_name, f.name) as nachunternehmer,
            m.anzahl_personen, m.dauer_minuten, m.mannstunden::text as mannstunden,
            m.taetigkeit, m.bereich,
            to_char(m.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as erfasst_lokal,
            (m.storniert_am is not null) as storniert, m.storno_grund, m.ersetzt_durch_id,
            (select v.id from bautagebuch_mannstunden v
              where v.ersetzt_durch_id = m.id order by v.erstellt_am limit 1) as ersetzt_id
       from bautagebuch_mannstunden m
       join gewerk g on g.id = m.gewerk_id and g.mandant_id = m.mandant_id
       left join firma f on f.id = m.nachunternehmer_firma_id
      where m.bautagebuch_id = $1::uuid
      order by m.erstellt_am, m.id`,
    [bautagebuchId],
  );
}

export interface PositionZeile {
  readonly id: string;
  readonly art: PositionArt;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly lieferant: string | null;
  readonly lieferschein_nummer: string | null;
  readonly gewerk: string | null;
  readonly zeitpunkt_lokal: string | null;
  readonly beschreibung: string | null;
  readonly erfasst_lokal: string;
  readonly storniert: boolean;
  readonly storno_grund: string | null;
  readonly ersetzt_durch_id: string | null;
  readonly ersetzt_id: string | null;
}

/** Geraet, Lieferung und Vorkommnis — ebenfalls mit der Korrekturspur. */
export async function lesePositionen(
  kontext: LeseKontext, bautagebuchId: string,
): Promise<readonly PositionZeile[]> {
  return kontext.abfrage<PositionZeile>(
    `select q.id, q.art::text as art, q.bezeichnung, q.menge::text as menge, q.einheit,
            f.name as lieferant, q.lieferschein_nummer, g.bezeichnung as gewerk,
            to_char(q.zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as zeitpunkt_lokal,
            q.beschreibung,
            to_char(q.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as erfasst_lokal,
            (q.storniert_am is not null) as storniert, q.storno_grund, q.ersetzt_durch_id,
            (select v.id from bautagebuch_position v
              where v.ersetzt_durch_id = q.id order by v.erstellt_am limit 1) as ersetzt_id
       from bautagebuch_position q
       left join firma f on f.id = q.lieferant_firma_id
       left join gewerk g on g.id = q.gewerk_id and g.mandant_id = q.mandant_id
      where q.bautagebuch_id = $1::uuid
      order by q.art, q.reihenfolge, q.erstellt_am`,
    [bautagebuchId],
  );
}

export interface TagesfotoZeile {
  readonly id: string;
  readonly mime_typ: string;
  readonly beschreibung: string | null;
  readonly erfasst_lokal: string;
}

/**
 * Die Aufnahmen des Tages — Kennung und Beschreibung, KEINE Adresse.
 *
 * Eine anzeigbare Adresse ist eine befristet signierte, und die entsteht am
 * Speicher. Ist der nicht verbunden, gibt es keine — und dann steht auf der
 * Seite, dass es keine gibt, statt eines toten Bildrahmens.
 */
export async function leseTagesfotos(
  kontext: LeseKontext, bautagebuchId: string,
): Promise<readonly TagesfotoZeile[]> {
  return kontext.abfrage<TagesfotoZeile>(
    `select e.id, e.mime_typ, e.beschreibung,
            to_char(e.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as erfasst_lokal
       from einsatz_medien e
      where e.bezug_tabelle = 'bautagebuch' and e.bezug_id = $1::uuid
      order by e.erstellt_am`,
    [bautagebuchId],
  );
}

/* ---------------------------------------------------------------------------
 * 7. Kleinkram
 * ------------------------------------------------------------------------ */

function leerZuNull(wert: string | null | undefined): string | null {
  const getrimmt = (wert ?? '').trim();
  return getrimmt === '' ? null : getrimmt;
}

/**
 * Ein Verstoss GEGEN GENAU DIESEN eindeutigen Index — nicht irgendeiner.
 *
 * `23505` allein zu pruefen faenge jede spaetere Eindeutigkeit mit ein und
 * uebersetzte sie in eine Aussage ueber den Bautag, die nicht stimmt.
 */
function istEindeutigkeitsverstoss(fehler: unknown, index: string): boolean {
  if (typeof fehler !== 'object' || fehler === null) return false;
  const f = fehler as { code?: unknown; constraint_name?: unknown };
  return f.code === '23505' && f.constraint_name === index;
}
