import 'server-only';
import postgres from 'postgres';

/**
 * Die eine Verbindung der laufenden Anwendung.
 *
 * **Warum ein Modul und keine Verbindung je Aufruf.** Next.js rendert jede
 * Anfrage in derselben Node-Instanz; eine neue Verbindung je Seitenaufruf
 * erschoepft den Verbindungspool von Postgres, bevor der erste Besucheransturm
 * vorbei ist — und der Fehler erscheint nicht beim Entwickeln, sondern unter
 * Last.
 *
 * **Warum traege.** Der Build rendert nichts, was die Datenbank braucht
 * (die oeffentlichen Seiten sind `force-dynamic`). Wuerde dieses Modul beim
 * Import verbinden, schlaege `pnpm build` ohne laufende Datenbank fehl — und
 * damit jeder CI-Lauf, der nur uebersetzen will.
 */
let verbindung: postgres.Sql | null = null;

export class KeineDatenbankFehler extends Error {
  constructor() {
    super(
      'DATABASE_URL fehlt. Die öffentlichen Seiten lesen ihren Inhalt aus '
      + '`seite`/`abschnitt` (PUB-07) — ohne Datenbank gibt es keinen Inhalt, '
      + 'und eine leere Seite auszuliefern wäre die schlechtere Antwort.',
    );
    this.name = 'KeineDatenbankFehler';
  }
}

export function db(): postgres.Sql {
  if (verbindung !== null) return verbindung;
  const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
  if (url === undefined || url === '') throw new KeineDatenbankFehler();
  verbindung = postgres(url, { max: 8, onnotice: () => {} });
  return verbindung;
}
