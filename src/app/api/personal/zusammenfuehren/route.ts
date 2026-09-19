import type { NextRequest, NextResponse } from 'next/server';
import { fuehreZusammen, ZusammenfuehrenFehler } from '@/server/services/personal/dublette';
import { fuehrePersonalAus } from '../gemeinsam';
import { UUID } from '../../rumpf';

/**
 * `POST /api/personal/zusammenfuehren` — zwei `person`-Zeilen sind ein Mensch
 * (D-09, LEG-09, 01-KERN §6.13).
 *
 * **Die Kennungen stehen im RUMPF und nicht im Pfad**, weil der Vorgang zwei
 * nimmt: die veraltete Zeile und die fuehrende. Welche welche ist, entscheidet
 * ein Mensch auf der Seite — nicht eine Heuristik und nicht die Reihenfolge in
 * einer Liste.
 *
 * Recht (`personal.zusammenfuehren`), Mandant, Zyklusfreiheit und Protokoll
 * stecken in `app.person_zusammenfuehren` (0194): der Zeiger ist `cse_app`
 * nicht schreibbar, und das ist die Zusage — eine Zusammenfuehrung ist kein
 * `update` in einer Maske.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehrePersonalAus(anfrage, {
    recht: 'personal.zusammenfuehren',
    handle: async (kontext, rumpf) => {
      const dublette = (rumpf.felder['dublette'] ?? '').trim();
      const fuehrend = (rumpf.felder['fuehrend'] ?? '').trim();
      if (!UUID.test(dublette) || !UUID.test(fuehrend)) {
        throw new ZusammenfuehrenFehler(
          'Es müssen zwei Datensätze gewählt sein: der veraltete und der führende.');
      }
      await fuehreZusammen(kontext, {
        dublettePersonId: dublette,
        fuehrendPersonId: fuehrend,
        grund: rumpf.felder['grund'] ?? '',
        bestaetigung: rumpf.felder['bestaetigung'] ?? '',
      });
    },
    ziel: (slug) => `/portal/${slug}/personal/zusammenfuehren?zusammengefuehrt=1`,
  });
}
