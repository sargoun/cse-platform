/**
 * `/[mandant]/finanzen/belege`, `/belege/[id]`, `/finanzen/ausgaben` und
 * `/ausgaben/[id]` — in beiden Sprachen.
 *
 * **Vier Blaetter, eine Datei.** Der Schnitt laeuft entlang der Teilflaeche
 * und nicht entlang des Bildschirms: Belegarchiv und Ausgaben teilen sich den
 * ganzen Kern ihres Wortschatzes — `Beleg`, `Belegnummer`, `Brutto`,
 * `Aufbewahrung`, `Löschsperre`, „ohne Beleg keine Freigabe". Dasselbe Wort
 * an vier Stellen ist vier Gelegenheiten, es beim naechsten Mal nur an drei
 * davon zu aendern. Die Ausgaben stehen hier und nicht in einer eigenen
 * Datei, weil eine Ausgabe ohne ihren Beleg gar nicht freigegeben wird
 * (ACC-03) — die beiden Flaechen sind eine.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`). `Beleg`, `Umsatzsteuer`, `Storno`, `Anstellung`,
 * `Lastschrift`, `Kasse`, `Kassenbuch`, `Buchungsbeleg`, `Handelsbrief`,
 * `Gutschrift` und `Gegenbuchung` tragen Rechtsbedeutung (AO, UStG, GoBD,
 * HGB, EStG). Im Englischen steht der deutsche Begriff und DANEBEN eine kurze
 * Erklaerung in Klammern — nie eine erfundene Entsprechung. Ein englisches
 * „receipt" ALLEIN bezeichnete nicht mehr den Nachweis des §147 AO, sondern
 * den Kassenzettel; und ein „credit note" fuer eine `Gutschrift` waere nach
 * §14 Abs. 2 UStG sogar das Gegenteil des Gemeinten. Die Erklaerung steht
 * einmal je Blatt, dort wo Platz ist (Titel, Leerzustand, Fliesstext) — in
 * einem Spaltenkopf steht der blosse Begriff, weil ein Kopf kein Ort fuer
 * eine Klammer ist.
 *
 * **Die Zustaende sind Schluessel und wandern nie.** `erfasst`,
 * `freigegeben`, `gebucht`, `abgelehnt` sind die Werte des Enums aus 0180,
 * `ausgangsrechnung`…`sonstiges` die des Enums `beleg_typ` und
 * `upload`…`erzeugt` die des Enums `beleg_quelle`. Uebersetzt wird nur, was
 * daneben auf dem Bildschirm steht; die Pille waehlt ihre Farbe weiter ueber
 * ihren deutschen `zustand` (DESIGN §5) und uebersetzt ihre Beschriftung
 * selbst.
 *
 * **Warum hier Satzbruchstuecke stehen.** Mehrere Saetze dieser Blaetter
 * tragen eine Zahl, ein Datum, einen Hash, einen Spalten- oder einen
 * Rechtenamen MITTEN im Satz. Ein Bruchstueck mit fuehrendem Leerzeichen
 * (`' Belege tragen keine Aufbewahrungsfrist.'`) ist deshalb Absicht und kein
 * Tippfehler: das eingesetzte Stueck steht davor. Wo der englische Satz an
 * dieser Stelle anders gebaut ist, steht die Fuge anderswo — der Satz muss
 * auf Englisch richtig sein, nicht gleich gebaut.
 *
 * **Spalten-, Rechte-, Index- und Ereignisnamen stehen NICHT hier.** Sie
 * lauten in beiden Sprachen gleich; sie stehen als Konstante im Seitenrumpf,
 * wo eine zweite Spalte nur eine Erfindung waere.
 *
 * **Die offenen Fragen bleiben Fragen.** O-05 (Aufwandskategorien und ihre
 * SKR-Abbildung), O-46 (die Aufbewahrungsfrist je Belegklasse), O-185
 * (belegfrei buchen) und O-186 (TSE nach §146a AO) stehen in beiden Sprachen
 * als offen da. Der englische Text nennt dieselbe Nummer und behauptet
 * nirgends eine Antwort, die der deutsche nicht gibt.
 */
import type { InternSprache } from '../../intern.js';

/** Die Werte des Enums `beleg_typ` (0121). */
type BelegTypSchluessel =
  | 'ausgangsrechnung' | 'eingangsrechnung' | 'gutschrift' | 'kassenbeleg'
  | 'bankbeleg' | 'vertrag' | 'sonstiges';

/** Die Werte des Enums `beleg_quelle` — fuenf, nicht vier. */
type BelegQuelleSchluessel = 'upload' | 'email' | 'scan' | 'api' | 'erzeugt';

/** Die Werte des Enums `ausgabe_status` (0180). */
type AusgabeStatusSchluessel = 'erfasst' | 'freigegeben' | 'gebucht' | 'abgelehnt';

/** Die Werte des Enums `zahlungsmittel`, soweit eine Ausgabe sie fuehrt. */
type ZahlungsmittelSchluessel =
  | 'ueberweisung' | 'lastschrift' | 'bar' | 'karte' | 'verrechnung';

/** Die vier Dinge, die sich auf einen Beleg berufen koennen. */
type VerwendungSchluessel =
  | 'eingangsrechnung' | 'ausgabe' | 'buchungssatz' | 'rechnung';

export interface BelegeTexte {
  /* ── Was auf mehreren der vier Blaetter steht ──────────────────────── */

  /**
   * Der blosse Begriff, wie er in einen Spaltenkopf und auf eine
   * Feldbeschriftung passt. Die Erklaerung steht im Fliesstext daneben —
   * ein Kopf ist kein Ort fuer eine Klammer.
   */
  readonly beleg: string;
  readonly alle: string;
  readonly anzeigen: string;
  readonly jahr: string;
  /** Vor „MM/JJJJ" — der Monatsfilter aus den Monatszahlen (V-215). */
  readonly belegdatumImMonat: string;
  readonly alleZeigen: string;
  readonly netto: string;
  readonly brutto: string;
  readonly ust: string;
  readonly kategorie: string;
  readonly ohneNummer: string;
  readonly belegnummer: string;
  readonly belegdatum: string;

  /** Die Anfuehrungszeichen — deutsch „…", englisch "…". */
  readonly zitatAuf: string;
  readonly zitatZu: string;

  /* ── Blatt 1: das Belegarchiv ──────────────────────────────────────── */
  readonly titel: string;
  readonly typ: string;
  readonly quelle: string;
  readonly belegeImArchiv: string;
  readonly mitLoeschsperre: string;
  readonly fristOffen: string;
  readonly jeTyp: string;
  readonly einBelegOhneFrist: string;
  /** Bruchstueck: die Anzahl steht davor. */
  readonly belegeOhneFrist: string;
  readonly fristOffenErklaerung: string;
  readonly keinBelegZumFilter: string;
  readonly keinBelegImArchiv: string;
  readonly tabelleListe: string;
  readonly seiten: string;
  readonly eingegangen: string;
  readonly aufbewahrung: string;
  readonly loeschsperre: string;
  readonly keineSperre: string;
  /**
   * Die Praeposition vor dem Fristdatum — nicht der Spaltenkopf „Bis" aus
   * `basis.ts`. Auf Englisch sind es zwei verschiedene Woerter: eine Spalte
   * heisst `To`, ein Datum steht `until 31.12.2035`.
   */
  readonly bisZum: string;
  readonly listeFussnoteVor: string;
  readonly listeFussnoteNach: string;

  readonly typNamen: Readonly<Record<BelegTypSchluessel, string>>;
  readonly quelleNamen: Readonly<Record<BelegQuelleSchluessel, string>>;

  /* ── Blatt 2: der einzelne Beleg ───────────────────────────────────── */
  readonly belegTitel: string;
  readonly belegOhneNummer: string;
  readonly bruttoNurZurSuche: string;
  readonly eingegangenBerlin: string;
  readonly sha256Erklaerung: string;
  readonly dieDatei: string;
  readonly keineDokumentversionVor: string;
  readonly keineDokumentversionMitte: string;
  readonly keineDokumentversionNach: string;
  readonly hashAbweichungTitel: string;
  readonly belegBezeugt: string;
  readonly versionTraegt: string;
  readonly hashAbweichungNach: string;
  readonly neuereVersionVor: string;
  readonly neuereVersionMitte: string;
  readonly neuereVersionNach: string;
  readonly titelFeld: string;
  readonly version: string;
  readonly formatUndGroesse: string;
  readonly dokumentGeloeschtVor: string;
  readonly dokumentGeloeschtNach: string;
  readonly belegOeffnen: string;
  readonly signierteUrlHinweis: string;
  readonly diesemKontoFehlt: string;
  readonly dateiBleibtZu: string;
  readonly klasse: string;
  readonly loeschsperreAktiv: string;
  readonly keineLoeschsperre: string;
  readonly fristOffenLang: string;
  readonly aufzubewahrenBis: string;
  readonly jahreAbBelegdatum: string;
  readonly regelUnbestaetigt: string;
  readonly woranDieserBelegHaengt: string;
  readonly keineVerwendung: string;
  readonly tabelleVerwendung: string;
  readonly belegOderText: string;
  readonly zugriffeTitel: string;
  readonly keineZugriffe: string;
  readonly tabelleZugriffe: string;
  readonly zeitpunkt: string;
  readonly konto: string;
  readonly belegFussnoteVor: string;
  readonly belegFussnoteNach: string;
  readonly zumGobdArchiv: string;

  readonly verwendungNamen: Readonly<Record<VerwendungSchluessel, string>>;

  /* ── Blatt 3: die Ausgabenliste ────────────────────────────────────── */
  readonly ausgabenTitel: string;
  readonly nurWeiterberechenbar: string;
  /** Filter wie die Spalte „Betriebsausgaben" der Monatszahlen (V-217). */
  readonly nurAufwand: string;
  readonly unbestaetigtKlammer: string;
  readonly summenJeZustand: string;
  readonly gezaehltInDatenbank: string;
  readonly einAusgabeOhneBeleg: string;
  /** Bruchstueck: die Anzahl steht davor. */
  readonly ausgabenOhneBeleg: string;
  readonly ohneBelegErklaerung: string;
  readonly belegfreiNichtVorgesehen: string;
  readonly tseOffen: string;
  readonly kategoriePlatzhalterVor: string;
  readonly kategoriePlatzhalterBetont: string;
  readonly kategoriePlatzhalterNach: string;
  readonly keineAusgabeZumFilter: string;
  readonly keineAusgabeErfasst: string;
  readonly tabelleAusgaben: string;
  readonly unbestaetigtO05: string;
  readonly auftrag: string;
  readonly belegFehltDarfNichtSein: string;
  readonly nochKeiner: string;
  readonly weiterberechenbarJa: string;
  readonly weiterberechenbarNein: string;
  readonly erstattungSuffix: string;
  readonly ausgabenFussnoteVor: string;
  readonly ausgabenFussnoteNach: string;

  /**
   * Der Zustand ausgeschrieben, wie er neben der Pille steht. Zwei Saetze,
   * weil das Blatt bei `gebucht` mehr sagt als die Liste: dort steht, dass
   * die Zeile ab hier unveraenderlich ist.
   */
  readonly zustandListe: Readonly<Record<AusgabeStatusSchluessel, string>>;
  readonly zustandBlatt: Readonly<Record<AusgabeStatusSchluessel, string>>;

  /**
   * Das Zahlungsmittel — zweimal, aus demselben Grund: die Liste nennt die
   * Kasse knapp, das Blatt sagt, dass das Geld aus ihr kam.
   */
  readonly zahlungsmittelListe: Readonly<Record<ZahlungsmittelSchluessel, string>>;
  readonly zahlungsmittelBlatt: Readonly<Record<ZahlungsmittelSchluessel, string>>;

  /* ── Blatt 4: die einzelne Ausgabe ─────────────────────────────────── */
  readonly ausgabeTitel: string;
  readonly ausgabedatum: string;
  readonly unbestaetigtStrich: string;
  readonly bezahltMit: string;
  readonly umsatzsteuer: string;
  readonly weiterberechenbar: string;
  readonly jaFin07: string;
  readonly nein: string;
  readonly belegFehltInDiesemZustand: string;
  readonly zurueckgewiesenVor: string;
  readonly zurueckgewiesenNach: string;
  readonly ohneBelegKeineFreigabe: string;
  readonly ohneBelegErzwungenVor: string;
  readonly freigegebenWort: string;
  readonly ohneBelegErzwungenNach: string;
  readonly steuerJeGruppeTitel: string;
  readonly gebuchtOhneAufteilung: string;
  readonly nochKeineAufteilung: string;
  readonly keinSatzZurueckgerechnetVor: string;
  readonly keinBetont: string;
  readonly keinSatzZurueckgerechnetNach: string;
  readonly tabelleSteuerzeilen: string;
  readonly steuersatzgruppe: string;
  readonly satz: string;
  readonly en16931Kategorie: string;
  readonly zeilensumme: string;
  readonly nettoSchraeg: string;
  readonly steuerKopf: string;
  readonly stimmenUeberein: string;
  readonly weichenAb: string;
  readonly erstattungTitel: string;
  readonly keineErstattung: string;
  readonly keineAngabeErstattungVor: string;
  readonly keineAngabeErstattungNach: string;
  readonly erstattetAnAnstellung: string;
  readonly ohnePersonalnummer: string;
  readonly erstattungAnAnstellungVor: string;
  readonly erstattungAnAnstellungNach: string;
  readonly weiterberechnungTitel: string;
  readonly nochNichtWeiterberechnetVor: string;
  readonly nochNichtWeiterberechnetNach: string;
  readonly nichtWeiterberechenbar: string;
  readonly tabelleWeiterberechnung: string;
  readonly rechnung: string;
  readonly entwurfOhneNummer: string;
  readonly position: string;
  readonly zeile: string;
  readonly wirksam: string;
  readonly berechnet: string;
  readonly unwirksamAusStorno: string;
  readonly zustandsverlauf: string;
  readonly hier: string;
  readonly uebergangErzwungenVor: string;
  readonly uebergangErzwungenMitte: string;
  readonly geloeschtWirdNichts: string;
  readonly uebergangErzwungenNach: string;
  readonly gebuchtWort: string;
  readonly abGebucht: string;

  /** Wohin ein Zustand fuehrt — dieselbe Folge wie `fin.ausgabe_uebergang`. */
  readonly folge: Readonly<Record<AusgabeStatusSchluessel, string>>;
}

const DE: BelegeTexte = {
  beleg: 'Beleg',
  alle: 'alle',
  anzeigen: 'Anzeigen',
  jahr: 'Jahr',
  belegdatumImMonat: 'Belegdatum im Monat',
  alleZeigen: 'alle zeigen',
  netto: 'Netto',
  brutto: 'Brutto',
  ust: 'USt',
  kategorie: 'Kategorie',
  ohneNummer: 'ohne Nummer',
  belegnummer: 'Belegnummer',
  belegdatum: 'Belegdatum',

  zitatAuf: '„',
  zitatZu: '"',

  titel: 'Belege',
  typ: 'Typ',
  quelle: 'Quelle',
  belegeImArchiv: 'Belege im Archiv',
  mitLoeschsperre: 'mit Löschsperre',
  fristOffen: 'Frist offen (O-46)',
  jeTyp: 'Je Typ:',
  einBelegOhneFrist: 'Ein Beleg trägt keine Aufbewahrungsfrist.',
  belegeOhneFrist: ' Belege tragen keine Aufbewahrungsfrist.',
  fristOffenErklaerung:
    'Für ihre Klasse ist nicht entschieden, wie lange aufbewahrt wird (O-46). '
    + 'Sie bleiben gesperrt — ausgesondert wird nichts, wofür keine Frist '
    + 'feststeht. §147 AO nennt zehn Jahre für Buchungsbelege und sechs für '
    + 'Handelsbriefe; welche Klasse welche Frist trägt, bestätigt der Mandant.',
  keinBelegZumFilter: 'Kein Beleg passt zu diesem Filter.',
  keinBelegImArchiv:
    'Es liegt kein Beleg im Archiv. Belege entstehen mit einer '
    + 'Eingangsrechnung, einer Ausgabe oder einer festgeschriebenen '
    + 'Ausgangsrechnung — und sie brauchen einen VERBUNDENEN Objektspeicher: '
    + 'ohne ihn legt auch der Demo-Datenbestand keinen an, weil ein Beleg ohne '
    + 'Datei kein Beleg ist (ACC-03).',
  tabelleListe: 'Buchungsbelege mit Typ, Quelle, Datum, Betrag und Aufbewahrung',
  seiten: 'Seiten',
  eingegangen: 'Eingegangen',
  aufbewahrung: 'Aufbewahrung',
  loeschsperre: 'Löschsperre',
  keineSperre: 'keine Sperre',
  bisZum: 'bis',
  listeFussnoteVor:
    'Die Datei selbst ist hier nicht verlinkt. Sie wird auf der Belegseite über '
    + 'eine kurzlebige signierte URL ausgeliefert, und zwar erst nach der '
    + 'Rechteentscheidung (DOC-03, SEC-A6). Gelöscht wird kein Beleg '
    + '(Invariante 8) — was ausscheidet, scheidet über',
  listeFussnoteNach: 'und die Löschsperre aus.',

  typNamen: {
    ausgangsrechnung: 'Ausgangsrechnung',
    eingangsrechnung: 'Eingangsrechnung',
    gutschrift: 'Gutschrift',
    kassenbeleg: 'Kassenbeleg',
    bankbeleg: 'Bankbeleg',
    vertrag: 'Vertrag',
    sonstiges: 'Sonstiges',
  },
  quelleNamen: {
    upload: 'hochgeladen',
    email: 'per E-Mail eingegangen',
    scan: 'gescannt',
    api: 'über eine Schnittstelle',
    erzeugt: 'von der Plattform erzeugt',
  },

  belegTitel: 'Beleg',
  belegOhneNummer: 'Beleg ohne Nummer',
  bruttoNurZurSuche: 'Brutto (nur zur Suche)',
  eingegangenBerlin: 'Eingegangen (Europe/Berlin)',
  sha256Erklaerung: 'SHA-256 der Datei — der Nachweis, dass sie dieselbe ist',
  dieDatei: 'Die Datei',
  keineDokumentversionVor:
    'Zu diesem Beleg lässt sich keine Dokumentversion lesen. Das darf nicht '
    + 'vorkommen:',
  keineDokumentversionMitte:
    'ist ein Pflichtfeld mit zusammengesetztem Fremdschlüssel. Fehlt sie hier, '
    + 'fehlt ein Recht auf',
  keineDokumentversionNach:
    'oder die Zeile ist beschädigt — beides gehört gemeldet und nicht '
    + 'weggeklickt.',
  hashAbweichungTitel:
    'Der Hash des Belegs weicht vom Hash der Dokumentversion ab.',
  belegBezeugt: 'Der Beleg bezeugt',
  versionTraegt: ', die Version trägt',
  hashAbweichungNach:
    '. Ein archiviertes Dokument wird nicht ausgetauscht (ACC-03) — das hier '
    + 'ist ein Befund, keine Anzeigefrage.',
  neuereVersionVor: 'Von diesem Dokument gibt es eine neuere Fassung (Version',
  neuereVersionMitte: '). Der Beleg bleibt bei Version',
  neuereVersionNach:
    '— und genau dafür zeigt er auf die VERSION und nicht auf das Dokument: '
    + 'eine spätere Fassung kann nicht stillschweigend zum Beleg werden.',
  titelFeld: 'Titel',
  version: 'Version',
  formatUndGroesse: 'Format und Grösse',
  dokumentGeloeschtVor: 'Das Dokument ist am',
  dokumentGeloeschtNach:
    'weich gelöscht worden und wird nicht ausgeliefert. Für Finanzkategorien '
    + 'schliesst der Dienst das Entfernen aus — dass es hier steht, ist ein '
    + 'Prüfauftrag.',
  belegOeffnen: 'Beleg öffnen',
  signierteUrlHinweis:
    'Die Adresse zieht eine kurzlebige signierte URL und leitet weiter. Sie '
    + 'steht nicht in dieser Seite.',
  diesemKontoFehlt: 'Diesem Konto fehlt',
  dateiBleibtZu:
    '. Der Beleg ist da; die Datei bleibt zu. Ein Knopf, der in ein 403 führt, '
    + 'verrät nur, was er nicht zeigt.',
  klasse: 'Klasse',
  loeschsperreAktiv: ' · Löschsperre aktiv',
  keineLoeschsperre: ' · keine Löschsperre',
  fristOffenLang:
    'Frist offen (O-46). Für diese Belegklasse ist nicht entschieden, wie lange '
    + 'aufbewahrt wird — §147 AO nennt zehn Jahre für Buchungsbelege und sechs '
    + 'für Handelsbriefe, und welche Klasse dieser Plattform welche Frist trägt, '
    + 'bestätigt der Mandant. Bis dahin wird nichts ausgesondert; das ist die '
    + 'Richtung, die nicht haftet.',
  aufzubewahrenBis: 'Aufzubewahren bis',
  jahreAbBelegdatum: 'Jahre ab Belegdatum',
  regelUnbestaetigt:
    'Die zugrunde liegende Regel ist unbestätigt (O-46) — das Datum steht, die '
    + 'Begründung dafür noch nicht.',
  woranDieserBelegHaengt: 'Woran dieser Beleg hängt',
  keineVerwendung:
    'Keine Zeile beruft sich auf diesen Beleg. Er liegt im Archiv, aber keine '
    + 'Buchung, keine Eingangsrechnung, keine Ausgabe und keine '
    + 'Ausgangsrechnung verweist auf ihn — dafür kann es Gründe geben (ein '
    + 'Vertrag, eine Anlage), und es kann auch eine unfertige Erfassung sein.',
  tabelleVerwendung: 'Zeilen, die sich auf diesen Beleg berufen',
  belegOderText: 'Beleg / Text',
  zugriffeTitel: 'Zugriffe auf das Dokument',
  keineZugriffe:
    'Keine Zugriffe protokolliert. Das heisst: niemand hat die Datei über die '
    + 'Plattform geöffnet — nicht, dass niemand sie kennt.',
  tabelleZugriffe: 'Die letzten Zugriffe auf die Belegdatei',
  zeitpunkt: 'Zeitpunkt',
  konto: 'Konto',
  belegFussnoteVor:
    'Es gibt hier keinen Löschknopf und keinen ausgegrauten (Invariante 8). '
    + 'Entfernen heisst in dieser Domäne archivieren, und für die '
    + 'Finanzkategorien schliesst der Dokumentendienst selbst das aus. Was '
    + 'ausscheidet, scheidet über',
  belegFussnoteNach:
    'und die Löschsperre aus — und darüber entscheidet die Aufbewahrungsregel, '
    + 'nicht diese Seite.',
  zumGobdArchiv: 'Zum GoBD-Archiv →',

  verwendungNamen: {
    eingangsrechnung: 'Eingangsrechnung',
    ausgabe: 'Ausgabe',
    buchungssatz: 'Buchungssatz',
    rechnung: 'Ausgangsrechnung',
  },

  ausgabenTitel: 'Ausgaben',
  nurWeiterberechenbar: 'nur weiterberechenbar',
  nurAufwand: 'nur Aufwand (freigegeben oder gebucht, ohne Eingangsrechnungen)',
  unbestaetigtKlammer: ' (unbestätigt)',
  summenJeZustand: 'Summen je Zustand',
  gezaehltInDatenbank:
    'Gezählt wird in der Datenbank, unter derselben Policy wie die Liste: was '
    + 'diese Sitzung nicht sehen darf, zählt für sie auch nicht mit. Eine Summe '
    + 'über eine gekürzte Liste wäre die Zahl, an der später jemand eine '
    + 'Abweichung sucht.',
  einAusgabeOhneBeleg: 'Eine freigegebene oder gebuchte Ausgabe trägt keinen Beleg.',
  ausgabenOhneBeleg: ' freigegebene oder gebuchte Ausgaben tragen keinen Beleg.',
  ohneBelegErklaerung:
    'Das kann als Daten nicht entstehen — die Datenbank verlangt vor der '
    + 'Freigabe einen Beleg (ACC-03). Steht es hier, ist die Zeile älter als die '
    + 'Regel oder beschädigt; beides gehört gemeldet.',
  belegfreiNichtVorgesehen: 'Belegfrei buchen ist nicht vorgesehen (O-185).',
  tseOffen:
    'Ob eine elektronische Registrierkasse mit TSE nach §146a AO im Einsatz ist '
    + 'oder ausschliesslich eine offene Ladenkasse mit Kassenbuch, ist ebenfalls '
    + 'offen (O-186). Eine Barausgabe verlangt hier deshalb eine Kasse und trägt '
    + 'keine TSE-Angaben — die Plattform behauptet keine Sicherungseinrichtung, '
    + 'die sie nicht hat.',
  kategoriePlatzhalterVor: 'Einige Zeilen hängen an einer',
  kategoriePlatzhalterBetont: 'unbestätigten Kategorie',
  kategoriePlatzhalterNach:
    '(O-05). Welche Aufwandskategorien der Steuerberater erwartet und wie sie '
    + 'auf SKR-Konten abbilden, ist nicht entschieden — bis dahin entsteht aus '
    + 'einer solchen Kategorie eine Buchung OHNE Konto und mit Prüfhinweis, nie '
    + 'eine auf ein geratenes Konto.',
  keineAusgabeZumFilter: 'Keine Ausgabe passt zu diesem Filter.',
  keineAusgabeErfasst:
    'Es ist keine Ausgabe erfasst. Eine Ausgabe ist der Aufwand dieser '
    + 'Gesellschaft, der keine Lieferantenrechnung ist — Barkasse, Tankbeleg, '
    + 'Material für einen Auftrag, eine Auslagenerstattung. Sie braucht vor der '
    + 'Freigabe ihren Beleg (ACC-03).',
  tabelleAusgaben: 'Ausgaben mit Datum, Kategorie, Betrag, Beleg und Zustand',
  unbestaetigtO05: 'unbestätigt (O-05)',
  auftrag: 'Auftrag',
  belegFehltDarfNichtSein: 'fehlt — darf nicht sein',
  nochKeiner: 'noch keiner',
  weiterberechenbarJa: 'weiterberechenbar',
  weiterberechenbarNein: 'nicht weiterberechenbar',
  erstattungSuffix: ' · Erstattung',
  ausgabenFussnoteVor:
    'Gelöscht wird keine Ausgabe (Invariante 8). Zurückgewiesen wird mit Grund, '
    + 'und eine gebuchte Ausgabe ist unveränderlich — korrigiert wird durch eine '
    + 'Gegenbuchung. Wer welche Erstattung bekommen hat, steht nicht in dieser '
    + 'Liste: die Spalte liegt hinter einem eigenen Recht (',
  ausgabenFussnoteNach: '), und der Zugriff darauf wird protokolliert.',

  zustandListe: {
    erfasst: 'erfasst — noch nicht freigegeben',
    freigegeben: 'freigegeben — zur Buchung bereit',
    gebucht: 'gebucht',
    abgelehnt: 'abgelehnt',
  },
  zustandBlatt: {
    erfasst: 'erfasst — noch nicht freigegeben',
    freigegeben: 'freigegeben — zur Buchung bereit',
    gebucht: 'gebucht — unveränderlich',
    abgelehnt: 'abgelehnt',
  },

  zahlungsmittelListe: {
    ueberweisung: 'Überweisung',
    lastschrift: 'Lastschrift',
    bar: 'bar (Kasse)',
    karte: 'Karte',
    verrechnung: 'Verrechnung',
  },
  zahlungsmittelBlatt: {
    ueberweisung: 'Überweisung',
    lastschrift: 'Lastschrift',
    bar: 'bar (aus der Kasse)',
    karte: 'Karte',
    verrechnung: 'Verrechnung',
  },

  ausgabeTitel: 'Ausgabe',
  ausgabedatum: 'Ausgabedatum',
  unbestaetigtStrich: ' — unbestätigt (O-05)',
  bezahltMit: 'Bezahlt mit',
  umsatzsteuer: 'Umsatzsteuer',
  weiterberechenbar: 'Weiterberechenbar',
  jaFin07: 'ja (FIN-07)',
  nein: 'nein',
  belegFehltInDiesemZustand: 'fehlt — das darf es in diesem Zustand nicht geben',
  zurueckgewiesenVor: 'Zurückgewiesen. Grund:',
  zurueckgewiesenNach:
    '. Die Zeile bleibt stehen (Invariante 8) — es gibt hier keine Löschung, '
    + 'auch keinen ausgegrauten Knopf dafür.',
  ohneBelegKeineFreigabe: 'Ohne Beleg keine Freigabe.',
  ohneBelegErzwungenVor: 'Die Datenbank verlangt ihn vor dem Übergang nach',
  freigegebenWort: 'freigegeben',
  ohneBelegErzwungenNach:
    '— „keine Buchung ohne Beleg" ist erzwungen und nicht behauptet (ACC-03).',
  steuerJeGruppeTitel: 'Die Steuer je Steuersatzgruppe — nie ein Mischsatz',
  gebuchtOhneAufteilung:
    'Diese gebuchte Ausgabe hat keine Aufteilung je Steuersatzgruppe. Das kann '
    + 'als Daten nicht entstehen — die Datenbank verlangt sie vor dem Buchen. '
    + 'Steht es hier, ist die Zeile älter als die Regel.',
  nochKeineAufteilung:
    'Noch keine Aufteilung erfasst. Sie darf während der Erfassung nachkommen; '
    + 'vor dem Buchen muss sie zum Kopf passen, und das prüft die Datenbank am '
    + 'Ende der Transaktion.',
  keinSatzZurueckgerechnetVor: 'Aus dem Bruttobetrag wird hier',
  keinBetont: 'kein',
  keinSatzZurueckgerechnetNach:
    'Satz zurückgerechnet: ein Mischsatz steht auf keinem Beleg (Invariante 1).',
  tabelleSteuerzeilen: 'Aufteilung dieser Ausgabe je Steuersatzgruppe',
  steuersatzgruppe: 'Steuersatzgruppe',
  satz: 'Satz',
  en16931Kategorie: 'EN-16931-Kategorie',
  zeilensumme: 'Zeilensumme',
  nettoSchraeg: 'netto /',
  steuerKopf: 'Steuer · Kopf',
  stimmenUeberein: ' — sie stimmen überein.',
  weichenAb:
    ' — sie weichen ab. Vor dem Buchen weist die Datenbank das ab; der Kopf oder '
    + 'die Zeilen sind zu korrigieren.',
  erstattungTitel: 'Erstattung an eine Beschäftigte',
  keineErstattung:
    'Diese Ausgabe ist keine Auslagenerstattung — sie hängt an keiner '
    + 'Anstellung.',
  keineAngabeErstattungVor:
    'Keine Angabe. Das heisst zweierlei, und die Seite unterscheidet es nicht: '
    + 'die Ausgabe ist keine Erstattung, ODER diesem Konto fehlt ',
  keineAngabeErstattungNach:
    '. Ein unterscheidbarer Hinweis wäre genau die Auskunft, die das Recht '
    + 'verweigert (AUT-06).',
  erstattetAnAnstellung: 'Erstattet an Anstellung',
  ohnePersonalnummer: 'ohne Personalnummer',
  erstattungAnAnstellungVor:
    'Eine Erstattung ist ein Kostensatz und hängt deshalb an der ANSTELLUNG, '
    + 'nie an der Person (D-09, Invariante 9). Dieser Lesezugriff steht im '
    + 'Protokoll —',
  erstattungAnAnstellungNach: ', mit Konto und Zeitpunkt.',
  weiterberechnungTitel: 'Weiterberechnung (FIN-07)',
  nochNichtWeiterberechnetVor:
    'Noch nicht weiterberechnet. Diese Ausgabe darf als Materialzeile auf einer '
    + 'Rechnung erscheinen — im Rechnungsentwurf unter „Position hinzufügen“, '
    + 'Herkunft „Material“ — und genau einmal: der Teilindex ',
  nochNichtWeiterberechnetNach: ' lässt eine zweite wirksame Zeile nicht zu.',
  nichtWeiterberechenbar:
    'Diese Ausgabe ist nicht als weiterberechenbar gekennzeichnet und erscheint '
    + 'auf keiner Rechnung.',
  tabelleWeiterberechnung: 'Rechnungszeilen, die diese Ausgabe weiterberechnen',
  rechnung: 'Rechnung',
  entwurfOhneNummer: 'Entwurf ohne Nummer',
  position: 'Position',
  zeile: 'Zeile',
  wirksam: 'Wirksam',
  berechnet: 'berechnet',
  unwirksamAusStorno: 'unwirksam — aus einem Storno übernommen',
  zustandsverlauf: 'Der Zustandsverlauf',
  hier: 'hier',
  uebergangErzwungenVor: 'Der Übergang wird in der Datenbank erzwungen (',
  uebergangErzwungenMitte: '), nicht in der Oberfläche angeboten.',
  geloeschtWirdNichts: 'Gelöscht wird nichts',
  uebergangErzwungenNach: '(Invariante 8); zurückgewiesen wird mit Grund, und ab',
  gebuchtWort: 'gebucht',
  abGebucht:
    'ist die Zeile unveränderlich — korrigiert wird durch eine Gegenbuchung.',

  folge: {
    erfasst: 'freigegeben · abgelehnt',
    freigegeben: 'gebucht · abgelehnt',
    gebucht: 'nichts mehr — korrigiert wird durch eine Gegenbuchung',
    abgelehnt: 'nichts mehr — eine abgelehnte Ausgabe wird neu erfasst',
  },
};

const EN: BelegeTexte = {
  beleg: 'Beleg',
  alle: 'all',
  anzeigen: 'Show',
  jahr: 'Year',
  belegdatumImMonat: 'Receipt date in',
  alleZeigen: 'show all',
  netto: 'Net',
  brutto: 'Gross',
  ust: 'USt (VAT)',
  kategorie: 'Category',
  ohneNummer: 'no number',
  belegnummer: 'Beleg number',
  belegdatum: 'Beleg date',

  zitatAuf: '"',
  zitatZu: '"',

  titel: 'Belege (supporting documents)',
  typ: 'Type',
  quelle: 'Source',
  belegeImArchiv: 'Belege in the archive',
  mitLoeschsperre: 'with a deletion lock',
  fristOffen: 'Retention period open (O-46)',
  jeTyp: 'By type:',
  einBelegOhneFrist: 'One Beleg carries no retention period.',
  belegeOhneFrist: ' Belege carry no retention period.',
  fristOffenErklaerung:
    'For their class it has not been decided how long they are kept (O-46). '
    + 'They stay locked — nothing is disposed of for which no period is settled. '
    + '§147 AO names ten years for Buchungsbelege (accounting records) and six '
    + 'for Handelsbriefe (commercial letters); which class carries which period '
    + 'is confirmed by the Mandant.',
  keinBelegZumFilter: 'No Beleg matches this filter.',
  keinBelegImArchiv:
    'There is no Beleg in the archive. Belege come into being with an incoming '
    + 'invoice, an expense or a finalised (festgeschrieben) outgoing invoice — '
    + 'and they need a CONNECTED object store: without one the demo data set '
    + 'creates none either, because a Beleg without a file is not a Beleg '
    + '(ACC-03).',
  tabelleListe:
    'Buchungsbelege (accounting records) with type, source, date, amount and '
    + 'retention',
  seiten: 'Pages',
  eingegangen: 'Received',
  aufbewahrung: 'Retention',
  loeschsperre: 'deletion lock',
  keineSperre: 'no lock',
  bisZum: 'until',
  listeFussnoteVor:
    'The file itself is not linked here. It is delivered on the Beleg page '
    + 'through a short-lived signed URL, and only after the permission decision '
    + '(DOC-03, SEC-A6). No Beleg is deleted (invariant 8) — what falls away '
    + 'falls away through',
  listeFussnoteNach: 'and the deletion lock.',

  typNamen: {
    ausgangsrechnung: 'Outgoing invoice',
    eingangsrechnung: 'Incoming invoice',
    gutschrift: 'Gutschrift (credit note)',
    kassenbeleg: 'Kassenbeleg (cash receipt)',
    bankbeleg: 'Bankbeleg (bank document)',
    vertrag: 'Contract',
    sonstiges: 'Other',
  },
  quelleNamen: {
    upload: 'uploaded',
    email: 'received by e-mail',
    scan: 'scanned',
    api: 'through an interface',
    erzeugt: 'produced by the platform',
  },

  belegTitel: 'Beleg (supporting document)',
  belegOhneNummer: 'Beleg without a number',
  bruttoNurZurSuche: 'Gross (for searching only)',
  eingegangenBerlin: 'Received (Europe/Berlin)',
  sha256Erklaerung: 'SHA-256 of the file — the proof that it is the same one',
  dieDatei: 'The file',
  keineDokumentversionVor:
    'No document version can be read for this Beleg. That must not happen:',
  keineDokumentversionMitte:
    'is a mandatory field with a composite foreign key. If it is missing here, '
    + 'a permission on',
  keineDokumentversionNach:
    'is missing or the row is damaged — either belongs in a report and is not '
    + 'clicked away.',
  hashAbweichungTitel:
    'The hash of the Beleg differs from the hash of the document version.',
  belegBezeugt: 'The Beleg attests',
  versionTraegt: ', the version carries',
  hashAbweichungNach:
    '. An archived document is not exchanged (ACC-03) — this is a finding, not '
    + 'a question of display.',
  neuereVersionVor: 'There is a newer edition of this document (version',
  neuereVersionMitte: '). The Beleg stays with version',
  neuereVersionNach:
    '— and that is precisely why it points to the VERSION and not to the '
    + 'document: a later edition cannot silently become the Beleg.',
  titelFeld: 'Title',
  version: 'Version',
  formatUndGroesse: 'Format and size',
  dokumentGeloeschtVor: 'The document was soft-deleted on',
  dokumentGeloeschtNach:
    'and is not delivered. For the finance categories the service rules removal '
    + 'out — that it stands here is a matter to be looked into.',
  belegOeffnen: 'Open the Beleg',
  signierteUrlHinweis:
    'The address fetches a short-lived signed URL and redirects. It does not '
    + 'appear in this page.',
  diesemKontoFehlt: 'This account is missing',
  dateiBleibtZu:
    '. The Beleg is there; the file stays shut. A button that leads into a 403 '
    + 'only gives away what it does not show.',
  klasse: 'Class',
  loeschsperreAktiv: ' · deletion lock active',
  keineLoeschsperre: ' · no deletion lock',
  fristOffenLang:
    'Retention period open (O-46). For this Beleg class it has not been decided '
    + 'how long it is kept — §147 AO names ten years for Buchungsbelege '
    + '(accounting records) and six for Handelsbriefe (commercial letters), and '
    + 'which class on this platform carries which period is confirmed by the '
    + 'Mandant. Until then nothing is disposed of; that is the direction that '
    + 'carries no liability.',
  aufzubewahrenBis: 'To be kept until',
  jahreAbBelegdatum: 'years from the Beleg date',
  regelUnbestaetigt:
    'The underlying rule is unconfirmed (O-46) — the date stands, the reason '
    + 'for it does not yet.',
  woranDieserBelegHaengt: 'What this Beleg is attached to',
  keineVerwendung:
    'No row relies on this Beleg. It sits in the archive, but no journal entry, '
    + 'no incoming invoice, no expense and no outgoing invoice refers to it — '
    + 'there can be reasons for that (a contract, an annex), and it can equally '
    + 'be an unfinished entry.',
  tabelleVerwendung: 'Rows that rely on this Beleg',
  belegOderText: 'Beleg / text',
  zugriffeTitel: 'Accesses to the document',
  keineZugriffe:
    'No accesses logged. That means: nobody has opened the file through the '
    + 'platform — not that nobody knows it.',
  tabelleZugriffe: 'The most recent accesses to the Beleg file',
  zeitpunkt: 'Time',
  konto: 'Account',
  belegFussnoteVor:
    'There is no delete button here, and no greyed-out one either (invariant '
    + '8). In this domain removing means archiving, and for the finance '
    + 'categories the document service itself rules it out. What falls away '
    + 'falls away through',
  belegFussnoteNach:
    'and the deletion lock — and that is decided by the retention rule, not by '
    + 'this page.',
  zumGobdArchiv: 'To the GoBD archive →',

  verwendungNamen: {
    eingangsrechnung: 'Incoming invoice',
    ausgabe: 'Expense',
    buchungssatz: 'Journal entry',
    rechnung: 'Outgoing invoice',
  },

  ausgabenTitel: 'Expenses',
  nurWeiterberechenbar: 'rechargeable only',
  nurAufwand: 'expense only (approved or booked, without incoming invoices)',
  unbestaetigtKlammer: ' (unconfirmed)',
  summenJeZustand: 'Totals by state',
  gezaehltInDatenbank:
    'The counting happens in the database, under the same policy as the list: '
    + 'what this session may not see does not count towards its totals either. '
    + 'A total over a shortened list would be the figure in which someone later '
    + 'goes looking for a discrepancy.',
  einAusgabeOhneBeleg: 'One approved or booked expense carries no Beleg.',
  ausgabenOhneBeleg: ' approved or booked expenses carry no Beleg.',
  ohneBelegErklaerung:
    'As data that cannot come into being — the database requires a Beleg '
    + '(supporting document) before approval (ACC-03). If it stands here, the '
    + 'row is older than the rule or damaged; either belongs in a report.',
  belegfreiNichtVorgesehen:
    'Booking without a Beleg is not provided for (O-185).',
  tseOffen:
    'Whether an electronic till with a TSE under §146a AO is in use, or only an '
    + 'open cash drawer with a Kassenbuch (cash book), is likewise open (O-186). '
    + 'A cash expense therefore requires a Kasse (cash box) here and carries no '
    + 'TSE data — the platform claims no security device it does not have.',
  kategoriePlatzhalterVor: 'Some rows hang on an',
  kategoriePlatzhalterBetont: 'unconfirmed category',
  kategoriePlatzhalterNach:
    '(O-05). Which expense categories the tax adviser expects, and how they map '
    + 'onto SKR accounts, is not decided — until then such a category yields a '
    + 'journal entry WITHOUT an account and with a check note, never one on a '
    + 'guessed account.',
  keineAusgabeZumFilter: 'No expense matches this filter.',
  keineAusgabeErfasst:
    'No expense has been recorded. An expense is this company’s cost that is '
    + 'not a supplier invoice — petty cash, a fuel receipt, material for an '
    + 'order, a reimbursement of outlays. It needs its Beleg (supporting '
    + 'document) before approval (ACC-03).',
  tabelleAusgaben:
    'Expenses with date, category, amount, Beleg and state',
  unbestaetigtO05: 'unconfirmed (O-05)',
  auftrag: 'Order',
  belegFehltDarfNichtSein: 'missing — must not be',
  nochKeiner: 'none yet',
  weiterberechenbarJa: 'rechargeable',
  weiterberechenbarNein: 'not rechargeable',
  erstattungSuffix: ' · reimbursement',
  ausgabenFussnoteVor:
    'No expense is deleted (invariant 8). Rejection carries a reason, and a '
    + 'booked expense is unalterable — it is corrected by a Gegenbuchung '
    + '(contra entry). Who received which reimbursement does not appear in this '
    + 'list: the column sits behind a permission of its own (',
  ausgabenFussnoteNach: '), and access to it is logged.',

  zustandListe: {
    erfasst: 'recorded — not yet approved',
    freigegeben: 'approved — ready to be booked',
    gebucht: 'booked',
    abgelehnt: 'rejected',
  },
  zustandBlatt: {
    erfasst: 'recorded — not yet approved',
    freigegeben: 'approved — ready to be booked',
    gebucht: 'booked — unalterable',
    abgelehnt: 'rejected',
  },

  zahlungsmittelListe: {
    ueberweisung: 'Bank transfer',
    lastschrift: 'Lastschrift (direct debit)',
    bar: 'cash (Kasse)',
    karte: 'Card',
    verrechnung: 'Set-off',
  },
  zahlungsmittelBlatt: {
    ueberweisung: 'Bank transfer',
    lastschrift: 'Lastschrift (direct debit)',
    bar: 'cash (from the Kasse)',
    karte: 'Card',
    verrechnung: 'Set-off',
  },

  ausgabeTitel: 'Expense',
  ausgabedatum: 'Expense date',
  unbestaetigtStrich: ' — unconfirmed (O-05)',
  bezahltMit: 'Paid by',
  umsatzsteuer: 'Umsatzsteuer (VAT)',
  weiterberechenbar: 'Rechargeable',
  jaFin07: 'yes (FIN-07)',
  nein: 'no',
  belegFehltInDiesemZustand: 'missing — in this state that must not exist',
  zurueckgewiesenVor: 'Rejected. Reason:',
  zurueckgewiesenNach:
    '. The row remains (invariant 8) — there is no deletion here, nor a '
    + 'greyed-out button for one.',
  ohneBelegKeineFreigabe: 'No approval without a Beleg.',
  ohneBelegErzwungenVor:
    'The database requires it before the transition to',
  freigegebenWort: 'freigegeben (approved)',
  ohneBelegErzwungenNach:
    '— "no booking without a Beleg" is enforced, not asserted (ACC-03).',
  steuerJeGruppeTitel: 'The tax by tax-rate group — never a blended rate',
  gebuchtOhneAufteilung:
    'This booked expense has no breakdown by tax-rate group. As data that '
    + 'cannot come into being — the database requires it before booking. If it '
    + 'stands here, the row is older than the rule.',
  nochKeineAufteilung:
    'No breakdown recorded yet. It may follow during entry; before booking it '
    + 'must match the header, and the database checks that at the end of the '
    + 'transaction.',
  keinSatzZurueckgerechnetVor: 'From the gross amount',
  keinBetont: 'no',
  keinSatzZurueckgerechnetNach:
    'rate is worked back here: a blended rate appears on no Beleg (invariant 1).',
  tabelleSteuerzeilen: 'Breakdown of this expense by tax-rate group',
  steuersatzgruppe: 'Tax-rate group',
  satz: 'Rate',
  en16931Kategorie: 'EN 16931 category',
  zeilensumme: 'Line total',
  nettoSchraeg: 'net /',
  steuerKopf: 'tax · header',
  stimmenUeberein: ' — they agree.',
  weichenAb:
    ' — they differ. Before booking the database rejects this; either the '
    + 'header or the lines must be corrected.',
  erstattungTitel: 'Reimbursement to an employee',
  keineErstattung:
    'This expense is not a reimbursement of outlays — it hangs on no Anstellung '
    + '(employment).',
  keineAngabeErstattungVor:
    'No statement. That means two things, and the page does not distinguish '
    + 'them: the expense is not a reimbursement, OR this account is missing ',
  keineAngabeErstattungNach:
    '. A hint that told them apart would be exactly the information the '
    + 'permission withholds (AUT-06).',
  erstattetAnAnstellung: 'Reimbursed to Anstellung (employment)',
  ohnePersonalnummer: 'no staff number',
  erstattungAnAnstellungVor:
    'A reimbursement is a costed item and therefore hangs on the ANSTELLUNG '
    + '(employment), never on the person (D-09, invariant 9). This read access '
    + 'is in the log —',
  erstattungAnAnstellungNach: ', with account and time.',
  weiterberechnungTitel: 'Recharging (FIN-07)',
  nochNichtWeiterberechnetVor:
    'Not recharged yet. This expense may appear as a material line on an '
    + 'invoice — in the invoice draft under “Add line item”, origin “Material” — and '
    + 'exactly once: the partial index ',
  nochNichtWeiterberechnetNach: ' does not admit a second effective line.',
  nichtWeiterberechenbar:
    'This expense is not marked as rechargeable and appears on no invoice.',
  tabelleWeiterberechnung: 'Invoice lines that recharge this expense',
  rechnung: 'Invoice',
  entwurfOhneNummer: 'Draft without a number',
  position: 'Item',
  zeile: 'Line',
  wirksam: 'Effective',
  berechnet: 'charged',
  unwirksamAusStorno:
    'not effective — carried over from a Storno (reversing entry)',
  zustandsverlauf: 'The sequence of states',
  hier: 'here',
  uebergangErzwungenVor: 'The transition is enforced in the database (',
  uebergangErzwungenMitte: '), not offered in the interface.',
  geloeschtWirdNichts: 'Nothing is deleted',
  uebergangErzwungenNach:
    '(invariant 8); rejection carries a reason, and from',
  gebuchtWort: 'gebucht (booked)',
  abGebucht:
    'onwards the row is unalterable — it is corrected by a Gegenbuchung (contra '
    + 'entry).',

  folge: {
    erfasst: 'freigegeben (approved) · abgelehnt (rejected)',
    freigegeben: 'gebucht (booked) · abgelehnt (rejected)',
    gebucht: 'nothing more — correction is by a Gegenbuchung (contra entry)',
    abgelehnt: 'nothing more — a rejected expense is recorded anew',
  },
};

export const BELEGE_TEXTE: Readonly<Record<InternSprache, BelegeTexte>> = {
  de: DE, en: EN,
};
