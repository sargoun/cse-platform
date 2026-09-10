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
