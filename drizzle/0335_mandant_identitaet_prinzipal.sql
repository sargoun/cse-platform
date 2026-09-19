-- ===========================================================================
-- 0335 — mandant_identitaet: `oeffentlich_sichtbar` war auf dem prinzipallosen
--        Renderpfad wirkungslos (01-KERN §6.1/§6.2, TEN-07, PUB-03, PRO-01,
--        K-01, K-03, Invariante 3)
-- ===========================================================================
--
-- **Der Befund.** 0200 legt zwei SELECT-Policies nebeneinander:
--
--   t_mi_lesen      using (mandant_id = any (app.sichtbare_mandanten()))
--   mi_oeffentlich  using (oeffentlich_sichtbar
--                          and app.aktueller_benutzer() is null
--                          and mandant_id = app.aktiver_mandant())
--
-- Die zweite ist die Tuer fuer die oeffentliche Seite, und sie ist eng
-- gefasst. Die erste steht daneben — und sie greift auf demselben Pfad
-- ebenfalls: `app.sichtbare_mandanten()` gibt im Mandanten-Scope
-- `array[app.aktiver_mandant()]` zurueck, OHNE nach einem Prinzipal zu
-- fragen (0004, 0020). Eine Sitzung ohne Benutzer — genau die, in der die
-- oeffentliche Seite gerendert wird — erfuellt sie damit immer.
--
-- Folge: `oeffentlich_sichtbar` steuerte nichts. Der prinzipallose Pfad las
-- die Identitaetszeile des aktiven Bereichs auch dann, wenn niemand sie
-- freigegeben hat — samt `email_absender`, `email_signatur` und `domain`,
-- die die Projektions-View `mandant_identitaet_oeffentlich` gerade deshalb
-- NICHT fuehrt. Gemessen an `tests/isolation/mandant-identitaet.test.ts`:
-- drei Faelle, alle drei mit einer Zeile statt keiner.
--
-- **Was §6.2 zusagt.** Die Spalte ist dort woertlich beschrieben als „steuert
-- die Lesbarkeit auf dem PRINZIPALLOSEN Renderpfad (§6.1)". §6.1 begruendet
-- das mit einer Annahme ueber die Sitzung ohne Prinzipal: „`app.hat_recht`
-- liefert ohne Sitzungszeile false, `sichtbare_mandanten()` ist leer, und
-- `app.aktueller_benutzer()` ist NULL". Der dritte Halbsatz stimmt. Der
-- zweite stimmt fuer den Gruppen-, Personen- und Kunden-Scope und NICHT fuer
-- den Mandanten-Scope, und auf dem laeuft die oeffentliche Seite.
--
-- **Warum die Korrektur hier steht und nicht in `sichtbare_mandanten()`.**
-- Diese Funktion ist die Wurzel jeder Policy der Plattform; ihr einen
-- Prinzipal-Konjunkt einzuziehen, aendert das Verhalten JEDER Tabelle auf
-- einmal — auch dort, wo heute bewusst ohne Benutzer gelesen wird
-- (Seedpfad, Definer-Leser, Pruefstrecken). Das ist eine eigene Pruefrunde
-- mit einem Urteil je Tabelle, kein Nebeneffekt einer Identitaetsmigration.
-- Hier wird die EINE Tabelle geschlossen, deren Freigabeschalter sonst
-- bedeutungslos bleibt.
--
-- Die angemeldete Sitzung merkt davon nichts: sie hat einen Prinzipal und
-- liest weiter ueber `sichtbare_mandanten()` — genau wie der Kommentar in
-- 0200 es bereits behauptet hat.
-- ===========================================================================

drop policy t_mi_lesen on mandant_identitaet;

/**
 * Lesen: jede Gesellschaft, die diese ANGEMELDETE Sitzung sieht. Kein
 * Fachrecht davor — die Identitaet steht in jeder Kopfzeile und in jedem
 * Switcher; ein Fachrecht hier machte die Marke unsichtbar, nicht sicherer.
 *
 * Der Prinzipal-Konjunkt ist die Abgrenzung zu `mi_oeffentlich` und sonst
 * nichts: ohne ihn stehen die beiden Policies nicht nebeneinander, sondern
 * die eine ueber der anderen, und die engere wird nie gebraucht.
 */
create policy t_mi_lesen on mandant_identitaet for select to cse_app
  using (app.aktueller_benutzer() is not null
         and mandant_id = any (app.sichtbare_mandanten()));

comment on column mandant_identitaet.oeffentlich_sichtbar is
  '§6.2: steuert die Lesbarkeit auf dem prinzipallosen Renderpfad (§6.1). '
  'Seit 0335 tatsaechlich: t_mi_lesen verlangt einen Prinzipal, sonst greift '
  'nur mi_oeffentlich. Nicht fuer cse_anon, das nirgends einen Grant haelt (K-01).';
