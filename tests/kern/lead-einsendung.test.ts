/**
 * Eine Einsendung, so wie ein Mensch sie liest (V-137, REQ-02 … REQ-04).
 *
 * Geprüft wird der reine Dienst hinter dem Abschnitt „Einsendung" des
 * Leadblatts: die Feldliste der VERSION ist das Wörterbuch, Auswahlwerte
 * werden zu Labels, Daten zu deutschen Daten, und nichts verschwindet.
 */
import { describe, expect, it } from 'vitest';
import type { FormularFeld } from '../../src/lib/formular/schema.js';
import { einsendungLesbar } from '../../src/server/services/lead/einsendung.js';
import { entscheideEskalation } from '../../src/server/services/lead/sla.js';
import { berlinFormat } from '../../src/server/services/lead/annahme.js';

const basis = { pflicht: false, fehlermeldung: 'x' } as const;
const FELDER: readonly FormularFeld[] = [
  { ...basis, typ: 'text', schluessel: 'firma', label: 'Firma', sortierung: 1 },
  { ...basis, typ: 'email', schluessel: 'email', label: 'E-Mail', sortierung: 3 },
  { ...basis, typ: 'telefon', schluessel: 'telefon', label: 'Telefon', sortierung: 4 },
  { ...basis, typ: 'auswahl', schluessel: 'turnus', label: 'Turnus', sortierung: 5,
    optionen: [{ wert: 'woechentlich', label: 'wöchentlich' }, { wert: 'taeglich', label: 'täglich' }] },
  { ...basis, typ: 'mehrfachauswahl', schluessel: 'flaechen', label: 'Flächen', sortierung: 6,
    optionen: [{ wert: 'buero', label: 'Büro' }, { wert: 'treppe', label: 'Treppenhaus' }] },
  { ...basis, typ: 'zahl', schluessel: 'qm', label: 'Fläche in m²', sortierung: 7 },
  { ...basis, typ: 'datum', schluessel: 'start', label: 'Start', sortierung: 8 },
  { ...basis, typ: 'datum_zeit', schluessel: 'termin', label: 'Besichtigung', sortierung: 9 },
  { ...basis, typ: 'checkbox', schluessel: 'einwilligung_werbung',
    label: 'Ich möchte Informationen erhalten.', sortierung: 10 },
  { ...basis, typ: 'textarea', schluessel: 'nachricht', label: 'Nachricht', sortierung: 11 },
  { ...basis, typ: 'datei', schluessel: 'lv', label: 'Leistungsverzeichnis', sortierung: 12,
    mime: ['application/pdf'], maxBytes: 1000 },
  { ...basis, typ: 'text', schluessel: 'name', label: 'Ihr Name', sortierung: 2 },
];

describe('§1 die Felder der Version sind das Wörterbuch', () => {
  const zeilen = einsendungLesbar(FELDER, {
    firma: 'Meyer & Sohn GmbH', name: 'Anna Meyer', email: 'anna@meyer.test',
    telefon: '+49 30 123456', turnus: 'woechentlich', flaechen: ['buero', 'treppe'],
    qm: 1250.5, start: '2026-10-01', termin: '2026-09-30T14:30',
    einwilligung_werbung: false, nachricht: 'Bitte\nzwei Zeilen', lv: 'geheim.pdf',
  });
  const als = Object.fromEntries(zeilen.map((z) => [z.schluessel, z]));

  it('in der Reihenfolge der Version, mit ihren Labels', () => {
    expect(zeilen.map((z) => z.schluessel).slice(0, 4)).toEqual(['firma', 'name', 'email', 'telefon']);
    expect(als['name']?.label).toBe('Ihr Name');
  });

  it('Auswahlwerte werden zu Labels', () => {
    expect(als['turnus']?.wert).toBe('wöchentlich');
    expect(als['flaechen']?.wert).toBe('Büro, Treppenhaus');
  });

  it('Zahlen und Daten auf Deutsch — die Wanduhr, wie eingegeben', () => {
    expect(als['qm']?.wert).toBe('1.250,5');
    expect(als['start']?.wert).toBe('01.10.2026');
    expect(als['termin']?.wert).toBe('30.09.2026, 14:30');
  });

  it('Kontaktwege sind als solche markiert, lange Texte als mehrzeilig', () => {
    expect(als['email']?.art).toBe('email');
    expect(als['telefon']?.art).toBe('telefon');
    expect(als['nachricht']?.art).toBe('mehrzeilig');
  });

  it('ein Häkchen sagt ja oder nein — auch „nein" ist eine Auskunft', () => {
    expect(als['einwilligung_werbung']?.wert).toBe('nein');
  });

  it('eine Datei steht nicht hier, sondern als Dokument mit Bezug', () => {
    expect(als['lv']).toBeUndefined();
  });
});

describe('§2 nichts verschwindet, nichts Leeres steht da', () => {
  it('ein Wert ohne Feld in der Version steht am Ende, mit seinem Schlüssel', () => {
    const zeilen = einsendungLesbar(FELDER, { firma: 'X', altes_feld: 'noch da' });
    expect(zeilen.at(-1)).toEqual({
      schluessel: 'altes_feld', label: 'altes_feld', wert: 'noch da', art: 'text' });
  });

  it('eine Option, die die Version nicht mehr kennt, bleibt als Wert lesbar', () => {
    expect(einsendungLesbar(FELDER, { turnus: 'monatlich' })[0]?.wert).toBe('monatlich');
  });

  it('leere Angaben erscheinen nicht', () => {
    expect(einsendungLesbar(FELDER, { firma: '  ', email: '' })).toEqual([]);
  });
});

describe('§3 die Eskalation spricht Berliner Zeit (V-137, Invariante 2)', () => {
  it('der Grund nennt die Frist als Wanduhr, nicht als ISO-UTC', () => {
    const frist = new Date(Date.UTC(2026, 6, 1, 8, 0, 0));  // Sommerzeit: 10:00 Berlin
    const e = entscheideEskalation({
      slaFristAm: frist, ersteReaktionAm: null, zuletztEskaliertAm: null, eskalationsstufe: 0,
    }, new Date(Date.UTC(2026, 6, 1, 12, 0, 0)));
    expect(e.eskalieren).toBe(true);
    expect(e.grund).toBe('Reaktionszeit seit 01.07.2026, 10:00 Uhr überschritten');
    expect(e.grund).not.toMatch(/T\d\d:|Z\b/u);
  });

  it('die Frist in der Meldung eines neuen Leads ebenso — im Winter mit +1', () => {
    expect(berlinFormat(new Date(Date.UTC(2026, 11, 1, 8, 0, 0)))).toBe('01.12.2026, 09:00');
  });
});
