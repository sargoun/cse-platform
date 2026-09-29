/**
 * Was ein fremder Kanal vom Bild eines Beitrags erfährt (SOC-02, SOC-05,
 * V-225, V-268, D-719 Nr. 5, D-761) — ohne Datenbank.
 *
 * Eine fremde Plattform holt das Bild selbst ab; eine relative Adresse wäre
 * dort nichts. Ohne kanonische Basis geht deshalb KEIN Bild mit — statt
 * eines, das niemand laden kann.
 */
import { describe, expect, it } from 'vitest';
import { bildFuerKanal } from '../../src/server/services/social/dienst.js';

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
