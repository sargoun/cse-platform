import { type NextRequest, type NextResponse } from 'next/server';
import { legeStelleAn, RecruitingFehler } from '@/server/services/recruiting/dienst';
import { fuehreRecruitingAus } from '../gemeinsam';
import { leseStellenfelder } from './felder';

/**
 * `POST /api/recruiting/stellen` — einen Stellenentwurf anlegen (REC-02,
 * Invariante 7).
 *
 * **Sie entsteht IMMER als Entwurf.** Es gibt keinen Parameter, der sie
 * freigegeben oder veröffentlicht anlegt — ein solcher wäre der kürzeste Weg
 * an der Freigabe vorbei. Die Datenbank hält dieselbe Regel unabhängig
 * (`stelle_freigegeben_hat_freigabe`, 0166): ohne Freigabe-Kennung gibt es
 * den Status gar nicht.
 *
 * **Die Felder liest `leseStellenfelder`** (`./felder.ts`, V-222) — dieselbe
 * Prüfung für Stunden, Frist und Anforderungen wie beim Entwurf durch den
 * Agenten und beim Bearbeiten eines Entwurfs.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.stelle_schreiben',
    handle: async (kontext, rumpf) => {
      const f = leseStellenfelder(rumpf.felder);
      if (f.titel === '' || f.beschreibung === '') {
        throw new RecruitingFehler(
          'Eine Stelle braucht einen Titel und eine Beschreibung. Ein leerer Entwurf '
          + 'sähe in der Liste aus wie eine fertige Anzeige.',
          'unvollstaendig', 400);
      }
      return legeStelleAn(kontext, {
        titel: f.titel,
        beschreibung: f.beschreibung,
        anforderungen: f.anforderungen,
        ...(f.einsatzort === null ? {} : { einsatzort: f.einsatzort }),
        ...(f.wochenstunden === null ? {} : { wochenstunden: f.wochenstunden }),
        ...(f.bewerbungsfrist === null ? {} : { bewerbungsfrist: f.bewerbungsfrist }),
      });
    },
    ziel: (slug, id) => `/portal/${slug}/recruiting/stellen/${id}?angelegt=1`,
  });
}
