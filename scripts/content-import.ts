/**
 * `pnpm content:import` — legt die PUB-01-Seiten an, idempotent.
 *
 * Zweimal laufen lassen aendert null Zeilen.
 *
 * **Die Texte sind ENTWURFSTEXTE** (`src/server/db/seed/inhalt.ts`, O-207):
 * sachliche Beschreibungen dessen, was die vier Gesellschaften tun, ohne
 * Zahlen, Auszeichnungen, Kundennamen oder Zusagen. Damit ist die Seite
 * vorzeigbar, ohne dass irgendwo eine Behauptung steht, die niemand geprueft
 * hat — ein Werbesatz auf der Website ist spaeter woertlich ein Satz im
 * Angebot.
 */
import postgres from 'postgres';
import { importiere, type ImportSeite } from '../src/server/services/inhalt/import.js';
import { OEFFENTLICHE_ROUTEN } from '../src/server/services/inhalt/routen.js';
import { SEITEN } from '../src/server/db/seed/inhalt.js';

const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
if (url === undefined || url === '') throw new Error('DATABASE_URL fehlt.');
const sql = postgres(url, { max: 1, onnotice: () => {} });

const inhalt = new Map(SEITEN.map((s) => [s.pfad, s]));

const seiten: readonly ImportSeite[] = OEFFENTLICHE_ROUTEN.map((r) => {
  const s = inhalt.get(r.pfad);
  if (s === undefined) {
    // Eine Route ohne Text bekommt die Ueberschrift und sonst nichts —
    // sichtbar unfertig statt mit einem Fuellsatz, den niemand ersetzt.
    return {
      pfad: r.pfad, titel: r.titel, beschreibung: null,
      abschnitte: [{
        art: 'hero', reihenfolge: 1, ueberschrift: r.titel,
        akzentWort: null, text: null,
      }],
    };
  }
  return {
    pfad: r.pfad,
    titel: r.titel,
    beschreibung: s.beschreibung,
    abschnitte: s.abschnitte.map((a, i) => ({
      art: a.art,
      reihenfolge: i + 1,
      ueberschrift: a.ueberschrift,
      // Das eine rote Akzentwort nur auf der Startseite (DESIGN §2).
      akzentWort: r.pfad === '/' && a.art === 'hero' ? 'Gruppe' : null,
      text: a.text,
      daten: a.daten,
    })),
  };
});

const bericht = await importiere(
  { unsafe: (s, w) => sql.unsafe(s, (w ?? []) as never[]) }, seiten,
);
process.stdout.write(
  `Import: ${String(bericht.angelegt)} angelegt, ${String(bericht.geaendert)} geändert, `
  + `${String(bericht.unveraendert)} unverändert.\n`,
);
process.stdout.write(
  '  Die Texte sind ENTWÜRFE (O-207) — bitte vom Mandanten prüfen lassen.\n',
);
await sql.end();
