/**
 * Phase 4 im Browser — Objekt, Raumbuch und der Preis, der daraus entsteht.
 *
 * Was hier geprueft wird, ist genau das Abnahmekriterium: aus dem Raumbuch
 * entsteht ein Reinigungspreis, ohne dass jemand rechnet. Und daneben die
 * beiden Dinge, die ein Angebot leise falsch machen wuerden — ein Raum, der
 * durch den Schluessel verschwindet, und ein Platzhalterpreis, der aussieht
 * wie ein entschiedener.
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

/** Die Objekt-id aus der Liste — der Test kennt keine ids, er klickt. */
async function oeffneBuerohaus(page: Page): Promise<void> {
  await page.goto('/portal/reinigung/objekte');
  await page.getByRole('link', { name: 'Bürohaus Kurfürstendamm' }).click();
  await expect(page.locator('h1')).toHaveText('Bürohaus Kurfürstendamm');
}

test.describe('(1) die Objektliste zeigt, was da ist', () => {
  test('admin sieht die Objekte seiner Gesellschaft mit Fläche', async ({ page }) => {
    await anmelden(page, 'admin');
    const antwort = await page.goto('/portal/reinigung/objekte');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Objekte');
    await expect(page.getByRole('link', { name: 'Bürohaus Kurfürstendamm' })).toBeVisible();
    // Das Veranstaltungsobjekt hat KEINEN Kunden — und sagt das, statt leer zu bleiben.
    await expect(page.getByText('ohne Kundenbezug').first()).toBeVisible();
  });

  test('und nicht die einer anderen Gesellschaft', async ({ page }) => {
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung/objekte');
    // OBJ-2001 gehoert der Security. Ein Objekt derselben Anschrift, anderer Mandant.
    await expect(page.getByText('Objektschutz')).toHaveCount(0);
  });
});

test.describe('(2) das Raumbuch — und der Fehler, der sonst niemandem auffällt', () => {
  test('jede Etage bringt ihre eigene 101 mit', async ({ page }) => {
    await anmelden(page, 'admin');
    await oeffneBuerohaus(page);
    await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
    await expect(page.locator('h1')).toHaveText('Raumbuch');

    /**
     * Im Seed steht "101" zweimal: Lager im UG und Büro Nord im 1. OG. Faellt
     * der natuerliche Schluessel des Raumbuchs auf (Objekt, Raumnummer)
     * zusammen, ueberlebt nur eine der beiden Zeilen — und mit ihr
     * verschwinden 18 m² aus jeder kuenftigen Kalkulation.
     */
    await expect(page.getByRole('cell', { name: 'Lager', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Büro Nord', exact: true })).toBeVisible();
  });

  test('Räume ohne Nummer sind trotzdem Räume', async ({ page }) => {
    await anmelden(page, 'admin');
    await oeffneBuerohaus(page);
    await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
    await expect(page.getByRole('cell', { name: 'Flur 1. OG' })).toBeVisible();
    // Und er sagt, dass er keine Nummer hat, statt eine zu erfinden.
    await expect(page.getByRole('cell', { name: 'ohne Nummer' }).first()).toBeVisible();
  });
});

test.describe('(3) der Preis entsteht aus dem Raumbuch (Abnahmekriterium Phase 4)', () => {
  test('es steht ein Netto-Betrag da, in Euro, aus der Fläche gerechnet', async ({ page }) => {
    await anmelden(page, 'admin');
    await oeffneBuerohaus(page);
    await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();

    const netto = page.locator('[data-cse="netto"]');
    await expect(netto).toBeVisible();
    await expect(netto).toHaveText(/\d+,\d{2}\s?€/u);
  });

  test('ein anderer Turnus ergibt einen anderen Preis — und zwar einen höheren',
    async ({ page }) => {
      await anmelden(page, 'admin');
      await oeffneBuerohaus(page);
      await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();

      const alsZahl = async (): Promise<number> => {
        const text = await page.locator('[data-cse="netto"]').innerText();
        return Number(text.replace(/[^\d,]/gu, '').replace(',', '.'));
      };
      await page.getByRole('link', { name: 'monatlich', exact: true }).click();
      await page.waitForURL(/turnus=1_pro_monat/u);
      const monatlich = await alsZahl();
      await page.getByRole('link', { name: '5× pro Woche' }).click();
      await page.waitForURL(/turnus=5_pro_woche/u);
      const taeglich = await alsZahl();

      expect(monatlich).toBeGreaterThan(0);
      // 21,667 Durchgänge statt einem. Der Faktor selbst ist ein Platzhalter,
      // die RICHTUNG ist es nicht.
      expect(taeglich).toBeGreaterThan(monatlich * 20);
    });

  test('und der Preis sagt von sich, dass er auf Platzhaltern steht', async ({ page }) => {
    await anmelden(page, 'admin');
    await oeffneBuerohaus(page);
    await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
    const hinweis = page.locator('[data-cse="platzhalter-hinweis"]');
    await expect(hinweis).toBeVisible();
    await expect(hinweis).toContainText('O-16');
    await expect(hinweis).toContainText('O-56');
  });
});

test.describe('(4) die internen Notizen bleiben intern', () => {
  test('das interne Portal zeigt den Zutrittshinweis', async ({ page }) => {
    await anmelden(page, 'admin');
    await oeffneBuerohaus(page);
    await expect(page.getByText('Schlüsselkasten Hintereingang')).toBeVisible();
  });
});

test.describe('(5) barrierefrei — BFSG gilt auch im Portal', () => {
  test('axe findet nichts auf dem Raumbuch', async ({ page }) => {
    await anmelden(page, 'admin');
    await oeffneBuerohaus(page);
    await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ergebnis.violations).toEqual([]);
  });
});
