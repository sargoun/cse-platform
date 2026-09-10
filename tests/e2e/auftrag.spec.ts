/**
 * OPS-05/OPS-10 im Browser — der Auftragsassistent.
 *
 * Der Kern der Pruefung ist, was NICHT passiert: Personalbedarf und
 * Wochenstunden bleiben leer, wenn niemand sie eintraegt. Eine Zahl, die ein
 * Assistent erfindet, hinterfragt spaeter niemand mehr.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Ein eigener Name je Lauf.
 *
 * Die Suite laeuft gegen EINE Datenbank, und die wird zwischen Laeufen nicht
 * geleert. Ein fester Name traf beim zweiten Lauf zwei Auftraege — und der
 * Test scheiterte daran, dass er schon einmal erfolgreich war.
 */
const LAUF = String(Date.now()).slice(-6);
const NAME = `Unterhaltsreinigung Kurfürstendamm ${LAUF}`;

test.describe.configure({ mode: 'serial' });

async function anmelden(page: Page, rolle: string): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator(`[data-cse="dev-anmelden"][data-rolle="${rolle}"]`).first();
  await expect(knopf, `kein Seed-Konto für Rolle ${rolle}`).toBeVisible();
  await knopf.click();
  await page.waitForLoadState('networkidle');
}

test.describe('(1) Der Assistent fragt, was OPS-10 verlangt', () => {
  test('alle sechs Felder stehen auf EINER Seite', async ({ page }) => {
    await anmelden(page, 'admin');
    const antwort = await page.goto('/portal/reinigung/auftraege/neu');
    expect(antwort?.status()).toBe(200);

    for (const feld of ['#objektId', '#personalbedarfAnzahl', '#wochenstundenSoll',
                        '#ausstattungHinweis', '#startDatum', '#verantwortlichBenutzerId']) {
      await expect(page.locator(feld), feld).toBeVisible();
    }
  });

  test('ein angelegter Auftrag trägt genau das, was eingetragen wurde', async ({ page }) => {
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung/auftraege/neu');

    await page.fill('#bezeichnung', NAME);
    await page.fill('#startDatum', '2026-11-02');
    await page.fill('#personalbedarfAnzahl', '3');
    await page.fill('#wochenstundenSoll', '18,5');
    await page.fill('#ausstattungHinweis', 'Reinigungswagen und Einscheibenmaschine');
    await page.locator('[data-cse="auftrag-anlegen"]').click();

    await expect(page).toHaveURL(/\/auftraege\/[0-9a-f-]{36}$/u);
    const felder = page.locator('[data-cse="auftrag-felder"]');
    await expect(felder).toContainText('3 Personen');
    await expect(felder).toContainText('18,50');
    await expect(felder).toContainText(/AU-\d{4}-\d{5}/u);
    await expect(page.getByText('Reinigungswagen und Einscheibenmaschine')).toBeVisible();
  });

  test('und was NICHT eingetragen wurde, bleibt leer — nichts wird geschätzt',
    async ({ page }) => {
      await anmelden(page, 'admin');
      await page.goto('/portal/reinigung/auftraege/neu');
      await page.fill('#bezeichnung', `Objektschutz ohne Angaben ${LAUF}`);
      await page.fill('#startDatum', '2026-12-01');
      await page.locator('[data-cse="auftrag-anlegen"]').click();

      await expect(page).toHaveURL(/\/auftraege\/[0-9a-f-]{36}$/u);
      const felder = page.locator('[data-cse="auftrag-felder"]');
      await expect(felder).toContainText('nicht angegeben');
    });
});

test.describe('(2) Die Liste und der Rückweg', () => {
  test('der neue Auftrag steht in der Liste', async ({ page }) => {
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung/auftraege');
    await expect(page.locator('h1')).toHaveText('Aufträge');
    await expect(page.getByRole('link', { name: NAME })).toBeVisible();
  });

  test('ein Auftrag ohne Kundenfreigabe sagt, dass er keine Referenz ist (PRO-05)',
    async ({ page }) => {
      await anmelden(page, 'admin');
      await page.goto('/portal/reinigung/auftraege');
      await page.getByRole('link', { name: NAME }).click();
      await expect(page.getByText(/Ohne schriftliche Freigabe des Kunden/u)).toBeVisible();
    });
});

test.describe('(3) barrierefrei', () => {
  test('axe findet nichts im Assistenten', async ({ page }) => {
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung/auftraege/neu');
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ergebnis.violations).toEqual([]);
  });
});
