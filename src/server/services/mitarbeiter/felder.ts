/**
 * Die festgeschriebenen Feldlisten des Mitarbeiterportals — K-05 und EMP-13
 * als PRUEFBARE Eigenschaft.
 *
 * **Warum eine Liste und keine Stichprobe.** Die naheliegende Abnahme sucht in
 * der Antwort nach dem Wort „stundensatz" und ist zufrieden, wenn sie es nicht
 * findet. Sie findet ein Feld namens `satz` nicht, kein `kondition`, kein
 * `tarif` und vor allem kein durchgereichtes `anstellung`-Objekt, das den
 * Stundensatz als verschachtelten Wert traegt. Deshalb wird hier die
 * ERLAUBTE Gestalt festgeschrieben: der Test vergleicht die Schluessel jeder
 * Nutzlast gegen ihre Liste, und ein neues Feld faellt auf, bevor es
 * ausgeliefert wird — auch eines mit einem harmlosen Namen.
 *
 * Die zweite Linie steht ohnehin schon und ist die staerkere:
 * `anstellung.stundensatz_intern` und `tarifgruppe` sind `cse_app` gar nicht
 * erst gegrantet (K-05, Spaltenprivilegien statt maskierender Sichten), und
 * der einzige Weg zum Entgelt ist `app.anstellung_entgelt_lesen` — `security
 * definer`, verlangt `personal.entgelt_lesen` und schreibt eine Auditzeile.
 * Die Rolle `mitarbeiter` haelt dieses Recht nicht.
 *
 * **Auch der EIGENE Lohnsatz steht deshalb nicht im Portal.** Das ist eine
 * Entscheidung und keine Luecke: er steht im Arbeitsvertrag und in der
 * Lohnabrechnung, die ein Lohnsystem erzeugt (D-06). Ihn hier zu zeigen
 * verlangte, `cse_app` die Spalte zu oeffnen — und damit die Linie zu
 * durchbrechen, die verhindert, dass eine Planerin der Reinigung den Satz der
 * Security sieht (D-09 §6).
 */
import { ANSTELLUNG_FELDER } from './person.js';
import { SCHICHT_FELDER } from './schichten.js';
import { STUNDEN_FENSTER_FELDER, KONTO_ANSICHT_FELDER, URLAUB_ANSICHT_FELDER }
  from './stunden.js';
import { ZEITEINTRAG_FELDER } from './zeiten.js';
import { EIGENER_NACHWEIS_FELDER, EIGENE_NACHWEISLAGE_FELDER } from './nachweise.js';
import { EIGENER_ANTRAG_FELDER, EIGENE_ABWESENHEIT_FELDER } from './antraege.js';
import { SCHICHT_NACHWEIS_FELDER } from './nachweis-schicht.js';
import { SCHICHT_MEDIUM_FELDER } from './medien.js';
import { SCHICHT_KONTROLLPUNKT_FELDER } from './schichtbuch.js';
import { MEIN_DOKUMENT_FELDER } from './dokumente.js';
import { EIGENES_OBJEKT_FELDER, OBJEKT_ZUGANG_FELDER } from './objekte.js';
import { TAUSCHBARE_SCHICHT_FELDER } from './tausch.js';

/**
 * Jede Nutzlast, die das Mitarbeiterportal einer Seite gibt, mit ihrer
 * erlaubten Feldmenge.
 */
export const MITARBEITER_NUTZLASTEN: Readonly<Record<string, readonly string[]>> = {
  anstellung: ANSTELLUNG_FELDER,
  schicht: SCHICHT_FELDER,
  stundenFenster: STUNDEN_FENSTER_FELDER,
  kontoAnsicht: KONTO_ANSICHT_FELDER,
  urlaubAnsicht: URLAUB_ANSICHT_FELDER,
  zeiteintrag: ZEITEINTRAG_FELDER,
  nachweis: EIGENER_NACHWEIS_FELDER,
  nachweislage: EIGENE_NACHWEISLAGE_FELDER,
  antrag: EIGENER_ANTRAG_FELDER,
  abwesenheit: EIGENE_ABWESENHEIT_FELDER,
  /*
   * Die Nutzlasten der vier Schichtseiten (0300–0304). Sie fehlten hier, und
   * damit prueften WEDER die Wortprobe noch der Feldvergleich sie — still,
   * denn nichts zaehlte die `*_FELDER`-Exporte auf. Genau dagegen ist diese
   * Liste laut ihrem Kopfkommentar gebaut. `tests/kern/mitarbeiter.test.ts`
   * haelt jetzt zusaetzlich jeden Export unter `services/mitarbeiter/` gegen
   * diese Schluessel, damit sich die Luecke beim naechsten Dienst nicht
   * wiederholt.
   */
  schichtNachweis: SCHICHT_NACHWEIS_FELDER,
  schichtMedium: SCHICHT_MEDIUM_FELDER,
  schichtKontrollpunkt: SCHICHT_KONTROLLPUNKT_FELDER,
  /*
   * Die Nutzlasten von `/portal/mein/dokumente` und `/portal/mein/objekte`
   * (0360, 0361). `dokument` und `objekt` sind die zwei Tabellen, an denen im
   * Mitarbeiterportal am meisten haengt, was dort NICHT hingehoert: `kunde_id`
   * am Dokument, `zutritt_hinweis` und `bemerkung` am Objekt. Die erste Linie
   * dagegen sind Policies und Spaltenrechte; diese Listen sind die zweite.
   */
  meinDokument: MEIN_DOKUMENT_FELDER,
  eigenesObjekt: EIGENES_OBJEKT_FELDER,
  objektZugang: OBJEKT_ZUGANG_FELDER,
  /*
   * Die Schichtauswahl des Antragsformulars (V-187). Sie zeigt eigene
   * kommende Schichten — Gesellschaft, Tag, Uhrzeit, Objekt; kein Kunde,
   * kein Auftrag.
   */
  tauschbareSchicht: TAUSCHBARE_SCHICHT_FELDER,
};

/**
 * Woerter, die in einer Mitarbeiter-Nutzlast nichts zu suchen haben.
 *
 * Sie sind die ZWEITE Probe, nicht die erste: die Feldlisten oben sind die
 * Zusage, diese Liste faengt den Fall ab, dass jemand eine Liste erweitert,
 * ohne zu merken, was er hineinlaesst. Beide zusammen sind mehr als jede
 * einzeln — die Liste sieht ein neues Feld, das Muster sieht ein falsches.
 *
 * **Verglichen werden WOERTER, nicht Zeichenketten**, und das ist kein
 * Feinschliff: „satz" steckt als Teilkette in `einsatzId`, `zusatzTage`,
 * `blockiertEinsatz` und `rechenansatz` — vier voellig harmlose Felder. Eine
 * Wache mit vier Falschtreffern wird nach dem zweiten Mal abgeschaltet, und
 * dann faellt der echte Treffer mit durch. Der Name wird deshalb an
 * Binnengrossschreibung und Unterstrichen zerlegt und Wort fuer Wort
 * verglichen.
 */
export const GELD_WOERTER: readonly string[] = [
  'stundensatz', 'satz', 'tarif', 'tarifgruppe', 'entgelt', 'lohn', 'gehalt',
  'preis', 'einzelpreis', 'gesamtpreis', 'betrag', 'cent', 'marge', 'umsatz',
  'kondition', 'kunde', 'kunden', 'rechnung', 'angebot', 'kalkulation',
];

/**
 * `netto` und `brutto` allein sagen nichts — sie brauchen ihre EINHEIT.
 *
 * Eine Schicht hat brutto und netto, und zwar in Minuten; eine Rechnung hat
 * sie in Cent. Erlaubt ist das Feld deshalb genau dann, wenn eine Zeiteinheit
 * danebensteht.
 */
export const MENGEN_WOERTER: readonly string[] = ['netto', 'brutto'];

export const ZEIT_EINHEITEN: readonly string[] = [
  'minuten', 'minute', 'stunden', 'sekunden', 'sek', 'tage', 'tag',
];

/** `anteilBruttoMinuten` → `['anteil', 'brutto', 'minuten']`. */
export function feldWoerter(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[\s_\-]+/u)
    .map((w) => w.toLowerCase())
    .filter((w) => w !== '');
}

/**
 * Klingt dieses Feld nach Geld — oder nach einer Zahl ohne Einheit?
 *
 * Verglichen wird Wort fuer Wort, und ein Wort zaehlt auch dann, wenn es das
 * BESTIMMUNGSWORT eines zusammengeschriebenen Kompositums ist:
 * `rechnungsnummer` und `kundennummer` sind ein Wort und trotzdem Geld- und
 * Kundendaten. Der Anfang genuegt dafuer und die Mitte nicht — `einsatz` faengt
 * nicht mit `satz` an, `zusatz` auch nicht, und genau das ist der Unterschied,
 * an dem die erste Fassung dieser Wache vier Falschtreffer produzierte.
 */
export function istVerbotenesFeld(name: string): boolean {
  const woerter = feldWoerter(name);
  if (woerter.some((w) => GELD_WOERTER.some((g) => w === g || w.startsWith(g)))) return true;
  if (woerter.some((w) => MENGEN_WOERTER.includes(w))
      && !woerter.some((w) => ZEIT_EINHEITEN.includes(w))) {
    return true;
  }
  return false;
}
