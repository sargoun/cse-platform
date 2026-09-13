/**
 * PR 54.3 im Browser — die Eingangsrechnung von der Erfassung bis zur Buchung
 * (FIN-14, ACC-03, ACC-05).
 *
 * Die Auslöser, Rechte und Mandantengrenzen stehen in
 * `tests/isolation/eingangsrechnung.test.ts`; hier steht, was ein Mensch am
 * Bildschirm tut — und die eine Sache, die er NICHT tun kann:
 *
 *  1. Ohne Beleg entsteht keine Rechnung, und die Maske sagt es.
 *  2. Ist der Belegspeicher nicht verbunden, wird NICHTS gespeichert — und
 *     auch das sagt sie. Keine erfundene Integration, kein halber Vorgang.
 *  3. Der Weg eingegangen → in Prüfung → freigegeben → gebucht ist genau
 *     einer, und die Seite bietet immer nur den nächsten Schritt an.
 *  4. Nach dem Buchen trägt der Beleg seine interne Nummer, und die
 *     Verbindlichkeit gegenüber dem Lieferanten steht offen.
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
 * **Der Beleg ist eine VORRICHTUNG dieser Datei — und das ist der ehrliche Weg.**
 *
 * Ein Beleg zeigt auf eine Dokumentversion samt SHA-256 (ACC-03). Im
 * Browserlauf ist kein Objektspeicher verbunden, also gibt es keinen Weg,
 * eine Datei wirklich abzulegen — die Route sagt das auch, und Prüfung (2)
 * unten hält genau darauf. Damit der WEG danach trotzdem prüfbar bleibt, legt
 * `beforeAll` einen Beleg direkt in der Testdatenbank an, so wie
 * `rechnung.spec.ts` sich den Nummernkreis anlegt.
 *
 * Was hier NICHT passiert: der Speicher wird nicht vorgetäuscht. Der
 * Hochladeweg bleibt ungeprüft und sagt das; der Erfassungs-, Prüf-, Freigabe-
 * und Buchungsweg wird geprüft.
 */
let belegId = '';

test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `select id from mandant where slug = $1`, [MANDANT]);
  const mandantId = m!.id;

  // Ein Kreis `eingangsrechnung_beleg` — der Seed legt ihn an; falls diese
  // Datenbank älter ist, kommt er hier dazu.
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     select $1, 'eingangsrechnung_beleg', null, 2026, 'Eingangsbelege', true,
            'EB-{jahr}-{nr:5}', 'jaehrlich', '2026-01-01', false, 'system', 'job:test'
      where not exists (select 1 from nummernkreis
                         where mandant_id = $1 and kreis_typ = 'eingangsrechnung_beleg')`,
    [mandantId]);

  const dokumentId = crypto.randomUUID();
  await sql.unsafe(
    `insert into dokument (id, mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                           groesse_bytes, bucket, objekt_schluessel, exif_entfernt,
                           loeschsperre)
     values ($1, $2, 'buchhaltung', 'Lieferantenrechnung (Prüfvorrichtung)',
             'application/pdf', true, 2048, 'dokumente', $3, true, true)`,
    [dokumentId, mandantId, `${mandantId}/buchhaltung/${dokumentId}`]);
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                   sha256, groesse_bytes, mime_typ)
     values ($1, $2, 1, $3, $4, 2048, 'application/pdf') returning id`,
    [mandantId, dokumentId, `${mandantId}/buchhaltung/${dokumentId}`, 'b'.repeat(64)]);
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                        dokument_version_id, datei_sha256, belegdatum,
                        erstellt_von_art, erstellt_von_dienst)
     values ($1, $5, 'eingangsrechnung', 'scan', $2, $3, $4, '2026-08-31',
             'system', 'job:test')
     returning id`,
    /* Die Belegnummer ist je Gesellschaft eindeutig; ein fester Wert liesse
       den zweiten Lauf an seiner eigenen Vorrichtung scheitern. */
    [mandantId, dokumentId, v!.id, 'b'.repeat(64), `PRUEF-${Date.now()}`]);
  belegId = b!.id;
});

test.afterAll(async () => { await sql.end(); });

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('Eingangsrechnungen (FIN-14)', () => {
  test('ohne Beleg entsteht keine Rechnung — und die Maske sagt es', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/eingangsrechnungen/neu`);

    await page.getByLabel('Lieferant', { exact: true }).selectOption({ index: 0 });
    await page.getByLabel('Rechnungsnummer des Lieferanten').fill(`OHNE-${Date.now()}`);
    await page.getByLabel('Rechnungsdatum').fill('2026-08-31');
    await page.getByLabel('Netto in Euro').fill('1000,00');
    await page.getByLabel('Umsatzsteuer in Euro').fill('190,00');
    await page.getByRole('button', { name: 'Erfassen' }).click();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('[data-cse="eingang-hinweis"]')).toContainText('Ohne Dokument');
  });

  /**
   * **Die Prüfung, die eine erfundene Integration verhindern soll.**
   *
   * Im Browserlauf ist kein Objektspeicher konfiguriert. Ein Programm, das
   * dann trotzdem eine Zeile anlegt, hat eine Eingangsrechnung ohne Beleg in
   * den Büchern — nach ACC-03 kein Beleg, sondern eine Behauptung. Die Route
   * muss also sagen, dass NICHTS gespeichert wurde, und das auch einhalten.
   */
  test('ohne verbundenen Belegspeicher wird nichts gespeichert — und es steht da',
    async ({ page }) => {
      const nummer = `UPLOAD-${Date.now()}`;
      await anmelden(page);
      await page.goto(`/portal/${MANDANT}/finanzen/eingangsrechnungen/neu`);

      await page.getByLabel('PDF hochladen').setInputFiles({
        name: 'rechnung.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n'),
      });
      await page.getByLabel('Lieferant', { exact: true }).selectOption({ index: 0 });
      await page.getByLabel('Rechnungsnummer des Lieferanten').fill(nummer);
      await page.getByLabel('Rechnungsdatum').fill('2026-08-31');
      await page.getByLabel('Netto in Euro').fill('1000,00');
      await page.getByLabel('Umsatzsteuer in Euro').fill('190,00');
      await page.getByRole('button', { name: 'Erfassen' }).click();
      await page.waitForLoadState('domcontentloaded');

      const hinweis = page.locator('[data-cse="eingang-hinweis"]');
      await expect(hinweis).toContainText('nicht verbunden');
      await expect(hinweis).toContainText('NICHTS gespeichert');

      const zeilen = await sql.unsafe<{ id: string }[]>(
        `select id from eingangsrechnung where rechnungsnummer_lieferant = $1`, [nummer]);
      expect(zeilen, 'es wurde doch eine Zeile angelegt').toHaveLength(0);
    });

  test('der Weg: erfassen → prüfen → freigeben → buchen, und die Nummer am Ende',
    async ({ page }) => {
      const nummer = `WEG-${Date.now()}`;
      await anmelden(page);
      await page.goto(`/portal/${MANDANT}/finanzen/eingangsrechnungen/neu`);

      await page.getByLabel('… oder einen bereits abgelegten Beleg wählen')
        .selectOption(belegId);
      await page.getByLabel('Lieferant', { exact: true }).selectOption({ index: 0 });
      await page.getByLabel('Rechnungsnummer des Lieferanten').fill(nummer);
      await page.getByLabel('Rechnungsdatum').fill('2026-08-31');
      await page.getByLabel('Leistungsdatum').fill('2026-08-20');
      await page.getByLabel('Fällig am').fill('2026-09-30');
      await page.getByLabel('Netto in Euro').fill('1000,00');
      await page.getByLabel('Umsatzsteuer in Euro').fill('190,00');
      await page.getByRole('button', { name: 'Erfassen' }).click();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('heading', { name: new RegExp(nummer, 'u') })).toBeVisible();
      await expect(page.getByText('entsteht beim Buchen')).toBeVisible();

      await page.getByRole('button', { name: 'In Prüfung geben' }).click();
      await page.waitForLoadState('domcontentloaded');

      await page.getByLabel('Grund der Freigabe').fill('Sachlich und rechnerisch geprüft');
      await page.getByRole('button', { name: 'Freigeben' }).click();
      await page.waitForLoadState('domcontentloaded');

      await page.getByRole('button', { name: 'Buchen' }).click();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('[data-cse="belegnummer"]')).toHaveText(/^EB-2026-\d{5}$/u);
      // Und die Verbindlichkeit steht offen — 1.190,00 €.
      await expect(page.getByText('1.190,00').first()).toBeVisible();
    });

  test('axe findet auf der Erfassungsmaske nichts', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/eingangsrechnungen/neu`);
    await expect(page.getByRole('heading', { name: 'Eingangsrechnung erfassen', level: 1 }))
      .toBeVisible();

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });
});
