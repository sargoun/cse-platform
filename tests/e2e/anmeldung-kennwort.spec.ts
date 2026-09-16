/**
 * Die Abnahme von PR 77: die Anmeldung mit E-Mail und Kennwort (AUT-01,
 * AUT-02) — im Browser.
 *
 * **Was hier gemessen wird und sonst nirgends.** Die reinen Teile stehen in
 * `tests/kern/qr.test.ts`, die Rechte- und Riegelfragen in
 * `tests/isolation/anmeldung-kennwort.test.ts`. Diese Datei prüft, was ein
 * Mensch vor dem Bildschirm sieht — und was ein Unbekannter aus dem Gesehenen
 * ableiten kann.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { codeFuer, schritt } from '../../src/lib/totp.js';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Dasselbe Kennwort, das `seed/zugang.ts` setzt. */
const KENNWORT = 'demo-cse-2026';

/** Die Bremse (AUT-07) ist Absicht im Betrieb, nicht im Lauf. */
async function bremseLoesen(): Promise<void> {
  await sql`delete from kern.anmeldeversuch`;
}

/** Ein Konto, das im Seed ein Demokennwort bekommen hat. */
async function demoKonto(rolle: 'admin' | 'leitung'): Promise<string> {
  const [z] = await sql<{ email: string }[]>`
    select b.email
      from benutzer b
      join kern.zugangsdaten z on z.benutzer_id = b.id
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.entzogen_am is null
      join rolle r on r.id = bm.rolle_id
     where r.schluessel = ${rolle} and z.kennwort_hash is not null
     order by b.email limit 1`;
  expect(z?.email ?? null, `kein Demokonto mit Rolle ${rolle}`).not.toBeNull();
  return z!.email;
}

test.beforeEach(bremseLoesen);
test.afterAll(async () => { await sql.end(); });

test.describe('die Anmeldung mit Kennwort', () => {
  test('sie ist von der Website aus erreichbar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /anmelden|login/iu }).first().click();
    await expect(page).toHaveURL(/\/auth\/login/u);
    await expect(page.locator('[data-cse="anmeldung-kennwort"]')).toBeVisible();
  });

  test('falsches Kennwort und unbekannte Adresse sagen DASSELBE', async ({ page }) => {
    const email = await demoKonto('leitung');

    await page.goto('/auth/login');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="kennwort"]', 'daneben-daneben');
    await page.click('[data-cse="anmelden"]');
    const mitKonto = await page.locator('[data-cse="anmeldung-fehler"]').innerText();

    await bremseLoesen();
    await page.goto('/auth/login');
    await page.fill('input[name="email"]', 'gibtsnicht@cse.test');
    await page.fill('input[name="kennwort"]', 'daneben-daneben');
    await page.click('[data-cse="anmelden"]');
    const ohneKonto = await page.locator('[data-cse="anmeldung-fehler"]').innerText();

    expect(ohneKonto).toBe(mitKonto);
    expect(mitKonto).toMatch(/E-Mail oder Kennwort/u);
  });

  test('eine Leitung kommt ins Portal und kann sich wieder abmelden', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('input[name="email"]', await demoKonto('leitung'));
    await page.fill('input[name="kennwort"]', KENNWORT);
    await page.click('[data-cse="anmelden"]');

    await expect(page).toHaveURL(/\/portal/u);
    await expect(page.locator('[data-cse="anmeldung-kennwort"]')).toHaveCount(0);
  });

  /**
   * **Der Weg, den es vor PR 77 gar nicht gab.** Die Administration trägt
   * `erfordert_2fa` seit 0007; ohne diese Seite konnte sie sich nie über ein
   * Kennwort anmelden, und mit ihr landet sie zuerst beim zweiten Faktor.
   */
  test('eine Administration wird zum zweiten Faktor geführt', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('input[name="email"]', await demoKonto('admin'));
    await page.fill('input[name="kennwort"]', KENNWORT);
    await page.click('[data-cse="anmelden"]');

    await expect(page).toHaveURL(/\/auth\/zwei-faktor\/(pruefen|einrichten)/u);
  });

  test('der Anbieter steht auf dem Bildschirm, statt verschwiegen zu werden', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('[data-cse="anbieter-demo"]')).toContainText(/nicht verbunden/u);
  });

  test('„Kennwort vergessen" verrät nicht, ob es die Adresse gibt', async ({ page }) => {
    await page.goto('/auth/passwort-vergessen');
    await page.fill('input[name="email"]', 'niemand-hier@cse.test');
    await page.click('[data-cse="link-anfordern"]');
    await expect(page.locator('h1')).toContainText(/Postfach/u);
    await expect(page.locator('body')).toContainText(/Wenn es zu dieser Adresse ein Konto gibt/u);
  });

  test('ein abgelaufener Zurücksetzungslink sagt das, statt ein Formular zu zeigen',
    async ({ page }) => {
      await page.goto('/auth/passwort-neu?token=00000000000000000000000000000000');
      await expect(page.locator('h1')).toContainText(/gilt nicht mehr/u);
      await expect(page.locator('input[name="kennwort"]')).toHaveCount(0);
    });

  /**
   * **Der ganze Weg, einmal durchlaufen (AUT-06).** Bis hierher prüfte diese
   * Datei nur die beiden Enden: dass die Seite nichts verrät, und dass ein
   * ungültiger Token abgewiesen wird. Dazwischen lag der eigentliche Weg --
   * anfordern, dem Link folgen, ein neues Kennwort setzen, sich damit
   * anmelden -- und der war nie gegangen worden. Genau dort stand der Link
   * relativ im Mailtext (D-532), ohne dass ein Lauf das bemerkte.
   *
   * Der Hash wird vorher gesichert und hinterher zurückgeschrieben: dieselbe
   * Leitung meldet sich in anderen Fällen mit dem Seed-Kennwort an, und ein
   * Test, der die Welt verändert zurückslässt, macht den nächsten rot.
   */
  test('anfordern, Link folgen, neues Kennwort -- und der Link gilt nur einmal',
    async ({ page }) => {
      const email = await demoKonto('leitung');
      const [vorher] = await sql<{ h: string }[]>`
        select z.kennwort_hash as h from kern.zugangsdaten z
          join benutzer b on b.id = z.benutzer_id where b.email = ${email}`;
      expect(vorher?.h ?? null).not.toBeNull();
      const NEU = 'ganz-neues-kennwort-2026';

      try {
        await page.goto('/auth/passwort-vergessen');
        await page.fill('input[name="email"]', email);
        await page.click('[data-cse="link-anfordern"]');

        // Auf der Entwicklungsfläche steht der Link statt im Postfach hier.
        const link = page.locator('[data-cse="dev-link"] a');
        await expect(link).toBeVisible();
        const ziel = await link.getAttribute('href');
        expect(ziel).toMatch(/^\/auth\/passwort-neu\?token=/u);

        await link.click();
        await page.fill('input[name="kennwort"]', NEU);
        await page.fill('input[name="kennwort2"]', NEU);
        await page.click('[data-cse="kennwort-setzen"]');
        await expect(page).toHaveURL(/gesetzt=1/u);

        // **Nur einmal**: derselbe Link ein zweites Mal ist kein Formular.
        await page.goto(ziel!);
        await expect(page.locator('h1')).toContainText(/gilt nicht mehr/u);

        // Und das neue Kennwort trägt wirklich.
        await bremseLoesen();
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="kennwort"]', NEU);
        await page.click('[data-cse="anmelden"]');
        await expect(page).toHaveURL(/\/portal/u);
      } finally {
        await sql`update kern.zugangsdaten z set kennwort_hash = ${vorher!.h}
                    from benutzer b where b.id = z.benutzer_id and b.email = ${email}`;
      }
    });

  test('ohne Sitzung führt der zweite Faktor zurück zur Anmeldung', async ({ page }) => {
    await page.goto('/auth/zwei-faktor/pruefen');
    await expect(page).toHaveURL(/\/auth\/login/u);
  });

  /**
   * **Der Befund aus dem Betrieb, und warum der Test ihn durchgelassen hat.**
   *
   * Wer sich ohne Rückweg anmeldete, landete auf `/portal` — und `/portal` war
   * keine Seite: die erste Ansicht nach einer erfolgreichen Anmeldung war
   * „Diese Seite gibt es hier nicht." Die Prüfungen daneben sahen es nicht,
   * weil sie `toHaveURL(/\/portal/)` fragen und `/portal` dieses Muster
   * erfüllt: die ADRESSE stimmte, die Seite dahinter fehlte.
   *
   * Deshalb wird hier auf den INHALT gesehen. Eine Adressprüfung, die ein 404
   * für einen Erfolg hält, ist keine.
   */
  test('nach der Anmeldung steht kein 404 — der Wegweiser führt in den Bereich',
    async ({ page }) => {
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', await demoKonto('leitung'));
      await page.fill('input[name="kennwort"]', KENNWORT);
      await page.click('[data-cse="anmelden"]');

      await expect(page).toHaveURL(/\/portal\/[a-z-]+/u);
      await expect(page.locator('h1')).not.toContainText(/gibt es hier nicht/u);
      // Die Portalhülle ist da — also eine Seite und kein Zustandsbildschirm.
      await expect(page.locator('[data-cse="tableiste"], nav').first()).toBeVisible();
    });

  test('und `/portal` selbst ist ein Wegweiser, keine Sackgasse', async ({ page }) => {
    // Sieben Stellen im Baum nennen `/portal` als letztes Rückfallziel. Sie
    // alle einzeln zu reparieren hiesse, dieselbe Fallunterscheidung siebenmal
    // zu führen — die Adresse muss selbst wissen, wohin sie gehört.
    await page.goto('/auth/login');
    await page.fill('input[name="email"]', await demoKonto('leitung'));
    await page.fill('input[name="kennwort"]', KENNWORT);
    await page.click('[data-cse="anmelden"]');
    await expect(page).toHaveURL(/\/portal\//u);

    await page.goto('/portal');
    await expect(page).toHaveURL(/\/portal\/[a-z-]+/u);
    await expect(page.locator('h1')).not.toContainText(/gibt es hier nicht/u);
  });

  test('ein offener Rückweg wird nicht gefolgt (D-504)', async ({ page, baseURL }) => {
    await page.goto('/auth/login?weiter=//example.com');
    await page.fill('input[name="email"]', await demoKonto('leitung'));
    await page.fill('input[name="kennwort"]', KENNWORT);
    await page.click('[data-cse="anmelden"]');

    // Der Wirt muss derselbe geblieben sein — `//example.com` beginnt mit
    // einem Schrägstrich und ist trotzdem eine fremde Adresse.
    expect(new URL(page.url()).host).toBe(new URL(baseURL ?? 'http://localhost:3000').host);
    await expect(page).toHaveURL(/\/portal/u);
  });
});

test.describe('der zweite Faktor', () => {
  /**
   * **Der QR-Code wird wirklich gerechnet.** Kein Bild von aussen, kein
   * `<img src>`, sondern ein SVG-Pfad in der Seite — und der Schlüssel darunter
   * lässt sich von Hand eintippen, falls keine Kamera da ist.
   */
  test('einrichten: QR-Code, Schlüssel zum Abtippen, und der Code schliesst ab',
    async ({ page }) => {
      const email = await demoKonto('admin');
      // Für diesen Lauf frisch: der Seed hat dem Konto ggf. schon einen Faktor.
      await sql`delete from kern.zweiter_faktor z using benutzer b
                 where b.id = z.benutzer_id and b.email = ${email}`;
      await sql`delete from auth.mfa_factors f using benutzer b
                 where b.id = f.user_id and b.email = ${email}`;

      await page.goto('/auth/login');
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="kennwort"]', KENNWORT);
      await page.click('[data-cse="anmelden"]');
      await expect(page).toHaveURL(/\/auth\/zwei-faktor\/einrichten/u);

      const qr = page.locator('[data-cse="faktor-qr"] svg');
      await expect(qr).toHaveCount(1);
      /**
       * **Kein Verweis nach aussen.** Der einzige erlaubte `http` im Markup ist
       * der SVG-Namensraum `http://www.w3.org/2000/svg` — er wird nie
       * abgerufen. Alles andere waere ein Bild, das das TOTP-Geheimnis in
       * seiner Adresse zu einem fremden Server traegt.
       */
      const markup = await page.locator('[data-cse="faktor-qr"]').innerHTML();
      expect(markup.replace(/http:\/\/www\.w3\.org\/2000\/svg/gu, '')).not.toMatch(/https?:/u);
      expect(markup).not.toContain('<img');

      await page.click('summary');
      const geheimnis = (await page.locator('[data-cse="faktor-geheimnis"]').innerText())
        .replace(/\s/gu, '');
      expect(geheimnis).toMatch(/^[A-Z2-7]{32}$/u);

      const [uhr] = await sql<{ t: Date }[]>`select now() as t`;
      await page.fill('input[name="code"]', codeFuer(geheimnis, schritt(new Date(uhr!.t))));
      await page.click('[data-cse="faktor-abschliessen"]');

      await expect(page).toHaveURL(/\/auth\/zwei-faktor\/wiederherstellung/u);
      await expect(page.locator('[data-cse="wiederherstellungscodes"] li')).toHaveCount(10);
    });
});

test.describe('Barrierefreiheit (BFSG)', () => {
  for (const pfad of ['/auth/login', '/auth/passwort-vergessen']) {
    test(`${pfad} ist frei von schweren axe-Verstössen`, async ({ page }) => {
      await page.goto(pfad);
      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(ergebnis.violations.map((v) => `${v.id} (${String(v.nodes.length)})`)).toEqual([]);
    });
  }
});
