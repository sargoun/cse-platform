/**
 * Die ENTWURFSTEXTE der oeffentlichen Seiten (O-207).
 *
 * **Was das ist und was es nicht ist.** Jede Seite hat einen Text, damit der
 * Mandant das Projekt ansehen kann, statt vierzehn leere Ueberschriften zu
 * sehen. Die Texte beschreiben sachlich, was die vier Gesellschaften laut
 * `CLAUDE.md` tun — mehr steht nicht drin:
 *
 *  - **keine Zahlen** (Mitarbeiterzahl, Jahre am Markt, Quadratmeter),
 *  - **keine Auszeichnungen und Zertifikate**,
 *  - **keine Kundennamen**,
 *  - **keine Zusagen** ("innerhalb von 24 Stunden", "rund um die Uhr").
 *
 * Der Grund ist nicht Bescheidenheit. Ein Werbesatz, den niemand geprueft hat,
 * steht spaeter woertlich in einem Angebot — und eine Zusage auf der Website
 * ist eine Zusage. Was hier fehlt, ist genau das, was der Mandant beisteuern
 * muss.
 *
 * // TODO(client): O-207 — bitte die Texte durchgehen und ergänzen. Besonders
 * // alles, was eine Zusage an einen Kunden wäre.
 */

export interface InhaltsAbschnitt {
  readonly art: 'hero' | 'text' | 'markenkarten' | 'leistungen';
  readonly ueberschrift: string | null;
  readonly text: string | null;
  /** Fuer `leistungen`: die Liste. Fuer `text`: optionale Fragen und Antworten. */
  readonly daten?: Record<string, unknown>;
}

export interface SeitenInhalt {
  readonly pfad: string;
  readonly beschreibung: string;
  readonly abschnitte: readonly InhaltsAbschnitt[];
}

/** Die Gewerke, wortgleich zu `CLAUDE.md` und zu `unternehmensprofil`. */
const GEWERK = {
  reinigung: 'Gebäudereinigung',
  security: 'Sicherheits- und Objektschutzdienste',
  bau: 'Hochbau, Ausbau, Rückbau',
} as const;

const leistung = (name: string, beschreibung: string) => ({ name, beschreibung });

export const SEITEN: readonly SeitenInhalt[] = [
  {
    pfad: '/',
    beschreibung:
      'Gebäudereinigung, Sicherheitsdienste und Bau in Berlin — vier '
      + 'eigenständige Gesellschaften, eine Ansprechpartnerin.',
    abschnitte: [
      {
        art: 'hero',
        ueberschrift: 'Vier Gewerke, eine',
        text:
          'Reinigung, Sicherheit und Bau in Berlin. Vier eigenständige '
          + 'Gesellschaften, die zusammenarbeiten, wenn ein Auftrag mehr als '
          + 'ein Gewerk braucht — und einzeln arbeiten, wenn nicht.',
      },
      { art: 'markenkarten', ueberschrift: null, text: null },
      {
        art: 'text',
        ueberschrift: 'Warum vier Gesellschaften',
        text:
          'Jedes Gewerk hat eigene Regeln: § 34a GewO für den Sicherheitsdienst, '
          + 'die VOB für den Bau, eigene Tarife und Nachweise für die Reinigung. '
          + 'Getrennte Gesellschaften halten diese Regeln sauber auseinander. '
          + 'Für Sie ändert das nichts: Sie sprechen mit einer Ansprechpartnerin, '
          + 'auch wenn zwei Bereiche beteiligt sind.',
      },
    ],
  },
  {
    pfad: '/unternehmen',
    beschreibung: 'Die vier Gesellschaften der CSE Gruppe im Überblick.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Unternehmen', text:
        'Vier Gesellschaften, ein Standort in Berlin.' },
      { art: 'markenkarten', ueberschrift: null, text: null },
      {
        art: 'text',
        ueberschrift: 'Eigenständig, nicht getrennt',
        text:
          'Jede Gesellschaft führt ihre eigenen Aufträge, ihre eigene Kalkulation '
          + 'und ihre eigene Rechnungsstellung. Wo ein Projekt mehrere Gewerke '
          + 'berührt, stimmen sich die Bereiche ab, statt Sie zwischen drei '
          + 'Firmen zu schicken.',
      },
    ],
  },
  {
    pfad: '/leistungen',
    beschreibung: 'Reinigung, Sicherheitsdienste und Bauleistungen aus Berlin.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Leistungen', text:
        'Was die vier Bereiche anbieten — und wofür Sie welche Anfrage stellen.' },
      {
        art: 'leistungen',
        ueberschrift: 'Gebäudereinigung und Hausdienste',
        text: null,
        // Die Leistungen, die CSE Dienstleistungen selbst nennt (D-473).
        daten: { leistungen: [
          leistung('Unterhaltsreinigung',
            'Wiederkehrende Reinigung, damit Immobilie und Büroräume in einem stets makellosen Zustand bleiben.'),
          leistung('Grundreinigung',
            'Von der Entfernung staubiger Verunreinigungen über die maschinelle Grundreinigung bis zur Sonderreinigung von Oberflächen.'),
          leistung('Fenster- und Büroreinigung',
            'Fenster, Büros, Flure und Teppiche — hochwertig und gründlich.'),
          leistung('Treppenhaus- und Baureinigung',
            'Der erste Eindruck Ihres Gebäudes — und die Reinigung nach Abschluss eines Bauprojekts.'),
          leistung('Abriss / Abbruch, Bauhelfer, Hausmeister',
            'Selektiver Rückbau (nicht statisch), Unterstützung der Fachkräfte auf der Baustelle, Hausmeisterdienste termingerecht oder auf Abruf.'),
        ] },
      },
      {
        art: 'leistungen',
        ueberschrift: 'Sicherheits- und Objektschutzdienste',
        text: null,
        // Die Dienste, die Select Security Event selbst nennt (D-473).
        daten: { leistungen: [
          leistung('Objektschutz und Baustellenbewachung',
            'Bewachung von Gebäuden, Anlagen und Baustellen nach § 34a GewO.'),
          leistung('Veranstaltungsschutz und Personenschutz',
            'Einlass, Ordnung und Aufsicht bei Veranstaltungen; Begleitschutz für Personen.'),
          leistung('Revier-, Interventions- und Brandwachdienste',
            'Kontrollfahrten, Einsatz bei Alarm, Brandsicherheitswachen.'),
          leistung('Empfangs- und Doorman-Service',
            'Empfang, Pforte, Zutrittskontrolle am Eingang.'),
          leistung('Ermittlungsdienste und Sicherheitstechnik',
            'Ermittlungen im gesetzlichen Rahmen; technische Sicherungsanlagen.'),
        ] },
      },
      {
        art: 'leistungen',
        ueberschrift: 'Hochbau, Ausbau, Rückbau',
        text: null,
        daten: { leistungen: [
          leistung('Hochbau', 'Rohbauarbeiten nach Leistungsverzeichnis.'),
          leistung('Ausbau', 'Trockenbau, Bodenbeläge, Malerarbeiten.'),
          leistung('Rückbau', 'Entkernung und Rückbau, mit Entsorgungsnachweis.'),
          leistung('Sanierung', 'Instandsetzung im Bestand.'),
        ] },
      },
    ],
  },
  {
    pfad: '/projekte',
    beschreibung: 'Abgeschlossene Projekte der CSE Gruppe.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Projekte', text: null },
      {
        art: 'text',
        ueberschrift: 'Nur mit schriftlicher Zustimmung',
        /*
         * **Der Text ist die EINLEITUNG, nicht mehr die Entschuldigung.**
         * Er lautete „Hier stehen bald Referenzen" — und die Referenzen gab es
         * längst, auf den vier Gesellschaftsprofilen. Die Liste darunter kommt
         * jetzt aus `referenz` (D-602); dieser Satz erklärt, warum sie kurz
         * ist, und das gilt auf einer gefüllten Liste genauso.
         */
        text:
          'Wir zeigen ein Projekt erst, wenn der Kunde der Nennung schriftlich '
          + 'zugestimmt hat. Ohne diese Zustimmung steht es hier nicht — auch kein '
          + 'abgeschlossenes und auch kein gelungenes. Jedes Projekt führt zu der '
          + 'Gesellschaft, die es ausgeführt hat.',
      },
    ],
  },
  {
    pfad: '/ueber-uns',
    beschreibung: 'Wer hinter der CSE Gruppe steht.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Über uns', text: null },
      {
        art: 'text',
        ueberschrift: 'Was wir tun',
        text:
          `Die CSE Gruppe führt vier Gesellschaften in Berlin: ${GEWERK.reinigung}, `
          + `${GEWERK.security} sowie ${GEWERK.bau}. Dazu kommt CSE Operations, `
          + 'die die digitalen Abläufe der Gruppe verantwortet.',
      },
      {
        art: 'text',
        ueberschrift: 'Wie wir arbeiten',
        text:
          'Jeder Auftrag hat eine benannte zuständige Person. Zeiten werden am '
          + 'Objekt erfasst, nicht nachträglich geschätzt. Leistungsnachweise '
          + 'gehören zur Rechnung, nicht zur Nachfrage.',
      },
    ],
  },
  {
    pfad: '/news',
    beschreibung: 'Aktuelles aus der CSE Gruppe.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Aktuelles', text: null },
      {
        art: 'text',
        ueberschrift: 'Aus den vier Gesellschaften',
        /* Dieselbe Umkehr wie bei `/projekte` (D-602). */
        text:
          'Was die Gesellschaften der Gruppe berichten, steht hier zusammen — '
          + 'jeder Beitrag führt zu der Gesellschaft, von der er stammt.',
      },
    ],
  },
  {
    pfad: '/kontakt',
    beschreibung: 'So erreichen Sie die vier Gesellschaften der CSE Gruppe.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Kontakt', text: null },
      {
        art: 'text',
        ueberschrift: 'Anfrage stellen',
        text:
          'Für ein Angebot nutzen Sie bitte das Formular des passenden Bereichs — '
          + 'dort werden genau die Angaben abgefragt, die wir zum Rechnen '
          + 'brauchen. Anschrift und Telefonnummer aller vier Gesellschaften '
          + 'stehen im Fussbereich jeder Seite und im Impressum.',
      },
    ],
  },
  {
    pfad: '/impressum',
    beschreibung: 'Impressum nach § 5 TMG.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Impressum', text: null },
      {
        art: 'text',
        ueberschrift: 'Angaben nach § 5 TMG',
        // Der Satz stand hier und verwies auf den Fussbereich und auf eine
        // spätere Ergänzung. Beides stimmt nicht mehr: die Angaben je
        // Gesellschaft stehen unter diesem Abschnitt, und was von ihnen noch
        // nicht bestätigt ist, sagt die Seite dort selbst (O-353).
        text:
          'Die Angaben nach § 5 TMG stehen unten je Gesellschaft — Firma, '
          + 'Anschrift, vertretungsberechtigte Personen, Handelsregister und '
          + 'Umsatzsteuer-Identifikationsnummer. Wo eine Angabe noch nicht '
          + 'bestätigt ist, ist sie dort als solche gekennzeichnet.',
      },
    ],
  },
  {
    pfad: '/datenschutz',
    beschreibung: 'Datenschutzerklärung nach Art. 13 DSGVO — Website, Portale und Kerntätigkeit.',
    /*
     * Die Erklaerung folgt der des bestehenden Auftritts
     * (cse-dienstleistungen.de/privacy, Stand April 2020, gelesen am
     * 14.09.2026, D-473) — uebernommen, wo sie fuer diese Plattform stimmt
     * (Verantwortliche, Kerntaetigkeit, Kontaktaufnahme, Rechte,
     * Widerspruch, Sicherheit), und ersetzt, wo sie nicht stimmt: dort wird
     * Google Analytics genannt, hier laeuft kein Analysedienst (PUB-13),
     * und dort steht der Hoster ohne Namen, hier stehen die beiden
     * Auftragsverarbeiter aus `registry/auftragsverarbeiter.ts`.
     *
     * TODO(client, O-362): Welche Gesellschaft betreibt den Gruppenauftritt
     * und die Portale (Verantwortliche nach Art. 4 Nr. 7 DSGVO) — die CSE
     * Dienstleistungen GmbH wie beim bisherigen Auftritt? Gibt es einen
     * Datenschutzbeauftragten, und welche Loeschfristen gelten fuer
     * Anfragen (der Auftritt nennt eine Pruefung alle zwei Jahre)?
     */
    abschnitte: [
      { art: 'hero', ueberschrift: 'Datenschutz', text:
        'Datenschutzerklärung nach Art. 13 DSGVO für diese Website und die '
        + 'Portale der Gruppe. Stand: September 2026.' },
      {
        art: 'text',
        ueberschrift: 'Wer für die Datenverarbeitung verantwortlich ist',
        text:
          'Verantwortlich für die Datenverarbeitung ist die CSE Dienstleistungen '
          + 'GmbH, Kurfürstendamm 201, 10719 Berlin, Deutschland, Telefon '
          + '+49 30 91203341, office@cse-dienstleistungen.de. Ansprechpartnerin '
          + 'in Fragen des Datenschutzes ist Cosette Weyer. Diese Erklärung gilt '
          + 'für den gemeinsamen Auftritt der vier Gesellschaften der Gruppe; die '
          + 'Angaben zu jeder Gesellschaft stehen im Impressum.',
      },
      {
        art: 'text',
        ueberschrift: 'Personenbezogene Daten — was damit gemeint ist',
        text:
          'Mit dieser Datenschutzerklärung möchten wir Sie über Art, Umfang und '
          + 'Zweck der Verarbeitung von personenbezogenen Daten aufklären. '
          + 'Personenbezogene Daten sind alle Daten, die einen persönlichen Bezug '
          + 'zu Ihnen aufweisen, zum Beispiel Name, Adresse, E-Mail-Adresse oder '
          + 'Nutzerverhalten.',
      },
      {
        art: 'text',
        ueberschrift: 'Verarbeitung im Rahmen unserer Kerntätigkeit',
        text:
          'Wir verarbeiten die an uns übertragenen personenbezogenen Daten im '
          + 'Rahmen der zwischen uns bestehenden vertraglichen und vorvertraglichen '
          + 'Beziehungen. Umfang, Art, Zweck und Erforderlichkeit der Verarbeitung '
          + 'richten sich nach dem jeweils zugrunde liegenden Vertragsverhältnis. '
          + 'Dazu gehören insbesondere Name und Adresse, E-Mail-Adresse und '
          + 'Telefonnummer, Vertragsdaten und Zahlungsdaten. Die Verarbeitung '
          + 'beschränkt sich auf die Daten, die zur Beantwortung von Anfragen '
          + 'oder zur Erfüllung eines Vertrages erforderlich und zweckmäßig sind. '
          + 'Eine Weitergabe an Dritte erfolgt nur, wenn dies zur Erbringung der '
          + 'Leistung, zur Abwicklung der Finanzbuchhaltung oder zur Befolgung '
          + 'gesetzlicher Verpflichtungen erforderlich ist — und dann nur mit den '
          + 'Daten, die dafür nötig sind. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b '
          + 'DSGVO (Vertragserfüllung); im Übrigen Art. 6 Abs. 1 lit. c DSGVO '
          + '(gesetzliche Verpflichtung) oder Art. 6 Abs. 1 lit. f DSGVO '
          + '(berechtigtes Interesse, etwa zur Verfolgung unserer Ansprüche). '
          + 'Gelöscht wird, sobald die Daten nicht mehr zur Erfüllung vertraglicher '
          + 'oder gesetzlicher Pflichten, für Gewährleistung und vergleichbare '
          + 'Pflichten erforderlich sind; gesetzliche Aufbewahrungspflichten '
          + '(§ 147 AO, § 257 HGB) bleiben unberührt.',
      },
      {
        art: 'text',
        ueberschrift: 'Hosting und Auftragsverarbeiter',
        text:
          'Website und Portale werden von Vercel ausgeliefert (Serverfunktionen '
          + 'in der EU-Region); Datenbank, Anmeldung und Dateiablage laufen bei '
          + 'Supabase in Frankfurt (EU). Beide Anbieter verarbeiten in unserem '
          + 'Auftrag nach Art. 28 DSGVO. Beim Aufruf einer Seite verarbeitet der '
          + 'Hoster die Daten, die Ihr Browser übermittelt: IP-Adresse, Datum und '
          + 'Uhrzeit des Zugriffs, Zugriffsstatus, übertragene Datenmenge, '
          + 'Browsertyp und -version, Betriebssystem, die zuvor besuchte Seite '
          + 'und die aufgerufenen Seiten. Das ist erforderlich, um die Seite '
          + 'darzustellen und Stabilität und Sicherheit zu gewährleisten; darin '
          + 'liegt unser berechtigtes Interesse, Art. 6 Abs. 1 lit. f DSGVO. Diese '
          + 'Zugriffsdaten werden nur so lange gespeichert, wie es für Betrieb und '
          + 'Sicherheit erforderlich ist. Das Verzeichnis der Auftragsverarbeiter '
          + 'führen wir in der Plattform; eine Übermittlung in Drittländer findet '
          + 'nicht statt.',
      },
      {
        art: 'text',
        ueberschrift: 'Keine Dritten auf dieser Seite',
        text:
          'Diese Website lädt keine Schriften, keine Analysewerkzeuge und keine '
          + 'Karten von fremden Servern und setzt keine Cookies zu Analyse- oder '
          + 'Werbezwecken. Deshalb gibt es auch keinen Cookie-Banner: es gibt '
          + 'nichts zu erlauben. Nach der Anmeldung in einem Portal setzt die '
          + 'Anwendung ein technisch notwendiges Sitzungscookie (§ 25 Abs. 2 Nr. 2 '
          + 'TTDSG); es endet mit der Abmeldung. Wählen Sie als Beschäftigte oder '
          + 'Beschäftigter auf der Anmeldeseite oder der Stempeluhr eine Sprache '
          + 'oder speichern Sie sie in Ihrem Profil, merkt sich Ihr Browser diese '
          + 'Wahl in einem Cookie namens „cse_sprache". Es enthält nur das Kürzel '
          + 'der Sprache (de, en, ar oder tr) und nichts über Ihre Person und dient '
          + 'allein dazu, diese Seiten auch ohne Anmeldung in Ihrer Sprache zu '
          + 'zeigen (§ 25 Abs. 2 Nr. 2 TTDSG). Es endet, wenn Sie den Browser '
          + 'schließen; die Abmeldung löscht es nicht.',
      },
      {
        art: 'text',
        ueberschrift: 'Wenn Sie uns kontaktieren oder ein Formular absenden',
        text:
          'Soweit Sie uns über E-Mail, Telefon, Post oder unser Kontakt- und '
          + 'Anfrageformular ansprechen und dabei personenbezogene Daten wie Ihren '
          + 'Namen, Ihre Telefonnummer oder Ihre E-Mail-Adresse zur Verfügung '
          + 'stellen, werden diese Daten zur Bearbeitung Ihrer Anfrage in unserem '
          + 'Haus gespeichert und weiterverarbeitet. Bei einem Formular speichern '
          + 'wir, was Sie eingetragen haben, dazu Datum und Uhrzeit des Eingangs '
          + 'sowie einen nicht rückrechenbaren Prüfwert Ihrer IP-Adresse zur '
          + 'Missbrauchsabwehr; die IP-Adresse selbst wird nicht gespeichert. '
          + 'Rechtsgrundlage ist Art. 6 Abs. 1 lit. a DSGVO, wenn Sie das '
          + 'Formular nutzen, Art. 6 Abs. 1 lit. b DSGVO im Rahmen vertraglicher '
          + 'oder vorvertraglicher Beziehungen, sonst unser berechtigtes Interesse '
          + 'an einer ordnungsgemäßen Beantwortung, Art. 6 Abs. 1 lit. f DSGVO. '
          + 'Die Daten werden gelöscht, sobald sie nicht mehr erforderlich sind; '
          + 'wir prüfen die Erforderlichkeit alle zwei Jahre. Eine erteilte '
          + 'Einwilligung können Sie jederzeit widerrufen.',
      },
      {
        art: 'text',
        ueberschrift: 'Kunden- und Mitarbeiterportal',
        text:
          'In den Portalen verarbeiten wir die Daten, die für die Zusammenarbeit '
          + 'nötig sind: Zugangsdaten und Sitzung, für Kundinnen und Kunden die '
          + 'Aufträge, Leistungsnachweise und Rechnungen, für Beschäftigte die '
          + 'Beschäftigungsdaten, Dienstpläne, Zeiterfassung und Nachweise. '
          + 'Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, für Beschäftigte '
          + '§ 26 BDSG, und Art. 6 Abs. 1 lit. c DSGVO, wo das Gesetz eine '
          + 'Aufzeichnung verlangt (etwa § 17 MiLoG für Arbeitszeiten). Die '
          + 'Speicherdauer folgt den gesetzlichen Aufbewahrungsfristen; danach '
          + 'werden die Daten gelöscht oder gesperrt.',
      },
      {
        art: 'text',
        ueberschrift: 'Ihre Rechte nach der DSGVO',
        text:
          'Sie können jederzeit gegenüber der oben genannten Verantwortlichen '
          + 'folgende Rechte geltend machen: Auskunft (Art. 15 DSGVO) darüber, ob '
          + 'und welche personenbezogenen Daten wir von Ihnen verarbeiten, zu '
          + 'welchen Zwecken, an welche Empfänger, wie lange und woher; '
          + 'Berichtigung unrichtiger oder Vervollständigung unvollständiger '
          + 'Daten (Art. 16); Löschung (Art. 17), soweit wir die Verarbeitung '
          + 'nicht zur Erfüllung einer rechtlichen Verpflichtung oder zur '
          + 'Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen '
          + 'benötigen; Einschränkung der Verarbeitung (Art. 18); Unterrichtung '
          + '(Art. 19); Datenübertragbarkeit (Art. 20) in einem strukturierten, '
          + 'gängigen und maschinenlesbaren Format; und das Recht, sich bei einer '
          + 'Aufsichtsbehörde zu beschweren (Art. 77) — an Ihrem Aufenthaltsort, '
          + 'Ihrem Arbeitsplatz oder unserem Firmensitz. Eine erteilte '
          + 'Einwilligung können Sie nach Art. 7 Abs. 3 DSGVO jederzeit '
          + 'widerrufen; die Rechtmäßigkeit der bis dahin erfolgten Verarbeitung '
          + 'bleibt davon unberührt.',
      },
      {
        art: 'text',
        ueberschrift: 'Widerspruchsrecht',
        text:
          'Sie haben das Recht, aus Gründen, die sich aus Ihrer besonderen '
          + 'Situation ergeben, jederzeit gegen die Verarbeitung Ihrer '
          + 'personenbezogenen Daten Widerspruch einzulegen, die aufgrund einer '
          + 'Interessenabwägung (Art. 6 Abs. 1 lit. f DSGVO) erfolgt — insbesondere '
          + 'dann, wenn die Verarbeitung nicht zur Erfüllung eines Vertrages '
          + 'erforderlich ist. Wir verarbeiten Ihre Daten dann nicht mehr, es sei '
          + 'denn, wir können zwingende schutzwürdige Gründe nachweisen, die Ihre '
          + 'Interessen und Rechte überwiegen. Der Verarbeitung für Zwecke der '
          + 'Werbung können Sie jederzeit ohne Angabe von Gründen widersprechen. '
          + 'Richten Sie Ihren Widerspruch an die oben angegebene Kontaktadresse.',
      },
      {
        art: 'text',
        ueberschrift: 'Sicherheitsmaßnahmen',
        text:
          'Wir treffen technische und organisatorische Sicherheitsmaßnahmen nach '
          + 'dem Stand der Technik, um die Vorschriften der Datenschutzgesetze '
          + 'einzuhalten und Ihre Daten gegen zufällige oder vorsätzliche '
          + 'Manipulationen, teilweisen oder vollständigen Verlust, Zerstörung '
          + 'oder den unbefugten Zugriff Dritter zu schützen. Alle Dienste, die '
          + 'diese Plattform betreiben, sind auf EU-Regionen festgelegt; Dateien '
          + 'liegen in privaten Ablagen und werden nur über zeitlich begrenzte, '
          + 'signierte Adressen ausgegeben.',
      },
      {
        art: 'text',
        ueberschrift: 'Aktualität und Änderung dieser Datenschutzerklärung',
        text:
          'Diese Datenschutzerklärung ist aktuell gültig und hat den Stand '
          + 'September 2026. Aufgrund geänderter gesetzlicher oder behördlicher '
          + 'Vorgaben oder einer Weiterentwicklung der Plattform kann es notwendig '
          + 'werden, sie anzupassen; die jeweils gültige Fassung steht an dieser '
          + 'Stelle.',
      },
    ],
  },
  {
    pfad: '/unternehmen/reinigung',
    beschreibung: `CSE Dienstleistungen GmbH — ${GEWERK.reinigung} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'CSE Dienstleistung', text: GEWERK.reinigung },
      /*
       * Die Saetze und die zehn Leistungen stehen so auf
       * cse-dienstleistungen.de (Stand 13.09.2026, D-473) — uebernommen, nicht
       * erfunden; ein Tippfehler des Auftritts („Dienstleistungspatner") ist
       * berichtigt.
       */
      {
        art: 'text',
        ueberschrift: 'Wir sind Ihr starker Dienstleistungspartner',
        text:
          'Unser kompetentes Team besteht aus motivierten und geschulten '
          + 'Mitarbeitern, die genau wissen, worauf es ankommt. Mit '
          + 'dementsprechendem Know-how setzen wir jede von uns angebotene '
          + 'Dienstleistung um und legen besonders viel Wert auf Qualität und '
          + 'Gründlichkeit. Unsere Dienstleistungen sind von A bis Z breit '
          + 'gefächert, wie z. B. Abrissarbeiten, Bauhelfer, Hausmeister oder die '
          + 'alltägliche Unterhaltsreinigung Ihrer Immobilie. Natürlich passen wir '
          + 'unsere Leistungen stets den Bedürfnissen und Wünschen unserer Kunden an.',
      },
      {
        art: 'leistungen',
        ueberschrift: 'Unsere Leistungen',
        text: null,
        daten: {
          leistungen: [
            leistung('Unterhaltsreinigung',
              'Möchten Sie Ihre Immobilie und die Büroräume in einem stets makellosen Zustand halten?'),
            leistung('Grundreinigung',
              'Von der Entfernung staubiger Verunreinigungen aller Art über die maschinelle Grundreinigung bis hin zur Sonderreinigung von Oberflächen.'),
            leistung('Fensterreinigung',
              'Mit unserer hochwertigen und gründlichen Reinigung verleihen Sie Ihren Fenstern den Glanz und das strahlende Aussehen, das sie verdienen.'),
            leistung('Büroreinigung',
              'Qualitativ hochwertige Büroreinigung sowie die Pflege und Wartung von Fluren und Teppichen.'),
            leistung('Treppenhausreinigung',
              'Das Treppenhaus ist mitunter der erste Eindruck Ihres Gebäudes.'),
            leistung('Baureinigung',
              'Sie stellt sicher, dass alle Materialien und Abfälle nach Beendigung des Projektes vollständig entfernt werden.'),
            leistung('Abriss / Abbruch',
              'Selektiver Rückbau (Abriss/Abbruch, nicht statisch) sämtlicher Einbauten bis zur Herstellung des Rohbauzustandes.'),
            leistung('Bauhelfer',
              'Bauhelfer sind auf zahlreichen Baustellen nicht mehr wegzudenken, da sie die Fachkräfte vor Ort entlasten.'),
            leistung('Hausmeister',
              'Ein Hausmeister übernimmt zahlreiche Aufgaben, die er für Eigentümer und Mieter termingerecht oder auf Abruf erledigt.'),
            leistung('Bauvermittlung',
              'Mit unserer Vermittlung erhalten Sie Zugang zu einem Netzwerk erfahrener Bauunternehmen und Handwerker.'),
          ],
          faq: [
            {
              frage: 'Was brauchen Sie für ein Angebot?',
              antwort:
                'Gebäudetyp, Fläche in Quadratmetern, Anzahl der Objekte, '
                + 'gewünschte Frequenz und den Wunschtermin für den Start. '
                + 'Genau das fragt das Anfrageformular ab.',
            },
            {
              frage: 'Reinigen Sie auch am Wochenende?',
              antwort:
                'Einsatzzeiten werden je Objekt vereinbart. Bitte tragen Sie '
                + 'Ihren Wunsch in die Anfrage ein.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/security',
    beschreibung: `SSE Security — ${GEWERK.security} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'SSE Security', text: GEWERK.security },
      /*
       * Leitsatz und die zehn Dienste stehen so auf select-security.de (Stand
       * 13.09.2026, D-473). Der Auftritt beschreibt die Dienste nicht naeher;
       * die Kurzbeschreibungen hier sagen nur, was das Wort bedeutet.
       */
      {
        art: 'text',
        ueberschrift: 'Wir sichern Berlin',
        text:
          'Ihr Partner für professionelle Sicherheitslösungen – zuverlässig, '
          + 'diskret und einsatzbereit. Ob Objektschutz, Personenschutz oder '
          + 'Veranstaltungssicherheit – wir stehen für kompromisslose Sicherheit '
          + 'in jeder Situation.',
      },
      {
        art: 'leistungen',
        ueberschrift: 'Unsere Dienste',
        text: null,
        daten: {
          leistungen: [
            leistung('Objektschutz', 'Bewachung von Gebäuden und Anlagen (§ 34a GewO).'),
            leistung('Baustellenbewachung', 'Schutz von Baustellen, Material und Gerät.'),
            leistung('Brandwachen', 'Brandsicherheitswache bei Arbeiten und Veranstaltungen.'),
            leistung('Personenschutz', 'Begleitschutz für Personen.'),
            leistung('Revier- und Interventionsdienste', 'Kontrollfahrten und Einsatz bei Alarm.'),
            leistung('Ermittlungs- und Detekteidienste', 'Ermittlungen im gesetzlichen Rahmen.'),
            leistung('Veranstaltungsschutz', 'Einlass, Ordnung und Aufsicht bei Veranstaltungen.'),
            leistung('Hostessen- und Empfangsservice', 'Empfang, Pforte und Gästebetreuung.'),
            leistung('Doorman-Service', 'Zutrittskontrolle am Eingang.'),
            leistung('Sicherheitstechnik', 'Technische Sicherungsanlagen.'),
          ],
          faq: [
            {
              frage: 'Was brauchen Sie für ein Angebot?',
              antwort:
                'Anlass, Zeitraum mit Datum und Uhrzeit, erwartete Besucherzahl, '
                + 'benötigte Kräfte und den Einsatzort.',
            },
            {
              frage: 'Sind Ihre Kräfte nach § 34a GewO unterrichtet?',
              antwort:
                'Der Nachweis nach § 34a GewO ist Voraussetzung für den Einsatz '
                + 'und wird je Mitarbeiterin und Mitarbeiter geführt.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/bau',
    beschreibung: `REALTIME Service GmbH — ${GEWERK.bau} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'REALTIME Service', text: GEWERK.bau },
      {
        art: 'leistungen',
        ueberschrift: 'Unsere Gewerke',
        text: null,
        daten: {
          leistungen: [
            leistung('Hochbau', 'Rohbauarbeiten nach Leistungsverzeichnis.'),
            leistung('Ausbau', 'Trockenbau, Bodenbeläge, Malerarbeiten.'),
            leistung('Rückbau', 'Entkernung, mit Entsorgungsnachweis.'),
            leistung('Sanierung', 'Instandsetzung im Bestand.'),
          ],
          faq: [
            {
              frage: 'Was brauchen Sie für ein Angebot?',
              antwort:
                'Gewerk, Umfang und den gewünschten Fertigstellungstermin. Wenn '
                + 'Sie ein Leistungsverzeichnis haben, können Sie es als PDF oder '
                + 'XLSX direkt an die Anfrage hängen.',
            },
            {
              frage: 'Arbeiten Sie nach VOB?',
              antwort:
                'Bauleistungen werden nach VOB/B abgewickelt, sofern nichts '
                + 'anderes vereinbart ist.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/operations',
    beschreibung: 'CSE Operations — digitale Abläufe, Auswertung und Gruppensteuerung.',
    abschnitte: [
      {
        art: 'hero',
        ueberschrift: 'CSE Operations',
        text: 'Digitale Abläufe, Auswertung und Gruppensteuerung.',
      },
      {
        art: 'text',
        ueberschrift: 'Was Operations macht',
        text:
          'CSE Operations betreibt die Plattform, auf der die drei anderen '
          + 'Gesellschaften arbeiten: Zeiterfassung, Dienstplanung, '
          + 'Leistungsnachweise, Auswertung. Für externe Kunden bietet der '
          + 'Bereich dieselbe Arbeit an — Abläufe aufnehmen, digitalisieren und '
          + 'auswertbar machen.',
      },
    ],
  },
];

/**
 * Die LEISTUNGSSEITEN unter `/leistungen/<slug>` — vorläufiger
 * Demonstrationsbestand (PUB-07, PUB-11).
 *
 * **Warum sie getrennt von `SEITEN` stehen.** `SEITEN` wird gegen
 * `OEFFENTLICHE_ROUTEN` abgeglichen, und das ist die Liste der FESTEN Seiten;
 * eine Leistungsseite ist dagegen Redaktion und entsteht als `seite`-Zeile,
 * ohne dass im Code eine erlaubte Slugliste steht. Die Route
 * `/leistungen/[slug]` liest jede solche Zeile, `sitemapEintraege` nimmt sie
 * automatisch auf.
 *
 * **Warum es überhaupt eine gibt.** Ohne Zeile antwortet die Route für jeden
 * Slug 404, und dann läuft auch der `Service`-Block aus `seiten-daten.ts` nie
 * — fertig gemeldeter, zur Laufzeit ungesehener Code. Eine Zeile je Sprache
 * ist das Minimum, das die Route wirklich ausführt.
 *
 * **Sie sagt selbst, dass sie vorläufig ist.** Der Text nennt O-652, und
 * `mandant_id` bleibt NULL: solange niemand entschieden hat, WELCHE
 * Gesellschaft eine Leistungsseite verantwortet, bleibt `Service.provider`
 * weg (siehe `seitenService` in `services/inhalt/jsonld.ts`). Die
 * Leistungsbeschreibung selbst ist nicht erfunden — sie steht wortgleich in
 * der Liste auf `/leistungen` (D-473).
 *
 * // TODO(client, O-652): Welche Leistungen bekommen eine eigene Seite unter
 * `/leistungen/<slug>`, und welche Gesellschaft verantwortet sie?
 */
export interface LeistungsSeite extends SeitenInhalt {
  readonly titel: string;
}

export const LEISTUNGSSEITEN: readonly LeistungsSeite[] = [
  {
    pfad: '/leistungen/unterhaltsreinigung',
    titel: 'Unterhaltsreinigung',
    beschreibung:
      'Wiederkehrende Reinigung nach vereinbartem Leistungsverzeichnis — '
      + 'Berlin.',
    abschnitte: [
      {
        art: 'hero',
        ueberschrift: 'Unterhaltsreinigung',
        text:
          'Wiederkehrende Reinigung, damit Immobilie und Büroräume in einem '
          + 'stets makellosen Zustand bleiben.',
      },
      {
        art: 'text',
        ueberschrift: 'Vorläufige Seite',
        text:
          'Diese Seite ist Demonstrationsbestand. Sie zeigt, wie eine '
          + 'einzelne Leistung als eigene Seite aussieht — welche Leistungen '
          + 'eine eigene Seite bekommen und welche Gesellschaft sie '
          + 'verantwortet, ist noch nicht entschieden (offen O-652). Bis '
          + 'dahin nennt die Seite keine Gesellschaft als Anbieter.',
      },
    ],
  },
];
