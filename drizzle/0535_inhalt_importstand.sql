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

-- Den Stand nachzutragen ist keine Aenderung der Seite. Eine Zeile von vor
-- dieser Migration, deren Inhalt dem Seed gleicht, bekommt beim naechsten
-- Import ihren import_stand — ohne ihn hielte der naechste geaenderte Seed die
-- unberuehrte Zeile fuer gepflegt und liesse sie fuer immer stehen.
-- kern.setze_geaendert_am stempelt aber jede Aktualisierung, und
-- seite.geaendert_am ist das lastmod der Sitemap: der Nachtrag stempelte jede
-- alte Seite als heute geaendert. Dieser Ausloeser laeuft nach dem Stempel
-- (die Ausloeser einer Zeile laufen in der Reihenfolge ihrer Namen) und nimmt
-- ihn zurueck, wenn sich ausser import_stand nichts geaendert hat. Den Wert
-- bestimmt weiter die Datenbank (S2): der alte oder now(), nie der Aufrufer.

create function kern.import_stand_ohne_stempel() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if (to_jsonb(new) - 'import_stand' - 'geaendert_am')
     = (to_jsonb(old) - 'import_stand' - 'geaendert_am') then
    new.geaendert_am := old.geaendert_am;
  end if;
  return new;
end $$;

comment on function kern.import_stand_ohne_stempel() is
  'V-386, D-851: eine Aktualisierung, die nur import_stand aendert, behaelt geaendert_am — '
  'der nachgetragene Stand des Inhaltsimports ist keine Aenderung der Seite.';

create trigger trg_seite_import_stand_ohne_stempel
  before update of import_stand on seite
  for each row execute function kern.import_stand_ohne_stempel();
create trigger trg_abschnitt_import_stand_ohne_stempel
  before update of import_stand on abschnitt
  for each row execute function kern.import_stand_ohne_stempel();
