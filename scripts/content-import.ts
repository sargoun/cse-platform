/**
 * `pnpm content:import` — legt die PUB-01-Seiten an, idempotent.
 *
 * Zweimal laufen lassen aendert null Zeilen. Der Inhalt hier ist der GERUEST-
 * text: Titel und Struktur stehen, die Texte schreibt der Mandant. Erfundene
 * Werbetexte saehen fertig aus und muessten spaeter gesucht werden.
 */
import postgres from 'postgres';
import { importiere, type ImportSeite } from '../src/server/services/inhalt/import.js';
import { OEFFENTLICHE_ROUTEN } from '../src/server/services/inhalt/routen.js';

const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
if (url === undefined || url === '') throw new Error('DATABASE_URL fehlt.');
const sql = postgres(url, { max: 1, onnotice: () => {} });

const seiten: readonly ImportSeite[] = OEFFENTLICHE_ROUTEN.map((r) => ({
  pfad: r.pfad,
  titel: r.titel,
  beschreibung: null,
  abschnitte: [
    {
      art: 'hero',
      reihenfolge: 1,
      ueberschrift: r.titel,
      // Das eine rote Akzentwort nur auf der Startseite (DESIGN §2).
      akzentWort: r.pfad === '/' ? 'Gruppe' : null,
      text: null,
    },
  ],
}));

const bericht = await importiere(
  { unsafe: (s, w) => sql.unsafe(s, (w ?? []) as never[]) }, seiten,
);
process.stdout.write(
  `Import: ${String(bericht.angelegt)} angelegt, ${String(bericht.geaendert)} geändert, `
  + `${String(bericht.unveraendert)} unverändert.\n`,
);
await sql.end();
