/**
 * Der EMP-08-Waechter als Job: 60/30/7 Tage vor Ablauf eines Nachweises.
 *
 * **`uebergreifend`, nicht `je_mandant`** — und das ist D-09, nicht Bequem-
 * lichkeit. Ein `nachweis` haengt am MENSCHEN und traegt kein `mandant_id`;
 * dieselbe Sachkundepruefung nach § 34a GewO gilt in allen Gesellschaften, in
 * denen die Person beschaeftigt ist. Ein Lauf je Mandant haette denselben
 * Nachweis viermal geprueft und — waere die Quittung in `nachweis_warnung`
 * nicht eindeutig — viermal gewarnt.
 *
 * Der Mandant der MELDUNG ist ein anderer: `nachweis.erfasst_von_mandant_id`,
 * die einzige Verantwortlichkeit, die auf der Zeile steht. Das entscheidet
 * `meldeAblaufwarnungen`, nicht dieser Job.
 */
import { registriere, type JobDefinition } from './registry.js';
import { meldeAblaufwarnungen } from '../services/nachweis/ablauf.js';
import { stelleZu, type Abfrage } from '../benachrichtigung/ablage.js';

export function registriereNachweisWarnungen(db: Abfrage): JobDefinition {
  return registriere({
    schluessel: 'nachweis_warnungen',
    bezeichnung: 'Ablaufwarnungen für Nachweise (60/30/7 Tage, EMP-08)',
    // Vor dem Dienstplangenerator: wer morgen keinen gültigen Nachweis mehr
    // hat, soll nicht erst erfahren, dass er schon eingeteilt ist.
    zeitplan: '5 2 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      /**
       * Der Stichtag kommt aus der DATENBANK (Invariante 5).
       *
       * Die Uhr des Prozesses, auf dem der Job gerade laeuft, entscheidet
       * hier ueber eine Frist — und eine Frist, die von der Maschine abhaengt,
       * ist keine.
       */
      const [zeile] = (await db.unsafe(
        `select (now() at time zone 'Europe/Berlin')::date::text as tag`,
      )) as readonly { tag: string }[];
      const heute = zeile!.tag;

      const bericht = await meldeAblaufwarnungen(db, heute);
      const zustellung = await stelleZu(db, bericht.gemeldet.map((m) => ({
        benachrichtigung: m.benachrichtigung,
        personId: m.personId,
        objektTyp: 'nachweis',
        objektId: m.nachweisId,
      })));

      /**
       * Beides steht im Kennzahlensatz, und zwar einzeln.
       *
       * „5 gemeldet" allein saehe wie ein ruhiger Lauf aus, auch wenn keine
       * einzige Meldung einen Menschen erreicht hat — der haeufigste Fall
       * heute, weil die meisten Personen noch keinen Zugang haben (PR 20).
       */
      return {
        stichtag: heute,
        geprueft: bericht.geprueft,
        gemeldet: bericht.gemeldet.length,
        zugestellt: zustellung.zugestellt,
        ohne_empfaenger: zustellung.ohneEmpfaenger,
        mehrdeutige_zugaenge: zustellung.mehrdeutig,
        unzustellbar: bericht.unzustellbar,
      };
    },
  });
}
