-- 0002 — the D-09 split, in the FIRST migration that carries domain tables.
--
-- `person` is the human. `anstellung` is one employment per entity. Merging
-- them later is the migration this project exists to avoid: a §34a certificate
-- stored per employment produces one valid and one expired copy of the same
-- certificate, and a scheduler that passes its own check while assigning an
-- unqualified guard.
--
-- The rule, from D-09: anything costed or invoiced hangs off the EMPLOYMENT
-- (it belongs to one entity and one rate); anything true of the human hangs
-- off the PERSON.

create table person (
  id             uuid primary key default gen_random_uuid(),
  vorname        text not null,
  nachname       text not null,
  geburtsdatum   date,
  telefon        text,
  -- EMP-12 states exactly these four.
  sprache        text not null default 'de' check (sprache in ('de','en','ar','tr')),
  geloescht_am   timestamptz,
  geloescht_von  uuid,
  erstellt_am    timestamptz not null default now(),
  geaendert_am   timestamptz,
  erstellt_von   uuid,
  geaendert_von  uuid
);

-- `person` carries no `mandant_id` BY CONSTRUCTION. It is the one shared table
-- of the tenancy model, and its visibility is asymmetric: a person is readable
-- from every mandant it has an employment with (§1.6 of the Kern model). A
-- `mandant_id` here would make the dual-employed human two rows, which is the
-- thing D-09 forbids.

create table anstellung (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  person_id             uuid not null references person(id),
  personalnummer        text not null,
  eintritt              date not null,
  austritt              date,
  -- PLACEHOLDER vocabulary: D-09 names the column, no document names the
  -- values, so the seed default is `unbekannt` and nothing branches on it.
  -- TODO(client): O-18 — welche Beschäftigungs-/SV-Kategorien nutzt die
  -- Gruppe für `arbeitszeitmodell`, und müssen sie den Codes des Lohnsystems
  -- entsprechen (ACC-12)?
  arbeitszeitmodell     text not null default 'unbekannt',
  wochenstunden         numeric(5,2),
  -- K-05: money in integer cents. The column carries NO `_cent` suffix — that
  -- suffix exists only on the HTTP wire field (R-12). Column-level SELECT is
  -- revoked from cse_app in 0004 and read through an accessor that re-checks
  -- the right, because D-09.6 says a manager in cleaning must not see security
  -- wage rates.
  stundensatz_intern    bigint,
  status                text not null default 'aktiv'
                          check (status in ('geplant','aktiv','ruhend','beendet')),
  geloescht_am          timestamptz,
  geloescht_von         uuid,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  erstellt_von          uuid,
  geaendert_von         uuid,

  constraint anstellung_personalnummer_uk unique (mandant_id, personalnummer),
  -- K-16: the composite parent unique every tenant child FK points at.
  constraint anstellung_mandant_id_uk    unique (mandant_id, id),
  -- 04-PLANUNG-ZEIT §2.3 item 8: three composite FKs in the time domain are
  -- `(anstellung_id, person_id) → anstellung (id, person_id)`. That pair is
  -- what makes the denormalised `person_id` on a time row drift-proof, and
  -- Postgres refuses those FKs until the parent declares this unique.
  constraint anstellung_id_person_uk     unique (id, person_id),
  constraint anstellung_austritt_nach_eintritt check (austritt is null or austritt >= eintritt)
);

create index anstellung_person_idx  on anstellung (person_id) where geloescht_am is null;
create index anstellung_mandant_idx on anstellung (mandant_id, status) where geloescht_am is null;

comment on table person is
  'Der Mensch. Ohne mandant_id — genau ein Zeile je Mensch, über alle Gesellschaften (D-09).';
comment on table anstellung is
  'Eine Beschäftigung je Gesellschaft. Alles Kostenrelevante hängt hier, nicht an person (D-09).';
