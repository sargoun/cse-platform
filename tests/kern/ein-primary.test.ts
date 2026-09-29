/**
 * **Ein Primärknopf je Ansicht** (DESIGN §5 „Buttons", D-710 Nr. 7; V-267,
 * Prüfung der Gruppe kalender-dokumente).
 *
 * `/recruiting/stellen/neu` trug zwei — „Entwurf erstellen lassen" (Agent)
 * und „Entwurf anlegen" (von Hand) —, das Bewerbungsblatt neben „Termin
 * anlegen" noch „Angaben bestätigen". Primär bleibt der Weg, der immer geht
 * bzw. der schon da war; der andere ist `secondary`, wie „Angaben speichern"
 * im selben Abschnitt.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const B = 'src/app/portal/[mandant]/recruiting/';

function primaer(quelle: string): string[] {
  return [...quelle.matchAll(/<Button\b[^>]*variante="primary"[^>]*>/gu)]
    .map((m) => /data-cse="([^"]+)"/u.exec(m[0])?.[1] ?? '?');
}

function variante(quelle: string, cse: string): string | undefined {
  const knopf = [...quelle.matchAll(/<Button\b[^>]*>/gu)].find((m) =>
    m[0].includes(`data-cse="${cse}"`));
  return knopf === undefined ? undefined : /variante="(\w+)"/u.exec(knopf[0])?.[1];
}

describe('ein Primärknopf je Ansicht', () => {
  it('/recruiting/stellen/neu: primär ist „Entwurf anlegen"; der Agent ist sekundär', () => {
    const seite = readFileSync(`${B}stellen/neu/page.tsx`, 'utf8');
    expect(primaer(seite)).toEqual(['stelle-anlegen']);
    expect(variante(seite, 'stelle-agent-anlegen')).toBe('secondary');
  });

  it('Bewerbungsblatt: primär ist „Termin anlegen"; „Angaben bestätigen" ist sekundär', () => {
    const seite = readFileSync(`${B}bewerbungen/[id]/page.tsx`, 'utf8');
    expect(primaer(seite)).toEqual(['gespraech-anlegen']);
    expect(variante(seite, 'kandidat-bestaetigen-knopf')).toBe('secondary');
    expect(variante(seite, 'kandidat-speichern')).toBe('secondary');
  });
});
