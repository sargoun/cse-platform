/**
 * Das Aufmass im Browser — die Abnahmekriterien von PR 43, die NUR dort zu
 * pruefen sind (BAU-01, BAU-02, BAU-03).
 *
 * Drei Zusagen betreffen die Oberflaeche und nicht die Datenbank:
 *
 * (1) **Formel und Ergebnis stehen nebeneinander.** Der Rechenansatz
 *     `3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)` steht woertlich auf dem
 *     Bildschirm, und daneben `30,87 m²`. Ein Blatt, das nur die Zahl zeigt,
 *     nimmt dem Pruefer genau das, wofuer BAU-02 beides speichert.
 * (2) **Ein fremdes Zeichen wird mit der STELLE zurueckgewiesen.** „Ungueltig"
 *     schickt den Polier auf die Suche; „Zeichen 13" zeigt auf das `%`.
 * (4) **`1.2.10` steht im LV-Baum hinter `1.2.9`**, und die Σ je Titel und je
 *     Los steht in der Tabelle — nicht nur in einem Dienst.
 * (3) **Ohne Messfoto erscheint kein Gegenzeichnen-Knopf**, sondern der Satz,
 *     was fehlt. Ein Knopf, der in einen Datenbankfehler laeuft, ist eine
 *     Zusage, die die Oberflaeche nicht halten kann.
 *
 * **Diese Datei wird in PR 43 NICHT ausgefuehrt** (Auftrag: Spezifikation
 * schreiben genuegt) — sie ist gegen dieselben Daten geschrieben wie die
 * Isolationspruefungen und laeuft, sobald die Browsersuite fuer Phase 5
 * insgesamt laeuft.
 */
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Die Formel aus SPEC §8 — das Beispiel, an dem dieser PR gemessen wird. */
const FORMEL = '3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)';
const ERGEBNIS = '30,87';

let mandantSlug = '';
let projektId = '';
let aufmassOhneFoto = '';
let aufmassMitFoto = '';
let lvId = '';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator('[data-cse="dev-anmelden"][data-rolle="admin"]').first();
  await expect(knopf, 'kein Seed-Konto für Rolle admin').toBeVisible();
  await knopf.click();
  await page.waitForLoadState('networkidle');
}

test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string; slug: string }[]>(
    `select id, slug from mandant where slug = 'bau'`);
  mandantSlug = m!.slug;

  const [k] = await sql.unsafe<{ id: string }[]>(
    `select id from kunde where mandant_id = $1 limit 1`, [m!.id]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     select $1, 'AU-E2E-AUFMASS', $2, 'projekt', 'aktiv', 'Rohbau Ost',
            (select id from benutzer limit 1), '2026-01-01'
     on conflict do nothing
     returning id`, [m!.id, k!.id] as never[]);

  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage)
     values ($1,$2,'P-E2E','Rohbau Ost',$3,'hochbau','vob_b') returning id`,
    [m!.id, a!.id, k!.id] as never[]);
  projektId = p!.id;

  const [lv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Rohbau Ost') returning id`,
    [m!.id, projektId] as never[]);
  lvId = lv!.id;

  /**
   * Die OZ-Probe: `1.2.9`, `1.2.10` und `1.2.100` unter einem Titel. Eine
   * Textsortierung stellte `1.2.10` VOR `1.2.9` — in einem LV mit
   * vierhundert Zeilen faellt das niemandem auf.
   */
  const [titel] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, oz, pfad,
                              sortier_pfad, ebene, art, kurztext)
     values ($1,$2,$3,'1.2','','',1,'titel','Mauerarbeiten') returning id`,
    [m!.id, lvId, projektId] as never[]);
  for (const [oz, menge, preis] of [
    ['1.2.9', '3.333', 1299], ['1.2.10', '17.500', 2450], ['1.2.100', '0.125', 99],
  ] as const) {
    await sql.unsafe(
      `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, eltern_id,
                                oz, pfad, sortier_pfad, ebene, art, kurztext, einheit,
                                menge_vertrag, einheitspreis_cent)
       values ($1,$2,$3,$4,$5,'','',2,'position','Mauerwerk','m²',$6::numeric,$7::bigint)`,
      [m!.id, lvId, projektId, titel!.id, oz, menge, preis] as never[]);
  }

  const [pos] = await sql.unsafe<{ id: string }[]>(
    `select id from lv_position where leistungsverzeichnis_id = $1 and oz = '1.2.9'`, [lvId]);

  const blatt = async (nummer: string): Promise<string> => {
    const [b] = await sql.unsafe<{ id: string }[]>(
      `insert into aufmass (mandant_id, projekt_id, kunde_id, nummer, bezeichnung, messdatum,
                            erhebungsart, leistungsverzeichnis_id)
       values ($1,$2,$3,$4,'Wand Achse C, OG1','2026-09-10','gemeinsam',$5) returning id`,
      [m!.id, projektId, k!.id, nummer, lvId] as never[]);
    await sql.unsafe(
      `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id, lv_position_id,
                                  reihenfolge, bezeichnung, rechenansatz, ergebnis_skaliert,
                                  menge, einheit)
       values ($1,$2,$3,$3,$4,1,'Wand Achse C',$5,308700,30.870,'m²')`,
      [m!.id, b!.id, projektId, pos!.id, FORMEL] as never[]);
    return b!.id;
  };

  aufmassOhneFoto = await blatt('A-E2E-1');
  aufmassMitFoto = await blatt('A-E2E-2');

  // Das Messfoto des zweiten Blattes — ohne es gibt es keine Gegenzeichnung.
  const [medium] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad,
                                 mime_typ, groesse_bytes, sha256, erstellt_von_art)
     values ($1,'aufmass',$2,'foto','einsatz-medien',$3,'image/jpeg',12345,repeat('a',64),
             'system')
     returning id`,
    [m!.id, aufmassMitFoto, `${m!.id}/${crypto.randomUUID()}`] as never[]);
  await sql.unsafe(
    `insert into aufmass_foto (mandant_id, aufmass_id, kunde_id, medien_id, zweck,
                               erstellt_von_art)
     values ($1,$2,$3,$4,'nachweis','system')`,
    [m!.id, aufmassMitFoto, k!.id, medium!.id] as never[]);
});

test.afterAll(async () => { await sql.end(); });

test.describe('(1) Formel und Ergebnis stehen nebeneinander', () => {
  test('das Blatt zeigt den Rechenansatz wörtlich und 30,87 m² daneben', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/${aufmassMitFoto}`);

    const zeile = page.locator('[data-cse="aufmass-zeile"]').first();
    await expect(zeile.locator('[data-cse="rechenansatz"]')).toHaveText(FORMEL);
    await expect(zeile.locator('[data-cse="ergebnis"]')).toContainText(`${ERGEBNIS} m²`);
    // Und die ganze Zahl steht am Element — sie ist der gespeicherte Wert.
    await expect(zeile.locator('[data-cse="ergebnis"]'))
      .toHaveAttribute('data-skaliert', '308700');
  });

  test('und das Probefeld rechnet auf dem SERVER, während man tippt', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/neu`);
    await page.locator('input[name="probe"]').fill(FORMEL);
    await page.locator('input[name="einheit"]').fill('m²');
    await page.getByRole('button', { name: 'Berechnen' }).click();

    const ergebnis = page.locator('[data-cse="probe-ergebnis"]');
    await expect(ergebnis).toContainText(FORMEL);
    await expect(ergebnis).toContainText(`${ERGEBNIS} m²`);
  });
});

test.describe('(2) ein fremdes Zeichen wird mit der Stelle zurückgewiesen', () => {
  test('„4,20 × 2,75 % 3" nennt Zeichen 13 und rechnet nicht', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/neu`);
    await page.locator('input[name="probe"]').fill('4,20 × 2,75 % 3');
    await page.getByRole('button', { name: 'Berechnen' }).click();

    const fehler = page.locator('[data-cse="probe-fehler"]');
    // Der Offset zaehlt ab 0, die Anzeige ab 1 — der Mensch zaehlt ab 1.
    await expect(fehler).toContainText('Zeichen 13');
    await expect(page.locator('[data-cse="probe-ergebnis"]')).toHaveCount(0);
  });

  test('und eine halbe Formel ist ein Hinweis, kein Absturz', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/neu`);
    await page.locator('input[name="probe"]').fill('3 × (4,20');
    await page.getByRole('button', { name: 'Berechnen' }).click();
    await expect(page.locator('[data-cse="probe-fehler"]')).toBeVisible();
  });
});

test.describe('(4) die OZ-Ordnung und die Summen im Baum', () => {
  test('1.2.10 steht hinter 1.2.9 — sichtbar, in dieser Reihenfolge', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/lv`);

    const ozs = await page.locator('[data-cse="lv-zeile"]').evaluateAll(
      (zeilen) => zeilen.map((z) => z.getAttribute('data-oz')));
    expect(ozs).toEqual(['1.2', '1.2.9', '1.2.10', '1.2.100']);
  });

  test('und die Σ des Titels ist die Summe seiner Positionen — auf den Cent', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/lv`);

    // 3,333 × 12,99 € = 43,30 € · 17,500 × 24,50 € = 428,75 € · 0,125 × 0,99 € = 0,12 €
    const titel = page.locator('[data-cse="lv-zeile"][data-oz="1.2"]');
    await expect(titel.locator('[data-cse="lv-teilsumme"]')).toContainText('472,17');
    await expect(page.locator('[data-cse="lv-summe"]')).toContainText('472,17');
  });
});

test.describe('(3) ohne Messfoto keine Gegenzeichnung', () => {
  test('das Blatt ohne Foto zeigt den Grund statt eines Knopfes', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/${aufmassOhneFoto}`);

    await expect(page.locator('[data-cse="hindernisse"]')).toContainText('Messfoto');
    await expect(page.locator('[data-cse="gegenzeichnung"]')).toHaveCount(0);
  });

  test('mit Foto lässt es sich gegenzeichnen — und ist danach unveränderlich', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/${aufmassMitFoto}`);

    const formular = page.locator('[data-cse="gegenzeichnung"]');
    await expect(formular).toBeVisible();
    await formular.locator('input[name="unterzeichner_name"]').fill('Frau Beyer');
    await formular.locator('input[name="unterzeichner_funktion"]').fill('Bauleiterin AG');
    await page.getByRole('button', { name: 'Gegenzeichnen' }).click();
    await page.waitForLoadState('networkidle');

    // Die Unterschrift steht mit ihrem Digest da …
    await expect(page.locator('[data-cse="signatur"]')).toContainText('Frau Beyer');
    await expect(page.locator('[data-cse="signatur"]')).toContainText('SHA-256');
    // … und das Formular ist weg: ab hier ist das Blatt eingefroren.
    await expect(page.locator('[data-cse="gegenzeichnung"]')).toHaveCount(0);
  });
});
