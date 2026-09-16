import { type NextRequest, type NextResponse } from 'next/server';
import {
  SocialFehler, bearbeiteBeitrag, setzeKanaele,
} from '@/server/services/social/dienst';
import { fuehreSocialAus, UUID } from '../../gemeinsam';

/**
 * `POST /api/social/beitraege/[id]` — Text, Art und Kanäle eines ENTWURFS.
 *
 * Der Dienst weist jeden anderen Zustand ab (409): die Freigabe hängt am
 * Text, der vorlag, und an den Kanälen, die genannt waren.
 */
export const dynamic = 'force-dynamic';

const ARTEN = ['beitrag', 'projektschau', 'neuigkeit', 'aktualisierung'] as const;
type Art = typeof ARTEN[number];

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreSocialAus(anfrage, {
    recht: 'social.schreiben',
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
      const titel = (rumpf.felder['titel'] ?? '').trim();
      const text = (rumpf.felder['text'] ?? '').trim();
      if (titel === '' || text === '') {
        throw new SocialFehler(
          'Ein Beitrag braucht einen Titel und einen Text.', 'unvollstaendig');
      }
      const rohArt = rumpf.felder['art'] ?? 'beitrag';
      const art: Art = (ARTEN as readonly string[]).includes(rohArt) ? rohArt as Art : 'beitrag';
      await bearbeiteBeitrag(kontext, id, { titel, text, art });
      await setzeKanaele(kontext, id, rumpf.alle('kanal').filter((k) => UUID.test(k)));
      return id;
    },
    ziel: (slug, beitragId) => `/portal/${slug}/social/posts/${beitragId}?gespeichert=1`,
  });
}
