/**
 * Die Vorrichtung der Browsersuite fuer PR 63: ein E-Rechnungs-Vorschlag im
 * Posteingang der Reinigung — gebaut durch DIESELBEN Dienste, die die
 * Hochladeroute benutzt (`extrahiereERechnung`, `legeERechnungAb`), in einer
 * Portalsitzung, nicht per Insert.
 *
 * **Warum ein eigener Prozess.** Die Dienste tragen `server-only`, und ein
 * Playwright-Prozess ist keine Serverumgebung; der Hook
 * `scripts/hooks/server-only.mjs` loest den Marker auf, so wie Vitest es tut.
 * Die Spezifikation ruft dieses Skript ueber `tsx --import` auf und liest
 * die JSON-Zeile am Ende.
 *
 * **Der Speicher ist der Testspeicher — und das steht dazu.** Im Browserlauf
 * ist kein Objektspeicher verbunden (die Suite prueft genau das:
 * `eingangsrechnung.spec.ts` (2), `erechnung.spec.ts` (4)). Die Bytes liegen
 * deshalb nur im Speicher dieses Prozesses; das Dokument dahinter laesst
 * sich im Browser nicht abrufen, und kein Test behauptet das. Der Seed
 * selbst legt ohne verbundenen Speicher nichts an (`seed/eingang.ts`).
 *
 * Aufruf: `tsx --import ./scripts/hooks/server-only.mjs <diese Datei> '<json>'`
 * mit einem Teil von `ERechnungBeispiel`; `{ "nurXml": true }` liefert nur
 * die Datei, ohne etwas anzulegen.
 */
import postgres from 'postgres';
import { LokalerSpeicher } from '../../../src/server/storage/adapter.js';
import {
  BEISPIEL_REINIGUNG, beispielERechnungUbl, seedEingang, type ERechnungBeispiel,
} from '../../../src/server/db/seed/eingang.js';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const auftrag = JSON.parse(process.argv[2] ?? '{}') as Partial<ERechnungBeispiel> & { nurXml?: boolean };
const { nurXml, ...teil } = auftrag;
const beispiel: ERechnungBeispiel = { ...BEISPIEL_REINIGUNG, ...teil };
const xml = beispielERechnungUbl(beispiel);

if (nurXml === true) {
  process.stdout.write(`${JSON.stringify({ xml })}\n`);
} else {
  const sql = postgres(DSN, { max: 2, onnotice: () => {} });
  try {
    const zeilen = await sql<{ slug: string; id: string }[]>`select slug, id from mandant`;
    const ids = new Map(zeilen.map((z) => [z.slug, z.id] as const));
    const ergebnis = await seedEingang(sql, ids, new LokalerSpeicher(), beispiel);
    process.stdout.write(`${JSON.stringify({ ...ergebnis, xml })}\n`);
  } finally {
    await sql.end();
  }
}
