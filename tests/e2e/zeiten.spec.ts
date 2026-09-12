/**
 * Der Zeitbereich im Browser — was nur dort zu prüfen ist.
 *
 * Die Rechnung selbst steht in der Datenbank und in den Diensten und ist dort
 * geprüft. Hier wird die andere Hälfte geprüft: dass die Zahl, die jemand auf
 * dem Bildschirm liest, DIESELBE ist.
 *
 * (1) Eine Nachtschicht steht mit `+1` da und liest ihre Netto-Dauer — 22:00
 *     bis 06:00 mit 30 Minuten Pause sind `7,50 h`.
 * (2) Dieselbe Wanduhrschicht in den beiden Umstellungsnächten liest `6,50 h`
 *     und `8,50 h` (K-11) — der Abstand zweier Instants, nicht die Differenz
 *     zweier Uhrzeiten.
 * (3) Ein laufender Eintrag steht auf dem Live-Brett und hat keine
 *     Netto-Dauer.
 * (4) Die Einzelansicht zeigt Serverzeit UND Gerätezeit mit der Abweichung.
 * (5) Der Filter „ohne Auftrag" zeigt genau die Einträge ohne Leistungsbezug.
 * (6) Die MiLoG-Aufzeichnung nennt dieselbe Summe wie ihre Gegenprobe.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/**
 * Ein Monat weit genug in der Zukunft, damit keine andere Zeile hineinfällt —
 * und ein anderer als der des Dienstplan-Tests, damit sich die beiden nicht
 * gegenseitig zählen.
 */
const TAG = '2029-05-07';             // ein Montag
const NACHT = '2029-05-11';           // Freitag auf Samstag
const NACHT_VOR = '2029-03-24';       // Umstellung in der Nacht auf den 25.03.2029
const NACHT_ZURUECK = '2029-10-27';   // Umstellung in der Nacht auf den 28.10.2029

let mandantId = '';
let anstellungId = '';
let personId = '';
let objektId = '';
let leistungId: string | null = null;
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
 * Ein Zeiteintrag von Hand.
 *
 * **`quelle = 'import'` und nicht `server_uhr`**: `kern.stempel_feldzeit()`
 * überschreibt einen Beginn mit `now()`, sobald die Quelle die Serveruhr ist
 * (Invariante 5, und richtig so). Eine Fixtur, die einen Tag in der Zukunft
 * setzen will, sagt deshalb, was sie ist — ein Import.
 *
 * Die Zeitpunkte kommen aus `app.loese_ortszeit`: die Wanduhrzeit 22:00 ist in
 * den drei Nächten drei verschiedene Instants, und genau das ist der Fall, den
 * dieser Test prüft. Sie hier in TypeScript zu rechnen hiesse, die Prüfung
 * gegen die eigene Rechnung laufen zu lassen.
 */
async function eintrag(opts: {
  readonly schluessel: string;
  readonly datum: string;
  readonly von: string;
  readonly bis: string | null;
  readonly folgetag: boolean;
  readonly pause: number;
  readonly mitAuftrag: boolean;
  readonly geraeteVersatzSek?: number;
  readonly nacherfasst?: boolean;
}): Promise<string> {
  const [da] = await sql.unsafe<{ id: string }[]>(
    `select id from zeiteintrag where mandant_id = $1 and notiz = $2`,
    [mandantId, opts.schluessel]);
  if (da !== undefined) return da.id;

  const [z] = await sql.unsafe<{ id: string }[]>(
    `with anfang as (select zeitpunkt from app.loese_ortszeit($2::date, $3::time, 'Europe/Berlin')),
          ende as (
            select case when $4::time is null then null
                   else (select zeitpunkt from app.loese_ortszeit(
                           ($2::date + case when $5 then 1 else 0 end),
                           $4::time, 'Europe/Berlin'))
                   end as zeitpunkt)
     insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, objekt_id, auftrag_leistung_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, quelle_beginn,
        erfassungsart_ende, quelle_ende,
        geraete_zeit_beginn, nacherfasst, behauptet_beginn,
        status, notiz, erstellt_von_art)
     select $1, $6, $7, $8, $9,
            anfang.zeitpunkt, ende.zeitpunkt, $10,
            'import', 'import',
            case when ende.zeitpunkt is null then null else 'import' end::erfassungs_art,
            case when ende.zeitpunkt is null then null else 'import' end::zeitquelle,
            case when $11::int is null then null
                 else anfang.zeitpunkt + make_interval(secs => $11::int) end,
            $12,
            case when $12 then anfang.zeitpunkt else null end,
            case when ende.zeitpunkt is null then 'laufend' else 'abgeschlossen' end::zeiteintrag_status,
            $13, 'system'
       from anfang, ende
     returning id`,
    [
      mandantId, opts.datum, opts.von, opts.bis, opts.folgetag,
      anstellungId, personId, objektId, opts.mitAuftrag ? leistungId : null,
      opts.pause, opts.geraeteVersatzSek ?? null, opts.nacherfasst ?? false,
      opts.schluessel,
    ]);
  return z!.id;
}

test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `select id from mandant where slug = 'reinigung' limit 1`);
  mandantId = m!.id;
  const [a] = await sql.unsafe<{ id: string; person_id: string }[]>(
    `select id, person_id from anstellung where mandant_id = $1 and geloescht_am is null
      order by personalnummer limit 1`, [mandantId]);
  anstellungId = a!.id;
  personId = a!.person_id;
  const [o] = await sql.unsafe<{ id: string }[]>(
    `select id from objekt where mandant_id = $1 and kunde_id is not null
      order by objektnummer limit 1`, [mandantId]);
  objektId = o!.id;
  const [l] = await sql.unsafe<{ id: string }[]>(
    `select al.id from auftrag_leistung al
       join auftrag auf on auf.mandant_id = al.mandant_id and auf.id = al.auftrag_id
      where al.mandant_id = $1 order by auf.auftragsnummer, al.position_nr limit 1`,
    [mandantId]);
  leistungId = l?.id ?? null;

  ids['tag'] = await eintrag({
    schluessel: 'e2e:zeit:tag', datum: TAG, von: '06:00', bis: '10:00',
    folgetag: false, pause: 0, mitAuftrag: true, geraeteVersatzSek: -7200,
  });
  ids['nacht'] = await eintrag({
    schluessel: 'e2e:zeit:nacht', datum: NACHT, von: '22:00', bis: '06:00',
    folgetag: true, pause: 30, mitAuftrag: true,
  });
  ids['ohne'] = await eintrag({
    schluessel: 'e2e:zeit:ohne-auftrag', datum: TAG, von: '14:00', bis: '16:00',
    folgetag: false, pause: 0, mitAuftrag: false,
  });
  ids['vor'] = await eintrag({
    schluessel: 'e2e:zeit:umstellung-vor', datum: NACHT_VOR, von: '22:00', bis: '06:00',
    folgetag: true, pause: 30, mitAuftrag: true,
  });
  ids['zurueck'] = await eintrag({
    schluessel: 'e2e:zeit:umstellung-zurueck', datum: NACHT_ZURUECK,
    von: '22:00', bis: '06:00', folgetag: true, pause: 30, mitAuftrag: true,
  });
});

test.afterAll(() => {
  /**
   * Kein DELETE: `zeiteintrag` trägt die Löschsperre (Invariante 8). Die
   * Zeilen bleiben stehen; sie stören nicht, weil sie 2029 liegen und jeder
   * Schlüssel in `notiz` steht.
   *
   * Und kein `sql.end()` — siehe `dienstplan.spec.ts`.
   */
});

test.describe('Zeiten — Wochenliste', () => {
  test('(1) eine Nachtschicht steht mit +1 und liest ihre Netto-Dauer', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/zeiten?woche=${NACHT}`);

    /**
     * **`[data-cse="tabelle"]` davor, und das ist die Aussage.**
     *
     * `DataTable` gibt JEDE Zeile zweimal aus: als `<table>` fuer den
     * Schreibtisch und als Kartenstapel fuer das Telefon; eine Medienabfrage
     * zeigt je eine. Playwrights strikter Modus zaehlt aber TREFFER, nicht
     * sichtbare Treffer — der Locator fand zwei und warf, bevor
     * `toBeVisible()` ueberhaupt filtern konnte. Die Seite ist in Ordnung;
     * die Pruefung fasste ein Merkmal an, das die Seite per Entwurf zweimal
     * traegt.
     *
     * `toHaveCount(1)` spricht die Einzigkeit aus, statt sie mit `.first()`
     * zu verschweigen.
     */
    const zeile = page.locator(
      `[data-cse="tabelle"] [data-zeiteintrag="${ids['nacht'] ?? ''}"]`);
    await expect(zeile).toHaveCount(1);
    await expect(zeile).toBeVisible();

    /**
     * Die Zeile der Tabelle, in der der Eintrag steht.
     *
     * **Der `has`-Locator zaehlt AB DER ZEILE, nicht ab der Seite.** Hier
     * stand `page.locator('tr', { has: zeile })` — und `zeile` beginnt mit
     * `[data-cse="tabelle"]`. Playwright wertet den inneren Locator relativ
     * zum aeusseren aus, gesucht wurde also ein `tr`, das seinerseits eine
     * Tabelle enthaelt, die den Eintrag enthaelt. Die Tabelle ist aber der
     * VORFAHR der Zeile. Kein Treffer — und der Fehlschlag las sich wie eine
     * fehlende Zeile, obwohl `zeile` zwei Zeilen darueber gerade mit
     * `toHaveCount(1)` bestaetigt hatte, dass sie dasteht.
     *
     * Das Tabellen-Rendering wird jetzt am AEUSSEREN Locator festgelegt; der
     * Filter fragt nur noch nach dem, was wirklich in der Zeile steht.
     */
    const reihe = page.locator('[data-cse="tabelle"] tr')
      .filter({ has: page.locator(`[data-zeiteintrag="${ids['nacht'] ?? ''}"]`) });
    await expect(reihe).toContainText('22:00');
    await expect(reihe).toContainText('06:00');
    // Der Tageswechsel steht DA — sonst läse 22:00 – 06:00 wie sechzehn
    // Stunden rückwärts.
    await expect(reihe).toContainText('+1');
    // 480 Minuten brutto minus 30 Minuten Pause.
    await expect(reihe).toContainText('7,50 h');
  });

  test('(2) die beiden Umstellungsnächte lesen 6,50 h und 8,50 h', async ({ page }) => {
    await anmelden(page);

    /**
     * Derselbe Fehlgriff wie in (1): `[data-cse="tabelle"]` stand INNEN, im
     * `has`, und wurde damit unterhalb des `tr` gesucht — also unterhalb
     * seines eigenen Vorfahren. Das Rendering gehoert nach AUSSEN, an den
     * Zeilen-Locator.
     */
    await page.goto(`/portal/reinigung/zeiten?woche=${NACHT_VOR}`);
    const vor = page.locator('[data-cse="tabelle"] tr')
      .filter({ has: page.locator(`[data-zeiteintrag="${ids['vor'] ?? ''}"]`) });
    await expect(vor).toContainText('6,50 h');

    await page.goto(`/portal/reinigung/zeiten?woche=${NACHT_ZURUECK}`);
    const zurueck = page.locator('[data-cse="tabelle"] tr')
      .filter({ has: page.locator(`[data-zeiteintrag="${ids['zurueck'] ?? ''}"]`) });
    await expect(zurueck).toContainText('8,50 h');
  });

  test('(5) der Filter „ohne Auftrag" zeigt den Eintrag ohne Leistungsbezug', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/zeiten?woche=${TAG}&merkmal=ohne_auftrag`);

    const ohne = page.locator(
      `[data-cse="tabelle"] [data-zeiteintrag="${ids['ohne'] ?? ''}"]`);
    await expect(ohne).toHaveCount(1);
    await expect(ohne).toBeVisible();
    /**
     * Diese Zusicherung bleibt UNEINGESCHRAENKT: „in keinem der beiden
     * Renderings" ist staerker als „nicht in der Tabelle". Ein gefilterter
     * Eintrag, der nur aus der Tabelle verschwindet und in der Telefonkarte
     * stehen bleibt, waere genau der Fehler, den sie fangen soll.
     */
    await expect(page.locator(`[data-zeiteintrag="${ids['tag'] ?? ''}"]`)).toHaveCount(0);
  });

  test('die Kennzahlen zählen genau die Zeilen darunter (DSH-04)', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/zeiten?woche=${TAG}`);

    // Auch hier: EIN Rendering zaehlen, sonst ist jede Zahl verdoppelt.
    const zeilen = await page
      .locator('[data-cse="tabelle"] [data-cse="zeiteintrag"]').count();
    const kachel = page.locator('[data-cse="kpi-wert"]').first();
    await expect(kachel).toHaveText(String(zeilen));
  });
});

test.describe('Zeiten — Einzelansicht', () => {
  test('(4) Serverzeit, Gerätezeit und die Abweichung stehen nebeneinander',
    async ({ page }) => {
      await anmelden(page);
      await page.goto(`/portal/reinigung/zeiten/${ids['tag'] ?? ''}`);

      await expect(page.getByText('Beginn (Serveruhr)')).toBeVisible();
      await expect(page.getByText('Gerätezeit Beginn')).toBeVisible();
      /*
       * Das Gerät ging zwei Stunden NACH, und der Kommentar hier sagte das
       * Gegenteil — genauso wie der Code, den diese Prüfung misst. Beide waren
       * gleich falsch, also war sie grün.
       *
       * Die Fixtur setzt `geraete_zeit_beginn = beginn_zeitpunkt - 2h`. Die
       * Abweichung ist GERÄT MINUS SERVER (0034:503), also -7200 — und ein
       * Gerät, dessen Uhr hinter der Serveruhr liegt, geht NACH. D-134 sagt es
       * wörtlich: „ein nachgehendes Telefon ergibt eine negative Abweichung".
       */
      await expect(page.getByText('-7200 s')).toBeVisible();
      await expect(page.getByText('Gerät ging nach')).toBeVisible();
    });

  test('ohne Korrektur sagt die Spur genau das', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/zeiten/${ids['nacht'] ?? ''}`);
    await expect(page.getByRole('heading', { name: 'Korrekturspur' })).toBeVisible();
    await expect(page.getByText('Keine Korrektur')).toBeVisible();
  });

  test('ein unbekannter Eintrag ist 404 und nicht 403', async ({ page }) => {
    await anmelden(page);
    const antwort = await page.goto(
      '/portal/reinigung/zeiten/00000000-0000-4000-8000-000000000000');
    expect(antwort?.status()).toBe(404);
  });
});

test.describe('Zeiten — Live-Brett', () => {
  test('(3) ein laufender Eintrag steht auf dem Brett, ohne Netto-Dauer', async ({ page }) => {
    // Der laufende Eintrag entsteht ERST HIER und liegt in der Gegenwart:
    // `zeiteintrag_offen` fragt nicht nach dem Datum, aber die Wochenliste
    // täte es, und ein offener Eintrag von 2029 stünde dort in jeder Woche.
    const [heute] = await sql.unsafe<{ tag: string }[]>(
      `select to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD') as tag`);

    /**
     * **Erst den offenen Eintrag schliessen, den der Seed schon angelegt hat.**
     *
     * `z_offen_uk` laesst je Beschaeftigung GENAU EINEN offenen Eintrag zu —
     * das ist die Zusicherung, wegen der es den Index gibt. Der Seed legt
     * selbst einen laufenden an („1 laufend"), und zwar fuer dieselbe
     * Beschaeftigung, die dieser Test benutzt. Der Einschub hier scheiterte
     * deshalb mit `duplicate key value violates unique constraint
     * "z_offen_uk"` — ein Fehlschlag, der nach einem Produktfehler aussieht
     * und die eigene Fixtur meint.
     *
     * Geschlossen wird, nicht geloescht (Invariante 8): der Eintrag bleibt
     * mit Ende stehen, wie ein Feierabend ihn hinterliesse. Danach ist der
     * einzige offene Eintrag der, den dieser Test gleich anlegt — und genau
     * das will er messen.
     */
    await sql.unsafe(
      `update zeiteintrag
          set ende_zeitpunkt = now(), status = 'abgeschlossen',
              erfassungsart_ende = 'import', quelle_ende = 'import'
        where anstellung_id = $1 and status = 'laufend'`,
      [anstellungId],
    );
    const laufend = await eintrag({
      schluessel: 'e2e:zeit:laufend', datum: heute!.tag, von: '00:30', bis: null,
      folgetag: false, pause: 0, mitAuftrag: false,
    });

    await anmelden(page);
    await page.goto('/portal/reinigung/zeiten/live');

    const karte = page.locator(`[data-cse="laufend"][data-zeiteintrag="${laufend}"]`);
    await expect(karte).toBeVisible();
    await expect(karte).toContainText('seit');
    /**
     * Die Standzeile, nicht irgendein Absatz mit dem Wort „Stand" darin.
     *
     * `getByText('Stand')` traf auch den Erklaersatz „Die Dauer ist der
     * Abstand zweier Zeitpunkte …" — im strikten Modus zwei Treffer. Das
     * Brett ist eine LIVE-Ansicht; dass sie ihren Stand nennt, ist ihre
     * wichtigste Zusicherung, und deshalb wird hier der Zeitpunkt gepruft
     * und nicht das Wort.
     */
    await expect(page.getByText(/^Stand \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/u)).toBeVisible();
  });
});

test.describe('Zeiten — § 17 MiLoG', () => {
  test('(6) die Aufzeichnung und ihre Gegenprobe nennen dieselbe Summe', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/reinigung/zeiten/milog?monat=${TAG}`);

    const knopf = page.locator(`[data-anstellung="${anstellungId}"]`);
    await expect(knopf).toBeVisible();
    await knopf.click();

    await expect(page.locator('[data-cse="nachweis"]')).toBeVisible();
    await expect(page.getByText('Gegenprobe stimmt')).toBeVisible();
    // Der Tageseintrag (4,00 h) und der ohne Auftrag (2,00 h) liegen beide im
    // Mai 2029; die Nachtschicht kommt dazu.
    await expect(page.locator('[data-cse="nachweis"]')).toContainText('4,00 h');
  });
});
