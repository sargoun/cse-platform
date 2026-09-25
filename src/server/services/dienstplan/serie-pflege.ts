import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { generiereEinsaetze, type SerienBericht } from './generator.js';
import { MAX_DAUER_MINUTEN } from './vorkommnisse.js';
import { turnusRegel, type Feiertagsregel, type TurnusFrequenz } from './serie.js';
import { LeistungsankerFehler, pruefeLeistungsanker } from './leistungsanker.js';

/**
 * **Eine Planungsserie ändern, beenden und archivieren** (V-021, TIM-02,
 * TIM-03, CLN-02, SEC-01).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `serie.ts` legt Serien an, `leseSerie` zeigt sie, `legeAusnahmeAn` setzt
 * Ausnahmen für einzelne Tage — **und keine einzige Zeile änderte je eine
 * bestehende Serie.** Ein Turnus, dessen Beginn sich um eine halbe Stunde
 * verschiebt, war nicht zu korrigieren; ein Vertrag, der zum Quartalsende
 * ausläuft, nicht zu beenden; eine Serie, die nichts mehr erzeugen soll,
 * nicht abzustellen. `planungsserie.archiviert_am` stand seit `0028` da, und
 * `ps_carrier_uk` ist eigens partiell darauf — geschrieben hat es nie jemand.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Drei Handlungen, und sie sind ausdrücklich NICHT dasselbe.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Ändern.** Die Regel liegt auf dem TRÄGER (`turnus`, `posten`), nicht
 * auf der Serie — `planungsserie` ist das Ausführungsprotokoll des
 * Generators und trägt weder RRULE noch Uhrzeit (0028). Geändert wird
 * deshalb dort, und danach läuft der Generator sofort: er schreibt die
 * künftigen Schichten um (`beginn_zeitpunkt > now()` und ohne Zeiteintrag)
 * und storniert, was die neue Regel nicht mehr will. Eine Änderung ohne
 * diesen Lauf wäre eine Regel, die erst morgen früh gilt — und bis dahin
 * stünde im Plan etwas anderes als in der Maske.
 *
 * **2. Beenden.** `gueltig_bis` auf dem Träger. Die Serie hört zu einem
 * DATUM auf, und was danach schon im Plan steht, wird abgesagt.
 *
 * **Und das geht nicht über den Generator allein.** `app.planungsbedarf`
 * filtert `gueltig_bis >= p_von`: ein auf gestern beendeter Träger fällt aus
 * der Abfrage, der Generator sieht ihn nicht mehr — und `storniereVerwaiste`
 * läuft für ihn nie. Die Schichten der nächsten acht Wochen blieben stehen,
 * für eine Serie, die es nicht mehr gibt. Das Absagen steht darum hier und
 * nicht im Generator.
 *
 * **3. Archivieren.** `planungsserie.archiviert_am`. Der TRÄGER bleibt — ein
 * Posten ist ein Objektschutzposten und kein Zeitplan, und ihn zu
 * archivieren, weil jemand seine Serie abstellt, wäre eine zweite
 * Entscheidung in einem Knopf. Was die Serie an künftigen Schichten erzeugt
 * hat, wird abgesagt: ein Generator, der die Serie nicht mehr liest, kann
 * sie auch nicht mehr aufräumen. `ps_carrier_uk` ist partiell auf
 * `archiviert_am is null`, also lässt sich für denselben Träger später eine
 * neue Serie anlegen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was NIE mitgeht: eine Schicht, auf der schon Zeit erfasst ist.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dieselbe Bedingung wie im Generator (`app.einsatz_hat_zeiterfassung`) und
 * bei der Einzelschicht: eine Stunde, die an einer abgesagten Schicht hängt,
 * ist eine Stunde, die im Lohnlauf niemand mehr zuordnen kann. Und nie eine
 * Schicht in der Vergangenheit — die Historie wird nicht umgeschrieben.
 */
export class SeriePflegeFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'nicht_gefunden' | 'kein_turnus' | 'unvollstaendig' | 'zeitraum'
      | 'schon_archiviert' | 'grund_fehlt' | 'abgewiesen'
      | 'leistung_unbekannt' | 'leistung_beendet' | 'leistung_anderer_auftrag',
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'SeriePflegeFehler';
  }
}

/**
 * Die drei Auditaktionen dieses Dienstes — als benannte Konstanten, weil sie
 * nicht als Literal in `app.protokolliere(…)` stehen.
 *
 * Der Aufruf liegt in `protokolliere()` unten und nimmt den Namen als
 * Parameter; ein Literal an vier Stellen waere dieselbe Anweisung viermal.
 * Das Praefix `AUDIT_` sagt dem Katalogscanner, in welches Register der Wert
 * gehoert (`scripts/katalog/benutzung.ts` (4c)) — es ist eine Handlung, kein
 * Rechteschluessel.
 */
const AUDIT_GEAENDERT = 'dienstplan.serie_geaendert';
const AUDIT_BEENDET = 'dienstplan.serie_beendet';
const AUDIT_ARCHIVIERT = 'dienstplan.serie_archiviert';

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const UHRZEIT = /^([01]\d|2[0-3]):([0-5]\d)$/u;

interface SerienKopf {
  readonly id: string;
  readonly quelle: 'turnus' | 'posten' | 'veranstaltung';
  readonly turnus_id: string | null;
  readonly posten_id: string | null;
  readonly veranstaltung_id: string | null;
  readonly archiviert: boolean;
  /** Der bisherige Anker des Turnus — `null` ohne Turnus oder ohne Anker. */
  readonly auftrag_leistung_id: string | null;
}

async function leseKopf(kontext: SchreibKontext, serieId: string): Promise<SerienKopf> {
  const [k] = await kontext.abfrage<SerienKopf>(
    `select id, quelle::text as quelle, turnus_id::text as turnus_id,
            posten_id::text as posten_id, veranstaltung_id::text as veranstaltung_id,
            (archiviert_am is not null) as archiviert,
            (select t.auftrag_leistung_id::text from turnus t
              where t.mandant_id = planungsserie.mandant_id
                and t.id = planungsserie.turnus_id) as auftrag_leistung_id
       from planungsserie where id = $1::uuid`, [serieId]);
  if (k === undefined) {
    /* AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten. */
    throw new SeriePflegeFehler('Diese Serie gibt es nicht.', 'nicht_gefunden', 404);
  }
  return k;
}

/**
 * Der Generator, sofort und nur für diese Gesellschaft.
 *
 * Er läuft über `app.planungsbedarf_eigen` (`dienstplan.schreiben`), also
 * unter dem Recht des Menschen, der gerade geändert hat — nicht unter dem des
 * Nachtlaufs.
 */
async function generiereJetzt(kontext: SchreibKontext): Promise<readonly SerienBericht[]> {
  const [heute] = await kontext.abfrage<{ tag: string }>(
    `select app.berlin_heute()::text as tag`);
  return generiereEinsaetze(
    { unsafe: (sql, werte) => kontext.schreibe<unknown>(sql, werte) },
    kontext.aktiverMandantId,
    { heute: heute?.tag ?? '2026-01-01', laufId: null },
    { eigen: true });
}

/**
 * Künftige Schichten einer Serie absagen.
 *
 * `ab` grenzt ein: beim Beenden zählt der PLANTAG (alles nach dem Enddatum),
 * beim Archivieren der ZEITPUNKT (alles, was noch nicht begonnen hat). Zwei
 * verschiedene Fragen — „was liegt nach dem Vertragsende" und „was hat noch
 * nicht angefangen" —, und sie fallen nur zufällig manchmal zusammen.
 */
async function sageKuenftigeAb(
  kontext: SchreibKontext, serieId: string, grund: string,
  ab: { readonly planDatumNach: string } | { readonly abJetzt: true },
): Promise<number> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update einsatz e
        set status = 'storniert'::einsatz_status, storniert_am = now(),
            storniert_von = $4::uuid, storno_grund = $2,
            geaendert_am = now(), geaendert_von_art = 'mensch'::akteur_art,
            geaendert_von = $4::uuid
      where e.planungsserie_id = $1::uuid
        and e.storniert_am is null
        and e.beginn_zeitpunkt > now()
        and ($3::date is null or e.plan_datum > $3::date)
        and not app.einsatz_hat_zeiterfassung(e.id)
      returning e.id`,
    [serieId, grund, 'planDatumNach' in ab ? ab.planDatumNach : null, kontext.benutzerId]);
  return zeilen.length;
}

/* ===========================================================================
 * 1. Den Lauf der Serie ändern — Horizont, Feiertage, Bundesland
 * ======================================================================== */

export interface SerienlaufAenderung {
  readonly horizontTage?: number;
  readonly feiertageUeberspringen?: boolean;
  readonly bundesland?: string;
}

export interface PflegeErgebnis {
  readonly erzeugt: number;
  readonly aktualisiert: number;
  readonly storniert: number;
  readonly abgesagt: number;
}

export async function aendereSerienlauf(
  kontext: SchreibKontext, serieId: string, e: SerienlaufAenderung,
): Promise<PflegeErgebnis> {
  const kopf = await leseKopf(kontext, serieId);
  if (kopf.archiviert) {
    throw new SeriePflegeFehler(
      'Diese Serie ist archiviert und erzeugt nichts mehr. Legen Sie für den Träger '
      + 'eine neue Serie an, statt die alte wiederzubeleben — die alte Zeile bleibt '
      + 'als Spur stehen.', 'schon_archiviert', 409);
  }
  if (e.horizontTage !== undefined
    && (!Number.isInteger(e.horizontTage) || e.horizontTage < 1 || e.horizontTage > 400)) {
    throw new SeriePflegeFehler(
      'Der Horizont liegt zwischen 1 und 400 Tagen — so weit im Voraus entstehen '
      + 'die Schichten.', 'unvollstaendig');
  }
  if (e.bundesland !== undefined && !/^[A-Z]{2}$/u.test(e.bundesland)) {
    throw new SeriePflegeFehler('Das Bundesland ist ein Kürzel wie BE.', 'unvollstaendig');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update planungsserie
        set horizont_tage           = coalesce($2::integer, horizont_tage),
            feiertage_ueberspringen = coalesce($3::boolean, feiertage_ueberspringen),
            feiertag_bundesland     = coalesce($4::text, feiertag_bundesland),
            geaendert_am = now(), geaendert_von_art = 'mensch'::akteur_art,
            geaendert_von = $5::uuid
      where id = $1::uuid and archiviert_am is null
      returning id`,
    [serieId, e.horizontTage ?? null, e.feiertageUeberspringen ?? null,
      e.bundesland ?? null, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new SeriePflegeFehler(
      'Die Serie wurde nicht geändert — fehlt `dienstplan.schreiben` in dieser '
      + 'Gesellschaft?', 'abgewiesen', 403);
  }

  const bericht = (await generiereJetzt(kontext)).find((b) => b.planungsserieId === serieId);
  await protokolliere(kontext, serieId, AUDIT_GEAENDERT, { ...e });
  return {
    erzeugt: bericht?.erzeugt ?? 0, aktualisiert: bericht?.aktualisiert ?? 0,
    storniert: bericht?.storniert ?? 0, abgesagt: 0,
  };
}

/* ===========================================================================
 * 2. Den Turnus ändern — Regel, Beginn, Dauer, Feiertagsregel
 * ======================================================================== */

export interface TurnusAenderung {
  readonly bezeichnung?: string;
  readonly frequenz?: TurnusFrequenz;
  readonly wochentage?: readonly string[];
  readonly monatstage?: readonly number[];
  readonly interval?: number;
  readonly beginnLokal?: string;
  readonly dauerMinuten?: number;
  readonly feiertagsregel?: Feiertagsregel;
  readonly gueltigBis?: string | null;
  /**
   * Die Leistungszeile (TIM-12, V-191). `undefined` lässt sie, wie sie ist —
   * eine Maske ohne `auftrag.lesen` schickt das Feld gar nicht und darf den
   * Anker nicht still löschen; `null` löst ihn. Der Generator schreibt den
   * neuen Anker gleich danach auf die künftigen Schichten ohne erfasste Zeit.
   */
  readonly auftragLeistungId?: string | null;
}

export async function aendereTurnus(
  kontext: SchreibKontext, serieId: string, e: TurnusAenderung,
): Promise<PflegeErgebnis> {
  const kopf = await leseKopf(kontext, serieId);
  if (kopf.archiviert) {
    throw new SeriePflegeFehler(
      'Diese Serie ist archiviert und erzeugt nichts mehr.', 'schon_archiviert', 409);
  }
  if (kopf.quelle !== 'turnus' || kopf.turnus_id === null) {
    /*
     * **Und das ist kein fehlendes Formular.** Eine Postenserie trägt ihre
     * Regel auf dem POSTEN — Dienstzeiten, Sollbesetzung, Abdeckung sind
     * Stammdaten des Objektschutzes und gehören auf sein Blatt, nicht in
     * eine Serienmaske. Eine Veranstaltung ist ein einzelnes Fenster und
     * gar keine Regel (SEC-08).
     */
    throw new SeriePflegeFehler(
      'Die Regel dieser Serie steht nicht auf einem Turnus. Eine Postenserie ändern '
      + 'Sie am Posten (Sicherheit → Posten), eine Veranstaltung an der '
      + 'Veranstaltung — ein einzelnes Fenster ist keine Regel.', 'kein_turnus', 409);
  }

  /* Was nicht genannt ist, bleibt — die Regel wird nur neu gebaut, wenn die
     Eingabe Tage mitbringt. `coalesce` allein reicht dafür nicht: eine leere
     Wochentagsliste ergäbe `BYDAY=` und damit eine Regel ohne Tag. */
  let rrule: string | null = null;
  if ((e.wochentage !== undefined && e.wochentage.length > 0)
    || (e.monatstage !== undefined && e.monatstage.length > 0)) {
    rrule = turnusRegel({
      frequenz: e.frequenz ?? 'woechentlich',
      wochentage: e.wochentage ?? [],
      monatstage: e.monatstage ?? [],
      interval: e.interval ?? 1,
    });
  }
  if (e.beginnLokal !== undefined && !UHRZEIT.test(e.beginnLokal)) {
    throw new SeriePflegeFehler('Der Beginn ist eine Uhrzeit HH:MM.', 'unvollstaendig');
  }
  if (e.dauerMinuten !== undefined
    && (!Number.isInteger(e.dauerMinuten) || e.dauerMinuten < 15
      || e.dauerMinuten > MAX_DAUER_MINUTEN)) {
    throw new SeriePflegeFehler(
      `Die Dauer liegt zwischen 15 und ${String(MAX_DAUER_MINUTEN)} Minuten — eine `
      + 'Schicht ist kürzer als ein Tag.', 'unvollstaendig');
  }
  const bis = e.gueltigBis === undefined || e.gueltigBis === null || e.gueltigBis === ''
    ? null : e.gueltigBis;
  if (bis !== null && !DATUM.test(bis)) {
    throw new SeriePflegeFehler('„Gültig bis" ist ein Datum.', 'unvollstaendig');
  }
  /*
   * Der Anker wird nur geprüft, wenn er sich ÄNDERT: ein bisheriger Anker,
   * dessen Zeile inzwischen beendet ist, soll das Speichern einer Uhrzeit
   * nicht verhindern.
   */
  const ankerGenannt = e.auftragLeistungId !== undefined;
  const anker = e.auftragLeistungId ?? null;
  if (ankerGenannt && anker !== null && anker !== kopf.auftrag_leistung_id) {
    try {
      await pruefeLeistungsanker(kontext, anker);
    } catch (fehler: unknown) {
      if (fehler instanceof LeistungsankerFehler) {
        throw new SeriePflegeFehler(fehler.message, fehler.grund, 422);
      }
      throw fehler;
    }
  }

  /*
   * **Jeder Parameter traegt seinen Typ ausgeschrieben.** In
   * `case when $4 is null` UND zugleich in einer Verkettung bleibt der Typ
   * sonst unbestimmt, und Postgres weist die Anweisung mit „could not
   * determine data type of parameter" ab — zur LAUFZEIT, nicht beim
   * Typcheck. Der Test hat es gefunden; ohne ihn waere es der erste Klick
   * auf „Regel speichern" gewesen.
   */
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update turnus
        set bezeichnung    = coalesce($2::text, bezeichnung),
            rrule          = coalesce($3::text, rrule),
            dtstart_lokal  = case when $4::text is null then dtstart_lokal
                                  else (dtstart_lokal::date || ' ' || $4::text)::timestamp end,
            dauer_minuten  = coalesce($5::integer, dauer_minuten),
            feiertagsregel = coalesce($6::turnus_feiertagsregel, feiertagsregel),
            gueltig_bis    = case when $8 then $7::date else gueltig_bis end,
            auftrag_leistung_id = case when $10 then $11::uuid else auftrag_leistung_id end,
            geaendert_am = now(), geaendert_von_art = 'mensch'::akteur_art,
            geaendert_von = $9::uuid
      where id = $1::uuid and archiviert_am is null
      returning id`,
    [kopf.turnus_id, e.bezeichnung?.trim() === '' ? null : e.bezeichnung ?? null,
      rrule, e.beginnLokal ?? null, e.dauerMinuten ?? null, e.feiertagsregel ?? null,
      bis, e.gueltigBis !== undefined, kontext.benutzerId, ankerGenannt, anker]);
  if (zeilen.length === 0) {
    throw new SeriePflegeFehler(
      'Der Turnus wurde nicht geändert — ist er archiviert, oder fehlt '
      + '`dienstplan.schreiben` in dieser Gesellschaft?', 'abgewiesen', 403);
  }

  /* Ein verkürzter Geltungszeitraum ist ein Beenden: was danach schon im Plan
     steht, wird hier abgesagt und nicht dem Generator überlassen (siehe oben). */
  const abgesagt = bis === null ? 0 : await sageKuenftigeAb(
    kontext, serieId, 'serie_beendet', { planDatumNach: bis });

  const bericht = (await generiereJetzt(kontext)).find((b) => b.planungsserieId === serieId);
  await protokolliere(kontext, serieId, AUDIT_GEAENDERT,
    {
      turnusId: kopf.turnus_id, rrule, gueltigBis: bis, abgesagt,
      ...(ankerGenannt ? { auftragLeistungId: anker } : {}),
    });
  return {
    erzeugt: bericht?.erzeugt ?? 0, aktualisiert: bericht?.aktualisiert ?? 0,
    storniert: bericht?.storniert ?? 0, abgesagt,
  };
}

/* ===========================================================================
 * 3. Beenden — zu einem Datum, mit Absage dessen, was danach liegt
 * ======================================================================== */

export async function beendeSerie(
  kontext: SchreibKontext, serieId: string, bis: string,
): Promise<PflegeErgebnis> {
  if (!DATUM.test(bis)) {
    throw new SeriePflegeFehler(
      'Ein Ende ist ein Datum (JJJJ-MM-TT). Bis einschliesslich diesem Tag läuft die '
      + 'Serie weiter.', 'unvollstaendig');
  }
  const kopf = await leseKopf(kontext, serieId);
  if (kopf.archiviert) {
    throw new SeriePflegeFehler(
      'Diese Serie ist archiviert und erzeugt ohnehin nichts mehr.',
      'schon_archiviert', 409);
  }
  const traeger = kopf.turnus_id ?? kopf.posten_id;
  if (traeger === null) {
    throw new SeriePflegeFehler(
      'Eine Veranstaltung ist ein einzelnes Fenster und lässt sich nicht beenden — '
      + 'sagen Sie ihre Schichten ab oder archivieren Sie die Serie.', 'kein_turnus', 409);
  }
  const tabelle = kopf.turnus_id !== null ? 'turnus' : 'posten';

  /*
   * ZUERST lesen, dann schreiben. `turnus_gueltig_fenster` fängt ein Ende vor
   * dem Beginn ohnehin ab — aber mit dem Namen der Bedingung, und das ist
   * kein Satz, den man einem Menschen zeigt. Ausserdem nennt dieser hier den
   * Beginn, gegen den das Ende verstösst.
   */
  const [geltung] = await kontext.abfrage<{ ab: string }>(
    `select to_char(gueltig_ab, 'YYYY-MM-DD') as ab from ${tabelle}
      where id = $1::uuid and archiviert_am is null`, [traeger]);
  if (geltung === undefined) {
    throw new SeriePflegeFehler(
      'Der Träger dieser Serie ist archiviert oder nicht erreichbar.',
      'nicht_gefunden', 404);
  }
  if (bis < geltung.ab) {
    throw new SeriePflegeFehler(
      `Das Ende liegt vor dem Beginn der Serie (${geltung.ab}).`, 'zeitraum');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update ${tabelle}
        set gueltig_bis = $2::date,
            geaendert_am = now(), geaendert_von_art = 'mensch'::akteur_art,
            geaendert_von = $3::uuid
      where id = $1::uuid and archiviert_am is null
      returning id`,
    [traeger, bis, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new SeriePflegeFehler(
      'Der Träger der Serie wurde nicht geändert — fehlt `dienstplan.schreiben`?',
      'abgewiesen', 403);
  }

  const abgesagt = await sageKuenftigeAb(
    kontext, serieId, 'serie_beendet', { planDatumNach: bis });
  const bericht = (await generiereJetzt(kontext)).find((b) => b.planungsserieId === serieId);
  await protokolliere(kontext, serieId, AUDIT_BEENDET, { bis, abgesagt });
  return {
    erzeugt: bericht?.erzeugt ?? 0, aktualisiert: bericht?.aktualisiert ?? 0,
    storniert: bericht?.storniert ?? 0, abgesagt,
  };
}

/* ===========================================================================
 * 4. Archivieren — die Serie erzeugt nichts mehr, der Träger bleibt
 * ======================================================================== */

export async function archiviereSerie(
  kontext: SchreibKontext, serieId: string, grund: string,
): Promise<PflegeErgebnis> {
  if (grund.trim().length < 3) {
    throw new SeriePflegeFehler(
      'Eine Archivierung ohne Grund ist keine Auskunft — mindestens drei Zeichen. Sie '
      + 'steht später an jeder abgesagten Schicht und beantwortet, warum an diesen '
      + 'Tagen niemand eingeplant war.', 'grund_fehlt');
  }
  const kopf = await leseKopf(kontext, serieId);
  if (kopf.archiviert) {
    throw new SeriePflegeFehler('Diese Serie ist schon archiviert.', 'schon_archiviert', 409);
  }

  /*
   * ZUERST absagen, dann archivieren — in dieser Reihenfolge, und das ist
   * nicht Geschmack. Beides steht in EINER Transaktion; scheitert das
   * Archivieren, ist auch die Absage zurückgedreht. Umgekehrt wäre die Serie
   * schon aus dem Blick des Generators, während die Absage noch läuft.
   */
  const abgesagt = await sageKuenftigeAb(
    kontext, serieId, `serie_archiviert: ${grund.trim()}`, { abJetzt: true });

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update planungsserie
        set archiviert_am = now(), archiviert_von = $2::uuid,
            geaendert_am = now(), geaendert_von_art = 'mensch'::akteur_art,
            geaendert_von = $2::uuid
      where id = $1::uuid and archiviert_am is null
      returning id`, [serieId, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new SeriePflegeFehler(
      'Die Serie wurde nicht archiviert — fehlt `dienstplan.schreiben` in dieser '
      + 'Gesellschaft?', 'abgewiesen', 403);
  }

  await protokolliere(kontext, serieId, AUDIT_ARCHIVIERT, { grund: grund.trim(), abgesagt });
  return { erzeugt: 0, aktualisiert: 0, storniert: 0, abgesagt };
}

async function protokolliere(
  kontext: SchreibKontext, serieId: string, aktion: string, nutzlast: Record<string, unknown>,
): Promise<void> {
  await kontext.schreibe(
    `select app.protokolliere($1, 'planungsserie', $2, null, $3::jsonb, app.aktiver_mandant())`,
    /* Das OBJEKT, nicht sein JSON-Text (D-467). */
    [aktion, serieId, nutzlast]);
}
