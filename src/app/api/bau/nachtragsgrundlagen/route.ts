import type { NextRequest, NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../uebergang';
import {
  archiviereGrundlage, bestaetigeGrundlage, NachtragGrundlageFehler, nimmGrundlageWiederAuf,
} from '@/server/services/bau/nachtrag-grundlage';

/**
 * `POST /api/bau/nachtragsgrundlagen` — eine Anspruchsgrundlage bestätigen,
 * archivieren oder wieder aufnehmen (BAU-04, K-17, V-384, O-23, D-842).
 *
 * **Drei Handlungen, eine Adresse, ein Recht** (`bau.schreiben` — dasselbe,
 * das die `WITH CHECK`-Hälfte von `nachtrag_grundlage.t_mandant` verlangt,
 * 0080). Das Gerüst ist `fuehreUebergangAus`: Ursprung, genau ein aktiver
 * Mandant (Invariante 10), `authorize` in der gebundenen Transaktion, und für
 * ein Formular eine Seite mit dem Grund (`?fehler=`), nie JSON (D-599).
 *
 * **Angelegt und gelöscht wird hier nichts.** Der Katalog ist der
 * Gesetzestext (0080); eine Grundlage, die nicht gilt, wird archiviert, und
 * die Nachträge auf ihr behalten sie.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus<{
    readonly aktion: 'bestaetigt' | 'archiviert' | 'wiederaufgenommen';
  }>(
    anfrage, {
      recht: 'bau.schreiben',
      handle: async (kontext, r) => {
        const id = r.felder['id'] ?? '';
        if (!UUID.test(id)) {
          throw new NachtragGrundlageFehler('nicht_gefunden', 'Diese Grundlage gibt es hier nicht.');
        }
        const aktion = r.felder['aktion'] ?? '';
        if (aktion === 'bestaetigen') {
          await bestaetigeGrundlage(kontext, id);
          return { aktion: 'bestaetigt' };
        }
        if (aktion === 'archivieren') {
          await archiviereGrundlage(kontext, id);
          return { aktion: 'archiviert' };
        }
        if (aktion === 'wiederaufnehmen') {
          await nimmGrundlageWiederAuf(kontext, id);
          return { aktion: 'wiederaufgenommen' };
        }
        throw new NachtragGrundlageFehler('nicht_gefunden', 'Diese Handlung gibt es nicht.');
      },
      ziel: (slug, e) => `/portal/${slug}/bau/nachtragsgrundlagen?grundlage=${e.aktion}`,
      grundVon: (fehler) => grundAus(fehler, NachtragGrundlageFehler),
    });
}
