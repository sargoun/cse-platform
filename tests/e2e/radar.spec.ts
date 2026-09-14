/**
 * Der Vergaberadar im Browser (RAD-04 … RAD-09, D-07, D-489, D-490).
 *
 * Geprüft wird das, was eine Liste am Morgen leisten muss und was keine
 * Einheitsprüfung zeigen kann:
 *
 *  1. Die Rangfolge steht da, mit der Begründung dahinter — und die Frist
 *     unter fünf Tagen ist auf den ersten Blick zu sehen (RAD-06).
 *  2. Das Detail rechnet die Punktzahl auf: jede Regel mit ihrem Beitrag.
 *     Eine Fremdwährung wird NICHT umgerechnet und sagt warum (O-47).
 *  3. Der Stand lässt sich setzen — und Verwerfen ohne Grund wird abgewiesen
 *     (RAD-07), nicht stillschweigend hingenommen.
 *  4. **Nirgends ein Knopf „einreichen"** (D-07).
 *  5. Jede Gesellschaft sieht ihre eigene Bewertung, nicht die der Schwester.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Vergaberadar (Phase 8)', () => {
  test('die Liste zeigt Punkte, Begruendung und die knappe Frist', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    expect((await page.goto('/portal/reinigung/radar'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Vergaberadar', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="radar-kennzahlen"] [data-cse="kpi-wert"]')).toHaveCount(4);

    /* Die Reinigungsausschreibung steht oben — ihr Profil trifft sie. */
    const tabelle = page.locator('[data-cse="tabelle"]');
    await expect(tabelle).toContainText('Unterhaltsreinigung von drei Dienstgebäuden');

    /* Die Punktzahl traegt ihre Begruendung als Titel — kein Modell, sondern Code (RAD-05). */
    const punkte = page.locator('[data-cse="radar-punkte"]').first();
    await expect(punkte).toContainText('/');
    expect(await punkte.getAttribute('title')).toMatch(/Punkten für/u);

    /* Keine Quelle verbunden — und die Seite sagt es, statt einen leeren Tag vorzutaeuschen. */
    await expect(page.locator('[data-cse="radar-quellen"]')).toContainText('O-366');

    /* Nirgends ein „einreichen" (D-07). */
    expect(await page.locator('text=/einreichen/iu').count()).toBe(0);
  });

  test('eine Frist unter fuenf Tagen ist auf den ersten Blick zu sehen (RAD-06)', async ({ page }) => {
    await anmelden(page, KONTO.adminSecurity);
    await page.goto('/portal/security/radar');
    /*
     * Gesucht wird die Zeile, nicht die Zahl: „noch 3 Tage" waere Sekunden
     * spaeter „noch 2 Tage", weil die Anzeige abrundet — und ein Test, der
     * daran haengt, faellt irgendwann nachts ohne Grund.
     */
    const knapp = page.locator('[data-cse="radar-frist"][data-rest]').first();
    await expect(knapp).toBeVisible();
    const rest = Number(await knapp.getAttribute('data-rest'));
    expect(rest, 'die knappste Frist steht oben in der Liste').toBeLessThan(5);
    await expect(knapp).toContainText(/noch \d+ Tage?|heute/u);
    const klasse = await knapp.locator('span').first().getAttribute('class');
    expect(klasse, 'unter fuenf Tagen traegt die Zahl den Warnton').toContain('text-danger');
  });

  test('das Detail rechnet die Punktzahl auf — und rechnet eine Fremdwaehrung NICHT um', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/radar');
    await page.locator('[data-cse="tabelle"] a', { hasText: 'Nettoyage de bâtiments' }).first().click();
    await page.waitForURL(/\/radar\/[0-9a-f-]{36}$/u);

    /* Jede der sechs Regeln steht mit ihrem Beitrag da. */
    const regeln = page.locator('[data-cse="radar-regel"]');
    await expect(regeln).not.toHaveCount(0);
    await expect(page.locator('[data-cse="radar-regel"][data-regel="cpv"]')).toBeVisible();
    await expect(page.locator('[data-cse="radar-regel"][data-regel="region"]')).toBeVisible();
    await expect(page.locator('[data-cse="radar-regel"][data-regel="wert"]')).toContainText('O-47');

    /* Der Wert steht in seiner Waehrung, unumgerechnet. */
    await expect(page.locator('[data-cse="radar-stammdaten"]')).toContainText('CHF');
    await expect(page.locator('[data-cse="radar-stammdaten"]')).toContainText('nicht umgerechnet');
  });

  test('der Stand laesst sich setzen — verwerfen ohne Grund nicht (RAD-07)', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/radar');
    await page.locator('[data-cse="tabelle"] a', { hasText: 'Unterhaltsreinigung von drei' }).first().click();
    await page.waitForURL(/\/radar\/[0-9a-f-]{36}$/u);

    await page.locator('[data-cse="radar-geprueft"]').click();
    await page.waitForURL(/vermerkt=geprueft/u);
    await expect(page.locator('[data-cse="radar-vermerkt"]')).toContainText('geprueft');

    /* Verwerfen ohne Grund: abgewiesen, mit einem Satz, der sagt warum. */
    await page.locator('[data-cse="radar-verworfen"]').click();
    await page.waitForURL(/fehler=grund/u);
    await expect(page.locator('[data-cse="radar-abgewiesen"]')).toContainText('Grund');

    /* Mit Grund geht es. */
    await page.fill('input[name="grund"]', 'Keine Kapazität im Zeitraum der Leistung.');
    await page.locator('[data-cse="radar-verworfen"]').click();
    await page.waitForURL(/vermerkt=verworfen/u);
    await expect(page.locator('[data-cse="radar-vermerkt"]')).toContainText('verworfen');
  });

  test('Profile und Plattformen sagen, was Platzhalter ist und was fehlt', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);

    expect((await page.goto('/portal/reinigung/radar/profile'))?.status()).toBe(200);
    await expect(page.locator('[data-cse="radar-profile-platzhalter"]')).toContainText('O-15');
    await expect(page.locator('[data-cse="radar-profil"]').first()).toContainText('Unterhaltsreinigung Berlin');
    await expect(page.locator('[data-cse="radar-profil-version"]').first()).toContainText('Bewertungen');

    /*
     * **RAD-08 sagt, dass es NICHT meldet** (O-15). Der Seed traegt die
     * Einsatzleitung als Empfaengerin ein, aber ohne Punktschwelle — genau
     * die Lage eines neuen Betriebs. Eine Seite, die das verschweigt, laesst
     * jemanden auf Meldungen warten, die nie kommen.
     */
    const empfaenger = page.locator('[data-cse="radar-empfaenger"]').first();
    await expect(empfaenger).toBeVisible();
    expect(await empfaenger.getAttribute('data-schwelle'),
      'ohne Schwelle steht dort nichts').toBe('');
    await expect(empfaenger).toContainText('keine Treffermeldung');
    await expect(page.locator('[data-cse="radar-profil-benachrichtigung"]').first(),
      'die Fristwarnung braucht keine Einstellung').toContainText('fünf Tage');

    expect((await page.goto('/portal/reinigung/radar/plattformen'))?.status()).toBe(200);
    /* Der Katalog ist leer — mit Absicht, und die Seite sagt warum (O-07). */
    await expect(page.locator('[data-cse="plattform-leer"]')).toContainText('O-07');
  });

  test('jede Gesellschaft sieht ihre eigene Bewertung', async ({ page }) => {
    await anmelden(page, KONTO.adminBau);
    await page.goto('/portal/bau/radar');
    await expect(page.locator('[data-cse="tabelle"]')).toContainText('Ausbau und Rückbau Berlin');
    expect(await page.locator('[data-cse="tabelle"]').innerText())
      .not.toContain('Unterhaltsreinigung Berlin');
  });
});
