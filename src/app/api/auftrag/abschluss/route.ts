import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../uebergang';
import { AbschlussFehler, schliesseAuftragAb } from '@/server/services/auftrag/abschluss';

/**
 * `POST /api/auftrag/abschluss` — der Auftrag ist fertig (OPS-05, FIN-18).
 *
 * **Warum nicht `aktion='abschliessen'` auf `/api/auftrag`.** Jene Adresse
 * steht im Manifest mit `auftrag.schreiben`; der Abschluss verlangt
 * `auftrag.abschliessen`. Das Manifest fuehrt EIN Recht je Pfad — die
 * Handlung unter eine Zeile zu haengen, die ein anderes Recht behauptet,
 * machte die Liste falsch, gegen die `tests/kern/routen.test.ts` prueft.
 *
 * Heute decken sich die Rollenmengen beider Rechte; genau deshalb faellt der
 * Unterschied im Betrieb nicht auf und muss in der Struktur stehen. Die
 * zweite Linie ist seit 0296 der Ausloeser `kern.auftrag_uebergang_pruefen`
 * und nicht `t_mandant`.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'auftrag.abschliessen',
    grundVon: (f) => grundAus(f, AbschlussFehler),
    handle: async (kontext, rumpf) => {
      const auftragId = rumpf.felder['auftragId'] ?? '';
      if (!UUID.test(auftragId)) {
        throw new AbschlussFehler('Kein Auftrag benannt', 'nicht_gefunden');
      }
      await schliesseAuftragAb(
        { abfrage: kontext.abfrage.bind(kontext) }, auftragId, {
          abnahmeAm: rumpf.felder['abnahmeAm'] ?? null,
          gewaehrleistungBis: rumpf.felder['gewaehrleistungBis'] ?? null,
          einbehaltProzent: rumpf.felder['einbehaltProzent'] ?? null,
          einbehaltBetrag: rumpf.felder['einbehaltBetrag'] ?? null,
        });
      return { auftragId };
    },
    ziel: (slug, ergebnis) => `/portal/${slug}/auftraege/${ergebnis.auftragId}`,
  });
}
