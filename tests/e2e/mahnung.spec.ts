/**
 * PR 55 im Browser — der Mahnbildschirm (FIN-15, SPEC §14).
 *
 * Die Datenbankseite steht in `tests/isolation/mahnung.test.ts`; hier steht,
 * was eine Buchhaltung tatsächlich sieht:
 *
 *  1. Ohne bestätigte Mahnstufe entsteht KEIN Vorschlag — und der Bildschirm
 *     sagt, warum (O-19). Ein leerer Bildschirm sähe aus wie „nichts
 *     überfällig", und das ist die gefährlichere Aussage.
 *  2. Mit bestätigter Stufe erscheint der Vorschlag, und daraus entsteht ein
 *     Entwurf OHNE Nummer.
 *  3. Die Freigabe zieht die Nummer — und der Bildschirm zeigt sie.
 *  4. Der Kunde sieht davon nichts (§7.5).
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

/** Der Seed lässt den Rechnungskreis als Platzhalter stehen (O-134). */
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

/**
 * Eine überfällige Forderung — als EIGENTÜMER und mit abgeschalteten
 * Auslösern.
 *
 * `fin.rechnung_nummer_ziehen` datiert jede Rechnung auf heute, und
 * `fin.op_unveraenderlich` friert `faellig_am` auf dem Posten ein: aus der
 * Anwendung heraus kann in derselben Sekunde nichts überfällig sein. Das ist
 * eine Vorrichtung des Tests, kein Weg der Plattform.
 */
async function ueberfaelligeForderung(page: Page): Promise<string> {
  await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
  await page.getByLabel('Kunde').selectOption({ index: 0 });
  await page.getByLabel('Leistung von').fill('2026-06-01');
  await page.getByLabel('Leistung bis').fill('2026-06-30');
  await page.getByLabel('Zahlungsziel (Tage)').fill('30');
  await page.getByLabel('Zahlungsart').selectOption('58');
  await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

  await page.getByLabel('Handelsübliche Bezeichnung').fill('Unterhaltsreinigung Juni');
  await page.getByLabel('Menge (Tausendstel)').fill('1000');
  await page.getByLabel('Einheit').selectOption('m2');
  await page.getByLabel('Einzelpreis (Cent)').fill('100000');
  await page.getByLabel('Begründung, falls von Hand erfasst')
    .fill('Einmalige Leistung ohne Auftragsbezug');
  await page.getByRole('button', { name: 'Position hinzufügen' }).click();
  await page.getByRole('button', { name: 'Rechnung festschreiben' }).click();
  await page.waitForLoadState('domcontentloaded');
  const nummer = (await page.getByText(/^RE-\d{4}-\d{5}$/u).first().innerText()).trim();

  await sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(
      `update offener_posten op
          set faellig_am = app.berlin_heute() - 40
         from rechnung r
        where r.id = op.rechnung_id and r.nummer = $1`, [nummer] as never[]);
  });
  return nummer;
}

/** Eine bestätigte Stufe — der Gegenstand von O-19, hier als Vorrichtung. */
async function bestaetigeStufe(): Promise<void> {
  await sql.unsafe(
    `update mahnstufe ms
        set ist_platzhalter = false, gebuehr_cent = 500
       from mandant m
      where m.id = ms.mandant_id and m.slug = $1 and ms.stufe = 1`, [MANDANT]);
}

async function platzhalterZurueck(): Promise<void> {
  await sql.unsafe(
    `update mahnstufe ms
        set ist_platzhalter = true, gebuehr_cent = 0
       from mandant m
      where m.id = ms.mandant_id and m.slug = $1`, [MANDANT]);
}

test.describe('Mahnwesen (FIN-15)', () => {
  test('ohne bestätigte Stufe entsteht kein Vorschlag — und der Grund steht da',
    async ({ page }) => {
      await platzhalterZurueck();
      await anmelden(page);
      const nummer = await ueberfaelligeForderung(page);

      await page.goto(`/portal/${MANDANT}/finanzen/mahnungen`);
      await expect(page.getByRole('heading', { name: 'Vorschläge des Laufs' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Entwürfe anlegen' })).toHaveCount(0);

      const zeile = page.getByRole('row').filter({ hasText: nummer });
      await expect(zeile).toContainText('unbestätigt');
      await expect(zeile).toContainText('O-19');
    });

  test('mit bestätigter Stufe entsteht ein Entwurf ohne Nummer, und die Freigabe zieht sie',
    async ({ page }) => {
      await platzhalterZurueck();
      await anmelden(page);
      await ueberfaelligeForderung(page);
      await bestaetigeStufe();

      await page.goto(`/portal/${MANDANT}/finanzen/mahnungen`);
      await page.getByRole('button', { name: 'Entwürfe anlegen' }).click();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('[data-cse="mahn-hinweis"]')).toContainText('keine Nummer');

      /* Der Entwurf steht in der Liste — mit „Entwurf" statt einer Nummer. */
      const entwurf = page.getByRole('link', { name: 'Entwurf' }).first();
      await expect(entwurf).toBeVisible();
      await entwurf.click();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('heading', { level: 2, name: 'Geforderte Positionen' }))
        .toBeVisible();
      await page.getByLabel('Begründung').fill('Nach Rücksprache mit der Leitung freigegeben.');
      await page.getByRole('button', { name: 'Freigeben' }).click();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('[data-cse="mahn-hinweis"]')).toContainText('Nummer MA-');
      await expect(page.getByRole('heading', { level: 2, name: 'Versand dokumentieren' }))
        .toBeVisible();
    });

  /**
   * **Der Bildschirm, an dem O-19 beantwortet wird.** Ohne ihn liesse sich
   * eine Stufe nur per SQL bestaetigen — und dann bestaetigt sie niemand.
   */
  test('eine Stufe wird auf dem Einstellungsbildschirm bestätigt', async ({ page }) => {
    await platzhalterZurueck();
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/einstellungen/mahnwesen`);

    const offen = page.locator('[data-cse="stufen-offen"]');
    await expect(offen).toBeVisible();
    await expect(offen).toContainText('unbestätigt');
    await expect(offen).toContainText('O-19');

    await page.getByLabel('Stufe', { exact: true }).fill('1');
    await page.getByLabel('Greift ab Tag nach Fälligkeit').fill('14');
    await page.getByLabel('Bezeichnung').fill('Zahlungserinnerung');
    await page.getByLabel('Mahngebühr in Euro').fill('5,00');
    await page.getByLabel('Verzugszins').selectOption('keine');
    /*
     * Das Datum wird NICHT gesetzt: der Bildschirm schlägt den morgigen Tag
     * vor, weil die Seed-Fassung seit heute läuft und eine neue frühestens
     * am Tag danach beginnt. Ein hier eingetipptes Datum prüfte den Test und
     * nicht den Bildschirm.
     */
    await expect(page.getByLabel('Gültig ab')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Stufe bestätigen' }).click();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('[data-cse="stufen-hinweis"]')).toContainText('bestätigt');
    /* Die abgelöste Fassung bleibt stehen — gelöscht wird nichts. Genau EINE,
       denn der Seed legt je Stufe eine an, und abgelöst wird nur Stufe 1. */
    await expect(
      page.getByRole('row').filter({ hasText: 'Zahlungserinnerung (unbestätigt)' }),
    ).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: 'Zahlungserinnerung' }).first())
      .toContainText('5,00');
  });

  /**
   * §7.5: der Kunde sieht keine Mahnung — und erfährt auch nicht, dass es die
   * Adresse gibt. Die K-04-Decke schickt ihn in SEIN Portal zurück, statt ihn
   * auf einem 404 stehen zu lassen (AUT-06): ein 403 bestätigte die Existenz.
   */
  test('der Kunde sieht keine Mahnung (§7.5)', async ({ page }) => {
    await page.goto('/dev/anmelden');
    await alsKonto(page, KONTO.kunde);
    await page.goto(`/portal/${MANDANT}/finanzen/mahnungen`);
    await page.waitForLoadState('domcontentloaded');

    expect(new URL(page.url()).pathname).toBe('/portal/kunde');
    await expect(page.getByRole('heading', { level: 1, name: 'Mahnungen' })).toHaveCount(0);
    await expect(page.getByText('Zahlungserinnerung')).toHaveCount(0);
  });

  test('axe findet auf dem Mahnbildschirm nichts', async ({ page }) => {
    await platzhalterZurueck();
    await anmelden(page);
    await ueberfaelligeForderung(page);
    await bestaetigeStufe();
    await page.goto(`/portal/${MANDANT}/finanzen/mahnungen`);
    await expect(page.getByRole('heading', { name: 'Mahnungen', level: 1 })).toBeVisible();

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });
});
