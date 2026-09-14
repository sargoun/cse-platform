/**
 * PR 62 im Browser — der Posteingang und die Prüfung (APR-01 … APR-03, APR-07,
 * APR-08, D-472).
 *
 * Was die Datenbank kann, steht in `tests/isolation/freigabe-*.test.ts`. Hier
 * steht, was eine Leitung sieht und tut:
 *
 *  1. Der Posteingang steht in der Ordnung des Dienstes — das Dringende oben.
 *  2. Die Prüfung nennt, was sich geändert hat, und woher jeder Wert stammt;
 *     ein unsicheres Feld sperrt den Freigabeknopf sichtbar.
 *  3. Ablehnen braucht einen Grund; mit Grund schreibt es ein Kettenglied.
 *  4. Freigeben ohne unsichere Felder schreibt ein Kettenglied — und die
 *     Freigabe verschwindet aus dem Posteingang.
 *  5. `geoeffnet_am` im Rumpf ist ein 400 (T-36).
 *  6. Wer `freigabe.lesen` nicht hält, sieht die Seite nicht (AUT-06).
 *  7. Der Stapel genehmigt die Routinezeilen und lässt die markierte stehen
 *     (APR-04) — und das Einspruchsfenster steht danach auf der Prüfseite,
 *     mit einem Knopf, der die Genehmigung zurückholt (APR-05).
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Freigabe-Posteingang', () => {
  test('das Dringende steht oben, mit Zähler', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    await expect(page.getByRole('heading', { name: 'Freigaben', level: 1 })).toBeVisible();

    const zaehler = page.locator('[data-cse="posteingang-zaehler"]');
    expect(Number(await zaehler.getAttribute('data-anzahl'))).toBeGreaterThanOrEqual(2);

    // Der Hinweis hat drei Stunden Frist, die Monatsrechnung zwei Tage.
    const erste = page.locator('table tbody tr').first();
    await expect(erste).toContainText('Leistungsnachweis');
    await expect(erste).toContainText('Unter 4 Stunden');
  });

  test('die Prüfung zeigt Kopfzeile, Diff, Nachweise — und sperrt den Knopf', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    await page.getByRole('link', { name: /Monatsrechnung August 2026/u }).click();

    await expect(page.locator('[data-cse="freigabe-kopfzeile"]'))
      // `formatiereGeld` setzt ein geschütztes Leerzeichen vor das Eurozeichen.
      .toContainText(/Nachtstunden .* neu → \+456,00\s€/u);
    await expect(page.getByRole('heading', { name: 'Was sich geändert hat' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Neue Positionen' })).toContainText('Nachtstunden');
    await expect(page.locator('[data-cse="diff-summen"]')).toContainText(/\+456,00\s€/u);

    // `DataTable` rendert jede Zeile zweimal — Tabelle ab `md`, Stapel darunter
    // (D-420); gezaehlt wird, was zu sehen ist.
    const unsicher = page.locator('[data-cse="feld-unsicher"]:visible');
    await expect(unsicher).toHaveCount(1);
    await expect(unsicher).toContainText('10,5 Nachtstunden');
    await expect(page.locator('[data-cse="freigeben-gesperrt"]')).toBeVisible();
    await expect(page.locator('[data-cse="freigeben"]')).toBeDisabled();
    await expect(page.locator('[data-cse="ablehnen"]')).toBeEnabled();
  });

  test('ablehnen braucht einen Grund — mit Grund entsteht ein Kettenglied', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    await page.getByRole('link', { name: /Monatsrechnung August 2026/u }).click();

    await page.locator('[data-cse="ablehnen"]').click();
    await expect(page).toHaveURL(/fehler=ohne_begruendung/u);
    await expect(page.locator('[data-cse="entscheidung-abgewiesen"]')).toContainText('Begründung');

    await page.locator('#begruendung').fill('Die Nachtstunden stimmen nicht mit dem Stundenkonto überein.');
    await page.locator('[data-cse="ablehnen"]').click();
    await expect(page).toHaveURL(/entschieden=abgelehnt/u);
    await expect(page.locator('[data-cse="entscheidung-vermerkt"]')).toContainText('Kettenglied');
    await expect(page.locator('[data-cse="freigabe-status"]')).toHaveAttribute('data-status', 'abgelehnt');
    await expect(page.locator('[data-cse="schnappschuss"]')).toContainText('SHA-256');
  });

  test('freigeben ohne unsichere Felder — und weg aus dem Posteingang', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    const vorher = Number(await page.locator('[data-cse="posteingang-zaehler"]').getAttribute('data-anzahl'));
    await page.getByRole('link', { name: /Leistungsnachweis/u }).click();

    await expect(page.locator('[data-cse="freigeben"]')).toBeEnabled();
    await page.locator('[data-cse="freigeben"]').click();
    await expect(page).toHaveURL(/entschieden=genehmigt/u);
    await expect(page.locator('[data-cse="freigabe-status"]')).toHaveAttribute('data-status', 'genehmigt');

    await page.goto(`/portal/${MANDANT}/freigaben`);
    const nachher = Number(await page.locator('[data-cse="posteingang-zaehler"]').getAttribute('data-anzahl'));
    expect(nachher).toBe(vorher - 1);
    await expect(page.getByRole('link', { name: /Leistungsnachweis/u })).toHaveCount(0);
  });

  test('geoeffnet_am im Rumpf ist ein 400 — die Prüfdauer misst der Server (T-36)', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    const antwort = await page.request.post(
      `/api/freigaben/00000000-0000-0000-0000-000000000000/entscheidung`,
      {
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        data: { entscheidung: 'genehmigt', geoeffnet_am: '2026-01-01T00:00:00Z' },
      });
    expect(antwort.status()).toBe(400);
    expect((await antwort.json() as { fehler: string }).fehler).toBe('geoeffnet_am_nicht_erlaubt');
  });

  test('wer das Recht nicht hält, sieht den Posteingang nicht (AUT-06)', async ({ page }) => {
    await anmelden(page, KONTO.kunde);
    const antwort = await page.goto(`/portal/${MANDANT}/freigaben`);
    // Die K-04-Decke leitet eine Kundin in ihr Portal — sie erfährt nichts
    // über die Existenz der Seite (D-4xx, siehe agenten.spec.ts).
    expect([200, 404]).toContain(antwort?.status());
    await expect(page.getByRole('heading', { name: 'Freigaben', level: 1 })).toHaveCount(0);
  });
});

/**
 * **Eigene Gesellschaften, damit die Reihenfolge nichts bedeutet.** Die Tests
 * oben entscheiden die beiden Vorschläge der Reinigung; ein Stapeltest, der
 * dieselben Zeilen bräuchte, liefe je nach Reihenfolge ins Leere. `bau` hat
 * genau eine Routinezeile, `security` genau eine markierte.
 */
test.describe('Stapel, Einspruch, Rücknahme (APR-04 … APR-06)', () => {
  test('eine markierte Zeile kommt gar nicht erst in den Stapel', async ({ page }) => {
    await anmelden(page, KONTO.adminSecurity);
    await page.goto('/portal/security/freigaben');
    await expect(page.locator('[data-cse="stapel-auswahl"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="stapel-keiner"]')).toBeVisible();
    await expect(page.locator('[data-cse="stapel-gesperrt"]:visible').first())
      .toContainText('Erstkontakt');
  });

  /**
   * Der ganze Weg in einem Zug: stapelweise genehmigen, das Fenster auf der
   * Prüfseite sehen, widersprechen. Drei Tests daraus zu machen hiesse, den
   * Stand zwischen ihnen zu erraten.
   */
  test('Stapel → Einspruchsfenster → Einspruch', async ({ page }) => {
    await anmelden(page, KONTO.adminBau);
    await page.goto('/portal/bau/freigaben');

    const haken = page.locator('[data-cse="stapel-auswahl"]:visible');
    await expect(haken).toHaveCount(1);
    const freigabeId = await haken.first().getAttribute('value');
    await haken.first().check();
    await page.locator('[data-cse="stapel-genehmigen"]').click();

    await expect(page).toHaveURL(/stapel=1/u);
    await expect(page.locator('[data-cse="stapel-bericht"]')).toContainText('1 genehmigt');
    // Eine Terminbestätigung ist risikoarm — also läuft ein Einspruchsfenster.
    await expect(page.locator('[data-cse="stapel-verzoegert"]')).toContainText('Einspruchsfenster');
    await expect(page.locator('[data-cse="posteingang-leer"]')).toBeVisible();

    /* Solange das Fenster läuft, steht die Zeile in „Laufende Fenster". */
    await page.goto('/portal/bau/freigaben/laufend');
    const laufend = page.locator('[data-cse="laufend-art"][data-art="einspruch"]:visible');
    await expect(laufend).toHaveCount(1);
    await expect(page.locator('[data-cse="laufend-rest"]:visible').first())
      .toContainText(/noch \d+ Min\./u);

    await page.goto(`/portal/bau/freigaben/${String(freigabeId)}`);
    await expect(page.locator('[data-cse="freigabe-status"]'))
      .toHaveAttribute('data-status', 'genehmigt');
    const fenster = page.locator('[data-cse="einspruch-fenster"]');
    await expect(fenster).toBeVisible();
    await expect(fenster).toContainText('Einspruchsfenster läuft');

    await fenster.locator('input[name="grund"]').fill('Der Bauherr hat den Termin verschoben');
    await page.locator('[data-cse="einspruch-erheben"]').click();

    await expect(page).toHaveURL(/vermerkt=einspruch/u);
    await expect(page.locator('[data-cse="fenster-vermerkt"]')).toContainText('Einspruch vermerkt');
    await expect(page.locator('[data-cse="freigabe-status"]'))
      .toHaveAttribute('data-status', 'widerrufen');
    await expect(page.locator('[data-cse="einspruch-fenster"]')).toHaveCount(0);

    /* Und danach steht kein Fenster mehr offen. */
    await page.goto('/portal/bau/freigaben/laufend');
    await expect(page.locator('[data-cse="laufend-leer"]')).toBeVisible();
  });

  /**
   * Die beiden Nachbarseiten laufen NACH dem Test oben — sie lesen, was er
   * entschieden hat. Eine eigene Gesellschaft hätte hier nichts zu zeigen.
   */
  test('die Geschichte zeigt das Kettenglied, die Prüfdauer keinen Namen', async ({ page }) => {
    await anmelden(page, KONTO.adminBau);

    await page.goto('/portal/bau/freigaben/erledigt');
    await expect(page.getByRole('heading', { name: 'Entschieden', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="erledigt-kettenglied"]:visible').first())
      .toContainText(/Nr\. \d+/u);
    await expect(page.locator('[data-cse="erledigt-status"]:visible').first())
      .toHaveAttribute('data-status', 'widerrufen');

    await page.goto('/portal/bau/freigaben/pruefdauer');
    await expect(page.getByRole('heading', { name: 'Prüfdauer', level: 1 })).toBeVisible();
    // Der ehrliche Satz: die personenbezogene Auswertung fehlt mit Absicht.
    await expect(page.locator('[data-cse="pruefdauer-o06"]')).toContainText('O-06');
    const gesamt = page.locator('[data-cse="pruefdauer-gesamt"]');
    expect(Number(await gesamt.getAttribute('data-anzahl'))).toBeGreaterThanOrEqual(1);
    // Die Stapelzeile ist schnell entschieden — und als Stapel ausgewiesen.
    await expect(page.locator('[data-cse="pruefdauer-eimer"][data-eimer="unter_3s"]:visible'))
      .toHaveCount(1);
    await expect(page.locator('[data-cse="pruefdauer-stapel"]:visible').first())
      .toContainText(/[1-9]/u);
  });
});
