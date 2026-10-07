import type { Sprache } from '@/lib/sprache';

/**
 * Die Sätze des Karrierebereichs — deutsch und englisch (D-82, V-393).
 *
 * **Eine Tabelle, nicht zwei Seitenbäume mit eigenem Wortlaut.** Die deutsche
 * und die englische Route rufen dieselben Bauteile; was sich unterscheidet,
 * steht hier — wie bei der Barrierefreiheitserklärung (`texte.ts` dort). Der
 * nächste Absatz landet sonst in einer Fassung und fehlt in der anderen.
 *
 * **Die Stellentexte stehen NICHT hier.** Titel, Beschreibung und
 * Anforderungen erfasst das Recruiting in einer Sprache, und so werden sie
 * gezeigt; die englische Seite sagt das in einem Satz (`stellenSprache`) und
 * markiert den Text mit `lang="de"` (WCAG 3.1.2), statt eine Übersetzung zu
 * behaupten, die niemand geschrieben hat.
 */
export interface KarriereTexte {
  readonly titel: string;
  readonly metaTitel: string;
  readonly metaBeschreibung: string;
  readonly einleitung: string;
  /** Englisch: der Satz über die Sprache der Stellentexte. Deutsch: keiner. */
  readonly stellenSprache: string | null;
  readonly filterLabel: string;
  readonly alleGesellschaften: string;
  readonly stellenZahl: (anzahl: number) => string;
  readonly keineStellen: string;
  readonly keineStellenBei: (gesellschaft: string) => string;
  readonly nachAbsprache: string;
  readonly stundenProWoche: (stunden: string) => string;
  readonly bewerbungBis: (datum: string) => string;
  readonly nichtsPassend: string;
  readonly initiativText: string;
  readonly initiativKnopf: string;

  readonly zurueckLabel: string;
  readonly zurueckAlle: string;
  readonly stelleMetaTitel: string;
  readonly erwartungen: string;
  readonly erwartungenHinweis: string;
  readonly aufStelleBewerben: string;

  /** Vor dem Stellentitel in der Überschrift des Formulars. */
  readonly bewerbungVor: string;
  readonly bewerbungMetaTitel: string;
  readonly initiativTitel: string;
  readonly initiativEinleitung: string;
  readonly initiativMetaTitel: string;

  readonly bereichLabel: string;
  readonly bitteWaehlen: string;
  readonly nameLabel: string;
  readonly emailLabel: string;
  readonly emailTitel: string;
  readonly telefonLabel: string;
  readonly nachrichtLabel: string;
  readonly uploadTitel: string;
  readonly uploadText: string;
  readonly datenschutzVor: string;
  readonly datenschutzTage: (tage: number) => string;
  readonly datenschutzNach: string;
  readonly datenschutzLink: string;
  readonly absenden: string;

  readonly dankeMetaTitel: string;
  readonly dankeTitel: string;
  readonly dankeText: string;
  readonly aufbewahrungOhneZahl: string;
  readonly aufbewahrungVor: string;
  readonly aufbewahrungTage: (tage: number) => string;
  readonly aufbewahrungNach: string;
  readonly frueherLoeschen: string;
  readonly zurueckZuStellen: string;
}

export const KARRIERE_TEXTE: Readonly<Record<Sprache, KarriereTexte>> = {
  de: {
    titel: 'Karriere',
    metaTitel: 'Karriere — CSE Gruppe',
    metaBeschreibung:
      'Offene Stellen in Gebäudereinigung, Sicherheitsdienst, Bau und '
      + 'Digital Operations. Bewerbung direkt über die Seite.',
    einleitung:
      'Vier Gesellschaften, ein Bewerbungsweg. An jeder Stelle steht, welche '
      + 'Gesellschaft einstellt — mit ihr kommt der Arbeitsvertrag zustande.',
    stellenSprache: null,
    filterLabel: 'Stellen nach Gesellschaft',
    alleGesellschaften: 'Alle Gesellschaften',
    stellenZahl: (n) => (n === 1 ? 'Eine offene Stelle' : `${String(n)} offene Stellen`),
    keineStellen:
      'Zurzeit ist nichts ausgeschrieben. Das heisst nicht, dass wir niemanden '
      + 'suchen — schicken Sie uns eine Initiativbewerbung.',
    keineStellenBei: (g) =>
      `Bei ${g} ist zurzeit nichts ausgeschrieben. Die übrigen `
      + 'Gesellschaften stehen unter „Alle Gesellschaften", und eine '
      + 'Initiativbewerbung nehmen wir jederzeit entgegen.',
    nachAbsprache: 'Ort und Umfang nach Absprache',
    stundenProWoche: (h) => `${h.replace('.', ',')} h/Woche`,
    bewerbungBis: (d) => `Bewerbung bis ${d}`,
    nichtsPassend: 'Nichts Passendes dabei?',
    initiativText:
      'Wir nehmen Initiativbewerbungen entgegen und melden uns, wenn eine '
      + 'Stelle dazu passt.',
    initiativKnopf: 'Initiativ bewerben',

    zurueckLabel: 'Zurück',
    zurueckAlle: '‹ Alle offenen Stellen',
    stelleMetaTitel: 'Stelle — CSE Gruppe',
    erwartungen: 'Was wir erwarten',
    erwartungenHinweis:
      'An genau diesen Punkten messen wir Bewerbungen — und eine '
      + 'Entscheidung trifft immer ein Mensch.',
    aufStelleBewerben: 'Auf diese Stelle bewerben',

    bewerbungVor: 'Bewerbung:',
    bewerbungMetaTitel: 'Bewerbung — CSE Gruppe',
    initiativTitel: 'Initiativbewerbung',
    initiativEinleitung:
      'Sagen Sie uns, was Sie können und wo Sie arbeiten möchten. Wir melden '
      + 'uns, wenn eine Stelle dazu passt.',
    initiativMetaTitel: 'Initiativbewerbung — CSE Gruppe',

    bereichLabel: 'Bereich',
    bitteWaehlen: '— bitte wählen —',
    nameLabel: 'Name',
    emailLabel: 'E-Mail',
    emailTitel: 'Eine E-Mail-Adresse mit Punkt nach dem @, etwa name@firma.de',
    telefonLabel: 'Telefon (freiwillig)',
    nachrichtLabel: 'Was Sie uns sagen möchten',
    uploadTitel: 'Noch kein Datei-Upload.',
    uploadText:
      'Der Dokumentenspeicher ist nicht verbunden; ein Feld, das eine Datei annimmt '
      + 'und sie nirgends ablegt, wäre schlimmer als keines. Schreiben Sie uns '
      + 'Ihren Werdegang bitte in das Feld oben — wir fragen nach Unterlagen, '
      + 'wenn es passt.',
    datenschutzVor: 'Ihre Angaben werden für dieses Bewerbungsverfahren verarbeitet und nach',
    datenschutzTage: (t) => `${String(t)} Tagen`,
    datenschutzNach:
      'gelöscht, sofern kein Arbeitsverhältnis zustande kommt. Über Einladung oder Absage '
      + 'entscheidet ein Mensch; eine automatische Auswahl findet nicht statt. '
      + 'Mehr dazu in der',
    datenschutzLink: 'Datenschutzerklärung',
    absenden: 'Bewerbung absenden',

    dankeMetaTitel: 'Danke — CSE Gruppe',
    dankeTitel: 'Ihre Bewerbung ist angekommen.',
    dankeText:
      'Wir sehen sie uns an und melden uns. Über Einladung oder Absage '
      + 'entscheidet ein Mensch — eine automatische Auswahl findet nicht statt.',
    aufbewahrungOhneZahl:
      'Ihre Angaben werden für dieses Verfahren verarbeitet und nach '
      + 'dessen Abschluss gelöscht, sofern kein Arbeitsverhältnis zustande '
      + 'kommt.',
    aufbewahrungVor: 'Ihre Angaben werden für dieses Verfahren verarbeitet und',
    aufbewahrungTage: (t) => `${String(t)} Tage nach Eingang`,
    aufbewahrungNach:
      'gelöscht, sofern kein Arbeitsverhältnis zustande kommt — auch '
      + 'dann, wenn wir uns nicht mehr melden.',
    frueherLoeschen:
      'Wenn Sie möchten, dass wir sie früher löschen, schreiben Sie uns — die '
      + 'Adresse steht in der',
    zurueckZuStellen: 'Zurück zu den offenen Stellen',
  },
  en: {
    titel: 'Careers',
    metaTitel: 'Careers — CSE Group',
    metaBeschreibung:
      'Open positions in commercial cleaning, security services, construction and '
      + 'digital operations. Apply directly on this page.',
    einleitung:
      'Four companies, one way to apply. Every position names the company that is '
      + 'hiring — your employment contract is concluded with that company.',
    stellenSprache:
      'Job advertisements are written in German and shown as written. You are welcome '
      + 'to apply in English.',
    filterLabel: 'Positions by company',
    alleGesellschaften: 'All companies',
    stellenZahl: (n) => (n === 1 ? 'One open position' : `${String(n)} open positions`),
    keineStellen:
      'There are no open positions at the moment. That does not mean we are not '
      + 'looking — send us an unsolicited application.',
    keineStellenBei: (g) =>
      `${g} has no open positions at the moment. The other companies are listed `
      + 'under “All companies”, and we accept unsolicited applications at any time.',
    nachAbsprache: 'Location and hours by arrangement',
    stundenProWoche: (h) => `${h} h/week`,
    bewerbungBis: (d) => `Apply by ${d}`,
    nichtsPassend: 'Nothing suitable?',
    initiativText:
      'We accept unsolicited applications and get in touch when a position fits.',
    initiativKnopf: 'Apply without a vacancy',

    zurueckLabel: 'Back',
    zurueckAlle: '‹ All open positions',
    stelleMetaTitel: 'Position — CSE Group',
    erwartungen: 'What we expect',
    erwartungenHinweis:
      'These are exactly the points against which we assess applications — and a '
      + 'person always makes the decision.',
    aufStelleBewerben: 'Apply for this position',

    bewerbungVor: 'Application:',
    bewerbungMetaTitel: 'Application — CSE Group',
    initiativTitel: 'Unsolicited application',
    initiativEinleitung:
      'Tell us what you can do and where you would like to work. We get in touch '
      + 'when a position fits.',
    initiativMetaTitel: 'Unsolicited application — CSE Group',

    bereichLabel: 'Company',
    bitteWaehlen: '— please choose —',
    nameLabel: 'Name',
    emailLabel: 'Email',
    emailTitel: 'An email address with a dot after the @, such as name@company.com',
    telefonLabel: 'Phone (optional)',
    nachrichtLabel: 'What you would like to tell us',
    uploadTitel: 'No file upload yet.',
    uploadText:
      'The document store is not connected; a field that accepts a file and stores '
      + 'it nowhere would be worse than none. Please describe your background in the '
      + 'field above — we will ask for documents when it fits.',
    datenschutzVor: 'Your details are processed for this application procedure and deleted after',
    datenschutzTage: (t) => `${String(t)} days`,
    datenschutzNach:
      'unless an employment relationship is established. A person decides on '
      + 'invitation or rejection; there is no automated selection. More in the',
    datenschutzLink: 'privacy policy',
    absenden: 'Submit application',

    dankeMetaTitel: 'Thank you — CSE Group',
    dankeTitel: 'Your application has arrived.',
    dankeText:
      'We will review it and get in touch. A person decides on invitation or '
      + 'rejection — there is no automated selection.',
    aufbewahrungOhneZahl:
      'Your details are processed for this procedure and deleted once it is '
      + 'concluded, unless an employment relationship is established.',
    aufbewahrungVor: 'Your details are processed for this procedure and deleted',
    aufbewahrungTage: (t) => `${String(t)} days after receipt`,
    aufbewahrungNach:
      'unless an employment relationship is established — even if we do not get '
      + 'back to you.',
    frueherLoeschen:
      'If you would like us to delete them earlier, write to us — the address is in the',
    zurueckZuStellen: 'Back to the open positions',
  },
};
