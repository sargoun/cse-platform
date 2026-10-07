-- 0526 — Die Verfahrensdokumentation traegt einen Zeichnungsvermerk
--        (V-316, O-188, D-787, D-837)
--
-- erstelleVerfahrensdokumentation erzeugt das Dokument aus der lebenden
-- Konfiguration, mit Hash und Schemastand (ACC-10). Wer es gezeichnet hat und
-- wann es zuletzt geprueft wurde, hielt nichts fest. Voreinstellung (O-188,
-- D-787): die Geschaeftsfuehrung der Gesellschaft zeichnet; geprueft wird
-- jaehrlich und bei jedem Wechsel des Schemastands.
--
-- verfahrensdokumentation_zeichnung: eine Zeile je Zeichnung, anfuegend.
--  - sha256 und schemastand sind die der Fassung, die gezeichnet wurde — der
--    Dienst setzt sie aus der beim Zeichnen erzeugten Dokumentation, kein
--    Formular reicht sie herein;
--  - gezeichnet_von setzt der Ausloeser aus der Sitzung, gezeichnet_am die
--    Serveruhr (Invariante 5) — ein Zeichner, den der Aufrufer nennt, waere
--    keiner;
--  - funktion (z. B. Geschaeftsfuehrung) traegt der Zeichnende ein.
-- Lesen: wer die Dokumentation lesen darf (buchhaltung_konfiguration.lesen).
-- Zeichnen: wer die Buchhaltungskonfiguration verwalten darf
-- (buchhaltung_konfiguration.verwalten) — wer die Konfiguration aendern darf,
-- bezeugt auch ihre Beschreibung.

create table verfahrensdokumentation_zeichnung (
  id             uuid primary key default gen_random_uuid(),
  mandant_id     uuid not null references mandant(id),
  sha256         text not null,
  schemastand    text,
  funktion       text not null,
  bemerkung      text,
  gezeichnet_von uuid not null references benutzer(id),
  gezeichnet_am  timestamptz not null default now(),

  constraint vdz_mandant_uk unique (mandant_id, id),
  constraint vdz_sha256_form check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint vdz_funktion_benannt check (length(btrim(funktion)) between 3 and 200),
  constraint vdz_bemerkung_laenge check (bemerkung is null or length(bemerkung) <= 2000)
);

create index vdz_mandant_idx on verfahrensdokumentation_zeichnung (mandant_id, gezeichnet_am desc);

comment on table verfahrensdokumentation_zeichnung is
  'V-316, O-188, ACC-10. Wer die Verfahrensdokumentation in welcher Fassung (Hash, Schemastand) '
  'gezeichnet hat und wann. Anfuegend; Zeichner und Zeit setzt die Datenbank.';

create function kern.vdz_zeichner_und_zeit() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  new.gezeichnet_am := now();
  new.gezeichnet_von := app.aktueller_benutzer();
  if new.gezeichnet_von is null then
    raise exception 'Eine Verfahrensdokumentation zeichnet ein Mensch — ohne angemeldetes Konto keine Zeichnung (V-316)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_vdz_zeichner_und_zeit
  before insert on verfahrensdokumentation_zeichnung
  for each row execute function kern.vdz_zeichner_und_zeit();

create function kern.vdz_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Eine Zeichnung bleibt, wie sie ist — eine neue Pruefung ist eine neue Zeile (V-316)'
    using errcode = 'restrict_violation';
end $$;

create trigger trg_vdz_unveraenderlich
  before update on verfahrensdokumentation_zeichnung
  for each row execute function kern.vdz_unveraenderlich();

alter table verfahrensdokumentation_zeichnung enable row level security;
alter table verfahrensdokumentation_zeichnung force row level security;

create policy t_vdz_lesen on verfahrensdokumentation_zeichnung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('buchhaltung_konfiguration.lesen', app.aktiver_mandant())));

create policy t_vdz_zeichnen on verfahrensdokumentation_zeichnung for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('buchhaltung_konfiguration.verwalten', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy p_intern_decke on verfahrensdokumentation_zeichnung as restrictive for all to cse_app
  using (app.portal() = 'intern')
  with check (app.portal() = 'intern');

grant select, insert (mandant_id, sha256, schemastand, funktion, bemerkung)
  on verfahrensdokumentation_zeichnung to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0526)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- verfahrensdokumentation_zeichnung (append): V-316, O-188, ACC-10, GoBD Rz. 151 ff. Wer die Verfahrensdokumentation in welcher Fassung gezeichnet hat. Loeschbar waere sie die Zeichnung, die es nicht gegeben haben soll — und eine Pruefung, deren Datum niemand belegt.
create trigger trg_verfahrensdokumentation_zeichnung_kein_hard_delete
  before delete on verfahrensdokumentation_zeichnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_verfahrensdokumentation_zeichnung_kein_truncate
  before truncate on verfahrensdokumentation_zeichnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on verfahrensdokumentation_zeichnung from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
