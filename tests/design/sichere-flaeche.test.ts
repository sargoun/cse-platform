/**
 * DESIGN §8 „Safe area" — die Fläche, die das Gerät für sich nimmt.
 *
 * **Der Befund vom echten Telefon.** Die Tab-Leiste klebte am unteren
 * Bildschirmrand, ihre Beschriftungen einen Millimeter über dem
 * Home-Indikator. Ein Tipp dort geht an die Systemgeste; Text dort schneidet
 * die Rundung ab.
 *
 * **Warum das kein Browsertest prüfen kann.** Headless Chromium meldet jeden
 * `env(safe-area-inset-*)` als `0px` — es gibt keine Notch zu melden. Ein
 * Browserlauf wäre also grün, egal ob die Regeln dastehen oder nicht, und
 * genau diese Sorte grüner Lauf hat den Fehler entstehen lassen. Geprüft wird
 * deshalb der VERTRAG: dass die Zeile im Stylesheet steht und dass die
 * Bauteile sie benutzen.
 *
 * Und die eine Zeile, ohne die alles andere wirkungslos ist, hat einen
 * eigenen Fall: **ohne `viewport-fit=cover` ist jeder Inset null.**
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync('src/styles/globals.css', 'utf8');
const LAYOUT = readFileSync('src/app/layout.tsx', 'utf8');
const LEISTE = readFileSync('src/components/portal/TabLeiste.tsx', 'utf8');
const RAHMEN = readFileSync('src/components/portal/PortalRahmen.tsx', 'utf8');
const SHELL = readFileSync('src/components/portal/PortalShell.tsx', 'utf8');
const OEFFENTLICH = readFileSync('src/components/oeffentlich/OeffentlicheShell.tsx', 'utf8');
const DESIGN = readFileSync('docs/DESIGN.md', 'utf8');

describe('die eine Zeile, ohne die nichts davon wirkt', () => {
  it('`viewport-fit=cover` steht im Layout', () => {
    expect(LAYOUT).toContain('viewportFit');
    expect(LAYOUT).toMatch(/viewportFit:\s*'cover'/u);
  });

  it('und DESIGN §8 sagt, warum', () => {
    expect(DESIGN).toContain('viewport-fit=cover');
    expect(DESIGN).toContain('safe-area-inset');
  });
});

describe('die vier Regeln stehen in globals.css — an EINER Stelle', () => {
  for (const [klasse, eigenschaft] of [
    ['.sicher-unten', 'padding-bottom'],
    ['.sicher-oben', 'padding-top'],
    ['.sicher-seiten', 'padding-left'],
    ['.ueber-tableiste', 'padding-bottom'],
    ['.ueber-leiste-oberkante', 'bottom'],
  ] as const) {
    it(`${klasse} rechnet gegen env(safe-area-inset-*)`, () => {
      const stelle = CSS.indexOf(`${klasse} `);
      expect(stelle, `${klasse} fehlt in globals.css`).toBeGreaterThan(0);
      const block = CSS.slice(stelle, stelle + 220);
      expect(block).toContain(eigenschaft);
      expect(block).toContain('env(safe-area-inset-');
    });
  }

  it('jede Regel trägt einen Ersatzwert `0px` — ein alter Browser kennt `env` nicht', () => {
    /*
     * `env(safe-area-inset-bottom)` ohne zweites Argument ist in einem
     * Browser ohne Unterstuetzung eine UNGUELTIGE Deklaration: die ganze
     * Zeile faellt weg, und `calc(52px + …)` wird zu gar keiner Polsterung.
     * Mit `, 0px` bleibt wenigstens die 52px stehen.
     */
    const treffer = [...CSS.matchAll(/env\(safe-area-inset-[a-z]+([^)]*)\)/gu)];
    expect(treffer.length).toBeGreaterThan(4);
    for (const t of treffer) expect(t[1], t[0]).toContain('0px');
  });

  it('`ueber-tableiste` kippt ab `md` zurück — dort gibt es keine Leiste', () => {
    /*
     * Die Leiste ist `md:hidden`. Bliebe die Polsterung, staende am
     * Schreibtisch 52px Leere unter jeder Seite. Der Umbruch gehoert INS
     * Stylesheet: `md:pb-s5` am Element haette dieselbe Spezifitaet, und
     * diese Datei steht hinter Tailwinds Utilities — sie haette gewonnen.
     */
    const stelle = CSS.indexOf('.ueber-tableiste');
    expect(CSS.slice(stelle, stelle + 400)).toContain('min-width: 768px');
  });
});

describe('die Bauteile benutzen sie', () => {
  it('die Tab-Leiste wächst um den unteren Inset', () => {
    expect(LEISTE).toContain('sicher-unten');
  });

  it('und ihre Zelle bleibt trotzdem 44px — DESIGN §8 „Tap targets ≥ 44×44px"', () => {
    /*
     * Der Inset ist Platz, den das System nimmt, nicht Platz, den der Knopf
     * hergibt. Eine Leiste, die ihre Zellen schrumpft, um den Indikator
     * unterzubringen, verfehlt die Regel auf genau den Geraeten, die sie
     * brauchen.
     */
    expect(LEISTE).toContain('min-h-[44px]');
  });

  it('das `Mehr`-Blatt endet an der Oberkante der Leiste, nicht bei 44px', () => {
    expect(LEISTE).toContain('ueber-leiste-oberkante');
    // `bottom-11` waere wieder die alte, feste Zahl.
    expect(LEISTE).not.toMatch(/className="[^"]*\bbottom-11\b/u);
  });

  it('der Inhalt hält Abstand zur Leiste — in beiden Hüllen', () => {
    expect(RAHMEN).toContain('ueber-tableiste');
    expect(SHELL).toContain('ueber-tableiste');
    // Die alte feste Zahl darf nirgends mehr stehen.
    expect(RAHMEN).not.toContain('pb-20');
    expect(SHELL).not.toContain('pb-20');
  });

  it('die Köpfe und der Inhalt halten Abstand zu den Seitenrundungen', () => {
    for (const [name, quelle] of [
      ['PortalRahmen', RAHMEN], ['PortalShell', SHELL], ['OeffentlicheShell', OEFFENTLICH],
    ] as const) {
      expect(quelle, name).toContain('sicher-seiten');
    }
  });

  it('der obere Inset sitzt am klebenden Kopf, nicht am Inhalt darunter', () => {
    expect(RAHMEN).toContain('sicher-oben');
    expect(OEFFENTLICH).toContain('sicher-oben');
  });
});
