import type { NextRequest, NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID, type Rumpf } from '../../uebergang';
import {
  aendereGewerk, archiviereGewerk, GewerkFehler, legeGewerkAn, type GewerkEingabe,
} from '@/server/services/bau/gewerk';

/**
 * `POST /api/bau/gewerke` — ein Gewerk eintragen, ändern oder archivieren
 * (BAU-07 „Mannstunden per trade", V-182).
 *
 * **Warum diese Route fehlte und was daran teuer war.** Jede Mannstundenzeile
 * des Bautagebuchs verlangt ein Gewerk (`gewerk_id` NOT NULL), der Katalog
 * wird leer ausgeliefert (O-159), und nur der Seed füllte ihn. In jedem echten
 * Bau-Mandanten blieb die Kernangabe des Bautagebuchs unerfassbar.
 *
 * **Drei Handlungen, eine Adresse, ein Recht** (`bau.schreiben` — dasselbe,
 * das die `WITH CHECK`-Hälfte von `gewerk.t_mandant` verlangt, 0082). Das
 * Gerüst ist `fuehreUebergangAus`: Ursprung, genau ein aktiver Mandant
 * (Invariante 10), `authorize` in der gebundenen Transaktion,
 * `autorisierungsAntwort` für einen Auth-Wurf, und für ein Formular eine
 * Seite mit dem Grund (`?fehler=`), nie JSON (D-599).
 *
 * **Gelöscht wird nie** — archiviert (`trg_gewerk_kein_hard_delete`). Der Code
 * eines Gewerks ändert sich nicht (siehe `services/bau/gewerk.ts`).
 */
export const dynamic = 'force-dynamic';

function eingabe(r: Rumpf): Omit<GewerkEingabe, 'code'> {
  const reihenfolge = (r.felder['sortierung'] ?? '').trim();
  return {
    bezeichnung: r.felder['bezeichnung'] ?? '',
    uebersetzungen: {
      en: r.felder['bezeichnung_en'] ?? '',
      ar: r.felder['bezeichnung_ar'] ?? '',
      tr: r.felder['bezeichnung_tr'] ?? '',
    },
    leistungsbereich: r.felder['leistungsbereich'] ?? null,
    /* Ein leeres Feld ist 0; alles andere prueft der Dienst (ganze Zahl 0 bis 999). */
    sortierung: reihenfolge === '' ? 0 : Number(reihenfolge),
    bestaetigt: r.felder['bestaetigt'] === 'ja',
  };
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus<{ readonly aktion: 'angelegt' | 'geaendert' | 'archiviert' }>(
    anfrage, {
      recht: 'bau.schreiben',
      handle: async (kontext, r) => {
        const aktion = r.felder['aktion'] ?? 'anlegen';
        if (aktion === 'anlegen') {
          await legeGewerkAn(kontext, { ...eingabe(r), code: r.felder['code'] ?? '' });
          return { aktion: 'angelegt' };
        }
        const id = r.felder['id'] ?? '';
        if (!UUID.test(id)) {
          throw new GewerkFehler('nicht_gefunden', 'Dieses Gewerk gibt es hier nicht.');
        }
        if (aktion === 'archivieren') {
          await archiviereGewerk(kontext, id);
          return { aktion: 'archiviert' };
        }
        if (aktion === 'aendern') {
          await aendereGewerk(kontext, id, eingabe(r));
          return { aktion: 'geaendert' };
        }
        throw new GewerkFehler('unvollstaendig', 'Diese Handlung gibt es nicht.');
      },
      ziel: (slug, e) => `/portal/${slug}/bau/gewerke?gewerk=${e.aktion}`,
      grundVon: (fehler) => grundAus(fehler, GewerkFehler),
    });
}
