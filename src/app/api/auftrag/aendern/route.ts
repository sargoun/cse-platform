import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../uebergang';
import { aendereAuftrag, AuftragPflegeFehler } from '@/server/services/auftrag/aendern';
import { AuftragsangabenFehler } from '@/server/services/auftrag/angaben';

/**
 * `POST /api/auftrag/aendern` — Stammdaten eines Auftrags pflegen (V-173,
 * OPS-05, OPS-10).
 *
 * **Warum nicht `/api/auftrag` mit einem Feld mehr.** Jene Adresse ist der
 * Assistent: sie zieht eine Nummer. Eine Änderung ist etwas anderes — sie
 * gehört zurück auf die Seite, von der sie kam, und das Gerüst
 * `fuehreUebergangAus` tut genau das, mit dem Bereich aus der SITZUNG und
 * der Abweisung als `?fehler=` auf der Maske (D-562, D-599).
 *
 * **`auftrag.schreiben`**, dasselbe Recht wie Anlegen und Zustand — und die
 * zweite Linie ist die UPDATE-Policy `t_mandant`, die der Dienst mit
 * `for update` vorher befragt.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'auftrag.schreiben',
    grundVon: (f) => grundAus(f, AuftragPflegeFehler, AuftragsangabenFehler),
    /* V-240: eine Abweisung bringt die Eingaben zurück, nicht den alten Stand. */
    maskeFelder: [
      'bezeichnung', 'beschreibung', 'verantwortlichBenutzerId', 'laufzeitBis',
      'auftragswertNetto', 'personalbedarfAnzahl', 'wochenstundenSoll', 'ausstattungHinweis',
    ],
    handle: async (kontext, rumpf) => {
      const auftragId = rumpf.felder['auftragId'] ?? '';
      if (!UUID.test(auftragId)) {
        throw new AuftragPflegeFehler('Kein Auftrag benannt', 'nicht_gefunden', 404);
      }
      const feld = (name: string): string | null => rumpf.felder[name] ?? null;
      await aendereAuftrag(kontext, {
        auftragId,
        bezeichnung: feld('bezeichnung') ?? '',
        beschreibung: feld('beschreibung'),
        verantwortlichBenutzerId: feld('verantwortlichBenutzerId') ?? '',
        laufzeitBis: feld('laufzeitBis'),
        auftragswertNetto: feld('auftragswertNetto'),
        personalbedarfAnzahl: feld('personalbedarfAnzahl'),
        wochenstundenSoll: feld('wochenstundenSoll'),
        ausstattungHinweis: feld('ausstattungHinweis'),
      });
      return { auftragId };
    },
    ziel: (slug, ergebnis) => `/portal/${slug}/auftraege/${ergebnis.auftragId}?gespeichert=1`,
  });
}
