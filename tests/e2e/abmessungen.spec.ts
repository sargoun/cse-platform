/**
 * **Die Masse der Seite — gemessen, nicht betrachtet.**
 *
 * Gemeldet mit einem Bildschirmfoto: die Kacheln klebten am Fensterrand. Nicht
 * auf einer Seite — auf **jeder** Seite des Portals, in jeder Breite, seit dem
 * Tag, an dem die Safe-area-Regeln aus DESIGN §8 dazukamen.
 *
 * **Warum nichts davon rot wurde.** Die Regeln standen als `padding` in
 * `globals.css`, und diese Datei wird NACH Tailwinds erzeugten Klassen
 * geladen: `.sicher-seiten` und `p-s5` sind zwei Deklarationen derselben
 * Eigenschaft mit derselben Spezifitaet, und die spaetere gewinnt. Am
 * Schreibtisch, wo jeder Inset `0px` ist, hiess das `padding-left: 0px`.
 * Keine Regel war verletzt — es trafen sich zwei richtige. Lint sah kein CSS,
 * `typecheck` sah Klassennamen, die Vertragspruefung sah beide Klassen
 * vorhanden, und der Browserlauf pruefte Wege, keine Masse.
 *
 * **Diese Datei prueft Masse.** Sie fragt den Browser nach dem, was am Ende
 * wirklich gerechnet wurde — `getComputedStyle` und `getBoundingClientRect` —,
 * und zwar an zwei Breiten, weil ein Rand, der am Schreibtisch stimmt, am
 * Telefon fehlen kann und umgekehrt.
 *
 * Sie ersetzt die Vertragspruefung in `tests/design/sichere-flaeche.test.ts`
 * nicht: die haelt fest, dass die Zeilen ueberhaupt dastehen (headless
 * Chromium meldet jeden Inset als `0px`, kennt also keine Notch). Diese hier
 * haelt fest, dass sie die Seite nicht kaputt machen.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { alsKonto, KONTO } from './hilfen/anmeldung';
import { ROUTEN } from '@/server/registry/routen.generiert';

/** `--s5` aus `globals.css` — die Rinne der Inhaltsspalte (DESIGN §3). */
const RINNE = 24;
/** Die Rinne, die Text auf der oeffentlichen Seite mindestens haelt. */
const TEXTRINNE = 16;

const BREITEN = [
  { name: 'Telefon', breite: 390, hoehe: 844 },
  { name: 'Tablet', breite: 768, hoehe: 1024 },
  { name: 'Laptop', breite: 1024, hoehe: 768 },
  { name: 'Schreibtisch', breite: 1440, hoehe: 900 },
] as const;

/**
 * **Zwei Oberflaechen, zwei Regeln — und das ist keine Ausnahme, sondern der
 * Unterschied zwischen ihnen.**
 *
 * Die Portalspalte ist EIN Kasten mit einer Rinne: `<main class="p-s5">`, und
 * dass diese Rinne dasteht, ist genau der Befund, der diese Datei ausgeloest
 * hat. Die oeffentliche Seite ist das Gegenteil — sie besteht aus Baendern,
 * die absichtlich bis an den Rand laufen (DESIGN §7: full-bleed sections,
 * inner container), und ein `padding` am `<main>` waere dort falsch.
 *
 * Geprueft wird deshalb dort, was der Mensch sieht: **kein TEXT beruehrt den
 * Rand.** Ein Farbband darf es, eine Zeile nicht.
 */
function istPortalspalte(pfad: string): boolean {
  return pfad.startsWith('/portal');
}

/** Was der Browser am Ende wirklich gerechnet hat. */
async function masse(page: Page) {
  return page.evaluate(() => {
    const zahl = (w: string) => Number.parseFloat(w) || 0;
    const haupt = document.querySelector('main');
    const kopf = document.querySelector('header');
    const hs = haupt === null ? null : getComputedStyle(haupt);
    const ks = kopf === null ? null : getComputedStyle(kopf);
    const wurzel = document.documentElement;
    const breite = wurzel.clientWidth;

    /*
     * Der schmalste Abstand, den eine Zeile TEXT zum Fensterrand haelt.
     * Gezaehlt wird nur, wo wirklich Text steht (ein Kind-Textknoten mit
     * Inhalt) und was man sieht — eine Zeile im zugeklappten `details` traegt
     * nichts zum Bild bei und misst 0.
     */
    let schmalste = breite;
    let wer = '';
    for (const e of document.querySelectorAll<HTMLElement>('main *')) {
      const hatText = [...e.childNodes].some(
        (k) => k.nodeType === 3 && (k.textContent ?? '').trim() !== '');
      if (!hatText) continue;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || st.display === 'none' || st.position === 'fixed') continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const abstand = Math.min(r.left, breite - r.right);
      if (abstand < schmalste) {
        schmalste = abstand;
        wer = `${e.tagName.toLowerCase()}.${e.className.toString().slice(0, 40)}`;
      }
    }

    return {
      hatHaupt: haupt !== null,
      /* Polsterung UND Rahmen: der Safe-area-Inset ist ein Rahmen (DESIGN §8). */
      links: hs === null ? -1 : zahl(hs.paddingLeft) + zahl(hs.borderLeftWidth),
      rechts: hs === null ? -1 : zahl(hs.paddingRight) + zahl(hs.borderRightWidth),
      kopfLinks: ks === null ? -1 : zahl(ks.paddingLeft) + zahl(ks.borderLeftWidth),
      ueberbreite: wurzel.scrollWidth - breite,
      /*
       * Ein Element, das ueber den rechten Rand ragt — mit Namen und Mass,
       * sonst sucht man es hinterher von Hand.
       *
       * **`body *` und nicht `main *`.** Die erste Fassung sah nur in die
       * Inhaltsspalte und meldete bei
       * `buchhaltung/verfahrensdokumentation` 133px Ueberbreite mit LEERER
       * Liste — der Ausreisser stand ausserhalb. Eine Diagnose, die den Ort
       * nicht findet, ist keine.
       */
      ausreisser: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((e) => {
          const st = getComputedStyle(e);
          if (st.display === 'none' || st.visibility === 'hidden') return false;
          return e.getBoundingClientRect().right > breite + 1;
        })
        .slice(0, 4)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return `${e.tagName.toLowerCase()}.${e.className.toString().slice(0, 36)}`
            + `[${String(Math.round(r.left))}…${String(Math.round(r.right))}]`;
        }),
      /*
       * **Der Ausreisser, den kein Kasten verraet.**
       *
       * `buchhaltung/verfahrensdokumentation` lief 133px ueber, und die Liste
       * darueber blieb LEER: ein SHA-256 ist ein Wort aus 64 Zeichen ohne
       * Trennstelle — der Kasten blieb in der Spalte, die SCHRIFT lief
       * darueber hinaus. `getBoundingClientRect()` gibt den Kasten zurueck und
       * sieht davon nichts; `scrollWidth` des Elements sieht es.
       */
      ueberlaufend: (() => {
        const alle = [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((e) => {
            if (e.scrollWidth <= e.clientWidth + 1) return false;
            const st = getComputedStyle(e);
            return st.overflowX === 'visible' && st.display !== 'none';
          });
        /*
         * **Die INNERSTEN zuerst, nicht die aeussersten.**
         *
         * `querySelectorAll` gibt Dokumentreihenfolge zurueck, also Vorfahren
         * vor Kindern — und `.slice(0, 4)` behielt damit genau das falsche
         * Ende. Auf `buchhaltung/verfahrensdokumentation` fuellten vier
         * Vorfahren (`div.sicher-oben`, `a.spur-zurueck`, `div.flex flex-1`,
         * `main`) die ganze Liste, und der Ort stand nicht dabei: ein
         * Ueberlauf laeuft nach OBEN durch, jeder Vorfahr meldet ihn mit.
         *
         * Das hat zwei Runden gekostet — erst war die Ueberschrift verdaechtig,
         * dann die Kopfzeile, und der eigentliche Ort kam erst zum Vorschein,
         * als die davor behoben waren. Wer einen Vorfahren meldet, schickt
         * den Nachfolger auf die Suche.
         *
         * Also: wer ein anderes gemeldetes Element ENTHAELT, faellt raus. Uebrig
         * bleibt, was den Ueberlauf wirklich verursacht.
         */
        return alle
          .filter((e) => !alle.some((x) => x !== e && e.contains(x)))
          .slice(0, 4)
          .map((e) => `${e.tagName.toLowerCase()}.${e.className.toString().slice(0, 36)}`
            + `(${String(e.scrollWidth)}>${String(e.clientWidth)})`);
      })(),
      textrand: { abstand: schmalste, wer },
    };
  });
}

/**
 * **Jede Seite der Karte — nicht eine Auswahl davon.**
 *
 * Der Befund stand auf JEDER Seite; eine Stichprobe haette ihn zwar auch
 * gefunden, aber die naechste Abweichung steht vielleicht auf genau der einen,
 * die nicht in der Liste steht. `ROUTEN` ist die erzeugte Fassung von
 * `04-SEITENKARTE.md` und damit die vollstaendige Liste dessen, was es
 * ueberhaupt gibt.
 *
 * Dynamische Segmente fallen weg — `[id]` braucht einen Datensatz, und den
 * pruefen die Fachspezifikationen. `[mandant]` ist kein dynamisches Segment in
 * diesem Sinn, sondern der Bereich: er wird eingesetzt, und zwar fuer JEDE der
 * drei Gesellschaften. Erst damit kommen die Modulseiten ueberhaupt vor —
 * `security/wachbuch` gibt es in `reinigung` mit Recht nicht (Modulriegel),
 * und ohne den Durchgang durch `security` haette sie niemand gemessen.
 */
const KARTE: readonly string[] = [...new Set(
  ROUTEN.map((r) => r.pfad).filter((p) => !p.startsWith('/api/') && !p.startsWith('/dev/')),
)];

const ohnePlatzhalter = (liste: readonly string[]) => liste.filter((p) => !p.includes('['));
const fuerBereich = (bereich: string) => ohnePlatzhalter(
  KARTE.filter((p) => p.startsWith('/portal/[mandant]')).map((p) => p.replace('[mandant]', bereich)));
const unter = (prefix: string) => ohnePlatzhalter(KARTE.filter((p) => p.startsWith(prefix)));

/**
 * **`/auth/abmelden` steht mit Absicht in keiner angemeldeten Gruppe.**
 *
 * Es hat zwei Durchgaenge gekostet, das zu sehen: der Lauf mass einmal 71 und
 * einmal 24 Seiten auf demselben Stand. Die Ursache war die Liste selbst — sie
 * enthaelt die Abmeldung, und alles dahinter lief ohne Sitzung gegen die
 * Anmeldemaske. Eine Pruefung, die ihre eigene Voraussetzung zerstoert, meldet
 * jeden zweiten Lauf etwas anderes.
 *
 * `/auth/callback` faellt weg, weil es ohne Anbieterantwort nichts anzeigt.
 */
const OHNE_SITZUNG = ohnePlatzhalter(
  KARTE.filter((p) => !p.startsWith('/portal') && p !== '/auth/callback'));

interface Gruppe {
  readonly name: string;
  /** `null` heisst: bewusst ohne Sitzung gemessen. */
  readonly konto: string | null;
  readonly seiten: readonly string[];
}

const GRUPPEN: readonly Gruppe[] = [
  { name: 'ohne Sitzung', konto: null, seiten: OHNE_SITZUNG },
  {
    name: 'reinigung',
    konto: KONTO.adminReinigung,
    seiten: [...fuerBereich('reinigung'), ...unter('/portal/konto')],
  },
  { name: 'security', konto: KONTO.adminSecurity, seiten: fuerBereich('security') },
  { name: 'bau', konto: KONTO.adminBau, seiten: fuerBereich('bau') },
  { name: 'Gruppenansicht', konto: KONTO.gruppe, seiten: unter('/portal/gruppe') },
  { name: 'Mitarbeiterin', konto: KONTO.fatima, seiten: unter('/portal/mein') },
  { name: 'Kundin', konto: KONTO.kunde, seiten: unter('/portal/kunde') },
];

/**
 * Misst eine Gruppe. Was nicht 200 antwortet, ist hier kein Fehler: ob eine
 * Route dieser Sitzung gehoert, pruefen die Rollenprobe
 * (`tests/isolation/rollen.test.ts`) und `verweise.spec.ts`. Diese Datei
 * misst — und sagt am Ende, wie viel sie messen konnte.
 */
async function messeGruppe(
  browser: Browser, gruppe: Gruppe, breite: number, hoehe: number,
): Promise<{ readonly klagen: readonly string[]; readonly gemessen: number }> {
  /*
   * **Jede Gruppe bekommt einen eigenen Kontext — und das ist keine Sauberkeit
   * um ihrer selbst willen.**
   *
   * Mit EINEM Kontext trug jede Gruppe mit, was die vorige hinterlassen hatte:
   * Sitzungskeks, Verlauf und vor allem eine noch offene clientseitige
   * Weiterleitung. Die Check-in-Seiten leiten nach `/check-in/abgelaufen`
   * weiter, wenn der Code abgelaufen ist — faellt das genau zwischen zwei
   * Gruppen, bricht Playwright mit „Navigation … is interrupted by another
   * navigation" ab. Zwei Anlaeufe mit `clearCookies` und `about:blank` haben
   * das Rennen nur verschoben, nicht beendet: der Abbruch wanderte von der
   * einen Zeile zur naechsten.
   *
   * Ein frischer Kontext hat nichts, was noch unterwegs sein koennte. Das ist
   * ausserdem naeher an der Wahrheit — ein Mensch meldet sich nicht in
   * derselben Sitzung nacheinander als sieben verschiedene Leute an.
   */
  const kontext = await browser.newContext({ viewport: { width: breite, height: hoehe } });
  const page = await kontext.newPage();
  try {
    if (gruppe.konto !== null) await alsKonto(page, gruppe.konto);

    const klagen: string[] = [];
    let gemessen = 0;
    for (const pfad of gruppe.seiten) {
      const antwort = await page.goto(pfad, { waitUntil: 'domcontentloaded' }).catch(() => null);
      if ((antwort?.status() ?? 0) !== 200) continue;
      const m = await masse(page).catch(() => null);
      if (m === null || !m.hatHaupt) continue;
      gemessen += 1;
      const wo = `${gruppe.name} ${pfad}`;
      if (istPortalspalte(pfad)) {
        if (m.links < RINNE || m.rechts < RINNE) {
          klagen.push(`${wo}: Rand ${String(m.links)}/${String(m.rechts)}px statt ${String(RINNE)}px`);
        }
        if (m.kopfLinks === 0) klagen.push(`${wo}: Kopfzeile ohne Rand links`);
      } else if (m.textrand.abstand < TEXTRINNE) {
        klagen.push(
          `${wo}: Text ${String(Math.round(m.textrand.abstand))}px vom Rand — ${m.textrand.wer}`);
      }
      if (m.ueberbreite > 1) {
        klagen.push(`${wo}: ${String(m.ueberbreite)}px ueberbreit`
          + ` — Kasten: ${m.ausreisser.join(' | ') || '—'}`
          + ` · Schrift: ${m.ueberlaufend.join(' | ') || '—'}`);
      }
    }
    return { klagen, gemessen };
  } finally {
    await kontext.close();
  }
}

for (const { name, breite, hoehe } of [BREITEN[0], BREITEN[3]] as const) {
  test(`jede Seite der Karte behaelt ihre Masse — ${name}`, async ({ browser }) => {
    test.setTimeout(25 * 60_000);
    const klagen: string[] = [];
    let gemessen = 0;
    for (const gruppe of GRUPPEN) {
      const ergebnis = await messeGruppe(browser, gruppe, breite, hoehe);
      klagen.push(...ergebnis.klagen);
      gemessen += ergebnis.gemessen;
    }
    /* Eine schrumpfende Abdeckung darf nicht unbemerkt bleiben. */
    console.log(`${name}: ${String(gemessen)} Seiten gemessen`);
    expect(gemessen, 'zu wenige Seiten erreichbar — stimmt die Anmeldung?').toBeGreaterThan(180);
    expect(klagen.join('\n'), `${String(klagen.length)} Seite(n) ohne richtige Masse`).toBe('');
  });
}

/**
 * Die vier Breiten auf einer Auswahl, die jede Layoutart einmal enthaelt:
 * Kachelraster, lange Tabelle, Formular, Detailblatt, Gruppenansicht. Der
 * volle Durchgang laeuft aus Zeitgruenden nur an den beiden Raendern; hier
 * kommen `md` und `lg` dazu, weil genau dort die Umbrueche sitzen.
 */
const QUERSCHNITT = [
  '/portal/reinigung',
  '/portal/reinigung/crm',
  '/portal/reinigung/objekte',
  '/portal/reinigung/dienstplan/woche',
  '/portal/reinigung/zeiten',
  '/portal/reinigung/personal/anstellungen',
  '/portal/reinigung/finanzen/rechnungen',
  '/portal/reinigung/agenten',
  '/portal/reinigung/einstellungen',
  '/portal/konto/profil',
] as const;

for (const { name, breite, hoehe } of [BREITEN[1], BREITEN[2]] as const) {
  test(`der Querschnitt haelt seine Masse — ${name} (${String(breite)}px)`, async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const ergebnis = await messeGruppe(
      browser, { name, konto: KONTO.adminReinigung, seiten: QUERSCHNITT }, breite, hoehe);
    expect(ergebnis.gemessen, 'der Querschnitt ist nicht erreichbar').toBe(QUERSCHNITT.length);
    expect(ergebnis.klagen.join('\n')).toBe('');
  });
}

/**
 * DESIGN §8 „Tap targets ≥ 44×44px" — am Geraet gemessen, nicht am Quelltext.
 *
 * `min-h-[44px]` im Quelltext beweist die Hoehe nicht: ein Vorfahr mit
 * `overflow: hidden` oder eine Leiste, die um den Inset SCHRUMPFT statt zu
 * wachsen, macht daraus weniger. Hier steht, was der Finger trifft.
 */
test('jede Zelle der Tab-Leiste ist am Telefon mindestens 44px hoch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await alsKonto(page, KONTO.leitungReinigung);
  await page.goto('/portal/reinigung');

  /*
   * `[data-cse="tab"]` und nicht „jeder Verweis in der Leiste": im
   * geschlossenen `Mehr`-Blatt stehen die Punkte des ganzen Portals, und die
   * sind `display: none` — eine Messung darauf faellt auf 0px und meldet einen
   * Fehler, den es nicht gibt. Die ZELLE ist der Tab; das Blatt hat seine
   * eigene Probe darunter.
   */
  const zellen = page.locator('[data-cse="tableiste"] [data-cse="tab"]');
  const anzahl = await zellen.count();
  expect(anzahl, 'keine Tab-Leiste am Telefon').toBeGreaterThan(2);
  for (let i = 0; i < anzahl; i += 1) {
    const kasten = await zellen.nth(i).boundingBox();
    expect(kasten?.height ?? 0, `Zelle ${String(i)} zu flach`).toBeGreaterThanOrEqual(44);
    expect(kasten?.width ?? 0, `Zelle ${String(i)} zu schmal`).toBeGreaterThanOrEqual(44);
  }

  /* Und die Zeilen im aufgeklappten Blatt tragen dieselbe Regel. */
  await page.locator('[data-cse="mehr"] summary').click();
  const zeilen = page.locator(
    '[data-cse="mehr-ziel"], [data-cse="mehr-sitzung"], [data-cse="mehr-abmelden"]');
  const zeilenZahl = await zeilen.count();
  expect(zeilenZahl, 'das Mehr-Blatt ist leer').toBeGreaterThan(3);
  for (let i = 0; i < zeilenZahl; i += 1) {
    const kasten = await zeilen.nth(i).boundingBox();
    expect(kasten?.height ?? 0, `Blattzeile ${String(i)} zu flach`).toBeGreaterThanOrEqual(44);
  }
});

/**
 * Und die Leiste verdeckt nichts: die letzte Zeile der Seite muss ueber ihrer
 * Oberkante enden. Genau dafuer ist `.ueber-tableiste` da — und genau das
 * misst hier niemand sonst.
 */
test('die Tab-Leiste verdeckt die letzte Zeile der Seite nicht', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await alsKonto(page, KONTO.leitungReinigung);
  await page.goto('/portal/reinigung/objekte');
  await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
  const unten = await page.evaluate(() => {
    const haupt = document.querySelector('main');
    const leiste = document.querySelector('[data-cse="tableiste"]');
    if (haupt === null || leiste === null) return null;
    return {
      letzte: haupt.lastElementChild?.getBoundingClientRect().bottom ?? 0,
      leisteOben: leiste.getBoundingClientRect().top,
    };
  });
  expect(unten, 'Leiste oder Inhalt fehlt').not.toBeNull();
  expect(unten!.letzte, 'der Inhalt endet unter der Leiste')
    .toBeLessThanOrEqual(unten!.leisteOben + 1);
});
