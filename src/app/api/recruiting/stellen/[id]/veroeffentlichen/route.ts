import { type NextRequest, type NextResponse } from 'next/server';
import {
  ladeStelle, vermerkeVeroeffentlichung, veroeffentlicheAufKarriereseite, RecruitingFehler,
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
      /**
       * **Die eigene Karriereseite ist kein Kanal — und braucht trotzdem
       * einen Knopf.**
       *
       * Der Trigger aus 0167 bringt eine genehmigte Anzeige auf
       * `freigegeben` und setzt `veroeffentlicht_am` ausdrücklich nicht;
       * `/karriere` zeigt nur `veroeffentlicht`. Dazwischen fehlte der Weg,
       * also erschien KEINE im Portal angelegte Stelle je öffentlich —
       * REC-02 und REC-03 waren gebaut und liefen ins Leere. Gemeldet von der
       * Copilot-Runde auf PR 16 (D-585).
       *
       * Sie steht hier und nicht in `BOERSEN`, weil sie keine Börse IST: kein
       * Port, kein Vertrag, keine externe Kennung, kein Vermerk in
       * `stelle_veroeffentlichung`. Der Schritt ändert den Zustand der
       * Anzeige, mehr nicht — und derselbe Riegel (Invariante 7) prüft beim
       * `update` noch einmal die Genehmigung.
       */
      if (roh === 'karriereseite') {
        await veroeffentlicheAufKarriereseite(kontext, id);
        return 'karriereseite';
      }
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
      /*
       * **Und eine GESCHLOSSENE erst recht nicht.**
       *
       * `geschlossen` ist der Endzustand: die Karriereseite zeigt sie nicht
       * mehr (`t_stelle_oeffentlich`), und die Personalstelle hat die Suche
       * beendet. Der Riegel oben liess sie trotzdem durch — mit einem
       * verbundenen Adapter ginge eine zurückgezogene Anzeige ein zweites Mal
       * auf eine fremde Börse, und **dort holt sie niemand zurück.** Heute
       * endete der Versuch als `nicht_verbunden`, was den Fehler verdeckte.
       * Gemeldet hat das die Copilot-Runde auf PR 16.
       */
      if (stelle.geschlossenAm !== null) {
        throw new RecruitingFehler(
          'Diese Stelle ist geschlossen. Eine zurückgezogene Anzeige geht nicht '
          + 'noch einmal hinaus — was auf einer fremden Börse steht, nimmt diese '
          + 'Plattform nicht zurück (REC-09).', 'geschlossen', 409);
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
        /*
         * **Auch der UNERWARTETE Fehler wird vermerkt.**
         *
         * Hier stand `if (!(fehler instanceof BoerseNichtVerbundenFehler))
         * throw fehler;` — und damit riss jeder andere Adapterfehler (ein
         * Netzausfall, ein Tippfehler im Adapter) die Transaktion mit, samt
         * dem Vermerk. Die Route versprach im Kommentar darüber das
         * Gegenteil: „jeder Misserfolg wird festgehalten". Ein Versprechen,
         * das nur für den einen bekannten Fall gilt, ist keines.
         *
         * Unterschieden wird trotzdem: `nicht_verbunden` ist ein ZUSTAND
         * (O-374), `fehlgeschlagen` ein Vorfall — und nur der gehört ins
         * Fehlerprotokoll, damit ihn jemand findet.
         */
        const bekannt = fehler instanceof BoerseNichtVerbundenFehler;
        if (!bekannt) {
          console.error('[recruiting] Boerse %s fuer Stelle %s fehlgeschlagen',
            boerse, id, fehler);
        }
        const meldung = fehler instanceof Error ? fehler.message : String(fehler);
        await vermerkeVeroeffentlichung(
          kontext, id, boerse, bekannt ? 'nicht_verbunden' : 'fehlgeschlagen', meldung);
        /*
         * **Zurückgeben, nicht werfen.** Ein Wurf hier risse den Vermerk mit:
         * die Transaktion rollte zurück, und der Versuch, den morgen jemand
         * sucht, hätte nie stattgefunden. Die erste Fassung tat genau das,
         * während ihr eigener Kommentar das Gegenteil behauptete — gefunden
         * hat es der Browserlauf mit einem 500.
         */
        const ergebnis: HandlerErgebnis = {
          ergebnis: boerse,
          fehler: bekannt
            ? { grund: 'kanal_nicht_verbunden', meldung, status: 409 }
            : { grund: 'veroeffentlichung_fehlgeschlagen', meldung, status: 502 },
        };
        return ergebnis;
      }
    },
    ziel: (slug) => `/portal/${slug}/recruiting/stellen/${id}/veroeffentlichung?gesendet=1`,
  });
}
