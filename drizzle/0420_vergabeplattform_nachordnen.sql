-- ===========================================================================
-- 0420 — Eine neu eingetragene Vergabeplattform ordnet die Bekanntmachungen
--        nach, die schon da sind (V-175, RAD-09, D-669)
-- ===========================================================================
-- **Der Befund.** vergabeplattform und mandant_plattform_registrierung
-- hatten seit 0145 Schema, RLS und Schreibrechte, aber keinen Dienst, der sie
-- schrieb. Der Katalog kommt mit Absicht leer (O-07, D-490). Nur liess sich
-- die Antwort auf O-07 nie eintragen, und damit blieb
-- ausschreibung.vergabeplattform_id immer NULL. Die Warnung „nicht
-- freigeschaltet" in Liste, Kennzahl und Detailblatt konnte nie ausloesen.
--
-- **Was hier fehlt, wenn der Dienst kommt.** Der Ausloeser
-- trg_plattform_zuordnen (0145) ordnet eine Bekanntmachung ihrer Plattform
-- zu, wenn sie eingelesen wird oder ihre quell_url sich aendert. Eine
-- Plattform, die die Super-Administration HEUTE eintraegt, erreicht damit nur
-- Bekanntmachungen von morgen. Die schon eingelesenen blieben ohne Plattform,
-- und genau bei ihnen laeuft die Frist schon. cse_app darf ausschreibung nur
-- lesen (0145), und das bleibt so: eine Bekanntmachung schreibt der
-- Einlesejob.
--
-- **Was diese Migration anlegt.**
--   1. app.radar_plattform_nachordnen(): ein Definer, der fuer die
--      Super-Administration im internen Portal die Bekanntmachungen OHNE
--      Plattform noch einmal durch denselben Ausloeser schickt. Eine zweite
--      Fassung der Hostregel gibt es nicht: der Definer setzt quell_url auf
--      sich selbst, und trg_plattform_zuordnen entscheidet wie beim Einlesen.
--      Eine vorhandene Zuordnung bleibt, wie sie ist (derselbe Ausloeser
--      greift nur bei leerer Spalte).
--   2. Die Rechte dafuer, eng geschnitten: cse_definer liest vier Spalten von
--      ausschreibung und schreibt genau eine (quell_url, auf ihren eigenen
--      Wert), und nur an Zeilen ohne Plattform. An vergabeplattform liest er
--      die vier Spalten, die der Ausloeser fragt.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0410.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Was der Definer sehen und schreiben darf.
-- ---------------------------------------------------------------------------
grant execute on function app.ist_super_admin() to cse_definer;

grant select (id, quell_url, vergabeplattform_id, plattform_hinweis)
      on ausschreibung to cse_definer;
grant update (quell_url) on ausschreibung to cse_definer;
grant select (id, slug, host_muster, archiviert_am) on vergabeplattform to cse_definer;

-- Die Lesepolicies haengen am selben Tor wie die Funktion: nur in einer
-- Sitzung der Super-Administration liest cse_definer hier ueberhaupt etwas.
-- Sie stehen als Unterabfrage, damit die Pruefung einmal je Anweisung laeuft
-- und nicht einmal je Zeile.
create policy d_ausschreibung_nachordnen_lesen on ausschreibung for select to cse_definer
  using ((select app.ist_super_admin()));
create policy d_ausschreibung_nachordnen on ausschreibung for update to cse_definer
  using      (vergabeplattform_id is null and (select app.ist_super_admin()))
  with check ((select app.ist_super_admin()));
create policy d_plattform_nachordnen_lesen on vergabeplattform for select to cse_definer
  using (archiviert_am is null and (select app.ist_super_admin()));

-- ---------------------------------------------------------------------------
-- 2. Das Nachordnen.
-- ---------------------------------------------------------------------------
-- Gibt zurueck, wie viele Bekanntmachungen jetzt eine Plattform tragen. Das
-- Tor steht in der Funktion UND in den Policies: fehlt eines, haelt das
-- andere.
create function app.radar_plattform_nachordnen() returns integer
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
    returning a.vergabeplattform_id
  )
  select count(*) filter (where n.vergabeplattform_id is not null)::integer
    into v_anzahl
    from nachgeordnet n;
  return v_anzahl;
end $$;

comment on function app.radar_plattform_nachordnen() is
  'V-175, RAD-09, D-669: schickt die Bekanntmachungen ohne Plattform noch einmal durch '
  'trg_plattform_zuordnen (0145), nachdem die Super-Administration den Katalog gepflegt hat. '
  'Gibt die Zahl der jetzt zugeordneten Bekanntmachungen zurueck.';

alter function app.radar_plattform_nachordnen() owner to cse_definer;
revoke execute on function app.radar_plattform_nachordnen() from public;
grant execute on function app.radar_plattform_nachordnen() to cse_app;
