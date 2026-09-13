/**
 * Die Einstellungen einer Gesellschaft im Browser (AUT-03, TEN-01, D-476).
 *
 *  1. Der Einstieg zeigt nur Karten, deren Seite diese Sitzung sehen darf —
 *     keine Karte fuehrt auf 404 (AUT-06).
 *  2. Unternehmensdaten sagen zuerst, dass sie unbestaetigt sind (O-353).
 *  3. Die Benutzerliste kennt den zweiten Faktor; fremde Sitzungen bleiben
 *     verborgen, eigene nicht.
 *  4. Rollen und Module verlangen mehr, als eine Administration hat: 404 —
 *     und ueber die Gruppensitzung (Super-Administration) den Wechsel.
 */
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

test.describe('Einstellungen', () => {
  test('der Einstieg zeigt der Administration ihre Karten — und keine auf 404', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/einstellungen');
    await expect(page.getByRole('heading', { name: 'Einstellungen', level: 1 })).toBeVisible();
    const karten = page.locator('[data-cse="einstellungen-karte"]');
    await expect(karten.filter({ has: page.locator('text=Unternehmensdaten') })).toHaveCount(1);
    await expect(karten.filter({ has: page.locator('text=Benutzer') })).toHaveCount(1);
    // `admin` haelt weder `system.rolle_lesen` noch `system.module_zuweisen`.
    await expect(page.locator('[data-cse="einstellungen-karte"][data-ziel="einstellungen/rollen"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="einstellungen-karte"][data-ziel="einstellungen/module"]')).toHaveCount(0);

    // Jede gezeigte Karte antwortet 200.
    const ziele = await karten.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    expect(ziele.length).toBeGreaterThan(0);
    for (const ziel of ziele) {
      const antwort = await page.goto(ziel);
      expect(antwort?.status(), ziel).toBe(200);
    }
  });

  test('Unternehmensdaten: Firma, Anschrift aus dem Auftritt — und der Vorbehalt (O-353)', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/einstellungen/mandant');
    await expect(page.getByRole('heading', { name: 'Unternehmensdaten', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="angaben-unbestaetigt"]')).toBeVisible();
    await expect(page.getByText('CSE Dienstleistungen GmbH')).toBeVisible();
    await expect(page.getByText('Kurfürstendamm 201')).toBeVisible();
    await expect(page.locator('main form')).toHaveCount(0);
  });

  test('Benutzer: die Konten der Gesellschaft, der zweite Faktor, die eigenen Sitzungen', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/einstellungen/benutzer');
    const zaehler = page.locator('[data-cse="benutzer-zaehler"]');
    expect(Number(await zaehler.getAttribute('data-anzahl'))).toBeGreaterThan(1);
    // Fatima arbeitet in der Reinigung — ein Konto dieser Gesellschaft.
    await page.locator('[data-cse="tabelle"] a', { hasText: 'Yildiz' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Yildiz/u })).toBeVisible();
    await expect(page.locator('[data-cse="sitzungen-fremd"]')).toBeVisible();

    // Das eigene Konto: die Sitzungen sind lesbar — mindestens diese eine.
    await page.goto('/portal/reinigung/einstellungen/benutzer');
    await page.locator('[data-cse="tabelle"] a', { hasText: 'Admin' }).first().click();
    await expect(page.locator('[data-cse="sitzungen-fremd"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="tabelle"]').last().locator('tbody tr').first()).toBeVisible();
  });

  test('Rollen: fuer die Administration 404, fuer die Super-Administration die Matrix', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung/einstellungen/rollen');
    expect(antwort?.status()).toBe(404);

    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/reinigung/einstellungen/rollen');
    await page.locator('[data-cse="wechsel-knopf"]').click();
    await expect(page).toHaveURL(/\/portal\/reinigung\/einstellungen\/rollen$/u);
    await expect(page.locator('[data-cse="rollen-liste"] [data-cse="tabelle"] tbody tr')).toHaveCount(7);
    await page.locator('[data-cse="tabelle"] a', { hasText: 'Leitung' }).click();
    await expect(page.getByRole('heading', { name: 'Leitung', level: 1 })).toBeVisible();
    const gilt = page.locator('[data-cse="rechte-matrix"] [data-cse="tabelle"] [data-gilt="ja"]');
    expect(await gilt.count()).toBeGreaterThan(0);

    await page.goto('/portal/reinigung/einstellungen/module');
    await expect(page.locator('[data-cse="gewerke"] [data-gewerk="reinigung"][data-gebucht="true"]')).toBeVisible();
    await page.goto('/portal/reinigung/einstellungen/protokoll');
    await expect(page.getByRole('heading', { name: 'Protokoll', level: 1 })).toBeVisible();
  });

  test('Integrationen und Auftragsverarbeiter sagen, was NICHT verbunden ist', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/reinigung/einstellungen/integrationen');
    await page.locator('[data-cse="wechsel-knopf"]').click();
    await expect(page).toHaveURL(/\/einstellungen\/integrationen$/u);
    const zaehler = page.locator('[data-cse="integrationen-zaehler"]');
    expect(Number(await zaehler.getAttribute('data-anzahl'))).toBeGreaterThanOrEqual(10);
    // Kein Versender, kein Modell, keine Karte: die Zeilen sagen es, statt zu schweigen.
    const nichtVerbunden = page.locator('[data-cse="integrationen"] [data-cse="tabelle"] [data-stand="nicht_verbunden"]');
    expect(await nichtVerbunden.count()).toBeGreaterThanOrEqual(5);
    // DATEV ist Dateiexport — mit Absicht, nicht aus Mangel (D-06).
    await expect(page.locator('[data-cse="integrationen"] [data-cse="tabelle"] [data-stand="dateiexport"]')).toHaveCount(1);
    await expect(page.locator('main form')).toHaveCount(0);

    await page.goto('/portal/reinigung/einstellungen/dpa');
    await expect(page.getByRole('heading', { name: 'Auftragsverarbeiter', level: 1 })).toBeVisible();
    // Drei Dienste, kein Vertragsdatum erfunden.
    await expect(page.locator('[data-cse="dpa-zaehler"]')).toHaveAttribute('data-ohne-vertrag', '3');
    await expect(page.locator('[data-cse="dpa-register"] [data-cse="tabelle"] tbody tr')).toHaveCount(3);
  });
});
