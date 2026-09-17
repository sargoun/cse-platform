import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

/**
 * Der Sprachumschalter des internen Portals (D-592).
 *
 * **Was hier geprueft wird, und was ausdruecklich nicht.** Geprueft wird, dass
 * die Wahl wirkt, bleibt und dorthin zurueckkehrt, wo sie getroffen wurde —
 * und dass sie auf JEDER internen Seite erreichbar ist, nicht nur auf der
 * Kontoseite. Nicht geprueft wird, ob jeder Fliesstext schon uebersetzt ist:
 * die Huelle ist es, die Seiteninhalte folgen. Ein Test, der das jetzt schon
 * behauptete, waere gruen, sobald jemand ihn auf die zwei uebersetzten Seiten
 * einschraenkt — und beweist dann nichts.
 */

/** Zurueck auf Deutsch, damit die Reihenfolge der Tests nichts faerbt. */
test.afterEach(async ({ page }) => {
  await page.goto('/portal/reinigung');
  const de = page.locator('[data-cse="sprachumschalter"] button[value="de"]');
  if (await de.isEnabled()) await de.click();
});

test('die Kopfzeile traegt den Umschalter, und Deutsch ist die Vorgabe', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung');

  const umschalter = page.locator('[data-cse="sprachumschalter"]');
  await expect(umschalter).toBeVisible();
  /*
   * Die aktive Sprache ist ein DEAKTIVIERTER Knopf, kein fehlender: wer
   * „Deutsch" nicht saehe, wuesste nicht, ob er Deutsch hat.
   */
  await expect(umschalter.locator('button[value="de"]')).toBeDisabled();
  await expect(umschalter.locator('button[value="en"]')).toBeEnabled();
  await expect(umschalter.locator('button[value="de"]')).toHaveAttribute('aria-current', 'true');
});

test('ein Klick auf English uebersetzt die Huelle und bleibt auf der Seite', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung/auftraege');

  // Vorher: die Sitzungspunkte stehen auf Deutsch.
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toContainText('Abmelden');

  await page.locator('[data-cse="sprachumschalter"] button[value="en"]').click();

  /*
   * **Dieselbe Adresse, nicht die Kontoseite.** Die Route faellt ohne
   * `zurueck` auf `/portal/konto/profil` — wer die Sprache auf der
   * Auftragsliste wechselt, will die Auftragsliste behalten.
   */
  await expect(page).toHaveURL(/\/portal\/reinigung\/auftraege$/);
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toContainText('Sign out');
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toContainText('Account');
  await expect(page.locator('[data-cse="sprachumschalter"] button[value="en"]')).toBeDisabled();
});

test('die Wahl gilt auf der NAECHSTEN Seite weiter, nicht nur auf dieser', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung');
  await page.locator('[data-cse="sprachumschalter"] button[value="en"]').click();

  /*
   * Der eigentliche Beweis, dass die Wahl in der DATENBANK steht und nicht in
   * einem Zustand dieser einen Antwort: eine andere Seite, frisch geladen.
   */
  await page.goto('/portal/reinigung/objekte');
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toContainText('Sign out');
  await expect(page.locator('[data-cse="sprachumschalter"] button[value="en"]')).toBeDisabled();
});

test('die Gruppenansicht traegt den Umschalter ebenfalls', async ({ page }) => {
  await alsKonto(page, KONTO.gruppe);
  await page.goto('/portal/gruppe');
  await expect(page.locator('[data-cse="sprachumschalter"]')).toBeVisible();
});

test('das Mitarbeiterportal traegt ihn NICHT — es waehlt vier Sprachen im Profil', async ({ page }) => {
  await alsKonto(page, KONTO.fatima);
  await page.goto('/portal/mein');
  /*
   * Zwei Umschalter mit verschiedenen Auswahlmengen auf einem Bildschirm
   * waeren eine Falle: der eine kennt `ar`, der andere ueberschriebe es mit
   * `en`, und niemand saehe, welcher gewonnen hat.
   */
  await expect(page.locator('[data-cse="sprachumschalter"]')).toHaveCount(0);
});

test('am Telefon steht er im „Mehr"-Blatt, nicht in der Kopfzeile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung');

  // Die Kopfzeilen-Navigation ist unter `sm` ausgeblendet — mit ihr der Umschalter.
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toBeHidden();

  await page.locator('[data-cse="mehr"] summary').click();
  const imBlatt = page.locator('[data-cse="mehr-blatt"] [data-cse="sprachumschalter"]');
  await expect(imBlatt).toBeVisible();
  await imBlatt.locator('button[value="en"]').click();
  await expect(page.locator('[data-cse="mehr"] summary')).toContainText('More');
});
