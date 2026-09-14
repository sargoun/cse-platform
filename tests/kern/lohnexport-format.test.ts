/**
 * PR 67 — das Format des Lohnexports, ohne Datenbank (ACC-12, D-06, D-486).
 *
 *  1. Dezimalstunden: ganzzahlig gerechnet, kaufmaennisch gerundet, mit
 *     Vorzeichen — nie ueber eine Gleitkommazahl.
 *  2. Das generische CSV traegt die drei Tabellen mit festen Spalten, sagt
 *     „unklar" statt „nein", laesst eine fehlende Lohnart leer — und ist
 *     ohne Uhr: zweimal dieselben Bytes.
 *  3. Das Format ist ein Platzhalter und sagt es (O-27); kein Stundensatz,
 *     kein Geburtsdatum, keine Anschrift in irgendeiner Spalte.
 */
import { describe, expect, it } from 'vitest';
import {
  BEWEGUNG_ARTEN, GENERISCH_CSV, LohnexportFehler, dezimalstunden, type LohnexportDaten,
} from '../../src/server/services/zeit/lohnexport.js';

const utf8 = new TextDecoder('utf-8');

const DATEN: LohnexportDaten = {
  mandantId: '00000000-0000-0000-0000-000000000001', firma: 'CSE Dienstleistungen GmbH',
  monat: '2026-08', von: '2026-08-01', bis: '2026-08-31',
  zeilen: [{
    anstellungId: 'a1', personalnummer: 'P-0007', person: 'Fatima Yildiz', eintritt: '2024-03-01', austritt: null,
    arbeitszeitmodell: 'vollzeit', wochenstunden: '39,00', konto: 'gesperrt',
    sollMinuten: 9360, istMinuten: 9420, korrekturMinuten: 0, saldoVortragMinuten: -30, saldoMinuten: 30,
    urlaubTage: '2,000', krankTage: '0', bewegungen: { arbeitszeit: 9420, abwesenheit: 0, feiertag: 0, korrektur: 0,
      uebertrag: 0, auszahlung: 0, freizeitausgleich: 0 },
    zeiteintraege: 21, unfreigegeben: 0, nachweisQuelle: 'artefakt', nachweisHash: 'ab'.repeat(32),
  }],
  abwesenheiten: [{
    id: 'w1', anstellungId: 'a1', personalnummer: 'P-0007', person: 'Fatima Yildiz', art: 'urlaub',
    bezeichnung: 'Urlaub', bezahlt: null, lohnart: null, gesundheitsbezogen: false,
    von: '2026-08-10', bis: '2026-08-11', vonHalbtags: false, bisHalbtags: true, tageAngerechnet: '1,500', status: 'genehmigt',
  }],
  zeiten: [{
    anstellungId: 'a1', personalnummer: 'P-0007', zeiteintragId: 'z1', kalendertag: '2026-08-03',
    beginn: '2026-08-03 06:00', ende: '2026-08-03 14:30', pauseMinuten: 30, bruttoMinuten: 510, nettoMinuten: 480,
    anteilBruttoMinuten: 510, anteilNettoMinuten: 480, nacherfasst: false,
  }],
};

describe('(1) dezimalstunden', () => {
  it('rundet kaufmaennisch auf zwei Stellen, ganzzahlig, mit Vorzeichen', () => {
    expect(dezimalstunden(0)).toBe('0,00');
    expect(dezimalstunden(90)).toBe('1,50');
    expect(dezimalstunden(-45)).toBe('-0,75');
    expect(dezimalstunden(7)).toBe('0,12');
    expect(dezimalstunden(1)).toBe('0,02');
    expect(dezimalstunden(9420)).toBe('157,00');
    expect(dezimalstunden(59)).toBe('0,98');
    expect(() => dezimalstunden(1.5)).toThrow(LohnexportFehler);
  });
});

describe('(2) das generische CSV', () => {
  it('schreibt drei Tabellen mit Kopfzeile, „unklar" und leerer Lohnart — reproduzierbar', () => {
    const a = GENERISCH_CSV.schreibe(DATEN);
    const b = GENERISCH_CSV.schreibe(DATEN);
    expect(a.map((d) => d.pfad)).toEqual(['monate.csv', 'abwesenheiten.csv', 'zeiten.csv']);
    a.forEach((d, i) => expect(Buffer.from(d.bytes).equals(Buffer.from(b[i]!.bytes))).toBe(true));

    const monate = utf8.decode(a[0]!.bytes).split('\r\n');
    expect(monate[0]).toContain('personalnummer;name;eintritt;austritt;arbeitszeitmodell;wochenstunden;konto_status;soll_minuten;soll_stunden;ist_minuten;ist_stunden');
    for (const art of BEWEGUNG_ARTEN) expect(monate[0]).toContain(`${art}_minuten`);
    expect(monate[1]).toContain('"P-0007";"Fatima Yildiz";2024-03-01;;"vollzeit";"39,00";"gesperrt";9360;"156,00";9420;"157,00"');
    expect(monate[1]).toContain(`"artefakt";"${'ab'.repeat(32)}"`);

    const abwesenheiten = utf8.decode(a[1]!.bytes).split('\r\n');
    expect(abwesenheiten[1]).toContain('"urlaub";"Urlaub";2026-08-10;2026-08-11;"nein";"ja";"1,500";"unklar";;"genehmigt";"nein"');

    const zeiten = utf8.decode(a[2]!.bytes).split('\r\n');
    expect(zeiten[0]).toBe('zeiteintrag_id;personalnummer;kalendertag;beginn;ende;pause_minuten;brutto_minuten;netto_minuten;anteil_brutto_minuten;anteil_netto_minuten;nacherfasst');
    expect(zeiten[1]).toBe('"z1";"P-0007";2026-08-03;"2026-08-03 06:00";"2026-08-03 14:30";30;510;480;510;480;"nein"');
  });
});

describe('(3) der Platzhalter und seine Grenzen', () => {
  it('nennt sich Platzhalter ohne Zielsystem (O-27)', () => {
    expect(GENERISCH_CSV.istPlatzhalter).toBe(true);
    expect(GENERISCH_CSV.zielsystem).toBeNull();
    expect(GENERISCH_CSV.schluessel).toBe('generisch_csv');
  });

  it('traegt keine Spalte fuer Stundensatz, Geburtsdatum oder Anschrift (K-05)', () => {
    const koepfe = GENERISCH_CSV.schreibe(DATEN).map((d) => utf8.decode(d.bytes).split('\r\n')[0] ?? '').join(';');
    for (const verboten of ['stundensatz', 'geburtsdatum', 'strasse', 'plz', 'iban', 'lohn_cent', 'gehalt']) {
      expect(koepfe).not.toContain(verboten);
    }
  });
});
