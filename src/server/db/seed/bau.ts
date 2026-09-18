/**
 * Demodaten fuer das Baugewerk — Projekt, Leistungsverzeichnis, Aufmass,
 * Nachtrag und Bautagebuch (BAU-01 bis BAU-08, REALTIME Service GmbH).
 *
 * **Zwei ganze Gewerke standen im Seed mit null Zeilen da**: `projekt` 0,
 * `lv_position` 0, `aufmass` 0, `nachtrag` 0, `bautagebuch` 0. Das ist der
 * Grund, aus dem der Auftraggeber das Portal als „leer“ erlebt hat — die
 * Seiten sind gebaut, sie hatten nur nichts zu zeigen. Und eine leere Tabelle
 * sieht aus wie ein fertiger Bildschirm ohne Vorgang: niemand prueft an ihr,
 * ob die Kette dahinter traegt.
 *
 * **Was ueber einen Dienst laeuft, laeuft ueber den Dienst.** Aufmass
 * (`erfasseAufmass` — der Rechenansatz wird SERVERSEITIG ausgewertet),
 * Nachtrag (`meldeNachtragAn`, `ordneAufmasszeileZu`, `reicheEin` — durch das
 * Ausgangstor), Bautagebuch (`legeBautagAn`, `hefteMannstundenAn`,
 * `heftePositionAn`, `schliesseBautag`) und das Wetter (`hefteWetterAn`).
 * Direkt geschrieben werden nur Auftrag, Projekt und die LV-Zeilen — fuer sie
 * gibt es keinen Dienst: `services/bau/lv.ts` LIEST und rechnet, es schreibt
 * nichts. Der Import eines echten LV kommt aus GAEB und damit aus einer Datei,
 * die dieser Seed nicht hat.
 *
 * **Die OZ-Ordnung ist der Grund fuer die Laenge des Trockenbau-Titels.**
 * Ein LV mit acht Positionen je Titel zeigt nicht, worum es geht; erst ab
 * `1.2.9` und `1.2.10` trennt sich die Ordnung der Datenbank
 * (`sortier_pfad`) von der Zeichenkettensortierung, die `1.2.10` VOR `1.2.9`
 * stellt. Die Demodaten gehen deshalb bis `1.2.12` — und die Summe wird
 * anschliessend aus DER GELESENEN Ordnung gebildet, nicht aus der Reihenfolge,
 * in der dieser Seed geschrieben hat.
 *
 * **Bedarfs- und Alternativposition zaehlen NICHT in die Auftragssumme**
 * (03-GEWERKE §3.3, O-155). Eine Demo, in der jede Zeile mitzaehlt, prueft die
 * Unterscheidung gerade nicht — deshalb steht je eine davon im LV.
 *
 * **Das Wetter wird nicht erfunden.** `src/server/versand/dwd.ts` ist ohne
 * `DWD_OPENDATA_BASE` nicht verbunden, und die Baustelle traegt ausserdem
 * keine Koordinaten. `hefteWetterAn` gibt dann einen BEFUND zurueck statt
 * Messwerte, der Bautag wird ohne Wetter gespeichert, und die Seite schreibt
 * „Wetterdaten nicht verfuegbar“ (BAU-08). Eine ausgedachte Temperatur waere
 * in einem Behinderungsstreit ein Beweismittel, das niemand gemessen hat.
 *
 * **Idempotent durch LESEN ZUERST** — wie die uebrigen Seed-Dateien. Ein
 * eingereichter Nachtrag laesst sich nicht zurueckziehen, ein abgeschlossener
 * Bautag nicht aendern (BAU-07, LEG-01), und der Auftragskreis vergaebe beim
 * zweiten Lauf eine zweite Nummer.
 */
import type postgres from 'postgres';
import type { LeseKontext } from '../../kontext/index.js';
import { alsPortalSitzung } from './sitzung.js';
import { berlinHeute, type Abfrage as TagAbfrage }
  from '../../services/dienstplan/generator.js';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import { vergebeNummer } from '../../services/finanz/nummernkreis.js';
import { formatiereGeld } from '../../services/finanz/geld.js';
import { berechneHash } from '../../services/finanz/hash-chain.js';
import {
  baueOzBaum, ladeLvPositionen, lvSummeCent, type LvArt, type LvPositionsart,
} from '../../services/bau/lv.js';
import { erfasseAufmass, ladeZeilen } from '../../services/bau/aufmass.js';
import {
  findeNachtrag, meldeNachtragAn, nachtragNutzlast, ordneAufmasszeileZu, reicheEin,
} from '../../services/bau/nachtrag.js';
import {
  hefteMannstundenAn, heftePositionAn, legeBautagAn, schliesseBautag,
} from '../../services/bau/bautagebuch.js';
import {
  behinderungNutzlast, erstelleBehinderung, findeBehinderung, zeigeWegfallAn,
} from '../../services/bau/behinderung.js';
import { protokolliereAbnahme } from '../../services/bau/abnahme.js';
import { legeLvImportAn } from '../../services/bau/lv-import.js';
import { hefteWetterAn } from '../../services/bau/wetter.js';
import { wetterPort } from '../../versand/dwd.js';
import { nutzlastHash } from '../../agent/policy.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface BauErgebnis {
  readonly projekte: number;
  readonly lvZeilen: number;
  /** Die Auftragssumme aus dem LV, formatiert — aus `lvSummeCent`. */
  readonly lvSumme: string | null;
  /** Positionen, die nach O-155 NICHT in die Summe gehen. */
  readonly ausgenommen: number;
  readonly aufmassblaetter: number;
  readonly aufmassZeilen: number;
  readonly nachtraege: number;
  readonly nachtragsnummer: string | null;
  /** § 6 VOB/B: laufend, weggefallen und storniert — je eine (BAU-06). */
  readonly behinderungen: number;
  readonly behinderungenLaufend: number;
  readonly gewerke: number;
  readonly bautage: number;
  readonly mannstunden: number;
  readonly tagespositionen: number;
  /** Was `hefteWetterAn` geantwortet hat — wortwoertlich, nicht beschoenigt. */
  readonly wetterBefund: string;
  readonly wetterVerbunden: boolean;
  /** § 12 Abs. 2 VOB/B: die Art der protokollierten Abnahme, oder `null`. */
  readonly abnahmeArt: string | null;
  /** § 12 Abs. 3: die im Protokoll aufgenommenen Maengel. */
  readonly abnahmeMaengel: number;
  /** Wurde die Vertragsstrafe vorbehalten (§ 11 Abs. 4)? */
  readonly abnahmeStrafeVorbehalten: boolean;
  /** Der wartende LV-Import: Zeilen insgesamt und die mit Fehlern. */
  readonly lvImportZeilen: number;
  readonly lvImportFehler: number;
}

const LEER: BauErgebnis = {
  projekte: 0, lvZeilen: 0, lvSumme: null, ausgenommen: 0,
  aufmassblaetter: 0, aufmassZeilen: 0, nachtraege: 0, nachtragsnummer: null,
  behinderungen: 0, behinderungenLaufend: 0, gewerke: 0, bautage: 0, mannstunden: 0, tagespositionen: 0,
  wetterBefund: 'nicht abgerufen', wetterVerbunden: false,
  abnahmeArt: null, abnahmeMaengel: 0, abnahmeStrafeVorbehalten: false,
  lvImportZeilen: 0, lvImportFehler: 0,
};

const PROJEKT = {
  bezeichnung: 'Dachgeschossausbau Berliner Straße 42',
  /**
   * // TODO(client, O-154): Kommen BGB-Bauvertraege vor oder ausschliesslich
   * VOB/B — und woran erkennt die Bauleitung, welches Regime gilt? Das Regime
   * entscheidet ueber Nachtrag, Behinderung, Abnahme und Gewaehrleistung;
   * `vertragsgrundlage` hat deshalb KEINEN Vorgabewert. Dieses Demoprojekt
   * steht auf VOB/B, weil der Nachtrag darauf aufsetzt (§ 2 Abs. 6) — das ist
   * eine Aussage ueber DIESE Demodaten und keine ueber die Vertragspraxis des
   * Hauses.
   */
  vertragsgrundlage: 'vob_b',
  art: 'ausbau',
} as const;

/**
 * Eine LV-Zeile, so wie sie in einem Leistungsverzeichnis steht.
 *
 * Die Preise sind DEMOWERTE — wie die Leistungszeilen in `auftrag.ts`. Sie
 * tragen keine Aussage ueber Marktpreise; ein echter Einheitspreis entsteht
 * aus der Urkalkulation und steht im Angebot, das die Gesellschaft abgibt.
 */
interface LvEntwurf {
  readonly oz: string;
  readonly art: LvArt;
  readonly kurztext: string;
  readonly langtext?: string;
  readonly einheit?: string;
  readonly menge?: string;
  readonly einheitspreisCent?: bigint;
  readonly positionsart?: LvPositionsart;
}

/**
 * Das Leistungsverzeichnis — ein Ausbauprojekt, wie es in Wilmersdorf steht.
 *
 * Der Trockenbau-Titel geht bis `1.2.12`, und das ist der Zweck: die Ordnung
 * `1.2.9` vor `1.2.10` ist genau die, die eine Textsortierung umdreht.
 */
const LV: readonly LvEntwurf[] = [
  { oz: '1', art: 'los', kurztext: 'Ausbau Dachgeschoss Berliner Straße 42' },

  { oz: '1.1', art: 'titel', kurztext: 'Baustelleneinrichtung und Gerüst' },
  { oz: '1.1.1', art: 'position', kurztext: 'Baustelleneinrichtung einrichten und vorhalten',
    langtext: 'Einrichten, Vorhalten und Räumen der Baustelleneinrichtung für die '
      + 'Dauer der Ausbauarbeiten, einschließlich Bauwasser und Baustrom vom '
      + 'bauseits gestellten Anschluss.',
    einheit: 'psch', menge: '1.000', einheitspreisCent: 480_000n },
  { oz: '1.1.2', art: 'position', kurztext: 'Fassadengerüst Hofseite, Lastklasse 3',
    einheit: 'm²', menge: '186.000', einheitspreisCent: 1_180n },
  { oz: '1.1.3', art: 'position', kurztext: 'Bauaufzug vorhalten',
    einheit: 'Wo', menge: '8.000', einheitspreisCent: 34_500n },

  { oz: '1.2', art: 'titel', kurztext: 'Trockenbau' },
  { oz: '1.2.1', art: 'position', kurztext: 'Metallständerwand CW 75, beidseitig doppelt beplankt',
    langtext: 'Nichttragende Trennwand in Metallständerbauweise, Ständerprofil CW 75, '
      + 'beidseitig doppelt beplankt mit Gipskartonbauplatte 12,5 mm, Hohlraum mit '
      + 'Mineralwolle 60 mm gedämmt.',
    einheit: 'm²', menge: '148.500', einheitspreisCent: 8_650n },
  { oz: '1.2.2', art: 'position', kurztext: 'Installationswand CW 100 vor Steigsträngen',
    einheit: 'm²', menge: '32.400', einheitspreisCent: 10_400n },
  { oz: '1.2.3', art: 'position', kurztext: 'Vorsatzschale vor Bestandsmauerwerk',
    einheit: 'm²', menge: '61.200', einheitspreisCent: 6_900n },
  { oz: '1.2.4', art: 'position', kurztext: 'Dachschrägenbekleidung, Unterkonstruktion und GKB',
    einheit: 'm²', menge: '212.800', einheitspreisCent: 7_450n },
  { oz: '1.2.5', art: 'position', kurztext: 'Abgehängte Unterdecke F30, Flur',
    einheit: 'm²', menge: '48.600', einheitspreisCent: 9_800n },
  { oz: '1.2.6', art: 'position', kurztext: 'Revisionsklappe 400 × 400 mm, F30',
    einheit: 'St', menge: '6.000', einheitspreisCent: 18_900n },
  { oz: '1.2.7', art: 'position', kurztext: 'Anschlussfugen dauerelastisch schließen',
    einheit: 'm', menge: '164.000', einheitspreisCent: 620n },
  { oz: '1.2.8', art: 'position', kurztext: 'Eckschutzschienen setzen und einspachteln',
    einheit: 'm', menge: '78.000', einheitspreisCent: 540n },
  { oz: '1.2.9', art: 'position', kurztext: 'Wandöffnung für Innentür herstellen',
    einheit: 'St', menge: '9.000', einheitspreisCent: 14_200n },
  { oz: '1.2.10', art: 'position', kurztext: 'Leibungsbekleidung Innentür, dreiseitig',
    einheit: 'St', menge: '9.000', einheitspreisCent: 11_600n },
  { oz: '1.2.11', art: 'position', kurztext: 'Oberflächenqualität Q3 auf Wandflächen',
    langtext: 'Bedarfsposition — wird nur auf gesonderte Anordnung ausgeführt und '
      + 'geht deshalb nicht in die Auftragssumme ein (§ 3.3, O-155).',
    einheit: 'm²', menge: '148.500', einheitspreisCent: 1_450n,
    positionsart: 'bedarfsposition' },
  { oz: '1.2.12', art: 'position', kurztext: 'Beplankung mit Feuchtraumplatte statt GKB',
    langtext: 'Alternativposition zu 1.2.1 für die Nassbereiche.',
    einheit: 'm²', menge: '24.000', einheitspreisCent: 9_950n,
    positionsart: 'alternativposition' },

  { oz: '1.3', art: 'titel', kurztext: 'Estrich und Bodenbeläge' },
  { oz: '1.3.1', art: 'position', kurztext: 'Trockenestrich zweilagig auf Schüttung',
    einheit: 'm²', menge: '196.400', einheitspreisCent: 5_980n },
  { oz: '1.3.2', art: 'position', kurztext: 'Randdämmstreifen einbauen und abschneiden',
    einheit: 'm', menge: '212.000', einheitspreisCent: 310n },
  { oz: '1.3.3', art: 'position', kurztext: 'Parkett Eiche Landhausdiele, geölt',
    einheit: 'm²', menge: '164.700', einheitspreisCent: 11_900n },

  { oz: '1.4', art: 'hinweistext',
    kurztext: 'Alle Maße sind vor Ausführung am Bau zu prüfen. '
      + 'Der Bestand ist ein Altbau von 1908; Rohbaumaße weichen ab.' },
];

/**
 * Das Aufmassblatt — drei Zeilen, und die dritte ist der Streitfall.
 *
 * Die Rechenansaetze stehen WOERTLICH so, wie ein Polier sie aufschreibt.
 * Ausgewertet werden sie auf dem Server (`rechneZeilen` → `berechneRechenansatz`),
 * und die Menge entsteht aus der Formel — nicht daneben. Ein Seed, der die
 * Menge selbst hinschriebe, pruefte den Parser nicht und koennte eine Zahl
 * eintragen, die zur Formel nicht passt.
 *
 * Die Einheit MUSS die der LV-Position sein (`kern.aufmass_zeile_einheit`,
 * §1.4) — eine Zeile in `m` unter einer Position in `m²` waere eine Menge
 * ohne Bedeutung.
 */
const AUFMASS_ZEILEN = [
  {
    oz: '1.2.1',
    bezeichnung: 'Trennwände Achse C bis E, Wohnung 3',
    rechenansatz: '3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)',
    einheit: 'm²',
  },
  {
    oz: '1.2.4',
    bezeichnung: 'Dachschräge Südseite, Gauben ausgenommen',
    rechenansatz: '2 × (6,40 × 3,10) − 2 × (1,20 × 1,40)',
    einheit: 'm²',
  },
] as const;

/**
 * Die Zeile AUSSERHALB des Leistungsverzeichnisses (BAU-05).
 *
 * Sie ist der Anlass des Nachtrags: aufgemessen wurde etwas, wofuer es keine
 * LV-Position gibt. `ladeAusserhalbLv` meldet genau solche Zeilen, solange
 * kein Nachtrag sie aufgenommen hat — und `ordneAufmasszeileZu` ist der Weg,
 * auf dem die Warnung wieder verschwindet.
 */
const AUSSERHALB = {
  bezeichnung: 'Stahlunterzug Achse D — im LV nicht enthalten',
  rechenansatz: '4,80 + 2,35',
  einheit: 'm',
  bemerkung:
    'Der Bestandsunterzug war unter der abgehängten Decke nicht sichtbar und ist '
    + 'im Leistungsverzeichnis nicht erfasst. Aufgenommen am Tag der Öffnung.',
} as const;

const NACHTRAG = {
  titel: 'Stahlunterzug Achse D — zusätzliche Auswechslung',
  grundlage: 'p2_abs_6',
  begruendung:
    'Beim Öffnen der Bestandsdecke im Bereich Achse D wurde ein nicht dokumentierter '
    + 'Stahlunterzug angetroffen. Die im Leistungsverzeichnis vorgesehene '
    + 'Ständerwand 1.2.1 lässt sich dort nicht ohne Auswechslung der '
    + 'Unterkonstruktion ausführen. Die Leistung ist im Vertrag nicht enthalten und '
    + 'wurde vor Ausführungsbeginn angekündigt (§ 2 Abs. 6 Nr. 1 VOB/B).',
  anordnungForm: 'muendlich',
  angeordnetVon: 'Charlottenburg Immobilien GmbH, Bauleitung vor Ort',
} as const;

/**
 * Drei Behinderungen nach § 6 VOB/B — und zwar in DREI Zustaenden.
 *
 * **Die Uebersicht des Baumoduls fragt nach genau einem davon** („laufend,
 * ohne dokumentierten Wegfall", BAU-06), und ein Bestand, in dem jede
 * Behinderung denselben Zustand hat, prueft diesen Filter nie. Deshalb:
 *
 *  - `laufend` — angezeigt, kein Wegfall. Sie steht auf der Uebersicht und
 *    hemmt die Bauzeit weiter, auch wenn auf der Baustelle wieder gearbeitet
 *    wird: § 6 Abs. 3 VOB/B verlangt die ANZEIGE des Wegfalls, nicht das
 *    Wiederaufnehmen der Arbeit.
 *  - `weggefallen` — angezeigt UND mit dokumentiertem Wegfall. Sie steht
 *    NICHT mehr auf der Uebersicht, und dass sie verschwindet, ist die Zusage,
 *    die sich nur an ihr pruefen laesst.
 *  - `entwurf` — erfasst, nicht angezeigt. Sie hemmt NICHTS: ein Entwurf ist
 *    keine Anzeige, und die Uebersicht sagt das ausdruecklich.
 */
const BEHINDERUNGEN = [
  {
    art: 'laufend',
    grundKategorie: 'risikobereich_ag',
    ursache:
      'Die Baugenehmigung für die Dachgaube liegt nicht vor; die Bauleitung des '
      + 'Auftraggebers hat die Ausführung im Bereich Achse A–C bis zur Erteilung '
      + 'untersagt.',
    auswirkung:
      'Der Trockenbau im Bereich Achse A–C kann nicht begonnen werden. Die Folgen '
      + 'für den Fertigstellungstermin sind noch nicht abschließend bezifferbar.',
    auswirkungTage: null,
    versatz: -9,
    empfaenger: 'Charlottenburg Immobilien GmbH, Bauleitung',
    wegfallVersatz: null,
  },
  {
    art: 'weggefallen',
    grundKategorie: 'hoehere_gewalt',
    ursache:
      'Dauerfrost unter −5 °C über fünf Arbeitstage; Estricharbeiten sind bei '
      + 'dieser Temperatur nicht ausführbar.',
    auswirkung: 'Estrich- und Bodenbelagsarbeiten ruhen; Verzug fünf Arbeitstage.',
    auswirkungTage: 5,
    versatz: -30,
    empfaenger: 'Charlottenburg Immobilien GmbH, Bauleitung',
    wegfallVersatz: -23,
  },
  {
    art: 'entwurf',
    grundKategorie: 'risikobereich_ag',
    ursache:
      'Die vom Auftraggeber beauftragte Elektrofirma hat die Leerrohre in Achse D '
      + 'nicht verlegt; die Ständerwand kann dort nicht geschlossen werden.',
    auswirkung: 'Noch nicht bezifferbar — der Termin der Vorleistung ist offen.',
    auswirkungTage: null,
    versatz: -2,
    empfaenger: 'Charlottenburg Immobilien GmbH, Bauleitung',
    wegfallVersatz: null,
  },
] as const;

/**
 * Der Gewerkekatalog — ZWEI Zeilen, beide als unbestaetigt gekennzeichnet.
 *
 * // TODO(client, O-159): Welche Gewerke werden im Bautagebuch gefuehrt, und
 * folgt die Liste den STLB-Bau-Leistungsbereichen? Der Katalog wird LEER
 * ausgeliefert, und das bleibt so: diese beiden Zeilen tragen
 * `ist_platzhalter = true`, die Oberflaeche schreibt „(unbestaetigt)“ dahinter,
 * und ohne sie liesse sich keine einzige Mannstundenzeile anlegen — der Bautag
 * stuende dann ohne die Angabe da, um die es in einem Bauzeitenstreit
 * ueberhaupt geht.
 */
const GEWERKE = [
  { code: 'TRO', bezeichnung: 'Trockenbauarbeiten', leistungsbereich: '039' },
  { code: 'EST', bezeichnung: 'Estrich- und Bodenbelagsarbeiten', leistungsbereich: '025' },
] as const;

interface TagEntwurf {
  readonly versatz: number;
  readonly beginn: string;
  readonly ende: string;
  readonly bemerkungen: string;
  readonly vorkommnisse?: string;
  readonly stunden: readonly {
    readonly code: string; readonly personen: number; readonly minuten: number;
    readonly taetigkeit: string; readonly bereich: string;
  }[];
  readonly positionen: readonly {
    readonly art: 'geraet' | 'lieferung' | 'vorkommnis';
    readonly bezeichnung: string;
    readonly menge?: string;
    readonly einheit?: string;
    readonly lieferschein?: string;
    readonly beschreibung?: string;
    readonly uhrzeit?: string;
  }[];
}

/**
 * Drei Bautage — Montag bis Mittwoch der VERGANGENEN Woche.
 *
 * Vergangenheit, weil ein Bautag, der in der Zukunft liegt, nichts bezeugt;
 * Werktage, weil `bautagebuch_tag_uk` je Projekt und Kalendertag genau einen
 * lebenden Tag zulaesst und ein Wochenendtag im Ausbau die Ausnahme ist.
 *
 * Die Dauer steht in ganzen MINUTEN (K-16), nicht in Bruchstunden: „7,5 h“
 * ist eine Anzeige, keine Messung.
 */
const TAGE: readonly TagEntwurf[] = [
  {
    versatz: 0,
    beginn: '07:00', ende: '16:30',
    bemerkungen: 'Trockenbau Wohnung 3 begonnen, Ständerwerk Achse C bis E gestellt.',
    stunden: [
      { code: 'TRO', personen: 3, minuten: 510,
        taetigkeit: 'Ständerwerk stellen, Beplankung erste Lage', bereich: 'Wohnung 3' },
    ],
    positionen: [
      { art: 'geraet', bezeichnung: 'Bauaufzug GEDA 500 Z/ZP', menge: '1.000', einheit: 'St' },
      { art: 'lieferung', bezeichnung: 'Gipskartonbauplatte GKB 12,5 mm, 2600 × 1250',
        menge: '96.000', einheit: 'St', lieferschein: 'LS-2026-4471' },
    ],
  },
  {
    versatz: 1,
    beginn: '07:00', ende: '16:30',
    bemerkungen: 'Beplankung zweite Lage, Dämmung eingebracht.',
    vorkommnisse:
      'Beim Öffnen der Bestandsdecke Achse D wurde ein nicht dokumentierter '
      + 'Stahlunterzug angetroffen. Bauleitung des Auftraggebers vor Ort informiert.',
    stunden: [
      { code: 'TRO', personen: 3, minuten: 510,
        taetigkeit: 'Beplankung zweite Lage, Mineralwolle einbringen', bereich: 'Wohnung 3' },
      { code: 'TRO', personen: 1, minuten: 240,
        taetigkeit: 'Aufmass Achse C bis E', bereich: 'Wohnung 3' },
    ],
    positionen: [
      { art: 'vorkommnis', bezeichnung: 'Stahlunterzug Achse D angetroffen',
        beschreibung:
          'Unterzug war unter der abgehängten Bestandsdecke nicht sichtbar. '
          + 'Ausführung der Position 1.2.1 in diesem Bereich gestoppt, Nachtrag '
          + 'angekündigt.',
        uhrzeit: '10:20' },
    ],
  },
  {
    versatz: 2,
    beginn: '07:00', ende: '15:00',
    bemerkungen: 'Estrichvorbereitung, Randdämmstreifen gesetzt. '
      + 'Trockenbau Achse D ruht bis zur Entscheidung über den Nachtrag.',
    stunden: [
      { code: 'EST', personen: 2, minuten: 450,
        taetigkeit: 'Schüttung abziehen, Randdämmstreifen setzen', bereich: 'Wohnung 3 und 4' },
    ],
    positionen: [
      { art: 'lieferung', bezeichnung: 'Ausgleichsschüttung, Sackware 50 l',
        menge: '84.000', einheit: 'Sack', lieferschein: 'LS-2026-4489' },
    ],
  },
];

/**
 * Ein Berliner Wanduhr-Zeitpunkt als UTC-Instant — gerechnet von POSTGRES.
 *
 * **Ueber den KONTEXT, nicht ueber `sql`.** Der Seed haelt genau eine
 * Verbindung (`max: 1`), und diese Funktion laeuft innerhalb der offenen
 * Sitzungstransaktion. Eine zweite Abfrage auf dem Pool wartete dort auf eine
 * Verbindung, die die Transaktion selbst haelt — der Seed bliebe stehen, ohne
 * Fehler und ohne Ausgabe.
 *
 * Und gerechnet wird in der Datenbank: `07:00` in Berlin ist im Sommer 05:00
 * UTC und im Winter 06:00. Node kennt die Umstellung nicht besser als
 * Postgres, aber Postgres ist die Stelle, an der jede andere Zeit dieses
 * Systems entsteht (Invariante 2, K-11).
 */
async function berlinInstant(
  kontext: LeseKontext, tag: string, uhrzeit: string,
): Promise<string> {
  const [z] = await kontext.abfrage<{ punkt: string }>(
    `select to_char(($1::text::timestamp at time zone 'Europe/Berlin')
                      at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as punkt`,
    [`${tag} ${uhrzeit}`],
  );
  return z?.punkt ?? '';
}

export async function seedBau(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<BauErgebnis> {
  const mandantId = ids.get('bau');
  if (mandantId === undefined) throw new Error('Bereich bau fehlt');

  const [objekt] = await sql<{ id: string; kunde_id: string }[]>`
    select o.id, o.kunde_id from objekt o
     where o.mandant_id = ${mandantId} and o.archiviert_am is null
       and o.kunde_id is not null
     order by o.objektnummer limit 1`;
  if (objekt === undefined) return LEER;

  /**
   * Die Bauleitung wird ueber ihre RECHTE gesucht, und `bau.preis_lesen`
   * gehoert dazu.
   *
   * Die Auftragssumme entsteht weiter unten aus `lvSummeCent` ueber die
   * GELESENEN Zeilen, und `app.lv_preis_lesen` gibt NULL zurueck, wer das
   * Recht nicht haelt (K-05, §1.9). Ohne diese Bedingung liefe der Seed unter
   * einem Konto, das seine eigenen Preise nicht lesen darf: die Summe waere
   * null, die Zeile „unvollstaendig“, und das Projekt truege eine
   * Auftragssumme von 0,00 €, die plausibel aussieht.
   */
  const [bauleitung] = await sql<{ id: string; person_id: string | null }[]>`
    select b.id, b.person_id
      from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
      join rolle r on r.id = bm.rolle_id
     where b.status = 'aktiv' and bm.entzogen_am is null
       and exists (select 1 from rolle_berechtigung rb
                     join berechtigung be on be.id = rb.berechtigung_id
                    where rb.rolle_id = r.id and be.schluessel = 'bau.schreiben')
       and exists (select 1 from rolle_berechtigung rb
                     join berechtigung be on be.id = rb.berechtigung_id
                    where rb.rolle_id = r.id and be.schluessel = 'bau.preis_lesen')
       and exists (select 1 from rolle_berechtigung rb
                     join berechtigung be on be.id = rb.berechtigung_id
                    where rb.rolle_id = r.id and be.schluessel = 'auftrag.schreiben')
       and exists (select 1 from rolle_berechtigung rb
                     join berechtigung be on be.id = rb.berechtigung_id
                    where rb.rolle_id = r.id and be.schluessel = 'versand.freigeben')
     order by b.email limit 1`;
  if (bauleitung === undefined) return LEER;

  // LESEN ZUERST: der Auftragskreis vergaebe beim zweiten Lauf eine zweite
  // Nummer, und ein eingereichter Nachtrag bleibt eingereicht.
  const [schonDa] = await sql<{ id: string }[]>`
    select id from projekt
     where mandant_id = ${mandantId} and bezeichnung = ${PROJEKT.bezeichnung} limit 1`;
  if (schonDa !== undefined) return LEER;

  const heute = await berlinHeute(sql as unknown as TagAbfrage);
  // Montag der VERGANGENEN Woche — drei Werktage, alle in der Vergangenheit.
  const bauwoche = tagePlus(montag(heute), -7);
  const [grundlage] = await sql<{ id: string }[]>`
    select id from nachtrag_grundlage
     where mandant_id = ${mandantId} and schluessel = ${NACHTRAG.grundlage} limit 1`;

  const port = wetterPort();

  return alsPortalSitzung(sql, mandantId, bauleitung.id, async (kontext) => {
    const db = {
      abfrage: kontext.abfrage.bind(kontext),
      unsafe: async (s: string, w: readonly unknown[] = []): Promise<readonly unknown[]> =>
        kontext.schreibe<unknown>(s, w),
    };

    /* ------------------------------------------------------------------ */
    /* 1 — Auftrag, Projekt, Leistungsverzeichnis                          */
    /* ------------------------------------------------------------------ */

    /**
     * Der Auftrag entsteht DIREKT und nicht aus einem Angebot.
     *
     * `wandleInAuftrag` setzt ein Angebot mit Reinigungskalkulation voraus;
     * ein Bauauftrag entsteht aus dem LV des Auftraggebers und einer
     * Urkalkulation je Position. Die NUMMER kommt trotzdem aus dem
     * Nummernkreis (FIN-03) — er ist fuer `auftrag` bestaetigt, und eine
     * handgeschriebene Nummer waere die einzige im Bestand, die keinen Kreis
     * hinter sich hat.
     */
    const auftragsnummer = await vergebeNummer(db, { kreisTyp: 'auftrag' });
    const [auftrag] = await kontext.schreibe<{ id: string }>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                            bezeichnung, verantwortlich_benutzer_id, start_datum)
       values ($1, $2, $3, $4, 'projekt', 'aktiv', $5, $6, $7::date)
       returning id`,
      [kontext.aktiverMandantId, auftragsnummer.formatiert, objekt.kunde_id, objekt.id,
       PROJEKT.bezeichnung, bauleitung.id, bauwoche],
    );
    if (auftrag === undefined) return LEER;

    /**
     * Die Projektnummer IST die Auftragsnummer.
     *
     * // TODO(client, O-351): Nach welchem Schluessel werden Bauprojekte
     * nummeriert — ein eigener Kreis je Gesellschaft, die Auftragsnummer oder
     * eine Bauvorhabenskennung des Auftraggebers? Das Projekt IST der Auftrag
     * (§7.1, `projekt_auftrag_uk`), deshalb ist die Auftragsnummer die
     * Antwort, die am wenigsten erfindet — ein ausgedachtes Format
     * „BV-2026-001“ saehe dagegen aus wie ein bestaetigter Nummernkreis und
     * waere keiner.
     */
    const [projekt] = await kontext.schreibe<{ id: string }>(
      `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, objekt_id,
                            art, status, vertragsgrundlage, verantwortlich_benutzer_id,
                            soll_beginn, erstellt_von)
       values ($1, $2, $3, $4, $5, $6, $7::projekt_art, 'in_arbeit',
               $8::bau_vertragsgrundlage, $9, $10::date, app.aktueller_benutzer())
       returning id`,
      [kontext.aktiverMandantId, auftrag.id, auftragsnummer.formatiert, PROJEKT.bezeichnung,
       objekt.kunde_id, objekt.id, PROJEKT.art, PROJEKT.vertragsgrundlage,
       bauleitung.id, bauwoche],
    );
    if (projekt === undefined) return LEER;

    const [lv] = await kontext.schreibe<{ id: string }>(
      `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung,
                                         erstellt_von)
       values ($1, $2, 'hauptauftrag', $3, app.aktueller_benutzer())
       returning id`,
      [kontext.aktiverMandantId, projekt.id,
       `Leistungsverzeichnis Ausbau — ${PROJEKT.bezeichnung}`],
    );
    if (lv === undefined) return LEER;

    /**
     * Die Zeilen in der Reihenfolge des Entwurfs — `eltern_id` ueber die OZ.
     *
     * `pfad`, `sortier_pfad` und `ebene` werden NICHT mitgeschickt:
     * `kern.lvp_pfad_setzen` (0071) leitet alle drei vom Elternteil ab. Sie
     * hier zu rechnen waere eine zweite Fassung derselben Regel — und die
     * zweite erfuehre nie, wenn die erste sich aendert.
     */
    const nachOz = new Map<string, string>();
    for (const zeile of LV) {
      const punkt = zeile.oz.lastIndexOf('.');
      const elternOz = punkt === -1 ? null : zeile.oz.slice(0, punkt);
      const [neu] = await kontext.schreibe<{ id: string }>(
        `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, eltern_id,
                                  oz, pfad, sortier_pfad, ebene, art, positionsart,
                                  kurztext, langtext, einheit, menge_vertrag,
                                  einheitspreis_cent, erstellt_von)
         values ($1, $2, $3, $4::uuid, $5, '', '', 1, $6::lv_art, $7::lv_positionsart,
                 $8, $9, $10, $11::numeric, $12::bigint, app.aktueller_benutzer())
         returning id`,
        [
          kontext.aktiverMandantId, lv.id, projekt.id,
          elternOz === null ? null : nachOz.get(elternOz) ?? null,
          zeile.oz, zeile.art,
          /**
           * Ein Titel ist keine „Normalposition“.
           *
           * `positionsart` steht auf `unbestimmt`, wo die Zeile keine
           * Position ist — genau der Vorgabewert der Spalte. Ein Los, das als
           * Normalposition dasteht, laedt jede spaetere Auswertung dazu ein,
           * es mitzuzaehlen, und `zaehltInSumme` faengt das nur ab, weil es
           * ZUSAETZLICH auf `art` prueft.
           */
          zeile.positionsart ?? (zeile.art === 'position' ? 'normalposition' : 'unbestimmt'),
          zeile.kurztext, zeile.langtext ?? null, zeile.einheit ?? null,
          zeile.menge ?? null,
          zeile.einheitspreisCent === undefined ? null : String(zeile.einheitspreisCent),
        ],
      );
      if (neu !== undefined) nachOz.set(zeile.oz, neu.id);
    }

    /**
     * Und die Summe aus DER GELESENEN Ordnung — nicht aus dem Entwurf oben.
     *
     * `ladeLvPositionen` sortiert nach `sortier_pfad`, `baueOzBaum` baut den
     * Baum und `lvSummeCent` summiert die je Position EINMAL gerundeten
     * Betraege. Damit ist die Auftragssumme des Demoprojekts dieselbe Zahl,
     * die die Oberflaeche unter dem LV anzeigt — und nicht eine zweite, die
     * hier noch einmal gerechnet worden waere.
     */
    const gelesen = await ladeLvPositionen(kontext, lv.id);
    const baum = baueOzBaum(gelesen);
    const summe = lvSummeCent(baum);
    const ausgenommen = baum.reduce((s, k) => s + k.ausgenommen, 0);

    await kontext.schreibe(
      `update auftrag set auftragswert_netto_cent = $2 where id = $1`,
      [auftrag.id, String(summe)]);
    /**
     * Der Sicherheitseinbehalt bleibt LEER.
     *
     * // TODO(client, O-20): Welcher Sicherheitseinbehalt ist ueblich
     * vereinbart (§ 17 VOB/B), und wird er durch Buergschaft abgeloest?
     * Ebenso `gewaehrleistung_bis` — // TODO(client, O-68): Gewaehrleistungs-
     * frist je Vertragsart und ab welchem Ereignis sie laeuft. Ein geratener
     * Prozentsatz waere Geld, das jemand einbehaelt, ohne dass es vereinbart
     * ist.
     */
    await kontext.schreibe(
      `update projekt set auftragssumme_netto_cent = $2,
                          geaendert_von = app.aktueller_benutzer()
        where id = $1`,
      [projekt.id, String(summe)]);

    /* ------------------------------------------------------------------ */
    /* 2 — das Aufmassblatt                                                */
    /* ------------------------------------------------------------------ */

    const blatt = await erfasseAufmass(kontext, {
      projektId: projekt.id,
      bezeichnung: 'Trockenbau Wohnung 3 — Achse C bis E',
      bereich: 'Dachgeschoss, Wohnung 3',
      messdatum: tagePlus(bauwoche, 1),
      /**
       * GEMEINSAM aufgenommen — deshalb braucht es keine Ankuendigung.
       *
       * Ein einseitiges Aufmass setzt die angekuendigte Feststellung voraus
       * (§ 14 Abs. 2 VOB/B), und `pruefeVorlage` weist es ohne sie zurueck.
       * // TODO(client, O-156): Unter welchen Voraussetzungen wird ein
       * einseitiges Aufmass abgerechnet?
       */
      erhebungsart: 'gemeinsam',
      ankuendigungAm: null,
      zeilen: [
        ...AUFMASS_ZEILEN.map((z) => ({
          bezeichnung: z.bezeichnung,
          rechenansatz: z.rechenansatz,
          einheit: z.einheit,
          lvPositionId: nachOz.get(z.oz) ?? null,
          ausserhalbLv: false,
        })),
        {
          bezeichnung: AUSSERHALB.bezeichnung,
          rechenansatz: AUSSERHALB.rechenansatz,
          einheit: AUSSERHALB.einheit,
          lvPositionId: null,
          ausserhalbLv: true,
          bemerkung: AUSSERHALB.bemerkung,
        },
      ],
    });

    /**
     * Das Blatt bleibt ENTWURF, und das ist kein halber Seed.
     *
     * `pruefeVorlage` verlangt fuer den Uebergang `entwurf → vorgelegt`
     * mindestens ein Messfoto (BAU-03). Ein Foto entsteht nur ueber
     * `legeMediumAb` im privaten Bucket — und ohne Zugangsdaten zum
     * Medienspeicher gibt es keine Medienzeile. Eine selbst geschriebene
     * `einsatz_medien`-Zeile mit `repeat('a',64)` als Pruefsumme waere ein
     * vorgetaeuschter Beleg unter einer Gegenzeichnung, also genau das, was
     * BAU-03 verhindern soll.
     */
    const zeilen = await ladeZeilen(kontext, blatt.id);
    const ausserhalb = zeilen.find((z) => z.ausserhalb_lv);

    /* ------------------------------------------------------------------ */
    /* 3 — der Nachtrag                                                    */
    /* ------------------------------------------------------------------ */

    let nachtragsnummer: string | null = null;
    let nachtraege = 0;
    if (grundlage !== undefined) {
      const nachtrag = await meldeNachtragAn(kontext, {
        projektId: projekt.id,
        titel: NACHTRAG.titel,
        grundlageId: grundlage.id,
        begruendung: NACHTRAG.begruendung,
        // Angekuendigt am Tag des Fundes — VOR Ausfuehrungsbeginn, das ist
        // die Angabe, an der § 2 Abs. 6 Nr. 1 VOB/B haengt.
        angemeldetAm: tagePlus(bauwoche, 1),
        anordnungForm: NACHTRAG.anordnungForm,
        angeordnetVon: NACHTRAG.angeordnetVon,
      });
      nachtragsnummer = nachtrag.nummer;
      nachtraege = 1;

      // Erst die Zuordnung, dann die Einreichung: die Warnung „ausserhalb des
      // LV, ohne Nachtrag“ verschwindet nur ueber diesen Weg (BAU-05).
      if (ausserhalb !== undefined) {
        await ordneAufmasszeileZu(kontext, {
          zeileId: ausserhalb.id, nachtragId: nachtrag.id,
        });
      }

      /**
       * Und die Einreichung durch DAS Tor — mit einer Freigabe, die GENAU
       * diesen Nachtrag deckt.
       *
       * `gate()` vergleicht Aktion UND Nutzlast-Abdruck. Eine Freigabe „fuer
       * irgendetwas“ reicht seit PR 49 nicht mehr, und das ist der Punkt:
       * `nachtragNutzlast` traegt Nummer, Projekt, Titel, Grundlage und
       * Begruendung — wer den Nachtrag nach der Freigabe umschreibt, hat
       * keine mehr fuer das, was er einreicht.
       */
      const zeile = await findeNachtrag(kontext, nachtrag.id);
      if (zeile !== null) {
        const nutzlast = nachtragNutzlast(kontext.aktiverMandantId, zeile);
        const abdruck = nutzlastHash(nutzlast);

        const [freigabe] = await kontext.schreibe<{ id: string }>(
          `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                                 begruendung, erstellt_von)
           values ($1, $2, 'genehmigt', $3, now(), $4, $3)
           returning id`,
          [kontext.aktiverMandantId, nutzlast.aktion, bauleitung.id,
           'Nachtrag im Bautagesgespräch mit dem Auftraggeber abgestimmt; '
           + 'Einreichung freigegeben.'],
        );
        const [kette] = await kontext.schreibe<{
          kette_nr: string; vorheriger_hash: string;
        }>(`select * from app.freigabe_kette_ziehen($1::uuid)`,
          [kontext.aktiverMandantId]);

        if (freigabe !== undefined && kette !== undefined) {
          /**
           * Der Kettenhash aus DER GEPRUEFTEN Funktion.
           *
           * `berechneHash` ist dieselbe, mit der die Rechnungskette rechnet
           * (Invariante 4): SHA-256 ueber die Nutzlastbytes UND den
           * vorherigen Hash als rohe Bytes. Einfach `hash = nutzlast_hash` zu
           * schreiben sieht gleich aus und ist keine Kette — jedes Glied
           * liesse sich dann einzeln austauschen.
           */
          const bytes = Buffer.from(JSON.stringify(nutzlast.inhalt), 'utf8');
          await kontext.schreibe(
            `insert into freigabe_snapshot (mandant_id, freigabe_id, kette_nr, nutzlast,
                                            nutzlast_hash, vorheriger_hash, hash,
                                            entscheidung, entschieden_von)
             values ($1, $2, $3::bigint, $4::jsonb, $5, $6, $7, 'genehmigt', $8)`,
            [kontext.aktiverMandantId, freigabe.id, kette.kette_nr, nutzlast.inhalt,
             abdruck, kette.vorheriger_hash,
             berechneHash(bytes, kette.vorheriger_hash), bauleitung.id],
          );

          await reicheEin(kontext, {
            id: nachtrag.id,
            eingereichtAm: tagePlus(bauwoche, 2),
            freigabeId: freigabe.id,
          });
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* 3b — die Behinderungen (§ 6 VOB/B, BAU-06)                          */
    /* ------------------------------------------------------------------ */

    /**
     * **Angelegt wird ueber den Dienst, angezeigt wird von Hand — und das
     * hat einen Grund, der nicht Bequemlichkeit ist.**
     *
     * `erstelleBehinderung` laeuft: es zieht die Nummer je Projekt, holt die
     * Vorlage (`vob_b_6_1`, als Platzhalter gekennzeichnet) und setzt den
     * Anzeigetext aus ihr zusammen. Der Uebergang „Entwurf → angezeigt"
     * laeuft dagegen ueber `dokumentiereVersand`, und das verlangt ZWEI
     * Dinge, die im Seed nicht da sind: eine Freigabe, deren Nutzlastabdruck
     * genau diese Anzeige deckt (Invariante 7), und einen VERBUNDENEN
     * Medienspeicher, in dem das erzeugte PDF archiviert wird. Ohne
     * Zugangsdaten bricht es dort ab — wie beim Aufmass ohne Messfoto.
     *
     * Die Freigabe schreibt dieser Seed selbst (dieselbe Kette wie beim
     * Nachtrag oben, mit `freigabe_snapshot` und echtem Kettenhash). Das PDF
     * kann er nicht schreiben, also bleibt `versand_dokument_id` NULL — und
     * die Oberflaeche zeigt genau das: eine dokumentierte Anzeige ohne
     * archiviertes Schreiben. Ein selbst geschriebenes `dokument` mit
     * erfundener Pruefsumme waere der vorgetaeuschte Beleg, den CLAUDE.md
     * verbietet.
     *
     * Der Kanal ist `bauleiterprotokoll` — einer der vier MENSCHLICHEN
     * Kanaele: hier wird dokumentiert, was ein Mensch getan hat, und kein
     * Versand nachgebaut.
     */
    let behinderungen = 0;
    let behinderungenLaufend = 0;
    for (const b of BEHINDERUNGEN) {
      const angelegt = await erstelleBehinderung(kontext, {
        projektId: projekt.id,
        vorlageSchluessel: 'vob_b_6_1',
        grundKategorie: b.grundKategorie,
        ursache: b.ursache,
        beginnAm: tagePlus(bauwoche, b.versatz),
        auswirkung: b.auswirkung,
        auswirkungTage: b.auswirkungTage,
        absender: 'REALTIME Service GmbH, Bauleitung',
      });
      behinderungen += 1;
      if (b.art === 'entwurf') continue;

      /**
       * Die Nutzlast ist DIESELBE, die `dokumentiereVersand` binden wuerde —
       * mit Text und Empfaenger (`behinderungNutzlast`). Eine Freigabe „fuer
       * irgendetwas" waere hier zwar nie geprueft worden (der Seed ruft
       * `gate()` nicht), aber sie stuende dann als Beleg in der Kette, der
       * nichts deckt: der naechste Kettenpruefer haette einen Abdruck ohne
       * Gegenstand.
       */
      const roh = await findeBehinderung(kontext, angelegt.id);
      if (roh === null) continue;
      const nutzlast = behinderungNutzlast(kontext.aktiverMandantId, {
        behinderungId: angelegt.id,
        nummer: angelegt.nummer,
        projekt: `${auftragsnummer.formatiert} · ${PROJEKT.bezeichnung}`,
        empfaenger: b.empfaenger,
        versandart: 'bauleiterprotokoll',
        anzeigetext: angelegt.anzeigetext,
      });
      const abdruck = nutzlastHash(nutzlast);

      const [freigabe] = await kontext.schreibe<{ id: string }>(
        `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                               begruendung, erstellt_von)
         values ($1, $2, 'genehmigt', $3, now(), $4, $3)
         returning id`,
        [kontext.aktiverMandantId, nutzlast.aktion, bauleitung.id,
         'Behinderungsanzeige im Bautagesgespräch abgestimmt; Versand freigegeben.'],
      );
      if (freigabe === undefined) continue;

      const [kette] = await kontext.schreibe<{
        kette_nr: string; vorheriger_hash: string;
      }>(`select * from app.freigabe_kette_ziehen($1::uuid)`, [kontext.aktiverMandantId]);
      if (kette !== undefined) {
        const bytes = Buffer.from(JSON.stringify(nutzlast.inhalt), 'utf8');
        await kontext.schreibe(
          `insert into freigabe_snapshot (mandant_id, freigabe_id, kette_nr, nutzlast,
                                          nutzlast_hash, vorheriger_hash, hash,
                                          entscheidung, entschieden_von)
           values ($1, $2, $3::bigint, $4::jsonb, $5, $6, $7, 'genehmigt', $8)`,
          [kontext.aktiverMandantId, freigabe.id, kette.kette_nr, nutzlast.inhalt,
           abdruck, kette.vorheriger_hash,
           berechneHash(bytes, kette.vorheriger_hash), bauleitung.id],
        );
      }

      /**
       * **`angezeigt_am` setzt der SERVER, nicht dieser Seed.**
       *
       * Der Ausloeser `kern.behinderung_versandzeit` (0081) ueberschreibt den
       * Wert beim Uebergang mit `app.berlin_heute()` — Invariante 5: wann eine
       * Anzeige hinausgegangen ist, weiss der Server und nicht der
       * Schreibende. Deshalb steht hier `app.berlin_heute()` und kein
       * ausgedachtes Datum: ein Parameter, den der Ausloeser verwirft, sieht
       * im Code aus wie eine Angabe und ist keine.
       *
       * Die Folge fuer die Demodaten: die Anzeige traegt den Tag des
       * Saatlaufs. Der BEGINN der Behinderung liegt davor (`beginn_am`), und
       * genau dieser Abstand ist der, um den es in § 6 Abs. 1 VOB/B geht
       * („unverzueglich") — er ist eine Rechtsfrage und keine Zahl, die dieser
       * Seed festlegt.
       */
      await kontext.schreibe(
        `update behinderung
            set status = 'angezeigt',
                angezeigt_am = app.berlin_heute(),
                versandart = 'bauleiterprotokoll',
                empfaenger = $2,
                freigabe_id = $3::uuid,
                freigegeben_am = now(),
                freigegeben_von = $4::uuid,
                geaendert_von = app.aktueller_benutzer()
          where id = $1`,
        [angelegt.id, b.empfaenger, freigabe.id, bauleitung.id],
      );

      if (b.wegfallVersatz === null) {
        behinderungenLaufend += 1;
        continue;
      }
      /**
       * § 6 Abs. 3 VOB/B: der Wegfall ist ebenfalls anzuzeigen — und erst
       * diese Anzeige beendet die Behinderung, nicht das Ende der Ursache.
       *
       * Die Wegfall-Anzeige traegt `heute` und nicht ein Datum aus der
       * Vergangenheit: die ERSTE Anzeige hat der Ausloeser eben mit dem
       * heutigen Berliner Tag gestempelt, und eine Wegfall-Anzeige, die davor
       * datiert, waere eine Anzeige vor der Anzeige. Das ENDE der Ursache
       * liegt dagegen in der Vergangenheit — das ist die Tatsache, die auf der
       * Baustelle eingetreten ist, und sie ist von ihrer Anzeige zu
       * unterscheiden.
       */
      await zeigeWegfallAn(kontext, {
        id: angelegt.id,
        endeAm: tagePlus(bauwoche, b.wegfallVersatz),
        angezeigtAm: heute,
      });
    }

    /* ------------------------------------------------------------------ */
    /* 4 — das Bautagebuch                                                 */
    /* ------------------------------------------------------------------ */

    const gewerkIds = new Map<string, string>();
    for (const g of GEWERKE) {
      const [neu] = await kontext.schreibe<{ id: string }>(
        `insert into gewerk (mandant_id, code, bezeichnung, leistungsbereich, sortierung,
                             ist_platzhalter, erstellt_von_art, erstellt_von)
         values ($1, $2, $3, $4, 0, true, 'mensch', app.aktueller_benutzer())
         returning id`,
        [kontext.aktiverMandantId, g.code, g.bezeichnung, g.leistungsbereich],
      );
      if (neu !== undefined) gewerkIds.set(g.code, neu.id);
    }

    let bautage = 0;
    let mannstunden = 0;
    let tagespositionen = 0;
    let wetterBefund = 'nicht abgerufen';

    for (const tag of TAGE) {
      const datum = tagePlus(bauwoche, tag.versatz);
      const bautagId = await legeBautagAn(kontext, {
        projektId: projekt.id,
        datum,
        arbeitsbeginn: await berlinInstant(kontext, datum, tag.beginn),
        arbeitsende: await berlinInstant(kontext, datum, tag.ende),
        bemerkungen: tag.bemerkungen,
        besondereVorkommnisse: tag.vorkommnisse ?? null,
        /**
         * `wetterNotiz` bleibt LEER.
         *
         * Das Feld ist die Beobachtung eines Menschen („ab Mittag Dauerregen“).
         * „Wetterdaten nicht verfuegbar“ hineinzuschreiben machte aus dem
         * Befund der Integration eine Aussage der Bauleitung — und die Seite
         * zeigt den Befund ohnehin selbst (`leseWetterAnzeige`).
         */
      });
      bautage += 1;

      for (const s of tag.stunden) {
        const gewerkId = gewerkIds.get(s.code);
        if (gewerkId === undefined) continue;
        await hefteMannstundenAn(kontext, {
          bautagebuchId: bautagId,
          gewerkId,
          herkunft: 'eigen',
          anzahlPersonen: s.personen,
          dauerMinuten: s.minuten,
          taetigkeit: s.taetigkeit,
          bereich: s.bereich,
        });
        mannstunden += 1;
      }

      for (const p of tag.positionen) {
        await heftePositionAn(kontext, {
          bautagebuchId: bautagId,
          art: p.art,
          bezeichnung: p.bezeichnung,
          menge: p.menge ?? null,
          einheit: p.einheit ?? null,
          lieferscheinNummer: p.lieferschein ?? null,
          beschreibung: p.beschreibung ?? null,
          zeitpunkt: p.uhrzeit === undefined
            ? null
            : await berlinInstant(kontext, datum, p.uhrzeit),
        });
        tagespositionen += 1;
      }

      /**
       * Das Wetter — gefragt wird IMMER, geschrieben nur, wenn geantwortet
       * wurde.
       *
       * `hefteWetterAn` wirft nie: es gibt einen Befund zurueck, und der
       * Bautag bleibt, wie er ist (BAU-08). Hier kommt heute
       * `ohne_koordinaten` heraus — die Baustelle traegt keine Geodaten, also
       * wird die Station gar nicht erst gesucht. Der DWD selbst ist ohnehin
       * nicht verbunden; beides steht in der Schlussmeldung und wird nicht
       * ueberschrieben.
       */
      const befund = await hefteWetterAn(kontext, { bautagebuchId: bautagId }, port);
      wetterBefund = `${befund.art}: ${befund.text}`;

      /**
       * Der erste Tag wird GESCHLOSSEN, die beiden anderen bleiben offen.
       *
       * Ein abgeschlossener Bautag ist unveraenderlich; korrigiert wird durch
       * Storno und Ersatztag (BAU-07, LEG-01). Ein Bestand, in dem jeder Tag
       * offen ist, zeigt diese Kante nie — und einer, in dem jeder Tag
       * geschlossen ist, laesst die Erfassungsmaske nirgends pruefen.
       */
      if (tag.versatz === 0) await schliesseBautag(kontext, bautagId);
    }

    /* ------------------------------------------------------------------ */
    /* 6 — die Teilabnahme (§ 12 Abs. 2 VOB/B)                             */
    /* ------------------------------------------------------------------ */
    /**
     * **Eine TEILABNAHME, und das ist eine Entscheidung.**
     *
     * Eine wirksame GESAMTabnahme schlaegt `projekt.status` auf `abgenommen`
     * um (Ausloeser `kern.abnahme_projekt_status`, 0211) — das Demoprojekt
     * waere damit fertig, und Nachtrag, Behinderung und Bautagebuch stuenden
     * an einem abgenommenen Bau. Die Teilabnahme laesst den Status stehen
     * (§ 12 Abs. 2: „in sich abgeschlossene Teile der Leistung"), zeigt aber
     * genau die Kanten, um die es geht: den Leistungsumfang, die beiden
     * Vorbehalte im Wortlaut, die Mängelliste mit Fristen — und dass
     * `gewaehrleistung_bis` LEER bleibt, weil die Frist offen ist (O-154).
     *
     * `vorbehalt_vertragsstrafe` steht auf `true` und traegt seinen Wortlaut:
     * nach § 11 Abs. 4 VOB/B verfaellt der Anspruch, wenn er bei der Abnahme
     * nicht vorbehalten wird. Ein Demobestand, in dem er nie vorbehalten ist,
     * zeigte diese Kante nie — und der Bericht ueber die verfallenen
     * Ansprueche (Index `abnahme_strafe_idx`) haette nichts, wogegen er
     * pruefen kann.
     */
    const teilabnahme = await protokolliereAbnahme(kontext, {
      projektId: projekt.id,
      art: 'teilabnahme',
      // Berliner Kalendertag (K-11), nicht die Serverzeit: der Tag, an dem
      // begangen wurde. `protokolliert_am` setzt der Server daneben.
      abnahmeAm: tagePlus(bauwoche, 4),
      leistungsumfang:
        'Titel 1.2 Trockenbau, Bauabschnitt Nordseite (OZ 1.2.1 bis 1.2.8) — '
        + 'Ständerwände, Vorsatzschalen und Dachschrägenbekleidung, '
        + 'abgenommen zur Weiterarbeit der Folgegewerke.',
      abgenommen: true,
      verweigerungGrund: null,
      vorbehaltVertragsstrafe: true,
      vorbehaltMaengel: true,
      vorbehaltText:
        'Der Auftraggeber behält sich die Vertragsstrafe wegen Überschreitung der '
        + 'Zwischenfrist für den Trockenbau ausdrücklich vor (§ 11 Abs. 4 VOB/B). '
        + 'Die im Protokoll aufgeführten Mängel bleiben nach § 12 Abs. 3 VOB/B '
        + 'vorbehalten; die Abnahme des Bauabschnitts wird dadurch nicht berührt.',
      teilnehmer: [
        'REALTIME Service GmbH, Bauleitung (Auftragnehmer)',
        'Hausverwaltung Berliner Straße 42 GmbH, technische Leitung (Auftraggeber)',
        'Architekturbüro Kranz, Bauleitung Örtlichkeit (Planer)',
      ],
      maengel: [
        {
          beschreibung:
            'Anschlussfuge Dachschräge zu Giebelwand auf 6 m nicht dauerelastisch '
            + 'geschlossen; Rissbildung sichtbar.',
          fristAm: tagePlus(bauwoche, 18),
          lvPositionId: nachOz.get('1.2.7') ?? null,
        },
        {
          beschreibung:
            'Zwei Revisionsklappen im Flur sitzen nicht fluchtend; Laibung nachzuarbeiten.',
          fristAm: tagePlus(bauwoche, 25),
          lvPositionId: nachOz.get('1.2.6') ?? null,
        },
      ],
    });

    const [abnahmeStand] = await kontext.abfrage<{
      art: string; maengel: string; strafe: boolean;
    }>(
      `select a.art::text as art, a.vorbehalt_vertragsstrafe as strafe,
              (select count(*) from abnahme_mangel m where m.abnahme_id = a.id) as maengel
         from abnahme a where a.id = $1`,
      [teilabnahme.id],
    );

    /* ------------------------------------------------------------------ */
    /* 7 — der wartende LV-Import (BAU-01, O-41)                           */
    /* ------------------------------------------------------------------ */
    /**
     * **Der Import bleibt in der Vorschau — uebernommen wird er NICHT.**
     *
     * Die Uebernahme legte eine NEUE Fassung des Leistungsverzeichnisses an,
     * und die AKTUELLE Fassung waere danach diese Datei: vier Zeilen statt
     * der geseedeten 23+. Genau das zeigt die Vorschau als „Positionen der
     * aktuellen Fassung fehlen in dieser Datei" (offen, O-633) — und der
     * Demobestand bleibt damit im Zustand, den die Seite
     * `/lv/import?import=…` fuehrt: gelesen, verglichen, wartend.
     *
     * **Keine dieser Zeilen ist „maschinell gelesen".** Hier stand, jede
     * Position waere bis zu ihrer Bestaetigung ungeprueft — das stimmt fuer
     * CSV nicht: `CSV_QUELLE` setzt `konfidenz: null`, weil eine Spalte, die
     * woertlich dasteht, kein Modell geraten hat. Damit greift weder
     * `istUngeprueftMaschinell` noch das Hindernis in
     * `kern.aufmass_vorlage_pruefen()` (0072), und der Bestaetigungsweg
     * (`bestaetigeLvPosition`) trifft diese Positionen nicht. Die Sicherung
     * beginnt bei einem EXTRAHIERENDEN Leser (PDF, Bild) — der ist noch
     * nicht gebaut (O-41).
     *
     * Die vier Zeilen sind die vier Faelle, die die Vorschau unterscheidet:
     * eine unveraenderte (1.1.2), eine geaenderte Menge (1.2.5), eine neue
     * Position (1.2.13) und eine, die NICHT lesbar ist — „zwölf" ist keine
     * Menge, und die Zeile steht mit ihrem Fehler da, statt still zu fehlen.
     *
     * Das Format ist `csv_semikolon`, das einzige implementierte. Welches
     * Austauschformat die Gruppe wirklich bekommt, ist offen (O-41); die
     * Auswahl in der Oberflaeche sagt das, und dieser Seed taeuscht kein
     * GAEB vor, das niemand liest.
     */
    const importCsv = [
      'OZ;Kurztext;Positionsart;Einheit;Menge;Einheitspreis',
      '1.1.2;Fassadengerüst Hofseite, Lastklasse 3;Normalposition;m²;186,000;11,80',
      '1.2.5;Abgehängte Unterdecke F30, Flur;Normalposition;m²;52,200;98,00',
      '1.2.13;Schachtverkleidung F90 vor Abluftstrang;Normalposition;m²;18,400;142,50',
      '1.3.4;Sockelleiste Eiche, gelackt;Normalposition;m;zwölf;9,40',
    ].join('\n');

    const lvImport = await legeLvImportAn(kontext, {
      projektId: projekt.id,
      dateiname: 'LV-Ausbau-DG-Fassung-2.csv',
      format: 'csv_semikolon',
      bezeichnung: 'Leistungsverzeichnis Ausbau — Fassung 2 (Nachtrag Schacht)',
      inhalt: importCsv,
    });

    return {
      projekte: 1,
      lvZeilen: gelesen.length,
      lvSumme: formatiereGeld(summe),
      ausgenommen,
      aufmassblaetter: 1,
      aufmassZeilen: zeilen.length,
      nachtraege,
      nachtragsnummer,
      behinderungen,
      behinderungenLaufend,
      gewerke: gewerkIds.size,
      bautage,
      mannstunden,
      tagespositionen,
      wetterBefund,
      wetterVerbunden: port.verbunden,
      abnahmeArt: abnahmeStand?.art ?? null,
      abnahmeMaengel: Number(abnahmeStand?.maengel ?? 0),
      abnahmeStrafeVorbehalten: abnahmeStand?.strafe ?? false,
      lvImportZeilen: lvImport.gueltig + lvImport.fehler,
      lvImportFehler: lvImport.fehler,
    };
  }, { personId: bauleitung.person_id });
}
