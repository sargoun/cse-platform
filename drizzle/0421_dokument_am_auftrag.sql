-- ===========================================================================
-- 0421 — Ein Dokument haengt an einem Auftrag (V-176, OPS-11, D-670)
-- ===========================================================================
-- **Der Befund.** OPS-11 verlangt Aufgaben, Fristen, Stand und Dokumente an
-- jedem Auftrag und jedem Projekt. dokument kannte seit 0009 nur kunde_id,
-- objekt_id und formular_eingang_id. Ein Vertrag, ein Leistungsverzeichnis
-- oder ein Abnahmeprotokoll liess sich damit nur an den Kunden oder das
-- Objekt haengen, und am Auftrag stand nichts davon. Das einzige spaetere
-- alter table dokument add war entstanden_am (0141).
--
-- **Was diese Migration anlegt.**
--   1. dokument.auftrag_id mit einem ZUSAMMENGESETZTEN Fremdschluessel
--      (mandant_id, auftrag_id) auf auftrag (mandant_id, id): ein Dokument
--      kann nur an einem Auftrag DERSELBEN Gesellschaft haengen, auch wenn
--      jemand am Ablagedienst vorbeischreibt. Anders als kunde_id und
--      objekt_id (0009, ohne Fremdschluessel) steht das Ziel heute fest.
--   2. Einen Teilindex auf genau die Frage des Auftragsblatts.
--
-- Die Rechte aendern sich nicht: cse_app haelt auf dokument Tabellenrechte
-- (0009), die neue Spalte ist darin enthalten, und die Policies t_mandant,
-- p_kunde_ceiling und p_ma_ceiling gelten fuer sie wie fuer jede Spalte. Ein
-- Bau-Projekt zeigt die Dokumente seines Auftrags: projekt.auftrag_id ist
-- seit 0071 NOT NULL und eindeutig, das Projekt IST die Bauakte genau eines
-- Auftrags. Eine eigene Projektspalte waere eine zweite Ablage derselben
-- Akte, und ein Dokument koennte an der einen haengen und an der anderen
-- fehlen.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0420.
-- ===========================================================================

alter table dokument add column auftrag_id uuid;

alter table dokument
  add constraint dokument_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id);

comment on column dokument.auftrag_id is
  'V-176, OPS-11, D-670. Der Auftrag, an dem das Dokument haengt, oder NULL. Zusammengesetzter '
  'Fremdschluessel mit mandant_id: nur ein Auftrag derselben Gesellschaft.';

create index dokument_auftrag_idx on dokument (mandant_id, auftrag_id)
  where auftrag_id is not null and geloescht_am is null;
