/**
 * PR 63 im Browser — die E-Rechnung vom Posteingang bis zur Eingangsrechnung
 * (ACC-05, APR-01 … APR-03).
 *
 * Was der Extraktor liest und was der Dienst daraus macht, steht in
 * `tests/kern/erechnung.test.ts` und `tests/isolation/eingang-vorschlag.test.ts`.
 * Hier steht, was eine Buchhaltung sieht und tut:
 *
 *  1. Der Vorschlag nennt jede Zahl mit dem Element der Datei, aus dem sie
 *     stammt; der Lieferant ist über den Stamm zugeordnet; der Freigabeknopf
 *     ist frei.
 *  2. Freigeben ÜBERNIMMT: die Eingangsrechnung entsteht in derselben
 *     Transaktion, und sie nennt ihre Herkunft Feld für Feld.
 *  3. Die Erfassungsmaske hat den E-Rechnungs-Weg — und aus einem Vorschlag
 *     kommt sie vorbelegt (`?von=`).
 *  4. Ohne verbundenen Belegspeicher legt Einlesen NICHTS ab — und sagt es.
 *  5. Ein Lieferant, der nicht im Stamm ist, sperrt die Freigabe sichtbar;
 *     der Weg von Hand bleibt offen.
 *
 * Die Vorschläge baut `hilfen/erechnung-vorrichtung.ts` durch die echten
 * Dienste — siehe dort, warum in einem eigenen Prozess und mit dem
 * Testspeicher.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import postgres from 'postgres';
import { alsKonto, KONTO } from './hilfen/anmeldung';
import type { ERechnungBeispiel } from '../../src/server/db/seed/eingang';

const MANDANT = 'reinigung';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';
const sql = postgres(DSN, { max: 2, onnotice: () => {} });

interface Vorrichtung {
  readonly status: string;
  readonly freigabeId: string | null;
  readonly unsichereFelder: number;
  readonly xml: string;
}

function vorrichtung(teil: Partial<ERechnungBeispiel> & { nurXml?: boolean }): Vorrichtung {
  const aus = execFileSync('node_modules/.bin/tsx', [
    '--import', './scripts/hooks/server-only.mjs',
    'tests/e2e/hilfen/erechnung-vorrichtung.ts', JSON.stringify(teil),
  ], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: DSN } });
  const zeile = aus.trim().split('\n').pop() ?? '{}';
  return JSON.parse(zeile) as Vorrichtung;
}

const STEMPEL = Date.now().toString(36).toUpperCase();
let lesen: Vorrichtung;
let freigeben: Vorrichtung;
let fremd: Vorrichtung;

test.beforeAll(() => {
  lesen = vorrichtung({ rechnungsnummer: `HN-${STEMPEL}-A` });
  freigeben = vorrichtung({ rechnungsnummer: `HN-${STEMPEL}-B` });
  fremd = vorrichtung({ rechnungsnummer: `HN-${STEMPEL}-C`, lieferantName: 'Fremde Lieferantin GmbH' });
  for (const v of [lesen, freigeben, fremd]) {
    expect(v.status, 'die Vorrichtung hat keinen Vorschlag angelegt').toBe('angelegt');
    expect(v.freigabeId).not.toBeNull();
  }
});

test.afterAll(async () => { await sql.end(); });

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, KONTO.adminReinigung);
}

test.describe('E-Rechnung → Vorschlag → Freigabe → Eingangsrechnung (PR 63)', () => {
  test('der Vorschlag nennt Zahl, Element und Lieferant — und der Knopf ist frei', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/freigaben/${lesen.freigabeId ?? ''}`);

    await expect(page.locator('[data-cse="freigabe-kopfzeile"]'))
      // `formatiereGeld` setzt ein geschütztes Leerzeichen vor das Eurozeichen.
      .toContainText(/E-Rechnung \(UBL\) von Hygiene Nord Handels GmbH: Netto 1\.250,00\s€ \+ USt 237,50\s€ = 1\.487,50\s€/u);
    await expect(page.locator('[data-cse="freigabe-risiko"]')).toBeVisible();
    await expect(page.locator('[data-cse="erechnung-wege"]')).toBeVisible();

    // Die Nachweise: Feldpfad, Element der Datei, Zitat — sichtbar, nicht nur im DOM.
    const tabelle = page.getByRole('table', { name: 'Extrahierte Felder mit Quelle und Konfidenz' });
    await expect(tabelle).toContainText('/nettoCent');
    await expect(tabelle).toContainText('Tabelle xml · Invoice/LegalMonetaryTotal/TaxExclusiveAmount');
    await expect(tabelle).toContainText('1250.00');
    await expect(tabelle).toContainText('Hygiene Nord Handels GmbH (über Name)');

    await expect(page.locator('[data-cse="feld-unsicher"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-cse="freigeben-gesperrt"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="freigeben"]')).toBeEnabled();
  });

  test('freigeben übernimmt — die Eingangsrechnung nennt ihre Herkunft', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/freigaben/${freigeben.freigabeId ?? ''}`);
    await page.locator('#begruendung').fill('Lieferung geprüft, Beträge stimmen mit dem Lieferschein.');
    await page.locator('[data-cse="freigeben"]').click();

    await expect(page).toHaveURL(/entschieden=genehmigt/u);
    await expect(page).toHaveURL(/ausgefuehrt=eingangsrechnung/u);
    await expect(page.locator('[data-cse="freigabe-status"]')).toHaveAttribute('data-status', 'genehmigt');
    const vermerkt = page.locator('[data-cse="entscheidung-vermerkt"]');
    await expect(vermerkt).toContainText('Kettenglied');
    await expect(vermerkt).toContainText('Die Eingangsrechnung ist angelegt');

    await vermerkt.locator('[data-cse="zur-eingangsrechnung"]').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: new RegExp(`HN-${STEMPEL}-B`, 'u') })).toBeVisible();
    await expect(page.getByText('1.487,50').first()).toBeVisible();

    const herkunft = page.locator('[data-cse="herkunft-erechnung"]');
    await expect(herkunft).toBeVisible();
    await expect(herkunft).toContainText('Aus einer E-Rechnung übernommen');
    await expect(herkunft).toContainText('Invoice/LegalMonetaryTotal/TaxExclusiveAmount');
    await expect(herkunft).toContainText('Invoice/ID');
    // Der nächste Schritt ist der erste des Kreditorenwegs — nichts wurde übersprungen.
    await expect(page.getByRole('button', { name: 'In Prüfung geben' })).toBeVisible();

    // Und in der Datenbank: Kopf, Steuerzeile, Bezug — alles aus derselben Entscheidung.
    const [z] = await sql.unsafe<{ netto: string; steuer: string; brutto: string; gruppe: string; status: string }[]>(
      `select er.netto_cent::text as netto, er.steuer_cent::text as steuer, er.brutto_cent::text as brutto,
              g.schluessel as gruppe, f.ausfuehrung_status::text as status
         from freigabe f
         join eingangsrechnung er on er.id = f.bezug_id
         join eingangsrechnung_steuer st on st.eingangsrechnung_id = er.id
         join steuersatz_gruppe g on g.id = st.steuersatz_gruppe_id
        where f.id = $1 and f.bezug_typ = 'eingangsrechnung'`,
      [freigeben.freigabeId]);
    expect(z).toEqual({ netto: '125000', steuer: '23750', brutto: '148750', gruppe: 'ust_19', status: 'ausgefuehrt' });

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });

  test('die Maske hat den E-Rechnungs-Weg — und kommt aus einem Vorschlag vorbelegt', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/eingangsrechnungen/neu`);
    await expect(page.locator('[data-cse="erechnung-formular"]')).toBeVisible();
    await expect(page.locator('[data-cse="erechnung-einlesen"]')).toBeEnabled();
    await expect(page.locator('[data-cse="vorbelegung-hinweis"]')).toHaveCount(0);

    await page.goto(`/portal/${MANDANT}/finanzen/eingangsrechnungen/neu?von=${lesen.freigabeId ?? ''}`);
    await expect(page.locator('[data-cse="vorbelegung-hinweis"]')).toBeVisible();
    await expect(page.locator('#rechnungsnummer')).toHaveValue(`HN-${STEMPEL}-A`);
    await expect(page.locator('#rechnungsdatum')).toHaveValue('2026-08-28');
    await expect(page.locator('#faelligAm')).toHaveValue('2026-09-27');
    await expect(page.locator('#netto')).toHaveValue('1250,00');
    await expect(page.locator('#steuer')).toHaveValue('237,50');
    await expect(page.locator('#steuergruppe')).toHaveValue('ust_19');
    // Der Lieferant ist gewählt — der aus dem Stamm, über den Namen.
    await expect(page.locator('#lieferantId option:checked')).toHaveText(/Hygiene Nord Handels GmbH/u);
  });

  /**
   * **Die Prüfung gegen die erfundene Integration.** Im Browserlauf ist kein
   * Objektspeicher verbunden. Einlesen liest die Datei, aber legt sie nicht
   * ab — und dann darf auch kein Vorschlag entstehen, denn er zeigte auf
   * einen Beleg, den es nicht gibt (ACC-03).
   */
  test('ohne verbundenen Belegspeicher legt Einlesen NICHTS ab — und sagt es', async ({ page }) => {
    const datei = vorrichtung({ rechnungsnummer: `HN-${STEMPEL}-D`, nurXml: true });
    const bytes = Buffer.from(datei.xml, 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/eingangsrechnungen/neu`);
    await page.getByLabel('Datei (XML oder PDF)').setInputFiles({
      name: `HN-${STEMPEL}-D.xml`, mimeType: 'application/xml', buffer: bytes,
    });
    await page.locator('[data-cse="erechnung-einlesen"]').click();
    await page.waitForLoadState('domcontentloaded');

    const hinweis = page.locator('[data-cse="eingang-hinweis"]');
    await expect(hinweis).toContainText('nicht verbunden');
    await expect(hinweis).toContainText('NICHTS gespeichert');

    const [n] = await sql.unsafe<{ freigaben: string; dokumente: string }[]>(
      `select (select count(*) from freigabe where externe_ref = $1)::text as freigaben,
              (select count(*) from dokument where titel = $2)::text as dokumente`,
      [`erechnung:${sha256}`, `E-Rechnung HN-${STEMPEL}-D`]);
    expect(n).toEqual({ freigaben: '0', dokumente: '0' });
  });

  test('ein Lieferant, der nicht im Stamm ist, sperrt die Freigabe — der Weg von Hand bleibt', async ({ page }) => {
    expect(fremd.unsichereFelder).toBeGreaterThanOrEqual(1);
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/freigaben/${fremd.freigabeId ?? ''}`);

    const unsicher = page.locator('[data-cse="feld-unsicher"]:visible');
    await expect(unsicher.first()).toBeVisible();
    await expect(page.locator('[data-cse="freigeben-gesperrt"]')).toBeVisible();
    await expect(page.locator('[data-cse="freigeben"]')).toBeDisabled();
    await expect(page.locator('[data-cse="erechnung-wege"]')).toContainText('von Hand');

    await page.locator('[data-cse="manuell-erfassen"]').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(new RegExp(`von=${fremd.freigabeId ?? ''}`, 'u'));
    await expect(page.locator('[data-cse="vorbelegung-hinweis"]')).toBeVisible();
    await expect(page.locator('#netto')).toHaveValue('1250,00');
    // Kein Lieferant vorgewählt: die Zuordnung war unsicher, und die Maske behauptet keine.
    await expect(page.locator('#lieferantId')).toHaveValue('');
  });
});
