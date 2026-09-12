/**
 * PR 16 Akzeptanz (1) und (5) — WCAG 2.1 AA auf JEDER oeffentlichen Route.
 *
 * **Warum jede und nicht eine Auswahl.** BFSG gilt fuer das Angebot, nicht fuer
 * die Startseite. Eine Stichprobe misst, wie sorgfaeltig die geprueften Seiten
 * gebaut wurden, und sagt ueber die uebrigen nichts — und die uebrigen sind
 * die, auf denen jemand ein Impressum oder einen Meldeweg sucht.
 *
 * Die Liste kommt aus `OEFFENTLICHE_ROUTEN`: eine neue Route ist damit
 * automatisch abgedeckt. Das ist der Unterschied zwischen einer Pruefung und
 * einer Erinnerung.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

const ROUTEN = [...OEFFENTLICHE_ROUTEN.map((r) => r.pfad), '/barrierefreiheit'];

test.describe('(1) axe meldet NULL AA-Verstösse auf jeder öffentlichen Route', () => {
  for (const pfad of ROUTEN) {
    test(`axe: ${pfad}`, async ({ page }) => {
      const antwort = await page.goto(pfad);
      // Eine 404 mit null Verstössen wäre ein bestandener Test über eine
      // Seite, die es nicht gibt.
      expect(antwort?.status(), `${pfad} antwortet nicht mit 200`).toBe(200);

      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Benannt, damit ein Fehlschlag sagt WELCHE Regel — nicht nur wie viele.
      const verstoesse = ergebnis.violations.map(
        (v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`,
      );
      expect(verstoesse, `${pfad}`).toEqual([]);
    });
  }
});

test.describe('(5) die Startseite ist vollständig mit der Tastatur bedienbar', () => {
  const BEDIENBAR =
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

  /**
   * **Nur was gerade GERENDERT ist.**
   *
   * Ein geschlossenes `<details>` behaelt seinen Inhalt im DOM. Die Ziele des
   * Telefon-Menues stehen also auch am Schreibtisch in
   * `querySelectorAll(BEDIENBAR)` — unsichtbar, per Tab nicht erreichbar, und
   * `focus()` auf ihnen tut nichts. Ohne diesen Filter meldete die Pruefung
   * sie als „nicht erreichbar" und „ohne Fokusrahmen": zwei Fehlschlaege fuer
   * einen Zustand, der richtig ist. Ein verborgener Verweis SOLL nicht
   * fokussierbar sein; dass er es wird, sobald das Menue aufgeht, haelt
   * `firmenangaben.spec.ts` fest.
   *
   * `offsetParent` ist das erste Kriterium und nicht `visibility`: es ist
   * genau dann null, wenn das Element (oder ein Vorfahr) `display: none`
   * traegt — derselbe Test, den die Tap-Ziel-Pruefung schon benutzt. Die
   * `position: fixed`-Ausnahme gehoert dazu: bei einem fixierten Element ist
   * `offsetParent` auch dann null, wenn es sichtbar ist.
   *
   * **Und es genuegt nicht.** Der Absatz darueber beschrieb den richtigen
   * Fall und traf ihn nur zufaellig: das Telefonmenue faellt hier durch, weil
   * es am Schreibtisch `md:hidden` ist — also `display: none` —, nicht weil
   * es geschlossen ist. Die Gesellschaftswahl im Kopf (D-381) ist die erste
   * Klappe, die geschlossen UND sichtbar ist. Chromium laesst ihren Inhalt
   * dabei `display: flex` und einen Kasten behalten; `offsetParent` ist nicht
   * null, und die vier Verweise wurden als „per Tastatur nicht erreichbar"
   * gemeldet — fuer einen Zustand, in dem kein Browser sie erreichbar macht
   * und keiner sie erreichbar machen soll.
   *
   * Deshalb steht die Bedingung jetzt ausdruecklich da: Inhalt einer
   * GESCHLOSSENEN Klappe zaehlt nicht, ihr `summary` schon — das ist das
   * Bedienelement, und es MUSS erreichbar sein. Was hinter dem Aufklappen
   * liegt, prueft der Fall „eine Klappe im Kopf ist per Tastatur vollstaendig
   * bedienbar" weiter unten, und der prueft mehr als diese Schleife je
   * geprueft hat: aufklappen mit der Tastatur, danach jedes Ziel erreichen,
   * jedes mit sichtbarem Ring.
   *
   * Der Filter steht ZWEIMAL ausgeschrieben, in beiden `page.evaluate`. Ein
   * gemeinsamer Helfer waere hier keiner: der Rumpf wird in den Browser
   * serialisiert, und eine Funktion aus dem Modulgeltungsbereich ist dort
   * nicht definiert.
   */

  /**
   * Jedes Element bekommt eine eigene Nummer, bevor getabbt wird.
   *
   * Eine frühere Fassung erkannte die Elemente an ihrem `href` und brach ab,
   * sobald sie einen zweimal sah. Auf dieser Seite steht `/kontakt` in der
   * Kopfnavigation UND weiter unten — die Schleife hielt also mitten in der
   * Seite an und meldete Erfolg. Eine Prüfung, die zu früh aufhört, besteht
   * immer: das war der Beweis, dass sie nichts prüfte.
   */
  async function nummeriere(page: Page): Promise<number> {
    return page.evaluate((auswahl) => {
      const es = [...document.querySelectorAll(auswahl)].filter(
        (e) => ((e as HTMLElement).offsetParent !== null
          || getComputedStyle(e).position === 'fixed')
          // Inhalt einer GESCHLOSSENEN Klappe zaehlt nicht — siehe oben.
          && !(e.closest('details:not([open])') !== null && e.closest('summary') === null),
      );
      es.forEach((e, i) => { e.setAttribute('data-a11y-nr', String(i)); });
      return es.length;
    }, BEDIENBAR);
  }

  test('jedes bedienbare Element wird per Tab ERREICHT', async ({ page }) => {
    await page.goto('/');
    const anzahl = await nummeriere(page);
    expect(anzahl, 'die Seite hat überhaupt bedienbare Elemente').toBeGreaterThan(4);

    const erreicht = new Set<string>();
    // Grosszügig, aber endlich: eine Fokusfalle läuft sonst ewig.
    for (let i = 0; i < anzahl * 3 + 10; i += 1) {
      await page.keyboard.press('Tab');
      const nr = await page.evaluate(
        () => document.activeElement?.getAttribute('data-a11y-nr') ?? null,
      );
      if (nr !== null) erreicht.add(nr);
      if (erreicht.size === anzahl) break;
    }

    const fehlend = [...Array(anzahl).keys()]
      .map(String).filter((n) => !erreicht.has(n));
    expect(fehlend, 'per Tastatur NICHT erreichbar (Index)').toEqual([]);
  });

  test('und zeigt im Fokus einen sichtbaren Ring — keines entfernt ihn', async ({ page }) => {
    await page.goto('/');
    const anzahl = await nummeriere(page);

    const ohneRing = await page.evaluate((auswahl) => {
      const schlecht: string[] = [];
      const sichtbare = [...document.querySelectorAll(auswahl)].filter(
        (e) => ((e as HTMLElement).offsetParent !== null
          || getComputedStyle(e).position === 'fixed')
          && !(e.closest('details:not([open])') !== null && e.closest('summary') === null),
      );
      for (const e of sichtbare) {
        (e as HTMLElement).focus();
        const s = getComputedStyle(e);
        const sichtbar = (s.outlineStyle !== 'none' && s.outlineWidth !== '0px')
          || (s.boxShadow !== 'none' && s.boxShadow !== '');
        if (!sichtbar) {
          schlecht.push(
            `${e.tagName}[${e.getAttribute('data-a11y-nr') ?? '?'}] `
            + `${(e.getAttribute('href') ?? e.textContent ?? '').trim().slice(0, 40)}`,
          );
        }
      }
      return schlecht;
    }, BEDIENBAR);

    expect(anzahl).toBeGreaterThan(4);
    // `outline: none` ohne Ersatz ist die häufigste Art, eine Seite für
    // Tastaturnutzer unbedienbar zu machen, ohne dass es jemandem auffällt.
    expect(ohneRing, 'ohne sichtbaren Fokusrahmen').toEqual([]);
  });

  /**
   * **Was der Sichtbarkeitsfilter oben nicht mehr zaehlt, prueft dieser Fall.**
   *
   * Die Schleife darueber darf den Inhalt einer geschlossenen Klappe nicht als
   * „per Tab erreichbar" verlangen — kein Browser macht ihn erreichbar, und er
   * soll es nicht sein. Damit daraus keine Luecke wird, steht hier die andere
   * Haelfte: die Klappe laesst sich MIT DER TASTATUR bedienen, und danach ist
   * jedes Ziel erreichbar und traegt einen Ring.
   *
   * Das ist mehr, als die Schleife je geprueft hat: sie haette vier Verweise
   * gezaehlt und waere zufrieden gewesen, wenn der Fokus sie irgendwann
   * streift. Hier muss die Bedienung selbst funktionieren — `Enter` auf dem
   * `summary`, sonst faellt der Fall.
   */
  test('eine Klappe im Kopf ist per Tastatur vollstaendig bedienbar (D-381)',
    async ({ page }) => {
      await page.goto('/');
      const wahl = page.locator('[data-cse="gesellschaftswahl"]');
      await expect(wahl).toBeVisible();
      await expect(wahl).not.toHaveAttribute('open', /.*/u);

      // 1) Das Bedienelement per Tab erreichen — ohne Mausklick.
      let erreicht = false;
      for (let i = 0; i < 40 && !erreicht; i += 1) {
        await page.keyboard.press('Tab');
        erreicht = await page.evaluate(() => {
          const e = document.activeElement;
          return e?.tagName === 'SUMMARY'
            && e.closest('[data-cse="gesellschaftswahl"]') !== null;
        });
      }
      expect(erreicht, 'das summary der Klappe wird per Tab nicht erreicht').toBe(true);

      // 2) Mit der Tastatur oeffnen.
      await page.keyboard.press('Enter');
      await expect(wahl).toHaveAttribute('open', /.*/u);

      // 3) Danach jedes Ziel erreichen — jedes mit sichtbarem Ring.
      const ziele = await wahl.locator('[data-cse="gesellschaftswahl-ziel"]').count();
      expect(ziele).toBe(4);

      const gesehen: string[] = [];
      for (let i = 0; i < ziele * 3 + 5 && gesehen.length < ziele; i += 1) {
        await page.keyboard.press('Tab');
        const z = await page.evaluate(() => {
          const e = document.activeElement as HTMLElement | null;
          if (e === null || e.getAttribute('data-cse') !== 'gesellschaftswahl-ziel') return null;
          const st = getComputedStyle(e);
          const ring = (st.outlineStyle !== 'none' && st.outlineWidth !== '0px')
            || (st.boxShadow !== 'none' && st.boxShadow !== '');
          return { href: e.getAttribute('href') ?? '', ring };
        });
        if (z !== null) {
          expect(z.ring, `ohne Fokusrahmen: ${z.href}`).toBe(true);
          if (!gesehen.includes(z.href)) gesehen.push(z.href);
        }
      }
      expect(gesehen, 'nicht jedes Ziel der offenen Klappe wird per Tab erreicht')
        .toHaveLength(ziele);
    });

  test('die rechtlichen Seiten sind von der Startseite aus verlinkt (§5 TMG, LEG-07)', async ({ page }) => {
    await page.goto('/');
    for (const ziel of ['/impressum', '/datenschutz', '/barrierefreiheit']) {
      await expect(
        page.locator(`a[href="${ziel}"]`),
        `${ziel} ist von der Startseite nicht erreichbar`,
      ).toHaveCount(1);
    }
  });
});
