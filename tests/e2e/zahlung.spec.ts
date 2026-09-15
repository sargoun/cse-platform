/**
 * PR 54.1 im Browser — die Forderung, die Teilzahlung und die Überzahlung
 * (FIN-14, ACC-07).
 *
 * Die Auslöser und die Rechte stehen in `tests/isolation/zahlung.test.ts`;
 * hier steht, was ein Mensch am Bildschirm sieht. Drei Aussagen, und jede
 * davon ist eine, die eine Buchhaltung sonst erst am Kontoauszug bemerkt:
 *
 *  1. Nach dem Festschreiben steht die Rechnung als offene Forderung da —
 *     mit dem Betrag und der Fälligkeit vom Beleg.
 *  2. Eine Teilzahlung lässt den Rest sichtbar offen, auf den Cent.
 *  3. Eine Überzahlung verschwindet NICHT. Sie erscheint als Guthaben des
 *     Kunden, und die Rechnung ist trotzdem ausgeglichen.
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

/**
 * **Dieselbe Vorrichtung wie in `rechnung.spec.ts`, aus demselben Grund.**
 *
 * Der Seed legt den Rechnungskreis als PLATZHALTER an (O-134), und
 * `fin.rechnung_nummer_ziehen` verweigert daraufhin jede Nummer. Ohne
 * festschreibbare Rechnung gibt es keinen offenen Posten, und diese Datei
 * prüfte nichts. Die Maske bleibt unangetastet: geprüft wird der WEG von der
 * Forderung zum Ausgleich, und der hängt nicht an ihr.
 *
 * // TODO(client, O-134): Laufen die Rechnungsnummern je Gesellschaft
 * fortlaufend weiter oder setzen sie jährlich zurück, und mit welcher Maske?
 */
test.beforeAll(async () => {
  await sql.unsafe(
    `update nummernkreis nk
        set ist_platzhalter = false,
            zuruecksetzung  = 'jaehrlich'::nummernkreis_zuruecksetzung
       from mandant m
      where m.id = nk.mandant_id
        and m.slug = $1
        and nk.kreis_typ = 'ausgangsrechnung'
        and nk.kontext_id is null
        and nk.geschlossen_am is null`,
    [MANDANT],
  );
});

test.afterAll(async () => { await sql.end(); });

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

/**
 * Ein festgeschriebener Beleg über 1.190,00 € brutto, und die Nummer, unter
 * der er in der Forderungsliste steht.
 *
 * Jede Prüfung schreibt ihren EIGENEN fest: zwei Prüfungen, die sich denselben
 * teilen, hängen an der Reihenfolge, in der Playwright sie ausführt.
 */
async function festgeschriebenerBeleg(page: Page): Promise<string> {
  await anmelden(page);
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
  const koerper = (await page.locator('body').innerText()).trim();
  expect(
    koerper.startsWith('{') ? koerper.slice(0, 400) : null,
    'Festschreiben abgewiesen — der Grund steht im JSON daneben',
  ).toBeNull();

  /*
   * **Der Kreis bestimmt das Praefix, nicht dieser Test.** Der Seed legt in
   * der Produktion einen Platzhalterkreis an (O-134) und auf der
   * Vorfuehrflaeche einen mit der Maske `DEMO-{jahr}-{nr:5}` (D-514). Ein
   * fest verdrahtetes `RE-` prueft damit die Seed-Einstellung und nicht die
   * Rechnung. Geprueft wird die FORM, die jede Maske erzeugt: ein Praefix,
   * das Jahr, die laufende Nummer.
   */
  const nummer = await page.getByText(/^[A-Z]+-\d{4}-\d{5}$/u).first().innerText();
  return nummer.trim();
}

/** Die Zeile der Forderungstabelle zu einer Rechnungsnummer. */
function forderung(page: Page, nummer: string) {
  return page.getByRole('row').filter({ hasText: nummer });
}

/**
 * Die Rechnung im Erfassungsformular auswählen.
 *
 * Über den WERT und nicht über das Label: das Label trägt Kunde und offenen
 * Betrag mit, und es ändert sich, sobald eine Teilzahlung darauf steht.
 * Ein Test, der an einem Betrag im Label hängt, fällt aus dem falschen Grund.
 */
async function waehleRechnung(page: Page, nummer: string): Promise<void> {
  const wert = await page.locator('#rechnungId option')
    .filter({ hasText: nummer }).first().getAttribute('value');
  expect(wert, `Rechnung ${nummer} steht nicht zur Auswahl`).toBeTruthy();
  await page.getByLabel('Rechnung').selectOption(wert!);
}

test.describe('Zahlungen (FIN-14)', () => {
  test('eine festgeschriebene Rechnung steht als offene Forderung da', async ({ page }) => {
    const nummer = await festgeschriebenerBeleg(page);
    await page.goto(`/portal/${MANDANT}/finanzen/zahlungen`);

    await expect(page.getByRole('heading', { name: 'Offene Forderungen' })).toBeVisible();
    const zeile = forderung(page, nummer);
    await expect(zeile).toBeVisible();
    await expect(zeile).toContainText('1.190,00');
  });

  test('eine Teilzahlung lässt den Rest offen — auf den Cent', async ({ page }) => {
    const nummer = await festgeschriebenerBeleg(page);
    await page.goto(`/portal/${MANDANT}/finanzen/zahlungen`);

    await waehleRechnung(page, nummer);
    await page.getByLabel('Betrag in Euro').fill('500,00');
    await page.getByLabel('Buchungstag').fill('2026-09-10');
    await page.getByLabel('Zahlungsmittel').selectOption('ueberweisung');
    await page.getByRole('button', { name: 'Zahlung erfassen' }).click();
    await page.waitForLoadState('domcontentloaded');

    const zeile = forderung(page, nummer);
    await expect(zeile).toContainText('690,00');
    await expect(page.getByRole('row').filter({ hasText: '10.09.2026' }).first())
      .toContainText('500,00');
  });

  /**
   * **Der Fall, den ein Buchhaltungssystem nie stillschweigend behandeln darf.**
   *
   * Kommen 1.500,00 € auf eine Rechnung über 1.190,00 €, gibt es drei
   * Möglichkeiten und zwei davon sind falsch: den Rest wegwerfen (der Kunde
   * bekommt sein Geld nie zurück) oder ihn auf die Rechnung buchen (der Posten
   * wäre „mehr als bezahlt"). Richtig ist: die Rechnung ist ausgeglichen und
   * 310,00 € stehen dem Kunden zu — sichtbar, auf demselben Bildschirm.
   */
  test('eine Überzahlung wird als Guthaben ausgewiesen, nicht geschluckt', async ({ page }) => {
    const nummer = await festgeschriebenerBeleg(page);
    await page.goto(`/portal/${MANDANT}/finanzen/zahlungen`);

    await waehleRechnung(page, nummer);
    await page.getByLabel('Betrag in Euro').fill('1.500,00');
    await page.getByLabel('Buchungstag').fill('2026-09-10');
    await page.getByLabel('Zahlungsmittel').selectOption('ueberweisung');
    await page.getByRole('button', { name: 'Zahlung erfassen' }).click();
    await page.waitForLoadState('domcontentloaded');

    // Die Forderung ist weg — sie ist ausgeglichen und steht nicht mehr offen.
    await expect(forderung(page, nummer)).toHaveCount(0);

    const guthaben = page.getByRole('heading', { name: 'Guthaben der Kunden' });
    await expect(guthaben).toBeVisible();
    await expect(page.locator('section').filter({ has: guthaben }))
      .toContainText('310,00');
  });

  test('der Zahlungsstorno öffnet die Forderung wieder', async ({ page }) => {
    const nummer = await festgeschriebenerBeleg(page);
    await page.goto(`/portal/${MANDANT}/finanzen/zahlungen`);

    await waehleRechnung(page, nummer);
    await page.getByLabel('Betrag in Euro').fill('1.190,00');
    await page.getByLabel('Buchungstag').fill('2026-09-10');
    await page.getByLabel('Zahlungsmittel').selectOption('lastschrift');
    await page.getByRole('button', { name: 'Zahlung erfassen' }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(forderung(page, nummer)).toHaveCount(0);

    // Über die Zahlungszeile in die Einzelansicht und dort stornieren.
    await page.getByRole('link', { name: '10.09.2026' }).first().click();
    await expect(page.getByRole('heading', { name: 'Wohin sie gebucht wurde' })).toBeVisible();
    await expect(page.getByRole('cell', { name: nummer })).toBeVisible();

    await page.getByLabel(/^Grund/u).fill('Lastschrift vom Kunden zurückgegeben');
    await page.getByRole('button', { name: 'Stornieren' }).click();
    await page.waitForLoadState('domcontentloaded');

    await expect(forderung(page, nummer)).toContainText('1.190,00');
  });

  test('axe findet auf dem Zahlungsbildschirm nichts', async ({ page }) => {
    await festgeschriebenerBeleg(page);
    await page.goto(`/portal/${MANDANT}/finanzen/zahlungen`);
    await expect(page.getByRole('heading', { name: 'Zahlungen', level: 1 })).toBeVisible();

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });
});
