import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

/**
 * **Jeder Bildschirm hat einen Weg hinaus.**
 *
 * Diese Datei gibt es, weil dieselbe Sache dreimal passiert ist: die Seiten
 * waren gebaut, die Routen waren da, und der VERWEIS fehlte. Erst hatte die
 * oeffentliche Huelle keinen Weg ins Portal, dann trug die Seitenleiste 5 von
 * 17 Modulen, dann war das „Mehr"-Blatt leer — und zuletzt fuehrte der Punkt
 * „Konto", den die Kopfzeile auf JEDER Portalseite anbietet, auf die Auskunft
 * „dieses Modul entsteht in Phase 3" fuer `/portal/[mandant]`.
 *
 * Ein fehlender Verweis erzeugt keinen Fehler. Er erzeugt einen Menschen, der
 * glaubt, die Anwendung koenne es nicht. Deshalb wird hier nicht geprueft, ob
 * eine Seite RENDERT, sondern ob man von ihr wieder WEGKOMMT.
 */

const PORTALSEITEN = [
  ['/portal/reinigung', KONTO.adminReinigung],
  ['/portal/reinigung/zeiten', KONTO.adminReinigung],
  ['/portal/mein', KONTO.fatima],
  ['/portal/mein/schichten', KONTO.fatima],
  ['/portal/konto', KONTO.fatima],
] as const;

async function ausgangspruefung(page: Page, pfad: string) {
  const antwort = await page.goto(pfad);
  expect(antwort?.status(), pfad).toBe(200);

  // Der Ausgang steht in der Kopfzeile am Schreibtisch …
  const kopf = page.locator('[data-cse="sitzungsnavigation"]');
  await expect(kopf, `${pfad}: keine Sitzungsnavigation`).toHaveCount(1);
  for (const ziel of ['/auth/bereich', '/portal/konto', '/']) {
    await expect(kopf.locator(`a[href="${ziel}"]`), `${pfad}: kein Weg zu ${ziel}`)
      .toHaveCount(1);
  }
  await expect(
    kopf.locator('form[action="/api/abmelden"] button[type="submit"]'),
    `${pfad}: keine Abmeldung`,
  ).toHaveCount(1);
}

test.describe('(1) kein Portalbildschirm ohne Ausgang', () => {
  for (const [pfad, konto] of PORTALSEITEN) {
    test(`${pfad} traegt Bereichswechsel, Konto, Website und Abmelden`, async ({ page }) => {
      await alsKonto(page, konto);
      await ausgangspruefung(page, pfad);
    });
  }
});

test.describe('(2) `/portal/konto` ist das Konto — nicht ein Mandantenmodul', () => {
  test('zeigt Anmeldung und Bereiche, nicht „wird noch gebaut"', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/konto');
    expect(antwort?.status()).toBe(200);

    await expect(page.locator('[data-cse="konto-angaben"]')).toBeVisible();
    await expect(page.locator('[data-cse="konto-bereiche"]')).toBeVisible();
    /*
     * Die Gegenprobe ist wichtiger als die Zusicherung darueber: vorher
     * RENDERTE die Seite auch — nur eben den Bauzustandshinweis einer
     * Adresse, die keine Gesellschaft ist.
     */
    await expect(page.locator('[data-cse="noch-nicht"]')).toHaveCount(0);
    await expect(page.getByText('/portal/[mandant]')).toHaveCount(0);
    // Die Anmeldung des Kontos steht drin — sonst ist es das Konto von wem?
    await expect(page.locator('[data-cse="konto-angaben"]'))
      .toContainText(KONTO.adminReinigung);
  });
});

test.describe('(3) die Bereichswahl ist keine Sackgasse', () => {
  test('aus einer laufenden Sitzung fuehrt ein Weg zurueck', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/auth/bereich');
    const ausgang = page.locator('[data-cse="bereich-ausgang"]');
    await expect(ausgang).toBeVisible();
    await expect(ausgang.locator('[data-cse="bereich-zurueck"]')).toHaveCount(1);
    await expect(ausgang.locator('form[action="/api/abmelden"]')).toHaveCount(1);

    await ausgang.locator('[data-cse="bereich-zurueck"]').click();
    await page.waitForLoadState('networkidle');
    // Zurueck heisst zurueck — und NICHT: gewechselt.
    expect(new URL(page.url()).pathname).toBe('/portal/reinigung');
  });
});

test.describe('(4) die Kopfzeile zeigt den Weg, nicht nur den Ort', () => {
  test('eine Unterseite traegt `‹ Heute › Seitenname`', async ({ page }) => {
    await alsKonto(page, KONTO.fatima);
    await page.goto('/portal/mein/schichten');
    const spur = page.locator('[data-cse="spur"]');
    await expect(spur).toBeVisible();
    const zurueck = spur.locator('[data-cse="spur-zurueck"]');
    await expect(zurueck).toHaveAttribute('href', '/portal/mein');
    await zurueck.click();
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/portal/mein');
  });

  test('die Wurzel selbst traegt KEINE Spur — sie waere ein Weg zu sich', async ({ page }) => {
    await alsKonto(page, KONTO.fatima);
    await page.goto('/portal/mein');
    await expect(page.locator('[data-cse="spur"]')).toHaveCount(0);
  });
});

test.describe('(5) das Mitarbeiterportal hat am Schreibtisch eine Navigation', () => {
  test('die Schiene traegt die Ziele der Leiste — und keine leere Spalte', async ({ page }) => {
    await alsKonto(page, KONTO.fatima);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/portal/mein');
    const schiene = page.locator('[data-cse="seitennavigation"]');
    await expect(schiene).toBeVisible();
    /*
     * Mehr als null. Vorher rendete das `<nav>` mit `w-56` und Trennlinie,
     * enthielt aber keinen einzigen Punkt: eine leere Spalte von 224px, die
     * sich wie ein Fehler liest und keiner war — nur das falsche Register.
     */
    await expect(schiene.locator('[data-cse="nav-punkt"]').first()).toBeVisible();
  });
});
