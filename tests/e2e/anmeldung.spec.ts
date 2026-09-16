/**
 * Die Abnahme von PR 20: die Anmeldung mit Telefon und Einmalcode (EMP-01).
 *
 * **Im Browser, nicht am Dienst.** Die reinen Teile stehen in
 * `tests/kern/mitarbeiter-anmeldung.test.ts`, die Rechte- und Riegelfragen in
 * `tests/isolation/mitarbeiter-anmeldung.test.ts`. Was hier gemessen wird, ist
 * die eine Sache, die keine der beiden zeigen kann: was ein Mensch vor dem
 * Bildschirm SIEHT — und was ein Unbekannter aus dem Gesehenen ableiten kann.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Response } from '@playwright/test';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Die Nummer einer geseedeten Beschäftigten — gelesen, nicht getippt. */
async function nummerVon(email: string): Promise<string> {
  const [z] = await sql<{ telefon: string | null }[]>`
    select p.telefon from benutzer b join person p on p.id = b.person_id
     where b.email = ${email} limit 1`;
  expect(z?.telefon ?? null, `kein Seed-Konto ${email} mit Nummer`).not.toBeNull();
  return z!.telefon!;
}

/**
 * **Die Bremse ist Absicht — im Betrieb, nicht im Lauf** (0130, D-488).
 *
 * Drei offene Codes je Zugang, und diese Datei fordert sieben an. Bricht ein
 * Fall vorzeitig ab, stehen seine Codes noch zehn Minuten offen, und der
 * naechste Fall bekommt keinen mehr — dann faellt eine Kette von Tests, die
 * mit der geprueften Sache nichts zu tun hat. Was offen ist, gilt deshalb vor
 * jeder Anforderung als verbraucht; gemessen wird weiter am echten Zugang.
 */
async function bremseLoesenFuerFeld(seite: {
  inputValue(auswahl: string): Promise<string>;
}): Promise<void> {
  await bremseLoesen(await seite.inputValue('input[name="telefon"]'));
}

async function bremseLoesen(telefon: string): Promise<void> {
  const ziffern = telefon.replace(/[^0-9+]/gu, '');
  await sql`
    update mitarbeiter_einmalcode set verbraucht_am = now()
     where verbraucht_am is null
       and zugang_id in (
         select z.id from mitarbeiter_zugang z
          where replace(z.telefon_e164, ' ', '') = ${ziffern}
             or right(replace(z.telefon_e164, ' ', ''), 9) = right(${ziffern}, 9))`;
}

/**
 * (1) **Kein Kennwortfeld — auf keinem der beiden Schritte.**
 *
 * EMP-01 sagt „phone number + SMS code, no password". Ein verstecktes oder
 * deaktiviertes Feld wäre trotzdem eines: Kennwortverwalter füllen es, Browser
 * bieten es an, und irgendwann fragt jemand, welches Kennwort gemeint ist.
 * Gezählt wird deshalb im DOM und nicht im Sichtbaren.
 */
test('die Anmeldung trägt kein einziges Kennwortfeld im DOM (EMP-01)', async ({ page }) => {
  await page.goto('/auth/mitarbeiter');
  expect(await page.locator('input[type="password"]').count()).toBe(0);

  await page.fill('input[name="telefon"]', await nummerVon('fatima.yildiz@cse-gruppe.de'));
  await bremseLoesenFuerFeld(page);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');
  expect(await page.locator('input[type="password"]').count()).toBe(0);

  /*
   * Und das Codefeld ist EINS, nicht sechs (04-SEITENKARTE §2548): sechs
   * Einzelzeichen lesen sich mit einem Screenreader als sechs namenlose
   * Eingaben, und Einfügen aus der SMS trifft dann nur das erste.
   */
  const code = page.locator('input[name="code"]');
  await expect(code).toHaveCount(1);
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
});

/**
 * (2) **Eine unbekannte Nummer sieht aus wie eine bekannte.**
 *
 * Das ist AUT-06 (404 statt 403) eine Ebene früher: gäbe die Seite Auskunft,
 * erführe jeder, der Nummern durchprobiert, WELCHE Menschen bei dieser Gruppe
 * arbeiten. Verglichen werden Ziel und Text, nicht ein Gefühl.
 */
test('eine unbekannte Nummer ist von einer bekannten nicht zu unterscheiden', async ({ page }) => {
  const bekannt = await nummerVon('fatima.yildiz@cse-gruppe.de');

  await page.goto('/auth/mitarbeiter');
  await page.fill('input[name="telefon"]', bekannt);
  await bremseLoesenFuerFeld(page);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');
  const zielA = new URL(page.url()).pathname;
  const textA = (await page.locator('main').innerText()).replace(/\d{6}/gu, 'CODE');

  await page.context().clearCookies();
  await page.goto('/auth/mitarbeiter');
  await page.fill('input[name="telefon"]', '+49 170 9999999');
  await bremseLoesenFuerFeld(page);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');
  const zielB = new URL(page.url()).pathname;
  const textB = (await page.locator('main').innerText()).replace(/\d{6}/gu, 'CODE');

  expect(zielB).toBe(zielA);
  /*
   * Der Entwicklungskasten steht nur da, wo ein Code ENTSTANDEN ist — auf den
   * Entwicklungsflächen ist das der einzige Unterschied, und er existiert in
   * einer Auslieferung nicht, weil es dort keinen Kasten gibt. Er wird deshalb
   * vor dem Vergleich abgezogen, und der Rest muss Zeichen für Zeichen gleich
   * sein.
   */
  const ohneKasten = (t: string): string =>
    t.split('\n')
      .map((z) => z.trim())
      .filter((z) => z !== ''
        && !z.includes('Entwicklungsfläche') && !z.includes('Der Code lautet'))
      .join('\n');
  /*
   * Leerzeilen fallen mit weg, und das ist kein Bequemlichkeitsfilter: der
   * Kasten hinterlaesst beim Herausschneiden genau eine, und ein Vergleich,
   * der daran scheitert, misst die Formatierung statt der Auskunft.
   */
  expect(ohneKasten(textB)).toBe(ohneKasten(textA));
});

/**
 * (3) **Ein falscher Code sagt nichts, woraus sich etwas ableiten ließe.**
 *
 * „Code falsch", „abgelaufen", „schon benutzt" und „Nummer unbekannt" sind
 * vier Hinweise für den, der rät, und null Hilfe für den, der sich vertippt
 * hat — der tippt einfach nochmal.
 */
test('ein falscher Code meldet genau dasselbe wie ein abgelaufener', async ({ page }) => {
  const nummer = await nummerVon('fatima.yildiz@cse-gruppe.de');

  await page.goto('/auth/mitarbeiter');
  await page.fill('input[name="telefon"]', nummer);
  await bremseLoesenFuerFeld(page);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');

  const echt = (await page.locator('[data-cse="dev-code-wert"]').innerText()).trim();
  const falsch = echt === '000000' ? '000001' : '000000';

  await page.fill('input[name="code"]', falsch);
  await page.locator('[data-cse="code-einloesen"]').click();
  await page.waitForURL(/code\?fehler=code/u);
  /*
   * Die Meldung AM FELD, nicht `[role="alert"]` irgendwo. Der erste Treffer im
   * DOM ist Next' Routen-Ansager — ein leerer Live-Bereich ganz oben, der bei
   * einem frischen Seitenaufruf nichts enthaelt. Dagegen zu vergleichen hiess,
   * zwei leere Zeichenketten gleich zu finden und das fuer eine Zusage zu
   * halten.
   */
  const meldungFalsch = await page
    .locator('form[data-cse="anmeldung-code"] [role="alert"]').innerText();
  expect(meldungFalsch.trim().length).toBeGreaterThan(0);
  expect(new URL(page.url()).pathname).toBe('/auth/mitarbeiter/code');

  // Denselben Weg mit einem ABGELAUFENEN Code — dieselbe Meldung.
  await sql`update mitarbeiter_einmalcode set gueltig_bis = now() - interval '1 minute'`;
  await page.goto('/auth/mitarbeiter/code');
  await page.fill('input[name="code"]', echt);
  await page.locator('[data-cse="code-einloesen"]').click();
  await page.waitForURL(/code\?fehler=code/u);
  const meldungAbgelaufen = await page
    .locator('form[data-cse="anmeldung-code"] [role="alert"]').innerText();

  expect(meldungAbgelaufen).toBe(meldungFalsch);
});

/**
 * (4) **Der richtige Code führt ins Mitarbeiterportal — und gilt genau
 * einmal.**
 *
 * Der zweite Teil ist der Wiedereinlöse-Angriff: stünde das Verbrauchen in
 * der Anwendung statt in `app.zugang_code_einloesen`, gäbe es ein Fenster
 * zwischen Prüfen und Verbrauchen, in dem derselbe Code zweimal gilt.
 */
test('der richtige Code meldet an, und ein zweites Mal nicht mehr', async ({ page }) => {
  const nummer = await nummerVon('fatima.yildiz@cse-gruppe.de');

  await page.goto('/auth/mitarbeiter');
  await page.fill('input[name="telefon"]', nummer);
  await bremseLoesenFuerFeld(page);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');
  const code = (await page.locator('[data-cse="dev-code-wert"]').innerText()).trim();

  await page.fill('input[name="code"]', code);
  await page.locator('[data-cse="code-einloesen"]').click();
  await page.waitForURL(/\/portal\/mein/u);
  /*
   * **Den TEXT festnageln, nicht die Sichtbarkeit.** `toBeVisible()` auf
   * irgendeinem `h1` ist auch dann wahr, wenn die Anmeldung fehlgeschlagen
   * ist — „Anmeldung erforderlich" hat ebenfalls eine Ueberschrift. Der
   * Bildschirm, den eine angemeldete Kraft sieht, heisst „Heute".
   */
  await expect(page.locator('h1')).toHaveText('Heute');

  /*
   * Abmelden und denselben Code erneut: er ist verbraucht. Der Weg dorthin
   * geht wieder über die Nummer, weil die Codeseite ohne den kurzlebigen Keks
   * zum ersten Schritt zurückschickt — auch das eine Zusage und kein Zufall.
   */
  await page.context().clearCookies();
  await page.goto('/auth/mitarbeiter');
  await page.fill('input[name="telefon"]', nummer);
  await bremseLoesenFuerFeld(page);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');

  await page.fill('input[name="code"]', code);
  await page.locator('[data-cse="code-einloesen"]').click();
  await page.waitForURL(/code\?fehler=code/u);
  expect(new URL(page.url()).pathname).toBe('/auth/mitarbeiter/code');
});

/**
 * Die Codeseite ohne offene Anmeldung ist kein halber Bildschirm, sondern der
 * erste Schritt. Sonst gäbe es einen zweiten Weg in die Codeeingabe — und der
 * zweite Weg ist der, den niemand prüft.
 */
test('die Codeseite ohne angefangene Anmeldung schickt zum ersten Schritt', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/auth/mitarbeiter/code');
  expect(new URL(page.url()).pathname).toBe('/auth/mitarbeiter');
});

/**
 * BFSG gilt für dieses Angebot, und die Anmeldung ist die Seite, an der ein
 * Zugänglichkeitsfehler den ganzen Rest unerreichbar macht.
 */
/**
 * **Auf den Titel WARTEN, und ihn dabei gleich mitprüfen.**
 *
 * Dieser Fall war zeitweise rot mit `document-title` — und die Seite war nie
 * schuld. Gemessen: unmittelbar nach `waitForURL` meldet der Browser
 * `document.title === ''`, kurz darauf „Code eingeben — CSE Gruppe". Der
 * zweite Schritt entsteht durch eine CLIENTSEITIGE Navigation (Server Action
 * plus Weiterleitung); die Adresse wechselt, bevor Next die Metadaten
 * angewandt hat. axe lief in genau dieses Fenster — mal gewann der eine, mal
 * der andere, und ein Lauf, der von der Tagesform der Maschine abhängt,
 * beweist nichts.
 *
 * Gewartet wird deshalb auf die Bedingung, von der die Prüfung abhängt — und
 * die Wartezeile ist zugleich eine ZUSICHERUNG: sie nennt den erwarteten
 * Titel. Das ist strenger als vorher, nicht lascher. Ein leeres `<title>`
 * fiele hier ebenso wie ein falsches, nur nicht mehr zufällig.
 */
const TITEL = {
  erst: /Anmeldung für Mitarbeitende/u,
  dann: /Code eingeben/u,
} as const;

test('beide Anmeldeschritte sind ohne axe-Verstoss', async ({ page }) => {
  for (const schritt of ['erst', 'dann'] as const) {
    if (schritt === 'erst') {
      await page.goto('/auth/mitarbeiter');
    } else {
      await page.fill('input[name="telefon"]', await nummerVon('amir.haddad@cse-gruppe.de'));
      await bremseLoesenFuerFeld(page);
      await page.locator('[data-cse="code-anfordern"]').click();
      await page.waitForURL('**/auth/mitarbeiter/code');
    }
    await expect(page).toHaveTitle(TITEL[schritt]);

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
      schritt,
    ).toEqual([]);
  }
});

/**
 * **Und die Abkürzung ist weg.** `/dev/anmelden` listet keine
 * `mitarbeiter`-Konten mehr: gäbe es sie noch, liefe jede andere Prüfung an
 * der echten Anmeldung vorbei, und ein Entwicklungsbau hätte zwei Eingänge in
 * dasselbe Portal.
 */
test('die Dev-Anmeldung bietet keine Beschäftigten mehr an', async ({ page }) => {
  await page.goto('/dev/anmelden');
  await expect(page.locator('[data-cse="dev-anmelden"]').first()).toBeVisible();
  expect(await page.locator('[data-cse="dev-anmelden"][data-rolle="mitarbeiter"]').count())
    .toBe(0);
  // Die Gegenprobe: die übrigen Rollen stehen sehr wohl noch da, sonst wäre
  // diese Zusage auch auf einer leeren Seite erfüllt.
  expect(await page.locator('[data-cse="dev-anmelden"][data-rolle="admin"]').count())
    .toBeGreaterThan(0);
});

/**
 * (7) **Die Schreibweise, die ein Mensch am Telefon wirklich tippt.**
 *
 * Jede Prüfung oben LIEST die Nummer aus der Datenbank (`+49 170 1000000`)
 * und gibt sie wörtlich ins Feld. Ein Mensch tippt `0170 1000000` — mit
 * führender Null und Leerzeichen, so wie sie auf jeder Visitenkarte steht.
 * Genau diese Form hat ein Nutzer eingegeben, und ob sie ankommt, hing an
 * `normalisiereTelefon` und daran, dass der Vergleich beide Seiten auf E.164
 * bringt.
 *
 * Die Prüfung kostet nichts und deckt die einzige Schreibweise ab, die im
 * Betrieb tatsächlich vorkommt.
 */
test('die nationale Schreibweise mit führender Null meldet genauso an', async ({ page }) => {
  const e164 = await nummerVon('fatima.yildiz@cse-gruppe.de');
  /* `+49 170 1000000` → `0170 1000000`: Ländervorwahl weg, Null davor. */
  const national = e164.replace(/^\+49\s*/u, '0');
  expect(national, 'die Rückrechnung muss eine nationale Form ergeben').toMatch(/^0\d/u);

  await page.goto('/auth/mitarbeiter');
  await page.fill('input[name="telefon"]', national);
  await bremseLoesenFuerFeld(page);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');

  const code = (await page.locator('[data-cse="dev-code-wert"]').innerText()).trim();
  await page.fill('input[name="code"]', code);
  await page.locator('[data-cse="code-einloesen"]').click();

  await page.waitForURL(/\/portal\/mein/u);
  await expect(page.locator('h1')).toHaveText('Heute');
});

/**
 * (8) **Der Keks, den der Browser auch behält.**
 *
 * Der teuerste Fehler dieses Weges war unsichtbar: `anmeldeKeksOptionen`
 * schrieb `secure: process.env.NODE_ENV === 'production'` als Literal, und
 * Webpack betonierte daraus im Bau `secure:!0` ein (D-541). Über
 * `http://192.168.0.193` verwarf jeder Browser den Keks, die Anmeldung war am
 * Telefon unmöglich — und keine Prüfung wurde rot, weil die Browsersuite über
 * `localhost` läuft und Loopback für Browser ein sicherer Kontext ist.
 *
 * Diese Prüfung schaut deshalb NICHT auf den Bildschirm, sondern auf den
 * `Set-Cookie`-Kopf. Der ist unabhängig davon, über welchen Host die Suite
 * läuft: unter `CSE_DEV_FLAECHEN=1` — und damit läuft Playwright — darf dort
 * kein `Secure` stehen und kein `__Host-`-Name.
 */
test('unter CSE_DEV_FLAECHEN trägt kein Anmeldekeks `Secure`', async ({ page }) => {
  const nummer = await nummerVon('fatima.yildiz@cse-gruppe.de');
  /*
   * **`response.headers()` taugt fuer `set-cookie` nicht.** Es liefert ein
   * Objekt mit einem Wert je Name; mehrere `Set-Cookie`-Koepfe einer Antwort
   * fallen dabei zusammen oder ganz heraus. `headerValue()` gibt sie roh
   * zurueck — und weil es asynchron ist, werden die Antworten hier gesammelt
   * und danach ausgelesen.
   */
  const antworten: Response[] = [];
  page.on('response', (r) => { antworten.push(r); });

  await page.goto('/auth/mitarbeiter');
  await page.fill('input[name="telefon"]', nummer);
  await bremseLoesenFuerFeld(page);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');

  const koepfe = (await Promise.all(antworten.map((r) => r.headerValue('set-cookie'))))
    .filter((k): k is string => k !== null);
  const anmeldekekse = koepfe.filter((k) => k.includes('cse_anmeldung_'));
  expect(anmeldekekse.length, 'kein Set-Cookie fuer die Anmeldekekse gesehen')
    .toBeGreaterThan(0);
  for (const kopf of anmeldekekse) {
    expect(kopf, 'ein `Secure`-Keks kommt ueber http:// nie an').not.toMatch(/;\s*Secure/iu);
  }

  const code = (await page.locator('[data-cse="dev-code-wert"]').innerText()).trim();
  await page.fill('input[name="code"]', code);
  await page.locator('[data-cse="code-einloesen"]').click();
  await page.waitForURL(/\/portal\/mein/u);

  /* Und der Sitzungskeks trägt denselben Zustand — eine Entscheidung, zwei Kekse. */
  const spaeter = (await Promise.all(antworten.map((r) => r.headerValue('set-cookie'))))
    .filter((k): k is string => k !== null);
  const sitzung = spaeter.filter((k) => k.includes('cse_sitzung='));
  expect(sitzung.length, 'kein Set-Cookie fuer den Sitzungskeks gesehen').toBeGreaterThan(0);
  for (const kopf of sitzung) {
    expect(kopf).not.toMatch(/;\s*Secure/iu);
    expect(kopf, '`__Host-` verlangt `Secure` — beides oder keines').not.toContain('__Host-');
  }
});
