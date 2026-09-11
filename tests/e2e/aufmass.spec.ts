/**
 * Das Aufmass im Browser — die Abnahmekriterien von PR 43, die NUR dort zu
 * pruefen sind (BAU-01, BAU-02, BAU-03).
 *
 * Drei Zusagen betreffen die Oberflaeche und nicht die Datenbank:
 *
 * (1) **Formel und Ergebnis stehen nebeneinander.** Der Rechenansatz
 *     `3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)` steht woertlich auf dem
 *     Bildschirm, und daneben `30,87 m²`. Ein Blatt, das nur die Zahl zeigt,
 *     nimmt dem Pruefer genau das, wofuer BAU-02 beides speichert.
 * (2) **Ein fremdes Zeichen wird mit der STELLE zurueckgewiesen.** „Ungueltig"
 *     schickt den Polier auf die Suche; „Zeichen 13" zeigt auf das `%`.
 * (4) **`1.2.10` steht im LV-Baum hinter `1.2.9`**, und die Σ je Titel und je
 *     Los steht in der Tabelle — nicht nur in einem Dienst.
 * (3) **Ohne Messfoto erscheint kein Gegenzeichnen-Knopf**, sondern der Satz,
 *     was fehlt. Ein Knopf, der in einen Datenbankfehler laeuft, ist eine
 *     Zusage, die die Oberflaeche nicht halten kann.
 *
 * **Diese Datei wird in PR 43 NICHT ausgefuehrt** (Auftrag: Spezifikation
 * schreiben genuegt) — sie ist gegen dieselben Daten geschrieben wie die
 * Isolationspruefungen und laeuft, sobald die Browsersuite fuer Phase 5
 * insgesamt laeuft.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';
import postgres from 'postgres';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/** Die Formel aus SPEC §8 — das Beispiel, an dem dieser PR gemessen wird. */
const FORMEL = '3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)';
const ERGEBNIS = '30,87';

/**
 * Auftrag, Projekt und LV sind FEST benannt und werden wiederverwendet.
 *
 * Hier stand `String(Date.now()).slice(-6)` — „jeder Lauf legt eigene
 * Stammdaten an". Die letzten sechs Stellen einer Millisekundenuhr wiederholen
 * sich aber alle 1000 Sekunden, und weil `auftrag` die Loeschsperre traegt
 * (Invariante 8), bleibt der Auftrag des ersten Laufs stehen. Playwright
 * verwirft nach einem Fehlschlag den Worker; der naechste fuehrt `beforeAll`
 * erneut aus — und der zweite `insert` starb an `auftrag_nummer_uk`. Der
 * Fehlschlag sah aus wie ein kaputtes Aufmass und war eine Fixtur, die sich
 * selbst im Weg stand.
 *
 * Statt einer unwahrscheinlichen Kennung jetzt eine, die es nur EINMAL geben
 * kann: `on conflict do nothing` und Nachlesen. Das haelt auch, wenn zwei
 * Worker (`fullyParallel`) dieselbe Datei gleichzeitig aufbauen — der zweite
 * wartet auf den ersten und liest dann dessen Zeile.
 */
const AUFTRAG_NR = 'AU-E2E-AUFMASS';
const PROJEKT_NR = 'P-E2E-AUFMASS';

/**
 * Die BLAETTER dagegen entstehen je Lauf neu — und das ist kein Widerspruch,
 * sondern die Bedingung von (3): das Blatt mit Foto wird gegengezeichnet und
 * ist danach eingefroren (`trg_aufmass_3_einfrieren`). Ein wiederverwendetes
 * Blatt haette beim zweiten Versuch kein Gegenzeichnen-Formular mehr, und die
 * Pruefung wuerde etwas anderes pruefen als beim ersten.
 *
 * Die Nummer traegt deshalb eine ganze UUID und nicht sechs Stellen einer Uhr
 * — und `aufmass_nummer_uk` laeuft ueber `(projekt_id, nummer)`, das Blatt
 * bleibt also auch im wiederverwendeten Projekt eindeutig.
 */
const LAUF = crypto.randomUUID();

let mandantSlug = '';
let projektId = '';
let aufmassOhneFoto = '';
let aufmassMitFoto = '';
let lvId = '';

/**
 * **Die Administration des BAUS, nicht die der Reinigung.**
 *
 * Hier stand `[data-rolle="admin"]`.first(). Das einzige `admin`-Konto des
 * Seeds gehoert `reinigung`; diese Datei legt ihre Daten aber in `bau` an.
 * Die Sitzung trug damit `aktiverMandantId = reinigung`, die URL den Slug
 * `bau`, und die Slug-Wache antwortete 404 — richtig so (AUT-06, §4.5), nur
 * sah der Fehlschlag aus wie ein kaputtes Aufmassblatt. Und die Σ-Zusicherung
 * braucht `bau.preis_lesen`, das laut Rechtematrix nur `admin` haelt.
 */
async function anmelden(page: Page): Promise<void> {
  await alsKonto(page, KONTO.adminBau);
}

/**
 * **Der Verantwortliche muss ein MITGLIED von `bau` sein.**
 *
 * `(select id from benutzer limit 1)` griff irgendein Konto heraus — und
 * `kern.auftrag_verantwortlich_im_mandant` wies es zurueck, sobald das erste
 * Konto im Seed zu einer anderen Gesellschaft gehoerte. Der Fehler sah aus
 * wie ein kaputtes Aufmass und war eine kaputte Fixtur. Die Auswahl hier
 * stellt dieselbe Frage wie `app.ist_mitglied` und bekommt deshalb dieselbe
 * Antwort.
 */
test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string; slug: string }[]>(
    `select id, slug from mandant where slug = 'bau'`);
  mandantSlug = m!.slug;

  const [k] = await sql.unsafe<{ id: string }[]>(
    `select id from kunde where mandant_id = $1 limit 1`, [m!.id]);

  /**
   * Legt die Zeile an — oder liest die, die schon dasteht. Ein `insert` mit
   * `on conflict do nothing` gibt nichts zurueck, wenn er nichts eingefuegt
   * hat; genau dann greift die Leseabfrage.
   */
  const einmalig = async (
    einfuegen: string, werte: readonly unknown[],
    lesen: string, leseWerte: readonly unknown[],
  ): Promise<string> => {
    const [neu] = await sql.unsafe<{ id: string }[]>(einfuegen, werte as never[]);
    if (neu !== undefined) return neu.id;
    const [da] = await sql.unsafe<{ id: string }[]>(lesen, leseWerte as never[]);
    return da!.id;
  };

  const auftragId = await einmalig(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     select $1, $3, $2, 'projekt', 'aktiv', 'Rohbau Ost',
            (select bm.benutzer_id from benutzer_mandant bm
              where bm.mandant_id = $1
                and bm.entzogen_am is null
                and bm.gueltig_ab <= current_date
                and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
              limit 1),
            '2026-01-01'
     on conflict do nothing
     returning id`,
    [m!.id, k!.id, AUFTRAG_NR],
    `select id from auftrag where mandant_id = $1 and auftragsnummer = $2`,
    [m!.id, AUFTRAG_NR]);

  projektId = await einmalig(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage)
     values ($1,$2,$4,'Rohbau Ost',$3,'hochbau','vob_b')
     on conflict do nothing returning id`,
    [m!.id, auftragId, k!.id, PROJEKT_NR],
    `select id from projekt where mandant_id = $1 and nummer = $2`,
    [m!.id, PROJEKT_NR]);

  lvId = await einmalig(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Rohbau Ost')
     on conflict do nothing returning id`,
    [m!.id, projektId],
    `select id from leistungsverzeichnis where projekt_id = $1 and art = 'hauptauftrag'
      order by fassung limit 1`,
    [projektId]);

  /**
   * Die OZ-Probe: `1.2.9`, `1.2.10` und `1.2.100` unter einem Titel. Eine
   * Textsortierung stellte `1.2.10` VOR `1.2.9` — in einem LV mit
   * vierhundert Zeilen faellt das niemandem auf.
   */
  const titelId = await einmalig(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, oz, pfad,
                              sortier_pfad, ebene, art, kurztext)
     values ($1,$2,$3,'1.2','','',1,'titel','Mauerarbeiten')
     on conflict do nothing returning id`,
    [m!.id, lvId, projektId],
    `select id from lv_position where leistungsverzeichnis_id = $1 and oz = '1.2'`,
    [lvId]);
  for (const [oz, menge, preis] of [
    ['1.2.9', '3.333', 1299], ['1.2.10', '17.500', 2450], ['1.2.100', '0.125', 99],
  ] as const) {
    /**
     * `on conflict do nothing` und nicht `do update`: die drei Positionen
     * sind ueber `lv_position_oz_uk` eindeutig, und die Zeile eines frueheren
     * Laufs traegt dieselben Werte. Ein zweites Einfuegen haette die Σ des
     * Titels verdoppelt — die Pruefung darunter rechnet auf den Cent.
     */
    await sql.unsafe(
      `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, eltern_id,
                                oz, pfad, sortier_pfad, ebene, art, kurztext, einheit,
                                menge_vertrag, einheitspreis_cent)
       values ($1,$2,$3,$4,$5,'','',2,'position','Mauerwerk','m²',$6::numeric,$7::bigint)
       on conflict do nothing`,
      [m!.id, lvId, projektId, titelId, oz, menge, preis] as never[]);
  }

  const [pos] = await sql.unsafe<{ id: string }[]>(
    `select id from lv_position where leistungsverzeichnis_id = $1 and oz = '1.2.9'`, [lvId]);

  const blatt = async (nummer: string): Promise<string> => {
    const [b] = await sql.unsafe<{ id: string }[]>(
      `insert into aufmass (mandant_id, projekt_id, kunde_id, nummer, bezeichnung, messdatum,
                            erhebungsart, leistungsverzeichnis_id)
       values ($1,$2,$3,$4,'Wand Achse C, OG1','2026-09-10','gemeinsam',$5) returning id`,
      [m!.id, projektId, k!.id, nummer, lvId] as never[]);
    await sql.unsafe(
      `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id, lv_position_id,
                                  reihenfolge, bezeichnung, rechenansatz, ergebnis_skaliert,
                                  menge, einheit)
       values ($1,$2,$3,$3,$4,1,'Wand Achse C',$5,308700,30.870,'m²')`,
      [m!.id, b!.id, projektId, pos!.id, FORMEL] as never[]);
    return b!.id;
  };

  aufmassOhneFoto = await blatt(`A-${LAUF}-1`);
  aufmassMitFoto = await blatt(`A-${LAUF}-2`);

  // Das Messfoto des zweiten Blattes — ohne es gibt es keine Gegenzeichnung.
  const [medium] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad,
                                 mime_typ, groesse_bytes, sha256, erstellt_von_art)
     values ($1,'aufmass',$2,'foto','einsatz-medien',$3,'image/jpeg',12345,repeat('a',64),
             'system')
     returning id`,
    [m!.id, aufmassMitFoto, `${m!.id}/${crypto.randomUUID()}`] as never[]);
  await sql.unsafe(
    `insert into aufmass_foto (mandant_id, aufmass_id, kunde_id, medien_id, zweck,
                               erstellt_von_art)
     values ($1,$2,$3,$4,'nachweis','system')`,
    [m!.id, aufmassMitFoto, k!.id, medium!.id] as never[]);
});

// Kein `sql.end()`: der Pool lebt je Worker-PROZESS, `afterAll` laeuft beim
// Verlassen der Datei. Nimmt derselbe Worker sie spaeter wieder auf, ist das
// Modul geladen und der Pool tot — jede Abfrage stirbt dann mit
// `CONNECTION_ENDED`, bevor sie den Server sieht.

test.describe('(1) Formel und Ergebnis stehen nebeneinander', () => {
  test('das Blatt zeigt den Rechenansatz wörtlich und 30,87 m² daneben', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/${aufmassMitFoto}`);

    const zeile = page.locator('[data-cse="aufmass-zeile"]').first();
    await expect(zeile.locator('[data-cse="rechenansatz"]')).toHaveText(FORMEL);
    await expect(zeile.locator('[data-cse="ergebnis"]')).toContainText(`${ERGEBNIS} m²`);
    // Und die ganze Zahl steht am Element — sie ist der gespeicherte Wert.
    await expect(zeile.locator('[data-cse="ergebnis"]'))
      .toHaveAttribute('data-skaliert', '308700');
  });

  test('und das Probefeld rechnet auf dem SERVER, während man tippt', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/neu`);
    await page.locator('input[name="probe"]').fill(FORMEL);
    await page.locator('input[name="einheit"]').fill('m²');
    await page.getByRole('button', { name: 'Berechnen' }).click();

    const ergebnis = page.locator('[data-cse="probe-ergebnis"]');
    await expect(ergebnis).toContainText(FORMEL);
    await expect(ergebnis).toContainText(`${ERGEBNIS} m²`);
  });
});

test.describe('(2) ein fremdes Zeichen wird mit der Stelle zurückgewiesen', () => {
  test('„4,20 × 2,75 % 3" nennt Zeichen 13 und rechnet nicht', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/neu`);
    await page.locator('input[name="probe"]').fill('4,20 × 2,75 % 3');
    await page.getByRole('button', { name: 'Berechnen' }).click();

    const fehler = page.locator('[data-cse="probe-fehler"]');
    // Der Offset zaehlt ab 0, die Anzeige ab 1 — der Mensch zaehlt ab 1.
    await expect(fehler).toContainText('Zeichen 13');
    await expect(page.locator('[data-cse="probe-ergebnis"]')).toHaveCount(0);
  });

  test('und eine halbe Formel ist ein Hinweis, kein Absturz', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/neu`);
    await page.locator('input[name="probe"]').fill('3 × (4,20');
    await page.getByRole('button', { name: 'Berechnen' }).click();
    await expect(page.locator('[data-cse="probe-fehler"]')).toBeVisible();
  });
});

test.describe('(4) die OZ-Ordnung und die Summen im Baum', () => {
  test('1.2.10 steht hinter 1.2.9 — sichtbar, in dieser Reihenfolge', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/lv`);

    const ozs = await page.locator('[data-cse="lv-zeile"]').evaluateAll(
      (zeilen) => zeilen.map((z) => z.getAttribute('data-oz')));
    expect(ozs).toEqual(['1.2', '1.2.9', '1.2.10', '1.2.100']);
  });

  test('und die Σ des Titels ist die Summe seiner Positionen — auf den Cent', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/lv`);

    // 3,333 × 12,99 € = 43,30 € · 17,500 × 24,50 € = 428,75 € · 0,125 × 0,99 € = 0,12 €
    const titel = page.locator('[data-cse="lv-zeile"][data-oz="1.2"]');
    await expect(titel.locator('[data-cse="lv-teilsumme"]')).toContainText('472,17');
    await expect(page.locator('[data-cse="lv-summe"]')).toContainText('472,17');
  });
});

test.describe('(3) ohne Messfoto keine Gegenzeichnung', () => {
  test('das Blatt ohne Foto zeigt den Grund statt eines Knopfes', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/${aufmassOhneFoto}`);

    await expect(page.locator('[data-cse="hindernisse"]')).toContainText('Messfoto');
    await expect(page.locator('[data-cse="gegenzeichnung"]')).toHaveCount(0);
  });

  test('mit Foto lässt es sich gegenzeichnen — und ist danach unveränderlich', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${mandantSlug}/bau/projekte/${projektId}/aufmass/${aufmassMitFoto}`);

    const formular = page.locator('[data-cse="gegenzeichnung"]');
    await expect(formular).toBeVisible();
    await formular.locator('input[name="unterzeichner_name"]').fill('Frau Beyer');
    await formular.locator('input[name="unterzeichner_funktion"]').fill('Bauleiterin AG');
    await page.getByRole('button', { name: 'Gegenzeichnen' }).click();
    await page.waitForLoadState('networkidle');

    // Die Unterschrift steht mit ihrem Digest da …
    await expect(page.locator('[data-cse="signatur"]')).toContainText('Frau Beyer');
    await expect(page.locator('[data-cse="signatur"]')).toContainText('SHA-256');
    // … und das Formular ist weg: ab hier ist das Blatt eingefroren.
    await expect(page.locator('[data-cse="gegenzeichnung"]')).toHaveCount(0);
  });
});
