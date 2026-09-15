/**
 * Faehrt den kompletten Mitarbeiter-Anmeldeweg und protokolliert JEDEN
 * Set-Cookie-Kopf. Aufruf:  node anmeldeweg.mjs <basis-url> <telefon> <label>
 */
import { chromium } from '@playwright/test';

const BASIS = process.argv[2];
const TELEFON = process.argv[3];
const LABEL = process.argv[4] ?? TELEFON;

const L = (...a) => console.log(...a);

function trenner(t) {
  L('\n' + '='.repeat(78));
  L(t);
  L('='.repeat(78));
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const antworten = [];
page.on('response', async (res) => {
  const req = res.request();
  if (!/\.(js|css|woff2?|png|svg|ico)(\?|$)/u.test(res.url())) {
    let kopf = [];
    try { kopf = await res.headersArray(); } catch { /* egal */ }
    const setCookies = kopf.filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);
    const loc = kopf.find((h) => h.name.toLowerCase() === 'location')?.value ?? null;
    antworten.push({
      methode: req.method(), url: res.url(), status: res.status(), location: loc, setCookies,
    });
  }
});

trenner(`LAUF: ${LABEL}   Basis: ${BASIS}   Nummer: ${TELEFON}`);

// ---- Schritt 1 -------------------------------------------------------------
L('\n--- 1) GET /auth/mitarbeiter ---');
await page.goto(`${BASIS}/auth/mitarbeiter`, { waitUntil: 'networkidle' });
L('URL:', page.url());
L('H1 :', await page.locator('h1').first().textContent());
L('Kekse nach Schritt 1:', JSON.stringify(await ctx.cookies(), null, 1));

// ---- Schritt 2: Nummer abschicken -----------------------------------------
L('\n--- 2) Nummer eintippen + "Code anfordern" ---');
await page.fill('input[name="telefon"]', TELEFON);
await Promise.all([
  page.waitForLoadState('networkidle'),
  page.click('[data-cse="code-anfordern"]'),
]);
await page.waitForTimeout(800);
L('URL nach Absenden:', page.url());
L('H1 :', await page.locator('h1').first().textContent());
const kekse2 = await ctx.cookies();
L('Kekse nach Schritt 2:', JSON.stringify(kekse2, null, 1));

// ---- Schritt 3: Code lesen -------------------------------------------------
let code = null;
const devFeld = page.locator('[data-cse="dev-code-wert"]');
if (await devFeld.count() > 0) {
  code = (await devFeld.first().textContent())?.trim() ?? null;
  L('DEV-CODE auf dem Bildschirm:', code);
} else {
  L('KEIN [data-cse="dev-code-wert"] auf der Seite.');
  const fehler = page.locator('[data-cse="code-fehler"]');
  if (await fehler.count() > 0) L('Fehlerkasten:', (await fehler.first().textContent())?.trim());
}

// ---- Schritt 4: Code einloesen --------------------------------------------
if (code !== null && await page.locator('input[name="code"]').count() > 0) {
  L('\n--- 3) Code eintippen + "Anmelden" ---');
  await page.fill('input[name="code"]', code);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('[data-cse="code-einloesen"]'),
  ]);
  await page.waitForTimeout(1200);
} else {
  L('\n--- 3) UEBERSPRUNGEN: kein Code / kein Codefeld erreichbar ---');
}

// ---- Endzustand ------------------------------------------------------------
trenner('ENDZUSTAND');
L('END-URL :', page.url());
L('TITEL   :', await page.title());
let h1 = '(keins)';
try { h1 = (await page.locator('h1').first().textContent({ timeout: 2000 }))?.trim(); } catch { /* */ }
L('END-H1  :', h1);
for (const marke of ['mein-portal', 'anmeldung-mitarbeiter', 'keks-abgelehnt',
  'anmeldung-telefon', 'anmeldung-code', 'code-fehler', 'sms-nicht-verbunden',
  'stunden-kopf', 'dev-code-wert']) {
  const n = await page.locator(`[data-cse="${marke}"]`).count();
  if (n > 0) L(`  data-cse="${marke}"  x${n}`);
}
const txt = (await page.locator('body').innerText()).replace(/\n{2,}/gu, '\n');
L('--- Sichtbarer Text (gekuerzt) ---');
L(txt.slice(0, 900));

trenner('KEKSE IM BROWSER AM ENDE');
L(JSON.stringify(await ctx.cookies(), null, 1));

trenner('ALLE ANTWORTEN (Status / Location / Set-Cookie)');
for (const a of antworten) {
  L(`[${a.methode} ${a.status}] ${a.url}`);
  if (a.location !== null) L(`        Location: ${a.location}`);
  for (const sc of a.setCookies) L(`        Set-Cookie: ${sc}`);
}

await browser.close();
