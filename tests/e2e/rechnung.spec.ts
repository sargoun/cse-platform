/**
 * PR 46 durch den Browser — Entwurf, Festschreiben, Verwerfen, Storno
 * (FIN-02, FIN-03, FIN-06, Invariante 4).
 *
 * **Diese Spezifikation läuft NICHT in der Entwicklungsdatenbank dieses PRs.**
 * Sie braucht einen Build und die gemeinsame Seed-Datenbank; sie steht hier als
 * das, was der Browser nachweisen soll, und wird im gemeinsamen Lauf
 * ausgeführt.
 *
 * Was sie prüft, prüft kein Unit- und kein Isolationstest:
 *
 *  - Ein Entwurf zeigt „ohne — Entwurf" statt einer Nummer. Dass die Spalte
 *    NULL ist, prüft die Datenbank; dass die Oberfläche daraus nicht
 *    stillschweigend eine Null macht, zeigt nur die gerenderte Seite.
 *  - Auf einem festgeschriebenen Beleg gibt es **kein Formular**. Die
 *    Seitenkarte verlangt „draft editor **or** finalised read-only view, never
 *    both", und ein Formular, das die Datenbank anschliessend ablehnt, ist ein
 *    Versprechen, das die Oberfläche nicht halten kann.
 *  - Der unbestätigte Nummernkreis und die unbestätigte Mengeneinheit tragen
 *    sichtbar ihren Platzhalter-Hinweis (§1.11, O-134, O-174) — sonst geht
 *    eine Rechnung unter einer geratenen Maske hinaus, und niemand hat es
 *    gesehen.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import postgres from 'postgres';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const MANDANT = 'reinigung';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';
const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/**
 * **Der Nummernkreis ist eine VORRICHTUNG dieser Datei, keine Antwort auf O-134.**
 *
 * Der Seed legt den Kreis `ausgangsrechnung` mit Absicht als Platzhalter an
 * (`src/server/db/seed/index.ts`), weil niemand entschieden hat, ob die
 * Gruppe fortlaufend oder jährlich neu nummeriert.
 * `fin.rechnung_nummer_ziehen` verweigert daraufhin jede Nummer — „eine
 * Nummer aus einem unbestätigten Kreis wäre eine erfundene", und das ist im
 * Betrieb genau richtig. Für den Browser heisst es aber: es gibt in dieser
 * Gesellschaft keine festschreibbare Rechnung, und damit prüfte der ganze
 * Block darunter nichts. Drei Fälle standen deshalb rot, ohne dass ein
 * einziger davon einen Programmfehler gemeldet hätte.
 *
 * Die Suite baut sich den Kreis deshalb selbst — dasselbe, was
 * `tests/isolation/rechnung.test.ts` in `macheFakturierfaehig()` tut und was
 * `tests/isolation/seed.test.ts` als den einen fehlenden Handgriff
 * beschreibt. Was hier NICHT passiert: die Maske wird nicht angefasst. Sie
 * ist der offene Teil der Frage, und diese Datei hat darauf keine Antwort;
 * geprüft wird der WEG (Entwurf → Nummer → Kette → Storno), und der ist von
 * der Maske unabhängig. Im Seed bleibt der Kreis ein Platzhalter — dies hier
 * ist die Testdatenbank und nur sie.
 *
 * // TODO(client, O-134): Laufen die Rechnungsnummern je Gesellschaft
 * fortlaufend weiter oder setzen sie jährlich zurück, und mit welcher Maske?
 */
test.beforeAll(async () => {
  /**
   * **Die Storno-Befugnis ist eine VORRICHTUNG, keine Antwort auf O-77.**
   *
   * `finanzen.stornieren` haelt im Katalog nur `super_admin`
   * (`gebunden: ['super_admin']`), und der einzige solche Zugang im Seed
   * gehoert keiner Gesellschaft an — in `reinigung` kann heute also NIEMAND
   * korrigieren, und der Weg, um den es in Invariante 4 geht, liesse sich im
   * Browser ueberhaupt nicht gehen.
   *
   * Der Katalog fuehrt `admin` ausdruecklich unter `bindbar`: die Bindung ist
   * eine vorgesehene Einstellung, keine erfundene Regel. Genau sie wird hier
   * fuer die Testdatenbank gesetzt — und NICHT im Seed, denn welche Rolle sie
   * im Betrieb traegt, ist offen.
   *
   * Was damit ungeprueft bleibt: der Zweig OHNE das Recht, der auf dem Beleg
   * statt des Formulars den Satz „dieses Konto haelt das Recht nicht (O-77)"
   * zeigt. Beides in einem Lauf zu pruefen hiesse, dieselbe Rolle gleichzeitig
   * mit und ohne Recht zu fuehren; `app.hat_recht` selbst ist in der
   * Isolationssuite abgedeckt.
   *
   * // TODO(client, O-77): Wer darf eine festgeschriebene Rechnung
   * stornieren — nur die Gruppenleitung, oder auch die Verwaltung einer
   * Gesellschaft?
   */
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id)
     select r.id, b.id from rolle r, berechtigung b
      where r.schluessel = 'admin' and b.schluessel = 'finanzen.stornieren'
     on conflict do nothing`);

  await sql.unsafe(
    `update nummernkreis nk
        set ist_platzhalter = false,
            -- 'jaehrlich' und nicht 'nie': der Seed traegt jahr = 2026 und die
            -- Maske RE-{jahr}-{nr:5}. Ein fortlaufender Kreis verlangt jahr = 0,
            -- und die Pruefung sagte das auch — 'Nummernkreis (unbestaetigt):
            -- fortlaufend, aber jahr = 2026 statt 0'. Die Vorrichtung muss zum
            -- Kreis passen, den sie bestaetigt, sonst bestaetigt sie einen
            -- Widerspruch. Dieselbe Wahl trifft tests/isolation/seed.test.ts.
            zuruecksetzung  = 'jaehrlich'::nummernkreis_zuruecksetzung
       from mandant m
      where m.id = nk.mandant_id
        and m.slug = $1
        and nk.kreis_typ = 'ausgangsrechnung'
        and nk.kontext_id is null
        and nk.geschlossen_am is null`,
    [MANDANT],
  );
});

/**
 * **Ohne Anmeldung antwortet jede Portalseite mit „Anmeldung erforderlich"** —
 * und dann ist die Ueberschrift, auf die dieser Test wartet, nicht da. Der
 * Helfer stand in jeder anderen e2e-Datei; hier fehlte er, und deshalb
 * scheiterten alle zehn Faelle mit demselben `toBeVisible()`, das wie ein
 * fehlender Bildschirm aussah.
 */
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
 * **Jede Prüfung schreibt ihren EIGENEN Beleg fest.**
 *
 * Zwei Prüfungen unten — der Storno und die BT-130-Spalte — öffneten
 * `getByRole('link', { name: /^RE-/u }).first()` im Rechnungsausgangsbuch. Die
 * einzige Rechnung, die dort je stand, legte die Prüfung „danach gibt es kein
 * Positionsformular mehr" an, und der Seed legt keine an (O-134, siehe unten).
 * `playwright.config.ts` läuft `fullyParallel`: die drei Fälle liegen in
 * verschiedenen Arbeitern, laufen gleichzeitig, und keine Reihenfolge
 * garantiert, dass der Beleg schon da ist. Die beiden Prüfungen fielen
 * deshalb an wechselnden Stellen um — mal mit einem Zeitablauf auf dem
 * Verweis, mal gar nicht.
 *
 * Schlimmer als das Wandern war der andere Ausgang: lief die erste Prüfung
 * zufällig zuerst durch, STORNIERTE der Storno-Fall genau den Beleg, an dem
 * die dritte Prüfung anschliessend ihre Spaltenüberschrift suchte — und auf
 * einer stornierten Rechnung steht kein Korrekturformular mehr.
 *
 * Der Helfer legt Entwurf und Position an und schreibt fest. Er ist damit
 * auch die einzige Stelle, an der der Weg beschrieben steht; drei Abschriften
 * waren drei Gelegenheiten, ihn verschieden zu tippen.
 */
async function festgeschriebenerBeleg(page: Page): Promise<void> {
  await anmelden(page);
  await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
  /*
   * Der Leistungszeitraum ist keine Zierde, sondern die Bedingung, unter der
   * sich der Beleg überhaupt festschreiben lässt: `rechnung_leistungszeitpunkt`
   * verlangt entweder `leistung_von` UND `leistung_bis`, oder — bei Abschlag
   * und Anzahlung — einen geplanten Vereinnahmungstag (§ 14 Abs. 4 Nr. 6
   * UStG). Der Helfer füllte nur das Zahlungsziel; die Festschreibung fiel
   * deshalb an der Datenbank, und zwar zu Recht.
   */
  await page.getByLabel('Leistung von').fill('2026-08-01');
  await page.getByLabel('Leistung bis').fill('2026-08-31');
  await page.getByLabel('Zahlungsziel (Tage)').fill('30');
  await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

  await page.getByLabel('Handelsübliche Bezeichnung').fill('Unterhaltsreinigung');
  await page.getByLabel('Menge (Tausendstel)').fill('1000');
  await page.getByLabel('Einzelpreis (Cent)').fill('10000');
  /*
   * PR 49: jede Leistungszeile nennt ihren Beleg (FIN-07). Dieser Entwurf
   * hängt an keinem Auftrag, also gibt es nur „von Hand" — und dann ist die
   * Begründung Pflicht, im Formular wie in der Datenbank.
   */
  await page.getByLabel('Begründung, falls von Hand erfasst')
    .fill('Einmalige Leistung ohne Auftragsbezug');
  await page.getByRole('button', { name: 'Position hinzufügen' }).click();

  /**
   * **Erst nachsehen, ob die Position wirklich steht.**
   *
   * Hier stand der naechste Klick direkt daneben. Der Knopf „Rechnung
   * festschreiben" ist `disabled`, solange kein Posten da ist — Playwright
   * wartet dann brav 30 Sekunden darauf, dass er `enabled` wird, und meldet
   * am Ende „Test timeout exceeded". Das ist die teuerste Art, einen Fehler
   * zu melden: sie nennt die Stelle, an der gewartet wurde, und verschweigt
   * die Stelle, an der etwas schiefging.
   *
   * Genau so ist es passiert — allein gefahren gruen, mit drei Arbeitern auf
   * derselben Datenbank einmal rot. Was der Lauf NICHT sagte: ob die
   * Uebernahme fehlschlug, ob die Seite gar nicht neu rendete, oder ob eine
   * Meldung dastand. Diese Zeile beantwortet das beim naechsten Mal: sie
   * faellt dort, wo es passiert, mit dem, was auf dem Bildschirm steht.
   */
  await expect(
    // Die Zelle der Positionstabelle, nicht eine Option der Auftragsauswahl (V-205).
    page.getByRole('cell', { name: 'Unterhaltsreinigung', exact: true }).first(),
    'die Position wurde nicht übernommen — der Beleg ist ohne sie nicht festschreibbar',
  ).toBeVisible();

  await page.getByRole('button', { name: 'Rechnung festschreiben' }).click();
  await page.waitForLoadState('domcontentloaded');

  /**
   * `/api/rechnungen/festschreiben` antwortet auf eine Abweisung mit JSON und
   * 409, nicht mit einer Seite — der Browser zeigt dann den rohen Text. Ohne
   * diese Probe suchte die nächste Zusicherung eine Überschrift auf einem
   * JSON-Dokument und meldete einen Zeitablauf, der wie ein kaputter
   * Bildschirm aussieht statt wie ein benannter Grund.
   *
   * Der Grund, der hier am längsten stand, ist keiner mehr: der Seed legt den
   * Rechnungsnummernkreis bewusst als PLATZHALTER an (O-134), und
   * `fin.rechnung_nummer_ziehen` zieht aus einem unbestätigten Kreis keine
   * Nummer. Das `beforeAll` dieser Datei baut sich den Kreis deshalb als
   * Vorrichtung. Bleibt die Abweisung trotzdem stehen, ist sie ein echter
   * Befund und ihr Text steht hier — statt eines Zeitablaufs weiter unten.
   *
   * **Deshalb nennt die Meldung keinen Grund mehr.** Sie nannte O-134, und
   * genau das hat in dieser Runde eine Stunde gekostet: abgewiesen wurde mit
   * `{"fehler":"pflichtfelder"}`, weil den Seed-Kunden die Anschrift fehlte
   * (§14 Abs. 4 Nr. 1 UStG) — der Nummernkreis war längst bestätigt. Eine
   * Zusicherung, die eine Ursache RÄT, schickt den nächsten Leser in die
   * falsche Datei; der Rumpf der Antwort steht ohnehin daneben.
   */
  const koerper = (await page.locator('body').innerText()).trim();
  expect(
    koerper.startsWith('{') ? koerper.slice(0, 400) : null,
    'Festschreiben abgewiesen — der Grund steht im JSON daneben, und alles '
    + 'darunter prüft ohne festgeschriebenen Beleg nichts',
  ).toBeNull();
}

test.describe('Das Rechnungsausgangsbuch (FIN-16)', () => {
  test('ein Entwurf steht ohne Nummer in der Liste', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen`);
    await expect(page.getByRole('heading', { name: 'Rechnungen', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Neuer Entwurf' })).toBeVisible();
  });

  test('die Liste nennt Brutto rechtsbündig und den Zustand als Pille', async ({ page }) => {
    await anmelden(page);
    /*
     * Erst eine Zeile, dann die Spaltenüberschriften. Eine leere Liste rendert
     * keine Tabelle — sie sagt „noch keine Rechnung" —, und die Prüfung suchte
     * eine Überschrift, die es dann zu Recht nicht gibt. Vorher stand sie nur
     * deshalb da, weil eine ANDERE Prüfung derselben Datei zufällig vorher
     * gelaufen war; `fullyParallel` verspricht das nicht. Der Seed legt keine
     * Rechnung an (O-134), also legt diese Prüfung ihre eigene an.
     */
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen`);
    await expect(page.getByRole('columnheader', { name: 'Brutto' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Zustand' })).toBeVisible();
  });
});

test.describe('Der Entwurf (FIN-01)', () => {
  test('das Formular füllt kein Zahlungsziel vor — §4.2 kennt keinen Vorgabewert', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    const ziel = page.getByLabel('Zahlungsziel (Tage)');
    await expect(ziel).toBeVisible();
    // Leer, nicht `14`. Ein vorausgefüllter Wert setzte `faellig_am` auf jeder
    // Rechnung und triebe den Mahnlauf.
    await expect(ziel).toHaveValue('');
    await expect(page.getByText(/Es gibt keinen Vorgabewert/u)).toBeVisible();
  });

  test('ein Entwurf entsteht, bekommt aber keine Nummer', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

    await expect(page.getByRole('heading', { name: 'Entwurf ohne Nummer' })).toBeVisible();
    await expect(page.getByText('Noch keine Position')).toBeVisible();
  });

  test('ohne Position lässt sich nicht festschreiben — der Knopf ist gesperrt', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page.getByRole('button', { name: 'Rechnung festschreiben' })).toBeDisabled();
  });

  test('Menge und Preis werden als GANZE Zahlen erfasst (K-16, Invariante 1)', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

    await expect(page.getByText('30870 = 30,870')).toBeVisible();
    await expect(page.getByText('1999 = 19,99 €')).toBeVisible();
    // `step="1"`: kein Komma, kein Punkt, kein Bruchteil eines Cents.
    await expect(page.getByLabel('Menge (Tausendstel)')).toHaveAttribute('step', '1');
    await expect(page.getByLabel('Einzelpreis (Cent)')).toHaveAttribute('step', '1');
  });
});

test.describe('Das Festschreiben ist einseitig (Invariante 4)', () => {
  test('danach gibt es kein Positionsformular mehr, sondern die Kettenbindung', async ({ page }) => {
    await festgeschriebenerBeleg(page);

    // Die Nummer steht jetzt in der Überschrift, und zwar aus der Maske des
    // Kreises — nicht aus einer Verkettung im Aufrufcode.
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Entwurf ohne Nummer');
    await expect(page.getByRole('heading', { name: 'Kettenbindung' })).toBeVisible();
    await expect(page.getByText(/Position \d+ der Kette/u)).toBeVisible();

    // Und der Editor ist weg. Das ist die Aussage der Seitenkarte.
    await expect(page.getByRole('button', { name: 'Position hinzufügen' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rechnung festschreiben' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Entwurf verwerfen' })).toHaveCount(0);
    // Die Kopfzeile trägt „Nur Lesen" — DESIGN §6.
    await expect(page.getByText('Nur Lesen').first()).toBeVisible();
  });

  test('korrigiert wird durch Storno mit auditfähigem Grund, nicht durch Änderung', async ({ page }) => {
    // Der EIGENE Beleg: ein fremder wäre schon storniert, sobald zwei Arbeiter
    // gleichzeitig in dieselbe Liste greifen.
    await festgeschriebenerBeleg(page);

    await expect(page.getByRole('heading', { name: 'Korrigieren' })).toBeVisible();
    const grund = page.getByLabel(/Grund \(mindestens zehn Zeichen/u);
    await expect(grund).toHaveAttribute('minlength', '10');
    // „Fehler" reicht nicht: `rechnung_beziehung` verlangt zehn Zeichen, und
    // das Formular sagt es, statt es die Datenbank sagen zu lassen.
    await grund.fill('Falsche Rechnungsanschrift des Auftraggebers');
    /*
     * Die Adresse des Belegs MUSS vor dem Absenden festgehalten werden.
     *
     * `/api/rechnungen/storno` leitet auf das AUSGANGSBUCH weiter, nicht auf
     * den Beleg — und das ist richtig so: nach einer Korrektur gibt es zwei
     * Belege, und welcher der gemeinte ist, entscheidet nicht die Route. Der
     * Hinweis „Aufgehoben durch Stornorechnung" steht aber auf dem
     * ursprünglichen Beleg, und die Prüfung suchte ihn auf der Liste.
     */
    const beleg = page.url();
    await page.getByRole('button', { name: 'Stornieren' }).click();
    await page.waitForURL(/\/finanzen\/rechnungen$/u);

    await page.goto(beleg);
    await expect(page.getByText(/Aufgehoben durch Stornorechnung/u).first()).toBeVisible();
  });
});

test.describe('Unbestätigte Werte sind sichtbar (§1.11)', () => {
  test('eine Platzhalter-Mengeneinheit sagt es in der Auswahl', async ({ page }) => {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page.getByLabel('Einheit')).toContainText('unbestätigter Wert');
  });

  test('und eine Position ohne BT-130 zeigt „offen" statt eines geratenen Codes', async ({ page }) => {
    await festgeschriebenerBeleg(page);
    await expect(page.getByRole('columnheader', { name: 'BT-130' })).toBeVisible();
  });
});

test.describe('Die XRechnung im Browser (FIN-11)', () => {
  /**
   * **Der Beleg geht an das Bezirksamt** — den einzigen öffentlichen
   * Auftraggeber der Demodaten (PR 52.1). Bei ihm ist die XRechnung keine
   * Beigabe: ohne sie kann die Gruppe ihn gar nicht abrechnen (SPEC §9), und
   * genau diesen Weg zeigt diese Prüfung.
   */
  async function belegAnDasBezirksamt(page: Page): Promise<void> {
    await anmelden(page);
    await page.goto(`/portal/${MANDANT}/finanzen/rechnungen/neu`);
    await page.getByLabel('Kunde').selectOption({ label: 'Bezirksamt Musterberg von Berlin' });
    await page.getByLabel('Leistung von').fill('2026-08-01');
    await page.getByLabel('Leistung bis').fill('2026-08-31');
    await page.getByLabel('Zahlungsziel (Tage)').fill('30');
    // BT-81: bei einem öffentlichen Auftraggeber verlangt BR-DE-1 die Angabe.
    await page.getByLabel('Zahlungsart').selectOption('58');
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();

    await page.getByLabel('Handelsübliche Bezeichnung').fill('Unterhaltsreinigung');
    await page.getByLabel('Menge (Tausendstel)').fill('1000');
    /*
     * **Quadratmeter, nicht die Vorauswahl.** Die erste Einheit der Liste ist
     * `einsatz`, und die hat keinen UN/ECE-Rec-20-Code — O-174 ist für sie
     * offen, weil es für „Einsatz" keine normative Entsprechung gibt. Die
     * Vorprüfung weist einen Beleg damit zu Recht ab (BT-130), und genau das
     * hat diese Prüfung beim ersten Lauf getan. Die Lehre steht hier, nicht in
     * einer stillen Änderung: wer für einen öffentlichen Auftraggeber
     * abrechnet, braucht eine Einheit mit Code.
     */
    await page.getByLabel('Einheit').selectOption('m2');
    await page.getByLabel('Einzelpreis (Cent)').fill('100000');
    await page.getByLabel('Begründung, falls von Hand erfasst')
      .fill('Einmalige Leistung ohne Auftragsbezug');
    await page.getByRole('button', { name: 'Position hinzufügen' }).click();
    // Die Zelle der Positionstabelle, nicht eine Option der Auftragsauswahl (V-205).
    await expect(page.getByRole('cell', { name: 'Unterhaltsreinigung', exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Rechnung festschreiben' }).click();
    await page.waitForLoadState('domcontentloaded');
    const koerper = (await page.locator('body').innerText()).trim();
    expect(
      koerper.startsWith('{') ? koerper.slice(0, 400) : null,
      'Festschreiben abgewiesen — der Grund steht im JSON daneben',
    ).toBeNull();
  }

  test('die Seite zeigt einen Prüfstand und behauptet NIE, das Dokument sei gültig',
    async ({ page }) => {
      await belegAnDasBezirksamt(page);
      await page.getByRole('link', { name: 'XRechnung ansehen' }).click();
      await expect(page.getByRole('heading', { name: 'XRechnung (UBL, EN 16931)' }))
        .toBeVisible();

      const stand = page.locator('[data-cse="xrechnung-pruefstand"]');
      await expect(stand).toBeVisible();
      /*
       * 04-SEITENKARTE §5.14.3 nennt genau drei Zustände und verbietet einen
       * vierten, der wie ein Bestehen aussieht. „gültig" über DIESE Rechnung
       * wäre genau der vierte — und eine erfundene Freigabe entdeckt der
       * Empfänger, indem er die Rechnung ablehnt.
       */
      await expect(stand).not.toContainText(/\bgültig\b/u);
      await expect(stand).toHaveAttribute(
        'data-art', /^(in_ci_validiert|pruefung_ausstehend|pruefer_nicht_verbunden)$/u);
    });

  test('die Leitweg-ID steht auf der Seite und im Dokument (BT-10)', async ({ page }) => {
    await belegAnDasBezirksamt(page);
    await page.getByRole('link', { name: 'XRechnung ansehen' }).click();

    await expect(page.locator('[data-cse="leitweg-id"]')).toHaveText('991-12345-67');
    // Und im erzeugten UBL — ohne BT-10 weist das Portal des Auftraggebers ab.
    await expect(page.locator('[data-cse="xrechnung-vorschau"]'))
      .toContainText('<cbc:BuyerReference>991-12345-67</cbc:BuyerReference>');
    // Es gibt KEINE Mängelliste: der Beleg ist vollständig.
    await expect(page.locator('[data-cse="xrechnung-fehlend"]')).toHaveCount(0);
  });

  test('die Adresse liefert XML, nicht HTML — und als Datei', async ({ page }) => {
    await belegAnDasBezirksamt(page);
    const beleg = page.url();
    const id = beleg.split('/').pop() ?? '';

    const antwort = await page.request.get(`/api/finanzen/rechnungen/${id}/xrechnung.xml`);
    expect(antwort.status()).toBe(200);
    expect(antwort.headers()['content-type']).toContain('application/xml');
    /*
     * `attachment` und ein Dateiname aus der Rechnungsnummer: ohne den
     * Kopfsatz zeigt der Browser das XML an, statt es zu speichern, und wer
     * es an die Rechnungseingangsplattform weiterreichen will, hat nichts in
     * der Hand.
     */
    expect(antwort.headers()['content-disposition']).toMatch(/attachment; filename="xrechnung-/u);
    expect(await antwort.text()).toContain('urn:xeinkauf.de:kosit:xrechnung_3.0');
  });

  test('axe findet nichts auf der XRechnung-Seite', async ({ page }) => {
    /*
     * BFSG (LEG-07, DESIGN §9). Die Portalseiten laufen nicht durch die
     * Sammelprüfung in `a11y.spec.ts` — die liest `OEFFENTLICHE_ROUTEN` —,
     * also steht die Prüfung bei der Seite, die sie braucht. Der
     * Vorschaukasten ist dabei der interessante Teil: ein `pre` mit tausend
     * Zeilen XML ist genau die Art Element, an der Kontrast, Rollen und
     * Tastaturerreichbarkeit auseinanderfallen.
     */
    await belegAnDasBezirksamt(page);
    await page.getByRole('link', { name: 'XRechnung ansehen' }).click();
    await expect(page.locator('[data-cse="xrechnung-vorschau"]')).toBeVisible();

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(
      ergebnis.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`),
    ).toEqual([]);
  });
});
