/**
 * PR 34 Abnahme (4) — die Stempelflaeche auf EINEM Telefonbildschirm.
 *
 * Das ist die einzige Flaeche der Plattform mit einer harten koerperlichen
 * Bedingung (DESIGN §8): **ein Bildschirm, ein Hauptknopf, kein Scrollen,
 * 44 px Tippziele, mit Handschuhen und einer Hand bedienbar.** Wer sie am
 * Schreibtisch prueft, prueft die falsche Sache — deshalb ist hier 375×812
 * eingestellt und nicht die Vorgabegroesse der Suite.
 *
 * Geprueft wird die Seite mit einer BELIEBIGEN Marke in der Adresse. Das ist
 * kein Behelf, sondern genau die Zusage: die Seite loest die Marke beim
 * Rendern nicht auf (D-135). Eine Seite, die fuer eine gueltige Marke etwas
 * anderes zeigt als fuer eine ungueltige, waere ein Orakel — und sie saehe
 * fuer diesen Test dann auch anders aus.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** iPhone-Klasse: 375×812. Die Groesse, auf der TIM-07 stattfindet. */
test.use({ viewport: { width: 375, height: 812 } });

const ADRESSE = '/check-in/aaaabbbbccccddddeeeeffff00001111222233334444555566667777';

test.describe('(4) die Check-in-Flaeche passt auf 375×812', () => {
  test('sie antwortet, ohne die Marke aufzuloesen', async ({ page }) => {
    const antwort = await page.goto(ADRESSE);
    // Eine 404 mit null Verstoessen waere ein bestandener Test ueber eine
    // Seite, die es nicht gibt.
    expect(antwort?.status(), 'die Check-in-Seite antwortet nicht mit 200').toBe(200);
    await expect(page.getByRole('heading', { name: 'Zeiterfassung' })).toBeVisible();
  });

  test('kein Scrollen: der Inhalt bleibt im sichtbaren Bereich', async ({ page }) => {
    await page.goto(ADRESSE);
    const masse = await page.evaluate(() => ({
      inhalt: document.documentElement.scrollHeight,
      fenster: window.innerHeight,
      breite: document.documentElement.scrollWidth,
      fensterBreite: window.innerWidth,
    }));
    /**
     * Ein Pixel Toleranz: Unterpixel-Rundung im Layout ist kein Scrollen.
     * Mehr waere die Zusage aufgeweicht — und genau diese Zusage ist der
     * Unterschied zwischen „tippen und weiterarbeiten" und „im Treppenhaus
     * nach dem Knopf suchen".
     */
    expect(masse.inhalt, 'die Seite scrollt senkrecht').toBeLessThanOrEqual(masse.fenster + 1);
    expect(masse.breite, 'die Seite scrollt waagerecht')
      .toBeLessThanOrEqual(masse.fensterBreite + 1);
  });

  test('genau EIN Hauptknopf, und er ist mindestens 44×44 px', async ({ page }) => {
    await page.goto(ADRESSE);
    const knoepfe = page.getByRole('button');
    await expect(knoepfe, 'ein Bildschirm, ein Knopf (DESIGN §5)').toHaveCount(1);

    const kasten = await knoepfe.first().boundingBox();
    expect(kasten, 'der Knopf hat keine Ausdehnung').not.toBeNull();
    // DESIGN §8: Tippziele ≥ 44×44 px. Nicht verhandelbar.
    expect(kasten!.height, 'Tippziel zu niedrig').toBeGreaterThanOrEqual(44);
    expect(kasten!.width, 'Tippziel zu schmal').toBeGreaterThanOrEqual(44);
    await expect(knoepfe.first()).toHaveText(/Einstempeln/u);
  });

  test('jedes bedienbare Element haelt 44 px — nicht nur der Hauptknopf', async ({ page }) => {
    await page.goto(ADRESSE);
    const zuKlein = await page.evaluate(() => {
      const auswahl = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      return [...document.querySelectorAll(auswahl)]
        .map((e) => ({ tag: e.tagName, k: e.getBoundingClientRect() }))
        .filter((x) => x.k.width > 0 && (x.k.height < 44 || x.k.width < 44))
        .map((x) => `${x.tag} ${String(Math.round(x.k.width))}×${String(Math.round(x.k.height))}`);
    });
    expect(zuKlein, 'Tippziele unter 44 px').toEqual([]);
  });

  test('axe meldet null AA-Verstoesse', async ({ page }) => {
    await page.goto(ADRESSE);
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    // Benannt, damit ein Fehlschlag sagt WELCHE Regel — nicht nur wie viele.
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });

  test('eine ungueltige Marke wird abgelehnt — angesagt, ohne Grund und ohne zweite Seite',
    async ({ page }) => {
      await page.goto(ADRESSE);
      await page.getByRole('button', { name: /Einstempeln/u }).click();

      /**
       * Die Meldung steht in einem `aria-live`-Bereich, wird also angesagt.
       * Und sie nennt KEINEN Grund: unbekannt, abgelaufen, zu frueh, schon
       * benutzt — alles ergibt denselben Satz (AUT-06, D-131). Ein Text, der
       * die Faelle unterscheidet, macht das Durchprobieren lohnend.
       */
      // Auf `main` eingegrenzt: Next haengt einen eigenen
      // `aria-live="assertive"`-Routenansager an den Seitenrumpf, und ein
      // ungenauer Treffer traefe zwei Elemente.
      const meldung = page.locator('main [aria-live="assertive"]');
      await expect(meldung).toHaveText(/nicht gültig/u, { timeout: 15_000 });

      // Kein Sprung auf eine zweite Seite: die Adresse bleibt dieselbe.
      expect(new URL(page.url()).pathname).toBe(ADRESSE);
    });
});
