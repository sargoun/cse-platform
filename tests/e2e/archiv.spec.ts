/**
 * PR 64 im Browser — das GoBD-Archiv, die Aufbewahrungsregeln, das
 * Pruefbuendel (ACC-06, DOC-07, DOC-08, D-483).
 *
 * Was die Datenbank haelt, steht in `tests/isolation/gobd-archiv.test.ts`.
 * Hier steht, was ein Mensch sieht:
 *
 *  1. Das Archiv nennt seine Zusage, seine Kennzahlen und sagt, was der
 *     Anbieter (nicht die Plattform) garantieren muss.
 *  2. Die Regeln: fuer die Administration 404 (das Recht liegt bei der
 *     Super-Administration), fuer die Super-Administration setzbar —
 *     die Untergrenze steht im Feld, nicht nur im Fehler.
 *  3. Das Pruefbuendel: das Manifest ist abrufbar und traegt seinen Hash;
 *     das ZIP gibt es ohne Speicher nicht, und die Seite sagt es.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

/** Die Super-Administration betritt einen Bereich ueber das Wechselblatt. */
async function alsSuperAdminAuf(page: Page, pfad: string): Promise<void> {
  await alsKonto(page, KONTO.gruppe);
  await page.goto(pfad);
  const wechsel = page.locator('[data-cse="wechsel-knopf"]');
  if ((await wechsel.count()) > 0) await wechsel.click();
  await expect(page).toHaveURL(new RegExp(`${pfad.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'));
}

test.describe('GoBD-Archiv (PR 64)', () => {
  test('das Archiv nennt Zusage, Kennzahlen und Grenze — fuer die Administration', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto(`/portal/${MANDANT}/buchhaltung/archiv`);
    expect(antwort?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'GoBD-Archiv', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="archiv-zusage"]')).toContainText('Löschen');
    await expect(page.locator('[data-cse="archiv-kennzahlen"] [data-cse="kpi-wert"]')).toHaveCount(4);
    const leer = page.locator('[data-cse="archiv-leer"]');
    const tabelle = page.locator('[data-cse="tabelle"]');
    expect((await leer.count()) + (await tabelle.count())).toBeGreaterThan(0);
    await expect(page.locator('[data-cse="archiv-anbieter"]')).toContainText('O-364');
    // Die Werkzeuge der Super-Administration stehen der Administration nicht als Link.
    await expect(page.locator('[data-cse="archiv-werkzeuge"] a', { hasText: 'Aufbewahrungsregeln' })).toHaveCount(0);
    await expect(page.locator('[data-cse="archiv-werkzeuge"] a', { hasText: 'Rechnungsausgangsbuch' })).toBeVisible();
  });

  test('Aufbewahrungsregeln: 404 fuer die Administration, setzbar fuer die Super-Administration', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto(`/portal/${MANDANT}/dokumente/aufbewahrung`);
    expect(antwort?.status()).toBe(404);

    await alsSuperAdminAuf(page, `/portal/${MANDANT}/dokumente/aufbewahrung`);
    await expect(page.getByRole('heading', { name: 'Aufbewahrungsregeln', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="aufbewahrung-regel"]')).toHaveCount(9);
    await expect(page.locator('[data-cse="wirtschaftsjahr"]')).toContainText('O-05');

    const rechnung = page.locator('[data-cse="aufbewahrung-regel"][data-kategorie="rechnung"]');
    await expect(rechnung.locator('[data-cse="regel-jahre"]')).toHaveText('10 Jahre');
    // Die Untergrenze steht im Feld — der Browser laesst weniger gar nicht zu.
    await expect(rechnung.locator('input[name="jahre"]')).toHaveAttribute('min', '10');
    await expect(rechnung.locator('input[name="loeschsperre"][type="checkbox"]')).toBeDisabled();

    await rechnung.locator('input[name="jahre"]').fill('12');
    await rechnung.locator('input[name="grundlage"]').fill('§ 147 AO, § 14b UStG — Beschluss der Geschäftsführung: zwölf Jahre');
    await rechnung.getByRole('button', { name: 'Regel setzen' }).click();
    await expect(page).toHaveURL(/gesetzt=rechnung/u);
    await expect(page.locator('[data-cse="aufbewahrung-gesetzt"]')).toContainText('Regel gesetzt');
    const danach = page.locator('[data-cse="aufbewahrung-regel"][data-kategorie="rechnung"]');
    await expect(danach.locator('[data-cse="regel-jahre"]')).toHaveText('12 Jahre');
    await expect(danach).toContainText('Regel dieser Gesellschaft');
  });

  test('Pruefbuendel: Manifest mit Hash abrufbar, ZIP ehrlich unmoeglich ohne Speicher', async ({ page }) => {
    await alsSuperAdminAuf(page, `/portal/${MANDANT}/dokumente/buendel`);
    await expect(page.getByRole('heading', { name: /^Prüfbündel/u, level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="buendel-kennzahlen"] [data-cse="kpi-wert"]')).toHaveCount(4);
    await expect(page.locator('[data-cse="buendel-ausgangsbuch"]')).toBeVisible();
    await expect(page.locator('[data-cse="buendel-abrufen"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="buendel-nicht-moeglich"]')).toBeVisible();
    await expect(page.locator('[data-cse="manifest-sha256"]')).toContainText('SHA-256');

    const href = await page.locator('[data-cse="manifest-abrufen"]').getAttribute('href');
    expect(href).not.toBeNull();
    const antwort = await page.request.get(href ?? '');
    expect(antwort.status()).toBe(200);
    expect(antwort.headers()['content-type']).toContain('application/json');
    expect(antwort.headers()['x-cse-manifest-sha256']).toMatch(/^[0-9a-f]{64}$/u);
    const manifest = await antwort.json() as Record<string, unknown>;
    expect(manifest['art']).toBe('cse-pruefbuendel');
    expect(manifest['hinweis']).toMatch(/keine Berechnung von Steuern oder Löhnen/u);

    // Das ZIP ohne Speicher: 503 mit Satz, kein leeres Archiv.
    const zip = await page.request.get(`${href ?? ''}`.replace('format=manifest', 'format=zip'));
    expect([409, 503]).toContain(zip.status());
  });
});
