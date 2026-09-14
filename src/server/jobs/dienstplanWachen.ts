import { istBerlinerStunde, registriere, type JobDefinition } from './registry.js';
import { erzeuge } from '../benachrichtigung/registry.js';
import { stelleZuAnKonto, type Abfrage } from '../benachrichtigung/ablage.js';
import {
  ART_MORGEN_UNBESETZT, ART_SCHICHT_OHNE_ZEIT, registriereWaechterArten,
} from '../services/waechter/benachrichtigung.js';
import {
  findeOffeneSchichten, findeUnbesetzteSchichten, gibQuittungZurueck, planer, quittiere,
} from '../services/waechter/dienstplan.js';

/**
 * Die beiden Dienstplanwachen aus SPEC §14.
 *
 * **`uebergreifend`, nicht `je_mandant`.** Beide Abfragen tragen `mandant_id`
 * in jeder Zeile und ermitteln die Empfänger je Gesellschaft; ein Lauf je
 * Mandant schriebe dieselben Quittungen viermal und liefe dreimal ins Leere.
 * Der Unterschied zum Lead-SLA (`je_mandant`) ist kein Zufall: dort steht der
 * Empfänger in der Zeile, hier wird er je Gesellschaft aufgelöst.
 */

interface Zaehler { readonly faellig: number; readonly zugestellt: number; readonly ohnePlaner: number }

async function melde(
  db: Abfrage,
  waechter: string,
  faelle: readonly {
    mandantId: string; mandantSlug: string; objektId: string; kennung: string;
    art: string; daten: Record<string, unknown>;
  }[],
  objektTyp: string,
): Promise<Zaehler> {
  let zugestellt = 0;
  let ohnePlaner = 0;
  /* Die Empfänger je Gesellschaft EINMAL aufloesen, nicht je Fall. */
  const empfaengerCache = new Map<string, readonly string[]>();

  for (const fall of faelle) {
    let empfaenger = empfaengerCache.get(fall.mandantId);
    if (empfaenger === undefined) {
      empfaenger = await planer(db, fall.mandantId);
      empfaengerCache.set(fall.mandantId, empfaenger);
    }
    if (empfaenger.length === 0) { ohnePlaner += 1; continue; }

    for (const benutzerId of empfaenger) {
      /*
       * **Erst den Anspruch, dann die Zustellung — und den Anspruch zurueck,
       * wenn nichts ankam.** Andersherum meldeten zwei gleichzeitige Laeufe
       * dieselbe Lage zweimal; ohne die Rueckgabe bliebe ein stillgelegtes
       * Konto fuer immer als „gemeldet" stehen, obwohl nie etwas zugestellt
       * wurde.
       */
      const quittung = await quittiere(db, {
        mandantId: fall.mandantId, waechter, objektTyp,
        objektId: fall.objektId, empfaengerId: benutzerId, kennung: fall.kennung,
      });
      if (quittung === null) continue;

      let benachrichtigung;
      try {
        benachrichtigung = erzeuge(fall.art, {
          mandantId: fall.mandantId, mandantSlug: fall.mandantSlug,
          objektTyp, objektId: fall.objektId, daten: fall.daten,
        });
      } catch {
        /* Kein Ziel (NOT-03) — gezaehlt, nicht verschwiegen, und nicht zugestellt. */
        await gibQuittungZurueck(db, quittung);
        continue;
      }
      const e = await stelleZuAnKonto(db, [{
        benachrichtigung, benutzerId, objektTyp, objektId: fall.objektId,
      }]);
      if (e.zugestellt === 0) { await gibQuittungZurueck(db, quittung); continue; }
      zugestellt += e.zugestellt;
    }
  }
  return { faellig: faelle.length, zugestellt, ohnePlaner };
}

/** SPEC §14: „daily 18:00" — Berliner Ortszeit, nicht UTC. */
const ABENDSTUNDE_BERLIN = 18;

export function registriereSchichtOhneZeiteintrag(db: Abfrage): JobDefinition {
  registriereWaechterArten();
  return registriere({
    schluessel: 'schicht_ohne_zeiteintrag',
    bezeichnung: 'Schicht beendet, kein Zeiteintrag — Planer benachrichtigen (SPEC §14)',
    /* Stuendlich zur halben Stunde, damit sie nicht mit jedem anderen Lauf kollidiert. */
    zeitplan: '30 * * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      const offene = await findeOffeneSchichten(db);
      const z = await melde(db, 'schicht_ohne_zeiteintrag', offene.map((o) => ({
        mandantId: o.mandantId, mandantSlug: o.mandantSlug,
        objektId: o.zuordnungId,
        /* Eine Lage, die sich nicht wiederholt: einmal melden, nie wieder. */
        kennung: '',
        art: ART_SCHICHT_OHNE_ZEIT,
        daten: {
          person: o.personName, objekt: o.objektName, ende: o.endeLokal, stunden: o.stundenHer,
        },
      })), 'einsatz_zuordnung');
      return { offene_schichten: z.faellig, zugestellt: z.zugestellt, ohne_planer: z.ohnePlaner };
    },
  });
}

export function registriereMorgenUnbesetzt(db: Abfrage): JobDefinition {
  registriereWaechterArten();
  return registriere({
    schluessel: 'morgen_unbesetzt',
    bezeichnung: 'Morgen unbesetzte Schichten — dringende Meldung (SPEC §14)',
    /**
     * **SPEC §14 sagt „daily 18:00", und das ist Ortszeit.**
     *
     * Hier stand `0 16 * * *` mit der Begründung, eine wandernde Stunde sei
     * „verkraftbar". Sie ist es nicht, und die Architektur sagt das auch
     * (`05-API-KARTE.md` §548): ein Lauf mit einer Wanduhr-Vorgabe wird
     * STÜNDLICH geplant und prüft die Berliner Stunde. `0 16 UTC` traf im
     * Sommer 18:00 und im Winter 17:00 — also ein halbes Jahr lang eine
     * Stunde zu früh, und zwar unbemerkt, weil die Meldung ja ankam.
     */
    zeitplan: '0 * * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      if (!await istBerlinerStunde(db, ABENDSTUNDE_BERLIN)) {
        return { uebersprungen: 'nicht die Abendstunde in Berlin' };
      }
      const luecken = await findeUnbesetzteSchichten(db);
      const z = await melde(db, 'morgen_unbesetzt', luecken.map((l) => ({
        mandantId: l.mandantId, mandantSlug: l.mandantSlug,
        objektId: l.einsatzId,
        /* Die Lage ist der TAG: morgen immer noch unbesetzt meldet erneut. */
        kennung: l.tag,
        art: ART_MORGEN_UNBESETZT,
        daten: { objekt: l.objektName, beginn: l.beginnLokal, soll: l.soll, besetzt: l.besetzt },
      })), 'einsatz');
      return { unbesetzt: z.faellig, zugestellt: z.zugestellt, ohne_planer: z.ohnePlaner };
    },
  });
}
