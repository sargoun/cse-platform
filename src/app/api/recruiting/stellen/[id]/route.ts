import { type NextRequest, type NextResponse } from 'next/server';
import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import { aendereStelle } from '@/server/services/recruiting/stellenentwurf';
import { fuehreRecruitingAus } from '../../gemeinsam';
import { UUID } from '../../../rumpf';
import { leseStellenfelder } from '../felder';

/**
 * `POST /api/recruiting/stellen/[id]` — einen Stellenentwurf bearbeiten
 * (REC-02 „AI drafts, a human edits and approves", V-222, D-716).
 *
 * Nur ein ENTWURF, an dem keine Freigabe hängt: die Freigabe bindet ihren
 * Abdruck an genau den vorgelegten Text (`legeStelleVor`), und wer danach
 * ändert, hätte keine Freigabe mehr für das, was hinausgeht. Die Bedingung
 * steht im Dienst IM `update`.
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
      const f = leseStellenfelder(rumpf.felder);
      await aendereStelle(kontext, id, {
        titel: f.titel,
        beschreibung: f.beschreibung,
        anforderungen: f.anforderungen,
        einsatzort: f.einsatzort,
        wochenstunden: f.wochenstunden,
        bewerbungsfrist: f.bewerbungsfrist,
      });
      return id;
    },
    ziel: (slug, stelle) => `/portal/${slug}/recruiting/stellen/${stelle}?bearbeitet=1`,
  });
}
