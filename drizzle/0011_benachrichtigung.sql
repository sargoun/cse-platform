-- 0011 — Benachrichtigungen und Nachrichten (NOT-01..NOT-03, EMP-11).

create type benachrichtigung_kanal as enum ('app','email');

create table benachrichtigung (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  empfaenger_id uuid not null references benutzer(id),
  art           text not null check (art ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  titel         text not null,
  text          text not null,
  -- NOT-03: ohne Ziel gibt es die Zeile nicht. `not null` ist die Zusage;
  -- die Aufloesung passiert im Dienst, vor dem Einfuegen.
  ziel          text not null check (length(ziel) > 1),
  objekt_typ    text not null,
  objekt_id     text,
  gelesen_am    timestamptz,
  -- Eine Freigabeanfrage traegt hier `false` und wird nie gesammelt.
  sammelbar     boolean not null,
  erstellt_am   timestamptz not null default now(),

  constraint benachrichtigung_mandant_id_uk unique (mandant_id, id)
);

create index benachrichtigung_posteingang_idx
  on benachrichtigung (empfaenger_id, erstellt_am desc) where gelesen_am is null;
create index benachrichtigung_mandant_idx on benachrichtigung (mandant_id, erstellt_am desc);

/** Was ein Benutzer je Art eingestellt hat (NOT-02). */
create table benachrichtigung_praeferenz (
  id          uuid primary key default gen_random_uuid(),
  benutzer_id uuid not null references benutzer(id),
  art         text not null,
  kanaele     benachrichtigung_kanal[] not null,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz,

  constraint benachrichtigung_praeferenz_key unique (benutzer_id, art),
  -- Der In-App-Posteingang laesst sich nicht abschalten: er ist das
  -- Protokoll dessen, was jemandem mitgeteilt wurde. Abgeschaltet wird der
  -- Push nach draussen.
  constraint praeferenz_app_bleibt check ('app' = any (kanaele))
);

/** EMP-11 — die interne Nachricht zwischen Menschen. */
create table nachricht (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  absender_id   uuid references benutzer(id),
  betreff       text not null,
  text          text not null,
  gesendet_am   timestamptz not null default now(),
  erstellt_am   timestamptz not null default now(),

  constraint nachricht_mandant_id_uk unique (mandant_id, id)
);

create table nachricht_empfaenger (
  id           uuid primary key default gen_random_uuid(),
  mandant_id   uuid not null references mandant(id),
  nachricht_id uuid not null,
  person_id    uuid not null references person(id),
  gelesen_am   timestamptz,

  constraint nachricht_empfaenger_fk
    foreign key (mandant_id, nachricht_id) references nachricht (mandant_id, id),
  constraint nachricht_empfaenger_uk unique (nachricht_id, person_id)
);

create index nachricht_empfaenger_idx on nachricht_empfaenger (person_id, gelesen_am);

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table benachrichtigung            enable row level security;
alter table benachrichtigung            force  row level security;
alter table benachrichtigung_praeferenz enable row level security;
alter table benachrichtigung_praeferenz force  row level security;
alter table nachricht                   enable row level security;
alter table nachricht                   force  row level security;
alter table nachricht_empfaenger        enable row level security;
alter table nachricht_empfaenger        force  row level security;

/**
 * Der Posteingang ist PERSOENLICH: `empfaenger_id = app.aktueller_benutzer()`.
 *
 * Kein `nachricht.lesen`-Recht davor. Das Recht regelt, wer Nachrichten
 * SCHREIBT und wer den Bereich sieht; wer eine Benachrichtigung bekommen hat,
 * darf sie lesen — sonst haette man ihm etwas mitgeteilt, das er nicht ansehen
 * kann. Der Mandant steht trotzdem in der Bedingung: eine Benachrichtigung aus
 * einem Bereich, den er verloren hat, verschwindet mit dem Zugang.
 */
create policy t_benachrichtigung_eigene on benachrichtigung for select to cse_app
  using (empfaenger_id = app.aktueller_benutzer()
         and mandant_id = any (app.sichtbare_mandanten()));

create policy t_benachrichtigung_lesen_setzen on benachrichtigung for update to cse_app
  using (empfaenger_id = app.aktueller_benutzer())
  with check (empfaenger_id = app.aktueller_benutzer());

create policy t_praeferenz_eigene on benachrichtigung_praeferenz for all to cse_app
  using (benutzer_id = app.aktueller_benutzer())
  with check (benutzer_id = app.aktueller_benutzer() and not app.ist_readonly());

create policy t_nachricht_mandant on nachricht for all to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('nachricht.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('nachricht.versenden', mandant_id));

create policy t_nachricht_gruppe on nachricht for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('gruppe.nachricht.lesen', mandant_id));

/** Die eigene Zustellung sieht der Mensch dahinter, ohne Recht (K-18, Form B). */
create policy t_empfaenger_person on nachricht_empfaenger for select to cse_app
  using (person_id = app.aktuelle_person()
         and mandant_id = any (app.sichtbare_mandanten()));

create policy t_empfaenger_mandant on nachricht_empfaenger for all to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('nachricht.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('nachricht.versenden', mandant_id));

grant select, update on benachrichtigung to cse_app;
grant select, insert, update on benachrichtigung_praeferenz to cse_app;
grant select, insert on nachricht to cse_app;
grant select, insert, update on nachricht_empfaenger to cse_app;
-- Benachrichtigungen schreibt der Dienst, nicht der Benutzer.
grant select, insert on benachrichtigung to cse_job;
