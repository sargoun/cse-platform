import { expect, test } from '@playwright/test';
import { SICHERHEITSKOEPFE } from '../../src/lib/sicherheitskoepfe';

/**
 * SEC-A7 auf den ECHTEN Antworten (03-AUTH §4.1, D-416).
 *
 * `tests/kern/sicherheitskoepfe.test.ts` prueft die Konstante und ihre
 * Verdrahtung in `next.config.ts`; diese Datei prueft, dass ein laufender
 * Server sie auch ausliefert — auf einer oeffentlichen Seite, einer
 * Auth-Seite, einer Portalseite ohne Sitzung, einem Route-Handler und einem
 * 404. Eine Matcher-Aenderung, die eine dieser Familien verliert, faellt hier.
 */
const ROUTEN = [
  ['/', 200],
  ['/auth/mitarbeiter', 200],
  ['/portal/reinigung', 200],
  ['/healthz', 200],
  ['/diese-seite-gibt-es-nicht', 404],
] as const;

for (const [pfad, status] of ROUTEN) {
  test(`${pfad} (${String(status)}) traegt jeden Sicherheitskopf`, async ({ request }) => {
    const antwort = await request.get(pfad);
    expect(antwort.status(), pfad).toBe(status);
    for (const { key, value } of SICHERHEITSKOEPFE) {
      expect(antwort.headers()[key.toLowerCase()], `${pfad}: ${key}`).toBe(value);
    }
  });
}
