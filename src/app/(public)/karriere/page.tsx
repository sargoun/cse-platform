import type { Metadata } from 'next';
import { bewerbungsMeldung } from './meldung';
import { karriereListe, karriereMetadaten } from './Seiten';
import { KARRIERE_TEXTE } from './texte';

/**
 * `/karriere` — die offenen Stellen der Gruppe (REC-03).
 *
 * **Vier Gesellschaften, eine Seite.** Wer Arbeit sucht, sucht Arbeit und
 * nicht eine Rechtsform: die Liste zeigt jede offene Stelle aller vier
 * Bereiche und nennt an jeder Zeile, welche Gesellschaft einstellt — die
 * Angabe zählt, weil der Arbeitsvertrag mit ihr zustande kommt (D-09).
 *
 * **Was hier NICHT steht, ist die halbe Zusage.** Ein Entwurf ist auf dieser
 * Seite null Zeilen; die Policy `t_stelle_oeffentlich` (0166) lässt
 * ausschliesslich veröffentlichte, nicht geschlossene Stellen durch. Eine
 * Anzeige, die versehentlich öffentlich wurde, holt niemand zurück.
 *
 * **Keine offene Stelle ist eine Auskunft**, kein leerer Bildschirm: die
 * Initiativbewerbung steht deshalb immer da, und nicht nur dann, wenn nichts
 * ausgeschrieben ist.
 *
 * **Der Bereichsfilter steht in der Adresse** (`?bereich=<slug>`, V-364): ein
 * Verweis je Gesellschaft, kein Skript — die Auswahl lässt sich teilen und
 * zurückblättern. Ein unbekannter Bereich zeigt alle Stellen, eine leere
 * Auswahl sagt es in einem Satz.
 *
 * **Deutsch hier, englisch unter `/en/karriere`** (V-393, D-82) — dieselbe
 * Seite aus `Seiten.tsx`, die Sätze aus `texte.ts`.
 *
 * TODO(client, O-38): Voreinstellung — eine Karriereseite der Gruppe mit
 * Bereichsfilter (SEITENKARTE); gebaut mit V-364, jede Karte nennt weiter die
 * Gesellschaft. D-797, D-806.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  const t = KARRIERE_TEXTE.de;
  return karriereMetadaten('de', '/karriere', t.metaTitel, t.metaBeschreibung);
}

export default async function KarriereSeite(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  /*
   * V-158: eine Bewerbung auf eine Stelle, die inzwischen geschlossen ist,
   * landet hier — mit einem Satz, statt `{"fehler":"nicht_gefunden"}` auf
   * weissem Grund. Das Stellenblatt selbst wäre dafür der falsche Ort: es
   * antwortet für eine geschlossene Stelle mit 404.
   */
  const meldung = bewerbungsMeldung((await searchParams)['fehler']);
  return karriereListe('de', (await searchParams)['bereich'], meldung);
}
