import { istBerlinerStunde, registriere, type JobDefinition } from './registry.js';
import { stelleZuAnKonto, type Abfrage } from '../benachrichtigung/ablage.js';
import { registriereRadarArten } from '../services/radar/benachrichtigung.js';
import { pruefeWarnungen } from '../services/radar/warnung.js';

/**
 * Der Radarwächter als Job (SPEC §14 Zeile 1, RAD-08).
 *
 * **Morgens um sieben, nicht nachts um zwei.** Eine Fristwarnung soll am
 * Anfang eines Arbeitstages im Posteingang liegen, nicht sechs Stunden davor
 * in einer stillen Nacht — sie ist eine Aufforderung zu handeln, und
 * gehandelt wird tagsüber. Der Einleselauf (`radar_einlesen`) läuft davor,
 * damit die Lage von heute gemeldet wird und nicht die von gestern.
 *
 * **`uebergreifend`, nicht `je_mandant`.** Die Abfragen tragen `mandant_id`
 * in jeder Zeile und melden je Gesellschaft getrennt; ein Lauf je Mandant
 * prüfte dieselbe Bekanntmachung viermal und schriebe vier Quittungen, wo
 * eine Quittung je Empfänger gemeint ist.
 */
/** Sieben Uhr Berliner Ortszeit — der Anfang eines Arbeitstages. */
const WARNSTUNDE_BERLIN = 7;

export function registriereRadarWarnungen(db: Abfrage): JobDefinition {
  /*
   * Die Arten werden beim Registrieren des Jobs bekannt gemacht, nicht im
   * Lauf: `registriereArt` wirft bei der zweiten Registrierung, und ein Job,
   * der beim zweiten Lauf daran stirbt, faellt erst in der zweiten Nacht auf.
   */
  registriereRadarArten();

  return registriere({
    schluessel: 'radar_warnungen',
    bezeichnung: 'Radar: knappe Abgabefristen und Treffer über der Schwelle (SPEC §14, RAD-08)',
    /**
     * **Stündlich, und die Berliner Stunde ist die Wache** (K-11). Ein festes
     * `0 6 * * *` wäre im Winter sieben Uhr und im Sommer acht — die Stunde
     * wanderte mit der Zeitumstellung. Sieben Uhr soll sieben Uhr sein.
     */
    zeitplan: '0 * * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      if (!await istBerlinerStunde(db, WARNSTUNDE_BERLIN)) {
        return { uebersprungen: 'nicht die Warnstunde in Berlin' };
      }
      const bericht = await pruefeWarnungen(
        { unsafe: (a, w) => db.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]> },
        async (meldungen) => {
          const e = await stelleZuAnKonto(db, meldungen.map((m) => ({
            benachrichtigung: m.benachrichtigung,
            benutzerId: m.empfaengerId,
            objektTyp: 'ausschreibung',
            objektId: m.ausschreibungId,
          })));
          return e.zugestellt;
        },
      );

      /**
       * `ohne_schwelle` steht mit im Kennzahlensatz, und zwar einzeln.
       *
       * „0 Treffer" allein sähe wie ein ruhiger Tag aus — auch dann, wenn
       * schlicht niemand eine Schwelle gesetzt hat (O-15) und RAD-08 deshalb
       * gar nicht arbeiten KANN. Der Unterschied ist genau der zwischen
       * „heute war nichts dabei" und „dieser Wächter ist unbestellt".
       */
      return {
        geprueft: bericht.geprueft,
        frist_faellig: bericht.frist,
        treffer_faellig: bericht.treffer,
        zugestellt: bericht.gemeldet,
        unzustellbar: bericht.unzustellbar,
        empfaenger_ohne_schwelle: bericht.ohneSchwelle,
      };
    },
  });
}
