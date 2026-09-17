import type { Metadata } from 'next';
import { AngebotSeiteFuer, angebotMetadaten } from './Angebot';

/**
 * `/angebot/[bereich]` — die deutsche Route (REQ-01).
 *
 * Formular und Metadaten stehen in `Anfrage.tsx`: aus einer `page.tsx` erlaubt
 * Next.js nur die bekannten Exporte, und die englische Route unter `en/` ruft
 * dieselbe Funktion mit `sprache="en"` auf.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  return angebotMetadaten(bereich);
}

export default async function AnfrageSeite(
  { params, searchParams }: {
    params: Promise<{ bereich: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { bereich } = await params;
  /*
   * **Die Meldung kommt aus der Adresse, weil das Formular kein JavaScript
   * hat.** Schlaegt die Annahme fehl, schickt `/api/anfrage` den Browser
   * hierher zurueck — mit dem Grund im Klartext. Vorher antwortete sie mit
   * JSON, und der Besucher sah `{"ok":false,…}` statt seines Formulars.
   *
   * Der TEXT reist mit und nicht ein Schluessel: die Meldungen entstehen in
   * der Formulardefinition (`formular_definition.felder`), und eine zweite
   * Liste hier waere eine, die auseinanderlaeuft.
   */
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : undefined;
  return AngebotSeiteFuer(bereich, undefined, meldung);
}
