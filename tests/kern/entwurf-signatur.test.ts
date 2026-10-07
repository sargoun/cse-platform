import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { schlussMitSignatur } from '../../src/server/services/mandant/signatur.js';
import { entwerfe, type Gesellschaft } from '../../src/server/services/akquise/entwurf.js';
import type { Ziel } from '../../src/server/services/akquise/ziel.js';

/**
 * Entwürfe schliessen mit der Signatur der Gesellschaft (V-391, O-115, D-829).
 *
 * Die Signatur steht in Einstellungen › Identität; ohne sie bleibt der
 * bisherige Schluss aus Gruss und Name. Den Weg durch die Datenbank für die
 * Antwort an eine Bewerberin prüft `tests/isolation/bewerbung-antwort.test.ts`
 * (§7).
 */

describe('schlussMitSignatur', () => {
  it('ohne Signatur: Gruss und Name der Gesellschaft, wie bisher', () => {
    expect(schlussMitSignatur('Freundliche Grüße', 'CSE Dienstleistungen GmbH', null))
      .toBe('Freundliche Grüße\nCSE Dienstleistungen GmbH');
    expect(schlussMitSignatur('Freundliche Grüße', 'CSE Dienstleistungen GmbH', '  \r\n '))
      .toBe('Freundliche Grüße\nCSE Dienstleistungen GmbH');
  });

  it('mit Signatur steht sie unter dem Gruss, mit \\n statt \\r\\n', () => {
    expect(schlussMitSignatur(
      'Mit freundlichen Grüßen', 'CSE Dienstleistungen GmbH',
      'CSE Dienstleistungen GmbH\r\nMusterstraße 1\r\n10115 Berlin\r\n',
    )).toBe('Mit freundlichen Grüßen\nCSE Dienstleistungen GmbH\nMusterstraße 1\n10115 Berlin');
  });

  it('beginnt die Signatur mit einem Gruss, steht kein zweiter davor', () => {
    for (const eigener of [
      'Mit freundlichen Grüßen', 'Beste Grüsse', 'Viele Gruesse aus Berlin',
      'Herzlicher Gruß', 'MfG', 'Kind regards',
    ]) {
      expect(schlussMitSignatur('Freundliche Grüße', 'SSE Security', `${eigener}\nSSE Security`))
        .toBe(`${eigener}\nSSE Security`);
    }
  });

  it('nur die erste Zeile zählt — ein Gruss weiter unten ist keiner', () => {
    expect(schlussMitSignatur('Freundliche Grüße', 'SSE Security',
      'Anna Schmidt\nGrußkarten und Präsente: nein'))
      .toBe('Freundliche Grüße\nAnna Schmidt\nGrußkarten und Präsente: nein');
  });
});

describe('der Akquiseentwurf nimmt die Signatur', () => {
  const ziel: Ziel = {
    id: '00000000-0000-4000-8000-000000000001', firmenname: 'Hausverwaltung Nord',
    branche: 'Wohnungswirtschaft', strasse: 'Nordweg 2', plz: '13347', ort: 'Berlin',
    website: null, allgemeineEmail: null, telefon: null, punktzahl: 70,
    punktzahlBegruendung: null, passenderBereich: 'reinigung', bedarfVermutung: null,
    status: 'neu', verworfenGrund: null, leadId: null, quelleBezeichnung: null,
    gefundenAm: new Date('2026-10-01T08:00:00Z'), angesehenAm: null, angesehenVon: null,
  };
  const firma = (signatur: string | null): Gesellschaft => ({
    name: 'CSE Dienstleistungen GmbH', slug: 'reinigung', gewerk: 'Gebäudereinigung', signatur,
  });

  it('mit Signatur schliesst er mit ihr', () => {
    const e = entwerfe(ziel, firma('Anna Schmidt\nCSE Dienstleistungen GmbH\n030 1234567'));
    expect(e.text.endsWith(
      '\n\nMit freundlichen Grüßen\nAnna Schmidt\nCSE Dienstleistungen GmbH\n030 1234567',
    )).toBe(true);
  });

  it('ohne Signatur wie bisher mit dem Namen', () => {
    expect(entwerfe(ziel, firma(null)).text.endsWith(
      '\n\nMit freundlichen Grüßen\nCSE Dienstleistungen GmbH')).toBe(true);
  });

  it('die Akquiseseite liest die Signatur aus der Identität', () => {
    const seite = readFileSync('src/app/portal/[mandant]/crm/akquise/[id]/page.tsx', 'utf8');
    expect(seite).toContain('mi.email_signatur as signatur');
    expect(seite).toContain('signatur: gesellschaft.signatur');
  });
});
