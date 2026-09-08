-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern
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
