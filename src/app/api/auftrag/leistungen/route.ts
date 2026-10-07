import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../uebergang';
import {
  LeistungFehler, beendeLeistungszeile, legeLeistungszeileAn,
} from '@/server/services/auftrag/leistung';

/**
 * `POST /api/auftrag/leistungen` — eine Leistungszeile anlegen oder beenden
 * (V-360, O-921, D-825).
 *
 * Zwei Vorgänge (`vorgang`): `anlegen` (eine nachträglich vereinbarte
 * Leistung, ab einem Stichtag) und `beenden` (letzter Tag, einschliesslich).
 * Das Recht ist `auftrag.schreiben` — die Policy `t_mandant` auf
 * `auftrag_leistung` (0050) verlangt dasselbe. Zurück geht es auf die
 * Leistungszeilen des Auftrags mit `?erfolg=`; eine Abweisung kommt mit
 * ihrem Grund und den Eingaben auf die Maske (`zurueck`, D-599).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'auftrag.schreiben',
    grundVon: (f) => grundAus(f, LeistungFehler),
    maskeFelder: [
      'bezeichnung', 'beschreibung', 'menge', 'einheit', 'einzelpreis', 'steuersatz', 'gueltigAb',
    ],
    handle: async (kontext, rumpf) => {
      const auftragId = rumpf.felder['auftragId'] ?? '';
      if (!UUID.test(auftragId)) throw new LeistungFehler('unbekannter_auftrag');
      const vorgang = rumpf.felder['vorgang'] ?? '';
      if (vorgang === 'anlegen') {
        await legeLeistungszeileAn(kontext, auftragId, {
          bezeichnung: rumpf.felder['bezeichnung'] ?? '',
          beschreibung: rumpf.felder['beschreibung'] ?? null,
          menge: rumpf.felder['menge'] ?? '',
          einheit: rumpf.felder['einheit'] ?? '',
          einzelpreis: rumpf.felder['einzelpreis'] ?? '',
          steuersatz: rumpf.felder['steuersatz'] ?? '',
          gueltigAb: rumpf.felder['gueltigAb'] ?? '',
        });
        return { auftragId, erfolg: 'angelegt' };
      }
      if (vorgang === 'beenden') {
        const zeileId = rumpf.felder['zeileId'] ?? '';
        if (!UUID.test(zeileId)) throw new LeistungFehler('unbekannte_zeile');
        await beendeLeistungszeile(kontext, auftragId, zeileId, rumpf.felder['gueltigBis'] ?? '');
        return { auftragId, erfolg: 'beendet' };
      }
      throw new LeistungFehler('unbekannter_vorgang');
    },
    ziel: (slug, e) => `/portal/${slug}/auftraege/${e.auftragId}/leistungen?erfolg=${e.erfolg}`,
  });
}
