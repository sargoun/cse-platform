-- ===========================================================================
-- 0422 — Das Nachordnen des Plattformkatalogs schreibt nur noch die
--        Bekanntmachungen an, die eine Plattform bekommen (V-240, RAD-09,
--        D-669 berichtigt)
-- ===========================================================================
-- **Der Befund.** app.radar_plattform_nachordnen (0420) schickte bei JEDER
-- Aenderung am Katalog ALLE Bekanntmachungen ohne Plattform durch den
-- Ausloeser: update ausschreibung set quell_url = quell_url, ohne weitere
-- Bedingung. Jede dieser Zeilen bekam eine neue Fassung und eine Zeilensperre
-- bis zum Ende der Transaktion, auch wenn keine Plattform zu ihr passte. Bei
-- einem grossen TED-Bestand sind das zehntausende Zeilen je Katalogpflege,
-- und der Einlesejob wartet solange auf genau diese Zeilen.
--
-- **Was sich aendert.**
--   1. Die Hostregel steht in zwei kleinen Funktionen:
--      app.radar_url_host (der Host einer Adresse, klein geschrieben, ohne
--      Schema, Pfad und Port) und app.radar_host_passt (gleich oder
--      Unterdomain eines Musters). Beide sind WOERTLICH die Ausdruecke, die
--      der Ausloeser app.ausschreibung_plattform_zuordnen seit 0145 inline
--      trug. Eine zweite Fassung der Hostregel entsteht damit nicht, es gibt
--      danach genau eine.
--   2. app.ausschreibung_plattform_zuordnen (0145) wird ersetzt und ruft die
--      beiden Funktionen. Sonst aendert sich an ihm nichts: dieselbe
--      Reihenfolge (slug), derselbe Hinweis bei fehlender Plattform, dieselbe
--      Ausnahme bei vorhandener Zuordnung oder leerer Adresse.
--   3. app.radar_plattform_nachordnen (0420) wird ersetzt: geschrieben wird
--      nur noch eine Bekanntmachung ohne Plattform, deren Host zu einem
--      Muster einer nicht archivierten Plattform passt. Welche Plattform sie
--      bekommt, entscheidet weiter der Ausloeser. Das Tor bleibt, wie es in
--      0420 stand (Super-Administration, internes Portal, nicht nur lesend),
--      ebenso Eigentuemer, search_path, Rechte und Rueckgabe.
--
-- Keine neuen Tabellen- oder Spaltenrechte: der Definer liest dieselben
-- Spalten wie in 0420 (ausschreibung id, quell_url, vergabeplattform_id;
-- vergabeplattform id, slug, host_muster, archiviert_am) unter denselben
-- d_-Policies.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0421.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die Hostregel — einmal.
-- ---------------------------------------------------------------------------
create function app.radar_url_host(p_url text) returns text
language sql immutable
set search_path = pg_catalog as $$
  select lower(split_part(split_part(regexp_replace(p_url, '^[a-z]+://', ''), '/', 1), ':', 1))
$$;

comment on function app.radar_url_host(text) is
  'V-240, RAD-09: der Host einer Bekanntmachungsadresse, wie ihn der Ausloeser '
  'trg_plattform_zuordnen seit 0145 liest. Leer, wenn die Adresse keinen traegt.';

create function app.radar_host_passt(p_host text, p_muster text[]) returns boolean
language sql immutable
set search_path = pg_catalog as $$
  select coalesce(p_host, '') <> ''
     and exists (select 1 from unnest(p_muster) m
                  where p_host = lower(m) or p_host like '%.' || lower(m))
$$;

comment on function app.radar_host_passt(text, text[]) is
  'V-240, RAD-09: passt ein Host zu einem der Hostmuster einer Plattform - gleich oder '
  'Unterdomain. Dieselbe Regel wie der Ausloeser seit 0145.';

revoke execute on function app.radar_url_host(text) from public;
revoke execute on function app.radar_host_passt(text, text[]) from public;
grant execute on function app.radar_url_host(text) to cse_app, cse_job, cse_definer;
grant execute on function app.radar_host_passt(text, text[]) to cse_app, cse_job, cse_definer;

-- ---------------------------------------------------------------------------
-- 2. Der Ausloeser aus 0145, mit der Hostregel aus Abschnitt 1.
-- ---------------------------------------------------------------------------
-- 0145 legte ihn an; seither hat ihn keine Migration ersetzt. Die Fassung
-- unten ist die aus 0145, nur mit den beiden Funktionsaufrufen an Stelle der
-- inline stehenden Ausdruecke.
create or replace function app.ausschreibung_plattform_zuordnen() returns trigger
language plpgsql as $$
declare
  v_host text;
  v_id   uuid;
begin
  if new.vergabeplattform_id is not null or new.quell_url is null then
    return new;
  end if;
  v_host := app.radar_url_host(new.quell_url);
  if v_host = '' then
    return new;
  end if;
  select p.id into v_id
    from public.vergabeplattform p
   where p.archiviert_am is null
     and app.radar_host_passt(v_host, p.host_muster)
   order by p.slug
   limit 1;
  if v_id is null then
    new.plattform_hinweis := coalesce(new.plattform_hinweis, v_host);
  else
    new.vergabeplattform_id := v_id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Das Nachordnen aus 0420 — nur noch, was eine Plattform bekommt.
-- ---------------------------------------------------------------------------
-- 0420 legte die Funktion an; dies ist ihre zweite Fassung. Unveraendert aus
-- 0420: das Tor (Portal intern, nicht nur lesend, Super-Administration), die
-- Rueckgabe (wie viele jetzt eine Plattform tragen), security definer,
-- search_path, Eigentuemer cse_definer, kein EXECUTE fuer PUBLIC, EXECUTE
-- fuer cse_app. Neu ist allein die Bedingung am update.
create or replace function app.radar_plattform_nachordnen() returns integer
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_anzahl integer;
begin
  if app.portal() is distinct from 'intern' or app.ist_readonly()
     or not app.ist_super_admin() then
    raise exception 'Den Plattformkatalog pflegt die Super-Administration (RAD-09)'
      using errcode = 'insufficient_privilege';
  end if;
  with nachgeordnet as (
    update public.ausschreibung a
       set quell_url = a.quell_url
     where a.vergabeplattform_id is null and a.quell_url is not null
       and exists (select 1 from public.vergabeplattform p
                    where p.archiviert_am is null
                      and app.radar_host_passt(app.radar_url_host(a.quell_url), p.host_muster))
    returning a.vergabeplattform_id
  )
  select count(*) filter (where n.vergabeplattform_id is not null)::integer
    into v_anzahl
    from nachgeordnet n;
  return v_anzahl;
end $$;

comment on function app.radar_plattform_nachordnen() is
  'V-175, V-240, RAD-09, D-669: schickt die Bekanntmachungen ohne Plattform, deren Host zu '
  'einer Plattform des Katalogs passt, noch einmal durch trg_plattform_zuordnen (0145, 0422). '
  'Andere Zeilen werden weder geschrieben noch gesperrt. Gibt die Zahl der jetzt '
  'zugeordneten Bekanntmachungen zurueck.';

alter function app.radar_plattform_nachordnen() owner to cse_definer;
revoke execute on function app.radar_plattform_nachordnen() from public;
grant execute on function app.radar_plattform_nachordnen() to cse_app;
