-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0005)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- audit_log (append): SEC-A9. An audit trail with a delete path is not an audit trail. No liveness column either: a redacted or archived audit row is still a row somebody chose to stop showing.
create trigger trg_audit_log_kein_hard_delete
  before delete on audit_log
  for each row execute function kern.verhindere_loeschung();
create trigger trg_audit_log_kein_truncate
  before truncate on audit_log
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on audit_log from cse_app, cse_anon, cse_checkin, cse_job;

-- mandant (archiv): LEG-01. A mandant owns financial records under a ten-year retention, and its id is the tenant key every one of those records carries. `archiviert_am` ends its operational life; the row stays for as long as its data does.
create trigger trg_mandant_kein_hard_delete
  before delete on mandant
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mandant_kein_truncate
  before truncate on mandant
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mandant from cse_app, cse_anon, cse_checkin, cse_job;

-- person (soft): LEG-02, D-09. The human behind every time record. Art. 17 DSGVO erasure anonymises this row where a statutory retention duty stands against removal (§6.3) — it never deletes it, because the costed records point here.
create trigger trg_person_kein_hard_delete
  before delete on person
  for each row execute function kern.verhindere_loeschung();
create trigger trg_person_kein_truncate
  before truncate on person
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on person from cse_app, cse_anon, cse_checkin, cse_job;

-- anstellung (soft): LEG-01, LEG-02. Everything costed hangs off `anstellung_id` (D-09). Deleting an employment orphans the wage evidence a MiLoG or ArbZG dispute is settled with.
create trigger trg_anstellung_kein_hard_delete
  before delete on anstellung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_anstellung_kein_truncate
  before truncate on anstellung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on anstellung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_mandant_geaendert_am
  before update on mandant
  for each row execute function kern.setze_geaendert_am();
create trigger trg_person_geaendert_am
  before update on person
  for each row execute function kern.setze_geaendert_am();
create trigger trg_anstellung_geaendert_am
  before update on anstellung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_mandant_audit
  after insert or update or delete on mandant
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_person_audit
  after insert or update or delete on person
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_anstellung_audit
  after insert or update or delete on anstellung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0006)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- nummernkreis (archiv): FIN-03, LEG-01. Die Zählerzeile IST der Beweis der Lückenlosigkeit: sie zu löschen und neu anzulegen setzt den Zähler zurück und erzeugt zweimal dieselbe Rechnungsnummer. `geschlossen_am` beendet die Vergabe; die Zeile bleibt, solange die Nummern gelten, die sie ausgegeben hat.
create trigger trg_nummernkreis_kein_hard_delete
  before delete on nummernkreis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nummernkreis_kein_truncate
  before truncate on nummernkreis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nummernkreis from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_nummernkreis_geaendert_am
  before update on nummernkreis
  for each row execute function kern.setze_geaendert_am();

create trigger trg_nummernkreis_audit
  after insert or update or delete on nummernkreis
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0007)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- rolle (archiv): AUT-03, SEC-A9. Die Historie in `benutzer_mandant` verweist auf die Rolle, unter der jemand gehandelt hat. Die Rolle zu löschen macht zehn Jahre Rechtevergabe unlesbar; `archiviert_am` beendet ihre Verwendung.
create trigger trg_rolle_kein_hard_delete
  before delete on rolle
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rolle_kein_truncate
  before truncate on rolle
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rolle from cse_app, cse_anon, cse_checkin, cse_job;

-- benutzer (archiv): SEC-A9, LEG-01. `audit_log` benennt dieses Konto als Akteur — dauerhaft. Ein gelöschter Benutzer macht jede Zeile, die er geschrieben hat, herrenlos. `deaktiviert_am` beendet den Zugang.
create trigger trg_benutzer_kein_hard_delete
  before delete on benutzer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_benutzer_kein_truncate
  before truncate on benutzer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on benutzer from cse_app, cse_anon, cse_checkin, cse_job;

-- benutzer_mandant (archiv): AUT-08, LEG-01. Wer wann in welchem Bereich welche Rolle hatte, ist die Antwort auf "wer durfte das". `entzogen_am` beendet den Zugang und behält die Antwort.
create trigger trg_benutzer_mandant_kein_hard_delete
  before delete on benutzer_mandant
  for each row execute function kern.verhindere_loeschung();
create trigger trg_benutzer_mandant_kein_truncate
  before truncate on benutzer_mandant
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on benutzer_mandant from cse_app, cse_anon, cse_checkin, cse_job;

-- benutzer_sitzung (archiv): SEC-A9, AUT-08. Sitzungen sind Teil des Sicherheitsprotokolls: von welchem Gerät und welcher IP wann gearbeitet wurde. `beendet_am` beendet sie.
create trigger trg_benutzer_sitzung_kein_hard_delete
  before delete on benutzer_sitzung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_benutzer_sitzung_kein_truncate
  before truncate on benutzer_sitzung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on benutzer_sitzung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_rolle_geaendert_am
  before update on rolle
  for each row execute function kern.setze_geaendert_am();
create trigger trg_benutzer_geaendert_am
  before update on benutzer
  for each row execute function kern.setze_geaendert_am();
create trigger trg_benutzer_mandant_geaendert_am
  before update on benutzer_mandant
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0009)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- dokument (soft): DOC-07, LEG-01, § 147 AO. Rechnungen und Buchungsbelege stehen zehn Jahre unter Aufbewahrungspflicht; `loeschsperre` verhindert zusaetzlich das Soft-Loeschen, solange die Frist laeuft oder unbekannt ist.
create trigger trg_dokument_kein_hard_delete
  before delete on dokument
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dokument_kein_truncate
  before truncate on dokument
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dokument from cse_app, cse_anon, cse_checkin, cse_job;

-- dokument_version (append): DOC-06, LEG-01. Die Versionskette traegt den SHA-256 der gespeicherten Bytes — die Grundlage der GoBD-Integritaet. Eine Version zu loeschen entfernt den Beweis, dass die uebrigen unveraendert sind.
create trigger trg_dokument_version_kein_hard_delete
  before delete on dokument_version
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dokument_version_kein_truncate
  before truncate on dokument_version
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dokument_version from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0012)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- freigabe_snapshot (append): Invariante 7, APR-07, K-13. Der Schnappschuss bezeugt, WAS zum Zeitpunkt der Entscheidung vorlag, und traegt das einzige verkettete Glied. Ihn zu loeschen entfernt den Beweis, dass die uebrigen Entscheidungen unveraendert sind.
create trigger trg_freigabe_snapshot_kein_hard_delete
  before delete on freigabe_snapshot
  for each row execute function kern.verhindere_loeschung();
create trigger trg_freigabe_snapshot_kein_truncate
  before truncate on freigabe_snapshot
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on freigabe_snapshot from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0016)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- formular_definition (archiv): REQ-01. Eine gespeicherte Einsendung verweist auf die Version, gegen die sie validiert wurde. Wird die Definition gelöscht, ist die Einsendung nicht mehr lesbar und der LEG-09-Datenschutzbeleg zeigt ins Leere. Zurückziehen heisst `zurueckgezogen_am`, nicht DELETE.
create trigger trg_formular_definition_kein_hard_delete
  before delete on formular_definition
  for each row execute function kern.verhindere_loeschung();
create trigger trg_formular_definition_kein_truncate
  before truncate on formular_definition
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on formular_definition from cse_app, cse_anon, cse_checkin, cse_job;

-- formular_zustaendigkeit (archiv): REQ-05/REQ-06. Sie hält die SLA und den benannten Besitzer eines Formulars; ohne sie lässt sich im Nachhinein nicht sagen, welche Frist für einen Lead galt. Sie endet mit ihrer Definition, nicht für sich.
create trigger trg_formular_zustaendigkeit_kein_hard_delete
  before delete on formular_zustaendigkeit
  for each row execute function kern.verhindere_loeschung();
create trigger trg_formular_zustaendigkeit_kein_truncate
  before truncate on formular_zustaendigkeit
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on formular_zustaendigkeit from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_formular_definition_geaendert_am
  before update on formular_definition
  for each row execute function kern.setze_geaendert_am();
create trigger trg_formular_zustaendigkeit_geaendert_am
  before update on formular_zustaendigkeit
  for each row execute function kern.setze_geaendert_am();

create trigger trg_formular_definition_audit
  after insert or update or delete on formular_definition
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_formular_zustaendigkeit_audit
  after insert or update or delete on formular_zustaendigkeit
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0017)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- lead (archiv): REP-02/REP-03. Die Auswertung von Gewinn und Verlust hängt daran, dass Leads nicht verschwinden — ein gelöschter verlorener Lead macht jede Quote besser, als sie ist. `archiviert_am` beendet ihn.
create trigger trg_lead_kein_hard_delete
  before delete on lead
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lead_kein_truncate
  before truncate on lead
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lead from cse_app, cse_anon, cse_checkin, cse_job;

-- lead_aktivitaet (append): § 7 UWG. Jede ausgehende Zeile trägt Zweck und Rechtsgrundlage zum Zeitpunkt des Sendens — das ist der Beweis, dass gesendet werden durfte. Ein Beweis mit Löschpfad ist keiner, und eine Zeitachse mit Lücken erst recht nicht.
create trigger trg_lead_aktivitaet_kein_hard_delete
  before delete on lead_aktivitaet
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lead_aktivitaet_kein_truncate
  before truncate on lead_aktivitaet
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lead_aktivitaet from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_lead_geaendert_am
  before update on lead
  for each row execute function kern.setze_geaendert_am();

create trigger trg_lead_audit
  after insert or update or delete on lead
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0020)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- firma (archiv): CRM-06. Die Firma ist die geteilte Identitaet hinter zwei oder drei Kundenbeziehungen. Sie zu loeschen macht die Historie der anderen Gesellschaften unlesbar — und die verlorene Zeile einer Verschmelzung bleibt fuer die referenzielle Historie stehen.
create trigger trg_firma_kein_hard_delete
  before delete on firma
  for each row execute function kern.verhindere_loeschung();
create trigger trg_firma_kein_truncate
  before truncate on firma
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on firma from cse_app, cse_anon, cse_checkin, cse_job;

-- kunde (archiv): LEG-01 und AO/HGB. An einem Kunden haengen Angebote, Auftraege und Rechnungen mit zehnjaehriger Aufbewahrung; Art. 17 DSGVO wird durch Anonymisierung erfuellt (anonymisiert_am), nicht durch Loeschen.
create trigger trg_kunde_kein_hard_delete
  before delete on kunde
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kunde_kein_truncate
  before truncate on kunde
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kunde from cse_app, cse_anon, cse_checkin, cse_job;

-- ansprechpartner (archiv): CRM-08. Auf dieser Zeile sitzt der Nachweis nach § 7 UWG: Grundlage, Beleg, Widerspruch. Sie zu loeschen loescht den Beweis, mit dem sich eine Abmahnung abwehren laesst — auch die Loeschung nach Art. 17 laeuft deshalb ueber anonymisiert_am.
create trigger trg_ansprechpartner_kein_hard_delete
  before delete on ansprechpartner
  for each row execute function kern.verhindere_loeschung();
create trigger trg_ansprechpartner_kein_truncate
  before truncate on ansprechpartner
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on ansprechpartner from cse_app, cse_anon, cse_checkin, cse_job;

-- kunde_zugang (archiv): AUT-08. Wer wann fuer welchen Kunden ins Portal durfte, ist eine Zugangsentscheidung. Ein entzogener Zugang wird auf entzogen_am gesetzt, nicht entfernt.
create trigger trg_kunde_zugang_kein_hard_delete
  before delete on kunde_zugang
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kunde_zugang_kein_truncate
  before truncate on kunde_zugang
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kunde_zugang from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0021)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- belagsart (archiv): OPS-03. Der Leistungswert ist die Zahl, aus der ein Angebotspreis entstanden ist. Faellt die Zeile weg, laesst sich ein bereits abgegebenes Angebot nicht mehr nachrechnen; abgeloest wird sie durch gueltig_bis, nicht durch DELETE.
create trigger trg_belagsart_kein_hard_delete
  before delete on belagsart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_belagsart_kein_truncate
  before truncate on belagsart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on belagsart from cse_app, cse_anon, cse_checkin, cse_job;

-- reinigungsklasse (archiv): OPS-02. Die Klasse steht im Leistungsverzeichnis eines laufenden Auftrags. Sie zu loeschen macht die vereinbarte Leistung unlesbar; das Ende einer Klasse ist archiviert_am.
create trigger trg_reinigungsklasse_kein_hard_delete
  before delete on reinigungsklasse
  for each row execute function kern.verhindere_loeschung();
create trigger trg_reinigungsklasse_kein_truncate
  before truncate on reinigungsklasse
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on reinigungsklasse from cse_app, cse_anon, cse_checkin, cse_job;

-- objekt (archiv): OPS-01. An einem Objekt haengen Auftraege, Einsaetze, Nachweise und Rechnungen mit zehnjaehriger Aufbewahrung. Ein beendetes Objekt wird archiviert, nie entfernt.
create trigger trg_objekt_kein_hard_delete
  before delete on objekt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_objekt_kein_truncate
  before truncate on objekt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on objekt from cse_app, cse_anon, cse_checkin, cse_job;

-- raum (archiv): OPS-02. Die Quadratmeter dieser Zeile sind die Grundlage einer Kalkulation, die in ein Angebot und von dort in eine Rechnung gewandert ist. Ein geloeschter Raum macht die Rechnung unpruefbar — ein entfallener Raum bekommt archiviert_am.
create trigger trg_raum_kein_hard_delete
  before delete on raum
  for each row execute function kern.verhindere_loeschung();
create trigger trg_raum_kein_truncate
  before truncate on raum
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on raum from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_belagsart_geaendert_am
  before update on belagsart
  for each row execute function kern.setze_geaendert_am();
create trigger trg_reinigungsklasse_geaendert_am
  before update on reinigungsklasse
  for each row execute function kern.setze_geaendert_am();
create trigger trg_objekt_geaendert_am
  before update on objekt
  for each row execute function kern.setze_geaendert_am();
create trigger trg_raum_geaendert_am
  before update on raum
  for each row execute function kern.setze_geaendert_am();

create trigger trg_belagsart_audit
  after insert or update or delete on belagsart
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0022)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- leistungskatalog (archiv): OPS-06. Der Katalog ist die Fassung, aus der ein abgegebenes Angebot seine Texte und Listenpreise genommen hat. Ein geloeschter Katalog macht dieses Angebot unlesbar; sein Ende ist status = archiviert.
create trigger trg_leistungskatalog_kein_hard_delete
  before delete on leistungskatalog
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungskatalog_kein_truncate
  before truncate on leistungskatalog
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungskatalog from cse_app, cse_anon, cse_checkin, cse_job;

-- leistungskatalog_position (archiv): OPS-06. An der Position haengen kalkulation_position und angebotsposition. Sie zu loeschen bricht die Spur vom Preis zur Leistung; abgeloest wird sie durch gueltig_bis.
create trigger trg_leistungskatalog_position_kein_hard_delete
  before delete on leistungskatalog_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungskatalog_position_kein_truncate
  before truncate on leistungskatalog_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungskatalog_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_leistungskatalog_geaendert_am
  before update on leistungskatalog
  for each row execute function kern.setze_geaendert_am();
create trigger trg_leistungskatalog_position_geaendert_am
  before update on leistungskatalog_position
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0023)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- kalkulation (archiv): OPS-07. Die Kalkulation ist die Begruendung eines abgegebenen Preises. Sie zu loeschen nimmt einem Preisstreit seine Grundlage; eine geaenderte Kalkulation ist eine neue Version, keine ersetzte Zeile.
create trigger trg_kalkulation_kein_hard_delete
  before delete on kalkulation
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kalkulation_kein_truncate
  before truncate on kalkulation
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kalkulation from cse_app, cse_anon, cse_checkin, cse_job;

-- kalkulation_position (archiv): OPS-07, BAU-02. Auf der Position stehen die Schnappschuesse jeder Eingangsgroesse und der Rechenansatz. Ohne sie laesst sich der Betrag nicht mehr nachrechnen, nur noch glauben.
create trigger trg_kalkulation_position_kein_hard_delete
  before delete on kalkulation_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kalkulation_position_kein_truncate
  before truncate on kalkulation_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kalkulation_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_kalkulation_geaendert_am
  before update on kalkulation
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0024)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- angebot (archiv): OPS-08. Ein versendetes Angebot ist ein abgegebenes Vertragsangebot; es zu loeschen entfernt den Beleg fuer das, was zugesagt wurde. Eine Aenderung ist eine neue Version mit Rueckverweis.
create trigger trg_angebot_kein_hard_delete
  before delete on angebot
  for each row execute function kern.verhindere_loeschung();
create trigger trg_angebot_kein_truncate
  before truncate on angebot
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on angebot from cse_app, cse_anon, cse_checkin, cse_job;

-- angebotsposition (archiv): OPS-08, FIN-07. Die Position ist die Zeile, die spaeter zur Rechnungszeile wird. Ohne sie laesst sich nicht mehr zeigen, wofuer der Preis galt.
create trigger trg_angebotsposition_kein_hard_delete
  before delete on angebotsposition
  for each row execute function kern.verhindere_loeschung();
create trigger trg_angebotsposition_kein_truncate
  before truncate on angebotsposition
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on angebotsposition from cse_app, cse_anon, cse_checkin, cse_job;

-- angebot_steuer (append): OPS-08, FIN-09. Die Steuerzeilen entstehen EINMAL beim Versand und werden nie nachgerechnet — dieselbe Bauart, die K-12 von der kanonischen Nutzlast einer Rechnung verlangt.
create trigger trg_angebot_steuer_kein_hard_delete
  before delete on angebot_steuer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_angebot_steuer_kein_truncate
  before truncate on angebot_steuer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on angebot_steuer from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_angebot_geaendert_am
  before update on angebot
  for each row execute function kern.setze_geaendert_am();
create trigger trg_angebotsposition_geaendert_am
  before update on angebotsposition
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0025)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- auftrag (archiv): OPS-05, FIN-07. An einem Auftrag haengen Rechnungen mit zehnjaehriger Aufbewahrung (§ 147 AO); ein beendeter Auftrag wird abgeschlossen und archiviert, nie entfernt.
create trigger trg_auftrag_kein_hard_delete
  before delete on auftrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_auftrag_kein_truncate
  before truncate on auftrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on auftrag from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_auftrag_geaendert_am
  before update on auftrag
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0026)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- raumbuch_import (archiv): OPS-04, LEG-01. Der Importkopf dokumentiert, WIE das heutige Raumbuch entstanden ist — eine GoBD-Frage. Er bleibt, auch wenn seine Zwischenzeilen geraeumt sind; sein Ende ist verworfen_am.
create trigger trg_raumbuch_import_kein_hard_delete
  before delete on raumbuch_import
  for each row execute function kern.verhindere_loeschung();
create trigger trg_raumbuch_import_kein_truncate
  before truncate on raumbuch_import
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on raumbuch_import from cse_app, cse_anon, cse_checkin, cse_job;

-- raum_import_historie (append): OPS-04, SEC-A9. Welcher Import welchen Raum wie veraendert hat, mit Vorher und Nachher. Eine Herkunftsspur mit Loeschpfad ist keine.
create trigger trg_raum_import_historie_kein_hard_delete
  before delete on raum_import_historie
  for each row execute function kern.verhindere_loeschung();
create trigger trg_raum_import_historie_kein_truncate
  before truncate on raum_import_historie
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on raum_import_historie from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_raumbuch_import_geaendert_am
  before update on raumbuch_import
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0028)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- feiertag (append): LEG-03, § 9 ArbZG. Der Feiertagskalender ist die Grundlage dafuer, ob an einem Tag geplant werden durfte und welche Zuschlaege galten. Ein geloeschter Feiertag macht jede vergangene Schicht an diesem Tag unpruefbar — korrigiert wird er durch eine neue Zeile, nie durch DELETE.
create trigger trg_feiertag_kein_hard_delete
  before delete on feiertag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_feiertag_kein_truncate
  before truncate on feiertag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on feiertag from cse_app, cse_anon, cse_checkin, cse_job;

-- planungsserie (archiv): LEG-03, LEG-01. Sie beantwortet, WORAUS ein Plan entstanden ist — die erste Frage einer ArbZG-Pruefung zu einer Schicht, die es nicht haette geben duerfen. Eine pausierte Serie bekommt archiviert_am; sie zu loeschen macht jede von ihr erzeugte Schicht herrenlos.
create trigger trg_planungsserie_kein_hard_delete
  before delete on planungsserie
  for each row execute function kern.verhindere_loeschung();
create trigger trg_planungsserie_kein_truncate
  before truncate on planungsserie
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on planungsserie from cse_app, cse_anon, cse_checkin, cse_job;

-- einsatz (archiv): LEG-02, LEG-03. Die geplante Schicht ist die Gegenprobe zum § 17 MiLoG-Nachweis und zur ArbZG-Auswertung: geplant gegen geleistet. Eine abgesagte Schicht bekommt storniert_am mit Grund — geloescht waere sie im Lohnstreit eine Luecke, die niemand mehr erklaeren kann.
create trigger trg_einsatz_kein_hard_delete
  before delete on einsatz
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatz_kein_truncate
  before truncate on einsatz
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatz from cse_app, cse_anon, cse_checkin, cse_job;

-- einsatz_zuordnung (archiv): LEG-03, D-09. Wer wann fuer WELCHE Gesellschaft eingeteilt war, ist der Beweis, aus dem die entitaetsuebergreifende ArbZG-Belastung entsteht. Eine zurueckgenommene Einteilung bekommt entfernt_am und bleibt Teil des Planungsprotokolls.
create trigger trg_einsatz_zuordnung_kein_hard_delete
  before delete on einsatz_zuordnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatz_zuordnung_kein_truncate
  before truncate on einsatz_zuordnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatz_zuordnung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_feiertag_geaendert_am
  before update on feiertag
  for each row execute function kern.setze_geaendert_am();
create trigger trg_planungsserie_geaendert_am
  before update on planungsserie
  for each row execute function kern.setze_geaendert_am();
create trigger trg_einsatz_geaendert_am
  before update on einsatz
  for each row execute function kern.setze_geaendert_am();
create trigger trg_einsatz_zuordnung_geaendert_am
  before update on einsatz_zuordnung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_einsatz_audit
  after insert or update or delete on einsatz
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_einsatz_zuordnung_audit
  after insert or update or delete on einsatz_zuordnung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0029)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- revier (archiv): CLN-01, FIN-07. Das Revier ist der Zuschnitt, auf den Sollzeit, Turnus und Leistungsnachweis zeigen. Es zu loeschen macht jede vergangene Abrechnung unpruefbar, weil niemand mehr sagen kann, welche Flaeche gemeint war; ein aufgeloestes Revier bekommt archiviert_am.
create trigger trg_revier_kein_hard_delete
  before delete on revier
  for each row execute function kern.verhindere_loeschung();
create trigger trg_revier_kein_truncate
  before truncate on revier
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on revier from cse_app, cse_anon, cse_checkin, cse_job;

-- turnus (archiv): CLN-02, LEG-03. Der Turnus ist die vertraglich geschuldete Leistung in ihrer Wiederholung — die Antwort darauf, ob eine Schicht stattfinden musste. Geloescht waere jede von ihm erzeugte Schicht ohne Grundlage; ein beendeter Turnus bekommt gueltig_bis, ein eingestellter archiviert_am.
create trigger trg_turnus_kein_hard_delete
  before delete on turnus
  for each row execute function kern.verhindere_loeschung();
create trigger trg_turnus_kein_truncate
  before truncate on turnus
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on turnus from cse_app, cse_anon, cse_checkin, cse_job;

-- turnus_ausnahme (append): CLN-03, FIN-01. Sie ist die dokumentierte Abweichung samt Grund und Urheber — genau das, was im Streit ueber eine nicht erbrachte Reinigung zaehlt. Eine Ausnahme, die sich loeschen laesst, ist keine Dokumentation. Zurueckgenommen wird sie durch eine Gegenzeile.
create trigger trg_turnus_ausnahme_kein_hard_delete
  before delete on turnus_ausnahme
  for each row execute function kern.verhindere_loeschung();
create trigger trg_turnus_ausnahme_kein_truncate
  before truncate on turnus_ausnahme
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on turnus_ausnahme from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_revier_geaendert_am
  before update on revier
  for each row execute function kern.setze_geaendert_am();
create trigger trg_turnus_geaendert_am
  before update on turnus
  for each row execute function kern.setze_geaendert_am();
create trigger trg_turnus_ausnahme_geaendert_am
  before update on turnus_ausnahme
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0030)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- nachweis_art (archiv): LEG-04, § 34a GewO. Der Schluessel einer Nachweisart steht in Vergabemappen, Agentenprotokollen und in jeder Qualifikation, die auf ihn zeigt. Ihn zu loeschen macht rueckwirkend unlesbar, WELCHE Eignung einmal verlangt war; sein Ende ist archiviert_am.
create trigger trg_nachweis_art_kein_hard_delete
  before delete on nachweis_art
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachweis_art_kein_truncate
  before truncate on nachweis_art
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachweis_art from cse_app, cse_anon, cse_checkin, cse_job;

-- qualifikation (archiv): LEG-04, § 34a GewO. Gegen diese Katalogzeile hat das SEC-04-Tor jede vergangene Zuweisung entschieden, und der Schnappschuss auf der Zuordnung verweist auf ihre id. Geloescht bliebe von der Entscheidung eine UUID ohne Bedeutung uebrig; abgeloest wird sie durch archiviert_am.
create trigger trg_qualifikation_kein_hard_delete
  before delete on qualifikation
  for each row execute function kern.verhindere_loeschung();
create trigger trg_qualifikation_kein_truncate
  before truncate on qualifikation
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on qualifikation from cse_app, cse_anon, cse_checkin, cse_job;

-- nachweis (archiv): LEG-04, D-09, § 34a GewO. Dieser Nachweis hat vergangene Schichten GEDECKT — er ist der Beleg, mit dem sich gegenueber der Behoerde zeigen laesst, dass der Einsatz zulaessig war. Ein Widerruf setzt widerrufen_am und nimmt diese Deckung nicht rueckwirkend weg.
create trigger trg_nachweis_kein_hard_delete
  before delete on nachweis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachweis_kein_truncate
  before truncate on nachweis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachweis from cse_app, cse_anon, cse_checkin, cse_job;

-- nachweis_warnung (append): LEG-04, § 34a GewO. Die Quittung, dass die 60/30/7-Stufe gemeldet wurde. Eine loeschbare Quittung ist keine: geloescht meldete der Waechter dieselbe Stufe erneut, und die Zusage "je genau einmal" haette keinen Traeger mehr.
create trigger trg_nachweis_warnung_kein_hard_delete
  before delete on nachweis_warnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachweis_warnung_kein_truncate
  before truncate on nachweis_warnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachweis_warnung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_nachweis_art_geaendert_am
  before update on nachweis_art
  for each row execute function kern.setze_geaendert_am();
create trigger trg_qualifikation_geaendert_am
  before update on qualifikation
  for each row execute function kern.setze_geaendert_am();
create trigger trg_nachweis_geaendert_am
  before update on nachweis
  for each row execute function kern.setze_geaendert_am();

create trigger trg_nachweis_audit
  after insert or update or delete on nachweis
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0031)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- bewacher_eintrag (archiv): SEC-A9, LEG-04, § 34a GewO. Unter dieser Eintragung wurde ein Mensch im Bewachungsgewerbe eingesetzt; sie zu loeschen entfernt den Beleg der Zulaessigkeit und die einmal vergebene Bewacher-ID. Eine erloschene Registrierung bekommt erloschen_am.
create trigger trg_bewacher_eintrag_kein_hard_delete
  before delete on bewacher_eintrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bewacher_eintrag_kein_truncate
  before truncate on bewacher_eintrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bewacher_eintrag from cse_app, cse_anon, cse_checkin, cse_job;

-- einsatzanforderung (archiv): LEG-04, § 34a Abs. 1a GewO. Sie sagt, WAS zum Zeitpunkt der Planung verlangt war — die Frage, an der eine Aufsicht eine vergangene Besetzung misst. Geloescht saehe jede damals rechtmaessig besetzte Schicht so aus, als habe nie eine Anforderung bestanden.
create trigger trg_einsatzanforderung_kein_hard_delete
  before delete on einsatzanforderung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatzanforderung_kein_truncate
  before truncate on einsatzanforderung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatzanforderung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_bewacher_eintrag_geaendert_am
  before update on bewacher_eintrag
  for each row execute function kern.setze_geaendert_am();
create trigger trg_einsatzanforderung_geaendert_am
  before update on einsatzanforderung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_bewacher_eintrag_audit
  after insert or update or delete on bewacher_eintrag
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0033)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- mandant_einstellung (append): LEG-10, § 87 Abs. 1 Nr. 6 BetrVG. Auf diesen Zeilen steht, ob eine Ueberwachungseinrichtung eingeschaltet war und auf welcher Grundlage. Sie zu loeschen loescht den Beleg dafuer, dass die Geolokalisierung im fraglichen Zeitraum AUS war — die Auskunft, auf die es ankommt. `append`, weil eine Einstellung nie endet: ein zurueckgenommener Wert wird auf den Vorgabewert gesetzt, und audit_log traegt den Verlauf.
create trigger trg_mandant_einstellung_kein_hard_delete
  before delete on mandant_einstellung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mandant_einstellung_kein_truncate
  before truncate on mandant_einstellung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mandant_einstellung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_mandant_einstellung_geaendert_am
  before update on mandant_einstellung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_mandant_einstellung_audit
  after insert or update or delete on mandant_einstellung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0034)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- zeiteintrag (archiv): LEG-02, § 17 MiLoG, GoBD. Das ist der Nachweis der geleisteten Zeit — die Zeile, die im Lohnstreit vorgelegt und aus der die Rechnung abgeleitet wird. Ein geloeschter Zeiteintrag ist eine Stunde, die niemand mehr belegen oder widerlegen kann; zurueckgenommen wird er durch storniert_am mit Grund, korrigiert durch eine neue Fassung.
create trigger trg_zeiteintrag_kein_hard_delete
  before delete on zeiteintrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zeiteintrag_kein_truncate
  before truncate on zeiteintrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeiteintrag from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_zeiteintrag_geaendert_am
  before update on zeiteintrag
  for each row execute function kern.setze_geaendert_am();

create trigger trg_zeiteintrag_audit
  after insert or update or delete on zeiteintrag
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0035)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- checkin_token (append): TIM-07, SEC-A9. Die Marke belegt, WER wann von welcher IP eingestempelt hat — der Herkunftsnachweis des zeiteintrags. Geloescht bliebe ein Zeitdatensatz ohne nachvollziehbare Herkunft; abgelaufen oder zurueckgezogen wird sie ueber widerrufen_am.
create trigger trg_checkin_token_kein_hard_delete
  before delete on checkin_token
  for each row execute function kern.verhindere_loeschung();
create trigger trg_checkin_token_kein_truncate
  before truncate on checkin_token
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on checkin_token from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0036)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- zeiteintrag_korrektur (append): TIM-11, LEG-01, SEC-A9. Eine Korrekturspur mit Loeschpfad ist keine. Der ganze Wert dieser Tabelle liegt darin, dass sich eine einmal aufgeschriebene Korrektur weder aendern noch entfernen laesst — auch nicht von super_admin.
create trigger trg_zeiteintrag_korrektur_kein_hard_delete
  before delete on zeiteintrag_korrektur
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zeiteintrag_korrektur_kein_truncate
  before truncate on zeiteintrag_korrektur
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeiteintrag_korrektur from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0040)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- arbeitszeit_verstoss (archiv): LEG-03, TIM-14, § 16 Abs. 2 ArbZG. Der Befund ist der Nachweis, dass die Gruppe eine Ueberschreitung BEMERKT hat — bei einer Gewerbeaufsicht die entscheidende Zeile. Geloescht waere er die Behauptung, es habe ihn nie gegeben; aufgeloest bekommt er hinfaellig_am, bearbeitet quittiert_am.
create trigger trg_arbeitszeit_verstoss_kein_hard_delete
  before delete on arbeitszeit_verstoss
  for each row execute function kern.verhindere_loeschung();
create trigger trg_arbeitszeit_verstoss_kein_truncate
  before truncate on arbeitszeit_verstoss
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on arbeitszeit_verstoss from cse_app, cse_anon, cse_checkin, cse_job;

-- planungs_konflikt (archiv): TIM-05, TIM-06. Ein quittierter Konflikt ist die Spur der Entscheidung, trotzdem zu planen — samt Begruendung und Urheber. Ihn zu loeschen macht aus einer bewussten Abweichung eine, die nie jemand gesehen hat.
create trigger trg_planungs_konflikt_kein_hard_delete
  before delete on planungs_konflikt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_planungs_konflikt_kein_truncate
  before truncate on planungs_konflikt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on planungs_konflikt from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_arbeitszeit_verstoss_geaendert_am
  before update on arbeitszeit_verstoss
  for each row execute function kern.setze_geaendert_am();
create trigger trg_planungs_konflikt_geaendert_am
  before update on planungs_konflikt
  for each row execute function kern.setze_geaendert_am();

create trigger trg_arbeitszeit_verstoss_audit
  after insert or update or delete on arbeitszeit_verstoss
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_planungs_konflikt_audit
  after insert or update or delete on planungs_konflikt
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0041)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- einsatz_medien_bezug (append): TIM-10, DOC-06. Das Register entscheidet, an welche Tabelle ein Medium haengen darf, und sein Name geht in die dynamische Anweisung von `me_bezug_pruefen`. Eine geloeschte Zeile machte jedes daran haengende Foto unpruefbar — der Elternteil liesse sich nicht mehr aufloesen —, und eine loeschbare Referenztabelle waere zugleich eine schreibbare.
create trigger trg_einsatz_medien_bezug_kein_hard_delete
  before delete on einsatz_medien_bezug
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatz_medien_bezug_kein_truncate
  before truncate on einsatz_medien_bezug
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatz_medien_bezug from cse_app, cse_anon, cse_checkin, cse_job;

-- einsatz_medien (archiv): TIM-10, DOC-07, LEG-09. Das Foto ist der Zustandsbeweis einer Schicht — die Zeile, die eine Reklamation entscheidet oder ein Aufmass traegt. Geloescht bliebe eine Behauptung ohne Beleg; die DSGVO-Loeschung entfernt die BINAERDATEI (storage_geloescht_am) und laesst die Zeile als Grabstein stehen, damit das Audit weiterhin zeigt, dass es sie gab.
create trigger trg_einsatz_medien_kein_hard_delete
  before delete on einsatz_medien
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatz_medien_kein_truncate
  before truncate on einsatz_medien
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatz_medien from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_einsatz_medien_geaendert_am
  before update on einsatz_medien
  for each row execute function kern.setze_geaendert_am();

create trigger trg_einsatz_medien_audit
  after insert or update or delete on einsatz_medien
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0042)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- offline_ereignis (append): TIM-09, LEG-02, § 17 MiLoG. Auf dieser Zeile steht, was eine Kraft behauptet hat und was ein Mensch darueber entschieden hat — samt Grund einer Ablehnung. Genau die abgelehnte Behauptung ist im Lohnstreit das Beweismittel; sie zu loeschen hiesse, die eine Seite des Streits zu entfernen. Entschieden wird ueber sie, nie an ihr.
create trigger trg_offline_ereignis_kein_hard_delete
  before delete on offline_ereignis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_offline_ereignis_kein_truncate
  before truncate on offline_ereignis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on offline_ereignis from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0050)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- auftrag_leistung (archiv): FIN-07, TIM-12. Auf eine Leistungszeile zeigen bereits Zeiteintraege, Einsaetze, Reviere und Turnusse — spaeter Aufmasse, LV-Positionen und Rechnungszeilen. Sie zu loeschen risse genau die Kette, auf der die Rueckverfolgbarkeit jeder stundenbasierten Rechnungszeile beruht. Beendet wird sie durch `gueltig_bis`, das einschliesslich gilt.
create trigger trg_auftrag_leistung_kein_hard_delete
  before delete on auftrag_leistung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_auftrag_leistung_kein_truncate
  before truncate on auftrag_leistung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on auftrag_leistung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_auftrag_leistung_geaendert_am
  before update on auftrag_leistung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_auftrag_leistung_audit
  after insert or update or delete on auftrag_leistung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0051)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- zeitnachweis (append): TIM-13, LEG-02, EMP-04. Das einmal gepraegte Artefakt eines gesperrten Monats IST der § 17-MiLoG-Nachweis, den die Arbeitnehmerin bekommen hat. Ein Loeschweg machte aus „byte-gleich wieder ausgegeben" eine Zusage, die der erste Wartungszugang aufhebt.
create trigger trg_zeitnachweis_kein_hard_delete
  before delete on zeitnachweis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zeitnachweis_kein_truncate
  before truncate on zeitnachweis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeitnachweis from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0052)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- zeit_einwand (archiv): EMP-07, LEG-02. Dass jemand eine Abweichung gemeldet — und vielleicht zurueckgezogen — hat, ist im Lohnstreit eine Tatsache und keine Datenpflege. Zurueckgenommen wird ueber `status`, nie durch DELETE.
create trigger trg_zeit_einwand_kein_hard_delete
  before delete on zeit_einwand
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zeit_einwand_kein_truncate
  before truncate on zeit_einwand
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeit_einwand from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_zeit_einwand_geaendert_am
  before update on zeit_einwand
  for each row execute function kern.setze_geaendert_am();

create trigger trg_zeit_einwand_audit
  after insert or update or delete on zeit_einwand
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0060)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- stundenkonto (archiv): EMP-04, LEG-02, ACC-12. Der Monat ist die Bezugsgroesse eines gezahlten Lohns; ein geloeschtes Konto nimmt dem Vortrag des Folgemonats seine Grundlage und dem § 17-Nachweis seinen Rahmen. Beendet wird ein Monat durch `status = gesperrt`, nie durch DELETE.
create trigger trg_stundenkonto_kein_hard_delete
  before delete on stundenkonto
  for each row execute function kern.verhindere_loeschung();
create trigger trg_stundenkonto_kein_truncate
  before truncate on stundenkonto
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on stundenkonto from cse_app, cse_anon, cse_checkin, cse_job;

-- stundenkonto_bewegung (append): EMP-04, TIM-11, Invariante 8. Die Bewegungen SIND das Konto — eine geloeschte Buchung ist eine Stunde, die nie stattgefunden hat, und die Summe daneben stimmt danach trotzdem. Eine falsche Buchung wird storniert (`storniert_bewegung_id`), nie entfernt.
create trigger trg_stundenkonto_bewegung_kein_hard_delete
  before delete on stundenkonto_bewegung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_stundenkonto_bewegung_kein_truncate
  before truncate on stundenkonto_bewegung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on stundenkonto_bewegung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_stundenkonto_geaendert_am
  before update on stundenkonto
  for each row execute function kern.setze_geaendert_am();

create trigger trg_stundenkonto_audit
  after insert or update or delete on stundenkonto
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0061)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- urlaubskonto (archiv): EMP-05, LEG-09. Anspruch, Uebertrag und genommene Tage sind der Nachweis nach § 7 BUrlG; sie zu loeschen macht einen Streit ueber Resturlaub unentscheidbar. Ein abgelaufenes Jahr traegt `abgeschlossen_am`.
create trigger trg_urlaubskonto_kein_hard_delete
  before delete on urlaubskonto
  for each row execute function kern.verhindere_loeschung();
create trigger trg_urlaubskonto_kein_truncate
  before truncate on urlaubskonto
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on urlaubskonto from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_urlaubskonto_geaendert_am
  before update on urlaubskonto
  for each row execute function kern.setze_geaendert_am();

create trigger trg_urlaubskonto_audit
  after insert or update or delete on urlaubskonto
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0065)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- revier_raum (append): CLN-01, OPS-07. Die Zeile IST der Rechenweg einer Kalkulation: Flaeche, Leistungswert und die daraus gewonnene Sollzeit, alle drei als Schnappschuss vom Kalkulationszeitpunkt. Geloescht laesst sich ein abgegebenes Angebot nicht mehr nachrechnen, und die Zusage "Σ revier_raum.sollzeit = revier.sollzeit" waere ohne Vorwarnung falsch. Eine neu zugeschnittene Zone entsteht als NEUES Revier; das alte bekommt archiviert_am.
create trigger trg_revier_raum_kein_hard_delete
  before delete on revier_raum
  for each row execute function kern.verhindere_loeschung();
create trigger trg_revier_raum_kein_truncate
  before truncate on revier_raum
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on revier_raum from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_revier_raum_geaendert_am
  before update on revier_raum
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0066)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- leistungsnachweis (archiv): CLN-04, LEG-01, § 147 AO. Das ist das Dokument, das der Kunde unterschrieben hat und aus dem eine Rechnung abgeleitet wird — zehn Jahre aufbewahrungspflichtig (Klasse gobd_10j). Geloescht bliebe eine Rechnung ohne Leistungsbeleg stehen; korrigiert wird durch Stornieren und einen Ersatz (ersetzt_durch_id), nie durch Entfernen.
create trigger trg_leistungsnachweis_kein_hard_delete
  before delete on leistungsnachweis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungsnachweis_kein_truncate
  before truncate on leistungsnachweis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungsnachweis from cse_app, cse_anon, cse_checkin, cse_job;

-- leistungsnachweis_position (append): CLN-04, FIN-07. Die Zeile traegt den Rueckverweis auf ihre Quelle — den Zeiteintrag, die Aufmasszeile, die Katalogposition. Sie zu loeschen macht aus der Nachvollziehbarkeit einer Rechnungsposition eine Behauptung. Eine eigene Lebendigkeitsspalte hat sie nicht: sie lebt und stirbt mit ihrem Kopf, dessen Zustand sie kopiert traegt.
create trigger trg_leistungsnachweis_position_kein_hard_delete
  before delete on leistungsnachweis_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungsnachweis_position_kein_truncate
  before truncate on leistungsnachweis_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungsnachweis_position from cse_app, cse_anon, cse_checkin, cse_job;

-- leistungsnachweis_signatur (append): CLN-04, LEG-01, SEC-A9. Name, Serverzeit, Ort und der unveraenderliche Abzug dessen, was angezeigt wurde — die Zeile, um die im Streitfall gestritten wird. Sie ist anfuegend bis in die Rechte hinein: kein UPDATE, kein DELETE, keine geaendert_*-Spalten. Eine loeschbare Unterschrift ist keine.
create trigger trg_leistungsnachweis_signatur_kein_hard_delete
  before delete on leistungsnachweis_signatur
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungsnachweis_signatur_kein_truncate
  before truncate on leistungsnachweis_signatur
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungsnachweis_signatur from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_leistungsnachweis_geaendert_am
  before update on leistungsnachweis
  for each row execute function kern.setze_geaendert_am();
create trigger trg_leistungsnachweis_position_geaendert_am
  before update on leistungsnachweis_position
  for each row execute function kern.setze_geaendert_am();

create trigger trg_leistungsnachweis_audit
  after insert or update or delete on leistungsnachweis
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0067)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- sonderleistung (archiv): CLN-05, FIN-01, FIN-07. Der Einzelabruf ist die Grundlage einer einzelabruf-Abrechnung und Teil der Abrechnungsspur (Klasse gobd_10j). Geloescht stuende die Rechnung ueber eine Sonderreinigung ohne den Beleg da, dass sie beauftragt war; ein zurueckgezogener Abruf bekommt storniert_am.
create trigger trg_sonderleistung_kein_hard_delete
  before delete on sonderleistung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_sonderleistung_kein_truncate
  before truncate on sonderleistung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on sonderleistung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_sonderleistung_geaendert_am
  before update on sonderleistung
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0068)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- pruefverfahren (archiv): OPS-11. Das Verfahren ist die Messvorschrift, nach der eine vergangene Pruefung bewertet wurde — samt der Bestehensschwelle, die damals galt. Geloescht liesse sich ein Protokoll nicht mehr lesen: die Punktzahl bliebe stehen und niemand wuesste, wogegen sie gemessen wurde. Abgeloest wird es durch archiviert_am.
create trigger trg_pruefverfahren_kein_hard_delete
  before delete on pruefverfahren
  for each row execute function kern.verhindere_loeschung();
create trigger trg_pruefverfahren_kein_truncate
  before truncate on pruefverfahren
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on pruefverfahren from cse_app, cse_anon, cse_checkin, cse_job;

-- reklamation (archiv): OPS-11, CRM-06, REP-05. Die Beanstandung ist Gewaehrleistungsbeweis: sie zeigt, was wann geruegt und wie abgestellt wurde, und der Wiederholungsfall (wiederholung_von_id) haengt an ihr. Geloescht ist die dritte Beschwerde ueber denselben Mangel die erste; eine erledigte bekommt geschlossen_am, eine gegenstandslose archiviert_am.
create trigger trg_reklamation_kein_hard_delete
  before delete on reklamation
  for each row execute function kern.verhindere_loeschung();
create trigger trg_reklamation_kein_truncate
  before truncate on reklamation
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on reklamation from cse_app, cse_anon, cse_checkin, cse_job;

-- qualitaetspruefung (archiv): OPS-11, PRO-05, REP-05. Das Pruefprotokoll ist die Grundlage des Kundengespraechs und der Nachschulung — und im Streit um eine Vertragsstrafe der Beleg, dass kontrolliert wurde. Geloescht bliebe nur die Behauptung; eine gegenstandslose Pruefung bekommt archiviert_am.
create trigger trg_qualitaetspruefung_kein_hard_delete
  before delete on qualitaetspruefung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_qualitaetspruefung_kein_truncate
  before truncate on qualitaetspruefung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on qualitaetspruefung from cse_app, cse_anon, cse_checkin, cse_job;

-- qualitaetspruefung_position (append): OPS-11, TIM-10. Der einzelne Befund samt Foto und Frist. Er zu loeschen liesse die Kopfsumme stehen und ihre Herleitung verschwinden — und der Mangel, aus dem eine Reklamation entstanden ist, zeigte auf nichts mehr. Eine eigene Lebendigkeitsspalte hat sie nicht: sie lebt mit ihrem Kopf.
create trigger trg_qualitaetspruefung_position_kein_hard_delete
  before delete on qualitaetspruefung_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_qualitaetspruefung_position_kein_truncate
  before truncate on qualitaetspruefung_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on qualitaetspruefung_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_pruefverfahren_geaendert_am
  before update on pruefverfahren
  for each row execute function kern.setze_geaendert_am();
create trigger trg_reklamation_geaendert_am
  before update on reklamation
  for each row execute function kern.setze_geaendert_am();
create trigger trg_qualitaetspruefung_geaendert_am
  before update on qualitaetspruefung
  for each row execute function kern.setze_geaendert_am();
create trigger trg_qualitaetspruefung_position_geaendert_am
  before update on qualitaetspruefung_position
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0069)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- postenart (archiv): SEC-01, LEG-04. Die Postenart sagt, WOFUER ein Mensch eingeteilt war — Empfang, Streife, Objektschutz. Geloescht liesse sich einer vergangenen Besetzung nicht mehr ansehen, welche Taetigkeit sie war, und genau daran misst eine Aufsicht die Qualifikation. Eine aufgegebene Art bekommt `archiviert_am`.
create trigger trg_postenart_kein_hard_delete
  before delete on postenart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_postenart_kein_truncate
  before truncate on postenart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on postenart from cse_app, cse_anon, cse_checkin, cse_job;

-- posten (archiv): SEC-01, LEG-04, TIM-04. Der Posten ist das vertraglich Geschuldete: die Antwort darauf, ob eine Wachschicht stattfinden musste und mit welcher Mindestbesetzung. Geloescht stuende jede von ihm erzeugte Schicht ohne Grundlage da; ein beendeter Posten bekommt `gueltig_bis`, ein aufgegebener `archiviert_am`.
create trigger trg_posten_kein_hard_delete
  before delete on posten
  for each row execute function kern.verhindere_loeschung();
create trigger trg_posten_kein_truncate
  before truncate on posten
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on posten from cse_app, cse_anon, cse_checkin, cse_job;

-- posten_ausnahme (append): SEC-01, TIM-02, LEG-04. Sie ist die dokumentierte Abweichung samt Grund und Urheber — im Streit ueber eine unbesetzte Nacht genau die Zeile, die zaehlt. Eine Ausnahme, die sich loeschen laesst, ist keine Dokumentation; zurueckgenommen wird sie durch eine Gegenzeile.
create trigger trg_posten_ausnahme_kein_hard_delete
  before delete on posten_ausnahme
  for each row execute function kern.verhindere_loeschung();
create trigger trg_posten_ausnahme_kein_truncate
  before truncate on posten_ausnahme
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on posten_ausnahme from cse_app, cse_anon, cse_checkin, cse_job;

-- veranstaltung (archiv): SEC-08, LEG-04. Der Eventdienst traegt Kunde, Ort und Fenster einer kurzfristigen Bewachung; er ist der Traeger, an dem die § 34a-Anforderung fuer Einsaetze ohne festen Posten haengt. Geloescht saehe eine damals gepruefte Besetzung so aus, als habe nie eine Anforderung bestanden. Abgesagt heisst `archiviert_am`.
create trigger trg_veranstaltung_kein_hard_delete
  before delete on veranstaltung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_veranstaltung_kein_truncate
  before truncate on veranstaltung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on veranstaltung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_postenart_geaendert_am
  before update on postenart
  for each row execute function kern.setze_geaendert_am();
create trigger trg_posten_geaendert_am
  before update on posten
  for each row execute function kern.setze_geaendert_am();
create trigger trg_posten_ausnahme_geaendert_am
  before update on posten_ausnahme
  for each row execute function kern.setze_geaendert_am();
create trigger trg_veranstaltung_geaendert_am
  before update on veranstaltung
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0070)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- kontrollpunkt (archiv): SEC-05, LEG-10. Der Kontrollpunkt ist der Bezug, auf den sich ein Praesenznachweis im Wachbuch beruft („war an Punkt 4"). Geloescht zeigt jeder Rundgangseintrag auf nichts mehr, und der Nachweis gegen den Auftraggeber ist wertlos. Ein abgebauter Punkt bekommt `archiviert_am`.
create trigger trg_kontrollpunkt_kein_hard_delete
  before delete on kontrollpunkt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kontrollpunkt_kein_truncate
  before truncate on kontrollpunkt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kontrollpunkt from cse_app, cse_anon, cse_checkin, cse_job;

-- wachbuch_eintrag (archiv): SEC-05, LEG-01, § 34a GewO. Das Wachbuch ist die einzige laufende Beweisfuehrung der Bewachung — Rundgang, Vorkommnis, Uebergabe, Alarm. Eine loeschbare Seite macht die Hashkette daneben zur Behauptung: fehlt ein Glied, laesst sich nicht mehr zeigen, dass nichts entfernt wurde. Korrigiert wird durch einen NEUEN, verknuepften Eintrag; die falsche Zeile bekommt `storniert_am` und `ersetzt_durch_id`.
create trigger trg_wachbuch_eintrag_kein_hard_delete
  before delete on wachbuch_eintrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_wachbuch_eintrag_kein_truncate
  before truncate on wachbuch_eintrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on wachbuch_eintrag from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_kontrollpunkt_geaendert_am
  before update on kontrollpunkt
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0071)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- projekt (archiv): OPS-05, BAU-01, LEG-01. Am Projekt haengen Leistungsverzeichnis, Aufmass, Abnahme und Rechnungen mit zehnjaehriger Aufbewahrung (§ 147 AO). Ein beendetes Projekt wird abgeschlossen und archiviert; geloescht bliebe eine Schlussrechnung ohne Bauvorhaben stehen.
create trigger trg_projekt_kein_hard_delete
  before delete on projekt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_projekt_kein_truncate
  before truncate on projekt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on projekt from cse_app, cse_anon, cse_checkin, cse_job;

-- leistungsverzeichnis (archiv): BAU-01, BAU-04. Das Verzeichnis ist die Fassung, gegen die abgerechnet wird — und bei einem Nachtrag der Beleg dafuer, was urspruenglich eingereicht wurde (§ 2 Abs. 6 VOB/B). Eine neue Verhandlungsrunde ist eine neue Fassung, nie eine ersetzte Zeile.
create trigger trg_leistungsverzeichnis_kein_hard_delete
  before delete on leistungsverzeichnis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungsverzeichnis_kein_truncate
  before truncate on leistungsverzeichnis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungsverzeichnis from cse_app, cse_anon, cse_checkin, cse_job;

-- lv_position (archiv): BAU-01, BAU-02, FIN-07. Auf der Position stehen Vertragsmenge und Einheitspreis, aus denen jede Einheitspreisrechnung entsteht. Sie zu loeschen macht ein bereits gestelltes Aufmass unlesbar: die Menge bliebe stehen, und niemand wuesste mehr, wofuer sie galt.
create trigger trg_lv_position_kein_hard_delete
  before delete on lv_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lv_position_kein_truncate
  before truncate on lv_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lv_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_projekt_geaendert_am
  before update on projekt
  for each row execute function kern.setze_geaendert_am();
create trigger trg_leistungsverzeichnis_geaendert_am
  before update on leistungsverzeichnis
  for each row execute function kern.setze_geaendert_am();
create trigger trg_lv_position_geaendert_am
  before update on lv_position
  for each row execute function kern.setze_geaendert_am();

create trigger trg_lv_position_audit
  after insert or update or delete on lv_position
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0072)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- aufmass (archiv): BAU-02, BAU-03, LEG-01, § 14 VOB/B. Das gegengezeichnete Blatt ist das Beweismittel, aus dem eine Werklohnforderung entsteht. Korrigiert wird durch Storno und ein Ersatzblatt (`ersetzt_durch_id`), nie durch Entfernen — geloescht waere im Werklohnprozess eine Luecke, die niemand mehr erklaeren kann.
create trigger trg_aufmass_kein_hard_delete
  before delete on aufmass
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufmass_kein_truncate
  before truncate on aufmass
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufmass from cse_app, cse_anon, cse_checkin, cse_job;

-- aufmass_zeile (append): BAU-02, FIN-07. Die Zeile traegt den Rechenansatz WOERTLICH neben dem Ergebnis — genau das, was ein Pruefer nachrechnet. Sie lebt und stirbt mit ihrem Kopf, dessen Zustand sie kopiert traegt, und hat darum keine eigene Lebendigkeitsspalte.
create trigger trg_aufmass_zeile_kein_hard_delete
  before delete on aufmass_zeile
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufmass_zeile_kein_truncate
  before truncate on aufmass_zeile
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufmass_zeile from cse_app, cse_anon, cse_checkin, cse_job;

-- aufmass_foto (append): BAU-03, DOC-07. Ohne Messfoto wird kein Blatt vorgelegt; ein geloeschtes Foto nimmt der Feststellung nachtraeglich ihre Voraussetzung, waehrend das Blatt gegengezeichnet stehen bleibt.
create trigger trg_aufmass_foto_kein_hard_delete
  before delete on aufmass_foto
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufmass_foto_kein_truncate
  before truncate on aufmass_foto
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufmass_foto from cse_app, cse_anon, cse_checkin, cse_job;

-- aufmass_signatur (append): BAU-03, § 14 VOB/B. Die Unterschrift mit ihrem eingefrorenen Schnappschuss IST die Feststellung. Sie zu loeschen liesse ein Blatt zurueck, das gegengezeichnet heisst und niemanden nennt.
create trigger trg_aufmass_signatur_kein_hard_delete
  before delete on aufmass_signatur
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufmass_signatur_kein_truncate
  before truncate on aufmass_signatur
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufmass_signatur from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_aufmass_geaendert_am
  before update on aufmass
  for each row execute function kern.setze_geaendert_am();
create trigger trg_aufmass_zeile_geaendert_am
  before update on aufmass_zeile
  for each row execute function kern.setze_geaendert_am();

create trigger trg_aufmass_audit
  after insert or update or delete on aufmass
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0073)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- abwesenheit (archiv): EMP-10, LEG-09, Invariante 8. Dass jemand krank gemeldet war oder Urlaub hatte, ist die Grundlage von Lohnfortzahlung und Urlaubskonto — und im Streit die Tatsache selbst. Zurueckgenommen wird ueber `status = storniert`, nie durch DELETE.
create trigger trg_abwesenheit_kein_hard_delete
  before delete on abwesenheit
  for each row execute function kern.verhindere_loeschung();
create trigger trg_abwesenheit_kein_truncate
  before truncate on abwesenheit
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on abwesenheit from cse_app, cse_anon, cse_checkin, cse_job;

-- abwesenheitsart (archiv): EMP-05, ACC-12, K-17. Der Katalog traegt die Lohnwirkung; eine geloeschte Art nimmt jeder Abwesenheit, die auf sie zeigt, ihre Bedeutung. Ausser Gebrauch kommt sie ueber `archiviert_am`.
create trigger trg_abwesenheitsart_kein_hard_delete
  before delete on abwesenheitsart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_abwesenheitsart_kein_truncate
  before truncate on abwesenheitsart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on abwesenheitsart from cse_app, cse_anon, cse_checkin, cse_job;


create trigger trg_abwesenheit_audit
  after insert or update or delete on abwesenheit
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0074)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- antrag (archiv): EMP-10, NOT-01. Der Antrag ist der BELEG der Entscheidung: wer wann was beantragt und wer mit welchem Wort entschieden hat. Genau diese Spur verschwaende, wenn man ihn nach der Umsetzung aufraeumte.
create trigger trg_antrag_kein_hard_delete
  before delete on antrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_antrag_kein_truncate
  before truncate on antrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on antrag from cse_app, cse_anon, cse_checkin, cse_job;

-- antragsart (archiv): EMP-10, K-17. Wie `abwesenheitsart`: der Katalog gibt jedem Antrag seine Bedeutung, und die drei Systemarten aus EMP-10 sind nicht entfernbar.
create trigger trg_antragsart_kein_hard_delete
  before delete on antragsart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_antragsart_kein_truncate
  before truncate on antragsart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on antragsart from cse_app, cse_anon, cse_checkin, cse_job;


create trigger trg_antrag_audit
  after insert or update or delete on antrag
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0075)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- steuersatz_gruppe (archiv): K-21, §14 Abs. 4 Nr. 8 UStG. Der EINE Steuerkatalog der Plattform. Eine Zeile zu loeschen bricht den Fremdschluessel jeder Rechnungsposition, die auf sie zeigt — und die Rechnung selbst darf sich nicht mehr aendern. Ein Satz laeuft ueber `gueltig_bis` aus; eine Aenderung ist eine NEUE Zeile mit eigenem Gueltigkeitsbeginn.
create trigger trg_steuersatz_gruppe_kein_hard_delete
  before delete on steuersatz_gruppe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_steuersatz_gruppe_kein_truncate
  before truncate on steuersatz_gruppe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on steuersatz_gruppe from cse_app, cse_anon, cse_checkin, cse_job;

-- masseinheit (append): FIN-11, EN 16931 BT-130. Die Einheit einer festgeschriebenen Position wird beim Nachdrucken und beim Export gelesen. Faellt die Zeile weg, laesst sich dieselbe Rechnung nicht mehr zweimal gleich ausgeben.
create trigger trg_masseinheit_kein_hard_delete
  before delete on masseinheit
  for each row execute function kern.verhindere_loeschung();
create trigger trg_masseinheit_kein_truncate
  before truncate on masseinheit
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on masseinheit from cse_app, cse_anon, cse_checkin, cse_job;

-- kleinbetrag_grenze (archiv): FIN-13, §33 UStDV. `ist_kleinbetrag` wird gegen die Schwelle des LEISTUNGSDATUMS eingefroren. Die historische Zeile zu loeschen hiesse, die Entscheidung nicht mehr begruenden zu koennen.
create trigger trg_kleinbetrag_grenze_kein_hard_delete
  before delete on kleinbetrag_grenze
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kleinbetrag_grenze_kein_truncate
  before truncate on kleinbetrag_grenze
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kleinbetrag_grenze from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung (archiv): Invariante 4 und 8, §147 AO, §14b UStG. Eine festgeschriebene Rechnung wird durch STORNO aufgehoben, nie entfernt; ein verworfener Entwurf bekommt `verworfen_am` samt Grund und bleibt stehen — genau er ist die Zeile, die eine Betriebspruefung liest, wenn sie nach der fehlenden Nummer fragt.
create trigger trg_rechnung_kein_hard_delete
  before delete on rechnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_kein_truncate
  before truncate on rechnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnungsposition (append): FIN-01, §14 Abs. 4 Nr. 5 UStG. Die Position IST der Leistungsnachweis auf dem Beleg. Waere sie loeschbar, koennte eine festgeschriebene Rechnung nachtraeglich kuerzer werden, waehrend Kopfsummen und Hash unveraendert stehen bleiben.
create trigger trg_rechnungsposition_kein_hard_delete
  before delete on rechnungsposition
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnungsposition_kein_truncate
  before truncate on rechnungsposition
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnungsposition from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung_zuschlag (append): FIN-01, §10 UStG, EN 16931 BG-20/BG-21. Ein entfernter Nachlass veraendert die Bemessungsgrundlage einer Steuergruppe, ohne dass der Kopf es zeigt — und die Bemessungsgrundlage ist genau die Zahl, aus der die Voranmeldung ihre Steuer rechnet.
create trigger trg_rechnung_zuschlag_kein_hard_delete
  before delete on rechnung_zuschlag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_zuschlag_kein_truncate
  before truncate on rechnung_zuschlag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_zuschlag from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung_steuer (append): §14 Abs. 4 Nr. 8 UStG. Die Aufschluesselung nach Steuersaetzen ist der Teil des Belegs, den die Umsatzsteuervoranmeldung uebernimmt. Neu gerechnet wird im Entwurf durch UPSERT; eine Gruppe, die wegfaellt, faellt auf null statt aus der Tabelle.
create trigger trg_rechnung_steuer_kein_hard_delete
  before delete on rechnung_steuer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_steuer_kein_truncate
  before truncate on rechnung_steuer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_steuer from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung_beziehung (append): K-12, Invariante 4, §17 UStG. Sie IST die Storno-Rueckbeziehung — der einzige Ort, an dem steht, dass eine Rechnung aufgehoben wurde, und damit der Beleg fuer die Aenderung der Bemessungsgrundlage. Sie zu loeschen liesse die aufgehobene Rechnung wieder als gueltige dastehen.
create trigger trg_rechnung_beziehung_kein_hard_delete
  before delete on rechnung_beziehung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_beziehung_kein_truncate
  before truncate on rechnung_beziehung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_beziehung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_steuersatz_gruppe_geaendert_am
  before update on steuersatz_gruppe
  for each row execute function kern.setze_geaendert_am();
create trigger trg_masseinheit_geaendert_am
  before update on masseinheit
  for each row execute function kern.setze_geaendert_am();
create trigger trg_rechnung_geaendert_am
  before update on rechnung
  for each row execute function kern.setze_geaendert_am();
create trigger trg_rechnungsposition_geaendert_am
  before update on rechnungsposition
  for each row execute function kern.setze_geaendert_am();
create trigger trg_rechnung_zuschlag_geaendert_am
  before update on rechnung_zuschlag
  for each row execute function kern.setze_geaendert_am();
create trigger trg_rechnung_steuer_geaendert_am
  before update on rechnung_steuer
  for each row execute function kern.setze_geaendert_am();

create trigger trg_steuersatz_gruppe_audit
  after insert or update or delete on steuersatz_gruppe
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_masseinheit_audit
  after insert or update or delete on masseinheit
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_kleinbetrag_grenze_audit
  after insert or update or delete on kleinbetrag_grenze
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnung_audit
  after insert or update or delete on rechnung
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnungsposition_audit
  after insert or update or delete on rechnungsposition
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnung_zuschlag_audit
  after insert or update or delete on rechnung_zuschlag
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnung_steuer_audit
  after insert or update or delete on rechnung_steuer
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnung_beziehung_audit
  after insert or update or delete on rechnung_beziehung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0077)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- rechnung_snapshot (append): FIN-06, LEG-01, ACC-06. Der Snapshot IST das Dokument; PDF und XRechnung werden aus ihm erzeugt, nie aus lebenden Stammdaten. Ohne ihn verifiziert die Kette gegen nichts.
create trigger trg_rechnung_snapshot_kein_hard_delete
  before delete on rechnung_snapshot
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_snapshot_kein_truncate
  before truncate on rechnung_snapshot
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_snapshot from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung_hash (append): FIN-06, LEG-01. Ein fehlendes Glied ist genau die Manipulation, gegen die die Kette geschrieben ist. Eine geleerte Kettentabelle laesst den naechtlichen Lauf eine LEERE Kette melden statt einer gebrochenen — und das liest sich wie „nichts zu pruefen".
create trigger trg_rechnung_hash_kein_hard_delete
  before delete on rechnung_hash
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_hash_kein_truncate
  before truncate on rechnung_hash
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_hash from cse_app, cse_anon, cse_checkin, cse_job;


create trigger trg_rechnung_hash_audit
  after insert or update or delete on rechnung_hash
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0078)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- dienstanweisung (archiv): SEC-06, LEG-04. Der Kopf ist der Bezug, auf den jede Fassung und jede Kenntnisnahme zeigt. Geloescht steht die Bestaetigung einer Wache vor einem Regelwerk, das es angeblich nie gab. Eine ausser Kraft gesetzte Anweisung bekommt `archiviert_am`.
create trigger trg_dienstanweisung_kein_hard_delete
  before delete on dienstanweisung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dienstanweisung_kein_truncate
  before truncate on dienstanweisung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dienstanweisung from cse_app, cse_anon, cse_checkin, cse_job;

-- dienstanweisung_version (append): SEC-06, LEG-04, DOC-05. Die Fassung IST der Text, gegen den bestaetigt wurde — `da_kenntnisnahme.bestaetigter_inhalt_hash` ist ihr Digest. Ohne die Zeile laesst sich nicht mehr zeigen, WAS gelesen wurde, und die Kenntnisnahme wird zur Behauptung. Eine Aenderung ist eine neue Fassung.
create trigger trg_dienstanweisung_version_kein_hard_delete
  before delete on dienstanweisung_version
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dienstanweisung_version_kein_truncate
  before truncate on dienstanweisung_version
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dienstanweisung_version from cse_app, cse_anon, cse_checkin, cse_job;

-- da_pflicht (archiv): SEC-06, LEG-04. „Diese Person musste die Anweisung kennen" ist die Auskunft, nicht ihr Fehlen: eine geloeschte Pflichtzeile macht aus einer nicht bestaetigten Anweisung eine, die niemanden betraf. Eine beendete Pflicht bekommt `entfallen_am` und bleibt stehen.
create trigger trg_da_pflicht_kein_hard_delete
  before delete on da_pflicht
  for each row execute function kern.verhindere_loeschung();
create trigger trg_da_pflicht_kein_truncate
  before truncate on da_pflicht
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on da_pflicht from cse_app, cse_anon, cse_checkin, cse_job;

-- da_kenntnisnahme (append): SEC-06, EMP-09, LEG-04. Im Haftungsfall der einzige Beleg, dass die Unterweisung stattgefunden hat — mit Serverzeit, Person und dem Digest des bestaetigten Textes. Ein Irrtum wird durch eine neue Fassung ueberholt, nicht durch Loeschen.
create trigger trg_da_kenntnisnahme_kein_hard_delete
  before delete on da_kenntnisnahme
  for each row execute function kern.verhindere_loeschung();
create trigger trg_da_kenntnisnahme_kein_truncate
  before truncate on da_kenntnisnahme
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on da_kenntnisnahme from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_dienstanweisung_geaendert_am
  before update on dienstanweisung
  for each row execute function kern.setze_geaendert_am();
create trigger trg_da_pflicht_geaendert_am
  before update on da_pflicht
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0079)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- schluesselart (archiv): SEC-07. Der Katalog ist der Bezug jedes Schluessels; geloescht traegt eine zehn Jahre alte Quittung eine Art, die niemand mehr aufloesen kann. Eine nicht mehr gefuehrte Art bekommt `archiviert_am`.
create trigger trg_schluesselart_kein_hard_delete
  before delete on schluesselart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_schluesselart_kein_truncate
  before truncate on schluesselart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on schluesselart from cse_app, cse_anon, cse_checkin, cse_job;

-- schluessel (archiv): SEC-07, LEG-01. Am Schluessel haengt sein Journal. Ihn zu loeschen nimmt dem Journal seinen Gegenstand und macht die Frage „wer hatte Zutritt" unbeantwortbar — die erste Frage nach einem Einbruch. Ein ausgemusterter Schluessel bekommt `archiviert_am` oder eine Vernichtungszeile.
create trigger trg_schluessel_kein_hard_delete
  before delete on schluessel
  for each row execute function kern.verhindere_loeschung();
create trigger trg_schluessel_kein_truncate
  before truncate on schluessel
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on schluessel from cse_app, cse_anon, cse_checkin, cse_job;

-- schluessel_quittung (append): SEC-07, LEG-01. Das Journal ist der Nachweis der Schluesselgewalt und die Grundlage jeder Haftungsfrage nach einem Schliessanlagenaustausch. Eine loeschbare Quittung heisst, dass sich „wer hatte den Schluessel" nachtraeglich umschreiben laesst. Richtiggestellt wird durch eine Gegenquittung.
create trigger trg_schluessel_quittung_kein_hard_delete
  before delete on schluessel_quittung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_schluessel_quittung_kein_truncate
  before truncate on schluessel_quittung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on schluessel_quittung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_schluesselart_geaendert_am
  before update on schluesselart
  for each row execute function kern.setze_geaendert_am();
create trigger trg_schluessel_geaendert_am
  before update on schluessel
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0080)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- nachtrag_grundlage (archiv): BAU-04, K-17. Die Zeile ist die Anspruchsgrundlage, unter der ein Nachtrag angemeldet wurde — im Streit um § 2 VOB/B die Frage selbst. Geloescht bliebe der Nachtrag stehen und niemand wuesste mehr, worauf er gestuetzt war; abgeloest wird sie durch archiviert_am.
create trigger trg_nachtrag_grundlage_kein_hard_delete
  before delete on nachtrag_grundlage
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachtrag_grundlage_kein_truncate
  before truncate on nachtrag_grundlage
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachtrag_grundlage from cse_app, cse_anon, cse_checkin, cse_job;

-- nachtrag (archiv): BAU-04, BAU-05, FIN-07, LEG-01. Am Nachtrag haengen die Ankuendigung (§ 2 Abs. 6 Nr. 1 VOB/B), die eingereichte Kalkulation und spaeter eine Rechnungsposition. Ein zurueckgezogener wird storniert und durch ersetzt_durch_id abgeloest — geloescht fehlte im Werklohnprozess der Beleg, dass rechtzeitig angekuendigt wurde.
create trigger trg_nachtrag_kein_hard_delete
  before delete on nachtrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachtrag_kein_truncate
  before truncate on nachtrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachtrag from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_nachtrag_grundlage_geaendert_am
  before update on nachtrag_grundlage
  for each row execute function kern.setze_geaendert_am();
create trigger trg_nachtrag_geaendert_am
  before update on nachtrag
  for each row execute function kern.setze_geaendert_am();

create trigger trg_nachtrag_grundlage_audit
  after insert or update or delete on nachtrag_grundlage
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_nachtrag_audit
  after insert or update or delete on nachtrag
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0081)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- behinderung_vorlage (archiv): BAU-06, LEG-01. Die Vorlage ist der Wortlaut, in dem eine hinausgegangene Rechtserklaerung abgefasst wurde. Geloescht liesse sich nicht mehr zeigen, welcher Text damals galt; eine ueberholte bekommt archiviert_am.
create trigger trg_behinderung_vorlage_kein_hard_delete
  before delete on behinderung_vorlage
  for each row execute function kern.verhindere_loeschung();
create trigger trg_behinderung_vorlage_kein_truncate
  before truncate on behinderung_vorlage
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on behinderung_vorlage from cse_app, cse_anon, cse_checkin, cse_job;

-- behinderung (archiv): BAU-06, § 6 VOB/B, LEG-01. Die angezeigte Behinderung ist eine empfangsbeduerftige Erklaerung mit anspruchswahrender Wirkung — sie entscheidet ueber Bauzeitverlaengerung und Schadensersatz. Korrigiert wird durch Storno und eine neue Anzeige, nie durch Entfernen.
create trigger trg_behinderung_kein_hard_delete
  before delete on behinderung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_behinderung_kein_truncate
  before truncate on behinderung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on behinderung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_behinderung_vorlage_geaendert_am
  before update on behinderung_vorlage
  for each row execute function kern.setze_geaendert_am();
create trigger trg_behinderung_geaendert_am
  before update on behinderung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_behinderung_vorlage_audit
  after insert or update or delete on behinderung_vorlage
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_behinderung_audit
  after insert or update or delete on behinderung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0082)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- gewerk (archiv): BAU-07, REP-05. Der Katalogeintrag ist der Bezug jeder Mannstundenzeile. Geloescht traegt eine abgeschlossene Tagesseite eine Gewerkekennung, zu der es nichts mehr gibt — und die Auswertung „Stunden je Gewerk" verliert rueckwirkend Zeilen. Ein aufgegebenes Gewerk bekommt archiviert_am und verschwindet aus der Auswahl, nicht aus der Historie.
create trigger trg_gewerk_kein_hard_delete
  before delete on gewerk
  for each row execute function kern.verhindere_loeschung();
create trigger trg_gewerk_kein_truncate
  before truncate on gewerk
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on gewerk from cse_app, cse_anon, cse_checkin, cse_job;

-- bautagebuch (archiv): BAU-07, LEG-01. Der Bautag traegt Bauzeit, Behinderung und Mehrverguetungsanspruch. Ein abgeschlossener Tag ist unveraenderlich; korrigiert wird durch Storno und einen Ersatztag (ersetzt_durch_id). Geloescht bliebe eine Luecke in der Bauzeit, die niemand mehr erklaeren kann — und genau daraus wird im Prozess ein Anspruch hergeleitet.
create trigger trg_bautagebuch_kein_hard_delete
  before delete on bautagebuch
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bautagebuch_kein_truncate
  before truncate on bautagebuch
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bautagebuch from cse_app, cse_anon, cse_checkin, cse_job;

-- bautagebuch_mannstunden (append): BAU-07, TIM-12, REP-05. Die Zeile IST die Mannstundenangabe des Tages — die Zahl, gegen die der Abgleich mit dem zeiteintrag laeuft und aus der ein Bauzeitnachtrag gerechnet wird. Sie ist anfuegend: eine falsche Zeile wird storniert und ersetzt, damit sichtbar bleibt, dass zuerst etwas anderes dastand.
create trigger trg_bautagebuch_mannstunden_kein_hard_delete
  before delete on bautagebuch_mannstunden
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bautagebuch_mannstunden_kein_truncate
  before truncate on bautagebuch_mannstunden
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bautagebuch_mannstunden from cse_app, cse_anon, cse_checkin, cse_job;

-- bautagebuch_position (append): BAU-07, LEG-01. Geraet, Lieferung und Vorkommnis des Tages. Ein geloeschtes Vorkommnis ist genau die Seite, die im Streit fehlt; eine irrtuemliche Zeile wird storniert und ersetzt.
create trigger trg_bautagebuch_position_kein_hard_delete
  before delete on bautagebuch_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bautagebuch_position_kein_truncate
  before truncate on bautagebuch_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bautagebuch_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_gewerk_geaendert_am
  before update on gewerk
  for each row execute function kern.setze_geaendert_am();
create trigger trg_bautagebuch_geaendert_am
  before update on bautagebuch
  for each row execute function kern.setze_geaendert_am();

create trigger trg_bautagebuch_audit
  after insert or update or delete on bautagebuch
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0083)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- wetter_station (archiv): BAU-08. An der Station haengt jede Beobachtung, und an der Beobachtung der Wetterbeleg eines Bautags. Eine stillgelegte Station bekommt archiviert_am — geloescht verloeren alle Tage, die auf sie zeigen, ihren Messort, und „3 °C" ohne Ort ist keine Aussage.
create trigger trg_wetter_station_kein_hard_delete
  before delete on wetter_station
  for each row execute function kern.verhindere_loeschung();
create trigger trg_wetter_station_kein_truncate
  before truncate on wetter_station
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on wetter_station from cse_app, cse_anon, cse_checkin, cse_job;

-- wetter_beobachtung (append): BAU-07, BAU-08, LEG-01. Die Messung, auf die sich ein Bautagebuch beruft. Der DWD revidiert Werte — eine Revision ist eine NEUE Zeile mit hoeherem Qualitaetsniveau, nie ein Ersetzen der alten. Geloescht zeigte der Tag auf nichts, und der Schnappschuss daneben liesse sich nicht mehr gegenpruefen.
create trigger trg_wetter_beobachtung_kein_hard_delete
  before delete on wetter_beobachtung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_wetter_beobachtung_kein_truncate
  before truncate on wetter_beobachtung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on wetter_beobachtung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_wetter_station_geaendert_am
  before update on wetter_station
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0105)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- vertrag_abrechnung (archiv): FIN-01, FIN-06, K-12. Die Zeile ist die Grundlage, auf der eine festgeschriebene und gehashte Rechnung entstanden ist. Geloescht liesse sich ein vergangener Abrechnungszeitraum nicht mehr rekonstruieren — eine dauerhafte Luecke im Pruefpfad. Abgeloest wird sie durch gueltig_bis, nie durch DELETE.
create trigger trg_vertrag_abrechnung_kein_hard_delete
  before delete on vertrag_abrechnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_vertrag_abrechnung_kein_truncate
  before truncate on vertrag_abrechnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on vertrag_abrechnung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_vertrag_abrechnung_geaendert_am
  before update on vertrag_abrechnung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_vertrag_abrechnung_audit
  after insert or update or delete on vertrag_abrechnung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0107)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- rechnungsposition_quelle (archiv): FIN-07, §4.4, Invariante 8. Sie IST der Beleg, dass eine abgerechnete Stunde abgerechnet ist. Waere sie loeschbar, liesse sich die Doppelabrechnungssperre durch ein DELETE aufheben — und derselbe Zeiteintrag stuende auf zwei Rechnungen, ohne dass irgendwo eine Zeile fehlte. Ein erloschener Anspruch faellt auf `wirksam = false` und bleibt stehen.
create trigger trg_rechnungsposition_quelle_kein_hard_delete
  before delete on rechnungsposition_quelle
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnungsposition_quelle_kein_truncate
  before truncate on rechnungsposition_quelle
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnungsposition_quelle from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_rechnungsposition_quelle_geaendert_am
  before update on rechnungsposition_quelle
  for each row execute function kern.setze_geaendert_am();

create trigger trg_rechnungsposition_quelle_audit
  after insert or update or delete on rechnungsposition_quelle
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0117)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- abschlagsrechnung_bezug (archiv): FIN-08, §14 Abs. 4 Nr. 8 UStG, LEG-01. Sie IST der Nachweis, welcher Abschlag auf welcher Schlussrechnung mit welchem Betrag je Steuergruppe abgezogen wurde. Sie zu loeschen liesse denselben Abschlag ein zweites Mal abziehbar erscheinen — und der Kunde zahlte zweimal oder gar nicht. Zurueckgenommen wird ueber `wirksam`: der Zustand aendert sich, die Zeile bleibt.
create trigger trg_abschlagsrechnung_bezug_kein_hard_delete
  before delete on abschlagsrechnung_bezug
  for each row execute function kern.verhindere_loeschung();
create trigger trg_abschlagsrechnung_bezug_kein_truncate
  before truncate on abschlagsrechnung_bezug
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on abschlagsrechnung_bezug from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0118)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- kunde_bauleistender_status (archiv): FIN-09, LEG-06, §13b UStG. Sie ist der datierte Nachweis, auf den sich eine Verlagerung der Steuerschuld stuetzt — und der Zeitraum, in dem sie galt, ist die Begruendung jeder Rechnung aus dieser Zeit. Wer sie loescht, nimmt einer festgeschriebenen Rechnung nachtraeglich ihre Grundlage, und der Leistende schuldet die Steuer, ohne sie eingenommen zu haben (§13a UStG). Beendet wird ein Status durch `gilt_bis`, wie bei `kleinbetrag_grenze` — eine neue Lage ist eine neue Zeile.
create trigger trg_kunde_bauleistender_status_kein_hard_delete
  before delete on kunde_bauleistender_status
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kunde_bauleistender_status_kein_truncate
  before truncate on kunde_bauleistender_status
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kunde_bauleistender_status from cse_app, cse_anon, cse_checkin, cse_job;

-- freistellungsbescheinigung (archiv): FIN-10, LEG-06, §48b EStG. Ohne sie haette einbehalten werden muessen; mit ihr durfte ausgezahlt werden. Sie ist damit der Beleg dafuer, dass die Gruppe ihrer Einbehaltungspflicht genuegt hat — und die Haftung nach §48a Abs. 3 EStG haengt genau daran. Ein Widerruf setzt `widerrufen_am`; die Bescheinigung bleibt stehen, weil sie fuer die Zeit davor weiter gilt.
create trigger trg_freistellungsbescheinigung_kein_hard_delete
  before delete on freistellungsbescheinigung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_freistellungsbescheinigung_kein_truncate
  before truncate on freistellungsbescheinigung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on freistellungsbescheinigung from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0121)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- bankkonto (archiv): ACC-01, ACC-04, FIN-11, K-12. Die IBAN und der Kontoinhaber stehen im Snapshot jeder Rechnung, die dieses Konto genannt hat, und in der XRechnung (BT-84, BT-85). Das Konto zu loeschen liesse die Belege auf einen Empfaenger zeigen, den es nie gab — und der Bankimport (PR 61) ordnet einen Auszug ueber die IBAN zu. Ein geschlossenes Konto traegt `archiviert_am`; seine IBAN wird damit wieder verwendbar.
create trigger trg_bankkonto_kein_hard_delete
  before delete on bankkonto
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bankkonto_kein_truncate
  before truncate on bankkonto
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bankkonto from cse_app, cse_anon, cse_checkin, cse_job;

-- kasse (archiv): FIN-14, ACC-06, GoBD. An der Kasse haengen Barzahlungen und spaeter das Kassenbuch mit fortgeschriebenem Bestand. Eine geloeschte Kasse nimmt den Bewegungen ihren Ort und macht die Kassensturzfaehigkeit unpruefbar. Aufgeloest wird sie ueber `archiviert_am`.
create trigger trg_kasse_kein_hard_delete
  before delete on kasse
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kasse_kein_truncate
  before truncate on kasse
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kasse from cse_app, cse_anon, cse_checkin, cse_job;

-- zahlung (archiv): FIN-14, ACC-04, ACC-07, Invariante 8. Sie ist der Nachweis, dass Geld geflossen ist — und die Gegenprobe zu jedem ausgeglichenen Posten. Eine geloeschte Zahlung liesse eine bezahlte Forderung als bezahlt stehen, ohne dass irgendwo stuende, wodurch. Zurueckgenommen wird ueber `storniert_am`, und der Ausloeser gibt die Posten wieder frei.
create trigger trg_zahlung_kein_hard_delete
  before delete on zahlung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zahlung_kein_truncate
  before truncate on zahlung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zahlung from cse_app, cse_anon, cse_checkin, cse_job;

-- offener_posten (archiv): ACC-07, FIN-15, FIN-17. Die Zeile traegt, was gemahnt wurde und wann — der Mahnlauf und die Altersliste lesen genau das. Sie zu loeschen entfernte eine Forderung aus jeder Auswertung, ohne dass ein Beleg sich aendert: die Rechnung stuende weiter im Ausgangsbuch, aber niemand erwartete noch Geld dafuer. Abgeschlossen wird ueber `ausgeglichen_am`.
create trigger trg_offener_posten_kein_hard_delete
  before delete on offener_posten
  for each row execute function kern.verhindere_loeschung();
create trigger trg_offener_posten_kein_truncate
  before truncate on offener_posten
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on offener_posten from cse_app, cse_anon, cse_checkin, cse_job;

-- zahlung_zuordnung (append): FIN-14, ACC-04, ACC-07, §146 Abs. 4 AO. Jede Zeile ist eine Buchung: wieviel dieser Zahlung auf welchen Posten entfaellt, und warum (Skonto, Bauabzugsteuer, abgeschriebene Differenz). Sie zu loeschen aenderte den Stand eines Postens ohne Spur. Eine falsche Zuordnung wird zurueckgenommen, indem die ZAHLUNG storniert wird.
create trigger trg_zahlung_zuordnung_kein_hard_delete
  before delete on zahlung_zuordnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zahlung_zuordnung_kein_truncate
  before truncate on zahlung_zuordnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zahlung_zuordnung from cse_app, cse_anon, cse_checkin, cse_job;

-- op_ausgleich (append): FIN-15, ACC-07, §14 UStG (Invariante 4). Der Ausgleich ist der Vorgang, der eine stornierte Rechnung und ihre Gutschrift gegeneinander schliesst, ohne eine Zahlung zu erfinden. Ihn zu loeschen oeffnete beide Posten wieder und liesse die Wache eine stornierte Rechnung anmahnen.
create trigger trg_op_ausgleich_kein_hard_delete
  before delete on op_ausgleich
  for each row execute function kern.verhindere_loeschung();
create trigger trg_op_ausgleich_kein_truncate
  before truncate on op_ausgleich
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on op_ausgleich from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0123)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- lieferant (archiv): FIN-14, ACC-05, ACC-07, §147 AO. Am Lieferanten haengen Eingangsrechnungen mit zehnjaehriger Aufbewahrung und der §48-EStG-Nachweis, wem gegenueber einbehalten wurde. Ihn zu loeschen macht jede Buchung darauf unlesbar; Art. 17 DSGVO wird bei einer natuerlichen Person ueber `anonymisiert_am` erfuellt, aufgeloest wird ueber `archiviert_am`.
create trigger trg_lieferant_kein_hard_delete
  before delete on lieferant
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lieferant_kein_truncate
  before truncate on lieferant
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lieferant from cse_app, cse_anon, cse_checkin, cse_job;

-- beleg (archiv): ACC-03, ACC-06, DOC-08, LEG-01, GoBD. Der Beleg IST der Nachweis zur Buchung — er nennt die Dokumentversion und ihren SHA-256. Ihn zu loeschen liesse eine Buchung ohne Beleg zurueck, und genau das ist der Mangel, den eine Betriebspruefung zuerst feststellt. Das Ausscheiden nach Fristablauf laeuft ueber `aufbewahrung_bis` und `loeschsperre`.
create trigger trg_beleg_kein_hard_delete
  before delete on beleg
  for each row execute function kern.verhindere_loeschung();
create trigger trg_beleg_kein_truncate
  before truncate on beleg
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on beleg from cse_app, cse_anon, cse_checkin, cse_job;

-- eingangsrechnung (archiv): FIN-14, ACC-05, ACC-06, LEG-01, §14b UStG. Sie traegt den Vorsteuerabzug und den §48-EStG-Einbehalt. Eine geloeschte Eingangsrechnung nimmt der Voranmeldung ihre Grundlage, und die interne Belegnummer hinterliesse eine Luecke in einem lueckenlosen Kreis. Zurueckgewiesen wird ueber `abgelehnt` mit Grund.
create trigger trg_eingangsrechnung_kein_hard_delete
  before delete on eingangsrechnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_eingangsrechnung_kein_truncate
  before truncate on eingangsrechnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on eingangsrechnung from cse_app, cse_anon, cse_checkin, cse_job;

-- eingangsrechnung_steuer (append): FIN-14, ACC-08, §15 UStG. Die Aufteilung nach Steuersaetzen IST der Vorsteuerabzug — ohne sie steht ein Bruttobetrag da, aus dem sich kein Satz mehr ableiten laesst. Sie zu loeschen aenderte die Voranmeldung ohne Spur.
create trigger trg_eingangsrechnung_steuer_kein_hard_delete
  before delete on eingangsrechnung_steuer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_eingangsrechnung_steuer_kein_truncate
  before truncate on eingangsrechnung_steuer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on eingangsrechnung_steuer from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0125)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- mahnstufe (archiv): FIN-15, §288 BGB. Die Stufe traegt Gebuehr, Zinsart und Frist — also die Grundlage jedes Betrags, der je auf einer Mahnung stand. Sie zu loeschen nimmt einem versendeten Brief seine Herleitung. Abgeloest wird ueber `gueltig_bis`.
create trigger trg_mahnstufe_kein_hard_delete
  before delete on mahnstufe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mahnstufe_kein_truncate
  before truncate on mahnstufe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mahnstufe from cse_app, cse_anon, cse_checkin, cse_job;

-- mahnung (archiv): FIN-15, ACC-07, §286 BGB, LEG-01. Sie IST die Mahnung — der Vorgang, an den der Verzug und damit der Zinsanspruch anknuepft. Ein geloeschter Brief laesst die naechste Stufe ohne Grundlage und den Zinsanspruch ohne Beleg. Nicht Versendetes wird ueber `verworfen` mit Grund beendet.
create trigger trg_mahnung_kein_hard_delete
  before delete on mahnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mahnung_kein_truncate
  before truncate on mahnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mahnung from cse_app, cse_anon, cse_checkin, cse_job;

-- mahnung_position (append): FIN-15, §288 BGB. Die Zeile traegt, WIE der Zins hergeleitet wurde: Verzugsbeginn, angewandte Regel, Tageszaehlung, Tage und Satz. Sie zu loeschen laesst einen geforderten Betrag ohne Rechenweg zurueck — und genau danach fragt der Anwalt des Empfaengers.
create trigger trg_mahnung_position_kein_hard_delete
  before delete on mahnung_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mahnung_position_kein_truncate
  before truncate on mahnung_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mahnung_position from cse_app, cse_anon, cse_checkin, cse_job;

-- mahnung_eskalation (archiv): FIN-15, APR-07, LEG-12. Eine Inkasso-Uebergabe oder ein Mahnbescheid beruehrt gegenueber einer natuerlichen Person Art. 22 DSGVO; die Zeile ist der Nachweis, WER sie freigegeben hat. Zurueckgenommen wird ueber `widerrufen_am`.
create trigger trg_mahnung_eskalation_kein_hard_delete
  before delete on mahnung_eskalation
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mahnung_eskalation_kein_truncate
  before truncate on mahnung_eskalation
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mahnung_eskalation from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0126)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- konto_mapping (archiv): ACC-01. Eine geloeschte Kontenzuordnung macht jede Buchung, die auf ihr beruht, unerklaerlich: das Konto steht im buchungssatz, der Grund ist fort. Geschlossen wird mit gueltig_bis.
create trigger trg_konto_mapping_kein_hard_delete
  before delete on konto_mapping
  for each row execute function kern.verhindere_loeschung();
create trigger trg_konto_mapping_kein_truncate
  before truncate on konto_mapping
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on konto_mapping from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0127)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- periode (archiv): ACC-08, LEG-01. Ein geloeschter Buchungsmonat nimmt die Festschreibung mit, die ihn abgeschlossen hat — und die Monatszahlen, die der Steuerberater bereits bekommen hat.
create trigger trg_periode_kein_hard_delete
  before delete on periode
  for each row execute function kern.verhindere_loeschung();
create trigger trg_periode_kein_truncate
  before truncate on periode
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on periode from cse_app, cse_anon, cse_checkin, cse_job;

-- buchungssatz (archiv): ACC-01, ACC-06, GoBD. Die Buchungszeile IST der Nachweis. Korrigiert wird durch Gegenbuchung (storniert_durch_id), nie durch Loeschen.
create trigger trg_buchungssatz_kein_hard_delete
  before delete on buchungssatz
  for each row execute function kern.verhindere_loeschung();
create trigger trg_buchungssatz_kein_truncate
  before truncate on buchungssatz
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on buchungssatz from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0128)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- agent_aufgabe (archiv): AGT-04. Was ein Agent getan hat, ist die Antwort auf die Frage, warum etwas im System steht. Eine geloeschte Aufgabe nimmt ihre Schritte mit — und damit die Begruendung eines Entwurfs, den ein Mensch freigegeben hat. Beendet wird mit status, nie durch Loeschen.
create trigger trg_agent_aufgabe_kein_hard_delete
  before delete on agent_aufgabe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_aufgabe_kein_truncate
  before truncate on agent_aufgabe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_aufgabe from cse_app, cse_anon, cse_checkin, cse_job;

-- agent_schritt (append): AGT-04, LEG-09. Das Schrittprotokoll ist der Nachweis, WAS der Agent gelesen und WAS er einem Modell geschickt hat. Die einzige erlaubte Aenderung ist die Schwaerzung der Nutzlast nach Frist — sie leert Spalten und entfernt keine Zeile.
create trigger trg_agent_schritt_kein_hard_delete
  before delete on agent_schritt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_schritt_kein_truncate
  before truncate on agent_schritt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_schritt from cse_app, cse_anon, cse_checkin, cse_job;

-- agent_kosten (append): AGT-05. Die Kostenzeilen SIND das Monatsbudget: der Verbrauch ist ihre Summe. Eine geloeschte Zeile senkt den Verbrauch und hebt damit ruecklaufend eine Obergrenze auf, die bereits gegriffen hat. Korrigiert wird durch eine zweite Zeile.
create trigger trg_agent_kosten_kein_hard_delete
  before delete on agent_kosten
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_kosten_kein_truncate
  before truncate on agent_kosten
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_kosten from cse_app, cse_anon, cse_checkin, cse_job;

-- agent_budget (archiv): AGT-05. Die Budgetzeile traegt die Obergrenze UND den Nachweis, dass und wann gestoppt wurde (gestoppt_am). Sie zu loeschen loescht beides und laesst die Agenten im naechsten Aufruf weiterlaufen, als waere nichts gewesen.
create trigger trg_agent_budget_kein_hard_delete
  before delete on agent_budget
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_budget_kein_truncate
  before truncate on agent_budget
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_budget from cse_app, cse_anon, cse_checkin, cse_job;

-- agent_reservierung (archiv): AGT-05. Eine Reservierung ist gebundenes Budget. Wird die Zeile geloescht statt freigegeben, bleibt der Zaehler in agent_budget gebunden und niemand kann mehr sehen, wofuer — geschlossen wird mit freigegeben_am und freigabe_grund.
create trigger trg_agent_reservierung_kein_hard_delete
  before delete on agent_reservierung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_reservierung_kein_truncate
  before truncate on agent_reservierung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_reservierung from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
