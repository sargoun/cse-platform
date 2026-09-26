import { type NextRequest, type NextResponse } from 'next/server';
import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import { bestaetigeKandidat, erfasseKandidat } from '@/server/services/recruiting/kandidat';
import { fuehreRecruitingAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/recruiting/bewerbungen/[id]/kandidat` — die strukturierten
 * Angaben einer Bewerbung erfassen, berichtigen oder bestätigen (REC-04,
 * V-223, D-717).
 *
 * **Ein Schreibrecht, kein Leserecht** (Invariante 10). `t_kandidat_schreiben`
 * (0166) lässt in der zweiten Linie schreiben, wer `recruiting.bewerbung_lesen`
 * hält; ein Leserecht ist aber in der Gruppenansicht erreichbar und bewiese
 * dort nichts. Die erste Linie verlangt deshalb `recruiting.bewerbung_bewerten`
 * — die Arbeit an den Angaben einer Bewerberin ist Teil ihrer Bewertung, und
 * dieselben Rollen halten beide Rechte (0008).
 *
 * **Die Aktion steht im Feld `aktion`**: `erfassen` speichert UNBESTÄTIGT
 * (und nimmt eine frühere Bestätigung zurück), `bestaetigen` setzt Zeitpunkt
 * und Person. Den Vorschlag des Agenten nimmt `…/kandidat/vorschlag` an —
 * mit dem Recht, einen Agenten zu starten.
 */
export const dynamic = 'force-dynamic';

function zeilen(roh: string | undefined): string[] {
  return (roh ?? '').split('\n').map((z) => z.trim()).filter((z) => z !== '');
}

/** Ganze Jahre oder leer — leer heisst „nicht bekannt", nie „null Jahre". */
function jahre(roh: string | undefined): number | null {
  const t = (roh ?? '').trim();
  if (t === '') return null;
  if (!/^\d{1,2}$/u.test(t)) {
    throw new RecruitingFehler(
      'Erfahrungsjahre als ganze Zahl zwischen 0 und 60 — oder leer.', 'unbrauchbare_jahre', 400);
  }
  return Number(t);
}

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.bewerbung_bewerten',
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Diese Bewerbung gibt es nicht.', 'unbekannt', 404);
      }
      const aktion = rumpf.felder['aktion'] ?? '';
      if (aktion === 'erfassen') {
        await erfasseKandidat(kontext, id, {
          qualifikationen: zeilen(rumpf.felder['qualifikationen']),
          sprachen: zeilen(rumpf.felder['sprachen']),
          erfahrungJahre: jahre(rumpf.felder['erfahrung_jahre']),
          notiz: rumpf.felder['notiz'] ?? null,
        });
        return 'erfasst';
      }
      if (aktion === 'bestaetigen') {
        await bestaetigeKandidat(kontext, id);
        return 'bestaetigt';
      }
      throw new RecruitingFehler('Erfassen oder bestätigen — etwas Drittes gibt es hier nicht.',
        'unbekannte_aktion', 400);
    },
    ziel: (slug, erledigt) =>
      `/portal/${slug}/recruiting/bewerbungen/${id}?kandidat=${erledigt}`,
  });
}
