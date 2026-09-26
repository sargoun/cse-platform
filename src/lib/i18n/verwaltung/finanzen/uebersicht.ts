/**
 * Die sechs Blaetter, die das Buch von aussen zeigen — in beiden Sprachen:
 * `/[mandant]/finanzen` (die Uebersicht), `/finanzen/ausgangsbuch`,
 * `/finanzen/hashkette`, `/finanzen/nummernkreise`, `/finanzen/pruefungen`
 * und `/gruppe/finanzen`.
 *
 * **Sechs Blaetter, eine Datei.** Der Schnitt laeuft entlang der Teilflaeche
 * und nicht entlang des Bildschirms (siehe den Kopf von `zahlungen.ts`).
 * Diese sechs teilen ihren Wortschatz bis in die Spaltenkoepfe:
 * `Nummernkreis`, `Kette`, `Glied`, `Beleg`, `fakturiert`, `netto`. Dasselbe
 * Wort an sechs Stellen ist sechs Gelegenheiten, es beim naechsten Mal nur an
 * fuenf davon zu aendern.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`). `Nummernkreis`, `Festschreibung`, `Storno`, `Abschlag`,
 * `Schlussrechnung`, `Gutschrift`, `Beleg`, `Mahnung`, `Mahnstufe`,
 * `Auftrag`, `Umsatzsteuer/USt` und `BWA` tragen Rechtsbedeutung (UStG, AO,
 * GoBD, VOB, HGB). Im Englischen steht der deutsche Begriff und DANEBEN eine
 * kurze Erklaerung in Klammern — nie eine erfundene Entsprechung. Die
 * Erklaerung steht einmal je Blatt, dort wo Platz ist (Titel, Leerzustand,
 * Fliesstext); in einem Spaltenkopf steht der blosse Begriff, weil ein Kopf
 * kein Ort fuer eine Klammer ist.
 *
 * **Spalten-, Funktions-, Rechte- und Jobnamen stehen NICHT hier.** `fin.
 * rechnung_nummer_ziehen`, `ist_platzhalter`, `genesis_hash`, `kette_pruefen`,
 * `zeit.lesen` lauten in beiden Sprachen gleich; sie stehen als Konstante im
 * Seitenrumpf, wo eine zweite Spalte nur eine Erfindung waere.
 *
 * **Warum hier Satzbruchstuecke stehen.** Fast jede Aussage dieser Blaetter
 * traegt eine Zahl, einen Hash oder einen Namen MITTEN im Satz: „12 Belege,
 * Nummern 1–12, Summe 4.284,00 €". Ein Bruchstueck ist deshalb Absicht und
 * kein Tippfehler; wo der englische Satz anders gebaut ist, steht die Fuge
 * anderswo — der Satz muss auf Englisch richtig sein, nicht gleich gebaut.
 *
 * **Die Zustaende sind Schluessel und wandern nie.** `standard`…`storno`
 * (`rechnungsart`), `nie`/`jaehrlich` (`zuruecksetzung`) und die neun
 * Bruchgruende aus `kettenlauf.ts` bleiben, wie sie sind; uebersetzt wird nur
 * ihre Beschriftung. Die Pille waehlt ihre Farbe weiter ueber ihren deutschen
 * `zustand` (DESIGN §5) und uebersetzt sich selbst.
 *
 * **Die offenen Fragen bleiben Fragen.** O-134 (Maske und Ruecksetzung der
 * Nummernkreise), O-352 (wer den Jahreswechsel ausfuehrt), O-357 (wer die
 * Kettenmeldung bekommt), O-601/O-602 (die weiteren Vorab-Pruefungen) und
 * O-606 (der Widerspruch in den Demokreisen) stehen in beiden Sprachen als
 * offen da. Der englische Text nennt dieselbe Nummer und behauptet nirgends
 * eine Antwort, die der deutsche nicht gibt.
 */
import type { InternSprache } from '../../intern.js';

/**
 * Die Ziele der Bereichskarten auf `/[mandant]/finanzen` — der Pfad ist
 * zugleich der Schluessel. Ein Pfad ohne Text ist damit ein Fehler beim
 * Uebersetzen und keine leere Karte beim Kunden.
 */
export type KartenZiel =
  | 'finanzen/rechnungen'
  | 'finanzen/zahlungen'
  | 'finanzen/eingangsrechnungen'
  | 'finanzen/lieferanten'
  | 'finanzen/mahnungen'
  | 'finanzen/ausgangsbuch'
  | 'finanzen/ausgaben'
  | 'finanzen/belege'
  | 'finanzen/pruefungen'
  | 'finanzen/nummernkreise'
  | 'finanzen/hashkette'
  | 'buchhaltung/archiv';

export interface KarteTexte {
  readonly titel: string;
  readonly text: string;
}

/** Die Werte des Enums `rechnungsart` (0121). */
type RechnungsartSchluessel =
  'standard' | 'abschlag' | 'anzahlung' | 'schluss' | 'storno';

/** Die Werte des Enums `zuruecksetzung` — `Zuruecksetzung` aus `kreisuebersicht.ts`. */
type ZuruecksetzungSchluessel = 'nie' | 'jaehrlich';

/**
 * Die neun Bruchgruende — `KettenBruch['grund']` aus `kettenlauf.ts`, das die
 * fuenf aus `hash-chain.ts` um vier eigene erweitert.
 *
 * **Die Aufzaehlung steht hier abgeschrieben und wird nicht importiert**, weil
 * `lib/i18n` nichts aus `server/services` zieht (dieselbe Linie wie die
 * Zahlungsmittel in `zahlungen.ts`). Der Abgleich passiert trotzdem beim
 * Uebersetzen: der Seitenrumpf greift die Tabelle mit einem Wert vom Typ
 * `KettenBruch['grund']`, und ein neuer Grund in `kettenlauf.ts` hat hier dann
 * keinen Schluessel — das ist ein Fehler im Bau und keine leere Zelle.
 */
type BruchgrundSchluessel =
  | 'hash_falsch'
  | 'nutzlast_veraendert'
  | 'verkettung_gebrochen'
  | 'position_luecke'
  | 'format_ungueltig'
  | 'kopf_weicht_ab'
  | 'ohne_kettenglied'
  | 'kreisuebergang_gebrochen'
  | 'kettenkopf_weicht_ab';

export interface UebersichtTexte {
  /* ── Die Finanzuebersicht ──────────────────────────────────────────── */
  readonly finanzen: string;
  readonly bereiche: string;
  readonly fakturiert: string;
  readonly netto: string;
  readonly rechnungenZahl: string;
  readonly rechnungsentwuerfe: string;
  readonly offeneForderungen: string;
  readonly ueberfaellig: string;
  readonly posten: string;
  readonly eingangsrechnungenZuPruefen: string;
  readonly eingang: string;
  /** V-215: die Kachel der Betriebsausgaben des Jahres. */
  readonly ausgabenKachel: string;
  readonly freigegebenGebucht: string;
  readonly mahnungenInArbeit: string;
  readonly kachelFussnote: string;
  readonly karten: Readonly<Record<KartenZiel, KarteTexte>>;

  /* ── Das Rechnungsausgangsbuch ─────────────────────────────────────── */
  readonly ausgangsbuchTitel: string;
  /** Die Ueberschrift — mit der Erklaerung, fuer die im Streifen kein Platz ist. */
  readonly ausgangsbuchUeberschrift: string;
  readonly jahr: string;
  readonly jahrAlle: string;
  readonly anzeigen: string;
  readonly abstimmung: string;
  readonly keineRechnungImZeitraum: string;
  readonly belegeWort: string;
  readonly nummernWort: string;
  /** „Summe" mitten im Satz — auf Englisch klein, weil es dort kein Substantiv ist. */
  readonly summeKlein: string;
  readonly buchUndBelegeStimmen: string;
  readonly abweichungVor: string;
  readonly lueckeBei: string;
  readonly ohneKettenglied: string;
  readonly tabelleAusgangsbuch: string;
  readonly kundeWieBeleg: string;
  readonly nettoKopf: string;
  readonly ustKopf: string;
  readonly bruttoKopf: string;
  readonly ketteKopf: string;
  readonly hinweisKopf: string;
  readonly storniertKlein: string;
  readonly lueckeDavor: string;
  readonly artNamen: Readonly<Record<RechnungsartSchluessel, string>>;
  readonly ausgangsbuchFussnote: string;
  readonly ueber: string;

  /* ── Die Hashkette ─────────────────────────────────────────────────── */
  readonly hashketteTitel: string;
  readonly hashketteUeberschrift: string;
  readonly jetztNachrechnen: string;
  readonly hashSatzVor: string;
  /** Die Formel im `<code>` — „Nutzlast" ist ein Wort und kein Spaltenname. */
  readonly hashFormel: string;
  readonly algorithmusWort: string;
  readonly hashSatzNach: string;
  readonly nachtlaufTitel: string;
  readonly keinLaufVor: string;
  readonly keinLaufNach: string;
  readonly keinLaufMitte: string;
  readonly keinLaufNicht: string;
  readonly keinLaufSchluss: string;
  readonly gestartet: string;
  readonly nochNichtBeendet: string;
  readonly beendet: string;
  readonly keineMeldung: string;
  readonly gepruefteRechnungen: string;
  readonly koepfeTitel: string;
  readonly einKreisKopf: string;
  readonly kreiseKopfNach: string;
  readonly kopfAbweichungSchluss: string;
  readonly keinKreis: string;
  readonly tabelleKoepfe: string;
  readonly kreisKopf: string;
  readonly genesisKopf: string;
  readonly letzterHashKopf: string;
  readonly gliederKopf: string;
  readonly befundKopf: string;
  readonly fortlaufend: string;
  readonly vorgabe: string;
  readonly keinGlied: string;
  readonly kopfStimmtPosition: string;
  readonly vorgaenger: string;
  /** Der Befund am Kettenkopf — er steht auch in `bruchGrund.kopf_weicht_ab`. */
  readonly textKopf: string;
  /** Der Befund am Kreisuebergang — er steht auch in `bruchGrund.kreisuebergang_gebrochen`. */
  readonly textUebergang: string;
  readonly bruchGrund: Readonly<Record<BruchgrundSchluessel, string>>;
  readonly liveTitel: string;
  readonly nichtNachgerechnet: string;
  readonly tabelleLive: string;
  readonly gepruefteGlieder: string;
  readonly rechnungWort: string;
  readonly positionWort: string;
  readonly erwartet: string;
  readonly gefunden: string;
  readonly kettenmeldungOffen: string;

  /* ── Die Nummernkreise ─────────────────────────────────────────────── */
  readonly nummernkreiseTitel: string;
  readonly nummernkreiseUeberschrift: string;
  readonly nummernkreiseEinleitung: string;
  readonly einPlatzhalter: string;
  readonly platzhalterNach: string;
  readonly platzhalterErklaerung: string;
  readonly nichtFestgeschrieben: string;
  readonly erfundeneNummer: string;
  readonly einWiderspruch: string;
  readonly widersprucheNach: string;
  readonly widerspruchMitte: string;
  readonly widerspruchNachSpalte: string;
  readonly widerspruchSchluss: string;
  readonly keinNummernkreis: string;
  readonly tabelleKreise: string;
  readonly maskeKopf: string;
  readonly naechsteNummerKopf: string;
  readonly kettenlageKopf: string;
  readonly geoeffnetKopf: string;
  readonly vergabeKopf: string;
  readonly ruecksetzungOffen: string;
  readonly zuruecksetzung: Readonly<Record<ZuruecksetzungSchluessel, string>>;
  readonly lueckenlos: string;
  readonly nichtLueckenlos: string;
  readonly zaehler: string;
  readonly genesisWort: string;
  readonly letzterWort: string;
  readonly glieder: string;
  readonly vorgaengerZusatz: string;
  readonly offenZusatz: string;
  readonly geschlossenZusatz: string;
  readonly zugDefiner: string;
  readonly zugAnwendung: string;
  readonly widerspruchZeileVor: string;
  readonly widerspruchZeileNach: string;
  readonly jahreswechselTitel: string;
  readonly jahreswechselEinleitung: string;
  readonly schrittSchliessenVor: string;
  readonly schrittSchliessenWort: string;
  readonly schrittSchliessenNach: string;
  readonly schrittNachfolgerVor: string;
  readonly schrittNachfolgerMitte: string;
  readonly schrittNachfolgerNach: string;
  readonly schrittVorgaengerVor: string;
  readonly schrittVorgaengerNach: string;
  readonly keinKnopfDafuer: string;
  readonly keinKnopfWer: string;
  readonly keinKnopfNach: string;
  readonly rechtGehalten: string;
  readonly rechtFehlt: string;
  readonly auchMitRecht: string;
  readonly zaehlerFussnote: string;
  readonly zumAusgangsbuch: string;

  /* ── Die Vorab-Pruefungen ──────────────────────────────────────────── */
  readonly pruefungenTitel: string;
  readonly pruefungenUeberschrift: string;
  readonly gefiltertAuf: string;
  readonly alleZeigen: string;
  readonly keinBefund: string;
  readonly tabellePruefungen: string;
  readonly regelKopf: string;
  readonly auftragBelegKopf: string;
  readonly regelnTitel: string;
  readonly haeltAn: string;
  readonly warntNur: string;
  readonly nochNichtGeprueftTitel: string;
  readonly grenzenEinleitung: string;
  readonly fin18MengeVor: string;
  readonly fin18MengeNachFunktion: string;
  readonly fin18MengeNachSicht: string;
  readonly fin18MengeNachInvoker: string;
  readonly fin18MengeNachRecht: string;
  readonly fin18MengeNachMinuten: string;
  readonly fin18MengeNachFestschreiben: string;
  readonly fin18MengeSchluss: string;

  /* ── Die Gruppenfinanzen ───────────────────────────────────────────── */
  readonly geschaeftsjahr: string;
  readonly fakturiertNetto: string;
  readonly eingangsrechnungenWort: string;
  readonly eingangsrechnungenNetto: string;
  /** V-215: Betriebsausgaben zählen zum Aufwand. */
  readonly ausgabenNetto: string;
  readonly ausgabenNettoKopf: string;
  readonly ausgabenWort: string;
  readonly ausgabenJeMonat: string;
  readonly tabelleAusgabenMonate: string;
  readonly saldoAusRechnungen: string;
  readonly forderungenOffen: string;
  readonly verbindlichkeitenOffen: string;
  readonly jeGesellschaft: string;
  readonly tabelleGesellschaften: string;
  readonly gesellschaftKopf: string;
  readonly rechnungenKopf: string;
  readonly eingangNettoKopf: string;
  readonly belegeKopf: string;
  readonly saldoKopf: string;
  readonly saldoHinweis: string;
  readonly fakturiertJeMonat: string;
  readonly tabelleFakturiertMonate: string;
  readonly eingangJeMonat: string;
  readonly tabelleEingangMonate: string;
  readonly ergebnisJeMonat: string;
  readonly tabelleErgebnisMonate: string;
  readonly monatKopf: string;
  readonly gruppeKopf: string;
  readonly erloeseNettoKopf: string;
  readonly aufwandNettoKopf: string;
  readonly ergebnisKopf: string;
  readonly bwaHinweis: string;
}

const DE: UebersichtTexte = {
  finanzen: 'Finanzen',
  bereiche: 'Bereiche',
  fakturiert: 'Fakturiert',
  netto: 'netto',
  rechnungenZahl: 'Rechnungen',
  rechnungsentwuerfe: 'Rechnungsentwürfe',
  offeneForderungen: 'Offene Forderungen',
  ueberfaellig: 'Überfällig',
  posten: 'Posten',
  eingangsrechnungenZuPruefen: 'Eingangsrechnungen zu prüfen',
  eingang: 'Eingang',
  ausgabenKachel: 'Betriebsausgaben',
  freigegebenGebucht: '(freigegeben, gebucht)',
  mahnungenInArbeit: 'Mahnungen in Arbeit',
  kachelFussnote:
    'Fakturiert zählt festgeschriebene Rechnungen nach Rechnungsdatum, netto; '
    + 'Eingang freigegebene und gebuchte Eingangsrechnungen. Das ist keine '
    + 'Gewinn-und-Verlust-Rechnung — den Jahresabschluss erstellt der '
    + 'Steuerberater aus dem DATEV-Export. Eine Kachel, deren Recht Sie nicht '
    + 'halten, fehlt hier — sie zeigt keine Null.',
  karten: {
    'finanzen/rechnungen': {
      titel: 'Rechnungen',
      text: 'Entwürfe, Festgeschriebenes, Stornos — jede Nummer lückenlos aus dem eigenen Kreis.',
    },
    'finanzen/zahlungen': {
      titel: 'Zahlungen und offene Posten',
      text: 'Was Kunden schulden, was eingegangen ist, was überfällig wird.',
    },
    'finanzen/eingangsrechnungen': {
      titel: 'Eingangsrechnungen',
      text: 'Lieferantenrechnungen: erfasst, geprüft, freigegeben, gebucht.',
    },
    'finanzen/mahnungen': {
      titel: 'Mahnwesen',
      text: 'Stufen, Gebühren, Vorschläge — versendet wird nichts ohne Freigabe.',
    },
    'finanzen/ausgangsbuch': {
      titel: 'Rechnungsausgangsbuch',
      text: 'Je Nummernkreis, lückenlos, mit dem Stand der Hash-Kette.',
    },
    'finanzen/ausgaben': {
      titel: 'Ausgaben',
      text: 'Barkasse, Tankbeleg, Material, Auslagenerstattung — der Aufwand, '
        + 'der keine Lieferantenrechnung ist.',
    },
    'finanzen/lieferanten': {
      titel: 'Lieferanten',
      text: 'Kreditoren und Nachunternehmen: Nummer, Steuerangaben, '
        + '§-13b-Umkehr und §-48-Freistellung — die Stammdaten, gegen die jede '
        + 'Eingangsrechnung läuft.',
    },
    'finanzen/belege': {
      titel: 'Belege',
      text: 'Das GoBD-Belegarchiv: Typ, Quelle, Aufbewahrungsklasse — die Datei '
        + 'erst nach der Rechteentscheidung.',
    },
    'finanzen/pruefungen': {
      titel: 'Vorab-Prüfungen',
      text: 'Vor der Rechnungsstellung: abgeschlossener Auftrag ohne erfasste '
        + 'Zeit, Entwurfszeile ohne Herkunft.',
    },
    'finanzen/nummernkreise': {
      titel: 'Nummernkreise',
      text: 'Maske, Rücksetzung, Kettenlage — der Zähler ist Ansicht und kein Eingabefeld.',
    },
    'finanzen/hashkette': {
      titel: 'Hashkette',
      text: 'Der nächtliche Prüfbericht je Nummernkreis, und das Nachrechnen auf Wunsch.',
    },
    'buchhaltung/archiv': {
      titel: 'GoBD-Archiv',
      text: 'Rechnungen und Belege, zehn Jahre, nicht löschbar — mit '
        + 'Aufbewahrungsregeln und Prüfbündel.',
    },
  },

  ausgangsbuchTitel: 'Rechnungsausgangsbuch',
  ausgangsbuchUeberschrift: 'Rechnungsausgangsbuch',
  jahr: 'Jahr',
  jahrAlle: 'alle',
  anzeigen: 'Anzeigen',
  abstimmung: 'Abstimmung',
  keineRechnungImZeitraum:
    'Für diesen Zeitraum ist keine Rechnung ausgestellt. Entwürfe stehen hier '
    + 'nicht — sie haben keine Nummer.',
  belegeWort: 'Belege',
  nummernWort: 'Nummern',
  summeKlein: 'Summe',
  buchUndBelegeStimmen: '— Buch und Belege stimmen überein',
  abweichungVor: '— ABWEICHUNG: die Belege ergeben',
  lueckeBei: '· Lücke bei',
  ohneKettenglied: 'Beleg(e) ohne Kettenglied',
  tabelleAusgangsbuch: 'Ausgestellte Rechnungen je Nummernkreis, nach laufender Nummer',
  kundeWieBeleg: 'Kunde (wie auf dem Beleg)',
  nettoKopf: 'Netto',
  ustKopf: 'USt',
  bruttoKopf: 'Brutto',
  ketteKopf: 'Kette',
  hinweisKopf: 'Hinweis',
  storniertKlein: 'storniert',
  lueckeDavor: 'Lücke davor',
  artNamen: {
    standard: 'Rechnung', abschlag: 'Abschlag', anzahlung: 'Anzahlung',
    schluss: 'Schlussrechnung', storno: 'Storno',
  },
  ausgangsbuchFussnote:
    'Der Kundenname stammt aus dem eingefrorenen Beleg, nicht aus dem '
    + 'Stammsatz (K-12): wird ein Kunde umbenannt oder anonymisiert, zeigt das '
    + 'Buch weiter, was auf der Rechnung stand.',
  ueber: 'über',

  hashketteTitel: 'Hashkette',
  hashketteUeberschrift: 'Hashkette der Ausgangsrechnungen',
  jetztNachrechnen: 'Jetzt nachrechnen',
  hashSatzVor: 'Jede festgeschriebene Rechnung trägt',
  hashFormel: 'hash = SHA256(Nutzlast ‖ vorheriger Hash)',
  algorithmusWort: 'Algorithmus',
  hashSatzNach:
    'Wird ein Beleg nachträglich verändert, passt sein Hash nicht mehr — und '
    + 'alle folgenden auch nicht. Das ist der Nachweis, den §146 AO und die '
    + 'GoBD verlangen.',
  nachtlaufTitel: 'Der nächtliche Prüflauf',
  keinLaufVor: 'Der Prüflauf',
  keinLaufNach: 'ist hier noch nie gelaufen.',
  keinLaufMitte:
    'Er ist im Jobregister eingetragen (täglich 03:20 Berliner Zeit), aber es '
    + 'liegt kein Ergebnis vor. Das heisst',
  keinLaufNicht: 'nicht',
  keinLaufSchluss:
    ', dass die Kette in Ordnung ist — es heisst, dass niemand nachgerechnet '
    + 'hat. „Jetzt nachrechnen" oben rechnet sie für diesen Aufruf nach, ohne '
    + 'etwas zu speichern.',
  gestartet: 'Gestartet',
  nochNichtBeendet: '— noch nicht beendet',
  beendet: ', beendet',
  keineMeldung: 'Der Lauf hat für diese Gesellschaft keine Meldung hinterlassen.',
  gepruefteRechnungen: 'Geprüfte Rechnungen im Lauf:',
  koepfeTitel: 'Die Kettenköpfe je Nummernkreis',
  einKreisKopf: 'Ein Kreis trägt einen Kopf, der nicht zu seinen Gliedern passt.',
  kreiseKopfNach: 'Kreise tragen einen Kopf, der nicht zu ihren Gliedern passt.',
  kopfAbweichungSchluss:
    'Das ist kein Rechenfehler: entweder fehlt ein Glied, oder es wurde eines '
    + 'ausgetauscht. Die Zeilen unten sind markiert.',
  keinKreis:
    'Für diese Gesellschaft ist kein Rechnungs- oder Gutschriftenkreis '
    + 'eingerichtet. Ohne Kreis gibt es keine Kette — und keine '
    + 'festgeschriebene Rechnung.',
  tabelleKoepfe: 'Genesis-Hash, letzter Hash und Kettenlänge je Nummernkreis',
  kreisKopf: 'Kreis',
  genesisKopf: 'Genesis',
  letzterHashKopf: 'Letzter Hash',
  gliederKopf: 'Glieder',
  befundKopf: 'Befund',
  fortlaufend: 'fortlaufend',
  vorgabe: '(Vorgabe)',
  keinGlied: 'kein Glied',
  kopfStimmtPosition: 'Kopf und letztes Glied stimmen überein, Position',
  vorgaenger: 'Vorgänger:',
  textKopf: 'Der Kettenkopf des Kreises weicht vom Hash seines letzten Gliedes ab.',
  textUebergang:
    'Der Genesis-Hash dieses Kreises ist nicht der letzte Hash seines '
    + 'Vorgängers (§5.7 Schritt 3b).',
  bruchGrund: {
    hash_falsch:
      'Der gespeicherte Hash stimmt nicht mit dem überein, der sich aus '
      + 'Nutzlast und Vorgänger ergibt.',
    nutzlast_veraendert:
      'Der Nutzlast-Hash passt nicht zu den Bytes des Snapshots — der '
      + 'Beleginhalt ist ein anderer als der, über den gehasht wurde.',
    verkettung_gebrochen:
      'Das Glied nennt einen anderen Vorgänger-Hash als den seines Vorgängers '
      + '— zwischen beiden fehlt etwas oder es wurde eines ersetzt.',
    position_luecke:
      'Die Kettenposition springt oder wiederholt sich — zwischen zwei '
      + 'Gliedern liegt eine Lücke.',
    format_ungueltig:
      'Der Hash ist kein Hex-64. Er kann damit aus keinem SHA-256 stammen, und '
      + 'nachrechnen lässt sich an dieser Stelle nichts mehr.',
    kopf_weicht_ab:
      'Der Kettenkopf des Kreises weicht vom Hash seines letzten Gliedes ab.',
    ohne_kettenglied:
      'Eine Kettenposition fehlt: eine festgeschriebene Rechnung ohne Kettensatz.',
    kreisuebergang_gebrochen:
      'Der Genesis-Hash dieses Kreises ist nicht der letzte Hash seines '
      + 'Vorgängers (§5.7 Schritt 3b).',
    kettenkopf_weicht_ab:
      'Der in `nummernkreis.letzter_hash` gespeicherte Kettenkopf ist nicht '
      + 'der Hash des letzten Gliedes dieses Kreises.',
  },
  liveTitel: 'Nachgerechnet, Glied für Glied',
  nichtNachgerechnet:
    'Nicht nachgerechnet. Die Live-Prüfung liest jedes Glied und rechnet jeden '
    + 'Hash neu — das kostet mit der Menge und läuft deshalb nicht bei jedem '
    + 'Seitenaufruf, sondern nur auf „Jetzt nachrechnen". Sie speichert nichts: '
    + 'ein Prüfer, der schreibt, bezeugt nichts mehr.',
  tabelleLive: 'Befund je Nummernkreis aus der Live-Prüfung',
  gepruefteGlieder: 'Geprüfte Glieder',
  rechnungWort: 'Rechnung',
  positionWort: 'Position',
  erwartet: 'erwartet',
  gefunden: 'gefunden',
  kettenmeldungOffen:
    'Wer die Kettenmeldung bekommt und auf welchem Weg, ist noch offen '
    + '(O-357). Bis dahin steht der Befund hier und im Betriebsbericht — er '
    + 'wird nicht zugestellt.',

  nummernkreiseTitel: 'Nummernkreise',
  nummernkreiseUeberschrift: 'Nummernkreise',
  nummernkreiseEinleitung:
    'Jede Gesellschaft nummeriert für sich (TEN-02). Die Nummer wird beim '
    + 'Festschreiben gezogen — unter Zeilensperre auf dem Zähler, in derselben '
    + 'Transaktion, die den Kettensatz schreibt. Deshalb gibt es keine Lücke: '
    + 'wer abbricht, zieht keine Nummer, und wer eine zieht, schreibt fest.',
  einPlatzhalter: 'Ein Kreis ist ein Platzhalter.',
  platzhalterNach: 'Kreise sind Platzhalter.',
  platzhalterErklaerung:
    'Maske und Rücksetzungsregel sind unbestätigt (O-134) — offen ist, ob es '
    + 'einen Kreis je Gesellschaft oder je Gesellschaft und Belegart gibt, ob '
    + 'die Nummer über Jahre weiterläuft oder am 1. Januar zurückspringt, und '
    + 'wie die Maske genau lautet.',
  nichtFestgeschrieben: 'In einem Platzhalterkreis wird nicht festgeschrieben',
  erfundeneNummer: '— eine Nummer daraus wäre eine erfundene.',
  einWiderspruch:
    'Ein Kreis behauptet in seiner Bezeichnung eine unbestätigte Maske, trägt '
    + 'aber ist_platzhalter = false.',
  widersprucheNach:
    'Kreise behaupten in ihrer Bezeichnung eine unbestätigte Maske, tragen '
    + 'aber ist_platzhalter = false.',
  widerspruchMitte:
    'Damit greift der Platzhalterschutz nicht: für Rechnungs- und '
    + 'Gutschriftenkreise sitzt er ausschliesslich in',
  widerspruchNachSpalte: ', und die prüft genau diese Spalte. Ob die Spalte auf',
  widerspruchSchluss:
    'gehört, ist eine Datenentscheidung mit Wirkung auf bereits '
    + 'festgeschriebene Belege — sie wird hier benannt und nicht getroffen '
    + '(O-606).',
  keinNummernkreis:
    'Für diese Gesellschaft ist kein Nummernkreis eingerichtet. Ohne Kreis '
    + 'entsteht keine Nummer und damit keine Rechnung, kein Angebot und kein '
    + 'Leistungsnachweis. Wer einen Kreis eröffnet, ist offen (O-352) — es '
    + 'gibt hier deshalb keinen Knopf dafür.',
  tabelleKreise: 'Nummernkreise mit Maske, Zähler, Kettenlage und Zustand',
  maskeKopf: 'Maske und Rücksetzung',
  naechsteNummerKopf: 'Nächste Nummer (Ansicht)',
  kettenlageKopf: 'Kettenlage',
  geoeffnetKopf: 'Geöffnet / geschlossen',
  vergabeKopf: 'Vergabe',
  ruecksetzungOffen: 'Rücksetzung nicht festgelegt',
  zuruecksetzung: {
    nie: 'nie — fortlaufend über Jahre',
    jaehrlich: 'jährlich — am 1. Januar zurück auf 1',
  },
  lueckenlos: ' · lückenlos',
  nichtLueckenlos: ' · nicht lückenlos',
  zaehler: 'Zähler',
  genesisWort: 'Genesis',
  letzterWort: 'Letzter',
  glieder: 'Glied(er)',
  vorgaengerZusatz: ' · Vorgänger: ',
  offenZusatz: ' · offen',
  geschlossenZusatz: ' · geschlossen ',
  zugDefiner: 'Zug in der Datenbank (Definer)',
  zugAnwendung: 'Zug in der Anwendung',
  widerspruchZeileVor: 'Bezeichnung und',
  widerspruchZeileNach: 'widersprechen sich (O-606).',
  jahreswechselTitel: 'Der Jahreswechsel — beschrieben, nicht auslösbar',
  jahreswechselEinleitung:
    'Ein Kreis mit jährlicher Rücksetzung wird nicht einfach weitergezählt. '
    + 'Der Vorgang hat drei Schritte, und sie gehören in eine Transaktion:',
  schrittSchliessenVor: 'Den Vorgängerkreis',
  schrittSchliessenWort: 'schliessen',
  schrittSchliessenNach: '). Danach vergibt er keine Nummer mehr.',
  schrittNachfolgerVor: 'Den Nachfolger eröffnen und seinen',
  schrittNachfolgerMitte: 'auf den',
  schrittNachfolgerNach:
    'des Vorgängers setzen — damit reisst die Kette am Jahreswechsel nicht.',
  schrittVorgaengerVor: 'Den Vorgänger eintragen (',
  schrittVorgaengerNach:
    '), damit die Prüfung den Übergang nachrechnen kann (§5.7 Schritt 3b).',
  keinKnopfDafuer: 'Es gibt hier keinen Knopf dafür (O-352).',
  keinKnopfWer: 'Wer',
  keinKnopfNach:
    'in den drei Gesellschaften hält und wer den Jahreswechsel ausführt, ist '
    + 'nicht entschieden — und ein Knopf würde die Rolle erfinden, die ihn '
    + 'auslöst.',
  rechtGehalten: 'Dieses Konto hält nummernkreis.verwalten.',
  rechtFehlt: 'Diesem Konto fehlt nummernkreis.verwalten.',
  auchMitRecht: 'Auch mit dem Recht gibt es den Vorgang noch nicht.',
  zaehlerFussnote:
    'Der Zähler ist hier Ansicht. Er wird ausschliesslich beim Festschreiben '
    + 'fortgezählt, unter Zeilensperre — jede andere Stelle wäre eine zweite, '
    + 'und zwei Stellen vergeben irgendwann dieselbe Nummer.',
  zumAusgangsbuch: 'Zum Rechnungsausgangsbuch →',

  pruefungenTitel: 'Vorab-Prüfungen',
  pruefungenUeberschrift: 'Vor der Rechnungsstellung',
  gefiltertAuf: 'Gefiltert auf',
  alleZeigen: 'alle zeigen',
  keinBefund:
    'Kein Befund. Kein abgeschlossener Auftrag ohne erfasste Minute, kein '
    + 'abgeschlossener Auftrag ohne Rechnung, keine Entwurfszeile ohne '
    + 'Herkunft. Das heisst nicht, dass alles geprüft ist — welche weiteren '
    + 'Vorab-Prüfungen diese Liste führen soll, ist offen (O-601), und sie '
    + 'steht unten.',
  tabellePruefungen: 'Befunde vor der Rechnungsstellung, mit Regel und Sprungziel',
  regelKopf: 'Regel',
  auftragBelegKopf: 'Auftrag / Beleg',
  regelnTitel: 'Was diese Liste prüft — und warum',
  haeltAn: 'hält die Festschreibung an',
  warntNur: 'warnt, hält nicht an',
  nochNichtGeprueftTitel: 'Was diese Liste NOCH NICHT prüft',
  grenzenEinleitung:
    'Eine Prüfliste, die ihre eigenen Grenzen verschweigt, wird für '
    + 'vollständig gehalten. Deshalb stehen sie hier — als benannte offene '
    + 'Fragen und nicht als leere Rubrik.',
  fin18MengeVor: 'Die FIN-18-Menge kommt aus',
  fin18MengeNachFunktion: 'und nicht aus der Sicht',
  fin18MengeNachSicht: ': die läuft mit',
  fin18MengeNachInvoker: ', und eine Buchhaltung ohne',
  fin18MengeNachRecht:
    'bekäme dort überall null Minuten — also bei jedem Auftrag eine Warnung. '
    + 'Eine Warnung, die immer kommt, wird nach dem dritten Mal ungelesen '
    + 'weggeklickt. Sie kommt auch nicht aus',
  fin18MengeNachMinuten: ': die verlangt',
  fin18MengeNachFestschreiben: ', während diese Route mit',
  fin18MengeSchluss:
    'öffnet — die Liste brach damit genau dann, wenn der erste abgeschlossene '
    + 'Auftrag im Bestand stand. Die Minutenzahl selbst bleibt hinter dem '
    + 'Festschreiberecht; hier steht nur ja oder nein.',

  geschaeftsjahr: 'Geschäftsjahr',
  fakturiertNetto: 'Fakturiert netto',
  eingangsrechnungenWort: 'Eingangsrechnungen',
  eingangsrechnungenNetto: 'Eingangsrechnungen netto',
  ausgabenNetto: 'Betriebsausgaben netto',
  ausgabenNettoKopf: 'Ausgaben netto',
  ausgabenWort: 'Betriebsausgaben',
  ausgabenJeMonat: 'Betriebsausgaben je Monat',
  tabelleAusgabenMonate: 'je Monat und Gesellschaft',
  saldoAusRechnungen: 'Saldo aus Belegen',
  forderungenOffen: 'Forderungen offen',
  verbindlichkeitenOffen: 'Verbindlichkeiten offen',
  jeGesellschaft: 'Je Gesellschaft',
  tabelleGesellschaften: 'je Gesellschaft',
  gesellschaftKopf: 'Gesellschaft',
  rechnungenKopf: 'Rechnungen',
  eingangNettoKopf: 'Eingang netto',
  belegeKopf: 'Belege',
  saldoKopf: 'Saldo',
  saldoHinweis:
    'Saldo = fakturierte Ausgangsrechnungen − freigegebene und gebuchte '
    + 'Eingangsrechnungen und Betriebsausgaben, jeweils netto nach Rechnungs- '
    + 'bzw. Belegdatum. Das ist keine '
    + 'Gewinn-und-Verlust-Rechnung: Personal, Abschreibungen, Abgrenzungen und '
    + 'Steuern fehlen; den Jahresabschluss erstellt der Steuerberater aus dem '
    + 'DATEV-Export.',
  fakturiertJeMonat: 'Fakturiert je Monat',
  tabelleFakturiertMonate: 'je Monat und Gesellschaft',
  eingangJeMonat: 'Eingangsrechnungen je Monat',
  tabelleEingangMonate: 'je Monat und Gesellschaft',
  ergebnisJeMonat: 'Ergebnis je Monat (BWA-artig)',
  tabelleErgebnisMonate: 'je Monat — Erlöse minus Aufwand, Summe der Gesellschaften',
  monatKopf: 'Monat',
  gruppeKopf: 'Gruppe',
  erloeseNettoKopf: 'Erlöse netto',
  aufwandNettoKopf: 'Aufwand netto',
  ergebnisKopf: 'Ergebnis',
  bwaHinweis:
    'BWA-artig, keine Betriebswirtschaftliche Auswertung: Erlöse und Aufwand '
    + '(Eingangsrechnungen und Betriebsausgaben) aus den Belegen nach Rechnungs- '
    + 'bzw. Belegdatum, je Gesellschaft dieselbe Rechnung '
    + 'wie unter Buchhaltung › Monatszahlen; die Gruppe ist die Summe der '
    + 'Gesellschaften.',
};

const EN: UebersichtTexte = {
  finanzen: 'Finance',
  bereiche: 'Areas',
  fakturiert: 'Invoiced',
  netto: 'net',
  rechnungenZahl: 'invoices',
  rechnungsentwuerfe: 'Invoice drafts',
  offeneForderungen: 'Open receivables',
  ueberfaellig: 'Overdue',
  posten: 'items',
  eingangsrechnungenZuPruefen: 'Incoming invoices to check',
  eingang: 'Incoming',
  ausgabenKachel: 'Operating expenses',
  freigegebenGebucht: '(approved, posted)',
  mahnungenInArbeit: 'Mahnungen (dunning letters) in progress',
  kachelFussnote:
    'Invoiced counts finalised (festgeschrieben) invoices by invoice date, '
    + 'net; incoming counts approved and posted incoming invoices. This is not '
    + 'a profit and loss account — the Jahresabschluss (annual accounts) is '
    + 'drawn up by the tax adviser from the DATEV export. A tile whose right '
    + 'you do not hold is absent here — it does not show a zero.',
  karten: {
    'finanzen/rechnungen': {
      titel: 'Invoices',
      text: 'Drafts, finalised invoices (festgeschrieben), Stornos (reversing '
        + 'entries) — every number gapless out of its own Nummernkreis.',
    },
    'finanzen/zahlungen': {
      titel: 'Payments and open items',
      text: 'What customers owe, what has come in, what is falling overdue.',
    },
    'finanzen/eingangsrechnungen': {
      titel: 'Incoming invoices',
      text: 'Supplier invoices: recorded, checked, approved, posted.',
    },
    'finanzen/mahnungen': {
      titel: 'Mahnwesen (dunning)',
      text: 'Mahnstufen, fees, proposals — nothing is sent without approval.',
    },
    'finanzen/ausgangsbuch': {
      titel: 'Rechnungsausgangsbuch (sales invoice journal)',
      text: 'Per Nummernkreis, gapless, with the state of the hash chain.',
    },
    'finanzen/ausgaben': {
      titel: 'Expenses',
      text: 'Petty cash, fuel receipt, materials, reimbursed outlays — the '
        + 'costs that are not a supplier invoice.',
    },
    'finanzen/lieferanten': {
      titel: 'Lieferanten (suppliers)',
      text: 'Creditors and subcontractors: number, tax details, § 13b reverse '
        + 'charge and § 48 exemption — the master data every incoming invoice '
        + 'is checked against.',
    },
    'finanzen/belege': {
      titel: 'Belege (source documents)',
      text: 'The GoBD document archive: type, source, retention class — the '
        + 'file only after the rights decision.',
    },
    'finanzen/pruefungen': {
      titel: 'Pre-invoice checks',
      text: 'Before invoicing: a completed Auftrag (order) without recorded '
        + 'time, a draft line without an origin.',
    },
    'finanzen/nummernkreise': {
      titel: 'Nummernkreise (number ranges)',
      text: 'Mask, reset, chain state — the counter is a view and not an input field.',
    },
    'finanzen/hashkette': {
      titel: 'Hash chain',
      text: 'The nightly check report per Nummernkreis, and recomputation on request.',
    },
    'buchhaltung/archiv': {
      titel: 'GoBD archive',
      text: 'Invoices and Belege, ten years, not deletable — with retention '
        + 'rules and audit bundle.',
    },
  },

  ausgangsbuchTitel: 'Rechnungsausgangsbuch',
  ausgangsbuchUeberschrift: 'Rechnungsausgangsbuch (sales invoice journal)',
  jahr: 'Year',
  jahrAlle: 'all',
  anzeigen: 'Show',
  abstimmung: 'Reconciliation',
  keineRechnungImZeitraum:
    'No invoice was issued for this period. Drafts do not appear here — they '
    + 'have no number.',
  belegeWort: 'Belege',
  nummernWort: 'numbers',
  summeKlein: 'total',
  buchUndBelegeStimmen: '— journal and Belege agree',
  abweichungVor: '— DISCREPANCY: the Belege add up to',
  lueckeBei: '· gap at',
  ohneKettenglied: 'Beleg(e) without a chain link',
  tabelleAusgangsbuch: 'Issued invoices per Nummernkreis, by sequential number',
  kundeWieBeleg: 'Customer (as on the Beleg)',
  nettoKopf: 'Net',
  ustKopf: 'USt (VAT)',
  bruttoKopf: 'Gross',
  ketteKopf: 'Chain',
  hinweisKopf: 'Note',
  storniertKlein: 'reversed (Storno)',
  lueckeDavor: 'gap before it',
  artNamen: {
    standard: 'Invoice', abschlag: 'Abschlag (interim invoice)',
    anzahlung: 'Anzahlung (advance payment)',
    schluss: 'Schlussrechnung (final invoice)', storno: 'Storno (reversing entry)',
  },
  ausgangsbuchFussnote:
    'The customer name comes from the frozen Beleg, not from the master record '
    + '(K-12): if a customer is renamed or anonymised, the journal keeps '
    + 'showing what stood on the invoice.',
  ueber: 'across',

  hashketteTitel: 'Hash chain',
  hashketteUeberschrift: 'Hash chain of the outgoing invoices',
  jetztNachrechnen: 'Recompute now',
  hashSatzVor: 'Every finalised (festgeschrieben) invoice carries',
  hashFormel: 'hash = SHA256(payload ‖ previous hash)',
  algorithmusWort: 'algorithm',
  hashSatzNach:
    'If a Beleg is altered afterwards, its hash no longer fits — and neither '
    + 'does any that follows. That is the evidence §146 AO and the GoBD '
    + 'require.',
  nachtlaufTitel: 'The nightly check run',
  keinLaufVor: 'The check run',
  keinLaufNach: 'has never run here.',
  keinLaufMitte:
    'It is entered in the job register (daily 03:20 Berlin time), but no '
    + 'result is on record. That does',
  keinLaufNicht: 'not',
  keinLaufSchluss:
    ' mean the chain is sound — it means nobody has recomputed it. "Recompute '
    + 'now" above recomputes it for this request without storing anything.',
  gestartet: 'Started',
  nochNichtBeendet: '— not finished yet',
  beendet: ', finished',
  keineMeldung: 'The run left no message for this company.',
  gepruefteRechnungen: 'Invoices checked in the run:',
  koepfeTitel: 'The chain heads per Nummernkreis (number range)',
  einKreisKopf: 'One Nummernkreis carries a head that does not match its links.',
  kreiseKopfNach: 'Nummernkreise carry a head that does not match their links.',
  kopfAbweichungSchluss:
    'That is not an arithmetic error: either a link is missing or one was '
    + 'swapped. The rows below are marked.',
  keinKreis:
    'No Nummernkreis for invoices or Gutschriften (credit notes) is set up for '
    + 'this company. Without one there is no chain — and no finalised '
    + '(festgeschrieben) invoice.',
  tabelleKoepfe: 'Genesis hash, last hash and chain length per Nummernkreis',
  kreisKopf: 'Nummernkreis',
  genesisKopf: 'Genesis',
  letzterHashKopf: 'Last hash',
  gliederKopf: 'Links',
  befundKopf: 'Finding',
  fortlaufend: 'continuous',
  vorgabe: '(default)',
  keinGlied: 'no link',
  kopfStimmtPosition: 'Head and last link agree, position',
  vorgaenger: 'Predecessor:',
  textKopf:
    'The chain head of the Nummernkreis differs from the hash of its last link.',
  textUebergang:
    'The genesis hash of this Nummernkreis is not the last hash of its '
    + 'predecessor (§5.7 step 3b).',
  bruchGrund: {
    hash_falsch:
      'The stored hash does not match the one that follows from payload and '
      + 'predecessor.',
    nutzlast_veraendert:
      'The payload hash does not match the bytes of the snapshot — the content '
      + 'of the Beleg is another than the one hashed over.',
    verkettung_gebrochen:
      'The link names a predecessor hash other than that of its predecessor — '
      + 'something is missing between the two or one was replaced.',
    position_luecke:
      'The chain position jumps or repeats itself — there is a gap between two '
      + 'links.',
    format_ungueltig:
      'The hash is not hex-64. It can therefore come from no SHA-256, and '
      + 'nothing can be recomputed at this point any more.',
    kopf_weicht_ab:
      'The chain head of the Nummernkreis differs from the hash of its last link.',
    ohne_kettenglied:
      'A chain position is missing: a finalised (festgeschrieben) invoice '
      + 'without a chain record.',
    kreisuebergang_gebrochen:
      'The genesis hash of this Nummernkreis is not the last hash of its '
      + 'predecessor (§5.7 step 3b).',
    kettenkopf_weicht_ab:
      'The chain head stored in `nummernkreis.letzter_hash` is not the hash of '
      + 'the last link of this Nummernkreis.',
  },
  liveTitel: 'Recomputed, link by link',
  nichtNachgerechnet:
    'Not recomputed. The live check reads every link and recomputes every hash '
    + '— that costs with the volume and therefore does not run on every page '
    + 'view, only on "Recompute now". It stores nothing: a checker that writes '
    + 'no longer bears witness.',
  tabelleLive: 'Finding per Nummernkreis from the live check',
  gepruefteGlieder: 'Links checked',
  rechnungWort: 'Invoice',
  positionWort: 'position',
  erwartet: 'expected',
  gefunden: 'found',
  kettenmeldungOffen:
    'Who receives the chain message, and by which route, is still open '
    + '(O-357). Until then the finding stands here and in the operations '
    + 'report — it is not delivered.',

  nummernkreiseTitel: 'Nummernkreise',
  nummernkreiseUeberschrift: 'Nummernkreise (number ranges)',
  nummernkreiseEinleitung:
    'Every company numbers for itself (TEN-02). The number is drawn at '
    + 'Festschreibung (finalisation) — under a row lock on the counter, in the '
    + 'same transaction that writes the chain record. That is why there is no '
    + 'gap: whoever aborts draws no number, and whoever draws one finalises.',
  einPlatzhalter: 'One Nummernkreis is a placeholder.',
  platzhalterNach: 'Nummernkreise are placeholders.',
  platzhalterErklaerung:
    'Mask and reset rule are unconfirmed (O-134) — open is whether there is '
    + 'one Nummernkreis per company or per company and document type, whether '
    + 'the number runs on across the years or jumps back on 1 January, and how '
    + 'the mask reads exactly.',
  nichtFestgeschrieben: 'In a placeholder Nummernkreis nothing is finalised',
  erfundeneNummer: '— a number out of it would be an invented one.',
  einWiderspruch:
    'One Nummernkreis claims an unconfirmed mask in its label but carries '
    + 'ist_platzhalter = false.',
  widersprucheNach:
    'Nummernkreise claim an unconfirmed mask in their label but carry '
    + 'ist_platzhalter = false.',
  widerspruchMitte:
    'The placeholder protection therefore does not bite: for invoice and '
    + 'Gutschrift (credit note) Nummernkreise it sits solely in',
  widerspruchNachSpalte:
    ', and that checks exactly this column. Whether the column ought to read',
  widerspruchSchluss:
    'is a data decision with effect on Belege already finalised '
    + '(festgeschrieben) — it is named here and not taken (O-606).',
  keinNummernkreis:
    'No Nummernkreis is set up for this company. Without one no number arises '
    + 'and hence no invoice, no quotation and no Leistungsnachweis (proof of '
    + 'service performed). Who opens a Nummernkreis is open (O-352) — there is '
    + 'therefore no button for it here.',
  tabelleKreise: 'Nummernkreise with mask, counter, chain state and state',
  maskeKopf: 'Mask and reset',
  naechsteNummerKopf: 'Next number (view)',
  kettenlageKopf: 'Chain state',
  geoeffnetKopf: 'Opened / closed',
  vergabeKopf: 'Issuing',
  ruecksetzungOffen: 'reset not laid down',
  zuruecksetzung: {
    nie: 'never — continuous across the years',
    jaehrlich: 'yearly — back to 1 on 1 January',
  },
  lueckenlos: ' · gapless',
  nichtLueckenlos: ' · not gapless',
  zaehler: 'Counter',
  genesisWort: 'Genesis',
  letzterWort: 'Last',
  glieder: 'link(s)',
  vorgaengerZusatz: ' · predecessor: ',
  offenZusatz: ' · open',
  geschlossenZusatz: ' · closed ',
  zugDefiner: 'drawn in the database (definer)',
  zugAnwendung: 'drawn in the application',
  widerspruchZeileVor: 'Label and',
  widerspruchZeileNach: 'contradict each other (O-606).',
  jahreswechselTitel: 'The turn of the year — described, not triggerable',
  jahreswechselEinleitung:
    'A Nummernkreis with a yearly reset is not simply counted on. The '
    + 'procedure has three steps, and they belong in one transaction:',
  schrittSchliessenVor: 'The predecessor Nummernkreis is',
  schrittSchliessenWort: 'closed',
  schrittSchliessenNach: '). After that it issues no further number.',
  schrittNachfolgerVor: 'Open the successor and set its',
  schrittNachfolgerMitte: 'to the',
  schrittNachfolgerNach:
    'of the predecessor — so that the chain does not tear at the turn of the year.',
  schrittVorgaengerVor: 'Record the predecessor (',
  schrittVorgaengerNach:
    '), so that the check can recompute the transition (§5.7 step 3b).',
  keinKnopfDafuer: 'There is no button for it here (O-352).',
  keinKnopfWer: 'Who holds',
  keinKnopfNach:
    'in the three companies, and who carries out the turn of the year, is not '
    + 'decided — and a button would invent the role that triggers it.',
  rechtGehalten: 'This account holds nummernkreis.verwalten.',
  rechtFehlt: 'This account lacks nummernkreis.verwalten.',
  auchMitRecht: 'Even with the right the procedure does not exist yet.',
  zaehlerFussnote:
    'The counter is a view here. It is counted on solely at Festschreibung '
    + '(finalisation), under a row lock — any other place would be a second '
    + 'one, and two places issue the same number sooner or later.',
  zumAusgangsbuch: 'To the Rechnungsausgangsbuch →',

  pruefungenTitel: 'Pre-invoice checks',
  pruefungenUeberschrift: 'Before invoicing',
  gefiltertAuf: 'Filtered to',
  alleZeigen: 'show all',
  keinBefund:
    'No finding. No completed Auftrag (order) without a recorded minute, no '
    + 'completed Auftrag without an invoice, no draft line without an origin. '
    + 'That does not mean everything is checked — which further pre-invoice '
    + 'checks this list is to carry is open (O-601), and it stands below.',
  tabellePruefungen: 'Findings before invoicing, with rule and jump target',
  regelKopf: 'Rule',
  auftragBelegKopf: 'Auftrag / Beleg',
  regelnTitel: 'What this list checks — and why',
  haeltAn: 'stops the Festschreibung (finalisation)',
  warntNur: 'warns, does not stop',
  nochNichtGeprueftTitel: 'What this list does NOT check yet',
  grenzenEinleitung:
    'A checklist that keeps quiet about its own limits is taken for complete. '
    + 'That is why they stand here — as named open questions and not as an '
    + 'empty heading.',
  fin18MengeVor: 'The FIN-18 set comes from',
  fin18MengeNachFunktion: 'and not from the view',
  fin18MengeNachSicht: ': that runs with',
  fin18MengeNachInvoker: ', and an accounting user without',
  fin18MengeNachRecht:
    'would get zero minutes everywhere there — that is, a warning on every '
    + 'Auftrag. A warning that always comes is clicked away unread after the '
    + 'third time. Nor does it come from',
  fin18MengeNachMinuten: ': that requires',
  fin18MengeNachFestschreiben: ', while this route opens with',
  fin18MengeSchluss:
    '— the list thus broke exactly when the first completed Auftrag was in the '
    + 'data. The number of minutes itself stays behind the Festschreibung '
    + 'right; here there is only yes or no.',

  geschaeftsjahr: 'Financial year',
  fakturiertNetto: 'Invoiced net',
  eingangsrechnungenWort: 'Incoming invoices',
  eingangsrechnungenNetto: 'Incoming invoices net',
  ausgabenNetto: 'Operating expenses net',
  ausgabenNettoKopf: 'Expenses net',
  ausgabenWort: 'Operating expenses',
  ausgabenJeMonat: 'Operating expenses per month',
  tabelleAusgabenMonate: 'per month and company',
  saldoAusRechnungen: 'Balance from Belege',
  forderungenOffen: 'Receivables open',
  verbindlichkeitenOffen: 'Payables open',
  jeGesellschaft: 'Per company',
  tabelleGesellschaften: 'per company',
  gesellschaftKopf: 'Company',
  rechnungenKopf: 'Invoices',
  eingangNettoKopf: 'Incoming net',
  belegeKopf: 'Belege',
  saldoKopf: 'Balance',
  saldoHinweis:
    'Balance = invoiced outgoing invoices − approved and posted incoming '
    + 'invoices and operating expenses, each net by invoice or receipt date. '
    + 'This is not a profit and loss '
    + 'account: staff costs, depreciation, accruals and taxes are missing; the '
    + 'Jahresabschluss (annual accounts) is drawn up by the tax adviser from '
    + 'the DATEV export.',
  fakturiertJeMonat: 'Invoiced per month',
  tabelleFakturiertMonate: 'per month and company',
  eingangJeMonat: 'Incoming invoices per month',
  tabelleEingangMonate: 'per month and company',
  ergebnisJeMonat: 'Result per month (BWA-style)',
  tabelleErgebnisMonate: 'per month — revenue minus costs, total of the companies',
  monatKopf: 'Month',
  gruppeKopf: 'Group',
  erloeseNettoKopf: 'Revenue net',
  aufwandNettoKopf: 'Costs net',
  ergebnisKopf: 'Result',
  bwaHinweis:
    'BWA-style, not a Betriebswirtschaftliche Auswertung (the standard German '
    + 'monthly management report): revenue and costs (incoming invoices and '
    + 'operating expenses) from the Belege by invoice or receipt date, per '
    + 'company the same calculation as under Buchhaltung › '
    + 'Monatszahlen (accounting › monthly figures); the group is the total of '
    + 'the companies.',
};

export const UEBERSICHT_TEXTE: Readonly<Record<InternSprache, UebersichtTexte>> = {
  de: DE, en: EN,
};
