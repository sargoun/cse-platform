/**
 * PR 66 im Browser — Z3-Datentraegerueberlassung und Verfahrensdokumentation
 * (ACC-09, ACC-10, D-485).
 *
 * Was Datenbank und Format halten, steht in `tests/isolation/
 * z3-verfahrensdokumentation.test.ts` und `tests/kern/z3-format.test.ts`.
 * Hier steht, was ein Mensch sieht und bekommt:
 *
 *  1. Z3: Tabellen mit Zeilen und Hash, die Grenzen benannt; das Paket kommt
 *     als ZIP mit demselben Hash wie auf der Seite, die Strukturbeschreibung
 *     als XML.
 *  2. Verfahrensdokumentation: jeder Abschnitt mit seiner Quelle, der Hash im
 *     Kopf; Markdown, PDF und JSON tragen denselben Hash.
 *  3. Ohne das Recht gibt es die Seiten nicht (404), auch fuer die Leitung.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';
const Z3 = `/portal/${MANDANT}/buchhaltung/z3-export`;
const VD = `/portal/${MANDANT}/buchhaltung/verfahrensdokumentation`;

async function anmelden(page: Page, konto: string = KONTO.adminReinigung): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Z3-Export und Verfahrensdokumentation (PR 66)', () => {
  test('Z3: Tabellen und Hash auf der Seite, das Paket als ZIP, die Strukturbeschreibung als XML', async ({ page }) => {
    await anmelden(page);
    const antwort = await page.goto(Z3);
    expect(antwort?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /^Z3-Export/u, level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="z3-kennzahlen"] [data-cse="kpi-wert"]')).toHaveCount(4);
    await expect(page.locator('[data-cse="z3-unvollstaendig"]')).toBeVisible();
    await expect(page.locator('[data-cse="z3-grenzen"]')).toContainText('O-365');
    // 16 Tabellen: seit V-215 gehoeren die Betriebsausgaben und ihre Steuerzeilen
    // dazu (ausgaben, ausgabensteuer) — vorher standen nur ihre Buchungen im Paket.
    await expect(page.locator('[data-cse="tabelle"] tbody tr')).toHaveCount(16);
    // Beide Dateien mit ihrem GENAUEN Namen (V-253): ein Teiltreffer auf „ausgaben"
    // waere schon von „ausgabensteuer.csv" allein erfuellt.
    const zeilen = page.locator('[data-cse="tabelle"] tbody tr');
    await expect(zeilen.filter({ has: page.getByText('ausgaben.csv', { exact: true }) }))
      .toHaveCount(1);
    await expect(zeilen.filter({ has: page.getByText('ausgabensteuer.csv', { exact: true }) }))
      .toHaveCount(1);

    const sha = await page.locator('[data-cse="z3-sha256"]').getAttribute('title');
    expect(sha).toMatch(/^[0-9a-f]{64}$/u);
    const href = await page.locator('[data-cse="z3-abrufen"]').getAttribute('href');
    expect(href).not.toBeNull();
    const zip = await page.request.get(href ?? '');
    expect(zip.status()).toBe(200);
    expect(zip.headers()['content-type']).toContain('application/zip');
    expect(zip.headers()['x-cse-paket-sha256']).toBe(sha);
    expect(zip.headers()['content-disposition']).toContain('z3-reinigung-');
    const bytes = await zip.body();
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    const indexHref = await page.locator('[data-cse="z3-index-abrufen"]').getAttribute('href');
    const index = await page.request.get(indexHref ?? '');
    expect(index.status()).toBe(200);
    expect(index.headers()['content-type']).toContain('application/xml');
    const xml = await index.text();
    expect(xml).toContain('<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">');
    expect(xml).toContain('<URL>buchungen.csv</URL>');
  });

  test('Verfahrensdokumentation: Abschnitte mit Quelle, Hash im Kopf — Markdown, PDF und JSON tragen ihn', async ({ page }) => {
    await anmelden(page);
    const antwort = await page.goto(VD);
    expect(antwort?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Verfahrensdokumentation', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="vd-teil"]')).toHaveCount(5);
    await expect(page.locator('[data-cse="vd-abschnitt"]')).toHaveCount(17);
    await expect(page.locator('[data-cse="vd-abschnitt"][data-quelle="datenbank"]').first()).toBeVisible();
    await expect(page.locator('[data-cse="vd-schemastand"]')).toContainText(/Migrationen|kein Migrationsjournal/u);
    await expect(page.locator('[data-cse="vd-offen"]')).toContainText('offene Punkte');
    const sha = (await page.locator('[data-cse="vd-sha256"]').textContent())?.trim();
    expect(sha).toMatch(/^[0-9a-f]{64}$/u);

    const markdown = await page.request.get((await page.locator('[data-cse="vd-markdown"]').getAttribute('href')) ?? '');
    expect(markdown.status()).toBe(200);
    expect(markdown.headers()['content-type']).toContain('text/markdown');
    expect(markdown.headers()['x-cse-dokument-sha256']).toBe(sha);
    const text = await markdown.text();
    expect(text).toContain('# Verfahrensdokumentation — CSE Dienstleistungen GmbH');
    expect(text).toContain('### 4.1 Rollen und Zugriffsrechte');

    const pdf = await page.request.get((await page.locator('[data-cse="vd-pdf"]').getAttribute('href')) ?? '');
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect(pdf.headers()['x-cse-dokument-sha256']).toBe(sha);
    expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const json = await page.request.get((await page.locator('[data-cse="vd-json"]').getAttribute('href')) ?? '');
    expect(json.status()).toBe(200);
    expect(json.headers()['x-cse-dokument-sha256']).toBe(sha);
    const struktur = await json.json() as Record<string, unknown>;
    expect(struktur['art']).toBe('cse-verfahrensdokumentation');
    expect(struktur['firma']).toBe('CSE Dienstleistungen GmbH');
  });

  test('ohne das Recht gibt es beide Seiten nicht — auch fuer die Leitung', async ({ page }) => {
    await anmelden(page, KONTO.leitungReinigung);
    expect((await page.goto(Z3))?.status()).toBe(404);
    expect((await page.goto(VD))?.status()).toBe(404);
    const api = await page.request.get(`/api/buchhaltung/z3-export?mandant=${MANDANT}&jahr=2026&format=index`);
    expect([403, 404]).toContain(api.status());
  });
});
