/**
 * Die Gruppenlisten `/projekte` und `/news` (SEITENKARTE §2.1, PRO-05, SOC-05).
 *
 * **Der Befund, den dieser Fall festhält.** Beide Seiten trugen einen
 * redaktionellen Abschnitt: „Hier stehen bald Referenzen" und „Noch keine
 * Beiträge". Die Referenzen und Beiträge gab es längst — sie standen auf den
 * vier Gesellschaftsprofilen. Wer über die Gruppenseite kam, las also, es gebe
 * nichts, während zwei Klicks weiter vier freigegebene Projekte standen.
 *
 * Geprüft wird deshalb beides: dass ECHTE Zeilen erscheinen, und dass jede auf
 * die kanonische Adresse bei ihrer Gesellschaft führt — nicht auf eine zweite
 * Kopie desselben Textes.
 */
import { expect, test } from '@playwright/test';

test.describe('/projekte', () => {
  test('zeigt echte Projekte, nicht „Hier stehen bald Referenzen"', async ({ page }) => {
    const antwort = await page.goto('/projekte');
    expect(antwort?.status()).toBe(200);

    const liste = page.locator('[data-cse="gruppen-projekte"]');
    await expect(liste).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Hier stehen bald Referenzen');

    const eintraege = page.locator('[data-cse="gruppen-projekt"]');
    await expect(eintraege.first()).toBeVisible();
    expect(await eintraege.count()).toBeGreaterThan(0);
  });

  test('jedes Projekt führt zu SEINER Gesellschaft, nicht auf eine zweite Kopie',
    async ({ page }) => {
      await page.goto('/projekte');
      const erstes = page.locator('[data-cse="gruppen-projekt"]').first();
      const bereich = await erstes.getAttribute('data-bereich');
      const ziel = await erstes.getAttribute('href');
      /*
       * §2.2 macht `/unternehmen/<bereich>/projekte/<slug>` zur kanonischen
       * Adresse. Zwei Adressen fuer einen Text waeren zwei Eintraege im
       * Suchindex und eine Entscheidung, welcher der richtige ist — die
       * niemand trifft.
       */
      expect(ziel).toBe(`/unternehmen/${bereich ?? ''}/projekte/${(ziel ?? '').split('/').pop() ?? ''}`);

      await erstes.click();
      await expect(page.locator('h1')).toBeVisible();
    });

  test('behält die Einleitung — sie erklärt, warum die Liste kurz ist', async ({ page }) => {
    await page.goto('/projekte');
    await expect(page.locator('body')).toContainText('schriftlich');
  });
});

test.describe('/news', () => {
  test('zeigt echte Beiträge, nicht „Noch keine Beiträge"', async ({ page }) => {
    const antwort = await page.goto('/news');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('body')).not.toContainText('Noch keine Beiträge');

    const eintraege = page.locator('[data-cse="gruppen-neuigkeit"]');
    await expect(eintraege.first()).toBeVisible();
  });

  test('gibt es auf Englisch unter demselben Pfad mit /en', async ({ page }) => {
    const antwort = await page.goto('/en/news');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('[data-cse="gruppen-neuigkeiten"]')).toBeVisible();
  });
});
