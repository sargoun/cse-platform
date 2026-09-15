/**
 * Der Agentenlauf im Browser (AGT-01, §4, §8) — **der Weg, den es bis PR 76
 * nicht gab**.
 *
 * Bis hierher zeigte das Agentenzentrum vier abgeschaltete Agenten und einen
 * Satz darüber, dass kein Modellzugang eingerichtet ist. Prüfbar war damit die
 * Anzeige, nicht die Kette. Seit dem Modellregister (0154) läuft sie: ein
 * Mensch drückt einen Knopf, ein Entwurf entsteht, und er liegt im
 * Freigabe-Posteingang — versendet wird nichts.
 *
 *  1. Die Seite sagt, WORAUF der Agent läuft — und dass es der Demobetrieb ist.
 *  2. Der Knopf legt einen Vorschlag vor, und der steht danach im Posteingang.
 *  3. Derselbe Knopf zweimal ergibt keinen zweiten Vorschlag.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Agentenlauf (AGT-01)', () => {
  test('die Seite nennt das Modell — und sagt, dass es der Demobetrieb ist', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten/backoffice`);

    const modell = page.locator('[data-cse="agent-modell"]');
    await expect(modell).toContainText('demo:hausintern-v1');
    await expect(modell).toHaveAttribute('data-anbieter', 'demo');
    await expect(modell, 'der Demobetrieb sagt, dass er einer ist')
      .toContainText('läuft im eigenen Prozess');
  });

  test('der Knopf legt einen Vorschlag vor — und der steht im Posteingang', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/freigaben`);
    const vorher = Number(
      await page.locator('[data-cse="posteingang-zaehler"]').getAttribute('data-anzahl'));

    await page.goto(`/portal/${MANDANT}/agenten/backoffice`);
    await page.locator('[data-cse="agent-starten"]').click();

    await expect(page).toHaveURL(/lauf=vorgelegt/u);
    await expect(page.locator('[data-cse="lauf-ergebnis"]'))
      .toContainText('Vorschlag liegt vor');
    await expect(page.locator('[data-cse="lauf-ergebnis"]'),
      'der Satz, der die Invariante trägt').toContainText('versendet wurde nichts');

    await page.locator('[data-cse="zum-posteingang"]').click();
    const nachher = Number(
      await page.locator('[data-cse="posteingang-zaehler"]').getAttribute('data-anzahl'));
    expect(nachher, 'ein Vorschlag mehr wartet').toBe(vorher + 1);
  });

  /**
   * **Zweimal absenden ist EIN Vorschlag** — die Zusage, die vorher nur im
   * Text stand.
   *
   * Die Route bekam keinen Idempotenzschlüssel, also übersprang
   * `starteAufgabe` seine Eindeutigkeitsprüfung, und jede Wiederholung legte
   * eine zweite Aufgabe UND eine zweite offene Freigabe an. Ein Mensch hätte
   * dieselbe Sache zweimal entschieden — oder, schlimmer, einmal genehmigt
   * und die Zwillingszeile übersehen.
   *
   * Geprüft wird die ECHTE Wiederholung: dasselbe Formular, zweimal
   * abgeschickt. Ein zweiter Klick auf denselben Knopf, ein „Formular erneut
   * senden" nach einem Neuladen, eine doppelte Zustellung — alle drei tragen
   * denselben Schlüssel, und genau den schickt dieser Test zweimal.
   */
  test('dasselbe Formular zweimal abgeschickt legt einen Vorschlag vor, nicht zwei',
    async ({ page }) => {
      await anmelden(page, KONTO.adminReinigung);
      await page.goto(`/portal/${MANDANT}/agenten/backoffice`);

      const schluessel = await page.locator('input[name="schluessel"]').inputValue();
      expect(schluessel, 'das Formular bringt einen Schlüssel mit').not.toBe('');

      const senden = async () => page.request.post('/api/agenten/lauf', {
        form: { mandant: MANDANT, agent: 'backoffice', schluessel },
        headers: { origin: new URL(page.url()).origin },
        maxRedirects: 0,
      });

      /*
       * Gezählt wird der ZUWACHS, nicht der Bestand: die Spezifikation teilt
       * sich eine Datenbank, und frühere Läufe haben denselben Titel. „Genau
       * eine Zeile" wäre eine Aussage über die Reihenfolge der Tests.
       */
      const zeilen = page.locator('table tbody tr')
        .filter({ hasText: 'Hinweis: offene Leistungsnachweise' });
      const vorher = await zeilen.count();

      const erst = await senden();
      expect(erst.status(), await erst.text()).toBe(303);
      expect(erst.headers()['location']).toContain('lauf=vorgelegt');

      const zweit = await senden();
      expect(zweit.status()).toBe(303);
      // `bestand` heisst: die Aufgabe gab es schon, es entstand nichts Neues.
      expect(zweit.headers()['location'],
        'der zweite Versuch legt nichts an').toContain('lauf=bestand');

      /*
       * Und in der Aufgabenliste des Agenten steht genau EINE Zeile mit
       * diesem Titel — nicht zwei. Vorher waren es zwei, und beide warteten
       * auf eine Entscheidung.
       */
      await page.goto(`/portal/${MANDANT}/agenten/backoffice`);
      await expect(zeilen, 'zwei Absendungen, eine Aufgabe').toHaveCount(vorher + 1);
    });

  /**
   * **Die Umleitung folgt der Sitzung, nicht dem Rumpf** (Invariante 3).
   *
   * Das Formular trug den Slug bis hierher als verstecktes Feld mit, und nur
   * er bestimmte, wohin die 303 zeigte — der Lauf selbst lief gegen den
   * aktiven Bereich der Sitzung. Wer in einem zweiten Reiter gewechselt
   * hatte, schickte den alten Slug ab: der Vorschlag entstand richtig, die
   * Umleitung fuehrte auf die Agentenseite der anderen Gesellschaft, und dort
   * stand er nicht. Ein Lauf, der aussah, als habe er nichts erzeugt.
   *
   * Hier wird der Rumpf absichtlich gefaelscht — `security` statt `reinigung`,
   * dazu ein Slug, den es gar nicht gibt.
   */
  test('ein fremder Bereich im Rumpf verschiebt die Umleitung nicht', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten/backoffice`);
    const schluessel = await page.locator('input[name="schluessel"]').inputValue();

    for (const fremd of ['security', 'gibt-es-nicht']) {
      const antwort = await page.request.post('/api/agenten/lauf', {
        form: { mandant: fremd, agent: 'backoffice', schluessel: `${schluessel}-${fremd}` },
        headers: { origin: new URL(page.url()).origin },
        maxRedirects: 0,
      });
      expect(antwort.status(), await antwort.text()).toBe(303);
      const ziel = antwort.headers()['location'] ?? '';
      expect(ziel, 'die Umleitung nennt den Bereich der Sitzung')
        .toContain(`/portal/${MANDANT}/agenten/backoffice`);
      expect(ziel, 'und nicht den aus dem Rumpf').not.toContain(`/portal/${fremd}/`);
    }
  });

  /**
   * Die Aufgabe steht danach in der Liste des Agenten — mit dem Stand, der
   * sagt, dass sie auf einen Menschen wartet und nicht fertig ist.
   */
  test('die Aufgabe steht in der Liste und wartet auf eine Freigabe', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten/finanzen`);
    await page.locator('[data-cse="agent-starten"]').click();
    await expect(page).toHaveURL(/lauf=vorgelegt/u);

    await page.goto(`/portal/${MANDANT}/agenten/finanzen`);
    const liste = page.locator('table');
    await expect(liste).toContainText('Hinweis: offene Posten');
    /* Der Zustand sagt „Wartet" — nicht „Fertig": die Entscheidung steht aus. */
    await expect(liste).toContainText('Wartet');
  });
});
