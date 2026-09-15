-- 0156 — Eine Benachrichtigungseinstellung auf die Vorgabe zurücksetzen (NOT-02).

/**
 * **`delete` fehlte, und damit war „zurück auf Vorgabe" nicht ausdrückbar.**
 *
 * `0011` gab `cse_app` auf `benachrichtigung_praeferenz` `select, insert,
 * update` — und `t_praeferenz_eigene` ist `for all`, deckt also auch das
 * Löschen ab. Nur das Tabellenrecht fehlte, und ohne beides greift keine
 * Policy: Postgres prüft zuerst das GRANT.
 *
 * Warum es gebraucht wird: in der Tabelle stehen nur die ABWEICHUNGEN von
 * `ArtDefinition.kanaeleVorgabe`. Wer eine Einstellung wieder auf die Vorgabe
 * stellt, muss seine Zeile loswerden — sonst stünde dort eine Abweichung, die
 * keine ist, und sie bliebe stehen, wenn die Vorgabe sich ändert. Eine
 * gespeicherte Vorgabe ist genau die Art von Wert, die später niemand
 * nachzieht.
 *
 * Aufgefallen ist es beim ersten Test, der den Weg ging: „permission denied
 * for table benachrichtigung_praeferenz". Bis dahin hatte NIE etwas in diese
 * Tabelle geschrieben — NOT-02 war vollständig unbenutzt (D-505).
 */
grant delete on benachrichtigung_praeferenz to cse_app;
