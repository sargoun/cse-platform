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
    ['.sicher-unten', 'border-bottom-width'],
    ['.sicher-oben', 'border-top-width'],
    ['.sicher-seiten', 'border-left-width'],
    ['.ueber-tableiste', 'border-bottom-width'],
    ['.ueber-leiste-oberkante', 'bottom'],
  ] as const) {
    it(`${klasse} rechnet gegen env(safe-area-inset-*)`, () => {
      const stelle = CSS.indexOf(`${klasse} `);
      expect(stelle, `${klasse} fehlt in globals.css`).toBeGreaterThan(0);
      const block = CSS.slice(stelle, stelle + 320);
      expect(block).toContain(eigenschaft);
      expect(block).toContain('env(safe-area-inset-');
    });
  }

  it('jede Regel trägt einen Ersatzwert `0px` — ein alter Browser kennt `env` nicht', () => {
    /*
     * `env(safe-area-inset-bottom)` ohne zweites Argument ist in einem
     * Browser ohne Unterstuetzung eine UNGUELTIGE Deklaration: die ganze
     * Zeile faellt weg, und `calc(52px + …)` wird zu gar keinem Platz.
     * Mit `, 0px` bleibt wenigstens die 52px stehen.
     */
    const treffer = [...CSS.matchAll(/env\(safe-area-inset-[a-z]+([^)]*)\)/gu)];
    expect(treffer.length).toBeGreaterThan(4);
    for (const t of treffer) expect(t[1], t[0]).toContain('0px');
  });

  it('`ueber-tableiste` kippt ab `md` zurück — dort gibt es keine Leiste', () => {
    /*
     * Die Leiste ist `md:hidden`. Bliebe der Platz, staende am Schreibtisch
     * 52px Leere unter jeder Seite. Der Umbruch gehoert INS Stylesheet:
     * `md:border-b-0` am Element haette dieselbe Spezifitaet, und diese Datei
     * steht hinter Tailwinds Utilities — sie haette gewonnen.
     */
    const stelle = CSS.indexOf('.ueber-tableiste');
    expect(CSS.slice(stelle, stelle + 600)).toContain('min-width: 768px');
  });
});

/**
 * **Der Fall, der diese Gruppe nötig machte — und der teuerste des Kapitels.**
 *
 * Die vier Regeln standen als `padding` da. `globals.css` wird NACH Tailwinds
 * erzeugten Klassen geladen, also sind `.sicher-seiten` und `p-s5` zwei
 * Deklarationen derselben Eigenschaft mit derselben Spezifitaet — und die
 * spätere gewinnt. Am Schreibtisch, wo jeder Inset `0px` ist, hiess das
 * `padding-left: 0px`: **die Kacheln klebten am Fensterrand, auf jeder Seite
 * des Portals, in jeder Breite.**
 *
 * Kein Linter, kein Typecheck und kein Browsertest schlug an, denn es war
 * keine Regel verletzt — es trafen sich zwei richtige. Gemeldet hat es ein
 * Mensch mit einem Bildschirmfoto.
 *
 * Der Inset ist deshalb ein durchsichtiger RAHMEN: bei `box-sizing:
 * border-box` wächst er nach innen wie eine Polsterung, der Hintergrund liegt
 * weiter darunter — und er ADDIERT sich zu der Polsterung, die das Element
 * schon trägt, statt sie zu ersetzen.
 */
describe('und sie nehmen dem Element nicht seine eigenen Ränder', () => {
  const BLOCK = CSS.slice(CSS.indexOf('@layer utilities {'));

  for (const klasse of
    ['.sicher-unten', '.sicher-oben', '.sicher-seiten', '.ueber-tableiste'] as const) {
    it(`${klasse} erklärt kein padding und kein margin`, () => {
      const stelle = BLOCK.indexOf(`${klasse} `);
      expect(stelle).toBeGreaterThan(0);
      const regel = BLOCK.slice(stelle, BLOCK.indexOf('}', stelle));
      expect(regel, `${klasse} würde p-s5 auf dem Element schlagen`)
        .not.toMatch(/(^|[\s;]) *padding/u);
      expect(regel, `${klasse} würde eine Tailwind-Marge schlagen`)
        .not.toMatch(/(^|[\s;]) *margin/u);
    });
  }

  it('der Rahmen ist durchsichtig und hat einen Stil — sonst ist er entweder sichtbar oder null', () => {
    /*
     * Ohne `-style: solid` rechnet jede Breite zu null (CSS Backgrounds §4.3).
     * Ohne `-color: transparent` erbt der Rahmen `border-color` des Elements —
     * bei der Kopfzeile mit `border-line` waere daraus eine sichtbare Linie
     * quer ueber die Seitenraender geworden.
     */
    for (const klasse of
      ['.sicher-unten', '.sicher-oben', '.sicher-seiten', '.ueber-tableiste'] as const) {
      const stelle = BLOCK.indexOf(`${klasse} `);
      const regel = BLOCK.slice(stelle, BLOCK.indexOf('}', stelle));
      expect(regel, klasse).toContain('-style: solid');
      expect(regel, klasse).toContain('-color: transparent');
    }
  });

  it('die Seiten-Regel ist PHYSISCH, nicht logisch — Arabisch läuft rtl', () => {
    /*
     * `safe-area-inset-left` ist die physische linke Seite des Geraets und
     * dreht sich nicht. Die Arbeiterschirme laufen auf Arabisch unter
     * `dir="rtl"` (SPEC §10) — `border-inline-start` legte den Notch-Inset
     * dort auf die falsche Seite des Bildschirms.
     */
    const stelle = BLOCK.indexOf('.sicher-seiten ');
    const regel = BLOCK.slice(stelle, BLOCK.indexOf('}', stelle));
    expect(regel).toContain('border-left-width');
    expect(regel).toContain('border-right-width');
    expect(regel).not.toContain('inline-start');
    expect(regel).not.toContain('inline-end');
  });

  it('und DESIGN §8 schreibt die Regel fest, die dahinter steht', () => {
    expect(DESIGN).toContain('transparent border');
    /* Der Fliesstext bricht um; verglichen wird ohne Umbruch und Zitatzeichen. */
    const fliess = DESIGN.replace(/\n>? */gu, ' ');
    expect(fliess).toContain(
      'never declares a property that a Tailwind utility on the same element also declares');
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

  it('und die Inhaltsspalte behält ihre eigene Polsterung — in BEIDEN Hüllen', () => {
    /*
     * Das ist der Befund selbst, an der Stelle, an der man ihn sieht: die
     * Spalte, in der jede Portalseite steht. Traegt sie `sicher-seiten` ohne
     * eigenes `p-s5`, klebt jede Kachel am Fensterrand.
     */
    for (const [name, quelle] of [['PortalRahmen', RAHMEN], ['PortalShell', SHELL]] as const) {
      const zeile = /<main className="([^"]*)"/u.exec(quelle)?.[1];
      expect(zeile, `${name}: kein <main> gefunden`).toBeDefined();
      expect(zeile, `${name}: <main> ohne eigene Polsterung`).toContain('p-s5');
      expect(zeile, `${name}: <main> ohne min-w-0 laesst breite Tabellen ausbrechen`)
        .toContain('min-w-0');
    }
  });

  it('die feste Höhe des öffentlichen Kopfes zählt ohne den Inset', () => {
    /*
     * `h-[72px]` ist bei `border-box` die Hoehe MIT Rahmen — im installierten
     * Modus waere die Leiste 72px geblieben und ihr Inhalt auf den Rest
     * zusammengedrueckt. `box-content` macht die 72px zur Zeile, der Inset
     * kommt darueber.
     */
    expect(OEFFENTLICH).toMatch(/box-content/u);
  });

  it('der obere Inset sitzt am klebenden Kopf, nicht am Inhalt darunter', () => {
    expect(RAHMEN).toContain('sicher-oben');
    expect(OEFFENTLICH).toContain('sicher-oben');
  });
});
