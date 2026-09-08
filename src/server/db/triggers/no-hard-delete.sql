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
