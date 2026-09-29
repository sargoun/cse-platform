-- ===========================================================================
-- 0468 -- Der Nachtlauf wetter_zuordnung darf das Wetter an offene Bautage
--         heften (V-183, D-677; BAU-08, 03-GEWERKE 13.2, 0082, 0083)
-- ===========================================================================
--
-- Der Befund (V-183). BAU-08 verlangt, dass das Wetter AUTOMATISCH am Bautag
-- haengt. hefteWetterAn lief nur auf Knopfdruck; einen Lauf gab es nicht, und
-- cse_job hatte auf bautagebuch und projekt weder ein Spaltenrecht noch eine
-- Policy -- ein Lauf haette nicht einmal den Tag gefunden.
--
-- Was diese Migration dazugibt, ist genau der Weg des Laufs und nichts
-- daneben:
--
--   1. Lesen: die Spalten, die hefteWetterAn und die Kandidatenliste lesen --
--      auf bautagebuch und projekt (objekt liest cse_job seit langem, geo_lat
--      und geo_lon eingeschlossen). Beide Policies an app.aktiver_mandant()
--      gebunden: der Lauf ist je_mandant und sieht nur die Tage der
--      Gesellschaft, deren Sitzung alsJobSitzung gebunden hat.
--   2. Schreiben: NUR die Wetterspalten und die Spur geaendert_von /
--      geaendert_von_art. Die Policy j_wetter_anheften laesst nur einen Tag
--      zu, der offen ist, nicht storniert, und noch KEIN Wetter traegt
--      (wetter_quelle = 'keine') -- ein von Hand eingetragenes oder schon
--      angeheftetes Wetter ueberschreibt der Lauf nie, auch nicht, wenn es
--      zwischen seinem Lesen und seinem Schreiben entsteht. Geschrieben wird
--      nur Wetter aus der Quelle: with check wetter_quelle = 'dwd'.
--   3. Ein abgeschlossener Tag bleibt draussen. 0082 sagt: ab dem Abschluss
--      bewegt sich nichts mehr. Ob das Wetter davon ausgenommen ist, weil es
--      erst nach dem Abschluss vollstaendig vorliegt, ist eine Frage an die
--      Gesellschaft (O-922), keine, die diese Migration beantwortet.
--
-- Keine Definer-Funktion: die Beobachtungen selbst uebernimmt weiter
-- app.wetter_beobachtung_uebernehmen (0083), die cse_job ausfuehren darf.
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie in 0417.
-- ===========================================================================

grant select (id, mandant_id, projekt_id, datum, abgeschlossen_am, storniert_am, wetter_quelle)
  on bautagebuch to cse_job;
grant update (wetter_quelle, wetter_frueh_id, wetter_mittag_id, wetter_abend_id,
              wetter_snapshot, temperatur_min_c, temperatur_max_c, niederschlag_mm,
              geaendert_von, geaendert_von_art)
  on bautagebuch to cse_job;
grant select (id, mandant_id, objekt_id, wetter_station_id) on projekt to cse_job;

create policy j_wetter_lesen on bautagebuch for select to cse_job
using (mandant_id = app.aktiver_mandant());

comment on policy j_wetter_lesen on bautagebuch is
  'BAU-08 (0468, V-183): der Nachtlauf wetter_zuordnung liest die Bautage der Gesellschaft, '
  'deren Sitzung er gebunden hat.';

create policy j_wetter_anheften on bautagebuch for update to cse_job
using (
  mandant_id = app.aktiver_mandant()
  and abgeschlossen_am is null
  and storniert_am is null
  and wetter_quelle = 'keine'
)
with check (
  mandant_id = app.aktiver_mandant()
  and abgeschlossen_am is null
  and storniert_am is null
  and wetter_quelle = 'dwd'
);

comment on policy j_wetter_anheften on bautagebuch is
  'BAU-08 (0468, V-183): der Nachtlauf heftet DWD-Wetter an einen offenen, nicht stornierten '
  'Bautag ohne Wetter. Vorhandenes Wetter, ob angeheftet oder von Hand, ueberschreibt er nie.';

create policy j_wetter_projekt on projekt for select to cse_job
using (mandant_id = app.aktiver_mandant());

comment on policy j_wetter_projekt on projekt is
  'BAU-08 (0468, V-183): Objekt und DWD-Station des Projekts fuer den Nachtlauf wetter_zuordnung.';
