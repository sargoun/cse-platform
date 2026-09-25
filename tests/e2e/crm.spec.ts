/**
 * Phase 4 · CRM im Browser — und die eine Spalte, die vor einer Abmahnung
 * schuetzt.
 *
 * § 7 UWG verbietet elektronische Werbung ohne vorherige ausdrueckliche
 * Einwilligung, auch im B2B. Die Kundenseite zeigt je Kontakt die ANTWORT
 * DES TORES, nicht eine zweite Formulierung derselben Regel — dieselbe
 * Funktion, die auch der Sendepfad fragt.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
/**
 * Angemeldet wird als BESTIMMTES Konto, nicht als „irgendwer mit Rolle admin".
 *
 * Die oertliche Hilfe griff `[data-rolle="admin"]`.first(); seit der Seed ein
 * zweites Verwaltungskonto kennt, steht „Administration Bau" in der nach Namen
 * sortierten Liste vor „Administration Reinigung". Die Sitzung landete damit
 * im Mandanten `bau`, und jeder Aufruf unter `/portal/reinigung/…` antwortete
 * zu Recht mit 404 (Slug-Wache, AUT-06) — ein Fehlschlag, der wie ein kaputter
 * Bildschirm aussah und eine falsche Anmeldung war.
 */
import { alsKonto, KONTO } from './hilfen/anmeldung';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';
const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/**
 * Hält die Rolle dieses Kontos das Recht — nach der LEBENDEN Rechtetabelle?
 *
 * Der Fall unten stand einmal auf einer Annahme im Kommentar („`leitung` hält
 * `system.einstellung_lesen` nicht"), und die Annahme wurde still falsch: der
 * Menüpunkt wanderte auf `system.mandant_lesen` (D-580), das `leitung` sehr
 * wohl hält, und die Zusicherung fiel mit `Expected 0, Received 1` — einem
 * Fehlerbild, das nach einem kaputten Blatt aussieht und ein veralteter
 * Kommentar war. Fünf CI-Läufe rot, bevor jemand nachsah.
 *
 * Deshalb steht die Voraussetzung jetzt als ABFRAGE da, nicht als Satz: kippt
 * die Matrix, fällt der Fall mit „die Voraussetzung gilt nicht mehr" — und
 * nicht mit einer Zahl, die man erst deuten muss.
 */
async function rolleHaelt(email: string, recht: string): Promise<boolean> {
  const [z] = await sql<{ hat: boolean }[]>`
    select exists (
      select 1
        from benutzer b
        join benutzer_mandant bm on bm.benutzer_id = b.id and bm.entzogen_am is null
        join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
        join berechtigung be on be.id = rb.berechtigung_id
       where b.email = ${email} and be.schluessel = ${recht}) as hat`;
  return z?.hat === true;
}

test.describe('(1) Die Kundenliste zeigt den Werbestatus', () => {
  test('sie führt die Seed-Kunden mit Rechtsgrundlage', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung/crm/kunden');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Kunden');
    await expect(page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }))
      .toBeVisible();
    await expect(page.getByText('Bestandskunde').first()).toBeVisible();
  });

  test('und nicht die Kunden einer anderen Gesellschaft', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/crm/kunden');
    // K-20001 gehoert der Security — dieselbe Firma, andere Kundenbeziehung.
    await expect(page.getByText('K-20001')).toHaveCount(0);
    await expect(page.getByText('K-10001').first()).toBeVisible();
  });
});

test.describe('(2) Das UWG-Tor steht als Anzeige auf der Kundenseite', () => {
  test('der Bestandskunden-Kontakt darf per E-Mail beworben werden', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/crm/kunden');
    await page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }).click();
    await expect(page.locator('h1')).toHaveText('Berliner Hausverwaltung GmbH');

    const tor = page.locator('[data-cse="werbetor"]').first();
    await expect(tor).toBeVisible();
    await expect(tor).toHaveAttribute('data-erlaubt', 'true');
    await expect(page.locator('[data-cse="rechtsgrundlage"]')).toContainText('Bestandskunde');
  });

  test('das Objekt des Kunden ist von hier erreichbar', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/crm/kunden');
    await page.getByRole('link', { name: 'Berliner Hausverwaltung GmbH' }).click();
    /*
     * Im Abschnitt „Objekte" und mit exaktem Namen: seit die Kundenseite auch
     * Anfragen, Angebote und Rechnungen des Kunden führt, heissen die
     * Angebote „Unterhaltsreinigung Bürohaus Kurfürstendamm" — ein Treffer
     * auf Teilnamen fand viele Verweise statt des einen Objekts.
     */
    await page.getByRole('region', { name: 'Objekte' })
      .getByRole('link', { name: 'Bürohaus Kurfürstendamm', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('Bürohaus Kurfürstendamm');
  });
});

test.describe('(3) Der Lead-Posteingang und der Verlauf', () => {
  test('er führt die offenen Anfragen', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung/crm/leads');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Leads');
    await expect(page.getByRole('link', { name: /Unterhaltsreinigung Buerohaus/u }))
      .toBeVisible();
  });

  test('eine Anfrage ohne nächsten Schritt sagt das — sonst liegt sie still',
    async ({ page }) => {
      await alsKonto(page, KONTO.adminReinigung);
      await page.goto('/portal/reinigung/crm/leads');
      await page.getByRole('link', { name: /Unterhaltsreinigung Buerohaus/u }).click();
      await expect(page.locator('[data-cse="ohne-naechsten-schritt"]')).toBeVisible();
    });

  test('eine Notiz landet im Verlauf, und der nächste Schritt steht danach fest',
    async ({ page }) => {
      await alsKonto(page, KONTO.adminReinigung);
      await page.goto('/portal/reinigung/crm/leads');
      await page.getByRole('link', { name: /Glasreinigung/u }).click();
      await page.waitForURL(/\/crm\/leads\/[0-9a-f-]{36}$/u);
      const url = page.url();

      /*
       * Über die Beschriftung im Formular „Aktivität festhalten" und nicht
       * über `#inhalt`/`#naechsteAktion`: das Formular trägt seit V-137 Art
       * und Richtung, und seine Felder sind in ihre Beschriftung gefasst —
       * ohne `id`. Geprüft wird, was ein Mensch sieht, in genau diesem
       * Formular.
       */
      const formular = page.locator('[data-cse="lead-aktivitaet-formular"]');
      await formular.getByLabel('Was ist passiert?', { exact: true })
        .fill('Rückruf: Termin am Objekt vereinbart.');
      await formular.getByLabel('Nächster Schritt', { exact: true })
        .fill('Angebot rechnen und senden');
      await formular.getByLabel('Wann', { exact: true }).fill('2026-10-01');
      await page.locator('[data-cse="lead-notieren"]').click();
      await page.waitForURL(url);

      await expect(page.locator('[data-cse="naechster-schritt"]'))
        .toContainText('Angebot rechnen und senden');
      await expect(page.locator('[data-cse="verlauf"]'))
        .toContainText('Termin am Objekt vereinbart');
      // Der Eintrag traegt, WER ihn festgehalten hat und WANN.
      await expect(page.locator('[data-cse="verlauf"]')).toContainText('Notiz ·');
    });
});

test.describe('(4) „Mehr" öffnet den vollständigen Baum (SEITENKARTE §11.2)', () => {
  test('am Telefon führt das fünfte Ziel in die übrigen Module', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung');

    const mehr = page.locator('[data-cse="mehr"]');
    await expect(mehr).toBeVisible();
    // Vor dem Öffnen ist das Blatt zu.
    await expect(page.locator('[data-cse="mehr-blatt"]')).toBeHidden();
    await page.locator('[data-cse="tab"][data-tab="mehr"]').click();
    await expect(page.locator('[data-cse="mehr-blatt"]')).toBeVisible();
    // CRM ist darin — und war über die vier Tabs nicht erreichbar.
    await page.locator('[data-cse="mehr-ziel"][data-ziel="crm"]').click();
    await expect(page.locator('h1')).toHaveText('CRM');
  });

  test('ein Modul ohne Recht steht NICHT im Blatt — eines mit Recht schon', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    /**
     * Hier ist die ROLLE die Aussage, nicht der Mensch: geprueft wird, was
     * `leitung` NICHT darf. `[data-rolle="leitung"]`.first() traf das nur so
     * lange verlaesslich, wie die nach Namen sortierte Liste „Leitung Bau" vor
     * „Leitung Security" stellte — eine Zusicherung, die niemand gegeben hat.
     * `leitung.bau` ist genau die Leitung DIESER Gesellschaft; unter einer
     * Sitzung in `security` haette `/portal/bau` mit 404 geantwortet.
     *
     * **Die Voraussetzung wird GEFRAGT, nicht behauptet.** `buchungen` trägt
     * `buchhaltung.lesen` (`registry/navigation.ts`), und das hält `leitung`
     * nach 0008 nicht — die Buchhaltung ist ein anderes Amt als die Leitung
     * eines Gewerks. `einstellungen` trägt `system.mandant_lesen`, und das
     * hält sie (D-580). Beides steht hier als Abfrage; sonst hiesse ein Kippen
     * der Matrix „Received 1" statt „Voraussetzung gefallen".
     */
    expect(await rolleHaelt(KONTO.leitungBau, 'buchhaltung.lesen'),
      'Voraussetzung: leitung hält buchhaltung.lesen NICHT (0008)').toBe(false);
    expect(await rolleHaelt(KONTO.leitungBau, 'system.mandant_lesen'),
      'Voraussetzung: leitung hält system.mandant_lesen (0008, D-580)').toBe(true);

    await alsKonto(page, KONTO.leitungBau);
    await page.goto('/portal/bau');
    await page.locator('[data-cse="tab"][data-tab="mehr"]').click();
    await expect(page.locator('[data-cse="mehr-blatt"]')).toBeVisible();

    // Ohne Recht fehlt der Punkt — nicht ausgegraut, sondern gar nicht: ein
    // Menüpunkt, der auf 404 führt, verrät die Existenz dessen, was er nicht
    // zeigen darf (AUT-06).
    await expect(page.locator('[data-cse="mehr-ziel"][data-ziel="buchungen"]'))
      .toHaveCount(0);
    await expect(page.locator('[data-cse="mehr-ziel"][data-ziel="objekte"]')).toBeVisible();

    /*
     * **Und mit Recht steht er da — das ist die andere Hälfte von AUT-06.**
     * Bis D-580 stand `einstellungen` auf `system.einstellung_lesen`, einem
     * Recht, das nur die Super-Administration hält; die Leitung sah den
     * Bereich nie, obwohl seine Seite für sie offen stand. Ein Blatt, das
     * einen erlaubten Punkt verschweigt, ist derselbe Fehler von der anderen
     * Seite — und genau dieser Fall hielt ihn fünf Läufe lang fest, weil er
     * das Fehlen als richtig zusicherte.
     */
    const einstellungen = page.locator('[data-cse="mehr-ziel"][data-ziel="einstellungen"]');
    await expect(einstellungen).toBeVisible();
    await einstellungen.click();
    await expect(page.locator('h1')).toHaveText('Einstellungen');
  });
});

test.describe('(5) barrierefrei', () => {
  test('axe findet nichts auf der Kundenseite', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/crm/kunden');
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ergebnis.violations).toEqual([]);
  });
});

test.afterAll(async () => { await sql.end(); });
