/**
 * D-487 im Browser — der Befund des Nutzers, nachgestellt und behoben:
 *
 *  1. Die Mitarbeiter-Anmeldung am Handy (390 px): Nummer → Code → Portal.
 *  2. Ohne SMS stellt die Einsatzleitung den Code aus: die Zugangsseite zeigt
 *     ihn einmal, die Mitarbeiterin meldet sich damit am Handy an; die
 *     Leitung ohne das Recht sieht die Seite nicht.
 *  3. Eine Administration legt eine Serie an, und die Schichten stehen sofort
 *     im Plan; die Sicherheit sieht ihre Posten, ein Baubereich seine Absage.
 */
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';
const sql = postgres(DSN, { max: 2, onnotice: () => {} });

const HANDY = { width: 390, height: 844 };

async function person(email: string): Promise<{ id: string; telefon: string }> {
  const [z] = await sql<{ id: string; telefon: string | null }[]>`
    select p.id, p.telefon from benutzer b join person p on p.id = b.person_id
     where b.email = ${email} limit 1`;
  expect(z?.telefon ?? null, `kein Seed-Konto ${email} mit Nummer`).not.toBeNull();
  return { id: z!.id, telefon: z!.telefon! };
}

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

/**
 * Die Bremse (drei offene Codes je Zugang, 0130) ist Absicht — im Betrieb.
 * Jeder Lauf dieser Datei fordert zwei Codes an; auf einer nicht frischen
 * Datenbank stuende der dritte Lauf vor der Bremse und saehe keinen Code.
 * Offene Codes gelten als verbraucht, bevor ein Test einen neuen anfordert.
 */
async function bremseLoesen(personId: string): Promise<void> {
  await sql`
    update mitarbeiter_einmalcode set verbraucht_am = now()
     where verbraucht_am is null
       and zugang_id = (select id from mitarbeiter_zugang where person_id = ${personId})`;
}

/** Ein Name je Lauf — die Zaehlung unten trifft sonst die Serie des vorigen Laufs. */
const SERIE = `Treppenhaus abends (Browsertest ${Date.now()})`;

test.afterAll(async () => { await sql.end(); });

test.describe('Anmeldung und Schichten (D-487)', () => {
  test('die Mitarbeiter-Anmeldung funktioniert am Handy: Nummer, Code, Portal', async ({ page }) => {
    await page.setViewportSize(HANDY);
    const fatima = await person(KONTO.fatima);
    await bremseLoesen(fatima.id);
    await page.goto('/auth/mitarbeiter');
    await expect(page.locator('input[name="telefon"]')).toBeVisible();
    await page.fill('input[name="telefon"]', fatima.telefon);
    await page.locator('[data-cse="code-anfordern"]').click();
    await page.waitForURL('**/auth/mitarbeiter/code');
    const code = (await page.locator('[data-cse="dev-code-wert"]').innerText()).trim();
    expect(code).toMatch(/^[0-9]{6}$/u);
    /*
     * **So kommt der Code wirklich an** (D-488): wer ihn vom Bildschirm
     * markiert und einfuegt, bringt Leerzeichen mit. Ein `pattern` im
     * Formular haette hier stumm blockiert — die Seite bliebe stehen, ohne
     * ein Wort. Genau das hat der Nutzer beschrieben.
     */
    await page.fill('input[name="code"]', ` ${code.slice(0, 3)} ${code.slice(3)} `);
    await page.locator('[data-cse="code-einloesen"]').click();
    await page.waitForURL(/\/portal\/mein/u);
    await expect(page.locator('h1')).toBeVisible();
    // Kein waagerechtes Scrollen auf dem Handy.
    const breite = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(breite).toBeLessThanOrEqual(HANDY.width + 1);
  });

  test('die Einsatzleitung stellt einen Code aus, die Mitarbeiterin meldet sich damit am Handy an', async ({ browser, page }) => {
    // Zwei Anmeldungen, fuenf Seiten, zwei Kontexte — beim ersten Aufruf kompiliert der Dev-Server die neuen Seiten.
    test.setTimeout(120_000);
    const fatima = await person(KONTO.fatima);
    await bremseLoesen(fatima.id);

    /*
     * Die Mitarbeiterin — anderer Browser, Handybreite — steht ZUERST auf der
     * Codeseite. Ohne Gateway legt ihr Tipp keinen Code an (Kern-Test,
     * D-487); auf der Entwicklungsflaeche, auf der dieser Test laeuft, legt
     * er den angezeigten an — und 0114 loest nur den JUENGSTEN ein. Der
     * ausgestellte Code muss deshalb NACH dem Tipp entstehen; genau diese
     * Reihenfolge nimmt der Betrieb ebenfalls („ich komme nicht rein" →
     * Anruf → Code).
     */
    const handy = await browser.newContext({ viewport: HANDY });
    const seite = await handy.newPage();
    await seite.goto('/auth/mitarbeiter');
    await seite.fill('input[name="telefon"]', fatima.telefon);
    await seite.locator('[data-cse="code-anfordern"]').click();
    await seite.waitForURL('**/auth/mitarbeiter/code');

    await anmelden(page, KONTO.adminReinigung);
    const antwort = await page.goto(`/portal/reinigung/personal/personen/${fatima.id}`);
    expect(antwort?.status()).toBe(200);
    await page.locator('[data-cse="person-zugang"]').click();
    await page.waitForURL(`**/personal/personen/${fatima.id}/zugang`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Zugang');
    await expect(page.locator('[data-cse="zugang-sms"]')).toContainText('nicht verbunden');
    await page.locator('[data-cse="zugang-code-ausstellen"]').click();
    await page.waitForURL(/ausgestellt=1/u);
    const code = (await page.locator('[data-cse="zugang-code-wert"]').innerText()).trim();
    expect(code).toMatch(/^[0-9]{6}$/u);
    // Der Klartext steht nicht in der Adresse.
    expect(page.url()).not.toContain(code);

    // Die Mitarbeiterin kommt mit genau diesem Code hinein — nicht mit dem angezeigten.
    await seite.fill('input[name="code"]', code);
    await seite.locator('[data-cse="code-einloesen"]').click();
    await seite.waitForURL(/\/portal\/mein/u);
    await expect(seite.locator('h1')).toBeVisible();
    await handy.close();

    // Die Ausstellung steht im Protokoll — ohne den Code.
    const [eintrag] = await sql<{ nachher: Record<string, unknown> }[]>`
      select nachher from audit_log where aktion = 'zugang.code_ausgestellt' and objekt_id = ${fatima.id}
       order by erstellt_am desc limit 1`;
    expect(eintrag?.nachher['weg']).toBe('einsatzleitung');
    expect(JSON.stringify(eintrag?.nachher)).not.toContain(code);
  });

  test('ein falscher Code sagt es sichtbar — die Seite bleibt nicht stumm', async ({ page }) => {
    await page.setViewportSize(HANDY);
    const fatima = await person(KONTO.fatima);
    await bremseLoesen(fatima.id);
    await page.goto('/auth/mitarbeiter');
    await page.fill('input[name="telefon"]', fatima.telefon);
    await page.locator('[data-cse="code-anfordern"]').click();
    await page.waitForURL('**/auth/mitarbeiter/code');

    await page.fill('input[name="code"]', '000000');
    await page.locator('[data-cse="code-einloesen"]').click();
    await page.waitForURL(/fehler=code/u);
    // Der Kasten steht OBEN, nicht als Kleingedrucktes unter dem Feld: am
    // Telefon ist das der Unterschied zwischen „es passiert nichts" und einer Auskunft.
    const kasten = page.locator('[data-cse="code-fehler"]');
    await expect(kasten).toBeVisible();
    await expect(kasten).toContainText('nicht geklappt');
    await expect(kasten).toBeInViewport();
  });

  test('die Zugangsseite zeigt, woran eine Anmeldung haengt: Konto, offene Codes, letzte Anmeldung', async ({ page }) => {
    const fatima = await person(KONTO.fatima);
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/reinigung/personal/personen/${fatima.id}/zugang`);
    await expect(page.locator('[data-cse="zugang-vorhanden"]')).toContainText('eingerichtet');
    await expect(page.locator('[data-cse="zugang-konto"]')).toContainText('aktiv');
    await expect(page.locator('[data-cse="zugang-offene-codes"]')).toContainText('von 3');
    await expect(page.locator('[data-cse="zugang-letzte-anmeldung"]')).not.toBeEmpty();
    // Nichts steht im Weg — also kein Hindernis-Kasten, und der Knopf traegt.
    await expect(page.locator('[data-cse="zugang-hindernis"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="zugang-code-ausstellen"]')).toBeEnabled();
  });

  test('ohne personal.zugang_verwalten gibt es die Zugangsseite nicht', async ({ page }) => {
    const fatima = await person(KONTO.fatima);
    await anmelden(page, KONTO.leitungReinigung);
    expect((await page.goto(`/portal/reinigung/personal/personen/${fatima.id}/zugang`))?.status()).toBe(404);
  });

  test('eine Administration legt eine Serie an — die Schichten stehen sofort im Plan', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/dienstplan/serien');
    await page.locator('[data-cse="serie-neu"]').click();
    await page.waitForURL('**/dienstplan/serien/neu');
    await expect(page.getByRole('heading', { name: 'Neue Serie', level: 1 })).toBeVisible();
    const formular = page.locator('[data-cse="serie-formular"]');
    await expect(formular.locator('select[name="revier"] option')).not.toHaveCount(0);
    await formular.locator('input[name="bezeichnung"]').fill(SERIE);
    await formular.locator('input[name="beginn"]').fill('18:00');
    await formular.locator('input[name="dauer"]').fill('120');
    await formular.locator('[data-cse="serie-anlegen"]').click();
    await page.waitForURL(/dienstplan\/serien\?angelegt=/u);
    const erzeugt = Number(new URL(page.url()).searchParams.get('erzeugt'));
    expect(erzeugt).toBeGreaterThan(0);
    await expect(page.locator('[data-cse="serie-angelegt"]')).toContainText('Serie angelegt');
    await expect(page.locator('[data-cse="tabelle"]')).toContainText(SERIE);

    const [zahl] = await sql<{ n: number }[]>`
      select count(*)::int as n from einsatz e join turnus t on t.id = e.turnus_id
       where t.bezeichnung = ${SERIE} and e.storniert_am is null`;
    expect(zahl!.n).toBe(erzeugt);
  });

  test('Sicherheit sieht ihre Posten mit Dienstzeiten; Bau bekommt eine Absage statt eines leeren Formulars', async ({ page }) => {
    await anmelden(page, KONTO.adminSecurity);
    expect((await page.goto('/portal/security/dienstplan/serien/neu'))?.status()).toBe(200);
    await expect(page.locator('[data-cse="serie-formular"] select[name="posten"]')).toBeVisible();
    await expect(page.locator('[data-cse="serie-posten-hinweis"]')).toContainText('Posten');

    await anmelden(page, KONTO.adminBau);
    expect((await page.goto('/portal/bau/dienstplan/serien/neu'))?.status()).toBe(200);
    await expect(page.locator('[data-cse="serie-nicht-hier"]')).toBeVisible();
    await expect(page.locator('[data-cse="serie-formular"]')).toHaveCount(0);
  });
});
