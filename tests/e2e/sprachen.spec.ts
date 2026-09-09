/**
 * Die zweisprachige Website (D-82) im Browser.
 *
 * Drei Zusagen lassen sich nur hier prüfen: dass `<html lang>` wirklich
 * umschaltet (WCAG 3.1.1 — ein Screenreader liest sonst englischen Text mit
 * deutscher Aussprache), dass die Sprachwahl auf DIESELBE Seite führt und
 * nicht auf die Startseite, und dass `hreflang` im ausgelieferten Kopf steht.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

test.describe('(1) `<html lang>` folgt der Seite', () => {
  test('deutsch unter /, englisch unter /en', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');

    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('auch auf einer Unterseite und im Formular', async ({ page }) => {
    await page.goto('/en/kontakt');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto('/en/anfrage/reinigung');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto('/anfrage/reinigung');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
  });
});

test.describe('(2) die Sprachwahl bleibt auf der Seite', () => {
  test('von /kontakt nach /en/kontakt — nicht auf die Startseite', async ({ page }) => {
    await page.goto('/kontakt');
    await page.locator('[data-cse="sprachwahl"] a[data-sprache="en"]').click();
    // Wer beim Sprachwechsel seinen Platz verliert, wechselt kein zweites Mal.
    await expect(page).toHaveURL(/\/en\/kontakt$/u);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('und wieder zurück', async ({ page }) => {
    await page.goto('/en/leistungen');
    await page.locator('[data-cse="sprachwahl"] a[data-sprache="de"]').click();
    await expect(page).toHaveURL(/\/leistungen$/u);
    await expect(page).not.toHaveURL(/\/en\//u);
  });

  test('die aktive Sprache ist als solche ausgezeichnet', async ({ page }) => {
    await page.goto('/en');
    const aktiv = page.locator('[data-cse="sprachwahl"] a[data-sprache="en"]');
    await expect(aktiv).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-cse="sprachwahl"] a[data-sprache="de"]'))
      .not.toHaveAttribute('aria-current', 'true');
  });
});

test.describe('(3) hreflang und canonical stehen im ausgelieferten Kopf', () => {
  test('beide Fassungen nennen einander — gegenseitig', async ({ page }) => {
    for (const pfad of ['/kontakt', '/en/kontakt']) {
      await page.goto(pfad);
      const alternates = await page.locator('link[rel="alternate"][hreflang]')
        .evaluateAll((ls) => ls.map((l) => [
          l.getAttribute('hreflang'), l.getAttribute('href'),
        ]));
      const karte = Object.fromEntries(alternates);
      /**
       * Google wertet `hreflang` nur bei gegenseitigen Verweisen aus. Nennte
       * nur die englische Seite ihre deutsche Fassung, konkurrierten beide um
       * dieselbe Suchanfrage, statt sich zu ergänzen.
       */
      expect(karte['de-DE'], pfad).toMatch(/\/kontakt$/u);
      expect(karte['en'], pfad).toMatch(/\/en\/kontakt$/u);
      expect(karte['x-default'], pfad).toMatch(/\/kontakt$/u);
    }
  });

  test('canonical zeigt auf die eigene Sprachfassung, nicht auf die deutsche',
    async ({ page }) => {
      await page.goto('/en/leistungen');
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      // Ein canonical auf die deutsche Fassung nähme die englische Seite aus
      // dem Index — gebaut, verlinkt und unauffindbar.
      expect(canonical).toMatch(/\/en\/leistungen$/u);
    });
});

test.describe('(4) jede öffentliche Route gibt es auf Englisch', () => {
  for (const r of OEFFENTLICHE_ROUTEN) {
    const en = r.pfad === '/' ? '/en' : `/en${r.pfad}`;
    test(`200 und englischer Inhalt: ${en}`, async ({ page }) => {
      const antwort = await page.goto(en);
      expect(antwort?.status(), en).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      // Die Hülle ist übersetzt — nicht nur der Rahmen um deutschen Text.
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeAttached();
    });
  }

  test('auch die Barrierefreiheitserklärung', async ({ page }) => {
    const antwort = await page.goto('/en/barrierefreiheit');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Accessibility statement');
    // Und sie sagt, dass die deutsche Fassung gilt.
    await expect(page.locator('[data-cse="rechtshinweis"]')).toContainText('German');
  });
});

test.describe('(5) das englische Formular ist englisch — Felder wie Knopf', () => {
  test('Beschriftungen, Auswahlwerte und Absendeknopf', async ({ page }) => {
    await page.goto('/en/anfrage/reinigung');
    await expect(page.locator('label[for="f_gebaeudetyp"]')).toHaveText(/Type of building/u);
    await expect(page.locator('button[type="submit"]')).toHaveText('Send enquiry');

    // Die WERTE bleiben deutsch — sie sind der gespeicherte Inhalt, nicht die
    // Anzeige. Übersetzte Werte hiessen: in `formular_eingang` steht je nach
    // Sprache etwas anderes, und keine Auswertung ginge mehr über beide.
    const werte = await page.locator('#f_gebaeudetyp option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(werte).toContain('buero');
    const beschriftungen = await page.locator('#f_gebaeudetyp option')
      .evaluateAll((os) => os.map((o) => o.textContent));
    expect(beschriftungen).toContain('Office building');
  });

  test('und das deutsche bleibt deutsch', async ({ page }) => {
    await page.goto('/anfrage/reinigung');
    await expect(page.locator('label[for="f_gebaeudetyp"]')).toHaveText(/Gebäudetyp/u);
    await expect(page.locator('button[type="submit"]')).toHaveText('Anfrage senden');
  });
});

test.describe('(6) die Maschinenflächen kennen beide Sprachen', () => {
  test('die Sitemap führt jede Seite in beiden Sprachen, mit Alternativen',
    async ({ request }) => {
      const antwort = await request.get('/sitemap.xml');
      expect(antwort.status()).toBe(200);
      const xml = await antwort.text();
      expect(xml).toContain('/en/kontakt');
      expect(xml).toContain('hreflang="en"');
      expect(xml).toContain('hreflang="x-default"');
    });

  test('llms.txt nennt die englische Fassung — ohne jede Seite zu verdoppeln',
    async ({ request }) => {
      const text = await (await request.get('/llms.txt')).text();
      expect(text).toContain('## Sprachen');
      expect(text).toMatch(/\/en/u);
      // Genau EINE Zeile je Seite: eine verdoppelte Liste läse sich für ein
      // Sprachmodell wie zwei verschiedene Seiten.
      const kontaktZeilen = text.split('\n').filter((z) => z.includes('](') && z.includes('/kontakt'));
      expect(kontaktZeilen).toHaveLength(1);
    });
});

test.describe('(7) barrierefrei in beiden Sprachen', () => {
  for (const pfad of ['/en', '/en/leistungen', '/en/anfrage/reinigung', '/en/barrierefreiheit']) {
    test(`axe: ${pfad}`, async ({ page }) => {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);
      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(
        ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
        pfad,
      ).toEqual([]);
    });
  }

  test('kein waagerechtes Scrollen bei 375px — auch mit der Sprachwahl im Kopf',
    async ({ page }) => {
      // Zwei zusätzliche Links im 72px-Kopf sind genau die Art Ergänzung, die
      // eine Kopfzeile auf einem Telefon zum Überlaufen bringt.
      await page.setViewportSize({ width: 375, height: 800 });
      for (const pfad of ['/', '/en']) {
        await page.goto(pfad);
        const ueberlauf = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(ueberlauf, pfad).toBe(false);
      }
    });
});
