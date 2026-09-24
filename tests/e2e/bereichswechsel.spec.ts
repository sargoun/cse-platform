import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

/**
 * **Der Bereichswechsel im ECHTEN Portal** (DESIGN §6, TEN-06, TEN-10, V-165).
 *
 * `portal.spec.ts` prueft die Vorschau unter `/dev/portal` mit festen Zahlen.
 * Diese Datei prueft, was ein Mensch in der Anwendung sieht: den Umschalter
 * oben links mit Live-Zaehlern und `NUR LESEN` am Gruppeneintrag — und bei
 * einem einzigen Bereich weder Umschalter noch Verweis.
 */

test.describe('(1) mehrere Bereiche: der Umschalter steht oben links', () => {
  test('mit Zaehlern, NUR LESEN am Gruppeneintrag, und der Wechsel traegt', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe');

    await page.click('[data-cse="umschalter-ausloeser"]');
    const menue = page.locator('[data-cse="umschalter-menue"]');
    await expect(menue).toBeVisible();
    // Vier Gesellschaften und die Gruppenuebersicht.
    await expect(menue.getByRole('menuitem')).toHaveCount(5);
    // Die Reinigung traegt Auftraege im Seed: ihr Zaehler steht da, live.
    await expect(menue.getByRole('menuitem', { name: /CSE Dienstleistung/u })
      .locator('[data-cse="umschalter-zaehler"]')).toContainText(/laufende[rs]? Auftr/u);
    await expect(page.locator('[data-cse="gruppenuebersicht"] [data-zustand="Nur Lesen"]'))
      .toHaveCount(1);

    await menue.getByRole('menuitem', { name: /CSE Dienstleistung/u }).click();
    await expect(page).toHaveURL(/\/portal\/reinigung$/u);
    await expect(page.locator('[data-cse="identitaets-streifen"]'))
      .toHaveAttribute('data-bereich', 'reinigung');
  });

  test('⌘K oeffnet ihn auf jeder Seite des internen Portals', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe');
    await expect(page.locator('[data-cse="umschalter-ausloeser"]')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('[data-cse="umschalter-menue"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-cse="umschalter-menue"]')).toHaveCount(0);
  });

  test('die Bereichswahl zeigt dieselben Zaehler und die Pille', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/auth/bereich');
    await expect(page.locator('[data-bereich="reinigung"] [data-cse="bereich-zaehler"]'))
      .toContainText(/laufende[rs]? Auftr/u);
    await expect(page.locator('[data-cse="gruppe-nur-lesen"]')).toBeVisible();
    await expect(page.getByText('Alle vier Gesellschaften')).toHaveCount(0);
  });
});

test.describe('(2) ein Bereich: weder Umschalter noch Verweis (TEN-06, D-43)', () => {
  test('admin.reinigung sieht ein Zeichen, keinen Chevron, keinen Verweis', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung');
    await expect(page.locator('[data-cse="umschalter-ausloeser"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="chevron"]')).toHaveCount(0);
    await expect(page.locator('a[href="/auth/bereich"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="portal-logo"]')).toBeVisible();
  });

  test('auch auf der Kontoseite, die nicht durch das Tor geht', async ({ page }) => {
    /*
     * `/portal/konto` liest seine Sitzung selbst (`leseKonto`). Vor V-165
     * stand dort der Verweis fuer jedes Konto — in der Kopfzeile UND im Text
     * der Seite.
     */
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/konto');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('[data-cse="konto-bereiche"] li')).toHaveCount(1);
    await expect(page.locator('a[href="/auth/bereich"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="umschalter-ausloeser"]')).toHaveCount(0);
  });
});

test.describe('(3) mehrere Bereiche auf der Kontoseite: derselbe Umschalter', () => {
  test('die Plattformverwaltung sieht ihn auch unter /portal/konto', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/konto');
    await expect(page.locator('[data-cse="umschalter-ausloeser"]')).toBeVisible();
    await expect(page.locator('[data-cse="konto-wechsel"] a[href="/auth/bereich"]'))
      .toHaveCount(1);
  });
});
