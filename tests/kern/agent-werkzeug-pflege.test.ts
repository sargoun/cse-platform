import { describe, expect, it } from 'vitest';
import {
  WERKZEUGE, WERKZEUG_REGISTER, fuerAgent,
} from '../../src/server/agent/tools/register-werkzeuge.js';
import {
  MIT_AUSFUEHRER, hatAusfuehrer, ohneAusfuehrer,
} from '../../src/server/agent/tools/ausfuehrer.js';
import {
  WerkzeugNichtFreigeschaltet, sperrErgebnis, standAus,
} from '../../src/server/agent/tools/freischaltung.js';
import {
  WerkzeugPflegeFehler, pruefeWerkzeugPaar,
} from '../../src/server/services/agent/werkzeug-pflege.js';
import { WERKZEUG_TEXT } from '../../src/lib/i18n/beschriftung/agent.js';

/**
 * Werkzeuge pflegbar, von der Laufzeit beachtet, und nie als „bereit"
 * ausgewiesen, wenn sie gar nicht laufen können (AGT-01, AGT-02, V-228, D-722).
 *
 * Die Datenbankseite — Upsert, Policy, CHECK, das Tor vor dem Assistenten —
 * prüft `tests/isolation/agent-werkzeug-pflege.test.ts`.
 */

function grund(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (fehler) {
    return fehler instanceof WerkzeugPflegeFehler ? fehler.grund : 'anderer';
  }
}

describe('Ausführer — zwei, und die sind die ohne Modell', () => {
  it('genau suche_bestand und berechne_preis haben einen', () => {
    expect([...MIT_AUSFUEHRER].sort()).toEqual(['berechne_preis', 'suche_bestand']);
  });

  it('die sieben übrigen antworten ehrlich „kein_modellzugang", ohne Daten', () => {
    const ohne = WERKZEUGE.filter((w) => !hatAusfuehrer(w));
    expect(ohne).toHaveLength(7);
    for (const w of ohne) {
      const e = ohneAusfuehrer(w);
      expect(e.ok, w).toBe(false);
      /* `ohneAusfuehrer` liefert seit V-270 den Typ `Fehlschlag` — `fehler` ist immer da. */
      expect(e.fehler.code, w).toBe('kein_modellzugang');
      expect(e).not.toHaveProperty('daten');
    }
  });

  /*
   * Hier prüfte bis V-270 ein Fall nur, dass der Kommentar im Register den
   * Namen `ohneAusfuehrer` nennt — er bestand, obwohl kein Code die Funktion
   * rief. Jetzt antwortet das Tor damit, und geprüft wird die Antwort.
   */
  it('das Tor weist ein freigeschaltetes Werkzeug ohne Ausführer mit genau dieser Antwort ab', () => {
    for (const w of WERKZEUGE.filter((x) => !hatAusfuehrer(x))) {
      const stand = standAus(w, { ist_aktiv: true, erfordert_freigabe: true });
      expect(stand.bereit, w).toBe(false);
      const fehler = new WerkzeugNichtFreigeschaltet(stand);
      expect(fehler.ergebnis, w).toEqual(ohneAusfuehrer(w));
      expect(fehler.message, w).toBe(ohneAusfuehrer(w).fehler.nachricht);
      expect(fehler.code, w).toBe('werkzeug_gesperrt');
    }
  });

  it('nicht freigeschaltet heisst „nicht erlaubt" — mit Ausführer und ohne', () => {
    for (const w of ['suche_bestand', 'lies_dokument'] as const) {
      const ergebnis = sperrErgebnis(standAus(w, undefined));
      expect(ergebnis.fehler.code, w).toBe('nicht_erlaubt');
      expect(ergebnis, w).not.toHaveProperty('daten');
    }
  });
});

describe('standAus — „bereit" heisst freigeschaltet UND ausführbar', () => {
  it('keine Zeile ist aus und mit Freigabe — die Vorgabe, nicht die Lockerung', () => {
    expect(standAus('suche_bestand', undefined)).toMatchObject({
      freigeschaltet: false, erfordertFreigabe: true, ausfuehrbar: true, bereit: false,
    });
  });

  it('freigeschaltet und mit Ausführer ist bereit', () => {
    expect(standAus('suche_bestand', { ist_aktiv: true, erfordert_freigabe: false }).bereit)
      .toBe(true);
  });

  it('ein freigeschaltetes Modellwerkzeug ist NICHT bereit', () => {
    expect(standAus('entwirf_text', { ist_aktiv: true, erfordert_freigabe: true })).toMatchObject({
      freigeschaltet: true, ausfuehrbar: false, bereit: false,
    });
  });
});

describe('pruefeWerkzeugPaar — nur Paare aus dem Register, Versand nie ohne Freigabe', () => {
  it('ein Paar aus dem Register geht durch', () => {
    expect(pruefeWerkzeugPaar('ceo_assistent', 'suche_bestand', false))
      .toEqual({ agent: 'ceo_assistent', werkzeug: 'suche_bestand' });
  });

  it('ein Werkzeug, das der Agent nicht führt, nicht (D-513)', () => {
    expect(fuerAgent('ceo_assistent').map((w) => w.name)).not.toContain('sende_email');
    expect(grund(() => pruefeWerkzeugPaar('ceo_assistent', 'sende_email', true)))
      .toBe('nicht_im_register');
  });

  it('sende_email ohne Freigabe ist abgewiesen — Invariante 7', () => {
    expect(WERKZEUG_REGISTER.sende_email.agenten).toContain('backoffice');
    expect(grund(() => pruefeWerkzeugPaar('backoffice', 'sende_email', false)))
      .toBe('freigabe_pflicht');
    expect(grund(() => pruefeWerkzeugPaar('backoffice', 'sende_email', true))).toBeNull();
  });

  it('ein unbekanntes Werkzeug und ein unbekannter Agent sind keine', () => {
    expect(grund(() => pruefeWerkzeugPaar('ceo_assistent', 'loesche_alles', true)))
      .toBe('unbekannt');
    expect(grund(() => pruefeWerkzeugPaar('praktikant', 'suche_bestand', true)))
      .toBe('kein_agent');
    expect(grund(() => pruefeWerkzeugPaar('ceo_assistent', 'toString', true)))
      .toBe('unbekannt');
  });
});

describe('jedes Werkzeug hat ein Wort, in beiden Sprachen', () => {
  it('neun Namen, kein Unterstrich im sichtbaren Text', () => {
    for (const s of ['de', 'en'] as const) {
      for (const w of WERKZEUGE) {
        const wort = WERKZEUG_TEXT[s][w];
        expect(wort, `${s}:${w}`).toBeTruthy();
        expect(wort, `${s}:${w}`).not.toContain('_');
      }
    }
  });
});
