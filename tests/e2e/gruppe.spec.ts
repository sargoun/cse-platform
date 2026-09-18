/**
 * Die Gruppenansicht im Browser (TEN-05, TEN-10, Invariante 10, D-475).
 *
 *  1. Die Uebersicht zeigt eine Zeile je Gesellschaft und die Summen — mit
 *     dem `NUR LESEN`-Zeichen in der Kopfzeile (DESIGN §6 Regel 3).
 *  2. Jede Liste traegt die Gesellschaft je Zeile, der Filter schraenkt ein,
 *     und der Verweis in den Bereich fuehrt ueber das Wechselblatt — nie
 *     direkt (§4.5).
 *  3. Kein Formular, kein Knopf im Inhalt: Steuerelemente sind ABWESEND,
 *     nicht deaktiviert (SEITENKARTE §6).
 *  4. Wer die Gruppenansicht nicht betreten darf, bekommt 404 — auch auf
 *     einer Unterseite (AUT-06).
 */
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

test.describe('Gruppenansicht', () => {
  test('die Übersicht: vier Gesellschaften, Summen, NUR LESEN', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe');

    await expect(page.getByRole('heading', { name: 'Gruppenübersicht', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="header-nur-lesen"]')).toBeVisible();
    await expect(page.locator('[data-cse="gruppe-summen"] [data-cse="kpi-wert"]')).toHaveCount(4);

    const matrix = page.locator('[data-cse="gruppe-matrix"] [data-cse="tabelle"] tbody tr');
    await expect(matrix).toHaveCount(4);
    // Ein Super-Admin haelt jedes Recht: kein Strich in der Matrix.
    await expect(page.locator('[data-cse="gruppe-matrix"] [data-cse="tabelle"] [data-cse="kein-recht"]'))
      .toHaveCount(0);
    // Die Reinigung hat Auftraege im Seed — die Zahl ist ein Verweis auf die Liste.
    const reinigung = matrix.filter({ has: page.locator('[data-bereich="reinigung"]') });
    await expect(reinigung.locator('a[href="/portal/gruppe/auftraege?bereich=reinigung"]')).toBeVisible();

    // Kein Formular im Inhalt — die Gruppenansicht kennt keine Handlung.
    await expect(page.locator('main form')).toHaveCount(0);
  });

  /**
   * **Der Befund aus dem Betrieb, mit Bildschirmfoto.** Auf der
   * Gruppenübersicht steht je Gesellschaft ein Knopf „Bereich öffnen". Er
   * führte auf „Diese Seite gibt es hier nicht."
   *
   * Der Grund war eine Zeile zu früh in `/portal/[mandant]/page.tsx`:
   * `if (sitzung.aktiverMandantId === null) notFound()` stand VOR `slugTor`,
   * und in der Gruppenansicht ist der aktive Bereich immer null (K-20). Jede
   * Gruppensitzung fiel damit auf 404, bevor das Wechselblatt kam.
   *
   * Dass der Weg über das Blatt geht und nicht direkt, prüfen die Fälle
   * daneben schon — aber alle über UNTERSEITEN (`/agenten`, `/auftraege`).
   * Genau die Wurzel `/portal/<slug>`, auf die dieser Knopf zeigt, hatte
   * keinen einzigen. Deshalb steht er hier, und zwar über den KNOPF statt
   * über die Adresse: eine Prüfung, die `page.goto` benutzt, hätte gehalten,
   * während der Knopf daneben ins Leere zeigt.
   */
  test('„Bereich öffnen" führt auf das Wechselblatt — nicht auf 404', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe');

    const knopf = page.locator('[data-cse="gruppe-bereiche"] [data-cse="bereich-oeffnen"]').first();
    await expect(knopf).toBeVisible();
    await knopf.click();

    await expect(page.locator('h1')).not.toContainText(/gibt es hier nicht/u);
    await expect(page.locator('[data-cse="wechsel-frage"]')).toContainText('Gruppenübersicht');

    // Und der Wechsel selbst trägt: danach steht die Gesellschaft da.
    await page.locator('[data-cse="wechsel-knopf"]').click();
    await expect(page).toHaveURL(/\/portal\/[a-z-]+$/u);
    await expect(page.locator('h1')).not.toContainText(/gibt es hier nicht/u);
    await expect(page.locator('[data-cse="header-nur-lesen"]')).toHaveCount(0);
  });

  test('Aufträge: Gesellschaft je Zeile, Filter, Wechselblatt statt Direktsprung', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe/auftraege');
    await expect(page.getByRole('heading', { name: 'Aufträge', level: 1 })).toBeVisible();

    const zeilen = page.locator('[data-cse="tabelle"] tbody tr');
    expect(await zeilen.count()).toBeGreaterThan(0);
    // Mehr als eine Gesellschaft in der ungefilterten Liste.
    const bereiche = await zeilen.locator('[data-bereich]').evaluateAll(
      (els) => [...new Set(els.map((e) => e.getAttribute('data-bereich')))]);
    expect(bereiche.length).toBeGreaterThan(1);

    await page.locator('[data-cse="bereichs-filter"] a[data-bereich="reinigung"]').click();
    await expect(page).toHaveURL(/bereich=reinigung$/u);
    const gefiltert = page.locator('[data-cse="tabelle"] tbody tr');
    expect(await gefiltert.count()).toBeGreaterThan(0);
    await expect(gefiltert.locator('[data-bereich]:not([data-bereich="reinigung"])')).toHaveCount(0);

    // Der Verweis in den Bereich: ein GET wechselt den Bereich nie.
    await gefiltert.first().locator('a[href^="/portal/reinigung/auftraege/"]').click();
    await expect(page.locator('[data-cse="wechsel-frage"]')).toContainText('Gruppenübersicht');
    await page.locator('[data-cse="wechsel-knopf"]').click();
    await expect(page).toHaveURL(/\/portal\/reinigung\/auftraege\/[0-9a-f-]{36}$/u);
  });

  test('Freigaben: wartende Vorschläge aller Bereiche, ohne Entscheidungsknopf', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe/freigaben');
    await expect(page.getByRole('heading', { name: 'Wartende Freigaben', level: 1 })).toBeVisible();
    const zaehler = page.locator('[data-cse="posteingang-zaehler"]');
    expect(Number(await zaehler.getAttribute('data-anzahl'))).toBeGreaterThan(0);
    await expect(page.locator('[data-cse="freigeben"]')).toHaveCount(0);
    await expect(page.locator('[data-cse="ablehnen"]')).toHaveCount(0);
    await expect(page.locator('main form')).toHaveCount(0);
  });

  /**
   * **Zwei Menschen heissen Yildiz — und genau daran ist dieser Fall gefallen.**
   *
   * Er zählte `[data-bereich]` in „der Yildiz-Zeile" und fand drei statt zwei.
   * Das sah nach einem Defekt an der heikelsten Stelle aus, die diese Seite
   * hat: eine Gesellschaft doppelt, oder eine, die sie nicht zeigen darf —
   * D-09 und die Mandantengrenze.
   *
   * **Es war keiner.** In der Datenbank nachgesehen:
   *
   *     Fatima Yildiz  42f55c9d…  2 lebende anstellung-Zeilen  reinigung, security
   *     Fatma  Yildiz  3a279ff1…  1 lebende anstellung-Zeile   reinigung
   *
   * Fatima hat unverändert ZWEI Beschäftigungen in zwei Gesellschaften, und
   * die Seite zeigt sie in EINER Zeile mit zwei Marken — richtig, und die
   * Abfrage kann es auch nicht anders (`array_agg(distinct m.slug)`).
   *
   * Die dritte Marke gehört einem ANDEREN Menschen: „Fatma Yildiz" ist die
   * Personendublette, die der Seed absichtlich anlegt, damit
   * `/personal/zusammenfuehren` überhaupt prüfbar ist — dieselbe Frau, zweimal
   * angelegt, die Schreibweise aus dem Bewerbungsformular gegen die aus dem
   * Vertrag (`seed/index.ts`). Sie ist der GEGENFALL zu D-09: D-09 ist ein
   * Mensch mit zwei Beschäftigungen in einer Zeile, die Dublette sind zwei
   * Zeilen für einen Menschen.
   *
   * **Der Fehler lag also im Zugriff, nicht in der Zahl.**
   * `filter({ hasText: 'Yildiz' })` griff beide Zeilen und summierte ihre
   * Marken. Solange es eine Yildiz gab, stimmte das zufällig. Die Zahl 2
   * bleibt deshalb stehen — sie war richtig; gezeigt wird jetzt auf die Zeile,
   * die gemeint ist.
   *
   * Beide Zeilen werden geprüft, und das ist der Punkt: dass die Plattform
   * einen Menschen mit zwei Beschäftigungen und zwei Menschen mit demselben
   * Nachnamen AUSEINANDERHÄLT, ist die Zusicherung aus D-09. Würde die Gruppe
   * die beiden zusammenwerfen (oder Fatimas Zeile spalten), fällt jetzt genau
   * eine dieser vier Zusicherungen — statt still im Summenfehler zu
   * verschwinden.
   */
  test('Personen: wer in zwei Gesellschaften arbeitet, steht mit beiden da (D-09)', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    await page.goto('/portal/gruppe/personen');
    const zaehler = page.locator('[data-cse="personen-zaehler"]');
    expect(Number(await zaehler.getAttribute('data-mehrfach'))).toBeGreaterThan(0);

    const zeilen = page.locator('[data-cse="tabelle"] tbody tr');

    /*
     * Der D-09-Fall: EINE Zeile, ZWEI Gesellschaften — und zwar namentlich
     * `reinigung` und `security`. Die Namen statt nur der Zahl: eine Zeile mit
     * zwei Marken, von denen eine dem falschen Mandanten gehört, wäre die
     * Grenzverletzung, die dieser Fall sucht, und käme auf dieselbe 2.
     */
    const fatima = zeilen.filter({
      has: page.getByRole('link', { name: 'Yildiz, Fatima', exact: true }),
    });
    await expect(fatima, 'Fatima Yildiz steht nicht genau einmal da').toHaveCount(1);
    const fatimaBereiche = await fatima.locator('[data-bereich]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-bereich')));
    expect([...fatimaBereiche].sort()).toEqual(['reinigung', 'security']);

    /*
     * Die Dublette daneben: EINE Zeile, EINE Gesellschaft. Sie ist der Grund,
     * aus dem dieser Fall über den vollen Namen greift und nicht über
     * „Yildiz" — und die Prüfung, dass die Gruppe die zwei Menschen nicht
     * zusammenzieht.
     */
    const fatma = zeilen.filter({
      has: page.getByRole('link', { name: 'Yildiz, Fatma', exact: true }),
    });
    await expect(fatma, 'die Seed-Dublette fehlt oder steht doppelt').toHaveCount(1);
    await expect(fatma.locator('[data-bereich="reinigung"]')).toHaveCount(1);
    await expect(fatma.locator('[data-bereich]')).toHaveCount(1);
  });

  test('Finanzen, Protokoll, Dienstplan, Auslastung antworten — lesend', async ({ page }) => {
    await alsKonto(page, KONTO.gruppe);
    for (const [pfad, titel] of [
      ['/portal/gruppe/finanzen', /^Finanzen \d{4}$/u],
      ['/portal/gruppe/protokoll', 'Protokoll'],
      ['/portal/gruppe/dienstplan', /^Dienstplan/u],
      ['/portal/gruppe/auslastung', 'Auslastung'],
      ['/portal/gruppe/offene-posten', 'Offene Posten'],
      ['/portal/gruppe/rechnungen', 'Rechnungen'],
      ['/portal/gruppe/kunden', 'Kunden'],
      ['/portal/gruppe/objekte', 'Objekte'],
      ['/portal/gruppe/projekte', 'Projekte'],
      ['/portal/gruppe/agenten', 'Agenten'],
    ] as const) {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: titel })).toBeVisible();
      await expect(page.locator('[data-cse="header-nur-lesen"]'), pfad).toBeVisible();
      await expect(page.locator('main form[method="post" i]'), pfad).toHaveCount(0);
    }
    // Die Dokumentensuche ist ein GET-Formular — sie aendert nichts.
    await page.goto('/portal/gruppe/dokumente?q=vertrag');
    await expect(page.getByRole('heading', { name: 'Dokumente', level: 1 })).toBeVisible();
    await expect(page.locator('[data-cse="dokumente-suche"] input[name="q"]')).toHaveValue('vertrag');
  });

  test('wer die Gruppenansicht nicht betreten darf, sieht auch keine Unterseite (AUT-06)', async ({ page }) => {
    // Eine Administration mit EINER Mitgliedschaft hat keine Gruppe (§4.5, Bedingung 1).
    await alsKonto(page, KONTO.adminReinigung);
    for (const pfad of ['/portal/gruppe', '/portal/gruppe/auftraege', '/portal/gruppe/finanzen']) {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(404);
    }
  });
});
