/**
 * OPS-07 bis OPS-09 im Browser — vom Raumbuch zum Auftrag, in vier Klicks.
 *
 * Das ist die Kette, die das Abnahmekriterium der Phase 4 im Ganzen zeigt:
 * gerechnet wird aus der Flaeche, angeboten wird mit Nummer, gewandelt wird
 * in einer Handlung. Und dazwischen die Zusage, die zaehlt: **nichts geht
 * hinaus, ohne dass ein Mensch geklickt hat.**
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function anmelden(page: Page, rolle: string): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator(`[data-cse="dev-anmelden"][data-rolle="${rolle}"]`).first();
  await expect(knopf, `kein Seed-Konto für Rolle ${rolle}`).toBeVisible();
  await knopf.click();
  await page.waitForLoadState('networkidle');
}

async function zumRaumbuch(page: Page): Promise<void> {
  await page.goto('/portal/reinigung/objekte');
  await page.getByRole('link', { name: 'Bürohaus Kurfürstendamm' }).click();
  await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
  await expect(page.locator('h1')).toHaveText('Raumbuch');
}

test.describe('(1) Aus der Kalkulation wird ein Angebot', () => {
  test('der Knopf legt eines an und führt hinein', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();

    await expect(page).toHaveURL(/\/portal\/reinigung\/angebote\/[0-9a-f-]{36}$/u);
    // Der Entwurf traegt noch keine Nummer — sie entsteht beim Versand.
    await expect(page.getByText('entsteht beim Versand').first()).toBeVisible();
    // Und die Position erklaert sich selbst.
    await expect(page.getByText(/÷ .* m²\/h/u).first()).toBeVisible();
  });

  test('das Angebot erscheint in der Liste', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    await page.goto('/portal/reinigung/angebote');
    await expect(page.locator('h1')).toHaveText('Angebote');
    await expect(page.getByText('ohne — Entwurf').first()).toBeVisible();
  });
});

test.describe('(2) Der Versand — und was er erzeugt', () => {
  test('ein Klick, eine Nummer, ein unveränderliches Dokument', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const angebotsUrl = page.url();

    await page.locator('[data-cse="versenden"]').click();
    await page.waitForURL(angebotsUrl);

    // Die Nummer steht jetzt da, und der Versandknopf ist fort.
    await expect(page.getByText(/AN-\d{4}-\d{5}/u).first()).toBeVisible();
    await expect(page.locator('[data-cse="versenden"]')).toHaveCount(0);
    // Die Umsatzsteuerzeile ist beim Versand entstanden.
    await expect(page.getByText(/Umsatzsteuer 19 %/u)).toBeVisible();
  });

  test('das Angebotsdokument trägt die Identität DIESER Gesellschaft', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    await page.locator('[data-cse="versenden"]').click();
    await page.getByRole('link', { name: 'Angebotsdokument' }).click();

    const blatt = page.locator('[data-cse="angebotsdokument"]');
    await expect(blatt).toBeVisible();
    // Die Reinigung druckt IHRE Firma — nicht die der Gruppe.
    await expect(blatt.getByText('CSE Dienstleistungen GmbH').first()).toBeVisible();
    // Weisses Blatt, dunkler Text (DESIGN §11).
    await expect(blatt).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(blatt).toHaveCSS('color', 'rgb(17, 17, 17)');
    await expect(page.locator('[data-cse="brutto"]')).toHaveText(/\d+,\d{2}\s?€/u);
  });
});

test.describe('(3) Angebot → Auftrag, in einer Handlung (OPS-09)', () => {
  test('ein Klick, und der Auftrag steht', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const angebotsUrl = page.url();
    await page.locator('[data-cse="versenden"]').click();
    await page.waitForURL(angebotsUrl);

    await page.locator('[data-cse="in-auftrag"]').click();
    await page.waitForURL(angebotsUrl);
    await expect(page.getByText(/Auftrag AU-\d{4}-\d{5} entstanden/u)).toBeVisible();
    // Und ein zweites Mal geht nicht.
    await expect(page.locator('[data-cse="in-auftrag"]')).toHaveCount(0);
  });
});

test.describe('(4) barrierefrei', () => {
  test('axe findet nichts auf dem Angebot', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ergebnis.violations).toEqual([]);
  });
});
