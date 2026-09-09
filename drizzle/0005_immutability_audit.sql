-- 0005 — Unveränderbarkeit, Soft-Delete, Audit-Trigger (invariant 8, SEC-A9, LEG-01).
--
-- Three mechanisms and one hole closed:
--
--   kern.verhindere_loeschung()    a BEFORE DELETE that raises — one name,
--                                  platform-wide (K-21)
--   kern.setze_geaendert_am()      S2, so `geaendert_am` is never the caller's
--                                  to write
--   kern.protokolliere_aenderung() the audit trigger, writing through
--                                  app.protokolliere and nothing else
--
-- The hole: 0004 granted `select` on `audit_log` table-wide. Before this
-- migration that leaked nothing, because no trigger wrote a payload. From here
-- on `vorher`/`nachher` carry the changed values themselves — including
-- `stundensatz_intern`, which K-05 spends an explicit column-list grant on
-- `anstellung` to withhold. A table-wide grant on `audit_log` would hand the
-- same number back through the audit trail one statement later. Closed below.

-- ---------------------------------------------------------------------------
-- The trigger functions.
-- ---------------------------------------------------------------------------

/**
 * S2 — `geaendert_am` is set by the database, never by the caller.
 *
 * A client-supplied modification timestamp is a client-supplied fact about
 * when something happened, which invariant 5 rules out for time entries and
 * which is no more trustworthy here.
 */
create function kern.setze_geaendert_am() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.geaendert_am := now();
  return new;
end $$;

comment on function kern.setze_geaendert_am() is
  'S2 (K-16): setzt geaendert_am serverseitig. Vom Aufrufer gelieferte Werte werden überschrieben.';

/**
 * Invariant 8 — no hard deletes.
 *
 * Two independent barriers stand in front of every registered table and this
 * is the second of them. The first is privilege and policy: the application
 * roles hold no `DELETE`, and under FORCE RLS a table with no `DELETE` policy
 * admits no row — but that first barrier fails *quietly*, as `DELETE 0`. A
 * maintenance session, a restore, a superuser at a psql prompt: those reach
 * the rows, and this is what stops them, loudly.
 */
create function kern.verhindere_loeschung() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception
    'Hard delete auf %.% ist gesperrt (Invariante 8, K-16).',
      tg_table_schema, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Registriert in src/server/db/schema/rls.ts. Je nach Tabelle: '
                 'geloescht_am setzen (soft), archiviert_am/storniert_am setzen '
                 '(archiv), oder gar nicht (append-only).';
end $$;

comment on function kern.verhindere_loeschung() is
  'BEFORE DELETE. Invariante 8 — plattformweit ein Name (K-21), Registry in schema/rls.ts.';

/**
 * SEC-A9 — every write to a registered table lands in `audit_log`.
 *
 * Written through `app.protokolliere` and never with a direct INSERT: the
 * audit trail has exactly one writer, and a trigger that inserts on its own
 * would be a second one with its own idea of what a row looks like.
 *
 * The tenant comes from the ROW where the row carries one, not from the
 * session. A group-scope write and a mandant-scope write to the same row must
 * be attributed to the same mandant, and only the row knows which that is.
 * Where the row carries no `mandant_id` — `person` is the case, by
 * construction (D-09) — `app.protokolliere` falls back to the session and, in
 * a scope with no single mandant, records a platform-level row (K-16(d)).
 */
create function kern.protokolliere_aenderung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_vorher  jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_nachher jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_zeile   jsonb := coalesce(v_nachher, v_vorher);
  v_mandant uuid  := nullif(v_zeile ->> 'mandant_id', '')::uuid;
begin
  -- `mandant` IS the tenant; its own id is the tenant the row belongs to.
  if tg_table_name = 'mandant' then
    v_mandant := nullif(v_zeile ->> 'id', '')::uuid;
  end if;

  perform app.protokolliere(
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_zeile ->> 'id',
    v_vorher,
    v_nachher,
    v_mandant
  );
  return null;   -- AFTER trigger: the return value is ignored.
end $$;

comment on function kern.protokolliere_aenderung() is
  'AFTER INSERT/UPDATE/DELETE. Schreibt ausschließlich über app.protokolliere (SEC-A9).';

-- ---------------------------------------------------------------------------
-- K-19 — the rights interface, failing closed until PR 6 seeds the catalogue.
-- ---------------------------------------------------------------------------

/**
 * `app.hat_recht` is the one gate every right-checked accessor calls.
 *
 * The catalogue (`berechtigung`, `rolle_berechtigung`, `benutzer`) lands with
 * PR 6. Until then this returns **false for every key**, which is not a stub
 * standing in for the real answer — it IS the answer D-17 requires: an
 * unregistered right key is permanent, silent denial. A version returning
 * `true` while the catalogue is missing would make every accessor behind it
 * open, and the day the catalogue arrived would be the day the platform
 * quietly narrowed. Failing closed makes the missing catalogue visible as an
 * empty screen instead.
 */
create function app.hat_recht(p_schluessel text) returns boolean
language sql stable as $$
  -- Replaced in PR 6 by the lookup against the seeded catalogue. No client
  -- question here: what the catalogue contains is settled in 03-AUTH §12.
  select false
$$;

comment on function app.hat_recht(text) is
  'K-19/D-17: unbekannter Rechteschlüssel = dauerhafte, stille Verweigerung. '
  'Der Katalog kommt mit PR 6; bis dahin ist jede Antwort false — fail closed.';

-- ---------------------------------------------------------------------------
-- The audit payload is restricted, not omitted (05-API-KARTE §B).
-- ---------------------------------------------------------------------------

/**
 * Omitting `stundensatz_intern`, `geburtsdatum` and absence reasons from
 * `vorher`/`nachher` would make a wage-rate change unreconstructable, which is
 * the opposite of what SEC-A9 and a wage dispute need. So the values ARE
 * written — and the read is restricted instead.
 *
 * The same Postgres fact as K-05 applies: a table-wide `GRANT SELECT` followed
 * by `REVOKE SELECT (spalte)` changes nothing. `vorher` and `nachher` have to
 * be left out of the grant in the first place.
 */
revoke select on audit_log from cse_app;

grant select (
  id, mandant_id, ebene, akteur_typ, akteur_id, agent_id, aktion,
  objekt_typ, objekt_id, geaendert_felder, ip, sitzung_id, erstellt_am
) on audit_log to cse_app;

/**
 * The full payload, behind `system.audit_sensitiv_lesen`.
 *
 * Definer, so it is not subject to the column grant above — and therefore it
 * repeats the tenant predicate of `t_audit_lesen`, which no longer applies to
 * it. While the catalogue is missing this returns NULL to everyone (K-19),
 * so the trail is readable and its values are not.
 */
create function app.audit_nutzlast_lesen(p_audit bigint)
  returns table (vorher jsonb, nachher jsonb)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid; v_ebene audit_ebene;
begin
  select a.mandant_id, a.ebene into v_mandant, v_ebene
    from public.audit_log a where a.id = p_audit;
  if not found then return; end if;

  -- Platform rows are super_admin only (K-16(d)); that right is catalogue-borne
  -- too, so both branches resolve through the one gate.
  if v_ebene = 'mandant' and not (v_mandant = any (app.sichtbare_mandanten())) then
    return;
  end if;
  if not app.hat_recht('system.audit_sensitiv_lesen') then return; end if;

  perform app.protokolliere('audit.nutzlast_gelesen', 'audit_log', p_audit::text, null, null, v_mandant);
  return query select a.vorher, a.nachher from public.audit_log a where a.id = p_audit;
end $$;

grant execute on function app.audit_nutzlast_lesen(bigint) to cse_app;

-- ---------------------------------------------------------------------------
-- Triggers and revoked DELETE grants — generated from src/server/db/schema/rls.ts.
-- `pnpm db:triggers` rewrites the block below; a test fails the build if the
-- registry, the generated file and this block disagree.
-- ---------------------------------------------------------------------------

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
