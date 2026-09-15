/**
 * Der Kalender im Browser (CAL-01, CAL-02, CAL-03).
 *
 * Die Rechte- und Quellenfragen stehen in `tests/isolation/kalender.test.ts`,
 * die Fensterarithmetik und der iCal-Text in `tests/kern/`. Hier steht, was
 * ein Mensch sieht und anfassen kann:
 *
 *  · das Monatsgitter zeichnet, und heute ist markiert;
 *  · Zeitraum, Ansicht und Filter sind Links — der Kalender ist teilbar;
 *  · ein Eintrag führt zu seinem Vorgang;
 *  · der iCal-Zugang lässt sich anlegen, wirklich abrufen und widerrufen,
 *    und der widerrufene gibt danach nichts mehr heraus.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('Kalender', () => {
  test('das Monatsgitter zeichnet, und heute ist markiert', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/kalender`);

    const zellen = page.locator('[data-cse="kalender-zelle"]');
    // Volle Wochen, zwischen vier und sechs.
    const anzahl = await zellen.count();
    expect(anzahl % 7, 'volle Wochen').toBe(0);
    expect(anzahl).toBeGreaterThanOrEqual(28);
    expect(anzahl).toBeLessThanOrEqual(42);

    // Genau EIN Heute — zwei wären zwei Monate im selben Gitter.
    await expect(page.locator('[data-cse="kalender-zelle"][data-heute="ja"]')).toHaveCount(1);
  });

  test('der Seed hat Termine gelegt, und sie stehen im Kalender', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/kalender`);
    await expect(page.locator('[data-cse="kalender-eintrag"]').first()).toBeVisible();
  });

  /**
   * **Alles steht in der Adresse.** Ein Kalender ist etwas, das man verschickt
   * („sieh dir den 30. an"); ein Zustand im Kopf der Seite wäre nicht teilbar,
   * und der Zurück-Knopf täte das Falsche.
   */
  test('Zeitraum, Ansicht und Filter sind Links', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/kalender`);
    const titel = await page.locator('h1').innerText();

    await page.locator('[data-cse="kalender-vor"]').click();
    await expect(page).toHaveURL(/tag=\d{4}-\d{2}-\d{2}/u);
    await expect(page.locator('h1'), 'ein anderer Monat').not.toHaveText(titel);

    await page.locator('[data-cse="kalender-heute"]').click();
    await expect(page.locator('h1')).toHaveText(titel);

    await page.locator('[data-cse="ansicht-woche"]').click();
    await expect(page).toHaveURL(/ansicht=woche/u);
    await expect(page.locator('[data-cse="ansicht-woche"]'))
      .toHaveAttribute('aria-current', 'page');
    // In der Wochenansicht gibt es kein Monatsgitter.
    await expect(page.locator('[data-cse="kalender-zelle"]')).toHaveCount(0);

    await page.locator('[data-cse="ansicht-tag"]').click();
    await expect(page).toHaveURL(/ansicht=tag/u);
  });

  test('ein Filter grenzt die Herkunft ein und bleibt in der Adresse', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/kalender?ansicht=monat`);

    await page.locator('[data-cse="filter-termin"]').click();
    await expect(page).toHaveURL(/quellen=termin/u);
    await expect(page.locator('[data-cse="filter-termin"]'))
      .toHaveAttribute('aria-current', 'page');

    const eintraege = page.locator('[data-cse="kalender-eintrag"]');
    const wieviele = await eintraege.count();
    for (let i = 0; i < wieviele; i += 1) {
      await expect(eintraege.nth(i)).toHaveAttribute('data-quelle', 'termin');
    }
  });

  test('ein Termin führt zu seiner Seite', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/kalender?quellen=termin`);
    await page.locator('[data-cse="kalender-eintrag"]').first().click();
    await expect(page).toHaveURL(/\/kalender\/[0-9a-f-]{36}/u);
    await expect(page.locator('[data-cse="termin-titel"]')).toBeVisible();
    await expect(page.locator('[data-cse="termin-zeit"]')).toBeVisible();
  });

  /**
   * **Nicht gefunden und nicht sichtbar sind dasselbe** (AUT-06) — und eine
   * Kennung, die gar keine UUID ist, ist auch kein Datenbankfehler.
   */
  test('ein fremder oder erfundener Termin ist eine Auskunft, kein Fehler', async ({ page }) => {
    await anmelden(page);
    for (const id of ['00000000-0000-0000-0000-000000000000', 'gibt-es-nicht']) {
      await page.goto(`/portal/${MANDANT}/kalender/${id}`);
      await expect(page.locator('[data-cse="termin-fehlt"]'), id).toBeVisible();
    }
  });

  test('keine Verstösse nach WCAG 2.1 AA auf dem Kalender', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/kalender`);
    await expect(page.locator('[data-cse="kalender-zelle"]').first()).toBeVisible();
    const befund = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(befund.violations).toEqual([]);
  });
});

test.describe('Der iCal-Zugang (CAL-03)', () => {
  /**
   * **Der ganze Weg in einem Test**, weil er nur als Ganzes etwas bedeutet:
   * anlegen → die Adresse EINMAL sehen → wirklich abrufen → widerrufen → und
   * danach bekommt dieselbe Adresse nichts mehr.
   */
  test('anlegen, abrufen, widerrufen — und danach ist er zu', async ({ page }) => {
    await anmelden(page);
    await page.goto('/portal/konto/kalender-feed');

    await page.locator('[data-cse="feed-anlegen"]').click();
    const adresse = page.locator('[data-cse="feed-adresse"]');
    await expect(adresse, 'die Adresse steht genau einmal da').toBeVisible();
    const pfad = (await adresse.innerText()).trim();
    expect(pfad).toMatch(/^\/api\/kalender\/[A-Za-z0-9_-]+$/u);

    // Wirklich abrufen — ein Feed, der 200 antwortet und leer ist, sieht gleich aus.
    const antwort = await page.request.get(pfad);
    expect(antwort.status(), await antwort.text()).toBe(200);
    expect(antwort.headers()['content-type']).toContain('text/calendar');
    const ics = await antwort.text();
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('\r\n');

    // Neu geladen ist die Adresse weg: gespeichert ist nur ihre Prüfsumme.
    await page.goto('/portal/konto/kalender-feed');
    await expect(page.locator('[data-cse="feed-adresse"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="feed-name"]').first()).toBeVisible();

    await page.locator('[data-cse="feed-widerrufen"]').first().click();
    await expect(page, 'der Widerruf leitet zurück').toHaveURL(/widerrufen=1/u);
    await expect(page.locator('[data-cse="feed-widerrufen-bestaetigt"]')).toBeVisible();

    /*
     * **Und die Liste stimmt beim nächsten Aufruf** — hier steht ein `goto`
     * und nicht die Prüfung direkt auf der Umleitungsseite, und das ist ein
     * bekannter Befund und keine Bequemlichkeit (O-510):
     *
     * Die Seite, die die 303 ausliefert, zeigt die gerade widerrufene Zeile
     * noch. Die Datenbank ist zu diesem Zeitpunkt richtig (`widerrufen_am`
     * gesetzt, der Feed antwortet unten mit 404), und ein normaler Aufruf
     * derselben Adresse zeigt die Liste richtig. Weder `revalidatePath` noch
     * `cache-control: no-store` auf der Umleitung ändern es.
     *
     * Deshalb steht auf der Umleitungsseite jetzt ein ausdrücklicher Satz,
     * der sagt, dass der Zugang widerrufen IST — die Zeile daneben ist dann
     * kein Widerspruch, sondern eine veraltete Liste mit einer Ansage
     * darüber. Der Befund bleibt offen; was er kostet, ist eine Zeile zu
     * viel, nicht ein Zugang zu viel.
     */
    await page.goto('/portal/konto/kalender-feed');
    await expect(page.locator('[data-cse="feed-widerrufen"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="feed-leer"]')).toBeVisible();


    // Und der Widerruf wirkt sofort — nicht beim nächsten Abgleich.
    const danach = await page.request.get(pfad);
    expect(danach.status(), 'widerrufen heisst widerrufen').toBe(404);
  });

  test('ein erfundener Token ist 404 und nicht 401', async ({ page }) => {
    await anmelden(page);
    const antwort = await page.request.get('/api/kalender/gibtesnichtgibtesnichtgibtesnicht');
    // 401 lüde zum zweiten Versuch ein; 404 sagt dasselbe wie für jede Adresse.
    expect(antwort.status()).toBe(404);
  });
});
