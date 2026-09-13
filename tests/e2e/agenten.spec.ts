/**
 * PR 76 im Browser — das Agenten-Zentrum (AGT-01, AGT-05, SPEC §22).
 *
 * Die Datenbankseite steht in `tests/isolation/agent-laufzeit.test.ts`; hier
 * steht, was eine Geschäftsführung tatsächlich sieht:
 *
 *  1. Die vier Agenten mit ihrem Schalterzustand — und der ehrliche Hinweis,
 *     dass kein Modellzugang eingerichtet ist. Ein Zentrum, das diesen Satz
 *     verschweigt, sieht fertig aus und ist es nicht.
 *  2. **Kein Startknopf.** Das ist die Zusicherung, nicht die Auslassung: ein
 *     Knopf, der eine Aufgabe anlegt, die niemand ausführt, wäre die
 *     vorgetäuschte Funktion, die CLAUDE.md verbietet.
 *  3. Das Budget zeigt die Obergrenze als PLATZHALTER — die Zahl steht da,
 *     und daneben steht, dass sie noch keine Entscheidung ist (O-26).
 *  4. Wer `agent.lesen` nicht hält, sieht die Seite gar nicht (AUT-06).
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

async function anmelden(page: Page, konto: string): Promise<void> {
  await page.goto('/dev/anmelden');
  await alsKonto(page, konto);
}

test.describe('Agenten-Zentrum', () => {
  test('zeigt die vier Agenten — und dass kein Modell verbunden ist', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten`);

    await expect(page.getByRole('heading', { name: 'Agenten', level: 1 })).toBeVisible();

    for (const name of [
      'CEO-Assistent', 'Akquise-Assistent', 'Rueckbuero-Assistent', 'Finanz-Assistent',
    ]) {
      await expect(page.getByRole('link', { name })).toBeVisible();
    }

    /*
     * Der Satz, der den Unterschied zwischen „gebaut" und „einsatzbereit"
     * ausspricht. Er steht oben, nicht im Kleingedruckten: wer ihn erst nach
     * dem dritten Klick liest, hat dreimal etwas gesucht, was es nicht gibt.
     */
    await expect(
      page.getByRole('heading', { name: 'Kein Modellzugang eingerichtet' }),
    ).toBeVisible();

    // Und kein Weg, trotzdem einen Lauf zu starten.
    await expect(page.getByRole('button', { name: /starten/iu })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /lauf starten/iu })).toHaveCount(0);
  });

  test('das Budget nennt seine Obergrenze — und dass sie ein Platzhalter ist', async ({ page }) => {
    /*
     * `agent.budget_verwalten` haelt nur `super_admin` — und das ist die
     * Absicht, nicht eine Luecke im Seed: eine Obergrenze fuer die KI ist
     * eine Ausgabenentscheidung, keine Verwaltungsaufgabe. Der Gruppenadmin
     * wechselt dafuer in die Gesellschaft; die Seite liegt unter `M1` und
     * nicht in der Gruppenansicht, weil sie eine einzelne Gesellschaft
     * betrifft.
     */
    await anmelden(page, KONTO.gruppe);
    await page.goto(`/portal/${MANDANT}/agenten/budget`);

    await expect(page.getByRole('heading', { name: 'KI-Budget', level: 1 })).toBeVisible();
    await expect(page.getByText('Platzhalter').first()).toBeVisible();

    /*
     * Die Warnschwelle wird NICHT erfunden (O-195). Dass der Bildschirm das
     * hinschreibt, statt eine plausible Zahl zu zeigen, ist die Prüfung.
     */
    await expect(page.getByText(/Warnschwelle: nicht hinterlegt/u)).toBeVisible();
  });

  test('ein Agent zeigt seine Grenzen und was hinausgehen darf', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten/akquise`);

    await expect(page.getByRole('heading', { name: 'Akquise-Assistent', level: 1 }))
      .toBeVisible();
    await expect(page.getByRole('heading', { name: 'Grenzen' })).toBeVisible();

    // Invariante 7: der Seed setzt jede Richtlinie auf „nur nach Freigabe".
    await expect(page.getByRole('heading', { name: 'Was hinausgehen darf' })).toBeVisible();
    await expect(page.getByText(/Nur nach menschlicher Freigabe/u).first()).toBeVisible();
  });

  test('wer nur agent.lesen hält, kommt an das Budget nicht heran', async ({ page }) => {
    /*
     * `admin` sieht die Agenten und ihre Laeufe, aber nicht die Obergrenze.
     * Das ist dieselbe Trennung wie beim Protokoll: sehen, DASS etwas laeuft,
     * ist nicht dasselbe wie ueber sein Geld zu entscheiden.
     */
    await anmelden(page, KONTO.adminReinigung);
    const antwort = await page.goto(`/portal/${MANDANT}/agenten/budget`);
    expect(antwort?.status()).toBe(404);
  });

  test('ein Agentenname, den es nicht gibt, ist ein 404 — kein leerer Bildschirm', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    const antwort = await page.goto(`/portal/${MANDANT}/agenten/gibt-es-nicht`);
    expect(antwort?.status()).toBe(404);
  });

  test('wer das Recht nicht hält, sieht das Zentrum nicht (AUT-06)', async ({ page }) => {
    /*
     * Der Kunde hat kein `agent.lesen`. Er bekommt keinen leeren Bildschirm
     * und keine Fehlermeldung, die die Existenz verrät — er bekommt 404.
     */
    await anmelden(page, KONTO.kunde);
    const antwort = await page.goto(`/portal/${MANDANT}/agenten`);
    expect(antwort?.status()).toBe(404);
  });
});
