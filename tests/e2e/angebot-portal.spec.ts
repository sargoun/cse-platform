/**
 * OPS-07 bis OPS-09 im Browser — vom Raumbuch zum Auftrag, in fuenf Klicks.
 *
 * Das ist die Kette, die das Abnahmekriterium der Phase 4 im Ganzen zeigt:
 * gerechnet wird aus der Flaeche, angeboten wird mit Nummer, gewandelt wird
 * in einer Handlung. Und dazwischen die Zusage, die zaehlt: **nichts geht
 * hinaus, ohne dass ein Mensch geklickt hat.**
 *
 * **Aus vier Klicks sind fuenf geworden, und das ist der Punkt.** Bis zur
 * Auftrennung setzte `versendeAngebot` Preisfreigabe UND Versand in einem
 * UPDATE. Der Rechtekatalog fuehrt sie getrennt:
 * `angebot.preis_freigeben` haben super_admin und leitung (bindbar an admin),
 * `angebot.versenden` zusaetzlich admin. Ein Klick fuer beides hiess also:
 * eine Administration hat den Preis freigegeben, ohne dieses Recht zu halten.
 *
 * **Und darum laeuft diese Suite jetzt als `leitungReinigung`.** Sie lief als
 * `adminReinigung` — ein Konto, das den Preis nach der Auftrennung gar nicht
 * freigeben DARF; die Freigabeseite antwortet ihm mit 404 (AUT-06). Das ist
 * kein Mangel des Tests, sondern die Zusage, die er jetzt zeigt: wer versenden
 * darf, darf darum nicht den Preis verantworten. Die Vier-Augen-Lage selbst —
 * zwei Menschen, zwei Rechte — prueft `tests/isolation/angebot-dienst.test.ts`,
 * wo sich zwei Sitzungen billiger nebeneinanderstellen lassen als im Browser.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
/**
 * Angemeldet wird als BESTIMMTES Konto, nicht als „irgendwer mit Rolle admin".
 *
 * Die oertliche Hilfe griff `[data-rolle="admin"]`.first(); seit der Seed ein
 * zweites Verwaltungskonto kennt, steht „Administration Bau" in der nach Namen
 * sortierten Liste vor „Administration Reinigung". Die Sitzung landete damit
 * im Mandanten `bau`, und jeder Aufruf unter `/portal/reinigung/…` antwortete
 * zu Recht mit 404 (Slug-Wache, AUT-06) — ein Fehlschlag, der wie ein kaputter
 * Bildschirm aussah und eine falsche Anmeldung war.
 */
import { alsKonto, KONTO } from './hilfen/anmeldung';

async function zumRaumbuch(page: Page): Promise<void> {
  await page.goto('/portal/reinigung/objekte');
  await page.getByRole('link', { name: 'Bürohaus Kurfürstendamm' }).click();
  await page.getByRole('link', { name: 'Raumbuch und Kalkulation' }).click();
  await expect(page.locator('h1')).toHaveText('Raumbuch');
}


/**
 * Die Werte bestaetigen — der Schritt, den das Abnahmekriterium verlangt.
 *
 * Ein Angebot aus dem Raumbuch ruht auf den Platzhaltern O-16 und O-17; die
 * Datenbank laesst es nicht hinaus, und der Versandknopf ist deshalb
 * gesperrt. Genau das ist die Zusage dieser Phase — und der Weg daran vorbei
 * ist kein Schalter, sondern das Eintragen der Zahlen.
 */
async function kalkulationBestaetigen(page: Page): Promise<void> {
  await page.locator('[data-cse="zur-kalkulation"]').click();
  await expect(page.locator('[data-cse="kalkulation-form"]')).toBeVisible();
  await page.locator('[data-cse="feld-stundensatz"]').fill('29,00');
  await page.locator('[data-cse="feld-gemeinkosten"]').fill('15');
  await page.locator('[data-cse="feld-wagnis"]').fill('8');
  /**
   * Der Frequenzfaktor (O-56) — seit D-105 ein eigenes Feld.
   *
   * `PLATZHALTER_FREQUENZ` raet ihn aus dem Turnus, und die Bestaetigung
   * loeschte diese Raute frueher mit, ohne je danach gefragt zu haben. Wer
   * bestaetigt, nennt ihn jetzt; `1` ist der Faktor des monatlichen Turnus,
   * mit dem dieses Angebot gerechnet wurde.
   */
  const frequenz = page.locator('[data-cse="feld-frequenz"]');
  if (await frequenz.count() > 0) await frequenz.fill('1');
  /**
   * Das Haekchen erscheint NUR, solange die Leistungswerte offen sind. Seit
   * D-105 haengt das am SCHNAPPSCHUSS dieser Kalkulation, nicht mehr am
   * geteilten Katalog: ein frueher bestaetigtes Angebot raeumt dieses hier
   * nicht mehr mit ab. Die Pruefung auf `count()` bleibt trotzdem — die Suite
   * teilt sich eine Datenbank, und ein Helfer, der einen festen Zustand
   * voraussetzt, prueft die Reihenfolge der Tests statt die Anwendung.
   */
  const haken = page.locator('[data-cse="feld-leistungswerte"]');
  if (await haken.count() > 0) await haken.check();
  await page.locator('[data-cse="kalkulation-bestaetigen"]').click();

  /**
   * **Und dann die PREISFREIGABE** — der zweite Schritt, den es vor der
   * Auftrennung nicht gab.
   *
   * Bestaetigte Werte machen den Versand noch nicht frei: der Preis ist
   * gerechnet, aber niemand hat ihn verantwortet. Die Detailseite sagt das mit
   * `[data-cse="freigabe-fehlt"]`, und der Versandknopf bleibt gesperrt —
   * genau die Trennung, die `angebot.preis_freigeben` und `angebot.versenden`
   * ausdruecken.
   */
  await expect(page.locator('[data-cse="freigabe-fehlt"]')).toBeVisible();
  await expect(page.locator('[data-cse="versenden"]')).toBeDisabled();
  await page.locator('[data-cse="zur-freigabe"]').click();
  await expect(page.locator('h1')).toHaveText('Preisfreigabe');
  await page.locator('[data-cse="preis-freigeben"]').click();

  /*
   * Die Freigabe fuehrt auf die VERSANDSEITE (das ist der naechste Schritt),
   * nicht auf die Detailseite. Von dort zurueck zum Angebot — die uebrigen
   * Faelle dieser Datei klicken `[data-cse="versenden"]` dort.
   *
   * **Der Rueckweg ist `<Zurueck>` (D-613)**: ein `<nav aria-label="Zurück">`
   * mit dem Pfeil als `aria-hidden` — der Name des Verweises ist „Zum
   * Angebot", nicht „← Zum Angebot". Hier stand der Name der alten,
   * handgeschriebenen Verweiszeile mit dem Pfeil im Text. Gesucht wird
   * jetzt genau DIESER Verweis: im Rueckweg der Seite, mit exaktem Namen.
   */
  await expect(page.locator('h1')).toHaveText('Versand');
  await expect(page.locator('[data-cse="sperre-freigabe-frei"]')).toBeVisible();
  await page.getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Zum Angebot', exact: true }).click();
  await expect(page.locator('[data-cse="freigabe-erteilt"]')).toBeVisible();
  await expect(page.locator('[data-cse="versenden"]')).toBeEnabled();
}

test.describe('(1) Aus der Kalkulation wird ein Angebot', () => {
  test('der Knopf legt eines an und führt hinein', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();

    await expect(page).toHaveURL(/\/portal\/reinigung\/angebote\/[0-9a-f-]{36}$/u);
    // Der Entwurf traegt noch keine Nummer — sie entsteht beim Versand.
    await expect(page.getByText('entsteht beim Versand').first()).toBeVisible();
    // Und die Position erklaert sich selbst.
    await expect(page.getByText(/÷ .* m²\/h/u).first()).toBeVisible();
  });

  test('das Angebot erscheint in der Liste', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    await page.goto('/portal/reinigung/angebote');
    await expect(page.locator('h1')).toHaveText('Angebote');
    await expect(page.getByText('ohne — Entwurf').first()).toBeVisible();
  });
});

test.describe('(2) Der Versand — und was er erzeugt', () => {
  test('ein Klick, eine Nummer, ein unveränderliches Dokument', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const angebotsUrl = page.url();

    // Der Versandknopf ist GESPERRT, solange die Werte Platzhalter sind.
    await expect(page.locator('[data-cse="versenden"]')).toBeDisabled();
    await expect(page.locator('[data-cse="kalkulation-offen"]')).toBeVisible();
    await kalkulationBestaetigen(page);

    await page.locator('[data-cse="versenden"]').click();
    await page.waitForURL(angebotsUrl);

    // Die Nummer steht jetzt da, und der Versandknopf ist fort.
    await expect(page.getByText(/AN-\d{4}-\d{5}/u).first()).toBeVisible();
    await expect(page.locator('[data-cse="versenden"]')).toHaveCount(0);
    // Die Umsatzsteuerzeile ist beim Versand entstanden.
    await expect(page.getByText(/Umsatzsteuer 19 %/u)).toBeVisible();
  });

  test('das Angebotsdokument trägt die Identität DIESER Gesellschaft', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    await kalkulationBestaetigen(page);
    await page.locator('[data-cse="versenden"]').click();
    await page.getByRole('link', { name: 'Angebotsdokument' }).click();

    const blatt = page.locator('[data-cse="angebotsdokument"]');
    await expect(blatt).toBeVisible();
    // Die Reinigung druckt IHRE Firma — nicht die der Gruppe.
    await expect(blatt.getByText('CSE Dienstleistungen GmbH').first()).toBeVisible();
    // Weisses Blatt, dunkler Text (DESIGN §11).
    await expect(blatt).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(blatt).toHaveCSS('color', 'rgb(17, 17, 17)');
    await expect(page.locator('[data-cse="brutto"]')).toHaveText(/\d+,\d{2}\s?€/u);
  });
});

test.describe('(3) Angebot → Auftrag, in einer Handlung (OPS-09)', () => {
  test('ein Klick, und der Auftrag steht', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const angebotsUrl = page.url();
    await kalkulationBestaetigen(page);
    await page.locator('[data-cse="versenden"]').click();
    await page.waitForURL(angebotsUrl);

    await page.locator('[data-cse="in-auftrag"]').click();
    await page.waitForURL(angebotsUrl);
    await expect(page.getByText(/Auftrag AU-\d{4}-\d{5} entstanden/u)).toBeVisible();
    // Und ein zweites Mal geht nicht.
    await expect(page.locator('[data-cse="in-auftrag"]')).toHaveCount(0);
  });
});

test.describe('(4) barrierefrei', () => {
  test('axe findet nichts auf dem Angebot', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ergebnis.violations).toEqual([]);
  });
});

test.describe('(5) Ein Preis auf Platzhaltern geht NICHT hinaus', () => {
  /**
   * Das Abnahmekriterium der Phase, im Browser: der Knopf ist gesperrt, der
   * Grund steht daneben, und der Weg heraus ist sichtbar. Ein gesperrter
   * Knopf ohne Erklaerung waere eine Sackgasse mit Tooltip.
   */
  test('der Versandknopf ist gesperrt, und die Seite sagt warum', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();

    await expect(page.locator('[data-cse="versenden"]')).toBeDisabled();
    await expect(page.locator('[data-cse="kalkulation-offen"]')).toContainText('O-16');
    await expect(page.locator('[data-cse="zur-kalkulation"]')).toBeVisible();
  });

  /**
   * Die ZWEITE Sperre, und sie ist eine andere: die Werte sind bestaetigt, der
   * Preis ist gerechnet — verantwortet hat ihn niemand. Ein gesperrter Knopf
   * ohne diesen Unterschied waere eine Sackgasse mit zwei Ursachen und einem
   * Satz.
   */
  test('und die Freigabeseite sperrt, solange Werte offen sind', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const angebotsUrl = page.url();

    await page.goto(`${angebotsUrl}/freigabe`);
    await expect(page.locator('h1')).toHaveText('Preisfreigabe');
    await expect(page.locator('[data-cse="freigabe-gesperrt"]')).toContainText('O-16');
    // Kein Knopf — und ein Satz, der den Weg heraus nennt.
    await expect(page.locator('[data-cse="preis-freigeben"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="zur-kalkulation"]')).toBeVisible();
  });

  /**
   * Und der Versand nennt die drei Sperren einzeln. „Irgendetwas ist offen"
   * schickt niemanden an die richtige Stelle.
   */
  test('die Versandseite nennt die drei Sperren einzeln', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const angebotsUrl = page.url();

    await page.goto(`${angebotsUrl}/versand`);
    await expect(page.locator('h1')).toHaveText('Versand');
    await expect(page.locator('[data-cse="sperre-kalkulation"]')).toBeVisible();
    await expect(page.locator('[data-cse="sperre-freigabe"]')).toBeVisible();
    // Positionen gibt es — die dritte Sperre ist frei.
    await expect(page.locator('[data-cse="sperre-positionen-frei"]')).toBeVisible();
    // Und der Kanal sagt die Wahrheit: nicht verbunden (O-36).
    await expect(page.locator('[data-cse="kanal-nicht-verbunden"]'))
      .toContainText('O-36');
    await expect(page.locator('[data-cse="versenden"]')).toHaveCount(0);
  });

  test('die Kalkulationsseite zeigt den Rechenweg, bevor sie nach Zahlen fragt',
    async ({ page }) => {
      await alsKonto(page, KONTO.leitungReinigung);
      await zumRaumbuch(page);
      await page.locator('[data-cse="angebot-erzeugen"]').click();
      await page.locator('[data-cse="zur-kalkulation"]').click();

      await expect(page.locator('h1')).toHaveText('Kalkulation');
      // Flaeche ÷ Leistungswert × Stundensatz — nachrechenbar, Zeile fuer Zeile.
      await expect(page.getByText(/m²\/h/u).first()).toBeVisible();
      await expect(page.locator('[data-cse="kalkulation-offen"]')).toBeVisible();
      await expect(page.locator('[data-cse="kalkulation-form"]')).toBeVisible();
    });

  test('nach dem Versand ist die Kalkulation eingefroren', async ({ page }) => {
    await alsKonto(page, KONTO.leitungReinigung);
    await zumRaumbuch(page);
    await page.locator('[data-cse="angebot-erzeugen"]').click();
    const angebotsUrl = page.url();
    await kalkulationBestaetigen(page);
    await page.locator('[data-cse="versenden"]').click();
    await page.waitForURL(angebotsUrl);

    // Die Seite bleibt erreichbar — nur aendern laesst sich dort nichts mehr.
    await page.goto(`${angebotsUrl}/kalkulation`);
    await expect(page.locator('[data-cse="kalkulation-eingefroren"]')).toBeVisible();
    await expect(page.locator('[data-cse="kalkulation-form"]')).toHaveCount(0);
  });
});
