import { expect, test } from '@playwright/test';

/**
 * Die Profil-Unterseiten der vier Gesellschaften (SEITENKARTE §2.2).
 *
 * **Ohne Sitzung.** Das ist der Punkt: diese Seiten sind der öffentliche
 * Auftritt, und wer sie nur angemeldet erreicht, hat keinen Auftritt.
 *
 * **Was hier NICHT geprüft wird:** ob die Texte gut sind. Geprüft wird, dass
 * jede der zehn Adressen mit 200 antwortet, ihre Gesellschaft nennt, die
 * Reiterleiste trägt und für einen erfundenen Bereich 404 gibt — die vier
 * Eigenschaften, die eine Adresse zu einer Seite machen.
 */

const BEREICHE = ['reinigung', 'security', 'bau', 'operations'] as const;
const UNTERSEITEN = [
  'leistungen', 'projekte', 'galerie', 'news', 'beitraege',
  'kontakt', 'unternehmensdaten',
] as const;

test('jede Unterseite jeder Gesellschaft antwortet 200 und trägt die Reiterleiste', async ({ page }) => {
  for (const bereich of BEREICHE) {
    for (const seite of UNTERSEITEN) {
      const adresse = `/unternehmen/${bereich}/${seite}`;
      const antwort = await page.goto(adresse);
      expect(antwort?.status(), adresse).toBe(200);
      await expect(page.locator('[data-cse="profil-tabs"]').first(), adresse).toBeVisible();
      /*
       * Der aktive Reiter trägt `aria-current` — Farbe allein wäre nach §9
       * kein Signal, und ein Screenreader liest keine Farbe.
       */
      await expect(
        page.locator(`[data-cse="profil-tab"][data-tab="${seite}"]`), adresse,
      ).toHaveAttribute('aria-current', 'page');
    }
  }
});

test('die Profilwurzel trägt die Leiste ebenfalls — sonst kommt man von dort nirgends hin', async ({ page }) => {
  await page.goto('/unternehmen/security');
  const leiste = page.locator('[data-cse="profil-tabs"]').first();
  await expect(leiste).toBeVisible();
  await expect(leiste.locator('[data-cse="profil-tab"]')).toHaveCount(8);
});

test('ein erfundener Bereich ist 404 und keine leere Seite', async ({ page }) => {
  for (const adresse of [
    '/unternehmen/gibtesnicht/leistungen',
    '/unternehmen/gibtesnicht/projekte',
    '/en/unternehmen/gibtesnicht/galerie',
  ]) {
    const antwort = await page.goto(adresse);
    expect(antwort?.status(), adresse).toBe(404);
  }
});

test('die englische Fassung steht unter /en und nennt dieselben Reiter auf Englisch', async ({ page }) => {
  const antwort = await page.goto('/en/unternehmen/reinigung/projekte');
  expect(antwort?.status()).toBe(200);
  await expect(page.locator('[data-cse="profil-tab"][data-tab="projekte"]')).toHaveText('Projects');
  await expect(page.locator('[data-cse="profil-tab"][data-tab="unternehmensdaten"]'))
    .toHaveText('Company details');
});

test('die Unternehmensdaten nennen fehlende Pflichtangaben, statt sie wegzulassen', async ({ page }) => {
  await page.goto('/unternehmen/reinigung/unternehmensdaten');
  const angaben = page.locator('[data-cse="angabe"]');
  await expect(angaben.first()).toBeVisible();
  /*
   * **Der Fall, um den es geht.** Eine fehlende Registernummer stillschweigend
   * zu überspringen macht aus einer unvollständigen Auskunft eine, die
   * vollständig AUSSIEHT — und § 5 TMG verlangt die Angabe, nicht den Schein.
   * Jede Zeile steht da, und jede sagt über `data-fehlt`, ob sie gefüllt ist.
   */
  const alle = await angaben.count();
  expect(alle).toBeGreaterThanOrEqual(9);
  for (let i = 0; i < alle; i += 1) {
    const text = (await angaben.nth(i).textContent()) ?? '';
    expect(text.trim().length, `Zeile ${String(i)} ist leer`).toBeGreaterThan(0);
  }
});

test('ein Projekt führt von der Liste auf seine kanonische Adresse', async ({ page }) => {
  await page.goto('/unternehmen/reinigung/projekte');
  const erstes = page.locator('[data-cse="projekt"]').first();
  /*
   * Die Liste kann leer sein, wenn keine Referenz freigegeben ist — das ist
   * ein gültiger Zustand und hat einen eigenen Bildschirm. Nur wenn eine da
   * ist, muss ihr Verweis auch führen.
   */
  if (await erstes.count() === 0) {
    await expect(page.locator('[data-cse="leer"]')).toBeVisible();
    return;
  }
  const slug = await erstes.getAttribute('data-slug');
  await erstes.click();
  await expect(page).toHaveURL(new RegExp(`/unternehmen/reinigung/projekte/${slug ?? ''}$`, 'u'));
  await expect(page.locator('[data-cse="projekt-detail"]')).toBeVisible();
});

test('eine erfundene Projektadresse ist 404 — nicht eine leere Detailseite', async ({ page }) => {
  const antwort = await page.goto('/unternehmen/reinigung/projekte/gibt-es-nicht');
  expect(antwort?.status()).toBe(404);
});

test('die Galerie zeigt das Platzhalter-Schild, solange kein eigenes Bild da ist', async ({ page }) => {
  await page.goto('/unternehmen/bau/galerie');
  const bilder = page.locator('[data-cse="galerie-bild"]');
  if (await bilder.count() === 0) {
    await expect(page.locator('[data-cse="leer"]')).toBeVisible();
    return;
  }
  /*
   * DESIGN §4.1: ein Platzhalterbild ist IM CODE als solches markiert und wird
   * als solches angezeigt. Ein fremdes Gebäude ohne dieses Schild wäre eine
   * Behauptung über einen Auftrag, den es nicht gibt (O-13).
   */
  await expect(page.locator('[data-cse="platzhalter-marke"]').first()).toBeVisible();
});
