import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUSSCHREIBUNG_STATUS_TEXT, MAPPE_STATUS_TEXT, RADAR_LAUF_STATUS_TEXT, RADAR_QUELLE_TEXT,
} from '../../src/lib/i18n/beschriftung/radar.js';
import { VEROEFFENTLICHUNG_ERGEBNIS_TEXT } from '../../src/lib/i18n/beschriftung/recruiting.js';
import { EINWAND_STATUS_TEXT } from '../../src/lib/i18n/beschriftung/zeit.js';
import { ZUORDNUNG_STATUS_TEXT } from '../../src/lib/i18n/beschriftung/dienstplan.js';
import { BELEGE_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/belege.js';
import { VERLAUF_TEXTE } from '../../src/lib/i18n/verwaltung/crm-verlauf.js';
import { enumWerte, pruefeKarte } from './hilfen/beschriftung.js';

/**
 * Die Verwaltung zeigt Wörter statt Enum-Schlüssel (Audit Befund 68, V-232,
 * D-726): „Stand: in_arbeit", „oeffentlichevergabe — uebersprungen",
 * „Letzter Versuch: nicht_verbunden", „(Stand: in_pruefung)",
 * „nicht_erschienen" und „ausgangsrechnung" standen im sichtbaren Text,
 * obwohl die Anwendung daneben Karten dafür hatte.
 */

describe('jede Karte gegen ihre Migration', () => {
  it('Vergabevorgang, Vergabemappe, Radarlauf und Radarquelle', () => {
    pruefeKarte(AUSSCHREIBUNG_STATUS_TEXT, enumWerte('ausschreibung_status'),
      'AUSSCHREIBUNG_STATUS_TEXT');
    pruefeKarte(MAPPE_STATUS_TEXT, enumWerte('vergabemappe_status'), 'MAPPE_STATUS_TEXT');
    pruefeKarte(RADAR_LAUF_STATUS_TEXT, enumWerte('radar_lauf_status'), 'RADAR_LAUF_STATUS_TEXT');
    expect(Object.keys(RADAR_QUELLE_TEXT.de).sort())
      .toEqual([...enumWerte('ausschreibung_quelle')].sort());
  });

  it('Veröffentlichung, Einwand, Einteilung', () => {
    pruefeKarte(VEROEFFENTLICHUNG_ERGEBNIS_TEXT, enumWerte('veroeffentlichung_ergebnis'),
      'VEROEFFENTLICHUNG_ERGEBNIS_TEXT');
    pruefeKarte(EINWAND_STATUS_TEXT, enumWerte('einwand_status'), 'EINWAND_STATUS_TEXT');
    pruefeKarte(ZUORDNUNG_STATUS_TEXT, enumWerte('zuordnung_status'), 'ZUORDNUNG_STATUS_TEXT');
  });

  it('die Belegarten und die Kanäle, die DATEV- und Kontaktblatt jetzt mitbenutzen', () => {
    for (const s of ['de', 'en'] as const) {
      expect(Object.keys(BELEGE_TEXTE[s].typNamen).sort())
        .toEqual([...enumWerte('beleg_typ')].sort());
      for (const k of ['email', 'telefon', 'sms', 'post', 'whatsapp']) {
        expect(VERLAUF_TEXTE[s].kanaele[k], `${s}/${k}`).toBeTruthy();
      }
    }
  });
});

describe('die Seiten aus dem Befund zeigen das Wort', () => {
  const lies = (p: string): string => readFileSync(p, 'utf8');

  it('Vorgangsblatt, Radarliste, Gruppenradar und Mappe', () => {
    expect(lies('src/app/portal/[mandant]/radar/[id]/page.tsx'))
      .not.toContain('<strong>{daten.mappe.status}</strong>');
    const liste = lies('src/app/portal/[mandant]/radar/page.tsx');
    expect(liste).not.toContain('{daten.kennzahlen.letzterLauf.quelle} —');
    expect(liste).not.toMatch(/const VORGANG: Readonly/u);
    expect(lies('src/app/portal/gruppe/radar/page.tsx')).not.toMatch(/const VORGANG: Readonly/u);
    expect(lies('src/app/portal/[mandant]/radar/[id]/mappe/page.tsx'))
      .not.toMatch(/const MAPPE_TEXT/u);
  });

  it('Veröffentlichung, Korrektur, Veranstaltung, DATEV und Kontakt', () => {
    expect(lies('src/app/portal/[mandant]/recruiting/stellen/[id]/veroeffentlichung/page.tsx'))
      .not.toContain('Letzter Versuch: {vermerk.ergebnis}');
    expect(lies('src/app/portal/[mandant]/zeiten/[id]/korrektur/page.tsx'))
      .not.toContain('(Stand: {einwand.status})');
    expect(lies('src/app/portal/[mandant]/security/veranstaltungen/[id]/page.tsx'))
      .not.toMatch(/\n\s*\{b\.status\}\n/u);
    expect(lies('src/app/portal/[mandant]/buchhaltung/datev/[id]/page.tsx'))
      .not.toContain("zelle: (z) => z.typ }");
    const kontakt = lies('src/app/portal/[mandant]/crm/kontakte/[id]/page.tsx');
    expect(kontakt).not.toMatch(/const KANAL_TEXT/u);
    expect(kontakt).not.toContain('lead_aktivitaet_hat_bezug</code>');
  });
});
