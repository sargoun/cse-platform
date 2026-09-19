/**
 * Die zweisprachige Website (D-82) im Browser.
 *
 * Drei Zusagen lassen sich nur hier prüfen: dass `<html lang>` wirklich
 * umschaltet (WCAG 3.1.1 — ein Screenreader liest sonst englischen Text mit
 * deutscher Aussprache), dass die Sprachwahl auf DIESELBE Seite führt und
 * nicht auf die Startseite, und dass `hreflang` im ausgelieferten Kopf steht.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

test.describe('(1) `<html lang>` folgt der Seite', () => {
  test('deutsch unter /, englisch unter /en', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');

    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('auch auf einer Unterseite und im Formular', async ({ page }) => {
    await page.goto('/en/kontakt');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto('/en/angebot/reinigung');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto('/angebot/reinigung');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
  });
});

test.describe('(2) die Sprachwahl bleibt auf der Seite', () => {
  test('von /kontakt nach /en/kontakt — nicht auf die Startseite', async ({ page }) => {
    await page.goto('/kontakt');
    await page.locator('[data-cse="sprachwahl"] a[data-sprache="en"]').click();
    // Wer beim Sprachwechsel seinen Platz verliert, wechselt kein zweites Mal.
    await expect(page).toHaveURL(/\/en\/kontakt$/u);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('und wieder zurück', async ({ page }) => {
    await page.goto('/en/leistungen');
    await page.locator('[data-cse="sprachwahl"] a[data-sprache="de"]').click();
    await expect(page).toHaveURL(/\/leistungen$/u);
    await expect(page).not.toHaveURL(/\/en\//u);
  });

  test('die aktive Sprache ist als solche ausgezeichnet', async ({ page }) => {
    await page.goto('/en');
    const aktiv = page.locator('[data-cse="sprachwahl"] a[data-sprache="en"]');
    await expect(aktiv).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-cse="sprachwahl"] a[data-sprache="de"]'))
      .not.toHaveAttribute('aria-current', 'true');
  });
});

test.describe('(3) hreflang und canonical stehen im ausgelieferten Kopf', () => {
  test('beide Fassungen nennen einander — gegenseitig', async ({ page }) => {
    for (const pfad of ['/kontakt', '/en/kontakt']) {
      await page.goto(pfad);
      const alternates = await page.locator('link[rel="alternate"][hreflang]')
        .evaluateAll((ls) => ls.map((l) => [
          l.getAttribute('hreflang'), l.getAttribute('href'),
        ]));
      const karte = Object.fromEntries(alternates);
      /**
       * Google wertet `hreflang` nur bei gegenseitigen Verweisen aus. Nennte
       * nur die englische Seite ihre deutsche Fassung, konkurrierten beide um
       * dieselbe Suchanfrage, statt sich zu ergänzen.
       */
      expect(karte['de-DE'], pfad).toMatch(/\/kontakt$/u);
      expect(karte['en'], pfad).toMatch(/\/en\/kontakt$/u);
      expect(karte['x-default'], pfad).toMatch(/\/kontakt$/u);
    }
  });

  test('canonical zeigt auf die eigene Sprachfassung, nicht auf die deutsche',
    async ({ page }) => {
      await page.goto('/en/leistungen');
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      // Ein canonical auf die deutsche Fassung nähme die englische Seite aus
      // dem Index — gebaut, verlinkt und unauffindbar.
      expect(canonical).toMatch(/\/en\/leistungen$/u);
    });
});

test.describe('(4) jede öffentliche Route gibt es auf Englisch', () => {
  for (const r of OEFFENTLICHE_ROUTEN) {
    const en = r.pfad === '/' ? '/en' : `/en${r.pfad}`;
    test(`200 und englischer Inhalt: ${en}`, async ({ page }) => {
      const antwort = await page.goto(en);
      expect(antwort?.status(), en).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      // Die Hülle ist übersetzt — nicht nur der Rahmen um deutschen Text.
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeAttached();
    });
  }

  test('auch die Barrierefreiheitserklärung', async ({ page }) => {
    const antwort = await page.goto('/en/barrierefreiheit');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Accessibility statement');
    // Und sie sagt, dass die deutsche Fassung gilt.
    await expect(page.locator('[data-cse="rechtshinweis"]')).toContainText('German');
  });
});

test.describe('(5) das englische Formular ist englisch — Felder wie Knopf', () => {
  test('Beschriftungen, Auswahlwerte und Absendeknopf', async ({ page }) => {
    await page.goto('/en/angebot/reinigung');
    await expect(page.locator('label[for="f_gebaeudetyp"]')).toHaveText(/Type of building/u);
    await expect(page.locator('button[type="submit"]')).toHaveText('Send enquiry');

    // Die WERTE bleiben deutsch — sie sind der gespeicherte Inhalt, nicht die
    // Anzeige. Übersetzte Werte hiessen: in `formular_eingang` steht je nach
    // Sprache etwas anderes, und keine Auswertung ginge mehr über beide.
    const werte = await page.locator('#f_gebaeudetyp option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(werte).toContain('buero');
    const beschriftungen = await page.locator('#f_gebaeudetyp option')
      .evaluateAll((os) => os.map((o) => o.textContent));
    expect(beschriftungen).toContain('Office building');
  });

  test('und das deutsche bleibt deutsch', async ({ page }) => {
    await page.goto('/angebot/reinigung');
    await expect(page.locator('label[for="f_gebaeudetyp"]')).toHaveText(/Gebäudetyp/u);
    await expect(page.locator('button[type="submit"]')).toHaveText('Anfrage senden');
  });

  test('und die ANTWORT ist englisch — nicht nur das Formular', async ({ page }) => {
    /**
     * Die Sprache reist als verstecktes Feld mit. Ohne sie antwortete
     * `/api/anfrage` deutsch, und zwar an der Stelle, an der jemand etwas
     * kaufen wollte.
     *
     * Der Test schickt WIRKLICH ab. Ein Test, der nur das versteckte Feld im
     * Markup sucht, bestuende auch dann, wenn die Route es ignoriert — oder,
     * wie beim ersten Versuch, wenn sie es als unbekanntes Formularfeld
     * abweist und die ganze Absendung bricht.
     */
    await page.goto('/en/angebot/reinigung');
    await expect(page.locator('input[name="sprache"]')).toHaveValue('en');

    await page.selectOption('#f_gebaeudetyp', 'buero');
    await page.fill('#f_flaeche_qm', '250');
    await page.fill('#f_anzahl_objekte', '2');
    await page.selectOption('#f_frequenz', 'woechentlich');
    await page.fill('#f_wunsch_start', '2026-10-01');
    await page.fill('#f_firma', `EN Test ${String(Date.now())}`);
    await page.fill('#f_name', 'A. Sample');
    await page.fill('#f_email', 'a@sample.test');
    await page.fill('#f_telefon', '+49 30 5550101');
    await page.check('#f_datenschutz_hinweis');

    const [antwort] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/anfrage') && r.request().method() === 'POST',
      ),
      page.click('button[type="submit"]'),
    ]);
    /*
     * **303 statt 200, und die Zusage ist dieselbe geblieben.**
     *
     * Frueher antwortete `/api/anfrage` mit JSON, und dieser Fall las den
     * englischen Danksatz aus dem Koerper. Seit D-599 schickt die Route den
     * Browser auf die Dankseite — das Formular hat kein JavaScript, und ein
     * Besucher landete sonst auf `{"ok":true,…}`. Geprueft wird deshalb
     * dasselbe an der neuen Stelle: die SEITE ist englisch, nicht der
     * JSON-Text.
     */
    expect(antwort.status()).toBe(303);
    await page.waitForURL(/\/en\/angebot\/reinigung\/danke\?nr=/u);

    const seite = await page.locator('[data-cse="angebot-danke"]').innerText();
    expect(seite).toContain('Your enquiry has arrived');
    // Und ausdruecklich NICHT die deutsche Fassung.
    expect(seite).not.toContain('Vielen Dank');
    expect(seite).not.toContain('Ihre Anfrage ist angekommen');
  });

  test('auch eine ABWEISUNG ist englisch — bis in die Feldmeldung', async ({ page }) => {
    /**
     * Die Validierung laeuft gegen `formular_definition`, und die ist deutsch
     * (D-83). Ohne Uebersetzung der ANZEIGE bekam ein englisches Formular
     * englische Beschriftungen und daneben deutsche Fehler — genau der
     * Zustand, den der erste Lauf dieses Tests zutage gefoerdert hat.
     */
    await page.goto('/en/angebot/reinigung');
    // Absichtlich unvollstaendig: nur das Pflichtfeld `anzahl_objekte` fehlt.
    await page.selectOption('#f_gebaeudetyp', 'buero');
    await page.fill('#f_flaeche_qm', '250');
    await page.selectOption('#f_frequenz', 'woechentlich');
    await page.fill('#f_wunsch_start', '2026-10-01');
    await page.fill('#f_firma', `EN Fehler ${String(Date.now())}`);
    await page.fill('#f_name', 'A. Sample');
    await page.fill('#f_email', 'a@sample.test');
    await page.fill('#f_telefon', '+49 30 5550102');
    await page.check('#f_datenschutz_hinweis');

    const [antwort] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/anfrage') && r.request().method() === 'POST',
      ),
      page.click('button[type="submit"]'),
    ]);
    /*
     * **Auch die ABWEISUNG kommt jetzt als Seite zurueck** (D-599) — und sie
     * traegt die FELDmeldungen mit, nicht nur den Sammelsatz. Der erste
     * Entwurf der Weiche haengte nur „Bitte pruefen Sie Ihre Eingaben" an die
     * Adresse; damit haette dieser Fall gruen sein koennen, waehrend der
     * Besucher weniger erfaehrt als vorher. Ein Formular ohne JavaScript ist
     * kein Grund, weniger zu sagen.
     */
    expect(antwort.status()).toBe(303);
    await page.waitForURL(/\/en\/angebot\/reinigung\?/u);

    /* Die Meldung steht AM FELD, mit `aria-invalid` — nicht in einem Sammelsatz. */
    const feld = page.locator('#f_anzahl_objekte');
    await expect(feld).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#f_anzahl_objekte_fehler'))
      .toHaveText('Please tell us how many properties this concerns.');
  });
});

test.describe('(6) die Maschinenflächen kennen beide Sprachen', () => {
  test('die Sitemap führt jede Seite in beiden Sprachen, mit Alternativen',
    async ({ request }) => {
      const antwort = await request.get('/sitemap.xml');
      expect(antwort.status()).toBe(200);
      const xml = await antwort.text();
      expect(xml).toContain('/en/kontakt');
      expect(xml).toContain('hreflang="en"');
      expect(xml).toContain('hreflang="x-default"');
    });

  test('llms.txt nennt die englische Fassung — ohne jede Seite zu verdoppeln',
    async ({ request }) => {
      const text = await (await request.get('/llms.txt')).text();
      expect(text).toContain('## Sprachen');
      expect(text).toMatch(/\/en/u);
      // Genau EINE Zeile je Seite: eine verdoppelte Liste läse sich für ein
      // Sprachmodell wie zwei verschiedene Seiten.
      const kontaktZeilen = text.split('\n').filter((z) => z.includes('](') && z.includes('/kontakt'));
      expect(kontaktZeilen).toHaveLength(1);
    });
});

test.describe('(7) barrierefrei in beiden Sprachen', () => {
  for (const pfad of ['/en', '/en/leistungen', '/en/angebot/reinigung', '/en/barrierefreiheit']) {
    test(`axe: ${pfad}`, async ({ page }) => {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);
      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(
        ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
        pfad,
      ).toEqual([]);
    });
  }

  test('kein waagerechtes Scrollen bei 375px', async ({ page }) => {
    // Zwei zusätzliche Links im 72px-Kopf sind genau die Art Ergänzung, die
    // eine Kopfzeile auf einem Telefon zum Überlaufen bringt.
    await page.setViewportSize({ width: 375, height: 800 });
    for (const pfad of ['/', '/en']) {
      await page.goto(pfad);
      const ueberlauf = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(ueberlauf, pfad).toBe(false);
    }
  });

  /**
   * **Der Auftrittsname wird auf dem Telefon nicht gekürzt** (DESIGN §5,
   * D-415).
   *
   * Der Test darüber war grün, WEIL gekürzt wurde: `truncate` hält
   * `scrollWidth` klein, und die Zusage „kein waagerechtes Scrollen" war
   * damit erfüllt, während im Kopf „CSE Gr…" stand — auf jeder öffentlichen
   * Seite, auf jedem Telefon zwischen 360px und 414px. Eine Zusage, die eine
   * andere verdeckt, braucht die zweite daneben.
   */
  for (const breite of [360, 375, 390, 414]) {
    test(`der Auftrittsname steht vollständig im Kopf (${String(breite)}px)`, async ({ page }) => {
      await page.setViewportSize({ width: breite, height: 800 });
      await page.goto('/');
      const marke = page.locator('header a[aria-label] span').first();
      const mass = await marke.evaluate((el) => ({
        sichtbar: Math.round(el.getBoundingClientRect().width),
        noetig: el.scrollWidth,
        text: el.textContent ?? '',
      }));
      expect(mass.text.length, 'kein Auftrittsname im Kopf').toBeGreaterThan(0);
      expect(
        mass.noetig,
        `„${mass.text}" ist bei ${String(breite)}px gekürzt: ${String(mass.noetig)}px `
        + `nötig, ${String(mass.sichtbar)}px sichtbar`,
      ).toBeLessThanOrEqual(mass.sichtbar);
    });
  }

  test('die Sprachwahl liegt auf dem Telefon im Menü und wechselt dort', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');

    // Im Kopf ist sie unter `md` nicht sichtbar — sie ist der Platz, den der
    // Auftrittsname braucht.
    await expect(page.locator('[data-cse="sprachwahl"]')).toBeHidden();

    await page.locator('[data-cse="menue"] summary').click();
    const nachEnglisch = page.locator('[data-cse="menue-sprache"][data-sprache="en"]');
    await expect(nachEnglisch).toBeVisible();
    await nachEnglisch.click();

    await expect(page).toHaveURL(/\/en$/u);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Und zurück: auf der englischen Seite führt der Punkt nach Deutsch.
    await page.locator('[data-cse="menue"] summary').click();
    await page.locator('[data-cse="menue-sprache"][data-sprache="de"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
  });
});
