import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../../uebergang';
import {
  TerminFehler, aendereTermin, sageTerminAb,
} from '@/server/services/kalender/termin';
import { TERMIN_MASKE, terminAusRumpf } from '../termin-rumpf';

/**
 * `POST /api/kalender/eintraege/[id]` — einen eigenen Termin ändern oder
 * absagen (CAL-01, V-221, D-715). Das Feld `aktion` sagt, welches.
 *
 * Nur, was der Kalender selbst besitzt: eine Wiedervorlage ändert das CRM,
 * ein Bewerbungsgespräch das Recruiting (`fremde_art`). Abgesagt wird mit
 * Grund, und der Termin bleibt stehen (0160, 0161).
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreUebergangAus(anfrage, {
    recht: 'kalender.schreiben',
    grundVon: (f) => grundAus(f, TerminFehler),
    maskeFelder: TERMIN_MASKE,
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) throw new TerminFehler('Diesen Termin gibt es nicht.', 'nicht_gefunden');
      const aktion = rumpf.felder['aktion'] ?? '';
      if (aktion === 'absagen') {
        await sageTerminAb(kontext, id, rumpf.felder['grund'] ?? '');
        return { id, erledigt: 'abgesagt' };
      }
      if (aktion === 'aendern') {
        await aendereTermin(kontext, id, terminAusRumpf(rumpf));
        return { id, erledigt: 'geaendert' };
      }
      throw new TerminFehler('Ändern oder absagen — etwas Drittes gibt es hier nicht.',
        'fremde_art');
    },
    ziel: (slug, e) => `/portal/${slug}/kalender/${e.id}?erledigt=${e.erledigt}`,
  });
}
