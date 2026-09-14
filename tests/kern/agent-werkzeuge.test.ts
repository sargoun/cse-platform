/**
 * Der Werkzeugvertrag (AGT-02, Invariante 6, K-10).
 *
 * Geprüft wird das, was die Werkzeuge zu SCHÜTZEN behaupten:
 *
 *  1. **Ein Handle ist ein Gutschein, kein Bezeichner.** Eine Kennung aus
 *     einem Dokument lässt sich nicht auflösen — das ist die Sperre gegen
 *     eine Leseanweisung, die jemand in eine Vergabeunterlage schreibt.
 *  2. **Eine freistehende Zahl in erzeugtem Text ist ein harter Fehler.**
 *     Sie hat keine Herkunft, und niemand kann sie nachrechnen.
 *  3. **Der Seitenbereich ist begrenzt, nicht vertraut** — die einzige Zahl,
 *     die ein Modell in ein Argument schreiben darf.
 *  4. **Das Register erbt Unsicherheit**: ein Preis auf einer unsicheren
 *     Fläche ist unsicher, auch wenn die Multiplikation exakt war.
 *  5. **Die Untergrenzen stimmen mit den Nebenwirkungen überein** — ein
 *     Versand kann unter keiner Konfiguration ohne Freigabe laufen.
 */
import { describe, expect, it } from 'vitest';
import { HandleFehler, HandleTresor } from '../../src/server/agent/tools/handles.js';
import { RegisterFehler, Wertregister } from '../../src/server/agent/tools/register.js';
import {
  SEITEN_HOECHSTZAHL, WerkzeugEingabeFehler, pruefeSeitenbereich,
} from '../../src/server/agent/tools/typen.js';
import {
  WERKZEUGE, WERKZEUG_REGISTER, fuerAgent, untergrenze,
} from '../../src/server/agent/tools/register-werkzeuge.js';
import type { Quelle } from '../../src/server/agent/tools/typen.js';

const QUELLE: Quelle = {
  art: 'berechnet', dienst: 'test', dienstVersion: 'v1', eingabenHash: 'x',
};

describe('(1) Der Handle-Tresor', () => {
  it('eine Kennung aus einem Dokument ist kein Handle', () => {
    const t = new HandleTresor();
    t.praege('dok', '7f3a0000-0000-0000-0000-000000000001');
    /* Genau die Form, die in einer Vergabeunterlage stehen könnte. */
    expect(() => t.loese('7f3a0000-0000-0000-0000-000000000001', 'dok'))
      .toThrow(HandleFehler);
    expect(() => t.loese('dok_99', 'dok')).toThrow(/Unbekanntes Handle/u);
  });

  it('dieselbe Zeile bekommt dasselbe Handle', () => {
    const t = new HandleTresor();
    const a = t.praege('dok', 'id-1');
    const b = t.praege('dok', 'id-1');
    expect(a).toBe(b);
    expect(t.anzahl, 'zwei Handles auf dieselbe Datei waeren ein Scheinunterschied').toBe(1);
  });

  it('ein Handle der falschen Art loest nicht auf — und verraet nichts', () => {
    const t = new HandleTresor();
    const objekt = t.praege('objekt', 'id-1');
    /* Dieselbe Meldung wie fuer ein unbekanntes: die Antwort darf nicht
       verraten, welche Nummern es gibt (AUT-06). */
    expect(() => t.loese(objekt, 'dok')).toThrow(/Unbekanntes Handle/u);
    expect(t.loese(objekt, 'objekt')).toBe('id-1');
  });

  it('ein Handle aus einem anderen Lauf ist unbekannt', () => {
    const erst = new HandleTresor();
    const handle = erst.praege('dok', 'id-1');
    const zweit = new HandleTresor();
    expect(() => zweit.loese(handle, 'dok'), 'der Tresor ist je Lauf').toThrow(HandleFehler);
  });
});

describe('(2) Das Wertregister', () => {
  it('setzt Token ein und laesst keine freie Zahl stehen', () => {
    const r = new Wertregister();
    const preis = r.binde({ art: 'geld', betragCent: 45_600n, anzeige: '456,00 €', quelle: QUELLE });
    expect(r.setzeEin(`Der Preis liegt bei ${preis.token}.`)).toBe('Der Preis liegt bei 456,00 €.');
  });

  it('eine freistehende Zahl ist ein harter Fehler', () => {
    const r = new Wertregister();
    expect(() => r.setzeEin('Der Preis liegt bei 456,00 €.'))
      .toThrow(RegisterFehler);
    expect(() => r.setzeEin('Wir rechnen mit 3 Durchgängen.')).toThrow(/Invariante 6/u);
  });

  it('Gesetzesstellen, Lose und Formblaetter sind keine gerechneten Zahlen', () => {
    const r = new Wertregister();
    expect(r.setzeEin('Nach § 2 Abs. 6 VOB/B, Lose 1 bis 3, Formblatt 124.'))
      .toContain('Formblatt 124');
    expect(r.setzeEin('CPV-90910000 in DE300.')).toContain('DE300');
  });

  it('Unsicherheit wird geerbt, Konfidenz ist das Minimum', () => {
    const r = new Wertregister();
    const flaeche = r.binde({
      art: 'menge', wert: '120,000', anzeige: '120,000 m²',
      quelle: { art: 'dokument', dokument: 'dok_1', seite: 4, textausschnitt: '120 m²' },
    });
    /* Eine aus einem Dokument gezogene Flaeche, von einer Regel als unsicher markiert. */
    const unsicher = { ...flaeche, konfidenz: 0.6, unsicher: true };
    const preis = r.binde({
      art: 'geld', betragCent: 45_600n, anzeige: '456,00 €', quelle: QUELLE,
      eingaben: [unsicher],
    });
    expect(preis.unsicher, 'ein Preis auf unsicherer Flaeche ist unsicher').toBe(true);
    expect(preis.konfidenz).toBe(0.6);
    expect(preis.abgeleitetVon).toContain(flaeche.token);
  });

  it('ohne Eingaben ist eine gerechnete Zahl sicher', () => {
    const r = new Wertregister();
    const w = r.binde({ art: 'geld', betragCent: 1n, anzeige: '0,01 €', quelle: QUELLE });
    expect(w.konfidenz, 'eine deterministische Quelle raet nicht').toBe(1);
    expect(w.unsicher).toBe(false);
  });
});

describe('(3) Der Seitenbereich — die eine erlaubte Zahl', () => {
  it('nimmt einen sinnvollen Bereich an', () => {
    expect(pruefeSeitenbereich({ von: 2, bis: 5 }, 40)).toEqual({ von: 2, bis: 5 });
  });

  it('kappt an der echten Seitenzahl, statt abzuweisen', () => {
    expect(pruefeSeitenbereich({ von: 1, bis: 999 }, 12),
      '„bis Seite 999" heisst „bis zum Ende"').toEqual({ von: 1, bis: 12 });
  });

  it('weist ab, was keine begrenzte Zahl ist', () => {
    expect(() => pruefeSeitenbereich({ von: 0, bis: 5 }, 40)).toThrow(WerkzeugEingabeFehler);
    expect(() => pruefeSeitenbereich({ von: 5, bis: 2 }, 40)).toThrow(/liegt vor/u);
    expect(() => pruefeSeitenbereich({ von: 1.5, bis: 2 }, 40)).toThrow(/ganze Zahlen/u);
    expect(() => pruefeSeitenbereich({ von: 1, bis: SEITEN_HOECHSTZAHL + 1 }, null))
      .toThrow(new RegExp(String(SEITEN_HOECHSTZAHL), 'u'));
  });

  it('kein Bereich ist erlaubt — dann gilt das ganze Dokument', () => {
    expect(pruefeSeitenbereich(undefined, 40)).toBeNull();
  });
});

describe('(4) Das Werkzeugregister (AGT-02)', () => {
  it('neun Werkzeuge, nicht acht und nicht zehn', () => {
    expect(WERKZEUGE).toHaveLength(9);
    expect(Object.keys(WERKZEUG_REGISTER)).toHaveLength(9);
  });

  it('jedes Werkzeug sagt, was es NICHT tut', () => {
    for (const name of WERKZEUGE) {
      const d = WERKZEUG_REGISTER[name];
      expect(d.abgrenzung.length, `${name} ohne Abgrenzung`).toBeGreaterThan(20);
      expect(d.agenten.length, `${name} ohne Agenten`).toBeGreaterThan(0);
    }
  });

  it('ein Versand kann unter keiner Konfiguration ohne Freigabe laufen', () => {
    expect(WERKZEUG_REGISTER.sende_email.nebenwirkung).toBe('versand');
    expect(untergrenze('versand')).toBe('freigabe_erforderlich');
  });

  it('genau zwei Werkzeuge rechnen ohne Modell — und beide erzeugen nichts', () => {
    const ohne = WERKZEUGE.filter((w) => WERKZEUG_REGISTER[w].ohneModell);
    expect(ohne).toEqual(['suche_bestand', 'berechne_preis']);
    for (const w of ohne) {
      expect(WERKZEUG_REGISTER[w].nebenwirkung,
        `${w} darf nichts schreiben — es rechnet oder schlaegt nach`).toBe('lesen');
    }
  });

  it('berechne_preis fuehrt nur, wer kalkuliert', () => {
    expect(WERKZEUG_REGISTER.berechne_preis.agenten).toEqual(['akquise', 'finanzen']);
    expect(fuerAgent('backoffice').map((d) => d.name)).not.toContain('berechne_preis');
  });

  it('der CEO-Assistent darf lesen und entwerfen, aber nichts versenden', () => {
    const seine = fuerAgent('ceo_assistent');
    expect(seine.map((d) => d.name)).toContain('suche_bestand');
    expect(seine.map((d) => d.name), 'Versand ist Sache des Backoffice — und auch dort mit Freigabe')
      .not.toContain('sende_email');
  });
});
