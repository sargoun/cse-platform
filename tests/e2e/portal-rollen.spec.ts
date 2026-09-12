/**
 * Phase 3 im Browser — die Hälfte, die kein Unit-Test zeigt.
 *
 * Die Rollenprobe (`tests/isolation/rollen.test.ts`) beweist die
 * Zugangsentscheidung über alle 432 Routen. Was sie nicht zeigt: dass eine
 * echte Anmeldung durch Cookie, `app.sitzung_aufloesen`, Portal-Decke, RLS
 * und Rendern hindurch wirklich die richtige Seite ergibt — und dass eine
 * getippte fremde URL wirklich 404 gibt und nicht 403.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

/**
 * **Diese Datei prüft Rollen — und meldet sich trotzdem als ein BESTIMMTER
 * Mensch an.**
 *
 * Hier stand eine eigene `anmelden(page, rolle)`-Hilfe, die
 * `[data-rolle="…"]`.first() griff. Solange es je Rolle genau ein Seed-Konto
 * gab, war das dasselbe; seit der Seed ein zweites Verwaltungskonto trägt
 * („Administration Bau", und `/dev/anmelden` listet `order by b.name`, also
 * VOR „Administration Reinigung"), bekam jede `admin`-Prüfung eine Sitzung im
 * Mandanten `bau`. Jeder Aufruf von `/portal/reinigung/…` antwortete danach
 * mit 404 — richtig so (AUT-06, Slug-Wache) — und drei Fehlschläge lasen sich
 * wie ein kaputtes Dashboard.
 *
 * Die Aussage jeder Prüfung bleibt unverändert: welche Rolle gemeint ist,
 * steht jetzt im Konto statt in einer Auswahl, die sich beim nächsten Seed
 * anders entscheidet.
 */

test.describe('(1) jede Rolle landet in ihrem Portal', () => {
  test('admin sieht das Dashboard seiner Gesellschaft', async ({ page }) => {
    // „Seiner Gesellschaft" ist hier `reinigung` — das Konto muss dasselbe
    // sagen wie die Adresse darunter, sonst prüft die Zeile die Slug-Wache.
    await alsKonto(page, KONTO.adminReinigung);
    const antwort = await page.goto('/portal/reinigung');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Übersicht');
    // Der Identitätsstreifen trägt den Hue des Bereichs (DESIGN §6 Regel 4).
    await expect(page.locator('[data-cse="identitaets-streifen"]'))
      .toHaveAttribute('data-bereich', 'reinigung');
  });

  test('mitarbeiter sieht sein eigenes Portal — mit BEIDEN Beschäftigungen', async ({ page }) => {
    /**
     * **Fatima namentlich**, nicht „der erste mitarbeiter". Seit der Seed ein
     * zweites Mitarbeiterkonto traegt (Amir, arabisch), griff `.first()` ihn
     * — `order by b.name` stellt „Amir Haddad" vor „Fatima Yildiz". Die
     * Ueberschrift stand dann auf „اليوم", und das war RICHTIG: das Portal
     * spricht die Sprache des angemeldeten Menschen (EMP-12). Falsch war die
     * Annahme, man wisse, wer angemeldet ist.
     */
    await alsKonto(page, KONTO.fatima);
    const antwort = await page.goto('/portal/mein');
    expect(antwort?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Heute');
    /**
     * Fatima ist der D-09-Fall: ein Mensch, zwei Gesellschaften. Ihr Portal
     * muss beide zeigen — über den Personen-Scope, nicht über die
     * Gruppenansicht, die für sie leer bliebe.
     */
    await expect(page.locator('[data-cse="anstellung"]')).toHaveCount(2);
  });

  test('kunde kommt in SEIN Portal — seit es einen Kundenzugang gibt',
    async ({ page }) => {
      /**
       * Bis Phase 4 stand hier das Gegenteil, und es war richtig: das
       * Kundenportal liest im `kunde`-Scope, dessen sichtbare Mandanten aus
       * `kunde_zugang` kommen — einer Tabelle, die es noch nicht gab. Die Tuer
       * war fehlgeschlossen zu.
       *
       * Jetzt gibt es die Tabelle UND einen Seed-Zugang, und dieselbe Prüfung
       * haelt die andere Haelfte fest: die Tuer geht auf, wenn ein Zugang
       * besteht — und nur so weit, wie er reicht.
       */
      await alsKonto(page, KONTO.kunde);
      const antwort = await page.goto('/portal/kunde');
      expect(antwort?.status()).toBe(200);
    });
});

test.describe('(2) 404, nie 403 — und nie eine fremde Zeile (AUT-06, SEC-A3)', () => {
  test('ein mitarbeiter, der eine Mandantenroute tippt, landet in SEINEM Portal',
    async ({ page }) => {
      /**
       * Fatima, und damit der schärfere Fall: `reinigung` ist IHRE
       * Gesellschaft (D-09, sie hat dort eine Beschäftigung). Die Decke
       * schickt sie trotzdem zurück — nicht weil der Mandant fremd wäre,
       * sondern weil das Mandantenportal nicht ihr Portal ist.
       */
      await alsKonto(page, KONTO.fatima);
      await page.goto('/portal/reinigung');
      // Die K-04-Decke schickt ihn zurück — kein 404, das ratlos zurücklässt,
      // und erst recht kein Dashboard.
      await expect(page).toHaveURL(/\/portal\/mein$/u);
    });

  test('eine leitung von bau bekommt security NICHT — 404 und nicht 403',
    async ({ page, request }) => {
      // „Eine leitung von BAU" steht im Namen der Prüfung — also namentlich
      // die Leitung Bau und nicht die erste Zeile der Rolle `leitung`, die
      // seit dem Seed der Security gehören kann.
      await alsKonto(page, KONTO.leitungBau);
      const antwort = await request.get('/portal/security', {
        headers: { cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`).join('; ') },
      });
      /**
       * 404 ist die Zusage, nicht 403. Ein 403 bestätigte, dass es
       * `/portal/security` gibt — und damit, dass es diese Gesellschaft gibt
       * und dass sie ein Portal hat.
       */
      expect(antwort.status()).toBe(404);
    });

  test('und eine erfundene Portalroute ebenfalls 404', async ({ page, request }) => {
    await alsKonto(page, KONTO.adminReinigung);
    const kekse = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`).join('; ');
    const antwort = await request.get('/portal/reinigung/gibtesnicht',
      { headers: { cookie: kekse } });
    expect(antwort.status()).toBe(404);
  });
});

test.describe('(3) ohne Anmeldung ist das Portal zu — aber ehrlich zu', () => {
  test('keine 404-Lüge, sondern "Anmeldung erforderlich"', async ({ page }) => {
    const antwort = await page.goto('/portal/mein');
    expect(antwort?.status()).toBe(200);
    // Ein 404 hiesse "diese Seite gibt es nicht". Es gibt sie.
    await expect(page.locator('h1')).toHaveText('Anmeldung erforderlich');
  });
});

test.describe('(4) §11.2 — fünf Ziele bei 375px, Tap-Ziele ≥ 44px', () => {
  test('das Mitarbeiterportal trägt fünf und KEIN "Mehr"', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await alsKonto(page, KONTO.fatima);
    await page.goto('/portal/mein');

    const tabs = page.locator('[data-cse="tableiste"] [data-cse="tab"]');
    await expect(tabs).toHaveCount(5);
    await expect(page.locator('[data-cse="tab"][data-tab="mehr"]')).toHaveCount(0);

    const hoehe = await tabs.first().evaluate((e) => e.getBoundingClientRect().height);
    expect(hoehe).toBeGreaterThanOrEqual(44);
  });

  test('das interne Portal trägt fünf MIT "Mehr"', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung');
    await expect(page.locator('[data-cse="tableiste"] [data-cse="tab"]')).toHaveCount(5);
    await expect(page.locator('[data-cse="tab"][data-tab="mehr"]')).toHaveCount(1);
  });

  test('am Schreibtisch ist die Leiste weg', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung');
    await expect(page.locator('[data-cse="tableiste"]')).toBeHidden();
  });

  test('kein waagerechtes Scrollen bei 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung');
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(ueberlauf).toBe(false);
  });
});

test.describe('(5) barrierefrei — das Portal ist der Arbeitsplatz', () => {
  /**
   * `/portal/kunde` fehlt hier, weil es bis Phase 4 404 gab — axe auf einer
   * Fehlerseite prüfte die Fehlerseite. Seit `kunde_zugang` steht, geht die
   * Tür auf (siehe oben); die Seite hier aufzunehmen ist eine neue Zusage und
   * gehört in den PR, der sie prüft.
   *
   * **Konto statt Rolle**: gemessen wird der Bildschirm, den ein bestimmtes
   * Konto wirklich sieht. Mit `[data-rolle="admin"]`.first() stand seit dem
   * zweiten Verwaltungskonto eine `bau`-Sitzung hinter `/portal/reinigung`;
   * die Statuszusicherung darunter fing das ab — 404 statt 200 — und der
   * Fehlschlag las sich wie ein Barrierefreiheitsmangel, den es nicht gab.
   */
  for (const [konto, pfad] of [
    [KONTO.adminReinigung, '/portal/reinigung'],
    [KONTO.fatima, '/portal/mein'],
  ] as const) {
    test(`axe: ${pfad}`, async ({ page }) => {
      await alsKonto(page, konto);
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);
      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(
        /*
         * Der Ort gehoert in die Meldung, nicht in eine zweite Sitzung.
         *
         * Hier stand nur `id: help (1×)`. Ein Kontrastverstoss auf einer Seite
         * mit ueber hundert Knoten sagt damit, DASS etwas zu blass ist, und
         * verschweigt, WAS — der Fehlschlag kostete einen kompletten zweiten
         * Lauf mit einer eigens veraenderten Zusicherung, nur um den Selektor
         * zu erfahren. `target` steht in jedem axe-Ergebnis bereit.
         */
        ergebnis.violations.map((v) =>
          `${v.id}: ${v.help} (${String(v.nodes.length)}×) — `
          + v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)}`)
              .join(' | ')),
        pfad,
      ).toEqual([]);
    });
  }
});
