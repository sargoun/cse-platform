import { type NextRequest, type NextResponse } from 'next/server';
import { legeStelleVor, RecruitingFehler } from '@/server/services/recruiting/dienst';
import { fuehreRecruitingAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/recruiting/stellen/[id]/freigabe` — die Anzeige zur Freigabe
 * vorlegen (REC-02, Invariante 7).
 *
 * **Diese Route hat gefehlt, und mit ihr das halbe Modul.** `stelle.status`
 * kannte `freigegeben` seit 0166; gesetzt hat ihn niemand. Eine Anzeige kam
 * nie aus dem Entwurf, die Veröffentlichungsseite antwortete „nicht
 * freigegeben", und REC-09 war für einen Menschen nicht ausführbar. Jede
 * Datei einzeln gebaut und geprüft — zusammen ging nichts hinaus.
 *
 * **Das Recht ist `recruiting.stelle_schreiben` und nicht
 * `…_veroeffentlichen`.** Vorlegen ist BITTEN, nicht entscheiden: wer die
 * Anzeige schreibt, darf um ihre Freigabe bitten. Entschieden wird im
 * Freigabe-Posteingang, und dort verlangt die Zeile ausdrücklich
 * `recruiting.stelle_veroeffentlichen` (`erforderliches_recht`). Zwei Wege zu
 * derselben Entscheidung wären einer zu viel (SOC-08, hier REC-02).
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.stelle_schreiben',
    handle: async (kontext) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Diese Stelle gibt es nicht.', 'unbekannt', 404);
      }
      await legeStelleVor(kontext, id);
      return id;
    },
    ziel: (slug, stelleId) => `/portal/${slug}/recruiting/stellen/${stelleId}?vorgelegt=1`,
  });
}
