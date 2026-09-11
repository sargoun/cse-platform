/**
 * PR 40 durch den Browser — Reviere, Leistungsnachweis, Unterschrift,
 * Reklamation (CLN-01, CLN-04, OPS-11).
 *
 * **Diese Spezifikation läuft NICHT in der Entwicklungsdatenbank dieses PRs.**
 * Sie braucht einen Build und die gemeinsame Seed-Datenbank; sie steht hier
 * als das, was der Browser nachweisen soll, und wird im gemeinsamen Lauf
 * ausgeführt.
 *
 * Was sie prüft, prüft kein Unit- und kein Isolationstest:
 *
 *  - Die **Prüfsumme** steht wirklich im Formular, das der Kunde absendet.
 *    Der Dienst vergleicht sie serverseitig — aber nur, wenn die Seite sie
 *    mitschickt, und genau das kann nur der Browser zeigen.
 *  - Nach der Unterschrift zeigt das Blatt den **Abzug**, nicht die lebende
 *    Tabelle. Das ist der Unterschied, um den es in CLN-04 geht, und er ist an
 *    der gerenderten Seite sichtbar oder gar nicht.
 *  - Die Zuordnung eines Raums ist **nicht abwählbar**: das Häkchen steht
 *    gesetzt und gesperrt da, weil `revier_raum` unter Löschsperre steht.
 */
import { expect, test } from '@playwright/test';

const MANDANT = 'reinigung';

test.describe('Reviere (CLN-01)', () => {
  test('die Liste nennt die Sollzeit als ZIELWERT und zeigt die Gegenprobe', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/reinigung/reviere`);

    // K-16(c): die Spaltenüberschrift sagt selbst, dass sie keinen gemessenen
    // Wert zeigt. Eine Minutenspalte ohne dieses Wort ist der Fehler, den die
    // Konvention verhindern will.
    await expect(page.getByRole('columnheader', { name: /Zielwert/u })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Summe Räume/u })).toBeVisible();
  });

  test('das Revierblatt stellt Kopfwert und Summe der Räume nebeneinander', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/reinigung/reviere`);
    await page.getByRole('link', { name: /EG|Revier|Zone/u }).first().click();

    await expect(page.getByText('Sollzeit je Durchgang — berechneter Zielwert')).toBeVisible();
    await expect(page.getByText('Summe der Räume')).toBeVisible();
    // Die beiden Zahlen müssen übereinstimmen; die Seite sagt es im Klartext.
    await expect(page.getByText(/Stimmt mit dem Kopf überein/u)).toBeVisible();
  });

  test('ein zugeordneter Raum lässt sich nicht abwählen', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/reinigung/reviere`);
    await page.getByRole('link', { name: /EG|Revier|Zone/u }).first().click();
    await page.getByRole('link', { name: /Räume zuordnen/u }).click();

    const gesetzt = page.locator('input[name="raum"][checked]').first();
    if (await gesetzt.count() > 0) {
      // Gesperrt, nicht bloss vorausgewählt: eine Zuordnung steht unter
      // Löschsperre und lässt sich nicht lösen (§5.2).
      await expect(gesetzt).toHaveAttribute('readonly', '');
    }
  });
});

test.describe('Leistungsnachweis und Unterschrift (CLN-04)', () => {
  test('das Unterschriftsblatt trägt die Prüfsumme im Formular', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/reinigung/leistungsnachweise`);
    await page.getByRole('link', { name: /LN-|ohne Nummer/u }).first().click();

    const unterschreiben = page.getByRole('link', { name: 'Unterschreiben lassen' });
    if (await unterschreiben.count() === 0) test.skip();
    await unterschreiben.click();

    const pruefsumme = page.locator('input[name="pruefsumme"]');
    await expect(pruefsumme).toHaveAttribute('value', /^[0-9a-f]{64}$/u);
    // Der Bestätigungstext ist DEUTSCH und bleibt es, auch wenn die Bedienung
    // übersetzt wird (EMP-12, SEITENKARTE §5.7).
    await expect(page.getByText(/hiermit bestätigt/u)).toBeVisible();
  });

  test('unterschreiben speichert Name und Serverzeit und friert das Blatt ein',
    async ({ page }) => {
      await page.goto(`/portal/${MANDANT}/reinigung/leistungsnachweise`);
      await page.getByRole('link', { name: /LN-|ohne Nummer/u }).first().click();

      const unterschreiben = page.getByRole('link', { name: 'Unterschreiben lassen' });
      if (await unterschreiben.count() === 0) test.skip();
      await unterschreiben.click();

      await page.getByLabel('Name der unterzeichnenden Person').fill('Frau Özdemir');
      await page.getByRole('button', { name: 'Unterschreiben' }).click();

      await expect(page.getByText('Unterschrift')).toBeVisible();
      await expect(page.getByText('Frau Özdemir')).toBeVisible();
      // Die Serverzeit steht als solche da — nicht als „Zeit".
      await expect(page.getByText(/Serverzeit \(Europe\/Berlin\)/u)).toBeVisible();
      // Und die Gerätezeit DANEBEN, nicht an ihrer Stelle (TIM-08).
      await expect(page.getByText(/Gerätezeit — getrennt gespeichert/u)).toBeVisible();

      // Nach der Unterschrift: der ABZUG, nicht die lebende Tabelle.
      await expect(page.getByText(/Abzug der Unterschrift/u)).toBeVisible();
      await expect(page.getByText(/unveränderliche Kopie/u)).toBeVisible();
      // Die Prüfsumme steht sichtbar da und ist nachgerechnet.
      await expect(page.getByText(/Nachgerechnet/u)).toBeVisible();
      // Und der Weg zum Unterschreiben ist weg.
      await expect(page.getByRole('link', { name: 'Unterschreiben lassen' })).toHaveCount(0);
    });

  test('ohne Bildspeicher sagt die Seite „nicht verbunden" statt zu tun als ob',
    async ({ page }) => {
      await page.goto(`/portal/${MANDANT}/reinigung/leistungsnachweise`);
      await page.getByRole('link', { name: /LN-|ohne Nummer/u }).first().click();
      const unterschreiben = page.getByRole('link', { name: 'Unterschreiben lassen' });
      if (await unterschreiben.count() === 0) test.skip();
      await unterschreiben.click();
      await expect(page.getByText(/nicht verbunden/u)).toBeVisible();
    });
});

test.describe('Reklamation (OPS-11)', () => {
  test('die Liste zeigt den bestrittenen Nachweis als Verweis', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/qualitaet/reklamationen`);
    await expect(
      page.getByRole('columnheader', { name: 'Bestrittener Nachweis' }),
    ).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Nacharbeit' })).toBeVisible();
  });

  test('„behoben" ohne Maßnahme wird abgewiesen', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/qualitaet/reklamationen`);
    const erste = page.getByRole('link', { name: /^RK-/u }).first();
    if (await erste.count() === 0) test.skip();
    await erste.click();

    await page.getByLabel('Abstellmaßnahme — Pflicht, sobald der Zustand „Behoben" ist').fill('');
    await page.getByLabel('Zustand').selectOption('behoben');
    await page.getByRole('button', { name: 'Speichern' }).click();

    // Der Dienst weist ab; die Datenbank täte es ein zweites Mal.
    await expect(page.locator('body')).toContainText(/ungueltiger_zustand|nicht behoben/u);
  });

  test('die Frist bleibt leer, solange O-14 offen ist', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/qualitaet/reklamationen`);
    const erste = page.getByRole('link', { name: /^RK-/u }).first();
    if (await erste.count() === 0) test.skip();
    await erste.click();
    // Kein erfundener Termin — die offene Frage steht im Klartext am Feld.
    await expect(page.getByText('offen (O-14)')).toBeVisible();
  });
});
