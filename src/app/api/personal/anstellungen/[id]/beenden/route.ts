import { NextResponse, type NextRequest } from 'next/server';
import { beendeAnstellung } from '@/server/services/personal/anstellung';
import { fuehrePersonalAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/personal/anstellungen/[id]/beenden` — Austritt und Grund
 * (D-09, K-14, R-08, 05-API-KARTE §C.8).
 *
 * **Nie ein DELETE** (Invariante 8): Zeit-, Konto- und Rechnungsdaten haengen
 * an dieser Zeile. Gesetzt werden `austritt` und `austritt_grund`; `status`
 * folgt dem Kalender, und am Statuswechsel haengt der K-14-Entzug der
 * abgeleiteten Mitgliedschaft — eine erteilte Rolle ueberlebt ihn.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await kontextParam.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  return fuehrePersonalAus(anfrage, {
    recht: 'personal.anstellung_beenden',
    handle: async (kontext, rumpf) => {
      await beendeAnstellung(kontext, {
        anstellungId: id,
        austritt: (rumpf.felder['austritt'] ?? '').trim(),
        grund: rumpf.felder['grund'] ?? '',
      });
    },
    ziel: (slug) => `/portal/${slug}/personal/anstellungen/${id}`,
  });
}
