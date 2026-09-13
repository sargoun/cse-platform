/**
 * Der naechtliche Abgleich der offenen Posten (ACC-07, `05-FINANZEN.md` §7.3).
 *
 * **Was er prueft und was nicht.** Er prueft, ob `bezahlt_cent` auf jedem
 * Posten dem entspricht, was die Belegzeilen ergeben. Er prueft NICHT, ob die
 * Zahlung richtig war — das kann kein Programm; er prueft, ob die Buchhaltung
 * mit sich selbst uebereinstimmt.
 *
 * **Warum eine schreibende Sitzung, obwohl er nicht repariert.** Der Lauf
 * setzt `neu_berechnet_am`, den Stempel „geprueft am". Ohne ihn liesse sich
 * nicht unterscheiden zwischen „keine Abweichung" und „seit drei Wochen hat
 * niemand hingesehen, weil der Lauf ausfaellt". Was er ausserdem NICHT
 * schreiben kann, steht nicht in dieser Datei, sondern im Spaltenrecht aus
 * 0121: `cse_job` haelt auf `offener_posten` nur `update (neu_berechnet_am)`.
 * Ein Isolationstest weist das nach, indem er `bezahlt_cent` unter dieser
 * Rolle zu setzen versucht.
 *
 * **`versuche: 0`.** Eine Abweichung verschwindet beim zweiten Hinsehen
 * nicht. Was ein Wiederholungsversuch kaufte, ist Verzoegerung zwischen Fund
 * und Meldung.
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobVerbindung } from './sitzung.js';
import { gleicheOffenePostenAb, meldung }
  from '../services/finanz/zahlung/abgleich.js';

export class PostenWeichenAb extends Error {
  constructor(text: string) {
    super(text);
    this.name = 'PostenWeichenAb';
  }
}

export function registrierePostenabgleich(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'offene_posten_abgleichen',
    bezeichnung: 'Nächtlicher Abgleich der offenen Posten (ACC-07)',
    /*
     * Nach dem Kettenpruefer (03:20): erst steht fest, dass die Belege
     * unversehrt sind, dann wird nachgerechnet, was auf ihnen offen ist.
     */
    zeitplan: '40 3 * * *',
    bereich: 'je_mandant',
    versuche: 0,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error('offene_posten_abgleichen ist je_mandant und braucht einen Mandanten.');
      }
      const befund = await alsJobSitzung(
        sql, kontext.mandantId,
        async (db) => gleicheOffenePostenAb(db),
        /* Er stempelt `neu_berechnet_am` — und sonst nichts; das Spaltenrecht
           aus 0121 haelt ihn von jeder anderen Spalte fern. */
        { nurLesen: false },
      );
      if (!befund.ok) throw new PostenWeichenAb(meldung(befund));
      return {
        geprueft: befund.geprueft,
        abweichungen: befund.abweichungen.length,
        meldung: meldung(befund),
      };
    },
  });
}
