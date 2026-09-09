/**
 * `lead_sla_eskalation` — stuendlich, je Mandant (REQ-06).
 *
 * **`je_mandant` und nicht `uebergreifend`.** Der Job laeuft in jedem Bereich
 * getrennt, sieht dort nur dessen Leads und schreibt sein Ergebnis nach
 * `job_lauf_mandant`. Ein uebergreifender Lauf haette eine Mandantengrenze
 * ueberschritten, ohne dass jemand die Entscheidung dazu getroffen haette —
 * genau das verlangt die Registrierung ausdruecklich zu erklaeren.
 *
 * **Stuendlich, und der Dienst sperrt zusaetzlich.** `entscheideEskalation`
 * laesst hoechstens eine Eskalation je Stunde zu, und das UPDATE traegt die
 * Bedingung noch einmal. Der Zeitplan allein waere keine Zusage: ein
 * Wiederholungslauf nach einem Netzfehler ist auch ein Lauf.
 */
import { registriere, type JobDefinition, type JobKontext } from './registry.js';
import { eskaliereFaellige, type Abfrage } from '../services/lead/eskalation.js';

export function registriereLeadSlaJob(db: Abfrage): JobDefinition {
  return registriere({
    schluessel: 'lead_sla_eskalation',
    bezeichnung: 'SLA-Fristen offener Leads prüfen und eskalieren',
    // Zur vollen Stunde, UTC. Die Anzeige rechnet nach Europe/Berlin um.
    zeitplan: '0 * * * *',
    bereich: 'je_mandant',
    // Ein Netzfehler ist kein Grund aufzugeben; dreimal reicht.
    versuche: 2,
    ausfuehren: async (kontext: JobKontext) => {
      if (kontext.mandantId === null) {
        throw new Error('lead_sla_eskalation ist je_mandant und braucht einen Mandanten.');
      }
      /**
       * Der Zeitpunkt kommt aus der DATENBANK (Invariante 5).
       *
       * Ein Job laeuft irgendwo; die Uhr dieses Prozesses ist nicht die
       * Wahrheit, und ein um Minuten falsch gehender Runner eskaliert zu frueh
       * oder zu spaet. `now()` ist der Zeitpunkt, gegen den auch die Fristen
       * geschrieben wurden.
       */
      const [uhr] = (await db.unsafe(`select now() as jetzt`)) as { jetzt: Date | string }[];
      const jetzt = uhr!.jetzt instanceof Date ? uhr!.jetzt : new Date(uhr!.jetzt);
      const bericht = await eskaliereFaellige(db, kontext.mandantId, jetzt);
      return { ...bericht };
    },
  });
}
