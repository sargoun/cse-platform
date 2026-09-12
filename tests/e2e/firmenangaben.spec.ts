import { expect, test } from '@playwright/test';

/**
 * § 5 TMG ist eine PFLICHT, und eine unvollstaendige Erfuellung sieht aus wie
 * eine vollstaendige.
 *
 * Auf `/impressum` stand ein Satz: Anschrift und Telefon im Fussbereich,
 * Handelsregister, Umsatzsteuer-Identifikationsnummer und Geschaeftsfuehrung
 * „werden hier je Gesellschaft ergaenzt, sobald die Angaben bestaetigt sind".
 * Die Angaben lagen zu dem Zeitpunkt bereits in `mandant` — dort, wo auch die
 * Rechnung sie hernimmt.
 *
 * Diese Pruefung haelt zwei Dinge fest, die leicht auseinanderlaufen: dass die
 * Angaben ERSCHEINEN, und dass eine FEHLENDE Angabe sichtbar fehlt statt
 * weggelassen zu werden.
 */
test.describe('das Impressum traegt die Pflichtangaben', () => {
  test('jede Gesellschaft mit Firma, Register und USt-IdNr.', async ({ page }) => {
    const antwort = await page.goto('/impressum');
    expect(antwort?.status()).toBe(200);

    const block = page.locator('[data-cse="gesellschaften"]');
    await expect(block).toBeVisible();

    const zeilen = block.locator('[data-cse="gesellschaft"]');
    /*
     * Vier Gesellschaften — dieselbe Zahl wie im Fussbereich und in
     * `mandant`. `toHaveCount` und nicht `first()`: dass es genau vier sind,
     * ist die Zusicherung; eine fuenfte, die niemand ins Impressum nimmt,
     * waere genau der Fehler.
     */
    await expect(zeilen).toHaveCount(4);
    for (const slug of ['reinigung', 'security', 'bau', 'operations']) {
      await expect(block.locator(`[data-slug="${slug}"]`), slug).toHaveCount(1);
    }

    // Die Angaben, die § 5 TMG nennt, stehen als Beschriftungen da.
    await expect(block).toContainText('Handelsregister');
    await expect(block).toContainText('Umsatzsteuer-Identifikationsnummer');
    await expect(block).toContainText('Vertreten durch');

    // Und eine echte Nummer, nicht nur die Beschriftung.
    await expect(block.locator('[data-slug="reinigung"]'))
      .toContainText('Amtsgericht Charlottenburg');
  });

  test('unbestaetigte Angaben sagen es — VOR der Nummer, nicht darunter', async ({ page }) => {
    await page.goto('/impressum');
    const block = page.locator('[data-cse="gesellschaften"]');
    /*
     * Anschrift, Register- und Steuernummer stammen bis zur Bestaetigung aus
     * dem Demonstrationsbestand: `Kurfürstendamm 21`, `HRB 200000`,
     * `DE100000000` — fortlaufend hochgezaehlt, nie erfragt. Sie ohne
     * Kennzeichnung als Angaben nach § 5 TMG auszugeben, waere eine amtlich
     * aussehende Falschauskunft.
     *
     * Diese Pruefung faellt an dem Tag, an dem `angaben_bestaetigt_am` gesetzt
     * wird — und das ist richtig so: dann gehoert sie umgeschrieben, nicht der
     * Hinweis entfernt.
     */
    const warnungen = block.locator('[data-cse="angaben-unbestaetigt"]');
    await expect(warnungen).toHaveCount(4);
    await expect(warnungen.first()).toContainText('§ 5 TMG');

    // Die Reihenfolge ist die Aussage: wer erst die Nummer liest und dann den
    // Hinweis, hat die Nummer schon geglaubt.
    const ersteKarte = block.locator('[data-slug="reinigung"]');
    const stellung = await ersteKarte.evaluate((el) => {
      const w = el.querySelector('[data-cse="angaben-unbestaetigt"]');
      const dl = el.querySelector('dl');
      if (w === null || dl === null) return 'fehlt';
      return (w.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        ? 'davor' : 'danach';
    });
    expect(stellung).toBe('davor');
  });

  test('was fehlt, steht als Fehlendes da — nicht gar nicht', async ({ page }) => {
    await page.goto('/impressum');
    const block = page.locator('[data-cse="gesellschaften"]');
    /*
     * `geschaeftsfuehrer` ist im Seed noch leer. Solange das so ist, MUSS die
     * Seite das sagen: eine ausgelassene Zeile im Impressum liest sich als
     * „diese Angabe gibt es nicht", und das waere eine Aussage ueber die
     * Gesellschaft statt ueber den Datenstand.
     *
     * Wird der Wert eines Tages gesetzt, faellt diese Pruefung — und das ist
     * richtig so: dann gehoert sie umgeschrieben, nicht der Hinweis entfernt.
     */
    await expect(block).toContainText('noch nicht hinterlegt');
  });

  test('auf Englisch dieselbe Auskunft', async ({ page }) => {
    const antwort = await page.goto('/en/impressum');
    expect(antwort?.status()).toBe(200);
    const block = page.locator('[data-cse="gesellschaften"]');
    await expect(block).toBeVisible();
    await expect(block).toContainText('VAT identification number');
    await expect(block.locator('[data-cse="gesellschaft"]')).toHaveCount(4);
  });
});

/**
 * Und dieselbe Frage fuer die Kontaktseite.
 *
 * Sie trug einen Satz, der auf zwei andere Seiten verwies — Impressum fuer
 * Anschrift und Telefon, Angebotsformular fuer alles Weitere. Eine Seite, auf
 * der jemand Kontakt sucht und keinen findet, ist kein Textproblem.
 */
test.describe('die Kontaktseite zeigt die Wege, die sie nennt', () => {
  test('vier Gesellschaften mit Telefon und E-Mail', async ({ page }) => {
    const antwort = await page.goto('/kontakt');
    expect(antwort?.status()).toBe(200);

    const block = page.locator('[data-cse="kontaktwege"]');
    await expect(block).toBeVisible();
    await expect(block.locator('[data-cse="kontaktweg"]')).toHaveCount(4);

    // Anrufbar heisst `tel:` — eine Nummer als Text ist am Telefon kein Weg.
    await expect(block.locator('a[href^="tel:"]').first()).toBeVisible();
    await expect(block.locator('a[href^="mailto:"]').first()).toBeVisible();
  });

  test('drei Bereiche fuehren ins Angebot — `operations` nicht', async ({ page }) => {
    await page.goto('/kontakt');
    const block = page.locator('[data-cse="kontaktwege"]');
    /*
     * `operations` fuehrt die Gruppe und verkauft nichts. Ein „Angebot
     * anfragen" dort fuehrte auf ein Formular, das es nicht gibt — genau der
     * Fehler, gegen den diese Datei geschrieben ist, nur auf der anderen Seite
     * der Anwendung.
     */
    await expect(block.locator('[data-cse="kontakt-angebot"]')).toHaveCount(3);
    await expect(
      block.locator('[data-slug="operations"] [data-cse="kontakt-angebot"]'),
    ).toHaveCount(0);

    const ziel = block.locator('[data-slug="reinigung"] [data-cse="kontakt-angebot"]');
    await expect(ziel).toHaveAttribute('href', '/angebot/reinigung');
    await ziel.click();
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/angebot/reinigung');
  });

  test('auf Englisch fuehrt der Weg nach `/en/angebot/...`', async ({ page }) => {
    await page.goto('/en/kontakt');
    const ziel = page.locator('[data-cse="kontaktwege"] [data-slug="bau"] [data-cse="kontakt-angebot"]');
    await expect(ziel).toHaveAttribute('href', '/en/angebot/bau');
  });
});

/**
 * **Kein deutsches Wort auf der englischen Seite.**
 *
 * D-82 sagt: eine englische Seite ist eine eigene Zeile. Fuer Inhalt gilt das
 * ueber `seite`/`abschnitt`; fuer BEDIENWOERTER ueber `SHELL_TEXTE`. Genau
 * dort fehlten zwei: „Mehr erfahren →" und „Platzhalterbild" standen als
 * Literale in `MarkenKarte` und `Hero`. Beide Komponenten erscheinen auf `/`
 * UND auf `/en` — die englische Startseite las also Deutsch.
 *
 * Das ist kein Schoenheitsfehler. Es ist ein deutsches Wort auf der Seite, die
 * jemand liest, WEIL er kein Deutsch kann; der Kopfkommentar von
 * `src/lib/i18n/texte.ts` sagt es seit dem ersten Tag.
 *
 * Die Pruefung nimmt die englische Startseite und sucht nach den Woertern, die
 * hier schon einmal standen — nicht nach „deutschen Woertern" allgemein: eine
 * Wortliste waere eine Heuristik, und eine Heuristik, die gelegentlich Recht
 * hat, wird beim ersten Fehlalarm abgeschaltet.
 */
test.describe('die englische Seite traegt kein deutsches Bedienwort', () => {
  for (const pfad of ['/en', '/en/unternehmen']) {
    test(`${pfad}: weder „Mehr erfahren" noch „Platzhalterbild"`, async ({ page }) => {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);
      const text = (await page.locator('body').innerText()).toLowerCase();
      for (const wort of ['mehr erfahren', 'platzhalterbild', 'zur startseite']) {
        expect(text, `${pfad} traegt „${wort}"`).not.toContain(wort);
      }
    });
  }

  test('und die deutsche Seite traegt sie sehr wohl', async ({ page }) => {
    /*
     * Die Gegenprobe. Ohne sie liesse sich „das Wort steht nicht da" nicht von
     * „die Karte wird gar nicht gerendert" unterscheiden — und genau so sieht
     * ein kaputter Abschnitt aus.
     */
    await page.goto('/');
    const text = (await page.locator('body').innerText()).toLowerCase();
    expect(text).toContain('mehr erfahren');
  });

  test('auf Englisch steht die Uebersetzung da', async ({ page }) => {
    await page.goto('/en');
    const text = (await page.locator('body').innerText()).toLowerCase();
    expect(text).toContain('learn more');
  });
});

/**
 * **Die Kopfzeile, die DESIGN §5 beschreibt** — und die es so nicht gab.
 *
 * „Logo left, nav centre, red *Angebot anfragen* + ghost *Login* right.
 * Mobile: full-screen overlay menu."
 *
 * Beide rechten Punkte fehlten in ihrer Wirkung: der rote Knopf gar nicht, und
 * unter `md` gab es UEBERHAUPT keine Hauptnavigation — vier gebaute Seiten
 * (Unternehmen, Leistungen, Projekte, Kontakt) ohne einen einzigen Verweis auf
 * dem Geraet, mit dem die meisten Besucher kommen.
 *
 * Der rote Knopf ist dabei nicht Schmuck: `/angebot` war gebaut, geprueft und
 * erreichbar — und stand in keiner Navigation. Wer ein Angebot wollte, musste
 * die Adresse kennen.
 */
test.describe('die oeffentliche Kopfzeile fuehrt weiter', () => {
  test('der rote Weg ins Angebot steht da — auf jeder Breite', async ({ page }) => {
    for (const breite of [375, 1280]) {
      await page.setViewportSize({ width: breite, height: 900 });
      await page.goto('/');
      const knopf = page.locator('[data-cse="angebot-anfragen"]');
      await expect(knopf, `bei ${String(breite)}px kein Angebotsweg`).toBeVisible();
      await expect(knopf).toHaveAttribute('href', '/angebot');
    }
  });

  test('das Telefon hat ein Menue, und darin stehen die vier Seiten', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const menue = page.locator('[data-cse="menue"]');
    await expect(menue).toBeVisible();
    // Zu: das Blatt ist nicht da. Sonst waere es kein Menue, sondern eine Liste.
    await expect(page.locator('[data-cse="menue-blatt"]')).toBeHidden();

    await menue.locator('summary').click();
    const blatt = page.locator('[data-cse="menue-blatt"]');
    await expect(blatt).toBeVisible();
    // Vier Seiten plus der Angebotsweg.
    await expect(blatt.locator('[data-cse="menue-ziel"]')).toHaveCount(5);

    await blatt.getByText('Leistungen').click();
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).pathname).toBe('/leistungen');
  });

  test('am Schreibtisch ist das Menue weg — die Navigation steht offen da', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.locator('[data-cse="menue"]')).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).first())
      .toBeVisible();
  });

  test('und auf Englisch fuehrt der Angebotsweg nach `/en/angebot`', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('[data-cse="angebot-anfragen"]'))
      .toHaveAttribute('href', '/en/angebot');
  });
});
