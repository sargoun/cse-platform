/**
 * Die Erinnerung an eine Wiedervorlage — was sich ohne Datenbank beweisen
 * lässt (V-146, CRM-04, NOT-01, NOT-03, D-640).
 *
 * Die Zustellung selbst, die Rolle `cse_job` und das Zurücksetzen beim
 * Verschieben prüft `tests/isolation/wiedervorlage-erinnerung.test.ts` an
 * echten Zeilen. Hier steht, dass es die Art und den Lauf ÜBERHAUPT gibt und
 * dass beide verdrahtet sind — die Lücke war genau das: ein Feld, dessen Wert
 * niemand las.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { erzeuge, findeArt, leereArten } from '../../src/server/benachrichtigung/registry.js';
import { alleArten } from '../../src/server/benachrichtigung/bootstrap.js';
import {
  ART_WIEDERVORLAGE_ERINNERUNG, registriereWiedervorlageArten,
} from '../../src/server/services/crm/benachrichtigung.js';
import { alleJobs, vergissRegistrierung } from '../../src/server/jobs/bootstrap.js';
import { leereRegister } from '../../src/server/jobs/registry.js';

const db = {
  unsafe: (): Promise<readonly unknown[]> => Promise.resolve([]),
  begin: <T,>(): Promise<T> => {
    throw new Error('Registrieren oeffnet keine Transaktion.');
  },
};

const kontext = {
  mandantId: '00000000-0000-0000-0000-000000000001',
  mandantSlug: 'reinigung',
  objektTyp: 'lead_aktivitaet',
  objektId: '00000000-0000-0000-0000-000000000002',
  daten: { betreff: 'Rückruf Objektleitung Mitte', faellig: '05.10.2026 09:00' },
};

beforeEach(() => { leereArten(); leereRegister(); vergissRegistrierung(); });
afterEach(() => { leereArten(); leereRegister(); vergissRegistrierung(); });

describe('die Art crm.wiedervorlage_erinnerung', () => {
  it('ist über den Bootstrap angemeldet — auch für die Einstellungsseite (NOT-02)', () => {
    expect(alleArten().map((a) => a.schluessel)).toContain(ART_WIEDERVORLAGE_ERINNERUNG);
    expect(ART_WIEDERVORLAGE_ERINNERUNG).toBe(['crm', 'wiedervorlage_erinnerung'].join('.'));
  });

  it('führt auf die Wiedervorlagenliste des Bereichs (NOT-03)', () => {
    registriereWiedervorlageArten();
    const b = erzeuge(ART_WIEDERVORLAGE_ERINNERUNG, kontext);
    expect(b.ziel).toBe('/portal/reinigung/crm/wiedervorlagen');
    expect(b.titel).toBe('Wiedervorlage: Rückruf Objektleitung Mitte');
    expect(b.text).toContain('05.10.2026 09:00');
  });

  it('V-153: der Text sagt, warum die Meldung an DIESEN Menschen geht', () => {
    registriereWiedervorlageArten();
    const zustaendig = erzeuge(ART_WIEDERVORLAGE_ERINNERUNG,
      { ...kontext, daten: { ...kontext.daten, rolle: 'zustaendig' } });
    expect(zustaendig.text)
      .toBe('Fällig am 05.10.2026 09:00. Sie sind für diese Wiedervorlage als zuständig eingetragen.');
    expect(zustaendig.ziel).toBe('/portal/reinigung/crm/wiedervorlagen');
    // Hier stand für jeden „Sie haben … um eine Erinnerung gebeten" — auch für
    // den Zuständigen, der um nichts gebeten hatte.
    expect(zustaendig.text).not.toContain('gebeten');

    const ohne = erzeuge(ART_WIEDERVORLAGE_ERINNERUNG,
      { ...kontext, daten: { ...kontext.daten, rolle: 'angelegt', ohneZustaendigen: true } });
    expect(ohne.text).toContain('Sie haben diese Wiedervorlage angelegt; zuständig ist niemand.');
    // „nur meine" zeigte sie dem Anlegenden nicht — das Ziel zeigt alle.
    expect(ohne.ziel).toBe('/portal/reinigung/crm/wiedervorlagen?wer=alle');

    const ohneZugang = erzeuge(ART_WIEDERVORLAGE_ERINNERUNG,
      { ...kontext, daten: { ...kontext.daten, rolle: 'angelegt', ohneZustaendigen: false } });
    expect(ohneZugang.text).toContain('keinen Zugang zum CRM');
  });

  it('ohne Slug entsteht keine Meldung — kein Ziel ist ehrlicher als ein totes', () => {
    registriereWiedervorlageArten();
    expect(() => erzeuge(ART_WIEDERVORLAGE_ERINNERUNG, { ...kontext, mandantSlug: null }))
      .toThrow(/kein aufloesbares Ziel/u);
  });

  it('ist nie sammelbar — eine Erinnerung am nächsten Morgen kommt nach dem Termin', () => {
    registriereWiedervorlageArten();
    expect(findeArt(ART_WIEDERVORLAGE_ERINNERUNG)?.sammelbar).toBe(false);
  });

  it('lässt sich mehrfach anmelden, ohne zu werfen (D-493)', () => {
    registriereWiedervorlageArten();
    expect(() => registriereWiedervorlageArten()).not.toThrow();
  });
});

describe('der Lauf wiedervorlage_erinnerung', () => {
  it('ist im Bootstrap verdrahtet, je Mandant, alle fünfzehn Minuten', () => {
    const job = alleJobs(db).find((j) => j.schluessel === 'wiedervorlage_erinnerung');
    expect(job, 'der Lauf fehlt im Bootstrap — die Erinnerung käme nie an').toBeDefined();
    expect(job?.bereich).toBe('je_mandant');
    expect(job?.zeitplan).toBe('*/15 * * * *');
  });

  it('ohne Mandant wirft er, statt still über alle Gesellschaften zu laufen', async () => {
    const job = alleJobs(db).find((j) => j.schluessel === 'wiedervorlage_erinnerung');
    await expect(job!.ausfuehren({ mandantId: null, laufId: 'x', versuch: 1 }))
      .rejects.toThrow(/je_mandant/u);
  });
});
