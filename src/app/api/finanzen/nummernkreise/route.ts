import type { NextRequest, NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus } from '../../uebergang';
import {
  eroeffneNachfolgekreis, WechselFehler,
} from '@/server/services/finanz/nummernkreis-wechsel';
import { FreigabeFehler, gibKreisFrei } from '@/server/services/finanz/nummernkreis-freigabe';

/**
 * `POST /api/finanzen/nummernkreise` — einen Platzhalterkreis freigeben
 * (`aktion=freigeben`, O-134) und den Nachfolgekreis zum Jahreswechsel
 * eröffnen (`aktion=nachfolger`, O-352) — FIN-03, LEG-01, V-284, D-848.
 *
 * **Zwei Handlungen, ein Recht** (`nummernkreis.verwalten` — dasselbe, das
 * die Datenbankfunktionen `fin.nummernkreis_freigeben` und
 * `fin.nummernkreis_nachfolger_eroeffnen` verlangen, 0532; Voreinstellung
 * O-352, D-779: die Administration). Das Gerüst ist `fuehreUebergangAus`:
 * Ursprung, genau ein aktiver Mandant (Invariante 10), `authorize` in der
 * gebundenen Transaktion, und für ein Formular die Seite mit dem Grund
 * (`?fehler=`), nie JSON (D-599). Eine abgewiesene Freigabe kommt mit ihren
 * Eingaben zurück (V-240) — und mit `aktion`, damit die Seite den Grund in
 * der Tabelle der richtigen Handlung nachschlägt.
 *
 * Kein Zähler und kein Hash kommt aus dem Formular. Die Freigabe nennt Maske,
 * Rücksetzung und Bezeichnung, der Jahreswechsel nur den Vorgänger; beide
 * bestätigen die Maske, alles andere übernimmt die Datenbank.
 */
export const dynamic = 'force-dynamic';

type Ergebnis =
  | { readonly art: 'nachfolger'; readonly jahr: number }
  | { readonly art: 'freigeben'; readonly kreis: string };

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus<Ergebnis>(
    anfrage, {
      recht: 'nummernkreis.verwalten',
      handle: async (kontext, r) => {
        const aktion = r.felder['aktion'] ?? '';
        if (aktion === 'freigeben') {
          const kreis = r.felder['kreis'] ?? '';
          await gibKreisFrei(kontext, {
            kreisId: kreis, maske: r.felder['maske'] ?? '',
            ruecksetzung: r.felder['ruecksetzung'] ?? '',
            bezeichnung: r.felder['bezeichnung'] ?? '',
            bestaetigt: r.felder['bestaetigt'] === 'ja',
          });
          return { art: 'freigeben', kreis };
        }
        if (aktion !== 'nachfolger') {
          throw new WechselFehler('nicht_gefunden', 'Diese Handlung gibt es nicht.');
        }
        const neu = await eroeffneNachfolgekreis(
          kontext, r.felder['vorgaenger'] ?? '', r.felder['maske_bestaetigt'] === 'ja');
        return { art: 'nachfolger', jahr: neu.jahr };
      },
      ziel: (slug, e) => `/portal/${slug}/finanzen/nummernkreise?${
        e.art === 'freigeben' ? `freigegeben=${e.kreis}` : `wechsel=${String(e.jahr)}`}`,
      grundVon: (fehler) => grundAus(fehler, WechselFehler, FreigabeFehler),
      maskeFelder: ['aktion', 'kreis', 'maske', 'ruecksetzung', 'bezeichnung'],
    });
}
