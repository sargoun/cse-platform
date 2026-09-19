-- ===========================================================================
-- 0367 — Einstellen ist ein RECHT, und die Datenbank wusste es nicht
--        (D-09, EMP-14, AUT-04, Invariante 3, 0004)
--
-- Vertrag: `docs/architecture/03-AUTH-BERECHTIGUNGEN.md` §12.4
-- (`personal.schreiben`), `04-SEITENKARTE.md` §5.12
-- (`/portal/[mandant]/personal/anstellungen/neu` → `personal.schreiben`).
--
-- **Der Befund.** `t_person_schreiben` und `t_anstellung_schreiben` aus 0004
-- pruefen `app.assert_genau_ein_mandant()` und `not app.ist_readonly()` — und
-- KEIN Recht. Jede angemeldete interne Sitzung mit einem aktiven Bereich
-- konnte damit einen Menschen und eine Beschaeftigung anlegen; die einzige
-- Wache war die Route, die es bis heute nicht gab. Solange niemand einstellen
-- konnte, ist das folgenlos geblieben — mit `/personal/anstellungen/neu` wird
-- es zur ersten Schreibflaeche auf diesen beiden Tabellen, und dann ist eine
-- Policy ohne Rechtepruefung genau die Luecke, gegen die Invariante 3
-- geschrieben ist: „RLS ist die zweite Verteidigungslinie, nie die einzige
-- und nie abwesend".
--
-- Zum Vergleich, im selben Modul: `anstellung_kondition` verlangt
-- `personal.entgelt_schreiben` (0192), `person`-Stammdaten verlangen
-- `personal.schreiben` (0190, `t_person_personalpflege`), die
-- Zusammenfuehrung verlangt `personal.zusammenfuehren` (0194). Genau die
-- ANLAGE fiel heraus.
--
-- **Warum `personal.schreiben` und kein neuer Schluessel.** 04-SEITENKARTE
-- §5.12 fuehrt die Anlageseite unter `personal.schreiben`, und der Katalog
-- bindet ihn an `super_admin`, `admin` und `leitung`. Einen eigenen
-- `personal.einstellen` zu erfinden hiesse, eine Rechtefrage zu beantworten,
-- die niemand gestellt hat (K-17).
--
-- **Kein Wechsel der Sichtbarkeit.** Beide Policies sind `for insert`; das
-- Lesen (`t_person_lesen`, `t_anstellung_lesen`) und das Aendern
-- (`t_anstellung_aendern`, `t_person_personalpflege`) bleiben unveraendert.
-- ===========================================================================

drop policy t_person_schreiben on person;

/**
 * Ein Mensch wird angelegt, weil jemand ihn EINSTELLT.
 *
 * `person` traegt keinen Mandanten (D-09), deshalb prueft die Bedingung den
 * AKTIVEN Bereich: wer hier einstellen darf, darf hier einen Menschen
 * anlegen. Die Beschaeftigung, die daraus folgt, prueft ihr eigenes Recht
 * eine Zeile weiter unten — und genau dieses Paar ist die D-09-Reihenfolge:
 * erst der Mensch, dann die Beschaeftigung.
 */
create policy t_person_schreiben on person for insert to cse_app
  with check (app.assert_genau_ein_mandant() is not null
              and not app.ist_readonly()
              and (select app.hat_recht('personal.schreiben', app.aktiver_mandant())));

comment on policy t_person_schreiben on person is
  'D-09/EMP-14: eine person-Zeile entsteht nur, wo jemand personal.schreiben '
  'im aktiven Bereich haelt. Bis 0367 pruefte diese Policy KEIN Recht.';

drop policy t_anstellung_schreiben on anstellung;

create policy t_anstellung_schreiben on anstellung for insert to cse_app
  with check (mandant_id = app.assert_genau_ein_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('personal.schreiben', mandant_id)));

comment on policy t_anstellung_schreiben on anstellung is
  'D-09/EMP-14: eine Beschaeftigung entsteht nur in der aktiven Gesellschaft und '
  'nur mit personal.schreiben DORT. Bis 0367 pruefte diese Policy KEIN Recht.';
