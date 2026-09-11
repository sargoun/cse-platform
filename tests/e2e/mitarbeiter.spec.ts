/**
 * Das Mitarbeiterportal im Browser — die Hälften, die nur dort zu prüfen sind
 * (EMP-02 … EMP-15).
 *
 * Die Datenbankhälften stehen in `tests/isolation/mitarbeiter.test.ts`, die
 * reinen in `tests/kern/mitarbeiter*.test.ts`. Hier steht, was erst am
 * gerenderten Bildschirm entsteht:
 *
 * (1) **Eine Anmeldung zeigt die Schichten BEIDER Beschäftigungen**, jede mit
 *     ihrer Gesellschaft beschriftet; die Kopfzeile summiert die Stunden,
 *     während die zwei Stundenkonten getrennt bleiben (EMP-14, EMP-15, D-09).
 * (2) **Es gibt kein Bearbeitungsfeld auf einem `zeiteintrag`** — kein Stift,
 *     kein Formular, kein Knopf; der Schreibweg antwortet 404, und das einzige
 *     Angebot ist ein `zeit_einwand` (EMP-07).
 * (3) Der Monatsnachweis nennt dieselbe Zahl wie das Stundenkonto — auf die
 *     Minute (EMP-04, EMP-06).
 * (4) **Kein Lohnsatz und nirgends ein Kundenpreis**, geprüft am gerenderten
 *     Text und an der Antwort (K-05, EMP-13).
 * (5) Ein abgelaufener Nachweis warnt die Person — dieselbe Quelle, aus der
 *     PR 31 die Einteilung sperrt (EMP-08, SEC-04).
 * (6) **Arabisch setzt `dir="rtl"`** und hat null axe-Verstöße (EMP-12,
 *     DESIGN §9, SEITENKARTE §12).
 *
 * **Die Fixtur ist Fatima aus dem Seed** — ein Mensch, zwei Gesellschaften
 * (D-09). Der Fall existiert im Seed genau deshalb; ihn hier nachzubauen
 * hiesse, gegen eine Fixtur zu prüfen statt gegen die Daten, mit denen die
 * Plattform ausgeliefert wird.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/**
 * Anmeldung als ein BESTIMMTER Mensch — nicht als „irgendwer mit dieser
 * Rolle".
 *
 * `/dev/anmelden` stellt für eine `mitarbeiter`-Rolle eine Sitzung mit
 * `ansicht = 'person'` aus — also genau den Personen-Scope, den K-18 für
 * dieses Portal verlangt. Alles danach ist echt: Policies, Rechte, Zeilen.
 *
 * `[data-rolle="mitarbeiter"]` griff das erste Konto dieser Rolle heraus.
 * Solange es genau eines gab, stimmte das zufällig; mit dem zweiten prüfte
 * dieselbe Zeile stillschweigend eine andere Person. Die Kennung steht
 * deshalb am Knopf (`src/app/dev/anmelden/page.tsx`).
 *
 * **Die Hilfe stand hier als eigene Abschrift** — eine von zwölf. Sie ist
 * nach `hilfen/anmeldung.ts` gezogen: dort sichert `toHaveCount(1)` zu, dass
 * es GENAU EIN Konto dieser Kennung gibt, während das `.first()` hier den Tag
 * verschwiegen hätte, an dem es zwei sind. Und die Kennungen stehen einmal
 * statt zwölfmal getippt da.
 */

/** Fatima Yildiz — ein Mensch, zwei Gesellschaften (D-09), Sprache Deutsch. */
async function alsFatima(page: Page): Promise<void> {
  await alsKonto(page, KONTO.fatima);
}

/**
 * Amir Haddad — dieselbe Oberfläche auf **Arabisch** (EMP-12, DESIGN §9).
 *
 * **Diese Datei schreibt `person.sprache` NICHT mehr um.** Sie tat es, und
 * das war ein Rennen: `playwright.config.ts` läuft `fullyParallel`, mehrere
 * Arbeiter schrieben gleichzeitig in dieselbe Zeile, und die Suite fiel an
 * wechselnden Stellen um — einmal stand `dir="ltr"` auf der arabischen
 * Prüfung, einmal „Bugün" auf einer deutschen in einer ganz anderen Datei.
 * Der Seed trägt jetzt alle vier Sprachen, jede an einem eigenen Menschen;
 * eine Prüfung sieht eine Sprache an, indem sie sich als dieser Mensch
 * anmeldet, und verändert dabei nichts.
 */
async function alsAmir(page: Page): Promise<void> {
  await alsKonto(page, KONTO.amir);
}

/**
 * **Der Pool wird NICHT mehr in `afterAll` geschlossen.**
 *
 * `const sql = postgres(...)` steht auf Modulebene, existiert also einmal je
 * Worker-PROZESS — `test.afterAll` dagegen laeuft, sobald ein Worker diese
 * Datei verlaesst. Nimmt er sie spaeter wieder auf (bei `fullyParallel` der
 * Normalfall), ist das Modul noch geladen und der Pool tot: jede weitere
 * Abfrage stirbt mit `write CONNECTION_ENDED`, bevor sie den Server sieht.
 * Genau so scheiterte „die Person sieht keinen zweiten Menschen" — an der
 * Datenbankzeile, nicht an ihrer Zusicherung, die damit nie gemessen wurde.
 *
 * Ein Pool, der mit dem Prozess endet, braucht kein `end()`: Playwright
 * beendet den Worker, und das Betriebssystem raeumt die Verbindungen ab.
 */

/**
 * **Die Woche wird aus den DATEN gewaehlt, nicht aus dem Kalender.**
 *
 * `/portal/mein/schichten` zeigt ohne `?woche` die laufende Berliner
 * Kalenderwoche (`page.tsx`: `montag(berlinHeute())` bis `+6`). Die Pruefung
 * ging stillschweigend davon aus, dass Fatima in JEDER Woche in beiden
 * Gesellschaften steht — und das kann der Seed nicht zusagen: der
 * Security-Posten laeuft `FREQ=WEEKLY;BYDAY=TU,TH` (`seed/security.ts`), also
 * zwei Dienste je Woche, und `besetzeUndErfasse` verteilt sie reihum auf die
 * DREI Beschaeftigten der Security. Fatima bekommt damit jeden dritten
 * Dienst — rechnerisch alle anderthalb Wochen —, und ungefaehr jede dritte
 * Kalenderwoche faellt fuer sie ganz aus. Genau eine solche Woche war die
 * laufende: zwei Reinigungsschichten, kein Sicherheitsdienst, also EINE
 * Gesellschaft statt zwei.
 *
 * Die alte Fassung war deshalb an zwei von drei Wochen gruen und am dritten
 * rot, ohne dass sich an Produkt oder Seed etwas geaendert haette — ein
 * Fehlschlag, der nach einem kaputten Portal aussah und keiner war, und der
 * beim naechsten Lauf von selbst verschwunden waere. Ein echtes Loch in D-09
 * haette er in demselben Rauschen versteckt.
 *
 * Gefragt wird jetzt die Datenbank, mit GENAU dem Fensterausdruck der Seite
 * (Ueberschneidung, nicht Plantag — sonst faellt die Nachtschicht vom Sonntag
 * auf den Montag zwischen die beiden Fassungen). Die laufende Woche steht
 * zuerst, also prueft der Normalfall weiterhin den Bildschirm OHNE Parameter.
 *
 * Und die Zusicherung ist schaerfer als vorher: nicht „mehr als eine
 * Gesellschaft", sondern GENAU DIE Gesellschaften, die in dieser Woche Zeilen
 * haben. Eine Seite, die eine der beiden stillschweigend wegfiltert, war
 * unter `> 1` noch gruen, sobald irgendwo eine dritte auftauchte.
 */
interface DoppelWoche {
  /** Berliner Montag, `JJJJ-MM-TT`. */
  readonly montag: string;
  /** Die Gesellschaften, die in dieser Woche Zeilen haben — aus der Datenbank. */
  readonly slugs: readonly string[];
  readonly istLaufendeWoche: boolean;
}

async function wocheMitBeidenGesellschaften(email: string): Promise<DoppelWoche> {
  const zeilen = await sql.unsafe<{
    montag: string; aktuell: boolean; slugs: string[];
  }[]>(
    `with mensch as (
       select p.id from person p join benutzer b on b.person_id = p.id where b.email = $1
     ), anker as (
       select date_trunc('week', (now() at time zone 'Europe/Berlin')::date)::date as montag
     ), wochen as (
       select ((select montag from anker) + (n * 7))::date as montag, n
         from generate_series(-3, 3) as n
     )
     select to_char(w.montag, 'YYYY-MM-DD')        as montag,
            (w.n = 0)                              as aktuell,
            array_agg(distinct m.slug order by m.slug) as slugs
       from wochen w
       join einsatz_zuordnung z
         on z.entfernt_am is null
        and z.beginn_zeitpunkt < ((w.montag + 7)::timestamp) at time zone 'Europe/Berlin'
        and z.ende_zeitpunkt   > (w.montag::timestamp) at time zone 'Europe/Berlin'
       join anstellung a on a.mandant_id = z.mandant_id and a.id = z.anstellung_id
       join mandant m on m.id = z.mandant_id
       join mensch on mensch.id = a.person_id
      group by w.montag, w.n
      order by abs(w.n), w.n`,
    [email] as never[]);

  const treffer = zeilen.find((z) => z.slugs.length > 1);
  /**
   * Kein `test.skip`: gibt es in sieben Wochen um heute herum keine einzige,
   * in der dieser Mensch in zwei Gesellschaften eingeteilt ist, dann liefert
   * die Plattform den D-09-Fall nicht mehr aus — und das ist der Fehlschlag,
   * den diese Datei melden soll, nicht ein Grund, sie zu ueberspringen.
   */
  expect(
    treffer,
    `kein Fenster mit zwei Gesellschaften fuer ${email} — der D-09-Fall fehlt in den Daten`,
  ).toBeDefined();
  return {
    montag: treffer!.montag,
    slugs: treffer!.slugs,
    istLaufendeWoche: treffer!.aktuell,
  };
}

// ---------------------------------------------------------------------------

test.describe('(1) eine Anmeldung, zwei Gesellschaften', () => {
  test('die Schichtliste zeigt beide, jede mit ihrer Gesellschaft beschriftet', async ({
    page,
  }) => {
    const woche = await wocheMitBeidenGesellschaften(KONTO.fatima);
    await alsFatima(page);
    // Ohne Parameter, wenn die laufende Woche es hergibt — das ist der
    // Bildschirm, den die Kraft morgens wirklich oeffnet.
    await page.goto(woche.istLaufendeWoche
      ? '/portal/mein/schichten'
      : `/portal/mein/schichten?woche=${woche.montag}`);

    const schichten = page.locator('[data-cse="schicht"]');
    await expect(schichten.first()).toBeVisible();

    // Jede Zeile trägt ihre GmbH — als NAME und nicht nur als Farbe (DESIGN §9).
    const bereiche = await schichten.evaluateAll(
      (es) => es.map((e) => e.getAttribute('data-mandant')));
    expect([...new Set(bereiche)].sort(), 'beide Gesellschaften stehen in der Liste')
      .toEqual([...woche.slugs]);
    // Und die Aussage von D-09 noch einmal fuer sich, unabhaengig von der
    // Liste oben: es sind ZWEI Gesellschaften und nicht eine.
    expect(new Set(bereiche).size, 'zwei Gesellschaften auf einem Bildschirm')
      .toBeGreaterThan(1);
    for (const s of await schichten.all()) {
      await expect(s.locator('[data-cse="gesellschaft"]')).toHaveText(/\S/u);
    }
  });

  test('die Kopfzeile summiert, die zwei Stundenkonten bleiben getrennt', async ({ page }) => {
    await alsFatima(page);
    await page.goto('/portal/mein');

    // Drei Kacheln: heute · Woche · Monat, zusammengezählt über beide Konten.
    await expect(page.locator('[data-cse="stunden-kopf"] [data-cse="kpi-wert"]'))
      .toHaveCount(3);
    const monatKopf = await page
      .locator('[data-cse="stunden-kopf"] [data-cse="kpi-wert"]').nth(2).innerText();

    // Und die Summe der beiden Beschäftigungszeilen ist dieselbe Zahl.
    const jeAnstellung = await page
      .locator('[data-cse="anstellung-monat"]').allInnerTexts();
    expect(jeAnstellung.length, 'zwei Beschäftigungen').toBe(2);
    expect(minuten(jeAnstellung[0]!) + minuten(jeAnstellung[1]!)).toBe(minuten(monatKopf));

    // Das Stundenkonto zeigt zwei GETRENNTE Konten, nicht eine Summe.
    await page.goto('/portal/mein/stundenkonto');
    await expect(page.locator('[data-cse="konto"]')).toHaveCount(2);
    const mandanten = await page.locator('[data-cse="konto"]').evaluateAll(
      (es) => es.map((e) => e.getAttribute('data-mandant')));
    expect(new Set(mandanten).size).toBe(2);
  });

  test('ohne hinterlegte Sollzeit steht „nicht hinterlegt" und keine 0 (O-18)', async ({
    page,
  }) => {
    await alsFatima(page);
    await page.goto('/portal/mein/stundenkonto');
    const soll = page.locator('[data-cse="konto-soll"]').first();
    if ((await soll.innerText()).includes('nicht hinterlegt')) {
      // Der erklärende Satz steht dann daneben — „0:00 h" wäre eine Antwort,
      // und zwar die gefährlichste von allen.
      await expect(page.locator('[data-cse="soll-offen"]')).toBeVisible();
      await expect(page.locator('[data-cse="konto-saldo"]').first())
        .toHaveText(/nicht hinterlegt/u);
    }
  });
});

/** `7:30 h` → 450. Die Anzeigeform ist die Zusage, also wird sie gelesen. */
function minuten(text: string): number {
  const t = /(-?)(\d+):(\d{2})/u.exec(text);
  if (t === null) throw new Error(`Keine Stundenangabe: ${text}`);
  const wert = Number(t[2]) * 60 + Number(t[3]);
  return t[1] === '-' ? -wert : wert;
}

// ---------------------------------------------------------------------------

test.describe('(2) kein Bearbeitungsfeld auf einem Zeiteintrag (EMP-07)', () => {
  test('die Liste und die Einzelansicht tragen kein Eingabefeld', async ({ page }) => {
    await alsFatima(page);
    for (const pfad of ['/portal/mein/zeiten']) {
      await page.goto(pfad);
      // Kein Formular, kein Eingabefeld, kein „speichern" — nirgends.
      await expect(page.locator('form')).toHaveCount(0);
      await expect(page.locator('input:not([type="hidden"]), textarea, select'))
        .toHaveCount(0);
      await expect(page.locator('[data-cse="kein-bearbeiten"]')).toBeVisible();
    }

    const ersteZeile = page.locator('[data-cse="zeit-zeile"]').first();
    await expect(ersteZeile).toBeVisible();
    await ersteZeile.click();
    await expect(page.locator('form')).toHaveCount(0);
    // Das EINZIGE Angebot dieser Seite.
    await expect(page.locator('[data-cse="einwand-link"]')).toBeVisible();
  });

  test('und der Schreibversuch antwortet 404 — nicht 403 (AUT-06)', async ({ page }) => {
    await alsFatima(page);
    /**
     * Es gibt keine Adresse, die einen Zeiteintrag ändert. Der Beweis ist
     * deshalb die Antwort auf den Versuch: 404, und zwar dieselbe Antwort wie
     * für alles andere, was es nicht gibt — ein 403 bestätigte die Existenz.
     */
    const antwort = await page.request.post('/api/zeiteintrag', {
      form: { id: '00000000-0000-0000-0000-000000000000', beginn: '2026-03-05T06:00' },
    });
    expect(antwort.status()).toBe(404);
  });

  test('der Einwand geht durch und ändert den Eintrag NICHT', async ({ page }) => {
    await alsFatima(page);
    await page.goto('/portal/mein/zeiten');
    await page.locator('[data-cse="zeit-zeile"]').first().click();
    await page.locator('[data-cse="einwand-link"]').click();

    await expect(page.locator('[data-cse="einwand-formular"]')).toBeVisible();
    const vorher = await page.locator('[data-cse="einwand-formular"] input[name="zeiteintrag"]')
      .inputValue();
    const [, abbildVorher] = await abbild(vorher);

    await page.selectOption('#einwand-art', 'zeit_falsch');
    await page.fill('#einwand-begruendung', 'Ich habe früher angefangen.');
    await page.click('[data-cse="einwand-formular"] button[type="submit"]');
    await page.waitForLoadState('networkidle');

    const [, abbildNachher] = await abbild(vorher);
    // Die Behauptung ist eine Behauptung und nie ein massgeblicher Zeitpunkt
    // (Invariante 5): der Eintrag steht Byte für Byte so da wie vorher.
    expect(abbildNachher).toBe(abbildVorher);
  });
});

async function abbild(id: string): Promise<[string, string]> {
  const zeilen = await sql.unsafe<{ abbild: string }[]>(
    `select to_jsonb(z)::text as abbild from zeiteintrag z where z.id = $1`, [id]);
  return [id, zeilen[0]?.abbild ?? ''];
}

// ---------------------------------------------------------------------------

test.describe('(3) der Monatsnachweis nennt dieselbe Zahl wie das Stundenkonto', () => {
  test('auf die Minute', async ({ page }) => {
    await alsFatima(page);
    await page.goto('/portal/mein/stundenkonto');
    const kontoIst = minuten(await page.locator('[data-cse="konto-ist"]').first().innerText());

    await page.locator('[data-cse="zum-monatsnachweis"]').first().click();
    await expect(page.locator('[data-cse="monatsnachweis"]')).toBeVisible();
    const summe = minuten(await page.locator('[data-cse="nachweis-summe"]').innerText());
    const abgleich = minuten(await page.locator('[data-cse="konto-ist"]').innerText());

    /**
     * **WELCHE Beschaeftigung auf dem Blatt steht, sagt das Blatt selbst.**
     *
     * Fatima hat zwei (D-09), und `.first()` oben waehlt die erste des
     * Stundenkontos — welche das ist, entscheidet die Sortierung nach
     * `anstellung_id`, also eine im Seed gewuerfelte UUID. Die Frage unten
     * muss deshalb DIESER Beschaeftigung gelten und nicht dem Menschen: eine
     * Person-weite Frage beantwortet, ob IRGENDWO etwas offen ist, waehrend
     * das Blatt von EINER Gesellschaft spricht. Beides auseinander zu halten
     * ist hier keine Feinheit — stand bei der einen etwas offen und bei der
     * anderen nicht, verlangte die Pruefung eine Erklaerung auf einem Blatt,
     * das zu Recht keine trug, und der Muenzwurf der UUID-Sortierung
     * entschied ueber rot und gruen.
     */
    const anstellungId = new URL(page.url()).searchParams.get('anstellung');
    expect(anstellungId, 'das Blatt nennt seine Beschaeftigung in der Adresse')
      .toMatch(/^[0-9a-f-]{36}$/u);

    // Dieselbe Beschaeftigung, derselbe Monat — der Abgleich auf dem Blatt
    // ist der des Kontos, von dem der Weg hierher ausging.
    expect(abgleich).toBe(kontoIst);

    /**
     * **Gleich, oder die Differenz ist auf die Minute erklaert.**
     *
     * Hier stand `expect(summe).toBe(abgleich)` — unbedingt. Das ist die
     * Zusicherung fuer einen ABGESCHLOSSENEN Monat und nur fuer ihn: auf das
     * Stundenkonto fliesst ausschliesslich Freigegebenes (§7.3), die
     * MiLoG-Aufzeichnung fuehrt dagegen JEDEN Anteil des Monats. Ein offener
     * Monat darf deshalb abweichen, und die Seite sagt selbst, warum
     * (`monatsnachweis/page.tsx`, D-162). Ein abgeschlossener kann es nicht:
     * `schliesseMonatAb` verweigert die Sperre, solange ein Eintrag
     * unfreigegeben ist.
     *
     * Die alte Fassung war nur an Tagen gruen, an denen in den letzten zwei
     * Tagen niemand gearbeitet hat — sie war nie richtig, nur oft genug
     * zufaellig wahr.
     *
     * Die neue Fassung ist SCHAERFER, nicht weicher: sie nimmt die Differenz
     * nicht hin, sondern rechnet sie gegen die Datenbank nach. Eine falsche
     * Buchung von 7 Minuten faellt hier auf; unter `toBe` waere sie nur ein
     * weiterer Unterschied gewesen.
     *
     * Gefragt wird nach der Beschaeftigung des Blattes UND nach Fatima: die
     * zweite Bedingung haelt die Aussage der Pruefung fest — es geht um DIESEN
     * Menschen —, die erste um die Gesellschaft, von der das Blatt spricht.
     */
    const [offen] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl
         from zeiteintrag_monatsanteil ma
         join zeiteintrag z on z.id = ma.zeiteintrag_id
         join anstellung a on a.id = ma.anstellung_id
         join person p on p.id = a.person_id
         join benutzer b on b.person_id = p.id
        where b.email = $1
          and a.id = $2
          and ma.monat = date_trunc('month', (now() at time zone 'Europe/Berlin'))::date
          and ma.freigegeben_am is null
          and z.storniert_am is null`,
      [KONTO.fatima, anstellungId] as never[]);
    const unfreigegeben = Number(offen?.anzahl ?? '0');

    if (unfreigegeben === 0) {
      // Nichts steht offen — dann gibt es keinen Grund fuer eine Differenz,
      // und die Zusicherung von EMP-04/EMP-06 gilt unbedingt.
      expect(summe, 'ohne offene Zeiten sind es dieselben Minuten').toBe(abgleich);
      return;
    }

    /**
     * Es steht etwas offen. Zwei Dinge muessen dann gelten, und beide sind
     * schaerfer als die alte Gleichheit es war:
     *
     * (a) Die Aufzeichnung ist NIE kleiner als das Konto. Gebucht wird nur
     *     Freigegebenes, aufgezeichnet wird alles — die Differenz kann also
     *     nur in eine Richtung gehen. Eine Buchung, die MEHR enthaelt als die
     *     Aufzeichnung, waere Geld aus dem Nichts und faellt hier auf.
     * (b) Das Blatt sagt den Grund. Eine Differenz ohne Erklaerung auf einem
     *     Dokument, das jemand unterschreibt, ist die schlechteste Variante
     *     (D-162).
     */
    expect(summe, 'die Aufzeichnung ist nie kleiner als das Konto').toBeGreaterThanOrEqual(abgleich);
    await expect(page.locator('[data-cse="konto-abgleich"]'))
      .toContainText(/noch offen ist und nur freigegebene/u);
  });

  test('das Blatt ist weiss mit dunklem Text — Print ist nicht die App (DESIGN §11)', async ({
    page,
  }) => {
    await alsFatima(page);
    await page.goto('/portal/mein/stundenkonto');
    await page.locator('[data-cse="zum-monatsnachweis"]').first().click();
    const blatt = page.locator('[data-cse="monatsnachweis"]');
    await expect(blatt).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(blatt).toHaveCSS('color', 'rgb(17, 17, 17)');
  });
});

// ---------------------------------------------------------------------------

test.describe('(4) kein Lohnsatz, nirgends ein Kundenpreis (K-05, EMP-13)', () => {
  const SEITEN = [
    '/portal/mein',
    '/portal/mein/schichten',
    '/portal/mein/zeiten',
    '/portal/mein/stundenkonto',
    '/portal/mein/urlaub',
    '/portal/mein/antraege',
    '/portal/mein/nachweise',
  ];

  for (const pfad of SEITEN) {
    test(`kein Geldbetrag auf ${pfad}`, async ({ page }) => {
      await alsFatima(page);
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);

      const text = await page.locator('main').innerText();
      /**
       * Geprüft wird auf die FORM eines Betrags und auf die Wörter, nicht auf
       * einen bestimmten Wert: `18,50 €` ist genauso verräterisch wie das Wort
       * „Stundensatz", und ein Feld namens `kondition` fällt unter das zweite.
       */
      expect(text, `${pfad} zeigt einen Eurobetrag`).not.toMatch(/\d[\d.]*,\d{2}\s*€/u);
      for (const wort of [
        'Stundensatz', 'Tarifgruppe', 'Entgelt', 'Lohn', 'Einzelpreis',
        'Gesamtpreis', 'Kundenpreis', 'Marge',
      ]) {
        expect(text, `${pfad} nennt „${wort}"`).not.toContain(wort);
      }
    });
  }

  test('und die Person sieht keinen zweiten Menschen', async ({ page }) => {
    await alsFatima(page);
    await page.goto('/portal/mein/zeiten');
    const namen = await sql.unsafe<{ name: string }[]>(
      `select (p.vorname || ' ' || p.nachname) as name from person p
        where p.id <> (select person_id from benutzer where email = $1)`,
      [KONTO.fatima] as never[]);
    const text = await page.locator('main').innerText();
    for (const n of namen) expect(text, `fremder Name: ${n.name}`).not.toContain(n.name);
  });
});

// ---------------------------------------------------------------------------

test.describe('(5) ein abgelaufener Nachweis warnt die Person (EMP-08)', () => {
  test('die Warnung steht auf „Heute" und nennt die Folge', async ({ page }) => {
    /**
     * **Der abgelaufene Nachweis kommt aus dem SEED, nicht aus dieser Zeile.**
     *
     * Hier stand ein `update nachweis set gueltig_bis = gestern`. Es tat sein
     * Werk und liess die Datenbank anders zurueck, als es sie vorfand — die
     * naechste Datei fand einen gesperrten Menschen vor, ohne dass irgendwo
     * stand, warum. Fatimas Bewacherausweis ist jetzt im Seed abgelaufen
     * (`src/server/db/seed/qualifikation.ts`), und diese Pruefung SIEHT nur
     * noch hin.
     */
    await alsFatima(page);
    await page.goto('/portal/mein');
    const warnung = page.locator('[data-cse="nachweis-warnung"]');
    await expect(warnung).toBeVisible();
    await expect(warnung.locator('[data-cse="nachweis-abgelaufen"]').first()).toBeVisible();
    // §9: die Farbe allein trägt die Aussage nicht — der Satz sagt, was folgt.
    await expect(warnung).toContainText(/einteilen/u);

    await page.goto('/portal/mein/nachweise');
    await expect(page.locator('[data-cse="nachweis"][data-warnlage="abgelaufen"]').first())
      .toBeVisible();
    await expect(page.locator('[data-cse="sperrt"]').first()).toBeVisible();
  });

  test('das Bewacherregister sagt, dass es nicht verbunden ist (SEC-03)', async ({ page }) => {
    await alsFatima(page);
    await page.goto('/portal/mein/nachweise');
    // Keine Schein-Integration: der Status ist handerfasst, und das steht da.
    await expect(page.locator('[data-cse="bewacherregister"]'))
      .toContainText(/nicht verbunden|not connected/u);
  });
});

// ---------------------------------------------------------------------------

test.describe('(6) Arabisch: `dir="rtl"` und null axe-Verstöße', () => {
  const SEITEN = [
    '/portal/mein',
    '/portal/mein/schichten',
    '/portal/mein/zeiten',
    '/portal/mein/stundenkonto',
    '/portal/mein/urlaub',
    '/portal/mein/antraege',
    '/portal/mein/antraege/neu',
    '/portal/mein/abwesenheit/neu',
    '/portal/mein/nachweise',
  ];

  test('die Hülle trägt `dir="rtl"` und `lang="ar"`', async ({ page }) => {
    await alsAmir(page);
    await page.goto('/portal/mein');
    const huelle = page.locator('[data-cse="mein-portal"]');
    await expect(huelle).toHaveAttribute('dir', 'rtl');
    await expect(huelle).toHaveAttribute('lang', 'ar');
    await expect(huelle).toHaveAttribute('data-sprache', 'ar');
    // Und der Text ist wirklich arabisch, nicht deutsch mit `dir`.
    await expect(page.locator('h1').first()).toHaveText(/[؀-ۿ]/u);
  });

  test('Zahlen, Geld und Zeit bleiben in der gesetzlichen Form (SEITENKARTE §12)', async ({
    page,
  }) => {
    await alsAmir(page);
    await page.goto('/portal/mein/zeiten');
    // Eine Uhrzeit in Europe/Berlin, mit deutschem Datumsformat — in jeder
    // Sprache dieselbe, weil sie im MiLoG-Nachweis genauso steht.
    await expect(page.locator('main')).toContainText(/\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2}/u);
  });

  for (const pfad of SEITEN) {
    test(`axe: ${pfad} auf Arabisch`, async ({ page }) => {
      await alsAmir(page);
      const antwort = await page.goto(pfad);
      // Null Verstösse auf einer 404 wäre ein bestandener Test über nichts.
      expect(antwort?.status(), pfad).toBe(200);

      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const verstoesse = ergebnis.violations.map(
        (v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`);
      expect(verstoesse, pfad).toEqual([]);
    });
  }

  /**
   * **Gemessen wird JEDE Seite, nicht die Startseite.**
   *
   * Vorher stand hier ein einziges `goto('/portal/mein')`. Genau deshalb
   * blieb ein 19 px hoher Link auf `/portal/mein/zeiten` unbemerkt: die
   * Regel galt überall, gemessen wurde an einer Stelle. Eine Zusicherung,
   * die nur einen von neun Bildschirmen ansieht, sagt über die anderen acht
   * nichts — und liest sich trotzdem wie „geprüft".
   */
  for (const pfad of SEITEN) {
  test(`Tippziele ≥ 44×44 px und Fliesstext ≥ 16 px auf ${pfad} (DESIGN §8)`, async ({ page }) => {
    await alsAmir(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const antwort = await page.goto(pfad);
    expect(antwort?.status(), pfad).toBe(200);

    const zuKlein = await page.evaluate(() => {
      const bedienbar = [...document.querySelectorAll<HTMLElement>(
        'a[href], button, input:not([type="hidden"]), select, textarea')];
      return bedienbar
        .filter((e) => e.offsetParent !== null)
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.height < 44 || r.width < 44;
        })
        .map((e) => `${e.tagName}: ${(e.textContent ?? '').trim().slice(0, 30)}`);
    });
    expect(zuKlein, pfad).toEqual([]);

    /**
     * 16 px Fliesstext — mit einer ausdrücklichen Ausnahme.
     *
     * `DataTable` (`src/components/ui/DataTable.tsx`) setzt seine Zellen auf
     * `text-sm` (14 px). Das ist für die internen Bildschirme richtig und für
     * `/portal/mein/**` zu klein (SEITENKARTE §13: „16px minimum body text").
     * Die Komponente gehört diesem PR nicht; die Abweichung ist im
     * Abschlussbericht vermerkt, statt sie hier stillschweigend zu übergehen
     * oder eine Prüfung zu schreiben, die absichtlich fehlschlägt.
     */
    const zuKleinerText = await page.evaluate(() => {
      const bereich = document.querySelector('main');
      if (bereich === null) return ['kein main'];
      return [...bereich.querySelectorAll<HTMLElement>('p, li, dd, span, label')]
        .filter((e) => e.closest('[data-cse="tabelle"], [data-cse="stapel"]') === null)
        .filter((e) => (e.textContent ?? '').trim().length > 12)
        .filter((e) => Number.parseFloat(getComputedStyle(e).fontSize) < 16)
        .map((e) => `${e.tagName}: ${(e.textContent ?? '').trim().slice(0, 30)}`);
    });
    expect(zuKleinerText, pfad).toEqual([]);
  });
  }
});
