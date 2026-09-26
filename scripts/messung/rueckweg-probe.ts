import { ROUTEN } from '../../src/server/registry/routen.js';
import { rueckwegFuer } from '../../src/server/registry/rueckweg.js';
import { BEKANNTE_RUECKZIELE } from '../../src/lib/i18n/verwaltung/rueckziele.js';

const beispiel = (muster: string): string =>
  muster.replace('[mandant]', 'reinigung')
    .replace(/\[[^\]]+\]/gu, 'a1b2c3d4-0000-0000-0000-000000000000');

const mandant = ROUTEN.filter((r) => r.pfad.startsWith('/portal/[mandant]'));
let mit = 0; let ohne = 0; const fehlend = new Set<string>();
for (const r of mandant) {
  const z = rueckwegFuer(beispiel(r.pfad));
  if (z === null) { ohne += 1; continue; }
  mit += 1;
  if (!z.segment.startsWith('[') && !BEKANNTE_RUECKZIELE.has(z.segment)) fehlend.add(z.segment);
}
console.log(`Seiten MIT abgeleitetem Rueckweg : ${String(mit)}`);
console.log(`Seiten OHNE (Modulwurzeln)       : ${String(ohne)}`);
console.log(`Segmente ohne Beschriftung       : ${String(fehlend.size)}`, [...fehlend]);
console.log('--- Stichproben ---');
for (const p of [
  '/portal/reinigung/personal/anstellungen/abc',
  '/portal/reinigung/personal/anstellungen/abc/stundenkonto',
  '/portal/reinigung/objekte/abc/raumbuch/xyz',
  '/portal/reinigung/objekte',
  '/portal/reinigung',
  '/portal/reinigung/bau/projekte/abc/lv/import',
  '/portal/reinigung/crm/kunden/abc/steuer',
]) {
  const z = rueckwegFuer(p);
  console.log(`  ${p}\n      -> ${z === null ? 'KEINER' : `${z.ziel}   [${z.segment}]`}`);
}
