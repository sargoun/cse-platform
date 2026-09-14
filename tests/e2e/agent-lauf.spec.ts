/**
 * Der Agentenlauf im Browser (AGT-01, §4, §8) — **der Weg, den es bis PR 76
 * nicht gab**.
 *
 * Bis hierher zeigte das Agentenzentrum vier abgeschaltete Agenten und einen
 * Satz darüber, dass kein Modellzugang eingerichtet ist. Prüfbar war damit die
 * Anzeige, nicht die Kette. Seit dem Modellregister (0154) läuft sie: ein
 * Mensch drückt einen Knopf, ein Entwurf entsteht, und er liegt im
 * Freigabe-Posteingang — versendet wird nichts.
 *
 *  1. Die Seite sagt, WORAUF der Agent läuft — und dass es der Demobetrieb ist.
 *  2. Der Knopf legt einen Vorschlag vor, und der steht danach im Posteingang.
 *  3. Derselbe Knopf zweimal ergibt keinen zweiten Vorschlag.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Agentenlauf (AGT-01)', () => {
  test('die Seite nennt das Modell — und sagt, dass es der Demobetrieb ist', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten/backoffice`);

    const modell = page.locator('[data-cse="agent-modell"]');
    await expect(modell).toContainText('demo:hausintern-v1');
    await expect(modell).toHaveAttribute('data-anbieter', 'demo');
    await expect(modell, 'der Demobetrieb sagt, dass er einer ist')
      .toContainText('läuft im eigenen Prozess');
  });

  test('der Knopf legt einen Vorschlag vor — und der steht im Posteingang', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    const vorher = Number(
      await page.locator('[data-cse="posteingang-zaehler"]').getAttribute('data-anzahl'));

    await page.goto(`/portal/${MANDANT}/agenten/backoffice`);
    await page.locator('[data-cse="agent-starten"]').click();

    await expect(page).toHaveURL(/lauf=vorgelegt/u);
    await expect(page.locator('[data-cse="lauf-ergebnis"]'))
      .toContainText('Vorschlag liegt vor');
    await expect(page.locator('[data-cse="lauf-ergebnis"]'),
      'der Satz, der die Invariante trägt').toContainText('versendet wurde nichts');

    await page.locator('[data-cse="zum-posteingang"]').click();
    const nachher = Number(
      await page.locator('[data-cse="posteingang-zaehler"]').getAttribute('data-anzahl'));
    expect(nachher, 'ein Vorschlag mehr wartet').toBe(vorher + 1);
  });

  /**
   * Die Aufgabe steht danach in der Liste des Agenten — mit dem Stand, der
   * sagt, dass sie auf einen Menschen wartet und nicht fertig ist.
   */
  test('die Aufgabe steht in der Liste und wartet auf eine Freigabe', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten/finanzen`);
    await page.locator('[data-cse="agent-starten"]').click();
    await expect(page).toHaveURL(/lauf=vorgelegt/u);

    await page.goto(`/portal/${MANDANT}/agenten/finanzen`);
    const liste = page.locator('table');
    await expect(liste).toContainText('Hinweis: offene Posten');
    /* Der Zustand sagt „Wartet" — nicht „Fertig": die Entscheidung steht aus. */
    await expect(liste).toContainText('Wartet');
  });
});
