/**
 * Die Stundenkonten im Browser — PR 37s Zahlen, endlich sichtbar (EMP-04).
 *
 * Was nur hier zu pruefen ist: dass der Monatsabschluss OHNE JavaScript
 * funktioniert (ein Formular, kein Skript), dass er genau einmal geht, und
 * dass die Seite den Grund nennt, warum ein Monat noch nicht schliessbar ist —
 * statt eines Knopfes, der scheitert.
 *
 * **Der Test schliesst einen Monat ab, und das ist unumkehrbar.** Er nimmt
 * dafuer einen Monat, den sonst niemand anfasst (Januar 2027), und eine eigens
 * angelegte Beschaeftigung — nicht die des Seeds, deren Zeiten andere Tests
 * lesen.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

const MONAT = '2027-01-01';
let mandantId = '';
let anstellungId = '';
let personName = '';

async function anmelden(page: Page): Promise<void> {
  await page.goto('/dev/anmelden');
  /**
   * **Namentlich, nicht „der erste admin".** Seit der Seed eine
   * `admin.bau` traegt, greift `.first()` den Bau — `order by b.name` stellt
   * „Administration Bau" vor „Administration Reinigung". Diese Datei
   * arbeitet in `reinigung`; die Slug-Wache haette 404 geantwortet, genau
   * wie AUT-06 es vorschreibt.
   */
  await alsKonto(page, KONTO.adminReinigung);
}

test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `select id from mandant where slug = 'reinigung' limit 1`);
  mandantId = m!.id;

  /**
   * **Die Fixtur traegt ihre Lauf-Kennung im NAMEN, nicht nur in der
   * Personalnummer.**
   *
   * Sie hiess fest „Konto Abschlussprobe". Playwright wirft einen Worker nach
   * einem fehlgeschlagenen Test weg und fuehrt `beforeAll` im naechsten
   * erneut aus; geloescht wird nichts (Invariante 8). Nach dem zweiten Lauf
   * standen also mehrere Menschen desselben Namens in der Datenbank — und
   * der Locator unten suchte die Zeile ueber genau diesen Namen. Der strikte
   * Modus fand zwei und warf, und der Fehlschlag las sich, als zeige die
   * Abschluss-Seite eine Zeile doppelt.
   */
  const lauf = `E2E-${String(Date.now()).slice(-6)}-${process.env['TEST_WORKER_INDEX'] ?? '0'}`;
  const [p] = await sql.unsafe<{ id: string; name: string }[]>(
    `insert into person (vorname, nachname)
     values ('Konto', $1)
     returning id, (vorname || ' ' || nachname) as name`,
    [`Abschlussprobe ${lauf}`] as never[]);
  personName = p!.name;
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
     values ($1, $2, $3, '2026-01-01'::date, 'aktiv')
     returning id`,
    [mandantId, p!.id, lauf] as never[]);
  anstellungId = a!.id;

  const [b] = await sql.unsafe<{ id: string }[]>(
    `select id from benutzer where email = 'admin@cse-gruppe.de'`);

  /**
   * Zwei Schichten im Januar 2027, EINE freigegeben. Damit zeigt die Seite
   * zuerst den Grund („1 Zeiteintrag ist nicht freigegeben") und erst nach der
   * zweiten Freigabe den Knopf.
   */
  for (const [tag, frei] of [['05', true], ['06', false]] as const) {
    await sql.unsafe(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
          pause_minuten, erfassungsart_beginn, erfassungsart_ende,
          quelle_beginn, quelle_ende, status, erstellt_von_art,
          freigegeben_am, freigegeben_von)
       values ($1,$2,$3, $4::timestamptz, $5::timestamptz, 0,
               'import','import','import','import','abgeschlossen','system',
               case when $6 then now() else null end,
               case when $6 then $7::uuid else null end)`,
      [mandantId, anstellungId, p!.id,
        `2027-01-${tag}T06:00:00Z`, `2027-01-${tag}T14:00:00Z`, frei, b!.id] as never[]);
  }

  // Das Konto legt sonst der Rollover an; hier legt es der Test an, weil die
  // Seite nur zeigt, was es gibt — und genau das ist ihre Zusage.
  await sql.unsafe(
    `insert into stundenkonto (mandant_id, anstellung_id, jahr, monat, erstellt_von)
     values ($1, $2, 2027, 1, $3)
     on conflict (anstellung_id, jahr, monat) do nothing`,
    [mandantId, anstellungId, b!.id] as never[]);
});

test.afterAll(() => {
  // Kein DELETE: Zeiteintrag und Stundenkonto tragen die Löschsperre
  // (Invariante 8). Und kein `sql.end()` — siehe `dienstplan.spec.ts`.
});

test.describe('Stundenkonten — Liste und Einzelblatt', () => {
  test('die Liste zeigt das Konto, ohne einen Saldo zu erfinden', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/personal/stundenkonten?monat=${MONAT}`);

    await expect(page.locator('h1')).toHaveText('Stundenkonten');
    const inhalt = page.locator('main');
    await expect(inhalt).toContainText(personName);
    /**
     * O-18: ohne hinterlegte Sollzeit gibt es keinen Saldo, nur eine Summe.
     * Stuende dort „+8:00 h", waere das ein Überstundenberg, den niemand
     * vereinbart hat — und aus dem eine Lohnzeile wuerde.
     */
    await expect(inhalt).toContainText('nicht hinterlegt');
  });

  test('das Einzelblatt zeigt die Buchungen hinter der Zahl', async ({ page }) => {
    await anmelden(page);
    await page.goto(
      `/portal/reinigung/personal/stundenkonten/${anstellungId}?monat=${MONAT}`);

    await expect(page.locator('h1')).toHaveText(personName);
    await expect(page.locator('main')).toContainText('Auszug Januar 2027');
  });
});

test.describe('Monatsabschluss — ein Formular, kein Skript', () => {
  test('nennt den Grund, solange Zeiten offen sind', async ({ page }) => {
    await anmelden(page);
    await page.goto(
      `/portal/reinigung/personal/stundenkonten/abschluss?monat=${MONAT}`);

    const zeile = page.locator(
      `[data-cse="tabelle"] tr:has(a[href*="${anstellungId}"])`);
    await expect(zeile).toContainText('nicht freigegeben');
    // Kein Knopf, der scheitern wuerde.
    await expect(zeile.locator('button')).toHaveCount(0);
  });

  test('schließt den Monat ohne JavaScript und nur einmal', async ({ page, context }) => {
    // Die zweite Schicht wird freigegeben — ab jetzt ist der Monat reif.
    const [b] = await sql.unsafe<{ id: string }[]>(
      `select id from benutzer where email = 'admin@cse-gruppe.de'`);
    await sql.unsafe(
      `update zeiteintrag set freigegeben_am = now(), freigegeben_von = $2
        where anstellung_id = $1 and freigegeben_am is null`,
      [anstellungId, b!.id] as never[]);

    // OHNE JavaScript: der Abschluss ist ein POST-Formular, und die
    // Personalstelle bedient ihn am Monatsende auf irgendeinem Gerät.
    await context.addInitScript(() => { /* nichts — das Skript bleibt aus */ });
    await anmelden(page);
    await page.goto(
      `/portal/reinigung/personal/stundenkonten/abschluss?monat=${MONAT}`);

    const zeile = page.locator(
      `[data-cse="tabelle"] tr:has(a[href*="${anstellungId}"])`);
    await zeile.locator('button', { hasText: 'Abschließen' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-cse="abschluss-erfolg"]')).toBeVisible();
    await expect(page.locator('[data-cse="abschluss-fehler"]')).toHaveCount(0);
    // Die Zeile ist aus der Liste der OFFENEN Konten verschwunden.
    await expect(page.locator(
      `[data-cse="tabelle"] tr:has(a[href*="${anstellungId}"])`))
      .toHaveCount(0);

    // Und die Liste sagt jetzt „Abgeschlossen".
    await page.goto(`/portal/reinigung/personal/stundenkonten?monat=${MONAT}`);
    await expect(page.locator(
      `[data-cse="tabelle"] tr:has(a[href*="${anstellungId}"])`))
      .toContainText('Abgeschlossen');

    const [konto] = await sql.unsafe<{ status: string }[]>(
      `select status::text from stundenkonto
        where anstellung_id = $1 and jahr = 2027 and monat = 1`, [anstellungId]);
    expect(konto!.status).toBe('gesperrt');

    // Der § 17-Nachweis entsteht beim Sperren, nicht beim Abfragen (D-152).
    const [nachweis] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from zeitnachweis
        where anstellung_id = $1 and monat = $2::date`, [anstellungId, MONAT] as never[]);
    expect(Number(nachweis!.anzahl)).toBe(1);
  });
});
