/**
 * PR 56 im Browser — das Rechnungsausgangsbuch (FIN-16, FIN-06).
 *
 * Die Sicht und die Abstimmung stehen in
 * `tests/isolation/ausgangsbuch.test.ts`; hier steht der Bildschirm, den eine
 * Betriebsprüfung tatsächlich vorgelegt bekommt:
 *
 *  1. Die Abstimmung steht OBEN und sagt zuerst, ob das Buch stimmt.
 *  2. Jede Zeile führt zu ihrem Beleg — eine Zahl ohne Weg dorthin ist keine
 *     Prüfgrundlage (Abnahme 5).
 *  3. Entwürfe stehen nicht darin.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import postgres from 'postgres';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';
const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Dieselbe Vorrichtung wie in `rechnung.spec.ts` — der Seed lässt den Kreis
 *  als Platzhalter stehen (O-134), und ohne Nummer gibt es kein Buch. */
test.beforeAll(async () => {
  await sql.unsafe(
    `update nummernkreis nk
        set ist_platzhalter = false,
            zuruecksetzung  = 'jaehrlich'::nummernkreis_zuruecksetzung
       from mandant m
      where m.id = nk.mandant_id and m.slug = $1
        and nk.kreis_typ = 'ausgangsrechnung' and nk.kontext_id is null
        and nk.geschlossen_am is null`, [MANDANT]);
});

test.afterAll(async () => { await sql.end(); });

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

/** Ein festgeschriebener Beleg, und die Nummer, unter der er im Buch steht. */
async function belegFestschreiben(page: Page): Promise<string> {
  await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
  await page.getByLabel('Kunde').selectOption({ index: 0 });
  await page.getByLabel('Leistung von').fill('2026-08-01');
  await page.getByLabel('Leistung bis').fill('2026-08-31');
  await page.getByLabel('Zahlungsziel (Tage)').fill('30');
  await page.getByLabel('Zahlungsart').selectOption('58');
  await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

  await page.getByLabel('Handelsübliche Bezeichnung').fill('Unterhaltsreinigung');
  await page.getByLabel('Menge (Tausendstel)').fill('1000');
  await page.getByLabel('Einheit').selectOption('m2');
  await page.getByLabel('Einzelpreis (Cent)').fill('100000');
  await page.getByLabel('Begründung, falls von Hand erfasst')
    .fill('Einmalige Leistung ohne Auftragsbezug');
  await page.getByRole('button', { name: 'Position hinzufügen' }).click();
  await expect(page.getByText('Unterhaltsreinigung').first()).toBeVisible();

  await page.getByRole('button', { name: 'Rechnung festschreiben' }).click();
  await page.waitForLoadState('domcontentloaded');
  const nummer = await page.getByText(/^RE-\d{4}-\d{5}$/u).first().innerText();
  return nummer.trim();
}

test.describe('Rechnungsausgangsbuch (FIN-16)', () => {
  test('die Abstimmung steht oben und sagt, dass das Buch stimmt', async ({ page }) => {
    await anmelden(page);
    const nummer = await belegFestschreiben(page);
    await page.goto(`/portal/${MANDANT}/finanzen/ausgangsbuch`);

    const abstimmung = page.locator('[data-cse="ausgangsbuch-abstimmung"]');
    await expect(abstimmung).toBeVisible();
    await expect(abstimmung).toHaveAttribute('data-ok', 'true');
    await expect(abstimmung).toContainText('Buch und Belege stimmen überein');

    await expect(page.getByRole('row').filter({ hasText: nummer })).toBeVisible();
  });

  test('jede Zeile führt zu ihrem Beleg — eine Zahl ohne Weg dorthin prüft niemand',
    async ({ page }) => {
      await anmelden(page);
      const nummer = await belegFestschreiben(page);
      await page.goto(`/portal/${MANDANT}/finanzen/ausgangsbuch`);

      await page.getByRole('link', { name: nummer }).first().click();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText(nummer).first()).toBeVisible();
    });

  test('ein Entwurf steht nicht im Buch', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Kunde').selectOption({ index: 0 });
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await page.waitForLoadState('domcontentloaded');

    await page.goto(`/portal/${MANDANT}/finanzen/ausgangsbuch`);
    // Ein Entwurf hat keine Nummer; im Buch steht keine Zeile ohne eine.
    await expect(page.getByText('ohne — Entwurf')).toHaveCount(0);
  });

  test('axe findet auf dem Ausgangsbuch nichts', async ({ page }) => {
    await anmelden(page);
    await belegFestschreiben(page);
    await page.goto(`/portal/${MANDANT}/finanzen/ausgangsbuch`);
    await expect(page.getByRole('heading', { name: 'Rechnungsausgangsbuch', level: 1 }))
      .toBeVisible();

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });
});
