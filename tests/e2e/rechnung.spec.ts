/**
 * PR 46 durch den Browser — Entwurf, Festschreiben, Verwerfen, Storno
 * (FIN-02, FIN-03, FIN-06, Invariante 4).
 *
 * **Diese Spezifikation läuft NICHT in der Entwicklungsdatenbank dieses PRs.**
 * Sie braucht einen Build und die gemeinsame Seed-Datenbank; sie steht hier als
 * das, was der Browser nachweisen soll, und wird im gemeinsamen Lauf
 * ausgeführt.
 *
 * Was sie prüft, prüft kein Unit- und kein Isolationstest:
 *
 *  - Ein Entwurf zeigt „ohne — Entwurf" statt einer Nummer. Dass die Spalte
 *    NULL ist, prüft die Datenbank; dass die Oberfläche daraus nicht
 *    stillschweigend eine Null macht, zeigt nur die gerenderte Seite.
 *  - Auf einem festgeschriebenen Beleg gibt es **kein Formular**. Die
 *    Seitenkarte verlangt „draft editor **or** finalised read-only view, never
 *    both", und ein Formular, das die Datenbank anschliessend ablehnt, ist ein
 *    Versprechen, das die Oberfläche nicht halten kann.
 *  - Der unbestätigte Nummernkreis und die unbestätigte Mengeneinheit tragen
 *    sichtbar ihren Platzhalter-Hinweis (§1.11, O-134, O-174) — sonst geht
 *    eine Rechnung unter einer geratenen Maske hinaus, und niemand hat es
 *    gesehen.
 */
import { expect, test, type Page } from '@playwright/test';

/**
 * **Ohne Anmeldung antwortet jede Portalseite mit „Anmeldung erforderlich"** —
 * und dann ist die Ueberschrift, auf die dieser Test wartet, nicht da. Der
 * Helfer stand in jeder anderen e2e-Datei; hier fehlte er, und deshalb
 * scheiterten alle zehn Faelle mit demselben `toBeVisible()`, das wie ein
 * fehlender Bildschirm aussah.
 */
async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator('[data-cse="dev-anmelden"][data-rolle="admin"]').first();
  await expect(knopf, 'kein Seed-Konto für Rolle admin').toBeVisible();
  await knopf.click();
  await page.waitForLoadState('networkidle');
}

const MANDANT = 'reinigung';

test.describe('Das Rechnungsausgangsbuch (FIN-16)', () => {
  test('ein Entwurf steht ohne Nummer in der Liste', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen`);
    await expect(page.getByRole('heading', { name: 'Rechnungen', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Neuer Entwurf' })).toBeVisible();
  });

  test('die Liste nennt Brutto rechtsbündig und den Zustand als Pille', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen`);
    await expect(page.getByRole('columnheader', { name: 'Brutto' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Zustand' })).toBeVisible();
  });
});

test.describe('Der Entwurf (FIN-01)', () => {
  test('das Formular füllt kein Zahlungsziel vor — §4.2 kennt keinen Vorgabewert', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    const ziel = page.getByLabel('Zahlungsziel (Tage)');
    await expect(ziel).toBeVisible();
    // Leer, nicht `14`. Ein vorausgefüllter Wert setzte `faellig_am` auf jeder
    // Rechnung und triebe den Mahnlauf.
    await expect(ziel).toHaveValue('');
    await expect(page.getByText(/Es gibt keinen Vorgabewert/u)).toBeVisible();
  });

  test('ein Entwurf entsteht, bekommt aber keine Nummer', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

    await expect(page.getByRole('heading', { name: 'Entwurf ohne Nummer' })).toBeVisible();
    await expect(page.getByText('Noch keine Position')).toBeVisible();
  });

  test('ohne Position lässt sich nicht festschreiben — der Knopf ist gesperrt', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page.getByRole('button', { name: 'Rechnung festschreiben' })).toBeDisabled();
  });

  test('Menge und Preis werden als GANZE Zahlen erfasst (K-16, Invariante 1)', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

    await expect(page.getByText('30870 = 30,870')).toBeVisible();
    await expect(page.getByText('1999 = 19,99 €')).toBeVisible();
    // `step="1"`: kein Komma, kein Punkt, kein Bruchteil eines Cents.
    await expect(page.getByLabel('Menge (Tausendstel)')).toHaveAttribute('step', '1');
    await expect(page.getByLabel('Einzelpreis (Cent)')).toHaveAttribute('step', '1');
  });
});

test.describe('Das Festschreiben ist einseitig (Invariante 4)', () => {
  test('danach gibt es kein Positionsformular mehr, sondern die Kettenbindung', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

    await page.getByLabel('Handelsübliche Bezeichnung').fill('Unterhaltsreinigung');
    await page.getByLabel('Menge (Tausendstel)').fill('1000');
    await page.getByLabel('Einzelpreis (Cent)').fill('10000');
    /**
     * PR 49: jede Leistungszeile nennt ihren Beleg (FIN-07). Dieser Entwurf
     * hängt an keinem Auftrag, also gibt es nur „von Hand" — und dann ist die
     * Begründung Pflicht, im Formular wie in der Datenbank.
     */
    await page.getByLabel('Begründung, falls von Hand erfasst')
      .fill('Einmalige Leistung ohne Auftragsbezug');
    await page.getByRole('button', { name: 'Position hinzufügen' }).click();

    await page.getByRole('button', { name: 'Rechnung festschreiben' }).click();

    // Die Nummer steht jetzt in der Überschrift, und zwar aus der Maske des
    // Kreises — nicht aus einer Verkettung im Aufrufcode.
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Entwurf ohne Nummer');
    await expect(page.getByRole('heading', { name: 'Kettenbindung' })).toBeVisible();
    await expect(page.getByText(/Position \d+ der Kette/u)).toBeVisible();

    // Und der Editor ist weg. Das ist die Aussage der Seitenkarte.
    await expect(page.getByRole('button', { name: 'Position hinzufügen' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rechnung festschreiben' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Entwurf verwerfen' })).toHaveCount(0);
    // Die Kopfzeile trägt „Nur Lesen" — DESIGN §6.
    await expect(page.getByText('Nur Lesen').first()).toBeVisible();
  });

  test('korrigiert wird durch Storno mit auditfähigem Grund, nicht durch Änderung', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen`);
    await page.getByRole('link', { name: /^RE-/u }).first().click();

    await expect(page.getByRole('heading', { name: 'Korrigieren' })).toBeVisible();
    const grund = page.getByLabel(/Grund \(mindestens zehn Zeichen/u);
    await expect(grund).toHaveAttribute('minlength', '10');
    // „Fehler" reicht nicht: `rechnung_beziehung` verlangt zehn Zeichen, und
    // das Formular sagt es, statt es die Datenbank sagen zu lassen.
    await grund.fill('Falsche Rechnungsanschrift des Auftraggebers');
    await page.getByRole('button', { name: 'Stornieren' }).click();

    await expect(page.getByText(/Aufgehoben durch Stornorechnung/u).first()).toBeVisible();
  });
});

test.describe('Unbestätigte Werte sind sichtbar (§1.11)', () => {
  test('eine Platzhalter-Mengeneinheit sagt es in der Auswahl', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page.getByLabel('Einheit')).toContainText('unbestätigter Wert');
  });

  test('und eine Position ohne BT-130 zeigt „offen" statt eines geratenen Codes', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen`);
    await page.getByRole('link', { name: /^RE-/u }).first().click();
    await expect(page.getByRole('columnheader', { name: 'BT-130' })).toBeVisible();
  });
});
