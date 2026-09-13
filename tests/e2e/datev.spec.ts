/**
 * PR 60 im Browser — der DATEV-Export (ACC-02).
 *
 * Der Schreiber steht byteweise in `tests/kern/datev-extf.test.ts`, der
 * Vorgang in `tests/isolation/datev-export.test.ts`. Hier stehen die drei
 * Aussagen, die nur auf dem Bildschirm zu prüfen sind:
 *
 *  1. Die Seite sagt ZUERST, dass es keine Verbindung gibt — und dass das so
 *     bleibt.
 *  2. Sie sagt, dass das Format nicht gegen ein echtes Muster geprüft ist
 *     (O-05), solange die Fahne steht.
 *  3. Ohne vollständige Stammdaten gibt es keinen Knopf, der zu einer Absage
 *     führt.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('DATEV-Export (ACC-02)', () => {
  test('die Seite sagt zuerst, dass nichts verbunden ist', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/datev`);

    const verbindung = page.locator('[data-cse="datev-verbindung"]');
    await expect(verbindung).toBeVisible();
    await expect(verbindung).toContainText('Nicht verbunden');
    await expect(verbindung).toContainText('Ein Knopf „an DATEV senden"');

    // Und es gibt ihn wirklich nicht.
    await expect(page.getByRole('button', { name: /senden/iu })).toHaveCount(0);
  });

  test('und dass das Format nicht gegen ein Muster geprüft ist (O-05)',
    async ({ page }) => {
      await anmelden(page);
      await page.goto(`/portal/${MANDANT}/buchhaltung/datev`);

      const fahne = page.locator('[data-cse="datev-format-ungeprueft"]');
      await expect(fahne).toBeVisible();
      await expect(fahne).toContainText('Format nicht gegen ein echtes Muster geprüft');
      await expect(fahne).toContainText('O-05');
    });

  test('ohne bestätigte Stammdaten führt kein Knopf in die Absage', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/datev`);

    /*
     * Der Seed lässt `datev_konfiguration` als Platzhalter stehen (O-05) —
     * also steht hier der ausgegraute Hinweis und KEIN Link. Wäre die
     * Konfiguration in einem späteren Seed vollständig, stünde der Link da;
     * beide Ausgänge sind ganz, und keiner davon ist ein Knopf, der in eine
     * Fehlermeldung führt.
     */
    const aus = page.locator('[data-cse="export-knopf-aus"]');
    const link = page.getByRole('link', { name: 'Stapel erzeugen' });

    if (await aus.count() > 0) {
      await expect(aus).toContainText('Stammdaten fehlen');
      await expect(link).toHaveCount(0);
      await expect(page.getByText('Stammdaten unvollständig (O-05)')).toBeVisible();
    } else {
      await expect(link).toBeVisible();
    }
  });

  test('die Vorschau steht vor dem Erzeugen-Knopf', async ({ page }) => {
    await anmelden(page);
    await page.goto(
      `/portal/${MANDANT}/buchhaltung/datev/neu?von=2026-08-01&bis=2026-08-31`);

    // Die Seite ist erreichbar, auch wenn die Übersicht den Weg dorthin
    // ausgraut — ein direkter Aufruf darf nicht ins Leere laufen.
    const vorschau = page.locator('[data-cse="datev-vorschau"]');
    await expect(vorschau).toBeVisible();

    const offen = Number(await vorschau.getAttribute('data-offen'));
    const knopf = page.locator('[data-cse="datev-erzeugen"]');
    if (offen > 0) {
      await expect(knopf).toBeDisabled();
    }
  });

  test('der Bildschirm ist barrierefrei (WCAG 2.1 AA)', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/datev`);
    const befund = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(befund.violations).toEqual([]);
  });

  test('bei 375px scrollt die Seite nicht seitwärts', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/datev`);
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ueberlauf).toBeLessThanOrEqual(1);
  });
});
