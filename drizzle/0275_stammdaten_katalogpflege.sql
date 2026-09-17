-- 0275 — der PLATTFORM-Zweig der beiden Personal-Kataloge
--        (`abwesenheitsart`, `antragsart`; K-17, EMP-05, EMP-10, O-139, O-142,
--        01-KERN §6.22/§6.28).
--
-- ===========================================================================
-- Der Befund, der diese Migration gebracht hat
-- ===========================================================================
--
-- `/portal/[mandant]/stammdaten/abwesenheitsarten` und
-- `/portal/[mandant]/stammdaten/antragsarten` sollen die beiden Kataloge
-- PFLEGEN. Mit den Policies von 0073/0074 kann das niemand — nicht nur „der
-- Mandanten-Admin nicht":
--
--  1. `t_katalog_pflege` ist auf beiden Tabellen die EINZIGE Schreibpolicy,
--     und sie verlangt `mandant_id = app.aktiver_mandant()`. Alle sieben
--     Abwesenheitsarten und alle drei Antragsarten stehen aber mit
--     `mandant_id IS NULL` da — sie kommen mit der Migration und gehoeren der
--     Plattform.
--  2. Beide Tabellen laufen mit `force row level security`, und `cse_app`
--     haelt nur `select, insert, update`. Es gibt also keinen Weg daran
--     vorbei, auch nicht fuer den Eigentuemer.
--
-- Folge: `abwesenheitsart.bezahlt` steht bei ALLEN sieben Zeilen auf NULL
-- („ungeklaert", O-139, ausdruecklich ohne Default), und
-- `src/server/services/abwesenheit/index.ts` weist die Verwendung einer
-- solchen Art mit `ArtUngeklaertFehler` ab. Die Antwort des Kunden auf O-139
-- war damit durch KEINE Oberflaeche eintragbar — nur „direkt in der
-- Datenbank", und genau das ist die Luecke, die geschlossen werden soll.
--
-- ===========================================================================
-- Die Entscheidung: derselbe Zweig, den `qualifikation` schon hat
-- ===========================================================================
--
-- `qualifikation` ist der dritte zweistufige Katalog des Hauses und traegt die
-- Antwort seit 0030: `q_schreiben`/`q_aendern` erlauben eine Zeile mit
-- `mandant_id IS NULL` genau dann, wenn `app.ist_super_admin()` gilt
-- (01-KERN §6.16, „Plattformweite Katalogzeilen nur Super-Admin"). Diese
-- Migration setzt fuer die beiden Personal-Kataloge dasselbe Muster — sie
-- erfindet keine Regel, sondern zieht die vorhandene nach.
--
-- Was sich dadurch NICHT aendert, und das ist der wichtigere Teil:
--
--  · `t_katalog_pflege` bleibt unberuehrt. Ein Mandanten-Admin pflegt weiter
--    genau seine eigenen Zeilen und keine fremde.
--  · `app.ist_super_admin()` verlangt `aal2` (0004). Eine Sitzung ohne
--    zweiten Faktor ist hier kein Super-Admin, auch wenn das Konto die
--    globale Rolle traegt.
--  · `not app.ist_readonly()`: in der Gruppenansicht wird nichts gepflegt
--    (Invariante 10).
--  · `antragsart.ist_system` bleibt gesperrt — fuer JEDEN. Die drei Arten aus
--    EMP-10 (`urlaub`, `krankmeldung`, `schichttausch`) haengen an
--    `kern.antrag_pflichtfelder` und `kern.antrag_erzeugt_abwesenheit`; sie
--    umzubenennen oder ihre Schalter zu drehen aendert die Kette
--    Antrag → Abwesenheit, und die ist §-gebunden. Neue Arten sind das, was
--    O-142 offen hat, nicht die Umdeutung der drei vorhandenen.
--  · Kein DELETE. Beide Tabellen tragen `kern.verhindere_loeschung` und
--    keinem Rolle ist `delete` gewaehrt (Invariante 8); Ende einer Art ist
--    `archiviert_am`.
--
-- NICHT in dieser Migration: die Kollisionssperre zwischen Plattform- und
-- Mandantenzeile (0276) und der Historienleser fuer `belagsart` (0277).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- abwesenheitsart — Plattformzeilen fuer den Super-Admin
-- ---------------------------------------------------------------------------

/**
 * Getrennt nach INSERT und UPDATE, nicht `for all`.
 *
 * Eine `for all`-Policy truege ihr `using` auch in das SELECT der Seite und
 * machte die Sichtbarkeit des Katalogs von der Rolle abhaengig — `t_katalog`
 * laesst jede Sitzung den Katalog LESEN, und das ist richtig: ohne ihn stehen
 * im Antragsformular UUIDs. Gepflegt wird er von einem, gelesen von allen.
 */
create policy t_plattform_anlegen on abwesenheitsart for insert to cse_app
  with check (mandant_id is null
              and not app.ist_readonly()
              and app.ist_super_admin());

create policy t_plattform_aendern on abwesenheitsart for update to cse_app
  using      (mandant_id is null and app.ist_super_admin())
  with check (mandant_id is null
              and not app.ist_readonly()
              and app.ist_super_admin());

-- ---------------------------------------------------------------------------
-- antragsart — dasselbe, und `ist_system` bleibt draussen
-- ---------------------------------------------------------------------------

/**
 * `not ist_system` steht im `with check` UND im `using` des UPDATE.
 *
 * Nur im `with check` haette den Super-Admin die Systemzeile bearbeiten
 * lassen, solange er nichts daran aendert — und ihn beim Speichern mit „new
 * row violates row-level security policy" abgewiesen. Im `using` ist die Zeile
 * fuer den Schreibweg von vornherein unsichtbar, und der Dienst kann davor
 * einen Satz sagen, den ein Mensch versteht.
 */
create policy t_plattform_anlegen on antragsart for insert to cse_app
  with check (mandant_id is null
              and not ist_system
              and not app.ist_readonly()
              and app.ist_super_admin());

create policy t_plattform_aendern on antragsart for update to cse_app
  using      (mandant_id is null and not ist_system and app.ist_super_admin())
  with check (mandant_id is null
              and not ist_system
              and not app.ist_readonly()
              and app.ist_super_admin());

comment on table abwesenheitsart is
  'K-17: der bearbeitbare Katalog der Abwesenheitsgruende. Kein Enum, weil das '
  'Vokabular lohnwirksam ist und der Kunde es aendern koennen muss. '
  'Zweistufig: mandant_id IS NULL ist der Plattformkatalog und wird nur vom '
  'Super-Admin gepflegt (0275), mandanteigene Zeilen mit '
  'stammdaten.verwalten (0073).';

comment on table antragsart is
  'K-17: der bearbeitbare Katalog der Antragsarten. Was eine Art verlangt, '
  'steht als Spalte — nicht als CASE ueber Enum-Namen. ist_system-Zeilen sind '
  'fuer JEDEN unveraenderlich (EMP-10); mandanteigene Zeilen tragen '
  'stammdaten.verwalten, Plattformzeilen den Super-Admin (0275).';
