import { type NextRequest, type NextResponse } from 'next/server';
import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import {
  sageGespraechAb, vermerkeGespraech, verschiebeGespraech,
} from '@/server/services/recruiting/gespraech';
import { planEingabe } from '@/server/services/zeit/formulareingabe';
import { fuehreRecruitingAus } from '../../gemeinsam';
import { UUID } from '../../../rumpf';

/**
 * `POST /api/recruiting/gespraeche/[id]` — ein geplantes Gespräch absagen,
 * verschieben oder als geführt vermerken (REC-06, CAL-01, V-220, D-714).
 *
 * **Dieselben Rechte wie beim Anlegen** (`api/recruiting/gespraeche`):
 * `recruiting.bewerbung_lesen` UND `kalender.schreiben` — ein Gespräch IST ein
 * Kalendertermin, und wer ihn nicht setzen darf, sagt ihn auch nicht ab.
 *
 * **Die Aktion steht im Feld `aktion`**, nicht in drei Adressen: alle drei
 * ändern denselben Termin, und eine unbekannte Aktion ist eine Abweisung mit
 * Satz, kein 404.
 *
 * **Nichts geht an die Bewerberin** (Invariante 7): die Route schreibt Zustand
 * und Protokoll; eine Nachricht entsteht nur als Entwurf auf der
 * Antwortseite der Bewerbung und geht durch die Freigabe.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.bewerbung_lesen',
    weitereRechte: ['kalender.schreiben'],
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Dieses Gespräch gibt es nicht.', 'unbekannt', 404);
      }
      const aktion = rumpf.felder['aktion'] ?? '';
      if (aktion === 'absagen') {
        await sageGespraechAb(kontext, id, rumpf.felder['grund'] ?? '');
        return `${id}:abgesagt`;
      }
      if (aktion === 'verschieben') {
        const gelesen = planEingabe(rumpf.felder['termin'] ?? '');
        if (!(gelesen instanceof Date)) {
          throw new RecruitingFehler(gelesen.satz, gelesen.grund, 400);
        }
        const dauerRoh = (rumpf.felder['dauer'] ?? '').trim();
        await verschiebeGespraech(kontext, id, gelesen, dauerRoh === '' ? Number.NaN
          : Number(dauerRoh));
        return `${id}:verschoben`;
      }
      if (aktion === 'vermerken') {
        await vermerkeGespraech(kontext, id);
        return `${id}:vermerkt`;
      }
      throw new RecruitingFehler(
        'Abgesagt, verschoben oder als geführt vermerkt — etwas Viertes gibt es hier nicht.',
        'unbekannte_aktion', 400);
    },
    ziel: (slug, ergebnis) => {
      const [gespraechId, erledigt] = ergebnis.split(':');
      return `/portal/${slug}/recruiting/gespraeche/${gespraechId ?? ''}?erledigt=${erledigt ?? ''}`;
    },
  });
}
