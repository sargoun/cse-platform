import { type NextRequest, type NextResponse } from 'next/server';
import {
  SocialFehler, legeVor, schrittGehen, veroeffentliche,
} from '@/server/services/social/dienst';
import { kanonischeBasis, KeinHostFehler } from '@/lib/domains';
import type { Schritt } from '@/server/services/social/weg';
import { fuehreSocialAus, UUID } from '../../../gemeinsam';

/**
 * `POST /api/social/beitraege/[id]/schritt` — ein Schritt auf dem Weg (SOC-03).
 *
 * **Jeder Schritt trägt sein eigenes Recht.** Vorlegen und Überarbeiten sind
 * Schreiben; Veröffentlichen und Zurücknehmen sind Planen — es ist die
 * Handlung, die etwas nach draussen bringt oder zurückholt. Freigeben und
 * Ablehnen stehen NICHT hier: sie fallen im Freigabe-Posteingang, und der
 * Beitrag folgt seiner Freigabe über den Trigger aus `0163`. Zwei Wege zur
 * selben Entscheidung wären einer zu viel (SOC-08).
 */
export const dynamic = 'force-dynamic';

const RECHT: Readonly<Record<string, string>> = {
  vorlegen: 'social.schreiben',
  ueberarbeiten: 'social.schreiben',
  planung_aufheben: 'social.planen',
  veroeffentlichen: 'social.planen',
  zuruecknehmen: 'social.planen',
};

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const roh = await anfrage.clone().formData().catch(() => null);
  const ausFormular = roh?.get('schritt');
  const schritt = typeof ausFormular === 'string' ? ausFormular : null;
  const recht = schritt === null ? 'social.planen' : RECHT[schritt] ?? 'social.planen';

  return fuehreSocialAus(anfrage, {
    recht,
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
      const gewaehlt = rumpf.felder['schritt'] ?? '';
      if (!(gewaehlt in RECHT)) {
        throw new SocialFehler(
          `„${gewaehlt}" ist kein Schritt, den diese Route geht. Freigeben und Ablehnen `
          + 'fallen im Freigabe-Posteingang.', 'unbekannter_schritt');
      }
      if (gewaehlt === 'vorlegen') {
        await legeVor(kontext, id);
        return id;
      }
      if (gewaehlt === 'veroeffentlichen') {
        /*
         * Die Adresse des Beitrags auf der eigenen Seite -- jede Plattform
         * will einen Link, und ein relativer waere dort dasselbe Nichts wie
         * in einer E-Mail (D-532). Fehlt der Host, geht der Beitrag trotzdem
         * hinaus: die eigene Seite braucht keinen absoluten Link.
         */
        let adresse: string | null = null;
        try {
          adresse = `${kanonischeBasis(anfrage.headers.get('host'))}/beitrag/${id}`;
        } catch (fehler) {
          if (!(fehler instanceof KeinHostFehler)) throw fehler;
        }
        await veroeffentliche(kontext, id, adresse);
        return id;
      }
      await schrittGehen(kontext, id, gewaehlt as Schritt, rumpf.felder['grund'] ?? null);
      return id;
    },
    ziel: (slug, beitragId) => `/portal/${slug}/social/posts/${beitragId}?schritt=1`,
  });
}
