/**
 * Der naechtliche Mahnlauf (FIN-15, SPEC §14 „Invoice overdue > 14 days").
 *
 * **Er erzeugt VORSCHLAEGE, nie einen Brief.** Was hier entsteht, ist ein
 * Entwurf ohne Nummer, der auf einem Bildschirm liegt, bis ein Mensch ihn
 * freigibt (Invariante 7). Ein Nachtlauf, der Mahnungen versendet, versendet
 * irgendwann die eine, die nicht haette hinausgehen duerfen — und danach
 * traut die Buchhaltung dem Lauf nicht mehr und schaltet ihn ab.
 *
 * **Wo nichts bestaetigt ist, entsteht nichts.** Ohne bestaetigte `mahnstufe`
 * (O-19) legt der Lauf keinen Entwurf an und sagt, warum. Er raet keine
 * Gebuehr und keinen Zinssatz.
 *
 * **`versuche: 0`.** Ein zweiter Anlauf faende dieselbe Lage vor. Was er
 * kaufte, ist ein doppelter Entwurf, falls der erste Durchlauf schon
 * geschrieben hat.
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobVerbindung } from './sitzung.js';
import { ermittleVorschlaege, legeMahnentwurfAn, meldung }
  from '../services/finanz/mahnung/lauf.js';

export function registriereMahnlauf(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'mahnvorschlaege_erzeugen',
    bezeichnung: 'Nächtlicher Mahnlauf — Vorschläge, keine Briefe (FIN-15)',
    /*
     * Nach dem Postenabgleich (03:40): erst steht fest, was wirklich offen
     * ist, dann wird gemahnt. Andersherum mahnte der Lauf Betraege, die der
     * Abgleich Minuten spaeter richtiggestellt haette.
     */
    zeitplan: '10 4 * * *',
    bereich: 'je_mandant',
    versuche: 0,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error('mahnvorschlaege_erzeugen ist je_mandant und braucht einen Mandanten.');
      }
      return alsJobSitzung(sql, kontext.mandantId, async (db) => {
        const lage = await ermittleVorschlaege(db);
        const angelegt: string[] = [];
        for (const vorschlag of lage.vorschlaege) {
          angelegt.push(await legeMahnentwurfAn(db, vorschlag));
        }
        return {
          entwuerfe: angelegt.length,
          uebergangen: lage.uebergangen.length,
          meldung: meldung(lage),
        };
      }, { nurLesen: false });
    },
  });
}
