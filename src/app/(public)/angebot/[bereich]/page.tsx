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
   * **Die Abweisung kommt aus der Adresse, weil das Formular kein JavaScript
   * hat.** Schlaegt die Annahme fehl, schickt `/api/anfrage` den Browser
   * hierher zurueck. Vorher antwortete sie mit JSON, und der Besucher sah
   * `{"ok":false,…}` statt seines Formulars.
   *
   * **Es reisen nur SCHLUESSEL** (`?fehler=<grund>&felder=<k1,k2,…>`, D-769):
   * `Angebot.tsx` schlaegt den Sammelsatz nach und nimmt die Meldung je Feld
   * aus derselben Formulardefinition, die es ohnehin laedt — es gibt keine
   * zweite Liste, die auseinanderlaufen koennte. Bis D-769 reiste der Text
   * selbst, und jeder praeparierte Link schrieb seinen eigenen.
   */
  return AngebotSeiteFuer(bereich, undefined, await searchParams);
}
