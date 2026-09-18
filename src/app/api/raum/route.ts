import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../uebergang';
import { archiviereRaum, RaumFehler, speichereRaum } from '@/server/services/raumbuch/raum';

/**
 * `POST /api/raum` — ein einzelner Raum im Raumbuch (OPS-02, OPS-03).
 *
 * Recht: `objekt.schreiben`. Hier passen Tor und Policy zusammen — `t_mandant`
 * auf `raum` verlangt im WITH CHECK genau dieses Recht. Von den sieben
 * Uebergaengen dieser Runde ist das der einzige, fuer den keine
 * Migration nachziehen musste; das steht hier, damit die Ausnahme auffaellt
 * und nicht als Nachlaessigkeit gelesen wird.
 *
 * **`objekt_id` reist mit und wird in JEDER Anweisung verglichen.** Die Seite
 * liegt unter `/objekte/[id]/raumbuch/[raumId]`, beide Segmente kommen vom
 * Klienten, und beide liegen im Zweifel im selben Mandanten — die RLS hat
 * daran also zu Recht nichts zu beanstanden. Ohne den Vergleich schriebe
 * diese Route den Raum eines anderen Objekts.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'objekt.schreiben',
    grundVon: (f) => grundAus(f, RaumFehler),
    handle: async (kontext, rumpf) => {
      const objektId = rumpf.felder['objektId'] ?? '';
      const raumId = rumpf.felder['raumId'] ?? '';
      if (!UUID.test(objektId) || !UUID.test(raumId)) {
        throw new RaumFehler('Objekt oder Raum nicht benannt', 'nicht_gefunden');
      }
      const db = { abfrage: kontext.abfrage.bind(kontext) };

      if ((rumpf.felder['aktion'] ?? '') === 'archivieren') {
        await archiviereRaum(db, objektId, raumId);
        return { objektId, raumId, archiviert: true };
      }

      const sortierung = Number.parseInt(rumpf.felder['sortierung'] ?? '0', 10);
      await speichereRaum(db, objektId, raumId, {
        raumnummer: rumpf.felder['raumnummer'] ?? null,
        bezeichnung: rumpf.felder['bezeichnung'] ?? null,
        etage: rumpf.felder['etage'] ?? null,
        nutzungsart: rumpf.felder['nutzungsart'] ?? null,
        /** Pflicht — der Dienst weist eine fehlende Flaeche benannt ab. */
        flaecheQm: rumpf.felder['flaecheQm'] ?? '',
        fensterFlaecheQm: rumpf.felder['fensterFlaecheQm'] ?? null,
        belagsartId: rumpf.felder['belagsartId'] ?? null,
        reinigungsklasseId: rumpf.felder['reinigungsklasseId'] ?? null,
        /* Kein `bemerkung`: die Spalte ist `cse_app` entzogen (0021). */
        sortierung: Number.isFinite(sortierung) ? sortierung : 0,
      });
      return { objektId, raumId, archiviert: false };
    },
    /**
     * Nach dem Archivieren fuehrt der Weg auf die LISTE, nicht auf das Blatt:
     * das Blatt eines archivierten Raums zeigt nur noch, dass er archiviert
     * ist — und wer gerade archiviert hat, weiss das.
     */
    ziel: (slug, e) => (e.archiviert
      ? `/portal/${slug}/objekte/${e.objektId}/raumbuch`
      : `/portal/${slug}/objekte/${e.objektId}/raumbuch/${e.raumId}`),
  });
}
