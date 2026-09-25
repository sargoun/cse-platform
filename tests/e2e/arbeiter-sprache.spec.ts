/**
 * Stempeluhr, Anmeldung und Konto der Beschäftigten in ihrer Sprache
 * (V-200, D-694, EMP-12, SEITENKARTE §12).
 *
 * **Der Befund.** SEITENKARTE §12 zählt die Stempeluhr (`/check-in/[token]`),
 * die Anmeldung (`/auth/mitarbeiter` samt `/code`) und die Kontoseiten der
 * Arbeiterhülle zu den vier Sprachen — alle drei waren fest deutsch, ohne
 * `lang` und ohne `dir`. Gerade das Stempeln ist der tägliche Handgriff einer
 * Kraft, die kein Deutsch liest.
 *
 * **Woher die Sprache kommt.** Vor der Anmeldung: der Sprachkeks, dann
 * `Accept-Language`, dann Deutsch. Diese Datei stellt den Browser deshalb
 * ausdrücklich auf Arabisch bzw. Türkisch; die übrige Suite läuft auf `de-DE`
 * (`playwright.config.ts`).
 *
 * Geprüft wird mit einer BELIEBIGEN Marke — die Seite löst sie beim Rendern
 * nicht auf (D-135), und genau deshalb darf die Sprache nicht aus ihr kommen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ANMELDUNG_TEXTE, STEMPEL_TEXTE } from '../../src/lib/i18n/vor-anmeldung.js';
import { KALENDER_FEED_TEXTE, KONTO_WURZEL_TEXTE } from '../../src/lib/i18n/konto.js';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const ADRESSE = '/check-in/aaaabbbbccccddddeeeeffff00001111222233334444555566667777';

test.describe('die Stempeluhr auf Arabisch — aus Accept-Language', () => {
  test.use({ locale: 'ar-EG', viewport: { width: 375, height: 812 } });

  test('rtl, arabischer Knopf, und die Ablehnung in derselben Sprache', async ({ page }) => {
    const t = STEMPEL_TEXTE.ar;
    await page.goto(ADRESSE);
    const flaeche = page.locator('main[data-cse="checkin"]');
    await expect(flaeche).toHaveAttribute('dir', 'rtl');
    await expect(flaeche).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.titel);
    await expect(page).toHaveTitle(t.seitentitel);

    // Weiterhin genau EIN Knopf (DESIGN §8) — die Sprachwahl sind Verweise.
    const knoepfe = page.getByRole('button');
    await expect(knoepfe).toHaveCount(1);
    await expect(knoepfe.first()).toHaveText(t.einstempeln);

    await knoepfe.first().click();
    await expect(page.locator('main [aria-live="assertive"]'))
      .toHaveText(t.ungueltig, { timeout: 15_000 });
  });

  test('kein Scrollen, auch mit den längeren arabischen Sätzen', async ({ page }) => {
    await page.goto(ADRESSE);
    const masse = await page.evaluate(() => ({
      inhalt: document.documentElement.scrollHeight,
      fenster: window.innerHeight,
      breite: document.documentElement.scrollWidth,
      fensterBreite: window.innerWidth,
    }));
    expect(masse.inhalt, 'die Seite scrollt senkrecht').toBeLessThanOrEqual(masse.fenster + 1);
    expect(masse.breite, 'die Seite scrollt waagerecht')
      .toBeLessThanOrEqual(masse.fensterBreite + 1);
  });

  test('axe meldet null AA-Verstösse', async ({ page }) => {
    await page.goto(ADRESSE);
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });

  test('die Wahl „Türkçe" gilt für dieses Gerät — vor Accept-Language', async ({ page }) => {
    await page.goto(ADRESSE);
    const wahl = page.locator('[data-cse="geraete-sprachwahl"]');
    await expect(wahl.locator('a[aria-current="true"]')).toHaveAttribute('data-sprache', 'ar');
    await wahl.locator('a[data-sprache="tr"]').click();

    // Zurück auf DIESELBE Marke, jetzt auf Türkisch.
    await expect(page).toHaveURL(new RegExp(`${ADRESSE}$`, 'u'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(STEMPEL_TEXTE.tr.titel);
    const keks = (await page.context().cookies()).find((k) => k.name === 'cse_sprache');
    expect(keks?.value).toBe('tr');
    expect(keks?.httpOnly).toBe(true);
    // Ein Sitzungskeks, solange O-928 offen ist (D-751) — Playwright meldet -1.
    expect(keks?.expires).toBe(-1);

    // Und sie bleibt: der Keks geht vor den Kopf des Browsers.
    await page.reload();
    await expect(page.locator('main[data-cse="checkin"]')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('button')).toHaveText(STEMPEL_TEXTE.tr.einstempeln);
  });

  test('ein Rückweg nach draussen endet auf der Anmeldung', async ({ page }) => {
    await page.goto('/api/geraetesprache?sprache=en&zurueck=https%3A%2F%2Fboese.example%2F');
    const ziel = new URL(page.url());
    expect(ziel.hostname).not.toBe('boese.example');
    expect(ziel.pathname).toBe('/auth/mitarbeiter');
  });
});

test.describe('die Anmeldung auf Türkisch — aus Accept-Language', () => {
  test.use({ locale: 'tr-TR' });

  test('beide Schritte sprechen Türkisch, und die Nummer liest sich von links', async ({ page }) => {
    const t = ANMELDUNG_TEXTE.tr;
    await page.goto('/auth/mitarbeiter');
    await expect(page.locator('[data-sprache="tr"]').first()).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.titel);
    await expect(page).toHaveTitle(t.seitentitel);
    await expect(page.locator('input[name="telefon"]')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('[data-cse="auth-schritt"]')).toContainText('1');

    // Weiter zur Codeeingabe — mit einer Nummer, die es nicht gibt (AUT-06:
    // der Weg sieht für jede Nummer gleich aus).
    await page.fill('input[name="telefon"]', '+49 170 9999998');
    await page.locator('[data-cse="code-anfordern"]').click();
    await page.waitForURL('**/auth/mitarbeiter/code');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.codeTitel);
    await expect(page.locator('[data-cse="code-einloesen"]')).toHaveText(t.anmelden);
  });

  test('auf Arabisch läuft die Anmeldung von rechts', async ({ page }) => {
    await page.goto('/api/geraetesprache?sprache=ar&zurueck=%2Fauth%2Fmitarbeiter');
    await expect(page).toHaveURL(/\/auth\/mitarbeiter$/u);
    const huelle = page.locator('[data-sprache="ar"]').first();
    await expect(huelle).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ANMELDUNG_TEXTE.ar.titel);

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });
});

test.describe('das Konto einer arabischsprachigen Beschäftigten', () => {
  test('die Kontowurzel spricht Arabisch — nicht nur ihre Leiste', async ({ page }) => {
    await alsKonto(page, KONTO.amir);
    await page.goto('/portal/konto');
    const t = KONTO_WURZEL_TEXTE.ar;
    await expect(page.locator('[data-sprache="ar"]').first()).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-cse="konto-seiten"]')).toContainText(t.profil);
    await expect(page.locator('[data-cse="konto-angaben"]')).toContainText(t.zweiteStufe);
  });

  test('die Benachrichtigungen zeigen die Arten, die sie erreichen — mit Namen', async ({ page }) => {
    await alsKonto(page, KONTO.amir);
    await page.goto('/portal/konto/benachrichtigungen');
    const zeilen = page.locator('[data-cse="praeferenz-zeile"]');
    await expect(zeilen.first()).toBeVisible();
    // Nur Arten mit einem Ziel im Arbeiterportal — keine Anfrage, kein Radar.
    await expect(page.locator('[data-cse="praeferenz-zeile"][data-art^="crm."]')).toHaveCount(0);
    await expect(page.locator('[data-cse="praeferenz-zeile"][data-art^="radar."]')).toHaveCount(0);
    // Kein Schlüssel als Überschrift einer Zeile.
    await expect(page.locator('main')).not.toContainText('plan_veroeffentlicht');
  });

  test('der Kalender-Feed, auf den die Wurzel verweist, spricht Arabisch — samt Warnung (D-750)',
    async ({ page }) => {
      await alsKonto(page, KONTO.amir);
      await page.goto('/portal/konto/kalender-feed');
      const t = KALENDER_FEED_TEXTE.ar;
      await expect(page.locator('[data-sprache="ar"]').first()).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('main')).toContainText(t.titel);
      await expect(page.locator('[data-cse="feed-warnung"]')).toContainText(t.warnungTitel);
      // Der Kalender eines Bereichs ist Verwaltung — kein Verweis dorthin.
      await expect(page.locator('[data-cse="zum-kalender"]')).toHaveCount(0);
    });
});
