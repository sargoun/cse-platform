import { type NextRequest, type NextResponse } from 'next/server';
import { SocialFehler, plane } from '@/server/services/social/dienst';
import { planEingabe } from '@/server/services/social/planeingabe';
import { fuehreSocialAus, UUID } from '../../../gemeinsam';

/**
 * `POST /api/social/beitraege/[id]/planung` — einen freigegebenen Beitrag auf
 * einen Zeitpunkt legen (SOC-03).
 *
 * **Die Uhr ist die des Servers** (Invariante 5). Das Formular schickt eine
 * Berliner Ortszeit ohne Zone; sie wird hier in einen Instant übersetzt und
 * gegen `now()` AUS DER DATENBANK geprüft. Ein Gerät, dessen Uhr falsch geht,
 * plant damit nichts in die Vergangenheit.
 *
 * **Übersetzt wird mit `berlinInstant`, nicht mit `new Date(wert)`.** Ein
 * `datetime-local`-Wert trägt keine Zone; `new Date` liest ihn als Ortszeit
 * des Servers, und der läuft in UTC — aus 09:00 Berlin würden 09:00 UTC, im
 * Sommer zwei Stunden zu früh. `berlinInstant` steht seit der Zeiterfassung
 * in `zeit/dauer.ts`, ist gegen beide Umstellungsnächte geprüft und sagt
 * ausdrücklich, wohin eine Uhrzeit fällt, die es zweimal oder gar nicht gibt.
 * Eine zweite Fassung hier wäre eine zweite Wahrheit über dieselbe Zeitzone.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreSocialAus(anfrage, {
    recht: 'social.planen',
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
      const gelesen = planEingabe(rumpf.felder['zeitpunkt'] ?? '');
      if (!(gelesen instanceof Date)) {
        throw new SocialFehler(gelesen.satz, gelesen.grund);
      }
      const [jetzt] = await kontext.abfrage<{ t: Date }>(`select now() as t`);
      if (jetzt === undefined) {
        throw new SocialFehler('Die Serverzeit war nicht zu lesen.', 'keine_serverzeit');
      }
      await plane(kontext, id, gelesen, jetzt.t);
      return id;
    },
    ziel: (slug, beitragId) => `/portal/${slug}/social/posts/${beitragId}?geplant=1`,
  });
}
