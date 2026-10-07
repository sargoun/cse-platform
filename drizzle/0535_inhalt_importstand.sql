-- 0535 — Der Inhaltsimport merkt sich, was er geschrieben hat, und laesst
--        eine Pflege im Portal stehen (V-386, O-207, D-802, D-851, PUB-08)
--
-- Der Befund: importiere() verglich jeden Abschnitt mit dem Seed und schrieb
-- den Seed, wo der Text abwich. Einen im Portal gepflegten Abschnitt konnte er
-- von einem veralteten nicht unterscheiden — `pnpm content:import` setzte die
-- Pflege des Betreibers zurueck, und seine Ausgabe musste das sagen.
--
-- import_stand haelt fest, was der Import zuletzt geschrieben hat (Seite:
-- Titel und Beschreibung; Abschnitt: Ueberschrift, Akzentwort, Text, Daten).
-- Weicht der heutige Stand davon ab, hat jemand ausserhalb des Imports
-- geaendert — der Import laesst ihn stehen und nennt ihn. Erst
-- `--ueberschreiben` setzt ausdruecklich zurueck.
--
-- Kein Rueckfuellen: was vor dieser Migration im Portal gepflegt wurde, kann
-- die Datenbank nicht wissen. Eine Zeile ohne import_stand, deren Inhalt vom
-- Seed abweicht, behandelt der Import deshalb wie eine gepflegte — stehen
-- lassen und nennen ist der Fehler ohne Datenverlust.
--
-- Nur Kommentare mit Doppelstrich.

alter table seite add column import_stand jsonb;
alter table abschnitt add column import_stand jsonb;

comment on column seite.import_stand is
  'V-386, D-851: Titel und Beschreibung, wie der Inhaltsimport sie zuletzt geschrieben hat. '
  'Weicht die Zeile davon ab, wurde sie im Portal gepflegt — der Import laesst sie stehen.';
comment on column abschnitt.import_stand is
  'V-386, D-851: Ueberschrift, Akzentwort, Text und Daten, wie der Inhaltsimport sie zuletzt '
  'geschrieben hat. Weicht der Abschnitt davon ab, wurde er im Portal gepflegt — der Import '
  'laesst ihn stehen.';
