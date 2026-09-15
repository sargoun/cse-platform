import { type NextRequest, type NextResponse } from 'next/server';
import { SocialFehler, plane } from '@/server/services/social/dienst';
import { berlinInstant, istKalendertag } from '@/server/services/zeit/dauer';
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

export interface EingabeFehler { readonly grund: string; readonly satz: string }

/** `2026-04-01T09:00` (Berliner Ortszeit) als Instant — oder der Grund. */
export function planEingabe(wert: string): Date | EingabeFehler {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(wert.trim());
  if (treffer === null) {
    return {
      grund: 'zeitpunkt_unlesbar',
      satz: 'Der Zeitpunkt ist keiner. Erwartet werden Datum und Uhrzeit in Berliner Zeit.',
    };
  }
  const [, j, mo, t, st, mi] = treffer;
  const jahr = Number(j);
  const monat = Number(mo);
  const tag = Number(t);
  const stunde = Number(st);
  const minute = Number(mi);
  /*
   * **Die Form zu pruefen genuegt nicht.** `2026-02-30` hat sie, und
   * `Date.UTC` rutscht stillschweigend auf den 2. Maerz weiter -- der Beitrag
   * ginge an einem Tag hinaus, den niemand gewaehlt hat. Dieselbe Pruefung
   * wie in `berlinTagesZeitpunkt`.
   */
  if (!istKalendertag(jahr, monat, tag)) {
    return { grund: 'kein_kalendertag', satz: `Diesen Tag gibt es nicht: ${wert.trim()}.` };
  }
  if (stunde > 23 || minute > 59) {
    return { grund: 'keine_uhrzeit', satz: `Diese Uhrzeit gibt es nicht: ${wert.trim()}.` };
  }
  return berlinInstant(jahr, monat, tag, stunde, minute);
}

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
