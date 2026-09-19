/**
 * Die Akquise im Browser (§12).
 *
 * **Was hier geprüft wird, sind die drei Sätze, die ein Vertrieb lesen muss,
 * bevor er etwas Falsches tut:**
 *
 *  1. Dass keine Recherchequelle verbunden ist — sonst hält jemand die kurze
 *     Liste für einen leeren Markt.
 *  2. Dass hier **keine Personendaten** stehen, und warum (Art. 14 DSGVO) —
 *     sonst sieht das fehlende Kontaktfeld nach einer Lücke aus.
 *  3. Dass der Entwurf **nicht** hinausgeht, mit dem Grund und den Schritten,
 *     die daran etwas ändern würden.
 *
 * Der dritte ist der wichtigste. Ein Entwurf ohne diesen Satz sieht aus wie
 * eine Nachricht, die gleich rausgeht — und der Unterschied zwischen „steht im
 * Entwurf" und „ist versendet" ist bei §7 UWG eine Abmahnung.
 *
 * **Und ein Fall, den man leicht vergisst:** `/crm/akquise/quellen` ist eine
 * Nachbarroute von `[id]`. Ohne die Kennungsprüfung landet das Wort „quellen"
 * in einem `$1::uuid` und die Seite antwortet 500 statt zu existieren.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Akquiseliste', () => {
  test('sagt, dass keine Quelle verbunden ist — und nennt den Grund', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/akquise`);

    const kasten = page.locator('[data-cse="akquise-quellenstand"]');
    await expect(kasten).toBeVisible();
    await expect(kasten).toHaveAttribute('data-art', 'warnung');
    await expect(kasten).toContainText('keine Recherchequelle verbunden');
  });

  test('erklärt auf der Liste, warum kein Ansprechpartner dabeisteht', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/akquise`);
    await expect(page.getByText('Art. 14 DSGVO').first()).toBeVisible();
    await expect(page.getByText('nur Firmendaten').first()).toBeVisible();
  });

  test('zeigt die recherchierten Firmen nach Punktzahl, die beste oben', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/akquise`);

    const zeilen = page.locator('tbody tr');
    await expect(zeilen.first()).toBeVisible();
    const anzahl = await zeilen.count();
    expect(anzahl).toBeGreaterThan(2);

    /*
     * Die Punktzahl steht in der zweiten Spalte. Geprueft wird die ORDNUNG,
     * nicht der Wert: die Gewichte sind Platzhalter (O-15) und duerfen sich
     * aendern, die Sortierung darf es nicht.
     */
    const punkte: number[] = [];
    for (let i = 0; i < Math.min(anzahl, 5); i += 1) {
      const text = (await zeilen.nth(i).locator('td').nth(1).innerText()).trim();
      if (text !== '—') punkte.push(Number(text));
    }
    expect(punkte.length).toBeGreaterThan(1);
    for (let i = 1; i < punkte.length; i += 1) {
      expect(punkte[i]!).toBeLessThanOrEqual(punkte[i - 1]!);
    }
  });
});

test.describe('Eine einzelne Firma', () => {
  async function ersteFirma(page: Page): Promise<string> {
    await page.goto(`/portal/${MANDANT}/crm/akquise`);
    const verweis = page.locator('tbody tr').first().locator('a').first();
    const ziel = await verweis.getAttribute('href');
    expect(ziel).not.toBeNull();
    return ziel!;
  }

  test('zeigt Begründung, Entwurf — und dass der Entwurf NICHT hinausgeht', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(await ersteFirma(page));

    /* 1 — die Begruendung nennt sich selbst als Platzhalter (O-15). */
    await expect(page.getByText('PLATZHALTER').first()).toBeVisible();

    /* 2 — der Entwurf steht da, und er beziffert nichts. */
    const entwurf = page.locator('pre').first();
    await expect(entwurf).toBeVisible();
    await expect(entwurf).toContainText('Mit freundlichen Grüßen');
    await expect(entwurf).not.toContainText('€');

    /* 3 — und der Satz, auf den es ankommt. */
    const sperre = page.locator('[data-cse="akquise-versandstand"]');
    await expect(sperre).toBeVisible();
    await expect(sperre).toHaveAttribute('data-art', 'warnung');
    await expect(sperre).toContainText('geht heute nicht hinaus');
    await expect(sperre.locator('ol li').first()).toBeVisible();
  });

  test('sagt beim Ansprechpartner, dass er gar nicht gespeichert wird', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(await ersteFirma(page));
    await expect(page.getByText('wird nicht gespeichert')).toBeVisible();
  });

  test('übernimmt eine Firma in den Vertrieb — und der Lead hat keinen Kontakt', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    const pfad = await ersteFirma(page);
    await page.goto(pfad);

    await page.getByRole('button', { name: 'Übernehmen' }).click();
    await page.waitForURL(`**${pfad}`);

    const bestaetigung = page.locator('[data-cse="akquise-uebernommen"]');
    await expect(bestaetigung).toBeVisible();
    await expect(bestaetigung).toContainText('im Vertrieb');

    /*
     * Und der Lead existiert wirklich — die Bestaetigung allein waere eine
     * Behauptung der Seite ueber sich selbst.
     */
    await bestaetigung.getByRole('link', { name: 'Zum Lead' }).click();
    await expect(page.locator('h1')).toBeVisible();
  });

  test('verwirft nur mit Grund', async ({ page }) => {
    await anmelden(page, KONTO.adminBau);
    await page.goto('/portal/bau/crm/akquise');
    const verweis = await page.locator('tbody tr').first().locator('a').first()
      .getAttribute('href');
    await page.goto(verweis!);

    const feld = page.locator('input[name="grund"]');
    await expect(feld).toHaveAttribute('required', '');

    await feld.fill('Hat bis 2027 einen Rahmenvertrag.');
    await page.getByRole('button', { name: 'Verwerfen' }).click();
    await page.waitForURL('**/portal/bau/crm/akquise');
    await expect(page.locator('[data-cse="akquise-quellenstand"]')).toBeVisible();
  });
});

test.describe('Quellen und Läufe', () => {
  test('ist eine eigene Seite und kein 500 — `quellen` ist keine Kennung', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    const antwort = await page.goto(`/portal/${MANDANT}/crm/akquise/quellen`);
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Recherchequellen');
  });

  test('nennt jede Quelle mit ihrem Grund — und den protokollierten Leerlauf', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/akquise/quellen`);

    await expect(page.locator('[data-cse="quellen-stand"]')).toContainText('Art. 14 DSGVO');
    await expect(page.getByText('Handelsregister').first()).toBeVisible();
    /*
     * Der uebersprungene Lauf ist hier die eigentliche Aussage: er beweist,
     * dass ein Leerlauf aufgeschrieben wird statt still zu bleiben.
     */
    await expect(page.getByText('Quelle nicht verbunden').first()).toBeVisible();
    await expect(page.getByText('O-596').first()).toBeVisible();
  });

  test('eine erfundene Kennung gibt 404, nicht 500', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    const antwort = await page.goto(
      `/portal/${MANDANT}/crm/akquise/00000000-0000-4000-8000-000000000000`);
    expect(antwort?.status()).toBe(404);
  });
});
