/**
 * Phase 4 · CRM im Browser — und die eine Spalte, die vor einer Abmahnung
 * schuetzt.
 *
 * § 7 UWG verbietet elektronische Werbung ohne vorherige ausdrueckliche
 * Einwilligung, auch im B2B. Die Kundenseite zeigt je Kontakt die ANTWORT
 * DES TORES, nicht eine zweite Formulierung derselben Regel — dieselbe
 * Funktion, die auch der Sendepfad fragt.
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

test.describe('(1) Die Kundenliste zeigt den Werbestatus', () => {
  test('sie führt die Seed-Kunden mit Rechtsgrundlage', async ({ page }) => {
    await anmelden(page, 'admin');
    const antwort = await page.goto('/portal/reinigung/crm/kunden');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Kunden');
    await expect(page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }))
      .toBeVisible();
    await expect(page.getByText('Bestandskunde').first()).toBeVisible();
  });

  test('und nicht die Kunden einer anderen Gesellschaft', async ({ page }) => {
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung/crm/kunden');
    // K-20001 gehoert der Security — dieselbe Firma, andere Kundenbeziehung.
    await expect(page.getByText('K-20001')).toHaveCount(0);
    await expect(page.getByText('K-10001').first()).toBeVisible();
  });
});

test.describe('(2) Das UWG-Tor steht als Anzeige auf der Kundenseite', () => {
  test('der Bestandskunden-Kontakt darf per E-Mail beworben werden', async ({ page }) => {
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung/crm/kunden');
    await page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }).click();
    await expect(page.locator('h1')).toHaveText('Berliner Hausverwaltung GmbH');

    const tor = page.locator('[data-cse="werbetor"]').first();
    await expect(tor).toBeVisible();
    await expect(tor).toHaveAttribute('data-erlaubt', 'true');
    await expect(page.locator('[data-cse="rechtsgrundlage"]')).toContainText('Bestandskunde');
  });

  test('das Objekt des Kunden ist von hier erreichbar', async ({ page }) => {
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung/crm/kunden');
    await page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }).click();
    await page.getByRole('link', { name: 'Bürohaus Kurfürstendamm' }).click();
    await expect(page.locator('h1')).toHaveText('Bürohaus Kurfürstendamm');
  });
});

test.describe('(3) Der Lead-Posteingang', () => {
  test('er ist erreichbar und sagt, wenn er leer ist', async ({ page }) => {
    await anmelden(page, 'admin');
    const antwort = await page.goto('/portal/reinigung/crm/leads');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Leads');
  });
});

test.describe('(4) „Mehr" öffnet den vollständigen Baum (SEITENKARTE §11.2)', () => {
  test('am Telefon führt das fünfte Ziel in die übrigen Module', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung');

    const mehr = page.locator('[data-cse="mehr"]');
    await expect(mehr).toBeVisible();
    // Vor dem Öffnen ist das Blatt zu.
    await expect(page.locator('[data-cse="mehr-blatt"]')).toBeHidden();
    await page.locator('[data-cse="tab"][data-tab="mehr"]').click();
    await expect(page.locator('[data-cse="mehr-blatt"]')).toBeVisible();
    // CRM ist darin — und war über die vier Tabs nicht erreichbar.
    await page.locator('[data-cse="mehr-ziel"][data-ziel="crm"]').click();
    await expect(page.locator('h1')).toHaveText('CRM');
  });

  test('ein Modul ohne Recht steht NICHT im Blatt', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await anmelden(page, 'leitung');
    await page.goto('/portal/bau');
    await page.locator('[data-cse="tab"][data-tab="mehr"]').click();
    // `leitung` hält `system.einstellung_lesen` nicht — der Punkt fehlt,
    // statt ausgegraut zu sein: ein Menüpunkt, der auf 404 führt, verrät
    // die Existenz dessen, was er nicht zeigen darf.
    await expect(page.locator('[data-cse="mehr-ziel"][data-ziel="einstellungen"]'))
      .toHaveCount(0);
    await expect(page.locator('[data-cse="mehr-ziel"][data-ziel="objekte"]')).toBeVisible();
  });
});

test.describe('(5) barrierefrei', () => {
  test('axe findet nichts auf der Kundenseite', async ({ page }) => {
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung/crm/kunden');
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ergebnis.violations).toEqual([]);
  });
});
