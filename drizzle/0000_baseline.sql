-- 0000_baseline — extensions and schemas only. No domain table lands here.
--
-- The domain tables arrive in PR 3 with the D-09 person/anstellung split
-- already in place; splitting them later is the migration this project is
-- built to avoid.

create extension if not exists "pgcrypto";      -- gen_random_uuid, digest
create extension if not exists "btree_gist";    -- EXCLUDE constraints on ranges
create extension if not exists "pg_trgm";       -- fuzzy name search
create extension if not exists "unaccent";      -- German folding in search

-- `app` holds the session accessors and the SECURITY DEFINER helpers.
create schema if not exists app;

-- `kern` holds the platform-wide trigger functions (kern.setze_geaendert_am,
-- kern.verhindere_loeschung, kern.erzwinge_serverzeit) — one name each,
-- platform-wide (K-21).
create schema if not exists kern;

-- `zeit_intern` is NOT exposed by PostgREST. It holds the one sanctioned
-- cross-entity crossing of K-06 and nothing else; exposing it would turn that
-- crossing into an HTTP endpoint with no code change anywhere.
create schema if not exists zeit_intern;
