/**
 * Der Dienstplan im Browser — die Abnahmekriterien von PR 33, die nur dort
 * zu pruefen sind.
 *
 * (1) Zehn Schichten zur selben Sekunde an einem Objekt stehen als zehn
 *     sichtbare Spalten nebeneinander. Das ist TIM-04, und es ist der Fall,
 *     an dem ein Plan still falsch wird: gruppiert er, zeigt er eine Zeile,
 *     und dass neun fehlen, sieht niemand.
 * (2) Eine Schicht 22:00–06:00 steht an beiden Tagen und liest `8,00 h`; in
 *     den beiden Umstellungsnaechten `7,00 h` und `9,00 h` (K-11).
 * (5) Die Anzeige bleibt Europe/Berlin, auch wenn der BROWSER in New York
 *     steht — jede Uhrzeit kommt fertig aus der Datenbank, und dieser Test
 *     ist der Beweis, dass sich keine client-seitige Formatierung
 *     eingeschlichen hat.
 */
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Ein Tag weit genug in der Zukunft, damit keine andere Schicht dazwischenliegt. */
const TAG = '2028-02-07';        // ein Montag
const NACHT_NORMAL = '2028-03-11';
const NACHT_VOR = '2028-03-25';  // Umstellung in der Nacht auf den 26.03.2028
const NACHT_ZURUECK = '2028-10-28'; // Umstellung in der Nacht auf den 29.10.2028

let objektId = '';
let mandantId = '';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator('[data-cse="dev-anmelden"][data-rolle="admin"]').first();
  await expect(knopf, 'kein Seed-Konto für Rolle admin').toBeVisible();
  await knopf.click();
  await page.waitForLoadState('networkidle');
}

/** Eine Schicht von Hand — `quelle = 'manuell'`, wie eine geplante Einzelschicht. */
async function schicht(
  schluessel: string, datum: string, von: string, bis: string, folgetag: boolean,
): Promise<void> {
  await sql.unsafe(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, soll_besetzung, min_besetzung,
                          erstellt_von_art, status)
     select $1, 'manuell', $2, $3::date,
            (select zeitpunkt from app.loese_ortszeit($3::date, $4::time, 'Europe/Berlin')),
            (select zeitpunkt from app.loese_ortszeit(
               ($3::date + case when $6 then 1 else 0 end), $5::time, 'Europe/Berlin')),
            'Europe/Berlin', $4::time, $5::time, $6,
            $7, o.kunde_id, 1, 1, 'system', 'geplant'
       from objekt o where o.id = $7
     on conflict (mandant_id, quell_schluessel) where storniert_am is null do nothing`,
    [mandantId, schluessel, datum, von, bis, folgetag, objektId],
  );
}

test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `select id from mandant where slug = 'reinigung' limit 1`);
  mandantId = m!.id;
  const [o] = await sql.unsafe<{ id: string }[]>(
    `select id from objekt where mandant_id = $1 and kunde_id is not null
      order by objektnummer limit 1`, [mandantId]);
  objektId = o!.id;

  // (1) zehn zur selben Sekunde
  for (let i = 0; i < 10; i += 1) {
    await schicht(`e2e:parallel:${String(i)}`, TAG, '06:00', '10:00', false);
  }
  // (2) die drei Naechte
  await schicht('e2e:nacht:normal', NACHT_NORMAL, '22:00', '06:00', true);
  await schicht('e2e:nacht:vor', NACHT_VOR, '22:00', '06:00', true);
  await schicht('e2e:nacht:zurueck', NACHT_ZURUECK, '22:00', '06:00', true);
});

test.afterAll(async () => {
  // Kein DELETE: `einsatz` traegt die Loeschsperre (Invariante 8). Die Zeilen
  // bleiben stehen; sie stoeren nicht, weil sie 2028 liegen.
  await sql.end();
});

test.describe('Dienstplan — Wochenansicht', () => {
  test('(1) zehn Schichten zur selben Sekunde sind zehn sichtbare Spalten', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${TAG}`);

    const bloecke = page.locator(`[data-cse="plantag"][data-datum="${TAG}"] [data-cse="schicht"]`);
    await expect(bloecke).toHaveCount(10);

    const kaesten = await bloecke.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), breite: Math.round(r.width), hoehe: Math.round(r.height) };
      }));

    // Zehn UNTERSCHIEDLICHE x-Positionen — nicht uebereinander.
    expect(new Set(kaesten.map((k) => k.x)).size).toBe(10);
    // Keiner ist weggeklappt: jeder hat Breite und Hoehe.
    for (const k of kaesten) {
      expect(k.breite, 'ein Block ohne Breite ist ein unsichtbarer Block').toBeGreaterThan(0);
      expect(k.hoehe).toBeGreaterThan(0);
    }
    // Und sie ueberlappen einander nicht — sonst waeren zehn Spalten optisch
    // wieder eine.
    const sortiert = [...kaesten].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sortiert.length; i += 1) {
      expect(sortiert[i]!.x).toBeGreaterThanOrEqual(sortiert[i - 1]!.x + sortiert[i - 1]!.breite - 1);
    }
  });

  test('(2) die Nachtschicht steht an beiden Tagen und liest 8,00 h', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${NACHT_NORMAL}`);

    const ersterTag = page.locator(`[data-cse="plantag"][data-datum="${NACHT_NORMAL}"] [data-cse="schicht"]`);
    const zweiterTag = page.locator('[data-cse="plantag"][data-datum="2028-03-12"] [data-cse="schicht"]');
    await expect(ersterTag).toHaveCount(1);
    await expect(zweiterTag).toHaveCount(1);
    await expect(ersterTag.first()).toContainText('8,00 h');
    await expect(zweiterTag.first()).toContainText('8,00 h');
    // Der Pfeil sagt, in welche Richtung sie weitergeht.
    await expect(ersterTag.first()).toContainText('↓');
    await expect(zweiterTag.first()).toContainText('↑');
  });

  test('(2) die Nacht der Vorstellung liest 7,00 h', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${NACHT_VOR}`);
    const block = page.locator(`[data-cse="plantag"][data-datum="${NACHT_VOR}"] [data-cse="schicht"]`);
    await expect(block.first()).toContainText('7,00 h');
    // Die Ortszeit bleibt 22:00–06:00 — verschoben hat sich der Instant.
    await expect(block.first()).toContainText('22:00');
    await expect(block.first()).toContainText('06:00');
  });

  test('(2) die Nacht der Rueckstellung liest 9,00 h', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${NACHT_ZURUECK}`);
    const block = page.locator(`[data-cse="plantag"][data-datum="${NACHT_ZURUECK}"] [data-cse="schicht"]`);
    await expect(block.first()).toContainText('9,00 h');
  });
});

test.describe('(5) die Anzeige bleibt Berlin', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('auch wenn der Browser in New York steht', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${NACHT_NORMAL}`);
    const block = page.locator(`[data-cse="plantag"][data-datum="${NACHT_NORMAL}"] [data-cse="schicht"]`);
    // 22:00 Berlin ist 16:00 in New York. Stuende hier 16:00, haette sich
    // eine client-seitige Formatierung eingeschlichen.
    await expect(block.first()).toContainText('22:00');
    await expect(block.first()).not.toContainText('16:00');
  });
});

test.describe('(5) der Monat auf einem Telefon', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('scrollt nicht waagerecht', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/monat?monat=${TAG}`);
    await expect(page.locator('[data-cse="monatsplan"]')).toBeVisible();
    const waagerecht = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(waagerecht, 'DESIGN §8: keine waagerechte Scrollleiste auf dem Telefon').toBe(false);
  });
});
