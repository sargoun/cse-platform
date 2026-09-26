import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beschriftung, lesbar } from '../../src/lib/i18n/beschriftung/basis.js';
import { enumWerte, pruefeKarte } from './hilfen/beschriftung.js';
import {
  LAUF_STOERUNG_TEXT, NEBENWIRKUNG_TEXT, UNTERGRENZE_TEXT, VERSAND_AKTION_TEXT, VORGANG_TEXT,
  WERKZEUG_TEXT,
} from '../../src/lib/i18n/beschriftung/agent.js';
import { AUFGABE_PILLE } from '../../src/app/portal/[mandant]/agenten/darstellung.js';
import { AKTIONEN } from '../../src/server/agent/policy.js';
import { VORGANG_LABEL } from '../../src/app/portal/[mandant]/freigaben/darstellung.js';
import { AKTION_TEXT } from '../../src/server/services/agent/richtlinie.js';

/**
 * Die Beschriftungskarten (V-228, V-231, D-722, D-725): jeder Wert, den die
 * Datenbank kennt, hat ein Wort — in beiden Sprachen, ohne Unterstrich —, und
 * die Seiten zeigen das Wort statt des Schlüssels.
 *
 * Geprüft wird gegen die MIGRATIONEN, nicht gegen eine Liste in dieser Datei:
 * ein neuer Enum-Wert (wie `bewerbung_antwort_entwurf` aus 0173, den die alte
 * Karte nicht kannte) fällt damit beim ersten Lauf auf.
 */

describe('beschriftung — ein Wort, nie ein Schlüssel', () => {
  it('ein bekannter Wert wird sein Wort, in der Sprache der Seite', () => {
    expect(beschriftung(VORGANG_TEXT, 'interner_hinweis')).toBe('Interner Hinweis');
    expect(beschriftung(VORGANG_TEXT, 'interner_hinweis', 'en')).toBe('Internal note');
  });

  it('ein unbekannter Wert wird lesbar statt roh — und ein geerbter Name ist keiner', () => {
    expect(beschriftung(VORGANG_TEXT, 'ganz_neuer_wert')).toBe('ganz neuer wert');
    expect(beschriftung(VORGANG_TEXT, 'toString')).toBe('toString');
    expect(beschriftung(VORGANG_TEXT, '__proto__')).toBe('proto');
    expect(beschriftung(VORGANG_TEXT, null)).toBe('—');
    expect(lesbar('nicht_erschienen')).toBe('nicht erschienen');
  });
});

describe('die Karten des Agentenzentrums gegen die Migrationen', () => {
  it('Werkzeuge: agent_werkzeug_name', () => {
    pruefeKarte(WERKZEUG_TEXT, enumWerte('agent_werkzeug_name'), 'WERKZEUG_TEXT');
  });

  it('Vorgangsarten: agent_vorgang_typ — alle, auch die aus 0173', () => {
    const werte = enumWerte('agent_vorgang_typ');
    expect(werte).toContain('bewerbung_antwort_entwurf');
    pruefeKarte(VORGANG_TEXT, werte, 'VORGANG_TEXT');
  });

  it('Aktionen der Versandrichtlinie: dieselben acht wie das Gate', () => {
    pruefeKarte(VERSAND_AKTION_TEXT, AKTIONEN, 'VERSAND_AKTION_TEXT');
  });

  it('Nebenwirkung und Untergrenze: jede hat ein Wort', () => {
    pruefeKarte(NEBENWIRKUNG_TEXT, ['lesen', 'entwurf', 'schreiben_mit_tor', 'versand'],
      'NEBENWIRKUNG_TEXT');
    pruefeKarte(UNTERGRENZE_TEXT, ['erlaubt', 'je_art', 'freigabe_erforderlich'],
      'UNTERGRENZE_TEXT');
  });

  it('Störungen eines Laufs: jeder Code des Modellports und des Orchestrators', () => {
    const port = readFileSync('src/server/agent/modell/port.ts', 'utf8');
    const typ = /export type ModellFehlerCode =([^;]*);/u.exec(port)?.[1] ?? '';
    const codes = [...typ.matchAll(/'([A-Z_]+)'/gu)].map((m) => m[1] ?? '');
    const orchestrator = readFileSync('src/server/agent/orchestrator.ts', 'utf8');
    for (const m of orchestrator.matchAll(/scheitern\(kontext, aufgabe\.id, '([A-Z_]+)'/gu)) {
      codes.push(m[1] ?? '');
    }
    codes.push('KEINE_ANFRAGE');
    for (const c of codes) {
      expect(LAUF_STOERUNG_TEXT.de[c as keyof typeof LAUF_STOERUNG_TEXT.de], c).toBeTruthy();
      expect(LAUF_STOERUNG_TEXT.en[c as keyof typeof LAUF_STOERUNG_TEXT.en], c).toBeTruthy();
    }
  });

  it('die Pille kennt genau die sieben Zustände einer Aufgabe', () => {
    expect(Object.keys(AUFGABE_PILLE).sort())
      .toEqual([...enumWerte('agent_aufgabe_status')].sort());
  });

  it('die alten Namen sind die deutsche Sicht auf dieselben Karten', () => {
    expect(VORGANG_LABEL).toBe(VORGANG_TEXT.de);
    expect(AKTION_TEXT).toBe(VERSAND_AKTION_TEXT.de);
  });
});

describe('die Agentenblätter zeigen das Wort', () => {
  const blatt = readFileSync('src/app/portal/[mandant]/agenten/[agent]/page.tsx', 'utf8');
  const aufgabe = readFileSync(
    'src/app/portal/[mandant]/agenten/[agent]/aufgaben/[id]/page.tsx', 'utf8');
  const start = readFileSync('src/app/portal/[mandant]/agenten/[agent]/start/page.tsx', 'utf8');
  const kette = readFileSync('src/app/portal/[mandant]/agenten/Schrittkette.tsx', 'utf8');

  it('keine rohe Aktion, keine rohe Vorgangsart, kein roher Störungscode', () => {
    // Als Text zwischen zwei Tags, nicht als Attribut (`data-aktion` bleibt für die Prüfung).
    expect(blatt).not.toMatch(/>\s*\{r\.aktion\}\s*</u);
    expect(blatt).not.toContain('zelle: (a) => a.vorgang');
    expect(blatt).not.toMatch(/endete mit „\$\{laufCode/u);
    expect(aufgabe).not.toMatch(/>\s*\{kopf\.vorgang\}\s*</u);
    expect(start).not.toContain('<code className="text-xs">{auftrag.aktion}</code>');
    expect(kette).not.toContain('s.werkzeug ?? <span');
  });

  it('kein Rechteschlüssel und kein Quelltext im sichtbaren Text des Vorschaltblatts', () => {
    expect(blatt).not.toContain('(„agent.aufgabe_starten")');
    expect(start).not.toMatch(/<code[^>]*>(server\/agent|pruefeZahlenherkunft|app\.berlin_heute|fuelleTatsachen)/u);
  });
});
