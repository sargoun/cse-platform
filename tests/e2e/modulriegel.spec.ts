/**
 * Der Modulriegel im Browser (D-377) — der Befund, den der Mandant selbst
 * gemeldet hat.
 *
 * „Ich klicke `admin` und `leitung` an und sehe ueberall dasselbe." Er hatte
 * recht, und die Rolle war nicht der Grund: die Plattformrollen halten
 * `reinigung.lesen` und `security.lesen` mit `rolle.mandant_id is null`, also
 * in JEDEM Bereich. Gebucht hat REALTIME Service aber nur den Hochbau.
 *
 * **Warum das im Browser steht und nicht nur im Unit-Test.** Die Regel
 * (`tests/kern/module.test.ts`) sagt, was gelten SOLL. Ob sie in der Sidebar,
 * in der Tab-Leiste und auf der Seite ankommt, entscheidet sich erst durch
 * Sitzung, Bindung, RLS und Rendern hindurch — und die Luecke, die es zu
 * schliessen galt, war genau eine zwischen richtiger Regel und fehlendem
 * Aufruf.
 */
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

test.describe('eine Gesellschaft sieht nur ihr eigenes Gewerk', () => {
  test('der Hochbau-Admin hat keine Reinigung und keine Security in der Sidebar',
    async ({ page }) => {
      await alsKonto(page, KONTO.adminBau);
      const antwort = await page.goto('/portal/bau');
      expect(antwort?.status()).toBe(200);

      const navi = page.locator('[data-cse="seitennavigation"]');
      await expect(navi).toBeVisible();
      // Das eigene Gewerk steht da …
      await expect(navi.getByRole('link', { name: 'Bau' })).toHaveCount(1);
      // … die fremden nicht. Nicht „ausgegraut": gar nicht.
      for (const fremd of ['Reinigung', 'Security', 'Dienstanweisungen', 'Schlüssel']) {
        await expect(navi.getByRole('link', { name: fremd }), fremd).toHaveCount(0);
      }
    });

  test('und die Adresse zu tippen hilft auch nicht: 404, nicht 403', async ({ page }) => {
    await alsKonto(page, KONTO.adminBau);
    /*
     * Ein ausgeblendeter Menuepunkt ist keine Sperre. Ohne den Riegel auf der
     * SEITE antwortete diese Adresse 200 — die Sidebar haette die Luecke nur
     * unsichtbar gemacht.
     */
    for (const pfad of ['/portal/bau/reinigung/reviere',
      '/portal/bau/security/posten',
      '/portal/bau/security/wachbuch']) {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(404);
    }
  });

  test('die Reinigungs-Leitung sieht ihr Revier und kein Wachbuch', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    expect((await page.goto('/portal/reinigung/reinigung/reviere'))?.status()).toBe(200);
    expect((await page.goto('/portal/reinigung/security/wachbuch'))?.status()).toBe(404);
  });

  /**
   * Die Gegenprobe, ohne die die drei Faelle oben auch dann gruen waeren,
   * wenn der Riegel ALLES sperrte: die Security kommt an ihr eigenes Buch.
   */
  test('die Security kommt an ihr Wachbuch, ihre Posten und ihre Anweisungen',
    async ({ page }) => {
      await alsKonto(page, KONTO.adminSecurity);
      for (const pfad of ['/portal/security/security/posten',
        '/portal/security/security/wachbuch',
        '/portal/security/security/dienstanweisungen']) {
        const antwort = await page.goto(pfad);
        expect(antwort?.status(), pfad).toBe(200);
      }
    });

  /**
   * Und die zweite Gegenprobe: was NICHT gebucht wird, bleibt fuer alle da.
   * Zeiten, Dienstplan und Rechnungen sind kein Gewerk, sondern der Betrieb.
   */
  test('Querschnittsmodule bleiben in jeder Gesellschaft erreichbar', async ({ page }) => {
    await alsKonto(page, KONTO.adminBau);
    for (const pfad of ['/portal/bau/zeiten', '/portal/bau/dienstplan/woche',
      '/portal/bau/objekte', '/portal/bau/dokumente']) {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);
    }
  });
});
