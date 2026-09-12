/**
 * Ein Aufzaehlungswert, und sonst nichts — er muss in einer EIGENEN
 * Migration stehen.
 *
 * Der Migrator faehrt jede Datei in einer Transaktion (`migrate.ts`), und
 * Postgres laesst einen frisch hinzugefuegten Aufzaehlungswert innerhalb
 * derselben Transaktion nicht BENUTZEN. `0112` braucht ihn im
 * Diskriminator und im Sperrindex; deshalb die Teilung.
 */
alter type quelle_typ add value 'sonderleistung';
