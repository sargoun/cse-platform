/**
 * Die Finanzuebersicht einer Gesellschaft (FIN-17, DSH-04, D-479) — das Ziel
 * des Tabs „Finanzen", lesend. Kacheln nur mit Recht, Karten nur mit Seite.
 */
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

test.describe('Finanzübersicht', () => {
  test('Kacheln und Karten — und jede Karte führt auf eine Seite', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung/finanzen');
    expect(antwort?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: /^Finanzen \d{4}$/u })).toBeVisible();
    // `admin` haelt `finanzen.lesen`: die Rechnungskacheln stehen, mit Betrag.
    await expect(page.locator('[data-cse="kachel"][data-kachel="fakturiert"] [data-cse="kpi-wert"]')).toContainText('€');
    await expect(page.locator('[data-cse="kachel"][data-kachel="entwuerfe"]')).toBeVisible();
    await expect(page.locator('main form')).toHaveCount(0);

    const karten = page.locator('[data-cse="finanzen-karte"]');
    expect(await karten.count()).toBeGreaterThan(0);
    const ziele = await karten.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const ziel of ziele) {
      const a = await page.goto(ziel);
      expect(a?.status(), ziel).toBe(200);
    }
  });

  test('der Tab „Finanzen" der globalen Leiste fuehrt hierher — nach dem Wechsel', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/reinigung/finanzen');
    await page.locator('[data-cse="wechsel-knopf"]').click();
    await expect(page).toHaveURL(/\/portal\/reinigung\/finanzen$/u);
    await expect(page.getByRole('heading', { level: 1, name: /^Finanzen \d{4}$/u })).toBeVisible();
    // Die Tab-Leiste ist die Leiste des Telefons (DESIGN §5 Navigation) — am
    // Schreibtisch traegt die Seitenleiste dieselben Ziele.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('[data-cse="tableiste"] [data-tab="finanzen"]')).toBeVisible();
  });

  test('ein Kundenkonto landet in seinem Portal (K-04)', async ({ page }) => {
    await alsKonto(page, KONTO.kunde);
    await page.goto('/portal/reinigung/finanzen');
    await expect(page).toHaveURL(/\/portal\/kunde$/u);
  });
});
