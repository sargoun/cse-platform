/**
 * **Kein gezeigter Verweis führt ins Nichts** (AUT-06).
 *
 * Diese Prüfung geht durch das Portal wie ein Mensch: sie steuert keine
 * Adressliste an, sondern folgt den Verweisen, die auf den Seiten wirklich
 * stehen. Genau das hat gefunden, was keine andere Prüfung sah:
 *
 *  - **97 Ziele mit 404**, weil elf Seiten den ABSCHNITT statt der
 *    Portalwurzel durchreichten und damit ihre ganze Seitenleiste brachen
 *    (D-566). Jede einzelne Seite sah dabei richtig aus; der Fehler stand in
 *    der Navigation daneben.
 *  - **sechs Knöpfe, deren Ziel die Sitzung nicht öffnen darf** — „Budget",
 *    „Schrittprotokoll", „MiLoG-Nachweise", „Neuer Entwurf", „Prüfdauer",
 *    „Zugang und Anmeldecode". Ein Menüpunkt, der auf 404 führt, ist
 *    schlechter als keiner: er verrät die Existenz dessen, was er nicht
 *    zeigen darf.
 *
 * **Fünf Menschen statt einem, und bis zum Ende statt bis 150.** Bis D-574
 * lief hier genau ein Lauf: `leitung` in `reinigung`, abgebrochen nach 150
 * Seiten. Beides war eine Stichprobe, die sich als Zusicherung las. Die
 * `leitung` sieht die Gruppenansicht nicht, betritt das Mitarbeiterportal
 * nicht und den Kundenzugang erst recht nicht — drei ganze Oberflächen, in
 * denen ein toter Verweis unbemerkt geblieben wäre. Und die Grenze von 150
 * schnitt genau dort ab, wo die Seiten selten werden und ein Fehler am
 * längsten überlebt.
 *
 * **Jeder Lauf geht jetzt bis die Schlange leer ist** und sagt, wie weit er
 * kam. Die Obergrenze darüber ist ein Ausreisser-Riegel, kein Stichprobenmass:
 * wird sie erreicht, FÄLLT die Prüfung, statt still weniger zu prüfen.
 *
 * **Eigener Browserkontext je Mensch.** Sonst nimmt die zweite Anmeldung die
 * Kekse der ersten mit, und ein Umleitungsrennen macht aus einem Befund eine
 * Laune. Dieselbe Lehre wie in `abmessungen.spec.ts`.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

/**
 * Der Ausreisser-Riegel je Lauf — **keine Stichprobengrösse.**
 *
 * Er fängt eine Schlange, die sich selbst nachlegt (eine Abfrage, die bei
 * jedem Aufruf eine neue erzeugt), und nichts sonst. Wird er erreicht, ist
 * das ein Fehlschlag mit Namen und nicht eine leise verkürzte Prüfung.
 */
const RIEGEL = 700;

/**
 * Ziele, die 404 geben DÜRFEN — und die Liste ist leer.
 *
 * Sie steht hier, damit eine Ausnahme eine Entscheidung ist und kein
 * weicher gemachter Vergleich. Wer hier etwas einträgt, schreibt daneben,
 * warum der Verweis trotzdem gezeigt wird.
 */
const ERLAUBT: readonly string[] = [];

/**
 * Was der Lauf nicht betritt — und beides aus DEMSELBEN Grund: es würde die
 * Sitzung wechseln, unter der geprüft wird.
 *
 * `/auth/abmelden` steht in jedem Kopf. Ihm zu folgen heisst, sich mitten im
 * Lauf abzumelden; alles danach ist dann die Anmeldeseite, und der Lauf
 * meldet 400 heile Verweise auf einen Bildschirm, den er nie sehen sollte.
 * Genau dieser Fehler hat die Messreihe (`abmessungen.spec.ts`) einmal 71
 * statt 24 Seiten „messen" lassen. `/dev/` ist dasselbe von vorn: dort steht
 * die Entwicklungsanmeldung, ein Klick genügt für einen anderen Menschen.
 */
const NICHT_FOLGEN = [/^\/auth\/abmelden/u, /^\/dev\//u, /^\/api\//u];

interface Lauf {
  readonly name: string;
  readonly konto: string;
  readonly start: string;
  /** Der Boden: darunter ist die Oberfläche geschrumpft, nicht der Lauf. */
  readonly mindestens: number;
  /** Erst den Mandanten wählen? Nur wo die Anmeldung mehrere anbietet. */
  readonly wechsel?: boolean;
}

/**
 * Fünf Oberflächen, fünf Rechtelagen.
 *
 * **Die `leitung` ist mit Absicht dabei.** Sie hält viel und nicht alles —
 * genau die Lage, in der ein ungeprüfter Knopf auffällt. Eine
 * Super-Administration hält jedes Recht und sähe keinen einzigen dieser Fälle;
 * deshalb steht sie DANEBEN und nicht STATT dessen: sie erreicht Seiten, die
 * der `leitung` verborgen bleiben, und dort gilt dieselbe Regel.
 *
 * `fatima` ist der Mitarbeiterweg (EMP-01) und `kunde` der Kundenzugang —
 * zwei Oberflächen mit eigener Navigation, die bis D-574 niemand abgelaufen
 * ist.
 */
const LAEUFE: readonly Lauf[] = [
  { name: 'leitung · reinigung', konto: KONTO.leitungReinigung, start: '/portal/reinigung', mindestens: 60, wechsel: true },
  { name: 'admin · reinigung', konto: KONTO.adminReinigung, start: '/portal/reinigung', mindestens: 60, wechsel: true },
  { name: 'gruppe', konto: KONTO.gruppe, start: '/portal/gruppe', mindestens: 8 },
  { name: 'mitarbeiterin', konto: KONTO.fatima, start: '/portal/mein', mindestens: 4 },
  { name: 'kundin', konto: KONTO.kunde, start: '/portal/kunde', mindestens: 2 },
];

/**
 * Ein Ziel auf seine Form bringen — **Anker weg, Abfrage aufbewahrt.**
 *
 * Die Abfrage BLEIBT am ersten Fund eines Pfades stehen (ein Bericht ohne
 * `?jahr=` zeigt etwas anderes als mit), aber sie zählt nicht als zweite
 * Seite: sonst wäre jede Jahres- und Rasterzeile ein eigener Aufruf, und der
 * Lauf verbrächte seine Zeit in einem einzigen Bericht, statt in die Breite
 * zu gehen.
 */
function schluessel(ziel: string): string {
  return ziel.split('#')[0]!.split('?')[0]!;
}

const IST_KENNUNG =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|\d{4}-\d{2}-\d{2})$/iu;

/**
 * Die ROUTENFORM eines Pfades — `…/objekte/<uuid>` wird `…/objekte/:id`.
 *
 * **Warum das nötig ist.** Ein Lauf bis zur Leere besucht sonst jede Zeile
 * jeder Liste: vierzig Objekte sind vierzig Aufrufe DESSELBEN Bildschirms mit
 * anderen Daten. Gesucht wird hier aber ein totes ZIEL, und das hängt an der
 * Route, nicht an der Zeile. Ein paar Vertreter je Form genügen — und bringen
 * den Lauf von „läuft in die Zeitgrenze" auf „ist in Minuten durch".
 */
function form(pfad: string): string {
  return pfad.split('/').map((t) => (IST_KENNUNG.test(t) ? ':id' : t)).join('/');
}

/** Wie viele Vertreter je Routenform. Drei: einer allein verdeckt einen Ausreisser. */
const JE_FORM = 3;

async function laufe(browser: Browser, lauf: Lauf): Promise<{ besucht: number; kaputt: string[] }> {
  const kontext = await browser.newContext();
  const seite: Page = await kontext.newPage();
  try {
    await alsKonto(seite, lauf.konto);
    await seite.goto(lauf.start);
    if (lauf.wechsel === true) {
      const wechsel = seite.locator('[data-cse="wechsel-knopf"]');
      if ((await wechsel.count()) > 0) await wechsel.click();
    }

    const gesehen = new Set<string>();
    const proForm = new Map<string, number>();
    const warteschlange = [lauf.start];
    const kaputt: string[] = [];
    let uebersprungen = 0;

    while (warteschlange.length > 0 && gesehen.size < RIEGEL) {
      const ziel = warteschlange.shift()!;
      const s = schluessel(ziel);
      if (gesehen.has(s)) continue;
      const f = form(s);
      const bisher = proForm.get(f) ?? 0;
      if (bisher >= JE_FORM) { uebersprungen += 1; continue; }
      proForm.set(f, bisher + 1);
      gesehen.add(s);

      const antwort = await seite.goto(ziel, { waitUntil: 'domcontentloaded' }).catch(() => null);
      const status = antwort?.status() ?? 0;
      const h1 = await seite.locator('h1').first().innerText().catch(() => '');
      const schlecht = status >= 500 || /gibt es hier nicht|schiefgegangen/iu.test(h1);
      if (schlecht) {
        if (!ERLAUBT.includes(s)) {
          kaputt.push(`[${lauf.name}] ${ziel} → ${String(status)} ${h1.replace(/\s+/gu, ' ').slice(0, 40)}`);
        }
        continue;
      }

      const ziele = await seite.locator('a[href^="/"]').evaluateAll(
        (els) => els.map((e) => e.getAttribute('href') ?? ''));
      for (const z of ziele) {
        if (z === '') continue;
        if (NICHT_FOLGEN.some((r) => r.test(z))) continue;
        if (gesehen.has(schluessel(z))) continue;
        warteschlange.push(z);
      }
    }

    console.log(`[verweise] ${lauf.name}: ${gesehen.size} Seiten in `
      + `${proForm.size} Routenformen, ${uebersprungen} weitere Vertreter `
      + `uebersprungen, ${warteschlange.length} offen, ${kaputt.length} kaputt`);
    expect(warteschlange.length,
      `[${lauf.name}] der Riegel von ${RIEGEL} Seiten hat gegriffen — die Schlange `
      + 'legt sich selbst nach, oder die Oberflaeche ist ueber Nacht gewachsen')
      .toBe(0);
    expect(gesehen.size,
      `[${lauf.name}] weniger als ${lauf.mindestens} erreichbare Seiten — die `
      + 'Oberflaeche ist geschrumpft oder ein Verweis fehlt')
      .toBeGreaterThanOrEqual(lauf.mindestens);
    return { besucht: gesehen.size, kaputt };
  } finally {
    await kontext.close();
  }
}

for (const lauf of LAEUFE) {
  test(`kein gezeigter Verweis führt auf 404 oder 500 — ${lauf.name}`, async ({ browser }) => {
    test.setTimeout(12 * 60_000);
    const { kaputt } = await laufe(browser, lauf);
    expect(kaputt, 'gezeigte Verweise, die ins Nichts führen').toEqual([]);
  });
}
