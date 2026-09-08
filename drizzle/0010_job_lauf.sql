-- 0010 — Job- und Scheduler-Kern (SPEC §14 Infrastruktur).
--
-- Zwei Tabellen, und die WICHTIGE Eigenschaft ist eine ABWESENHEIT:
-- `job_lauf` hat **kein** `mandant_id`.
--
-- K-16(d) haelt `audit_log` als die einzige mandantennahe Tabelle mit einem
-- nullbaren `mandant_id`. Ein naechtlicher Lauf ueber alle Gesellschaften hat
-- keinen einzelnen Mandanten zu nennen — und eine Spalte, die dann NULL
-- traegt, waere eine zweite Ausnahme mit derselben Begruendung, die K-16(d)
-- ausdruecklich nur einmal zulaesst. Wichtiger noch: eine Zeile mit
-- `mandant_id IS NULL` in einer Tabelle, deren Policy auf `mandant_id` keyt,
-- ist von jedem Mandanten aus unsichtbar ODER von allen sichtbar, je nach
-- Praedikat — und beides ist falsch.
--
-- Das Ergebnis JE MANDANT lebt deshalb in `job_lauf_mandant`, und nur dort.

create type job_ergebnis as enum ('erfolg','teilweise','fehler','abgebrochen');

create table job_lauf (
  id            uuid primary key default gen_random_uuid(),
  -- Der Registrierungsschluessel. Nicht `job_schluessel`: der Eigentuemer
  -- (01-KERN §6) nennt die Spalte `job`.
  job           text not null,
  gestartet_am  timestamptz not null default now(),
  beendet_am    timestamptz,
  ergebnis      job_ergebnis,
  kennzahlen    jsonb not null default '{}',
  fehlertext    text,
  -- Derselbe Schluessel zweimal heisst: die Arbeit passiert einmal.
  idempotenz_schluessel text,
  versuch       integer not null default 1 check (versuch >= 1),

  constraint job_lauf_ende check ((beendet_am is null) = (ergebnis is null))
);

-- KEIN mandant_id. Der Schema-Test unten prueft das, und die
-- Isolations-Registry fuehrt die Tabelle nicht.

create unique index job_lauf_idempotenz_uk on job_lauf (job, idempotenz_schluessel)
  where idempotenz_schluessel is not null;
create index job_lauf_zeit_idx on job_lauf (job, gestartet_am desc);
create index job_lauf_offen_idx on job_lauf (gestartet_am) where beendet_am is null;

create table job_lauf_mandant (
  id          uuid primary key default gen_random_uuid(),
  job_lauf_id uuid not null references job_lauf(id),
  mandant_id  uuid not null references mandant(id),
  ergebnis    job_ergebnis not null,
  kennzahlen  jsonb not null default '{}',
  fehlertext  text,
  erstellt_am timestamptz not null default now(),

  constraint job_lauf_mandant_uk unique (job_lauf_id, mandant_id)
);

create index job_lauf_mandant_idx on job_lauf_mandant (mandant_id, erstellt_am desc);

comment on table job_lauf is
  'Plattform-Betriebsprotokoll. OHNE mandant_id: ein Lauf ueber alle Gesellschaften '
  'hat keinen einzelnen zu nennen (K-16(d)). Je-Mandant-Ergebnisse: job_lauf_mandant.';

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table job_lauf         enable row level security;
alter table job_lauf         force  row level security;
alter table job_lauf_mandant enable row level security;
alter table job_lauf_mandant force  row level security;

-- `job_lauf` ist Betriebsdatum, kein Mandantendatum: lesbar mit dem
-- Betriebsrecht, und mit keinem anderen.
create policy t_job_lauf_lesen on job_lauf for select to cse_app
  using (app.hat_recht('system.betrieb_lesen', app.aktiver_mandant()));

-- Das Je-Mandant-Ergebnis ist ein Mandantendatum und traegt die uebliche
-- Trennung.
create policy t_job_lauf_mandant_lesen on job_lauf_mandant for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('system.betrieb_lesen', mandant_id));

-- Geschrieben wird ausschliesslich von `cse_job`.
grant select on job_lauf, job_lauf_mandant to cse_app;
grant select, insert, update on job_lauf to cse_job;
grant select, insert on job_lauf_mandant to cse_job;

create policy t_job_lauf_schreiben on job_lauf for all to cse_job
  using (true) with check (true);
create policy t_job_lauf_mandant_schreiben on job_lauf_mandant for all to cse_job
  using (true) with check (true);
