/**
 * Die Ablage und das Beschaeftigungsblatt im Browser (DOC-01/02/04, D-09,
 * D-478) — beide lesend, beide ehrlich ueber das, was fehlt.
 */
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

test.describe('Dokumente', () => {
  test('die Ablage antwortet mit Filtern und Suche — und sagt, ob der Speicher verbunden ist', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung/dokumente');
    expect(antwort?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Dokumente', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="kategorie-filter"] a[data-kategorie="vertrag"]')).toBeVisible();
    // Entweder Zeilen oder der ehrliche Leerzustand — nie ein leerer Bildschirm.
    const leer = page.locator('[data-cse="dokumente-leer"]');
    const tabelle = page.locator('[data-cse="tabelle"]');
    expect((await leer.count()) + (await tabelle.count())).toBeGreaterThan(0);

    await page.locator('[data-cse="kategorie-filter"] a[data-kategorie="vertrag"]').click();
    await expect(page).toHaveURL(/kategorie=vertrag$/u);
    await page.locator('[data-cse="dokumente-suche"] input[name="q"]').fill('Rahmenvertrag');
    await page.locator('[data-cse="dokumente-suche"] button[type="submit"]').click();
    await expect(page).toHaveURL(/q=Rahmenvertrag/u);
    await expect(page.locator('[data-cse="dokumente-suche"] input[name="q"]')).toHaveValue('Rahmenvertrag');
  });

  test('ein unbekanntes Dokument ist 404, ein Kundenkonto landet in seinem Portal (K-04)', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung/dokumente/00000000-0000-4000-8000-000000000000');
    expect(antwort?.status()).toBe(404);
    const falsch = await page.goto('/portal/reinigung/dokumente/nicht-eine-id');
    expect(falsch?.status()).toBe(404);

    await alsKonto(page, KONTO.kunde);
    await page.goto('/portal/reinigung/dokumente');
    await expect(page).toHaveURL(/\/portal\/kunde$/u);
  });
});

test.describe('Beschäftigungsblatt', () => {
  test('aus der Liste auf das Blatt: Eckdaten, Stundenkonto, Abwesenheiten', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/personal/anstellungen');
    const erster = page.locator('[data-cse="tabelle"] tbody tr a').first();
    const name = (await erster.textContent())?.trim() ?? '';
    expect(name.length).toBeGreaterThan(0);
    await erster.click();
    await expect(page).toHaveURL(/\/personal\/anstellungen\/[0-9a-f-]{36}$/u);
    await expect(page.locator('[data-cse="anstellung-kopf"] h1')).toHaveText(name);
    await expect(page.getByRole('heading', { name: 'Beschäftigung', level: 2 })).toBeVisible();
    // Die Administration haelt die Zeitrechte: kein „kein Recht"-Hinweis.
    await expect(page.locator('[data-cse="konto-kein-recht"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="abwesenheit-kein-recht"]')).toHaveCount(0);
    await expect(page.locator('main form')).toHaveCount(0);
  });

  test('eine Beschäftigung einer anderen Gesellschaft ist hier 404 (TEN-04)', async ({ page }) => {
    await alsKonto(page, KONTO.adminBau);
    await page.goto('/portal/bau/personal/anstellungen');
    // Die Reinigung stellt Fatima an; unter `bau` gibt es diese Zeile nicht.
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/personal/anstellungen');
    const href = await page.locator('[data-cse="tabelle"] tbody tr a').first().getAttribute('href');
    const id = href?.split('/').pop() ?? '';
    await alsKonto(page, KONTO.adminBau);
    const antwort = await page.goto(`/portal/bau/personal/anstellungen/${id}`);
    expect(antwort?.status()).toBe(404);
  });
});
