/**
 * Der Raumbuch-Import im Browser (OPS-04).
 *
 * Die Zusage, die hier faellt oder haelt: **zwischen Datei und Raumbuch
 * steht ein Mensch.** Hochladen zeigt eine Vorschau und aendert nichts;
 * erst der zweite Knopf schreibt.
 */
import { expect, test, type Page } from '@playwright/test';
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

/**
 * SERIELL, und das ist keine Bequemlichkeit.
 *
 * Alle drei Pruefungen arbeiten am selben Seed-Objekt derselben Datenbank:
 * die eine sieht nach, dass das Raumbuch nach dem Hochladen noch LEER ist,
 * die andere fuellt es. Parallel gefahren haengt ihr Ergebnis davon ab, wer
 * zuerst drankommt — und ein Test, dessen Ausgang die Reihenfolge
 * entscheidet, prueft nichts.
 */
test.describe.configure({ mode: 'serial' });

/** Das leere Objekt aus dem Seed — die Veranstaltungshalle hat kein Raumbuch. */
async function zumImport(page: Page): Promise<void> {
  await page.goto('/portal/reinigung/objekte');
  await page.getByRole('link', { name: 'Veranstaltungshalle Tempelhof' }).click();
  await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
  await page.locator('[data-cse="zum-import"]').click();
  await expect(page.locator('h1')).toHaveText('Raumbuch importieren');
}

const DATEI = [
  'Etage;Raumnummer;Bezeichnung;Fläche m²;Belag;Klasse',
  'EG;001;Halle;1.250,5;BETON;RK2',
  'EG;002;Technik;45,25;BETON;RK4',
  'EG;;Foyer;180,0;FLIESE;RK2',
  'UG;001;Lager;;BETON;RK4',
].join('\n');

test.describe('(1) Hochladen zeigt eine Vorschau und ändert nichts', () => {
  test('vier Zeilen, drei gültig, eine ohne Fläche', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await zumImport(page);

    await page.setInputFiles('#datei', {
      name: 'raumbuch.csv', mimeType: 'text/csv', buffer: Buffer.from(DATEI, 'utf8'),
    });
    await page.locator('[data-cse="import-hochladen"]').click();
    await page.waitForURL(/\?import=/u);

    await expect(page.locator('[data-cse="fehlerzahl"]')).toHaveText('1');
    // Die Zeile ohne Fläche sagt, warum sie nicht mitkommt.
    // Zweimal im Baum, weil die Tabelle ab 768px als Tabelle und darunter
    // als Karten gerendert wird — dasselbe Markup, eines davon verborgen.
    await expect(page.getByText('Keine Flaeche angegeben').first()).toBeVisible();
    // Und die deutsche Zahl wurde als 1.250,5 gelesen — nicht als 12505.
    await expect(page.getByText('1.250,50').first()).toBeVisible();
  });

  /**
   * Verglichen wird VORHER mit NACHHER, nicht mit "leer".
   *
   * Die Suite laeuft gegen EINE Datenbank, die zwischen Laeufen nicht
   * geleert wird: nach dem ersten erfolgreichen Durchgang ist dieses Objekt
   * nicht mehr leer, und ein Test auf "leer" scheiterte daran, dass er schon
   * einmal gelaufen ist. Die AUSSAGE ist ohnehin eine andere: das Hochladen
   * aendert NICHTS — egal, was vorher dastand.
   */
  test('das Raumbuch ist danach unveraendert', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    // Erst zaehlen, dann importieren — linear, ohne Zurueckspringen: eine
    // Seite, die der Browser aus dem Verlauf holt, hat ihr Formular nicht
    // mehr, und der Test scheiterte dann an der Navigation statt an der Sache.
    await page.goto('/portal/reinigung/objekte');
    await page.getByRole('link', { name: 'Veranstaltungshalle Tempelhof' }).click();
    await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
    /**
     * Erst die Seite abwarten, dann zaehlen: `count()` wartet NICHT, und
     * direkt nach dem Klick stand die Antwort noch nicht da — der Test las
     * dann 0 und verglich hinterher mit einer Seite, die gerendert war.
     *
     * Und gezaehlt wird die RAUMBUCH-Tabelle: die Seite traegt zwei
     * (Raeume und Kalkulation), „die Tabelle" ist damit keine Angabe.
     */
    await expect(page.locator('h1')).toHaveText('Raumbuch');
    const raeume = page.locator('[data-cse="raumbuch-tabelle"] [data-cse="tabelle"] tbody tr');
    const vorher = await raeume.count();

    await page.locator('[data-cse="zum-import"]').click();
    await expect(page.locator('h1')).toHaveText('Raumbuch importieren');
    await page.setInputFiles('#datei', {
      name: 'raumbuch.csv', mimeType: 'text/csv', buffer: Buffer.from(DATEI, 'utf8'),
    });
    await page.locator('[data-cse="import-hochladen"]').click();
    await page.waitForURL(/\?import=/u);

    /*
     * Der Rueckweg ist `<Zurueck>` (D-613): der Pfeil ist `aria-hidden`, der
     * Name des Verweises heisst „Raumbuch". Gesucht wird genau dieser
     * Verweis im Rueckweg der Seite — „Raumbuch" allein traefe auch
     * „Raumbuch und Kalkulation" in der Navigation.
     */
    await page.getByRole('navigation', { name: 'Zurück' })
      .getByRole('link', { name: 'Raumbuch', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('Raumbuch');
    expect(await raeume.count()).toBe(vorher);
  });
});

test.describe('(2) Erst die Übernahme schreibt', () => {
  test('drei Räume entstehen, die vierte Zeile bleibt draußen', async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await zumImport(page);
    await page.setInputFiles('#datei', {
      name: 'raumbuch.csv', mimeType: 'text/csv', buffer: Buffer.from(DATEI, 'utf8'),
    });
    await page.locator('[data-cse="import-hochladen"]').click();
    await page.waitForURL(/\?import=/u);
    await page.locator('[data-cse="import-uebernehmen"]').click();

    // Zurück im Raumbuch: drei Zeilen, und die Kalkulation rechnet damit.
    await expect(page.locator('h1')).toHaveText('Raumbuch');
    await expect(page.getByRole('cell', { name: 'Halle', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Foyer', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Lager', exact: true })).toHaveCount(0);
  });
});

test.describe('(3) Was der Import ablehnt', () => {
  /**
   * V-171 (D-665): die Abweisung kommt auf der IMPORTSEITE an, mit dem Satz —
   * nicht mehr als weisse JSON-Seite mit HTTP 415. Und erkannt wird die Datei
   * am Inhalt: auch eine „raumbuch.csv", die in Wahrheit ein ZIP ist, fällt.
   */
  test('eine Excel-Datei wird abgewiesen — mit einem Satz auf der Seite, nicht mit halbem Lesen',
    async ({ page }) => {
      await alsKonto(page, KONTO.adminReinigung);
      await zumImport(page);
      const objektId = /\/objekte\/([0-9a-f-]{36})\//u.exec(page.url())?.[1] ?? '';
      for (const datei of [
        { name: 'raumbuch.xlsx', mimeType: 'application/vnd.ms-excel',
          buffer: Buffer.from('PK', 'utf8') },
        { name: 'raumbuch.csv', mimeType: 'text/csv',
          buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]) },
      ]) {
        const antwort = await page.request.post('/api/raumbuch-import', {
          multipart: { objektId, datei },
          headers: { origin: new URL(page.url()).origin },
        });
        expect(antwort.status()).toBe(200);
        expect(antwort.url()).toContain('fehler=excel');
        expect(await antwort.text()).toContain('CSV');
      }
    });
});
