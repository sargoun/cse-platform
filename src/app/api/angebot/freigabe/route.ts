import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../uebergang';
import { AngebotFehler, gibPreisFrei } from '@/server/services/angebot/index';

/**
 * `POST /api/angebot/freigabe` — die Preisfreigabe (OPS-08, Invariante 7).
 *
 * **Warum eine EIGENE Adresse und nicht eine vierte Aktion auf
 * `/api/angebot`.** Das Route-Manifest fuehrt genau EINEN Rechteschluessel je
 * Pfad, und `api/angebot` steht dort mit `angebot.versenden`. Eine zweite
 * Zeile fuer denselben Pfad waere kein Eintrag, sondern ein Duplikat —
 * `tests/kern/routen.test.ts` vergleicht Pfadmengen. Die Freigabe stuende
 * damit unter einer Manifestzeile, die ein ANDERES Recht behauptet, und die
 * Liste, gegen die geprueft wird, waere an dieser Stelle falsch.
 *
 * Das Recht ist `angebot.preis_freigeben` (super_admin, leitung; bindbar an
 * admin) und ausdruecklich nicht `angebot.versenden` (zusaetzlich admin): das
 * ist der Vier-Augen-Schnitt, den die Auftrennung von `versendeAngebot`
 * ueberhaupt erst wirksam macht. Zweite Linie ist der Ausloeser
 * `kern.angebot_preisfreigabe_pruefen` (0295) — nicht die Policy `t_mandant`,
 * die `angebot.schreiben` prueft und damit ein weiteres Recht.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'angebot.preis_freigeben',
    grundVon: (f) => grundAus(f, AngebotFehler),
    handle: async (kontext, rumpf) => {
      const angebotId = rumpf.felder['angebotId'] ?? '';
      if (!UUID.test(angebotId)) {
        throw new AngebotFehler('Kein Angebot benannt', 'nicht_gefunden');
      }
      const ergebnis = await gibPreisFrei(
        { abfrage: kontext.abfrage.bind(kontext) },
        angebotId,
        /**
         * Der Freigeber ist die SITZUNG, nie ein Feld aus dem Formular.
         *
         * Invariante 7 verlangt einen benannten Menschen; ein Name aus dem
         * Rumpf waere der Name, den jemand eingetippt hat.
         */
        kontext.benutzerId,
      );
      return { angebotId, nettoCent: String(ergebnis.nettoCent) };
    },
    ziel: (slug, ergebnis) => `/portal/${slug}/angebote/${ergebnis.angebotId}/versand`,
  });
}
