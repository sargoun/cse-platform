-- 0003 — audit_log, and the one writer.
--
-- `app.protokolliere(...)` is the only path that writes here. `cse_app` holds
-- no INSERT: an audit trail the application can write directly is an audit
-- trail the application can shape.

create type audit_ebene as enum ('plattform','mandant');
create type akteur_art  as enum ('mensch','agent','system');

create table audit_log (
  id             bigint generated always as identity primary key,
  -- K-16(d): the ONE tenant-adjacent table with a nullable mandant_id. A
  -- platform event (a migration, a login attempt before a tenant is known)
  -- has no mandant, and forcing one would mean inventing it.
  mandant_id     uuid references mandant(id),
  ebene          audit_ebene not null,
  akteur_typ     akteur_art  not null,
  akteur_id      uuid,
  agent_id       uuid,
  aktion         text not null,
  objekt_typ     text not null,
  objekt_id      text,
  vorher         jsonb,
  nachher        jsonb,
  geaendert_felder text[],
  ip             inet,
  sitzung_id     uuid,
  erstellt_am    timestamptz not null default now(),

  constraint audit_ebene_stimmt check ((ebene = 'mandant') = (mandant_id is not null))
);

create index audit_mandant_idx on audit_log (mandant_id, erstellt_am desc);
create index audit_objekt_idx  on audit_log (objekt_typ, objekt_id, erstellt_am desc);
