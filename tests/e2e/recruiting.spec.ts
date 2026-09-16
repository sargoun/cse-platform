/**
 * Recruiting im Browser, auf dem Weg, den ein Mensch nimmt (REC-01…REC-09).
 *
 * **Nicht „die Seite antwortet 200", sondern „der Vorgang geht durch".** Eine
 * Bewertung eintragen, sie auf der Bewerbung wiederfinden, entscheiden, und
 * den Stand danach sehen — das ist die Kette, die im Streit erklärt werden
 * muss, und sie läuft hier einmal am Stück.
 *
 * **Der Veröffentlichungsversuch gehört dazu, gerade weil er fehlschlägt.**
 * Keine Jobbörse ist verbunden (O-374); was geprüft wird, ist, dass der
 * Misserfolg VERMERKT wird und nicht als Erfolg aussieht (D-02, R-17).
 */
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

test('die Übersicht zeigt Bestand und nennt die Frist als Platzhalter', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung/recruiting');
  await expect(page.locator('h1')).toContainText('Recruiting');
  await expect(page.locator('[data-cse="kachel-raster"]')).toBeVisible();
  /* Die Zahl ist ein Platzhalter, und die Seite sagt es — sonst liest sie sich wie Recht. */
  await expect(page.locator('[data-cse="rec-frist"]')).toContainText('O-373');
});

test('die Sprungzeile zeigt nur, was diese Sitzung öffnen darf', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung/recruiting');
  const spruenge = page.locator('[data-cse="recruiting-sprung"]');
  const anzahl = await spruenge.count();
  expect(anzahl).toBeGreaterThan(2);
  /* Jeder gezeigte Sprung muss auch wirklich aufgehen (AUT-06, D-567). */
  for (let i = 0; i < anzahl; i += 1) {
    const ziel = await spruenge.nth(i).getAttribute('href');
    const antwort = await page.goto(ziel!, { waitUntil: 'domcontentloaded' });
    expect(antwort?.status(), ziel!).toBe(200);
  }
});

test('eine Stelle führt zu ihren Bewerbungen und ihren Veröffentlichungswegen',
  async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/recruiting/stellen');
    await expect(page.locator('h1')).toContainText('Stellen');

    /* Die erste Stelle mit Bewerbungen — der Seed legt sie veröffentlicht an. */
    await page.locator('table a, [data-cse="stapel"] a').first().click();
    await expect(page.locator('[data-cse="stelle-wege"]')).toBeVisible();
    await page.locator('[data-cse="stelle-wege"]').click();

    /* Alle vier Ziele stehen da — auch die, die nicht gehen, mit ihrem Grund. */
    const boersen = page.locator('[data-cse="boerse"]');
    await expect(boersen).toHaveCount(4);
    for (const b of await boersen.all()) {
      await expect(b).toHaveAttribute('data-verbunden', 'false');
    }
  });

test('ein Versuch gegen eine unverbundene Börse wird vermerkt, nicht beschönigt',
  async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/recruiting/stellen');
    await page.locator('table a, [data-cse="stapel"] a').first().click();
    await page.locator('[data-cse="stelle-wege"]').click();

    await page.locator('[data-cse="boerse-senden"]').first().click();
    /*
     * Zurück auf derselben Seite, mit einem Grund in der Adresse — und NICHT
     * auf einer weissen Seite mit JSON. Was zählt: nirgends steht
     * „veröffentlicht".
     */
    await expect(page).toHaveURL(/veroeffentlichung/u);
    await expect(page.locator('[data-cse="boerse"]').first())
      .toContainText('nicht verbunden');
  });

test('bewerten, wiederfinden, entscheiden — die Kette am Stück', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung/recruiting/bewerbungen');
  await expect(page.locator('h1')).toContainText('Bewerbungen');

  /* Eine Bewerbung, die noch keine Entscheidung trägt. */
  await page.locator('table a, [data-cse="stapel"] a').first().click();
  /*
   * **Erst warten, dann die Adresse lesen.** Ohne das `waitForURL` stand in
   * `bewerbung` noch die LISTE — und der Rücksprung darauf fand den
   * Entscheidungsknopf nicht, der dort mit Recht nicht steht. Das sah aus wie
   * ein fehlendes Recht und war eine fehlende Zeile im Test.
   */
  await page.waitForURL(/\/bewerbungen\/[0-9a-f-]{36}/u);
  const bewerbung = page.url();
  await expect(page.locator('[data-cse="rec-keine-dateien"]')).toContainText('O-375');

  await page.locator('[data-cse="zur-bewertung"]').click();
  await page.locator('[data-cse="kriterium-name"]').first().fill('Erfahrung im Objekt');
  await page.locator('[data-cse="kriterium-gewicht"]').first().fill('60');
  await page.locator('[data-cse="kriterium-punkte"]').first().fill('8');
  await page.locator('[data-cse="kriterium-begruendung"]').first()
    .fill('Fünf Jahre in vergleichbaren Objekten, im Lebenslauf belegt.');
  await page.locator('[data-cse="bewertung-speichern"]').click();

  /* Die Bewertung steht auf der Bewerbung — mit Gewicht, Punkten und Grund. */
  await expect(page).toHaveURL(/bewerbungen/u);
  await expect(page.locator('[data-cse="kriterium"]').first())
    .toContainText('Erfahrung im Objekt');

  await page.goto(bewerbung);
  await page.locator('[data-cse="zur-entscheidung"]').click();
  await page.locator('[data-cse="ergebnis-abgelehnt"]').check();
  await page.locator('[data-cse="entscheidung-begruendung"]')
    .fill('Die Anforderung „Führerschein Klasse B" ist nicht belegt.');
  await page.locator('[data-cse="entscheidung-speichern"]').click();

  await expect(page).toHaveURL(/bewerbungen/u);
  await expect(page.locator('body')).toContainText('Abgelehnt');
});

test('eine Entscheidung gibt es genau einmal', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung/recruiting/bewerbungen');
  await page.locator('table a, [data-cse="stapel"] a').first().click();
  await page.locator('[data-cse="zur-entscheidung"]').click();
  /*
   * Entweder das Formular (noch nicht entschieden) oder der Hinweis — aber
   * nie beides, und nie keines. Der vorige Fall hat je nach Reihenfolge schon
   * entschieden; beide Wege sind richtig, und genau das steht hier.
   */
  const formular = page.locator('[data-cse="entscheidung-formular"]');
  const schon = page.locator('[data-cse="schon-entschieden"]');
  await expect(formular.or(schon).first()).toBeVisible();
  expect(await formular.count() + await schon.count()).toBe(1);
});

test('die Datenschutzseite zeigt Fälliges UND Gesperrtes', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung/recruiting/datenschutz');
  await expect(page.locator('h1')).toContainText('Datenschutz');
  await expect(page.locator('[data-cse="rec-regel"]')).toContainText('vorläufig');
  /* Der Seed legt beides an — eine Seite, die nur eines zeigt, beweist nichts. */
  await expect(page.locator('body')).toContainText('Fällig zum');
  await expect(page.locator('body')).toContainText('Gesperrt');
});

test('die Karriereseite zeigt nur veröffentlichte Stellen', async ({ page }) => {
  await page.goto('/karriere');
  const antwort = await page.goto('/karriere', { waitUntil: 'domcontentloaded' });
  expect(antwort?.status()).toBe(200);
  await expect(page.locator('h1')).toBeVisible();
  /*
   * Ein Entwurf darf hier NICHT stehen. Der Seed legt je Gesellschaft einen
   * an; sein Titel ist die Probe.
   */
  await expect(page.locator('body')).not.toContainText('Trockenbauer');
});

test('die Bewerbung über das öffentliche Formular kommt an', async ({ page }) => {
  await page.goto('/karriere');
  /*
   * Eine echte Stelle, nicht irgendein Verweis unter `/karriere/`:
   * `initiativbewerbung` und `danke` stehen dort auch, und
   * `/karriere/danke/bewerbung` gibt es nicht. Die erste Fassung nahm den
   * ersten Treffer und prüfte damit je nach Reihenfolge etwas anderes.
   */
  const ziele = await page.locator('a[href^="/karriere/"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('href') ?? ''));
  const ziel = ziele.find(
    (z) => !z.includes('initiativbewerbung') && !z.includes('danke')
      && z.split('/').filter((t) => t !== '').length === 2);
  expect(ziel, 'keine veröffentlichte Stelle auf /karriere').toBeDefined();

  await page.goto(`${ziel!}/bewerbung`);
  await page.locator('[name="name"]').fill('Probe Mensch');
  await page.locator('[name="email"]').fill('probe.mensch@example.test');
  await page.locator('[name="nachricht"]').fill('Ich bewerbe mich auf diese Stelle.');
  /* Das Initiativformular hat einen Bereichswähler, das Stellenformular nicht. */
  const bereich = page.locator('select[name="bereich"]');
  if (await bereich.count() > 0) await bereich.selectOption({ index: 1 });
  const einwilligung = page.locator('[name="einwilligung"]');
  if (await einwilligung.count() > 0) await einwilligung.check();
  await page.locator('button[type="submit"]').first().click();

  await expect(page).toHaveURL(/danke/u);
});

test('und auch die Initiativbewerbung mit Bereichswahl', async ({ page }) => {
  await page.goto('/karriere/initiativbewerbung');
  await page.locator('select[name="bereich"]').selectOption({ index: 1 });
  await page.locator('[name="name"]').fill('Initiativ Mensch');
  await page.locator('[name="email"]').fill('initiativ.mensch@example.test');
  await page.locator('[name="nachricht"]').fill('Ich bewerbe mich initiativ.');
  const einwilligung = page.locator('[name="einwilligung"]');
  if (await einwilligung.count() > 0) await einwilligung.check();
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(/danke/u);
});

/**
 * **Der Weg, der gefehlt hat: Entwurf → Freigabe → Posteingang** (REC-02,
 * Invariante 7).
 *
 * `stelle.status` kannte `freigegeben` seit 0166, und im ganzen Baum setzte
 * ihn niemand: eine Anzeige kam nie aus dem Entwurf, `/veroeffentlichung`
 * antwortete „nicht freigegeben", REC-09 war für einen Menschen nicht
 * ausführbar. Jede Datei gebaut, keine angeschlossen — genau die Sorte Lücke,
 * die eine Einzelprüfung nicht findet.
 *
 * Geprüft wird deshalb der GANZE Weg: anlegen, vorlegen, und die Bitte im
 * Freigabe-Posteingang wiederfinden. Dass sie dort ANKOMMT, ist der Beweis;
 * der Status der Stelle ändert sich absichtlich noch nicht (ein Mensch
 * entscheidet).
 */
test('eine Stelle legt sich zur Freigabe vor und liegt danach im Posteingang', async ({ page }) => {
  await alsKonto(page, KONTO.adminReinigung);
  await page.goto('/portal/reinigung/recruiting/stellen/neu');

  const titel = `Objektleitung Probe ${String(Date.now())}`;
  await page.locator('[name="titel"]').fill(titel);
  await page.locator('[name="beschreibung"]').fill(
    'Führung eines Reinigungsteams in Berlin-Mitte, Früh- und Spätschicht.');
  await page.locator('[name="anforderungen"]').fill('Führerschein\nDeutsch B2');
  /*
   * **`[data-cse="stelle-anlegen"]` und nicht `button[type="submit"]`.first().**
   *
   * Der erste Absendeknopf im Portalbaum ist „Abmelden" — er sitzt im Kopf,
   * vor dem Inhalt, und sein Formular zeigt auf `/api/abmelden`. Die erste
   * Fassung dieses Tests traf ihn, meldete sich ab und wartete danach auf eine
   * Adresse, die sie als abgemeldeter Besucher nie sehen konnte. Der
   * Fehlschlag las sich wie „die Stelle wurde nicht angelegt"; in Wahrheit war
   * die Sitzung weg. Dieselbe Falle wie in `abmessungen.spec.ts` (D-569) und
   * in `verweise.spec.ts` (D-575), nur über einen Knopf statt einen Link.
   */
  await page.locator('[data-cse="stelle-anlegen"]').click();
  await page.waitForURL(/\/recruiting\/stellen\/[0-9a-f-]{36}/u);

  /* Entwurf: der Knopf steht da, der Veröffentlichungsweg noch nicht offen. */
  const vorlegen = page.locator('[data-cse="stelle-vorlegen"]');
  await expect(vorlegen).toBeVisible();
  await vorlegen.click();
  await expect(page.locator('[data-cse="stelle-vorgelegt"]')).toBeVisible();

  /*
   * **Vorgelegt heisst NICHT freigegeben.** Der Riegel aus 0167 lässt den
   * Status erst mit einer genehmigten Freigabe wandern; solange die Bitte
   * offen ist, bleibt die Anzeige ein Entwurf — und der Knopf verschwindet,
   * damit niemand zweimal bittet.
   */
  await expect(page.locator('[data-cse="stelle-vorlegen"]')).toHaveCount(0);

  await page.goto('/portal/reinigung/freigaben');
  await expect(page.locator('body')).toContainText(titel);
});

/**
 * **REC-06 war gebaut und unerreichbar.** `planeGespraech` stand im Dienst,
 * die Gesprächsliste stand da und versprach in ihrer Leerseite einen Knopf auf
 * dem Bewerbungsblatt — und keine Route rief die Funktion. Ein Termin konnte
 * nur aus dem Seed kommen.
 */
test('ein Gespräch entsteht am Bewerbungsblatt und steht danach in der Liste',
  async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/recruiting/bewerbungen');
    await page.locator('[data-cse="tabelle"] tbody tr a').first().click();
    await page.waitForURL(/\/recruiting\/bewerbungen\/[0-9a-f-]{36}/u);

    const formular = page.locator('[data-cse="gespraech-formular"]');
    await expect(formular).toBeVisible();

    /*
     * **Ein Termin in der Zukunft, und zwar ausdrücklich.** Die Route prüft
     * gegen `now()` AUS DER DATENBANK (Invariante 5); ein fester Wert im Test
     * wäre irgendwann Vergangenheit und der Fehlschlag sähe aus wie ein
     * kaputtes Formular.
     */
    const inEinerWoche = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const wert = `${inEinerWoche.toISOString().slice(0, 10)}T10:30`;
    await page.locator('[data-cse="gespraech-termin"]').fill(wert);
    await page.locator('[name="ort"]').fill('Büro Wilmersdorfer Straße');
    await page.locator('[data-cse="gespraech-fragen"]').fill(
      'Erfahrung mit Objektleitung?\nVerfügbar ab wann?');
    await page.locator('[data-cse="gespraech-anlegen"]').click();

    await expect(page.locator('[data-cse="termin-angelegt"]')).toBeVisible();

    await page.goto('/portal/reinigung/recruiting/gespraeche');
    await expect(page.locator('[data-cse="tabelle"] tbody tr')).not.toHaveCount(0);
  });

/**
 * **Ein Termin in der Vergangenheit ist keine Einladung** — und der Mensch
 * bekommt den Satz auf SEINER Seite, nicht als JSON auf einer weissen.
 */
test('ein rückwirkender Gesprächstermin wird abgewiesen, auf der Seite',
  async ({ page }) => {
    await alsKonto(page, KONTO.adminReinigung);
    await page.goto('/portal/reinigung/recruiting/bewerbungen');
    await page.locator('[data-cse="tabelle"] tbody tr a').first().click();
    await page.waitForURL(/\/recruiting\/bewerbungen\/[0-9a-f-]{36}/u);

    const gestern = new Date(Date.now() - 24 * 3600 * 1000);
    await page.locator('[data-cse="gespraech-termin"]')
      .fill(`${gestern.toISOString().slice(0, 10)}T09:00`);
    await page.locator('[data-cse="gespraech-anlegen"]').click();

    await expect(page.locator('[data-cse="termin-fehler"]')).toContainText('Zukunft');
  });
