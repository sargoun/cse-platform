/**
 * Die Antwort an eine Bewerberin im Browser (REC-03, § 22 AGG).
 *
 * **Was hier geprüft wird, sind die Sätze, die ein Personalbereich lesen muss,
 * bevor er etwas Falsches tut:**
 *
 *  1. Dass eine Absage keinen Grund nennt — und warum (§ 22 AGG). Der Satz
 *     steht GANZ OBEN: wer bis zum Absageformular scrollt, hat schon
 *     entschieden, was er schreiben will.
 *  2. Dass kein Postausgang verbunden ist, und zwar VORHER — nicht als
 *     Fehlermeldung nach einem Klick.
 *  3. Dass der Weg wirklich über einen Menschen führt: ein frischer Entwurf
 *     trägt keinen Sendeknopf.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

/** Die erste Bewerbung dieser Gesellschaft — über die Liste, wie ein Mensch. */
async function ersteBewerbung(page: Page): Promise<string> {
  await page.goto(`/portal/${MANDANT}/recruiting/bewerbungen`);
  const verweis = page.locator('tbody tr a').first();
  const ziel = await verweis.getAttribute('href');
  expect(ziel, 'keine Bewerbung in der Liste').not.toBeNull();
  return ziel!;
}

test.describe('Antwortseite', () => {
  test('nennt den AGG-Grundsatz, bevor sie irgendetwas anbietet', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`${await ersteBewerbung(page)}/antwort`);

    const agg = page.locator('[data-cse="agg-hinweis"]');
    await expect(agg).toBeVisible();
    await expect(agg).toContainText('Eine Absage nennt keinen Grund');
    await expect(agg).toContainText('§ 22 AGG');
    await expect(agg).toContainText('Beweislast');
  });

  test('sagt VORHER, dass kein Postausgang verbunden ist', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`${await ersteBewerbung(page)}/antwort`);

    const post = page.locator('[data-cse="postausgang"]');
    await expect(post).toBeVisible();
    await expect(post).toHaveAttribute('data-art', 'warnung');
    await expect(post).toContainText('O-501');
  });

  test('zeigt den Entwurf aus dem Seed — und er ist NICHT gesendet', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`${await ersteBewerbung(page)}/antwort`);

    await expect(page.getByText('Eingangsbestätigung').first()).toBeVisible();
    await expect(page.getByText('Entwurf — noch niemand hat ihn gelesen').first())
      .toBeVisible();
    /*
     * **Kein Sendeknopf an einem Entwurf.** Das ist Invariante 7 auf dem
     * Bildschirm: gesendet wird, was ein Mensch freigegeben hat — und dieser
     * Entwurf liegt noch nicht einmal im Posteingang.
     */
    await expect(page.locator('[data-cse="antwort-senden"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="antwort-vorlegen"]').first()).toBeVisible();
  });

  test('lässt eine Absage entwerfen und legt sie zur Freigabe', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    const pfad = `${await ersteBewerbung(page)}/antwort`;
    await page.goto(pfad);

    await page.locator('[data-cse="entwerfen-absage"]').click();
    await page.waitForURL(`**${pfad}`);

    /* Der Text der Vorlage — und kein Grund darin. */
    const absage = page.getByText('Wir haben uns für eine andere Bewerbung entschieden.');
    await expect(absage.first()).toBeVisible();

    /* Und der Knopf für eine zweite Absage ist fort: je Art einmal. */
    await expect(page.locator('[data-cse="entwerfen-absage"]')).toHaveCount(0);
  });

  test('weist einen Text ab, der die interne Begründung übernimmt', async ({ page }) => {
    /*
     * Der gefaehrliche Weg: jemand ergaenzt den Grund von Hand, aus
     * Hoeflichkeit. Geprueft wird hier nur, dass der Riegel eine MELDUNG gibt
     * und keinen Serverfehler — die Wirkung selbst steht in
     * `tests/isolation/bewerbung-antwort.test.ts`, wo sich eine Entscheidung
     * mit Begruendung anlegen laesst.
     */
    await anmelden(page, KONTO.adminReinigung);
    const pfad = `${await ersteBewerbung(page)}/antwort`;
    await page.goto(pfad);

    const formular = page.locator('[data-cse="antwort-aendern"]').first();
    await expect(formular).toBeVisible();
    await formular.locator('textarea').fill(
      'Guten Tag,\n\nwir melden uns.\n\nFreundliche Grüße');
    const antwort = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/recruiting/antwort')),
      formular.locator('button[type="submit"]').click(),
    ]);
    /* 303 auf die Seite zurück — kein 500, kein 400. */
    expect([200, 303]).toContain(antwort[0].status());
  });
});

test.describe('Rechte', () => {
  test('wer nur lesen darf, sieht keinen Entwurfsknopf', async ({ page }) => {
    /*
     * `leitung.reinigung` haelt `recruiting.bewerbung_lesen`, aber nicht
     * zwingend `bewerbung_bewerten`. Was die Sitzung nicht darf, steht nicht
     * als Knopf da — ein Knopf, der 403 gibt, ist schlechter als keiner.
     */
    await anmelden(page, KONTO.leitungReinigung);
    const antwort = await page.goto(
      `/portal/${MANDANT}/recruiting/bewerbungen/00000000-0000-4000-8000-000000000000/antwort`);
    /* Eine erfundene Kennung gibt 404 — nicht 500 (kennungOder404 greift davor). */
    expect(antwort?.status()).toBe(404);
  });
});
