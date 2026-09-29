-- ===========================================================================
-- 0472 — Eine Bewerbung aus dem Postfach, mit oder ohne Stelle
--        (REC-03, REC-07, V-224, D-718)
-- ===========================================================================
-- **Der Befund.** bewerbung_quelle kennt seit 0166 den Wert mail, und kein
-- Weg setzte ihn. Seit V-224 erfasst ein Mensch eine Bewerbung, die im
-- Postfach liegt (erfasseBewerbungAusPostfach). Die Bedingung
-- bewerbung_initiativ_ohne_stelle verlangte aber: ohne Stelle heisst die
-- Quelle initiativ, mit Stelle darf sie es nicht sein. Eine
-- Initiativbewerbung, die per E-Mail kam, haette damit ihre Herkunft
-- verloren — auf dem Bewerbungsblatt stuende Karriereseite oder initiativ,
-- und keiner von beiden Wegen ist der, auf dem sie kam.
--
-- **Die neue Bedingung.** initiativ bleibt ohne Stelle, karriereseite und
-- import bleiben mit Stelle — wie bisher. Nur mail ist mit UND ohne Stelle
-- zulaessig. Jede vorhandene Zeile erfuellt die alte Regel und damit die neue.
--
-- Kommentare nur mit --, keine Backticks.
-- ===========================================================================

alter table bewerbung drop constraint bewerbung_initiativ_ohne_stelle;

alter table bewerbung add constraint bewerbung_quelle_und_stelle check (
     (quelle = 'initiativ' and stelle_id is null)
  or (quelle in ('karriereseite', 'import') and stelle_id is not null)
  or quelle = 'mail');

comment on constraint bewerbung_quelle_und_stelle on bewerbung is
  'REC-03, V-224, D-718. Eine Bewerbung aus dem Postfach traegt ihre Herkunft mit oder ohne '
  'Stelle; initiativ bleibt ohne, Karriereseite und Import bleiben mit Stelle.';
