/**
 * Der Versandstand eines Käufers — das Prädikat, das FIN-11 sperrt
 * (07-INTEGRATIONEN §12.1, LEG-05, O-22).
 *
 * **Was diese Datei beweist:**
 *
 *  1. **Ein Pflichtkäufer ohne Übertragungsweg ist GESPERRT und fällt nicht
 *     auf E-Mail zurück.** Das ist die eine Zusage, um die es hier geht: eine
 *     XRechnung auf dem falschen Kanal gilt als nicht zugestellt, während die
 *     Zahlungsfrist läuft.
 *  2. Jede fehlende Pflichtangabe wird EINZELN genannt, mit BT-Nummer — nicht
 *     die erste, sondern alle.
 *  3. Ein öffentlicher Auftraggeber ist auch ohne `xrechnung_pflicht`
 *     pflichtig.
 *  4. Peppol, ZRE und OZG-RE gelten als NICHT VERBUNDEN, auch wenn alles
 *     gepflegt ist — der Zustand heisst dann `nicht_verbunden` und nicht
 *     `bereit`. **Und `email` genauso**, solange kein Postausgang
 *     angeschlossen ist (O-501): `server/versand/email.ts` gibt in JEDER
 *     Umgebung `verbunden = false` zurück, und ein zweites „E-Mail ist
 *     verbunden" in `erechnung.ts` wäre genau die vorgetäuschte Integration,
 *     die diese Datei für die drei Häfen ausschliesst.
 *  5. Ein Nicht-Pflichtkäufer ohne Weg ist `offen`, nicht `gesperrt`: kein
 *     Mangel, aber auch keine Zusage.
 *  6. Der Weg `email` ohne Rechnungsadresse sperrt — mit BT-43 in der Liste.
 *  7. Eine elektronische Adresse ohne Schema (BT-49-1) fehlt, eine mit Schema
 *     nicht.
 */
import { describe, expect, it } from 'vitest';
import {
  WEGE, WEG_VERBUNDEN, fehlendeKaeuferangaben, versandLage, wegVerbunden,
  type KaeuferLage,
} from '../../src/server/services/crm/erechnung.js';

/** Die Umgebung, in der diese Installation heute läuft: kein Postausgang (O-501). */
const OHNE_POSTAUSGANG = { postausgangVerbunden: false } as const;
/** Die Umgebung, die es gäbe, wenn jemand einen Anbieter anschlösse. */
const MIT_POSTAUSGANG = { postausgangVerbunden: true } as const;

/** Ein vollständig gepflegter Pflichtkäufer — die Grundlage der Abwandlungen. */
function kaeufer(teil: Partial<KaeuferLage> = {}): KaeuferLage {
  return {
    xrechnungPflicht: true,
    istOeffentlicherAuftraggeber: true,
    leitwegId: '991-12345-67',
    kaeuferReferenz: 'KR-2026-1',
    elektronischeAdresse: '991-12345-67',
    elektronischeAdresseSchema: '0204',
    uebertragungsweg: 'ozg_re',
    rechnungsformat: 'xrechnung_ubl',
    rechnungEmail: 'rechnung@bezirksamt.test',
    ...teil,
  };
}

describe('FIN-11 · ein Pflichtkäufer ohne Übertragungsweg SPERRT', () => {
  it('der Zustand ist `gesperrt`, nicht `bereit` und nicht `offen`', () => {
    const lage = versandLage(kaeufer({ uebertragungsweg: null }));
    expect(lage.art).toBe('gesperrt');
  });

  it('der Satz sagt ausdrücklich, dass NICHT zurückgefallen wird', () => {
    const lage = versandLage(kaeufer({ uebertragungsweg: null }));
    expect(lage.text).toContain('fällt nicht');
  });

  it('die fehlende Angabe steht in der Liste, mit der offenen Nummer', () => {
    const fehlend = fehlendeKaeuferangaben(kaeufer({ uebertragungsweg: null }));
    const weg = fehlend.find((f) => f.feld === 'Übertragungsweg');
    expect(weg).toBeDefined();
    expect(weg?.text).toContain('O-22');
  });

  it('eine vorhandene Rechnungsadresse heilt es NICHT', () => {
    // Genau der Rückfall, den §12.1 verbietet: E-Mail ist da, also „geht es
    // schon irgendwie". Nein.
    const lage = versandLage(kaeufer({
      uebertragungsweg: null, rechnungEmail: 'x@y.test',
    }));
    expect(lage.art).toBe('gesperrt');
  });
});

describe('Pflichtangaben · alle, einzeln, mit BT-Nummer', () => {
  it('ein leerer Pflichtkäufer nennt VIER Mängel, nicht einen', () => {
    /*
     * Vier und nicht fünf: fehlt die Adresse selbst (BT-49), wird ihr Schema
     * (BT-49-1) NICHT zusätzlich gemeldet. Ein Schema ohne Adresse zu
     * verlangen wäre ein zweiter Mangel für dieselbe Lücke — und eine Liste,
     * die eine Lücke doppelt zählt, schickt jemanden zweimal in dieselbe
     * Maske.
     */
    const fehlend = fehlendeKaeuferangaben(kaeufer({
      leitwegId: null, elektronischeAdresse: null, elektronischeAdresseSchema: null,
      uebertragungsweg: null, rechnungsformat: null,
    }));
    expect(fehlend).toHaveLength(4);
    expect(fehlend.map((f) => f.bt)).not.toContain('BT-49-1');
    expect(fehlend.map((f) => f.bt)).toContain('BT-10');
    expect(fehlend.map((f) => f.bt)).toContain('BT-49');
  });

  it('jeder Mangel trägt Regel, Feld und einen Satz', () => {
    for (const f of fehlendeKaeuferangaben(kaeufer({
      leitwegId: null, elektronischeAdresse: null, uebertragungsweg: null,
      rechnungsformat: null,
    }))) {
      expect(f.regel.length, f.bt).toBeGreaterThan(3);
      expect(f.feld.length, f.bt).toBeGreaterThan(3);
      expect(f.text.length, f.bt).toBeGreaterThan(20);
    }
  });

  it('eine Adresse OHNE Schema fehlt als BT-49-1', () => {
    const fehlend = fehlendeKaeuferangaben(
      kaeufer({ elektronischeAdresseSchema: null }));
    expect(fehlend.map((f) => f.bt)).toContain('BT-49-1');
  });

  it('eine Adresse MIT Schema fehlt nicht', () => {
    expect(fehlendeKaeuferangaben(kaeufer())).toHaveLength(0);
  });

  it('eine Leitweg-ID aus Leerzeichen zählt als fehlend', () => {
    const fehlend = fehlendeKaeuferangaben(kaeufer({ leitwegId: '   ' }));
    expect(fehlend.map((f) => f.bt)).toContain('BT-10');
  });

  it('ein NICHT-Pflichtkäufer hat keine Pflichtangaben', () => {
    expect(fehlendeKaeuferangaben(kaeufer({
      xrechnungPflicht: false, istOeffentlicherAuftraggeber: false,
      leitwegId: null, elektronischeAdresse: null, elektronischeAdresseSchema: null,
    }))).toHaveLength(0);
  });

  it('ein öffentlicher Auftraggeber ist pflichtig, auch ohne `xrechnung_pflicht`', () => {
    const fehlend = fehlendeKaeuferangaben(kaeufer({
      xrechnungPflicht: false, istOeffentlicherAuftraggeber: true, leitwegId: null,
    }));
    expect(fehlend.map((f) => f.bt)).toContain('BT-10');
  });
});

describe('nicht verbunden ist nicht bereit', () => {
  it('Peppol, ZRE und OZG-RE gelten als nicht verbunden', () => {
    for (const weg of ['peppol', 'zre', 'ozg_re'] as const) {
      expect(WEG_VERBUNDEN[weg], weg).toBe(false);
      const lage = versandLage(kaeufer({ uebertragungsweg: weg }));
      expect(lage.art, weg).toBe('nicht_verbunden');
      expect(lage.text).toContain('NICHT verbunden');
    }
  });

  it('Kundenportal und Post brauchen keinen Anschluss — ein Mensch bedient sie', () => {
    for (const weg of ['kundenportal', 'post'] as const) {
      expect(WEG_VERBUNDEN[weg], weg).toBe(true);
      expect(versandLage(kaeufer({ uebertragungsweg: weg }), OHNE_POSTAUSGANG).art, weg)
        .toBe('bereit');
    }
  });

  it('E-Mail IST ein Anschluss — und dieses Haus hat keinen (O-501)', () => {
    /*
     * Der Fehler, den diese Zusage verhindert: `WEG_VERBUNDEN.email = true`
     * liess auf dem Steuerblatt eines Kunden die grüne Pille „Bereit" für
     * einen Kanal stehen, den `emailDienst(...)` in jeder Umgebung mit
     * `verbunden = false` beantwortet. Ein Versandstand, der „bereit" sagt,
     * während nichts hinausgeht, ist genau der Fall aus dem Kopf dieser Datei.
     */
    expect(WEG_VERBUNDEN.email).toBe(false);
    const lage = versandLage(
      kaeufer({ uebertragungsweg: 'email' }), OHNE_POSTAUSGANG);
    expect(lage.art).toBe('nicht_verbunden');
    expect(lage.text).toContain('O-501');
  });

  it('OHNE Umgebung gilt: kein Postausgang — fail closed', () => {
    expect(versandLage(kaeufer({ uebertragungsweg: 'email' })).art)
      .toBe('nicht_verbunden');
  });

  it('mit angeschlossenem Postausgang ist E-Mail bereit — und NUR dann', () => {
    expect(wegVerbunden('email', MIT_POSTAUSGANG)).toBe(true);
    expect(wegVerbunden('email', OHNE_POSTAUSGANG)).toBe(false);
    expect(versandLage(kaeufer({ uebertragungsweg: 'email' }), MIT_POSTAUSGANG).art)
      .toBe('bereit');
  });

  it('ein angeschlossener Postausgang öffnet KEINEN der drei Häfen', () => {
    for (const weg of ['peppol', 'zre', 'ozg_re'] as const) {
      expect(wegVerbunden(weg, MIT_POSTAUSGANG), weg).toBe(false);
    }
  });

  it('jeder Enumwert hat einen Verbindungszustand — kein `undefined`', () => {
    for (const weg of WEGE) {
      expect(typeof WEG_VERBUNDEN[weg], weg).toBe('boolean');
    }
  });
});

describe('offen ist kein Mangel — und keine Zusage', () => {
  it('kein Pflichtkäufer, kein Weg → `offen`', () => {
    const lage = versandLage(kaeufer({
      xrechnungPflicht: false, istOeffentlicherAuftraggeber: false,
      uebertragungsweg: null,
    }));
    expect(lage.art).toBe('offen');
    expect(lage.fehlend).toHaveLength(0);
  });
});

describe('E-Mail ohne Adresse sperrt — mit BT-43, auch ohne Anschluss', () => {
  it('der Mangel am KUNDEN geht dem fehlenden Anschluss vor', () => {
    // Sonst verdeckte „nicht verbunden" die fehlende Rechnungsadresse, und
    // niemand pflegte sie nach, bis der Anschluss steht.
    const lage = versandLage(kaeufer({
      uebertragungsweg: 'email', rechnungEmail: null,
    }), OHNE_POSTAUSGANG);
    expect(lage.art).toBe('gesperrt');
  });

  it('der Zustand ist gesperrt', () => {
    const lage = versandLage(kaeufer({
      uebertragungsweg: 'email', rechnungEmail: null,
    }));
    expect(lage.art).toBe('gesperrt');
    expect(lage.fehlend.map((f) => f.bt)).toContain('BT-43');
  });

  it('eine leere Adresse ist wie keine', () => {
    expect(versandLage(kaeufer({
      uebertragungsweg: 'email', rechnungEmail: '  ',
    })).art).toBe('gesperrt');
  });
});

describe('bereit nennt Weg UND Format', () => {
  it('beides steht im Satz', () => {
    const lage = versandLage(kaeufer({
      uebertragungsweg: 'email', rechnungsformat: 'zugferd',
    }), MIT_POSTAUSGANG);
    expect(lage.art).toBe('bereit');
    expect(lage.text).toContain('E-Mail');
    expect(lage.text).toContain('ZUGFeRD');
  });
});
