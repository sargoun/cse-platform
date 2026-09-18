/**
 * Die Regeln der Website-Pflege — **ohne Datenbank, weil sie ohne Datenbank
 * gelten** (REQ-01 … REQ-04, PRO-02, PUB-11, D-75, D-82).
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Der Zustand einer Formularversion ist eine ABLEITUNG aus zwei
 *     Zeitpunkten — und `zurueckgezogen_am` schlägt `veroeffentlicht_am`.
 *     Umgekehrt gelesen stünden vier lebende Formulare da, wo eines lebt.
 *  2. Die Reaktionszeit sagt „24 Stunden — vorläufig (O-14)" und nicht „noch
 *     nicht festgelegt". Der Erstbestand TRÄGT die 24 (D-75); ein Bildschirm,
 *     der sie verschweigt, behauptet das Gegenteil der Daten.
 *  3. Eine neue Version ist `max + 1` und nie `anzahl + 1` — bei einer Lücke
 *     in den Nummern kollidierte das zweite mit `formular_definition_version_uk`.
 *  4. Was die Website-Redaktion als Neuigkeit zeigt, ist genau
 *     `NEUIGKEITS_ARTEN` (O-548) — eine Liste, die mehr zeigt als die Seite
 *     dahinter, ist keine Vorschau.
 *  5. Ein Leistungseintrag ohne Namen ist kein Eintrag: der LESER
 *     (`jsonld.ts`) verwirft ihn, und deshalb darf der Schreibweg ihn nicht
 *     annehmen.
 */
import { describe, expect, it } from 'vitest';
import {
  ZUSTAND_TEXT, felderEingefroren, formularZustand, naechsteVersion, reaktionszeitText,
} from '../../src/lib/formular/pflege.js';
import { NEUIGKEITS_ARTEN } from '../../src/server/services/social/dienst.js';
import { leistungenAus } from '../../src/server/services/inhalt/jsonld.js';

const IRGENDWANN = '2026-09-01T10:00:00.000Z';
const SPAETER = '2026-09-18T10:00:00.000Z';

describe('(1) der Zustand einer Formularversion kommt aus zwei Zeitpunkten', () => {
  it('kein Zeitpunkt heisst Entwurf', () => {
    expect(formularZustand(null, null)).toBe('entwurf');
  });

  it('veroeffentlicht und nicht zurueckgezogen heisst live', () => {
    expect(formularZustand(IRGENDWANN, null)).toBe('live');
  });

  it('zurueckgezogen schlaegt veroeffentlicht — und DAS ist der Punkt', () => {
    /*
     * `kern.erzwinge_serverzeit_veroeffentlichung` FRIERT
     * `veroeffentlicht_am` ein: eine zurueckgezogene Version behaelt ihren
     * Veroeffentlichungszeitpunkt. Wer zuerst nach ihm fragte, bekaeme fuer
     * jede zurueckgezogene Version „live" — und die Liste zeigte vier lebende
     * Formulare, wo eines lebt. Entferne die erste Zeile in
     * `formularZustand`, und diese Pruefung faellt.
     */
    expect(formularZustand(IRGENDWANN, SPAETER)).toBe('zurueckgezogen');
  });

  it('ein Rueckzug ohne Veroeffentlichung wird nicht wegargumentiert', () => {
    expect(formularZustand(null, SPAETER)).toBe('zurueckgezogen');
  });

  it('nur der Entwurf ist in seinen Feldern aenderbar', () => {
    // Dieselbe Grenze wie `kern.formular_definition_unveraenderlich`.
    expect(felderEingefroren('entwurf')).toBe(false);
    expect(felderEingefroren('live')).toBe(true);
    expect(felderEingefroren('zurueckgezogen')).toBe(true);
  });

  it('jeder Zustand hat einen deutschen Namen — die Oberflaeche ist deutsch', () => {
    for (const z of ['entwurf', 'live', 'zurueckgezogen'] as const) {
      expect(ZUSTAND_TEXT[z].length).toBeGreaterThan(0);
    }
  });
});

describe('(2) die Reaktionszeit ist vorlaeufig, nicht unbekannt (D-75, O-14)', () => {
  it('24 Stunden werden ANGEZEIGT und als vorlaeufig markiert', () => {
    const text = reaktionszeitText(24);
    expect(text).toContain('24');
    expect(text).toContain('vorläufig');
    expect(text).toContain('O-14');
  });

  it('und NICHT als „noch nicht festgelegt" — der Wert steht in der Zeile', () => {
    /*
     * Der Seed schreibt die 24 absichtlich in die ZEILE und nicht als
     * Spalten-DEFAULT (`seed/index.ts`), und D-75 verlangt, dass die
     * Oberflaeche sie als vorlaeufig ausweist. „Noch nicht festgelegt" ueber
     * einem gepflegten Wert ist eine falsche Auskunft, und zwar eine
     * beruhigende.
     */
    expect(reaktionszeitText(24)).not.toContain('nicht festgelegt');
  });

  it('der Nullfall bleibt — ein Formular ohne Zustaendigkeitszeile hat keine Frist', () => {
    expect(reaktionszeitText(null)).toBe('offen (O-14)');
  });
});

describe('(3) eine neue Version ist max + 1', () => {
  it('aus einer Version wird die zweite', () => {
    expect(naechsteVersion([1])).toBe(2);
  });

  it('eine LUECKE in den Nummern zaehlt nicht mit', () => {
    /*
     * `anzahl + 1` gaebe hier 3 — und 3 gibt es schon.
     * `formular_definition_version_uk` (mandant, schluessel, version) wiese
     * den Einfuegeversuch ab, mit einer Meldung aus der Datenbank, die
     * niemandem sagt, was gemeint war.
     */
    expect(naechsteVersion([1, 3])).toBe(4);
  });

  it('die Reihenfolge der Eingabe ist gleichgueltig', () => {
    expect(naechsteVersion([3, 1, 2])).toBe(4);
  });

  it('ohne Vorgaenger beginnt es bei 1 — `version > 0` ist ein Check', () => {
    expect(naechsteVersion([])).toBe(1);
  });
});

describe('(4) Neuigkeit ist eine ART, keine zweite Spalte (O-548)', () => {
  it('genau zwei Arten zaehlen als Neuigkeit', () => {
    expect([...NEUIGKEITS_ARTEN].sort()).toEqual(['aktualisierung', 'neuigkeit']);
  });

  it('eine Projektschau zaehlt heute NICHT — sie hat ihre eigene Liste', () => {
    expect(NEUIGKEITS_ARTEN).not.toContain('projektschau');
    expect(NEUIGKEITS_ARTEN).not.toContain('beitrag');
  });
});

describe('(5) ein Leistungseintrag ohne Namen ist kein Eintrag (PUB-11)', () => {
  it('der Leser verwirft ihn — die ganze Liste, nicht nur die Zeile', () => {
    /*
     * `leistungenAus` prueft die Liste als GANZES (`z.array(LEISTUNG)`): ein
     * einziger leerer Name laesst sie durchfallen, und die oeffentliche Seite
     * zeigt dann „noch keine Leistungen hinterlegt". Genau deshalb weist
     * `setzeLeistungen` einen leeren Namen ab, statt ihn stillschweigend
     * mitzuschreiben — sonst verschwaende EIN Tippfehler alle zehn Eintraege.
     */
    expect(leistungenAus({ leistungen: [{ name: '' }] })).toEqual([]);
    expect(leistungenAus({ leistungen: [{ name: 'Unterhaltsreinigung' }, { name: ' ' }] }))
      .toEqual([]);
  });

  it('ein gueltiger Eintrag geht durch, mit und ohne Beschreibung', () => {
    expect(leistungenAus({
      leistungen: [
        { name: 'Unterhaltsreinigung', beschreibung: 'Täglich, nach Revierplan.' },
        { name: 'Glasreinigung' },
      ],
    })).toEqual([
      { name: 'Unterhaltsreinigung', beschreibung: 'Täglich, nach Revierplan.' },
      { name: 'Glasreinigung' },
    ]);
  });

  it('ein fehlender Schluessel ist eine leere Liste und kein Fehler', () => {
    // Genau der Fall von `/unternehmen/operations`: kein Leistungsabschnitt.
    expect(leistungenAus({})).toEqual([]);
    expect(leistungenAus(null)).toEqual([]);
  });
});
