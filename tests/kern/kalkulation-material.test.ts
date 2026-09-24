/**
 * Material und Gerät in der Kalkulation — die fünf Blöcke von OPS-07
 * (V-174).
 *
 * Bis hierher kannte `kalkuliere` nur Lohn → Gemeinkosten → Wagnis/Gewinn.
 * Ein Reinigungsangebot enthielt nie Reinigungsmittel oder Maschinen und war
 * systematisch zu niedrig; die gewählte Gemeinkostenbasis `selbstkosten`
 * wurde gespeichert und dann doch auf den Lohn gerechnet. Geprüft wird hier,
 * dass die Einzelkosten in den Preis gehen, dass die Basis wirkt, und dass
 * jede Zahl eine ganze Cent-Zahl aus einer getesteten Funktion ist.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { basisPunkte, cent, formatiereGeld } from '../../src/server/services/finanz/geld.js';
import { ANGEBOT_HAND_TEXTE } from '../../src/lib/i18n/verwaltung/angebot-hand.js';
import { HAND_ANGEBOT_KALKULATION } from '../../src/server/services/angebot/von-hand.js';
import {
  formatiereMenge, mengeAusPostgres, milliMenge,
} from '../../src/server/services/finanz/menge.js';
import type { Flaechenposten } from '../../src/server/services/kalkulation/richtzeit.js';
import {
  gemeinkostenBezug, kalkuliere, verteileNetto, LEERE_KALKULATION,
} from '../../src/server/services/kalkulation/index.js';
import {
  berechnungswegText, pruefeKostenposition,
} from '../../src/server/services/kalkulation/kostenposition.js';
import { KalkulationFehler } from '../../src/server/services/kalkulation/bestaetigung.js';

const posten = (flaeche: string, wert: string, name = 'PVC'): Flaechenposten => ({
  belagsartId: `b-${name}`, bezeichnung: name,
  flaeche: mengeAusPostgres(flaeche), leistungswert: mengeAusPostgres(wert),
});

/** 10 % Gemeinkosten, 5 % Wagnis, kein Gewinn — runde Zahlen zum Nachrechnen. */
const tarif = {
  stundensatz: cent(3000n), gemeinkostenSatz: basisPunkte(1000),
  wagnisSatz: basisPunkte(500), gewinnSatz: basisPunkte(0),
  istPlatzhalter: false, offeneFragen: [],
};
const frequenz = { faktor: milliMenge(1000n), istPlatzhalter: false, offeneFragen: [] };

describe('(1) ohne Material und Gerät rechnet die Kette wie bisher', () => {
  it('Lohn 60,00 → +10 % → +5 % = 69,30 €', () => {
    // 500 m² ÷ 250 m²/h = 2 h × 30,00 € = 60,00 €
    const k = kalkuliere({ posten: [posten('500', '250')], frequenz, tarif });
    expect(k.lohnkosten).toBe(6000n);
    expect(k.materialkosten).toBe(0n);
    expect(k.geraetekosten).toBe(0n);
    expect(k.gemeinkostenBasis).toBe('lohn');
    expect(k.gemeinkosten).toBe(600n);
    expect(k.vorZuschlag).toBe(6600n);
    expect(k.wagnis).toBe(330n);
    expect(k.netto).toBe(6930n);
  });

  it('die leere Kalkulation kennt die neuen Blöcke als null', () => {
    expect(LEERE_KALKULATION).toMatchObject({
      materialkosten: 0n, geraetekosten: 0n, gemeinkostenBezug: 0n, vorZuschlag: 0n,
      gemeinkostenBasis: 'lohn',
    });
  });
});

describe('(2) Material und Gerät gehen in den Preis — die Basis entscheidet nur den Gemeinkostenbezug', () => {
  const einzelkosten = { material: cent(1500n), geraet: cent(500n) };

  it('Basis Lohn: Gemeinkosten nur auf den Lohn, Einzelkosten trotzdem im Preis', () => {
    const k = kalkuliere({ posten: [posten('500', '250')], frequenz, tarif, einzelkosten,
                           gemeinkostenBasis: 'lohn' });
    expect(k.gemeinkostenBezug).toBe(6000n);
    expect(k.gemeinkosten).toBe(600n);                       // 10 % von 60,00
    expect(k.vorZuschlag).toBe(6000n + 1500n + 500n + 600n);  // 86,00
    expect(k.wagnis).toBe(430n);                              // 5 % von 86,00
    expect(k.netto).toBe(9030n);
    expect(formatiereGeld(k.netto).replace(/\u00a0/gu, ' ')).toBe('90,30 €');
  });

  it('Basis Selbstkosten: Gemeinkosten auf Lohn + Material + Gerät', () => {
    const k = kalkuliere({ posten: [posten('500', '250')], frequenz, tarif, einzelkosten,
                           gemeinkostenBasis: 'selbstkosten' });
    expect(k.gemeinkostenBezug).toBe(8000n);
    expect(k.gemeinkosten).toBe(800n);                        // 10 % von 80,00
    expect(k.vorZuschlag).toBe(8800n);
    expect(k.wagnis).toBe(440n);
    expect(k.netto).toBe(9240n);
  });

  it('ohne Einzelkosten sind beide Basen gleich — die Wahl wirkt erst mit Material', () => {
    const a = kalkuliere({ posten: [posten('500', '250')], frequenz, tarif,
                           gemeinkostenBasis: 'lohn' });
    const b = kalkuliere({ posten: [posten('500', '250')], frequenz, tarif,
                           gemeinkostenBasis: 'selbstkosten' });
    expect(a.netto).toBe(b.netto);
  });

  it('gemeinkostenBezug ist EINE Stelle', () => {
    expect(gemeinkostenBezug('lohn', cent(100n), einzelkosten)).toBe(100n);
    expect(gemeinkostenBezug('selbstkosten', cent(100n), einzelkosten)).toBe(2100n);
  });

  it('negative Einzelkosten gibt es nicht — sie wären eine Gutschrift im Preis', () => {
    expect(() => kalkuliere({ posten: [posten('500', '250')], frequenz, tarif,
      einzelkosten: { material: cent(-1n), geraet: cent(0n) } })).toThrow(/nicht negativ/u);
  });

  it('die verteilten Zeilenpreise ergeben EXAKT das Netto mit Material', () => {
    const k = kalkuliere({
      posten: [posten('500', '250', 'PVC'), posten('120.5', '180', 'Teppich'),
               posten('33.333', '90', 'Stein')],
      frequenz, tarif, einzelkosten: { material: cent(1234n), geraet: cent(999n) },
      gemeinkostenBasis: 'selbstkosten',
    });
    const preise = verteileNetto(k.zeilen, k.netto);
    expect(preise.reduce((s, p) => s + p, 0n)).toBe(k.netto);
  });
});

describe('(3) pruefeKostenposition — Menge × Einzelpreis in ganzen Cent', () => {
  const zeile = {
    kostenart: 'material', bezeichnung: 'Reinigungsmittel', menge: '12,5', einheit: 'l',
    einzelpreisEuro: '3,20',
  };

  it('12,5 l × 3,20 € = 40,00 €', () => {
    const p = pruefeKostenposition(zeile);
    expect(p).toMatchObject({ kostenart: 'material', menge: 12_500n, einzelpreis: 320n,
                              betrag: 4000n, einheit: 'l' });
    expect(berechnungswegText(p).replace(/\u00a0/gu, ' ')).toBe('12,50 l × 3,20 € = 40,00 €');
  });

  it('rundet einmal, halb aufwärts: 0,333 × 1,00 € = 0,33 €; 0,335 × 1,00 € = 0,34 €', () => {
    expect(pruefeKostenposition({ ...zeile, menge: '0,333', einzelpreisEuro: '1,00' }).betrag)
      .toBe(33n);
    expect(pruefeKostenposition({ ...zeile, menge: '0,335', einzelpreisEuro: '1,00' }).betrag)
      .toBe(34n);
  });

  it('eine Menge von null ist erlaubt — so wird eine Zeile neutralisiert, nicht gelöscht', () => {
    expect(pruefeKostenposition({ ...zeile, menge: '0' }).betrag).toBe(0n);
  });

  it.each([
    [{ kostenart: 'lohn' }, 'kostenart'],
    [{ bezeichnung: '  ' }, 'bezeichnung'],
    [{ einheit: '' }, 'einheit'],
    [{ menge: 'viel' }, 'menge'],
    [{ menge: '12,5 l' }, 'menge'],
    [{ menge: '-1' }, 'menge'],
    [{ menge: '1,2345' }, 'menge'],
    [{ einzelpreisEuro: '3.20' }, 'einzelpreis'],
    [{ einzelpreisEuro: '-3,20' }, 'einzelpreis'],
  ])('%o wird mit dem Feld %s abgewiesen', (abweichung, feld) => {
    let gefangen: unknown = null;
    try { pruefeKostenposition({ ...zeile, ...abweichung }); } catch (f) { gefangen = f; }
    expect(gefangen).toBeInstanceOf(KalkulationFehler);
    expect((gefangen as KalkulationFehler).feld).toBe(feld);
  });
});

describe('(4) die Menge ist eine DEUTSCHE Zahl — und was zwei Lesarten hat, wird nicht gedeutet', () => {
  const zeile = {
    kostenart: 'geraet', bezeichnung: 'Scheuersaugmaschine', menge: '1', einheit: 'Std',
    einzelpreisEuro: '2,00',
  };
  const fehlerVon = (abweichung: Partial<typeof zeile>): KalkulationFehler | null => {
    try { pruefeKostenposition({ ...zeile, ...abweichung }); } catch (f) {
      return f as KalkulationFehler;
    }
    return null;
  };

  it('Tausenderpunkt und Dezimalkomma: 1.234,5 Std × 2,00 € = 2.469,00 €', () => {
    const p = pruefeKostenposition({ ...zeile, menge: '1.234,5' });
    expect(p.menge).toBe(1_234_500n);
    expect(p.betrag).toBe(246_900n);
  });

  it('„1.000" sind tausend, nicht eins — der Punkt gruppiert', () => {
    expect(pruefeKostenposition({ ...zeile, menge: '1.000' }).menge).toBe(1_000_000n);
  });

  it('„12.50" hat zwei Lesarten und wird abgewiesen — mit Grund und Feld', () => {
    const f = fehlerVon({ menge: '12.50' });
    expect(f).toBeInstanceOf(KalkulationFehler);
    expect(f?.grund).toBe('mehrdeutig');
    expect(f?.feld).toBe('menge');
    expect(fehlerVon({ menge: '12,50' })).toBeNull();
  });

  it('was die Seite zum Berichtigen vorbelegt, liest der Dienst wieder genauso', () => {
    for (const roh of ['0,333', '12,5', '1.234,5', '999.999.999,999']) {
      const p = pruefeKostenposition({ ...zeile, menge: roh });
      const vorbelegt = pruefeKostenposition({ ...zeile, menge: formatiereMenge(p.menge) });
      expect(vorbelegt.menge, roh).toBe(p.menge);
    }
  });

  it('die Grenzen sind die der Spalte und der exakten Anzeige, keine Fachregel', () => {
    expect(fehlerVon({ menge: '1.000.000.000' })).toMatchObject(
      { grund: 'keine_zahl', feld: 'menge' });
    expect(fehlerVon({ menge: '999.999.999,999' })).toBeNull();
    expect(fehlerVon({ menge: '1', einzelpreisEuro: '90.071.992.547.409,92' })).toMatchObject(
      { grund: 'keine_zahl', feld: 'einzelpreis' });
    // 10 × 9.007.199.254.741,00 € liegt neun Cent über der Grenze, …
    expect(fehlerVon({ menge: '10', einzelpreisEuro: '9.007.199.254.741,00' })).toMatchObject(
      { grund: 'keine_zahl', feld: 'einzelpreis' });
    // … 10 × 9.007.199.254.740,99 € darunter.
    expect(fehlerVon({ menge: '10', einzelpreisEuro: '9.007.199.254.740,99' })).toBeNull();
    expect(fehlerVon({ menge: '1', einzelpreisEuro: '90.071.992.547.409,91' })).toBeNull();
  });
});

describe('(6) ein Angebot von Hand sagt, dass es keine Kalkulation hat (V-238, O-920)', () => {
  it('der Platzhalter nennt die Frage, und Maske und Kalkulationsblatt lesen ihn', () => {
    expect(HAND_ANGEBOT_KALKULATION).toEqual({ vorhanden: false, offeneFrage: 'O-920' });
    for (const seite of [
      'src/app/portal/[mandant]/angebote/neu/page.tsx',
      'src/app/portal/[mandant]/angebote/[id]/kalkulation/page.tsx',
    ]) {
      expect(readFileSync(seite, 'utf8'), seite).toContain('HAND_ANGEBOT_KALKULATION.offeneFrage');
    }
    expect(readFileSync('src/server/services/angebot/von-hand.ts', 'utf8'))
      .toContain('TODO(client, O-920)');
  });

  it('beide Sprachen sagen es, mit der Nummer', () => {
    expect(ANGEBOT_HAND_TEXTE.de.ohneKalkulation('O-920')).toContain('O-920');
    expect(ANGEBOT_HAND_TEXTE.en.ohneKalkulation('O-920')).toContain('O-920');
  });
});
