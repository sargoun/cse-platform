/**
 * Die reinen Teile der Nummernkreis-Übersicht und der ZUGFeRD-Summenprobe
 * (FIN-03, FIN-12, PR 54.x).
 *
 * **Was hier bewiesen wird.** Dass die Maskenvorschau dieselbe Nummer zeigt,
 * die die Vergabe später zieht — und dass sie bei einem fortlaufenden Kreis
 * (`jahr = 0`) NICHT still eine `0` einsetzt. Ein Kreis mit
 * `zuruecksetzung = 'nie'` trägt `jahr = 0`; eine Vorschau, die daraus
 * `RE-0-00042` macht, behauptet eine Maske, die niemand vereinbart hat, und
 * genau das ist der Fehler, den man erst auf der ersten echten Rechnung
 * bemerkt.
 *
 * **Und dass die Summenprobe vier Dinge einzeln vergleicht.** Eine Abweichung
 * im Netto hat eine andere Ursache als eine im Zahlbetrag — dort steckt der
 * Abschlagsabzug. „Die Summen weichen ab" wäre die Auskunft, mit der niemand
 * sucht.
 */
import { describe, expect, it } from 'vitest';
import { vorschau } from '../../src/server/services/finanz/kreisuebersicht.js';
import { summenprobe, type ZugferdVorschau }
  from '../../src/server/services/finanz/zugferd/vorschau.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { formatiereNummer } from '../../src/server/services/finanz/nummernkreis.js';

describe('Maskenvorschau', () => {
  it('füllt die laufende Nummer auf die Stellenzahl der Maske', () => {
    expect(vorschau('RE-{jahr}-{nr:5}', 42, 2026)).toBe('RE-2026-00042');
  });

  it('kommt ohne Stellenangabe aus', () => {
    expect(vorschau('AN-{nr}', 7, 2026)).toBe('AN-7');
  });

  it('kürzt eine Nummer NICHT, die länger ist als die Maske', () => {
    /*
     * `padStart` verkürzt nicht — und das ist die richtige Richtung: eine
     * gekürzte Nummer wäre eine ANDERE Nummer, und der lückenlose Kreis
     * hätte zwei Belege mit derselben.
     */
    expect(vorschau('RE-{nr:3}', 12345, 2026)).toBe('RE-12345');
  });

  it('setzt bei einem fortlaufenden Kreis keine 0 als Jahr ein', () => {
    /*
     * `jahr = 0` heisst „fortlaufend über Jahre hinweg" und nicht „Jahr
     * unbekannt". Die Vorschau sagt das im Klartext, statt eine Maske zu
     * zeigen, die so nie gedruckt wird. `formatiereNummer` WIRFT in diesem
     * Fall — richtig für die Vergabe, falsch für eine Übersicht, die genau
     * diesen Kreis anzeigen soll.
     */
    const gezeigt = vorschau('RE-{jahr}-{nr:4}', 1, 0);
    expect(gezeigt).toContain('{jahr');
    expect(gezeigt).not.toContain('RE-0-');
    expect(() => formatiereNummer('RE-{jahr}-{nr:4}', 1, 0)).toThrow();
  });

  it('zeigt für einen bestätigten Kreis dasselbe wie die Vergabe', () => {
    /*
     * Die eine Aussage, auf die es ankommt: Vorschau und Vergabe dürfen nicht
     * auseinanderlaufen. Läuft die Vorschau anders, steht auf dem
     * Festschreibebildschirm eine Nummer, die der Beleg dann nicht trägt.
     */
    for (const [maske, nummer, jahr] of [
      ['RE-{jahr}-{nr:5}', 1, 2026],
      ['RE-{jahr}-{nr:5}', 99_999, 2026],
      ['GS-{nr:4}', 7, 2031],
      ['{jahr}/{nr:3}', 123, 2026],
    ] as const) {
      expect(vorschau(maske, nummer, jahr)).toBe(formatiereNummer(maske, nummer, jahr));
    }
  });
});

function vorschauSatz(
  abweichung: Partial<Record<'netto' | 'steuer' | 'brutto' | 'zahlbetrag', bigint>> = {},
): ZugferdVorschau {
  const summen = {
    zeilen: cent(100_000n),
    nachlass: cent(0n),
    zuschlag: cent(0n),
    netto: cent(100_000n),
    steuer: cent(19_000n),
    brutto: cent(119_000n),
    gezahlt: cent(50_000n),
    zahlbetrag: cent(69_000n),
  };
  return {
    nummer: 'RE-2026-00001',
    cii: '<rsm:CrossIndustryInvoice/>',
    summen,
    belegNettoCent: cent(abweichung.netto ?? 100_000n),
    belegSteuerCent: cent(abweichung.steuer ?? 19_000n),
    belegBruttoCent: cent(abweichung.brutto ?? 119_000n),
    belegZahlbetragCent: cent(abweichung.zahlbetrag ?? 69_000n),
    festgeschriebenAm: '2026-03-04T09:00:00.000Z',
    schemaVersion: 'v2',
  };
}

describe('ZUGFeRD-Summenprobe', () => {
  it('geht auf, wenn alle vier Summen stimmen', () => {
    const p = summenprobe(vorschauSatz());
    expect(p.ok).toBe(true);
    expect(p.abweichungen).toEqual([]);
  });

  it('benennt die abweichende Summe und nicht nur, DASS es eine gibt', () => {
    expect(summenprobe(vorschauSatz({ netto: 99_999n })).abweichungen).toEqual(['Netto']);
    expect(summenprobe(vorschauSatz({ steuer: 18_999n })).abweichungen)
      .toEqual(['Umsatzsteuer']);
    expect(summenprobe(vorschauSatz({ brutto: 118_999n })).abweichungen).toEqual(['Brutto']);
    expect(summenprobe(vorschauSatz({ zahlbetrag: 68_999n })).abweichungen)
      .toEqual(['Zahlbetrag']);
  });

  it('nennt mehrere Abweichungen alle auf einmal', () => {
    /*
     * Alle auf einmal und nicht die erste: wer viermal hintereinander in
     * dieselbe Suche geschickt wird, gibt beim dritten Mal auf — dieselbe
     * Regel wie beim Pflichtfeldbericht.
     */
    const p = summenprobe(vorschauSatz({ netto: 1n, brutto: 2n }));
    expect(p.ok).toBe(false);
    expect(p.abweichungen).toEqual(['Netto', 'Brutto']);
  });

  it('bemerkt eine Abweichung von EINEM Cent', () => {
    /*
     * Ein Cent ist der ganze Punkt: eine Rundung, die um einen Cent
     * danebenliegt, wird beim Empfänger zur Ablehnung — und in einer
     * Prozentprüfung wäre sie unsichtbar.
     */
    expect(summenprobe(vorschauSatz({ brutto: 118_999n })).ok).toBe(false);
  });
});
