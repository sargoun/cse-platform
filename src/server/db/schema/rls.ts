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
] as const;

/**
 * Tables whose every write is mirrored into `audit_log` by
 * `kern.protokolliere_aenderung()`.
 *
 * `audit_log` is deliberately absent: a table that audits itself recurses, and
 * there is no write path to it other than `app.protokolliere` anyway.
 */
export const AUDITIERT: readonly TabelleJeMigration[] = [
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
] as const;

/** Tables carrying S4 (`geloescht_am` / `geloescht_von`) — the finders' domain. */
export const SOFT_DELETE: readonly string[] = KEIN_HARD_DELETE.filter(
  (l) => l.art === 'soft',
).map((l) => l.tabelle);

/** Tables carrying S2 (`geaendert_am`, maintained by `kern.setze_geaendert_am()`). */
export const GEAENDERT_AM: readonly TabelleJeMigration[] = [
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
    tabelle: 'freigabe_kette',
    zugang: 'app.freigabe_kette_ziehen',
    grund:
      'K-13. Der Kettenkopf wird unter `SELECT … FOR UPDATE` gezogen, damit zwei '
      + 'gleichzeitige Freigebende die Kette nicht gabeln. Eine Policy, die `cse_app` '
      + 'an die Zeile liesse, machte den Zaehler von aussen bewegbar — und eine Kette, '
      + 'deren Kopf jemand verstellen kann, bezeugt nichts.',
  },
];
