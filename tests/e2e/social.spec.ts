/**
 * Das Social Media Center im Browser (SOC-01…SOC-08).
 *
 * Die Datenbankseite steht in `tests/isolation/social.test.ts`; hier steht,
 * was ein Mensch vor dem Bildschirm sieht — und was er NICHT kann:
 *
 *  1. Der ganze Weg einmal gegangen: anlegen → vorlegen → freigeben (im
 *     Posteingang, nicht hier) → veröffentlichen.
 *  2. **Kein Knopf, der an der Freigabe vorbeiführt.** Das ist die
 *     Zusicherung, nicht die Auslassung (SOC-08).
 *  3. Der Kanalbildschirm sagt bei allen fünf „nicht verbunden" — mit Grund.
 *     Ein Haken ohne Konto dahinter wäre der teuerste Bildschirm des Moduls.
 *  4. Ein veröffentlichter Beitrag steht auf der öffentlichen
 *     Gesellschaftsseite (SOC-05) — ohne Sitzung, ohne fremden Anbieter.
 *  5. Ein nicht verbundener Kanal wird als „nicht verbunden" geführt, NIE als
 *     veröffentlicht (SOC-07).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Social Media Center', () => {
  test('(1) das Center zeigt Kennzahlen, den Plan und den Kanalstand', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/social`);

    await expect(page.locator('h1')).toContainText('Social Media Center');
    await expect(page.locator('[data-cse="social-kennzahlen"]')).toBeVisible();
    // Der Seed legt je Gesellschaft einen geplanten Beitrag an.
    await expect(page.locator('[data-cse="social-plan-zeile"]').first()).toBeVisible();
    // Und er sagt, dass kein fremder Kanal verbunden ist.
    await expect(page.locator('[data-cse="social-kein-kanal"]')).toBeVisible();
  });

  test('(3) alle fünf Kanäle sagen „nicht verbunden" — mit Grund', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/social/kanaele`);

    const kanaele = page.locator('[data-cse="kanal"]');
    await expect(kanaele).toHaveCount(5);
    await expect(page.locator('[data-cse="kanal"][data-verbunden="1"]')).toHaveCount(0);
    // Jeder nennt die fehlenden Zugangsdaten beim Namen.
    await expect(page.locator('[data-cse="kanal-fehlt"]')).toHaveCount(5);
    // Die eigene Seite steht darüber und funktioniert.
    await expect(page.locator('[data-cse="kanal-website"]')).toContainText(/kein Anschluss/u);
  });

  test('(2) der ganze Weg: anlegen, vorlegen, freigeben, veröffentlichen',
    async ({ page }) => {
      await anmelden(page, KONTO.adminReinigung);
      const titel = `Prüfbeitrag ${Date.now().toString(36)}`;

      // — anlegen —
      await page.goto(`/portal/${MANDANT}/social/posts/neu`);
      await page.fill('input[name="titel"]', titel);
      await page.fill('[data-cse="beitrag-text"]', 'Ein Text für die Abnahme.');
      // Ein nicht verbundener Kanal wird BEWUSST mitgewählt (siehe unten).
      await page.locator('[data-cse="kanal-wahl"] input').first().check();
      await page.click('[data-cse="beitrag-anlegen"]');
      await expect(page.locator('[data-cse="beitrag-angelegt"]')).toBeVisible();
      const beitragUrl = page.url();

      // **Kein Weg an der Freigabe vorbei**: weder veröffentlichen noch planen.
      await expect(page.locator('[data-cse="schritt-veroeffentlichen"]')).toHaveCount(0);
      await expect(page.locator('[data-cse="zur-planung"]')).toHaveCount(0);

      // — vorlegen —
      await page.click('[data-cse="schritt-vorlegen"]');
      await expect(page.locator('[data-cse="beitrag-stand"]')).toHaveAttribute(
        'data-status', 'vorgelegt');
      // Ab jetzt ist der Text nicht mehr bearbeitbar.
      await expect(page.locator('[data-cse="nicht-bearbeitbar"]')).toBeVisible();

      // — freigeben: im Posteingang, nicht hier —
      await page.click('[data-cse="zur-freigabe"]');
      await expect(page).toHaveURL(/\/freigaben\//u);
      await page.click('[data-cse="freigeben"]');

      // — der Beitrag ist der Entscheidung gefolgt —
      await page.goto(beitragUrl);
      await expect(page.locator('[data-cse="beitrag-stand"]')).toHaveAttribute(
        'data-status', 'freigegeben');

      // — veröffentlichen —
      await page.click('[data-cse="schritt-veroeffentlichen"]');
      await expect(page.locator('[data-cse="beitrag-stand"]')).toHaveAttribute(
        'data-status', 'veroeffentlicht');

      /*
       * **(5) Der gewaehlte fremde Kanal steht auf `nicht_verbunden`** --
       * nicht auf `veroeffentlicht`, und nicht stillschweigend gar nicht.
       * Genau das ist SOC-07.
       */
      const kanal = page.locator('[data-cse="kanal-ergebnis"]:not([data-plattform="website"])');
      await expect(kanal).toHaveCount(1);
      await expect(kanal).toHaveAttribute('data-ergebnis', 'nicht_verbunden');

      // — (4) und er steht auf der oeffentlichen Gesellschaftsseite —
      await page.goto(`/unternehmen/${MANDANT}`);
      await expect(page.locator('[data-cse="oeffentliche-beitraege"]')).toContainText(titel);
    });

  test('(4) ein Entwurf steht NICHT auf der öffentlichen Seite', async ({ page }) => {
    await page.goto(`/unternehmen/${MANDANT}`);
    const abschnitt = page.locator('[data-cse="oeffentliche-beitraege"]');
    await expect(abschnitt).toBeVisible();
    // Der Seed legt je Gesellschaft genau einen veröffentlichten an.
    await expect(page.locator('[data-cse="oeffentlicher-beitrag"]')).toHaveCount(1);
  });

  test.describe('Barrierefreiheit (BFSG)', () => {
    for (const pfad of ['/social', '/social/posts', '/social/kanaele', '/social/statistik']) {
      test(`${pfad} ist frei von schweren axe-Verstössen`, async ({ page }) => {
        await anmelden(page, KONTO.adminReinigung);
        await page.goto(`/portal/${MANDANT}${pfad}`);
        const ergebnis = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(ergebnis.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
      });
    }
  });
});
