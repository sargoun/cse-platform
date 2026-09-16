/**
 * Die Vergabemappe im Browser (RAD-07, D-07, D-492).
 *
 * Geprüft wird das, was keine Einheitsprüfung zeigen kann:
 *
 *  1. Der Weg dorthin existiert: „In Bearbeitung" öffnet die Mappe, und von
 *     der Bekanntmachung führt ein Link hin.
 *  2. Der Zähler zeigt, was fehlt — und „liegt vor" zählt NICHT als erledigt
 *     (D-492). Freigeben wird abgewiesen, solange eine Pflichtzeile offen ist.
 *  3. **Nirgends ein Knopf, der einreicht** (D-07). Was es gibt, ist ein
 *     Formular, das festhält, was ein Mensch getan hat — ohne Feld für „wer".
 *  4. Ohne Dokumentenspeicher wird NICHTS gespeichert, und die Seite sagt es.
 *  5. Die leere Prüfliste sagt, warum sie leer ist (O-194) — statt eine
 *     erfundene Vorlage zu zeigen, die vollständig aussieht.
 */
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/**
 * Die Demomappe auf den Seed-Stand zurücksetzen.
 *
 * **Warum das sein muss.** Ein Test hier reicht ein, und eine eingereichte
 * Mappe lässt sich nicht mehr umsortieren — richtig so, aber der nächste Lauf
 * fände die Formulare nicht mehr. Deshalb dasselbe Vorgehen wie bei der
 * Codebremse in `anmeldung.spec`: der Test räumt seine Spur weg, statt die
 * Zusage zu lockern, die er gerade geprüft hat.
 */
async function mappeZuruecksetzen(): Promise<void> {
  await sql`
    update ausschreibung_vorgang v
       set status = 'in_bearbeitung', entschieden_am = null, zuschlagswert_cent = null
      from vergabemappe m, ausschreibung a
     where m.ausschreibung_vorgang_id = v.id and a.id = v.ausschreibung_id
       and a.quell_id = 'demo-2026-0001'`;
  await sql`
    update vergabemappe m
       set status = 'in_arbeit', eingereicht_von = null, eingereicht_am = null,
           eingereicht_ueber_plattform_id = null, eingereicht_ueber_text = null,
           einreichung_kennzeichen = null, einreichung_beleg_dokument_id = null,
           freigegeben_von = null, freigegeben_am = null
      from ausschreibung_vorgang v, ausschreibung a
     where m.ausschreibung_vorgang_id = v.id and a.id = v.ausschreibung_id
       and a.quell_id = 'demo-2026-0001'`;
  /* Was ein Lauf ergänzt hat, fliegt wieder heraus: sechs Zeilen, wie geseedet. */
  await sql`
    delete from vergabemappe_position p
     using vergabemappe m, ausschreibung_vorgang v, ausschreibung a
     where p.vergabemappe_id = m.id and m.ausschreibung_vorgang_id = v.id
       and a.id = v.ausschreibung_id and a.quell_id = 'demo-2026-0001'
       and p.position > 6`;
  await sql`
    update vergabemappe_position p
       set status = 'offen', luecke_hinweis = null
      from vergabemappe m, ausschreibung_vorgang v, ausschreibung a
     where p.vergabemappe_id = m.id and m.ausschreibung_vorgang_id = v.id
       and a.id = v.ausschreibung_id and a.quell_id = 'demo-2026-0001'
       and p.dokument_id is null and p.status <> 'offen'`;
}

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

/** Die Reinigungsausschreibung, auf der die Demomappe liegt. */
async function zurMappe(page: Page): Promise<void> {
  await page.goto('/portal/reinigung/radar');
  await page.locator('[data-cse="tabelle"] a', { hasText: 'Unterhaltsreinigung von drei' })
    .first().click();
  await page.waitForURL(/\/radar\/[0-9a-f-]{36}$/u);
  await page.locator('[data-cse="radar-zur-mappe"]').click();
  await page.waitForURL(/\/mappe$/u);
}

test.describe('Vergabemappe (Phase 8, PR 70)', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(mappeZuruecksetzen);
  test.afterAll(async () => {
    await mappeZuruecksetzen();
    await sql.end();
  });

  test('von der Bekanntmachung fuehrt ein Weg in die Mappe — mit dem Zaehler', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);

    await expect(page.getByRole('heading', { name: 'Vergabemappe', level: 1 })).toBeVisible();

    const zaehler = page.locator('[data-cse="mappe-zaehler"]');
    const gesamt = Number(await zaehler.getAttribute('data-gesamt'));
    const erledigt = Number(await zaehler.getAttribute('data-erledigt'));
    expect(gesamt, 'die Demomappe hat Pflichtpositionen').toBeGreaterThan(0);
    expect(erledigt, 'und sie ist mit Absicht nicht fertig').toBeLessThan(gesamt);
    await expect(zaehler).toContainText('Pflichtpositionen geprüft');

    /* Was fehlt, steht im Klartext — das ist der eigentliche Zweck der Mappe. */
    await expect(page.locator('[data-cse="mappe-luecken"]')).toContainText('Formblatt 124');

    /* Jede Zeile traegt ihren Stand als Attribut, nicht nur als Farbe. */
    const zeilen = page.locator('[data-cse="mappe-position"]');
    await expect(zeilen).not.toHaveCount(0);
    await expect(page.locator('[data-cse="mappe-position"][data-stand="geprueft"]').first())
      .toBeVisible();
    await expect(page.locator('[data-cse="mappe-position"][data-stand="offen"]').first())
      .toBeVisible();
  });

  test('freigeben wird abgewiesen, solange eine Pflichtzeile offen ist', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);

    await page.locator('[data-cse="mappe-freigeben"]').click();
    await page.waitForURL(/fehler=/u);
    await expect(page.locator('[data-cse="mappe-fehler"]')).toContainText('Pflichtposition');
  });

  test('„gilt nicht" ohne Begruendung wird abgewiesen — mit Begruendung geht es', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);

    await page.locator('[data-cse="position-nicht-zutreffend"]').click();
    await page.waitForURL(/fehler=begruendung/u);
    await expect(page.locator('[data-cse="mappe-fehler"]')).toContainText('Begründung');

    await page.fill('[data-cse="mappe-positionsstand"] input[name="hinweis"]',
      'Diese Forderung gilt nur für Bauleistungen.');
    await page.locator('[data-cse="position-nicht-zutreffend"]').click();
    await page.waitForURL(/vermerkt=mappe/u);
    await expect(page.locator('[data-cse="mappe-vermerkt"]')).toBeVisible();
  });

  test('eine neue Position landet am Ende der Pruefliste', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);
    const vorher = await page.locator('[data-cse="mappe-position"]').count();

    await page.fill('[data-cse="mappe-position-neu"] input[name="bezeichnung"]',
      'Tariftreue- und Mindestlohnerklärung');
    await page.locator('[data-cse="position-hinzufuegen"]').click();
    await page.waitForURL(/vermerkt=mappe/u);

    await expect(page.locator('[data-cse="mappe-position"]')).toHaveCount(vorher + 1);
    await expect(page.locator('[data-cse="mappe-positionen"]'))
      .toContainText('Tariftreue- und Mindestlohnerklärung');
  });

  /**
   * **Die Gegenrichtung zum Hinzufügen** (D-577).
   *
   * `entfernePosition` gab es im Dienst seit PR 70, und keine Adresse rief
   * sie: die Prüfliste wuchs und schrumpfte nie. Diese Zusicherung geht den
   * Weg, den ein Mensch geht — Zeile anlegen, Zeile wieder wegnehmen —, denn
   * genau das war die Lücke: gebaut, geprüft, und vom Bildschirm aus nicht
   * erreichbar.
   */
  test('eine vertippte Zeile laesst sich wieder wegnehmen', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);
    const vorher = await page.locator('[data-cse="mappe-position"]').count();

    await page.fill('[data-cse="mappe-position-neu"] input[name="bezeichnung"]',
      'Tariftreueerklaerunggg');
    await page.locator('[data-cse="position-hinzufuegen"]').click();
    await page.waitForURL(/vermerkt=mappe/u);
    await expect(page.locator('[data-cse="mappe-position"]')).toHaveCount(vorher + 1);

    /*
     * Der Knopf der LETZTEN Zeile — die neue steht am Ende der Liste
     * (`ergaenzePosition` vergibt `max(position) + 1`). Genau darum steht der
     * Knopf an der Zeile und nicht in einem Auswahlfeld: hier ist sichtbar,
     * welche Zeile verschwindet.
     */
    await page.locator('[data-cse="position-entfernen"]').last().click();
    await page.waitForURL(/vermerkt=mappe/u);

    await expect(page.locator('[data-cse="mappe-position"]')).toHaveCount(vorher);
    await expect(page.locator('[data-cse="mappe-positionen"]'))
      .not.toContainText('Tariftreueerklaerunggg');
  });

  test('ohne Dokumentenspeicher wird NICHTS gespeichert — und die Seite sagt es', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);

    await page.setInputFiles('[data-cse="mappe-unterlage"] input[name="datei"]', {
      name: 'formblatt-124.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<<>>\nendobj\n', 'latin1'),
    });
    await page.locator('[data-cse="unterlage-beilegen"]').click();
    await page.waitForURL(/fehler=/u);
    /*
     * Beides ist eine ehrliche Antwort: ohne Anbieter „nicht verbunden", mit
     * Anbieter waere die Datei abgelegt. Was NICHT vorkommen darf, ist eine
     * Erfolgsmeldung ohne Speicher — und genau die faengt diese Zusicherung ab.
     */
    await expect(page.locator('[data-cse="mappe-fehler"]')).toContainText(
      /nicht verbunden|abgewiesen/u);
    await expect(page.locator('[data-cse="mappe-vermerkt"]')).toHaveCount(0);
  });

  test('das Einreichungsformular fragt nicht, WER eingereicht hat (D-07)', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);
    await page.locator('[data-cse="mappe-zur-einreichung"]').click();
    await page.waitForURL(/\/mappe\/einreichung$/u);

    await expect(page.locator('[data-cse="einreichung-d07"]')).toContainText('D-07');
    /* Kein Katalog, und die Seite sagt warum (O-07). */
    await expect(page.locator('[data-cse="einreichung-katalog-leer"]')).toContainText('O-07');
    /* Kein Feld fuer die Person und keines fuer den Zeitpunkt. */
    await expect(page.locator('[data-cse="einreichung-wer"]')).toContainText('angemeldete Person');
    expect(await page.locator('input[name="eingereicht_von"]').count()).toBe(0);
    expect(await page.locator('input[name="eingereicht_am"]').count()).toBe(0);

    /* Ohne Plattform keine Erfassung. */
    await page.locator('[data-cse="einreichung-speichern"]').click();
    await page.waitForURL(/fehler=plattform/u);
    await expect(page.locator('[data-cse="einreichung-fehler"]')).toContainText('Plattform');
  });

  test('die Einreichung wird erfasst — mit Mensch, Zeitpunkt und Plattform', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);
    await page.locator('[data-cse="mappe-zur-einreichung"]').click();
    await page.waitForURL(/\/mappe\/einreichung$/u);

    await page.fill('input[name="plattform_text"]', 'Vergabemarktplatz Berlin');
    await page.fill('input[name="kennzeichen"]', 'AZ-2026-4711');
    await page.locator('[data-cse="einreichung-speichern"]').click();
    await page.waitForURL(/\/mappe\?vermerkt=eingereicht$/u);

    const beleg = page.locator('[data-cse="mappe-eingereicht"]');
    await expect(beleg).toContainText('Vergabemarktplatz Berlin');
    await expect(beleg).toContainText('AZ-2026-4711');
    await expect(beleg, 'die Plattform hat nichts uebertragen — ein Mensch hat es getan')
      .toContainText('D-07');

    /* Danach ist die Mappe gesperrt: kein Formular, das sie noch umsortiert. */
    expect(await page.locator('[data-cse="mappe-stand-formular"]').count()).toBe(0);
    expect(await page.locator('[data-cse="mappe-position-neu"]').count()).toBe(0);
  });

  /**
   * **Ohne Ausgang kein Bericht** (REP-06). „Gefunden · geprüft · geboten ·
   * gewonnen" ist nicht zu rechnen, solange niemand festhalten kann, wie ein
   * Verfahren endete — und ein Ergebnis vor der Abgabe ist keines.
   */
  test('das Ergebnis wird erfasst — aber erst nach der Einreichung (REP-06)', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await zurMappe(page);

    /* Vor der Einreichung gibt es das Formular gar nicht. */
    expect(await page.locator('[data-cse="ausgang-formular"]').count()).toBe(0);

    await page.locator('[data-cse="mappe-zur-einreichung"]').click();
    await page.waitForURL(/\/mappe\/einreichung$/u);
    await page.fill('input[name="plattform_text"]', 'Vergabemarktplatz Berlin');
    await page.locator('[data-cse="einreichung-speichern"]').click();
    await page.waitForURL(/\/mappe\?vermerkt=eingereicht$/u);

    await page.fill('[data-cse="ausgang-formular"] input[name="entschieden_am"]', '2026-11-02');
    await page.fill('[data-cse="ausgang-formular"] input[name="wert"]', '486.000,00');
    await page.locator('[data-cse="ausgang-zuschlag"]').click();
    await page.waitForURL(/vermerkt=ausgang/u);

    const erfasst = page.locator('[data-cse="mappe-ausgang-erfasst"]');
    await expect(erfasst).toContainText('Zuschlag erhalten');
    await expect(erfasst, 'der Auftragswert in ganzen Cent, deutsch formatiert')
      .toContainText('486.000,00');
  });
});
