/**
 * **Die Ausgabe einer Check-in-Marke — der Weg, den nie jemand gegangen ist**
 * (TIM-09, D-579).
 *
 * `/portal/[mandant]/zeiten/checkin-links` liest den Übergabe-Keks und löscht
 * ihn im selben Atemzug: `keks.delete(MARKE_KEKS)`, mitten im Rendern einer
 * SERVER-Komponente. Ob Next.js das zulässt, hat nie jemand ausprobiert — der
 * Keks steht nur da, wenn unmittelbar davor eine Marke ausgegeben wurde, und
 * kein Test hat je auf den Knopf gedrückt. Der Verweis-Durchlauf besucht die
 * Seite sehr wohl, aber ohne Keks; dann läuft die Zeile gar nicht.
 *
 * Das ist die Form, in der dieses Projekt seine teuersten Fehler hatte: jede
 * Datei für sich grün, der Weg dazwischen nie gegangen. Gemeldet hat es die
 * Copilot-Runde auf PR 16.
 *
 * Eigene Datei und nicht `checkin.spec.ts`: dort steht ein `test.use` mit
 * 375 px für die Stempelfläche am Telefon. Hier geht es um den Bildschirm der
 * Einsatzleitung.
 */
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const SEITE = '/portal/reinigung/zeiten/checkin-links';

test.describe('Check-in-Marke ausgeben (TIM-09)', () => {
  test('nach dem Ausgeben steht der Link da — und die Seite bricht nicht', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto(SEITE);

    const knopf = page.locator('[data-cse="marke-ausgeben"]').first();
    await expect(knopf, 'ohne Einteilung gibt es nichts auszugeben').toBeVisible();
    await knopf.click();
    await page.waitForURL(/checkin-links/u);

    /*
     * **Die Seite muss STEHEN.** Ein Keks, der im Rendern gelöscht wird, wirft
     * in Next 15 — dann stünde hier die Fehlerhülle statt der Überschrift, und
     * die Einsatzleitung hätte eine Marke ausgegeben, die sie nie zu sehen
     * bekommt. Die Marke wäre dabei WEG: ausgegeben wird sie nur einmal im
     * Klartext.
     */
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="erneut-versuchen"]'),
      'die Fehlerhuelle — die Seite hat beim Rendern geworfen').toHaveCount(0);
    await expect(page.locator('[data-cse="marke-link"]').first()).toBeVisible();
  });

  test('beim zweiten Laden ist sie weg — der Keks traegt sie EINEN Bildschirm weit',
    async ({ page }) => {
      await alsKonto(page, KONTO.adminReinigung);
      await page.goto(SEITE);
      await page.locator('[data-cse="marke-ausgeben"]').first().click();
      await page.waitForURL(/checkin-links/u);
      await expect(page.locator('[data-cse="marke-link"]').first()).toBeVisible();

      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('[data-cse="marke-link"]'),
        'ein zweites Laden zeigt sie nicht noch einmal').toHaveCount(0);
    });
});
