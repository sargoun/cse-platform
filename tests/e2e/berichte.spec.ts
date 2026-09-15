/**
 * Die Berichte im Browser (REP-01…REP-07).
 *
 * Gerechnet wird in `server/services/bericht`, geprüft in
 * `tests/kern/bericht-ausgabe.test.ts` (Zeiträume, Formate, CSV) und in
 * `tests/isolation/bericht.test.ts` (die Abfragen gegen echte Rechte).
 * Hier steht, was ein Mensch sieht und anfassen kann:
 *
 *  · alle sechs Berichte sind erreichbar und zeichnen eine Tabelle;
 *  · Jahr und Körnung sind Links, keine versteckte Zustandsmaschine —
 *    ein Bericht ist damit teilbar und ein Browser-Zurück tut das Richtige;
 *  · der CSV-Ausgang liefert wirklich eine Datei mit BOM und CRLF (REP-07);
 *  · **der Ausgang ist ein eigenes Recht**: wer lesen darf, darf nicht
 *    automatisch ausleiten;
 *  · die Gruppenfassung teilt je Gesellschaft auf und trägt keinen Ausgang.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const BERICHTE = [
  'umsatz', 'auftraege', 'attribution', 'mitarbeiter', 'projekte', 'pipeline',
] as const;

async function alsAdmin(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('Berichte im Bereich', () => {
  test('der Index nennt alle sechs und jeder führt zu seiner Seite', async ({ page }) => {
    await alsAdmin(page);
    await page.goto('/portal/reinigung/berichte');
    await expect(page.locator('[data-cse="berichtsliste"] > li')).toHaveCount(6);

    for (const b of BERICHTE) {
      await expect(page.locator(`[data-cse="bericht-${b}"]`)).toBeVisible();
    }
  });

  /**
   * Alle sechs in einem Test: sechs fast gleiche Tests verstecken den einen,
   * der fehlt. Die Schleife nennt den Bericht im Fehlschlag mit.
   */
  test('jeder Bericht zeichnet eine Tabelle oder sagt, warum keine da ist',
    async ({ page }) => {
      await alsAdmin(page);
      for (const b of BERICHTE) {
        await page.goto(`/portal/reinigung/berichte/${b}`);
        await expect(page.locator('h1'), b).toBeVisible();
        // Kein "wird gebaut" — das ist der Unterschied zwischen Route und Seite.
        await expect(page.locator('body'), b).not.toContainText('wird gerade gebaut');
        /*
         * **Tabelle ODER benannter Leerstand, nie nichts.** Eine Gesellschaft
         * ohne Projekte ist kein Fehler — `projekt` ist ein Bau-Begriff, und
         * die Reinigung führt keine. Falsch wäre eine leere Seite, die
         * aussieht wie ein Ladefehler; richtig ist ein Satz, der sagt, dass
         * im Zeitraum nichts liegt. Genau das wird hier verlangt.
         */
        const tabellen = await page.locator('table').count();
        const leer = await page.locator(`[data-cse="${b}-leer"]`).count();
        expect(tabellen + leer, `${b}: weder Tabelle noch Leerstand`).toBeGreaterThan(0);
      }
    });

  test('Jahr und Körnung sind Links — der Bericht ist teilbar', async ({ page }) => {
    await alsAdmin(page);
    await page.goto('/portal/reinigung/berichte/umsatz');

    const steuerung = page.locator('[data-cse="bericht-steuerung"]');
    await expect(steuerung).toBeVisible();

    await steuerung.locator('[data-cse="koernung-quartal"]').click();
    await expect(page).toHaveURL(/koernung=quartal/u);
    // Vier Quartale, kein Rest.
    await expect(page.locator('tbody tr')).toHaveCount(4);

    await page.locator('[data-cse="koernung-monat"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(12);

    // Und ein Jahr zurück bleibt ein Jahr zurück.
    const jahr = new Date().getUTCFullYear() - 1;
    await page.locator(`[data-cse="jahr-${String(jahr)}"]`).click();
    await expect(page).toHaveURL(new RegExp(`jahr=${String(jahr)}`, 'u'));
    await expect(page.locator(`[data-cse="jahr-${String(jahr)}"]`))
      .toHaveAttribute('aria-current', 'page');
  });

  /**
   * **REP-07 wirklich herunterladen**, nicht nur den Knopf sehen. Eine CSV,
   * die 200 antwortet und leer ist, sieht im Bildschirm genauso aus.
   */
  test('der CSV-Ausgang liefert eine Datei mit BOM und CRLF', async ({ page }) => {
    await alsAdmin(page);
    await page.goto('/portal/reinigung/berichte/umsatz');

    const knopf = page.locator('[data-cse="csv-export"]');
    await expect(knopf).toBeVisible();

    const antwort = await page.request.get(
      await knopf.getAttribute('href') ?? '');
    expect(antwort.status(), await antwort.text()).toBe(200);
    expect(antwort.headers()['content-type']).toContain('text/csv');
    expect(antwort.headers()['content-disposition']).toContain('attachment');

    const text = await antwort.text();
    expect(text.startsWith('﻿'), 'BOM, sonst liest Excel Umlaute falsch').toBe(true);
    expect(text).toContain('\r\n');
    expect(text).toContain('Zeitraum');
    // Zwölf Monate plus Kopfzeile.
    expect(text.trim().split('\r\n')).toHaveLength(13);
  });

  /**
   * **Der Ausgang ist ein eigenes Recht.** `leitung` liest die Berichte und
   * trägt `bericht.exportieren` nicht — dann steht dort kein Knopf, der 403
   * antwortet, sondern gar keiner.
   */
  test('ohne bericht.exportieren erscheint kein Ausgang', async ({ page }) => {
    await page.goto('/dev/anmelden');
    await alsKonto(page, KONTO.leitungReinigung);
    await page.goto('/portal/reinigung/berichte/umsatz');

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(1);
    await expect(page.locator('[data-cse="csv-export"]')).toHaveCount(0);
  });

  test('keine Verstösse nach WCAG 2.1 AA auf dem Umsatzbericht', async ({ page }) => {
    await alsAdmin(page);
    await page.goto('/portal/reinigung/berichte/umsatz');
    await expect(page.locator('table')).toHaveCount(1);
    const befund = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(befund.violations).toEqual([]);
  });
});

test.describe('Berichte in der Gruppe (Invariante 10)', () => {
  test('jede Gruppenfassung zeichnet je Gesellschaft eine Zeile', async ({ page }) => {
    await page.goto('/dev/anmelden');
    await alsKonto(page, KONTO.gruppe);

    for (const b of BERICHTE) {
      await page.goto(`/portal/gruppe/berichte/${b}`);
      await expect(page.locator('h1'), b).toBeVisible();
      await expect(page.locator('table'), b).toHaveCount(1);
      /*
       * **Je Gesellschaft eine Zeile — ausser bei „Herkunft".** Die fünf
       * anderen zählen von `mandant` aus nach links und geben deshalb auch
       * die Null aus; die Herkunft zählt von den Leads aus und kennt eine
       * Gesellschaft ohne Anfragen gar nicht. Das ist der Unterschied
       * zwischen „vier Gesellschaften, eine ohne Umsatz" und „welcher Kanal
       * wirkt" — und er gehört in die Erwartung, nicht in eine Ausnahme,
       * die man später für einen Fehler hält.
       */
      const zeilen = await page.locator('tbody tr').count();
      expect(zeilen, b).toBeGreaterThanOrEqual(b === 'attribution' ? 1 : 4);
    }
  });

  /**
   * **Kein Ausgang in der Gruppe** — und das ist kein Vergessen.
   * `bericht.exportieren` ist ein Recht AM BEREICH; es in der Gruppenansicht
   * zu prüfen hiesse, sich einen Bereich auszusuchen.
   */
  test('die Gruppenansicht trägt keinen CSV-Knopf', async ({ page }) => {
    await page.goto('/dev/anmelden');
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe/berichte/umsatz');
    await expect(page.locator('table')).toHaveCount(1);
    await expect(page.locator('[data-cse="csv-export"]')).toHaveCount(0);
  });
});
