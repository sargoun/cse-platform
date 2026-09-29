import { type NextRequest, type NextResponse } from 'next/server';
import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import { schlageKandidatVor } from '@/server/services/recruiting/kandidat';
import { kiGrund } from '@/server/services/recruiting/stellenentwurf';
import { fuehreRecruitingAus } from '../../../../gemeinsam';
import { UUID } from '../../../../../rumpf';

/**
 * `POST /api/recruiting/bewerbungen/[id]/kandidat/vorschlag` — den
 * Back-office-Agenten die Angaben einer Bewerbung auslesen lassen (REC-04,
 * V-223, D-717).
 *
 * **Zwei Rechte:** `recruiting.bewerbung_bewerten` (wie Erfassen und
 * Bestätigen, `…/kandidat`) und `agent.aufgabe_starten` (der Lauf) — dieselbe Schranke wie
 * `POST /api/agenten/lauf` und `t_mandant` auf `agent_aufgabe`.
 *
 * **Das Ergebnis gilt nicht** (Invariante 6 und 7): es steht als
 * `quelle_art = 'agent'` UNBESTÄTIGT da, bis ein Mensch es bestätigt. Ohne
 * freigegebenes Modell, ohne Budget oder mit einer Antwort, die kein
 * Datensatz ist, entsteht nichts — die Aufgabe steht mit ihrem Grund im
 * Agentenzentrum, und die Seite sagt es.
 */
export const dynamic = 'force-dynamic';

function codeVersion(): string {
  return process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['CSE_CODE_VERSION'] ?? 'entwicklung';
}

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.bewerbung_bewerten',
    weitereRechte: ['agent.aufgabe_starten'],
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Diese Bewerbung gibt es nicht.', 'unbekannt', 404);
      }
      const schluessel = (rumpf.felder['schluessel'] ?? '')
        .replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 64);
      if (schluessel === '') {
        throw new RecruitingFehler('Das Formular trug keinen Schlüssel — bitte neu laden.',
          'kein_schluessel', 400);
      }
      const e = await schlageKandidatVor(kontext, id, { schluessel, codeVersion: codeVersion() });
      if (e.art === 'gestoert') {
        return {
          ergebnis: '',
          fehler: {
            grund: e.code === 'UNBRAUCHBAR' ? 'ki_unbrauchbar' : kiGrund(e.code),
            meldung: e.nachricht,
            status: 409,
          },
        };
      }
      return 'vorgeschlagen';
    },
    ziel: (slug, erledigt) =>
      `/portal/${slug}/recruiting/bewerbungen/${id}?kandidat=${erledigt}`,
  });
}
