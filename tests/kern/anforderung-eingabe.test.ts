/**
 * Verlangte Nachweise — die Pruefung der Eingabe ohne Datenbank (V-179,
 * D-673, SEC-01, SEC-04).
 *
 * Der Weg durch die echte Datenbank (Dienst, Tor, Nachzug der Schichten)
 * steht in `tests/isolation/anforderung-pflege.test.ts`. Hier steht, was
 * vorher abgewiesen wird — mit einem Satz statt einer Bedingungsverletzung —
 * und dass jede Abweisung auf der Seite in beiden Sprachen einen Satz hat.
 *
 * Dazu (3): die Bausteine, die die Gruppe „einsatz" neu gebaut hat, tragen
 * keinen frei gewählten Wert. Im Anforderungsblock stand `max-w-[12rem]` —
 * eine Breite, die DESIGN.md nicht kennt (§3: „Set as a theme token, never as
 * a one-off"). Erlaubt ist nur, was DESIGN.md selbst nennt: die Laufweite
 * `tracking-[0.08em]` der Mikroschrift (§2).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AnforderungFehler, pruefeAnforderungEingabe, type AnforderungEingabe,
  type AnforderungGrund,
} from '../../src/server/services/security/anforderung.js';
import { ANFORDERUNG_TEXTE } from '../../src/lib/i18n/verwaltung/anforderung.js';

const POSTEN = '00000000-0000-4000-8000-000000000001';
const QUALI = '00000000-0000-4000-8000-000000000002';

function eingabe(mehr: Partial<AnforderungEingabe> = {}): AnforderungEingabe {
  return {
    herkunft: { art: 'posten', id: POSTEN },
    bereich: 'posten',
    qualifikationId: QUALI,
    zwingend: true,
    geltung: 'jeder',
    mindestanzahl: 1,
    bewacherregisterPflicht: false,
    gueltigAb: null,
    rechtsgrundlage: null,
    bestaetigt: false,
    ...mehr,
  };
}

function grund(fn: () => unknown): AnforderungGrund | null {
  try {
    fn();
    return null;
  } catch (fehler) {
    return fehler instanceof AnforderungFehler ? fehler.grund : null;
  }
}

describe('(1) was vor der Datenbank abgewiesen wird', () => {
  it('eine Sperre mit „mindestens eine Person" — die prueft heute niemand (0031)', () => {
    expect(grund(() => pruefeAnforderungEingabe(eingabe({
      geltung: 'mindestens_einer', mindestanzahl: 2,
    })))).toBe('sperre_nur_jeder');
  });

  it('als Warnung ist „mindestens zwei Personen" erlaubt, und die Zahl bleibt', () => {
    const e = pruefeAnforderungEingabe(eingabe({
      zwingend: false, geltung: 'mindestens_einer', mindestanzahl: 2,
    }));
    expect(e.mindestanzahl).toBe(2);
  });

  it('bei „jede Person" ist die Anzahl 1 — was das Formular sonst schickt, zählt nicht', () => {
    expect(pruefeAnforderungEingabe(eingabe({ mindestanzahl: 7 })).mindestanzahl).toBe(1);
  });

  it('der Bereich muss zur Seite passen', () => {
    expect(grund(() => pruefeAnforderungEingabe(eingabe({ bereich: 'veranstaltung' }))))
      .toBe('bereich_passt_nicht');
    expect(grund(() => pruefeAnforderungEingabe(eingabe({
      herkunft: { art: 'veranstaltung', id: POSTEN }, bereich: 'posten',
    })))).toBe('bereich_passt_nicht');
  });

  it('keine Zahl, kein Datum, keine Qualifikation', () => {
    expect(grund(() => pruefeAnforderungEingabe(eingabe({
      zwingend: false, geltung: 'mindestens_einer', mindestanzahl: Number.NaN,
    })))).toBe('unvollstaendig');
    expect(grund(() => pruefeAnforderungEingabe(eingabe({ gueltigAb: '1.1.2030' }))))
      .toBe('unvollstaendig');
    expect(grund(() => pruefeAnforderungEingabe(eingabe({ qualifikationId: ' ' }))))
      .toBe('unvollstaendig');
  });

  it('eine leere Rechtsgrundlage ist keine', () => {
    expect(pruefeAnforderungEingabe(eingabe({ rechtsgrundlage: '  ' })).rechtsgrundlage)
      .toBeNull();
  });
});

describe('(2) jede Abweisung hat einen Satz — in beiden Sprachen', () => {
  const gruende: readonly AnforderungGrund[] = [
    'unvollstaendig', 'nicht_gefunden', 'qualifikation_unbekannt', 'kein_objekt',
    'bereich_passt_nicht', 'sperre_nur_jeder', 'doppelt', 'schon_archiviert',
  ];
  for (const sprache of ['de', 'en'] as const) {
    it(`${sprache}: kein Grund ohne Satz, kein roher Schluessel`, () => {
      const t = ANFORDERUNG_TEXTE[sprache];
      for (const g of gruende) {
        expect(t.fehler[g], g).toMatch(/\S/u);
        expect(t.fehler[g]).not.toContain(g);
      }
    });
  }
});

describe('(3) die neuen Bausteine tragen keinen frei gewählten Wert (DESIGN §2, §3)', () => {
  const DATEIEN = [
    'src/app/portal/[mandant]/security/Anforderungsblock.tsx',
    'src/app/portal/[mandant]/bau/GewerkFormular.tsx',
    'src/app/portal/[mandant]/bau/gewerke/page.tsx',
    'src/components/portal/Aufnahmeliste.tsx',
  ];
  /** Die EINE Ausnahme, die DESIGN.md §2 selbst nennt: die Mikroschrift. */
  const ERLAUBT = new Set(['tracking-[0.08em]']);

  for (const datei of DATEIEN) {
    it(datei, () => {
      const frei = [...readFileSync(datei, 'utf8').matchAll(/[a-z][a-z0-9:-]*-\[[^\]\s]+\]/gu)]
        .map((m) => m[0].replace(/^(?:[a-z0-9]+:)+/u, ''))
        .filter((w) => !ERLAUBT.has(w));
      expect(frei).toEqual([]);
    });
  }
});
