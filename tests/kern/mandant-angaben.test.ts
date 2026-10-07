/**
 * **Die Angaben einer Gesellschaft — die Regeln vor der Datenbank** (V-390,
 * D-804, TEN-01, TEN-02).
 *
 * `pruefeAngaben` sagt in Worten, was die CHECKs aus 0001 und 0120 als
 * letzte Linie halten: USt-IdNr. `DE` und neun Ziffern, fünfstellige
 * Postleitzahl, Adresse und Schema paarweise, ein eigener Nummernkreis nur
 * für eine eigene Rechtseinheit mit vollständigen Pflichtangaben nach § 14
 * UStG. Dazu, was keine Datenbank prüft: die IBAN-Prüfziffer, die BIC, die
 * Form von E-Mail und Webadresse. Und die drei Zustände der Rechtseinheit —
 * „nicht eingetragen" ist der Stand der CSE Operations (O-01), kein Fehler.
 */
import { describe, expect, it } from 'vitest';
import {
  AngabenFehler, ANGABEN_SAETZE, pruefeAngaben, type AngabenGrund,
} from '../../src/server/services/mandant/angaben.js';

const GUELTIG: Readonly<Record<string, string>> = {
  firma: 'CSE Dienstleistungen GmbH',
  rechtsform: 'GmbH',
  istRechtseinheit: 'ja',
  eigenerNummernkreis: 'ja',
  geschaeftsfuehrer: 'Erika Muster\nMax Beispiel',
  handelsregisterGericht: 'Amtsgericht Charlottenburg',
  handelsregisterNummer: 'HRB 200001 B',
  ustId: 'de 123 456 789',
  steuernummer: '27/123/45678',
  strasse: 'Kurfürstendamm 201',
  plz: '10719',
  ort: 'Berlin',
  land: 'de',
  email: 'office@example.test',
  web: 'https://example.test',
  iban: 'DE02 1203 0000 0000 2020 51',
  bic: 'BYLADEM1001',
  elektronischeAdresse: 'DE123456789',
  elektronischeAdresseSchema: '9930',
};

function aus(werte: Readonly<Record<string, string>>) {
  return (feld: string): string | null => werte[feld] ?? null;
}

function grund(werte: Readonly<Record<string, string>>): AngabenGrund | 'kein_fehler' {
  try {
    pruefeAngaben(aus(werte));
  } catch (fehler) {
    if (fehler instanceof AngabenFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

describe('gültige Angaben werden normalisiert', () => {
  it('USt-IdNr. groß und ohne Leerzeichen, IBAN ohne Leerzeichen, Land groß', () => {
    const a = pruefeAngaben(aus(GUELTIG));
    expect(a.ustId).toBe('DE123456789');
    expect(a.iban).toBe('DE02120300000000202051');
    expect(a.land).toBe('DE');
    expect(a.istRechtseinheit).toBe(true);
    expect(a.eigenerNummernkreis).toBe(true);
  });

  it('die Geschäftsführung je Zeile oder durch Komma getrennt, leere fallen weg', () => {
    expect(pruefeAngaben(aus(GUELTIG)).geschaeftsfuehrer).toEqual(['Erika Muster', 'Max Beispiel']);
    expect(pruefeAngaben(aus({ ...GUELTIG, geschaeftsfuehrer: 'A, B,\n\n C' })).geschaeftsfuehrer)
      .toEqual(['A', 'B', 'C']);
  });

  it('leere Felder werden null, ein fehlendes Land wird DE', () => {
    const a = pruefeAngaben(aus({ firma: 'X GmbH', telefon: '   ', land: '' }));
    expect(a.telefon).toBeNull();
    expect(a.land).toBe('DE');
    expect(a.geschaeftsfuehrer).toEqual([]);
  });
});

describe('die Rechtseinheit hat drei Zustände (O-01)', () => {
  it('„offen" und ein fehlendes Feld sind „nicht eingetragen", kein Fehler', () => {
    expect(pruefeAngaben(aus({ firma: 'CSE Operations', istRechtseinheit: 'offen' })).istRechtseinheit)
      .toBeNull();
    expect(pruefeAngaben(aus({ firma: 'CSE Operations' })).istRechtseinheit).toBeNull();
  });

  it('nein ist nein', () => {
    expect(pruefeAngaben(aus({ firma: 'X', istRechtseinheit: 'nein' })).istRechtseinheit).toBe(false);
  });

  it('ein anderer Wert wird abgewiesen', () => {
    expect(grund({ firma: 'X', istRechtseinheit: 'vielleicht' })).toBe('rechtseinheit');
  });
});

describe('was abgewiesen wird — mit dem Grund, den der Bildschirm sagt', () => {
  it.each([
    [{ ...GUELTIG, firma: '  ' }, 'firma_fehlt'],
    [{ ...GUELTIG, ustId: 'DE12345678' }, 'ust_id'],
    [{ ...GUELTIG, ustId: 'ATU12345678' }, 'ust_id'],
    [{ ...GUELTIG, plz: '1071' }, 'plz'],
    [{ ...GUELTIG, land: 'DEU' }, 'land'],
    [{ ...GUELTIG, iban: 'DE02 1203 0000 0000 2020 52' }, 'iban'],
    [{ ...GUELTIG, bic: 'BYLA' }, 'bic'],
    [{ ...GUELTIG, email: 'office(at)example.test' }, 'email'],
    [{ ...GUELTIG, web: 'example.test' }, 'web'],
    [{ ...GUELTIG, elektronischeAdresseSchema: '' }, 'eadresse_paar'],
    [{ ...GUELTIG, elektronischeAdresseSchema: 'XYZ' }, 'eadresse_schema'],
    [{ ...GUELTIG, istRechtseinheit: 'offen' }, 'kreis_ohne_rechtseinheit'],
    [{ ...GUELTIG, istRechtseinheit: 'nein' }, 'kreis_ohne_rechtseinheit'],
    [{ ...GUELTIG, ort: '' }, 'ustg14_unvollstaendig'],
    [{ ...GUELTIG, ustId: '', steuernummer: '' }, 'ustg14_unvollstaendig'],
    [{ ...GUELTIG, rechtsform: 'x'.repeat(201) }, 'zu_lang'],
  ] as const)('%#: %j → %s', (werte, erwartet) => {
    expect(grund(werte)).toBe(erwartet);
  });

  it('ohne eigenen Nummernkreis braucht es die § 14-Angaben nicht', () => {
    expect(grund({ firma: 'X GmbH', istRechtseinheit: 'ja' })).toBe('kein_fehler');
  });

  it('eine Steuernummer genügt statt der USt-IdNr.', () => {
    expect(grund({ ...GUELTIG, ustId: '' })).toBe('kein_fehler');
  });
});

describe('jeder Grund hat einen Satz', () => {
  it('kein Grund ohne Satz, kein Satz leer', () => {
    for (const satz of Object.values(ANGABEN_SAETZE)) expect(satz.length).toBeGreaterThan(10);
    expect(new AngabenFehler('ust_id').message).toBe(ANGABEN_SAETZE.ust_id);
  });
});
