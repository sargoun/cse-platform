/**
 * Phase 10 im Browser — die drei Bildschirme, die aus der laufenden
 * Konfiguration entstehen (LEG-09, SPEC §14; D-586, D-587, D-588).
 *
 * **Warum es diese Datei gibt.** Die Isolationsfälle rufen die DIENSTE auf und
 * beweisen, was die Datenbank hergibt. Sie sagen nichts über die Grenze
 * dahinter: ob die Adresse das Recht prüft, ob der Abruf als Datei kommt, ob
 * die Prüfsumme auf dem Bildschirm dieselbe ist wie im Kopf der Antwort. Genau
 * diese Lücke hat die Copilot-Runde auf PR 17 benannt — die Ausgaberoute war
 * gebaut, geprüft war nur ihr Inhalt.
 *
 * Gemessen wird deshalb an der Grenze:
 *
 *  1. Die Seite trägt eine Prüfsumme, und beide Abrufe tragen DIESELBE.
 *  2. Der Abruf kommt als Anhang, mit seinem Typ und ohne Zwischenspeicher.
 *  3. Ohne das Recht gibt es weder Seite noch Abruf — und zwar mit demselben
 *     404 wie für eine Seite, die es nicht gibt (AUT-06).
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';
const VV = `/portal/${MANDANT}/datenschutz/verarbeitungsverzeichnis`;
const LK = `/portal/${MANDANT}/datenschutz/loeschkonzept`;
const BETRIEB = `/portal/${MANDANT}/einstellungen/betrieb`;

async function anmelden(page: Page, konto: string = KONTO.adminReinigung): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

/** Der Abruf hinter einem Knopf — samt der Prüfung, dass er einer ist. */
async function abrufen(page: Page, anker: string) {
  const href = await page.locator(`[data-cse="${anker}"]`).getAttribute('href');
  expect(href, `${anker} ohne Ziel`).not.toBeNull();
  return page.request.get(href ?? '');
}

test.describe('Die erzeugten Datenschutzdokumente und die Betriebsansicht', () => {
  test('Verarbeitungsverzeichnis: Seite, Markdown und JSON tragen denselben Abdruck', async ({ page }) => {
    await anmelden(page);
    expect((await page.goto(VV))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /Verarbeitungsverzeichnis/u, level: 1 }))
      .toBeVisible();
    await expect(page.locator('[data-cse="vv-abschnitt"]').first()).toBeVisible();

    const sha = (await page.locator('[data-cse="vv-sha256"]').textContent())?.trim();
    expect(sha).toMatch(/^[0-9a-f]{64}$/u);

    const md = await abrufen(page, 'vv-markdown');
    expect(md.status()).toBe(200);
    expect(md.headers()['content-type']).toContain('text/markdown');
    expect(md.headers()['x-cse-dokument-sha256']).toBe(sha);
    expect(md.headers()['content-disposition']).toContain('attachment');
    expect(md.headers()['cache-control']).toContain('no-store');
    const text = await md.text();
    expect(text).toContain('# Verzeichnis von Verarbeitungstätigkeiten');
    expect(text).toContain('## 4. Empfänger und Auftragsverarbeiter');
    /* Abschnitt 8 ist die Zusage, dass das Dokument seine Grenze nennt. */
    expect(text).toContain('## Offen');
    expect(text).toContain('O-514');

    const json = await abrufen(page, 'vv-json');
    expect(json.status()).toBe(200);
    expect(json.headers()['x-cse-dokument-sha256']).toBe(sha);
    const struktur = await json.json() as Record<string, unknown>;
    expect((struktur['verantwortlicher'] as { firma?: string }).firma)
      .toBe('CSE Dienstleistungen GmbH');
    expect(Array.isArray(struktur['abschnitte'])).toBe(true);
    expect((struktur['offen'] as unknown[]).length).toBeGreaterThan(0);
  });

  test('Löschkonzept: dasselbe, und die Sperren nennen ihren Grund', async ({ page }) => {
    await anmelden(page);
    expect((await page.goto(LK))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Löschkonzept', level: 1 })).toBeVisible();

    const sha = (await page.locator('[data-cse="lk-sha256"]').textContent())?.trim();
    expect(sha).toMatch(/^[0-9a-f]{64}$/u);

    const md = await abrufen(page, 'lk-markdown');
    expect(md.status()).toBe(200);
    expect(md.headers()['x-cse-dokument-sha256']).toBe(sha);
    const text = await md.text();
    expect(text).toContain('# Löschkonzept');
    expect(text).toContain('## 3. Was NICHT gelöscht wird — und warum');
    /*
     * **Die Floskel steht bei keiner Zeile.** Der Grund kommt je Tabelle aus
     * `rls.ts` (K-16); „aus gesetzlichen Gründen" wäre keine Auskunft.
     */
    expect(text).not.toContain('aus gesetzlichen Gründen');

    const json = await abrufen(page, 'lk-json');
    expect(json.status()).toBe(200);
    expect(json.headers()['x-cse-dokument-sha256']).toBe(sha);
    const struktur = await json.json() as Record<string, unknown>;
    expect(Array.isArray(struktur['sperren'])).toBe(true);
    expect((struktur['sperren'] as unknown[]).length).toBeGreaterThan(0);
  });

  test('Betrieb: jeder geplante Lauf steht da, und der Auslöser wird benannt', async ({ page }) => {
    await anmelden(page);
    expect((await page.goto(BETRIEB))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Betrieb', level: 1 })).toBeVisible();

    /* Die Frage vor allen anderen: läuft überhaupt etwas (D-540)? */
    await expect(page.locator('[data-cse="betrieb-ausloeser"]')).toBeVisible();
    await expect(page.locator('[data-cse="betrieb-stand"]')).toContainText('geplante Läufe');
    /* Jeder registrierte Lauf bekommt eine Zeile — keine Auswahl, keine Kürzung. */
    const zeilen = page.locator('[data-cse="tabelle"] tbody tr');
    expect(await zeilen.count()).toBeGreaterThan(10);
  });

  test('ohne das Recht gibt es die drei Seiten nicht — auch für die Leitung', async ({ page }) => {
    await anmelden(page, KONTO.leitungReinigung);
    expect((await page.goto(VV))?.status()).toBe(404);
    expect((await page.goto(LK))?.status()).toBe(404);
    expect((await page.goto(BETRIEB))?.status()).toBe(404);

    /*
     * Und die Ausgaberoute ebenso wenig. Eine Seite, die 404 antwortet,
     * während ihre Adresse das Dokument herausgibt, wäre die Tür neben der
     * verschlossenen Tür.
     */
    for (const pfad of ['verarbeitungsverzeichnis', 'loeschkonzept']) {
      const antwort = await page.request.get(
        `/api/datenschutz/${pfad}?mandant=${MANDANT}&format=md`);
      expect([403, 404], pfad).toContain(antwort.status());
    }
  });
});
