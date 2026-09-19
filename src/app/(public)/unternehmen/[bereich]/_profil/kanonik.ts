import 'server-only';
import type { Metadata } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import {
  beitragSegment, oeffentlicherBeitragNachSlug,
} from '@/server/services/social/dienst';
import { alternativen, mitSprache, OG_LOCALE, type Sprache } from '@/lib/sprache';
import { ladeBereich } from './Rahmen';

/**
 * Die Metadaten einer Beitragsdetailseite — mit der EINEN kanonischen Adresse.
 *
 * **Der Fehler, gegen den diese Datei steht.**
 * `/unternehmen/<b>/news/<slug>` und `/unternehmen/<b>/beitraege/<slug>`
 * liefern dieselbe Zeile: `oeffentlicherBeitragNachSlug` kennt keinen
 * Artenfilter, und beide Seiten setzten gar kein `canonical` — sie gaben nur
 * `{ title: daten.name }` zurueck, also nicht einmal den Titel des Beitrags.
 * Zwei indexierbare Adressen fuer einen Text sind genau die Doppelung, wegen
 * der die kurzen Gesellschaftsadressen einmal geloescht worden sind
 * (SEITENKARTE §2.2). Bemerken wuerde das niemand ausser einer Suchmaschine,
 * und die sagt es nicht.
 *
 * **Welche der beiden gewinnt, entscheidet die ART** — ueber
 * `beitragSegment()`, dieselbe Funktion, die `detailEintraege()` in der
 * Sitemap fragt. Zwei getrennte Vergleiche waeren die Stelle, an der Sitemap
 * und Seite verschiedene Adressen zur kanonischen erklaeren.
 *
 * Ein nicht vorhandener oder zurueckgezogener Beitrag bekommt hier KEINE
 * eigene Auskunft: die Seite selbst antwortet mit 404, und ein Titel, der die
 * Existenz bestaetigt, waere der Unterschied, den ein Entwurf nicht verraten
 * soll.
 */
export async function beitragsMetadaten(
  bereich: string, slug: string, sprache: Sprache,
): Promise<Metadata> {
  const nichtGefunden = sprache === 'en' ? 'Not found' : 'Nicht gefunden';
  const daten = await ladeBereich(bereich, sprache);
  if (daten === null) return { title: nichtGefunden };

  const beitrag = await oeffentlichLesen((kontext) =>
    oeffentlicherBeitragNachSlug(kontext, daten.id, slug));
  if (beitrag === null) return { title: nichtGefunden };

  const basis = await basisAusAnfrage();
  const pfad = `/unternehmen/${daten.slug}/${beitragSegment(beitrag.art)}/${slug}`;
  const url = `${basis}${mitSprache(pfad, sprache)}`;

  return {
    title: `${beitrag.titel} — ${daten.name}`,
    alternates: { canonical: url, languages: alternativen(pfad, basis) },
    openGraph: {
      title: beitrag.titel,
      url,
      locale: OG_LOCALE[sprache],
      type: 'article',
    },
  };
}
