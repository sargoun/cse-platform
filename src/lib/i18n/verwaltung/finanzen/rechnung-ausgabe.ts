/**
 * Die Ausgabe einer Rechnung — die fuenf Blaetter unter
 * `/[mandant]/finanzen/rechnungen/[id]`, die den Beleg pruefen, abrechnen und
 * nach draussen bringen: `/abschlaege`, `/pruefung`, `/versand`,
 * `/xrechnung`, `/zugferd`. In beiden Sprachen.
 *
 * **Fuenf Blaetter, eine Datei.** Der Schnitt laeuft entlang der Teilflaeche
 * und nicht entlang der Datei: die fuenf teilen sich ein Dutzend Woerter —
 * `Entwurf ohne Nummer`, `Pruefstand`, `Regelwerk`, `Leitweg-ID (BT-10)`,
 * `Es entsteht kein Dokument` —, und dasselbe Wort an fuenf Stellen ist
 * fuenfmal die Gelegenheit, es beim naechsten Mal nur an vier davon zu
 * aendern. Die Rechnungsakte daneben (`rechnung-akte.ts`) traegt den Entwurf
 * und seine drei Uebergaenge; hier steht, was aus dem festgeschriebenen Beleg
 * herausgeht.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`). `Abschlagsrechnung`, `Schlussrechnung`, `Storno`,
 * `Festschreibung`, `Sicherheitseinbehalt`, `Umsatzsteuer`, `Leitweg-ID`
 * tragen Rechtsbedeutung (UStG, VOB/B, GoBD, EN 16931). Im Englischen steht
 * der deutsche Begriff und DANEBEN eine kurze Erklaerung in Klammern — nie
 * eine erfundene Entsprechung. `XRechnung` und `ZUGFeRD` sind Eigennamen
 * einer deutschen Norm und heissen auch auf Englisch so.
 *
 * **Warum hier Satzbruchstuecke stehen.** Mehrere Saetze dieser Blaetter
 * tragen einen Betrag, eine Anzahl oder eine Rechnungsnummer MITTEN im Satz.
 * Ein Bruchstueck mit fuehrendem oder abschliessendem Leerzeichen ist
 * deshalb Absicht und kein Tippfehler: das eingesetzte Stueck steht daneben.
 *
 * **Die Nummern offener Fragen (O-20, O-175) stehen im TEXT und wandern
 * mit.** Sie sind der Verweis auf `docs/DECISIONS.md`; eine Uebersetzung, die
 * sie wegliesse, naehme dem englischen Leser genau die Stelle, an der steht,
 * dass hier nichts entschieden ist.
 */
import type { InternSprache } from '../../intern.js';

export interface RechnungAusgabeTexte {
  /* ── Was auf mehreren der fuenf Blaetter steht ─────────────────────── */
  readonly entwurfOhneNummer: string;
  readonly empfaenger: string;
  readonly ja: string;
  readonly nein: string;
  readonly netto: string;
  readonly brutto: string;
  readonly ust: string;
  readonly satz: string;
  readonly steuersatzgruppe: string;
  readonly leitwegId: string;
  readonly xrechnungVerlangt: string;
  readonly pruefstand: string;
  readonly regelwerk: string;
  readonly nichtLesbar: string;
  readonly keinDokumentVor: string;
  readonly pflichtangabenFehlen: string;
  readonly zuPflegenUnter: string;

  /** Die Anfuehrungszeichen — deutsch „…", englisch "…". */
  readonly zitatAuf: string;
  readonly zitatZu: string;

  /** Die beiden Erzeugnisse, benannt wie die Norm sie nennt. */
  readonly xrechnungTitel: string;
  readonly zugferdTitel: string;

  /* ── `/abschlaege` ─────────────────────────────────────────────────── */
  readonly abschlaegeTitel: string;
  readonly auftrag: string;
  readonly keinAuftrag: string;
  readonly rechnungsart: string;
  readonly schlussrechnung: string;
  readonly offenErklaerung: string;
  readonly abschlaegeDesAuftrags: string;
  readonly keinAuftragText: string;
  readonly keinAbschlagText: string;
  readonly tabelleAbschlaege: string;
  readonly storniertAbzugHaeltAn: string;
  readonly nochNichtAbgezogen: string;
  readonly wirdHierAbgezogen: string;
  readonly wirdAnderswoAbgezogen: string;
  readonly abzugJeSteuergruppe: string;
  readonly keinAbzug: string;
  readonly keinAbzugWeilKeiner: string;
  readonly keinAbzugWeilFehler: string;
  readonly aufteilungErklaerung: string;
  readonly tabelleAbzug: string;
  readonly unbekannteSteuergruppe: string;
  readonly bruttoDieserRechnung: string;
  readonly verrechnungssumme: string;
  readonly abzugAufDemBeleg: string;
  readonly zahlbetragKunde: string;
  readonly sicherheitseinbehalt: string;
  readonly offenO20: string;
  readonly imAuftragHinterlegt: string;
  readonly bzw: string;
  readonly nichtsAbgezogenSolangeOffen: string;
  readonly zweiAngabenVor: string;
  readonly zweiBetont: string;
  readonly zweiAngabenNach: string;
  readonly verbleibenderZahlbetrag: string;
  readonly abweichungErklaerung: string;
  readonly abzugSchreibenTitel: string;
  readonly abzugSchreibenVor: string;
  readonly abzugSchreibenAus: string;
  readonly abzugSchreibenNach: string;
  readonly abzugSchreiben: string;
  readonly nurSchlussVor: string;
  readonly nurSchlussMitte: string;
  readonly nurSchlussNach: string;

  /* ── `/pruefung` ───────────────────────────────────────────────────── */
  readonly pruefungTitel: string;
  readonly pruefungH1: string;
  readonly dortBeheben: string;
  readonly festgeschriebenSicht: string;
  readonly blockiertVor: string;
  readonly blockiertNach: string;
  readonly allesDa: string;
  readonly blockierend: string;
  readonly keineBlockierenden: string;
  readonly warnungenTitel: string;
  readonly keineWarnungen: string;
  readonly kleinbetragTitel: string;
  readonly erleichterung: string;
  readonly greift: string;
  readonly greiftNicht: string;
  readonly grenze: string;
  readonly unbestaetigterWertO175: string;
  readonly bruttoDiesesBelegs: string;
  readonly begruendung: string;
  readonly nochNichtGeprueft: string;
  readonly regelwerkFussNach: string;

  /* ── `/versand` ────────────────────────────────────────────────────── */
  readonly versand: string;
  readonly xrechnungZweck: string;
  readonly zugferdZweck: string;
  readonly nichtVerbundenStrong: string;
  readonly nichtVerbundenText: string;
  readonly verbundenVor: string;
  readonly verbundenNach: string;
  readonly wegeTitel: string;
  readonly tabelleWege: string;
  readonly kanal: string;
  /**
   * **Klein geschrieben, und das ist kein Flüchtigkeitsfehler.** Der Wert
   * steht in einer Tabellenzelle neben `nichtVerbunden` — als Aussage über
   * einen Weg, nicht als Schild. `basis.nichtVerbunden` ist gross, weil es
   * dort ein Schild IST; hier stünde „Verbunden" / „Nicht verbunden" mitten
   * im Satz. Der Altstand schrieb beides klein, und beim Wandern des Textes
   * ist der deutsche Wortlaut gewachsen — Text durfte umziehen, nicht sich
   * ändern.
   */
  readonly verbunden: string;
  readonly nichtVerbunden: string;
  readonly warum: string;
  readonly zugangsdatenHinterlegt: string;
  readonly portalUndPost: string;
  readonly empfaengerTitel: string;
  readonly keinLesbarerKunde: string;
  readonly elektronischeAdresse: string;
  readonly verabredeterWeg: string;
  readonly verabredetesFormat: string;
  readonly nichtVerabredet: string;
  readonly bewertetVonVor: string;
  readonly bewertetVonMitte: string;
  readonly blockiert: string;
  readonly bewertetVonNach: string;
  readonly erzeugnisseTitel: string;
  readonly entwurfKeinDokument: string;
  readonly verworfenKeinDokument: string;
  readonly keinSnapshot: string;
  readonly vorschauUndPruefstand: string;
  readonly dateiHerunterladen: string;
  readonly diesemKontoFehlt: string;
  readonly dateiBleibtZu: string;
  readonly pdfPostweg: string;
  readonly protokollTitel: string;
  readonly keinVersandProtokolliert: string;
  readonly tabelleProtokoll: string;
  readonly kanalUndErzeugnis: string;
  readonly empfaengerEingefroren: string;
  readonly leitweg: string;
  readonly freigegeben: string;
  readonly kontoOhneNamen: string;
  readonly gesendet: string;
  readonly zugangTitel: string;
  readonly zugangNichtFestgestellt: string;
  readonly welcheFassung: string;
  readonly versandFreigebenFehltNach: string;
  readonly versandstandFussVor: string;
  readonly versandstandFussNach: string;

  /** Die vier Lagen des Empfaengers — `VersandArt` aus `crm/erechnung.ts`. */
  readonly lageNamen: Readonly<Record<
    'gesperrt' | 'nicht_verbunden' | 'offen' | 'bereit', string>>;

  /** Die vier Zustaende einer Protokollzeile — `VersandStatus` aus 0181. */
  readonly statusTexte: Readonly<Record<
    'freigegeben' | 'gesendet' | 'fehlgeschlagen' | 'nicht_verbunden', string>>;

  /* ── `/xrechnung` ──────────────────────────────────────────────────── */
  readonly dokumentMitLuecken: string;
  readonly xrechnungHerunterladen: string;
  readonly vorschau: string;

  /* ── `/zugferd` ────────────────────────────────────────────────────── */
  readonly zugferdH1: string;
  readonly veraPdfVor: string;
  readonly veraPdfNach: string;
  readonly profil: string;
  readonly eingebetteteDatei: string;
  readonly summenprobe: string;
  readonly summenprobeFehlgeschlagen: string;
  readonly abweichungBei: string;
  readonly summenprobeErklaerung: string;
  readonly pdfOhneRechnung: string;
  readonly ausSnapshotGerendert: string;
  readonly zugferdHerunterladen: string;
  readonly zeilensumme: string;
  readonly nachlassZuschlag: string;
  readonly nettoBeleg: string;
  readonly ustBeleg: string;
  readonly bruttoBeleg: string;
  readonly zahlbetragBeleg: string;
  readonly bereitsGezahlt: string;
  readonly snapshotGestalt: string;
  readonly festgeschriebenAm: string;
  readonly byteGleich: string;
  readonly eingebetteteRechnung: string;
}

const DE: RechnungAusgabeTexte = {
  entwurfOhneNummer: 'Entwurf ohne Nummer',
  empfaenger: 'Empfänger',
  ja: 'ja',
  nein: 'nein',
  netto: 'Netto',
  brutto: 'Brutto',
  ust: 'USt',
  satz: 'Satz',
  steuersatzgruppe: 'Steuersatzgruppe',
  leitwegId: 'Leitweg-ID (BT-10)',
  xrechnungVerlangt: 'XRechnung verlangt',
  pruefstand: 'Prüfstand',
  regelwerk: 'Regelwerk',
  nichtLesbar: 'Diese Rechnung ist nicht lesbar.',
  keinDokumentVor: 'Es entsteht kein Dokument — ',
  pflichtangabenFehlen: ' Pflichtangabe(n) fehlen',
  zuPflegenUnter: 'Zu pflegen unter ',

  zitatAuf: '„',
  zitatZu: '"',

  xrechnungTitel: 'XRechnung (UBL, EN 16931)',
  zugferdTitel: 'ZUGFeRD (PDF/A-3 mit CII)',

  abschlaegeTitel: 'Abschläge und ihr Abzug',
  auftrag: 'Auftrag',
  keinAuftrag: 'kein Auftrag',
  rechnungsart: 'Rechnungsart',
  schlussrechnung: 'Schlussrechnung',
  offenErklaerung:
    'Solange ein Abschlag offen ist, wird diese Schlussrechnung nicht '
    + 'festgeschrieben (FIN-08) — sonst verlangte sie den Auftragswert ein '
    + 'zweites Mal ein.',
  abschlaegeDesAuftrags: 'Die Abschläge dieses Auftrags',
  keinAuftragText:
    'Diese Rechnung hängt an keinem Auftrag. Welche Abschläge zu ihr gehören, '
    + 'lässt sich damit nicht beantworten — und geraten wird hier nichts.',
  keinAbschlagText:
    'Zu diesem Auftrag ist kein festgeschriebener Abschlag und keine Anzahlung '
    + 'ausgestellt. Es gibt nichts abzuziehen.',
  tabelleAbschlaege: 'Frühere Abschläge und Anzahlungen dieses Auftrags',
  storniertAbzugHaeltAn: 'storniert — der Abzug hält an',
  nochNichtAbgezogen: 'noch nicht abgezogen',
  wirdHierAbgezogen: 'wird hier abgezogen',
  wirdAnderswoAbgezogen: 'wird von einer anderen Schlussrechnung abgezogen',
  abzugJeSteuergruppe: 'Der Abzug je Steuersatzgruppe',
  keinAbzug: 'Kein Abzug. ',
  keinAbzugWeilKeiner: 'Es gibt keinen abzuziehenden Abschlag.',
  keinAbzugWeilFehler: 'Der Abzug ist nicht berechenbar — der Grund steht oben.',
  aufteilungErklaerung:
    'Die Aufteilung kommt aus den Steuerzeilen der abgezogenen Belege und wird '
    + 'summiert, nicht gerundet. Ein aus dem Brutto zurückgerechneter Mischsatz '
    + 'stünde auf keinem der beiden Belege (Invariante 1).',
  tabelleAbzug: 'Abzug je Steuersatzgruppe',
  unbekannteSteuergruppe: 'unbekannte Steuersatzgruppe',
  bruttoDieserRechnung: 'Brutto dieser Rechnung',
  verrechnungssumme: 'Verrechnungssumme (berechnet)',
  abzugAufDemBeleg: 'Abzug, wie er auf dem Beleg steht',
  zahlbetragKunde: 'Zahlbetrag des Kunden',
  sicherheitseinbehalt: 'Sicherheitseinbehalt (VOB/B §17)',
  offenO20: ' — offen (O-20)',
  imAuftragHinterlegt: 'Im Auftrag hinterlegt: ',
  bzw: 'bzw.',
  nichtsAbgezogenSolangeOffen:
    '. Abgezogen wird davon nichts, solange die Regel dazu offen ist.',
  zweiAngabenVor: 'Es stehen ',
  zweiBetont: 'zwei',
  zweiAngabenNach:
    ' Angaben im Auftrag — ein Prozentsatz und ein Betrag. Welche gilt, wenn '
    + 'sie sich widersprechen, ist nicht entschieden: es steht in derselben '
    + 'offenen Frage wie die Einbehaltsregel selbst (O-20). Beide werden '
    + 'deshalb gezeigt und keine verschwiegen.',
  verbleibenderZahlbetrag: 'Verbleibender Zahlbetrag',
  abweichungErklaerung:
    'Der berechnete Abzug und der Abzug auf dem Beleg weichen ab. Auf einem '
    + 'Entwurf heisst das: der Abzug ist noch nicht geschrieben. Auf einem '
    + 'festgeschriebenen Beleg heisst es, dass sich die Abschläge danach '
    + 'verändert haben — und dann gilt der Beleg, nicht die Rechnung von heute.',
  abzugSchreibenTitel: 'Abzug an den Entwurf schreiben',
  abzugSchreibenVor: 'Es entstehen die Bezugszeilen und der Kopfbetrag — ',
  abzugSchreibenAus: ' aus ',
  abzugSchreibenNach:
    '. Nur an einem Entwurf: nach dem Festschreiben ist der Beleg '
    + 'unveränderlich.',
  abzugSchreiben: 'Abzug schreiben',
  nurSchlussVor: 'Abschläge werden nur von einer ',
  nurSchlussMitte: ' abgezogen. Diese Rechnung ist eine der Art ',
  nurSchlussNach:
    '; die Liste oben zeigt den Stand des Auftrags, aber es gibt hier nichts '
    + 'zu verrechnen.',

  pruefungTitel: '§14-UStG-Prüfung',
  pruefungH1: 'Pflichtangaben nach §14 UStG',
  dortBeheben: 'Dort beheben →',
  festgeschriebenSicht:
    'Dieser Beleg ist festgeschrieben. Der Bericht unten ist die heutige Sicht '
    + 'auf die gedruckten Angaben; der Befund, mit dem festgeschrieben wurde, '
    + 'steht unveränderlich im Snapshot.',
  blockiertVor: 'Die Festschreibung ist blockiert: ',
  blockiertNach:
    ' Pflichtangabe(n) fehlen. Alle fehlenden Felder stehen unten — nicht nur '
    + 'das erste.',
  allesDa:
    'Alle geprüften Pflichtangaben liegen vor. Die Festschreibung ist aus '
    + 'Sicht dieser Prüfung möglich.',
  blockierend: 'Blockierend',
  keineBlockierenden: 'Keine blockierenden Befunde.',
  warnungenTitel: 'Warnungen — sie halten den Beleg nicht auf',
  keineWarnungen: 'Keine Warnungen.',
  kleinbetragTitel: 'Kleinbetragsrechnung (§33 UStDV)',
  erleichterung: 'Erleichterung',
  greift: 'greift',
  greiftNicht: 'greift nicht',
  grenze: 'Grenze',
  unbestaetigterWertO175: ' — unbestätigter Wert (O-175)',
  bruttoDiesesBelegs: 'Brutto dieses Belegs',
  begruendung: 'Begründung',
  nochNichtGeprueft: 'Was diese Prüfung noch nicht prüft',
  regelwerkFussNach:
    '. Der vollständige Befund wird beim Festschreiben in den Snapshot '
    + 'eingefroren — damit später nachvollziehbar bleibt, welche Regeln auf '
    + 'diesen Beleg angewandt wurden.',

  versand: 'Versand',
  xrechnungZweck: 'für öffentliche Auftraggeber',
  zugferdZweck: 'für gewerbliche Kunden, die eine PDF erwarten',
  nichtVerbundenStrong:
    'Versand nicht verbunden (O-36) — die Datei lässt sich herunterladen und '
    + 'von Hand versenden.',
  nichtVerbundenText:
    ' Es ist nicht entschieden, welcher EU-gehostete Transaktionsmailer unter '
    + 'welchem Auftragsverarbeitungsvertrag ausliefert, und kein '
    + 'Peppol-Zugangspunkt ist eingerichtet (O-22). Es gibt deshalb keinen '
    + 'Sendeknopf — und keinen vorgetäuschten Erfolg: ein Protokolleintrag '
    + '„gesendet" ohne Versand ist die Auskunft, dass eine Rechnung draussen '
    + 'sei, die es nicht ist.',
  verbundenVor:
    'Mindestens ein Kanal ist verbunden. Gesendet wird trotzdem nur nach '
    + 'menschlicher Zustimmung: es entsteht eine Freigabe, und erst sie '
    + 'erlaubt den Versand (Invariante 7, ',
  verbundenNach: '). Automatisch verlässt nichts das Haus.',
  wegeTitel: 'Die Wege und ihr Zustand',
  tabelleWege: 'Übertragungswege und ob sie verbunden sind',
  kanal: 'Kanal',
  verbunden: 'verbunden',
  nichtVerbunden: 'nicht verbunden',
  warum: 'Warum',
  zugangsdatenHinterlegt: 'Zugangsdaten hinterlegt.',
  portalUndPost:
    'Kundenportal und Post stehen nicht in dieser Liste: das Portal zeigt das '
    + 'Dokument, und Papier kuvertiert ein Mensch. Beides ist kein '
    + 'elektronischer Versand durch die Plattform und braucht keine Verbindung.',
  empfaengerTitel: 'Was der Empfänger erwartet',
  keinLesbarerKunde: 'Diese Rechnung hat keinen lesbaren Kunden.',
  elektronischeAdresse: 'Elektronische Adresse',
  verabredeterWeg: 'Verabredeter Weg',
  verabredetesFormat: 'Verabredetes Format',
  nichtVerabredet: 'nicht verabredet',
  bewertetVonVor: 'Bewertet von ',
  bewertetVonMitte:
    ' — derselben Stelle, die den Kundenstamm bewertet. Ein Käufer mit '
    + 'XRechnungspflicht ohne hinterlegten Weg ',
  blockiert: 'blockiert',
  bewertetVonNach:
    ' den Versand, statt auf einen Kanal zurückzufallen (07-INTEGRATIONEN '
    + '§12.1). Zwei Formulierungen derselben Regel wären eine zu viel.',
  erzeugnisseTitel: 'Die Erzeugnisse',
  entwurfKeinDokument:
    'Dieser Beleg ist ein Entwurf. XRechnung und ZUGFeRD entstehen erst bei '
    + 'der Festschreibung, weil sie die Nummer und den Zeitpunkt tragen — und '
    + 'weil sie aus dem Snapshot gerendert werden, nie aus den heutigen '
    + 'Stammdaten (K-12).',
  verworfenKeinDokument:
    'Dieser Entwurf ist verworfen. Es gibt kein Dokument zu versenden.',
  keinSnapshot:
    'Zu diesem Beleg gibt es keinen Snapshot. Ohne ihn entstünde das Dokument '
    + 'aus den heutigen Stammdaten — also ein zweites Dokument zu derselben '
    + 'Nummer (K-12). Das ist ein Prüfauftrag.',
  vorschauUndPruefstand: 'Vorschau und Prüfstand →',
  dateiHerunterladen: 'Datei herunterladen',
  diesemKontoFehlt: 'Diesem Konto fehlt ',
  dateiBleibtZu: ' — die Datei bleibt zu.',
  pdfPostweg:
    'Ein PDF für den Postweg ist dasselbe ZUGFeRD-Dokument: es ist ein '
    + 'gültiges PDF/A-3 und lässt sich drucken. Ein zweiter PDF-Erzeuger '
    + 'daneben wäre eine zweite Fassung derselben Rechnung.',
  protokollTitel: 'Das Protokoll',
  keinVersandProtokolliert:
    'Kein Versand protokolliert. Das heisst: diese Rechnung ist über die '
    + 'Plattform nicht hinausgegangen — nicht, dass der Kunde sie nicht hat. '
    + 'Wurde sie von Hand versendet, steht das hier nicht, und dieser '
    + 'Unterschied ist wichtig: §286 BGB rechnet ab ZUGANG, und einen Zugang, '
    + 'den niemand festgestellt hat, darf kein Mahnlauf unterstellen.',
  tabelleProtokoll: 'Freigegebene Versandvorgänge dieser Rechnung',
  kanalUndErzeugnis: 'Kanal und Erzeugnis',
  empfaengerEingefroren: 'Empfänger (eingefroren)',
  leitweg: 'Leitweg',
  freigegeben: 'Freigegeben',
  kontoOhneNamen: 'Konto ohne Namen',
  gesendet: 'gesendet',
  zugangTitel: 'Zugang (§286 BGB)',
  zugangNichtFestgestellt: 'nicht festgestellt — kein Verzugsbeginn',
  welcheFassung: 'Welche Fassung',
  versandFreigebenFehltNach:
    '. Es sieht das Protokoll, gibt aber keinen Versand frei — und ein Knopf, '
    + 'der in ein 403 führt, verrät nur, was er nicht zeigt.',
  versandstandFussVor:
    'Der Versandstand ist ein Kind der Rechnung und keine Spalte darauf '
    + '(K-12): an einem festgeschriebenen Beleg ändert sich nichts, am Versand '
    + 'dauernd. ',
  versandstandFussNach:
    ' belegt, welche Fassung hinausging — weil das Dokument aus dem Snapshot '
    + 'mit dem Festschreibungszeitpunkt gerendert wird, ergibt derselbe Beleg '
    + 'bei jedem Abruf byte-gleich dieselbe Datei (Invariante 5, K-11), und '
    + 'der Hash ist damit nachprüfbar.',

  lageNamen: {
    gesperrt: 'Versand gesperrt',
    nicht_verbunden: 'Weg verabredet, Hafen nicht verbunden',
    offen: 'Kein Zustellweg verabredet',
    bereit: 'Zustellweg steht',
  },

  statusTexte: {
    freigegeben: 'freigegeben — noch nicht gesendet',
    gesendet: 'gesendet',
    fehlgeschlagen: 'fehlgeschlagen',
    nicht_verbunden: 'nicht verbunden — es wurde nichts gesendet',
  },

  dokumentMitLuecken:
    'Ein Dokument mit Lücken sieht aus wie ein vollständiges und wird beim '
    + 'Empfänger abgewiesen. Es entsteht deshalb gar nicht erst.',
  xrechnungHerunterladen: 'XRechnung herunterladen',
  vorschau: 'Vorschau',

  zugferdH1: 'ZUGFeRD 2.x (PDF/A-3 mit CII)',
  veraPdfVor: 'Geprüft wird das PDF/A-3 mit veraPDF im Bau (',
  veraPdfNach:
    '), nicht beim Aufruf. Die Aussage gilt dem Erzeuger, nicht diesem Beleg.',
  profil: 'Profil',
  eingebetteteDatei: 'Eingebettete Datei',
  summenprobe: 'Summenprobe',
  summenprobeFehlgeschlagen: 'Die Summenprobe geht nicht auf.',
  abweichungBei: 'Abweichung bei: ',
  summenprobeErklaerung:
    '. Ein Dokument, dessen eingebettete Summen von den Kopfsummen des Belegs '
    + 'abweichen, wird beim Empfänger abgewiesen — und zwar nachdem er es '
    + 'eingelesen hat.',
  pdfOhneRechnung:
    'Ein PDF ohne die eingebettete Rechnung wäre ein ZUGFeRD-Dokument, das '
    + 'keines ist. Es entsteht deshalb gar nicht erst — hier steht die ganze '
    + 'Liste, nicht das erste fehlende Feld.',
  ausSnapshotGerendert:
    'Das PDF wird aus dem Snapshot gerendert, nie aus den heutigen Stammdaten '
    + '(K-12) — sonst entstünde ein zweites Dokument zu derselben Nummer.',
  zugferdHerunterladen: 'ZUGFeRD-PDF herunterladen',
  zeilensumme: 'Zeilensumme (BT-106)',
  nachlassZuschlag: 'Nachlass / Zuschlag',
  nettoBeleg: 'Netto (BT-109) · Beleg',
  ustBeleg: 'USt (BT-110) · Beleg',
  bruttoBeleg: 'Brutto (BT-112) · Beleg',
  zahlbetragBeleg: 'Zahlbetrag (BT-115) · Beleg',
  bereitsGezahlt: 'Bereits gezahlt (Abzug früherer Abschläge, BT-113)',
  snapshotGestalt: 'Snapshot-Gestalt ',
  festgeschriebenAm: ', festgeschrieben ',
  byteGleich:
    '. Das PDF trägt diesen Zeitpunkt als Erzeugungsdatum — deshalb ergibt '
    + 'derselbe Beleg bei jedem Abruf byte-gleich dieselbe Datei, und ihr '
    + 'SHA-256 taugt als Nachweis (Invariante 5, K-11).',
  eingebetteteRechnung: 'Eingebettete Rechnung',
};

const EN: RechnungAusgabeTexte = {
  entwurfOhneNummer: 'Draft without a number',
  empfaenger: 'Recipient',
  ja: 'yes',
  nein: 'no',
  netto: 'Net',
  brutto: 'Gross',
  ust: 'USt (VAT)',
  satz: 'Rate',
  steuersatzgruppe: 'Tax-rate group',
  leitwegId: 'Leitweg-ID (routing ID, BT-10)',
  xrechnungVerlangt: 'XRechnung required',
  pruefstand: 'Validation status',
  regelwerk: 'Rule set',
  nichtLesbar: 'This invoice cannot be read.',
  keinDokumentVor: 'No document is produced — ',
  pflichtangabenFehlen: ' mandatory field(s) missing',
  zuPflegenUnter: 'To be maintained under ',

  zitatAuf: '"',
  zitatZu: '"',

  xrechnungTitel: 'XRechnung (UBL, EN 16931)',
  zugferdTitel: 'ZUGFeRD (PDF/A-3 with CII)',

  abschlaegeTitel: 'Abschläge (interim invoices) and their set-off',
  auftrag: 'Auftrag (order)',
  keinAuftrag: 'no Auftrag',
  rechnungsart: 'Invoice type',
  schlussrechnung: 'Schlussrechnung (final invoice)',
  offenErklaerung:
    'As long as an Abschlag is outstanding, this Schlussrechnung is not '
    + 'finalised (festgeschrieben, FIN-08) — otherwise it would claim the '
    + 'order value a second time.',
  abschlaegeDesAuftrags: 'The Abschläge of this Auftrag',
  keinAuftragText:
    'This invoice is not attached to an Auftrag. Which Abschläge belong to it '
    + 'therefore cannot be established — and nothing is guessed here.',
  keinAbschlagText:
    'No finalised Abschlagsrechnung and no Anzahlung (payment on account) has '
    + 'been issued for this Auftrag. There is nothing to set off.',
  tabelleAbschlaege: 'Earlier Abschläge and Anzahlungen of this Auftrag',
  storniertAbzugHaeltAn:
    'Storno (reversing entry) — the set-off still stands',
  nochNichtAbgezogen: 'not yet set off',
  wirdHierAbgezogen: 'set off here',
  wirdAnderswoAbgezogen: 'set off by another Schlussrechnung',
  abzugJeSteuergruppe: 'The set-off per tax-rate group',
  keinAbzug: 'No set-off. ',
  keinAbzugWeilKeiner: 'There is no Abschlag to set off.',
  keinAbzugWeilFehler:
    'The set-off cannot be computed — the reason is stated above.',
  aufteilungErklaerung:
    'The split comes from the tax lines of the documents set off and is added '
    + 'up, not rounded. A blended rate worked back from the gross amount would '
    + 'appear on neither of the two documents (invariant 1).',
  tabelleAbzug: 'Set-off per tax-rate group',
  unbekannteSteuergruppe: 'unknown tax-rate group',
  bruttoDieserRechnung: 'Gross of this invoice',
  verrechnungssumme: 'Set-off total (computed)',
  abzugAufDemBeleg: 'Set-off as it stands on the document',
  zahlbetragKunde: 'Amount payable by the customer',
  sicherheitseinbehalt:
    'Sicherheitseinbehalt (retention, VOB/B §17)',
  offenO20: ' — open (O-20)',
  imAuftragHinterlegt: 'Held on the Auftrag: ',
  bzw: 'or',
  nichtsAbgezogenSolangeOffen:
    '. Nothing is deducted from it while the rule for it is open.',
  zweiAngabenVor: 'The Auftrag carries ',
  zweiBetont: 'two',
  zweiAngabenNach:
    ' figures — a percentage and an amount. Which one applies if they '
    + 'contradict each other has not been decided: it sits in the same open '
    + 'question as the retention rule itself (O-20). Both are therefore shown '
    + 'and neither is withheld.',
  verbleibenderZahlbetrag: 'Remaining amount payable',
  abweichungErklaerung:
    'The computed set-off and the set-off on the document differ. On a draft '
    + 'that means the set-off has not been written yet. On a finalised '
    + '(festgeschrieben) document it means the Abschläge changed afterwards — '
    + 'and then the document governs, not today’s calculation.',
  abzugSchreibenTitel: 'Write the set-off to the draft',
  abzugSchreibenVor: 'This creates the reference lines and the header amount — ',
  abzugSchreibenAus: ' from ',
  abzugSchreibenNach:
    '. On a draft only: once finalised (festgeschrieben), the document is '
    + 'immutable.',
  abzugSchreiben: 'Write set-off',
  nurSchlussVor: 'Abschläge are only set off by a ',
  nurSchlussMitte: '. This invoice is of type ',
  nurSchlussNach:
    '; the list above shows the state of the Auftrag, but there is nothing to '
    + 'set off here.',

  pruefungTitel: '§14 UStG check',
  pruefungH1: 'Mandatory particulars under §14 UStG',
  dortBeheben: 'Fix it there →',
  festgeschriebenSicht:
    'This document is finalised (festgeschrieben). The report below is '
    + 'today’s view of the particulars printed on it; the findings it was '
    + 'finalised with sit unchangeably in the snapshot.',
  blockiertVor: 'Festschreibung (finalisation) is blocked: ',
  blockiertNach:
    ' mandatory particular(s) missing. Every missing field is listed below — '
    + 'not just the first.',
  allesDa:
    'All mandatory particulars checked are present. As far as this check goes, '
    + 'Festschreibung (finalisation) is possible.',
  blockierend: 'Blocking',
  keineBlockierenden: 'No blocking findings.',
  warnungenTitel: 'Warnings — they do not hold the document up',
  keineWarnungen: 'No warnings.',
  kleinbetragTitel: 'Kleinbetragsrechnung (small-amount invoice, §33 UStDV)',
  erleichterung: 'Relief',
  greift: 'applies',
  greiftNicht: 'does not apply',
  grenze: 'Threshold',
  unbestaetigterWertO175: ' — unconfirmed value (O-175)',
  bruttoDiesesBelegs: 'Gross of this document',
  begruendung: 'Reasoning',
  nochNichtGeprueft: 'What this check does not yet check',
  regelwerkFussNach:
    '. The full findings are frozen into the snapshot at Festschreibung '
    + '(finalisation) — so it remains traceable later which rules were applied '
    + 'to this document.',

  versand: 'Dispatch',
  xrechnungZweck: 'for public-sector buyers',
  zugferdZweck: 'for commercial customers who expect a PDF',
  nichtVerbundenStrong:
    'Dispatch not connected (O-36) — the file can be downloaded and sent by '
    + 'hand.',
  nichtVerbundenText:
    ' It has not been decided which EU-hosted transactional mailer delivers '
    + 'under which data-processing agreement, and no Peppol access point is '
    + 'set up (O-22). There is therefore no send button — and no pretended '
    + 'success: a log entry reading "sent" without a dispatch is the statement '
    + 'that an invoice is out of the house when it is not.',
  verbundenVor:
    'At least one channel is connected. Even so, nothing is sent without human '
    + 'approval: an approval is raised, and only that permits dispatch '
    + '(invariant 7, ',
  verbundenNach: '). Nothing leaves the house automatically.',
  wegeTitel: 'The channels and their state',
  tabelleWege: 'Transmission channels and whether they are connected',
  kanal: 'Channel',
  verbunden: 'connected',
  nichtVerbunden: 'not connected',
  warum: 'Why',
  zugangsdatenHinterlegt: 'Credentials are configured.',
  portalUndPost:
    'The customer portal and the post are not in this list: the portal shows '
    + 'the document, and a person puts paper in an envelope. Neither is '
    + 'electronic dispatch by the platform, and neither needs a connection.',
  empfaengerTitel: 'What the recipient expects',
  keinLesbarerKunde: 'This invoice has no readable customer.',
  elektronischeAdresse: 'Electronic address',
  verabredeterWeg: 'Agreed channel',
  verabredetesFormat: 'Agreed format',
  nichtVerabredet: 'not agreed',
  bewertetVonVor: 'Assessed by ',
  bewertetVonMitte:
    ' — the same place that assesses the customer record. A buyer subject to '
    + 'XRechnung without a channel on file ',
  blockiert: 'blocks',
  bewertetVonNach:
    ' dispatch instead of falling back to some channel (07-INTEGRATIONEN '
    + '§12.1). Two wordings of the same rule would be one too many.',
  erzeugnisseTitel: 'The documents produced',
  entwurfKeinDokument:
    'This document is a draft. XRechnung and ZUGFeRD come into being only at '
    + 'Festschreibung (finalisation), because they carry the number and the '
    + 'timestamp — and because they are rendered from the snapshot, never from '
    + 'today’s master data (K-12).',
  verworfenKeinDokument:
    'This draft has been discarded. There is no document to dispatch.',
  keinSnapshot:
    'There is no snapshot for this document. Without one the document would be '
    + 'produced from today’s master data — that is, a second document '
    + 'under the same number (K-12). This is a case to investigate.',
  vorschauUndPruefstand: 'Preview and validation status →',
  dateiHerunterladen: 'Download file',
  diesemKontoFehlt: 'This account lacks ',
  dateiBleibtZu: ' — the file stays shut.',
  pdfPostweg:
    'A PDF for the post is the same ZUGFeRD document: it is a valid PDF/A-3 '
    + 'and can be printed. A second PDF generator beside it would be a second '
    + 'version of the same invoice.',
  protokollTitel: 'The log',
  keinVersandProtokolliert:
    'No dispatch logged. That means this invoice has not gone out through the '
    + 'platform — not that the customer does not have it. If it was sent by '
    + 'hand, that is not recorded here, and the difference matters: §286 BGB '
    + 'runs from RECEIPT, and no dunning run may assume a receipt nobody has '
    + 'established.',
  tabelleProtokoll: 'Approved dispatches of this invoice',
  kanalUndErzeugnis: 'Channel and document',
  empfaengerEingefroren: 'Recipient (frozen)',
  leitweg: 'Leitweg',
  freigegeben: 'Approved',
  kontoOhneNamen: 'account without a name',
  gesendet: 'sent',
  zugangTitel: 'Receipt (§286 BGB)',
  zugangNichtFestgestellt: 'not established — Verzug (default) does not begin',
  welcheFassung: 'Which version',
  versandFreigebenFehltNach:
    '. It sees the log but approves no dispatch — and a button that leads to a '
    + '403 only gives away what it does not show.',
  versandstandFussVor:
    'The dispatch state is a child of the invoice and not a column on it '
    + '(K-12): nothing changes on a finalised (festgeschrieben) document, '
    + 'while dispatch changes constantly. ',
  versandstandFussNach:
    ' records which version went out — because the document is rendered from '
    + 'the snapshot with the Festschreibung timestamp, the same document '
    + 'yields the byte-identical file on every retrieval (invariant 5, K-11), '
    + 'and the hash is therefore verifiable.',

  lageNamen: {
    gesperrt: 'Dispatch blocked',
    nicht_verbunden: 'Channel agreed, access point not connected',
    offen: 'No delivery channel agreed',
    bereit: 'Delivery channel in place',
  },

  statusTexte: {
    freigegeben: 'approved — not yet sent',
    gesendet: 'sent',
    fehlgeschlagen: 'failed',
    nicht_verbunden: 'not connected — nothing was sent',
  },

  dokumentMitLuecken:
    'A document with gaps looks like a complete one and is rejected by the '
    + 'recipient. It is therefore not produced at all.',
  xrechnungHerunterladen: 'Download XRechnung',
  vorschau: 'Preview',

  zugferdH1: 'ZUGFeRD 2.x (PDF/A-3 with CII)',
  veraPdfVor: 'The PDF/A-3 is checked with veraPDF in the build (',
  veraPdfNach:
    '), not on request. The statement applies to the generator, not to this '
    + 'document.',
  profil: 'Profile',
  eingebetteteDatei: 'Embedded file',
  summenprobe: 'Totals check',
  summenprobeFehlgeschlagen: 'The totals check does not balance.',
  abweichungBei: 'Deviation in: ',
  summenprobeErklaerung:
    '. A document whose embedded totals differ from the header totals of the '
    + 'invoice is rejected by the recipient — and rejected after they have '
    + 'read it in.',
  pdfOhneRechnung:
    'A PDF without the embedded invoice would be a ZUGFeRD document that is '
    + 'none. It is therefore not produced at all — the whole list is here, not '
    + 'the first missing field.',
  ausSnapshotGerendert:
    'The PDF is rendered from the snapshot, never from today’s master '
    + 'data (K-12) — otherwise a second document under the same number would '
    + 'come into being.',
  zugferdHerunterladen: 'Download ZUGFeRD PDF',
  zeilensumme: 'Sum of line items (BT-106)',
  nachlassZuschlag: 'Allowance / charge',
  nettoBeleg: 'Net (BT-109) · document',
  ustBeleg: 'USt (BT-110) · document',
  bruttoBeleg: 'Gross (BT-112) · document',
  zahlbetragBeleg: 'Amount payable (BT-115) · document',
  bereitsGezahlt: 'Already paid (set-off of earlier Abschläge, BT-113)',
  snapshotGestalt: 'Snapshot shape ',
  festgeschriebenAm: ', finalised (festgeschrieben) ',
  byteGleich:
    '. The PDF carries this timestamp as its creation date — which is why the '
    + 'same document yields the byte-identical file on every retrieval, and '
    + 'its SHA-256 serves as evidence (invariant 5, K-11).',
  eingebetteteRechnung: 'Embedded invoice',
};

export const RECHNUNG_AUSGABE_TEXTE:
Readonly<Record<InternSprache, RechnungAusgabeTexte>> = { de: DE, en: EN };
