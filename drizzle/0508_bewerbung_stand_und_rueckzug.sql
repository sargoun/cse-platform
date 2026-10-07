-- 0508 — eine Bewerbung bewegt sich auch ohne Entscheidung (V-363, O-200, D-812).
--
-- Seit 0168 aendert cse_app bewerbung nicht; der Status wandert nur ueber eine
-- Einstellungsentscheidung (abgelehnt, eingestellt). Die drei Staende
-- dazwischen aus 0166 setzte niemand: in_pruefung nur der Seed, gespraech und
-- zurueckgezogen gar kein Weg. Voreinstellung zu O-200 (D-797): die Staende wie
-- 0166, und keiner davon ist eine Entscheidung ueber einen Menschen.
--
--   (1) in_pruefung, sobald ein MENSCH die erste Bewertung schreibt — eine
--       Bewertung des Agenten bewegt nichts (Art. 22 DSGVO).
--   (2) gespraech, sobald ein Gespraech geplant ist; sind alle Gespraeche
--       abgesagt, zurueck auf in_pruefung. Ein gefuehrtes Gespraech laesst den
--       Stand stehen.
--   (3) zurueckgezogen als Vermerk auf die Erklaerung der Bewerberin, von einem
--       benannten Menschen mit recruiting.bewerbung_bewerten, mit Vermerk und
--       Zeitpunkt. Die Aufbewahrungsfrist laeuft danach wie bei einer Absage
--       (0498): Berliner Tag plus recruiting.aufbewahrung_tage, nie kuerzer als
--       ab Eingang.
--   (4) Eine zurueckgezogene Bewerbung wird nicht mehr entschieden.
--
-- (1) und (2) bewegen nur nach vorn und nie eine entschiedene oder
-- zurueckgezogene Bewerbung. Alle Schreiber sind Definer mit cse_definer als
-- Eigentuemer, wie der Nachzug aus 0168; cse_app bekommt kein update auf
-- bewerbung.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- (3a) Der Rueckzug steht an der Zeile
-- ---------------------------------------------------------------------------

alter table bewerbung
  add column zurueckgezogen_am timestamptz,
  add column zurueckgezogen_von uuid references benutzer(id),
  add column zurueckgezogen_vermerk text;

-- Der Stand und der Vermerk gehoeren zusammen. Der Loeschlauf (REC-07) leert
-- den Vermerk mit den uebrigen Angaben der Bewerberin; Zeitpunkt und Name
-- dessen, der vermerkt hat, bleiben.
alter table bewerbung add constraint bewerbung_rueckzug_vermerkt check (
  (status = 'zurueckgezogen') = (zurueckgezogen_am is not null)
  and (zurueckgezogen_am is null
       or (zurueckgezogen_von is not null
           and (geloescht_am is not null
                or btrim(coalesce(zurueckgezogen_vermerk, '')) <> ''))));

grant update (zurueckgezogen_vermerk) on bewerbung to cse_job;

-- ---------------------------------------------------------------------------
-- (3b) Der Rueckzug als Definer
-- ---------------------------------------------------------------------------

create function app.bewerbung_zurueckziehen(p_bewerbung uuid, p_vermerk text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_benutzer uuid := app.aktueller_benutzer();
  v_roh      text;
  v_tage     int;
  v_zeilen   int;
begin
  if v_mandant is null or v_benutzer is null or app.ist_gruppenansicht() then
    raise exception 'Nur in einer aktiven Gesellschaft mit angemeldeter Person.'
      using errcode = '42501';
  end if;
  if app.ist_readonly() then
    raise exception 'Diese Sitzung liest nur.' using errcode = '42501';
  end if;
  if not app.hat_recht('recruiting.bewerbung_bewerten', v_mandant) then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_vermerk, ''))) < 3 then
    raise exception 'Der Vermerk sagt, wie die Bewerberin zurueckgezogen hat.'
      using errcode = '22023';
  end if;

  v_roh := app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}';
  if v_roh ~ '^[1-9][0-9]{0,4}$' then
    v_tage := v_roh::int;
  end if;

  update public.bewerbung
     set status = 'zurueckgezogen',
         zurueckgezogen_am = now(),
         zurueckgezogen_von = v_benutzer,
         zurueckgezogen_vermerk = btrim(p_vermerk),
         aufbewahrung_bis = case
           when v_tage is null then aufbewahrung_bis
           else greatest(aufbewahrung_bis, app.berlin_heute() + v_tage)
         end,
         geaendert_am = now(),
         geaendert_von = v_benutzer
   where id = p_bewerbung
     and mandant_id = v_mandant
     and geloescht_am is null
     and status in ('eingegangen', 'in_pruefung', 'gespraech');
  get diagnostics v_zeilen = row_count;

  if v_zeilen = 1 then
    perform app.protokolliere('recruiting.bewerbung_zurueckgezogen', 'bewerbung',
      p_bewerbung::text, null, jsonb_build_object('status', 'zurueckgezogen'), v_mandant);
  end if;
  return v_zeilen = 1;
end $$;

comment on function app.bewerbung_zurueckziehen(uuid, text) is
  'V-363, O-200, D-812: vermerkt den Rueckzug einer offenen Bewerbung (eingegangen, '
  'in_pruefung, gespraech) mit Vermerk und Namen; die Frist laeuft danach wie bei einer '
  'Absage. Gibt false zurueck, wenn die Bewerbung nicht offen ist.';

alter function app.bewerbung_zurueckziehen(uuid, text) owner to cse_definer;
revoke all on function app.bewerbung_zurueckziehen(uuid, text) from public;
grant execute on function app.bewerbung_zurueckziehen(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- (1)(2) Bewertung und Gespraech ziehen den Stand nach
-- ---------------------------------------------------------------------------

grant select on gespraech to cse_definer;
create policy d_gespraech_lesen on gespraech for select to cse_definer using (true);

create function app.bewerbung_folgt_bearbeitung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if tg_table_name = 'bewerbung_bewertung' then
    if new.erstellt_von_art = 'mensch' then
      update public.bewerbung
         set status = 'in_pruefung', geaendert_am = now()
       where id = new.bewerbung_id and mandant_id = new.mandant_id
         and status = 'eingegangen';
    end if;
  elsif tg_table_name = 'gespraech' then
    if tg_op = 'INSERT' and new.status = 'geplant' then
      update public.bewerbung
         set status = 'gespraech', geaendert_am = now()
       where id = new.bewerbung_id and mandant_id = new.mandant_id
         and status in ('eingegangen', 'in_pruefung');
    elsif tg_op = 'UPDATE' and new.status = 'abgesagt' and old.status <> 'abgesagt' then
      update public.bewerbung b
         set status = 'in_pruefung', geaendert_am = now()
       where b.id = new.bewerbung_id and b.mandant_id = new.mandant_id
         and b.status = 'gespraech'
         and not exists (
           select 1 from public.gespraech g
            where g.bewerbung_id = b.id and g.mandant_id = b.mandant_id
              and g.status <> 'abgesagt');
    end if;
  end if;
  return null;
end $$;

comment on function app.bewerbung_folgt_bearbeitung() is
  'V-363, O-200, D-812: in_pruefung bei der ersten Bewertung eines Menschen, gespraech beim '
  'geplanten Gespraech, zurueck auf in_pruefung, wenn alle Gespraeche abgesagt sind. Nur nach '
  'vorn und nie fuer eine entschiedene oder zurueckgezogene Bewerbung.';

alter function app.bewerbung_folgt_bearbeitung() owner to cse_definer;
revoke all on function app.bewerbung_folgt_bearbeitung() from public;

create trigger bewertung_zieht_stand_nach
  after insert on bewerbung_bewertung
  for each row execute function app.bewerbung_folgt_bearbeitung();

create trigger gespraech_zieht_stand_nach
  after insert or update of status on gespraech
  for each row execute function app.bewerbung_folgt_bearbeitung();

-- ---------------------------------------------------------------------------
-- (4) Keine Entscheidung nach dem Rueckzug
-- ---------------------------------------------------------------------------

create function app.entscheidung_nicht_nach_rueckzug() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if exists (
    select 1 from public.bewerbung b
     where b.id = new.bewerbung_id and b.mandant_id = new.mandant_id
       and b.status = 'zurueckgezogen') then
    raise exception 'Eine zurueckgezogene Bewerbung wird nicht mehr entschieden.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

alter function app.entscheidung_nicht_nach_rueckzug() owner to cse_definer;
revoke all on function app.entscheidung_nicht_nach_rueckzug() from public;

create trigger entscheidung_nicht_nach_rueckzug
  before insert on einstellungsentscheidung
  for each row execute function app.entscheidung_nicht_nach_rueckzug();
