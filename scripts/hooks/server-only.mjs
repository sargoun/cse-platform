/**
 * `server-only` ausserhalb von Next — fuer Skripte, die Serverdienste laden.
 *
 * Das Paket `server-only` wirft beim Import, sobald es nicht in einer
 * React-Server-Umgebung landet; das haelt Module mit Datenbankzugriff aus
 * dem Client-Buendel. Der Seed und die Vorrichtungen der Browsersuite SIND
 * Serverprozesse — nur ohne React —, und sie sollen genau die Dienste
 * durchlaufen, die das Portal durchlaeuft (`sitzung.ts`: „als Eigentuemer
 * geprueft hiesse: nicht geprueft"). Dieser Hook loest den Marker auf ein
 * leeres Modul auf, so wie `tests/stubs/server-only.ts` es fuer Vitest tut.
 *
 * Er gilt NUR fuer den Prozess, der ihn per `--import` laedt. Der Build von
 * Next importiert weiterhin das echte Paket und weist ein Modul, das
 * versehentlich im Client landet, weiterhin ab.
 *
 *   tsx --import ./scripts/hooks/server-only.mjs <skript>
 */
import { register } from 'node:module';

register('./server-only-aufloeser.mjs', import.meta.url);
