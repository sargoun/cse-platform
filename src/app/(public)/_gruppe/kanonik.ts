import { mitSprache, type Sprache } from '@/lib/sprache';

/**
 * Die kanonische Adresse einer Gruppen-Detailseite (SEITENKARTE §2.2).
 *
 * **Warum das eine eigene, reine Funktion ist.** `/news/<slug>` und
 * `/unternehmen/operations/news/<slug>` zeigen dieselbe Zeile. §2.2 legt fest,
 * dass jede Meldung und jedes Projekt GENAU EINE kanonische Adresse hat, und
 * das ist die unter `/unternehmen/<bereich>/`. Ohne `rel=canonical` entstünde
 * hier die Doppelung, wegen der die kurzen Adressen einmal gelöscht worden
 * sind: zwei indexierbare Fassungen eines Textes, die sich im Suchergebnis
 * gegenseitig verdrängen.
 *
 * Als reine Funktion prüfbar — ohne Anfrage, ohne Datenbank, ohne Renderer.
 * Der Fehler, gegen den das steht, ist der stille: eine der sechs Dateien
 * (drei Segmente, zwei Sprachen) setzt `canonical` nicht, und niemand sieht es
 * ausser einer Suchmaschine.
 */
export const GRUPPEN_GESELLSCHAFT = 'operations';

export type DetailSegment = 'news' | 'projekte' | 'leistungen';

export function kanonischerDetailpfad(
  segment: DetailSegment, slug: string, sprache: Sprache,
): string {
  return mitSprache(`/unternehmen/${GRUPPEN_GESELLSCHAFT}/${segment}/${slug}`, sprache);
}
