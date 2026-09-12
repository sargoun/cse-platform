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
        ueberschrift: 'Gebäudereinigung',
        text: null,
        daten: { leistungen: [
          leistung('Unterhaltsreinigung',
            'Wiederkehrende Reinigung nach vereinbartem Leistungsverzeichnis.'),
          leistung('Glas- und Rahmenreinigung',
            'Fenster, Fassadenelemente und Rahmen, innen und aussen.'),
          leistung('Bauendreinigung',
            'Die Reinigung nach Abschluss der Bauarbeiten, vor der Übergabe.'),
          leistung('Sonderreinigung',
            'Einmalige Einsätze nach Absprache.'),
        ] },
      },
      {
        art: 'leistungen',
        ueberschrift: 'Sicherheits- und Objektschutzdienste',
        text: null,
        daten: { leistungen: [
          leistung('Objektschutz',
            'Bewachung von Gebäuden und Anlagen nach § 34a GewO.'),
          leistung('Veranstaltungsdienst',
            'Einlass, Ordnung und Aufsicht bei Veranstaltungen.'),
          leistung('Empfangsdienst',
            'Besetzung von Empfang und Pforte.'),
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
        ueberschrift: 'Hier stehen bald Referenzen',
        text:
          'Projekte erscheinen an dieser Stelle, sobald der jeweilige Kunde der '
          + 'Nennung schriftlich zugestimmt hat. Ohne diese Zustimmung wird kein '
          + 'Projekt gezeigt — auch kein abgeschlossenes und auch kein gelungenes.',
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
        ueberschrift: 'Noch keine Beiträge',
        text: 'Sobald es etwas zu berichten gibt, steht es hier.',
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
    beschreibung: 'Datenschutzhinweise nach DSGVO.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Datenschutz', text: null },
      {
        art: 'text',
        ueberschrift: 'Keine Dritten auf dieser Seite',
        text:
          'Diese Website lädt keine Schriften, keine Analysewerkzeuge und keine '
          + 'Karten von fremden Servern. Deshalb gibt es auch keinen '
          + 'Cookie-Banner: es gibt nichts zu erlauben.',
      },
      {
        art: 'text',
        ueberschrift: 'Wenn Sie ein Formular absenden',
        text:
          'Wir speichern, was Sie eingetragen haben, dazu Datum und Uhrzeit des '
          + 'Eingangs sowie einen nicht rückrechenbaren Prüfwert Ihrer '
          + 'IP-Adresse zur Missbrauchsabwehr. Die IP-Adresse selbst wird nicht '
          + 'gespeichert. Grundlage ist Art. 6 Abs. 1 lit. b und f DSGVO — die '
          + 'Bearbeitung Ihrer Anfrage.',
      },
    ],
  },
  {
    pfad: '/unternehmen/reinigung',
    beschreibung: `CSE Dienstleistungen GmbH — ${GEWERK.reinigung} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'CSE Dienstleistung', text: GEWERK.reinigung },
      {
        art: 'leistungen',
        ueberschrift: 'Was wir reinigen',
        text: null,
        daten: {
          leistungen: [
            leistung('Unterhaltsreinigung', 'Wiederkehrend, nach Leistungsverzeichnis.'),
            leistung('Glas- und Rahmenreinigung', 'Innen und aussen.'),
            leistung('Bauendreinigung', 'Nach Abschluss der Bauarbeiten.'),
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
      {
        art: 'leistungen',
        ueberschrift: 'Unsere Dienste',
        text: null,
        daten: {
          leistungen: [
            leistung('Objektschutz', 'Bewachung nach § 34a GewO.'),
            leistung('Veranstaltungsdienst', 'Einlass, Ordnung und Aufsicht.'),
            leistung('Empfangsdienst', 'Empfang und Pforte.'),
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
