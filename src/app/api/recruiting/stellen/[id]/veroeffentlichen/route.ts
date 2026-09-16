import { type NextRequest, type NextResponse } from 'next/server';
import {
  ladeStelle, vermerkeVeroeffentlichung, RecruitingFehler,
} from '@/server/services/recruiting/dienst';
import {
  BOERSEN, BoerseNichtVerbundenFehler, boersenPort, type Boerse,
} from '@/server/versand/stellenboerse';
import { fuehreRecruitingAus, type HandlerErgebnis } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/recruiting/stellen/[id]/veroeffentlichen` — der Versuch, und was
 * daraus wurde (REC-09, D-02, R-17).
 *
 * **Es gibt keinen Demo-Zweig.** Keine Börse ist verbunden; jeder Versuch
 * endet mit `409 kanal_nicht_verbunden` — und wird VERMERKT, mit Datum und
 * Grund. Eine erfundene `externe_ref` wäre ein Beleg für etwas, das nie
 * geschah, und die Stelle sähe im Portal veröffentlicht aus.
 *
 * **Der Vermerk wird auch im Misserfolg geschrieben, und das ist der Zweck
 * dieser Route.** Wer morgen fragt „warum steht die Stelle nicht bei der
 * Bundesagentur", findet hier die Antwort mit Zeitpunkt, statt sie zu erraten.
 * Deshalb ist der Fehler des Ports hier kein Abbruch: er wird gefangen,
 * festgehalten und als ERGEBNIS zurückgegeben — nicht geworfen. Ein Wurf
 * risse den Vermerk mit, denn die Transaktion rollte zurück; die Antwort 409
 * bildet das Gerüst danach, wenn geschrieben ist.
 *
 * // TODO(client): O-374 — welche Jobbörse wird beauftragt, mit welchem
 * // Vertrag, und liegt für die Bundesagentur eine freigeschaltete
 * // Betriebsnummer vor?
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.stelle_veroeffentlichen',
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Diese Stelle gibt es nicht.', 'nicht_gefunden', 404);
      }
      const roh = (rumpf.felder['boerse'] ?? '').trim();
      if (!(BOERSEN as readonly string[]).includes(roh)) {
        throw new RecruitingFehler(
          'Dieses Ziel kennt die Plattform nicht.', 'unbekanntes_ziel', 400);
      }
      const boerse = roh as Boerse;

      const stelle = await ladeStelle(kontext, id);
      if (stelle === null) {
        throw new RecruitingFehler('Diese Stelle gibt es nicht.', 'nicht_gefunden', 404);
      }
      /*
       * Ein Entwurf geht nirgends hin. Das prüft hier eine Zeile, weil die
       * Antwort sonst „nicht verbunden" hiesse — und die Personalstelle den
       * fehlenden Vertrag suchte, wo die fehlende Freigabe steht.
       */
      if (stelle.status === 'entwurf') {
        throw new RecruitingFehler(
          'Ein Entwurf geht nicht hinaus. Die Stelle braucht zuerst eine Freigabe '
          + '(Invariante 7).', 'nicht_freigegeben', 409);
      }

      const port = boersenPort(boerse);
      try {
        const { externeRef } = await port.veroeffentliche({
          stelleId: id,
          titel: stelle.titel,
          beschreibung: stelle.beschreibung,
          einsatzort: stelle.einsatzort,
        });
        await vermerkeVeroeffentlichung(
          kontext, id, boerse, 'veroeffentlicht', port.hinweis, externeRef);
        return externeRef;
      } catch (fehler) {
        if (!(fehler instanceof BoerseNichtVerbundenFehler)) throw fehler;
        await vermerkeVeroeffentlichung(
          kontext, id, boerse, 'nicht_verbunden', fehler.message);
        /*
         * **Zurückgeben, nicht werfen.** Ein Wurf hier risse den Vermerk mit:
         * die Transaktion rollte zurück, und der Versuch, den morgen jemand
         * sucht, hätte nie stattgefunden. Die erste Fassung tat genau das,
         * während ihr eigener Kommentar das Gegenteil behauptete — gefunden
         * hat es der Browserlauf mit einem 500.
         */
        const ergebnis: HandlerErgebnis = {
          ergebnis: boerse,
          fehler: { grund: 'kanal_nicht_verbunden', meldung: fehler.message, status: 409 },
        };
        return ergebnis;
      }
    },
    ziel: (slug) => `/portal/${slug}/recruiting/stellen/${id}/veroeffentlichung?gesendet=1`,
  });
}
