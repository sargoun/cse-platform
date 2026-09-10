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
import { SEITEN_EN } from '../src/server/db/seed/inhalt-en.js';
import { TITEL_EN } from '../src/server/db/seed/routen-en.js';

const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
if (url === undefined || url === '') throw new Error('DATABASE_URL fehlt.');
const sql = postgres(url, { max: 1, onnotice: () => {} });

/**
 * Baut die Importliste EINER Sprache.
 *
 * Die Routenliste ist dieselbe: eine englische Seite ist derselbe Pfad in
 * einer anderen Zeile, kein eigener Slug. Ein zweiter Slug (`/services` neben
 * `/leistungen`) waere eine zweite Adresse fuer dieselbe Seite — und damit ein
 * zweiter Eintrag in jeder Sitemap, jeder Pruefliste und jedem Verweis.
 */
function bauen(
  quelle: readonly (typeof SEITEN)[number][],
  titel: (pfad: string, deutsch: string) => string,
): readonly ImportSeite[] {
  const inhalt = new Map(quelle.map((s) => [s.pfad, s]));
  return OEFFENTLICHE_ROUTEN.map((r) => {
    const s = inhalt.get(r.pfad);
    if (s === undefined) {
      // Eine Route ohne Text bekommt die Ueberschrift und sonst nichts —
      // sichtbar unfertig statt mit einem Fuellsatz, den niemand ersetzt.
      return {
        pfad: r.pfad, titel: titel(r.pfad, r.titel), beschreibung: null,
        abschnitte: [{
          art: 'hero', reihenfolge: 1, ueberschrift: titel(r.pfad, r.titel),
          akzentWort: null, text: null,
        }],
      };
    }
    return {
      pfad: r.pfad,
      titel: titel(r.pfad, r.titel),
      beschreibung: s.beschreibung,
      abschnitte: s.abschnitte.map((a, i) => ({
        art: a.art,
        reihenfolge: i + 1,
        ueberschrift: a.ueberschrift,
        // Das eine rote Akzentwort nur auf der Startseite (DESIGN §2).
        akzentWort: r.pfad === '/' && a.art === 'hero'
          ? (titel === deutscherTitel ? 'Gruppe' : 'group') : null,
        text: a.text,
        daten: a.daten,
      })),
    };
  });
}

const deutscherTitel = (_pfad: string, deutsch: string): string => deutsch;
const englischerTitel = (pfad: string, deutsch: string): string =>
  TITEL_EN[pfad] ?? deutsch;

const seiten = bauen(SEITEN, deutscherTitel);
const seitenEn = bauen(SEITEN_EN, englischerTitel);

const treiber = { unsafe: (s: string, w?: readonly unknown[]) => sql.unsafe(s, (w ?? []) as never[]) };
const de = await importiere(treiber, seiten, 'de');
const en = await importiere(treiber, seitenEn, 'en');
const bericht = {
  angelegt: de.angelegt + en.angelegt,
  geaendert: de.geaendert + en.geaendert,
  unveraendert: de.unveraendert + en.unveraendert,
};
process.stdout.write(
  `Import: ${String(bericht.angelegt)} angelegt, ${String(bericht.geaendert)} geändert, `
  + `${String(bericht.unveraendert)} unverändert.\n`,
);
process.stdout.write(
  '  Die Texte sind ENTWÜRFE (O-207) — bitte vom Mandanten prüfen lassen.\n',
);
await sql.end();
