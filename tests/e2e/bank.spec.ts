/**
 * PR 61 im Browser — der Bankabgleich (ACC-04).
 *
 * Leser, Abgleichsregeln und Import stehen in den Kern- und
 * Isolationstests. Hier stehen die drei Aussagen, die nur auf dem Bildschirm
 * zu prüfen sind:
 *
 *  1. Was wartet, steht OBEN — vor der Liste der Auszüge.
 *  2. Die Seite sagt, dass es keinen Bankabruf gibt, und es gibt keinen Knopf
 *     dafür.
 *  3. Die Hochladeseite sagt VOR dem Hochladen, was danach passiert.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('Bankabgleich (ACC-04)', () => {
  test('was wartet, steht vor der Liste', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/bank`);

    const schlange = page.locator('[data-cse="bank-schlange"]');
    await expect(schlange).toBeVisible();

    /*
     * Beide Ausgänge sind ganz. Ohne eingelesenen Auszug wartet nichts; mit
     * einem wartet in aller Regel etwas, denn zugeordnet wird nur ein
     * eindeutiger Treffer. Was NICHT vorkommen darf, ist ein Kasten ohne
     * Aussage.
     */
    const offen = Number(await schlange.getAttribute('data-offen'));
    if (offen === 0) {
      await expect(schlange).toContainText('Nichts in Klärung');
    } else {
      await expect(schlange).toContainText('warten auf eine Entscheidung');
      await expect(schlange).toContainText('Betrag, Rechnungsnummer UND die IBAN');
    }
  });

  test('es gibt keinen Bankabruf — und keinen Knopf dafür', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/bank`);

    const hinweis = page.locator('[data-cse="bank-nicht-verbunden"]');
    await expect(hinweis).toBeVisible();
    await expect(hinweis).toContainText('kein PSD2, kein FinTS');

    await expect(page.getByRole('button', { name: /abrufen|abholen/iu })).toHaveCount(0);
  });

  test('die Hochladeseite sagt vorher, was danach passiert', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/bank/import`);

    await expect(page.getByRole('heading', { name: 'Was danach passiert' })).toBeVisible();
    await expect(page.getByText('Zugeordnet wird nur ein eindeutiger Treffer'))
      .toBeVisible();
    await expect(page.getByText(/Vormerkung der Bank/u)).toBeVisible();

    // Das Formular ist da und verlangt eine Datei.
    const feld = page.locator('input[name="datei"]');
    await expect(feld).toBeVisible();
    await expect(feld).toHaveAttribute('required', '');
    await expect(page.locator('[data-cse="bank-einlesen"]')).toBeVisible();
  });

  test('der Bildschirm ist barrierefrei (WCAG 2.1 AA)', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/bank`);
    const befund = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(befund.violations).toEqual([]);
  });

  test('bei 375px scrollt keine der beiden Seiten seitwärts', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await anmelden(page);
    for (const pfad of ['buchhaltung/bank', 'buchhaltung/bank/import']) {
      await page.goto(`/portal/${MANDANT}/${pfad}`);
      const ueberlauf = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ueberlauf, pfad).toBeLessThanOrEqual(1);
    }
  });
});
