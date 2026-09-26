import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KEINE_LUECKE, anfrageLuecken, lueckenText,
} from '../../src/server/services/lead/einsendung.js';
import { DemoModell, fuelle } from '../../src/server/agent/modell/demo.js';
import type { FormularFeld } from '../../src/lib/formular/schema.js';

/**
 * Der Antwortentwurf des Akquise-Agenten nennt nur Lücken, die in der Anfrage
 * wirklich leer sind — und keine interne Zahl (§17 „names gaps", Invariante
 * 6/7, V-230, D-724).
 *
 * Die Abfrage selbst (nur offene Anfragen, Formular gegen Daten, keine
 * Anfrage → kein Lauf) prüft `tests/isolation/agent-lauf.test.ts` (10).
 */

const feld = (
  schluessel: string, label: string, typ: FormularFeld['typ'], sortierung: number,
): FormularFeld => ({
  schluessel, label, typ, sortierung, pflicht: false, fehlermeldung: 'Bitte angeben.',
  ...(typ === 'auswahl' || typ === 'mehrfachauswahl'
    ? { optionen: [{ wert: 'woechentlich', label: 'wöchentlich' }] } : {}),
  ...(typ === 'dezimal' ? { nachkommastellen: 2 } : {}),
  ...(typ === 'datei' ? { mime: ['application/pdf'], maxBytes: 1000 } : {}),
} as FormularFeld);

const REINIGUNG: readonly FormularFeld[] = [
  feld('flaeche_qm', 'Fläche in m²', 'dezimal', 2),
  feld('frequenz', 'Reinigungsfrequenz', 'auswahl', 3),
  feld('firma', 'Firma', 'text', 1),
  feld('nachricht', 'Ihre Nachricht', 'textarea', 4),
  feld('einwilligung_werbung', 'Werbung', 'checkbox', 5),
  feld('lv_datei', 'Leistungsverzeichnis', 'datei', 6),
];

describe('anfrageLuecken — nur, was die Daten leer lassen', () => {
  it('zwei Anfragen mit verschiedenen Lücken ergeben verschiedene Lücken', () => {
    const a = anfrageLuecken(REINIGUNG, { firma: 'Nord GmbH', flaeche_qm: 1200 });
    const b = anfrageLuecken(REINIGUNG, { firma: 'Süd GmbH', frequenz: 'woechentlich' });
    expect(a).toEqual(['Reinigungsfrequenz']);
    expect(b).toEqual(['Fläche in m²']);
  });

  it('eine vollständige Anfrage hat keine Lücke — und die Personenzahl kommt nirgends vor', () => {
    const l = anfrageLuecken(REINIGUNG, {
      firma: 'Nord GmbH', flaeche_qm: 1200, frequenz: 'woechentlich',
    });
    expect(l).toEqual([]);
    expect(lueckenText(l)).toBeNull();
  });

  it('Häkchen, Freitext und Datei sind keine Lücke', () => {
    expect([...KEINE_LUECKE].sort()).toEqual(['checkbox', 'datei', 'textarea']);
    const l = anfrageLuecken(REINIGUNG, { firma: 'Nord GmbH', flaeche_qm: 1, frequenz: 'woechentlich' });
    expect(l).not.toContain('Ihre Nachricht');
    expect(l).not.toContain('Werbung');
    expect(l).not.toContain('Leistungsverzeichnis');
  });

  it('eine Null ist eine Angabe, ein Leerzeichen nicht', () => {
    expect(anfrageLuecken(REINIGUNG, {
      firma: '   ', flaeche_qm: 0, frequenz: 'woechentlich',
    })).toEqual(['Firma']);
  });

  it('in der Reihenfolge des Formulars, als deutsche Aufzählung', () => {
    const l = anfrageLuecken(REINIGUNG, {});
    expect(l).toEqual(['Firma', 'Fläche in m²', 'Reinigungsfrequenz']);
    expect(lueckenText(l)).toBe('Firma, Fläche in m² und Reinigungsfrequenz');
    expect(lueckenText(['A', 'B'])).toBe('A und B');
    expect(lueckenText(['A'])).toBe('A');
  });
});

describe('der Entwurf an den Kunden', () => {
  const tatsachen = {
    stand: '01.10.2026', empfaenger: 'Nord GmbH', datum: '30.09.2026',
    betreff: 'Unterhaltsreinigung', zusammenfassung: 'Ihr Anliegen ist bei uns aufgenommen.',
  };

  it('mit Lücke steht der Satz da, mit genau dieser Lücke', async () => {
    const e = await new DemoModell().entwerfe({
      vorlage: 'anfrage_antwort_entwurf',
      tatsachen: { ...tatsachen, offen: 'Reinigungsfrequenz' },
      maxTokenAusgabe: 500,
    });
    expect(e.text).toContain('folgende Angaben: Reinigungsfrequenz.');
    expect(e.text).not.toMatch(/\{[a-z_]+\}|\[\[|\]\]/u);
  });

  it('ohne Lücke entfällt der Satz — kein stehengelassener Platzhalter', async () => {
    const e = await new DemoModell().entwerfe({
      vorlage: 'anfrage_antwort_entwurf', tatsachen, maxTokenAusgabe: 500,
    });
    expect(e.text).not.toContain('fehlen uns');
    expect(e.text).not.toMatch(/\{[a-z_]+\}|\[\[|\]\]/u);
    expect(e.text).toContain('Der Text ist ein Entwurf');
  });

  it('ausserhalb von [[…]] bleibt ein fehlender Platzhalter sichtbar', () => {
    expect(fuelle('Hallo {name}. [[Offen: {offen}.]]', {})).toBe('Hallo {name}. ');
  });

  it('kein Personenzahl-Literal und keine interne Anfragezahl mehr im Quelltext', () => {
    const auftraege = readFileSync('src/server/agent/auftraege.ts', 'utf8');
    expect(auftraege).not.toContain('die Angabe zur Personenzahl');
    expect(auftraege).not.toMatch(/derzeit bearbeiten wir/u);
    expect(auftraege).not.toContain('offene_anfragen');
  });
});
