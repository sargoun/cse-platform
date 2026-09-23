import { describe, expect, it } from 'vitest';
import { istSvg, pruefeSvg, SvgFehler } from '@/server/storage/svg';
import {
  erlaubteTypen, istMarkenbildArt, markenbildAdresse, markenbildSchluessel,
  MARKENBILD_ARTEN, oeffentlicheMarkeAus, typAusSchluessel,
} from '@/server/services/mandant/markenbild';

/**
 * V-100, D-622 — was sich ohne Datenbank über Logo, Avatar und Titelbild
 * sagen lässt: welche Datei ein Bild ist, wie sie heisst und unter welcher
 * Adresse sie ausgeliefert wird.
 */

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const MANDANT = '11111111-2222-4333-8444-555555555555';

const LOGO = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Logo der Gesellschaft -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32">
  <style>.a{fill:#E30613}</style>
  <rect class="a" width="32" height="32" rx="6"/>
  <text x="40" y="22" font-family="Inter">CSE</text>
  <use href="#a"/>
</svg>`;

describe('§1 ein SVG-Logo wird angenommen, wenn es ein Bild ist', () => {
  it('ein sauberes Logo mit Prolog, Kommentar, Stil und innerem Verweis', () => {
    expect(istSvg(text(LOGO))).toBe(true);
    expect(() => pruefeSvg(text(LOGO))).not.toThrow();
  });

  it('auch mit Byte-Order-Mark und ohne Prolog', () => {
    expect(istSvg(text('﻿<svg viewBox="0 0 1 1"></svg>'))).toBe(true);
    expect(istSvg(text('<svg>'))).toBe(true);
  });

  it('ein eingebettetes PNG als data-Adresse ist erlaubt', () => {
    expect(() => pruefeSvg(text(
      '<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>'))).not.toThrow();
  });

  it('HTML, PDF und ein XML ohne svg-Wurzel sind kein SVG', () => {
    expect(istSvg(text('<html><svg></svg></html>'))).toBe(false);
    expect(istSvg(text('%PDF-1.7'))).toBe(false);
    expect(istSvg(text('<?xml version="1.0"?><Invoice/>'))).toBe(false);
  });
});

describe('§2 was ein Logo nie braucht, wird abgewiesen — mit Grund', () => {
  it.each([
    ['ein Skript', '<svg><script>alert(1)</script></svg>'],
    ['ein Ereignisattribut', '<svg onload="alert(1)"></svg>'],
    ['ein Ereignisattribut in einem Kind', '<svg><rect ONCLICK="x()"/></svg>'],
    ['eine javascript:-Adresse', '<svg><a href="javascript:alert(1)"><rect/></a></svg>'],
    ['eingebettetes HTML', '<svg><foreignObject><div/></foreignObject></svg>'],
    ['eine Animation, die Attribute setzt', '<svg><set attributeName="href" to="x"/></svg>'],
    ['ein Verweis nach draussen', '<svg><image href="https://example.com/x.png"/></svg>'],
    ['ein xlink-Verweis nach draussen', '<svg><use xlink:href="other.svg#a"/></svg>'],
    ['eine externe CSS-Ressource', '<svg><style>rect{fill:url(https://x/y)}</style></svg>'],
    ['ein CSS-Import', '<svg><style>@import "x.css";</style></svg>'],
    ['eine Entitätsdeklaration', '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "b">]><svg/>'],
  ])('%s', (_grund, svg) => {
    expect(() => pruefeSvg(text(svg))).toThrow(SvgFehler);
  });

  it('ein Logo über 1 MB ist eingebettetes Raster', () => {
    const gross = text(`<svg>${' '.repeat(1024 * 1024)}</svg>`);
    expect(() => pruefeSvg(gross)).toThrow(/1 MB/u);
  });

  it('kein gültiges UTF-8', () => {
    expect(() => pruefeSvg(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0xff, 0xfe, 0x3e])))
      .toThrow(/UTF-8/u);
  });
});

describe('§3 der Name ist der Inhalt — und passt zum CHECK aus 0393', () => {
  /* Dieselben Muster wie `mi_bildpfad_eigen`, hier als RegExp. */
  const CHECK: Record<string, RegExp> = {
    logo_hell: new RegExp(`^${MANDANT}/logo_hell/[0-9a-f]{64}\\.(svg|png|jpg)$`, 'u'),
    avatar: new RegExp(`^${MANDANT}/avatar/[0-9a-f]{64}\\.(png|jpg)$`, 'u'),
    cover: new RegExp(`^${MANDANT}/cover/[0-9a-f]{64}\\.(png|jpg)$`, 'u'),
  };

  it('ein Logo als SVG, ein Avatar als PNG, ein Titelbild als JPEG', () => {
    expect(markenbildSchluessel(MANDANT, 'logo_hell', text(LOGO), 'image/svg+xml'))
      .toMatch(CHECK['logo_hell']!);
    expect(markenbildSchluessel(MANDANT, 'avatar', text('x'), 'image/png'))
      .toMatch(CHECK['avatar']!);
    expect(markenbildSchluessel(MANDANT, 'cover', text('x'), 'image/jpeg'))
      .toMatch(CHECK['cover']!);
  });

  it('gleicher Inhalt, gleicher Name; ein Byte anders, ein anderer', () => {
    const a = markenbildSchluessel(MANDANT, 'cover', text('a'), 'image/jpeg');
    expect(markenbildSchluessel(MANDANT, 'cover', text('a'), 'image/jpeg')).toBe(a);
    expect(markenbildSchluessel(MANDANT, 'cover', text('b'), 'image/jpeg')).not.toBe(a);
  });

  it('der Typ der Auslieferung kommt aus der Endung, die der Dienst setzt', () => {
    expect(typAusSchluessel(`${MANDANT}/logo_hell/${'a'.repeat(64)}.svg`)).toBe('image/svg+xml');
    expect(typAusSchluessel(`${MANDANT}/avatar/${'a'.repeat(64)}.png`)).toBe('image/png');
    expect(typAusSchluessel(`${MANDANT}/cover/${'a'.repeat(64)}.jpg`)).toBe('image/jpeg');
  });
});

describe('§4 was je Art angenommen wird', () => {
  it('Logos: SVG, PNG, JPEG — Avatar und Titelbild: nur Raster', () => {
    for (const art of ['logo_hell', 'logo_dunkel', 'logo_druck'] as const) {
      expect(erlaubteTypen(art)).toEqual(['image/svg+xml', 'image/png', 'image/jpeg']);
    }
    expect(erlaubteTypen('avatar')).toEqual(['image/png', 'image/jpeg']);
    expect(erlaubteTypen('cover')).toEqual(['image/png', 'image/jpeg']);
  });

  it('die fünf Arten sind die fünf Spalten aus 0200 — und nichts sonst', () => {
    expect(MARKENBILD_ARTEN).toEqual(['logo_hell', 'logo_dunkel', 'logo_druck', 'avatar', 'cover']);
    expect(istMarkenbildArt('cover')).toBe(true);
    expect(istMarkenbildArt('logo')).toBe(false);
    expect(istMarkenbildArt('../cover')).toBe(false);
  });
});

describe('§5 die Adresse trägt die Version im Pfad', () => {
  it('ein neues Bild hat eine neue Adresse', () => {
    const a = markenbildAdresse(MANDANT, 'cover', `${MANDANT}/cover/${'a'.repeat(64)}.jpg`);
    const b = markenbildAdresse(MANDANT, 'cover', `${MANDANT}/cover/${'b'.repeat(64)}.jpg`);
    expect(a).toBe(`/api/marke/${MANDANT}/cover/${'a'.repeat(16)}`);
    expect(b).not.toBe(a);
  });

  it('die Website bekommt Adresse und Alternativtext — und null, wo nichts ist', () => {
    const m = oeffentlicheMarkeAus(MANDANT, {
      logo_hell_pfad: null, logo_dunkel_pfad: `${MANDANT}/logo_dunkel/${'c'.repeat(64)}.svg`,
      logo_alt: 'Logo der CSE Dienstleistungen GmbH',
      avatar_pfad: null, avatar_alt: null,
      cover_pfad: `${MANDANT}/cover/${'d'.repeat(64)}.jpg`, cover_alt: 'Treppenhaus',
    });
    expect(m.logoHell).toBeNull();
    expect(m.avatar).toBeNull();
    expect(m.logoDunkel).toEqual({
      adresse: `/api/marke/${MANDANT}/logo_dunkel/${'c'.repeat(16)}`,
      alt: 'Logo der CSE Dienstleistungen GmbH',
    });
    expect(m.cover?.alt).toBe('Treppenhaus');
  });
});
