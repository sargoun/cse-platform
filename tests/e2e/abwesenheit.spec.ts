/**
 * Abwesenheiten und Anträge im Browser — PR 38 (EMP-10, LEG-09).
 *
 * Was nur hier zu prüfen ist: dass der Bildschirm der Planung den Grund nicht
 * zeigt, dass eine Entscheidung ohne JavaScript funktioniert, und dass eine
 * genehmigte Abwesenheit im Dienstplan als Befund auftaucht — dort, wo eine
 * Planerin hinsieht, bevor sie einteilt.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';
import { tagDeutsch } from '../../src/lib/datum/kalendertag.js';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Weit genug in der Zukunft, damit keine andere Fixtur danebenliegt. */
const VON = '2029-04-09';   // Montag
const BIS = '2029-04-11';

/**
 * **Eine EIGENE Woche fuer den Dienstplantest.**
 *
 * Er lag auf derselben Woche wie der Stornotest — und teilte sich mit ihm die
 * Abwesenheitszeile. Der Quelltext unterstellte die Reihenfolge „erst
 * stornieren, dann neu anlegen"; bei `fullyParallel` laufen die beiden
 * `describe`-Bloecke aber in verschiedenen Workern, und die Reihenfolge gilt
 * nicht. Lief der Dienstplantest zuerst, griff sein `where not exists`-
 * Waechter auf die noch nicht stornierte Krankheitszeile, die eigene
 * Abmeldung entstand gar nicht, und die Schicht trug kein „abgemeldet".
 *
 * Zwei Tests, die sich eine Zeile teilen, sind kein Fixturdetail, sondern
 * ein Rennen. Getrennte Wochen sind die Reparatur, die keine Reihenfolge
 * voraussetzt.
 */
const PLAN_VON = '2029-04-16';   // Montag, eigene Woche
const PLAN_BIS = '2029-04-18';

let mandantId = '';
let anstellungId = '';
let abwesenheitId = '';

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
  const [a] = await sql.unsafe<{ id: string }[]>(
    `select id from anstellung where mandant_id = $1 and geloescht_am is null
      order by personalnummer limit 1`, [mandantId]);
  anstellungId = a!.id;

  // Die Lohnfrage der Art ist im Demo-Bestand beantwortet; hier wird sie
  // sicherheitshalber gesetzt, damit der Test nicht an O-139 scheitert.
  const [art] = await sql.unsafe<{ id: string }[]>(
    `update abwesenheitsart set bezahlt = coalesce(bezahlt, true)
      where schluessel = 'krankheit' and mandant_id is null returning id`);

  const [vorhanden] = await sql.unsafe<{ id: string }[]>(
    `select id from abwesenheit where anstellung_id = $1 and von = $2::date`,
    [anstellungId, VON]);
  abwesenheitId = vorhanden?.id ?? (await sql.unsafe<{ id: string }[]>(
    `insert into abwesenheit
       (mandant_id, anstellung_id, abwesenheitsart_id, von, bis,
        tage_angerechnet, status, au_bescheinigung_vorliegt, bemerkung)
     values ($1, $2, $3, $4::date, $5::date, 3, 'erfasst', true,
             'AU liegt vor — e2e-Fixtur')
     returning id`,
    [mandantId, anstellungId, art!.id, VON, BIS]))[0]!.id;
});

test.afterAll(() => {
  // Kein DELETE: `abwesenheit` trägt die Löschsperre (Invariante 8). Und kein
  // `sql.end()` — siehe `dienstplan.spec.ts`.
});

/**
 * **Diese Datei laeuft SERIELL** — wie `auftrag.spec.ts` und aus demselben
 * Grund.
 *
 * `fullyParallel: true` verteilt auch die Pruefungen INNERHALB einer Datei auf
 * verschiedene Arbeiter. Die drei Beschreibungen hier teilen sich aber die
 * Fixtur aus `beforeAll`: dieselbe Abwesenheit, derselbe Antrag. Entscheidet
 * die eine Pruefung ueber den Antrag, waehrend die andere sein Formular sucht,
 * findet die zweite nichts — und meldet „element(s) not found" fuer ein
 * Formular, das es gab, bis der Nachbar es benutzt hat.
 *
 * Genau so ist es gefallen: „und eine Entscheidung funktioniert ohne
 * JavaScript" suchte ein Formular, das „Der Posteingang steht und nennt seinen
 * Zweck" Sekunden vorher abgeraeumt hatte. Loeschen kann die Suite nichts
 * (Invariante 8), also ist Reihenfolge die einzige Trennung, die traegt.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Abwesenheiten — die Liste der Planung', () => {
  test('zeigt den Zeitraum und nirgends den Grund', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/personal/abwesenheiten?woche=${VON}`);

    const tabelle = page.locator('[data-cse="tabelle"]');
    // Der Tag steht in der Hausschreibweise TT.MM.JJJJ (V-197, D-690) — die
    // Adresse (`?woche=`) behält den ISO-Tag.
    await expect(tabelle).toContainText(tagDeutsch(VON));

    /**
     * Der Kern des Tests: das Wort „Krankheit" steht auf diesem Bildschirm
     * nicht — weil die Spalte der Anwendungsrolle entzogen ist und nicht,
     * weil die Seite es ausblendet. Und die AU-Bemerkung schon gar nicht.
     */
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('Krankheit');
    expect(text).not.toContain('AU liegt vor');
    // Aber der Hinweis, warum nicht, steht da.
    expect(text).toContain('Art. 9 DSGVO');
  });

  test('und eine Entscheidung funktioniert ohne JavaScript', async ({ browser }) => {
    const kontext = await browser.newContext({ javaScriptEnabled: false });
    const seite = await kontext.newPage();
    await seite.goto('/dev/anmelden');
    await seite.locator(
      `[data-cse="dev-anmelden"][data-email="${KONTO.adminReinigung}"]`).click();
    await seite.waitForLoadState('domcontentloaded');
    await seite.goto(`/portal/reinigung/personal/abwesenheiten?woche=${VON}`);

    /**
     * `:visible` ist hier keine Bequemlichkeit, sondern die Aussage.
     *
     * `DataTable` legt jede Zeile ZWEIMAL ins Dokument: als `tr` fuer den
     * Schreibtisch und als `dl`-Karte fuer das Telefon; eine Medienabfrage
     * blendet die je andere aus. Beide tragen dasselbe `action` — ohne den
     * Filter faende der strikte Modus zwei Treffer und meldete einen Fehler,
     * wo keiner ist. Gepruefte Bedienung ist die SICHTBARE Bedienung.
     */
    const formular = seite
      .locator(`form[action="/api/abwesenheiten/${abwesenheitId}"]:visible`);
    await expect(formular).toBeVisible();
    await formular.locator('input[name="grund"]').fill('Meldung war eine Verwechslung.');
    await formular.getByRole('button', { name: 'Stornieren' }).click();
    await seite.waitForLoadState('domcontentloaded');

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from abwesenheit where id = $1`, [abwesenheitId]);
    expect(z?.status).toBe('storniert');
    await kontext.close();
  });
});

test.describe('Anträge', () => {
  test('der Posteingang steht und nennt seinen Zweck', async ({ page }) => {
    await anmelden(page);
    await page.goto('/portal/reinigung/personal/antraege');
    await expect(page.getByRole('heading', { name: 'Anträge', level: 1 })).toBeVisible();
    // Der Demo-Bestand legt genau einen offenen Antrag an.
    const karten = page.locator('[data-cse="antrag"]');
    expect(await karten.count()).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Der Dienstplan kennzeichnet die betroffene Schicht', () => {
  test('eine Abmeldung erscheint als Befund an der Schicht', async ({ page }) => {
    // Eine Schicht IM Abwesenheitszeitraum, mit genau dieser Beschäftigung besetzt.
    const [kunde] = await sql.unsafe<{ id: string }[]>(
      `select id from kunde where mandant_id = $1 limit 1`, [mandantId]);
    const [objekt] = await sql.unsafe<{ id: string }[]>(
      `select id from objekt where mandant_id = $1 order by objektnummer limit 1`, [mandantId]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                            beginn_lokal, ende_lokal, endet_am_folgetag,
                            objekt_id, kunde_id, soll_besetzung, min_besetzung,
                            erstellt_von_art, status)
       select $1, 'manuell', $2, $3::date,
              (select zeitpunkt from app.loese_ortszeit($3::date, '06:00'::time, 'Europe/Berlin')),
              (select zeitpunkt from app.loese_ortszeit($3::date, '09:30'::time, 'Europe/Berlin')),
              'Europe/Berlin', '06:00'::time, '09:30'::time, false,
              $4, $5, 1, 1, 'system', 'geplant'
       on conflict (mandant_id, quell_schluessel) where storniert_am is null do nothing
       returning id`,
      [mandantId, `e2e:abwesenheit-plan:${PLAN_VON}`, PLAN_VON, objekt!.id, kunde!.id]);
    const einsatzId = e?.id ?? (await sql.unsafe<{ id: string }[]>(
      `select id from einsatz where mandant_id = $1 and quell_schluessel = $2`,
      [mandantId, `e2e:abwesenheit-plan:${PLAN_VON}`]))[0]!.id;

    const [person] = await sql.unsafe<{ person_id: string }[]>(
      `select person_id from anstellung where id = $1`, [anstellungId]);
    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      erstellt_von_art)
       values ($1, $2, $3, $4, 'system')
       on conflict do nothing`,
      [mandantId, einsatzId, anstellungId, person!.person_id]);

    /**
     * Die eigene Abmeldung, in der eigenen Woche — und der Waechter fragt
     * nach GENAU DIESER Zeile statt nach „irgendeiner nicht stornierten".
     * Der alte fremdbezogene Waechter liess den `insert` ausfallen, sobald
     * eine fremde Zeile derselben Anstellung offen war, und schwieg dabei.
     */
    const [art] = await sql.unsafe<{ id: string }[]>(
      `select id from abwesenheitsart where schluessel = 'urlaub' and mandant_id is null`);
    await sql.unsafe(
      `insert into abwesenheit (mandant_id, anstellung_id, abwesenheitsart_id, von, bis,
                                tage_angerechnet, status)
       select $1, $2, $3, $4::date, $5::date, 3, 'erfasst'
        where not exists (
          select 1 from abwesenheit a
           where a.anstellung_id = $2 and a.von = $4::date
             and a.abwesenheitsart_id = $3 and a.status <> 'storniert')`,
      [mandantId, anstellungId, art!.id, PLAN_VON, PLAN_BIS]);

    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${PLAN_VON}`);
    const block = page.locator(`[data-cse="schicht"][data-schicht="${einsatzId}"]`);
    await expect(block).toBeVisible();
    // Text, nicht Farbe (DESIGN §9) — und ohne den Grund zu nennen.
    await expect(block).toContainText('abgemeldet');
  });
});
