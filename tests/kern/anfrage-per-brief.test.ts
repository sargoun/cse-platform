/**
 * Die Betroffenenanfrage per Brief, ohne E-Mail-Adresse (V-370, O-892,
 * D-844) — was ohne Datenbank entschieden wird.
 *
 * Was die Datenbank hält — E-Mail ODER Anschrift, das Formular nur mit
 * Adresse, ein Antwortweg nur, wenn er erreicht und erst mit der Entscheidung
 * —, steht in `tests/isolation/anfrage-aufnehmen.test.ts` §5. Hier:
 *
 *  1. Erreichbar ist, was erfasst ist: E-Mail, Brief oder beides.
 *  2. Die Vorgabe des Antwortwegs folgt dem Weg der Anfrage (O-892).
 *  3. Formular, Aufnahmeroute und Entscheidungsroute tragen die neuen Felder;
 *     die E-Mail ist im Aufnahmeformular kein Pflichtfeld mehr.
 *  4. Die Wörter stehen in beiden Sprachen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANSCHRIFT_HOECHSTENS, antwortwegeFuer, antwortwegVorgabe,
} from '../../src/server/services/datenschutz/anfrage.js';
import { AUFNAHME_TEXTE } from '../../src/lib/i18n/verwaltung/datenschutz.js';

describe('erreichbar ist, was erfasst ist', () => {
  it('E-Mail, Brief, beides — und ohne beides nichts', () => {
    expect(antwortwegeFuer({ email: 'a@b.de', anschrift: null })).toEqual(['email']);
    expect(antwortwegeFuer({ email: null, anschrift: 'Lindenstraße 12' })).toEqual(['brief']);
    expect(antwortwegeFuer({ email: 'a@b.de', anschrift: 'Lindenstraße 12' }))
      .toEqual(['email', 'brief']);
    expect(antwortwegeFuer({ email: null, anschrift: null })).toEqual([]);
  });
});

describe('die Vorgabe: auf dem Weg, auf dem die Anfrage kam (O-892)', () => {
  it('ein Brief mit Anschrift wird per Brief beantwortet, auch wenn eine Adresse da ist', () => {
    expect(antwortwegVorgabe({ email: 'a@b.de', anschrift: 'X', eingangsweg: 'brief' }))
      .toBe('brief');
  });

  it('sonst per E-Mail, wo eine Adresse da ist — ohne sie per Brief', () => {
    expect(antwortwegVorgabe({ email: 'a@b.de', anschrift: 'X', eingangsweg: 'telefon' }))
      .toBe('email');
    expect(antwortwegVorgabe({ email: 'a@b.de', anschrift: null, eingangsweg: 'brief' }))
      .toBe('email');
    expect(antwortwegVorgabe({ email: null, anschrift: 'X', eingangsweg: 'persoenlich' }))
      .toBe('brief');
  });

  it('die Vorgabe ist immer ein erreichbarer Weg', () => {
    for (const email of ['a@b.de', null]) {
      for (const anschrift of ['X', null]) {
        if (email === null && anschrift === null) continue;
        for (const eingangsweg of ['brief', 'telefon', 'email', 'persoenlich', 'formular'] as const) {
          const a = { email, anschrift, eingangsweg };
          expect(antwortwegeFuer(a), JSON.stringify(a)).toContain(antwortwegVorgabe(a));
        }
      }
    }
  });
});

describe('Formular und Routen', () => {
  const FORMULAR = readFileSync(
    'src/app/portal/[mandant]/datenschutz/AufnahmeFormular.tsx', 'utf8');
  const AUFNEHMEN = readFileSync('src/app/api/datenschutz/aufnehmen/route.ts', 'utf8');
  const BEARBEITEN = readFileSync('src/app/api/datenschutz/bearbeiten/route.ts', 'utf8');
  const VORGANG = readFileSync('src/app/portal/[mandant]/datenschutz/[id]/page.tsx', 'utf8');
  const MIGRATION = readFileSync('drizzle/0529_betroffenenanfrage_per_brief.sql', 'utf8');

  it('das Aufnahmeformular verlangt die E-Mail nicht mehr und trägt die Anschrift', () => {
    const email = /<input type="email" name="email"[^>]*>/u.exec(FORMULAR)?.[0] ?? '';
    expect(email).not.toBe('');
    expect(email).not.toContain('required');
    expect(FORMULAR).toContain('name="anschrift"');
    expect(FORMULAR).toContain('maxLength={ANSCHRIFT_HOECHSTENS}');
    expect(AUFNEHMEN).toContain("anschrift: feld('anschrift')");
  });

  it('die Entscheidung trägt den Antwortweg, und die Seite bietet nur Erreichbares an', () => {
    expect(BEARBEITEN).toContain("String(daten.get('antwortweg') ?? '')");
    expect(VORGANG).toContain('antwortwegeFuer(z).map(');
    expect(VORGANG).toContain('defaultChecked={w === antwortwegVorgabe(z)}');
  });

  it('die Grenze der Anschrift ist die der Spalte', () => {
    expect(ANSCHRIFT_HOECHSTENS).toBe(500);
    expect(MIGRATION).toContain(`length(anschrift) <= ${String(ANSCHRIFT_HOECHSTENS)}`);
  });
});

describe('die Wörter', () => {
  it('Anschrift und Erreichbarkeit in beiden Sprachen; die E-Mail verlangt keinen Vermerk mehr', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = AUFNAHME_TEXTE[sprache];
      expect(t.anschrift, sprache).toBeTruthy();
      expect(t.anschriftErklaerung, sprache).toContain('O-892');
      expect(t.erreichbarErklaerung, sprache).toBeTruthy();
    }
    expect(AUFNAHME_TEXTE.de.emailErklaerung).not.toContain('in der Nachricht');
    expect(AUFNAHME_TEXTE.en.emailErklaerung).not.toContain('message below');
  });
});
