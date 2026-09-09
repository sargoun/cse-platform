/**
 * PR 18 Akzeptanz (1) und (5) — die Hälfte, die nur im Browser existiert.
 *
 * (2), (3) und (4) beweist das Register: eine Kachel ohne Abfrage oder ohne
 * Linkziel kommt nicht durch `registriereKachel`, und eine Kachel eines nicht
 * gemergten Moduls gibt es nicht. Was dort nicht zu prüfen ist, ist die
 * Zusage, die DSH-04 dem Leser macht: **die Zahl auf der Kachel führt zu den
 * Zeilen, die sie zählt.** Das ist eine Aussage über einen Klick, und Klicks
 * gibt es nur hier.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Geprüft wird auf `security`, nicht auf „Alle Bereiche“.
 *
 * `anfrage.spec.ts` schickt echte Formulare ab und erzeugt dabei Leads in
 * `reinigung`. Läuft es parallel, ändert sich zwischen dem Aufruf des
 * Dashboards und dem der Liste eine Zahl — der Test fiele, und zwar zu Recht
 * über etwas, das kein Fehler ist. In `security` schreibt keine Suite.
 */
const BEREICH = 'security';

interface Kachelstand { readonly schluessel: string; readonly wert: number; readonly ziel: string }

async function stand(page: Page): Promise<readonly Kachelstand[]> {
  return page.locator('[data-cse="kachel"]').evaluateAll((es) =>
    es.map((e) => ({
      schluessel: e.getAttribute('data-kachel') ?? '',
      wert: Number(e.querySelector('[data-cse="kpi-wert"]')?.textContent ?? 'NaN'),
      ziel: e.getAttribute('href') ?? '',
    })));
}

/** Wie viele Spalten das Raster wirklich hat — berechnet, nicht aus Klassennamen. */
async function spalten(page: Page): Promise<number> {
  const vorlage = await page.locator('[data-cse="kachel-raster"]')
    .evaluate((e) => getComputedStyle(e).gridTemplateColumns);
  return vorlage.split(/\s+/).filter((s) => s !== '').length;
}

test.describe('(1) DSH-04: keine toten Zahlen', () => {
  test('jede Kachel führt zu einer Liste, deren Zeilenzahl ihre Zahl IST', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const antwort = await page.goto(`/dev/dashboard?bereich=${BEREICH}`);
    expect(antwort?.status()).toBe(200);

    const kacheln = await stand(page);
    expect(kacheln.length, 'das Dashboard zeigt überhaupt Kacheln').toBeGreaterThan(0);
    for (const k of kacheln) {
      expect(Number.isNaN(k.wert), `${k.schluessel} zeigt keine Zahl`).toBe(false);
      expect(k.ziel, `${k.schluessel} hat kein Linkziel`).not.toBe('');
    }

    /**
     * Ohne diese Zeile bestünde der Test auf einer leeren Datenbank: 0 = 0,
     * siebenmal. Eine Prüfung, die genau dann besteht, wenn es nichts zu
     * prüfen gibt, prüft nichts.
     */
    expect(
      kacheln.filter((k) => k.wert > 0).map((k) => k.schluessel).length,
      'mindestens eine Kachel zählt echte Zeilen',
    ).toBeGreaterThan(0);

    for (const k of kacheln) {
      const liste = await page.goto(k.ziel);
      expect(liste?.status(), `${k.schluessel} → ${k.ziel}`).toBe(200);

      const zeilen = await page.locator('[data-cse="kennzahl-zeile"]').count();
      expect(zeilen, `${k.schluessel}: Kachel sagt ${String(k.wert)}`).toBe(k.wert);

      // Und die Liste nennt dieselbe Zahl noch einmal selbst — aus derselben
      // Transaktion wie ihre Zeilen (SCHNAPPSCHUSS).
      const genannt = await page.locator('[data-cse="kennzahl-wert"]').innerText();
      expect(Number(genannt), `${k.schluessel}: Kopfzahl der Liste`).toBe(zeilen);

      await page.goBack();
    }
  });

  test('ein Klick auf die Kachel — nicht nur ihr href — landet auf der Liste', async ({ page }) => {
    await page.goto(`/dev/dashboard?bereich=${BEREICH}`);
    const erste = page.locator('[data-cse="kachel"]').first();
    const schluessel = await erste.getAttribute('data-kachel');
    await erste.click();
    await expect(page).toHaveURL(new RegExp(`/dev/kennzahl/${schluessel ?? ''}\\?`));
    await expect(page.locator('h1')).toBeVisible();
  });

  test('ein unbekannter Kennzahlschlüssel ist 404, keine leere Tabelle', async ({ request }) => {
    // Eine leere Tabelle sähe aus wie „es gibt nichts“ — und das ist eine
    // andere Aussage als „diese Kennzahl gibt es nicht“.
    expect((await request.get('/dev/kennzahl/gibtesnicht')).status()).toBe(404);
  });
});

test.describe('(3) der Bereichsfilter ist EIN Argument', () => {
  test('ein Wechsel ändert die URL und JEDES Linkziel — nicht nur das erste', async ({ page }) => {
    await page.goto('/dev/dashboard?bereich=gruppe');
    const vorher = await stand(page);
    expect(vorher.every((k) => k.ziel.includes('bereich=gruppe'))).toBe(true);

    await page.locator(`[data-cse="bereich-knopf"][href$="bereich=${BEREICH}"]`).click();
    await expect(page).toHaveURL(new RegExp(`bereich=${BEREICH}`));

    const nachher = await stand(page);
    expect(nachher.length).toBe(vorher.length);
    // Genau EIN Bereich in allen Zielen: liefe der Filter je Kachel, zeigte
    // nach dem Wechsel die eine den neuen und die andere noch den alten.
    const bereiche = new Set(
      nachher.map((k) => new URL(k.ziel, 'http://x').searchParams.get('bereich')),
    );
    expect([...bereiche]).toHaveLength(1);
    expect([...bereiche][0]).not.toBe('gruppe');

    // Und die Zahlen sind kleiner oder gleich: ein Bereich ist eine Teilmenge
    // der Gruppe. Grösser hiesse, der Filter addiert Fremdzeilen.
    for (const k of nachher) {
      const gruppe = vorher.find((v) => v.schluessel === k.schluessel);
      expect(k.wert, `${k.schluessel} im Bereich vs. Gruppe`)
        .toBeLessThanOrEqual(gruppe?.wert ?? -1);
    }
  });
});

test.describe('(5) DESIGN §5/§8: die Kacheln bei 4, 2 und 1 Spalte', () => {
  test('vier Spalten am Schreibtisch', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dev/dashboard?bereich=${BEREICH}`);
    expect(await spalten(page)).toBe(4);
  });

  test('zwei auf dem Tablet', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`/dev/dashboard?bereich=${BEREICH}`);
    expect(await spalten(page)).toBe(2);
  });

  test('eine am Telefon — und kein waagerechtes Scrollen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/dev/dashboard?bereich=${BEREICH}`);
    expect(await spalten(page)).toBe(1);

    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(ueberlauf).toBe(false);

    // §8: Tap-Ziele mindestens 44px. Die ganze Kachel ist der Link, nicht ein
    // Pfeil in der Ecke.
    const hoehe = await page.locator('[data-cse="kachel"]').first()
      .evaluate((e) => e.getBoundingClientRect().height);
    expect(hoehe).toBeGreaterThanOrEqual(44);
  });
});

test.describe('barrierefrei — ein Dashboard ist der Einstieg in alles Übrige', () => {
  for (const pfad of ['/dev/dashboard', `/dev/kennzahl/anstellungen?bereich=${BEREICH}`]) {
    test(`axe: ${pfad}`, async ({ page }) => {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), `${pfad} antwortet nicht mit 200`).toBe(200);
      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(
        ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
        pfad,
      ).toEqual([]);
    });
  }

  test('die Kachel zeigt beim Tabben einen sichtbaren Fokusring (§5, §9)', async ({ page }) => {
    await page.goto(`/dev/dashboard?bereich=${BEREICH}`);
    const kachel = page.locator('[data-cse="kachel"]').first();
    await kachel.focus();
    const schatten = await kachel.evaluate((e) => getComputedStyle(e).boxShadow);
    // Der Ring ist rgba(227,6,19,0.40) — an den Kanälen geprüft, damit ein
    // umbenanntes Token nicht stillschweigend besteht.
    expect(schatten).not.toBe('none');
    expect(schatten).toContain('227');
  });
});
