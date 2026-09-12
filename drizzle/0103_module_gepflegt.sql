/**
 * „Keine Module gebucht" und „noch niemand hat es eingetragen" sind zwei
 * verschiedene Aussagen — und `module = '{}'` konnte nur eine davon sagen.
 *
 * Der Modulriegel (D-377) las die leere Liste als „nicht hinterlegt" und
 * filterte dann gar nichts. Die Begruendung dafuer ist gut und bleibt: waere
 * leer gleich „nichts gebucht", machte ein vergessener Eintrag beim Anlegen
 * einer Gesellschaft aus einem Datenfehler einen Totalausfall — ein Portal,
 * das niemandem etwas zeigt, und die Ursache steht in einer Spalte, die
 * niemand ansieht.
 *
 * Nur passt diese Lesart nicht auf CSE Operations. Die Gruppensteuerung fuehrt
 * weder Reviere noch Posten noch Baustellen; ihre leere Liste IST die Aussage.
 * Unter der alten Lesart sah ihr Verwalter genau die drei Gewerke, die sie
 * nicht hat — also derselbe Befund, den der Mandant fuer den Hochbau gemeldet
 * hat, nur eine Gesellschaft weiter.
 *
 * Ein Kennzeichen loest beides, ohne eine der beiden Aussagen zu erfinden:
 *
 *   module_gepflegt = false  „niemand hat es eingetragen" — es wird nicht
 *                            gefiltert. Der Vorgabewert, damit eine neu
 *                            angelegte Gesellschaft sichtbar bleibt.
 *   module_gepflegt = true   die Liste GILT. Leer heisst dann: kein Gewerk.
 *
 * Kein Sentinelwert in der Liste (`'keine'`, `'-'`): ein Wert, der kein Modul
 * ist und in einer Modulliste steht, faellt beim ersten Vergleich um, den
 * jemand ohne den Kommentar hier schreibt.
 *
 * // TODO(client, O-355): Wer traegt die Modulbuchung ein und pflegt das
 * Kennzeichen — Vertrag, Verwaltung oder Super-Admin ueber
 * `system.module_zuweisen`?
 */
alter table mandant
  add column module_gepflegt boolean not null default false;

comment on column mandant.module_gepflegt is
  'Gilt `module` als hinterlegt? false = nicht eingetragen, es wird nicht '
  'gefiltert. true = die Liste gilt, leer heisst „kein Gewerk". D-377.';
