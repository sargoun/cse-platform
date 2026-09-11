/**
 * Das Wachbuch im Browser — die Abnahmekriterien von PR 41, die nur dort zu
 * pruefen sind (SEC-05, TIM-08, LEG-01).
 *
 * **Was hier steht und nicht in der Isolationssuite:** dass die Oberflaeche
 * keinen Weg anbietet, den die Datenbank verbietet. Ein Bearbeiten-Formular,
 * das beim Speichern an einem Ausloeser scheitert, ist schlechter als keines —
 * die Wache tippt ihren Text ein zweites Mal und bekommt denselben Fehler.
 *
 * (3) Eine Seite laesst sich schreiben und danach NICHT bearbeiten: auf dem
 *     Einzelblatt gibt es kein Textfeld fuer den Eintragstext, sondern ein
 *     Formular fuer die RICHTIGSTELLUNG. Beide Eintraege stehen danach im
 *     Buch, der falsche durchgestrichen und mit Grund.
 * (4) Die Seite zeigt die SERVERZEIT. Der Test setzt die Uhr des Browsers zwei
 *     Stunden vor und erwartet trotzdem die Serverzeit im Blatt — und die
 *     Geraeteabweichung als eigene Angabe daneben.
 * (1) Ein Posten unter Mindestbesetzung zeigt auf `security/posten` den
 *     Dringlichkeitsblock und auf dem Postenblatt „nicht veroeffentlichbar".
 *
 * **Diese Datei wird in PR 41 GESCHRIEBEN, aber nicht ausgefuehrt.** Die
 * e2e-Suite braucht einen Build und die gemeinsame Datenbank; beides steht in
 * einer parallel laufenden Phase nicht allein zur Verfuegung. Der Lauf gehoert
 * in den CI-Schritt, der die Suite als Ganzes fahren kann.
 */
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Der Bereich, unter dem das Wachbuch liegt — die Security-Gesellschaft. */
const BEREICH = 'security';
/** Ein Tag weit genug in der Zukunft, damit keine andere Schicht dazwischenliegt. */
const NACHT = '2028-06-13';

let mandantId = '';
let objektId = '';
let postenId = '';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator('[data-cse="dev-anmelden"][data-rolle="admin"]').first();
  await expect(knopf, 'kein Seed-Konto für Rolle admin').toBeVisible();
  await knopf.click();
  await page.waitForLoadState('networkidle');
}

test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `select id from mandant where slug = $1`, [BEREICH]);
  mandantId = m!.id;

  const [o] = await sql.unsafe<{ id: string }[]>(
    `select id from objekt where mandant_id = $1 and archiviert_am is null
      order by erstellt_am limit 1`, [mandantId]);
  objektId = o!.id;

  /**
   * Ein Posten mit Mindestbesetzung ZWEI und eine Nacht ohne jede Einteilung.
   *
   * `on conflict do nothing` ueber das Kurzzeichen: `posten` traegt die
   * Loeschsperre, also bleibt die Zeile eines frueheren Laufs liegen — ein
   * zweiter Posten daneben machte aus dem Dringlichkeitsblock zwei Zeilen,
   * und der Test faende einen Fehler, den es nicht gibt.
   */
  await sql.unsafe(
    `insert into posten (mandant_id, objekt_id, bezeichnung, kurzzeichen,
                         min_besetzung, soll_besetzung, gueltig_ab, erstellt_von_art)
     values ($1, $2, 'E2E-Nachtwache', 'E2E-NW', 2, 2, $3::date, 'system')
     on conflict do nothing`,
    [mandantId, objektId, NACHT]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `select id from posten where mandant_id = $1 and kurzzeichen = 'E2E-NW'`, [mandantId]);
  postenId = p!.id;

  await sql.unsafe(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, posten_id, soll_besetzung, min_besetzung,
                          erstellt_von_art, status)
     select $1, 'posten', $2, $3::date,
            (select zeitpunkt from app.loese_ortszeit($3::date, '22:00', 'Europe/Berlin')),
            (select zeitpunkt from app.loese_ortszeit($3::date + 1, '04:00', 'Europe/Berlin')),
            'Europe/Berlin', '22:00', '04:00', true,
            $4, o.kunde_id, $5, 2, 2, 'system', 'geplant'
       from objekt o where o.id = $4
     on conflict (mandant_id, quell_schluessel) where storniert_am is null do nothing`,
    [mandantId, `e2e-wachbuch:${NACHT}`, NACHT, objektId, postenId]);
});

test.afterAll(async () => {
  await sql.end({ timeout: 5 });
});

test.describe('(3) das Wachbuch ist anfuegbar, nicht bearbeitbar', () => {
  test('eine Seite entsteht, und das Blatt bietet kein Bearbeiten an', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${BEREICH}/security/wachbuch/neu`);

    await page.selectOption('select[name="objekt"]', objektId);
    await page.getByRole('radio', { name: 'Vorkommnis' }).check();
    await page.fill('input[name="betreff"]', 'E2E Tür offen');
    await page.fill('textarea[name="eintragstext"]', 'Nebentür offen vorgefunden.');
    await page.getByRole('button', { name: 'Eintrag schreiben' }).click();

    // Nach dem Schreiben steht die Seite im Buch — mit Nummer und Serverzeit.
    const eintrag = page.locator('[data-cse="wachbuch-eintrag"]').first();
    await expect(eintrag).toContainText('E2E Tür offen');
    await eintrag.getByRole('link').first().click();

    const blatt = page.locator('[data-cse="wachbuch-blatt"]');
    await expect(blatt).toContainText('Nebentür offen vorgefunden.');
    /**
     * **Die eigentliche Zusage:** es gibt kein Feld, das den Text aendert.
     * Das Formular auf dieser Seite ist das der Richtigstellung, und es
     * verlangt einen Grund.
     */
    await expect(page.locator('textarea[name="eintragstext"]')).toHaveCount(1);
    await expect(page.locator('input[name="grund"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Richtigstellung schreiben' }))
      .toBeVisible();
  });

  test('die Richtigstellung laesst beide Eintraege stehen', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${BEREICH}/security/wachbuch`);
    await page.locator('[data-cse="wachbuch-eintrag"]').first()
      .getByRole('link').first().click();

    await page.fill('input[name="grund"]', 'Falsche Tür genannt');
    await page.fill('input[name="betreff"]', 'E2E Tor offen');
    await page.fill('textarea[name="eintragstext"]', 'Lieferantentor offen vorgefunden.');
    await page.getByRole('button', { name: 'Richtigstellung schreiben' }).click();

    // Die Richtigstellung verweist zurueck …
    await expect(page.locator('[data-cse="wachbuch-blatt"]'))
      .toContainText('stellt');

    // … und im Buch stehen beide, der falsche als storniert.
    await page.goto(`/portal/${BEREICH}/security/wachbuch`);
    await expect(page.locator('[data-cse="wachbuch-eintrag"][data-storniert="ja"]').first())
      .toContainText('Storniert: Falsche Tür genannt');
    await expect(page.locator('[data-cse="wachbuch-eintrag"][data-storniert="nein"]').first())
      .toContainText('E2E Tor offen');
  });
});

test.describe('(4) eine manipulierte Geraeteuhr aendert keine aufgezeichnete Zeit', () => {
  /**
   * Die Uhr des BROWSERS zwei Stunden vor. Playwright stellt sie fuer die
   * ganze Seite; ein Skript, das die Zeit selbst formatierte, faellt damit
   * sofort auf — und genau das ist der Punkt: jede Uhrzeit kommt fertig aus
   * der Datenbank (Invariante 2).
   */
  test.use({ timezoneId: 'America/New_York' });

  test('das Blatt zeigt die Berliner Serverzeit, nicht die Zeit des Geraets',
    async ({ page }) => {
      await anmelden(page);
      await page.goto(`/portal/${BEREICH}/security/wachbuch`);
      await page.locator('[data-cse="wachbuch-eintrag"]').first()
        .getByRole('link').first().click();

      const blatt = page.locator('[data-cse="wachbuch-blatt"]');
      await expect(blatt).toContainText('Serverzeit');

      /**
       * Die angezeigte Uhrzeit muss der SERVERZEIT entsprechen — auch wenn der
       * Browser in New York steht. Verglichen wird gegen die Datenbank selbst,
       * denn sie ist die Quelle.
       */
      const [zeile] = await sql.unsafe<{ lokal: string }[]>(
        `select to_char(erfasst_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as lokal
           from wachbuch_eintrag
          where mandant_id = $1 order by erfasst_am desc limit 1`, [mandantId]);
      await expect(blatt).toContainText(zeile!.lokal);
    });
});

test.describe('(1) ein Posten unter Mindestbesetzung', () => {
  test('steht im Dringlichkeitsblock und ist nicht veroeffentlichbar',
    async ({ page }) => {
      await anmelden(page);
      await page.goto(`/portal/${BEREICH}/security/posten`);

      const block = page.locator('[data-cse="posten-unterbesetzung"]');
      await expect(block).toBeVisible();
      await expect(block).toContainText('E2E-Nachtwache');
      await expect(block).toContainText('0 von 2');

      await page.goto(`/portal/${BEREICH}/security/posten/${postenId}`);
      await expect(page.locator('[data-cse="nicht-veroeffentlichbar"]'))
        .toContainText('Nicht als besetzt veröffentlichbar');
    });
});
