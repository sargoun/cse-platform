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
