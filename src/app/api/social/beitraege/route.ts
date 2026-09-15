import { type NextRequest, type NextResponse } from 'next/server';
import { SocialFehler, legeBeitragAn } from '@/server/services/social/dienst';
import { fuehreSocialAus, UUID } from '../gemeinsam';

/**
 * `POST /api/social/beitraege` — einen Entwurf anlegen (SOC-02, SOC-04).
 *
 * Er entsteht IMMER als Entwurf. Es gibt keinen Parameter, der ihn direkt
 * freigegeben oder veröffentlicht anlegt — ein solcher wäre der kürzeste Weg
 * an der Freigabe vorbei (SOC-08).
 */
export const dynamic = 'force-dynamic';

const ARTEN = ['beitrag', 'projektschau', 'neuigkeit', 'aktualisierung'] as const;
type Art = typeof ARTEN[number];

function kennung(wert: string | undefined): string | null {
  return wert !== undefined && UUID.test(wert) ? wert : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreSocialAus(anfrage, {
    recht: 'social.schreiben',
    handle: async (kontext, rumpf) => {
      const titel = (rumpf.felder['titel'] ?? '').trim();
      const text = (rumpf.felder['text'] ?? '').trim();
      if (titel === '' || text === '') {
        throw new SocialFehler(
          'Ein Beitrag braucht einen Titel und einen Text. Ein leerer Entwurf sähe im '
          + 'Posteingang aus wie ein fertiger.', 'unvollstaendig');
      }
      const rohArt = rumpf.felder['art'] ?? 'beitrag';
      const art: Art = (ARTEN as readonly string[]).includes(rohArt) ? rohArt as Art : 'beitrag';
      return legeBeitragAn(kontext, {
        titel,
        text,
        art,
        projektId: kennung(rumpf.felder['projekt_id']),
        referenzId: kennung(rumpf.felder['referenz_id']),
        kanalIds: rumpf.alle('kanal').filter((k) => UUID.test(k)),
      });
    },
    ziel: (slug, id) => `/portal/${slug}/social/posts/${id}?angelegt=1`,
  });
}
