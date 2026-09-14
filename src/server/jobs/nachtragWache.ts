import { registriere, type JobDefinition } from './registry.js';
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
export function registriereNachtragWache(db: Abfrage): JobDefinition {
  registriereWaechterArten();
  return registriere({
    schluessel: 'nachtrag_ueberfaellig',
    bezeichnung: 'Nachtrag angemeldet, nach 14 Tagen nicht eingereicht (SPEC §14, BAU-04)',
    zeitplan: '15 5 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
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
        const e = await stelleZuAnKonto(db, [{
          benachrichtigung, benutzerId: empfaenger,
          objektTyp: 'nachtrag', objektId: String(n['id']),
        }]);
        zugestellt += e.zugestellt;
        gemeldet.push(String(n['id']));
      }

      /**
       * Das Gedächtnis wird NACH der Zustellung gesetzt — anders als bei den
       * beiden anderen Wachen, und mit Absicht: hier ist es eine Spalte am
       * Nachtrag, die in der Bauakte angezeigt wird. „Gemeldet am" soll dort
       * stimmen, und die Bedingung steht zusätzlich im UPDATE, damit zwei
       * gleichzeitige Läufe nicht beide melden.
       */
      let markiert = 0;
      if (gemeldet.length > 0) {
        const zeilen = (await db.unsafe(
          `update nachtrag set ueberfaellig_gemeldet_am = now()
            where id = any ($1::uuid[]) and ueberfaellig_gemeldet_am is null
           returning id`, [gemeldet])) as readonly { id: string }[];
        markiert = zeilen.length;
      }

      return {
        ueberfaellig: faellige.length,
        zugestellt,
        markiert,
        ohne_bauleitung: ohneBauleitung,
      };
    },
  });
}
