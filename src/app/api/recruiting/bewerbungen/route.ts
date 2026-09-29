import { type NextRequest, type NextResponse } from 'next/server';
import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import { erfasseBewerbungAusPostfach } from '@/server/services/recruiting/postfach';
import { fuehreRecruitingAus } from '../gemeinsam';
import { UUID } from '../../rumpf';

/**
 * `POST /api/recruiting/bewerbungen` — eine Bewerbung, die per E-Mail kam,
 * von Hand erfassen (REC-03, REC-07, V-224, D-718).
 *
 * **Warum von Hand.** Das Bewerbungspostfach ist nicht angeschlossen (O-938,
 * `integrationen/bewerbungspostfach.ts`); bis es das ist, überträgt ein
 * Mensch, was dort liegt. Die Bewerbung bekommt die Quelle `mail` und dieselbe
 * Löschfrist wie eine über die Karriereseite — sonst griffe REC-07 für sie
 * nicht.
 *
 * **Recht:** `recruiting.bewerbung_bewerten` — ein Schreibrecht und kein
 * Leserecht (Invariante 10: ein Leserecht ist in der Gruppenansicht
 * erreichbar); dieselben Rollen halten beide (0008). Eine Nachricht an die
 * Bewerberin entsteht hier nicht (Invariante 7).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.bewerbung_bewerten',
    handle: async (kontext, rumpf) => {
      const stelle = (rumpf.felder['stelle'] ?? '').trim();
      if (stelle !== '' && !UUID.test(stelle)) {
        throw new RecruitingFehler(
          'Diese Stelle gibt es hier nicht — oder sie ist geschlossen.', 'stelle_unbekannt', 400);
      }
      return erfasseBewerbungAusPostfach(kontext, {
        stelleId: stelle === '' ? null : stelle,
        name: rumpf.felder['name'] ?? '',
        email: rumpf.felder['email'] ?? '',
        telefon: rumpf.felder['telefon'] ?? null,
        nachricht: rumpf.felder['nachricht'] ?? null,
      });
    },
    ziel: (slug, id) => `/portal/${slug}/recruiting/bewerbungen/${id}?erfasst=1`,
  });
}
