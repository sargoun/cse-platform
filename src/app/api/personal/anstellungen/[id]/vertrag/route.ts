import { NextResponse, type NextRequest } from 'next/server';
import { aendereVertrag } from '@/server/services/personal/anstellung';
import { fuehrePersonalAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/personal/anstellungen/[id]/vertrag` — Personalnummer und
 * Eintritt (D-09, EMP-04, §5.12.1).
 *
 * **Zwei Felder und nicht vier.** Arbeitszeitmodell und Wochenstunden sind
 * nach 01-KERN §6.14 ein abgeleiteter Spiegel der datierten
 * `anstellung_kondition` und laufen ueber `…/entgelt` mit dem strengeren Recht
 * `personal.entgelt_schreiben`; `cse_app` hat auf diesen Spalten kein UPDATE
 * (0191). Das Austrittsdatum gehoert `…/beenden` — eine Spalte, ein
 * Schreiber.
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
    recht: 'personal.schreiben',
    handle: async (kontext, rumpf) => {
      await aendereVertrag(kontext, {
        anstellungId: id,
        personalnummer: rumpf.felder['personalnummer'] ?? '',
        eintritt: rumpf.felder['eintritt'] ?? '',
      });
    },
    ziel: (slug) => `/portal/${slug}/personal/anstellungen/${id}`,
  });
}
