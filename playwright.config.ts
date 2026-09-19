import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * The pre-installed Chromium is used where it exists, rather than downloading
 * a second copy: this environment ships one at /opt/pw-browsers/chromium and a
 * pinned @playwright/test may want a different build number.
 */
const VORHANDEN = '/opt/pw-browsers/chromium';
const chromium = existsSync(VORHANDEN) ? { executablePath: VORHANDEN } : {};

export default defineConfig({
  testDir: './tests/e2e',
  /**
   * **Ein Arbeiter, und das ist kein Rueckschritt.**
   *
   * Die Suite teilt sich EINE Datenbank und darf nichts loeschen
   * (Invariante 8): keine Fixtur raeumt hinter sich auf, jede Zeile bleibt
   * stehen. Mit mehreren Arbeitern messen die Pruefungen deshalb einander
   * statt des Produkts — und zwar auf die unangenehmste Art: jeder Lauf faellt
   * woanders um.
   *
   * Der Beleg aus dieser Nacht, drei Laeufe hintereinander auf demselben
   * Stand: einmal `rechnung.spec.ts` („Position hinzufuegen" war noch nicht
   * durch), einmal `dienstplan.spec.ts` (die Karte war weg, aber unquittiert),
   * einmal `abwesenheit.spec.ts` („element(s) not found" fuer ein Formular,
   * das ein Nachbar Sekunden vorher abgeraeumt hatte). Drei verschiedene
   * Dateien, dieselbe Ursache — und jedes Mal eine Stunde Suche nach einem
   * Produktfehler, den es nicht gab. `mode: 'serial'` je Datei half nicht: die
   * Nachbarn stehen in ANDEREN Dateien.
   *
   * **Was dadurch NICHT verloren geht.** Nebenlaeufigkeit ist hier nie
   * Prueflast gewesen: dass zwei Sitzungen gleichzeitig sauber arbeiten,
   * beweist die Isolationssuite an echtem Postgres — mit Sperren, Policies und
   * `FOR UPDATE`. Der Browser prueft Wege durch die Oberflaeche, und die sind
   * seriell genauso wahr.
   *
   * **Was es kostet:** etwa acht Minuten statt drei. Das ist der Preis dafuer,
   * dass ein roter Lauf wieder etwas bedeutet.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] !== undefined ? 2 : 0,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...chromium,
          // The container runs as root; Chromium's sandbox needs user
          // namespaces that are not available here.
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000/healthz',
    env: {
      // The suite must axe-test the real production build, not a development
      // render with its overlays — so the dev surfaces are switched on for this
      // one build. Nothing else sets the flag, so a deployment ships a 404.
      CSE_DEV_FLAECHEN: '1',
      /**
       * The public pages read their content from `seite`/`abschnitt` (PUB-07),
       * so the suite needs a real database — the same throwaway Postgres the
       * isolation suite uses, seeded and content-imported first.
       *
       * A fixture page with hard-coded copy would need none of this, and that
       * was the problem: it could keep every promise while the delivered page
       * broke them.
       *
       * **Wenn der Server ein Passwort verlangt, muss `DATABASE_URL` gesetzt
       * sein** — die Vorgabe hier traegt keines, weil `scripts/test-db.sh`
       * einen Server mit `--auth=trust` startet und CI einen Dienst-Container
       * ohne Passwort reicht. Zeigt die Adresse auf einen VORHANDENEN Server
       * mit Passwortpflicht, kommt die Anwendung nicht an die Datenbank, und
       * dann antwortet JEDE oeffentliche Seite mit 500 — der Lauf meldet
       * vierzig Barrierefreiheitsfehler, die keine sind.
       *
       * Die Bereitschaftsprobe faengt das NICHT: `/healthz` liest bewusst
       * keine Zeile (das ist ihr Zweck), antwortet also 200, und Playwright
       * startet zufrieden. Wer hier vierzig rote Routen sieht, prueft zuerst
       * `curl localhost:3000/` — 500 heisst Datenbank, nicht Barrierefreiheit.
       */
      DATABASE_URL:
        process.env['DATABASE_URL']
        ?? process.env['TEST_DATABASE_URL']
        ?? 'postgres://postgres@localhost:55432/cse_test',
      // O-08 is open, so the canonical host is the request host. Pinning it
      // here keeps `sitemap.xml` and every JSON-LD `@id` assertable.
      CSE_KANONISCHE_BASIS: 'http://localhost:3000',
    },
    reuseExistingServer: false,
    /**
     * **600 Sekunden, und das ist gemessen, nicht geraten.**
     *
     * Hier standen 180. `webServer.command` ist `pnpm build && pnpm start`, und
     * der Bau dauerte bei 439 Routen und warmem Cache **3 min 13 s** — also
     * dreizehn Sekunden zu lang. Die Folge war kein Testfehler, sondern
     * „Timed out waiting 180000ms from config.webServer": die ganze Suite lief
     * gar nicht erst an, und das sieht in einem Protokoll aus wie ein
     * kaputter Server.
     *
     * Die Zahl ist die Bauzeit mal drei. Nicht knapp darüber: ein kalter Cache
     * (frischer Container, erster Lauf nach `pnpm install`) braucht deutlich
     * länger als ein warmer, und ein Zeitlimit, das genau bis zum Messwert
     * reicht, fällt beim nächsten Route-Zuwachs wieder.
     *
     * **Und genau das ist eingetreten — 19.09.2026.** Der Bau misst jetzt
     * **599 s**: eine Sekunde unter dem Limit. Die Suite lief nicht mehr
     * durch, sondern meldete „Timed out waiting 600000ms from
     * config.webServer" und führte KEINE einzige Prüfung aus. Das sieht aus
     * wie ein kaputter Server und ist eine zu knappe Zahl.
     *
     * Der Grund ist kein Defekt: zwischen den beiden Messungen sind 826
     * Dateien und 174 000 Zeilen dazugekommen, und die Seitenkarte führt 439
     * Adressen. 193 s → 599 s ist der Preis dafür.
     *
     * Deshalb wieder derselbe Faktor wie damals (193 → 600, gut dreifach):
     * 599 → 1 800. Wer die Zahl das nächste Mal anfasst, misst vorher und
     * schreibt den Messwert hierher — ein Limit ohne Messung ist geraten, und
     * ein geratenes Limit kostet einen ganzen Lauf.
     */
    timeout: 1_800_000,
  },
});
