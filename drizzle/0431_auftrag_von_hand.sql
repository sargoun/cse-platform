-- ===========================================================================
-- 0431 — Woher der Auftrag einer Einzelschicht stammt: von Hand genannt oder
--        aus ihrer Leistungszeile abgeleitet (V-192, D-686, TIM-12)
-- ===========================================================================
--
-- **Der Befund.** Eine Einzelschicht kann einen Auftrag auf zwei Wegen
-- tragen: ein Mensch nennt ihn beim Anlegen (die Auftragsauswahl der Maske),
-- oder er folgt aus ihrer Leistungszeile (kern.einsatz_auftrag_ableiten,
-- 0050, 0430). D-685 Nr. 2 behandelt die beiden verschieden: einen GENANNTEN
-- Auftrag behaelt die Schicht, und eine spaeter gewaehlte Zeile muss zu ihm
-- gehoeren; ein ABGELEITETER folgt der Zeile. Die Datenbank wusste aber nicht,
-- welcher Fall vorliegt, und der Dienst riet aus dem Stand: traegt die Schicht
-- eine Zeile, gilt der Auftrag als abgeleitet, sonst als genannt. Nach dem
-- Loesen einer Zeile stand damit ein ABGELEITETER Auftrag ohne Zeile da, der
-- beim naechsten Setzen wie ein genannter galt: die Zeile eines anderen
-- Auftrags wurde abgewiesen, obwohl nie ein Mensch diesen Auftrag genannt
-- hatte.
--
-- **Die Spalte haelt die Herkunft fest.** auftrag_von_hand ist wahr genau
-- dann, wenn ein Mensch den Auftrag in der Maske genannt hat, mit oder ohne
-- Leistungszeile. Dann muss jede spaeter gewaehlte Zeile zu ihm gehoeren, und
-- das Loesen der Zeile laesst ihn stehen. Sonst folgt der Auftrag der Zeile
-- und geht mit ihr. Geschrieben wird die Spalte vom Dienst, der die
-- Einzelschicht anlegt; der Generator und jede Serienschicht lassen sie auf
-- falsch, denn ihr Auftrag kommt immer aus der Zeile.
--
-- **Der Bestand.** Abgeleitet wird ein Auftrag nur aus einer Zeile. Eine von
-- Hand geplante Schicht mit Auftrag und OHNE Zeile hat ihren Auftrag also von
-- einem Menschen. Vor V-191 liess sich an einer Einzelschicht keine Zeile
-- setzen; eine von Hand geplante Schicht mit Zeile gibt es im Bestand nicht.
-- Die Pruefung unten haelt fest, dass ein Auftrag von Hand ein Auftrag ist.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0430.
-- ===========================================================================

alter table einsatz
  add column auftrag_von_hand boolean not null default false;

comment on column einsatz.auftrag_von_hand is
  'V-192, D-686: wahr, wenn ein Mensch den Auftrag dieser Schicht in der Maske genannt hat. '
  'Dann muss eine spaeter gewaehlte Leistungszeile zu ihm gehoeren, und das Loesen der Zeile '
  'laesst ihn stehen. Sonst folgt der Auftrag der Zeile (0050, 0430) und geht mit ihr.';

alter table einsatz
  add constraint einsatz_auftrag_von_hand_hat_auftrag
  check (not auftrag_von_hand or auftrag_id is not null);

update einsatz
   set auftrag_von_hand = true
 where quelle = 'manuell'
   and auftrag_id is not null
   and auftrag_leistung_id is null;
