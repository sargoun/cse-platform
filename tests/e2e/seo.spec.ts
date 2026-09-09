/**
 * PR 16 Akzeptanz (3) und (4) — die Maschinenflaechen am laufenden Server.
 *
 * Die Bausteine pruefen `tests/kern/jsonld.test.ts` und `tests/kern/seo.test.ts`.
 * Hier wird geholt, was tatsaechlich ausgeliefert wird: eine Funktion, die
 * richtig rechnet, und eine Route, die sie nie aufruft, sehen aus der Ferne
 * gleich aus.
 */
import { expect, test, type Page } from '@playwright/test';
import { pruefeJsonLd } from '../../src/server/services/inhalt/jsonld.js';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

/** Die JSON-LD-Bloecke einer Seite, geparst. */
async function bloecke(page: Page, pfad: string) {
  await page.goto(pfad);
  const texte = await page.locator('script[type="application/ld+json"]')
    .evaluateAll((es) => es.map((e) => e.textContent ?? ''));
  return texte.map((t) => JSON.parse(t) as Record<string, unknown>);
}

test.describe('(4) robots.txt, sitemap.xml und llms.txt liefern aus', () => {
  test('robots.txt sperrt /dev/ und nennt die Sitemap', async ({ request }) => {
    const antwort = await request.get('/robots.txt');
    expect(antwort.status()).toBe(200);
    const text = await antwort.text();
    expect(text).toContain('Disallow: /dev/');
    expect(text).toContain('Disallow: /portal/');
    expect(text).toContain('Sitemap: http://localhost:3000/sitemap.xml');
  });

  test('die Sitemap führt jede veröffentlichte Seite und KEINE /dev/-Fläche', async ({ request }) => {
    const antwort = await request.get('/sitemap.xml');
    expect(antwort.status()).toBe(200);
    const xml = await antwort.text();

    for (const route of OEFFENTLICHE_ROUTEN) {
      const url = `http://localhost:3000${route.pfad === '/' ? '' : route.pfad}`;
      expect(xml, `${route.pfad} fehlt in der Sitemap`).toContain(`<loc>${url}</loc>`);
    }
    // Die Erklärung ist eine Codeseite und steht in keiner `seite`-Zeile.
    expect(xml).toContain('<loc>http://localhost:3000/barrierefreiheit</loc>');

    // `Disallow` ist eine Bitte; eine fehlende Zeile in der Sitemap ist eine
    // Tatsache. Beides, nicht eines.
    expect(xml).not.toContain('/dev/');
    expect(xml).not.toContain('/portal/');
  });

  test('llms.txt kommt als text/plain und nennt jede Gesellschaft', async ({ request }) => {
    const antwort = await request.get('/llms.txt');
    expect(antwort.status()).toBe(200);
    expect(antwort.headers()['content-type']).toContain('text/plain');

    const text = await antwort.text();
    for (const firma of [
      'CSE Dienstleistungen GmbH', 'Select-Security Event GmbH',
      'REALTIME Service GmbH', 'CSE Operations',
    ]) {
      expect(text, `${firma} fehlt in llms.txt`).toContain(firma);
    }
  });

  test('die Anschrift steht in llms.txt ZEICHENGLEICH wie im Fussbereich', async ({ page, request }) => {
    const text = await (await request.get('/llms.txt')).text();
    await page.goto('/');
    const fuss = await page.locator('[data-cse="nap"] li').allInnerTexts();
    expect(fuss.length).toBe(4);

    for (const zeile of fuss) {
      // Der Fussbereich schreibt "Firma · Strasse · PLZ Ort", llms.txt
      // "Strasse, PLZ Ort" — geprüft wird, dass die BESTANDTEILE identisch
      // sind. Zwei Schreibweisen derselben Adresse sind zwei Unternehmen.
      const teile = zeile.split(' · ').map((t) => t.trim());
      for (const teil of teile) expect(text, `"${teil}" fehlt in llms.txt`).toContain(teil);
    }
  });
});

test.describe('(3) die ausgelieferten JSON-LD-Blöcke halten der Form stand', () => {
  test('die Startseite trägt WebSite und vier LocalBusiness', async ({ page }) => {
    const gefunden = await bloecke(page, '/');
    for (const b of gefunden) expect(() => pruefeJsonLd(b)).not.toThrow();

    const typen = gefunden.map((b) => b['@type']);
    expect(typen.filter((t) => t === 'LocalBusiness').length).toBe(4);
    expect(typen).toContain('WebSite');
    // O-206 ist offen: es gibt keinen gepflegten Rechtsträger, also kein Dach.
    expect(typen).not.toContain('Organization');
  });

  test.describe('je Bereich ein eigener LocalBusiness mit eigener Identität', () => {
    for (const slug of ['reinigung', 'security', 'bau', 'operations']) {
      test(`/${slug}`, async ({ page }) => {
        const gefunden = await bloecke(page, `/${slug}`);
        for (const b of gefunden) expect(() => pruefeJsonLd(b)).not.toThrow();

        const unternehmen = gefunden.find((b) => b['@type'] === 'LocalBusiness');
        expect(unternehmen, `/${slug} ohne LocalBusiness`).toBeDefined();
        // Vier eigenständige Gesellschaften (D-11) — vier eigene `@id`, sonst
        // konkurrieren sie lokal miteinander.
        expect(unternehmen!['@id']).toBe(`http://localhost:3000/${slug}#unternehmen`);
      });
    }
  });

  test('die vier @id sind VERSCHIEDEN', async ({ page }) => {
    const ids: string[] = [];
    for (const slug of ['reinigung', 'security', 'bau', 'operations']) {
      const gefunden = await bloecke(page, `/${slug}`);
      ids.push(String(gefunden.find((b) => b['@type'] === 'LocalBusiness')?.['@id']));
    }
    expect(new Set(ids).size).toBe(4);
  });

  test('eine Gruppenunterseite trägt eine Brotkrume und KEIN zweites LocalBusiness', async ({ page }) => {
    const gefunden = await bloecke(page, '/kontakt');
    for (const b of gefunden) expect(() => pruefeJsonLd(b)).not.toThrow();
    expect(gefunden.map((b) => b['@type'])).toEqual(['BreadcrumbList']);
  });

  test('jede Seite trägt genau EIN canonical', async ({ page }) => {
    for (const route of OEFFENTLICHE_ROUTEN) {
      await page.goto(route.pfad);
      await expect(
        page.locator('link[rel="canonical"]'), `${route.pfad}`,
      ).toHaveCount(1);
    }
  });
});
