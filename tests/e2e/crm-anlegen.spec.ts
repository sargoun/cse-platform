/**
 * Kunde, Kontakt und Lead im Browser anlegen (CRM-01, CRM-03, CRM-07).
 *
 * **Was hier geprüft wird, ist nicht „das Formular speichert".** Das steht in
 * `tests/isolation/crm-anlegen.test.ts`. Hier steht, was ein Vertriebsmensch
 * auf dem Bildschirm SIEHT — und die eine Sache, die er sehen muss, bevor er
 * einen Kunden anlegt: dass die Rechtsgrundlage darüber entscheidet, ob ihm je
 * eine Werbemail hinausgeht.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Einen Kunden anlegen', () => {
  test('erklärt die Rechtsgrundlage, bevor sie abgefragt wird', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/kunden/neu`);

    const formular = page.locator('[data-cse="kunde-formular"]');
    await expect(formular).toBeVisible();
    await expect(formular).toContainText('§7 UWG');
    await expect(formular).toContainText('ohne Grundlage geht keine Werbung hinaus');

    /* Die Vorgabe ist der sichere Zweig. */
    await expect(page.locator('input[name="rechtsgrundlage"][value="keine"]'))
      .toBeChecked();
  });

  test('legt einen Kunden an und springt auf seine Seite', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/kunden/neu`);

    const name = `Browsertest Hausverwaltung ${String(Date.now())}`;
    await page.locator('[data-cse="kunde-name"]').fill(name);
    await page.locator('input[name="ort"]').fill('Berlin');
    await page.locator('[data-cse="kunde-anlegen"]').click();

    /* Nicht zurueck aufs leere Formular: wer anlegt, will weiterarbeiten. */
    await page.waitForURL(/\/crm\/kunden\/[0-9a-f-]{36}$/u);
    await expect(page.locator('h1')).toContainText(name);
  });

  test('weist eine behauptete Einwilligung ohne Quelle ab — mit einem Satz', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/kunden/neu`);

    await page.locator('[data-cse="kunde-name"]').fill('Ohne Quelle GmbH');
    await page.locator('input[name="rechtsgrundlage"][value="einwilligung"]').check();
    await page.locator('[data-cse="kunde-anlegen"]').click();

    /*
     * Zurueck auf das Formular mit dem Grund — kein JSON, kein 500. Die
     * Portalformulare haben kein JavaScript, und eine JSON-Antwort waere
     * derselbe Fehler wie auf der oeffentlichen Angebotsanfrage (D-599).
     */
    await page.waitForURL(/\/crm\/kunden\/neu\?meldung=/u);
    const meldung = page.locator('[data-cse="kunde-meldung"]');
    await expect(meldung).toBeVisible();
    await expect(meldung).toContainText('Abmahnung');
  });
});

test.describe('Einen Ansprechpartner anlegen', () => {
  test('das Formular steht beim Kunden und zeigt das Tor danach', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);

    /* Erst einen Kunden anlegen, damit der Fall nicht auf Seed-Daten sitzt. */
    await page.goto(`/portal/${MANDANT}/crm/kunden/neu`);
    await page.locator('[data-cse="kunde-name"]').fill(`Kontakttest ${String(Date.now())}`);
    await page.locator('[data-cse="kunde-anlegen"]').click();
    await page.waitForURL(/\/crm\/kunden\/[0-9a-f-]{36}$/u);

    await page.locator('[data-cse="kontakt-anlegen"] summary').click();
    await page.locator('[data-cse="kontakt-nachname"]').fill('Beispiel');
    await page.locator('[data-cse="kontakt-speichern"]').click();
    await page.waitForURL(/\/crm\/kunden\/[0-9a-f-]{36}$/u);

    /*
     * **Die Spalte „Werbung per E-Mail" ist die Antwort des Tores selbst.**
     * Ohne Rechtsgrundlage steht dort „Abgelehnt" — und das ist der Beweis,
     * dass die Kette vom Formular bis in die Datenbank durchschlaegt.
     */
    const tor = page.locator('[data-cse="werbetor"]').last();
    await expect(tor).toHaveAttribute('data-erlaubt', 'false');
  });
});

test.describe('Einen Lead anlegen', () => {
  test('sagt, dass er keine Frist bekommt — und warum', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/leads/neu`);

    const hinweis = page.locator('[data-cse="lead-keine-frist"]');
    await expect(hinweis).toBeVisible();
    await expect(hinweis).toContainText('O-14');
  });

  test('verlangt einen Namen — Kunde oder Firma', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/leads/neu`);

    await page.locator('[data-cse="lead-betreff"]').fill('Ohne jeden Namen');
    await page.locator('[data-cse="lead-anlegen"]').click();

    await page.waitForURL(/\/crm\/leads\/neu\?meldung=/u);
    await expect(page.locator('[data-cse="lead-meldung"]')).toContainText('Namen');
  });

  test('legt einen Lead an und springt auf ihn', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/crm/leads/neu`);

    const firma = `Anruf GmbH ${String(Date.now())}`;
    await page.locator('[data-cse="lead-betreff"]').fill('Unterhaltsreinigung, Anruf');
    await page.locator('[data-cse="lead-firma"]').fill(firma);
    await page.locator('[data-cse="lead-anlegen"]').click();

    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]{36}$/u);
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('Rechte', () => {
  test('ohne crm.schreiben steht kein Formular da, sondern ein Satz', async ({ page }) => {
    /*
     * `leitung.reinigung` haelt `crm.lesen`. Ob sie auch schreibt, entscheidet
     * die Rollenmatrix — geprueft wird deshalb die ENTWEDER-ODER-Zusage: es
     * steht ein Formular da ODER ein Satz, der sagt, was fehlt. Nie ein Knopf,
     * der 403 gibt.
     */
    await anmelden(page, KONTO.leitungReinigung);
    const antwort = await page.goto(`/portal/${MANDANT}/crm/kunden/neu`);
    expect(antwort?.status()).toBe(200);
    const formular = page.locator('[data-cse="kunde-formular"]');
    const sperre = page.locator('[data-cse="kein-schreibrecht"]');
    expect(await formular.count() + await sperre.count()).toBe(1);
  });
});
