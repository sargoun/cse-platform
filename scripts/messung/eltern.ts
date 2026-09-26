import { ROUTEN } from '../../src/server/registry/routen.js';
import { NAVIGATION } from '../../src/server/registry/navigation.js';

const mandant = ROUTEN.filter((r) => r.pfad.startsWith('/portal/[mandant]'));
const pfade = new Set(mandant.map((r) => r.pfad));
const navPfad = new Map(NAVIGATION.map((n) => [`/portal/[mandant]${n.pfad === '' ? '' : `/${n.pfad}`}`, n.label]));

let mitNav = 0; let mitRoute = 0; let ohne = 0;
const ohneListe: string[] = [];
for (const r of mandant) {
  const seg = r.pfad.split('/');
  let eltern: string | null = null;
  for (let i = seg.length - 1; i > 3; i -= 1) {
    const kandidat = seg.slice(0, i).join('/');
    if (pfade.has(kandidat)) { eltern = kandidat; break; }
  }
  if (eltern === null) { ohne += 1; ohneListe.push(r.pfad); continue; }
  if (navPfad.has(eltern)) mitNav += 1; else { mitRoute += 1; ohneListe.push(`${r.pfad}  ->  ${eltern} (kein Navi-Label)`); }
}
console.log('Eltern IST Navigationspunkt (Label vorhanden):', mitNav);
console.log('Eltern ist Route, aber kein Navi-Punkt      :', mitRoute);
console.log('Keine Eltern (Modulwurzel)                  :', ohne);
console.log('--- Beispiele ohne Navi-Label ---');
for (const z of ohneListe.slice(0, 25)) console.log('   ', z);
