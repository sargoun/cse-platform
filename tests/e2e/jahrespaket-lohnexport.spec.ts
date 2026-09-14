/**
 * PR 67 im Browser — Jahrespaket und Lohnexport (ACC-11, ACC-12, D-486).
 *
 *  1. Jahrespaket: Kennzahlen, die Hinweise (ohne Speicher: keine Dateien —
 *     die Seite sagt es), das ZIP kommt mit Hash.
 *  2. Lohnexport: der Platzhalter ist benannt (O-27), die Monatsnavigation
 *     traegt, das ZIP kommt mit Format und Hash — und die Leitung ohne
 *     `zeit.exportieren` sieht nichts.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';
const JP = `/portal/${MANDANT}/buchhaltung/jahrespaket`;
const LE = `/portal/${MANDANT}/buchhaltung/lohnexport`;

async function anmelden(page: Page, konto: string = KONTO.adminReinigung): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Jahrespaket und Lohnexport (PR 67)', () => {
  test('Jahrespaket: Kennzahlen, ehrliche Hinweise, das ZIP mit Hash', async ({ page }) => {
    await anmelden(page);
    expect((await page.goto(JP))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /^Jahrespaket/u, level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="jahrespaket-kennzahlen"] [data-cse="kpi-wert"]')).toHaveCount(4);
    await expect(page.locator('[data-cse="jahrespaket-hinweise"]')).toBeVisible();
    await expect(page.locator('[data-cse="jahrespaket-speicher"]')).toContainText('nicht verbunden');
    await expect(page.locator('[data-cse="tabelle"]')).toContainText('LIESMICH.txt');
    await expect(page.locator('[data-cse="tabelle"]')).toContainText('verfahrensdokumentation.md');

    const href = await page.locator('[data-cse="jahrespaket-abrufen"]').getAttribute('href');
    const zip = await page.request.get(href ?? '');
    expect(zip.status()).toBe(200);
    expect(zip.headers()['content-type']).toContain('application/zip');
    expect(zip.headers()['x-cse-paket-sha256']).toMatch(/^[0-9a-f]{64}$/u);
    expect((await zip.body()).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  test('Lohnexport: Platzhalter benannt, Monatsnavigation, ZIP mit Format und Hash', async ({ page }) => {
    await anmelden(page);
    expect((await page.goto(LE))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /^Lohnexport/u, level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="lohnexport-format"]')).toContainText('O-27');
    await expect(page.locator('[data-cse="lohnexport-kennzahlen"] [data-cse="kpi-wert"]')).toHaveCount(4);
    const sha = await page.locator('[data-cse="lohnexport-sha256"]').getAttribute('title');
    expect(sha).toMatch(/^[0-9a-f]{64}$/u);

    const href = await page.locator('[data-cse="lohnexport-abrufen"]').getAttribute('href');
    const zip = await page.request.get(href ?? '');
    expect(zip.status()).toBe(200);
    expect(zip.headers()['x-cse-format']).toBe('generisch_csv');
    expect(zip.headers()['x-cse-paket-sha256']).toBe(sha);

    await page.locator('[data-cse="lohnexport-zurueck"]').click();
    await expect(page).toHaveURL(/monat=\d{4}-\d{2}/u);
    await expect(page.getByRole('heading', { name: /^Lohnexport/u, level: 1 })).toBeVisible();
  });

  test('ohne das Recht gibt es beide Seiten nicht', async ({ page }) => {
    await anmelden(page, KONTO.leitungReinigung);
    expect((await page.goto(JP))?.status()).toBe(404);
    expect((await page.goto(LE))?.status()).toBe(404);
  });
});
