/**
 * Der Raumbuch-Import im Browser (OPS-04).
 *
 * Die Zusage, die hier faellt oder haelt: **zwischen Datei und Raumbuch
 * steht ein Mensch.** Hochladen zeigt eine Vorschau und aendert nichts;
 * erst der zweite Knopf schreibt.
 */
import { expect, test, type Page } from '@playwright/test';

/**
 * SERIELL, und das ist keine Bequemlichkeit.
 *
 * Alle drei Pruefungen arbeiten am selben Seed-Objekt derselben Datenbank:
 * die eine sieht nach, dass das Raumbuch nach dem Hochladen noch LEER ist,
 * die andere fuellt es. Parallel gefahren haengt ihr Ergebnis davon ab, wer
 * zuerst drankommt — und ein Test, dessen Ausgang die Reihenfolge
 * entscheidet, prueft nichts.
 */
test.describe.configure({ mode: 'serial' });

async function anmelden(page: Page, rolle: string): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator(`[data-cse="dev-anmelden"][data-rolle="${rolle}"]`).first();
  await expect(knopf, `kein Seed-Konto für Rolle ${rolle}`).toBeVisible();
  await knopf.click();
  await page.waitForLoadState('networkidle');
}

/** Das leere Objekt aus dem Seed — die Veranstaltungshalle hat kein Raumbuch. */
async function zumImport(page: Page): Promise<void> {
  await page.goto('/portal/reinigung/objekte');
  await page.getByRole('link', { name: 'Veranstaltungshalle Tempelhof' }).click();
  await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
  await page.locator('[data-cse="zum-import"]').click();
  await expect(page.locator('h1')).toHaveText('Raumbuch importieren');
}

const DATEI = [
  'Etage;Raumnummer;Bezeichnung;Fläche m²;Belag;Klasse',
  'EG;001;Halle;1.250,5;BETON;RK2',
  'EG;002;Technik;45,25;BETON;RK4',
  'EG;;Foyer;180,0;FLIESE;RK2',
  'UG;001;Lager;;BETON;RK4',
].join('\n');

test.describe('(1) Hochladen zeigt eine Vorschau und ändert nichts', () => {
  test('vier Zeilen, drei gültig, eine ohne Fläche', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumImport(page);

    await page.setInputFiles('#datei', {
      name: 'raumbuch.csv', mimeType: 'text/csv', buffer: Buffer.from(DATEI, 'utf8'),
    });
    await page.locator('[data-cse="import-hochladen"]').click();
    await page.waitForURL(/\?import=/u);

    await expect(page.locator('[data-cse="fehlerzahl"]')).toHaveText('1');
    // Die Zeile ohne Fläche sagt, warum sie nicht mitkommt.
    // Zweimal im Baum, weil die Tabelle ab 768px als Tabelle und darunter
    // als Karten gerendert wird — dasselbe Markup, eines davon verborgen.
    await expect(page.getByText('Keine Flaeche angegeben').first()).toBeVisible();
    // Und die deutsche Zahl wurde als 1.250,5 gelesen — nicht als 12505.
    await expect(page.getByText('1.250,50').first()).toBeVisible();
  });

  test('das Raumbuch ist danach noch leer', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumImport(page);
    await page.setInputFiles('#datei', {
      name: 'raumbuch.csv', mimeType: 'text/csv', buffer: Buffer.from(DATEI, 'utf8'),
    });
    await page.locator('[data-cse="import-hochladen"]').click();
    await page.waitForURL(/\?import=/u);

    await page.getByRole('link', { name: '← Raumbuch' }).click();
    await expect(page.getByText('Noch kein Raum erfasst')).toBeVisible();
  });
});

test.describe('(2) Erst die Übernahme schreibt', () => {
  test('drei Räume entstehen, die vierte Zeile bleibt draußen', async ({ page }) => {
    await anmelden(page, 'admin');
    await zumImport(page);
    await page.setInputFiles('#datei', {
      name: 'raumbuch.csv', mimeType: 'text/csv', buffer: Buffer.from(DATEI, 'utf8'),
    });
    await page.locator('[data-cse="import-hochladen"]').click();
    await page.waitForURL(/\?import=/u);
    await page.locator('[data-cse="import-uebernehmen"]').click();

    // Zurück im Raumbuch: drei Zeilen, und die Kalkulation rechnet damit.
    await expect(page.locator('h1')).toHaveText('Raumbuch');
    await expect(page.getByRole('cell', { name: 'Halle', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Foyer', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Lager', exact: true })).toHaveCount(0);
  });
});

test.describe('(3) Was der Import ablehnt', () => {
  test('eine .xlsx wird abgewiesen — mit einem Satz, nicht mit halbem Lesen',
    async ({ page }) => {
      await anmelden(page, 'admin');
      await zumImport(page);
      const antwort = await page.request.post(
        '/api/raumbuch-import?mandant=reinigung',
        {
          multipart: {
            objektId: '00000000-0000-0000-0000-000000000000',
            datei: { name: 'raumbuch.xlsx', mimeType: 'application/vnd.ms-excel',
                     buffer: Buffer.from('PK', 'utf8') },
          },
          headers: { origin: new URL(page.url()).origin },
        });
      expect(antwort.status()).toBe(415);
      expect(await antwort.text()).toContain('CSV');
    });
});
