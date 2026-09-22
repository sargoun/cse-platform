import { ROUTEN } from '../../src/server/registry/routen.js';

const mandant = ROUTEN.filter((r) => r.pfad.startsWith('/portal/[mandant]'));
const pfade = new Set(mandant.map((r) => r.pfad));
const eltern = new Set<string>();
for (const r of mandant) {
  const seg = r.pfad.split('/');
  for (let i = seg.length - 1; i > 3; i -= 1) {
    const k = seg.slice(0, i).join('/');
    if (pfade.has(k)) { eltern.add(k); break; }
  }
}
const letzte = new Map<string, number>();
for (const e of eltern) {
  const s = e.split('/').at(-1) ?? '';
  letzte.set(s, (letzte.get(s) ?? 0) + 1);
}
console.log('verschiedene Elternpfade:', eltern.size);
console.log('verschiedene LETZTE Segmente:', letzte.size);
for (const [s, n] of [...letzte].sort()) console.log(`  ${n}x  ${s}`);
