/**
 * The delete-lock and audit registries.
 *
 * `01-ORDNERSTRUKTUR.md` §6.2 makes this file the single enumeration —
 * "`rls.ts.kein_hard_delete` enumerates them and `db/triggers/no-hard-delete.sql`
 * is generated from that list". The generator is `scripts/generate-triggers.ts`
 * and the generated block is embedded verbatim in `drizzle/0005`; a test fails
 * the build if the three drift apart.
 *
 * **Deletion protection is stated per table, never assumed globally** (K-16).
 * A table absent from this list is deletable, and that has to be a decision
 * somebody made rather than a line nobody wrote. So every entry carries the
 * reason, and the test enumerating the database refuses a table that carries
 * the trigger without appearing here — the registry cannot go stale in either
 * direction.
 */

/**
 * How a delete-locked table records the end of a row's life. K-16 and
 * `01-ORDNERSTRUKTUR.md` §6.2 are explicit that these are not interchangeable:
 * "a soft-delete column on a table that must never be deleted is an invitation".
 */
export type Loeschart =
  /** S4: `geloescht_am` / `geloescht_von`. The row is gone from the domain but
   *  kept for reconstruction. Finders exclude it by default. */
  | 'soft'
  /** The row stays and its *state* changes — `archiviert_am`, `storniert_am`,
   *  `geschlossen_am`. Nothing is "deleted", so no `geloescht_am` column
   *  exists to invite it. */
  | 'archiv'
  /** Append-only. Nothing ever ends a row here; there is no liveness column
   *  at all and no path that writes one. */
  | 'append';

export interface TabelleJeMigration {
  readonly tabelle: string;
  readonly migration: string;
}

export interface Loeschsperre {
  readonly tabelle: string;
  readonly art: Loeschart;
  /**
   * The migration that creates the table, and therefore the one that must
   * carry its locks. A trigger cannot be created before its table exists, so
   * the generator emits one block per migration rather than one block for
   * everything — which is what a single block would silently get wrong the
   * first time a table arrived later than `0005`.
   */
  readonly migration: string;
  /** Why this table may never be hard-deleted. A legal or domain reason, not
   *  "for safety" — the reason is what a reviewer checks. */
  readonly grund: string;
}

/**
 * Tables carrying `kern.verhindere_loeschung()` and holding no `DELETE` grant.
 *
 * Only tables that exist today are listed. The finance and time domains
 * (`finanz.ts`, `zeit.ts`), `freigabe*`, `wachbuch_eintrag`,
 * `schluessel_quittung`, `da_kenntnisnahme` and the finance document
 * categories join this list as their PRs land — §6.2 names them, and each
 * arrives with its table rather than being reserved here against a table that
 * does not exist.
 */
export const KEIN_HARD_DELETE: readonly Loeschsperre[] = [
  {
    tabelle: 'agent_aufgabe',
    art: 'archiv',
    migration: '0128',
    grund:
      'AGT-04. Was ein Agent getan hat, ist die Antwort auf die Frage, warum '
      + 'etwas im System steht. Eine geloeschte Aufgabe nimmt ihre Schritte '
      + 'mit — und damit die Begruendung eines Entwurfs, den ein Mensch '
      + 'freigegeben hat. Beendet wird mit status, nie durch Loeschen.',
  },
  {
    tabelle: 'agent_schritt',
    art: 'append',
    migration: '0128',
    grund:
      'AGT-04, LEG-09. Das Schrittprotokoll ist der Nachweis, WAS der Agent '
      + 'gelesen und WAS er einem Modell geschickt hat. Die einzige erlaubte '
      + 'Aenderung ist die Schwaerzung der Nutzlast nach Frist — sie leert '
      + 'Spalten und entfernt keine Zeile.',
  },
  {
    tabelle: 'agent_kosten',
    art: 'append',
    migration: '0128',
    grund:
      'AGT-05. Die Kostenzeilen SIND das Monatsbudget: der Verbrauch ist ihre '
      + 'Summe. Eine geloeschte Zeile senkt den Verbrauch und hebt damit '
      + 'ruecklaufend eine Obergrenze auf, die bereits gegriffen hat. '
      + 'Korrigiert wird durch eine zweite Zeile.',
  },
  {
    tabelle: 'agent_budget',
    art: 'archiv',
    migration: '0128',
    grund:
      'AGT-05. Die Budgetzeile traegt die Obergrenze UND den Nachweis, dass '
      + 'und wann gestoppt wurde (gestoppt_am). Sie zu loeschen loescht beides '
      + 'und laesst die Agenten im naechsten Aufruf weiterlaufen, als waere '
      + 'nichts gewesen.',
  },
  {
    tabelle: 'agent_reservierung',
    art: 'archiv',
    migration: '0128',
    grund:
      'AGT-05. Eine Reservierung ist gebundenes Budget. Wird die Zeile '
      + 'geloescht statt freigegeben, bleibt der Zaehler in agent_budget '
      + 'gebunden und niemand kann mehr sehen, wofuer — geschlossen wird mit '
      + 'freigegeben_am und freigabe_grund.',
  },
  {
    tabelle: 'konto_mapping',
    art: 'archiv',
    migration: '0126',
    grund:
      'ACC-01. Eine geloeschte Kontenzuordnung macht jede Buchung, die auf ihr '
      + 'beruht, unerklaerlich: das Konto steht im buchungssatz, der Grund ist '
      + 'fort. Geschlossen wird mit gueltig_bis.',
  },
  {
    tabelle: 'periode',
    art: 'archiv',
    migration: '0127',
    grund:
      'ACC-08, LEG-01. Ein geloeschter Buchungsmonat nimmt die Festschreibung '
      + 'mit, die ihn abgeschlossen hat — und die Monatszahlen, die der '
      + 'Steuerberater bereits bekommen hat.',
  },
  {
    tabelle: 'buchungssatz',
    art: 'archiv',
    migration: '0127',
    grund:
      'ACC-01, ACC-06, GoBD. Die Buchungszeile IST der Nachweis. Korrigiert '
      + 'wird durch Gegenbuchung (storniert_durch_id), nie durch Loeschen.',
  },
  {
    tabelle: 'firma',
    art: 'archiv',
    migration: '0020',
    grund:
      'CRM-06. Die Firma ist die geteilte Identitaet hinter zwei oder drei '
      + 'Kundenbeziehungen. Sie zu loeschen macht die Historie der anderen '
      + 'Gesellschaften unlesbar — und die verlorene Zeile einer Verschmelzung '
      + 'bleibt fuer die referenzielle Historie stehen.',
  },
  {
    tabelle: 'kunde',
    art: 'archiv',
    migration: '0020',
    grund:
      'LEG-01 und AO/HGB. An einem Kunden haengen Angebote, Auftraege und '
      + 'Rechnungen mit zehnjaehriger Aufbewahrung; Art. 17 DSGVO wird durch '
      + 'Anonymisierung erfuellt (anonymisiert_am), nicht durch Loeschen.',
  },
  {
    tabelle: 'ansprechpartner',
    art: 'archiv',
    migration: '0020',
    grund:
      'CRM-08. Auf dieser Zeile sitzt der Nachweis nach § 7 UWG: Grundlage, '
      + 'Beleg, Widerspruch. Sie zu loeschen loescht den Beweis, mit dem sich '
      + 'eine Abmahnung abwehren laesst — auch die Loeschung nach Art. 17 '
      + 'laeuft deshalb ueber anonymisiert_am.',
  },
  {
    tabelle: 'kunde_zugang',
    art: 'archiv',
    migration: '0020',
    grund:
      'AUT-08. Wer wann fuer welchen Kunden ins Portal durfte, ist eine '
      + 'Zugangsentscheidung. Ein entzogener Zugang wird auf entzogen_am '
      + 'gesetzt, nicht entfernt.',
  },
  {
    tabelle: 'belagsart',
    art: 'archiv',
    migration: '0021',
    grund:
      'OPS-03. Der Leistungswert ist die Zahl, aus der ein Angebotspreis '
      + 'entstanden ist. Faellt die Zeile weg, laesst sich ein bereits '
      + 'abgegebenes Angebot nicht mehr nachrechnen; abgeloest wird sie durch '
      + 'gueltig_bis, nicht durch DELETE.',
  },
  {
    tabelle: 'reinigungsklasse',
    art: 'archiv',
    migration: '0021',
    grund:
      'OPS-02. Die Klasse steht im Leistungsverzeichnis eines laufenden '
      + 'Auftrags. Sie zu loeschen macht die vereinbarte Leistung unlesbar; '
      + 'das Ende einer Klasse ist archiviert_am.',
  },
  {
    tabelle: 'objekt',
    art: 'archiv',
    migration: '0021',
    grund:
      'OPS-01. An einem Objekt haengen Auftraege, Einsaetze, Nachweise und '
      + 'Rechnungen mit zehnjaehriger Aufbewahrung. Ein beendetes Objekt wird '
      + 'archiviert, nie entfernt.',
  },
  {
    tabelle: 'raum',
    art: 'archiv',
    migration: '0021',
    grund:
      'OPS-02. Die Quadratmeter dieser Zeile sind die Grundlage einer '
      + 'Kalkulation, die in ein Angebot und von dort in eine Rechnung '
      + 'gewandert ist. Ein geloeschter Raum macht die Rechnung unpruefbar — '
      + 'ein entfallener Raum bekommt archiviert_am.',
  },
  {
    tabelle: 'leistungskatalog',
    art: 'archiv',
    migration: '0022',
    grund:
      'OPS-06. Der Katalog ist die Fassung, aus der ein abgegebenes Angebot '
      + 'seine Texte und Listenpreise genommen hat. Ein geloeschter Katalog '
      + 'macht dieses Angebot unlesbar; sein Ende ist status = archiviert.',
  },
  {
    tabelle: 'leistungskatalog_position',
    art: 'archiv',
    migration: '0022',
    grund:
      'OPS-06. An der Position haengen kalkulation_position und '
      + 'angebotsposition. Sie zu loeschen bricht die Spur vom Preis zur '
      + 'Leistung; abgeloest wird sie durch gueltig_bis.',
  },
  {
    tabelle: 'kalkulation',
    art: 'archiv',
    migration: '0023',
    grund:
      'OPS-07. Die Kalkulation ist die Begruendung eines abgegebenen Preises. '
      + 'Sie zu loeschen nimmt einem Preisstreit seine Grundlage; eine '
      + 'geaenderte Kalkulation ist eine neue Version, keine ersetzte Zeile.',
  },
  {
    tabelle: 'kalkulation_position',
    art: 'archiv',
    migration: '0023',
    grund:
      'OPS-07, BAU-02. Auf der Position stehen die Schnappschuesse jeder '
      + 'Eingangsgroesse und der Rechenansatz. Ohne sie laesst sich der '
      + 'Betrag nicht mehr nachrechnen, nur noch glauben.',
  },
  {
    tabelle: 'angebot',
    art: 'archiv',
    migration: '0024',
    grund:
      'OPS-08. Ein versendetes Angebot ist ein abgegebenes Vertragsangebot; '
      + 'es zu loeschen entfernt den Beleg fuer das, was zugesagt wurde. Eine '
      + 'Aenderung ist eine neue Version mit Rueckverweis.',
  },
  {
    tabelle: 'angebotsposition',
    art: 'archiv',
    migration: '0024',
    grund:
      'OPS-08, FIN-07. Die Position ist die Zeile, die spaeter zur '
      + 'Rechnungszeile wird. Ohne sie laesst sich nicht mehr zeigen, wofuer '
      + 'der Preis galt.',
  },
  {
    tabelle: 'angebot_steuer',
    art: 'append',
    migration: '0024',
    grund:
      'OPS-08, FIN-09. Die Steuerzeilen entstehen EINMAL beim Versand und '
      + 'werden nie nachgerechnet — dieselbe Bauart, die K-12 von der '
      + 'kanonischen Nutzlast einer Rechnung verlangt.',
  },
  {
    tabelle: 'auftrag',
    art: 'archiv',
    migration: '0025',
    grund:
      'OPS-05, FIN-07. An einem Auftrag haengen Rechnungen mit '
      + 'zehnjaehriger Aufbewahrung (§ 147 AO); ein beendeter Auftrag wird '
      + 'abgeschlossen und archiviert, nie entfernt.',
  },
  {
    tabelle: 'raumbuch_import',
    art: 'archiv',
    migration: '0026',
    grund:
      'OPS-04, LEG-01. Der Importkopf dokumentiert, WIE das heutige Raumbuch '
      + 'entstanden ist — eine GoBD-Frage. Er bleibt, auch wenn seine '
      + 'Zwischenzeilen geraeumt sind; sein Ende ist verworfen_am.',
  },
  {
    tabelle: 'raum_import_historie',
    art: 'append',
    migration: '0026',
    grund:
      'OPS-04, SEC-A9. Welcher Import welchen Raum wie veraendert hat, mit '
      + 'Vorher und Nachher. Eine Herkunftsspur mit Loeschpfad ist keine.',
  },
  {
    tabelle: 'feiertag',
    art: 'append',
    migration: '0028',
    grund:
      'LEG-03, § 9 ArbZG. Der Feiertagskalender ist die Grundlage dafuer, ob an '
      + 'einem Tag geplant werden durfte und welche Zuschlaege galten. Ein '
      + 'geloeschter Feiertag macht jede vergangene Schicht an diesem Tag '
      + 'unpruefbar — korrigiert wird er durch eine neue Zeile, nie durch DELETE.',
  },
  {
    tabelle: 'planungsserie',
    art: 'archiv',
    migration: '0028',
    grund:
      'LEG-03, LEG-01. Sie beantwortet, WORAUS ein Plan entstanden ist — die '
      + 'erste Frage einer ArbZG-Pruefung zu einer Schicht, die es nicht haette '
      + 'geben duerfen. Eine pausierte Serie bekommt archiviert_am; sie zu '
      + 'loeschen macht jede von ihr erzeugte Schicht herrenlos.',
  },
  {
    tabelle: 'einsatz',
    art: 'archiv',
    migration: '0028',
    grund:
      'LEG-02, LEG-03. Die geplante Schicht ist die Gegenprobe zum § 17 '
      + 'MiLoG-Nachweis und zur ArbZG-Auswertung: geplant gegen geleistet. Eine '
      + 'abgesagte Schicht bekommt storniert_am mit Grund — geloescht waere sie '
      + 'im Lohnstreit eine Luecke, die niemand mehr erklaeren kann.',
  },
  {
    tabelle: 'einsatz_zuordnung',
    art: 'archiv',
    migration: '0028',
    grund:
      'LEG-03, D-09. Wer wann fuer WELCHE Gesellschaft eingeteilt war, ist der '
      + 'Beweis, aus dem die entitaetsuebergreifende ArbZG-Belastung entsteht. '
      + 'Eine zurueckgenommene Einteilung bekommt entfernt_am und bleibt Teil '
      + 'des Planungsprotokolls.',
  },
  {
    tabelle: 'revier',
    art: 'archiv',
    migration: '0029',
    grund:
      'CLN-01, FIN-07. Das Revier ist der Zuschnitt, auf den Sollzeit, Turnus '
      + 'und Leistungsnachweis zeigen. Es zu loeschen macht jede vergangene '
      + 'Abrechnung unpruefbar, weil niemand mehr sagen kann, welche Flaeche '
      + 'gemeint war; ein aufgeloestes Revier bekommt archiviert_am.',
  },
  {
    tabelle: 'turnus',
    art: 'archiv',
    migration: '0029',
    grund:
      'CLN-02, LEG-03. Der Turnus ist die vertraglich geschuldete Leistung in '
      + 'ihrer Wiederholung — die Antwort darauf, ob eine Schicht stattfinden '
      + 'musste. Geloescht waere jede von ihm erzeugte Schicht ohne Grundlage; '
      + 'ein beendeter Turnus bekommt gueltig_bis, ein eingestellter '
      + 'archiviert_am.',
  },
  {
    tabelle: 'turnus_ausnahme',
    art: 'append',
    migration: '0029',
    grund:
      'CLN-03, FIN-01. Sie ist die dokumentierte Abweichung samt Grund und '
      + 'Urheber — genau das, was im Streit ueber eine nicht erbrachte '
      + 'Reinigung zaehlt. Eine Ausnahme, die sich loeschen laesst, ist keine '
      + 'Dokumentation. Zurueckgenommen wird sie durch eine Gegenzeile.',
  },
  {
    tabelle: 'nachweis_art',
    art: 'archiv',
    migration: '0030',
    grund:
      'LEG-04, § 34a GewO. Der Schluessel einer Nachweisart steht in '
      + 'Vergabemappen, Agentenprotokollen und in jeder Qualifikation, die auf '
      + 'ihn zeigt. Ihn zu loeschen macht rueckwirkend unlesbar, WELCHE Eignung '
      + 'einmal verlangt war; sein Ende ist archiviert_am.',
  },
  {
    tabelle: 'qualifikation',
    art: 'archiv',
    migration: '0030',
    grund:
      'LEG-04, § 34a GewO. Gegen diese Katalogzeile hat das SEC-04-Tor jede '
      + 'vergangene Zuweisung entschieden, und der Schnappschuss auf der '
      + 'Zuordnung verweist auf ihre id. Geloescht bliebe von der Entscheidung '
      + 'eine UUID ohne Bedeutung uebrig; abgeloest wird sie durch archiviert_am.',
  },
  {
    tabelle: 'nachweis',
    art: 'archiv',
    migration: '0030',
    grund:
      'LEG-04, D-09, § 34a GewO. Dieser Nachweis hat vergangene Schichten '
      + 'GEDECKT — er ist der Beleg, mit dem sich gegenueber der Behoerde zeigen '
      + 'laesst, dass der Einsatz zulaessig war. Ein Widerruf setzt '
      + 'widerrufen_am und nimmt diese Deckung nicht rueckwirkend weg.',
  },
  {
    tabelle: 'nachweis_warnung',
    art: 'append',
    migration: '0030',
    grund:
      'LEG-04, § 34a GewO. Die Quittung, dass die 60/30/7-Stufe gemeldet wurde. '
      + 'Eine loeschbare Quittung ist keine: geloescht meldete der Waechter '
      + 'dieselbe Stufe erneut, und die Zusage "je genau einmal" haette keinen '
      + 'Traeger mehr.',
  },
  {
    tabelle: 'bewacher_eintrag',
    art: 'archiv',
    migration: '0031',
    grund:
      'SEC-A9, LEG-04, § 34a GewO. Unter dieser Eintragung wurde ein Mensch im '
      + 'Bewachungsgewerbe eingesetzt; sie zu loeschen entfernt den Beleg der '
      + 'Zulaessigkeit und die einmal vergebene Bewacher-ID. Eine erloschene '
      + 'Registrierung bekommt erloschen_am.',
  },
  {
    tabelle: 'einsatzanforderung',
    art: 'archiv',
    migration: '0031',
    grund:
      'LEG-04, § 34a Abs. 1a GewO. Sie sagt, WAS zum Zeitpunkt der Planung '
      + 'verlangt war — die Frage, an der eine Aufsicht eine vergangene '
      + 'Besetzung misst. Geloescht saehe jede damals rechtmaessig besetzte '
      + 'Schicht so aus, als habe nie eine Anforderung bestanden.',
  },
  {
    tabelle: 'mandant_einstellung',
    art: 'append',
    migration: '0033',
    grund:
      'LEG-10, § 87 Abs. 1 Nr. 6 BetrVG. Auf diesen Zeilen steht, ob eine '
      + 'Ueberwachungseinrichtung eingeschaltet war und auf welcher Grundlage. '
      + 'Sie zu loeschen loescht den Beleg dafuer, dass die Geolokalisierung im '
      + 'fraglichen Zeitraum AUS war — die Auskunft, auf die es ankommt. '
      + '`append`, weil eine Einstellung nie endet: ein zurueckgenommener Wert '
      + 'wird auf den Vorgabewert gesetzt, und audit_log traegt den Verlauf.',
  },
  {
    tabelle: 'zeiteintrag',
    art: 'archiv',
    migration: '0034',
    grund:
      'LEG-02, § 17 MiLoG, GoBD. Das ist der Nachweis der geleisteten Zeit — '
      + 'die Zeile, die im Lohnstreit vorgelegt und aus der die Rechnung '
      + 'abgeleitet wird. Ein geloeschter Zeiteintrag ist eine Stunde, die '
      + 'niemand mehr belegen oder widerlegen kann; zurueckgenommen wird er '
      + 'durch storniert_am mit Grund, korrigiert durch eine neue Fassung.',
  },
  {
    tabelle: 'checkin_token',
    art: 'append',
    migration: '0035',
    grund:
      'TIM-07, SEC-A9. Die Marke belegt, WER wann von welcher IP eingestempelt '
      + 'hat — der Herkunftsnachweis des zeiteintrags. Geloescht bliebe ein '
      + 'Zeitdatensatz ohne nachvollziehbare Herkunft; abgelaufen oder '
      + 'zurueckgezogen wird sie ueber widerrufen_am.',
  },
  {
    tabelle: 'zeiteintrag_korrektur',
    art: 'append',
    migration: '0036',
    grund:
      'TIM-11, LEG-01, SEC-A9. Eine Korrekturspur mit Loeschpfad ist keine. '
      + 'Der ganze Wert dieser Tabelle liegt darin, dass sich eine einmal '
      + 'aufgeschriebene Korrektur weder aendern noch entfernen laesst — auch '
      + 'nicht von super_admin.',
  },
  {
    tabelle: 'audit_log',
    art: 'append',
    migration: '0005',
    grund:
      'SEC-A9. An audit trail with a delete path is not an audit trail. No liveness '
      + 'column either: a redacted or archived audit row is still a row somebody chose '
      + 'to stop showing.',
  },
  {
    tabelle: 'mandant',
    art: 'archiv',
    migration: '0005',
    grund:
      'LEG-01. A mandant owns financial records under a ten-year retention, and its id '
      + 'is the tenant key every one of those records carries. `archiviert_am` ends its '
      + 'operational life; the row stays for as long as its data does.',
  },
  {
    tabelle: 'nummernkreis',
    art: 'archiv',
    migration: '0006',
    grund:
      'FIN-03, LEG-01. Die Zählerzeile IST der Beweis der Lückenlosigkeit: sie zu '
      + 'löschen und neu anzulegen setzt den Zähler zurück und erzeugt zweimal '
      + 'dieselbe Rechnungsnummer. `geschlossen_am` beendet die Vergabe; die Zeile '
      + 'bleibt, solange die Nummern gelten, die sie ausgegeben hat.',
  },
  {
    tabelle: 'rolle',
    art: 'archiv',
    migration: '0007',
    grund:
      'AUT-03, SEC-A9. Die Historie in `benutzer_mandant` verweist auf die Rolle, unter '
      + 'der jemand gehandelt hat. Die Rolle zu löschen macht zehn Jahre Rechtevergabe '
      + 'unlesbar; `archiviert_am` beendet ihre Verwendung.',
  },
  {
    tabelle: 'benutzer',
    art: 'archiv',
    migration: '0007',
    grund:
      'SEC-A9, LEG-01. `audit_log` benennt dieses Konto als Akteur — dauerhaft. Ein '
      + 'gelöschter Benutzer macht jede Zeile, die er geschrieben hat, herrenlos. '
      + '`deaktiviert_am` beendet den Zugang.',
  },
  {
    tabelle: 'benutzer_mandant',
    art: 'archiv',
    migration: '0007',
    grund:
      'AUT-08, LEG-01. Wer wann in welchem Bereich welche Rolle hatte, ist die Antwort '
      + 'auf "wer durfte das". `entzogen_am` beendet den Zugang und behält die Antwort.',
  },
  {
    tabelle: 'benutzer_sitzung',
    art: 'archiv',
    migration: '0007',
    grund:
      'SEC-A9, AUT-08. Sitzungen sind Teil des Sicherheitsprotokolls: von welchem Gerät '
      + 'und welcher IP wann gearbeitet wurde. `beendet_am` beendet sie.',
  },
  {
    tabelle: 'dokument',
    art: 'soft',
    migration: '0009',
    grund:
      'DOC-07, LEG-01, § 147 AO. Rechnungen und Buchungsbelege stehen zehn Jahre unter '
      + 'Aufbewahrungspflicht; `loeschsperre` verhindert zusaetzlich das Soft-Loeschen, '
      + 'solange die Frist laeuft oder unbekannt ist.',
  },
  {
    tabelle: 'dokument_version',
    art: 'append',
    migration: '0009',
    grund:
      'DOC-06, LEG-01. Die Versionskette traegt den SHA-256 der gespeicherten Bytes — '
      + 'die Grundlage der GoBD-Integritaet. Eine Version zu loeschen entfernt den '
      + 'Beweis, dass die uebrigen unveraendert sind.',
  },
  {
    tabelle: 'freigabe_snapshot',
    art: 'append',
    migration: '0012',
    grund:
      'Invariante 7, APR-07, K-13. Der Schnappschuss bezeugt, WAS zum Zeitpunkt der '
      + 'Entscheidung vorlag, und traegt das einzige verkettete Glied. Ihn zu loeschen '
      + 'entfernt den Beweis, dass die uebrigen Entscheidungen unveraendert sind.',
  },
  {
    tabelle: 'person',
    art: 'soft',
    migration: '0005',
    grund:
      'LEG-02, D-09. The human behind every time record. Art. 17 DSGVO erasure '
      + 'anonymises this row where a statutory retention duty stands against removal '
      + '(§6.3) — it never deletes it, because the costed records point here.',
  },
  {
    tabelle: 'anstellung',
    art: 'soft',
    migration: '0005',
    grund:
      'LEG-01, LEG-02. Everything costed hangs off `anstellung_id` (D-09). Deleting an '
      + 'employment orphans the wage evidence a MiLoG or ArbZG dispute is settled with.',
  },
  {
    tabelle: 'formular_definition',
    art: 'archiv',
    migration: '0016',
    grund:
      'REQ-01. Eine gespeicherte Einsendung verweist auf die Version, gegen die sie '
      + 'validiert wurde. Wird die Definition gelöscht, ist die Einsendung nicht mehr '
      + 'lesbar und der LEG-09-Datenschutzbeleg zeigt ins Leere. Zurückziehen heisst '
      + '`zurueckgezogen_am`, nicht DELETE.',
  },
  {
    tabelle: 'formular_zustaendigkeit',
    art: 'archiv',
    migration: '0016',
    grund:
      'REQ-05/REQ-06. Sie hält die SLA und den benannten Besitzer eines Formulars; '
      + 'ohne sie lässt sich im Nachhinein nicht sagen, welche Frist für einen Lead '
      + 'galt. Sie endet mit ihrer Definition, nicht für sich.',
  },
  {
    tabelle: 'lead',
    art: 'archiv',
    migration: '0017',
    grund:
      'REP-02/REP-03. Die Auswertung von Gewinn und Verlust hängt daran, dass Leads '
      + 'nicht verschwinden — ein gelöschter verlorener Lead macht jede Quote besser, '
      + 'als sie ist. `archiviert_am` beendet ihn.',
  },
  {
    tabelle: 'lead_aktivitaet',
    art: 'append',
    migration: '0017',
    grund:
      '§ 7 UWG. Jede ausgehende Zeile trägt Zweck und Rechtsgrundlage zum Zeitpunkt '
      + 'des Sendens — das ist der Beweis, dass gesendet werden durfte. Ein Beweis mit '
      + 'Löschpfad ist keiner, und eine Zeitachse mit Lücken erst recht nicht.',
  },
  {
    tabelle: 'einsatz_medien_bezug',
    art: 'append',
    migration: '0041',
    grund:
      'TIM-10, DOC-06. Das Register entscheidet, an welche Tabelle ein Medium '
      + 'haengen darf, und sein Name geht in die dynamische Anweisung von '
      + '`me_bezug_pruefen`. Eine geloeschte Zeile machte jedes daran haengende '
      + 'Foto unpruefbar — der Elternteil liesse sich nicht mehr aufloesen —, und '
      + 'eine loeschbare Referenztabelle waere zugleich eine schreibbare.',
  },
  {
    tabelle: 'einsatz_medien',
    art: 'archiv',
    migration: '0041',
    grund:
      'TIM-10, DOC-07, LEG-09. Das Foto ist der Zustandsbeweis einer Schicht — '
      + 'die Zeile, die eine Reklamation entscheidet oder ein Aufmass traegt. '
      + 'Geloescht bliebe eine Behauptung ohne Beleg; die DSGVO-Loeschung '
      + 'entfernt die BINAERDATEI (storage_geloescht_am) und laesst die Zeile als '
      + 'Grabstein stehen, damit das Audit weiterhin zeigt, dass es sie gab.',
  },
  {
    tabelle: 'offline_ereignis',
    art: 'append',
    migration: '0042',
    grund:
      'TIM-09, LEG-02, § 17 MiLoG. Auf dieser Zeile steht, was eine Kraft '
      + 'behauptet hat und was ein Mensch darueber entschieden hat — samt Grund '
      + 'einer Ablehnung. Genau die abgelehnte Behauptung ist im Lohnstreit das '
      + 'Beweismittel; sie zu loeschen hiesse, die eine Seite des Streits zu '
      + 'entfernen. Entschieden wird ueber sie, nie an ihr.',
  },
  {
    tabelle: 'arbeitszeit_verstoss',
    art: 'archiv',
    migration: '0040',
    grund:
      'LEG-03, TIM-14, § 16 Abs. 2 ArbZG. Der Befund ist der Nachweis, dass die '
      + 'Gruppe eine Ueberschreitung BEMERKT hat — bei einer Gewerbeaufsicht die '
      + 'entscheidende Zeile. Geloescht waere er die Behauptung, es habe ihn nie '
      + 'gegeben; aufgeloest bekommt er hinfaellig_am, bearbeitet quittiert_am.',
  },
  {
    tabelle: 'planungs_konflikt',
    art: 'archiv',
    migration: '0040',
    grund:
      'TIM-05, TIM-06. Ein quittierter Konflikt ist die Spur der Entscheidung, '
      + 'trotzdem zu planen — samt Begruendung und Urheber. Ihn zu loeschen macht '
      + 'aus einer bewussten Abweichung eine, die nie jemand gesehen hat.',
  },
  {
    tabelle: 'auftrag_leistung',
    art: 'archiv',
    migration: '0050',
    grund:
      'FIN-07, TIM-12. Auf eine Leistungszeile zeigen bereits Zeiteintraege, '
      + 'Einsaetze, Reviere und Turnusse — spaeter Aufmasse, LV-Positionen und '
      + 'Rechnungszeilen. Sie zu loeschen risse genau die Kette, auf der die '
      + 'Rueckverfolgbarkeit jeder stundenbasierten Rechnungszeile beruht. '
      + 'Beendet wird sie durch `gueltig_bis`, das einschliesslich gilt.',
  },
  {
    tabelle: 'zeitnachweis',
    art: 'append',
    migration: '0051',
    grund:
      'TIM-13, LEG-02, EMP-04. Das einmal gepraegte Artefakt eines gesperrten '
      + 'Monats IST der § 17-MiLoG-Nachweis, den die Arbeitnehmerin bekommen '
      + 'hat. Ein Loeschweg machte aus „byte-gleich wieder ausgegeben" eine '
      + 'Zusage, die der erste Wartungszugang aufhebt.',
  },
  {
    tabelle: 'zeit_einwand',
    art: 'archiv',
    migration: '0052',
    grund:
      'EMP-07, LEG-02. Dass jemand eine Abweichung gemeldet — und vielleicht '
      + 'zurueckgezogen — hat, ist im Lohnstreit eine Tatsache und keine '
      + 'Datenpflege. Zurueckgenommen wird ueber `status`, nie durch DELETE.',
  },
  {
    tabelle: 'stundenkonto',
    art: 'archiv',
    migration: '0060',
    grund:
      'EMP-04, LEG-02, ACC-12. Der Monat ist die Bezugsgroesse eines '
      + 'gezahlten Lohns; ein geloeschtes Konto nimmt dem Vortrag des '
      + 'Folgemonats seine Grundlage und dem § 17-Nachweis seinen Rahmen. '
      + 'Beendet wird ein Monat durch `status = gesperrt`, nie durch DELETE.',
  },
  {
    tabelle: 'stundenkonto_bewegung',
    art: 'append',
    migration: '0060',
    grund:
      'EMP-04, TIM-11, Invariante 8. Die Bewegungen SIND das Konto — eine '
      + 'geloeschte Buchung ist eine Stunde, die nie stattgefunden hat, und '
      + 'die Summe daneben stimmt danach trotzdem. Eine falsche Buchung wird '
      + 'storniert (`storniert_bewegung_id`), nie entfernt.',
  },
  {
    tabelle: 'urlaubskonto',
    art: 'archiv',
    migration: '0061',
    grund:
      'EMP-05, LEG-09. Anspruch, Uebertrag und genommene Tage sind der '
      + 'Nachweis nach § 7 BUrlG; sie zu loeschen macht einen Streit ueber '
      + 'Resturlaub unentscheidbar. Ein abgelaufenes Jahr traegt '
      + '`abgeschlossen_am`.',
  },
  {
    tabelle: 'abwesenheit',
    art: 'archiv',
    migration: '0073',
    grund:
      'EMP-10, LEG-09, Invariante 8. Dass jemand krank gemeldet war oder '
      + 'Urlaub hatte, ist die Grundlage von Lohnfortzahlung und Urlaubskonto '
      + '— und im Streit die Tatsache selbst. Zurueckgenommen wird ueber '
      + '`status = storniert`, nie durch DELETE.',
  },
  {
    tabelle: 'abwesenheitsart',
    art: 'archiv',
    migration: '0073',
    grund:
      'EMP-05, ACC-12, K-17. Der Katalog traegt die Lohnwirkung; eine geloeschte Art '
      + 'nimmt jeder Abwesenheit, die auf sie zeigt, ihre Bedeutung. Ausser '
      + 'Gebrauch kommt sie ueber `archiviert_am`.',
  },
  {
    tabelle: 'antrag',
    art: 'archiv',
    migration: '0074',
    grund:
      'EMP-10, NOT-01. Der Antrag ist der BELEG der Entscheidung: wer wann '
      + 'was beantragt und wer mit welchem Wort entschieden hat. Genau diese '
      + 'Spur verschwaende, wenn man ihn nach der Umsetzung aufraeumte.',
  },
  {
    tabelle: 'antragsart',
    art: 'archiv',
    migration: '0074',
    grund:
      'EMP-10, K-17. Wie `abwesenheitsart`: der Katalog gibt jedem Antrag '
      + 'seine Bedeutung, und die drei Systemarten aus EMP-10 sind nicht '
      + 'entfernbar.',
  },
  {
    tabelle: 'postenart',
    art: 'archiv',
    migration: '0069',
    grund:
      'SEC-01, LEG-04. Die Postenart sagt, WOFUER ein Mensch eingeteilt war — '
      + 'Empfang, Streife, Objektschutz. Geloescht liesse sich einer vergangenen '
      + 'Besetzung nicht mehr ansehen, welche Taetigkeit sie war, und genau '
      + 'daran misst eine Aufsicht die Qualifikation. Eine aufgegebene Art '
      + 'bekommt `archiviert_am`.',
  },
  {
    tabelle: 'posten',
    art: 'archiv',
    migration: '0069',
    grund:
      'SEC-01, LEG-04, TIM-04. Der Posten ist das vertraglich Geschuldete: die '
      + 'Antwort darauf, ob eine Wachschicht stattfinden musste und mit welcher '
      + 'Mindestbesetzung. Geloescht stuende jede von ihm erzeugte Schicht ohne '
      + 'Grundlage da; ein beendeter Posten bekommt `gueltig_bis`, ein '
      + 'aufgegebener `archiviert_am`.',
  },
  {
    tabelle: 'posten_ausnahme',
    art: 'append',
    migration: '0069',
    grund:
      'SEC-01, TIM-02, LEG-04. Sie ist die dokumentierte Abweichung samt Grund '
      + 'und Urheber — im Streit ueber eine unbesetzte Nacht genau die Zeile, '
      + 'die zaehlt. Eine Ausnahme, die sich loeschen laesst, ist keine '
      + 'Dokumentation; zurueckgenommen wird sie durch eine Gegenzeile.',
  },
  {
    tabelle: 'veranstaltung',
    art: 'archiv',
    migration: '0069',
    grund:
      'SEC-08, LEG-04. Der Eventdienst traegt Kunde, Ort und Fenster einer '
      + 'kurzfristigen Bewachung; er ist der Traeger, an dem die '
      + '§ 34a-Anforderung fuer Einsaetze ohne festen Posten haengt. Geloescht '
      + 'saehe eine damals gepruefte Besetzung so aus, als habe nie eine '
      + 'Anforderung bestanden. Abgesagt heisst `archiviert_am`.',
  },
  {
    tabelle: 'kontrollpunkt',
    art: 'archiv',
    migration: '0070',
    grund:
      'SEC-05, LEG-10. Der Kontrollpunkt ist der Bezug, auf den sich ein '
      + 'Praesenznachweis im Wachbuch beruft („war an Punkt 4"). Geloescht '
      + 'zeigt jeder Rundgangseintrag auf nichts mehr, und der Nachweis gegen '
      + 'den Auftraggeber ist wertlos. Ein abgebauter Punkt bekommt '
      + '`archiviert_am`.',
  },
  {
    tabelle: 'wachbuch_eintrag',
    art: 'archiv',
    migration: '0070',
    grund:
      'SEC-05, LEG-01, § 34a GewO. Das Wachbuch ist die einzige laufende '
      + 'Beweisfuehrung der Bewachung — Rundgang, Vorkommnis, Uebergabe, '
      + 'Alarm. Eine loeschbare Seite macht die Hashkette daneben zur '
      + 'Behauptung: fehlt ein Glied, laesst sich nicht mehr zeigen, dass '
      + 'nichts entfernt wurde. Korrigiert wird durch einen NEUEN, verknuepften '
      + 'Eintrag; die falsche Zeile bekommt `storniert_am` und '
      + '`ersetzt_durch_id`.',
  },
  {
    tabelle: 'revier_raum',
    art: 'append',
    migration: '0065',
    grund:
      'CLN-01, OPS-07. Die Zeile IST der Rechenweg einer Kalkulation: Flaeche, '
      + 'Leistungswert und die daraus gewonnene Sollzeit, alle drei als '
      + 'Schnappschuss vom Kalkulationszeitpunkt. Geloescht laesst sich ein '
      + 'abgegebenes Angebot nicht mehr nachrechnen, und die Zusage '
      + '"Σ revier_raum.sollzeit = revier.sollzeit" waere ohne Vorwarnung '
      + 'falsch. Eine neu zugeschnittene Zone entsteht als NEUES Revier; das '
      + 'alte bekommt archiviert_am.',
  },
  {
    tabelle: 'leistungsnachweis',
    art: 'archiv',
    migration: '0066',
    grund:
      'CLN-04, LEG-01, § 147 AO. Das ist das Dokument, das der Kunde '
      + 'unterschrieben hat und aus dem eine Rechnung abgeleitet wird — zehn '
      + 'Jahre aufbewahrungspflichtig (Klasse gobd_10j). Geloescht bliebe eine '
      + 'Rechnung ohne Leistungsbeleg stehen; korrigiert wird durch Stornieren '
      + 'und einen Ersatz (ersetzt_durch_id), nie durch Entfernen.',
  },
  {
    tabelle: 'leistungsnachweis_position',
    art: 'append',
    migration: '0066',
    grund:
      'CLN-04, FIN-07. Die Zeile traegt den Rueckverweis auf ihre Quelle — den '
      + 'Zeiteintrag, die Aufmasszeile, die Katalogposition. Sie zu loeschen '
      + 'macht aus der Nachvollziehbarkeit einer Rechnungsposition eine '
      + 'Behauptung. Eine eigene Lebendigkeitsspalte hat sie nicht: sie lebt '
      + 'und stirbt mit ihrem Kopf, dessen Zustand sie kopiert traegt.',
  },
  {
    tabelle: 'leistungsnachweis_signatur',
    art: 'append',
    migration: '0066',
    grund:
      'CLN-04, LEG-01, SEC-A9. Name, Serverzeit, Ort und der unveraenderliche '
      + 'Abzug dessen, was angezeigt wurde — die Zeile, um die im Streitfall '
      + 'gestritten wird. Sie ist anfuegend bis in die Rechte hinein: kein '
      + 'UPDATE, kein DELETE, keine geaendert_*-Spalten. Eine loeschbare '
      + 'Unterschrift ist keine.',
  },
  {
    tabelle: 'sonderleistung',
    art: 'archiv',
    migration: '0067',
    grund:
      'CLN-05, FIN-01, FIN-07. Der Einzelabruf ist die Grundlage einer '
      + 'einzelabruf-Abrechnung und Teil der Abrechnungsspur (Klasse '
      + 'gobd_10j). Geloescht stuende die Rechnung ueber eine Sonderreinigung '
      + 'ohne den Beleg da, dass sie beauftragt war; ein zurueckgezogener '
      + 'Abruf bekommt storniert_am.',
  },
  {
    tabelle: 'pruefverfahren',
    art: 'archiv',
    migration: '0068',
    grund:
      'OPS-11. Das Verfahren ist die Messvorschrift, nach der eine vergangene '
      + 'Pruefung bewertet wurde — samt der Bestehensschwelle, die damals '
      + 'galt. Geloescht liesse sich ein Protokoll nicht mehr lesen: die '
      + 'Punktzahl bliebe stehen und niemand wuesste, wogegen sie gemessen '
      + 'wurde. Abgeloest wird es durch archiviert_am.',
  },
  {
    tabelle: 'reklamation',
    art: 'archiv',
    migration: '0068',
    grund:
      'OPS-11, CRM-06, REP-05. Die Beanstandung ist Gewaehrleistungsbeweis: '
      + 'sie zeigt, was wann geruegt und wie abgestellt wurde, und der '
      + 'Wiederholungsfall (wiederholung_von_id) haengt an ihr. Geloescht ist '
      + 'die dritte Beschwerde ueber denselben Mangel die erste; eine '
      + 'erledigte bekommt geschlossen_am, eine gegenstandslose '
      + 'archiviert_am.',
  },
  {
    tabelle: 'qualitaetspruefung',
    art: 'archiv',
    migration: '0068',
    grund:
      'OPS-11, PRO-05, REP-05. Das Pruefprotokoll ist die Grundlage des '
      + 'Kundengespraechs und der Nachschulung — und im Streit um eine '
      + 'Vertragsstrafe der Beleg, dass kontrolliert wurde. Geloescht bliebe '
      + 'nur die Behauptung; eine gegenstandslose Pruefung bekommt '
      + 'archiviert_am.',
  },
  {
    tabelle: 'qualitaetspruefung_position',
    art: 'append',
    migration: '0068',
    grund:
      'OPS-11, TIM-10. Der einzelne Befund samt Foto und Frist. Er zu '
      + 'loeschen liesse die Kopfsumme stehen und ihre Herleitung '
      + 'verschwinden — und der Mangel, aus dem eine Reklamation entstanden '
      + 'ist, zeigte auf nichts mehr. Eine eigene Lebendigkeitsspalte hat sie '
      + 'nicht: sie lebt mit ihrem Kopf.',
  },
  /**
   * Bau (PR 43, 03-GEWERKE §7.1, §7.4 – §7.9). Die drei Stammdatentabellen
   * werden archiviert, die vier Beweistabellen sind anfuegend oder werden
   * storniert — keine von ihnen kennt einen Loeschpfad.
   */
  {
    tabelle: 'projekt',
    art: 'archiv',
    migration: '0071',
    grund:
      'OPS-05, BAU-01, LEG-01. Am Projekt haengen Leistungsverzeichnis, '
      + 'Aufmass, Abnahme und Rechnungen mit zehnjaehriger Aufbewahrung '
      + '(§ 147 AO). Ein beendetes Projekt wird abgeschlossen und archiviert; '
      + 'geloescht bliebe eine Schlussrechnung ohne Bauvorhaben stehen.',
  },
  {
    tabelle: 'leistungsverzeichnis',
    art: 'archiv',
    migration: '0071',
    grund:
      'BAU-01, BAU-04. Das Verzeichnis ist die Fassung, gegen die abgerechnet '
      + 'wird — und bei einem Nachtrag der Beleg dafuer, was urspruenglich '
      + 'eingereicht wurde (§ 2 Abs. 6 VOB/B). Eine neue Verhandlungsrunde ist '
      + 'eine neue Fassung, nie eine ersetzte Zeile.',
  },
  {
    tabelle: 'lv_position',
    art: 'archiv',
    migration: '0071',
    grund:
      'BAU-01, BAU-02, FIN-07. Auf der Position stehen Vertragsmenge und '
      + 'Einheitspreis, aus denen jede Einheitspreisrechnung entsteht. Sie zu '
      + 'loeschen macht ein bereits gestelltes Aufmass unlesbar: die Menge '
      + 'bliebe stehen, und niemand wuesste mehr, wofuer sie galt.',
  },
  {
    tabelle: 'aufmass',
    art: 'archiv',
    migration: '0072',
    grund:
      'BAU-02, BAU-03, LEG-01, § 14 VOB/B. Das gegengezeichnete Blatt ist das '
      + 'Beweismittel, aus dem eine Werklohnforderung entsteht. Korrigiert '
      + 'wird durch Storno und ein Ersatzblatt (`ersetzt_durch_id`), nie durch '
      + 'Entfernen — geloescht waere im Werklohnprozess eine Luecke, die '
      + 'niemand mehr erklaeren kann.',
  },
  {
    tabelle: 'aufmass_zeile',
    art: 'append',
    migration: '0072',
    grund:
      'BAU-02, FIN-07. Die Zeile traegt den Rechenansatz WOERTLICH neben dem '
      + 'Ergebnis — genau das, was ein Pruefer nachrechnet. Sie lebt und '
      + 'stirbt mit ihrem Kopf, dessen Zustand sie kopiert traegt, und hat '
      + 'darum keine eigene Lebendigkeitsspalte.',
  },
  {
    tabelle: 'aufmass_foto',
    art: 'append',
    migration: '0072',
    grund:
      'BAU-03, DOC-07. Ohne Messfoto wird kein Blatt vorgelegt; ein '
      + 'geloeschtes Foto nimmt der Feststellung nachtraeglich ihre '
      + 'Voraussetzung, waehrend das Blatt gegengezeichnet stehen bleibt.',
  },
  {
    tabelle: 'aufmass_signatur',
    art: 'append',
    migration: '0072',
    grund:
      'BAU-03, § 14 VOB/B. Die Unterschrift mit ihrem eingefrorenen '
      + 'Schnappschuss IST die Feststellung. Sie zu loeschen liesse ein Blatt '
      + 'zurueck, das gegengezeichnet heisst und niemanden nennt.',
  },

  /**
   * Bau (PR 44, 03-GEWERKE §7.10, §7.11). Zwei Katalogtabellen und zwei
   * Beweistabellen — keine von ihnen kennt einen Loeschpfad.
   */
  {
    tabelle: 'nachtrag_grundlage',
    art: 'archiv',
    migration: '0080',
    grund:
      'BAU-04, K-17. Die Zeile ist die Anspruchsgrundlage, unter der ein '
      + 'Nachtrag angemeldet wurde — im Streit um § 2 VOB/B die Frage selbst. '
      + 'Geloescht bliebe der Nachtrag stehen und niemand wuesste mehr, worauf '
      + 'er gestuetzt war; abgeloest wird sie durch archiviert_am.',
  },
  {
    tabelle: 'nachtrag',
    art: 'archiv',
    migration: '0080',
    grund:
      'BAU-04, BAU-05, FIN-07, LEG-01. Am Nachtrag haengen die Ankuendigung '
      + '(§ 2 Abs. 6 Nr. 1 VOB/B), die eingereichte Kalkulation und spaeter '
      + 'eine Rechnungsposition. Ein zurueckgezogener wird storniert und durch '
      + 'ersetzt_durch_id abgeloest — geloescht fehlte im Werklohnprozess der '
      + 'Beleg, dass rechtzeitig angekuendigt wurde.',
  },
  /**
   * Finanzen / CRM (PR 48, 02-CRM-OPERATIONS.md §3.2). Die
   * Abrechnungskonfiguration eines Auftrags.
   */
  {
    tabelle: 'vertrag_abrechnung',
    art: 'archiv',
    migration: '0105',
    grund:
      'FIN-01, FIN-06, K-12. Die Zeile ist die Grundlage, auf der eine '
      + 'festgeschriebene und gehashte Rechnung entstanden ist. Geloescht '
      + 'liesse sich ein vergangener Abrechnungszeitraum nicht mehr '
      + 'rekonstruieren — eine dauerhafte Luecke im Pruefpfad. Abgeloest wird '
      + 'sie durch gueltig_bis, nie durch DELETE.',
  },
  {
    tabelle: 'behinderung_vorlage',
    art: 'archiv',
    migration: '0081',
    grund:
      'BAU-06, LEG-01. Die Vorlage ist der Wortlaut, in dem eine hinausgegangene '
      + 'Rechtserklaerung abgefasst wurde. Geloescht liesse sich nicht mehr '
      + 'zeigen, welcher Text damals galt; eine ueberholte bekommt archiviert_am.',
  },
  {
    tabelle: 'behinderung',
    art: 'archiv',
    migration: '0081',
    grund:
      'BAU-06, § 6 VOB/B, LEG-01. Die angezeigte Behinderung ist eine '
      + 'empfangsbeduerftige Erklaerung mit anspruchswahrender Wirkung — sie '
      + 'entscheidet ueber Bauzeitverlaengerung und Schadensersatz. Korrigiert '
      + 'wird durch Storno und eine neue Anzeige, nie durch Entfernen.',
  },

  /**
   * Bau C (PR 45, 03-GEWERKE §7.12 – §7.17). Der Gewerkekatalog wird
   * archiviert; der Tageskopf und seine beiden Kindtabellen tragen die
   * Stornospur aus §1.3, und die beiden Wettertabellen sind reine
   * Referenzdaten, an denen ein Bautagebuch haengt.
   */
  {
    tabelle: 'gewerk',
    art: 'archiv',
    migration: '0082',
    grund:
      'BAU-07, REP-05. Der Katalogeintrag ist der Bezug jeder Mannstundenzeile. '
      + 'Geloescht traegt eine abgeschlossene Tagesseite eine Gewerkekennung, '
      + 'zu der es nichts mehr gibt — und die Auswertung „Stunden je Gewerk" '
      + 'verliert rueckwirkend Zeilen. Ein aufgegebenes Gewerk bekommt '
      + 'archiviert_am und verschwindet aus der Auswahl, nicht aus der Historie.',
  },
  {
    tabelle: 'bautagebuch',
    art: 'archiv',
    migration: '0082',
    grund:
      'BAU-07, LEG-01. Der Bautag traegt Bauzeit, Behinderung und '
      + 'Mehrverguetungsanspruch. Ein abgeschlossener Tag ist unveraenderlich; '
      + 'korrigiert wird durch Storno und einen Ersatztag (ersetzt_durch_id). '
      + 'Geloescht bliebe eine Luecke in der Bauzeit, die niemand mehr erklaeren '
      + 'kann — und genau daraus wird im Prozess ein Anspruch hergeleitet.',
  },
  {
    tabelle: 'bautagebuch_mannstunden',
    art: 'append',
    migration: '0082',
    grund:
      'BAU-07, TIM-12, REP-05. Die Zeile IST die Mannstundenangabe des Tages — '
      + 'die Zahl, gegen die der Abgleich mit dem zeiteintrag laeuft und aus der '
      + 'ein Bauzeitnachtrag gerechnet wird. Sie ist anfuegend: eine falsche '
      + 'Zeile wird storniert und ersetzt, damit sichtbar bleibt, dass zuerst '
      + 'etwas anderes dastand.',
  },
  {
    tabelle: 'bautagebuch_position',
    art: 'append',
    migration: '0082',
    grund:
      'BAU-07, LEG-01. Geraet, Lieferung und Vorkommnis des Tages. Ein '
      + 'geloeschtes Vorkommnis ist genau die Seite, die im Streit fehlt; eine '
      + 'irrtuemliche Zeile wird storniert und ersetzt.',
  },
  {
    tabelle: 'wetter_station',
    art: 'archiv',
    migration: '0083',
    grund:
      'BAU-08. An der Station haengt jede Beobachtung, und an der Beobachtung '
      + 'der Wetterbeleg eines Bautags. Eine stillgelegte Station bekommt '
      + 'archiviert_am — geloescht verloeren alle Tage, die auf sie zeigen, '
      + 'ihren Messort, und „3 °C" ohne Ort ist keine Aussage.',
  },
  {
    tabelle: 'wetter_beobachtung',
    art: 'append',
    migration: '0083',
    grund:
      'BAU-07, BAU-08, LEG-01. Die Messung, auf die sich ein Bautagebuch '
      + 'beruft. Der DWD revidiert Werte — eine Revision ist eine NEUE Zeile '
      + 'mit hoeherem Qualitaetsniveau, nie ein Ersetzen der alten. Geloescht '
      + 'zeigte der Tag auf nichts, und der Schnappschuss daneben liesse sich '
      + 'nicht mehr gegenpruefen.',
  },

  /**
   * Finanzen (PR 46). Invariante 8 gilt in dieser Domaene OHNE Ausnahme —
   * `05-FINANZEN.md` §1.6 stellt vier Schichten davor und sagt ausdruecklich,
   * dass keine dieser Tabellen eine Bereinigungstabelle ist.
   *
   * Auch die drei globalen Referenztabellen stehen hier, und das ist kein
   * Uebereifer: ein geloeschter Steuersatz macht jede festgeschriebene
   * Rechnung unlesbar, die auf ihn zeigt — und das sind, zehn Jahre lang,
   * alle.
   */
  {
    tabelle: 'steuersatz_gruppe',
    art: 'archiv',
    migration: '0075',
    grund:
      'K-21, §14 Abs. 4 Nr. 8 UStG. Der EINE Steuerkatalog der Plattform. Eine '
      + 'Zeile zu loeschen bricht den Fremdschluessel jeder Rechnungsposition, '
      + 'die auf sie zeigt — und die Rechnung selbst darf sich nicht mehr '
      + 'aendern. Ein Satz laeuft ueber `gueltig_bis` aus; eine Aenderung ist '
      + 'eine NEUE Zeile mit eigenem Gueltigkeitsbeginn.',
  },
  {
    tabelle: 'masseinheit',
    art: 'append',
    migration: '0075',
    grund:
      'FIN-11, EN 16931 BT-130. Die Einheit einer festgeschriebenen Position '
      + 'wird beim Nachdrucken und beim Export gelesen. Faellt die Zeile weg, '
      + 'laesst sich dieselbe Rechnung nicht mehr zweimal gleich ausgeben.',
  },
  {
    tabelle: 'kleinbetrag_grenze',
    art: 'archiv',
    migration: '0075',
    grund:
      'FIN-13, §33 UStDV. `ist_kleinbetrag` wird gegen die Schwelle des '
      + 'LEISTUNGSDATUMS eingefroren. Die historische Zeile zu loeschen hiesse, '
      + 'die Entscheidung nicht mehr begruenden zu koennen.',
  },
  {
    tabelle: 'rechnung',
    art: 'archiv',
    migration: '0075',
    grund:
      'Invariante 4 und 8, §147 AO, §14b UStG. Eine festgeschriebene Rechnung '
      + 'wird durch STORNO aufgehoben, nie entfernt; ein verworfener Entwurf '
      + 'bekommt `verworfen_am` samt Grund und bleibt stehen — genau er ist die '
      + 'Zeile, die eine Betriebspruefung liest, wenn sie nach der fehlenden '
      + 'Nummer fragt.',
  },
  {
    tabelle: 'rechnungsposition',
    art: 'append',
    migration: '0075',
    grund:
      'FIN-01, §14 Abs. 4 Nr. 5 UStG. Die Position IST der Leistungsnachweis '
      + 'auf dem Beleg. Waere sie loeschbar, koennte eine festgeschriebene '
      + 'Rechnung nachtraeglich kuerzer werden, waehrend Kopfsummen und Hash '
      + 'unveraendert stehen bleiben.',
  },
  {
    tabelle: 'rechnung_zuschlag',
    art: 'append',
    migration: '0075',
    grund:
      'FIN-01, §10 UStG, EN 16931 BG-20/BG-21. Ein entfernter Nachlass '
      + 'veraendert die Bemessungsgrundlage einer Steuergruppe, ohne dass der '
      + 'Kopf es zeigt — und die Bemessungsgrundlage ist genau die Zahl, aus '
      + 'der die Voranmeldung ihre Steuer rechnet.',
  },
  {
    tabelle: 'rechnung_steuer',
    art: 'append',
    migration: '0075',
    grund:
      '§14 Abs. 4 Nr. 8 UStG. Die Aufschluesselung nach Steuersaetzen ist der '
      + 'Teil des Belegs, den die Umsatzsteuervoranmeldung uebernimmt. Neu '
      + 'gerechnet wird im Entwurf durch UPSERT; eine Gruppe, die wegfaellt, '
      + 'faellt auf null statt aus der Tabelle.',
  },
  {
    tabelle: 'rechnung_beziehung',
    art: 'append',
    migration: '0075',
    grund:
      'K-12, Invariante 4, §17 UStG. Sie IST die Storno-Rueckbeziehung — der '
      + 'einzige Ort, an dem steht, dass eine Rechnung aufgehoben wurde, und '
      + 'damit der Beleg fuer die Aenderung der Bemessungsgrundlage. Sie zu '
      + 'loeschen liesse die aufgehobene Rechnung wieder als gueltige dastehen.',
  },
  {
    tabelle: 'rechnung_snapshot',
    art: 'append',
    migration: '0077',
    grund:
      'FIN-06, LEG-01, ACC-06. Der Snapshot IST das Dokument; PDF und '
      + 'XRechnung werden aus ihm erzeugt, nie aus lebenden Stammdaten. Ohne '
      + 'ihn verifiziert die Kette gegen nichts.',
  },
  {
    tabelle: 'rechnung_hash',
    art: 'append',
    migration: '0077',
    grund:
      'FIN-06, LEG-01. Ein fehlendes Glied ist genau die Manipulation, gegen '
      + 'die die Kette geschrieben ist. Eine geleerte Kettentabelle laesst den '
      + 'naechtlichen Lauf eine LEERE Kette melden statt einer gebrochenen — '
      + 'und das liest sich wie „nichts zu pruefen".',
  },
  /**
   * Finanzen (PR 49): die Herkunft einer Rechnungszeile (FIN-07, §4.4).
   *
   * `archiv` und nicht `append`, weil `wirksam` genau der Zustand ist, den
   * §4.4 vorsieht: ein Anspruch erlischt, die Zeile bleibt. Eine loeschbare
   * Herkunftszeile hiesse, die Doppelabrechnungssperre mit einem DELETE
   * aufheben zu koennen — derselbe Zeiteintrag stuende dann auf zwei
   * Rechnungen, ohne dass irgendwo eine Zeile fehlte.
   */
  {
    tabelle: 'rechnungsposition_quelle',
    art: 'archiv',
    migration: '0107',
    grund:
      'FIN-07, §4.4, Invariante 8. Sie IST der Beleg, dass eine abgerechnete '
      + 'Stunde abgerechnet ist. Waere sie loeschbar, liesse sich die '
      + 'Doppelabrechnungssperre durch ein DELETE aufheben — und derselbe '
      + 'Zeiteintrag stuende auf zwei Rechnungen, ohne dass irgendwo eine '
      + 'Zeile fehlte. Ein erloschener Anspruch faellt auf `wirksam = false` '
      + 'und bleibt stehen.',
  },

  /**
   * Security B (PR 42). Vier Tabellen der Dienstanweisung, drei der
   * Schluesselverwaltung — und die Begruendung ist bei allen sieben dieselbe
   * Familie: sie beantworten im Streitfall „wer wusste was" und „wer hatte
   * welchen Schluessel".
   */
  {
    tabelle: 'dienstanweisung',
    art: 'archiv',
    migration: '0078',
    grund:
      'SEC-06, LEG-04. Der Kopf ist der Bezug, auf den jede Fassung und jede '
      + 'Kenntnisnahme zeigt. Geloescht steht die Bestaetigung einer Wache vor '
      + 'einem Regelwerk, das es angeblich nie gab. Eine ausser Kraft gesetzte '
      + 'Anweisung bekommt `archiviert_am`.',
  },
  {
    tabelle: 'dienstanweisung_version',
    art: 'append',
    migration: '0078',
    grund:
      'SEC-06, LEG-04, DOC-05. Die Fassung IST der Text, gegen den bestaetigt '
      + 'wurde — `da_kenntnisnahme.bestaetigter_inhalt_hash` ist ihr Digest. '
      + 'Ohne die Zeile laesst sich nicht mehr zeigen, WAS gelesen wurde, und '
      + 'die Kenntnisnahme wird zur Behauptung. Eine Aenderung ist eine neue '
      + 'Fassung.',
  },
  {
    tabelle: 'da_pflicht',
    art: 'archiv',
    migration: '0078',
    grund:
      'SEC-06, LEG-04. „Diese Person musste die Anweisung kennen" ist die '
      + 'Auskunft, nicht ihr Fehlen: eine geloeschte Pflichtzeile macht aus '
      + 'einer nicht bestaetigten Anweisung eine, die niemanden betraf. Eine '
      + 'beendete Pflicht bekommt `entfallen_am` und bleibt stehen.',
  },
  {
    tabelle: 'da_kenntnisnahme',
    art: 'append',
    migration: '0078',
    grund:
      'SEC-06, EMP-09, LEG-04. Im Haftungsfall der einzige Beleg, dass die '
      + 'Unterweisung stattgefunden hat — mit Serverzeit, Person und dem Digest '
      + 'des bestaetigten Textes. Ein Irrtum wird durch eine neue Fassung '
      + 'ueberholt, nicht durch Loeschen.',
  },
  {
    tabelle: 'schluesselart',
    art: 'archiv',
    migration: '0079',
    grund:
      'SEC-07. Der Katalog ist der Bezug jedes Schluessels; geloescht traegt '
      + 'eine zehn Jahre alte Quittung eine Art, die niemand mehr aufloesen '
      + 'kann. Eine nicht mehr gefuehrte Art bekommt `archiviert_am`.',
  },
  {
    tabelle: 'schluessel',
    art: 'archiv',
    migration: '0079',
    grund:
      'SEC-07, LEG-01. Am Schluessel haengt sein Journal. Ihn zu loeschen '
      + 'nimmt dem Journal seinen Gegenstand und macht die Frage „wer hatte '
      + 'Zutritt" unbeantwortbar — die erste Frage nach einem Einbruch. Ein '
      + 'ausgemusterter Schluessel bekommt `archiviert_am` oder eine '
      + 'Vernichtungszeile.',
  },
  /**
   * **Diese drei standen nicht hier — und die Wache hat es gemeldet.**
   *
   * PR 50 und PR 51 haben ihre Tabellen angelegt UND die Sperre von Hand
   * dazugeschrieben, statt sie hier einzutragen und erzeugen zu lassen. In
   * der Datenbank war damit alles richtig; die REGISTRATUR war es nicht, und
   * genau das ist der Fall, den `unveraenderbarkeit.test.ts` §(4) in beide
   * Richtungen prueft: „no table carries the trigger without being
   * registered — the registry cannot go stale". Eine Liste, die drei
   * Finanztabellen unterschlaegt, liest sich fuer den naechsten Menschen so,
   * als duerften sie geloescht werden.
   */
  {
    tabelle: 'abschlagsrechnung_bezug',
    art: 'archiv',
    migration: '0117',
    grund:
      'FIN-08, §14 Abs. 4 Nr. 8 UStG, LEG-01. Sie IST der Nachweis, welcher '
      + 'Abschlag auf welcher Schlussrechnung mit welchem Betrag je '
      + 'Steuergruppe abgezogen wurde. Sie zu loeschen liesse denselben '
      + 'Abschlag ein zweites Mal abziehbar erscheinen — und der Kunde zahlte '
      + 'zweimal oder gar nicht. Zurueckgenommen wird ueber `wirksam`: der '
      + 'Zustand aendert sich, die Zeile bleibt.',
  },
  {
    tabelle: 'kunde_bauleistender_status',
    art: 'archiv',
    migration: '0118',
    grund:
      'FIN-09, LEG-06, §13b UStG. Sie ist der datierte Nachweis, auf den sich '
      + 'eine Verlagerung der Steuerschuld stuetzt — und der Zeitraum, in dem '
      + 'sie galt, ist die Begruendung jeder Rechnung aus dieser Zeit. Wer sie '
      + 'loescht, nimmt einer festgeschriebenen Rechnung nachtraeglich ihre '
      + 'Grundlage, und der Leistende schuldet die Steuer, ohne sie '
      + 'eingenommen zu haben (§13a UStG). Beendet wird ein Status durch '
      + '`gilt_bis`, wie bei `kleinbetrag_grenze` — eine neue Lage ist eine '
      + 'neue Zeile.',
  },
  {
    tabelle: 'freistellungsbescheinigung',
    art: 'archiv',
    migration: '0118',
    grund:
      'FIN-10, LEG-06, §48b EStG. Ohne sie haette einbehalten werden muessen; '
      + 'mit ihr durfte ausgezahlt werden. Sie ist damit der Beleg dafuer, '
      + 'dass die Gruppe ihrer Einbehaltungspflicht genuegt hat — und die '
      + 'Haftung nach §48a Abs. 3 EStG haengt genau daran. Ein Widerruf setzt '
      + '`widerrufen_am`; die Bescheinigung bleibt stehen, weil sie fuer die '
      + 'Zeit davor weiter gilt.',
  },
  {
    tabelle: 'bankkonto',
    art: 'archiv',
    migration: '0121',
    grund:
      'ACC-01, ACC-04, FIN-11, K-12. Die IBAN und der Kontoinhaber stehen im '
      + 'Snapshot jeder Rechnung, die dieses Konto genannt hat, und in der '
      + 'XRechnung (BT-84, BT-85). Das Konto zu loeschen liesse die Belege auf '
      + 'einen Empfaenger zeigen, den es nie gab — und der Bankimport (PR 61) '
      + 'ordnet einen Auszug ueber die IBAN zu. Ein geschlossenes Konto traegt '
      + '`archiviert_am`; seine IBAN wird damit wieder verwendbar.',
  },
  {
    tabelle: 'kasse',
    art: 'archiv',
    migration: '0121',
    grund:
      'FIN-14, ACC-06, GoBD. An der Kasse haengen Barzahlungen und spaeter das '
      + 'Kassenbuch mit fortgeschriebenem Bestand. Eine geloeschte Kasse '
      + 'nimmt den Bewegungen ihren Ort und macht die Kassensturzfaehigkeit '
      + 'unpruefbar. Aufgeloest wird sie ueber `archiviert_am`.',
  },
  {
    tabelle: 'zahlung',
    art: 'archiv',
    migration: '0121',
    grund:
      'FIN-14, ACC-04, ACC-07, Invariante 8. Sie ist der Nachweis, dass Geld '
      + 'geflossen ist — und die Gegenprobe zu jedem ausgeglichenen Posten. '
      + 'Eine geloeschte Zahlung liesse eine bezahlte Forderung als bezahlt '
      + 'stehen, ohne dass irgendwo stuende, wodurch. Zurueckgenommen wird '
      + 'ueber `storniert_am`, und der Ausloeser gibt die Posten wieder frei.',
  },
  {
    tabelle: 'offener_posten',
    art: 'archiv',
    migration: '0121',
    grund:
      'ACC-07, FIN-15, FIN-17. Die Zeile traegt, was gemahnt wurde und wann — '
      + 'der Mahnlauf und die Altersliste lesen genau das. Sie zu loeschen '
      + 'entfernte eine Forderung aus jeder Auswertung, ohne dass ein Beleg '
      + 'sich aendert: die Rechnung stuende weiter im Ausgangsbuch, aber '
      + 'niemand erwartete noch Geld dafuer. Abgeschlossen wird ueber '
      + '`ausgeglichen_am`.',
  },
  {
    tabelle: 'zahlung_zuordnung',
    art: 'append',
    migration: '0121',
    grund:
      'FIN-14, ACC-04, ACC-07, §146 Abs. 4 AO. Jede Zeile ist eine Buchung: wieviel dieser '
      + 'Zahlung auf welchen Posten entfaellt, und warum (Skonto, '
      + 'Bauabzugsteuer, abgeschriebene Differenz). Sie zu loeschen aenderte '
      + 'den Stand eines Postens ohne Spur. Eine falsche Zuordnung wird '
      + 'zurueckgenommen, indem die ZAHLUNG storniert wird.',
  },
  {
    tabelle: 'op_ausgleich',
    art: 'append',
    migration: '0121',
    grund:
      'FIN-15, ACC-07, §14 UStG (Invariante 4). Der Ausgleich ist der Vorgang, der eine '
      + 'stornierte Rechnung und ihre Gutschrift gegeneinander schliesst, ohne '
      + 'eine Zahlung zu erfinden. Ihn zu loeschen oeffnete beide Posten '
      + 'wieder und liesse die Wache eine stornierte Rechnung anmahnen.',
  },
  {
    tabelle: 'lieferant',
    art: 'archiv',
    migration: '0123',
    grund:
      'FIN-14, ACC-05, ACC-07, §147 AO. Am Lieferanten haengen Eingangs'
      + 'rechnungen mit zehnjaehriger Aufbewahrung und der §48-EStG-Nachweis, '
      + 'wem gegenueber einbehalten wurde. Ihn zu loeschen macht jede Buchung '
      + 'darauf unlesbar; Art. 17 DSGVO wird bei einer natuerlichen Person '
      + 'ueber `anonymisiert_am` erfuellt, aufgeloest wird ueber '
      + '`archiviert_am`.',
  },
  {
    tabelle: 'kontoauszug',
    art: 'archiv',
    migration: '0135',
    grund:
      'ACC-04, ACC-06, LEG-01, GoBD. Der eingelesene Auszug ist der Nachweis, '
      + 'WAS die Bank gemeldet hat — er traegt Anfangs- und Endsaldo und den '
      + 'Pruefwert der Datei. Ihn zu loeschen liesse die Umsaetze auf einen '
      + 'Auszug zeigen, den es nicht mehr gibt, und die Frage, woher eine '
      + 'Zahlung kam, waere nicht mehr zu beantworten. Ein falscher Auszug '
      + 'wird VERWORFEN und neu eingelesen; die Zeile bleibt.',
  },
  {
    tabelle: 'kontoumsatz',
    art: 'append',
    migration: '0135',
    grund:
      'ACC-04, LEG-01, GoBD. Eine Auszugszeile verschwindet nicht — auch '
      + 'dann nicht, wenn niemand sie zuordnen kann. Genau das ist die '
      + 'Zusage: ein unzugeordneter Umsatz bleibt sichtbar, statt aus der '
      + 'Ansicht zu fallen und den Saldo unerklaerlich zu machen. Wer ihn '
      + 'fuer gegenstandslos haelt, setzt zustand = ohne_bezug MIT Grund.',
  },
  {
    tabelle: 'umsatz_zuordnung',
    art: 'append',
    migration: '0135',
    grund:
      'ACC-04, LEG-01. Die Bruecke zwischen Auszugszeile und Zahlung ist '
      + 'widerrufbar, nicht loeschbar: der Widerruf ist selbst die '
      + 'Aufzeichnung, dass hier einmal eine andere Zuordnung stand. Sie zu '
      + 'loeschen naehme genau die Spur, die nach einem Fehlgriff gebraucht '
      + 'wird — und liesse offen, ob eine Regel oder ein Mensch danebenlag.',
  },
  {
    tabelle: 'freigabe_feld',
    art: 'append',
    migration: '0136',
    grund:
      'APR-03, APR-07, K-13. Jede Zeile ist der NACHWEIS, woher ein '
      + 'extrahierter Wert stammt — Seite, Zelle, Zitat, Konfidenz. Sie zu '
      + 'loeschen naehme genau die Spur, auf die sich eine Freigabe beruft, '
      + 'und liesse die Entscheidung als Behauptung zurueck. Eine Korrektur '
      + 'ist eine NEUE freigabe mit ersetzt_durch_freigabe_id, nie ein '
      + 'Entfernen hier.',
  },
  {
    tabelle: 'freigabe_ansicht',
    art: 'append',
    migration: '0136',
    grund:
      'APR-08, K-13, LEG-01. Sie bezeugt, dass ein Mensch die Freigabe '
      + 'geoeffnet hat, und ist die einzige Grundlage von pruefdauer_sek. '
      + 'Loeschbar waere sie genau das Werkzeug dessen, den APR-08 finden '
      + 'soll: wer zu schnell entscheidet, raeumte die Messung hinter sich '
      + 'weg, und die Auswertung meldete danach nur noch die Sorgfaeltigen.',
  },
  {
    tabelle: 'dokument_zugriff',
    art: 'append',
    migration: '0139',
    grund:
      'DOC-03, SEC-A6, Art. 15 DSGVO. Eine Zeile je Abruf einer Datei aus der '
      + 'Ablage. Sie ist die Antwort auf die Frage, wer eine Personalakte oder '
      + 'einen Beleg gesehen hat — loeschbar waere sie das Werkzeug dessen, der '
      + 'nicht gesehen werden will.',
  },
  {
    tabelle: 'datev_export',
    art: 'archiv',
    migration: '0133',
    grund:
      'ACC-02, ACC-06, LEG-01, GoBD. Der Exportvorgang bezeugt, WELCHE Zeilen '
      + 'mit welchen Summen und welchen Stammdaten das Haus verlassen haben. '
      + 'Ihn zu loeschen liesse die gestempelten Buchungszeilen auf einen '
      + 'Stapel zeigen, den es nicht mehr gibt — und die Frage, was der '
      + 'Steuerberater bekommen hat, waere nicht mehr zu beantworten. Ein '
      + 'falscher Stapel wird VERWORFEN und neu erzeugt; die Zeile bleibt.',
  },
  {
    tabelle: 'beleg',
    art: 'archiv',
    migration: '0123',
    grund:
      'ACC-03, ACC-06, DOC-08, LEG-01, GoBD. Der Beleg IST der Nachweis zur '
      + 'Buchung — er nennt die Dokumentversion und ihren SHA-256. Ihn zu '
      + 'loeschen liesse eine Buchung ohne Beleg zurueck, und genau das ist '
      + 'der Mangel, den eine Betriebspruefung zuerst feststellt. Das '
      + 'Ausscheiden nach Fristablauf laeuft ueber `aufbewahrung_bis` und '
      + '`loeschsperre`.',
  },
  {
    tabelle: 'eingangsrechnung',
    art: 'archiv',
    migration: '0123',
    grund:
      'FIN-14, ACC-05, ACC-06, LEG-01, §14b UStG. Sie traegt den '
      + 'Vorsteuerabzug und den §48-EStG-Einbehalt. Eine geloeschte '
      + 'Eingangsrechnung nimmt der Voranmeldung ihre Grundlage, und die '
      + 'interne Belegnummer hinterliesse eine Luecke in einem lueckenlosen '
      + 'Kreis. Zurueckgewiesen wird ueber `abgelehnt` mit Grund.',
  },
  {
    tabelle: 'eingangsrechnung_steuer',
    art: 'append',
    migration: '0123',
    grund:
      'FIN-14, ACC-08, §15 UStG. Die Aufteilung nach Steuersaetzen IST der '
      + 'Vorsteuerabzug — ohne sie steht ein Bruttobetrag da, aus dem sich '
      + 'kein Satz mehr ableiten laesst. Sie zu loeschen aenderte die '
      + 'Voranmeldung ohne Spur.',
  },
  {
    tabelle: 'mahnstufe',
    art: 'archiv',
    migration: '0125',
    grund:
      'FIN-15, §288 BGB. Die Stufe traegt Gebuehr, Zinsart und Frist — also '
      + 'die Grundlage jedes Betrags, der je auf einer Mahnung stand. Sie zu '
      + 'loeschen nimmt einem versendeten Brief seine Herleitung. Abgeloest '
      + 'wird ueber `gueltig_bis`.',
  },
  {
    tabelle: 'mahnung',
    art: 'archiv',
    migration: '0125',
    grund:
      'FIN-15, ACC-07, §286 BGB, LEG-01. Sie IST die Mahnung — der Vorgang, '
      + 'an den der Verzug und damit der Zinsanspruch anknuepft. Ein '
      + 'geloeschter Brief laesst die naechste Stufe ohne Grundlage und den '
      + 'Zinsanspruch ohne Beleg. Nicht Versendetes wird ueber `verworfen` '
      + 'mit Grund beendet.',
  },
  {
    tabelle: 'mahnung_position',
    art: 'append',
    migration: '0125',
    grund:
      'FIN-15, §288 BGB. Die Zeile traegt, WIE der Zins hergeleitet wurde: '
      + 'Verzugsbeginn, angewandte Regel, Tageszaehlung, Tage und Satz. Sie '
      + 'zu loeschen laesst einen geforderten Betrag ohne Rechenweg zurueck — '
      + 'und genau danach fragt der Anwalt des Empfaengers.',
  },
  {
    tabelle: 'mahnung_eskalation',
    art: 'archiv',
    migration: '0125',
    grund:
      'FIN-15, APR-07, LEG-12. Eine Inkasso-Uebergabe oder ein Mahnbescheid '
      + 'beruehrt gegenueber einer natuerlichen Person Art. 22 DSGVO; die '
      + 'Zeile ist der Nachweis, WER sie freigegeben hat. Zurueckgenommen '
      + 'wird ueber `widerrufen_am`.',
  },
  {
    tabelle: 'schluessel_quittung',
    art: 'append',
    migration: '0079',
    grund:
      'SEC-07, LEG-01. Das Journal ist der Nachweis der Schluesselgewalt und '
      + 'die Grundlage jeder Haftungsfrage nach einem Schliessanlagenaustausch. '
      + 'Eine loeschbare Quittung heisst, dass sich „wer hatte den Schluessel" '
      + 'nachtraeglich umschreiben laesst. Richtiggestellt wird durch eine '
      + 'Gegenquittung.',
  },
] as const;

/**
 * Tables whose every write is mirrored into `audit_log` by
 * `kern.protokolliere_aenderung()`.
 *
 * `audit_log` is deliberately absent: a table that audits itself recurses, and
 * there is no write path to it other than `app.protokolliere` anyway.
 */
export const AUDITIERT: readonly TabelleJeMigration[] = [
  /**
   * `medien` ja, `offline_ereignis` nein — eine Entscheidung, keine Auslassung
   * (04-PLANUNG-ZEIT §14.1).
   *
   * Wer ein Beweisfoto archiviert oder seine Binaerdatei entfernt hat, ist die
   * Zeile, ueber die im Reklamationsfall gestritten wird — mit Vorher und
   * Nachher. `offline_ereignis` dagegen IST bereits der Nachweis: sie traegt
   * Entscheider, Zeitpunkt und Ablehnungsgrund in eigenen Spalten, ist
   * anfuegend und in ihrer Behauptung unveraenderlich, und ihre zwei
   * Entscheidungen schreiben ohnehin `app.protokolliere` von Hand. Ein
   * Auditeintrag je Zeile verdoppelte genau das Protokoll, auf das sich eine
   * Auskunft stuetzt.
   */
  { tabelle: 'einsatz_medien', migration: '0041' },
  { tabelle: 'arbeitszeit_verstoss', migration: '0040' },
  { tabelle: 'planungs_konflikt', migration: '0040' },
  { tabelle: 'mandant', migration: '0005' },
  { tabelle: 'person', migration: '0005' },
  { tabelle: 'anstellung', migration: '0005' },
  { tabelle: 'nummernkreis', migration: '0006' },
  // Wer ein Formular veröffentlicht oder zurückzieht, ändert damit, was die
  // Website zeigt — und wer die Zuständigkeit ändert, verschiebt eine SLA.
  { tabelle: 'formular_definition', migration: '0016' },
  { tabelle: 'formular_zustaendigkeit', migration: '0016' },
  { tabelle: 'lead', migration: '0017' },
  // `belagsart` ja, `raum` nein — eine Entscheidung, keine Auslassung. Ein
  // geaenderter Leistungswert bepreist jedes noch offene Angebot neu und ist
  // die Zeile, ueber die im Streitfall gestritten wird; er aendert sich
  // selten. Ein Raumbuch dagegen kommt zu Tausenden aus einem Import, und ein
  // Audit-Eintrag je Raum ertraenkte genau das Protokoll, auf das sich eine
  // Auskunft stuetzt — die Historie des Raums steht ohnehin in seiner eigenen
  // Zeile (`archiviert_am` plus Neuanlage).
  { tabelle: 'belagsart', migration: '0021' },
  /**
   * `einsatz` und `einsatz_zuordnung` ja, `planungsserie` nein — eine
   * Entscheidung, keine Auslassung (04-PLANUNG-ZEIT §14.1).
   *
   * Eine verschobene Schicht und eine zurueckgenommene Einteilung sind die
   * beiden Zeilen, ueber die im Lohnstreit gestritten wird ("diese Schicht
   * wurde zweimal verlegt"), und aus ihrem Vorher/Nachher entsteht die
   * NOT-01-Meldung ueber Planaenderungen. Die Serie dagegen aendert sich nur
   * durch den Nachtlauf, der seinen Fortschritt ohnehin in `job_lauf` und
   * `letzte_meldung` protokolliert — ein Audit-Eintrag je Lauf und Serie
   * ertraenkte genau das Protokoll, auf das sich eine Auskunft stuetzt.
   */
  { tabelle: 'einsatz', migration: '0028' },
  { tabelle: 'einsatz_zuordnung', migration: '0028' },
  /**
   * `nachweis` und `bewacher_eintrag` ja, `qualifikation` und
   * `einsatzanforderung` nein — eine Entscheidung, keine Auslassung
   * (01-KERN §6.17/§6.18).
   *
   * Eine verschobene Gueltigkeit und ein geaenderter Registerstatus sind die
   * zwei Zeilen, an denen eine Aufsicht die Zulaessigkeit eines vergangenen
   * Einsatzes aufhaengt: WER hat wann behauptet, dieser Mensch duerfe
   * eingesetzt werden. Der Katalog daneben aendert sich selten und traegt seine
   * Geschichte ohnehin in `archiviert_am` plus Neuanlage — ein Auditeintrag je
   * Katalogpflege ertraenkte genau das Protokoll, auf das sich die Auskunft
   * stuetzt.
   */
  { tabelle: 'nachweis', migration: '0030' },
  { tabelle: 'bewacher_eintrag', migration: '0031' },
  /**
   * `abwesenheit` und `antrag` ja, die beiden Kataloge nein — eine
   * Entscheidung, keine Auslassung (01-KERN §6.22–§6.29).
   *
   * Wer eine Krankmeldung nachtraeglich verschiebt oder einen Urlaub
   * storniert, aendert eine Lohntatsache; und wer einen Antrag entscheidet,
   * entscheidet ueber die Freizeit eines Menschen. Beides ist die Zeile, ueber
   * die im Streit mit Vorher und Nachher gestritten wird. Die Kataloge
   * dagegen aendern sich selten und tragen ihre Geschichte in `archiviert_am`
   * plus Neuanlage — und `abwesenheitsart_schutz` (0073) haelt ohnehin fest,
   * was an einer benutzten Art unveraenderlich ist.
   */
  { tabelle: 'abwesenheit', migration: '0073' },
  { tabelle: 'antrag', migration: '0074' },
  /**
   * `mandant_einstellung` und `zeiteintrag` ja, `checkin_token` und
   * `zeiteintrag_korrektur` nein — eine Entscheidung, keine Auslassung
   * (04-PLANUNG-ZEIT §14.1).
   *
   * Wer einen Ueberwachungsschalter umgelegt hat und wer eine Arbeitszeit
   * bewegt hat, sind die zwei Zeilen, ueber die im Lohnstreit und vor dem
   * Betriebsrat gestritten wird — mit Vorher und Nachher. Die Marke und die
   * Korrekturspur dagegen SIND bereits der Nachweis: sie tragen Akteur,
   * Zeitpunkt und Begruendung in eigenen Spalten, sind anfuegend und
   * unveraenderlich. Ein zweiter Auditeintrag je Zeile verdoppelte genau das
   * Protokoll, auf das sich eine Auskunft stuetzt.
   */
  { tabelle: 'mandant_einstellung', migration: '0033' },
  { tabelle: 'zeiteintrag', migration: '0034' },
  /**
   * `auftrag_leistung` und `zeit_einwand` ja, `zeitnachweis` nein — eine
   * Entscheidung, keine Auslassung (02-CRM §1.6, 01-KERN §6.27).
   *
   * Wer einen Preis oder eine Menge einer Leistungszeile bewegt hat, aendert
   * damit jede kuenftige Rechnung aus diesem Auftrag; und wer einen Einwand
   * entschieden hat, entscheidet ueber einen Lohn. Beides ist die Zeile, ueber
   * die im Streit mit Vorher und Nachher gestritten wird. `zeitnachweis`
   * dagegen IST bereits der Nachweis: anfuegend, mit eigenem Digest und einem
   * Ausloeser, der jedes UPDATE abweist — ein Auditeintrag daneben
   * verdoppelte genau das Protokoll, auf das sich eine Auskunft stuetzt.
   */
  { tabelle: 'auftrag_leistung', migration: '0050' },
  { tabelle: 'zeit_einwand', migration: '0052' },
  /**
   * `stundenkonto` und `urlaubskonto` ja, `stundenkonto_bewegung` nein.
   *
   * An den beiden Konten aendert sich etwas — Sollzeit, Vortrag, Zustand —,
   * und WER den Monat gesperrt hat, ist im Lohnstreit die Frage. Die Bewegung
   * dagegen IST der Nachweis: anfuegend, mit Urheber und Zeitpunkt in eigenen
   * Spalten, und `bewegung_unveraenderlich` laesst kein UPDATE zu. Ein
   * Auditeintrag je Buchung verdoppelte genau das Journal, auf das sich die
   * Auskunft stuetzt — und `bewegung_summe` erzeugte je Buchung zusaetzlich
   * eine zweite Zeile am Konto.
   */
  { tabelle: 'stundenkonto', migration: '0060' },
  { tabelle: 'urlaubskonto', migration: '0061' },
  /**
   * `leistungsnachweis` ja, seine Zeilen und `revier_raum` nein — eine
   * Entscheidung, keine Auslassung (§13.1).
   *
   * Wer einen Nachweis vorgelegt, abgelehnt oder storniert hat, ist die Zeile,
   * ueber die im Streit um eine Rechnung gestritten wird, mit Vorher und
   * Nachher. Die Positionen und die Raumzuordnung kommen dagegen zu Hunderten
   * aus einem Import; ein Auditeintrag je Zeile ertraenkte genau das
   * Protokoll, auf das sich eine Auskunft stuetzt — §13.1 nennt das
   * ausdruecklich „logged at head granularity".
   */
  { tabelle: 'leistungsnachweis', migration: '0066' },
  /**
   * `lv_position` und `aufmass` ja, ihre Kinder nein — eine Entscheidung,
   * keine Auslassung (03-GEWERKE §12).
   *
   * An der LV-Position bewegt sich die Vertragsmenge und der Einheitspreis,
   * und WER sie bewegt hat, aendert jede kuenftige Rechnung aus diesem
   * Projekt; am Aufmassblatt bewegt sich der Zustand bis zur Sperre, und ob
   * jemand ein Blatt kurz vor der Gegenzeichnung noch angefasst hat, ist im
   * Werklohnstreit genau die Frage. Zeile, Foto und Unterschrift dagegen SIND
   * bereits der Nachweis: sie sind anfuegend, tragen Urheber und Serverzeit in
   * eigenen Spalten und werden mit der Sperre eingefroren. Ein zweiter
   * Auditeintrag je Zeile verdoppelte genau das Protokoll, auf das sich eine
   * Auskunft stuetzt.
   */
  { tabelle: 'lv_position', migration: '0071' },
  { tabelle: 'aufmass', migration: '0072' },
  /**
   * `nachtrag` und `behinderung` ja, ihre Kataloge auch (PR 44).
   *
   * Am Nachtrag bewegen sich zwei Daten, an denen ein Anspruch haengt, und
   * wer sie bewegt hat, ist im § 2-Streit die Frage. An der Behinderung
   * bewegt sich der Zustand bis zum Versand — danach laesst der Ausloeser
   * `behinderung_einfrieren` ohnehin nichts mehr zu, und genau deshalb ist
   * interessant, wer kurz davor noch etwas angefasst hat. Die beiden Kataloge
   * tragen Rechtstexte und die Platzhaltermarkierung: sie zu aendern aendert
   * die Grundlage jedes kuenftigen Nachtrags und jedes kuenftigen Schreibens.
   */
  { tabelle: 'nachtrag_grundlage', migration: '0080' },
  { tabelle: 'nachtrag', migration: '0080' },
  { tabelle: 'behinderung_vorlage', migration: '0081' },
  { tabelle: 'behinderung', migration: '0081' },
  /**
   * `bautagebuch` ja, seine beiden Kindtabellen nicht (PR 45, §13.1
   * „logged at head granularity").
   *
   * Wer einen Bautag geschlossen, gegengezeichnet oder storniert hat, ist im
   * Bauzeitstreit genau die Frage — mit Vorher und Nachher. Die Mannstunden-
   * und Positionszeilen SIND dagegen bereits der Nachweis: anfuegend, mit
   * Urheber und Serverzeit in eigenen Spalten, und `bautagebuch_kind_nur_storno`
   * laesst kein inhaltliches UPDATE zu. Ein Auditeintrag je Zeile verdoppelte
   * bei zwanzig Zeilen am Tag genau das Protokoll, auf das sich eine Auskunft
   * stuetzt.
   */
  { tabelle: 'bautagebuch', migration: '0082' },

  /**
   * Finanzen (PR 46) — und `rechnung_snapshot` steht ausdruecklich NICHT
   * dabei.
   *
   * Der Rechnungskopf, seine Kinder und die drei Referenztabellen werden
   * auditiert: wer eine Position kurz vor dem Festschreiben noch angefasst
   * hat, ist im Streitfall genau die Frage, und wer einen Steuersatz bewegt
   * hat, entscheidet ueber jede kuenftige Rechnung der Gruppe.
   *
   * Der Snapshot dagegen IST das Protokoll. Ihn zusaetzlich nach `audit_log`
   * zu spiegeln legte dasselbe Dokument ein zweites Mal ab — samt
   * `nutzlast_bytes` als Hextext, also mit doppeltem Volumen — und die zweite
   * Kopie waere die, die niemand hasht. `rechnung_hash` dagegen ist eine
   * Handvoll Spalten und die Zeile, an der eine Manipulation sichtbar wuerde.
   */
  { tabelle: 'steuersatz_gruppe', migration: '0075' },
  { tabelle: 'masseinheit', migration: '0075' },
  { tabelle: 'kleinbetrag_grenze', migration: '0075' },
  { tabelle: 'rechnung', migration: '0075' },
  { tabelle: 'rechnungsposition', migration: '0075' },
  { tabelle: 'rechnung_zuschlag', migration: '0075' },
  { tabelle: 'rechnung_steuer', migration: '0075' },
  { tabelle: 'rechnung_beziehung', migration: '0075' },
  { tabelle: 'rechnung_hash', migration: '0077' },
  /**
   * CRM (PR 48): die Abrechnungskonfiguration. Wer den Stundensatz oder die
   * Monatspauschale eines laufenden Vertrages bewegt hat — mit Vorher und
   * Nachher —, ist die Frage, die jede kuenftige Rechnung dieses Auftrags
   * entscheidet (02-CRM §13.1 fuehrt `vertrag_abrechnung` ausdruecklich in
   * der Liste der protokollierten Tabellen).
   */
  { tabelle: 'vertrag_abrechnung', migration: '0105' },
  /**
   * Finanzen (PR 49): wer welche Stunde auf welche Rechnung gesetzt — und wer
   * sie mit einem Storno wieder freigegeben — hat, ist die Frage, die eine
   * Betriebspruefung an der Doppelabrechnungssperre stellt (§4.4, FIN-07).
   */
  { tabelle: 'rechnungsposition_quelle', migration: '0107' },
] as const;

/** Tables carrying S4 (`geloescht_am` / `geloescht_von`) — the finders' domain. */
export const SOFT_DELETE: readonly string[] = KEIN_HARD_DELETE.filter(
  (l) => l.art === 'soft',
).map((l) => l.tabelle);

/** Tables carrying S2 (`geaendert_am`, maintained by `kern.setze_geaendert_am()`). */
export const GEAENDERT_AM: readonly TabelleJeMigration[] = [
  /**
   * `medien` ja, `medien_bezug` und `offline_ereignis` nicht.
   *
   * Ein Medium bekommt eine Beschreibung, wird archiviert, verliert seine
   * Binaerdatei — das sind Aenderungen, und sie sollen einen Zeitpunkt tragen.
   * Das Register ist Referenzdatenbestand, den nur eine Migration bewegt, und
   * `offline_ereignis` ist anfuegend: ein `geaendert_am` daneben behauptete,
   * jemand habe die BEHAUPTUNG bearbeitet — das darf niemand, und
   * `oe_unveraenderlich` laesst es auch nicht zu.
   */
  { tabelle: 'einsatz_medien', migration: '0041' },
  { tabelle: 'arbeitszeit_verstoss', migration: '0040' },
  { tabelle: 'planungs_konflikt', migration: '0040' },
  { tabelle: 'mandant', migration: '0005' },
  { tabelle: 'person', migration: '0005' },
  { tabelle: 'anstellung', migration: '0005' },
  // `nummernkreis` trägt zusätzlich fin.nummernkreis_pruefen() (0006), das
  // entscheidet, WAS sich ändern darf; dieser hier setzt nur, WANN.
  { tabelle: 'nummernkreis', migration: '0006' },
  { tabelle: 'rolle', migration: '0007' },
  { tabelle: 'benutzer', migration: '0007' },
  { tabelle: 'benutzer_mandant', migration: '0007' },
  // `benutzer_sitzung` führt `letzte_aktivitaet_am` selbst, in derselben
  // Anweisung, die die Sitzung validiert.
  { tabelle: 'formular_definition', migration: '0016' },
  { tabelle: 'formular_zustaendigkeit', migration: '0016' },
  { tabelle: 'lead', migration: '0017' },
  { tabelle: 'belagsart', migration: '0021' },
  { tabelle: 'reinigungsklasse', migration: '0021' },
  { tabelle: 'objekt', migration: '0021' },
  { tabelle: 'raum', migration: '0021' },
  { tabelle: 'leistungskatalog', migration: '0022' },
  { tabelle: 'leistungskatalog_position', migration: '0022' },
  { tabelle: 'kalkulation', migration: '0023' },
  { tabelle: 'angebot', migration: '0024' },
  { tabelle: 'angebotsposition', migration: '0024' },
  { tabelle: 'auftrag', migration: '0025' },
  { tabelle: 'raumbuch_import', migration: '0026' },
  { tabelle: 'feiertag', migration: '0028' },
  { tabelle: 'planungsserie', migration: '0028' },
  { tabelle: 'einsatz', migration: '0028' },
  { tabelle: 'einsatz_zuordnung', migration: '0028' },
  { tabelle: 'revier', migration: '0029' },
  { tabelle: 'turnus', migration: '0029' },
  { tabelle: 'turnus_ausnahme', migration: '0029' },
  { tabelle: 'nachweis_art', migration: '0030' },
  { tabelle: 'qualifikation', migration: '0030' },
  { tabelle: 'nachweis', migration: '0030' },
  { tabelle: 'bewacher_eintrag', migration: '0031' },
  { tabelle: 'einsatzanforderung', migration: '0031' },
  { tabelle: 'mandant_einstellung', migration: '0033' },
  { tabelle: 'zeiteintrag', migration: '0034' },
  { tabelle: 'auftrag_leistung', migration: '0050' },
  { tabelle: 'zeit_einwand', migration: '0052' },
  // `stundenkonto_bewegung` NICHT: sie ist anfuegend (§6.25). Ein
  // `geaendert_am` daneben behauptete, eine gebuchte Minute liesse sich
  // nachtraeglich bewegen — genau das verhindert `bewegung_unveraenderlich`.
  { tabelle: 'stundenkonto', migration: '0060' },
  { tabelle: 'urlaubskonto', migration: '0061' },
  { tabelle: 'postenart', migration: '0069' },
  { tabelle: 'posten', migration: '0069' },
  { tabelle: 'posten_ausnahme', migration: '0069' },
  { tabelle: 'veranstaltung', migration: '0069' },
  { tabelle: 'kontrollpunkt', migration: '0070' },
  // `wachbuch_eintrag` NICHT: die Seite ist geschrieben, sobald sie steht
  // (§6.12). Ein `geaendert_am` daneben behauptete, ein Mensch habe einen
  // Wachbucheintrag bearbeitet — genau das laesst `w_nur_storno` nicht zu, und
  // die Hashkette waere danach gebrochen. Korrigiert wird durch einen neuen,
  // verknuepften Eintrag.
  // `zeitnachweis` NICHT: das Artefakt eines gesperrten Monats wird genau
  // einmal geschrieben, und `kern.zeitnachweis_write_once()` weist jedes
  // UPDATE ab. Ein `geaendert_am` daneben behauptete, es liesse sich aendern.
  // `checkin_token` NICHT: sie ist anfuegend (§5.5). Was sich an ihr noch
  // bewegen darf, zaehlt `ct_unveraenderlich` einzeln auf; ein `geaendert_am`
  // daneben behauptete, ein Mensch habe die Marke bearbeitet.
  // `zeiteintrag_korrektur` NICHT: sie wird genau einmal geschrieben, und ein
  // `geaendert_am` an einer Korrekturspur ist ein Widerspruch in sich.
  // `nachweis_warnung` NICHT: die Quittung wird einmal geschrieben und nie
  // geaendert. Ein `geaendert_am` daneben behauptete, eine bereits ergangene
  // Meldung habe sich geaendert — sie darf es nicht.
  // `raumbuch_import_zeile` NICHT: sie ist die eine RAEUMBARE Tabelle dieser
  // Domaene (§1.8) und traegt deshalb weder Loeschsperre noch geaendert_am —
  // mit Sperre koennte die Raeumungspolicy gar nicht feuern.
  // `angebot_steuer` NICHT: sie wird einmal geschrieben und nie geaendert.
  // `kalkulation_position` NICHT: sie traegt kein geaendert_am. Eine Position
  // einer festgeschriebenen Kalkulation ist unveraenderlich, und eine einer
  // offenen wird ersetzt statt bearbeitet.
  // `formular_eingang` NICHT: er ist write-once. `verarbeitet_am` sagt, wann
  // jemand ihn angefasst hat, und ein `geaendert_am` daneben behauptete, der
  // Eingang selbst habe sich geändert — er darf es nicht.
  { tabelle: 'revier_raum', migration: '0065' },
  { tabelle: 'leistungsnachweis', migration: '0066' },
  { tabelle: 'leistungsnachweis_position', migration: '0066' },
  /**
   * `leistungsnachweis_signatur` fehlt hier mit Absicht: sie hat gar keine
   * `geaendert_*`-Spalten (§5.8). Ein Stempel darauf behauptete, jemand duerfe
   * eine Unterschrift bearbeiten — und `ln_signatur_unveraenderlich` laesst es
   * ohnehin nicht zu.
   */
  { tabelle: 'sonderleistung', migration: '0067' },
  { tabelle: 'pruefverfahren', migration: '0068' },
  { tabelle: 'reklamation', migration: '0068' },
  { tabelle: 'qualitaetspruefung', migration: '0068' },
  { tabelle: 'qualitaetspruefung_position', migration: '0068' },
  // Bau (PR 43): die drei Stammdatentabellen und die zwei Tabellen, an denen
  // sich im Entwurf noch etwas bewegt. `aufmass_foto` und `aufmass_signatur`
  // NICHT: beide sind anfuegend, und ein `geaendert_am` an einer Unterschrift
  // behauptete, sie liesse sich nachtraeglich bearbeiten.
  { tabelle: 'projekt', migration: '0071' },
  { tabelle: 'leistungsverzeichnis', migration: '0071' },
  { tabelle: 'lv_position', migration: '0071' },
  { tabelle: 'aufmass', migration: '0072' },
  { tabelle: 'aufmass_zeile', migration: '0072' },
  // Bau (PR 44): alle vier — am Nachtrag und an der Behinderung bewegt sich
  // bis zur Einreichung bzw. bis zum Versand etwas, und die Kataloge werden
  // gepflegt, sobald O-23 beantwortet ist.
  { tabelle: 'nachtrag_grundlage', migration: '0080' },
  { tabelle: 'nachtrag', migration: '0080' },
  { tabelle: 'behinderung_vorlage', migration: '0081' },
  { tabelle: 'behinderung', migration: '0081' },
  // Bau (PR 45): der Gewerkekatalog und der Tageskopf, an dem sich bis zum
  // Abschluss noch etwas bewegt. Die beiden Kindtabellen NICHT: sie sind
  // anfuegend, und ein `geaendert_am` an einer Mannstundenzeile behauptete,
  // eine gebuchte Stunde liesse sich nachtraeglich bewegen — genau das weist
  // `bautagebuch_kind_nur_storno` ab.
  { tabelle: 'gewerk', migration: '0082' },
  { tabelle: 'bautagebuch', migration: '0082' },
  // `wetter_station` ja, `wetter_beobachtung` nicht: eine Station wird
  // umbenannt oder stillgelegt, eine Messung nie korrigiert — ihre Revision
  // ist eine neue Zeile (§7.17).
  { tabelle: 'wetter_station', migration: '0083' },

  /**
   * Finanzen (PR 46): beweglich ist, was im ENTWURF noch bewegt wird — der
   * Kopf, seine Positionen, die Zu- und Abschlaege und die
   * Steueraufschluesselung, die `berechneSteuer()` bei jeder Positionsaenderung
   * neu setzt.
   *
   * `rechnung_beziehung`, `rechnung_snapshot` und `rechnung_hash` NICHT: alle
   * drei sind anfuegend, und ein `geaendert_am` an einem Kettenglied
   * behauptete, es liesse sich nachtraeglich bearbeiten — was
   * `fin.kette_unveraenderlich()` gerade nicht zulaesst.
   *
   * `kleinbetrag_grenze` ebenfalls nicht: eine ausgelaufene Schwelle bekommt
   * `gueltig_bis`, eine neue ist eine neue Zeile.
   */
  { tabelle: 'steuersatz_gruppe', migration: '0075' },
  { tabelle: 'masseinheit', migration: '0075' },
  { tabelle: 'rechnung', migration: '0075' },
  { tabelle: 'rechnungsposition', migration: '0075' },
  { tabelle: 'rechnung_zuschlag', migration: '0075' },
  { tabelle: 'rechnung_steuer', migration: '0075' },

  /**
   * Security B (PR 42): beweglich sind der Kopf der Dienstanweisung, die
   * Pflichtzeile und die zwei Stammdatentabellen der Schluessel.
   *
   * `dienstanweisung_version`, `da_kenntnisnahme` und `schluessel_quittung`
   * NICHT: alle drei sind anfuegend, und ein `geaendert_am` daneben
   * behauptete, jemand duerfe eine veroeffentlichte Fassung, eine Bestaetigung
   * oder eine Quittung bearbeiten — was die Ausloeser gerade nicht zulassen.
   */
  { tabelle: 'dienstanweisung', migration: '0078' },
  { tabelle: 'da_pflicht', migration: '0078' },
  { tabelle: 'schluesselart', migration: '0079' },
  { tabelle: 'schluessel', migration: '0079' },

  /**
   * CRM (PR 48): die Abrechnungskonfiguration ist beweglich, solange ihr
   * Zeitraum laeuft — Zahlungsziel, Skonto, Leitweg-ID und Bestellnummer
   * werden gepflegt. Was sie NICHT ist, ist rueckwirkend loeschbar: sie wird
   * durch `gueltig_bis` abgeloest (siehe KEIN_HARD_DELETE).
   */
  { tabelle: 'vertrag_abrechnung', migration: '0105' },

  /**
   * Finanzen (PR 49): `rechnungsposition_quelle` ist beweglich in genau einer
   * Spalte — `wirksam` faellt beim Storno. §4.4 nennt den Auditblock
   * „insert only" und fuehrt `wirksam` zugleich als veraenderlich; K-16
   * verlangt fuer jede bewegliche Tabelle ein `geaendert_am`, und wo Kapitel
   * und Konvention auseinandergehen, gilt die Konvention (wie bei
   * `rechnung_steuer`, D-213).
   */
  { tabelle: 'rechnungsposition_quelle', migration: '0107' },
] as const;

/** Every migration that carries a generated block, in order. */
export const MIGRATIONEN: readonly string[] = [
  ...new Set([
    ...KEIN_HARD_DELETE.map((l) => l.migration),
    ...AUDITIERT.map((a) => a.migration),
    ...GEAENDERT_AM.map((g) => g.migration),
  ]),
].sort();

/**
 * Tabellen mit `mandant_id`, die BEWUSST keine `cse_app`-Policy tragen.
 *
 * Der uebliche Fall ist: `mandant_id` heisst Policy. Diese hier sind die
 * Ausnahme, und sie ist streng — kein Grant, keine Policy, erreichbar
 * ausschliesslich durch eine `SECURITY DEFINER`-Funktion, die ihre eigene
 * Pruefung mitbringt. Ohne Policy trifft ein direkter Zugriff null Zeilen;
 * ohne Grant kommt er gar nicht erst so weit.
 *
 * Der Eintrag steht hier, damit die Ausnahme REVIEWBAR ist. Eine Tabelle, die
 * einfach keine Policy hat, sieht genauso aus wie eine, bei der jemand sie
 * vergessen hat — und der Unterschied ist der ganze Punkt.
 */
export interface DefinerTabelle {
  readonly tabelle: string;
  /** Die einzige Funktion, die sie beruehrt. */
  readonly zugang: string;
  readonly grund: string;
}

export const NUR_UEBER_DEFINER: readonly DefinerTabelle[] = [
  {
    tabelle: 'zeit_intern.arbeitszeit_fenster',
    zugang: 'app.arbzg_belastung / zeit_intern.fenster_setzen',
    grund:
      'K-06 — die eine erlaubte Mandantenueberschreitung. Die Tabelle traegt die '
      + 'Arbeitszeitfenster EINER Person ueber alle Gesellschaften hinweg; jede '
      + 'Policy fuer `cse_app` waere ein Leseweg quer durch die Mandantengrenze. '
      + 'Sie hat darum weder Policy noch Grant, liegt in einem Schema, das '
      + 'PostgREST nicht ausliefert, und enthaelt keine Spalte, die eine Schicht '
      + 'identifizieren koennte — auch ein Fehler im Leser kann nicht verraten, '
      + 'was nicht darin steht. Der Eintrag steht hier, weil eine Tabelle ohne '
      + 'Policy sonst aussieht wie eine vergessene.',
  },
  {
    tabelle: 'freigabe_kette',
    zugang: 'app.freigabe_kette_ziehen',
    grund:
      'K-13. Der Kettenkopf wird unter `SELECT … FOR UPDATE` gezogen, damit zwei '
      + 'gleichzeitige Freigebende die Kette nicht gabeln. Eine Policy, die `cse_app` '
      + 'an die Zeile liesse, machte den Zaehler von aussen bewegbar — und eine Kette, '
      + 'deren Kopf jemand verstellen kann, bezeugt nichts.',
  },
];
