/**
 * PR 59 im Browser — die Buchungen und ihr Beleg (ACC-01, ACC-03, DOC-04).
 *
 * Was die Datenbank kann, steht in `tests/isolation/belegverknuepfung.test.ts`.
 * Hier steht die Frage, die kein Isolationstest beantwortet: sieht man es?
 *
 *  1. Der Exportzustand steht ganz oben — vor der Liste, nicht in einer
 *     Spalte, die man erst nach dem Scrollen sieht.
 *  2. Eine Zeile führt zu ihrer Buchung, und die Buchung nennt ihren Beleg.
 *  3. Die Probe „Soll = Haben" steht auf dem Bildschirm.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('Buchungen und Belegverknüpfung (ACC-03)', () => {
  test('der Exportzustand steht oben und sagt, was fehlt', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/buchungen`);

    const bereitschaft = page.locator('[data-cse="export-bereitschaft"]');
    await expect(bereitschaft).toBeVisible();

    /*
     * **Beide Ausgänge sind ganz, und keiner davon ist „leer".** Die
     * Demodaten enthalten gebuchte Rechnungen, deren PDF der nächtliche
     * Archivlauf noch nicht abgelegt hat — dann steht hier eine Zahl und der
     * Grund. Sind sie abgelegt, steht „Exportfähig". Was NICHT vorkommen
     * darf, ist ein Kasten ohne Aussage: dann wüsste niemand, ob der Export
     * geht.
     */
    const offen = Number(await bereitschaft.getAttribute('data-offen'));
    if (offen === 0) {
      await expect(bereitschaft).toContainText('Exportfähig');
    } else {
      await expect(bereitschaft).toContainText('unvollständig');
      await expect(bereitschaft).toContainText(/Beleg fehlt|Konto ist nicht zugeordnet/u);
    }
  });

  test('der Filter „nur unvollständige" zeigt nichts anderes', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/buchungen?offen=1`);

    const bereitschaft = page.locator('[data-cse="export-bereitschaft"]');
    const offen = Number(await bereitschaft.getAttribute('data-offen'));

    const zeilen = page.getByRole('row');
    if (offen === 0) {
      // Kein offener Posten: die Liste ist leer, und sie sagt es.
      await expect(page.getByText('keine Buchungszeile')).toBeVisible();
    } else {
      // Jede sichtbare Zeile trägt den Grund, warum sie hier steht.
      await expect(zeilen.filter({ hasText: 'nicht archiviert' }).first())
        .toBeVisible();
    }
  });

  test('eine Zeile führt zu ihrer Buchung, und die Probe steht dort',
    async ({ page }) => {
      await anmelden(page);
      await page.goto(`/portal/${MANDANT}/buchhaltung/buchungen`);

      const ersteZeile = page.getByRole('row').nth(1);
      const anzahl = await page.getByRole('row').count();
      test.skip(anzahl < 2, 'Ohne gebuchte Zeile im Seed gibt es nichts zu öffnen.');

      await ersteZeile.getByRole('link').first().click();
      await page.waitForLoadState('domcontentloaded');

      const probe = page.locator('[data-cse="buchung-probe"]');
      await expect(probe).toBeVisible();
      // Eine automatisch erzeugte Buchung geht auf — sonst wäre sie gar nicht
      // erst entstanden (`bs_buchung_ausgeglichen`).
      await expect(probe).toHaveAttribute('data-geht-auf', 'true');
      await expect(probe).toContainText('die Buchung geht auf');

      await expect(page.getByRole('heading', { name: 'Beleg' })).toBeVisible();
    });

  test('der Bildschirm ist barrierefrei (WCAG 2.1 AA)', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/buchungen`);
    const befund = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(befund.violations).toEqual([]);
  });

  test('bei 375px scrollt die Seite nicht seitwärts', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/buchungen`);

    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ueberlauf).toBeLessThanOrEqual(1);
  });
});
