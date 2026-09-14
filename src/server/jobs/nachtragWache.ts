import { istBerlinerStunde, registriere, type JobDefinition } from './registry.js';
import { erzeuge } from '../benachrichtigung/registry.js';
import { stelleZuAnKonto, type Abfrage } from '../benachrichtigung/ablage.js';
import {
  ART_NACHTRAG_OFFEN, registriereWaechterArten,
} from '../services/waechter/benachrichtigung.js';

/**
 * „Nachtrag angemeldet, nach 14 Tagen nicht eingereicht" (SPEC §14, BAU-04).
 *
 * **Der Dienst stand schon, der Zeitplan fehlte.** `waehleUeberfaelligeNachtraege`
 * und `markiereUeberfaelligGemeldet` liegen seit 0080 in `services/bau/nachtrag`
 * — mitsamt dem Gedächtnis (`ueberfaellig_gemeldet_am`) und dem fertigen Ziel.
 * Was fehlte, war der Job, der sie täglich aufruft: eine Wache ohne Uhr ist
 * eine Funktion, die niemand ruft.
 *
 * **Warum § 2 Abs. 6 VOB/B im Meldungstext steht.** Die Ankündigung eines
 * Nachtrags gehört VOR die Ausführung. Ein Nachtrag, der seit zwei Wochen
 * angemeldet und nicht eingereicht ist, wird mit jedem Tag schwerer
 * durchzusetzen — das ist kein Verwaltungsdetail, sondern der Grund, warum
 * diese Wache im SPEC steht.
 *
 * **Der Empfänger steht in der Zeile** (`projekt.verantwortlich_benutzer_id`),
 * anders als bei den Dienstplanwachen: ein Bauprojekt HAT eine Bauleitung.
 * Fehlt sie, wird das gezählt und nicht ersatzweise die halbe Gesellschaft
 * benachrichtigt.
 */
/** Acht Uhr Berliner Ortszeit — die Bauleitung liest morgens. */
const MELDESTUNDE_BERLIN = 8;

export function registriereNachtragWache(db: Abfrage): JobDefinition {
  registriereWaechterArten();
  return registriere({
    schluessel: 'nachtrag_ueberfaellig',
    bezeichnung: 'Nachtrag angemeldet, nach 14 Tagen nicht eingereicht (SPEC §14, BAU-04)',
    /**
     * **Acht Uhr Berliner Ortszeit, also stündlich mit Stundenwache** (K-11,
     * `05-API-KARTE.md` §548). `15 5 * * *` traf 06:15 im Winter und 07:15 im
     * Sommer — beides nicht acht, und beides unbemerkt.
     */
    zeitplan: '0 * * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      if (!await istBerlinerStunde(db, MELDESTUNDE_BERLIN)) {
        return { uebersprungen: 'nicht die Meldestunde in Berlin' };
      }
      const faellige = (await db.unsafe(
        `select n.id, n.nummer, n.titel, n.mandant_id, m.slug as mandant_slug,
                p.bezeichnung as projekt, p.verantwortlich_benutzer_id,
                to_char(n.angemeldet_am, 'DD.MM.YYYY') as angemeldet_lokal,
                (app.berlin_heute() - n.angemeldet_am)::int as tage_offen,
                '/portal/' || m.slug || '/bau/projekte/' || n.projekt_id::text
                  || '/nachtraege/' || n.id::text as ziel
           from nachtrag n
           join projekt p on p.id = n.projekt_id and p.mandant_id = n.mandant_id
           join mandant m on m.id = n.mandant_id
          where n.status = 'angemeldet'
            and n.eingereicht_am is null
            and n.storniert_am is null
            and n.ueberfaellig_gemeldet_am is null
            and n.angemeldet_am is not null
            and n.angemeldet_am <= app.berlin_heute() - 14
          order by n.angemeldet_am, n.nummer`,
      )) as readonly Record<string, unknown>[];

      let zugestellt = 0;
      let ohneBauleitung = 0;
      const gemeldet: string[] = [];

      for (const n of faellige) {
        const empfaenger = n['verantwortlich_benutzer_id'];
        if (typeof empfaenger !== 'string' || empfaenger === '') {
          ohneBauleitung += 1;
          continue;
        }
        let benachrichtigung;
        try {
          benachrichtigung = erzeuge(ART_NACHTRAG_OFFEN, {
            mandantId: String(n['mandant_id']),
            mandantSlug: String(n['mandant_slug']),
            objektTyp: 'nachtrag',
            objektId: String(n['id']),
            daten: {
              nummer: n['nummer'], titel: n['titel'], projekt: n['projekt'],
              angemeldet: n['angemeldet_lokal'], tage: n['tage_offen'], ziel: n['ziel'],
            },
          });
        } catch {
          continue;   // Ohne Ziel keine Meldung (NOT-03).
        }
        /**
         * **Erst den Anspruch nehmen, dann zustellen, und ihn bei null wieder
         * zurueckgeben.**
         *
         * Vorher stand das Gedaechtnis NACH der Zustellung, und beides war
         * falsch: zwei gleichzeitige Laeufe waehlten dieselbe Zeile, stellten
         * beide zu und stritten erst danach um das UPDATE — die Bedingung
         * `is null` verhinderte die doppelte Meldung nicht, nur den doppelten
         * Zeitstempel. Und eine Zustellung an ein stillgelegtes Konto (null
         * Empfaenger) markierte die Zeile trotzdem als gemeldet, womit sie nie
         * wieder drankam.
         *
         * Der Anspruch ist eine EINZELNE Anweisung mit `is null` — damit hat
         * ihn genau ein Lauf. Bleibt die Zustellung bei null, wird er
         * zurueckgegeben, und der naechste Lauf versucht es erneut.
         */
        const anspruch = (await db.unsafe(
          `update nachtrag set ueberfaellig_gemeldet_am = now()
            where id = $1::uuid and ueberfaellig_gemeldet_am is null
           returning id`, [String(n['id'])])) as readonly { id: string }[];
        if (anspruch.length === 0) continue;

        const e = await stelleZuAnKonto(db, [{
          benachrichtigung, benutzerId: empfaenger,
          objektTyp: 'nachtrag', objektId: String(n['id']),
        }]);
        if (e.zugestellt === 0) {
          await db.unsafe(
            `update nachtrag set ueberfaellig_gemeldet_am = null where id = $1::uuid`,
            [String(n['id'])]);
          continue;
        }
        zugestellt += e.zugestellt;
        gemeldet.push(String(n['id']));
      }

      /* Markiert ist, was oben den Anspruch behalten hat — er steht schon. */
      const markiert = gemeldet.length;

      return {
        ueberfaellig: faellige.length,
        zugestellt,
        markiert,
        ohne_bauleitung: ohneBauleitung,
      };
    },
  });
}
