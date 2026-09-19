/**
 * Die Rechnungsakte — `/[mandant]/finanzen/rechnungen/[id]` und die drei
 * Uebergaenge darunter (`/festschreiben`, `/storno`, `/verwerfen`) in beiden
 * Sprachen.
 *
 * **Vier Blaetter, eine Datei.** Der Schnitt laeuft entlang der Teilflaeche
 * und nicht entlang der Datei: der Entwurfseditor und seine drei Uebergaenge
 * teilen sich ein Dutzend Woerter — `Entwurf ohne Nummer`, der FIN-18-Satz,
 * `Rechnung festschreiben` —, und dreimal dasselbe Wort an drei Stellen ist
 * dreimal die Gelegenheit, es beim naechsten Mal nur an zwei davon zu aendern.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`). `Festschreibung`, `Storno`, `Abschlagsrechnung`,
 * `Bauabzugsteuer`, `Freistellungsbescheinigung`, `Umsatzsteuer`,
 * `Leistungsnachweis`, `Nachtrag`, `Aufmass` tragen Rechtsbedeutung (UStG,
 * EStG, VOB, GoBD). Im Englischen steht der deutsche Begriff und DANEBEN eine
 * kurze Erklaerung in Klammern — nie eine erfundene Entsprechung. Ein
 * englisches „credit note" fuer einen Storno waere fachlich etwas anderes:
 * eine Gutschrift aendert den Beleg, ein Storno hebt ihn durch einen zweiten
 * auf (Invariante 4).
 *
 * **Warum hier Satzbruchstuecke stehen.** Mehrere Saetze dieser Blaetter
 * tragen eine Rechnungsnummer, einen Betrag oder einen Namen MITTEN im Satz.
 * Ein Bruchstueck mit fuehrendem Leerzeichen (`' aufgehoben.'`) ist deshalb
 * Absicht und kein Tippfehler: das eingesetzte Stueck steht davor. Wo der
 * englische Satz an dieser Stelle schon zu Ende ist, steht dort nur der
 * Punkt — oder, wo auch der davor gehoert, die leere Zeichenkette.
 */
import type { InternSprache } from '../../intern.js';

export interface RechnungAkteTexte {
  /* ── Was auf mehreren der vier Blaetter steht ──────────────────────── */
  readonly rechnungsentwurf: string;
  readonly entwurfOhneNummer: string;
  readonly rechnungsdatum: string;
  readonly leistungszeitraum: string;
  readonly nr: string;
  readonly netto: string;
  readonly brutto: string;
  readonly umsatzsteuer: string;
  readonly positionen: string;
  readonly position: string;
  readonly beleg: string;
  readonly grund: string;
  readonly grundIst: string;
  readonly form: string;
  readonly stornieren: string;
  readonly entwurfVerwerfen: string;
  readonly rechnungFestschreiben: string;
  readonly kettenbindung: string;
  readonly einzelpreis: string;
  readonly steuergruppe: string;

  /** Die Anfuehrungszeichen — deutsch „…", englisch "…". */
  readonly zitatAuf: string;
  readonly zitatZu: string;

  /**
   * FIN-18: ein abgeschlossener Auftrag ohne eine einzige erfasste Minute.
   * Derselbe Befund steht auf dem Entwurfsblatt und auf dem Einwegtor.
   */
  readonly fin18Auftrag: string;
  readonly fin18Satz: string;

  /* ── Das Entwurfsblatt: `/rechnungen/[id]` ─────────────────────────── */
  readonly alleRechnungen: string;
  readonly pruefungAnsehen: string;
  readonly xrechnungAnsehen: string;
  readonly zugferdPdfLaden: string;
  readonly zugferdAnsehen: string;
  readonly festschreibenPruefen: string;
  readonly abschlaegeUndAbzug: string;
  readonly versandprotokoll: string;

  readonly leistungsort: string;
  readonly zahlungsziel: string;
  readonly zahlungszielFehlt: string;
  readonly tage: string;

  readonly verworfenLabel: string;
  readonly aufgehobenDurch: string;
  readonly neuAusgestelltAls: string;
  readonly stornoUnveraendert: string;

  readonly keinePosition: string;
  readonly tabellePositionen: string;
  readonly codeOffen: string;
  readonly unbestaetigterWert: string;

  readonly herkunftTitel: string;
  readonly anspruchErloschen: string;
  readonly summeDerBelege: string;
  readonly stimmtUeberein: string;
  readonly positionTraegt: string;

  readonly ustJeGruppe: string;
  readonly ustAufschluesselung: string;

  readonly abzuegeTitel: string;
  readonly abzuegeBeschriftung: string;
  readonly steuersatz: string;
  readonly vom: string;
  readonly zahlbetrag: string;

  readonly steuerfallTitel: string;
  readonly reverseChargeVorgabe: string;
  readonly grundlageBau: string;
  readonly grundlageReinigung: string;
  readonly bauabzugsteuerEinbehalten: string;
  readonly ueberwiesenWerden: string;
  readonly keineFreistellung: string;
  readonly freistellungNummer: string;
  readonly keinEinbehaltFreistellung: string;
  readonly giltAmLeistungsdatum: string;

  readonly artDerLeistung: string;
  readonly wederNoch: string;
  readonly optionBau: string;
  readonly optionReinigung: string;
  readonly steuerfallHinweis: string;
  readonly steuerfallBestimmen: string;

  readonly abschlaegeErklaerung: string;
  readonly abschlaegeAbziehen: string;

  readonly zeitzeileTitel: string;
  readonly zeitzeileTeil1: string;
  readonly zeitzeileBetont: string;
  readonly zeitzeileTeil2: string;
  readonly leistungszeile: string;
  readonly handelsuebliche: string;
  readonly stundensatzCent: string;
  readonly vonBerlinerTag: string;
  readonly bisEinschliesslich: string;
  readonly stundenUebernehmen: string;

  readonly positionHinzufuegen: string;
  readonly mengeTausendstel: string;
  readonly einzelpreisCent: string;
  readonly unbestaetigterWertSuffix: string;
  readonly herkunftDieserZeile: string;
  readonly optionVertrag: string;
  readonly optionManuell: string;
  readonly vertragsposition: string;
  readonly begruendungVonHand: string;
  readonly keineZeileOhneBeleg: string;

  readonly festschreibenTitel: string;
  readonly festschreibenErklaerung: string;
  readonly danachUnveraenderlich: string;
  readonly korrekturIstStorno: string;
  readonly fin18Begruendung10: string;

  readonly verwerfenTitel: string;
  readonly verwerfenErklaerungKurz: string;

  readonly keinKettensatz: string;
  readonly kettePositionVor: string;
  readonly kettePositionNach: string;
  readonly stornoRechtFehltVor: string;
  readonly stornoRechtFehltNach: string;
  readonly korrigieren: string;
  readonly korrigierenErklaerung: string;
  readonly grundZehnZeichen: string;
  readonly formKorrektur: string;
  readonly formNurStorno: string;

  /* ── Das Einwegtor: `/festschreiben` ───────────────────────────────── */
  readonly dortBeheben: string;
  readonly festschreibenH1: string;
  readonly warnungTeil1: string;
  readonly warnungBetont: string;
  readonly warnungTeil2: string;
  readonly warnungTeil3: string;
  readonly belegIst: string;
  readonly zustandVerworfen: string;
  readonly zustandFestgeschrieben: string;
  readonly undTraegtNummer: string;
  readonly nichtsMehrFestzuschreiben: string;

  readonly wasUnumkehrbar: string;
  readonly empfaenger: string;
  readonly keineSteuerzeile: string;
  readonly tabelleSteuer: string;
  readonly steuersatzgruppe: string;
  readonly satz: string;
  readonly nettoGesamt: string;
  readonly ustGesamt: string;
  readonly abzugFrueherer: string;
  readonly bauabzugsteuer48: string;
  readonly keinEinbehalt: string;
  readonly zahlbetragKunde: string;
  readonly ueberweisungsbetrag: string;
  readonly steuerhinweis13b: string;

  readonly kreisTitel: string;
  readonly keinKreisVor: string;
  readonly ausgangsrechnungen: string;
  readonly keinKreisMitte: string;
  readonly keinKreisNach: string;
  readonly maske: string;
  readonly ruecksetzung: string;
  readonly nichtFestgelegt: string;
  readonly lueckenlos: string;
  readonly nichtLueckenlos: string;
  readonly zaehlerStehtBei: string;
  readonly nummerEntstehtSpaeter: string;

  readonly blockierendTitel: string;
  readonly keineBlockierenden: string;
  readonly warnungenTitel: string;
  readonly keineWarnungen: string;
  readonly abschlaegeAnsehen: string;

  readonly fin18BegruendungMin: string;
  readonly zeichenKlammer: string;
  readonly fin18Protokolliert: string;

  readonly gesperrtKeinePosition: string;
  readonly gesperrtBlockiertVor: string;
  readonly gesperrtBlockiertNach: string;
  readonly gesperrtAbschlag: string;
  readonly gesperrtKreis: string;

  readonly regelwerk: string;
  readonly regelwerkHinweis: string;

  /* ── Die stornierende Buchung: `/storno` ───────────────────────────── */
  readonly stornoTitel: string;
  readonly stornoH1: string;
  readonly stornoErklaerungVor: string;
  readonly nichtsGeaendert: string;
  readonly stornoErklaerungNach: string;
  readonly keinKettensatzKurz: string;

  readonly schonStorniertVor: string;
  readonly schonStorniertNach: string;
  readonly ersetztWurdeSieDurch: string;
  readonly zumStornobeleg: string;

  readonly istStornoVor: string;
  readonly hebtAufVor: string;
  readonly hebtAufNach: string;
  readonly istStornoNach: string;
  readonly zumAufgehobenenBeleg: string;

  readonly istEntwurf: string;
  readonly istVerworfen: string;
  readonly zurVerwerfenSeite: string;
  readonly verworfenVonJemandemMit: string;

  readonly gegenrechnungTitel: string;
  readonly keinePositionen: string;
  readonly tabelleStorno: string;
  readonly wirdNichtUebernommen: string;
  readonly mengeImStorno: string;
  readonly nettoImStorno: string;
  readonly ustImStorno: string;
  readonly bruttoImStorno: string;
  readonly nurVor: string;
  readonly leistungszeilen: string;
  readonly nichtGespiegeltNach: string;

  readonly grundMindestensVor: string;
  readonly zeichenAuditfaehig: string;
  readonly grundWirdIn: string;
  readonly grundFestgehalten: string;
  readonly formNurStornoLang: string;
  readonly formKorrekturLang: string;
  readonly neuausstellungVor: string;
  readonly entwurf: string;
  readonly neuausstellungNach: string;
  readonly stornoFussVor: string;

  /**
   * Die Positionsarten — `positionsart`-Enum. `storniere()` spiegelt
   * ausschliesslich `leistung`; die Beschriftung sagt nur, was die Zeile IST.
   */
  readonly positionsartNamen: Readonly<Record<
    'leistung' | 'textzeile' | 'zwischensumme', string>>;

  /* ── Der verworfene Entwurf: `/verwerfen` ──────────────────────────── */
  readonly wechseltVon: string;
  readonly nachWort: string;
  readonly verworfen: string;
  readonly zeileBleibt: string;
  readonly nichtsGeloescht: string;
  readonly keineLuecke: string;

  readonly entwurfKurzform: string;
  readonly wasWiederFrei: string;
  readonly keineQuelle: string;
  readonly quellenErklaerung: string;
  readonly tabelleQuellen: string;
  readonly herkunft: string;
  readonly anteil: string;

  readonly grundPflicht: string;
  readonly grundErklaerung: string;

  readonly verworfenAm: string;
  readonly unbekanntesDatum: string;
  readonly verworfenVon: string;
  readonly kontoOhneNamen: string;
  readonly verworfenWorden: string;
  readonly zeileBleibtStehen: string;
  readonly istFestgeschrieben: string;
  readonly zurStornoseite: string;
  readonly stornoLaeuftUeber: string;
  readonly undVerlangt: string;
  readonly rechtFehltErklaerung: string;

  /**
   * Die Herkunftsarten einer Rechnungszeile (FIN-07) — `quelle.typ` aus
   * `services/finanz/positionsquelle.ts`.
   */
  readonly herkunftNamen: Readonly<Record<
    'zeiteintrag' | 'aufmass' | 'vertrag' | 'material' | 'leistungsnachweis'
    | 'nachtrag' | 'sonderleistung' | 'manuell', string>>;
}

export const RECHNUNG_AKTE_TEXTE: Readonly<Record<InternSprache, RechnungAkteTexte>> = {
  de: {
    rechnungsentwurf: 'Rechnungsentwurf',
    entwurfOhneNummer: 'Entwurf ohne Nummer',
    rechnungsdatum: 'Rechnungsdatum',
    leistungszeitraum: 'Leistungszeitraum',
    nr: 'Nr.',
    netto: 'Netto',
    brutto: 'Brutto',
    umsatzsteuer: 'Umsatzsteuer',
    positionen: 'Positionen',
    position: 'Position',
    beleg: 'Beleg',
    grund: 'Grund',
    grundIst: 'Grund:',
    form: 'Form',
    stornieren: 'Stornieren',
    entwurfVerwerfen: 'Entwurf verwerfen',
    rechnungFestschreiben: 'Rechnung festschreiben',
    kettenbindung: 'Kettenbindung',
    einzelpreis: 'Einzelpreis',
    steuergruppe: 'Steuergruppe',

    zitatAuf: '„',
    zitatZu: '"',

    fin18Auftrag: 'Auftrag',
    fin18Satz:
      'ist abgeschlossen, aber es ist keine einzige Minute erfasst (FIN-18). '
      + 'Entweder fehlt die Zeiterfassung, oder diese Rechnung gehört zu einem '
      + 'anderen Auftrag.',

    alleRechnungen: 'Alle Rechnungen',
    pruefungAnsehen: '§14-UStG-Prüfung ansehen',
    xrechnungAnsehen: 'XRechnung ansehen',
    zugferdPdfLaden: 'ZUGFeRD-PDF laden',
    zugferdAnsehen: 'ZUGFeRD ansehen',
    festschreibenPruefen: 'Festschreiben prüfen',
    abschlaegeUndAbzug: 'Abschläge und Abzug',
    versandprotokoll: 'Versandprotokoll',

    leistungsort: 'Leistungsort',
    zahlungsziel: 'Zahlungsziel',
    zahlungszielFehlt: 'nicht hinterlegt (O-66)',
    tage: 'Tage',

    verworfenLabel: 'Verworfen:',
    aufgehobenDurch: 'Aufgehoben durch Stornorechnung',
    neuAusgestelltAls: ', neu ausgestellt als',
    stornoUnveraendert:
      'Dieser Beleg bleibt unverändert lesbar — korrigiert wird durch '
      + 'Gegenbuchung, nie durch Änderung.',

    keinePosition:
      'Noch keine Position. Ohne Leistungsposition gibt es nichts abzurechnen '
      + '(§14 Abs. 4 Nr. 5 UStG).',
    tabellePositionen: 'Positionen der Rechnung mit Menge, Einzelpreis und Steuersatz',
    codeOffen: 'offen',
    unbestaetigterWert: 'Unbestätigter Wert (O-174)',

    herkunftTitel: 'Herkunft der Positionen',
    anspruchErloschen: 'Anspruch erloschen',
    summeDerBelege: 'Summe der Belege:',
    stimmtUeberein: '— stimmt mit der Position überein.',
    positionTraegt: '— die Position trägt',

    ustJeGruppe: 'Umsatzsteuer je Steuergruppe',
    ustAufschluesselung: 'Aufschlüsselung nach Steuersätzen (§14 Abs. 4 Nr. 8 UStG)',

    abzuegeTitel: 'Abgezogene Abschlagsrechnungen',
    abzuegeBeschriftung: 'Bereits gestellte Abschläge, je Beleg und Steuersatz (FIN-08)',
    steuersatz: 'Steuersatz',
    vom: 'vom',
    zahlbetrag: 'Zahlbetrag',

    steuerfallTitel: 'Steuerfall',
    reverseChargeVorgabe: 'Steuerschuldnerschaft des Leistungsempfängers',
    grundlageBau: ' (§13b Abs. 2 Nr. 4 — Bauleistung)',
    grundlageReinigung: ' (§13b Abs. 2 Nr. 8 — Gebäudereinigung)',
    bauabzugsteuerEinbehalten: 'Bauabzugsteuer einbehalten —',
    ueberwiesenWerden: '. An die Gesellschaft überwiesen werden',
    keineFreistellung:
      ' Es liegt keine am Leistungsdatum gültige Freistellungsbescheinigung vor.',
    freistellungNummer: 'Freistellungsbescheinigung',
    keinEinbehaltFreistellung: 'kein Einbehalt — Freistellungsbescheinigung',
    giltAmLeistungsdatum: 'gilt am Leistungsdatum.',

    artDerLeistung: 'Art der Leistung (§13b Abs. 2 UStG)',
    wederNoch: 'weder Bauleistung noch Gebäudereinigung',
    optionBau: 'Bauleistung (§13b Abs. 2 Nr. 4)',
    optionReinigung: 'Gebäudereinigungsleistung (§13b Abs. 2 Nr. 8)',
    steuerfallHinweis:
      'Aus der Angabe folgt nicht automatisch eine Verlagerung: sie greift nur, '
      + 'wenn für diesen Kunden am Leistungsdatum ein §13b-Status hinterlegt ist. '
      + 'Ohne Nachweis wird die Umsatzsteuer ausgewiesen.',
    steuerfallBestimmen: 'Steuerfall bestimmen',

    abschlaegeErklaerung:
      'Zieht jeden festgeschriebenen Abschlag dieses Auftrags ab — je '
      + 'Steuergruppe, in den Beträgen, die auf den Abschlagsrechnungen stehen. '
      + 'Ohne diesen Schritt weist die Festschreibung den Beleg ab: eine '
      + 'Schlussrechnung, die einen gestellten Abschlag nicht abzieht, verlangt '
      + 'das Geld zweimal.',
    abschlaegeAbziehen: 'Abschläge abziehen',

    zeitzeileTitel: 'Zeile aus der Zeiterfassung',
    zeitzeileTeil1:
      'Nimmt jeden freigegebenen und noch nicht abgerechneten Zeiteintrag der '
      + 'gewählten Leistungszeile, bildet daraus',
    zeitzeileBetont: 'eine',
    zeitzeileTeil2:
      'Zeile und hängt jeden Eintrag als Beleg darunter. Die Menge wird genau '
      + 'einmal gerundet, am Ende.',
    leistungszeile: 'Leistungszeile des Auftrags',
    handelsuebliche: 'Handelsübliche Bezeichnung',
    stundensatzCent: 'Stundensatz (Cent)',
    vonBerlinerTag: 'Von (Berliner Kalendertag)',
    bisEinschliesslich: 'Bis (einschließlich)',
    stundenUebernehmen: 'Stunden übernehmen',

    positionHinzufuegen: 'Position hinzufügen',
    mengeTausendstel: 'Menge (Tausendstel)',
    einzelpreisCent: 'Einzelpreis (Cent)',
    unbestaetigterWertSuffix: ' — unbestätigter Wert',
    herkunftDieserZeile: 'Herkunft dieser Zeile',
    optionVertrag: 'Vertragsposition des Auftrags',
    optionManuell: 'Von Hand — mit Begründung',
    vertragsposition: 'Vertragsposition',
    begruendungVonHand: 'Begründung, falls von Hand erfasst',
    keineZeileOhneBeleg: 'Eine Zeile ohne Beleg entsteht nicht — auch nicht versehentlich.',

    festschreibenTitel: 'Festschreiben',
    festschreibenErklaerung:
      'Vergibt die nächste Nummer aus dem Kreis dieser Gesellschaft und schreibt '
      + 'den Kettensatz — in derselben Transaktion.',
    danachUnveraenderlich: 'Danach ist der Beleg unveränderlich.',
    korrekturIstStorno: 'Eine Korrektur ist dann ein Storno mit Neuausstellung.',
    fin18Begruendung10: 'Begründung, um trotzdem festzuschreiben (mind. zehn Zeichen)',

    verwerfenTitel: 'Verwerfen',
    verwerfenErklaerungKurz:
      'Der Entwurf wird nicht gelöscht — er bleibt mit Grund stehen und kostet '
      + 'keine Nummer.',

    keinKettensatz: 'Kein Kettensatz — das darf nicht vorkommen.',
    kettePositionVor: 'Position',
    kettePositionNach: 'der Kette,',
    stornoRechtFehltVor:
      'Eine festgeschriebene Rechnung wird nicht geändert, sondern durch eine '
      + 'Stornobuchung aufgehoben. Dieses Konto hält das Recht',
    stornoRechtFehltNach: 'nicht — wer es hält, ist noch offen (O-77).',
    korrigieren: 'Korrigieren',
    korrigierenErklaerung:
      'Eine festgeschriebene Rechnung wird nicht geändert. Die stornierende '
      + 'Buchung erzeugt einen eigenen Beleg mit eigener Nummer; die '
      + 'Neuausstellung einen zweiten.',
    grundZehnZeichen: 'Grund (mindestens zehn Zeichen, auditfähig)',
    formKorrektur: 'Storno und Neuausstellung',
    formNurStorno: 'Nur Storno',

    dortBeheben: 'Dort beheben →',
    festschreibenH1: 'Festschreiben — ein Weg, keine Rückkehr',
    warnungTeil1:
      'Mit dem Festschreiben zieht die Datenbank die nächste Nummer aus dem '
      + 'lückenlosen Kreis dieser Gesellschaft und schreibt den Kettensatz — in',
    warnungBetont: 'derselben',
    warnungTeil2: 'Transaktion.',
    warnungTeil3:
      'Eine Korrektur ist dann ein Storno mit Neuausstellung, und beide Belege '
      + 'bleiben für immer stehen.',
    belegIst: 'Dieser Beleg ist',
    zustandVerworfen: 'verworfen',
    zustandFestgeschrieben: 'festgeschrieben',
    undTraegtNummer: 'und trägt die Nummer',
    nichtsMehrFestzuschreiben:
      '. Es gibt hier nichts mehr festzuschreiben — die Zahlen unten sind die, '
      + 'mit denen es geschehen ist.',

    wasUnumkehrbar: 'Was gleich unumkehrbar wird',
    empfaenger: 'Empfänger',
    keineSteuerzeile:
      'Keine Steuerzeile. Ohne Aufteilung je Steuersatzgruppe entsteht keine '
      + 'Rechnung — die Umsatzsteuer wird je Gruppe gerechnet und niemals aus '
      + 'einem Bruttobetrag zurück (Invariante 1).',
    tabelleSteuer: 'Netto und Umsatzsteuer je Steuersatzgruppe',
    steuersatzgruppe: 'Steuersatzgruppe',
    satz: 'Satz',
    nettoGesamt: 'Netto gesamt',
    ustGesamt: 'Umsatzsteuer gesamt',
    abzugFrueherer: 'Abzug früherer Abschläge (FIN-08)',
    bauabzugsteuer48: 'Bauabzugsteuer §48 EStG',
    keinEinbehalt: 'kein Einbehalt',
    zahlbetragKunde: 'Zahlbetrag des Kunden',
    ueberweisungsbetrag: 'Überweisungsbetrag an die Gesellschaft',
    steuerhinweis13b: 'Steuerhinweis (§13b UStG)',

    kreisTitel: 'Der Nummernkreis, der die Nummer zieht',
    keinKreisVor: 'Für',
    ausgangsrechnungen: 'Ausgangsrechnungen',
    keinKreisMitte:
      'ist in dieser Gesellschaft kein offener Nummernkreis ohne Kontext '
      + 'eingerichtet. Ohne ihn entsteht keine Nummer, und ohne Nummer keine '
      + 'Rechnung.',
    keinKreisNach: 'sucht genau diesen einen Kreis — auch für eine Stornorechnung.',
    maske: 'Maske',
    ruecksetzung: 'Rücksetzung',
    nichtFestgelegt: 'nicht festgelegt',
    lueckenlos: 'lückenlos',
    nichtLueckenlos: 'nicht lückenlos',
    zaehlerStehtBei: 'Zähler steht bei',
    nummerEntstehtSpaeter:
      'Die Nummer wird hier nicht angezeigt und nicht vorbelegt. Sie entsteht in '
      + 'der Festschreibungstransaktion, unter Zeilensperre auf dem Zähler — ein '
      + 'Entwurf, der eine Nummer hielte, wäre der Weg, auf dem Lücken entstehen.',

    blockierendTitel: 'Blockierend — §14 UStG',
    keineBlockierenden:
      'Keine blockierenden Befunde. Aus Sicht dieser Prüfung ist die '
      + 'Festschreibung möglich.',
    warnungenTitel: 'Warnungen — sie halten den Beleg nicht auf',
    keineWarnungen: 'Keine Warnungen.',
    abschlaegeAnsehen: 'Abschläge dieser Schlussrechnung ansehen →',

    fin18BegruendungMin: 'Begründung, um trotzdem festzuschreiben (mindestens',
    zeichenKlammer: 'Zeichen)',
    fin18Protokolliert:
      'Sie wird protokolliert und mit dem Snapshot unveränderlich — ein Vermerk, '
      + 'den man später noch ändern kann, ist keiner.',

    gesperrtKeinePosition:
      'Dieser Entwurf hat keine Position. Eine Rechnung ohne Leistung entsteht nicht.',
    gesperrtBlockiertVor: 'Die Festschreibung ist blockiert:',
    gesperrtBlockiertNach:
      'Pflichtangabe(n) fehlen. Sie stehen alle oben — nicht nur die erste.',
    gesperrtAbschlag: 'Ein früherer Abschlag ist noch nicht abgezogen (FIN-08).',
    gesperrtKreis:
      'In diesem Nummernkreis wird nicht festgeschrieben — der Grund steht oben.',

    regelwerk: 'Regelwerk',
    regelwerkHinweis:
      '. Der vollständige §14-Befund wird beim Festschreiben in den Snapshot '
      + 'eingefroren — damit später nachvollziehbar bleibt, welche Regeln auf '
      + 'diesen Beleg angewandt wurden.',

    stornoTitel: 'Storno',
    stornoH1: 'Stornieren — ein zweiter Beleg, kein Eingriff',
    stornoErklaerungVor: 'An dieser Rechnung wird',
    nichtsGeaendert: 'nichts geändert',
    stornoErklaerungNach:
      '. Es entsteht ein zweiter Beleg mit gespiegelten Beträgen, eigener Nummer '
      + 'aus demselben Kreis und eigenem Kettenglied. Beide Belege bleiben für '
      + 'immer stehen und verweisen aufeinander — das ist die einzige '
      + 'rechtmässige Korrektur (Invariante 4, LEG-01).',
    keinKettensatzKurz: 'kein Kettensatz',

    schonStorniertVor: 'Diese Rechnung ist durch',
    schonStorniertNach: ' aufgehoben.',
    ersetztWurdeSieDurch: 'Ersetzt wurde sie durch',
    zumStornobeleg: 'Zum Stornobeleg →',

    istStornoVor: 'Dieser Beleg IST eine stornierende Buchung',
    hebtAufVor: 'und hebt',
    hebtAufNach: ' auf',
    istStornoNach:
      '. Ein Storno wird nicht selbst storniert — eine erneute Korrektur ist '
      + 'eine neue Rechnung.',
    zumAufgehobenenBeleg: 'Zum aufgehobenen Beleg →',

    istEntwurf:
      'Dieser Beleg ist ein Entwurf. Ein Entwurf wird verworfen, nicht '
      + 'storniert — er hat keine Nummer und keine rechtliche Existenz.',
    istVerworfen: 'Dieser Entwurf ist verworfen. Es gibt nichts aufzuheben.',
    zurVerwerfenSeite: 'Zur Verwerfen-Seite →',
    verworfenVonJemandemMit: 'Verworfen wird er von jemandem mit',

    gegenrechnungTitel: 'Die Gegenrechnung, Position für Position',
    keinePositionen: 'Dieser Beleg hat keine Position.',
    tabelleStorno: 'Die Positionen des Stornos — gespiegelte Mengen und Beträge',
    wirdNichtUebernommen: 'wird nicht übernommen',
    mengeImStorno: 'Menge im Storno',
    nettoImStorno: 'Netto im Storno',
    ustImStorno: 'USt im Storno',
    bruttoImStorno: 'Brutto im Storno',
    nurVor: 'Nur',
    leistungszeilen: 'Leistungszeilen',
    nichtGespiegeltNach:
      'werden gespiegelt. Textzeilen und Zwischensummen stehen oben mit dem '
      + 'Vermerk „wird nicht übernommen" und ohne Zahl: eine negierte '
      + 'Zwischensumme wäre eine Summe über Zeilen, die der Stornobeleg gar '
      + 'nicht führt. Die Kopfsummen darunter sind die des Originals, negiert — '
      + 'sie rechnen nicht über die Zeilen dieser Tabelle.',

    grundMindestensVor: 'Grund (mindestens',
    zeichenAuditfaehig: 'Zeichen, auditfähig)',
    grundWirdIn: 'Er wird in',
    grundFestgehalten:
      'festgehalten und steht danach auf beiden Belegen. „Fehler" ist keine '
      + 'Begründung — der Grund muss den Vorgang benennen.',
    formNurStornoLang: 'Nur Storno — die Rechnung wird aufgehoben',
    formKorrekturLang:
      'Storno und Neuausstellung — es entsteht zusätzlich ein neuer Entwurf',
    neuausstellungVor:
      'Die Neuausstellung übernimmt die Positionen und beansprucht die Quellen '
      + 'des Originals neu. Sie ist ein',
    entwurf: 'Entwurf',
    neuausstellungNach:
      '— sie wird nicht automatisch festgeschrieben und hält keine Nummer.',
    stornoFussVor:
      'Der Storno zieht seine eigene Nummer aus demselben Kreis und hängt sich '
      + 'an dieselbe Hashkette. Wer darf stornieren, ist noch offen (O-77) — bis '
      + 'dahin gilt die Katalogvorgabe für',

    positionsartNamen: {
      leistung: 'Leistung', textzeile: 'Textzeile', zwischensumme: 'Zwischensumme',
    },

    wechseltVon: 'Der Entwurf wechselt von',
    nachWort: 'nach',
    verworfen: 'verworfen',
    zeileBleibt: '. Die Zeile bleibt stehen —',
    nichtsGeloescht: 'es wird nichts gelöscht',
    keineLuecke:
      '(Invariante 8). Und weil ein Entwurf nie eine Nummer hält, entsteht keine '
      + 'Lücke im Nummernkreis: der Zähler wird erst beim Festschreiben berührt.',

    entwurfKurzform: 'Der Entwurf in Kurzform',
    wasWiederFrei: 'Was durch das Verwerfen wieder frei wird',
    keineQuelle:
      'Keine Quelle ist an diesem Entwurf gebunden. Es wird also keine Leistung '
      + 'wieder abrechenbar — entweder stehen die Positionen „von Hand", oder '
      + 'der Entwurf hat noch keine.',
    quellenErklaerung:
      'Diese Quellen sind heute als abgerechnet markiert. Nach dem Verwerfen '
      + 'sind sie wieder abrechenbar und erscheinen bei der nächsten Rechnung zu '
      + 'diesem Auftrag erneut.',
    tabelleQuellen: 'Quellen, die durch das Verwerfen wieder abrechenbar werden',
    herkunft: 'Herkunft',
    anteil: 'Anteil',

    grundPflicht: 'Grund (Pflicht)',
    grundErklaerung:
      'Der Grund wird mitgeschrieben. Er ist der Satz, den eine Betriebsprüfung '
      + 'liest, wenn sie nach dem Entwurf fragt, zu dem keine Rechnung entstanden '
      + 'ist. Nach dem Verwerfen ist der Entwurf nur noch lesbar und nicht '
      + 'wiederbelebbar.',

    verworfenAm: 'Dieser Entwurf ist am',
    unbekanntesDatum: 'unbekannten Datum',
    verworfenVon: 'von',
    kontoOhneNamen: 'einem Konto ohne Namen',
    verworfenWorden: ' verworfen worden.',
    zeileBleibtStehen: 'Die Zeile bleibt stehen; wiederbeleben lässt sie sich nicht.',
    istFestgeschrieben:
      'Dieser Beleg ist festgeschrieben. Ein festgeschriebener Beleg wird nicht '
      + 'verworfen, sondern durch eine Stornobuchung aufgehoben — das ist der '
      + 'einzige Weg zu einer Korrektur (Invariante 4).',
    zurStornoseite: 'Zur Stornoseite →',
    stornoLaeuftUeber: 'Der Storno läuft über',
    undVerlangt: 'und verlangt',
    rechtFehltErklaerung:
      '. Dieses Konto hält das Recht nicht — deshalb steht hier der Weg als Satz '
      + 'und nicht als Verweis: ein Verweis auf 404 verrät, was er verbergen '
      + 'soll (AUT-06).',

    herkunftNamen: {
      zeiteintrag: 'Zeiteintrag', aufmass: 'Aufmass', vertrag: 'Vertragsleistung',
      material: 'Material (Ausgabe)', leistungsnachweis: 'Leistungsnachweis',
      nachtrag: 'Nachtrag', sonderleistung: 'Sonderleistung', manuell: 'von Hand',
    },
  },

  en: {
    rechnungsentwurf: 'Invoice draft',
    entwurfOhneNummer: 'Draft without a number',
    rechnungsdatum: 'Invoice date',
    leistungszeitraum: 'Period of supply',
    nr: 'No.',
    netto: 'Net',
    brutto: 'Gross',
    umsatzsteuer: 'Umsatzsteuer (VAT)',
    positionen: 'Line items',
    position: 'Line item',
    beleg: 'Supporting document',
    grund: 'Reason',
    grundIst: 'Reason:',
    form: 'Form',
    stornieren: 'Storno (reversing entry)',
    entwurfVerwerfen: 'Discard draft',
    rechnungFestschreiben: 'Finalise invoice (festschreiben)',
    kettenbindung: 'Hash chain link',
    einzelpreis: 'Unit price',
    steuergruppe: 'Tax group',

    zitatAuf: '"',
    zitatZu: '"',

    fin18Auftrag: 'Auftrag (order)',
    fin18Satz:
      'is closed, but not a single minute has been recorded (FIN-18). Either '
      + 'the time recording is missing, or this invoice belongs to a different '
      + 'Auftrag.',

    alleRechnungen: 'All invoices',
    pruefungAnsehen: 'View the §14 UStG check',
    xrechnungAnsehen: 'View XRechnung',
    zugferdPdfLaden: 'Download ZUGFeRD PDF',
    zugferdAnsehen: 'View ZUGFeRD',
    festschreibenPruefen: 'Check before Festschreibung (finalisation)',
    abschlaegeUndAbzug: 'Abschlagsrechnungen (interim invoices) and deduction',
    versandprotokoll: 'Dispatch log',

    leistungsort: 'Place of supply',
    zahlungsziel: 'Payment terms',
    zahlungszielFehlt: 'not recorded (O-66)',
    tage: 'days',

    verworfenLabel: 'Discarded:',
    aufgehobenDurch: 'Lifted by Storno invoice',
    neuAusgestelltAls: ', reissued as',
    stornoUnveraendert:
      'This document remains readable unchanged — a correction is made by '
      + 'reversing entry (Storno), never by amendment.',

    keinePosition:
      'No line item yet. Without a line of supply there is nothing to invoice '
      + '(§14 (4) no. 5 UStG).',
    tabellePositionen: 'Invoice line items with quantity, unit price and tax rate',
    codeOffen: 'open',
    unbestaetigterWert: 'Unconfirmed value (O-174)',

    herkunftTitel: 'Origin of the line items',
    anspruchErloschen: 'claim extinguished',
    summeDerBelege: 'Total of the supporting records:',
    stimmtUeberein: '— matches the line item.',
    positionTraegt: '— the line item carries',

    ustJeGruppe: 'Umsatzsteuer (VAT) by tax group',
    ustAufschluesselung: 'Breakdown by tax rate (§14 (4) no. 8 UStG)',

    abzuegeTitel: 'Abschlagsrechnungen (interim invoices) deducted',
    abzuegeBeschriftung:
      'Interim invoices already issued, by document and tax rate (FIN-08)',
    steuersatz: 'Tax rate',
    vom: 'of',
    zahlbetrag: 'Amount payable',

    steuerfallTitel: 'Tax treatment',
    reverseChargeVorgabe:
      'Steuerschuldnerschaft des Leistungsempfängers (reverse charge — the '
      + 'recipient owes the Umsatzsteuer)',
    grundlageBau: ' (§13b (2) no. 4 — construction work)',
    grundlageReinigung: ' (§13b (2) no. 8 — building cleaning)',
    bauabzugsteuerEinbehalten:
      'Bauabzugsteuer (construction withholding tax) retained —',
    ueberwiesenWerden: '. Remitted to the company:',
    keineFreistellung:
      ' There is no Freistellungsbescheinigung (exemption certificate) valid on '
      + 'the date of supply.',
    freistellungNummer: 'Freistellungsbescheinigung (exemption certificate)',
    keinEinbehaltFreistellung:
      'no retention — Freistellungsbescheinigung (exemption certificate)',
    giltAmLeistungsdatum: 'is valid on the date of supply.',

    artDerLeistung: 'Type of supply (§13b (2) UStG)',
    wederNoch: 'neither construction work nor building cleaning',
    optionBau: 'Construction work (§13b (2) no. 4)',
    optionReinigung: 'Building cleaning (§13b (2) no. 8)',
    steuerfallHinweis:
      'This entry does not by itself shift the tax liability: it only takes '
      + 'effect if a §13b status is recorded for this customer on the date of '
      + 'supply. Without that evidence the Umsatzsteuer is shown.',
    steuerfallBestimmen: 'Determine tax treatment',

    abschlaegeErklaerung:
      'Deducts every festgeschriebene (finalised) Abschlagsrechnung (interim '
      + 'invoice) of this Auftrag — by tax group, in the amounts stated on those '
      + 'invoices. Without this step the Festschreibung rejects the document: a '
      + 'final invoice that fails to deduct an interim invoice already issued '
      + 'demands the money twice.',
    abschlaegeAbziehen: 'Deduct Abschlagsrechnungen',

    zeitzeileTitel: 'Line from the time recording',
    zeitzeileTeil1:
      'Takes every approved and not yet invoiced Zeiteintrag (time entry) of the '
      + 'chosen order line and forms',
    zeitzeileBetont: 'one',
    zeitzeileTeil2:
      'line from them, hanging each entry underneath as its supporting record. '
      + 'The quantity is rounded exactly once, at the end.',
    leistungszeile: 'Order line of the Auftrag',
    handelsuebliche: 'Customary trade description',
    stundensatzCent: 'Hourly rate (cents)',
    vonBerlinerTag: 'From (Berlin calendar day)',
    bisEinschliesslich: 'To (inclusive)',
    stundenUebernehmen: 'Take over hours',

    positionHinzufuegen: 'Add line item',
    mengeTausendstel: 'Quantity (thousandths)',
    einzelpreisCent: 'Unit price (cents)',
    unbestaetigterWertSuffix: ' — unconfirmed value',
    herkunftDieserZeile: 'Origin of this line',
    optionVertrag: 'Contract line of the Auftrag',
    optionManuell: 'By hand — with a reason',
    vertragsposition: 'Contract line',
    begruendungVonHand: 'Reason, if entered by hand',
    keineZeileOhneBeleg:
      'A line without a supporting record does not come into being — not even '
      + 'by accident.',

    festschreibenTitel: 'Festschreibung (finalisation)',
    festschreibenErklaerung:
      'Draws the next number from this company’s Nummernkreis (number '
      + 'range) and writes the chain record — in the same transaction.',
    danachUnveraenderlich: 'After that the document is immutable.',
    korrekturIstStorno:
      'A correction is then a Storno (reversing entry) with reissue.',
    fin18Begruendung10:
      'Reason for finalising nonetheless (at least ten characters)',

    verwerfenTitel: 'Discard',
    verwerfenErklaerungKurz:
      'The draft is not deleted — it remains, with its reason, and costs no '
      + 'number.',

    keinKettensatz: 'No chain record — this must not happen.',
    kettePositionVor: 'Link',
    kettePositionNach: 'of the chain,',
    stornoRechtFehltVor:
      'A festgeschriebene (finalised) invoice is not amended; it is lifted by a '
      + 'Storno (reversing entry). This account does not hold the right',
    stornoRechtFehltNach: '— who does hold it is still open (O-77).',
    korrigieren: 'Correct',
    korrigierenErklaerung:
      'A festgeschriebene (finalised) invoice is not amended. The reversing '
      + 'entry produces a document of its own with a number of its own; the '
      + 'reissue produces a second.',
    grundZehnZeichen: 'Reason (at least ten characters, audit-proof)',
    formKorrektur: 'Storno and reissue',
    formNurStorno: 'Storno only',

    dortBeheben: 'Fix it there →',
    festschreibenH1: 'Festschreibung — one way, no return',
    warnungTeil1:
      'On Festschreibung the database draws the next number from this '
      + 'company’s gap-free Nummernkreis (number range) and writes the '
      + 'chain record — in',
    warnungBetont: 'the same',
    warnungTeil2: 'transaction.',
    warnungTeil3:
      'A correction is then a Storno (reversing entry) with reissue, and both '
      + 'documents remain for good.',
    belegIst: 'This document is',
    zustandVerworfen: 'verworfen (discarded)',
    zustandFestgeschrieben: 'festgeschrieben (finalised)',
    undTraegtNummer: 'and carries the number',
    nichtsMehrFestzuschreiben:
      '. There is nothing left to finalise here — the figures below are the '
      + 'ones it happened with.',

    wasUnumkehrbar: 'What is about to become irreversible',
    empfaenger: 'Recipient',
    keineSteuerzeile:
      'No tax line. Without a split by tax-rate group no invoice comes into '
      + 'being — the Umsatzsteuer is computed per group and never back out of a '
      + 'gross amount (invariant 1).',
    tabelleSteuer: 'Net and Umsatzsteuer by tax-rate group',
    steuersatzgruppe: 'Tax-rate group',
    satz: 'Rate',
    nettoGesamt: 'Net total',
    ustGesamt: 'Umsatzsteuer total',
    abzugFrueherer:
      'Deduction of earlier Abschlagsrechnungen (interim invoices) (FIN-08)',
    bauabzugsteuer48: 'Bauabzugsteuer §48 EStG (construction withholding tax)',
    keinEinbehalt: 'no retention',
    zahlbetragKunde: 'Amount payable by the customer',
    ueberweisungsbetrag: 'Amount remitted to the company',
    steuerhinweis13b: 'Tax note (§13b UStG)',

    kreisTitel: 'The Nummernkreis that will draw the number',
    keinKreisVor: 'For',
    ausgangsrechnungen: 'Ausgangsrechnungen (outgoing invoices)',
    keinKreisMitte:
      'no open Nummernkreis (number range) without a context is set up in this '
      + 'company. Without one no number comes into being, and without a number '
      + 'no invoice.',
    keinKreisNach:
      'looks for precisely this one range — for a Storno invoice as well.',
    maske: 'mask',
    ruecksetzung: 'reset',
    nichtFestgelegt: 'not specified',
    lueckenlos: 'gap-free',
    nichtLueckenlos: 'not gap-free',
    zaehlerStehtBei: 'counter stands at',
    nummerEntstehtSpaeter:
      'The number is neither shown nor pre-filled here. It comes into being in '
      + 'the Festschreibung transaction, under a row lock on the counter — a '
      + 'draft holding a number would be the very route by which gaps arise.',

    blockierendTitel: 'Blocking — §14 UStG',
    keineBlockierenden:
      'No blocking findings. As far as this check is concerned, Festschreibung '
      + 'is possible.',
    warnungenTitel: 'Warnings — they do not hold the document up',
    keineWarnungen: 'No warnings.',
    abschlaegeAnsehen:
      'View the Abschlagsrechnungen of this Schlussrechnung (final invoice) →',

    fin18BegruendungMin: 'Reason for finalising nonetheless (at least',
    zeichenKlammer: 'characters)',
    fin18Protokolliert:
      'It is logged and made immutable with the snapshot — a note that can '
      + 'still be changed later is no note at all.',

    gesperrtKeinePosition:
      'This draft has no line item. An invoice without a supply does not come '
      + 'into being.',
    gesperrtBlockiertVor: 'Festschreibung is blocked:',
    gesperrtBlockiertNach:
      'mandatory particular(s) missing. They are all listed above — not just '
      + 'the first.',
    gesperrtAbschlag:
      'An earlier Abschlagsrechnung (interim invoice) has not yet been deducted '
      + '(FIN-08).',
    gesperrtKreis:
      'Nothing is finalised in this Nummernkreis — the reason is stated above.',

    regelwerk: 'Rule set',
    regelwerkHinweis:
      '. The full §14 finding is frozen into the snapshot on Festschreibung — '
      + 'so that it remains traceable later which rules were applied to this '
      + 'document.',

    stornoTitel: 'Storno',
    stornoH1: 'Storno — a second document, not an intervention',
    stornoErklaerungVor: 'On this invoice',
    nichtsGeaendert: 'nothing is changed',
    stornoErklaerungNach:
      '. A second document comes into being with mirrored amounts, a number of '
      + 'its own from the same Nummernkreis and a chain link of its own. Both '
      + 'documents remain for good and refer to one another — this is the only '
      + 'lawful correction (invariant 4, LEG-01).',
    keinKettensatzKurz: 'no chain record',

    schonStorniertVor: 'This invoice has been lifted by',
    schonStorniertNach: '.',
    ersetztWurdeSieDurch: 'It was replaced by',
    zumStornobeleg: 'To the Storno document →',

    istStornoVor: 'This document IS a reversing entry (Storno)',
    hebtAufVor: 'and lifts',
    hebtAufNach: '',
    istStornoNach:
      '. A Storno is not itself reversed — a further correction is a new '
      + 'invoice.',
    zumAufgehobenenBeleg: 'To the lifted document →',

    istEntwurf:
      'This document is a draft. A draft is discarded, not reversed — it has no '
      + 'number and no legal existence.',
    istVerworfen: 'This draft has been discarded. There is nothing to lift.',
    zurVerwerfenSeite: 'To the discard page →',
    verworfenVonJemandemMit: 'It is discarded by someone holding',

    gegenrechnungTitel: 'The counter-entry, line by line',
    keinePositionen: 'This document has no line item.',
    tabelleStorno: 'The Storno line items — mirrored quantities and amounts',
    wirdNichtUebernommen: 'not carried over',
    mengeImStorno: 'Quantity in the Storno',
    nettoImStorno: 'Net in the Storno',
    ustImStorno: 'USt in the Storno',
    bruttoImStorno: 'Gross in the Storno',
    nurVor: 'Only',
    leistungszeilen: 'Leistungszeilen (lines of supply)',
    nichtGespiegeltNach:
      'are mirrored. Text lines and subtotals appear above marked "not carried '
      + 'over" and without a figure: a negated subtotal would be a total over '
      + 'lines the Storno document does not even hold. The header totals below '
      + 'are those of the original, negated — they do not total the rows of this '
      + 'table.',

    grundMindestensVor: 'Reason (at least',
    zeichenAuditfaehig: 'characters, audit-proof)',
    grundWirdIn: 'It is recorded in',
    grundFestgehalten:
      'and then appears on both documents. "Error" is not a reason — the reason '
      + 'must name what happened.',
    formNurStornoLang: 'Storno only — the invoice is lifted',
    formKorrekturLang: 'Storno and reissue — a new draft is created as well',
    neuausstellungVor:
      'The reissue takes over the line items and claims the sources of the '
      + 'original afresh. It is a',
    entwurf: 'draft (Entwurf)',
    neuausstellungNach:
      '— it is not finalised automatically and holds no number.',
    stornoFussVor:
      'The Storno draws a number of its own from the same Nummernkreis and '
      + 'attaches itself to the same hash chain. Who may reverse an invoice is '
      + 'still open (O-77) — until then the catalogue default applies for',

    positionsartNamen: {
      leistung: 'Leistung (line of supply)', textzeile: 'Text line',
      zwischensumme: 'Subtotal',
    },

    wechseltVon: 'The draft moves from',
    nachWort: 'to',
    verworfen: 'verworfen (discarded)',
    zeileBleibt: '. The row remains —',
    nichtsGeloescht: 'nothing is deleted',
    keineLuecke:
      '(invariant 8). And because a draft never holds a number, no gap arises '
      + 'in the Nummernkreis: the counter is touched only on Festschreibung.',

    entwurfKurzform: 'The draft in brief',
    wasWiederFrei: 'What becomes free again through discarding',
    keineQuelle:
      'No source is bound to this draft. So no supply becomes invoiceable '
      + 'again — either the line items stand "by hand", or the draft has none '
      + 'yet.',
    quellenErklaerung:
      'These sources are marked as invoiced today. After discarding they are '
      + 'invoiceable again and will reappear on the next invoice for this '
      + 'Auftrag.',
    tabelleQuellen: 'Sources that become invoiceable again through discarding',
    herkunft: 'Origin',
    anteil: 'Share',

    grundPflicht: 'Reason (required)',
    grundErklaerung:
      'The reason is recorded. It is the sentence a tax audit reads when it '
      + 'asks about the draft for which no invoice came into being. After '
      + 'discarding, the draft is readable only and cannot be revived.',

    verworfenAm: 'This draft was discarded on',
    unbekanntesDatum: 'an unknown date',
    verworfenVon: 'by',
    kontoOhneNamen: 'an account without a name',
    verworfenWorden: '.',
    zeileBleibtStehen: 'The row remains; it cannot be revived.',
    istFestgeschrieben:
      'This document is festgeschrieben (finalised). A finalised document is '
      + 'not discarded but lifted by a Storno (reversing entry) — that is the '
      + 'only route to a correction (invariant 4).',
    zurStornoseite: 'To the Storno page →',
    stornoLaeuftUeber: 'The Storno runs via',
    undVerlangt: 'and requires',
    rechtFehltErklaerung:
      '. This account does not hold that right — which is why the route is '
      + 'stated here in words and not as a link: a link to a 404 gives away '
      + 'what it is meant to hide (AUT-06).',

    herkunftNamen: {
      zeiteintrag: 'Zeiteintrag (time entry)', aufmass: 'Aufmass (site measurement)',
      vertrag: 'Contract supply', material: 'Material (issued)',
      leistungsnachweis: 'Leistungsnachweis (proof of performance)',
      nachtrag: 'Nachtrag (variation order)', sonderleistung: 'Special supply',
      manuell: 'by hand',
    },
  },
};
