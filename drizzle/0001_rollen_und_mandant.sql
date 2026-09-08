-- 0001 — the six K-01 database roles, and `mandant`.
--
-- The roles are the first line of the tenancy defence and they are created
-- before any table, so no table can be created without one of them owning it.
-- NOBYPASSRLS on every application role is not a precaution: a role with
-- BYPASSRLS makes every policy in this schema decorative.

do $$ begin
  -- Owns the schema. Runs migrations. Never serves a request.
  if not exists (select from pg_roles where rolname = 'cse_migrator') then
    create role cse_migrator nologin nobypassrls;
  end if;
  -- Owns the SECURITY DEFINER helpers. Never used by the application pool.
  if not exists (select from pg_roles where rolname = 'cse_definer') then
    create role cse_definer nologin nobypassrls;
  end if;
  -- The application pool. Every request runs as this role, under RLS.
  if not exists (select from pg_roles where rolname = 'cse_app') then
    create role cse_app nologin nobypassrls;
  end if;
  -- Pre-authentication paths only (K-08's closed register).
  if not exists (select from pg_roles where rolname = 'cse_anon') then
    create role cse_anon nologin nobypassrls;
  end if;
  -- The tokenised check-in endpoint and its offline replay. Two functions.
  if not exists (select from pg_roles where rolname = 'cse_checkin') then
    create role cse_checkin nologin nobypassrls;
  end if;
  -- Cron and Edge Functions.
  if not exists (select from pg_roles where rolname = 'cse_job') then
    create role cse_job nologin nobypassrls;
  end if;
end $$;

grant usage on schema public, app, kern to cse_app, cse_anon, cse_checkin, cse_job, cse_definer;

-- ---------------------------------------------------------------------------
-- mandant — one business area of the group as its own tenant.
-- ---------------------------------------------------------------------------
create table mandant (
  id                        uuid primary key default gen_random_uuid(),
  -- K-07/K-21: the canonical spelling is `slug`, never `schluessel`. The
  -- reserved list is one list and lives in K-21; a slug colliding with a
  -- portal static would shadow that route.
  slug                      text not null unique
                              check (slug ~ '^[a-z][a-z0-9_-]{1,30}$'
                                     and slug not in ('gruppe','mein','kunde','konto','api')),
  name                      text not null,
  firma                     text not null,
  rechtsform                text,
  -- NULL is the only neutral value: O-01 is open, and a default of true or
  -- false would decide it silently.
  -- TODO(client): O-01 — ist CSE Operations eine GmbH oder eine Abteilung?
  ist_rechtseinheit         boolean,
  eigener_nummernkreis      boolean not null default false,
  module                    text[] not null default '{}',
  handelsregister_gericht   text,
  handelsregister_nummer    text,
  geschaeftsfuehrer         text[] not null default '{}',
  ust_id                    text check (ust_id is null or ust_id ~ '^DE[0-9]{9}$'),
  steuernummer              text,
  finanzamt                 text,
  betriebsnummer            text,
  strasse                   text,
  plz                       text check (plz is null or plz ~ '^[0-9]{5}$'),
  ort                       text,
  land                      char(2) not null default 'DE',
  telefon                   text,
  email                     text,
  web                       text,
  iban                      text,
  bic                       text,
  bank                      text,
  farbe_token               text,
  sortierung                integer not null default 0,
  -- The single liveness column. No hard delete: a mandant owns financial data
  -- under a ten-year retention (LEG-01).
  archiviert_am             timestamptz,
  erstellt_am               timestamptz not null default now(),
  geaendert_am              timestamptz,
  erstellt_von              uuid,
  geaendert_von             uuid,

  -- TEN-02: a circle requires a decided legal entity.
  constraint mandant_kreis_nur_rechtseinheit
    check (not eigener_nummernkreis or ist_rechtseinheit is true),
  -- §14 UStG: an entity cannot own an invoice circle it may not lawfully
  -- invoice from. The finalisation pre-flight checks the same fields again,
  -- because K-12 copies the supplier into the invoice as a snapshot.
  constraint mandant_ustg14_vollstaendig
    check (not eigener_nummernkreis
           or (strasse is not null and plz is not null and ort is not null
               and (ust_id is not null or steuernummer is not null)))
);

comment on column mandant.ist_rechtseinheit is
  'NULL = ungeklärt (O-01). Steuert TEN-02: kein Nummernkreis, solange NULL.';
