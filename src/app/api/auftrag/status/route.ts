import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../uebergang';
import {
  AuftragsstatusFehler, setzeAuftragsstatus,
} from '@/server/services/auftrag/status';

/**
 * `POST /api/auftrag/status` — der Auftrag läuft, ruht oder ist storniert
 * (V-081, OPS-05).
 *
 * **Warum nicht `/api/auftrag` mit einem Feld mehr.** Jene Adresse ist der
 * Auftragsassistent: sie liest ein Dutzend Felder, zieht eine Nummer und
 * antwortet mit JSON. Ein Zustandswechsel ist etwas anderes — ein Übergang,
 * der zurück auf die Seite gehört, von der er kam (D-562). Das Gerüst
 * `fuehreUebergangAus` tut genau das, und es tut es für die Nachbarn
 * (`abschluss`, `kundenfreigabe`) schon.
 *
 * **`auftrag.schreiben` und ausdrücklich NICHT `auftrag.abschliessen`.** Ein
 * Auftrag zu pausieren oder zu stornieren ist Auftragspflege; ihn
 * abzuschliessen ist der Vorgang, der nach D-366 die FIN-18-Warnung im
 * Rechnungsweg scharf stellt und deshalb sein eigenes Recht trägt (`0296`).
 * `abgeschlossen` ist hier gar nicht wählbar — der Dienst weist den Wert ab,
 * bevor er die Datenbank sieht.
 *
 * **Die zweite Linie ist der Auslöser**, nicht `t_mandant`:
 * `kern.auftrag_status_pruefen` (`0389`) trägt die Tabelle der erlaubten Wege
 * und hält `storniert` einwegig — auch gegen einen Aufrufer, der diesen
 * Handler nie gesehen hat.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'auftrag.schreiben',
    grundVon: (f) => grundAus(f, AuftragsstatusFehler),
    handle: async (kontext, rumpf) => {
      const auftragId = rumpf.felder['auftragId'] ?? '';
      if (!UUID.test(auftragId)) {
        throw new AuftragsstatusFehler('Kein Auftrag benannt', 'nicht_gefunden', 404);
      }
      await setzeAuftragsstatus(
        kontext, auftragId,
        rumpf.felder['zustand'] ?? '',
        rumpf.felder['grund'] ?? '');
      return { auftragId };
    },
    ziel: (slug, ergebnis) => `/portal/${slug}/auftraege/${ergebnis.auftragId}`,
  });
}
