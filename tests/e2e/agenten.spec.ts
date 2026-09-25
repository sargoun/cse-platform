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
  /**
   * **Die Übersicht sagt denselben Zustand wie die Detailseite.**
   *
   * Sie behauptete unbedingt „Kein Modellzugang eingerichtet" — ein Satz aus
   * der Zeit vor dem Modellregister (0154). Seit der Demobetrieb eingetragen
   * ist, zeigt die Detailseite daneben einen Startknopf, und die Übersicht
   * darüber sagte das Gegenteil. Zwei Bildschirme, zwei Wahrheiten: wer den
   * Knopf drückt, glaubt der Übersicht danach nichts mehr. Dieser Test prüft
   * jetzt, dass beide aus derselben Quelle sprechen.
   */
  test('zeigt die vier Agenten — und welches Modell wirklich gilt', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten`);

    await expect(page.getByRole('heading', { name: 'Agenten', level: 1 })).toBeVisible();

    for (const name of [
      'CEO-Assistent', 'Akquise-Assistent', 'Rueckbuero-Assistent', 'Finanz-Assistent',
    ]) {
      await expect(page.getByRole('link', { name })).toBeVisible();
    }

    /*
     * Der Demobetrieb ist eingetragen, also sagt die Seite das — und sagt
     * dazu, was er ist: eigener Prozess, kein Anbieter, kein Netzverkehr.
     * Der Satz „kein Modellzugang" darf hier NICHT stehen, solange einer da
     * ist.
     */
    const banner = page.locator('[data-cse="agenten-demobetrieb"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('demo:hausintern-v1');
    await expect(banner).toContainText('kein Anbieter, kein Netzverkehr');
    await expect(page.locator('[data-cse="agenten-kein-modell"]')).toHaveCount(0);

    /*
     * Und die Detailseite daneben zeigt denselben Zustand — mit dem Knopf,
     * dessen Fehlen die Übersicht vorher behauptete.
     */
    await page.getByRole('link', { name: 'Rueckbuero-Assistent' }).click();
    await expect(page.locator('[data-cse="agent-modell"]'))
      .toContainText('demo:hausintern-v1');
    await expect(page.locator('[data-cse="agent-starten"]')).toBeVisible();
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

    /*
     * D-474: die Gruppensitzung bekommt auf einer Mandantsseite das
     * Wechselblatt — ein GET wechselt den Bereich nie (03-AUTH §4.5). Der
     * Wechsel ist ein POST, und er fuehrt auf die Seite zurueck, die gemeint
     * war. Vorher antwortete das Tor 404, weil es das Recht im Gruppen-Scope
     * fragte, wo `verwalten` immer `false` ist (Invariante 10).
     */
    await expect(page.locator('[data-cse="wechsel-frage"]')).toContainText('Gruppenübersicht');
    await page.locator('[data-cse="wechsel-knopf"]').click();
    await expect(page).toHaveURL(new RegExp(`/portal/${MANDANT}/agenten/budget$`, 'u'));
    await expect(page.getByRole('heading', { name: 'KI-Budget', level: 1 })).toBeVisible();
    await expect(page.getByText('Platzhalter').first()).toBeVisible();

    /*
     * Die Warnschwelle wird NICHT erfunden (O-195). Dass der Bildschirm das
     * hinschreibt, statt eine plausible Zahl zu zeigen, ist die Prüfung.
     */
    await expect(page.getByText(/Warnschwelle: nicht hinterlegt/u)).toBeVisible();
  });

  /**
   * **Eine gesetzte Warnschwelle steht in ihrer Zeile** (V-245, D-739; V-254,
   * D-746).
   *
   * Der Seed setzt keine Schwelle (O-195), also lief dieser Zweig der Seite in
   * keinem Browserlauf. Der Fall legt deshalb selbst eine an — über die
   * Maske, wie ein Mensch — und zwar für Dezember 2099: einen Monat, den kein
   * Agent bucht, damit die Zeile des laufenden Monats und der Fall darüber
   * unberührt bleiben. Die 80 ist Testeingabe, keine Vorgabe. Der Satz „nicht
   * hinterlegt" bleibt stehen, denn die Zeile des laufenden Monats hat weiter
   * keine; dass er verschwindet, sobald JEDE Zeile eine hat, prüft
   * `tests/kern/agent-budget-warnschwelle.test.ts`.
   */
  test('eine gesetzte Warnschwelle steht in ihrer Zeile — der Satz bleibt, solange eine fehlt', async ({ page }) => {
    await anmelden(page, KONTO.gruppe);
    await page.goto(`/portal/${MANDANT}/agenten/budget`);
    const wechsel = page.locator('[data-cse="wechsel-knopf"]');
    if ((await wechsel.count()) > 0) await wechsel.click();
    await expect(page).toHaveURL(new RegExp(`/portal/${MANDANT}/agenten/budget$`, 'u'));

    await page.locator('[data-cse="budget-jahr"]').fill('2099');
    await page.locator('[data-cse="budget-monat"]').fill('12');
    await page.locator('[data-cse="budget-betrag"]').fill('10,00');
    await page.locator('[data-cse="budget-warnschwelle"]').fill('80');
    await page.locator('[data-cse="budget-speichern"]').click();

    await expect(page.locator('[data-cse="budget-gesetzt"]')).toBeVisible();
    await expect(page.locator('[data-cse="budget-warnung-ab"]').first())
      .toHaveText('Warnung ab 80 %');
    await expect(page.locator('[data-cse="budget-warnschwelle-offen"]'))
      .toContainText('Warnschwelle: nicht hinterlegt');
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
    await page.goto(`/portal/${MANDANT}/agenten`);
    /*
     * Die K-04-Decke (`zugang.ts`): ein Kundenkonto auf einer Mandantsseite
     * landet in SEINEM Portal — nicht auf einem 404, das es ratlos
     * zuruecklaesst. Ueber die Existenz der Seite sagt das nichts: jeder
     * Mandantspfad fuehrt fuer dieses Konto denselben Weg, ob es die Seite
     * gibt oder nicht. Hier stand `toBe(404)` — das beschrieb den Stand vor
     * der Decke (HANDOVER-PR62 §5).
     */
    await expect(page).toHaveURL(/\/portal\/kunde$/u);
    await expect(page.getByRole('heading', { name: 'Agenten', level: 1 })).toHaveCount(0);
  });
});

/**
 * **Die Laufansicht — die Seite, die niemand je geöffnet hat** (AGT-01,
 * AGT-04).
 *
 * `/portal/[mandant]/agenten/[agent]/aufgaben/[id]` antwortete mit **500**, für
 * jede Rolle und in jeder Gesellschaft, seit es sie gibt: die Abfrage las
 * `a.ausloeser`, und das ist der TYPNAME aus 0128 — die Spalte heisst
 * `ausgeloest_durch`. Überlebt hat der Tippfehler, weil kein einziger
 * Browserlauf diese Adresse je angesteuert hat. Sie stand in der Seitenkarte,
 * war bewacht, hatte Rechte, Marken und einen sorgfältigen Kopfkommentar — und
 * niemand ist je auf sie geklickt. Gefunden hat sie erst der erweiterte
 * Verweiselauf (D-575), der jedem gezeigten Link bis zum Ende folgt.
 *
 * **Deshalb wird hier GEKLICKT und nicht `goto` gerufen.** Eine Prüfung, die
 * eine Adresse direkt ansteuert, prüft die Seite; eine, die den Weg dorthin
 * geht, prüft ausserdem, dass es ihn gibt.
 */
test.describe('Ein Lauf, von vorne bis hinten', () => {
  test('von der Agentenseite auf die Laufansicht — und sie antwortet 200', async ({ page }) => {
    await anmelden(page, KONTO.adminReinigung);
    await page.goto(`/portal/${MANDANT}/agenten`);

    const agent = page.locator('[data-cse="agent-karte"] a, [data-cse="agentenliste"] a').first();
    if (await agent.count() === 0) {
      await page.goto(`/portal/${MANDANT}/agenten/backoffice`);
    } else {
      await agent.click();
    }
    await page.waitForLoadState('domcontentloaded');

    const lauf = page.locator('a[href*="/aufgaben/"]').first();
    expect(await lauf.count(), 'kein Lauf verlinkt — der Seed führt je Agent einen')
      .toBeGreaterThan(0);
    await lauf.click();
    await page.waitForURL(/\/aufgaben\/[0-9a-f-]{36}/u);

    /*
     * **Der Beweis ist nicht „200", sondern ein Feld, das aus der Abfrage
     * kommt.** Ein 500 würde hier zwar auch auffallen, aber `lauf-ausloeser`
     * liest GENAU die Spalte, die den Ausfall verursacht hat.
     */
    await expect(page.locator('[data-cse="lauf-ausloeser"]')).toBeVisible();
    await expect(page.locator('h1')).not.toContainText('schiefgegangen');
  });
});
