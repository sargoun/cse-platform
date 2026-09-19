import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  PAUSE_AB_6H, PAUSE_AB_9H, RUHEZEIT_MINUTEN,
} from './arbzg.js';
import {
  SOLLSTUNDEN_OFFEN, type SollstundenRegel,
} from './sollstunden.js';

/**
 * Arbeitszeitmodelle und Tarifvereinbarungen — lesen und bestaetigen
 * (EMP-04, TIM-06, TIM-14, LEG-03, O-18, O-50).
 *
 * **Die gesetzlichen ArbZG-Grenzen sind keine Einstellung.** 04-SEITENKARTE
 * §5.24 ist ausdruecklich: „The ArbZG limits are not settings". Diese Datei
 * kann sie deshalb nur ANZEIGEN — der Vergleichsmaßstab kommt aus `arbzg.ts`,
 * also aus der Datei, die auch prueft. Eine Tarifregel darf nur STRENGER
 * sein; einen schwaecheren Wert weist `pruefeTarifRegel` ab, und die
 * Datenbank weist ihn noch einmal ab (`tv_mindestens_gesetz`, 0201). Zwei
 * Linien, weil die Anwendung eine BENANNTE Meldung erzeugt und die Datenbank
 * die haltbare.
 *
 * **Die Sollzeitregel bleibt offen, und das ist kein Mangel dieser Datei.**
 * O-18 ist unbeantwortet: ob die Woche fuenf oder sechs Arbeitstage hat, ob
 * ein Feiertag Sollzeit senkt oder als bezahlte Ausfallzeit gutgeschrieben
 * wird, wie Teilzeit auf Tage faellt, und ob das Konto gegen den Monat oder
 * gegen einen Ausgleichszeitraum rechnet. Jede dieser Antworten aendert den
 * SALDO, und der Saldo wird am Ende eine Lohnzeile. `regelFuerModell` gibt
 * deshalb `SOLLSTUNDEN_OFFEN` zurueck — die Regel, die `null` antwortet —,
 * und `sollMinutenOderFehler` wirft mit dem Namen der hinterlegten Regel,
 * statt eine Formel zu raten.
 */

export class ArbeitszeitFehler extends Error {
  constructor(
    readonly grund: 'ungueltig' | 'schwaecher_als_gesetz' | 'ueberlappt',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'ArbeitszeitFehler';
  }
}

/** Die gesetzlichen Werte, wie der Bildschirm sie neben den Tarif stellt. */
export const GESETZ: Readonly<Record<'pause6h' | 'pause9h' | 'ruhezeit', number>> = {
  pause6h: PAUSE_AB_6H,
  pause9h: PAUSE_AB_9H,
  ruhezeit: RUHEZEIT_MINUTEN,
};

/**
 * Die GESCHLOSSENE Menge der Uebertragsregeln — heute genau eine.
 *
 * `uebertrag_art` entscheidet, was am Monatsende mit einem Stundensaldo
 * geschieht: mitnehmen, kappen, verfallen lassen. Das ist eine Lohnfrage,
 * und sie ist offen (O-18). Solange sie offen ist, gibt es hier genau einen
 * Wert, und „offen" heisst: es wird nichts uebertragen und nichts verfallen
 * gelassen. Ein FREITEXTFELD an dieser Stelle waere das Gegenteil eines
 * benannten Platzhalters — ein Tippfehler („verfalen") liesse sich speichern
 * und saehe in der Tabelle danach aus wie eine hinterlegte Regel.
 *
 * Erweitert wird die Liste, wenn O-18 beantwortet ist: ein Wert hier, ein
 * Zweig in der Sollzeitrechnung, ein Test — und die CHECK-Constraint
 * `azm_uebertrag_art` (0205) zieht nach.
 */
export const UEBERTRAG_ARTEN = ['offen'] as const;

export type UebertragArt = typeof UEBERTRAG_ARTEN[number];

export function istUebertragArt(wert: string): wert is UebertragArt {
  return (UEBERTRAG_ARTEN as readonly string[]).includes(wert);
}

export type Gewerk = 'reinigung' | 'security' | 'bau';

export const GEWERKE: readonly Gewerk[] = ['reinigung', 'security', 'bau'];

export const GEWERK_TEXT: Readonly<Record<Gewerk, string>> = {
  reinigung: 'Gebäudereinigung',
  security: 'Sicherheits- und Objektschutzdienste',
  bau: 'Hochbau, Ausbau, Rückbau',
};

export interface ModellZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  /** Tausendstel-Stunden als Text — nie eine Gleitkommazahl (K-16). */
  readonly wochenstunden: string | null;
  readonly arbeitstageWoche: string | null;
  readonly sollzeitregel: string;
  readonly uebertragArt: string;
  readonly uebertragGrenzeMinuten: number | null;
  readonly verfallMonate: number | null;
  readonly istPlatzhalter: boolean;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
  readonly bestaetigtAm: string | null;
  readonly bestaetigtVon: string | null;
}

interface ModellRoh {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly wochenstunden: string | null;
  readonly arbeitstage_woche: string | null;
  readonly sollzeitregel: string;
  readonly uebertrag_art: string;
  readonly uebertrag_grenze_minuten: number | null;
  readonly verfall_monate: number | null;
  readonly ist_platzhalter: boolean;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  readonly bestaetigt_am: string | null;
  readonly bestaetigt_von: string | null;
}

export interface TarifZeile {
  readonly id: string;
  readonly gewerk: Gewerk;
  readonly gewerkText: string;
  readonly bezeichnung: string;
  readonly fundstelle: string | null;
  readonly pauseAb6hMinuten: number | null;
  readonly pauseAb9hMinuten: number | null;
  readonly ruhezeitMinuten: number | null;
  readonly istPlatzhalter: boolean;
  readonly giltAb: string;
  readonly giltBis: string | null;
  readonly bestaetigtAm: string | null;
  readonly bestaetigtVon: string | null;
  /** Ist irgendein Wert strenger als das Gesetz? Sonst wirkt die Zeile nicht. */
  readonly strengerAlsGesetz: boolean;
}

interface TarifRoh {
  readonly id: string;
  readonly gewerk: string;
  readonly bezeichnung: string;
  readonly fundstelle: string | null;
  readonly pause_ab_6h_minuten: number | null;
  readonly pause_ab_9h_minuten: number | null;
  readonly ruhezeit_minuten: number | null;
  readonly ist_platzhalter: boolean;
  readonly gilt_ab: string;
  readonly gilt_bis: string | null;
  readonly bestaetigt_am: string | null;
  readonly bestaetigt_von: string | null;
}

export async function ladeArbeitszeitmodelle(
  kontext: LeseKontext,
): Promise<readonly ModellZeile[]> {
  const roh = await kontext.abfrage<ModellRoh>(
    `select m.id, m.schluessel, m.bezeichnung,
            m.wochenstunden::text as wochenstunden,
            m.arbeitstage_woche::text as arbeitstage_woche,
            m.sollzeitregel, m.uebertrag_art, m.uebertrag_grenze_minuten,
            m.verfall_monate, m.ist_platzhalter,
            m.gueltig_ab::text as gueltig_ab, m.gueltig_bis::text as gueltig_bis,
            to_char(m.bestaetigt_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as bestaetigt_am,
            b.name as bestaetigt_von
       from arbeitszeitmodell m
       left join benutzer b on b.id = m.bestaetigt_von
      order by m.schluessel, m.gueltig_ab desc`);
  return roh.map((r) => ({
    id: r.id, schluessel: r.schluessel, bezeichnung: r.bezeichnung,
    wochenstunden: r.wochenstunden, arbeitstageWoche: r.arbeitstage_woche,
    sollzeitregel: r.sollzeitregel, uebertragArt: r.uebertrag_art,
    uebertragGrenzeMinuten: r.uebertrag_grenze_minuten,
    verfallMonate: r.verfall_monate, istPlatzhalter: r.ist_platzhalter,
    gueltigAb: r.gueltig_ab, gueltigBis: r.gueltig_bis,
    bestaetigtAm: r.bestaetigt_am, bestaetigtVon: r.bestaetigt_von,
  }));
}

/** Ist irgendein Tarifwert strenger als das Gesetz? */
export function strengerAlsGesetz(t: {
  readonly pauseAb6hMinuten: number | null;
  readonly pauseAb9hMinuten: number | null;
  readonly ruhezeitMinuten: number | null;
}): boolean {
  return (t.pauseAb6hMinuten !== null && t.pauseAb6hMinuten > GESETZ.pause6h)
    || (t.pauseAb9hMinuten !== null && t.pauseAb9hMinuten > GESETZ.pause9h)
    || (t.ruhezeitMinuten !== null && t.ruhezeitMinuten > GESETZ.ruhezeit);
}

export async function ladeTarifvereinbarungen(
  kontext: LeseKontext,
): Promise<readonly TarifZeile[]> {
  const roh = await kontext.abfrage<TarifRoh>(
    `select t.id, t.gewerk, t.bezeichnung, t.fundstelle,
            t.pause_ab_6h_minuten, t.pause_ab_9h_minuten, t.ruhezeit_minuten,
            t.ist_platzhalter, t.gilt_ab::text as gilt_ab, t.gilt_bis::text as gilt_bis,
            to_char(t.bestaetigt_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as bestaetigt_am,
            b.name as bestaetigt_von
       from tarifvereinbarung t
       left join benutzer b on b.id = t.bestaetigt_von
      order by t.gewerk, t.gilt_ab desc`);
  return roh.map((r) => {
    const werte = {
      pauseAb6hMinuten: r.pause_ab_6h_minuten,
      pauseAb9hMinuten: r.pause_ab_9h_minuten,
      ruhezeitMinuten: r.ruhezeit_minuten,
    };
    return {
      id: r.id, gewerk: r.gewerk as Gewerk,
      gewerkText: GEWERK_TEXT[r.gewerk as Gewerk] ?? r.gewerk,
      bezeichnung: r.bezeichnung, fundstelle: r.fundstelle,
      ...werte,
      istPlatzhalter: r.ist_platzhalter,
      giltAb: r.gilt_ab, giltBis: r.gilt_bis,
      bestaetigtAm: r.bestaetigt_am, bestaetigtVon: r.bestaetigt_von,
      strengerAlsGesetz: strengerAlsGesetz(werte),
    };
  });
}

/**
 * Die Sollzeitregel eines Modells — die ZWEITE Umsetzung der Schnittstelle,
 * an genau EINER Stelle (`sollstunden.ts` sieht das so vor).
 *
 * **Heute gibt es genau eine Regel, und sie antwortet nicht.** `offen` ist
 * `SOLLSTUNDEN_OFFEN`. Jeder andere hinterlegte Schluessel heisst: der
 * Mandant hat eine Regel BENANNT, deren Code noch nicht geschrieben ist —
 * dann muss die Meldung ihren Namen nennen, damit nicht nach einem
 * Datenbankfehler gesucht wird. Ein Rueckfall auf eine Formel gaebe es hier
 * nicht: `wochenstunden / 5 * arbeitstage` sieht harmlos aus und entscheidet
 * vier Fragen, die niemand gestellt hat (O-18).
 *
 * **Der zweite Zweig ist heute nicht erreichbar, und das ist Absicht.**
 * Kein Schreibweg setzt `sollzeitregel` auf etwas anderes als `'offen'`: der
 * INSERT in `setzeArbeitszeitmodell` schreibt das Literal, die Spalte hat
 * dieselbe Vorgabe, und der Spaltengrant erlaubt kein UPDATE darauf. Der
 * Zweig sichert die Spalte gegen einen kuenftigen MIGRATIONSWERT ab — wer
 * eine zweite Regel benennt, bevor er sie baut, bekommt ihren Namen in der
 * Meldung statt eine stillschweigende `null`. Er ist also keine benutzbare
 * Einstellung, sondern eine Wache; wenn `sollzeitregel` je Eingabe wird,
 * gehoert eine geschlossene Menge dazu, wie bei `UEBERTRAG_ARTEN`.
 */
export function regelFuerModell(modell: {
  readonly schluessel: string; readonly sollzeitregel: string;
}): SollstundenRegel {
  if (modell.sollzeitregel === 'offen') return SOLLSTUNDEN_OFFEN;
  return {
    schluessel: `${modell.sollzeitregel} (nicht gebaut)`,
    sollMinuten(): number | null {
      return null;
    },
  };
}

export interface ModellEingabe {
  readonly schluessel: string;
  readonly bezeichnung: string;
  /** Tausendstel-Stunden als Text, z. B. `39.000` — nie eine Gleitkommazahl. */
  readonly wochenstunden: string | null;
  readonly arbeitstageWoche: string | null;
  readonly uebertragArt: string;
  readonly uebertragGrenzeMinuten: number | null;
  readonly verfallMonate: number | null;
  readonly gueltigAb: string;
  /** `true`: der Mandant bestaetigt die Werte (O-18 fuer diese Zeile beantwortet). */
  readonly bestaetigt: boolean;
}

const MENGE = /^\d{1,3}(?:[.,]\d{1,3})?$/u;

/** `39,5` → `39.500`. Text nach Text, nie durch eine Gleitkommazahl (K-16). */
export function alsMengeText(eingabe: string): string {
  if (!MENGE.test(eingabe.trim())) {
    throw new ArbeitszeitFehler('ungueltig',
      `„${eingabe}" ist keine Stundenzahl. Erlaubt sind bis zu drei Nachkommastellen, `
      + 'z. B. 39 oder 38,5.');
  }
  const [ganz, teil = ''] = eingabe.trim().replace(',', '.').split('.');
  return `${ganz ?? '0'}.${teil.padEnd(3, '0')}`;
}

/**
 * Eine Fassung eines Arbeitszeitmodells — die laufende wird zum Vortag
 * geschlossen.
 *
 * Dieselbe Mechanik wie bei `mahnstufe` und `anstellung_kondition`: erst
 * schliessen, dann anlegen. Andersherum stiessen beide fuer einen Augenblick
 * auf `azm_kein_ueberlapp`, und die neue Zeile waere abgewiesen — mit einer
 * Meldung ueber einen Zustand, den niemand gewollt hat.
 *
 * **Eine Rueckwirkungssperre gibt es hier NICHT — und das ist eine bewusste
 * Nicht-Entscheidung.** Hier stand einmal „vor heute gibt es keine Fassung",
 * begruendet mit § 17 MiLoG. Diese Regel hat niemand getroffen: das Vorbild
 * `mahnstufe` kennt sie nicht, `setzeTarifvereinbarung` in dieser Datei kennt
 * sie nicht (Tarife duerften also rueckwirkend gelten, Modelle nicht), und
 * sie machte genau den Fall unmoeglich, den `/einstellungen/import`
 * vorbereitet: ein Mandant, der bei der Uebernahme sein seit 2020 geltendes
 * Modell hinterlegen will. Die Ablösung regelt allein `azm_kein_ueberlapp`,
 * wie bei `mahnstufe`.
 */
// TODO(client, O-626): Darf eine Fassung rueckwirkend hinterlegt werden (Uebernahme von Altbestaenden), und ab welchem Datum ist ein Monat fuer neue Fassungen gesperrt — ab dem Zeitnachweis nach § 17 MiLoG, ab der Lohnabrechnung oder ab der Festschreibung?
export async function setzeArbeitszeitmodell(
  kontext: SchreibKontext, e: ModellEingabe,
): Promise<void> {
  const schluessel = e.schluessel.trim();
  if (schluessel === '' || e.bezeichnung.trim() === '') {
    throw new ArbeitszeitFehler('ungueltig',
      'Schlüssel und Bezeichnung sind Pflicht — der Schlüssel ist das Ziel von '
      + 'anstellung_kondition.arbeitszeitmodell.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(e.gueltigAb)) {
    throw new ArbeitszeitFehler('ungueltig', 'Gültig ab: bitte als JJJJ-MM-TT.');
  }
  /*
   * Zweite Linie hinter der Route: die Menge ist geschlossen, und zwar hier,
   * damit kein zweiter Schreibweg sie umgeht. Die dritte Linie ist
   * `azm_uebertrag_art` in der Datenbank (0205).
   */
  if (!istUebertragArt(e.uebertragArt)) {
    throw new ArbeitszeitFehler('ungueltig',
      `„${e.uebertragArt}" ist keine Übertragsregel. Erlaubt ist derzeit nur `
      + `„${UEBERTRAG_ARTEN.join('", „')}" — was am Monatsende mit einem Saldo `
      + 'geschieht, ist offen (O-18), und eine geratene Regel löscht Überstunden.');
  }

  try {
    await kontext.schreibe(
      `update arbeitszeitmodell
          set gueltig_bis = ($2::date - 1), geaendert_von = $3::uuid
        where mandant_id = app.aktiver_mandant()
          and schluessel = $1 and gueltig_bis is null and gueltig_ab < $2::date`,
      [schluessel, e.gueltigAb, kontext.benutzerId]);

    await kontext.schreibe(
      `insert into arbeitszeitmodell
         (mandant_id, schluessel, bezeichnung, wochenstunden, arbeitstage_woche,
          sollzeitregel, uebertrag_art, uebertrag_grenze_minuten, verfall_monate,
          ist_platzhalter, gueltig_ab, bestaetigt_am, bestaetigt_von, erstellt_von)
       values (app.aktiver_mandant(), $1, $2, $3::numeric, $4::numeric,
               'offen', $5, $6::int, $7::int,
               $8, $9::date,
               case when $8 then null else now() end,
               case when $8 then null else $10::uuid end,
               $10::uuid)`,
      [schluessel, e.bezeichnung.trim(), e.wochenstunden, e.arbeitstageWoche,
        e.uebertragArt, e.uebertragGrenzeMinuten, e.verfallMonate,
        !e.bestaetigt, e.gueltigAb, kontext.benutzerId]);
  } catch (fehler: unknown) {
    const f = fehler as { code?: unknown; constraint_name?: unknown };
    if (f.code === '23P01' && f.constraint_name === 'azm_kein_ueberlapp') {
      throw new ArbeitszeitFehler('ueberlappt',
        `Für „${schluessel}" gilt am ${e.gueltigAb} schon eine Fassung. Zwei `
        + 'gleichzeitig gültige Wochenstundenzahlen sind keine Lage, die ein Mensch '
        + 'gemeint haben kann: jede Sollzeitrechnung müsste raten.');
    }
    throw fehler;
  }

  await kontext.schreibe(
    `select app.protokolliere('zeit.arbeitszeitmodell_gesetzt', 'arbeitszeitmodell',
                              $1, null, $2::jsonb, app.aktiver_mandant())`,
    [schluessel, {
      schluessel, gueltigAb: e.gueltigAb, wochenstunden: e.wochenstunden,
      istPlatzhalter: !e.bestaetigt,
    }]);
}

export interface TarifEingabe {
  readonly gewerk: Gewerk;
  readonly bezeichnung: string;
  readonly fundstelle: string | null;
  readonly pauseAb6hMinuten: number | null;
  readonly pauseAb9hMinuten: number | null;
  readonly ruhezeitMinuten: number | null;
  readonly giltAb: string;
  readonly bestaetigt: boolean;
}

/**
 * Prueft eine Tarifregel gegen das Gesetz — und weist alles ab, was
 * schwaecher ist.
 *
 * **Warum die Anwendung das prueft, obwohl die Datenbank es auch tut.** Der
 * `CHECK` haelt; er erzeugt aber eine Constraintmeldung, und niemand weiss
 * danach, welcher der drei Werte gemeint war. Die Anwendung ist die Linie,
 * die eine BENANNTE Antwort gibt (Invariante 3, AUT-05).
 */
export function pruefeTarifRegel(e: TarifEingabe): void {
  const zuSchwach: string[] = [];
  if (e.pauseAb6hMinuten !== null && e.pauseAb6hMinuten < GESETZ.pause6h) {
    zuSchwach.push(
      `Pause ab 6 h: ${String(e.pauseAb6hMinuten)} min — § 4 ArbZG verlangt `
      + `mindestens ${String(GESETZ.pause6h)} min`);
  }
  if (e.pauseAb9hMinuten !== null && e.pauseAb9hMinuten < GESETZ.pause9h) {
    zuSchwach.push(
      `Pause ab 9 h: ${String(e.pauseAb9hMinuten)} min — § 4 ArbZG verlangt `
      + `mindestens ${String(GESETZ.pause9h)} min`);
  }
  if (e.ruhezeitMinuten !== null && e.ruhezeitMinuten < GESETZ.ruhezeit) {
    zuSchwach.push(
      `Ruhezeit: ${String(e.ruhezeitMinuten)} min — § 5 ArbZG verlangt mindestens `
      + `${String(GESETZ.ruhezeit)} min`);
  }
  if (zuSchwach.length > 0) {
    throw new ArbeitszeitFehler('schwaecher_als_gesetz',
      'Ein Tarifvertrag kann die gesetzlichen Grenzen nur ANHEBEN, nie senken. '
      + `Abgewiesen: ${zuSchwach.join('; ')}. Die ArbZG-Grenzen sind keine `
      + 'Einstellung dieser Plattform.');
  }
  if (e.pauseAb6hMinuten !== null && e.pauseAb9hMinuten !== null
      && e.pauseAb9hMinuten < e.pauseAb6hMinuten) {
    throw new ArbeitszeitFehler('ungueltig',
      'Die Pause ab 9 Stunden kann nicht kürzer sein als die ab 6 Stunden.');
  }
}

/** Eine Fassung der Tarifvereinbarung — die laufende wird zum Vortag geschlossen. */
export async function setzeTarifvereinbarung(
  kontext: SchreibKontext, e: TarifEingabe,
): Promise<void> {
  if (e.bezeichnung.trim() === '') {
    throw new ArbeitszeitFehler('ungueltig',
      'Ohne den Namen des Tarifvertrags ist eine strengere Pause eine Behauptung.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(e.giltAb)) {
    throw new ArbeitszeitFehler('ungueltig', 'Gilt ab: bitte als JJJJ-MM-TT.');
  }
  pruefeTarifRegel(e);

  try {
    await kontext.schreibe(
      `update tarifvereinbarung
          set gilt_bis = ($2::date - 1), geaendert_von = $3::uuid
        where mandant_id = app.aktiver_mandant()
          and gewerk = $1 and gilt_bis is null and gilt_ab < $2::date`,
      [e.gewerk, e.giltAb, kontext.benutzerId]);

    await kontext.schreibe(
      `insert into tarifvereinbarung
         (mandant_id, gewerk, bezeichnung, fundstelle,
          pause_ab_6h_minuten, pause_ab_9h_minuten, ruhezeit_minuten,
          ist_platzhalter, gilt_ab, bestaetigt_am, bestaetigt_von, erstellt_von)
       values (app.aktiver_mandant(), $1, $2, $3, $4::int, $5::int, $6::int,
               $7, $8::date,
               case when $7 then null else now() end,
               case when $7 then null else $9::uuid end,
               $9::uuid)`,
      [e.gewerk, e.bezeichnung.trim(), e.fundstelle,
        e.pauseAb6hMinuten, e.pauseAb9hMinuten, e.ruhezeitMinuten,
        !e.bestaetigt, e.giltAb, kontext.benutzerId]);
  } catch (fehler: unknown) {
    const f = fehler as { code?: unknown; constraint_name?: unknown };
    if (f.code === '23P01' && f.constraint_name === 'tv_kein_ueberlapp') {
      throw new ArbeitszeitFehler('ueberlappt',
        `Für ${GEWERK_TEXT[e.gewerk]} gilt am ${e.giltAb} schon eine Vereinbarung. `
        + 'Zwei gleichzeitig gültige Pausenregeln liessen die Prüfung raten, welche '
        + 'gilt — und sie würde je Abfrage anders raten.');
    }
    if (f.code === '23514' && f.constraint_name === 'tv_mindestens_gesetz') {
      throw new ArbeitszeitFehler('schwaecher_als_gesetz',
        'Die Datenbank hat den Wert abgewiesen: er liegt unter dem gesetzlichen '
        + 'Mindestmaß (§ 4, § 5 ArbZG).');
    }
    throw fehler;
  }

  await kontext.schreibe(
    `select app.protokolliere('zeit.tarifvereinbarung_gesetzt', 'tarifvereinbarung',
                              $1, null, $2::jsonb, app.aktiver_mandant())`,
    [e.gewerk, {
      gewerk: e.gewerk, giltAb: e.giltAb, bezeichnung: e.bezeichnung.trim(),
      pauseAb6hMinuten: e.pauseAb6hMinuten, pauseAb9hMinuten: e.pauseAb9hMinuten,
      ruhezeitMinuten: e.ruhezeitMinuten, istPlatzhalter: !e.bestaetigt,
    }]);
}
