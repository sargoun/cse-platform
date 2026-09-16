import { type NextRequest, type NextResponse } from 'next/server';
import { entscheide, RecruitingFehler } from '@/server/services/recruiting/dienst';
import { fuehreRecruitingAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/recruiting/bewerbungen/[id]/entscheidung` — die Entscheidung
 * (REC-08, LEG-12, Art. 22 DSGVO).
 *
 * **Diese Route ist der einzige Weg, auf dem eine Bewerbung angenommen oder
 * abgelehnt wird — und sie verlangt einen benannten Menschen.**
 *
 * Der Riegel steht nicht hier, sondern in der Datenbank: der Auslöser
 * `kern.entscheidung_ist_menschlich` (0166) weist jede Zeile ab, deren
 * `app.akteur_typ` nicht `mensch` ist, mit `insufficient_privilege`. Ein
 * Agent, der diese Route aufriefe, bekäme also keine höfliche Fehlermeldung,
 * sondern eine Abweisung — und zwar auch dann, wenn jemand diesen Handler
 * später umschreibt. Genau dafür liegt die Regel dort und nicht hier.
 *
 * **Es gibt keinen Stapelweg.** Kein Parameter nimmt mehrere Kennungen
 * entgegen: „alle unter 5 Punkten ablehnen" wäre eine Entscheidung allein
 * aufgrund automatisierter Verarbeitung, und genau die verbietet Art. 22.
 */
export const dynamic = 'force-dynamic';

const ERGEBNISSE = new Set(['eingestellt', 'abgelehnt']);

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.entscheiden',
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Diese Bewerbung gibt es nicht.', 'nicht_gefunden', 404);
      }
      const ergebnis = (rumpf.felder['ergebnis'] ?? '').trim();
      if (!ERGEBNISSE.has(ergebnis)) {
        throw new RecruitingFehler(
          'Eingestellt oder abgelehnt — etwas Drittes gibt es hier nicht.',
          'unbrauchbares_ergebnis', 400);
      }
      const begruendung = (rumpf.felder['begruendung'] ?? '').trim();
      if (begruendung === '') {
        throw new RecruitingFehler(
          'Eine Entscheidung ohne Begründung ist im AGG-Streit nichts wert.',
          'ohne_begruendung', 400);
      }
      return entscheide(
        kontext, id, ergebnis as 'eingestellt' | 'abgelehnt', begruendung);
    },
    ziel: (slug) => `/portal/${slug}/recruiting/bewerbungen/${id}?entschieden=1`,
  });
}
