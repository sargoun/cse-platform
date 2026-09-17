import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

/**
 * **Beide Fassungen stehen gleichzeitig im Dokument.** Die der Kopfzeile ist
 * unter `sm` ausgeblendet, die des „Mehr"-Blatts ab `md` — sichtbar ist je
 * nach Breite genau eine, im DOM sind es immer zwei. Jede Auswahl nennt
 * deshalb ihren Ort; ein blosses `[data-cse="sprachumschalter"]` traefe zwei
 * Elemente, und Playwright bricht darauf zu Recht ab.
 */
const KOPF = '[data-cse="sprachumschalter"][data-ort="kopfzeile"]';
const BLATT = '[data-cse="sprachumschalter"][data-ort="blatt"]';

/**
 * Stellt die Sitzung auf Deutsch — ohne ueber den Ausgangszustand etwas zu
 * behaupten.
 *
 * **Diese Suite teilt sich EINE Datenbank und raeumt nicht auf** (Invariante 8):
 * die Sprachwahl eines Falls steht beim naechsten Lauf noch da. Ein Fall, der
 * „am Anfang ist es Deutsch" VORAUSSETZT, prueft deshalb in Wahrheit, wie der
 * vorige Lauf geendet hat. Wer den Uebergang messen will, stellt den
 * Ausgangspunkt selbst her.
 */
async function aufDeutsch(page: import('@playwright/test').Page): Promise<void> {
  const de = page.locator(`${KOPF} button[value="de"]`);
  if (await de.count() === 1 && await de.isVisible() && await de.isEnabled()) await de.click();
}

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

/**
 * Zurueck auf Deutsch, damit die Reihenfolge der Faelle nichts faerbt.
 *
 * **Die Breite wird zuerst zurueckgesetzt.** Der Telefonfall laesst 375px
 * stehen; dort ist der Umschalter der Kopfzeile zwar im Dokument, aber per
 * CSS verborgen, und ein Klick darauf wartet bis zum Zeitablauf auf ein
 * Element, das nie sichtbar wird. Aufgeraeumt wird am Schreibtisch.
 */
test.afterEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/portal/reinigung');
  await aufDeutsch(page);
});

/*
 * **Absichtlich `leitungBau`.** Kein anderer Fall dieser Datei wechselt die
 * Sprache dieses Kontos; seine Vorgabe ist deshalb wirklich die des Seeds und
 * nicht der Rest des vorigen Laufs.
 */
test('die Kopfzeile traegt den Umschalter, und Deutsch ist die Vorgabe', async ({ page }) => {
  await alsKonto(page, KONTO.leitungBau);
  await page.goto('/portal/bau');

  const umschalter = page.locator(KOPF);
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
  await aufDeutsch(page);

  // Vorher: die Sitzungspunkte stehen auf Deutsch.
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toContainText('Abmelden');

  await page.locator(`${KOPF} button[value="en"]`).click();

  /*
   * **Dieselbe Adresse, nicht die Kontoseite.** Die Route faellt ohne
   * `zurueck` auf `/portal/konto/profil` — wer die Sprache auf der
   * Auftragsliste wechselt, will die Auftragsliste behalten.
   */
  await expect(page).toHaveURL(/\/portal\/reinigung\/auftraege$/);
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toContainText('Sign out');
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toContainText('Account');
  await expect(page.locator(`${KOPF} button[value="en"]`)).toBeDisabled();
});

test('die Wahl gilt auf der NAECHSTEN Seite weiter, nicht nur auf dieser', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung');
  await aufDeutsch(page);
  await page.locator(`${KOPF} button[value="en"]`).click();

  /*
   * Der eigentliche Beweis, dass die Wahl in der DATENBANK steht und nicht in
   * einem Zustand dieser einen Antwort: eine andere Seite, frisch geladen.
   */
  await page.goto('/portal/reinigung/objekte');
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toContainText('Sign out');
  await expect(page.locator(`${KOPF} button[value="en"]`)).toBeDisabled();
});

test('die Gruppenansicht traegt den Umschalter ebenfalls', async ({ page }) => {
  await alsKonto(page, KONTO.gruppe);
  await page.goto('/portal/gruppe');
  await expect(page.locator(KOPF)).toBeVisible();
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
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung');
  await aufDeutsch(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/portal/reinigung');

  // Die Kopfzeilen-Navigation ist unter `sm` ausgeblendet — mit ihr der Umschalter.
  await expect(page.locator('[data-cse="sitzungsnavigation"]')).toBeHidden();

  await page.locator('[data-cse="mehr"] summary').click();
  const imBlatt = page.locator(BLATT);
  await expect(imBlatt).toBeVisible();
  await imBlatt.locator('button[value="en"]').click();
  await expect(page.locator('[data-cse="mehr"] summary')).toContainText('More');
});
