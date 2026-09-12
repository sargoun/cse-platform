/**
 * Phase 4 · CRM im Browser — und die eine Spalte, die vor einer Abmahnung
 * schuetzt.
 *
 * § 7 UWG verbietet elektronische Werbung ohne vorherige ausdrueckliche
 * Einwilligung, auch im B2B. Die Kundenseite zeigt je Kontakt die ANTWORT
 * DES TORES, nicht eine zweite Formulierung derselben Regel — dieselbe
 * Funktion, die auch der Sendepfad fragt.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
/**
 * Angemeldet wird als BESTIMMTES Konto, nicht als „irgendwer mit Rolle admin".
 *
 * Die oertliche Hilfe griff `[data-rolle="admin"]`.first(); seit der Seed ein
 * zweites Verwaltungskonto kennt, steht „Administration Bau" in der nach Namen
 * sortierten Liste vor „Administration Reinigung". Die Sitzung landete damit
 * im Mandanten `bau`, und jeder Aufruf unter `/portal/reinigung/…` antwortete
 * zu Recht mit 404 (Slug-Wache, AUT-06) — ein Fehlschlag, der wie ein kaputter
 * Bildschirm aussah und eine falsche Anmeldung war.
 */
import { alsKonto, KONTO } from './hilfen/anmeldung';

test.describe('(1) Die Kundenliste zeigt den Werbestatus', () => {
  test('sie führt die Seed-Kunden mit Rechtsgrundlage', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung/crm/kunden');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Kunden');
    await expect(page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }))
      .toBeVisible();
    await expect(page.getByText('Bestandskunde').first()).toBeVisible();
  });

  test('und nicht die Kunden einer anderen Gesellschaft', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/crm/kunden');
    // K-20001 gehoert der Security — dieselbe Firma, andere Kundenbeziehung.
    await expect(page.getByText('K-20001')).toHaveCount(0);
    await expect(page.getByText('K-10001').first()).toBeVisible();
  });
});

test.describe('(2) Das UWG-Tor steht als Anzeige auf der Kundenseite', () => {
  test('der Bestandskunden-Kontakt darf per E-Mail beworben werden', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/crm/kunden');
    await page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }).click();
    await expect(page.locator('h1')).toHaveText('Berliner Hausverwaltung GmbH');

    const tor = page.locator('[data-cse="werbetor"]').first();
    await expect(tor).toBeVisible();
    await expect(tor).toHaveAttribute('data-erlaubt', 'true');
    await expect(page.locator('[data-cse="rechtsgrundlage"]')).toContainText('Bestandskunde');
  });

  test('das Objekt des Kunden ist von hier erreichbar', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/crm/kunden');
    await page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }).click();
    await page.getByRole('link', { name: 'Bürohaus Kurfürstendamm' }).click();
    await expect(page.locator('h1')).toHaveText('Bürohaus Kurfürstendamm');
  });
});

test.describe('(3) Der Lead-Posteingang und der Verlauf', () => {
  test('er führt die offenen Anfragen', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung/crm/leads');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Leads');
    await expect(page.getByRole('link', { name: /Unterhaltsreinigung Buerohaus/u }))
      .toBeVisible();
  });

  test('eine Anfrage ohne nächsten Schritt sagt das — sonst liegt sie still',
    async ({ page }) => {
      await alsKonto(page, KONTO.adminReinigung);
      await page.goto('/portal/reinigung/crm/leads');
      await page.getByRole('link', { name: /Unterhaltsreinigung Buerohaus/u }).click();
      await expect(page.locator('[data-cse="ohne-naechsten-schritt"]')).toBeVisible();
    });

  test('eine Notiz landet im Verlauf, und der nächste Schritt steht danach fest',
    async ({ page }) => {
      await alsKonto(page, KONTO.adminReinigung);
      await page.goto('/portal/reinigung/crm/leads');
      await page.getByRole('link', { name: /Glasreinigung/u }).click();
      await page.waitForURL(/\/crm\/leads\/[0-9a-f-]{36}$/u);
      const url = page.url();

      await page.fill('#inhalt', 'Rückruf: Termin am Objekt vereinbart.');
      await page.fill('#naechsteAktion', 'Angebot rechnen und senden');
      await page.fill('#naechsteAktionAm', '2026-10-01');
      await page.locator('[data-cse="lead-notieren"]').click();
      await page.waitForURL(url);

      await expect(page.locator('[data-cse="naechster-schritt"]'))
        .toContainText('Angebot rechnen und senden');
      await expect(page.locator('[data-cse="verlauf"]'))
        .toContainText('Termin am Objekt vereinbart');
      // Der Eintrag traegt, WER ihn festgehalten hat und WANN.
      await expect(page.locator('[data-cse="verlauf"]')).toContainText('Notiz ·');
    });
});

test.describe('(4) „Mehr" öffnet den vollständigen Baum (SEITENKARTE §11.2)', () => {
  test('am Telefon führt das fünfte Ziel in die übrigen Module', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung');

    const mehr = page.locator('[data-cse="mehr"]');
    await expect(mehr).toBeVisible();
    // Vor dem Öffnen ist das Blatt zu.
    await expect(page.locator('[data-cse="mehr-blatt"]')).toBeHidden();
    await page.locator('[data-cse="tab"][data-tab="mehr"]').click();
    await expect(page.locator('[data-cse="mehr-blatt"]')).toBeVisible();
    // CRM ist darin — und war über die vier Tabs nicht erreichbar.
    await page.locator('[data-cse="mehr-ziel"][data-ziel="crm"]').click();
    await expect(page.locator('h1')).toHaveText('CRM');
  });

  test('ein Modul ohne Recht steht NICHT im Blatt', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    /**
     * Hier ist die ROLLE die Aussage, nicht der Mensch: geprueft wird, was
     * `leitung` NICHT darf. `[data-rolle="leitung"]`.first() traf das nur so
     * lange verlaesslich, wie die nach Namen sortierte Liste „Leitung Bau" vor
     * „Leitung Security" stellte — eine Zusicherung, die niemand gegeben hat.
     * `leitung.bau` ist genau die Leitung DIESER Gesellschaft; unter einer
     * Sitzung in `security` haette `/portal/bau` mit 404 geantwortet.
     */
    await alsKonto(page, KONTO.leitungBau);
    await page.goto('/portal/bau');
    await page.locator('[data-cse="tab"][data-tab="mehr"]').click();
    // `leitung` hält `system.einstellung_lesen` nicht — der Punkt fehlt,
    // statt ausgegraut zu sein: ein Menüpunkt, der auf 404 führt, verrät
    // die Existenz dessen, was er nicht zeigen darf.
    await expect(page.locator('[data-cse="mehr-ziel"][data-ziel="einstellungen"]'))
      .toHaveCount(0);
    await expect(page.locator('[data-cse="mehr-ziel"][data-ziel="objekte"]')).toBeVisible();
  });
});

test.describe('(5) barrierefrei', () => {
  test('axe findet nichts auf der Kundenseite', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/crm/kunden');
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ergebnis.violations).toEqual([]);
  });
});
