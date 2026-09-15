/**
 * Der Posteingang im Browser (NOT-01, NOT-02, NOT-03).
 *
 * Die Rechte- und Riegelfragen stehen in
 * `tests/isolation/benachrichtigung-posteingang.test.ts`. Hier wird gemessen,
 * was ein Mensch sieht: dass die Glocke die Zahl trägt, dass ein Eintrag
 * wirklich zu seinem Datensatz führt (NOT-03), und dass „gelesen" stempelt
 * statt zu löschen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

/**
 * Immer DASSELBE Konto: der Posteingang ist persönlich, und der Seed legt die
 * Demo-Meldung genau einem Konto je Gesellschaft hin. `.first()` auf einer
 * Rolle griffe irgendwann das andere — der Fehler, wegen dessen es
 * `hilfen/anmeldung.ts` überhaupt gibt.
 */
async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('Posteingang', () => {
  test('die Glocke steht in der Kopfzeile und trägt ihre Zahl', async ({ page }) => {
    await anmelden(page);
    await page.goto('/portal/reinigung');

    const glocke = page.locator('[data-cse="glocke"]');
    await expect(glocke).toHaveCount(1);
    // Der Name trägt die Zahl — Farbe und Grösse allein sind kein Signal (§9).
    await expect(glocke).toHaveAttribute('aria-label', /Benachrichtigungen/u);
  });

  test('der Posteingang zeigt die geseedete Meldung und führt zu ihrem Datensatz',
    async ({ page }) => {
      await anmelden(page);
      await page.goto('/portal/reinigung/benachrichtigungen');
      const eintraege = page.locator('[data-cse="benachrichtigung"]');
      await expect(eintraege.first()).toBeVisible();
      await expect(eintraege.first()).toHaveAttribute('data-gelesen', 'nein');

      await eintraege.first().locator('[data-cse="oeffnen"]').click();
      // NOT-03: sie führt zu ihrem Datensatz, nicht auf eine Liste.
      await expect(page).toHaveURL(/\/portal\/reinigung\/crm\/leads\/[0-9a-f-]{36}/u);

      // Und sie ist danach gestempelt, nicht verschwunden.
      await page.goto('/portal/reinigung/benachrichtigungen?alle=1');
      await expect(page.locator('[data-cse="benachrichtigung"][data-gelesen="ja"]').first())
        .toBeVisible();
    });

  test('„alle als gelesen" leert die ungelesene Ansicht, nicht den Posteingang',
    async ({ page }) => {
      await anmelden(page);
      await page.goto('/portal/reinigung/benachrichtigungen');
      const knopf = page.locator('[data-cse="alle-lesen"]');
      if (await knopf.count() > 0) {
        await knopf.click();
        await expect(page.locator('[data-cse="alle-gelesen"]')).toBeVisible();
      }
      await expect(page.locator('[data-cse="posteingang-leer"]')).toBeVisible();

      await page.goto('/portal/reinigung/benachrichtigungen?alle=1');
      await expect(page.locator('[data-cse="benachrichtigung"]').first()).toBeVisible();
    });

  test('die Einstellungen führen jede Art auf und lassen E-Mail abwählen', async ({ page }) => {
    await anmelden(page);
    await page.goto('/portal/konto/benachrichtigungen');
    const zeilen = page.locator('[data-cse="praeferenz-zeile"]');
    expect(await zeilen.count()).toBeGreaterThan(5);

    // `app` ist da, aber nicht abwählbar — der Posteingang ist das Protokoll.
    const erste = zeilen.first();
    await expect(erste.locator('input[disabled]')).toHaveCount(1);

    const email = page.locator('input[name="kanal:crm.neuer_lead:email"]');
    await expect(email).toHaveCount(1);
    await email.uncheck();
    await page.locator('[data-cse="praeferenz-speichern"]').click();

    await expect(page.locator('[data-cse="praeferenz-gespeichert"]')).toBeVisible();
    await expect(page.locator('input[name="kanal:crm.neuer_lead:email"]')).not.toBeChecked();
  });

  test('ohne verbundenen Postausgang steht das auf dem Bildschirm', async ({ page }) => {
    await anmelden(page);
    await page.goto('/portal/konto/benachrichtigungen');
    await expect(page.locator('[data-cse="email-nicht-verbunden"]'))
      .toContainText(/nicht verbunden/u);
  });
});

test.describe('Barrierefreiheit (BFSG)', () => {
  for (const pfad of ['/portal/reinigung/benachrichtigungen', '/portal/konto/benachrichtigungen']) {
    test(`${pfad} ist frei von schweren axe-Verstössen`, async ({ page }) => {
      await anmelden(page);
      await page.goto(pfad);
      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(ergebnis.violations.map((v) => `${v.id} (${String(v.nodes.length)})`)).toEqual([]);
    });
  }
});
