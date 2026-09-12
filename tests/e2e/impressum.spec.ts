import { expect, test } from '@playwright/test';

/**
 * § 5 TMG ist eine PFLICHT, und eine unvollstaendige Erfuellung sieht aus wie
 * eine vollstaendige.
 *
 * Auf `/impressum` stand ein Satz: Anschrift und Telefon im Fussbereich,
 * Handelsregister, Umsatzsteuer-Identifikationsnummer und Geschaeftsfuehrung
 * „werden hier je Gesellschaft ergaenzt, sobald die Angaben bestaetigt sind".
 * Die Angaben lagen zu dem Zeitpunkt bereits in `mandant` — dort, wo auch die
 * Rechnung sie hernimmt.
 *
 * Diese Pruefung haelt zwei Dinge fest, die leicht auseinanderlaufen: dass die
 * Angaben ERSCHEINEN, und dass eine FEHLENDE Angabe sichtbar fehlt statt
 * weggelassen zu werden.
 */
test.describe('das Impressum traegt die Pflichtangaben', () => {
  test('jede Gesellschaft mit Firma, Register und USt-IdNr.', async ({ page }) => {
    const antwort = await page.goto('/impressum');
    expect(antwort?.status()).toBe(200);

    const block = page.locator('[data-cse="gesellschaften"]');
    await expect(block).toBeVisible();

    const zeilen = block.locator('[data-cse="gesellschaft"]');
    /*
     * Vier Gesellschaften — dieselbe Zahl wie im Fussbereich und in
     * `mandant`. `toHaveCount` und nicht `first()`: dass es genau vier sind,
     * ist die Zusicherung; eine fuenfte, die niemand ins Impressum nimmt,
     * waere genau der Fehler.
     */
    await expect(zeilen).toHaveCount(4);
    for (const slug of ['reinigung', 'security', 'bau', 'operations']) {
      await expect(block.locator(`[data-slug="${slug}"]`), slug).toHaveCount(1);
    }

    // Die Angaben, die § 5 TMG nennt, stehen als Beschriftungen da.
    await expect(block).toContainText('Handelsregister');
    await expect(block).toContainText('Umsatzsteuer-Identifikationsnummer');
    await expect(block).toContainText('Vertreten durch');

    // Und eine echte Nummer, nicht nur die Beschriftung.
    await expect(block.locator('[data-slug="reinigung"]'))
      .toContainText('Amtsgericht Charlottenburg');
  });

  test('was fehlt, steht als Fehlendes da — nicht gar nicht', async ({ page }) => {
    await page.goto('/impressum');
    const block = page.locator('[data-cse="gesellschaften"]');
    /*
     * `geschaeftsfuehrer` ist im Seed noch leer. Solange das so ist, MUSS die
     * Seite das sagen: eine ausgelassene Zeile im Impressum liest sich als
     * „diese Angabe gibt es nicht", und das waere eine Aussage ueber die
     * Gesellschaft statt ueber den Datenstand.
     *
     * Wird der Wert eines Tages gesetzt, faellt diese Pruefung — und das ist
     * richtig so: dann gehoert sie umgeschrieben, nicht der Hinweis entfernt.
     */
    await expect(block).toContainText('noch nicht hinterlegt');
  });

  test('auf Englisch dieselbe Auskunft', async ({ page }) => {
    const antwort = await page.goto('/en/impressum');
    expect(antwort?.status()).toBe(200);
    const block = page.locator('[data-cse="gesellschaften"]');
    await expect(block).toBeVisible();
    await expect(block).toContainText('VAT identification number');
    await expect(block.locator('[data-cse="gesellschaft"]')).toHaveCount(4);
  });
});
