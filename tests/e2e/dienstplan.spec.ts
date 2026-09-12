/**
 * Der Dienstplan im Browser — die Abnahmekriterien von PR 33, die nur dort
 * zu pruefen sind.
 *
 * (1) Zehn Schichten zur selben Sekunde an einem Objekt stehen als zehn
 *     sichtbare Spalten nebeneinander. Das ist TIM-04, und es ist der Fall,
 *     an dem ein Plan still falsch wird: gruppiert er, zeigt er eine Zeile,
 *     und dass neun fehlen, sieht niemand.
 * (2) Eine Schicht 22:00–06:00 steht an beiden Tagen und liest `8,00 h`; in
 *     den beiden Umstellungsnaechten `7,00 h` und `9,00 h` (K-11).
 * (5) Die Anzeige bleibt Europe/Berlin, auch wenn der BROWSER in New York
 *     steht — jede Uhrzeit kommt fertig aus der Datenbank, und dieser Test
 *     ist der Beweis, dass sich keine client-seitige Formatierung
 *     eingeschlichen hat.
 */
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Ein Tag weit genug in der Zukunft, damit keine andere Schicht dazwischenliegt. */
const TAG = '2028-03-06';        // ein Montag
const NACHT_NORMAL = '2028-03-11';
const NACHT_VOR = '2028-03-25';  // Umstellung in der Nacht auf den 26.03.2028
const NACHT_ZURUECK = '2028-10-28'; // Umstellung in der Nacht auf den 29.10.2028
/**
 * Die Konfliktfaelle bekommen einen EIGENEN Tag.
 *
 * Sonst zaehlt der Parallelspalten-Test ihre Schichten mit, und `toHaveCount(10)`
 * wird zu 12 — ein Fehlschlag, der nach einem Layoutfehler aussieht und keiner
 * ist. Tests, die sich Daten teilen, pruefen einander statt der Sache.
 */
const KONFLIKT_TAG = '2028-03-13';

let objektId = '';
let mandantId = '';
let personId = '';
let anstellungId = '';
let warnKonflikt = '';
let sperrKonflikt = '';
/**
 * Die Ids der angelegten Schichten.
 *
 * Geprueft wird gegen SIE und nicht gegen „alle Schichten dieses Tages":
 * `einsatz` traegt die Loeschsperre, also bleiben die Schichten frueherer
 * Laeufe liegen, und ein Zaehltest wuerde mit jedem Lauf um eins daneben
 * liegen — ein Fehlschlag, der nach einem Layoutfehler aussieht.
 */
const ids: Record<string, string> = {};

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

/**
 * Eine Schicht von Hand — `quelle = 'manuell'`, wie eine geplante
 * Einzelschicht.
 *
 * Der Schluessel traegt das DATUM. `on conflict … do nothing` heisst sonst:
 * eine Schicht, die ein frueherer Lauf an einem anderen Tag angelegt hat,
 * bleibt dort liegen — und der Test prueft danach eine Schicht, die woanders
 * steht, als er glaubt. `einsatz` traegt die Loeschsperre, aufraeumen kann er
 * sie also nicht.
 */
async function schicht(
  schluessel: string, datum: string, von: string, bis: string, folgetag: boolean,
): Promise<string> {
  await sql.unsafe(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, soll_besetzung, min_besetzung,
                          erstellt_von_art, status)
     select $1, 'manuell', $2, $3::date,
            (select zeitpunkt from app.loese_ortszeit($3::date, $4::time, 'Europe/Berlin')),
            (select zeitpunkt from app.loese_ortszeit(
               ($3::date + case when $6 then 1 else 0 end), $5::time, 'Europe/Berlin')),
            'Europe/Berlin', $4::time, $5::time, $6,
            $7, o.kunde_id, 1, 1, 'system', 'geplant'
       from objekt o where o.id = $7
     on conflict (mandant_id, quell_schluessel) where storniert_am is null do nothing`,
    [mandantId, schluessel, datum, von, bis, folgetag, objektId],
  );
  const [e] = await sql.unsafe<{ id: string }[]>(
    `select id from einsatz where mandant_id = $1 and quell_schluessel = $2`,
    [mandantId, schluessel]);
  return e!.id;
}

/**
 * Ein Konflikt, wie ihn der Detektor schreibt.
 *
 * Er wird hier von Hand gesetzt und nicht ueber den Detektor erzeugt: der
 * braucht eine echte Ueberlastung ueber zwei Gesellschaften, und dieser Test
 * prueft die ANZEIGE, nicht die Erkennung. Die hat ihre eigenen neun Tests
 * gegen die Datenbank.
 */
async function konflikt(schluessel: string, blockiert: boolean): Promise<string> {
  const [e] = await sql.unsafe<{ id: string; beginn: Date; ende: Date }[]>(
    `select id, beginn_zeitpunkt as beginn, ende_zeitpunkt as ende
       from einsatz where mandant_id = $1 and quell_schluessel = $2`,
    [mandantId, schluessel]);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into planungs_konflikt (
       mandant_id, art, person_id, anstellung_id, einsatz_id,
       zeitraum_beginn, zeitraum_ende, schwere, blockiert,
       betrifft_fremden_mandant, details, fingerprint, erkannt_durch, erstellt_von_art)
     values ($1, $2::konflikt_art, $3, $4, $5, $6, $7,
             $8::verstoss_schwere, $9, $10, '{}'::jsonb,
             $11, 'detektor_job', 'system')
     on conflict (mandant_id, fingerprint) where hinfaellig_am is null
       -- Eine Fixtur STELLT ihre Vorbedingung her, sie erbt sie nicht: ein
       -- frueherer Lauf hat diese Zeile womoeglich quittiert, und der Test
       -- pruefte dann eine Karte, die es im Eingang gar nicht mehr gibt.
       do update set schwere = excluded.schwere,
                     status = 'offen',
                     quittiert_am = null,
                     quittiert_von = null,
                     quittierung_begruendung = null
     returning id`,
    [
      mandantId, blockiert ? 'qualifikation_entfallen' : 'arbzg',
      personId, anstellungId, e!.id, e!.beginn, e!.ende,
      blockiert ? 'verstoss' : 'warnung', blockiert, false,
      // Der Abdruck wird HIER gerechnet und nicht in SQL: dieselbe Nummer
      // zweimal — einmal als uuid, einmal als Text — laesst Postgres den Typ
      // des Parameters nicht ableiten ("inconsistent types deduced").
      createHash('sha256').update(`${e!.id}:${schluessel}`).digest('hex'),
    ]);
  return k!.id;
}

test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `select id from mandant where slug = 'reinigung' limit 1`);
  mandantId = m!.id;
  const [a] = await sql.unsafe<{ id: string; person_id: string }[]>(
    `select id, person_id from anstellung where mandant_id = $1 and geloescht_am is null
      order by personalnummer limit 1`, [m!.id]);
  anstellungId = a!.id;
  personId = a!.person_id;
  const [o] = await sql.unsafe<{ id: string }[]>(
    `select id from objekt where mandant_id = $1 and kunde_id is not null
      order by objektnummer limit 1`, [mandantId]);
  objektId = o!.id;

  // (1) zehn zur selben Sekunde
  for (let i = 0; i < 10; i += 1) {
    await schicht(`e2e:parallel:${TAG}:${String(i)}`, TAG, '06:00', '10:00', false);
  }
  // (2) die drei Naechte
  ids['normal'] = await schicht(
    `e2e:nacht:normal:${NACHT_NORMAL}`, NACHT_NORMAL, '22:00', '06:00', true);
  ids['vor'] = await schicht(`e2e:nacht:vor:${NACHT_VOR}`, NACHT_VOR, '22:00', '06:00', true);
  ids['zurueck'] = await schicht(
    `e2e:nacht:zurueck:${NACHT_ZURUECK}`, NACHT_ZURUECK, '22:00', '06:00', true);
  // (3)/(4): ein warnender und ein sperrender Konflikt an zwei Schichten
  await schicht(`e2e:konflikt:warn:${KONFLIKT_TAG}`, KONFLIKT_TAG, '14:00', '18:00', false);
  await schicht(`e2e:konflikt:sperr:${KONFLIKT_TAG}`, KONFLIKT_TAG, '19:00', '22:00', false);
  warnKonflikt = await konflikt(`e2e:konflikt:warn:${KONFLIKT_TAG}`, false);
  sperrKonflikt = await konflikt(`e2e:konflikt:sperr:${KONFLIKT_TAG}`, true);
});

test.afterAll(() => {
  /**
   * Kein DELETE: `einsatz` traegt die Loeschsperre (Invariante 8). Die Zeilen
   * bleiben stehen; sie stoeren nicht, weil sie 2028 liegen und jeder
   * Schluessel sein Datum traegt.
   *
   * Und kein `sql.end()`: der serielle Block laeuft im selben Arbeiter nach
   * den parallelen, und ein geschlossener Pool riss ihn mit einem
   * `CONNECTION_ENDED` ab — ein Fehlschlag, der nach einem Datenbankproblem
   * aussieht und keins ist. Der Prozess schliesst die Verbindung selbst.
   */
});

test.describe('Dienstplan — Wochenansicht', () => {
  test('(1) zehn Schichten zur selben Sekunde sind zehn sichtbare Spalten', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${TAG}`);

    const bloecke = page.locator(`[data-cse="plantag"][data-datum="${TAG}"] [data-cse="schicht"]`);
    await expect(bloecke).toHaveCount(10);

    const kaesten = await bloecke.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), breite: Math.round(r.width), hoehe: Math.round(r.height) };
      }));

    // Zehn UNTERSCHIEDLICHE x-Positionen — nicht uebereinander.
    expect(new Set(kaesten.map((k) => k.x)).size).toBe(10);
    // Keiner ist weggeklappt: jeder hat Breite und Hoehe.
    for (const k of kaesten) {
      expect(k.breite, 'ein Block ohne Breite ist ein unsichtbarer Block').toBeGreaterThan(0);
      expect(k.hoehe).toBeGreaterThan(0);
    }
    // Und sie ueberlappen einander nicht — sonst waeren zehn Spalten optisch
    // wieder eine.
    const sortiert = [...kaesten].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sortiert.length; i += 1) {
      expect(sortiert[i]!.x).toBeGreaterThanOrEqual(sortiert[i - 1]!.x + sortiert[i - 1]!.breite - 1);
    }
  });

  test('(2) die Nachtschicht steht an beiden Tagen und liest 8,00 h', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${NACHT_NORMAL}`);

    const ersterTag = page.locator(
      `[data-cse="plantag"][data-datum="${NACHT_NORMAL}"] [data-schicht="${ids['normal'] ?? ''}"]`);
    const zweiterTag = page.locator(
      `[data-cse="plantag"][data-datum="2028-03-12"] [data-schicht="${ids['normal'] ?? ''}"]`);
    await expect(ersterTag).toHaveCount(1);
    await expect(zweiterTag).toHaveCount(1);
    await expect(ersterTag.first()).toContainText('8,00 h');
    await expect(zweiterTag.first()).toContainText('8,00 h');
    // Der Pfeil sagt, in welche Richtung sie weitergeht.
    await expect(ersterTag.first()).toContainText('↓');
    await expect(zweiterTag.first()).toContainText('↑');
  });

  test('(2) die Nacht der Vorstellung liest 7,00 h', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${NACHT_VOR}`);
    const block = page.locator(
      `[data-cse="plantag"][data-datum="${NACHT_VOR}"] [data-schicht="${ids['vor'] ?? ''}"]`);
    await expect(block.first()).toContainText('7,00 h');
    // Die Ortszeit bleibt 22:00–06:00 — verschoben hat sich der Instant.
    await expect(block.first()).toContainText('22:00');
    await expect(block.first()).toContainText('06:00');
  });

  test('(2) die Nacht der Rueckstellung liest 9,00 h', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${NACHT_ZURUECK}`);
    const block = page.locator(
      `[data-cse="plantag"][data-datum="${NACHT_ZURUECK}"] [data-schicht="${ids['zurueck'] ?? ''}"]`);
    await expect(block.first()).toContainText('9,00 h');
  });
});

test.describe('(5) die Anzeige bleibt Berlin', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('auch wenn der Browser in New York steht', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${NACHT_NORMAL}`);
    const block = page.locator(
      `[data-cse="plantag"][data-datum="${NACHT_NORMAL}"] [data-schicht="${ids['normal'] ?? ''}"]`);
    // 22:00 Berlin ist 16:00 in New York. Stuende hier 16:00, haette sich
    // eine client-seitige Formatierung eingeschlichen.
    await expect(block.first()).toContainText('22:00');
    await expect(block.first()).not.toContainText('16:00');
  });
});

test.describe('(5) der Monat auf einem Telefon', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('scrollt nicht waagerecht', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/monat?monat=${TAG}`);
    await expect(page.locator('[data-cse="monatsplan"]')).toBeVisible();
    const waagerecht = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(waagerecht, 'DESIGN §8: keine waagerechte Scrollleiste auf dem Telefon').toBe(false);
  });
});

test.describe('(3)/(4) Befunde und ihre Quittung', () => {
  /**
   * SERIELL, weil (4) quittiert, was (3) liest.
   *
   * Parallel gelaufen fand (3) den Befund manchmal und manchmal nicht — ein
   * Test, der von der Reihenfolge abhaengt, ist schlimmer als keiner: er wird
   * irgendwann rot, und niemand weiss warum.
   */
  test.describe.configure({ mode: 'serial' });

  test('(3) der Plan zeigt den Befund als WORT, nicht nur als Farbe', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/dienstplan/woche?woche=${KONFLIKT_TAG}`);
    const befunde = page.locator(
      `[data-cse="plantag"][data-datum="${KONFLIKT_TAG}"] [data-cse="befund"]`);
    await expect(befunde).toHaveCount(2);
    // DESIGN §9 / BFSG: das Wort traegt die Bedeutung. Waere nur die Farbe da,
    // bestuende dieser Test nicht — und ein farbenblinder Planer saehe nichts.
    await expect(befunde.filter({ hasText: 'Gesperrt' })).toHaveCount(1);
    await expect(befunde.filter({ hasText: 'Warnung' })).toHaveCount(1);
  });

  test('(4) eine Warnung braucht eine Begruendung — eine Sperre hat kein Formular', async ({ page }) => {
    await anmelden(page);
    await page.goto('/portal/reinigung/dienstplan/konflikte');

    const sperre = page.locator(`[data-cse="konflikt"][data-konflikt="${sperrKonflikt}"]`);
    const warnung = page.locator(`[data-cse="konflikt"][data-konflikt="${warnKonflikt}"]`);
    await expect(sperre).toBeVisible();
    await expect(warnung).toBeVisible();

    // § 34a GewO kennt keinen Uebergehen-Knopf.
    await expect(sperre.locator('form')).toHaveCount(0);
    await expect(sperre).toContainText('Nicht quittierbar');

    // Die Warnung hat eins — und das Feld ist Pflicht.
    const feld = warnung.locator('input[name="begruendung"]');
    await expect(feld).toHaveAttribute('required', '');
    await expect(feld).toHaveAttribute('minlength', '10');

    await feld.fill('Ersatz kurzfristig ausgefallen, Kunde verlangt Besetzung.');
    await warnung.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    // Quittiert heisst: verschwunden aus dem Eingang, aber nicht geloescht.
    await expect(page.locator(`[data-cse="konflikt"][data-konflikt="${warnKonflikt}"]`))
      .toHaveCount(0);
    /**
     * **Verschwunden ist nicht dasselbe wie quittiert.**
     *
     * Der Eingang zeigt `status = 'offen' and hinfaellig_am is null`
     * (`konflikte/page.tsx:136`). Eine Karte faellt also aus ihm heraus, wenn
     * sie quittiert wurde ODER wenn sie hinfaellig wurde — und seit es fuer
     * `hinfaellig_am` einen Schreiber gibt, ist der zweite Weg kein
     * theoretischer mehr.
     *
     * Genau so ist diese Pruefung einmal gefallen: die Karte war weg, der
     * Status stand auf `offen`, und die Meldung lautete `Received: "offen"` —
     * ohne ein Wort darueber, dass die Karte ueberholt worden war. Die
     * Abfrage liest `hinfaellig_am` jetzt mit und sagt es.
     */
    const [z] = await sql.unsafe<
      { status: string; grund: string | null; hinfaellig: Date | null }[]
    >(
      `select status::text as status, quittierung_begruendung as grund,
              hinfaellig_am as hinfaellig
         from planungs_konflikt where id = $1`, [warnKonflikt]);
    expect(
      z!.hinfaellig,
      'die Karte wurde ueberholt, nicht quittiert — ein anderer Lauf hat sie '
      + 'hinfaellig gesetzt, bevor diese Pruefung ihre Begruendung abgab',
    ).toBeNull();
    expect(z!.status).toBe('quittiert');
    expect(z!.grund).toContain('Ersatz kurzfristig');
  });

  test('(4) ohne Begruendung passiert nichts', async ({ page }) => {
    await anmelden(page);
    /**
     * Direkt gegen den Schreibweg — die Oberflaeche laesst es gar nicht zu,
     * und genau deshalb muss der Weg selbst es auch abweisen.
     *
     * `page.request` und nicht die `request`-Fixtur: die hat ihren eigenen
     * Keksbehaelter und waere nicht angemeldet. Der Test haette dann 401
     * gemessen und die Pruefung der Begruendung nie erreicht — bestanden
     * haette er trotzdem ausgesehen.
     */
    const antwort = await page.request.post('/api/konflikt', {
      form: { konflikt: sperrKonflikt, begruendung: 'zu kurz', mandant: 'reinigung' },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(antwort.status()).toBe(400);
    expect(await antwort.json()).toMatchObject({ fehler: 'begruendung_zu_kurz' });
  });
});
