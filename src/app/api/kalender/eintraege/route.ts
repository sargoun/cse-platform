import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus } from '../../uebergang';
import { TerminFehler, legeTerminAn } from '@/server/services/kalender/termin';
import { TERMIN_MASKE, terminAusRumpf } from './termin-rumpf';

/**
 * `POST /api/kalender/eintraege` — einen eigenen Termin anlegen (CAL-01,
 * V-221, D-715).
 *
 * Die Adresse aus `05-API-KARTE.md` („GET/POST /api/kalender/eintraege ·
 * PATCH /[id] … manual entries"). Geändert und abgesagt wird über
 * `POST /api/kalender/eintraege/[id]` — Browserformulare kennen kein PATCH.
 *
 * Recht: `kalender.schreiben` — dasselbe, das `t_kalender_schreiben` (0160)
 * in der zweiten Linie prüft. Der Termin entsteht in der Gesellschaft der
 * SITZUNG (Invariante 3), und wer anlegt, führt ihn.
 *
 * Ein Formular bekommt seine Seite zurück (D-599, V-240): die Abweisung mit
 * Grund und den getippten Feldern auf `/kalender/neu`, der Erfolg auf dem
 * Termin selbst.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'kalender.schreiben',
    grundVon: (f) => grundAus(f, TerminFehler),
    maskeFelder: TERMIN_MASKE,
    handle: async (kontext, rumpf) => legeTerminAn(kontext, terminAusRumpf(rumpf)),
    ziel: (slug, id) => `/portal/${slug}/kalender/${id}?erledigt=angelegt`,
  });
}
