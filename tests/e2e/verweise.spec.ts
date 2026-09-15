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
 * **Die `leitung` ist mit Absicht die Rolle hier.** Sie hält viel und nicht
 * alles — genau die Lage, in der ein ungeprüfter Knopf auffällt. Eine
 * Super-Administration hält jedes Recht und sähe keinen einzigen dieser Fälle.
 *
 * Die Grenze von 150 Seiten hält den Lauf unter zwei Minuten. Sie ist eine
 * Stichprobe der Breite, keine Vollständigkeitszusage — und `log` sagt am
 * Ende, wie weit sie gekommen ist, damit eine schrumpfende Abdeckung nicht
 * unbemerkt bleibt.
 */
import { expect, test } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';

const GRENZE = 150;

/**
 * Ziele, die 404 geben DÜRFEN — und die Liste ist leer.
 *
 * Sie steht hier, damit eine Ausnahme eine Entscheidung ist und kein
 * weicher gemachter Vergleich. Wer hier etwas einträgt, schreibt daneben,
 * warum der Verweis trotzdem gezeigt wird.
 */
const ERLAUBT: readonly string[] = [];

test('kein gezeigter Verweis führt auf 404 oder 500 — als `leitung`', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await alsKonto(page, KONTO.leitungReinigung);
  await page.goto('/portal/reinigung');
  const wechsel = page.locator('[data-cse="wechsel-knopf"]');
  if ((await wechsel.count()) > 0) await wechsel.click();

  const gesehen = new Set<string>();
  const warteschlange = ['/portal/reinigung'];
  const kaputt: string[] = [];

  while (warteschlange.length > 0 && gesehen.size < GRENZE) {
    const pfad = warteschlange.shift()!;
    if (gesehen.has(pfad)) continue;
    gesehen.add(pfad);

    const antwort = await page.goto(pfad, { waitUntil: 'domcontentloaded' }).catch(() => null);
    const status = antwort?.status() ?? 0;
    const h1 = await page.locator('h1').first().innerText().catch(() => '');
    const schlecht = status >= 500
      || /gibt es hier nicht|schiefgegangen/iu.test(h1);
    if (schlecht && !ERLAUBT.includes(pfad)) {
      kaputt.push(`${pfad} → ${String(status)} ${h1.replace(/\s+/gu, ' ').slice(0, 40)}`);
      continue;
    }
    if (schlecht) continue;

    const ziele = await page.locator('a[href^="/"]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const z of ziele) {
      const rein = z.split('#')[0]!;
      // `/api/` ist kein Bildschirm; eine Abfrage daran ist eine andere Sache.
      if (rein === '' || rein.startsWith('/api/') || gesehen.has(rein)) continue;
      warteschlange.push(rein);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[verweise] ${gesehen.size} Seiten besucht, ${kaputt.length} kaputt`);
  expect(gesehen.size, 'die Stichprobe ist geschrumpft — das Portal ist kleiner '
    + 'geworden oder ein Verweis fehlt').toBeGreaterThan(60);
  expect(kaputt, 'gezeigte Verweise, die ins Nichts führen').toEqual([]);
});
