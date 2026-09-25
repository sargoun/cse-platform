-- ===========================================================================
-- 0467 -- Fotos am Wachbucheintrag: anhaengen beim Schreiben der Seite, lesen
--         mit wachbuch.lesen (V-181, D-675; SEC-05 "with server time and
--         photos", 0041, 0070, 0303)
-- ===========================================================================
--
-- Der Befund (V-181). 0070 hat wachbuch_eintrag eigens in das Register
-- einsatz_medien_bezug eingetragen -- "ohne diese Zeile ... waere SEC-05s
-- mit Fotos unbaubar". Geschrieben hat trotzdem nie jemand ein Medium mit
-- diesem Bezug, und lesen konnte es niemand ausser mit zeit.lesen: die
-- einzigen Policies auf einsatz_medien fragen das Zeitrecht (t_mandant), die
-- Bauweg-Policies (0072, 0082) und die Selbstdokumentation der Schicht
-- (t_selbst_schichtmedien, 0303, nur Bezug einsatz und bautagebuch).
--
-- Die Entscheidung (D-675):
--
--   1. Ein Foto kommt MIT der Seite, nie danach. Die Seite ist anfuegbar und
--      nie aenderbar (0070, Paragraph 34a GewO); ein Bild, das Stunden
--      spaeter an eine alte Seite gehaengt wird, liesse sie aussehen, als
--      haette es von Anfang an dazugehoert. Die Datenbank haelt das fest:
--      angehaengt werden darf nur an eine Seite, die DIESE Transaktion
--      geschrieben hat (erfasst_am = now(), der Stempel aus
--      kern.wachbuch_eintrag_vorbereiten) und deren Urheber der Mensch dieser
--      Sitzung ist. Ein spaeteres Foto ist eine neue Seite -- oder die
--      Richtigstellung, die ihrerseits eine neue Seite ist.
--      Das steht als RESTRIKTIVE Policy (p_wachbuch_medien_mit_seite) und
--      nicht nur in der erlaubenden: t_mandant (0041) laesst mit zeit.schreiben
--      jeden Bezug zu, und erlaubende Policies werden ODER-verknuepft -- eine
--      Leitung mit Zeitrecht haette sonst ein Foto an jede alte Seite gehaengt.
--   2. Schreiben: wer die Seite schreiben darf (wachbuch.schreiben), haengt
--      ihre Fotos an -- die Leitstelle ebenso wie die Wache im
--      Mitarbeiterportal (die Rolle mitarbeiter haelt wachbuch.schreiben,
--      0008). Die Decke p_ma_decke (0041) bleibt: im Portal nur Zeilen, deren
--      erstellt_von_person_id der eigene Mensch ist.
--   3. Lesen: wer das Buch lesen darf (wachbuch.lesen), sieht die Fotos
--      seiner Seiten -- ohne Zeitrecht. Die Wache sieht ihre eigenen
--      Aufnahmen weiter ueber t_person (0041). Die Kundendecke bleibt zu:
--      kunde_pfad ist fuer wachbuch_eintrag NULL (O-78).
--
-- Die Pruefung "diese Transaktion, dieser Mensch" braucht einen Blick auf
-- wachbuch_eintrag, den die Sitzung nicht immer hat: die Rolle mitarbeiter
-- schreibt Seiten, liest sie im Mandantenumfang aber nicht (0008), und eine
-- Pruefung per Unterabfrage faende dort null Zeilen. Deshalb eine
-- Definer-Funktion (K-01): Eigentuemer cse_definer, fester search_path, kein
-- EXECUTE fuer PUBLIC. cse_definer sieht auf wachbuch_eintrag genau die
-- Zeilen DIESER Transaktion (d_wachbuch_foto_seite) und genau vier Spalten.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie in 0417.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Was cse_definer dafuer liest
-- ---------------------------------------------------------------------------

grant select (id, mandant_id, person_id, erfasst_am) on wachbuch_eintrag to cse_definer;

create policy d_wachbuch_foto_seite on wachbuch_eintrag
  for select to cse_definer
  using (erfasst_am = now());

comment on policy d_wachbuch_foto_seite on wachbuch_eintrag is
  'app.wachbuch_seite_eben_geschrieben (0467, V-181): nur die Seiten, die die laufende '
  'Transaktion geschrieben hat -- erfasst_am stempelt kern.wachbuch_eintrag_vorbereiten mit now().';

-- ---------------------------------------------------------------------------
-- 2. Die Funktion
-- ---------------------------------------------------------------------------

create function app.wachbuch_seite_eben_geschrieben(p_eintrag uuid, p_mandant uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
      from public.wachbuch_eintrag w
     where w.id = p_eintrag
       and w.mandant_id = p_mandant
       and w.erfasst_am = now()
       and w.person_id is not null
       and w.person_id = app.aktuelle_person());
$$;

comment on function app.wachbuch_seite_eben_geschrieben(uuid, uuid) is
  'V-181, D-675: true, wenn die Wachbuchseite in DIESER Transaktion vom Menschen dieser Sitzung '
  'geschrieben wurde. Traegt t_wachbuch_medien: ein Foto kommt mit der Seite, nie danach.';

alter function app.wachbuch_seite_eben_geschrieben(uuid, uuid) owner to cse_definer;
revoke all on function app.wachbuch_seite_eben_geschrieben(uuid, uuid) from public;
grant execute on function app.wachbuch_seite_eben_geschrieben(uuid, uuid) to cse_app;

-- ---------------------------------------------------------------------------
-- 3. Die Policies auf einsatz_medien
-- ---------------------------------------------------------------------------

create policy t_wachbuch_medien on einsatz_medien for insert to cse_app
with check (
  mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and bezug_tabelle = 'wachbuch_eintrag'
  and erstellt_von_art = 'mensch'
  and erstellt_von_person_id = app.aktuelle_person()
  and archiviert_am is null
  and storage_geloescht_am is null
  and (select app.hat_recht('wachbuch.schreiben', app.aktiver_mandant()))
  and app.wachbuch_seite_eben_geschrieben(bezug_id, mandant_id)
);

comment on policy t_wachbuch_medien on einsatz_medien is
  'SEC-05 (0467, V-181): ein Foto an einer Wachbuchseite -- nur mit wachbuch.schreiben und nur an '
  'einer Seite, die diese Transaktion vom Menschen dieser Sitzung geschrieben hat.';

create policy t_wachbuch_medien_lesen on einsatz_medien for select to cse_app
using (
  mandant_id = app.aktiver_mandant()
  and bezug_tabelle = 'wachbuch_eintrag'
  and (select app.hat_recht('wachbuch.lesen', app.aktiver_mandant()))
);

comment on policy t_wachbuch_medien_lesen on einsatz_medien is
  'SEC-05 (0467, V-181): die Fotos der Wachbuchseiten fuer die, die das Buch lesen -- ohne '
  'Zeitrecht. Die Decken p_ma_decke und p_kunde_decke (0041) bleiben.';

-- ---------------------------------------------------------------------------
-- 4. Die Sperre, die fuer JEDEN Schreibweg der Sitzung gilt
-- ---------------------------------------------------------------------------
--
-- Restriktiv, also UND-verknuepft mit allen erlaubenden Policies: auch wer
-- ueber t_mandant (zeit.schreiben) schreiben darf, haengt ein Foto mit Bezug
-- wachbuch_eintrag nur an die Seite, die diese Transaktion geschrieben hat.
-- Andere Bezuege beruehrt sie nicht.

create policy p_wachbuch_medien_mit_seite on einsatz_medien as restrictive for insert to cse_app
with check (
  bezug_tabelle <> 'wachbuch_eintrag'
  or app.wachbuch_seite_eben_geschrieben(bezug_id, mandant_id)
);

comment on policy p_wachbuch_medien_mit_seite on einsatz_medien is
  'SEC-05 (0467, V-181): ein Foto kommt mit der Wachbuchseite, nie danach -- fuer jeden '
  'Schreibweg der Sitzung, auch den ueber zeit.schreiben (t_mandant, 0041).';
