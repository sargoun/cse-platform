-- ===========================================================================
-- 0214 — `lv_import_zeile.hinweise`: was angepasst wurde, ohne zu verwerfen
-- ===========================================================================
--
-- **Der Ausfall, den diese Spalte verhindert.** `lv_position` traegt drei
-- Bedingungen, die eine Zeile der Datei verletzen kann: `lvp_einheit_bei_position`,
-- `lvp_menge_bei_position` und `lvp_preis_nur_position`. Die ersten beiden
-- nahm der Leser vorweg und gab der Zeile einen Fehler; die dritte fehlte.
-- Ein Titel mit einer Titelsumme in der EP-Spalte — in exportierten
-- LV-Tabellen ueblich — stand deshalb als gueltig in der Vorschau, und die
-- Uebernahme brach mitten in der Schleife mit
-- `new row for relation "lv_position" violates check constraint
-- "lvp_preis_nur_position"` ab: ein Serverfehler nach einer gruenen Vorschau.
--
-- **Warum eine zweite Spalte und nicht `fehler`.** `ist_gueltig` haengt daran,
-- dass `fehler` leer ist — eine Zeile mit Eintrag faellt aus der Uebernahme
-- heraus. Fuer den Titel waere das die falsche Folge: seine Positionen
-- haengten danach eine Ebene zu hoch, weil ihr Elternteil fehlt. Richtig ist,
-- den PREIS wegzulassen und die Zeile zu behalten — und genau das muss die
-- Vorschau sagen koennen, sonst verschwindet eine Zahl still.
--
-- Fehler heisst: die Zeile kommt nicht mit.
-- Hinweis heisst: die Zeile kommt mit, und etwas an ihr wurde angepasst.

alter table lv_import_zeile
  add column hinweise text[] not null default '{}';

comment on column lv_import_zeile.hinweise is
  'Was an der Zeile angepasst wurde, ohne sie zu verwerfen — z. B. ein Preis '
  'auf einer Zeile, die keine Position ist (lvp_preis_nur_position, 0071). '
  'Anders als fehler macht ein Hinweis die Zeile NICHT ungueltig.';

/**
 * **Das Spaltenrecht muss mitwachsen.** 0212 hat `cse_app` das tabellenweite
 * `select` auf `lv_import_zeile` NICHT erteilt, sondern eine erschoepfende
 * Spaltenliste (ohne `einheitspreis_cent` und `rohdaten`, K-05). Eine neue
 * Spalte ist damit fuer die Anwendung unsichtbar, bis sie hier ausdruecklich
 * dazukommt — und `insert`/`update` stehen tabellenweit, also decken sie die
 * neue Spalte schon.
 */
grant select (hinweise) on lv_import_zeile to cse_app;
