/**
 * `/[mandant]/finanzen/eingangsrechnungen` und die vier Blaetter darunter —
 * `/neu`, `/[id]`, `/[id]/freigabe`, `/[id]/steuer` — in beiden Sprachen.
 *
 * **Fuenf Blaetter, eine Datei.** Der Schnitt laeuft entlang der Teilflaeche
 * und nicht entlang des Bildschirms: Liste, Erfassung, Akte, Freigabe und
 * steuerliche Lage teilen sich zwei Dutzend Woerter — `Lieferant`,
 * `Rechnungsnummer des Lieferanten`, `In Pruefung geben`, `Zurueckweisen` —,
 * und dasselbe Wort an fuenf Stellen ist fuenfmal die Gelegenheit, es beim
 * naechsten Mal nur an vier davon zu aendern.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`). `Umsatzsteuer`, `Bauabzugsteuer`,
 * `Freistellungsbescheinigung`, `Bagatellgrenze`, `Gegenbuchung` und
 * `Beleg` tragen Rechtsbedeutung (UStG, EStG, GoBD). Im Englischen steht der
 * deutsche Begriff und DANEBEN eine kurze Erklaerung in Klammern — nie eine
 * erfundene Entsprechung. Ein englisches „exemption certificate" ALLEIN
 * bezeichnete nicht mehr das Papier des §48b EStG, sondern irgendeine
 * Befreiung.
 *
 * **Die Zustaende sind Schluessel und bleiben deshalb halb hier, halb dort.**
 * `eingegangen`, `in_pruefung`, `freigegeben`, `gebucht`, `abgelehnt` sind die
 * Werte des Enums aus 0123 und wandern nie. Uebersetzt wird nur, was daneben
 * auf dem Bildschirm steht — die Pille waehlt ihre Farbe weiter ueber ihren
 * deutschen `zustand` (DESIGN §5) und uebersetzt ihre Beschriftung selbst.
 *
 * **Warum hier Satzbruchstuecke stehen.** Mehrere Saetze dieser Blaetter
 * tragen eine Belegnummer, einen Betrag, ein Recht oder einen Tabellennamen
 * MITTEN im Satz. Ein Bruchstueck mit fuehrendem Leerzeichen (`' oeffnet. '`)
 * ist deshalb Absicht und kein Tippfehler: das eingesetzte Stueck steht
 * davor. Wo der englische Satz an dieser Stelle anders gebaut ist, steht die
 * Fuge an einer anderen Stelle — der Satz muss auf Englisch richtig sein,
 * nicht gleich gebaut.
 *
 * **Rechte-, Tabellen- und Dateinamen stehen NICHT hier.** Sie lauten in
 * beiden Sprachen gleich; sie stehen als Konstante im Seitenrumpf, wo eine
 * zweite Spalte nur eine Erfindung waere.
 */
import type { InternSprache } from '../../intern.js';

export interface EingangsrechnungenTexte {
  /* ── Was auf mehreren der fuenf Blaetter steht ─────────────────────── */
  readonly titel: string;
  readonly eingangsrechnung: string;
  readonly lieferant: string;
  readonly rechnungsnummerLieferant: string;
  readonly rechnungsdatum: string;
  readonly leistungsdatum: string;
  readonly netto: string;
  readonly brutto: string;
  readonly steuer: string;
  readonly steuersatz: string;
  readonly beleg: string;
  readonly grund: string;
  readonly einbehalt: string;
  readonly keinEinbehalt: string;
  readonly greiftNicht: string;
  readonly inPruefungGeben: string;
  readonly zurueckweisen: string;
  readonly zurueckweisenPlatzhalter: string;
  readonly begruendungPlatzhalter: string;
  readonly zeileBleibtStehen: string;
  readonly diesemKontoFehlt: string;
  readonly steuerlicheLage: string;

  /** Die Anfuehrungszeichen — deutsch „…", englisch "…". */
  readonly zitatAuf: string;
  readonly zitatZu: string;

  /**
   * Der Zustand ausgeschrieben, wie er neben der Pille steht. Kurz auf der
   * Liste, lang auf dem Freigabeblatt — dort traegt er den Grund mit, aus dem
   * gerade nicht freigegeben werden kann.
   */
  readonly zustandKurz: Readonly<Record<
    'eingegangen' | 'in_pruefung' | 'freigegeben' | 'gebucht' | 'abgelehnt', string>>;
  readonly zustandLang: Readonly<Record<
    'eingegangen' | 'in_pruefung' | 'freigegeben' | 'gebucht' | 'abgelehnt', string>>;

  /* ── Blatt 1: die Liste ────────────────────────────────────────────── */
  readonly rechnungsdatumImMonat: string;
  readonly alleZeigen: string;
  readonly rechnungErfassen: string;
  readonly keineEingangsrechnung: string;
  readonly tabelleListe: string;
  readonly ohneNochNichtGebucht: string;
  readonly nrDesLieferanten: string;

  /* ── Blatt 2: `/neu` — erfassen ────────────────────────────────────── */
  readonly erfassenTitel: string;
  readonly erechnungTitel: string;
  readonly erechnungErklaerung: string;
  readonly erechnungDatei: string;
  readonly erechnungKnopf: string;
  readonly vorschlag: string;
  readonly vorbelegtVor: string;
  readonly vorbelegtNach: string;
  readonly keinLieferantAngelegt: string;
  readonly belegLegende: string;
  readonly pdfHochladen: string;
  readonly belegWaehlen: string;
  readonly belegDesVorschlags: string;
  readonly einesVonBeidem: string;
  readonly bitteWaehlen: string;
  readonly faelligAm: string;
  readonly nettoInEuro: string;
  readonly umsatzsteuerInEuro: string;
  readonly bruttoHinweis: string;
  readonly erfassen: string;

  /* ── Blatt 3: `/[id]` — die Akte ───────────────────────────────────── */
  readonly ohneLieferant: string;
  readonly ohneNummer: string;
  readonly freigabeAnsehen: string;
  readonly abgelehntMit: string;
  readonly interneBelegnummer: string;
  readonly entstehtBeimBuchen: string;
  readonly offenAnLieferanten: string;
  readonly nochKeinPosten: string;

  /* ── Der Zahlungsausgang (V-216) ─────────────────────────────────────── */
  readonly zahlungenTitel: string;
  readonly keineZahlung: string;
  readonly tabelleZahlungen: string;
  readonly zahlungstag: string;
  readonly zahlungOeffnen: string;
  readonly storniert: string;
  readonly zahlungErfassenTitel: string;
  readonly zahlungErfassenErklaerung: string;
  readonly betragInEuro: string;
  readonly zahlungsweg: string;
  readonly vonKonto: string;
  readonly zahlungErfassen: string;
  /** Vor dem Tag, an dem der Kreditorposten ausgeglichen wurde (V-217). */
  readonly bezahlt: string;
  /** Die Rückmeldung nach dem Erfassen — `?meldung=`, über `eigenerEintrag()`. */
  readonly ausgangMeldungen: Readonly<Record<'ausgang_erfasst' | 'ausgang_guthaben', string>>;
  /** Der Grund einer Abweisung — `?fehler=`, über `eigenerEintrag()`. */
  readonly ausgangFehler: Readonly<Record<string, string>>;
  readonly ausgangFehlerSonst: string;
  readonly entgeltJeSteuersatz: string;
  readonly keineAufteilung: string;
  readonly tabelleSteuerzeilen: string;
  readonly herkunftTitel: string;
  readonly herkunftErklaerung: string;
  readonly entschiedenWurdeIn: string;
  readonly derFreigabe: string;
  readonly tabelleHerkunft: string;
  readonly feld: string;
  readonly wert: string;
  readonly konfidenz: string;
  readonly quelle: string;
  readonly naechsterSchritt: string;
  readonly gebuchtUnter: string;
  readonly gebuchtErklaerung: string;
  readonly abgelehntErklaerung: string;
  readonly pruefenErklaerung: string;
  readonly grundDerFreigabe: string;
  readonly freigabeFriertEin: string;
  readonly buchenErklaerung: string;
  readonly buchen: string;
  readonly zurueckweisenMitGrund: string;

  /* ── Blatt 4: `/[id]/freigabe` ─────────────────────────────────────── */
  readonly freigabe: string;
  readonly keinLeserechtFreigabe: string;
  readonly freigabeZurBuchung: string;
  readonly wasPassiertVor: string;
  readonly wasPassiertBuchung: string;
  readonly wasPassiertMitte: string;
  readonly wasPassiertBetont: string;
  readonly wasPassiertNach: string;
  readonly vierAngabenTitel: string;
  readonly bruttobetrag: string;
  readonly keinLieferantZugeordnet: string;
  readonly nettoUst: string;
  readonly keinBeleg: string;
  readonly belegOhneNummer: string;
  readonly reverseChargeGreift: string;
  readonly nochNichtGerechnet: string;
  readonly steuerlicheLageKlein: string;
  readonly vierAugenTitel: string;
  readonly keinVierAugen: string;
  readonly abGrenzeVor: string;
  readonly abGrenzeNach: string;
  readonly erfasstHat: string;
  readonly kontoOhneNamen: string;
  readonly istDiesesKonto: string;
  readonly nichtDiesesKonto: string;
  readonly vierAugenSperrtSatz: string;
  readonly keineSperre: string;
  readonly darfFreigeben: string;
  readonly freigegebenWort: string;
  readonly amDatum: string;
  readonly vonPerson: string;
  readonly begruendungIst: string;
  readonly istGebucht: string;
  readonly zurueckgewiesenGrund: string;
  readonly zurueckgewiesenNach: string;
  readonly nochNichtPruefbarVor: string;
  readonly nochNichtPruefbarNach: string;
  readonly begruendungFuenf: string;
  readonly begruendungImSatz: string;
  readonly gesperrtVierAugen: string;
  readonly rechtEntscheidenFehlt: string;
  readonly zurBuchungFreigeben: string;
  readonly grundFuenf: string;

  /* ── Blatt 5: `/[id]/steuer` — die steuerliche Lage ─────────────────── */
  readonly keinLeserechtSteuerMitte: string;
  readonly keinLeserechtSteuerNach: string;
  readonly steuerH1: string;
  readonly ustIdLieferant: string;
  readonly geprueftGegen: string;
  readonly keinDatumPruefbar: string;
  readonly welchesDatum: string;
  readonly stichtagErklaerung: string;
  readonly titel13b: string;
  readonly greift: string;
  /** Die Grundlage der Verlagerung — `reverse_charge_grundlage` aus 0123. */
  readonly artText: Readonly<Record<'bau' | 'gebaeudereinigung', string>>;
  readonly nichtBenannt: string;
  readonly grundlageVor: string;
  readonly grundlageNach: string;
  readonly keineVerlagerung: string;
  readonly hinweistextLautet: string;
  readonly status13bVor: string;
  readonly status13bMitte: string;
  readonly status13bNach: string;
  readonly titel48: string;
  readonly ausgangNichtBewertbarVor: string;
  readonly ausgangNichtBewertbarNach: string;
  readonly ausgangKeinSatz: string;
  readonly ausgangKeineBauleistung: string;
  readonly ausgangBescheinigung: string;
  readonly ausgangBagatelle: string;
  readonly ausgangEinbehalt: string;
  readonly nichtBewertbarMitte: string;
  readonly nichtBewertbarNach: string;
  readonly keinSatzVor: string;
  readonly keinSatzNach: string;
  readonly ohneStichtag: string;
  readonly grundlageBrutto: string;
  readonly satz: string;
  readonly keinSatzHinterlegt: string;
  readonly satzAusEinstellungVor: string;
  readonly satzAusEinstellungNach: string;
  readonly satzVomBeleg: string;
  readonly abweichungVor: string;
  readonly abweichungMitte: string;
  readonly abweichungNach: string;
  readonly keineBagatellgrenze: string;
  readonly bagatellgrenzeVor: string;
  readonly fundstelle: string;
  readonly jahressummeTitel: string;
  readonly ohneLieferantKeineSumme: string;
  readonly fuerJahrVor: string;
  readonly diesesJahr: string;
  readonly fuerJahrNach: string;
  readonly vorAbzugsentscheidung: string;
  readonly bereitsErbracht: string;
  readonly erwarteteJahresgegenleistung: string;
  readonly nichtEingetragen: string;
  readonly grundlageErwartung: string;
  readonly fortgeschrieben: string;
  readonly prognoseErklaerung: string;
  readonly fsbTitel: string;
  readonly fsbKeinRechtMitte: string;
  readonly fsbKeinRechtNach: string;
  readonly keineFsbHinterlegt: string;
  readonly tabelleFsb: string;
  readonly finanzamt: string;
  readonly gueltig: string;
  readonly umfang: string;
  readonly unbeschraenkt: string;
  readonly auftragsbezogen: string;
  readonly amStichtag: string;
  readonly widerrufenAm: string;
  readonly gilt: string;
  readonly giltAndererAuftrag: string;
  readonly giltNicht: string;
  readonly keinDokument: string;
  readonly pflegeOffenBetont: string;
  readonly pflegeOffenVor: string;
  readonly pflegeOffenZwei: string;
  readonly pflegeOffenDrei: string;
  readonly pflegeOffenNach: string;
  readonly schlussVor: string;
  readonly schlussNach: string;
  readonly geprueftNichtVermerkt: string;
  readonly geprueftAm: string;
}

const DE: EingangsrechnungenTexte = {
  titel: 'Eingangsrechnungen',
  eingangsrechnung: 'Eingangsrechnung',
  lieferant: 'Lieferant',
  rechnungsnummerLieferant: 'Rechnungsnummer des Lieferanten',
  rechnungsdatum: 'Rechnungsdatum',
  leistungsdatum: 'Leistungsdatum',
  netto: 'Netto',
  brutto: 'Brutto',
  steuer: 'Steuer',
  steuersatz: 'Steuersatz',
  beleg: 'Beleg',
  grund: 'Grund',
  einbehalt: 'Einbehalt',
  keinEinbehalt: 'kein Einbehalt',
  greiftNicht: 'greift nicht',
  inPruefungGeben: 'In Prüfung geben',
  zurueckweisen: 'Zurückweisen',
  zurueckweisenPlatzhalter: 'Leistung wurde nie erbracht',
  begruendungPlatzhalter: 'Sachlich und rechnerisch geprüft',
  zeileBleibtStehen:
    'Die Zeile bleibt stehen (Invariante 8). Der Grund ist das, was später '
    + 'allein dasteht.',
  diesemKontoFehlt: 'Diesem Konto fehlt',
  steuerlicheLage: 'Steuerliche Lage',

  zitatAuf: '„',
  zitatZu: '"',

  zustandKurz: {
    eingegangen: 'eingegangen', in_pruefung: 'in Prüfung',
    freigegeben: 'freigegeben', gebucht: 'gebucht', abgelehnt: 'abgelehnt',
  },
  zustandLang: {
    eingegangen: 'eingegangen — noch nicht in der Prüfung',
    in_pruefung: 'in Prüfung',
    freigegeben: 'freigegeben — zur Buchung bereit',
    gebucht: 'gebucht',
    abgelehnt: 'abgelehnt',
  },

  rechnungsdatumImMonat: 'Rechnungsdatum im Monat',
  alleZeigen: 'alle zeigen',
  rechnungErfassen: 'Rechnung erfassen',
  keineEingangsrechnung:
    'Noch keine Eingangsrechnung erfasst. Jede braucht ihr Dokument — ohne '
    + 'Beleg wird nichts gebucht (ACC-03).',
  tabelleListe: 'Eingangsrechnungen mit Belegnummer, Lieferant, Betrag und Zustand',
  ohneNochNichtGebucht: 'ohne — noch nicht gebucht',
  nrDesLieferanten: 'Nr. des Lieferanten',

  erfassenTitel: 'Eingangsrechnung erfassen',
  erechnungTitel: 'E-Rechnung einlesen',
  erechnungErklaerung:
    'XRechnung (XML) oder ZUGFeRD (PDF mit eingebetteter Rechnung). Die Werte '
    + 'gehen als Vorschlag in die Freigaben — mit Quelle und Prüfung je Feld; erst '
    + 'die Freigabe erzeugt die Eingangsrechnung. Gescannte PDF ohne Datensatz werden '
    + 'nicht erkannt (kein OCR-Anbieter, O-135) — dafür das Formular darunter.',
  erechnungDatei: 'Datei (XML oder PDF)',
  erechnungKnopf: 'Einlesen und vorschlagen',
  vorschlag: 'Vorschlag',
  vorbelegtVor: 'Vorbelegt aus dem Vorschlag',
  vorbelegtNach:
    '. Prüfen, anpassen, erfassen — der Beleg des Vorschlags wird übernommen.',
  keinLieferantAngelegt:
    'Für diese Gesellschaft ist noch kein Lieferant angelegt. Ohne '
    + 'Lieferant lässt sich eine Rechnung weder prüfen noch zuordnen.',
  belegLegende: 'Der Beleg (ACC-03)',
  pdfHochladen: 'PDF hochladen',
  belegWaehlen: '… oder einen bereits abgelegten Beleg wählen',
  belegDesVorschlags: 'Beleg des Vorschlags',
  einesVonBeidem:
    'Eines von beidem ist Pflicht. Ohne Dokument entsteht keine '
    + 'Eingangsrechnung.',
  bitteWaehlen: 'Bitte wählen — im Stamm nicht eindeutig gefunden',
  faelligAm: 'Fällig am',
  nettoInEuro: 'Netto in Euro',
  umsatzsteuerInEuro: 'Umsatzsteuer in Euro',
  bruttoHinweis:
    'Das Brutto wird aus Netto + Steuer gerechnet, nicht eingegeben — ein '
    + 'eingetipptes Brutto, das nicht aufgeht, ist ein Beleg, der sich nicht '
    + 'buchen lässt.',
  erfassen: 'Erfassen',

  ohneLieferant: 'Ohne Lieferant',
  ohneNummer: 'ohne Nummer',
  freigabeAnsehen: 'Freigabe ansehen',
  abgelehntMit: 'Abgelehnt:',
  interneBelegnummer: 'Interne Belegnummer',
  entstehtBeimBuchen: 'entsteht beim Buchen',
  offenAnLieferanten: 'Offen an den Lieferanten',
  nochKeinPosten: 'noch kein Posten — nicht gebucht',

  zahlungenTitel: 'Zahlungen an den Lieferanten',
  keineZahlung: 'Noch keine Zahlung erfasst.',
  tabelleZahlungen: 'Zahlungen an den Lieferanten mit Tag, Art und Betrag',
  zahlungstag: 'Zahlungstag',
  zahlungOeffnen: 'Zahlung öffnen',
  storniert: 'storniert',
  zahlungErfassenTitel: 'Zahlung an den Lieferanten erfassen',
  zahlungErfassenErklaerung:
    'Erfasst wird eine Zahlung, die hinausgegangen ist — die Plattform löst '
    + 'keine Überweisung aus, eine Bankanbindung gibt es nicht. Was über den '
    + 'offenen Betrag hinausgeht, steht danach als Guthaben beim Lieferanten.',
  betragInEuro: 'Betrag in Euro',
  zahlungsweg: 'Zahlungsweg',
  vonKonto: 'Gezahlt von Konto',
  zahlungErfassen: 'Zahlung erfassen',
  bezahlt: 'Diese Eingangsrechnung ist vollständig bezahlt, ausgeglichen am',
  ausgangMeldungen: {
    ausgang_erfasst: 'Die Zahlung an den Lieferanten ist erfasst.',
    ausgang_guthaben:
      'Die Zahlung ist erfasst. Sie lag über dem offenen Betrag — der Rest steht '
      + 'als Guthaben beim Lieferanten in den offenen Posten.',
  },
  ausgangFehler: {
    unvollstaendig: 'Betrag, Zahlungstag und Zahlungsweg sind Pflicht.',
    datum: 'Der Zahlungstag ist kein Datum.',
    betrag: 'Der Betrag ist kein Eurobetrag — bitte wie 1.190,00 schreiben.',
    kein_posten: 'Zu dieser Eingangsrechnung gibt es noch keinen offenen Posten — erst das Buchen eröffnet ihn.',
    schon_ausgeglichen: 'Diese Eingangsrechnung ist bereits bezahlt.',
    betrag_nicht_positiv: 'Der Betrag muss größer als null sein.',
    bankkonto_fremd: 'Das gewählte Konto gehört nicht zu dieser Gesellschaft.',
    abgewiesen:
      'Die Zahlung wurde abgewiesen — darf Ihr Zugang in dieser Gesellschaft Zahlungen '
      + 'erfassen?',
    nicht_gefunden: 'Der offene Posten ist nicht erreichbar.',
  },
  ausgangFehlerSonst: 'Die Zahlung wurde nicht erfasst.',
  entgeltJeSteuersatz: 'Entgelt je Steuersatz (§15 UStG)',
  keineAufteilung:
    'Keine Aufteilung erfasst. Ohne sie wird nicht gebucht — ein Brutto '
    + 'mit einem Mischsatz ergibt keinen Vorsteuerabzug.',
  tabelleSteuerzeilen: 'Entgelt und Steuer je Steuersatzgruppe',
  herkunftTitel: 'Aus einer E-Rechnung übernommen',
  herkunftErklaerung:
    'Jeder Wert nennt das Element der Datei, aus dem er stammt, und die Prüfung, '
    + 'die er bestanden hat.',
  entschiedenWurdeIn: 'Entschieden wurde in',
  derFreigabe: 'der Freigabe',
  tabelleHerkunft: 'Extrahierte Felder mit Quelle und Konfidenz',
  feld: 'Feld',
  wert: 'Wert',
  konfidenz: 'Konfidenz',
  quelle: 'Quelle',
  naechsterSchritt: 'Der nächste Schritt',
  gebuchtUnter: 'Gebucht unter',
  gebuchtErklaerung:
    '. Eine gebuchte Rechnung wird nicht mehr umgestellt — korrigiert wird '
    + 'durch eine Gegenbuchung.',
  abgelehntErklaerung:
    'Abgelehnt. Eine abgelehnte Rechnung wird neu erfasst, nicht '
    + 'wiederbelebt — und sie blockiert die Neuerfassung nicht.',
  pruefenErklaerung:
    'In die Prüfung geben. Ab hier ist der Lieferant gesetzt und der Beleg '
    + 'zugeordnet.',
  grundDerFreigabe: 'Grund der Freigabe',
  freigabeFriertEin:
    'Die Freigabe friert ein, worüber entschieden wurde: Lieferant, Nummer, '
    + 'Datum und Betrag. Wer die Rechnung danach ändert, hat für das, was er '
    + 'bucht, keine Freigabe mehr (K-13).',
  buchenErklaerung:
    'Buchen zieht die interne Belegnummer und öffnet die Verbindlichkeit '
    + 'gegenüber dem Lieferanten. Danach ist der Beleg unveränderlich.',
  buchen: 'Buchen',
  zurueckweisenMitGrund: 'Zurückweisen — mit Grund',

  freigabe: 'Freigabe',
  keinLeserechtFreigabe:
    '. Es darf freigeben, aber nicht sehen, was es freigibt — und eine Freigabe '
    + 'ohne Einsicht ist keine. Die beiden Rechte gehören zusammen; wer sie '
    + 'vergibt, entscheidet die Rollenverwaltung.',
  freigabeZurBuchung: 'Freigabe zur Buchung',
  wasPassiertVor: 'Die Freigabe erlaubt die',
  wasPassiertBuchung: 'Buchung',
  wasPassiertMitte:
    '— sie ist keine Zahlungsanweisung. Es entsteht ein Freigabesatz in der '
    + 'Freigabekette (K-13) und ein Zustandswechsel;',
  wasPassiertBetont: 'nichts verlässt dabei das System',
  wasPassiertNach:
    '(Invariante 7). Gezahlt wird später, über die Zahlungsseite, und von '
    + 'einem Menschen.',
  vierAngabenTitel:
    'Worüber entschieden wird — genau diese vier Angaben friert der '
    + 'Freigabesatz ein',
  bruttobetrag: 'Bruttobetrag',
  keinLieferantZugeordnet: 'kein Lieferant zugeordnet',
  nettoUst: 'Netto / USt',
  keinBeleg: 'kein Beleg — ohne ihn wird nicht gebucht (ACC-03)',
  belegOhneNummer: 'Beleg ohne Nummer',
  reverseChargeGreift: 'Reverse Charge greift',
  nochNichtGerechnet: 'noch nicht gerechnet',
  steuerlicheLageKlein: 'steuerliche Lage',
  vierAugenTitel: 'Die Vier-Augen-Lage',
  keinVierAugen:
    'Kein Vier-Augen-Zwang konfiguriert (O-183). Diese Gesellschaft hat '
    + 'keinen Betrag hinterlegt, ab dem eine zweite Person freigeben muss '
    + '— und die Plattform erfindet keinen. Das heisst NICHT, dass keine '
    + 'Grenze gelten soll; es heisst, dass niemand sie gesetzt hat.',
  abGrenzeVor: 'Ab',
  abGrenzeNach: 'gibt eine zweite Person frei: wer erfasst hat, gibt nicht frei.',
  erfasstHat: 'Erfasst hat',
  kontoOhneNamen: 'ein Konto ohne Namen',
  istDiesesKonto: ' — das ist dieses Konto.',
  nichtDiesesKonto: ' — nicht dieses Konto.',
  vierAugenSperrtSatz:
    'Diese Sitzung darf deshalb NICHT freigeben: sie hat selbst erfasst, '
    + 'und der Betrag liegt über der Grenze.',
  keineSperre: 'Es gibt darum keine Sperre — mangels Regel, nicht mangels Grund.',
  darfFreigeben: 'Diese Sitzung darf freigeben.',
  freigegebenWort: 'Freigegeben',
  amDatum: ' am ',
  vonPerson: ' von ',
  begruendungIst: ' Begründung: ',
  istGebucht: ' Die Rechnung ist gebucht; korrigiert wird durch eine Gegenbuchung.',
  zurueckgewiesenGrund: 'Zurückgewiesen. Grund: ',
  zurueckgewiesenNach:
    '. Die Zeile bleibt stehen (Invariante 8); eine abgelehnte Rechnung wird '
    + 'neu erfasst, nicht wiederbelebt.',
  nochNichtPruefbarVor:
    'Diese Rechnung ist noch nicht in der Prüfung. Freigegeben wird aus dem '
    + 'Zustand',
  nochNichtPruefbarNach:
    '— dort ist der Lieferant gesetzt und der Beleg zugeordnet.',
  begruendungFuenf: 'Begründung (mindestens fünf Zeichen)',
  begruendungImSatz:
    'Sie steht im Freigabesatz, zusammen mit den vier Angaben oben. Wer '
    + 'die Rechnung danach ändert, hat für das, was er bucht, keine '
    + 'Freigabe mehr (K-13).',
  gesperrtVierAugen:
    'Gesperrt: diese Sitzung hat die Rechnung selbst erfasst, und der '
    + 'Betrag liegt über der Vier-Augen-Grenze dieser Gesellschaft.',
  rechtEntscheidenFehlt:
    ' — ohne dieses Recht entsteht kein Satz in der Freigabekette, und ohne '
    + 'ihn keine Freigabe.',
  zurBuchungFreigeben: 'Zur Buchung freigeben',
  grundFuenf: 'Grund (mindestens fünf Zeichen)',

  keinLeserechtSteuerMitte: '. Diese Route öffnet mit',
  keinLeserechtSteuerNach:
    ', die Rechnung selbst liegt aber hinter dem Eingangsrecht — beide Mengen '
    + 'sind nicht deckungsgleich, und welche gelten soll, ist offen (O-604).',
  steuerH1: '§13b UStG und §48 EStG',
  ustIdLieferant: 'USt-IdNr. des Lieferanten',
  geprueftGegen: 'Geprüft gegen',
  keinDatumPruefbar: 'kein Datum — nichts prüfbar',
  welchesDatum: 'Welches Datum das ist',
  stichtagErklaerung:
    '— also das Ende des Leistungszeitraums, sonst das Leistungsdatum, sonst '
    + 'das Rechnungsdatum. Der Gesetzeswortlaut des §48 EStG knüpft an die '
    + 'ZAHLUNG an, SPEC FIN-10 an das Leistungsdatum; welches gilt, ist offen '
    + '(O-176). Die Entscheidung unten ist gegen den genannten Tag getroffen '
    + 'und gegen keinen anderen.',
  titel13b: '§13b UStG — Steuerschuldnerschaft des Leistungsempfängers',
  greift: 'greift',
  artText: {
    bau: 'Bauleistung (§13b Abs. 2 Nr. 4 UStG)',
    gebaeudereinigung: 'Gebäudereinigung (§13b Abs. 2 Nr. 8 UStG)',
  },
  nichtBenannt: 'nicht benannt',
  grundlageVor: 'Grundlage:',
  grundlageNach:
    'Die Umsatzsteuer schuldet diese Gesellschaft als Leistungsempfängerin; '
    + 'der Lieferant weist keine aus.',
  keineVerlagerung:
    'Diese Rechnung trägt keine Verlagerung der Steuerschuld. Ohne '
    + 'hinterlegten Nachweis wird die Umsatzsteuer ausgewiesen — die '
    + 'sichere Richtung: zu Unrecht ausgewiesene Steuer wird geschuldet '
    + '(§14c UStG) und ist korrigierbar, eine zu Unrecht verlagerte ist '
    + 'beim Empfänger ein Ausfall.',
  hinweistextLautet: 'Der feste Hinweistext auf dem Beleg lautet:',
  status13bVor:
    'Der §13b-Status der EIGENEN Gesellschaft als Leistungsempfängerin '
    + 'ist nirgends als Zeitreihe hinterlegt —',
  status13bMitte: 'trägt kein entsprechendes Feld, und',
  status13bNach:
    'beschreibt die Ausgangsseite. Was hier steht, ist deshalb der auf dem '
    + 'BELEG gespeicherte Stand und keine tagesaktuelle Neubewertung (O-605).',
  titel48: '§48 EStG — Bauabzugsteuer, drei Ausgänge',
  ausgangNichtBewertbarVor: 'Nicht bewertbar —',
  ausgangNichtBewertbarNach: 'fehlt',
  ausgangKeinSatz: 'Nicht gerechnet — kein Satz hinterlegt',
  ausgangKeineBauleistung: 'Angewandt: §48 EStG greift nicht',
  ausgangBescheinigung: 'Angewandt: Ausgang 1 — gültige Freistellungsbescheinigung',
  ausgangBagatelle: 'Angewandt: Ausgang 2 — Jahressumme unter der Bagatellgrenze',
  ausgangEinbehalt: 'Angewandt: Ausgang 3 — es wird einbehalten',
  nichtBewertbarMitte: '. Die Policy auf',
  nichtBewertbarNach:
    'verlangt genau dieses Recht, die Bescheinigungen dieses Lieferanten sind '
    + 'hier also unsichtbar — und eine leere Liste hiesse „keine '
    + 'Bescheinigung", während sie „nicht sichtbar" bedeutet. Aus einer durch '
    + 'RLS geleerten Liste wird hier kein Ausgang bestimmt und kein Einbehalt '
    + 'gerechnet (O-604). Wer entscheidet, braucht das Leserecht.',
  keinSatzVor: 'Auf diesem Beleg steht kein Abzugssatz, und die Einstellung',
  keinSatzNach:
    'ist nicht belegt. Beides fehlt — also wird nichts gerechnet. 15 % wären '
    + 'hier eine Zahl aus dem Nichts, auch wenn sie im Gesetz stehen: der Satz '
    + 'ist eine datierte Einstellung, damit eine Änderung nicht jede '
    + 'historische Rechnung neu bewertet.',
  ohneStichtag:
    'Ohne Stichtag oder ohne Betrag lässt sich nichts entscheiden — und '
    + 'geraten wird hier nichts.',
  grundlageBrutto: 'Grundlage (brutto)',
  satz: 'Satz',
  keinSatzHinterlegt: 'kein Satz hinterlegt',
  satzAusEinstellungVor: 'Aus der datierten Einstellung',
  satzAusEinstellungNach: '— auf dem Beleg selbst steht keiner.',
  satzVomBeleg:
    'Der auf dem BELEG gespeicherte Satz. Er gilt, auch wenn die Einstellung '
    + 'heute eine andere nennt: gebucht wurde nach dem Beleg.',
  abweichungVor: 'Auf dem Beleg steht ein Einbehalt von',
  abweichungMitte: ', die heutige Prüfung ergibt',
  abweichungNach:
    '. Gebucht wurde nach dem Beleg; die Abweichung ist ein Prüfauftrag, keine '
    + 'Korrektur.',
  keineBagatellgrenze: 'Keine Bagatellgrenze angewandt (O-21) — es wird einbehalten.',
  bagatellgrenzeVor: 'Bagatellgrenze:',
  fundstelle: 'Fundstelle:',
  jahressummeTitel: 'Die Jahressumme dieses Leistenden — der zweite Ausgang',
  ohneLieferantKeineSumme:
    'Ohne zugeordneten Lieferanten gibt es keine Jahressumme. §48 Abs. 2 '
    + 'EStG misst je Leistungsempfänger und Leistendem.',
  fuerJahrVor: 'Für',
  diesesJahr: 'dieses Jahr',
  fuerJahrNach:
    'ist noch keine Gegenleistung an diesen Leistenden erfasst. Die Summe '
    + 'entsteht beim Übergang einer Eingangsrechnung nach',
  vorAbzugsentscheidung: '— also VOR der Abzugsentscheidung und nicht danach.',
  bereitsErbracht: 'Bereits erbrachte Gegenleistung',
  erwarteteJahresgegenleistung: 'Erwartete Jahresgegenleistung (§48 Abs. 1)',
  nichtEingetragen: 'nicht eingetragen',
  grundlageErwartung: 'Grundlage der Erwartung',
  fortgeschrieben: 'Fortgeschrieben',
  prognoseErklaerung:
    '· Die Prognose trägt ein Mensch ein und wird nie abgeleitet — eine '
    + 'geschätzte Prognose wäre eine, die die Plattform behauptet und niemand '
    + 'verantwortet.',
  fsbTitel: 'Freistellungsbescheinigungen nach §48b EStG',
  fsbKeinRechtMitte: '— und genau das verlangt die Policy auf',
  fsbKeinRechtNach:
    '. Die Bescheinigungen bleiben deshalb ungezeigt; das ist kein leerer '
    + 'Bestand, sondern ein fehlendes Recht (O-604).',
  keineFsbHinterlegt:
    'Für diesen Lieferanten ist keine Freistellungsbescheinigung '
    + 'hinterlegt. Ohne sie wird einbehalten — das ist Ausgang 3 und kein '
    + 'Versäumnis der Seite.',
  tabelleFsb:
    'Freistellungsbescheinigungen dieses Lieferanten mit Gültigkeit und Widerruf',
  finanzamt: 'Finanzamt',
  gueltig: 'Gültig',
  umfang: 'Umfang',
  unbeschraenkt: 'unbeschränkt',
  auftragsbezogen: 'auftragsbezogen',
  amStichtag: 'Am',
  widerrufenAm: 'widerrufen am',
  gilt: 'gilt',
  giltAndererAuftrag: 'gilt für einen anderen Auftrag',
  giltNicht: 'gilt am Stichtag nicht',
  keinDokument: 'kein Dokument',
  pflegeOffenBetont:
    'Hochladen, Gültigkeit setzen und Widerruf sind hier nicht möglich (O-604).',
  pflegeOffenVor:
    'Für diese Route ist im Register kein Schreibrecht eingetragen; die Policy auf',
  pflegeOffenZwei: 'verlangt zum Schreiben',
  pflegeOffenDrei: ', während die Route mit',
  pflegeOffenNach:
    ' öffnet. Welcher Schlüssel gelten soll, ist eine Entscheidung am '
    + 'Rechtemodell — und eine Maske, die auf eine Policy trifft, die sie '
    + 'abweist, ist schlechter als keine.',
  schlussVor: 'Der Einbehaltbetrag kommt aus',
  schlussNach: 'und nie aus einem Modell (Invariante 6).',
  geprueftNichtVermerkt: ' Geprüft wurde die Bescheinigung auf dem Beleg nicht vermerkt.',
  geprueftAm: ' Geprüft wurde die Bescheinigung laut Beleg am',
};

const EN: EingangsrechnungenTexte = {
  titel: 'Incoming invoices',
  eingangsrechnung: 'Incoming invoice',
  lieferant: 'Supplier',
  rechnungsnummerLieferant: 'Supplier’s invoice number',
  rechnungsdatum: 'Invoice date',
  leistungsdatum: 'Date of supply',
  netto: 'Net',
  brutto: 'Gross',
  steuer: 'Tax',
  steuersatz: 'Tax rate',
  beleg: 'Beleg (supporting document)',
  grund: 'Reason',
  einbehalt: 'Retention',
  keinEinbehalt: 'no retention',
  greiftNicht: 'does not apply',
  inPruefungGeben: 'Move into review',
  zurueckweisen: 'Reject',
  zurueckweisenPlatzhalter: 'The work was never carried out',
  begruendungPlatzhalter: 'Checked as to substance and arithmetic',
  zeileBleibtStehen:
    'The row remains (invariant 8). The reason is what will later stand there '
    + 'on its own.',
  diesemKontoFehlt: 'This account is missing',
  steuerlicheLage: 'Tax position',

  zitatAuf: '"',
  zitatZu: '"',

  zustandKurz: {
    eingegangen: 'received', in_pruefung: 'under review',
    freigegeben: 'approved', gebucht: 'booked', abgelehnt: 'rejected',
  },
  zustandLang: {
    eingegangen: 'received — not yet under review',
    in_pruefung: 'under review',
    freigegeben: 'approved — ready to be booked',
    gebucht: 'booked',
    abgelehnt: 'rejected',
  },

  rechnungsdatumImMonat: 'Invoice date in the month',
  alleZeigen: 'show all',
  rechnungErfassen: 'Record an invoice',
  keineEingangsrechnung:
    'No incoming invoice recorded yet. Each one needs its document — without a '
    + 'Beleg (supporting document) nothing is booked (ACC-03).',
  tabelleListe:
    'Incoming invoices with document number, supplier, amount and state',
  ohneNochNichtGebucht: 'none — not booked yet',
  nrDesLieferanten: 'Supplier’s no.',

  erfassenTitel: 'Record an incoming invoice',
  erechnungTitel: 'Read in an e-invoice',
  erechnungErklaerung:
    'XRechnung (XML) or ZUGFeRD (PDF with an embedded invoice). The values go '
    + 'into the approvals as a proposal — with source and check per field; only '
    + 'the approval creates the incoming invoice. Scanned PDFs without a data '
    + 'record are not read (no OCR provider, O-135) — use the form below for those.',
  erechnungDatei: 'File (XML or PDF)',
  erechnungKnopf: 'Read in and propose',
  vorschlag: 'Proposal',
  vorbelegtVor: 'Pre-filled from the proposal',
  vorbelegtNach:
    '. Check it, adjust it, record it — the proposal’s Beleg (supporting '
    + 'document) is carried over.',
  keinLieferantAngelegt:
    'No supplier has been created for this company yet. Without a supplier an '
    + 'invoice can be neither checked nor allocated.',
  belegLegende: 'The Beleg — supporting document (ACC-03)',
  pdfHochladen: 'Upload a PDF',
  belegWaehlen: '… or choose a Beleg (supporting document) already on file',
  belegDesVorschlags: 'The proposal’s Beleg',
  einesVonBeidem:
    'One of the two is required. Without a document no incoming invoice comes '
    + 'into being.',
  bitteWaehlen: 'Please choose — no unique match in the master data',
  faelligAm: 'Due on',
  nettoInEuro: 'Net in Euro',
  umsatzsteuerInEuro: 'Umsatzsteuer (VAT) in Euro',
  bruttoHinweis:
    'The gross amount is computed from net + tax, not entered — a gross amount '
    + 'typed in that does not add up is a document that cannot be booked.',
  erfassen: 'Record',

  ohneLieferant: 'No supplier',
  ohneNummer: 'no number',
  freigabeAnsehen: 'View the approval',
  abgelehntMit: 'Rejected:',
  interneBelegnummer: 'Internal document number',
  entstehtBeimBuchen: 'comes into being on booking',
  offenAnLieferanten: 'Open to the supplier',
  nochKeinPosten: 'no item yet — not booked',

  zahlungenTitel: 'Payments to the supplier',
  keineZahlung: 'No payment recorded yet.',
  tabelleZahlungen: 'Payments to the supplier with date, type and amount',
  zahlungstag: 'Payment date',
  zahlungOeffnen: 'Open payment',
  storniert: 'reversed',
  zahlungErfassenTitel: 'Record a payment to the supplier',
  zahlungErfassenErklaerung:
    'This records a payment that has gone out — the platform does not make '
    + 'transfers, there is no bank connection. Anything above the open amount '
    + 'is then held as a credit with the supplier.',
  betragInEuro: 'Amount in euros (German notation, e.g. 1.190,00)',
  zahlungsweg: 'Payment method',
  vonKonto: 'Paid from account',
  zahlungErfassen: 'Record payment',
  bezahlt: 'This incoming invoice is paid in full, settled on',
  ausgangMeldungen: {
    ausgang_erfasst: 'The payment to the supplier has been recorded.',
    ausgang_guthaben:
      'The payment has been recorded. It exceeded the open amount — the rest is '
      + 'listed as a credit with the supplier among the open items.',
  },
  ausgangFehler: {
    unvollstaendig: 'Amount, payment date and payment method are required.',
    datum: 'The payment date is not a date.',
    betrag: 'The amount is not a euro amount — please write it like 1.190,00.',
    kein_posten: 'This incoming invoice has no open item yet — booking it opens one.',
    schon_ausgeglichen: 'This incoming invoice has already been paid.',
    betrag_nicht_positiv: 'The amount must be greater than zero.',
    bankkonto_fremd: 'The selected account does not belong to this company.',
    abgewiesen:
      'The payment was rejected — is your access allowed to record payments in this '
      + 'company?',
    nicht_gefunden: 'The open item cannot be reached.',
  },
  ausgangFehlerSonst: 'The payment was not recorded.',
  entgeltJeSteuersatz: 'Consideration by tax rate (§15 UStG)',
  keineAufteilung:
    'No breakdown recorded. Without it nothing is booked — a gross amount at a '
    + 'blended rate yields no input VAT deduction.',
  tabelleSteuerzeilen: 'Consideration and tax by tax-rate group',
  herkunftTitel: 'Taken over from an e-invoice',
  herkunftErklaerung:
    'Every value names the element of the file it comes from, and the check it '
    + 'passed.',
  entschiedenWurdeIn: 'The decision was taken in',
  derFreigabe: 'the approval',
  tabelleHerkunft: 'Extracted fields with source and confidence',
  feld: 'Field',
  wert: 'Value',
  konfidenz: 'Confidence',
  quelle: 'Source',
  naechsterSchritt: 'The next step',
  gebuchtUnter: 'Booked under',
  gebuchtErklaerung:
    '. A booked invoice is not moved on any further — it is corrected by a '
    + 'Gegenbuchung (contra entry).',
  abgelehntErklaerung:
    'Rejected. A rejected invoice is recorded afresh, not revived — and it does '
    + 'not block the fresh entry.',
  pruefenErklaerung:
    'Move it into review. From here on the supplier is set and the Beleg '
    + '(supporting document) allocated.',
  grundDerFreigabe: 'Reason for the approval',
  freigabeFriertEin:
    'The approval freezes what was decided upon: supplier, number, date and '
    + 'amount. Whoever changes the invoice afterwards no longer holds an '
    + 'approval for what they book (K-13).',
  buchenErklaerung:
    'Booking draws the internal document number and opens the liability towards '
    + 'the supplier. After that the document is immutable.',
  buchen: 'Book',
  zurueckweisenMitGrund: 'Reject — with a reason',

  freigabe: 'Approval',
  keinLeserechtFreigabe:
    '. It may approve, but not see what it is approving — and an approval '
    + 'without sight of the matter is none. The two rights belong together; who '
    + 'grants them is for role administration to decide.',
  freigabeZurBuchung: 'Approval for booking',
  wasPassiertVor: 'The approval permits the',
  wasPassiertBuchung: 'booking',
  wasPassiertMitte:
    '— it is not a payment instruction. An approval record arises in the '
    + 'approval chain (K-13), and a change of state;',
  wasPassiertBetont: 'nothing leaves the system in the process',
  wasPassiertNach:
    '(invariant 7). Payment comes later, on the payments page, and from a human '
    + 'being.',
  vierAngabenTitel:
    'What is being decided — the approval record freezes exactly these four '
    + 'details',
  bruttobetrag: 'Gross amount',
  keinLieferantZugeordnet: 'no supplier allocated',
  nettoUst: 'Net / USt (VAT)',
  keinBeleg:
    'no Beleg (supporting document) — without one nothing is booked (ACC-03)',
  belegOhneNummer: 'Beleg without a number',
  reverseChargeGreift: 'Reverse charge applies',
  nochNichtGerechnet: 'not computed yet',
  steuerlicheLageKlein: 'tax position',
  vierAugenTitel: 'The four-eyes position (Vier-Augen-Prinzip)',
  keinVierAugen:
    'No four-eyes requirement configured (O-183). This company has recorded no '
    + 'amount above which a second person must approve — and the platform does '
    + 'not invent one. That does NOT mean no threshold is meant to apply; it '
    + 'means nobody has set one.',
  abGrenzeVor: 'From',
  abGrenzeNach:
    'upwards a second person approves: whoever recorded it does not approve it.',
  erfasstHat: 'Recorded by',
  kontoOhneNamen: 'an account without a name',
  istDiesesKonto: ' — that is this account.',
  nichtDiesesKonto: ' — not this account.',
  vierAugenSperrtSatz:
    'This session may therefore NOT approve: it recorded the invoice itself, '
    + 'and the amount is above the threshold.',
  keineSperre:
    'There is therefore no block — for want of a rule, not for want of a reason.',
  darfFreigeben: 'This session may approve.',
  freigegebenWort: 'Approved',
  amDatum: ' on ',
  vonPerson: ' by ',
  begruendungIst: ' Reason: ',
  istGebucht:
    ' The invoice is booked; it is corrected by a Gegenbuchung (contra entry).',
  zurueckgewiesenGrund: 'Rejected. Reason: ',
  zurueckgewiesenNach:
    '. The row remains (invariant 8); a rejected invoice is recorded afresh, '
    + 'not revived.',
  nochNichtPruefbarVor:
    'This invoice is not under review yet. Approval is given from the state',
  nochNichtPruefbarNach:
    '— there the supplier is set and the Beleg (supporting document) allocated.',
  begruendungFuenf: 'Reason (at least five characters)',
  begruendungImSatz:
    'It goes into the approval record, together with the four details above. '
    + 'Whoever changes the invoice afterwards no longer holds an approval for '
    + 'what they book (K-13).',
  gesperrtVierAugen:
    'Blocked: this session recorded the invoice itself, and the amount is above '
    + 'this company’s four-eyes threshold.',
  rechtEntscheidenFehlt:
    ' — without this right no record arises in the approval chain, and without '
    + 'that record there is no approval.',
  zurBuchungFreigeben: 'Approve for booking',
  grundFuenf: 'Reason (at least five characters)',

  keinLeserechtSteuerMitte: '. This route opens with',
  keinLeserechtSteuerNach:
    ', but the invoice itself sits behind the Eingang right — the two sets are '
    + 'not congruent, and which of them is to apply is open (O-604).',
  steuerH1: '§13b UStG and §48 EStG',
  ustIdLieferant: 'Supplier’s USt-IdNr. (VAT identification number)',
  geprueftGegen: 'Checked against',
  keinDatumPruefbar: 'no date — nothing can be checked',
  welchesDatum: 'Which date that is',
  stichtagErklaerung:
    '— that is, the end of the period of supply, failing that the date of '
    + 'supply, failing that the invoice date. The wording of §48 EStG attaches '
    + 'to PAYMENT, SPEC FIN-10 to the date of supply; which of them applies is '
    + 'open (O-176). The decision below was taken against the day named and '
    + 'against no other.',
  titel13b:
    '§13b UStG — Steuerschuldnerschaft des Leistungsempfängers (reverse charge: '
    + 'the recipient owes the Umsatzsteuer)',
  greift: 'applies',
  artText: {
    bau: 'Bauleistung — construction work (§13b (2) no. 4 UStG)',
    gebaeudereinigung: 'Gebäudereinigung — building cleaning (§13b (2) no. 8 UStG)',
  },
  nichtBenannt: 'not named',
  grundlageVor: 'Basis:',
  grundlageNach:
    'This company owes the Umsatzsteuer (VAT) as the recipient of the supply; '
    + 'the supplier shows none.',
  keineVerlagerung:
    'This invoice carries no shift of the tax liability. Without recorded '
    + 'evidence the Umsatzsteuer (VAT) is shown — the safe direction: tax shown '
    + 'without justification is owed (§14c UStG) and can be corrected, whereas '
    + 'liability shifted without justification is a loss at the recipient.',
  hinweistextLautet: 'The fixed note on the document reads:',
  status13bVor:
    'The §13b status of this company’s OWN position as recipient of the supply '
    + 'is recorded nowhere as a time series —',
  status13bMitte: 'carries no field for it, and',
  status13bNach:
    'describes the outgoing side. What stands here is therefore the state '
    + 'stored on the DOCUMENT and not a re-assessment as at today (O-605).',
  titel48:
    '§48 EStG — Bauabzugsteuer (construction withholding tax), three outcomes',
  ausgangNichtBewertbarVor: 'Not assessable —',
  ausgangNichtBewertbarNach: 'is missing',
  ausgangKeinSatz: 'Not computed — no rate recorded',
  ausgangKeineBauleistung: 'Applied: §48 EStG does not apply',
  ausgangBescheinigung:
    'Applied: outcome 1 — valid Freistellungsbescheinigung (exemption certificate)',
  ausgangBagatelle:
    'Applied: outcome 2 — annual total below the Bagatellgrenze (de-minimis '
    + 'threshold)',
  ausgangEinbehalt: 'Applied: outcome 3 — tax is retained',
  nichtBewertbarMitte: '. The policy on',
  nichtBewertbarNach:
    'requires precisely that right, so this supplier’s certificates are '
    + 'invisible here — and an empty list would read as "no certificate" while '
    + 'it means "not visible". No outcome is determined and no retention '
    + 'computed here from a list emptied by RLS (O-604). Whoever decides needs '
    + 'the read right.',
  keinSatzVor: 'This document carries no withholding rate, and the setting',
  keinSatzNach:
    'holds no value. Both are missing — so nothing is computed. 15 % would be a '
    + 'figure out of nowhere here, even though it stands in the statute: the '
    + 'rate is a dated setting, so that a change does not re-assess every '
    + 'historical invoice.',
  ohneStichtag:
    'Without a cut-off date or without an amount nothing can be decided — and '
    + 'nothing is guessed here.',
  grundlageBrutto: 'Basis (gross)',
  satz: 'Rate',
  keinSatzHinterlegt: 'no rate recorded',
  satzAusEinstellungVor: 'From the dated setting',
  satzAusEinstellungNach: '— the document itself carries none.',
  satzVomBeleg:
    'The rate stored on the DOCUMENT. It applies even if the setting names a '
    + 'different one today: the booking followed the document.',
  abweichungVor: 'The document states a retention of',
  abweichungMitte: ', today’s check yields',
  abweichungNach:
    '. The booking followed the document; the difference is something to '
    + 'examine, not a correction.',
  keineBagatellgrenze:
    'No Bagatellgrenze (de-minimis threshold) applied (O-21) — tax is retained.',
  bagatellgrenzeVor: 'Bagatellgrenze (de-minimis threshold):',
  fundstelle: 'Source:',
  jahressummeTitel: 'This provider’s annual total — the second outcome',
  ohneLieferantKeineSumme:
    'Without an allocated supplier there is no annual total. §48 (2) EStG '
    + 'measures per recipient and per provider of the supply.',
  fuerJahrVor: 'For',
  diesesJahr: 'this year',
  fuerJahrNach:
    'no consideration to this provider has been recorded yet. The total arises '
    + 'when an incoming invoice moves to',
  vorAbzugsentscheidung:
    '— that is, BEFORE the withholding decision and not after it.',
  bereitsErbracht: 'Consideration already provided',
  erwarteteJahresgegenleistung: 'Expected annual consideration (§48 (1))',
  nichtEingetragen: 'not entered',
  grundlageErwartung: 'Basis of the expectation',
  fortgeschrieben: 'Updated',
  prognoseErklaerung:
    '· The forecast is entered by a human being and is never derived — an '
    + 'estimated forecast would be one the platform asserts and nobody answers '
    + 'for.',
  fsbTitel:
    'Freistellungsbescheinigungen — exemption certificates under §48b EStG',
  fsbKeinRechtMitte: '— and that is precisely what the policy on',
  fsbKeinRechtNach:
    ' requires. The certificates therefore remain unshown; that is not an empty '
    + 'stock, it is a missing right (O-604).',
  keineFsbHinterlegt:
    'No Freistellungsbescheinigung (exemption certificate) is recorded for this '
    + 'supplier. Without one, tax is retained — that is outcome 3 and not an '
    + 'omission of this page.',
  tabelleFsb:
    'This supplier’s Freistellungsbescheinigungen (exemption certificates) with '
    + 'validity and revocation',
  finanzamt: 'Finanzamt (tax office)',
  gueltig: 'Valid',
  umfang: 'Scope',
  unbeschraenkt: 'unrestricted',
  auftragsbezogen: 'tied to one Auftrag (order)',
  amStichtag: 'On',
  widerrufenAm: 'revoked on',
  gilt: 'valid',
  giltAndererAuftrag: 'valid for a different Auftrag (order)',
  giltNicht: 'not valid on the cut-off date',
  keinDokument: 'no document',
  pflegeOffenBetont:
    'Uploading, setting validity and revoking are not possible here (O-604).',
  pflegeOffenVor:
    'No write right is entered in the register for this route; the policy on',
  pflegeOffenZwei: 'requires',
  pflegeOffenDrei: ' to write, while the route opens with',
  pflegeOffenNach:
    '. Which key is to apply is a decision about the rights model — and a form '
    + 'that runs into a policy rejecting it is worse than no form at all.',
  schlussVor: 'The retained amount comes from',
  schlussNach: 'and never from a model (invariant 6).',
  geprueftNichtVermerkt:
    ' The document does not record that the certificate was checked.',
  geprueftAm: ' According to the document the certificate was checked on',
};

export const EINGANGSRECHNUNGEN_TEXTE: Readonly<
  Record<InternSprache, EingangsrechnungenTexte>
> = { de: DE, en: EN };
