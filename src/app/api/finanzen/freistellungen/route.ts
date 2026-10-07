import type { NextRequest, NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus } from '../../uebergang';
import {
  FreistellungFehler, legeFreistellungAn, verknuepfeFreistellungsbeleg, widerrufeFreistellung,
} from '@/server/services/finanz/freistellung';

/**
 * `POST /api/finanzen/freistellungen` — eine Freistellungsbescheinigung nach
 * § 48b EStG erfassen, widerrufen oder ihren Beleg verknüpfen (FIN-10,
 * LEG-06, V-283, O-604, D-845).
 *
 * **Drei Handlungen, eine Adresse, ein Recht** (`finanzen.schreiben` —
 * dasselbe, das die `WITH CHECK`-Hälfte von `freistellungsbescheinigung.
 * t_mandant` verlangt, 0118; Voreinstellung O-604, D-779). Das Gerüst ist
 * `fuehreUebergangAus`: Ursprung, genau ein aktiver Mandant (Invariante 10),
 * `authorize` in der gebundenen Transaktion, und für ein Formular die Seite
 * mit dem Grund (`?fehler=`), nie JSON (D-599).
 *
 * **Geändert und gelöscht wird hier nichts.** Eine Bescheinigung steht nach
 * dem Erfassen fest (0530); eine falsch erfasste wird widerrufen und neu
 * erfasst.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus<{ readonly aktion: 'angelegt' | 'widerrufen' | 'beleg' }>(
    anfrage, {
      recht: 'finanzen.schreiben',
      handle: async (kontext, r) => {
        const f = r.felder;
        const aktion = f['aktion'] ?? '';
        if (aktion === 'anlegen') {
          const traeger = f['traeger'] ?? '';
          await legeFreistellungAn(kontext, {
            traeger,
            // Die eigene Bescheinigung hat keinen Träger; die eines Lieferanten seinen.
            traegerId: (traeger === 'lieferant' ? f['lieferant_id']
              : traeger === 'kunde' ? f['kunde_id'] : '') ?? '',
            nummer: f['nummer'] ?? '',
            finanzamt: f['finanzamt'] ?? '',
            gueltigVon: f['gueltig_von'] ?? '',
            gueltigBis: f['gueltig_bis'] ?? '',
            umfang: f['umfang'] ?? '',
            auftragId: f['auftrag_id'] ?? null,
            dokumentId: f['dokument_id'] ?? null,
          });
          return { aktion: 'angelegt' };
        }
        if (aktion === 'widerrufen') {
          await widerrufeFreistellung(kontext, f['id'] ?? '', f['ab'] ?? '');
          return { aktion: 'widerrufen' };
        }
        if (aktion === 'beleg') {
          await verknuepfeFreistellungsbeleg(kontext, f['id'] ?? '', f['dokument_id'] ?? '');
          return { aktion: 'beleg' };
        }
        throw new FreistellungFehler('nicht_gefunden', 'Diese Handlung gibt es nicht.');
      },
      ziel: (slug, e) => `/portal/${slug}/finanzen/freistellungen?freistellung=${e.aktion}`,
      grundVon: (fehler) => grundAus(fehler, FreistellungFehler),
      /*
       * Eine abgewiesene Erfassung zeigt, was getippt wurde (V-240) — die
       * Nummer steht auf dem Papier und will nicht zweimal abgeschrieben
       * werden. Nur Stammdaten der Bescheinigung, nichts Geheimes.
       */
      maskeFelder: ['traeger', 'kunde_id', 'lieferant_id', 'nummer', 'finanzamt',
        'gueltig_von', 'gueltig_bis', 'umfang', 'auftrag_id', 'dokument_id'],
    });
}
