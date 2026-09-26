-- ===========================================================================
-- 0469 -- Ein Medium wechselt seinen Bezug nie (V-184, D-678; V-181, D-675,
--         SEC-05, TIM-10, 0041, 0467)
-- ===========================================================================
--
-- Der Befund (Pruefung der Gruppe einsatz, V-184). D-675 Punkt 1 sagt: ein
-- Foto kommt MIT der Wachbuchseite, nie danach -- "die Datenbank haelt das
-- fest". Gehalten hat sie es nur fuer INSERT: p_wachbuch_medien_mit_seite
-- (0467) ist eine restriktive Policy FOR INSERT. t_mandant auf einsatz_medien
-- (0041) gilt FOR ALL, cse_app haelt seit 0041 update auf der ganzen Tabelle,
-- und kein Ausloeser verbot eine Aenderung von bezug_tabelle oder bezug_id:
-- kern.einsatz_medien_bezug_pruefen prueft nur, ob der neue Elternteil im
-- selben Mandanten existiert. Eine Leitung mit zeit.schreiben konnte damit
--
--   update einsatz_medien set bezug_tabelle = 'wachbuch_eintrag',
--          bezug_id = <Seite von gestern> where id = <Schichtfoto>
--
-- absetzen -- UPDATE 1 --, ebenso ein Seitenfoto von Seite A auf Seite B
-- schieben. Das Wachbuchblatt zeigte das umgehaengte Foto danach als Teil der
-- alten Seite. Genau den Angreifer, den D-675 nennt ("Leitung mit Zeitrecht
-- haengt ein Foto an eine alte Seite"), hielt die Datenbank nur auf einem der
-- zwei Wege auf.
--
-- Die Entscheidung (D-678):
--
--   1. Der Bezug eines Mediums ist unveraenderlich -- fuer JEDEN Bezug, nicht
--      nur das Wachbuch. Ein Foto ist der Beleg der Zeile, an der es haengt
--      (Schicht, Wachbuchseite, Bautag, Leistungsnachweis, Aufmass); an eine
--      andere gehaengt, ist es an beiden Stellen ein falscher Beleg. Ein
--      falsch zugeordnetes Foto wird archiviert und neu aufgenommen, wie jede
--      andere Korrektur im Haus.
--   2. Ein BEFORE-UPDATE-Ausloeser und keine Policy: eine Policy sieht nur die
--      neue Zeile und kann alt und neu nicht vergleichen. Der Ausloeser gilt
--      fuer jede Rolle, auch cse_definer, cse_job und den Eigentuemer.
--   3. Kein Weg der Anwendung aendert den Bezug heute (grep: kein update auf
--      einsatz_medien in src, keine Funktion in drizzle). Die Sperre nimmt
--      also nichts weg, was funktioniert; sie schliesst den Weg, bevor ihn ein
--      spaeterer Bearbeitungsweg (etwa fuer die Beschreibung) still oeffnet.
--
-- Der Ausloeser ist KEIN security definer: er liest nichts, er vergleicht nur
-- alte und neue Zeile. Er feuert nur, wenn eine der beiden Spalten im SET
-- steht, und vor trg_medien_1_bezug_pruefen (Namensfolge), damit ein
-- verbotenes Umhaengen nicht erst den neuen Elternteil sucht.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie in 0417.
-- ===========================================================================

create function kern.einsatz_medien_bezug_fest() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if (new.bezug_tabelle, new.bezug_id) is distinct from (old.bezug_tabelle, old.bezug_id) then
    raise exception 'Ein Medium wechselt seinen Bezug nicht (V-184, D-678)'
      using errcode = 'P0001',
            detail  = format('Medium %s haengt an %s %s.', old.id, old.bezug_tabelle, old.bezug_id),
            hint    = 'Ein Foto ist der Beleg der Zeile, an der es haengt. Ein falsch '
                      || 'zugeordnetes wird archiviert und neu aufgenommen, an eine '
                      || 'Wachbuchseite nur zusammen mit ihr (D-675).';
  end if;
  return new;
end $$;

comment on function kern.einsatz_medien_bezug_fest() is
  'V-184, D-678: bezug_tabelle und bezug_id eines Mediums sind unveraenderlich. Damit gilt '
  'die Wachbuchzusage aus D-675 (ein Foto kommt mit der Seite, nie danach) auch fuer UPDATE, '
  'nicht nur fuer INSERT (0467).';

create trigger trg_medien_0_bezug_fest
  before update of bezug_tabelle, bezug_id on einsatz_medien
  for each row execute function kern.einsatz_medien_bezug_fest();
