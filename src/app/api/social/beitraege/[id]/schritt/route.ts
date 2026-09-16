import { type NextRequest, type NextResponse } from 'next/server';
import {
  SocialFehler, legeVor, schrittGehen, sendeErneut, veroeffentliche,
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
  /*
   * **`erneut_senden` verlangt `social.planen`, nicht `social.schreiben`.**
   *
   * Es schickt etwas nach DRAUSSEN — an dieselben fremden Plattformen wie
   * „Jetzt veröffentlichen", und aus demselben Grund gehört es zum schärferen
   * Recht. Wer Texte schreibt, entscheidet damit nicht, wann sie hinausgehen.
   */
  erneut_senden: 'social.planen',
};

/**
 * **`planen` steht mit Absicht NICHT in dieser Tabelle.**
 *
 * Planen heisst, einen Zeitpunkt zu setzen, und ein Schritt ohne Zeitpunkt ist
 * keine Planung. Er hat deshalb eine eigene Route
 * (`/api/social/beitraege/[id]/planung`), die den Zeitpunkt entgegennimmt und
 * gegen die Serveruhr prueft (Invariante 5). Hier abgewiesen zu werden ist
 * die richtige Antwort — nicht eine Luecke.
 */

/** Der strengste Fall: was hier nicht steht, verlangt das schaerfere Recht. */
const STRENGSTES = 'social.planen';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return fuehreSocialAus(anfrage, {
    /*
     * Der Rumpf wird vom Geruest EINMAL gelesen — in beiden Formaten. Hier
     * stand vorher ein zweites Auslesen aus `formData()`, das einen
     * JSON-Aufrufer nicht sah und ihn deshalb am strengsten Recht scheitern
     * liess, auch wenn sein Schritt das mildere verlangte.
     */
    recht: (rumpf) => RECHT[rumpf.felder['schritt'] ?? ''] ?? STRENGSTES,
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
      if (gewaehlt === 'veroeffentlichen' || gewaehlt === 'erneut_senden') {
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
        if (gewaehlt === 'erneut_senden') await sendeErneut(kontext, id, adresse);
        else await veroeffentliche(kontext, id, adresse);
        return id;
      }
      await schrittGehen(kontext, id, gewaehlt as Schritt, rumpf.felder['grund'] ?? null);
      return id;
    },
    ziel: (slug, beitragId) => `/portal/${slug}/social/posts/${beitragId}?schritt=1`,
  });
}
