/**
 * Was ein fremder Kanal vom Bild eines Beitrags erfährt (SOC-02, SOC-05,
 * V-225, V-268, D-719 Nr. 5, D-761) — ohne Datenbank.
 *
 * Eine fremde Plattform holt das Bild selbst ab; eine relative Adresse wäre
 * dort nichts. Ohne kanonische Basis geht deshalb KEIN Bild mit — statt
 * eines, das niemand laden kann.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bildFuerKanal } from '../../src/server/services/social/dienst.js';
import { bildAusNutzlast } from '../../src/server/services/social/beitragsbild.js';

const HOCHGELADEN = {
  bildAdresse: '/api/beitragsbild/00000000-0000-4000-8000-000000000001',
  bildTyp: 'image/png', bildAlt: 'Treppenhaus nach der Grundreinigung',
};
const STATISCH = { bildAdresse: '/bilder/reinigung.jpg', bildTyp: null, bildAlt: 'Fassade' };

describe('bildFuerKanal', () => {
  it('mit Basis: eine absolute Adresse, Typ und Alternativtext', () => {
    expect(bildFuerKanal(HOCHGELADEN, 'https://cse.example/')).toEqual({
      medien: {
        url: 'https://cse.example/api/beitragsbild/00000000-0000-4000-8000-000000000001',
        mimeTyp: 'image/png', alt: 'Treppenhaus nach der Grundreinigung',
      },
    });
    expect(bildFuerKanal(STATISCH, 'https://cse.example')).toEqual({
      medien: { url: 'https://cse.example/bilder/reinigung.jpg', mimeTyp: 'image/jpeg', alt: 'Fassade' },
    });
  });

  it('ohne Basis oder ohne Bild: kein Feld — nie eine relative Adresse', () => {
    expect(bildFuerKanal(HOCHGELADEN, null)).toEqual({});
    expect(bildFuerKanal(HOCHGELADEN, '')).toEqual({});
    expect(bildFuerKanal({ bildAdresse: null, bildTyp: null, bildAlt: null },
      'https://cse.example')).toEqual({});
  });
});

/**
 * **Das Bild gehört zur Entscheidung** (V-268, D-761). Die Nutzlast einer
 * Freigabe trägt `bild: { medien_id, alt }` (`legeVor`); der
 * Entscheidungsbildschirm liest es daraus und zeigt das Bild.
 */
describe('bildAusNutzlast — was der Entscheidungsbildschirm zeigt', () => {
  const ID = '00000000-0000-4000-8000-000000000002';

  it('liest Kennung und Alternativtext, wie legeVor sie hineinlegt', () => {
    expect(bildAusNutzlast({ titel: 'T', text: 'X', bild: { medien_id: ID, alt: 'Glasfront' } }))
      .toEqual({ medienId: ID, alt: 'Glasfront' });
    expect(bildAusNutzlast({ bild: { medien_id: ID } })).toEqual({ medienId: ID, alt: '' });
  });

  it('ohne Bild, mit fremder Form oder ohne Kennung: nichts', () => {
    for (const n of [null, 'text', 42, [], { titel: 'T' }, { bild: null }, { bild: 'x' },
      { bild: { medien_id: 'keine-kennung', alt: 'a' } }, { bild: { alt: 'a' } }]) {
      expect(bildAusNutzlast(n), JSON.stringify(n)).toBeNull();
    }
  });

  it('der Entscheidungsbildschirm zeigt das Bild über den Dienst — und verweist auf den Beitrag', () => {
    const seite = readFileSync('src/app/portal/[mandant]/freigaben/[id]/page.tsx', 'utf8');
    expect(seite).toContain('bildDerFreigabe(kontext, geoeffnet.vorschau)');
    expect(seite).toContain('data-cse="freigabe-bild-vorschau"');
    expect(seite).toMatch(/<img src=\{bild\.adresse\} alt=\{bild\.alt\}/u);
    expect(seite).toContain('data-cse="zum-beitrag"');
  });
});

/**
 * V-268 d, D-761 Nr. 8: die Route fragt den Beitrag, bevor eine Datei im
 * Behälter liegt — über `haengeNeuesBildAn`, nicht über die zwei Schritte
 * „ablegen, dann zuordnen", zwischen denen eine Abweisung eine Waise liess.
 */
describe('die Bild-Route: erst der Beitrag, dann die Datei', () => {
  it('ruft haengeNeuesBildAn — und legt nicht selbst ab', () => {
    const route = readFileSync('src/app/api/social/beitraege/[id]/bild/route.ts', 'utf8');
    expect(route).toContain('await haengeNeuesBildAn(kontext, speicher, id, {');
    expect(route).not.toContain('legeBeitragsbildAn(');
  });

  it('der Dienst prüft und sperrt den Beitrag vor legeBeitragsbildAn', () => {
    const dienst = readFileSync('src/server/services/social/dienst.ts', 'utf8');
    const start = dienst.indexOf('export async function haengeNeuesBildAn(');
    expect(start).toBeGreaterThan(0);
    const rumpf = dienst.slice(start, dienst.indexOf('\n}\n', start));
    const sperre = rumpf.indexOf('for update');
    const pruefung = rumpf.indexOf('darfBearbeiten(b.status)');
    const ablage = rumpf.indexOf('legeBeitragsbildAn(kontext, speicher, eingabe)');
    expect(sperre).toBeGreaterThan(0);
    expect(pruefung).toBeGreaterThan(sperre);
    expect(ablage).toBeGreaterThan(pruefung);
  });
});
