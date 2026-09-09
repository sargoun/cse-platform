/**
 * Das ANNAHMEN-Register — jeder vorläufige Wert an einer Stelle.
 *
 * **Warum es das gibt.** Der Mandant soll das Projekt sehen, bevor er die
 * offenen Fragen beantwortet. Dafür muss jede Stelle einen Wert haben — sonst
 * sieht er leere Auswahllisten, 404-Seiten und Platzhaltertexte und kann nicht
 * beurteilen, was er da eigentlich vor sich hat.
 *
 * **Warum es EIN Register ist und keine verstreuten Vorgaben.** Wenn er
 * antwortet, ändert sich genau diese Datei — nicht dreissig Stellen im Code,
 * von denen man siebenundzwanzig findet. Ein Wert, der an vier Stellen steht,
 * wird an drei geändert; das ist kein Pessimismus, das ist die
 * Erfahrungsregel hinter jedem Register in diesem Projekt.
 *
 * **Was hier NICHT steht.** Alles, was eine rechtliche oder finanzielle Zusage
 * wäre und sich nicht zurücknehmen lässt:
 *
 *  - Der **Rechnungsnummernkreis** bleibt `ist_platzhalter` (O-134). Eine
 *    festgeschriebene Rechnung ist unveränderlich (Invariante 4); eine mit
 *    geratener Nummer bekommt man nicht zurück, und § 14 UStG kennt keine
 *    Vorführversion.
 *  - Der **Konformitätsstatus** der Barrierefreiheitserklärung (O-205). Er
 *    setzt eine tatsächliche Prüfung voraus; ihn zu behaupten wäre eine
 *    falsche Zusage an genau die Menschen, die sich darauf verlassen.
 *  - **DATEV-Kontenrahmen und Steuerschlüssel** (O-05). Ein falsch gebuchter
 *    Beleg fällt beim Jahresabschluss auf, nicht vorher.
 *
 * Diese drei bleiben sichtbar offen. Alles andere hat hier einen Wert.
 *
 * `docs/ANNAHMEN.md` wird aus dieser Datei ERZEUGT (`pnpm annahmen`) und ist
 * die Liste, die der Mandant durchgeht.
 */

export type Bereich = 'inhalt' | 'formular' | 'frist' | 'marke' | 'technik' | 'recht';

export interface Annahme {
  /** Die offene Frage aus `docs/DECISIONS.md`. */
  readonly frage: string;
  readonly bereich: Bereich;
  /** Was wir angenommen haben — in einem Satz, auf Deutsch. */
  readonly annahme: string;
  /** Was der Mandant entscheiden muss. Als Frage, die er beantworten kann. */
  readonly zuKlaeren: string;
  /** Wo es wirkt. Damit er sieht, was sich ändert, wenn er anders entscheidet. */
  readonly wirktIn: readonly string[];
  /**
   * Was passiert, wenn die Annahme falsch ist.
   *
   * `korrigierbar` — ein Wert wird geändert, fertig.
   * `nacharbeit`   — Daten müssen nachgezogen oder Texte neu geschrieben werden.
   * `nicht_umkehrbar` — es entsteht etwas, das man nicht zurücknimmt. Solche
   *                     Werte stehen NICHT in diesem Register.
   */
  readonly folge: 'korrigierbar' | 'nacharbeit';
}

export const ANNAHMEN: readonly Annahme[] = [
  /* ── Fristen und Abläufe ──────────────────────────────────────────────── */
  {
    frage: 'O-14',
    bereich: 'frist',
    annahme:
      'Reaktionszeit auf eine Angebotsanfrage: 24 Stunden, in KALENDERSTUNDEN '
      + 'gerechnet — eine Anfrage am Freitag um 17 Uhr ist also am Samstag um '
      + '17 Uhr überfällig. Eskalation stündlich an dieselbe Person, die den '
      + 'Lead besitzt.',
    zuKlaeren:
      'Wie schnell wollen Sie auf eine Anfrage antworten — und zählen Wochenenden '
      + 'mit? Wer soll benachrichtigt werden, wenn die Frist verstreicht: der '
      + 'Bereichsleiter oder die Geschäftsführung?',
    wirktIn: ['Lead-Posteingang', 'Eskalations-Job', 'Eingangsbestätigung an den Kunden'],
    folge: 'korrigierbar',
  },
  {
    frage: 'O-80',
    bereich: 'technik',
    annahme:
      'Anmeldeversuche: 10 je Kennung und 50 je IP-Adresse in 15 Minuten, danach '
      + '30 Minuten Sperre. Formulareinsendungen: 5 je Verbindung in 15 Minuten.',
    zuKlaeren:
      'Sind diese Grenzen für Ihren Betrieb passend? Zu streng heisst: ein '
      + 'Mitarbeiter mit vergessenem Passwort sperrt sich aus.',
    wirktIn: ['Anmeldung', 'Angebotsanfrage-Formular'],
    folge: 'korrigierbar',
  },
  {
    frage: 'O-25',
    bereich: 'recht',
    annahme:
      'Aufbewahrung nach dem gesetzlichen MINIMUM: Rechnungen und Buchhaltung '
      + '10 Jahre, Verträge 10 Jahre, Personalakten offen mit Löschsperre. Wo '
      + 'keine Frist feststeht, gilt die Sperre — es wird nichts gelöscht.',
    zuKlaeren:
      'Wollen Sie länger aufbewahren als gesetzlich nötig? Und wie lange sollen '
      + 'Anfragen aufbewahrt werden, aus denen kein Auftrag wurde?',
    wirktIn: ['Dokumentenablage', 'Lösch-Jobs'],
    folge: 'korrigierbar',
  },

  /* ── Formulare ────────────────────────────────────────────────────────── */
  {
    frage: 'O-62',
    bereich: 'formular',
    annahme:
      'Auswahllisten aus den branchenüblichen Kategorien: Gebäudetypen '
      + '(Bürogebäude, Wohnanlage, Praxis/Klinik, Einzelhandel, Industrie/Lager, '
      + 'Schule/Kita, Hotel/Gastronomie), Reinigungsfrequenzen (täglich bis '
      + 'einmalig) und Gewerke (Hochbau, Ausbau, Rückbau, Sanierung, Maler, Boden).',
    zuKlaeren:
      'Welche Gebäudetypen betreuen Sie tatsächlich, und in welchen Frequenzen? '
      + 'Welche Gewerke bieten Sie an? Was hier nicht steht, kann ein Kunde nicht '
      + 'anfragen.',
    wirktIn: ['Angebotsanfrage Reinigung', 'Angebotsanfrage Bau', 'Auswertung nach Objektart'],
    folge: 'korrigierbar',
  },
  {
    frage: 'O-61',
    bereich: 'formular',
    annahme:
      'CSE Operations fragt nach Anliegen (Prozessanalyse, Software-Einführung, '
      + 'KI-Automatisierung, Datenmigration, Schulung), Anzahl Mitarbeitender, '
      + 'eingesetzten Systemen und gewünschtem Zeitrahmen.',
    zuKlaeren:
      'Was verkauft CSE Operations an externe Kunden — und was braucht Ihr Team, '
      + 'um dafür ein Angebot zu rechnen?',
    wirktIn: ['Angebotsanfrage Operations'],
    folge: 'nacharbeit',
  },
  {
    frage: 'O-63',
    bereich: 'recht',
    annahme:
      'Das Pflichthäkchen im Formular BESTÄTIGT, dass die Datenschutzhinweise '
      + 'gezeigt wurden (Art. 6 Abs. 1 lit. b/f DSGVO) — es ist keine '
      + 'Einwilligung. Nur das zweite, freiwillige Häkchen ist eine Einwilligung, '
      + 'und nur es erlaubt spätere Werbung.',
    zuKlaeren:
      'Bestätigen lassen oder als Einwilligung erheben? Der Unterschied '
      + 'entscheidet, ob Sie eine Anfrage ohne Häkchen überhaupt bearbeiten dürfen. '
      + 'Empfehlung des Rechtsrahmens: bestätigen — eine Einwilligung, die man '
      + 'nicht verweigern kann, ist keine.',
    wirktIn: ['alle Angebotsanfrage-Formulare', 'Werbe-Sperre nach § 7 UWG'],
    folge: 'korrigierbar',
  },

  /* ── Auftritt und Inhalt ──────────────────────────────────────────────── */
  {
    frage: 'O-08',
    bereich: 'technik',
    annahme:
      'EINE Gruppendomain mit Pfaden je Bereich: `/reinigung`, `/security`, '
      + '`/bau`, `/operations`. Der Host steht in der Umgebungsvariablen '
      + '`CSE_KANONISCHE_BASIS` und ist bis zur Entscheidung der Host der Anfrage.',
    zuKlaeren:
      'Eine gemeinsame Domain oder vier eigene? Vier eigene bauen vier getrennte '
      + 'Sichtbarkeiten in der Suche auf, eine gemeinsame eine starke. Der Wechsel '
      + 'ist später möglich, kostet aber die aufgebaute Sichtbarkeit.',
    wirktIn: ['Sitemap', 'kanonische Adressen', 'strukturierte Daten'],
    folge: 'nacharbeit',
  },
  {
    frage: 'O-206',
    bereich: 'marke',
    annahme:
      '"CSE Gruppe" ist ein AUFTRITTSNAME über vier eigenständigen '
      + 'Gesellschaften, kein eigener Rechtsträger. In den strukturierten Daten '
      + 'erscheinen deshalb vier vollständige Unternehmenseinträge und kein Dach.',
    zuKlaeren:
      'Gibt es eine Holding oder Dachgesellschaft mit eigenem Handelsregister-'
      + 'eintrag? Falls ja: Name, Anschrift und Registernummer.',
    wirktIn: ['Kopfzeile', 'Fussbereich', 'strukturierte Daten', 'Impressum'],
    folge: 'korrigierbar',
  },
  {
    frage: 'O-12',
    bereich: 'marke',
    annahme:
      'Das CSE-Rot ist `#E30613`, und die vier Bereichsfarben stehen in '
      + 'DESIGN.md. Die Logos sind erkennbar markierte Platzhalter.',
    zuKlaeren:
      'Bitte das Original-Logo als SVG für alle vier Marken und den exakten '
      + 'Rotwert aus Ihrem Logo — ein um zwei Prozent abweichendes Rot fällt '
      + 'neben dem gedruckten Briefpapier auf.',
    wirktIn: ['gesamter Auftritt', 'PDF-Vorlagen', 'Portal'],
    folge: 'korrigierbar',
  },
  {
    frage: 'O-13',
    bereich: 'marke',
    annahme:
      'Alle Bilder sind sichtbar markierte Platzhalter. Es wurde KEIN Bildmaterial '
      + 'erfunden und keines aus fremden Quellen übernommen.',
    zuKlaeren:
      'Eigene Aufnahmen von Teams, Objekten und abgeschlossenen Projekten — mit '
      + 'schriftlicher Einwilligung der abgebildeten Personen. Das ist der einzige '
      + 'Punkt, den kein Programmierer lösen kann.',
    wirktIn: ['Startseite', 'Unternehmensprofile', 'Referenzen'],
    folge: 'nacharbeit',
  },
  {
    frage: 'O-207',
    bereich: 'inhalt',
    annahme:
      'Alle Seitentexte sind ENTWURFSTEXTE: sie beschreiben sachlich, was die vier '
      + 'Gesellschaften laut Unternehmensangaben tun, und enthalten keine Zahlen, '
      + 'Auszeichnungen, Kundennamen oder Versprechen, die niemand geprüft hat.',
    zuKlaeren:
      'Bitte die Texte durchgehen und korrigieren — besonders alles, was eine '
      + 'Zusage an einen Kunden ist. Ein Werbetext, den niemand geprüft hat, '
      + 'steht später in einem Angebot.',
    wirktIn: ['alle 14 öffentlichen Seiten'],
    folge: 'nacharbeit',
  },
] as const;

/** Nachschlagen — die Oberfläche zeigt an, dass ein Wert vorläufig ist. */
export function annahmeZu(frage: string): Annahme | undefined {
  return ANNAHMEN.find((a) => a.frage === frage);
}

export const OFFEN_GEBLIEBEN: readonly { frage: string; grund: string }[] = [
  {
    frage: 'O-134',
    grund:
      'Rechnungsnummernkreis je Gesellschaft. Eine festgeschriebene Rechnung ist '
      + 'unveränderlich (Invariante 4) — eine mit geratener Nummer bekommt man '
      + 'nicht zurück. Der Kreis bleibt ein Platzhalter und vergibt keine Nummer, '
      + 'bis die Maske bestätigt ist.',
  },
  {
    frage: 'O-01',
    grund:
      'Ist CSE Operations eine GmbH oder eine Abteilung? Davon hängt ab, ob sie '
      + 'überhaupt eigene Rechnungen stellen darf (§ 14 UStG). Die Spalte bleibt '
      + 'NULL — jeder andere Wert wäre eine Behauptung über eine Rechtsform.',
  },
  {
    frage: 'O-205',
    grund:
      'Konformitätsstatus der Barrierefreiheitserklärung. Er setzt eine '
      + 'tatsächliche Prüfung voraus; ihn zu behaupten wäre eine falsche Zusage '
      + 'an genau die Menschen, die sich darauf verlassen.',
  },
  {
    frage: 'O-05',
    grund:
      'DATEV-Kontenrahmen, Beraternummer und Steuerschlüssel. Ein falsch '
      + 'gebuchter Beleg fällt beim Jahresabschluss auf, nicht vorher.',
  },
  {
    frage: 'O-06',
    grund:
      'Gibt es einen Betriebsrat? § 87 Abs. 1 Nr. 6 BetrVG regelt die '
      + 'Standorterfassung mit. Ohne Antwort bleibt die Standorterfassung AUS.',
  },
];
