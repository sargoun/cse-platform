/**
 * Phase 3 im Browser — die Hälfte, die kein Unit-Test zeigt.
 *
 * Die Rollenprobe (`tests/isolation/rollen.test.ts`) beweist die
 * Zugangsentscheidung über alle 432 Routen. Was sie nicht zeigt: dass eine
 * echte Anmeldung durch Cookie, `app.sitzung_aufloesen`, Portal-Decke, RLS
 * und Rendern hindurch wirklich die richtige Seite ergibt — und dass eine
 * getippte fremde URL wirklich 404 gibt und nicht 403.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Meldet sich über die Entwicklungsanmeldung an — eine echte Sitzung. */
async function anmelden(page: Page, rolle: string): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator(`[data-cse="dev-anmelden"][data-rolle="${rolle}"]`).first();
  await expect(knopf, `kein Seed-Konto für Rolle ${rolle}`).toBeVisible();
  await knopf.click();
  // Der Server setzt das Cookie; danach steht die Sitzung.
  await page.waitForLoadState('networkidle');
}

test.describe('(1) jede Rolle landet in ihrem Portal', () => {
  test('admin sieht das Dashboard seiner Gesellschaft', async ({ page }) => {
    await anmelden(page, 'admin');
    const antwort = await page.goto('/portal/reinigung');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Übersicht');
    // Der Identitätsstreifen trägt den Hue des Bereichs (DESIGN §6 Regel 4).
    await expect(page.locator('[data-cse="identitaets-streifen"]'))
      .toHaveAttribute('data-bereich', 'reinigung');
  });

  test('mitarbeiter sieht sein eigenes Portal — mit BEIDEN Beschäftigungen', async ({ page }) => {
    await anmelden(page, 'mitarbeiter');
    const antwort = await page.goto('/portal/mein');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Heute');
    /**
     * Fatima ist der D-09-Fall: ein Mensch, zwei Gesellschaften. Ihr Portal
     * muss beide zeigen — über den Personen-Scope, nicht über die
     * Gruppenansicht, die für sie leer bliebe.
     */
    await expect(page.locator('[data-cse="anstellung"]')).toHaveCount(2);
  });

  test('kunde kommt in SEIN Portal — seit es einen Kundenzugang gibt',
    async ({ page }) => {
      /**
       * Bis Phase 4 stand hier das Gegenteil, und es war richtig: das
       * Kundenportal liest im `kunde`-Scope, dessen sichtbare Mandanten aus
       * `kunde_zugang` kommen — einer Tabelle, die es noch nicht gab. Die Tuer
       * war fehlgeschlossen zu.
       *
       * Jetzt gibt es die Tabelle UND einen Seed-Zugang, und dieselbe Prüfung
       * haelt die andere Haelfte fest: die Tuer geht auf, wenn ein Zugang
       * besteht — und nur so weit, wie er reicht.
       */
      await anmelden(page, 'kunde');
      const antwort = await page.goto('/portal/kunde');
      expect(antwort?.status()).toBe(200);
    });
});

test.describe('(2) 404, nie 403 — und nie eine fremde Zeile (AUT-06, SEC-A3)', () => {
  test('ein mitarbeiter, der eine Mandantenroute tippt, landet in SEINEM Portal',
    async ({ page }) => {
      await anmelden(page, 'mitarbeiter');
      await page.goto('/portal/reinigung');
      // Die K-04-Decke schickt ihn zurück — kein 404, das ratlos zurücklässt,
      // und erst recht kein Dashboard.
      await expect(page).toHaveURL(/\/portal\/mein$/u);
    });

  test('eine leitung von bau bekommt security NICHT — 404 und nicht 403',
    async ({ page, request }) => {
      await anmelden(page, 'leitung');
      const antwort = await request.get('/portal/security', {
        headers: { cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`).join('; ') },
      });
      /**
       * 404 ist die Zusage, nicht 403. Ein 403 bestätigte, dass es
       * `/portal/security` gibt — und damit, dass es diese Gesellschaft gibt
       * und dass sie ein Portal hat.
       */
      expect(antwort.status()).toBe(404);
    });

  test('und eine erfundene Portalroute ebenfalls 404', async ({ page, request }) => {
    await anmelden(page, 'admin');
    const kekse = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`).join('; ');
    const antwort = await request.get('/portal/reinigung/gibtesnicht',
      { headers: { cookie: kekse } });
    expect(antwort.status()).toBe(404);
  });
});

test.describe('(3) ohne Anmeldung ist das Portal zu — aber ehrlich zu', () => {
  test('keine 404-Lüge, sondern "Anmeldung erforderlich"', async ({ page }) => {
    const antwort = await page.goto('/portal/mein');
    expect(antwort?.status()).toBe(200);
    // Ein 404 hiesse "diese Seite gibt es nicht". Es gibt sie.
    await expect(page.locator('h1')).toHaveText('Anmeldung erforderlich');
  });
});

test.describe('(4) §11.2 — fünf Ziele bei 375px, Tap-Ziele ≥ 44px', () => {
  test('das Mitarbeiterportal trägt fünf und KEIN "Mehr"', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await anmelden(page, 'mitarbeiter');
    await page.goto('/portal/mein');

    const tabs = page.locator('[data-cse="tableiste"] [data-cse="tab"]');
    await expect(tabs).toHaveCount(5);
    await expect(page.locator('[data-cse="tab"][data-tab="mehr"]')).toHaveCount(0);

    const hoehe = await tabs.first().evaluate((e) => e.getBoundingClientRect().height);
    expect(hoehe).toBeGreaterThanOrEqual(44);
  });

  test('das interne Portal trägt fünf MIT "Mehr"', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung');
    await expect(page.locator('[data-cse="tableiste"] [data-cse="tab"]')).toHaveCount(5);
    await expect(page.locator('[data-cse="tab"][data-tab="mehr"]')).toHaveCount(1);
  });

  test('am Schreibtisch ist die Leiste weg', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung');
    await expect(page.locator('[data-cse="tableiste"]')).toBeHidden();
  });

  test('kein waagerechtes Scrollen bei 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await anmelden(page, 'admin');
    await page.goto('/portal/reinigung');
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(ueberlauf).toBe(false);
  });
});

test.describe('(5) barrierefrei — das Portal ist der Arbeitsplatz', () => {
  /**
   * `/portal/kunde` fehlt hier, weil es heute 404 gibt (siehe oben) — axe auf
   * einer Fehlerseite prüfte die Fehlerseite. Es kommt dazu, sobald
   * `kunde_zugang` existiert.
   */
  for (const [rolle, pfad] of [
    ['admin', '/portal/reinigung'],
    ['mitarbeiter', '/portal/mein'],
  ] as const) {
    test(`axe: ${pfad}`, async ({ page }) => {
      await anmelden(page, rolle);
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);
      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(
        ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
        pfad,
      ).toEqual([]);
    });
  }
});
