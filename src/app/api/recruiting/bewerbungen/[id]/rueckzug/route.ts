import { type NextRequest, type NextResponse } from 'next/server';
import { RecruitingFehler, zieheBewerbungZurueck } from '@/server/services/recruiting/dienst';
import { fuehreRecruitingAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/recruiting/bewerbungen/[id]/rueckzug` — den Rückzug einer
 * offenen Bewerbung vermerken, auf die Erklärung der Bewerberin
 * (V-363, O-200, D-812).
 *
 * Keine Entscheidung über einen Menschen: die Bewerberin hat entschieden, und
 * hier steht, wer es vermerkt hat und wie sie es erklärt hat. Danach wird die
 * Bewerbung nicht mehr entschieden (0508).
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.bewerbung_bewerten',
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Diese Bewerbung gibt es nicht.', 'nicht_gefunden', 404);
      }
      await zieheBewerbungZurueck(kontext, id, rumpf.felder['vermerk'] ?? '');
      return id;
    },
    ziel: (slug) => `/portal/${slug}/recruiting/bewerbungen/${id}?zurueckgezogen=1`,
  });
}
