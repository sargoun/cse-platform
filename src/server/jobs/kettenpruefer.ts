/**
 * Der naechtliche Hashketten-Pruefer als Job (FIN-06, LEG-01, SPEC §14:
 * „Invoice hash chain broken | nightly | alert immediately").
 *
 * **Warum er so lange nicht registriert war.** Der Dienst
 * (`services/finanz/kettenlauf.ts`) ist seit PR 46 fertig und geprueft —
 * aber nur unter `cse_app`, aus einem Isolationstest heraus. `pruefeKette`
 * filtert ueber `app.aktiver_mandant()`, und ein Job hatte keine Sitzung, in
 * der diese Frage eine Antwort hat. Ihn trotzdem einzutragen haette jede
 * Nacht null Rechnungen geprueft und „keine Abweichung" gemeldet.
 *
 * Beides steht jetzt: `alsJobSitzung` bindet den Mandanten und faehrt unter
 * `cse_job`, und `0108` gibt `cse_job` die beiden fehlenden Leserechte samt
 * Policies — mandantengebunden, nicht `using (true)`, damit der Binder
 * TRAEGT und nicht bloss danebensteht.
 *
 * **`versuche: 0`, und das ist eine Aussage.** Ein gebrochener Hash wird beim
 * zweiten Hinsehen nicht heil. Was ein Wiederholungsversuch hier kaufen
 * wuerde, ist Verzoegerung zwischen Fund und Meldung — bei „alert
 * immediately" genau das Falsche.
 *
 * Nebenbei: bei `bereich: 'je_mandant'` wiederholt der Runner die
 * Mandantenschleife ohnehin nicht (`runner.ts`: der Fehler je Mandant wird
 * gefangen und vermerkt, der Lauf kehrt danach zurueck). `versuche` ist dort
 * heute wirkungslos — die drei bestehenden `je_mandant`-Jobs versprechen
 * also eine Wiederholung, die niemand ausfuehrt. Siehe D-379.
 *
 * **Wie der Alarm aussieht.** Ein Bruch laesst `ausfuehren` werfen. Der
 * Runner traegt den Mandanten mit `ergebnis = 'fehler'` und der VOLLEN
 * Meldung (`meldung(befund)` — Rechnungsnummer, Kreis, Position, Grund) in
 * `job_lauf_mandant` ein und ruft danach `alarm.melde(...)`. Die
 * Alarmzeile selbst nennt nur die Zahl der fehlerhaften Mandanten; die
 * Rechnungsnummer steht eine Ebene tiefer im Protokoll. Wer die Meldung
 * bekommt und auf welchem Weg, ist offen — das ist keine technische Frage.
 *
 * // TODO(client, O-357): Sollen die Waechter-Meldungen aus SPEC §14 in den
 * Posteingang, per Mail oder beides — und wer bekommt die Kettenmeldung,
 * deren Empfaenger nicht die Person, sondern die Buchhaltung ist?
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobVerbindung } from './sitzung.js';
import { meldung, pruefeKette } from '../services/finanz/kettenlauf.js';

export class KetteGebrochen extends Error {
  constructor(text: string) {
    super(text);
    this.name = 'KetteGebrochen';
  }
}

export function registriereKettenpruefer(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'kette_pruefen',
    bezeichnung: 'Nächtliche Prüfung der Rechnungs-Hashkette (FIN-06)',
    /*
     * Nach den schreibenden Nachtlaeufen (Generator 02:15, Konflikte danach)
     * und lange vor dem Arbeitstag: geprueft wird der Stand, mit dem die
     * Buchhaltung morgens anfaengt, nicht einer von mittendrin.
     */
    zeitplan: '20 3 * * *',
    bereich: 'je_mandant',
    versuche: 0,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error('kette_pruefen ist je_mandant und braucht einen Mandanten.');
      }
      const befund = await alsJobSitzung(
        sql, kontext.mandantId, async (db) => pruefeKette(db),
      );
      if (!befund.ok) throw new KetteGebrochen(meldung(befund));
      return {
        geprueft: befund.geprueft,
        kreise: befund.kreise.length,
        meldung: meldung(befund),
      };
    },
  });
}
