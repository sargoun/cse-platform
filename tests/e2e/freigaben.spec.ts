/**
 * PR 62 im Browser — der Posteingang und die Prüfung (APR-01 … APR-03, APR-07,
 * APR-08, D-472).
 *
 * Was die Datenbank kann, steht in `tests/isolation/freigabe-*.test.ts`. Hier
 * steht, was eine Leitung sieht und tut:
 *
 *  1. Der Posteingang steht in der Ordnung des Dienstes — das Dringende oben.
 *  2. Die Prüfung nennt, was sich geändert hat, und woher jeder Wert stammt;
 *     ein unsicheres Feld sperrt den Freigabeknopf sichtbar.
 *  3. Ablehnen braucht einen Grund; mit Grund schreibt es ein Kettenglied.
 *  4. Freigeben ohne unsichere Felder schreibt ein Kettenglied — und die
 *     Freigabe verschwindet aus dem Posteingang.
 *  5. `geoeffnet_am` im Rumpf ist ein 400 (T-36).
 *  6. Wer `freigabe.lesen` nicht hält, sieht die Seite nicht (AUT-06).
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Freigabe-Posteingang', () => {
  test('das Dringende steht oben, mit Zähler', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    await expect(page.getByRole('heading', { name: 'Freigaben', level: 1 })).toBeVisible();

    const zaehler = page.locator('[data-cse="posteingang-zaehler"]');
    expect(Number(await zaehler.getAttribute('data-anzahl'))).toBeGreaterThanOrEqual(2);

    // Der Hinweis hat drei Stunden Frist, die Monatsrechnung zwei Tage.
    const erste = page.locator('table tbody tr').first();
    await expect(erste).toContainText('Leistungsnachweis');
    await expect(erste).toContainText('Unter 4 Stunden');
  });

  test('die Prüfung zeigt Kopfzeile, Diff, Nachweise — und sperrt den Knopf', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    await page.getByRole('link', { name: /Monatsrechnung August 2026/u }).click();

    await expect(page.locator('[data-cse="freigabe-kopfzeile"]'))
      // `formatiereGeld` setzt ein geschütztes Leerzeichen vor das Eurozeichen.
      .toContainText(/Nachtstunden .* neu → \+456,00\s€/u);
    await expect(page.getByRole('heading', { name: 'Was sich geändert hat' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Neue Positionen' })).toContainText('Nachtstunden');
    await expect(page.locator('[data-cse="diff-summen"]')).toContainText(/\+456,00\s€/u);

    // `DataTable` rendert jede Zeile zweimal — Tabelle ab `md`, Stapel darunter
    // (D-420); gezaehlt wird, was zu sehen ist.
    const unsicher = page.locator('[data-cse="feld-unsicher"]:visible');
    await expect(unsicher).toHaveCount(1);
    await expect(unsicher).toContainText('10,5 Nachtstunden');
    await expect(page.locator('[data-cse="freigeben-gesperrt"]')).toBeVisible();
    await expect(page.locator('[data-cse="freigeben"]')).toBeDisabled();
    await expect(page.locator('[data-cse="ablehnen"]')).toBeEnabled();
  });

  test('ablehnen braucht einen Grund — mit Grund entsteht ein Kettenglied', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    await page.getByRole('link', { name: /Monatsrechnung August 2026/u }).click();

    await page.locator('[data-cse="ablehnen"]').click();
    await expect(page).toHaveURL(/fehler=ohne_begruendung/u);
    await expect(page.locator('[data-cse="entscheidung-abgewiesen"]')).toContainText('Begründung');

    await page.locator('#begruendung').fill('Die Nachtstunden stimmen nicht mit dem Stundenkonto überein.');
    await page.locator('[data-cse="ablehnen"]').click();
    await expect(page).toHaveURL(/entschieden=abgelehnt/u);
    await expect(page.locator('[data-cse="entscheidung-vermerkt"]')).toContainText('Kettenglied');
    await expect(page.locator('[data-cse="freigabe-status"]')).toHaveAttribute('data-status', 'abgelehnt');
    await expect(page.locator('[data-cse="schnappschuss"]')).toContainText('SHA-256');
  });

  test('freigeben ohne unsichere Felder — und weg aus dem Posteingang', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    const vorher = Number(await page.locator('[data-cse="posteingang-zaehler"]').getAttribute('data-anzahl'));
    await page.getByRole('link', { name: /Leistungsnachweis/u }).click();

    await expect(page.locator('[data-cse="freigeben"]')).toBeEnabled();
    await page.locator('[data-cse="freigeben"]').click();
    await expect(page).toHaveURL(/entschieden=genehmigt/u);
    await expect(page.locator('[data-cse="freigabe-status"]')).toHaveAttribute('data-status', 'genehmigt');

    await page.goto(`/portal/${MANDANT}/freigaben`);
    const nachher = Number(await page.locator('[data-cse="posteingang-zaehler"]').getAttribute('data-anzahl'));
    expect(nachher).toBe(vorher - 1);
    await expect(page.getByRole('link', { name: /Leistungsnachweis/u })).toHaveCount(0);
  });

  test('geoeffnet_am im Rumpf ist ein 400 — die Prüfdauer misst der Server (T-36)', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    const antwort = await page.request.post(
      `/api/freigaben/00000000-0000-0000-0000-000000000000/entscheidung`,
      {
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        data: { entscheidung: 'genehmigt', geoeffnet_am: '2026-01-01T00:00:00Z' },
      });
    expect(antwort.status()).toBe(400);
    expect((await antwort.json() as { fehler: string }).fehler).toBe('geoeffnet_am_nicht_erlaubt');
  });

  test('wer das Recht nicht hält, sieht den Posteingang nicht (AUT-06)', async ({ page }) => {
    await anmelden(page, KONTO.kunde);
    const antwort = await page.goto(`/portal/${MANDANT}/freigaben`);
    // Die K-04-Decke leitet eine Kundin in ihr Portal — sie erfährt nichts
    // über die Existenz der Seite (D-4xx, siehe agenten.spec.ts).
    expect([200, 404]).toContain(antwort?.status());
    await expect(page.getByRole('heading', { name: 'Freigaben', level: 1 })).toHaveCount(0);
  });
});
