-- 0004 — session state, the K-20 accessors, and RLS with FORCE.
--
-- Two things here are load-bearing and easy to get subtly wrong:
--
--  1. FORCE. Without it the table OWNER bypasses its own policies, so every
--     test that runs as the owner passes and production is the first place
--     anyone learns otherwise.
--  2. Every accessor resolves in ALL FOUR scopes (K-20). An accessor keyed on
--     `app.aktiver_mandant()` returns NULL in gruppe/person/kunde scope,
--     every predicate on it is then false, and the page reads zero rows with
--     no error at all.

-- ---------------------------------------------------------------------------
-- Session state — the GUCs, and nothing else (K-02).
-- ---------------------------------------------------------------------------
create function app.guc(p_name text) returns text
language sql stable as $$
  select nullif(current_setting(p_name, true), '')
$$;

create function app.aktueller_benutzer() returns uuid
language sql stable as $$ select app.guc('app.benutzer_id')::uuid $$;

create function app.scope() returns text
language sql stable as $$ select coalesce(app.guc('app.scope'), 'mandant') $$;

/**
 * The active mandant. NULL in the three multi-tenant scopes BY CONSTRUCTION —
 * documented, not accidental, and that is what K-20 requires to be stated.
 */
create function app.aktiver_mandant() returns uuid
language sql stable as $$
  select case when app.scope() = 'mandant' then app.guc('app.mandant_id')::uuid else null end
$$;

create function app.mandant_ids() returns uuid[]
language sql stable as $$
  select coalesce(
    (select array_agg(x::uuid) from unnest(string_to_array(coalesce(app.guc('app.mandant_ids'), ''), ',')) as x
      where x <> ''),
    '{}')
$$;

create function app.aktuelle_person() returns uuid
language sql stable as $$ select app.guc('app.person_id')::uuid $$;

create function app.ist_gruppenansicht() returns boolean
language sql stable as $$ select app.scope() = 'gruppe' $$;

create function app.ist_readonly() returns boolean
language sql stable as $$
  -- The draft's coalesce(current_setting(...), 'on') treated an EMPTY STRING
  -- as not-readonly — a fail-open path in the one helper called fail-closed.
  select coalesce(nullif(current_setting('app.readonly', true), ''), 'on') = 'on'
$$;

/**
 * `app.portal` — the K-04 ceiling. Bound when the scope is ENTERED and never
 * recomputed from `aktiver_mandant()`, which is NULL outside mandant scope and
 * would fall through to the fail-closed 'mitarbeiter': that fires every
 * employee ceiling inside the group view and ceilings every customer as staff.
 *
 * In `gruppe` scope the value is the constant 'intern'. Entry is the gate, not
 * the ceiling: the wrapper admits only a principal holding an intern
 * membership plus a group read right. A most-restrictive fold over the
 * memberships returns 'mitarbeiter' for the D-09 human who leads one entity
 * and is employed by another, which blanks the four-entity roll-up.
 */
create function app.portal() returns text
language sql stable as $$
  select case app.scope()
    when 'gruppe' then 'intern'
    when 'person' then 'mitarbeiter'
    when 'kunde'  then 'kunde'
    else coalesce(app.guc('app.portal'), 'mitarbeiter')
  end
$$;

/**
 * The mandanten readable in the current scope, re-derived INSIDE the database
 * per scope (K-18). `app.mandant_ids` is a hint this may cross-check, never
 * the authority: if the application ever set a mandant the caller does not
 * belong to, the database still returns nothing.
 */
create function app.sichtbare_mandanten() returns uuid[]
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select case app.scope()
    when 'mandant' then case when app.aktiver_mandant() is null then '{}'::uuid[]
                             else array[app.aktiver_mandant()] end
    when 'gruppe'  then app.mandant_ids()
    -- The employee portal spans tenants as a SUBJECT: the person's own live
    -- employments, not a management right (K-18).
    when 'person'  then coalesce((select array_agg(distinct a.mandant_id) from public.anstellung a
                                   where a.person_id = app.aktuelle_person()
                                     and a.geloescht_am is null), '{}')
    -- The customer portal resolves from kunde_zugang, which arrives with the
    -- CRM domain. Empty is the correct fail-closed value until then, and it is
    -- documented rather than accidental.
    when 'kunde'   then '{}'::uuid[]
    else '{}'::uuid[]
  end
$$;

create function app.assert_genau_ein_mandant() returns uuid
language plpgsql stable as $$
declare m uuid;
begin
  m := app.aktiver_mandant();
  if m is null then
    raise exception 'KeinAktiverMandant' using errcode = 'P0001';
  end if;
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- audit_log's one writer.
-- ---------------------------------------------------------------------------
create function app.protokolliere(
  p_aktion text, p_objekt_typ text, p_objekt_id text,
  p_vorher jsonb default null, p_nachher jsonb default null,
  p_mandant uuid default null
) returns void
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare m uuid := coalesce(p_mandant, app.aktiver_mandant());
begin
  insert into public.audit_log
    (mandant_id, ebene, akteur_typ, akteur_id, aktion, objekt_typ, objekt_id,
     vorher, nachher, geaendert_felder, ip, sitzung_id)
  values
    (m,
     case when m is null then 'plattform' else 'mandant' end::audit_ebene,
     coalesce(app.guc('app.akteur_typ'), 'system')::akteur_art,
     app.aktueller_benutzer(),
     p_aktion, p_objekt_typ, p_objekt_id, p_vorher, p_nachher,
     case when p_vorher is null or p_nachher is null then null
          else (select coalesce(array_agg(k), '{}') from jsonb_object_keys(p_nachher) k
                 where p_vorher -> k is distinct from p_nachher -> k) end,
     app.guc('app.ip')::inet,
     app.guc('app.sitzung_id')::uuid);
end $$;

-- ---------------------------------------------------------------------------
-- RLS. FORCE everywhere, and no application role holds BYPASSRLS.
-- ---------------------------------------------------------------------------
alter table mandant    enable row level security;
alter table mandant    force  row level security;
alter table person     enable row level security;
alter table person     force  row level security;
alter table anstellung enable row level security;
alter table anstellung force  row level security;
alter table audit_log  enable row level security;
alter table audit_log  force  row level security;

-- mandant: readable where it is in the caller's scope-derived set.
create policy t_mandant_lesen on mandant for select to cse_app
  using (id = any (app.sichtbare_mandanten()));

-- anstellung: strictly tenant-scoped. This is the row a `reinigung` session
-- must not see for a `security` employment, and the policy is what enforces
-- it — the service-layer filter is the first line, this is the second.
create policy t_anstellung_lesen on anstellung for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten()));

create policy t_anstellung_schreiben on anstellung for insert to cse_app
  with check (mandant_id = app.assert_genau_ein_mandant() and not app.ist_readonly());

create policy t_anstellung_aendern on anstellung for update to cse_app
  using (mandant_id = app.assert_genau_ein_mandant())
  with check (mandant_id = app.assert_genau_ein_mandant() and not app.ist_readonly());

/**
 * person: ASYMMETRIC, and this is the D-09 rule in SQL.
 *
 * A person is visible to every mandant it has an employment with — so the
 * dual-employed human is ONE row readable from both tenants. What stays
 * tenant-scoped is `anstellung` and everything below it, which is where the
 * wage rate lives.
 */
/**
 * K-04 — the employee ceiling, and it is RESTRICTIVE.
 *
 * The tenant policy above says which entities a session may read. That is not
 * enough for the employee portal: in `person` scope the subject may read her
 * OWN employments across entities, and nobody else's — otherwise every cleaner
 * reads every colleague's employment row in their own entity (EMP-13, D-09.6).
 *
 * Restrictive, so it ANDs with the permissive policy rather than widening it.
 * A permissive second policy would OR, which is how a ceiling becomes a hole.
 */
create policy p_ma_ceiling on anstellung as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter' or person_id = app.aktuelle_person())
  with check (app.portal() <> 'mitarbeiter' or person_id = app.aktuelle_person());

create policy t_person_lesen on person for select to cse_app
  using (
    exists (select 1 from anstellung a
             where a.person_id = person.id
               and a.geloescht_am is null
               and a.mandant_id = any (app.sichtbare_mandanten()))
    or person.id = app.aktuelle_person()
  );

create policy t_person_schreiben on person for insert to cse_app
  with check (app.assert_genau_ein_mandant() is not null and not app.ist_readonly());

-- audit_log: readable in scope, and NOT insertable by cse_app at all.
create policy t_audit_lesen on audit_log for select to cse_app
  using (mandant_id is null or mandant_id = any (app.sichtbare_mandanten()));

/**
 * The wage rate is granted away by NOT granting it — K-05.
 *
 * A table-wide `GRANT SELECT` followed by `REVOKE SELECT (spalte)` does NOT
 * work in Postgres: the table-level privilege keeps covering every column and
 * the revoke silently changes nothing. The column has to be left out of the
 * grant in the first place, which is why this is an explicit column list and
 * a schema test asserts `stundensatz_intern` is absent from it.
 */
grant select (
  id, mandant_id, person_id, personalnummer, eintritt, austritt,
  arbeitszeitmodell, wochenstunden, status,
  geloescht_am, geloescht_von, erstellt_am, geaendert_am, erstellt_von, geaendert_von
) on anstellung to cse_app;
grant insert, update on anstellung to cse_app;
grant select, insert on person to cse_app;
grant select on mandant to cse_app;
grant select on audit_log to cse_app;
-- No INSERT on audit_log for cse_app. app.protokolliere is the only writer.
grant execute on function app.protokolliere(text,text,text,jsonb,jsonb,uuid) to cse_app;

/**
 * K-05 — the wage rate is a COLUMN GRANT, not a masking view.
 *
 * The first draft used a view doing `select a.*` and then adding a masked copy
 * of the rate beside it. Both repairs fail: `security_invoker` needs
 * privileges just revoked, and without it the view runs as an owner that
 * ignores the tenant predicate. So the privilege is removed at column level
 * and the value is read through a definer accessor that re-checks the right.
 */
create function app.anstellung_entgelt_lesen(p_anstellung uuid) returns bigint
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare wert bigint; m uuid;
begin
  select a.stundensatz_intern, a.mandant_id into wert, m
    from public.anstellung a where a.id = p_anstellung;
  if m is null then return null; end if;
  -- The tenant check is repeated here BECAUSE this function is a definer and
  -- therefore not subject to the policy above.
  if not (m = any (app.sichtbare_mandanten())) then return null; end if;
  perform app.protokolliere('entgelt.gelesen', 'anstellung', p_anstellung::text, null, null, m);
  return wert;
end $$;

grant execute on function app.anstellung_entgelt_lesen(uuid) to cse_app;
