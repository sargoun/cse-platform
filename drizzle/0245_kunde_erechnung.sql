-- 0245 — `kunde.uebertragungsweg` und `kunde.rechnungsformat`:
-- der Weg und die Form, in der eine Rechnung beim Kaeufer ankommt
-- (FIN-11, LEG-05, 04-SEITENKARTE §5.3, 02-datenmodell/05-FINANZEN §700/§906).
--
-- ===========================================================================
-- Was heute fehlt und was es kostet
-- ===========================================================================
--
-- `rechnung_versand` (0181) traegt den Weg SCHON als `kanal uebertragungsweg`
-- — je Versandversuch. Was nirgends steht, ist der Weg des KAEUFERS: welcher
-- Kanal fuer diesen Auftraggeber verabredet ist, bevor der erste Versand
-- entsteht. Die Folge ist keine Fehlermeldung, sondern eine Frage, die ein
-- Mensch jedes Mal neu am Telefon klaert — und beim zweiten Mal anders.
--
-- `07-INTEGRATIONEN.md` §12.1 verlangt dazu ausdruecklich eine SPERRE und
-- keinen Rueckfall: „a buyer with `xrechnung_pflicht` and no
-- `uebertragungsweg` **blocks** FIN-11 dispatch instead of defaulting". Ein
-- Vorgabekanal waere hier der teure Fehler: eine XRechnung, die statt an
-- OZG-RE per E-Mail hinausgeht, gilt als nicht zugestellt — die Frist laeuft,
-- und niemand sieht es, weil der Versand „erfolgreich" war.
--
-- **Die Sperre steht NICHT als CHECK auf dieser Tabelle.** Ein
-- `check (not xrechnung_pflicht or uebertragungsweg is not null)` haette jeden
-- der heute vorhandenen Behoerdenkunden unspeicherbar gemacht und damit die
-- Pflege genau der Angabe verhindert, die er erzwingen will. Gesperrt wird der
-- VERSAND, nicht die Zeile; die Bedingung steht als geprueftes Praedikat in
-- `server/services/crm/erechnung.ts` und wird auf dem Steuerblatt des Kunden
-- angezeigt.
--
-- ===========================================================================
-- Die zwei Enums
-- ===========================================================================
--
-- `uebertragungsweg` EXISTIERT schon (0181, Zeile 54) und wird hier
-- wiederverwendet — kein zweites Vokabular fuer dieselbe Sache (§12.1
-- ausdruecklich). `rechnungsformat` ist neu und uebernimmt WOERTLICH die
-- Deklaration aus `02-datenmodell/02-CRM-OPERATIONS.md` §646:
-- `('xrechnung_ubl','zugferd','pdf')`. Kein `xrechnung_cii`: FIN-11 baut das
-- UBL-Profil, und ein Enumwert, der ein nicht gebautes Format benennt, ist ein
-- Versprechen, das der Renderer nicht halten kann (05-FINANZEN §906).
--
-- Welcher Weg und welches Format je oeffentlichem Auftraggeber gilt, ist
-- offen — und wird hier NICHT geraten:
-- TODO(client, O-22): Welche Leitweg-ID, welcher Uebertragungsweg (OZG-RE,
-- ZRE, Landesportal, Peppol, E-Mail) und welches Format je oeffentlichem
-- Auftraggeber? Bis zur Antwort bleiben beide Spalten NULL, und der Versand
-- eines Pflichtkaeufers ohne Weg ist gesperrt statt geraten.

create type rechnungsformat as enum ('xrechnung_ubl', 'zugferd', 'pdf');

comment on type rechnungsformat is
  'Die Form der Rechnung beim Kaeufer (05-FINANZEN §906). CII fehlt absichtlich: '
  'FIN-11 baut UBL, und ein Wert fuer ein nicht gebautes Format ist ein '
  'Versprechen ohne Renderer.';

alter table kunde
  add column uebertragungsweg uebertragungsweg,
  add column rechnungsformat  rechnungsformat;

comment on column kunde.uebertragungsweg is
  'Der verabredete Zustellweg dieses Kaeufers. NULL heisst NICHT „E-Mail", '
  'sondern „nicht verabredet" (O-22): ein Pflichtkaeufer ohne Weg sperrt den '
  'FIN-11-Versand (07-INTEGRATIONEN §12.1). peppol/zre/ozg_re sind nicht '
  'verbunden und in der Oberflaeche so bezeichnet.';

comment on column kunde.rechnungsformat is
  'Das verabredete Rechnungsformat dieses Kaeufers. NULL heisst „nicht '
  'verabredet" (O-22), nicht „PDF".';

-- ---------------------------------------------------------------------------
-- Die Rechte — und warum hier ein SELECT ausgeschrieben steht
-- ---------------------------------------------------------------------------
--
-- `kunde` hat fuer `cse_app` KEIN Tabellen-SELECT (K-05: der Entzug ist
-- spaltenweise, und das Erteilen ist es deshalb auch). INSERT und UPDATE sind
-- Tabellenrechte und decken neue Spalten von selbst; SELECT muss je Spalte
-- erteilt werden. Ohne diese Zeile waere jede Abfrage, die den
-- Uebertragungsweg liest, ein `42501` — und zwar erst zur Laufzeit, auf der
-- Seite, die ihn anzeigen soll.
--
-- Diese zwei Spalten gehoeren NICHT in den entzogenen Block: sie sind keine
-- Kondition und kein Entgelt, sondern eine Zustelladresse. Wer den Kunden
-- sehen darf, darf sehen, wohin seine Rechnung geht.
grant select (uebertragungsweg, rechnungsformat) on kunde to cse_app;

-- Die Luecke, die FIN-11 sperrt — als Index, damit ein Bericht sie findet,
-- ohne jede Kundenzeile zu lesen. `kunde_fin11_luecken_idx` (0020) deckt die
-- fehlende Leitweg-ID; dies deckt den fehlenden WEG, und das ist ein anderer
-- Mangel: eine Leitweg-ID ohne Kanal ist eine Adresse ohne Zusteller.
create index kunde_weg_luecken_idx on kunde (mandant_id)
  where xrechnung_pflicht and uebertragungsweg is null and archiviert_am is null;
