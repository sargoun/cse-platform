/**
 * PR 17 Akzeptanz (1) und (4) — die ROADMAP-Zusage für Phase 2, im Browser.
 *
 * "Das Reinigungsformular, abgeschickt bei 375 px, erzeugt binnen eines
 * Neuladens einen Lead mit Frist, Quelle und Besitzer." Das ist die
 * Abnahmebedingung der ganzen Phase, und sie wird hier so geprüft, wie sie
 * dasteht: auf einem Telefonschirm, mit echtem Absenden, und danach in der
 * Übersicht nachgesehen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const FORMULAR = '/angebot/reinigung';

/** Ein Wert je Pflichtfeld — so, wie ein Mensch ihn eintippen würde. */
async function fuelleAus(page: Page, firma: string): Promise<void> {
  await page.selectOption('#f_gebaeudetyp', 'buero');
  await page.fill('#f_flaeche_qm', '250');
  await page.fill('#f_anzahl_objekte', '2');
  await page.selectOption('#f_frequenz', 'woechentlich');
  await page.fill('#f_wunsch_start', '2026-10-01');
  await page.fill('#f_firma', firma);
  await page.fill('#f_name', 'A. Muster');
  await page.fill('#f_email', 'a@muster.test');
  await page.fill('#f_telefon', '+49 30 5550100');
  await page.check('#f_datenschutz_hinweis');
}

test.describe('(1) Phase-2-Abnahme: Formular bei 375 px → Lead mit Frist und Besitzer', () => {
  test('abgeschickt am Telefon, sichtbar im Posteingang', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(FORMULAR);

    // Kein waagerechtes Scrollen — ein Formular, das seitlich wegläuft, füllt
    // niemand auf einer Baustelle aus.
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(ueberlauf).toBe(false);

    const firma = `Testfirma ${String(Date.now())}`;
    await fuelleAus(page, firma);

    // Auf die ANTWORT warten, nicht nur klicken: ein sofortiges `goto`
    // bricht die laufende POST-Anfrage ab, und der Test hätte gemeldet, es
    // sei kein Lead entstanden — obwohl er nie abgeschickt wurde.
    const [antwort] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/anfrage') && r.request().method() === 'POST'),
      page.click('button[type="submit"]'),
    ]);
    expect(antwort.status(), await antwort.text()).toBe(200);

    // "Binnen eines Neuladens": die Route antwortet JSON, die Übersicht liest
    // frisch aus der Datenbank.
    await page.goto('/dev/leads');
    const zeile = page.locator('[data-cse="lead-zeile"]', { hasText: firma });
    await expect(zeile).toHaveCount(1);

    // Die Frist steht da — welche, entscheidet der Mandant (O-14).
    await expect(zeile.locator('[data-cse="lead-frist"]')).not.toHaveText('—');
    // Und der Bereich stimmt: eine Reinigungsanfrage gehört `reinigung`.
    await expect(zeile).toContainText('reinigung');
  });

  test('der Honigtopf ist für Menschen unsichtbar und für Screenreader stumm', async ({ page }) => {
    await page.goto(FORMULAR);
    const topf = page.locator('#f_website');
    await expect(topf).toHaveCount(1);
    // `aria-hidden` am Container und `tabindex="-1"`: kein CAPTCHA, das genau
    // die Menschen belastet, für die BFSG gilt.
    await expect(topf).toHaveAttribute('tabindex', '-1');
    const versteckt = await topf.evaluate((e) => e.closest('[aria-hidden="true"]') !== null);
    expect(versteckt).toBe(true);
    await expect(topf).not.toBeInViewport();
  });
});

test.describe('(4) eine Datei, die kein PDF/XLSX ist, wird abgewiesen', () => {
  test('der Inhalt entscheidet, nicht der Dateiname', async ({ request }) => {
    // Als `.pdf` benannt, in Wahrheit Text. Wer dem Namen glaubt, hat die
    // `.exe` im Bucket.
    const antwort = await request.post('/api/anfrage', {
      multipart: {
        bereich: 'bau',
        gewerk: 'hochbau', volumen: '3 Etagen', fertigstellung_bis: '2027-01-01',
        firma: 'Bau Test', name: 'B. Muster', email: 'b@muster.test',
        telefon: '+49 30 5550100', datenschutz_hinweis: 'on',
        lv_datei: {
          name: 'leistungsverzeichnis.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('Das ist kein PDF, sondern Text.'),
        },
      },
    });
    expect(antwort.status()).toBe(415);
    const koerper = (await antwort.json()) as { ok: boolean; felder: Record<string, string> };
    expect(koerper.ok).toBe(false);
    // Die Meldung kommt aus der Felddefinition und sagt, was zu tun ist.
    expect(koerper.felder['lv_datei']).toContain('PDF');
  });

  test('ein echtes PDF scheitert am NICHT VERBUNDENEN Speicher — und sagt das', async ({ request }) => {
    /**
     * Kein simulierter Erfolg (CLAUDE.md "keine Schein-Integrationen"): ohne
     * Supabase-Zugangsdaten gibt es keinen Bucket, und die Antwort sagt genau
     * das — statt die Anfrage ohne die Datei zu speichern, die sie erwähnt.
     */
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj\n<<>>\nendobj\n'),
      Buffer.from('trailer\n<<>>\n%%EOF\n'),
    ]);
    const antwort = await request.post('/api/anfrage', {
      multipart: {
        bereich: 'bau',
        gewerk: 'hochbau', volumen: '3 Etagen', fertigstellung_bis: '2027-01-01',
        firma: 'Bau Test', name: 'B. Muster', email: 'b@muster.test',
        telefon: '+49 30 5550100', datenschutz_hinweis: 'on',
        lv_datei: { name: 'lv.pdf', mimeType: 'application/pdf', buffer: pdf },
      },
    });
    expect(antwort.status()).toBe(503);
    expect((await antwort.text()).toLowerCase()).toContain('nicht verfügbar');
  });
});

test.describe('das Formular ist barrierefrei — es ist der Kanal, auf dem Umsatz ankommt', () => {
  for (const bereich of ['reinigung', 'security', 'bau', 'operations']) {
    test(`axe: /angebot/${bereich}`, async ({ page }) => {
      const antwort = await page.goto(`/angebot/${bereich}`);
      expect(antwort?.status()).toBe(200);
      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(ergebnis.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }

  test('jedes Feld hat ein echtes Label, kein Platzhalter (WCAG 3.3.2)', async ({ page }) => {
    await page.goto(FORMULAR);
    const ohneLabel = await page.locator('[data-cse="formularfeld"]').evaluateAll(
      (felder) => felder.filter((f) => {
        const eingabe = f.querySelector('input, select, textarea');
        if (eingabe === null) return true;
        const id = eingabe.getAttribute('id') ?? '';
        return f.querySelector(`label[for="${id}"]`) === null;
      }).length,
    );
    expect(ohneLabel).toBe(0);
  });

  test('ein Bereich ohne Formular ist 404, kein leeres Formular', async ({ request }) => {
    // Ein Formular ohne Felder sähe aus wie ein Ladefehler und würde
    // abgeschickt, ohne dass jemand anbieten könnte. Alle vier Bereiche haben
    // inzwischen eines (O-61 vorläufig beantwortet), also wird ein erfundener
    // Bereich geprüft.
    expect((await request.get('/angebot/gibtesnicht')).status()).toBe(404);
  });
});
