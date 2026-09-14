/**
 * PR 65 im Browser — Buchhaltungsuebersicht, offene Posten, Monatszahlen,
 * Periodenschloss, Kontenrahmen (ACC-07, ACC-08, ACC-01, DSH-04, D-484).
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('Buchhaltung (PR 65)', () => {
  test('die Uebersicht: vier Zahlen, jede fuehrt weiter, jede Karte auf eine Seite', async ({ page }) => {
    await anmelden(page);
    const antwort = await page.goto(`/portal/${MANDANT}/buchhaltung`);
    expect(antwort?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Buchhaltung', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="buchhaltung-kennzahlen"] [data-cse="kpi-wert"]')).toHaveCount(4);
    await expect(page.locator('[data-cse="buchhaltung-kennzahlen"] a')).toHaveCount(4);

    const karten = page.locator('[data-cse="buchhaltung-karte"]');
    expect(await karten.count()).toBeGreaterThanOrEqual(6);
    const ziele = await karten.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const ziel of ziele) {
      const a = await page.goto(ziel);
      expect(a?.status(), ziel).toBe(200);
    }
  });

  test('offene Posten: Altersstruktur, Abstimmung, Debitoren und Kreditoren', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/offene-posten`);
    await expect(page.getByRole('heading', { name: 'Offene Posten', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="alter-klasse"]:visible')).toHaveCount(6);
    await expect(page.locator('[data-cse="posten-abstimmung"]')).toContainText('Abstimmung');
    // Die Klassen summieren sich zur Gesamtzeile — auch am Bildschirm.
    const werte = await page.locator('[data-cse="alter-klasse"]:visible').evaluateAll((els) =>
      els.map((e) => ({ klasse: e.getAttribute('data-klasse'), cent: BigInt(e.getAttribute('data-cent') ?? '0') })));
    const gesamt = werte.find((w) => w.klasse === 'gesamt')?.cent ?? 0n;
    const summe = werte.filter((w) => w.klasse !== 'gesamt').reduce((s, w) => s + w.cent, 0n);
    expect(summe).toBe(gesamt);

    await page.locator('[data-cse="posten-art"] a', { hasText: 'Kreditoren' }).click();
    await expect(page).toHaveURL(/art=kreditor/u);
    await expect(page.getByRole('heading', { name: /Verbindlichkeiten/u, level: 2 })).toBeVisible();
    await page.locator('#stichtag').fill('2026-03-31');
    await page.locator('[data-cse="posten-stichtag"] button[type="submit"]').click();
    await expect(page).toHaveURL(/stichtag=2026-03-31/u);
    await expect(page.getByText('Stichtag 31.03.2026')).toBeVisible();
  });

  test('Monatszahlen sind BWA-artig — zwoelf Monate, jede Zahl fuehrt auf die Liste', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/monatszahlen`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('BWA-artig');
    await expect(page.locator('[data-cse="monatszahlen-lesart"]')).toContainText('keine Betriebswirtschaftliche Auswertung');
    await expect(page.locator('[data-cse="monat-ergebnis"]:visible')).toHaveCount(12);
    await expect(page.locator('[data-cse="monatszahlen-summen"] [data-cse="kpi-wert"]')).toHaveCount(3);

    const erloese = page.locator('[data-cse="monat-erloese"]:visible').first();
    const href = await erloese.getAttribute('href');
    expect(href).toMatch(/\/finanzen\/rechnungen\?monat=\d{4}-\d{2}$/u);
    await erloese.click();
    await expect(page.locator('[data-cse="monat-filter"]')).toBeVisible();

    await page.goto(`/portal/${MANDANT}/buchhaltung/monatszahlen`);
    const aufwand = page.locator('[data-cse="monat-aufwand"]:visible').first();
    await aufwand.click();
    await expect(page).toHaveURL(/\/finanzen\/eingangsrechnungen\?monat=/u);
    await expect(page.locator('[data-cse="monat-filter"]')).toBeVisible();
  });

  test('das Periodenschloss: ein Monat mit Zeilen ohne Konto schliesst nicht — ein leerer Monat vorlaeufig, offen, endgueltig', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/buchhaltung/perioden`);
    await expect(page.getByRole('heading', { name: /^Periodenschloss/u, level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="periode"]')).toHaveCount(12);

    // Der laufende Monat: endgueltig gar nicht; vorlaeufig weist die Datenbank ab,
    // weil der Seed Buchungszeilen ohne Konto traegt (O-05) — und der Satz steht da.
    const heute = new Date().toISOString().slice(0, 7);
    const laufend = page.locator(`[data-cse="periode"][data-monat="${heute}"]`);
    await expect(laufend.getByRole('button', { name: 'Schließen', exact: true })).toBeDisabled();
    await laufend.getByRole('button', { name: 'Vorläufig schließen' }).click();
    await expect(page).toHaveURL(/fehler=datenbank/u);
    await expect(page.locator('[data-cse="periode-abgewiesen"]')).toContainText('ohne Konto');
    await expect(page.locator(`[data-cse="periode"][data-monat="${heute}"]`)).toHaveAttribute('data-status', 'offen');

    // Ein vergangener Monat ohne Zeilen: vorlaeufig, wieder offen, dann endgueltig.
    const januar = `${heute.slice(0, 4)}-01`;
    const monat = () => page.locator(`[data-cse="periode"][data-monat="${januar}"]`);
    await monat().getByRole('button', { name: 'Vorläufig schließen' }).click();
    await expect(page).toHaveURL(/geschlossen=/u);
    await expect(page.locator('[data-cse="periode-vermerkt"]')).toContainText('vorläufig geschlossen');
    await expect(monat()).toHaveAttribute('data-status', 'vorlaeufig_geschlossen');

    await monat().getByRole('button', { name: 'Wieder öffnen' }).click();
    await expect(page.locator('[data-cse="periode-vermerkt"]')).toContainText('wieder geöffnet');
    await expect(monat()).toHaveAttribute('data-status', 'offen');

    await monat().getByRole('button', { name: 'Schließen', exact: true }).click();
    await expect(page.locator('[data-cse="periode-vermerkt"]')).toContainText('geschlossen');
    await expect(monat()).toHaveAttribute('data-status', 'geschlossen');
    await expect(monat()).toContainText('endgültig');
    await expect(monat().getByRole('button')).toHaveCount(0);
  });

  test('Kontenrahmen: fuer die Administration 404, fuer die Super-Administration mit Platzhalter-Hinweis', async ({ page }) => {
    await anmelden(page);
    const antwort = await page.goto(`/portal/${MANDANT}/buchhaltung/konten`);
    expect(antwort?.status()).toBe(404);

    await alsKonto(page, KONTO.gruppe);
    await page.goto(`/portal/${MANDANT}/buchhaltung/konten`);
    const wechsel = page.locator('[data-cse="wechsel-knopf"]');
    if ((await wechsel.count()) > 0) await wechsel.click();
    await expect(page).toHaveURL(new RegExp(`/portal/${MANDANT}/buchhaltung/konten$`, 'u'));
    await expect(page.getByRole('heading', { name: 'Kontenrahmen und Zuordnungen', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="konten-konfiguration"]')).toContainText('O-05');
    await expect(page.locator('[data-cse="zuordnungen-anzahl"]')).toBeVisible();
  });

  test('die Gruppe zeigt das Ergebnis je Monat als Summe der Gesellschaften', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe/finanzen');
    await expect(page.locator('[data-cse="finanzen-monate-ergebnis"]')).toBeVisible();
    await expect(page.locator('[data-cse="gruppe-monat-ergebnis"]:visible')).toHaveCount(12);
    await expect(page.getByText('BWA-artig, keine Betriebswirtschaftliche Auswertung')).toBeVisible();
  });
});
