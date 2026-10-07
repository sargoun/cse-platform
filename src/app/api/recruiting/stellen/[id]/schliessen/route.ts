import { type NextRequest, type NextResponse } from 'next/server';
import { RecruitingFehler, schliesseStelle } from '@/server/services/recruiting/dienst';
import { fuehreRecruitingAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/recruiting/stellen/[id]/schliessen` — eine Stelle schliessen,
 * mit Grund (V-363, O-200, D-812).
 *
 * Danach steht sie nicht mehr auf der Karriereseite; die offenen Bewerbungen
 * bleiben und werden weiter entschieden. Protokolliert wird im Dienst.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.stelle_schreiben',
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Diese Stelle gibt es nicht.', 'unbekannt', 404);
      }
      await schliesseStelle(kontext, id, rumpf.felder['grund'] ?? '');
      return id;
    },
    ziel: (slug) => `/portal/${slug}/recruiting/stellen/${id}?geschlossen=1`,
  });
}
