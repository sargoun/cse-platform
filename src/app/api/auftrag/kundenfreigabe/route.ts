import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../uebergang';
import {
  erfasseKundenfreigabe, KundenfreigabeFehler, widerrufeKundenfreigabe,
} from '@/server/services/auftrag/kundenfreigabe';

/**
 * `POST /api/auftrag/kundenfreigabe` — die schriftliche Erlaubnis des Kunden,
 * das Projekt oeffentlich zu nennen (PRO-05).
 *
 * Recht: `referenz.kundenfreigabe_erfassen`, nicht `auftrag.schreiben` —
 * geschrieben wird auf `auftrag`, entschieden wird ueber eine
 * Veroeffentlichung. Seit 0296 setzt der Ausloeser
 * `kern.auftrag_uebergang_pruefen` dasselbe Recht als zweite Linie durch;
 * `t_mandant` prueft `auftrag.schreiben` und traf die richtige Rollenmenge
 * bisher nur zufaellig.
 *
 * **Diese Route veroeffentlicht nichts.** Sie legt keine `referenz`-Zeile an
 * und aendert keine. Das ist PRO-05 und Invariante 7: die oeffentliche Zeile
 * entsteht unter `/website/referenzen` durch einen Menschen, der entscheidet,
 * WAS von diesem Projekt oeffentlich wird.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'referenz.kundenfreigabe_erfassen',
    grundVon: (f) => grundAus(f, KundenfreigabeFehler),
    handle: async (kontext, rumpf) => {
      const auftragId = rumpf.felder['auftragId'] ?? '';
      if (!UUID.test(auftragId)) {
        throw new KundenfreigabeFehler('Kein Auftrag benannt', 'nicht_gefunden');
      }
      const db = { abfrage: kontext.abfrage.bind(kontext) };

      if ((rumpf.felder['aktion'] ?? '') === 'widerrufen') {
        await widerrufeKundenfreigabe(db, auftragId, rumpf.felder['grund'] ?? '');
        return { auftragId };
      }
      await erfasseKundenfreigabe(db, auftragId, {
        ansprechpartnerId: rumpf.felder['ansprechpartnerId'] ?? '',
        dokumentId: rumpf.felder['dokumentId'] ?? '',
        text: rumpf.felder['text'] ?? '',
      });
      return { auftragId };
    },
    ziel: (slug, ergebnis) =>
      `/portal/${slug}/auftraege/${ergebnis.auftragId}/kundenfreigabe`,
  });
}
