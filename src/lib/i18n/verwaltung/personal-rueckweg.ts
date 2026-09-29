/**
 * Warum ein Personalformular nicht durchlief — als SATZ, nachgeschlagen nach
 * einem GRUND (V-273, D-771, D-769, D-753, D-728).
 *
 * **Der Befund.** `fuehrePersonalAus` (`api/personal/gemeinsam.ts`) schickte
 * den Satz des Dienstes als `?meldung=` auf sechs Seiten zurück — Einstellen,
 * Vertrag, Entgelt, Beenden, Stammdaten, Zusammenführen —, und jede zeigte ihn
 * roh in ihrem Warnkasten. Nach einer Beschäftigung, die es nicht mehr gab,
 * stand dort „Beschäftigung 5b0d6c1e-… gibt es in dieser Gesellschaft nicht.";
 * nach einer doppelten Personalnummer die Eingabe; nach einer Dublette ein
 * Name aus der Datenbank. Und jeder präparierte Link schrieb seine eigene
 * Systemmeldung in den Kasten.
 *
 * **Die Route schickt einen GRUND** (`?fehler=<grund>`, den `grund` der
 * Fehlerklasse), die Seite schlägt ihn hier nach — nur als eigener Eintrag
 * (`eigenerEintrag`, D-728). Ein Grund, den die Tabelle nicht kennt, bekommt
 * `sonst`: nie den Schlüssel, nie Text aus der Adresse.
 *
 * **Kein Satz trägt einen Wert aus der Adresse** (D-769 Nr. 5). Was der Satz
 * des Dienstes an Werten trug — ein Eintritts- oder Austrittsdatum, eine
 * Periode, die Nummer oder den Namen —, zeigt die Seite aus IHREN Daten: der
 * Kopf nennt den Eintritt, die Tabelle „Konditionen" die Perioden, die
 * Trefferliste den Namen. Der Satz verweist darauf oder kommt ohne den Wert
 * aus.
 *
 * **Nur Deutsch, in der Form der zweisprachigen Tabellen.** Die sechs Seiten
 * stehen auf der Ausnahmeliste der Übersetzungswache
 * (`scripts/guards/uebersetzung-ausnahmen.ts`): ihr ganzer übriger Text ist
 * deutsch, und ein englischer Satz im Warnkasten einer deutschen Seite wäre ein
 * Sprachwechsel mitten auf dem Schirm. Die Tabellen sind trotzdem nach
 * Sprache geschlüsselt wie `ENTSCHEIDUNG_FEHLER_TEXTE`: wer eine Seite
 * umstellt, ergänzt `en` und wählt mit `nachSprache`.
 */
import type { InternSprache } from '../intern.js';
import type {
  AnstellungNichtGefunden, BEENDEN_EINGABE_GRUENDE, BeendigungGrund, KONDITION_GRUENDE,
  VERTRAG_AENDERN_GRUENDE,
} from '../../../server/services/personal/anstellung.js';
import type {
  DubletteImHaus, EinstellungGrund, PersonNichtSichtbar,
} from '../../../server/services/personal/einstellung.js';
import type { PersonalnummerVergeben } from '../../../server/services/personal/personalnummer.js';
import type { BestaetigungFehlt, ZusammenfuehrenGrund } from '../../../server/services/personal/dublette.js';
import type { PersonNichtGefunden, StammdatenGrund } from '../../../server/services/personal/stammdaten.js';

export interface PersonalRueckwegTexte<G extends string> {
  /** Die fett gesetzten ersten Worte des Kastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  /** Für einen Grund, den die Tabelle nicht kennt — nie der Schlüssel selbst. */
  readonly sonst: string;
  /** Ein Satz für JEDEN Grund, den die Route dieser Seite schicken kann. */
  readonly fehler: Readonly<Record<G, string>>;
}

/** Eine Tabelle, die heute nur deutsch spricht — in der Form der zweisprachigen. */
export type NurDeutsch<T> = Readonly<Pick<Record<InternSprache, T>, 'de'>>;

/** Was `POST /api/personal/anstellungen` zurückschickt (`stelleEin`). */
export type EinstellungSeitenGrund =
  | EinstellungGrund | DubletteImHaus['grund'] | PersonNichtSichtbar['grund']
  | PersonalnummerVergeben['grund'];
/** Was `POST /api/personal/anstellungen/[id]/vertrag` zurückschickt (`aendereVertrag`). */
export type VertragSeitenGrund =
  | (typeof VERTRAG_AENDERN_GRUENDE)[number] | AnstellungNichtGefunden['grund']
  | PersonalnummerVergeben['grund'];
/** Was `POST /api/personal/anstellungen/[id]/beenden` zurückschickt (`beendeAnstellung`). */
export type BeendenSeitenGrund =
  | (typeof BEENDEN_EINGABE_GRUENDE)[number] | BeendigungGrund | AnstellungNichtGefunden['grund'];
/** Was `POST /api/personal/anstellungen/[id]/entgelt` zurückschickt (Route und `setzeKondition`). */
export type EntgeltSeitenGrund = (typeof KONDITION_GRUENDE)[number] | AnstellungNichtGefunden['grund'];
/** Was `POST /api/personal/personen/[id]/stammdaten` zurückschickt (`schreibeStammdaten`). */
export type StammdatenSeitenGrund = StammdatenGrund | PersonNichtGefunden['grund'];
/** Was `POST /api/personal/zusammenfuehren` zurückschickt (Route und `fuehreZusammen`). */
export type ZusammenfuehrenSeitenGrund = ZusammenfuehrenGrund | BestaetigungFehlt['grund'];

/** Dieselben Sätze auf zwei Seiten — einmal geschrieben, damit sie nicht auseinanderlaufen. */
const PERSONALNUMMER_PFLICHT =
  'Die Personalnummer ist Pflicht — sie ist der Schlüssel, unter dem diese Gesellschaft die '
  + 'Beschäftigung führt (eindeutig je Gesellschaft, D-09).';
const PERSONALNUMMER_VERGEBEN =
  'Diese Personalnummer ist in dieser Gesellschaft schon vergeben. Jede Gesellschaft führt ihre '
  + 'eigene Systematik (D-09) — dieselbe Nummer in der Schwestergesellschaft wäre in Ordnung, '
  + 'hier nicht.';
const EINTRITT_KALENDERTAG = 'Der Eintritt erwartet einen Kalendertag (JJJJ-MM-TT).';
const ERNEUT = 'Prüfen Sie die Angaben und senden Sie das Formular noch einmal ab.';

export const EINSTELLUNG_RUECKWEG: NurDeutsch<PersonalRueckwegTexte<EinstellungSeitenGrund>> = {
  de: {
    titel: 'Nicht angelegt.',
    sonst: ERNEUT,
    fehler: {
      personalnummer_fehlt: PERSONALNUMMER_PFLICHT,
      personalnummer_zu_lang: 'Die Personalnummer fasst 40 Zeichen.',
      personalnummer_vergeben: PERSONALNUMMER_VERGEBEN,
      eintritt_ungueltig: EINTRITT_KALENDERTAG,
      kein_mensch_gewaehlt:
        'Es ist kein Mensch gewählt. Suchen Sie zuerst — eine Beschäftigung ohne Menschen gibt '
        + 'es nicht (D-09).',
      name_fehlt: 'Vorname und Nachname sind Pflicht.',
      name_zu_lang: 'Vorname und Nachname fassen je 80 Zeichen.',
      sprache_ungueltig:
        'Die Sprache ist eine der vier aus der Auswahl: Deutsch, Englisch, Arabisch oder '
        + 'Türkisch (EMP-12).',
      telefon_zu_lang: 'Die Telefonnummer fasst 40 Zeichen.',
      person_zusammengefuehrt:
        'Der gewählte Mensch ist eine zusammengeführte Zeile und zeigt auf einen anderen '
        + 'Datensatz. Stellen Sie den führenden Menschen ein — sonst hängt die Beschäftigung an '
        + 'einer Zeile, die keine Auswertung mehr als diesen Menschen liest.',
      person_nicht_sichtbar:
        'Dieser Mensch ist von dieser Gesellschaft aus nicht sichtbar. Ein Mensch gehört keiner '
        + 'einzelnen Gesellschaft (D-09) — sichtbar ist er hier, weil er hier beschäftigt ist.',
      dublette_im_haus:
        'Ein Mensch mit diesem Namen wird in dieser Gesellschaft bereits geführt. Eine zweite '
        + 'Personenzeile für denselben Menschen ist keine zweite Beschäftigung, sondern eine '
        + 'Dublette (D-09) — sie zerlegt später die Arbeitszeitgrenzen, die je Mensch gelten '
        + '(Invariante 9). Wählen Sie die vorhandene Zeile aus der Trefferliste; nur wenn es '
        + 'wirklich zwei Menschen sind, legen Sie eine zweite an — dann mit dem Vornamen, der '
        + 'sie unterscheidet.',
    },
  },
};

export const VERTRAG_RUECKWEG: NurDeutsch<PersonalRueckwegTexte<VertragSeitenGrund>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: ERNEUT,
    fehler: {
      personalnummer_fehlt: PERSONALNUMMER_PFLICHT,
      personalnummer_vergeben: PERSONALNUMMER_VERGEBEN,
      eintritt_ungueltig: EINTRITT_KALENDERTAG,
      eintritt_nach_austritt:
        'Der Eintritt läge nach dem Austritt, der unten unter „Nicht hier zu ändern" steht. '
        + 'Erst das Austrittsdatum korrigieren, dann den Eintritt.',
      nicht_gefunden:
        'Diese Beschäftigung ist in dieser Gesellschaft nicht mehr da — die Seite zeigt den '
        + 'aktuellen Stand.',
    },
  },
};

export const BEENDEN_RUECKWEG: NurDeutsch<PersonalRueckwegTexte<BeendenSeitenGrund>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: ERNEUT,
    fehler: {
      austritt_ungueltig: 'Der Austritt erwartet einen Kalendertag (JJJJ-MM-TT).',
      grund_fehlt:
        'Eine Beendigung ohne Begründung ist kein Vorgang, sondern ein Klick. Der Grund steht '
        + 'später in der Personalakte und in jeder Rückfrage.',
      bereits_beendet:
        'Diese Beschäftigung ist bereits beendet — eine Beendigung wird nicht überschrieben. '
        + 'Die Seite zeigt den aktuellen Stand.',
      austritt_vor_eintritt:
        'Der Austritt läge vor dem Eintritt, den der Kopf dieser Seite nennt. Der letzte '
        + 'Arbeitstag liegt nie vor dem ersten.',
      nicht_gefunden:
        'Diese Beschäftigung wurde inzwischen beendet, oder sie ist in dieser Gesellschaft '
        + 'nicht mehr da — die Seite zeigt den aktuellen Stand.',
    },
  },
};

export const ENTGELT_RUECKWEG: NurDeutsch<PersonalRueckwegTexte<EntgeltSeitenGrund>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: ERNEUT,
    fehler: {
      betrag_ungueltig:
        'Der Stundensatz ist kein Eurobetrag in deutscher Schreibweise. Erwartet wird etwa '
        + '„17,50" — Komma vor den Cent, Punkt für die Tausender.',
      gilt_ab_ungueltig: '„Gilt ab" erwartet einen Kalendertag (JJJJ-MM-TT).',
      satz_negativ: 'Ein negativer Stundensatz ist kein Kostensatz.',
      /* Die Grenzen sind die der Datenbank (`KONDITION_GRENZEN`, 0192). */
      wochenstunden_ungueltig:
        'Die Wochenstunden sind eine Zahl von 0 bis 168 mit höchstens drei '
        + 'Nachkommastellen — etwa „38,5". Leer lassen heisst „nicht hinterlegt".',
      arbeitstage_ungueltig:
        'Die Arbeitstage pro Woche sind eine Zahl von 0 bis 7 mit höchstens drei '
        + 'Nachkommastellen — etwa „5" oder „4,5". Leer lassen heisst „nicht hinterlegt".',
      vor_eintritt:
        'Eine Kondition kann nicht vor dem Eintritt gelten, den der Kopf dieser Seite nennt.',
      periode_belegt:
        'Für diesen Tag gilt bereits eine abgeschlossene Kondition — ihren Zeitraum zeigt die '
        + 'Tabelle „Konditionen". Zwei gleichzeitig gültige Sätze wären die Frage, welcher gilt. '
        + 'Eine rückwirkende Korrektur schliesst zuerst die betroffene Periode — sie wird nicht '
        + 'überschrieben und nicht gelöscht (Invariante 8).',
      nicht_nach_laufender:
        'Eine neue Kondition muss später beginnen als die laufende — die steht in der Tabelle '
        + '„Konditionen" mit „offen". Zwei gleichzeitig gültige Sätze wären die Frage, welcher '
        + 'gilt, und jede Abfrage beantwortete sie anders.',
      nicht_gefunden:
        'Diese Beschäftigung ist in dieser Gesellschaft nicht mehr da — die Seite zeigt den '
        + 'aktuellen Stand.',
    },
  },
};

export const STAMMDATEN_RUECKWEG: NurDeutsch<PersonalRueckwegTexte<StammdatenSeitenGrund>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: ERNEUT,
    fehler: {
      geburtsdatum_ungueltig: 'Das Geburtsdatum erwartet einen Kalendertag (JJJJ-MM-TT).',
      staat_ungueltig:
        'Die Staatsangehörigkeit erwartet den zweibuchstabigen Ländercode nach ISO 3166-1 '
        + 'alpha-2 — „DE", „TR", „SY". Das ist die Form, in der das Bewacherregister sie '
        + 'verlangt (SEC-03).',
      nicht_gefunden:
        'Die Stammdaten eines Menschen pflegt eine Gesellschaft, bei der er beschäftigt ist — '
        + 'von hier aus liess sich diese Zeile nicht ändern. Die Seite zeigt den aktuellen Stand.',
    },
  },
};

/**
 * Was das Blatt einer Beschäftigung nach einem ERFOLG sagt (D-771 Nachtrag).
 *
 * Einstellen schickt seit jeher `?eingestellt=1`, und keine Seite las es:
 * nach dem Anlegen kam das Blatt der neuen Beschäftigung ohne ein Wort.
 * Vertrag und Beenden führten auf dasselbe Blatt ganz ohne Parameter. Jetzt
 * schicken sie einen Schlüssel (`?erfolg=`), und das Blatt schlägt ihn hier
 * nach — nur als eigener Eintrag; ein unbekannter Schlüssel zeigt nichts.
 */
export const ANSTELLUNG_ERFOLG_SCHLUESSEL = [
  'eingestellt', 'vertrag_gespeichert', 'beendigung_eingetragen',
] as const;
export type AnstellungErfolg = (typeof ANSTELLUNG_ERFOLG_SCHLUESSEL)[number];

/** Ein Erfolg: die fett gesetzten ersten Worte und der Satz dahinter (DESIGN §5 „Notices"). */
export interface ErfolgSatz {
  readonly titel: string;
  readonly satz: string;
}

export const ANSTELLUNG_ERFOLG: NurDeutsch<Readonly<Record<AnstellungErfolg, ErfolgSatz>>> = {
  de: {
    eingestellt: {
      titel: 'Eingestellt.',
      satz: 'Angelegt sind die Vertragseckdaten. Stundensatz, Arbeitszeitmodell und '
        + 'Wochenstunden folgen als datierte Kondition auf der Seite „Entgelt"; der '
        + 'Portalzugang ist ein eigener Schritt (EMP-01).',
    },
    vertrag_gespeichert: {
      titel: 'Vertragseckdaten gespeichert.',
      satz: 'Personalnummer und Eintritt stehen unten so, wie sie jetzt gelten.',
    },
    beendigung_eingetragen: {
      titel: 'Beendigung eingetragen.',
      satz: 'Der Austritt steht unten. Der Status wechselt auf „beendet", sobald der letzte '
        + 'Arbeitstag vorbei ist — erst dann erlischt der abgeleitete Portalzugang (K-14).',
    },
  },
};

export const ZUSAMMENFUEHREN_RUECKWEG:
NurDeutsch<PersonalRueckwegTexte<ZusammenfuehrenSeitenGrund>> = {
  de: {
    titel: 'Nicht zusammengeführt.',
    sonst: 'Prüfen Sie die Auswahl und die Angaben und senden Sie das Formular noch einmal ab.',
    fehler: {
      keine_auswahl: 'Es müssen zwei Datensätze gewählt sein: der veraltete und der führende.',
      dieselbe_zeile:
        'Ein Mensch ist keine Dublette von sich selbst — gewählt war zweimal derselbe Datensatz.',
      grund_fehlt: 'Eine Zusammenführung ohne Begründung ist kein Vorgang, sondern ein Klick.',
      fuehrend_nicht_sichtbar: 'Die führende Zeile ist in dieser Gesellschaft nicht sichtbar.',
      bestaetigung_falsch:
        'Die getippte Bestätigung stimmt nicht mit dem Nachnamen der führenden Zeile überein. '
        + 'Eine Zusammenführung ist nicht mit einem Klick rückgängig zu machen — deshalb wird '
        + 'sie getippt.',
      /* Die Abweisungen der Datenbank (0194), als Satz statt als 500 (D-771 Nachtrag). */
      nicht_beide_hier:
        'Beide Datensätze müssen in dieser Gesellschaft beschäftigt sein. Liegt die zweite '
        + 'Beschäftigung bei einer Schwestergesellschaft, ist die Zusammenführung offen '
        + '(O-611) — sie entschiede über einen Menschen, den diese Gesellschaft nicht führt.',
      bereits_zusammengefuehrt:
        'Der veraltete Datensatz ist inzwischen schon zusammengeführt — eine Zusammenführung '
        + 'wird nicht überschrieben (Invariante 8). Die Seite zeigt den aktuellen Stand.',
      fuehrend_zusammengefuehrt:
        'Die gewählte führende Zeile ist selbst schon zusammengeführt. Ein Verweis reicht '
        + 'genau einen Schritt weit — sonst läse eine Auswertung, die der Kette nicht folgt, '
        + 'die mittlere Zeile als führend.',
      dublette_ist_fuehrend:
        'Auf die veraltete Zeile zeigt bereits eine andere Dublette; sie ist damit selbst eine '
        + 'führende Zeile und kann nicht zusammengeführt werden. Führen Sie zuerst beide '
        + 'Dubletten auf dieselbe Zeile.',
    },
  },
};
