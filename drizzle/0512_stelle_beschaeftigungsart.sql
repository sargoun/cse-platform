-- 0512 — eine Stelle fuehrt ihre Beschaeftigungsart (V-362, O-200, D-816).
--
-- stelle (0166) kannte wochenstunden, aber weder Vollzeit noch Teilzeit,
-- Minijob oder Aushilfe; der Anzeigentext musste es sagen, und die
-- Stellenboersen fragen danach (O-374). Voreinstellung zu O-200 (D-797): das
-- Vokabular Vollzeit, Teilzeit, Minijob, Aushilfe.
--
-- Die Spalte ist nullbar: NULL heisst "nicht festgelegt", wie bei
-- wochenstunden — eine Anzeige ohne Angabe ist keine Vollzeitstelle. Die
-- Vorschlagsregel aus den Wochenstunden steht im Dienst
-- (recruiting/beschaeftigungsart.ts), nicht hier: gespeichert wird, was ein
-- Mensch waehlt.
--
-- cse_app haelt auf stelle Tabellenrechte (0166), die neue Spalte ist damit
-- lesbar und schreibbar wie die uebrigen; die Policies bleiben, wie sie sind.
--
-- Nur Kommentare mit Doppelstrich.

create type beschaeftigungsart as enum ('vollzeit', 'teilzeit', 'minijob', 'aushilfe');

alter table stelle add column beschaeftigungsart beschaeftigungsart;

comment on column stelle.beschaeftigungsart is
  'V-362, O-200, D-816: Vollzeit, Teilzeit, Minijob oder Aushilfe; NULL heisst nicht '
  'festgelegt. Gespeichert wird die Wahl eines Menschen, der Vorschlag aus den '
  'Wochenstunden steht im Dienst.';
