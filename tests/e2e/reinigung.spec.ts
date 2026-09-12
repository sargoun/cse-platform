/**
 * PR 40 durch den Browser — Reviere, Leistungsnachweis, Unterschrift,
 * Reklamation (CLN-01, CLN-04, OPS-11).
 *
 * **Diese Spezifikation läuft NICHT in der Entwicklungsdatenbank dieses PRs.**
 * Sie braucht einen Build und die gemeinsame Seed-Datenbank; sie steht hier
 * als das, was der Browser nachweisen soll, und wird im gemeinsamen Lauf
 * ausgeführt.
 *
 * Was sie prüft, prüft kein Unit- und kein Isolationstest:
 *
 *  - Die **Prüfsumme** steht wirklich im Formular, das der Kunde absendet.
 *    Der Dienst vergleicht sie serverseitig — aber nur, wenn die Seite sie
 *    mitschickt, und genau das kann nur der Browser zeigen.
 *  - Nach der Unterschrift zeigt das Blatt den **Abzug**, nicht die lebende
 *    Tabelle. Das ist der Unterschied, um den es in CLN-04 geht, und er ist an
 *    der gerenderten Seite sichtbar oder gar nicht.
 *  - Die Zuordnung eines Raums ist **nicht abwählbar**: das Häkchen steht
 *    gesetzt und gesperrt da, weil `revier_raum` unter Löschsperre steht.
 */
import { expect, test, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';
import postgres from 'postgres';

const MANDANT = 'reinigung';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/**
 * **Der Seed legt weder einen Leistungsnachweis noch eine Reklamation an.**
 *
 * Fünf Prüfungen liefen trotzdem auf ihnen: drei klickten den ersten Verweis
 * `LN-…` einer leeren Liste an — `.first().click()` wartet dann dreissig
 * Sekunden und fällt mit einem Zeitablauf um, der wie ein kaputter Bildschirm
 * aussieht. Zwei riefen davor `if (count === 0) test.skip()` auf und waren
 * damit schlimmer: sie meldeten GRÜN, ohne je eine Seite geöffnet zu haben.
 * Die Unterschrift samt Prüfsumme und Abzug — das eine Kriterium, das nur der
 * Browser zeigen kann — war seit PR 40 nie geprüft, und niemand hätte es
 * gemerkt.
 *
 * Deshalb legt die Datei ihre Fixtur jetzt selbst an, nach dem Muster von
 * `tests/e2e/aufmass.spec.ts`: eine `LAUF`-Kennung je Lauf, eigener
 * `postgres`-Zugriff, und die Seiten werden über ihre Kennung angesteuert
 * statt über „der erste Verweis in der Liste". Unter `fullyParallel` füllen
 * mehrere Arbeiter dieselbe Liste, und `.first()` griffe das Blatt eines
 * fremden Falles.
 *
 * Zwei Nachweise und nicht einer: das Unterschreiben friert das Blatt ein
 * (`trg_ln_signatur_2_signierbar` setzt `gesperrt_am`). Ein geteiltes Blatt
 * hätte für die beiden lesenden Prüfungen kein Unterschriftsformular mehr,
 * sobald die dritte zuerst fertig ist.
 */
/**
 * Die Kennung gehört dem ARBEITER, nicht dem Modulimport.
 *
 * `crypto.randomUUID()` beim Laden des Moduls sah richtig aus und war es
 * nicht: `beforeAll` lief in diesem Lauf ein zweites Mal mit DERSELBEN
 * Kennung — in der Datenbank stand genau EIN Satz Fixturen, und der zweite
 * Einfügeversuch brach an `ln_nummer_uk`. Ein Nachweis ist nicht löschbar
 * (Invariante 8), die Zeile des ersten Durchgangs bleibt also stehen.
 *
 * `TEST_PARALLEL_INDEX` setzt Playwright je Arbeiter. Damit ist die Kennung
 * zwischen gleichzeitigen Arbeitern VERSCHIEDEN — zwei dürfen nicht
 * denselben Nachweis unterschreiben, das Unterschreiben friert ihn ein — und
 * innerhalb eines Arbeiters GLEICH, sodass ein zweiter Durchgang dieselben
 * Zeilen wiederfindet, statt sie ein zweites Mal anzulegen.
 */
const LAUF = `w${process.env['TEST_PARALLEL_INDEX'] ?? '0'}`;

let nachweisLesend = '';
let nachweisZumUnterschreiben = '';
let reklamationBehoben = '';
let reklamationFrist = '';

test.beforeAll(async () => {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `select id from mandant where slug = 'reinigung'`);

  /**
   * Objekt, Kunde und Revier kommen aus dem Seed und werden NICHT angelegt:
   * `objekt` und `kunde` tragen Löschsperren, und eine zweite Garnitur je
   * Lauf bliebe für immer stehen. Das Revier ist der Anker, den CLN-04 für
   * die Kopfzeile des Blattes braucht.
   */
  const [ort] = await sql.unsafe<{
    objekt_id: string; kunde_id: string; revier_id: string;
  }[]>(
    `select o.id as objekt_id, o.kunde_id, r.id as revier_id
       from objekt o
       join revier r on r.objekt_id = o.id and r.mandant_id = o.mandant_id
      where o.mandant_id = $1 and o.kunde_id is not null
      order by o.bezeichnung, r.bezeichnung
      limit 1`, [m!.id]);

  /**
   * `erstellt_von_art = 'system'`: die Fixtur ist kein Mensch. `'mensch'`
   * verlangte nach `ln_akteur_stimmig` eine Benutzerkennung, und „irgendein
   * Konto" wäre wieder die Auswahl, an der `aufmass.spec.ts` schon einmal
   * hängengeblieben ist.
   */
  const nachweis = async (nummer: string): Promise<string> => {
    const [n] = await sql.unsafe<{ id: string }[]>(
      `insert into leistungsnachweis
         (mandant_id, nummer, objekt_id, revier_id, kunde_id,
          leistungszeitraum_von, leistungszeitraum_bis, status, vorgelegt_am,
          erstellt_von_art)
       values ($1, $2, $3, $4, $5, '2026-08-01', '2026-08-31', 'vorgelegt', now(),
               'system')
       on conflict (mandant_id, nummer) where nummer is not null do nothing
       returning id`,
      [m!.id, nummer, ort!.objekt_id, ort!.revier_id, ort!.kunde_id] as never[]);

    // Kam nichts zurueck, gibt es die Zeile schon — aus einem frueheren
    // Durchgang desselben Arbeiters. Dann wird sie WIEDERVERWENDET und nicht
    // ein zweites Mal angelegt; die Positionen unten haengen an derselben
    // Kennung und entstehen ebenfalls nur einmal.
    if (n === undefined) {
      const [vorhanden] = await sql.unsafe<{ id: string }[]>(
        'select id from leistungsnachweis where mandant_id = $1 and nummer = $2',
        [m!.id, nummer] as never[]);
      return vorhanden!.id;
    }

    // Zwei Zeilen, damit der Abzug nach der Unterschrift etwas zu zeigen hat.
    for (const [reihe, text, menge, einheit, preis] of [
      [1, 'Unterhaltsreinigung Bürogeschosse', '21.000', 'Durchgang', 4250],
      [2, 'Glasreinigung Foyer, innen', '1.000', 'Durchgang', 18900],
    ] as const) {
      await sql.unsafe(
        `insert into leistungsnachweis_position
           (mandant_id, leistungsnachweis_id, kunde_id, reihenfolge, bezeichnung,
            menge, einheit, einzelpreis_cent, quelle, erstellt_von_art)
         values ($1,$2,$3,$4,$5,$6::numeric,$7,$8::bigint,'manuell','system')`,
        // KEIN `on conflict` hier: `lnp_reihenfolge_uk` ist DEFERRABLE, und
        // Postgres laesst eine aufschiebbare Bedingung nicht als Schiedsrichter
        // zu — „ON CONFLICT does not support deferrable unique constraints as
        // arbiters", auch ohne Zielangabe. Es braucht auch keines: hierher
        // kommt nur, wer den Nachweis GERADE angelegt hat; ein zweiter
        // Durchgang ist oben schon mit der vorhandenen Kennung zurueck.
        [m!.id, n!.id, ort!.kunde_id, reihe, text, menge, einheit, preis] as never[]);
    }
    return n!.id;
  };

  nachweisLesend = await nachweis(`LN-E2E-${LAUF}-1`);
  nachweisZumUnterschreiben = await nachweis(`LN-E2E-${LAUF}-2`);

  /**
   * Die Beanstandung trägt den bestrittenen Nachweis — sonst zeigt die Spalte,
   * um die es in Abnahmekriterium 4 geht, auf jeder Zeile einen Gedankenstrich.
   */
  const reklamation = async (nummer: string): Promise<string> => {
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into reklamation
         (mandant_id, nummer, objekt_id, revier_id, kunde_id, leistungsnachweis_id,
          quelle, prioritaet, status, beschreibung, gemeldet_von_name,
          erstellt_von_art)
       values ($1,$2,$3,$4,$5,$6,'kunde','mittel','offen',
               'Treppenhaus im 3. OG am Montag nicht gereinigt, Flecken vor Aufzug.',
               'Frau Özdemir, Objektverantwortliche', 'system')
       on conflict (mandant_id, nummer) do nothing
       returning id`,
      [m!.id, nummer, ort!.objekt_id, ort!.revier_id, ort!.kunde_id,
        nachweisLesend] as never[]);
    // Wie beim Nachweis: ein zweiter Durchgang desselben Arbeiters findet die
    // Zeile wieder, statt an `reklamation_nummer_uk` zu brechen.
    if (r === undefined) {
      const [vorhanden] = await sql.unsafe<{ id: string }[]>(
        'select id from reklamation where mandant_id = $1 and nummer = $2',
        [m!.id, nummer] as never[]);
      return vorhanden!.id;
    }
    return r.id;
  };

  reklamationBehoben = await reklamation(`RK-E2E-${LAUF}-1`);
  reklamationFrist = await reklamation(`RK-E2E-${LAUF}-2`);
});

/**
 * **Diese Datei hat sich nie angemeldet.**
 *
 * Jede Portalseite beantwortet eine fehlende Sitzung mit „Anmeldung
 * erforderlich" — nicht mit einem Fehler, sondern mit einem gültigen,
 * freundlichen Bildschirm ohne die gesuchte Überschrift. Sieben Fehlschläge
 * lasen sich deshalb wie sieben kaputte Seiten. Derselbe Fehler steckte in
 * `rechnung.spec.ts` (behoben in 30a294c); hier stand er noch.
 */
test.beforeEach(async ({ page }) => { await alsKonto(page, KONTO.adminReinigung); });

// Kein `sql.end()`: derselbe Grund wie in `aufmass.spec.ts` — der Pool lebt je
// Worker-PROZESS, und ein in `afterAll` geschlossener Pool tötet jede Abfrage
// eines späteren Laufs derselben Datei mit `CONNECTION_ENDED`.

/**
 * Der Verweis in der TABELLE, nicht „der erste Verweis der Seite".
 *
 * Hier stand `getByRole('link', { name: /EG|Revier|Zone/u })`. Kein Revier des
 * Seeds heisst so — sie heissen „Bürogeschosse", „Glasflächen" und
 * „Nachtreinigung Halle" —, und eine Namensprobe, die auf die Bezeichnung der
 * Demodaten wettet, geht beim nächsten Seed wieder kaputt. `[data-cse="tabelle"]`
 * ist die Tabelle ab `md`; die gestapelte Kartenansicht darunter trägt
 * `data-cse="stapel"` und steht in der Desktop-Ansicht auf `display:none`,
 * zählt also nicht mit.
 */
function ersterTabellenverweis(page: Page) {
  return page.locator('[data-cse="tabelle"]').getByRole('link').first();
}

test.describe('Reviere (CLN-01)', () => {
  test('die Liste nennt die Sollzeit als ZIELWERT und zeigt die Gegenprobe', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/reinigung/reviere`);

    // K-16(c): die Spaltenüberschrift sagt selbst, dass sie keinen gemessenen
    // Wert zeigt. Eine Minutenspalte ohne dieses Wort ist der Fehler, den die
    // Konvention verhindern will.
    await expect(page.getByRole('columnheader', { name: /Zielwert/u })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Summe Räume/u })).toBeVisible();
  });

  test('das Revierblatt stellt Kopfwert und Summe der Räume nebeneinander', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/reinigung/reviere`);
    await ersterTabellenverweis(page).click();

    await expect(page.getByText('Sollzeit je Durchgang — berechneter Zielwert')).toBeVisible();
    await expect(page.getByText('Summe der Räume')).toBeVisible();
    // Die beiden Zahlen müssen übereinstimmen; die Seite sagt es im Klartext.
    await expect(page.getByText(/Stimmt mit dem Kopf überein/u)).toBeVisible();
  });

  test('ein zugeordneter Raum lässt sich nicht abwählen', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/reinigung/reviere`);
    await ersterTabellenverweis(page).click();
    await page.getByRole('link', { name: /Räume zuordnen/u }).click();

    const gesetzt = page.locator('input[type="checkbox"][disabled]').first();
    if (await gesetzt.count() > 0) {
      // Abgeschaltet, nicht bloss vorausgewählt: eine Zuordnung steht unter
      // Löschsperre und lässt sich nicht lösen (§5.2). `readonly` täte auf
      // einem Kontrollkästchen nichts.
      await expect(gesetzt).toBeChecked();
      await expect(gesetzt).toBeDisabled();
      // Und der Wert reist trotzdem mit — sonst fiele die Zuordnung beim
      // Speichern heraus und der Dienst meldete „nicht entfernbar".
      const versteckt = page.locator('input[type="hidden"][name="raum"]');
      await expect(versteckt.first()).toHaveCount(1);
    }
  });
});

test.describe('Leistungsnachweis und Unterschrift (CLN-04)', () => {
  test('das Unterschriftsblatt trägt die Prüfsumme im Formular', async ({ page }) => {
    await page.goto(
      `/portal/${MANDANT}/reinigung/leistungsnachweise/${nachweisLesend}/unterschrift`);

    const pruefsumme = page.locator('input[name="pruefsumme"]');
    await expect(pruefsumme).toHaveAttribute('value', /^[0-9a-f]{64}$/u);
    // Der Bestätigungstext ist DEUTSCH und bleibt es, auch wenn die Bedienung
    // übersetzt wird (EMP-12, SEITENKARTE §5.7).
    await expect(page.getByText(/hiermit bestätigt/u)).toBeVisible();
  });

  test('unterschreiben speichert Name und Serverzeit und friert das Blatt ein',
    async ({ page }) => {
      await page.goto(
        `/portal/${MANDANT}/reinigung/leistungsnachweise/${nachweisZumUnterschreiben}`);
      await page.getByRole('link', { name: 'Unterschreiben lassen' }).click();

      await page.getByLabel('Name der unterzeichnenden Person').fill('Frau Özdemir');
      await page.getByRole('button', { name: 'Unterschreiben' }).click();

      /**
       * `getByRole('heading', …)` und nicht `getByText('Unterschrift')`: die
       * Seite trägt nach dem Unterschreiben zwei Überschriften mit diesem
       * Wort — „Unterschrift" und „Positionen — Abzug der Unterschrift" —, und
       * der strikte Modus wirft dann eine Mehrdeutigkeit statt zu prüfen.
       */
      await expect(page.getByRole('heading', { name: 'Unterschrift', exact: true }))
        .toBeVisible();
      await expect(page.getByText('Frau Özdemir')).toBeVisible();
      // Die Serverzeit steht als solche da — nicht als „Zeit".
      await expect(page.getByText(/Serverzeit \(Europe\/Berlin\)/u)).toBeVisible();
      // Und die Gerätezeit DANEBEN, nicht an ihrer Stelle (TIM-08).
      await expect(page.getByText(/Gerätezeit — getrennt gespeichert/u)).toBeVisible();

      // Nach der Unterschrift: der ABZUG, nicht die lebende Tabelle.
      await expect(page.getByText(/Abzug der Unterschrift/u)).toBeVisible();
      await expect(page.getByText(/unveränderliche Kopie/u)).toBeVisible();
      // Die Prüfsumme steht sichtbar da und ist nachgerechnet.
      await expect(page.getByText(/Nachgerechnet/u)).toBeVisible();
      // Und der Weg zum Unterschreiben ist weg.
      await expect(page.getByRole('link', { name: 'Unterschreiben lassen' })).toHaveCount(0);
    });

  test('ohne Bildspeicher sagt die Seite „nicht verbunden" statt zu tun als ob',
    async ({ page }) => {
      await page.goto(
        `/portal/${MANDANT}/reinigung/leistungsnachweise/${nachweisLesend}/unterschrift`);
      await expect(page.getByText(/nicht verbunden/u)).toBeVisible();
    });
});

test.describe('Reklamation (OPS-11)', () => {
  test('die Liste zeigt den bestrittenen Nachweis als Verweis', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/qualitaet/reklamationen`);
    await expect(
      page.getByRole('columnheader', { name: 'Bestrittener Nachweis' }),
    ).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Nacharbeit' })).toBeVisible();
  });

  test('„behoben" ohne Maßnahme wird abgewiesen', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/qualitaet/reklamationen/${reklamationBehoben}`);

    await page.getByLabel('Abstellmaßnahme — Pflicht, sobald der Zustand „Behoben" ist').fill('');
    /*
     * `exact: true`, weil `getByLabel` sonst als Teilzeichenkette sucht: das
     * Feld darüber heisst „Abstellmaßnahme — Pflicht, sobald der Zustand
     * „Behoben" ist" und enthält das Wort ebenfalls. Zwei Treffer sind im
     * strikten Modus ein Fehler, und er las sich wie eine kaputte Seite.
     */
    await page.getByLabel('Zustand', { exact: true }).selectOption('behoben');
    await page.getByRole('button', { name: 'Speichern' }).click();

    // Der Dienst weist ab; die Datenbank täte es ein zweites Mal.
    await expect(page.locator('body')).toContainText(/ungueltiger_zustand|nicht behoben/u);
  });

  test('die Frist bleibt leer, solange O-14 offen ist', async ({ page }) => {
    await page.goto(`/portal/${MANDANT}/qualitaet/reklamationen/${reklamationFrist}`);
    // Kein erfundener Termin — die offene Frage steht im Klartext am Feld.
    await expect(page.getByText('offen (O-14)')).toBeVisible();
  });
});
