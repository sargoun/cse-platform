import { describe, expect, it } from 'vitest';
import {
  eigenerPfad, fremdeAdresse, herkunftAlsSuche, herkunftAus, utmAus,
} from '../../src/lib/formular/herkunft.js';

/**
 * Die Herkunft einer Angebotsanfrage (REQ-07, D-631).
 *
 * Vorher stand in JEDEM Lead die eigene Formularseite als Referrer — gelesen
 * aus dem `Referer` des POST — und nie eine Kampagne, weil kein Feld sie trug.
 */
const HOST = 'cse.test';

describe('herkunftAus — ein Aufruf der Formularseite', () => {
  it('von aussen: der fremde Referrer, und diese Seite ist der Einstieg (mit utm)', () => {
    const h = herkunftAus(
      { utm_source: 'google', utm_campaign: 'herbst' },
      'https://www.google.de/', HOST, '/angebot/reinigung',
    );
    expect(h.referrerExtern).toBe('https://www.google.de/');
    expect(h.landingPage).toBe('/angebot/reinigung?utm_source=google&utm_campaign=herbst');
    expect(h.utm).toEqual({ utm_source: 'google', utm_campaign: 'herbst' });
  });

  it('von einer eigenen Seite: die vorige Seite ist der Einstieg, kein Referrer', () => {
    const h = herkunftAus({}, 'https://cse.test/leistungen/reinigung?x=1', HOST, '/angebot/reinigung');
    expect(h.referrerExtern).toBeUndefined();
    expect(h.landingPage).toBe('/leistungen/reinigung?x=1');
  });

  it('direkt aufgerufen: diese Seite ist der Einstieg', () => {
    expect(herkunftAus({}, null, HOST, '/en/angebot/bau'))
      .toEqual({ utm: {}, landingPage: '/en/angebot/bau' });
  });

  it('die weitergereichte Herkunft der Auswahlseite gewinnt über den eigenen Referer', () => {
    const h = herkunftAus(
      { einstieg: '/angebot?utm_source=newsletter', von: 'https://partner.example/liste', utm_source: 'newsletter' },
      'https://cse.test/angebot', HOST, '/angebot/security',
    );
    expect(h.landingPage).toBe('/angebot?utm_source=newsletter');
    expect(h.referrerExtern).toBe('https://partner.example/liste');
  });

  it('ein Kreis über die Auswahlseite ergibt dieselbe Herkunft wie der direkte Weg', () => {
    const auswahl = herkunftAus({ utm_medium: 'cpc' }, 'https://bing.com/', HOST, '/angebot');
    const q = Object.fromEntries(new URLSearchParams(herkunftAlsSuche(auswahl).slice(1)));
    const formular = herkunftAus(q, 'https://cse.test/angebot?utm_medium=cpc', HOST, '/angebot/bau');
    expect(formular).toEqual(auswahl);
  });

  it('kein Kampagnenparameter heisst: keine Adresszeichen an den Links', () => {
    expect(herkunftAlsSuche({ utm: {} })).toBe('');
  });
});

describe('was eine Adresse NICHT unterschieben darf', () => {
  it('„//fremd" ist kein eigener Pfad — sonst stünde ein fremder Link auf dem Leadblatt', () => {
    expect(eigenerPfad('//boese.example/x')).toBeUndefined();
    expect(eigenerPfad('/\\boese.example')).toBeUndefined();
    expect(eigenerPfad('https://boese.example/')).toBeUndefined();
    expect(eigenerPfad('/leistungen')).toBe('/leistungen');
  });

  it('der eigene Host ist kein fremder Referrer, javascript: keine Adresse', () => {
    expect(fremdeAdresse('https://cse.test/x', HOST)).toBeUndefined();
    expect(fremdeAdresse('https://CSE.test/x', HOST)).toBeUndefined();
    expect(fremdeAdresse('javascript:alert(1)', HOST)).toBeUndefined();
    expect(fremdeAdresse('kein url', HOST)).toBeUndefined();
  });

  it('Zugangsdaten in einer Referrer-Adresse werden entfernt', () => {
    expect(fremdeAdresse('https://nutzer:geheim@partner.example/p', HOST))
      .toBe('https://partner.example/p');
  });

  it('überlange und Steuerzeichen-Werte werden verworfen, nicht gekürzt', () => {
    expect(utmAus({ utm_source: 'x'.repeat(201) })).toEqual({});
    expect(utmAus({ utm_source: 'a\nb' })).toEqual({});
    expect(utmAus({ utm_source: ['erste', 'zweite'], utm_term: '  reinigung  ' }))
      .toEqual({ utm_source: 'erste', utm_term: 'reinigung' });
    expect(eigenerPfad(`/${'x'.repeat(600)}`)).toBeUndefined();
  });
});
