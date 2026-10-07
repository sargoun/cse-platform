import type { Metadata } from 'next';
import { bewerbungsMeldung } from '../../meldung';
import { bewerbungsBlatt } from '../../Seiten';
import { KARRIERE_TEXTE } from '../../texte';

/**
 * `/karriere/[stelle]/bewerbung` — das Formular (REC-03, REC-07, LEG-11).
 *
 * Die Aufbewahrungsfrist kommt aus der Einstellung und steht als ZAHL auf der
 * Seite. „Wir löschen nach angemessener Zeit" ist keine Angabe nach Art. 13
 * DSGVO — die Tage sind eine. Englisch unter `/en/karriere/[stelle]/bewerbung`
 * (V-393).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: KARRIERE_TEXTE.de.bewerbungMetaTitel };

export default async function BewerbungsSeite(
  { params, searchParams }: {
    params: Promise<{ stelle: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  // V-158: eine Abweisung kommt als Grund zurück, nicht als JSON.
  const meldung = bewerbungsMeldung((await searchParams)['fehler']);
  return bewerbungsBlatt('de', (await params).stelle, meldung);
}
