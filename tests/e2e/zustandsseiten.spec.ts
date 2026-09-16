/**
 * Die drei Zustandsseiten im Browser (DESIGN §5 „Status pages").
 *
 * **Der Befund, der sie nötig machte:** 232 Aufrufe von `notFound()` und keine
 * einzige `not-found.tsx`. Jeder davon landete auf Next.js' eigener Vorgabe —
 * schwarz auf weiss, englisch, ohne Inter, ohne einen Weg zurück. Das ist die
 * Seite, die jemand genau in dem Moment sieht, in dem er ohnehin verloren ist.
 *
 * Diese Prüfung geht die beiden Fälle, die ein Mensch wirklich trifft: eine
 * Adresse, die es nie gab, und eine Portalseite, die diesem Konto nicht gehört
 * (AUT-06 — dieselbe Antwort, und der Text muss für beide stimmen).
 */
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { alsKonto, KONTO } from './hilfen/anmeldung';

test.describe('Zustandsseiten', () => {
  test('eine Adresse, die es nie gab, ist 404 — auf Deutsch, mit einem Weg weiter',
    async ({ page }) => {
      const antwort = await page.goto('/gibt-es-nicht-und-gab-es-nie');
      expect(antwort?.status()).toBe(404);

      const seite = page.locator('[data-cse="seite-404"]');
      await expect(seite).toBeVisible();
      await expect(page.locator('[data-cse="zustand-code"]')).toHaveText('404');
      await expect(page.getByRole('heading', { level: 1 }))
        .toHaveText('Diese Seite gibt es hier nicht.');

      /*
       * **Der Weg weiter ist die Zusicherung.** Eine Zustandsseite ohne
       * Verweis ist eine Sackgasse — und genau das war Next.js' Vorgabe.
       */
      await expect(page.locator('[data-cse="zu-start"]')).toBeVisible();
      await page.locator('[data-cse="zu-start"]').click();
      await expect(page).toHaveURL(/\/$/u);
    });

  /**
   * **Ein unbekannter Pfad UNTER `/portal/[mandant]/…` ist kein 404** — und
   * das ist Absicht, nicht eine Lücke. Dort liegt `[...rest]`, die
   * Platzhalterseite für die noch nicht gebauten Bildschirme; sie antwortet
   * mit 200 und sagt hin, dass es diesen Bildschirm noch nicht gibt. Ein 404
   * wäre dort die falsche Auskunft.
   *
   * Der 404 des Portals fällt eine Ebene höher: bei einem Slug, den es nicht
   * gibt — oder der jemand anderem gehört. Genau diese beiden Fälle prüft der
   * nächste Test, und sie sind derselbe Fall (AUT-06).
   */
  test('ein unbekannter Mandant ist 404 — und führt zurück ins Portal',
    async ({ page }) => {
      /*
       * Der Rahmen lässt sich hier nicht mitzeigen (DESIGN §5: `not-found.tsx`
       * bekommt keine `params`, und der Lader, der sie hätte, ruft selbst
       * `notFound()`). Der Ausgleich ist dieser Verweis: die Navigation ist
       * einen Klick weit weg statt weg. Er kommt aus dem PFAD, also zeigt er
       * hier auf die Wurzel des Slugs, den der Browser geschickt hat.
       */
      await page.goto('/dev/anmelden');
      await alsKonto(page, KONTO.leitungReinigung);

      const antwort = await page.goto('/portal/gibt-es-nicht/objekte');
      expect(antwort?.status()).toBe(404);
      await expect(page.getByRole('heading', { level: 1 }))
        .toHaveText('Diese Seite gibt es hier nicht.');
      await expect(page.locator('[data-cse="zum-portal"]')).toBeVisible();
    });

  test('eine fremde Gesellschaft sieht genauso aus wie ein erfundener Slug (AUT-06)',
    async ({ page }) => {
      /*
       * **Das ist der Punkt der ganzen Seite.** Ein Konto der Reinigung fragt
       * nach einer Gesellschaft, in der es NICHT Mitglied ist. Die Antwort muss
       * dieselbe sein wie bei einem Slug, den es gar nicht gibt — ein anderer
       * Text oder ein anderer Statuscode wäre das Orakel, das AUT-06 verhindert:
       * „diese Gesellschaft gibt es, du darfst nur nicht".
       *
       * `app.mandant_fuer_wechsel` gibt für beides dasselbe `null` zurück; hier
       * steht, dass der BILDSCHIRM den Unterschied auch nicht macht.
       */
      await page.goto('/dev/anmelden');
      await alsKonto(page, KONTO.leitungReinigung);

      const antwort = await page.goto('/portal/bau/aufmasse');
      expect(antwort?.status()).toBe(404);
      await expect(page.getByRole('heading', { level: 1 }))
        .toHaveText('Diese Seite gibt es hier nicht.');
      await expect(page.locator('body')).not.toContainText(/Berechtigung|Zugriff verweigert/u);
    });

  /**
   * **Die Gegenprobe zur Statusfrage.** Eine `loading.tsx` würde die Hülle
   * ausliefern, bevor die Seite entschieden hat — mit 200. Diese Prüfung
   * besteht nur, solange keine existiert; sie ist die Browserhälfte von
   * `tests/kern/zustandsseiten.test.ts`.
   */
  test('und eine Seite, die es GIBT, antwortet weiterhin 200', async ({ page }) => {
    const antwort = await page.goto('/unternehmen/reinigung');
    expect(antwort?.status()).toBe(200);
  });

  test('die 404-Seite ist frei von schweren axe-Verstössen (BFSG)', async ({ page }) => {
    await page.goto('/gibt-es-nicht-und-gab-es-nie');
    const befund = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const schwer = befund.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious');
    expect(schwer.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
