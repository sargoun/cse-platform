import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { ladeBereich } from '@/app/(public)/unternehmen/[bereich]/_profil/Rahmen';
import type { BereichZeile } from '@/server/inhalt/lesen';
import { praefix, type Sprache } from '@/lib/sprache';
import {
  GRUPPEN_GESELLSCHAFT, kanonischerDetailpfad, type DetailSegment,
} from './kanonik';

/**
 * Die drei kurzen Gruppenadressen `/leistungen/[slug]`, `/news/[slug]` und
 * `/projekte/[slug]` — eine Hülle, eine Kanonik.
 *
 * **Warum es diese Datei gibt, und warum sie so klein ist.** Die drei Routen
 * teilen genau zwei Dinge, und beide sind leicht falsch zu machen:
 *
 *  1. **Die Gesellschaft ist fest `operations`.** `04-SEITENKARTE.md` §2.2
 *     sagt: „`/news/[slug]` exists only for items whose owning mandant is
 *     `operations`." Die Gruppenadresse trägt, was der Gruppe gehört; alles
 *     andere lebt unter `/unternehmen/<bereich>/…`. Ein `[bereich]`-Segment
 *     gibt es hier nicht, also darf es auch nicht aus dem Slug erraten werden.
 *
 *  2. **Die kanonische Adresse ist die GESELLSCHAFTSADRESSE.** Dieselbe Zeile
 *     ist unter zwei Adressen erreichbar — und §2.2 legt fest, dass jede
 *     Meldung, jedes Projekt und jede Leistung GENAU EINE kanonische Adresse
 *     hat, nämlich die unter `/unternehmen/<bereich>/`. Ohne
 *     `rel=canonical` entstünde hier genau die Doppelung, wegen der die kurzen
 *     Adressen einmal gelöscht worden sind: zwei indexierbare Fassungen eines
 *     Textes, die sich im Suchergebnis gegenseitig verdrängen.
 *
 * Eine gemeinsame Funktion und nicht drei Kopien: die dritte Kopie wäre die
 * ohne `canonical`, und das fiele erst auf, wenn es zu spät ist.
 */

export { GRUPPEN_GESELLSCHAFT } from './kanonik';

/**
 * Titel, `canonical` und `openGraph` für eine Gruppen-Detailadresse.
 *
 * `canonical` zeigt NIE auf die eigene Adresse. Das ist der ganze Sinn: die
 * Gesellschaftsadresse ist die eine Fassung, diese hier ist der kurze Weg
 * dorthin.
 */
export async function gruppenDetailMetadaten(
  { segment, slug, sprache, titel }: {
    readonly segment: DetailSegment;
    readonly slug: string;
    readonly sprache: Sprache;
    readonly titel: string | null;
  },
): Promise<Metadata> {
  if (titel === null) {
    return { title: sprache === 'en' ? 'Not found' : 'Nicht gefunden' };
  }
  const basis = await basisAusAnfrage();
  const kanonisch = `${basis}${kanonischerDetailpfad(segment, slug, sprache)}`;
  return {
    title: titel,
    alternates: { canonical: kanonisch },
    openGraph: { title: titel, url: kanonisch, type: 'article' },
  };
}

/**
 * Löst die Gruppengesellschaft auf — oder beendet die Seite mit 404.
 *
 * `notFound()` und keine leere Seite: eine leere Seite sieht aus wie „noch
 * nicht fertig" und wird indexiert.
 */
export async function gruppenGesellschaft(sprache: Sprache): Promise<BereichZeile> {
  const daten = await ladeBereich(GRUPPEN_GESELLSCHAFT, sprache);
  if (daten === null) notFound();
  return daten;
}

const ZURUECK: Readonly<Record<string, Readonly<Record<Sprache, string>>>> = {
  news: { de: 'Alle Meldungen', en: 'All news' },
  projekte: { de: 'Alle Projekte', en: 'All projects' },
  leistungen: { de: 'Alle Leistungen', en: 'All services' },
};

const TITEL: Readonly<Record<string, Readonly<Record<Sprache, string>>>> = {
  news: { de: 'Aktuelles', en: 'News' },
  projekte: { de: 'Projekte', en: 'Projects' },
  leistungen: { de: 'Leistungen', en: 'Services' },
};

/**
 * Die öffentliche Hülle einer Gruppen-Detailseite.
 *
 * **Nicht `ProfilRahmen`**: der trägt den Gesellschaftsdeckel und die
 * Reiterleiste des Profils. Auf Gruppenebene gibt es beides nicht — es gibt
 * keine Gesellschaft, deren Reiter man anzeigen könnte. Die Maße sind
 * dieselben wie dort (`max-w-content`, `px-s4`, `py-s6`), damit die Seite wie
 * ihre Nachbarin aussieht.
 *
 * **Der Hinweis auf die kanonische Adresse steht auch SICHTBAR**, nicht nur
 * im `<head>`: wer über eine Suchmaschine hier landet, soll erfahren, zu
 * welcher Gesellschaft der Text gehört. Ein `canonical`, das nur eine
 * Maschine liest, lässt den Menschen im Unklaren.
 */
export function GruppenDetailRahmen(
  { segment, slug, sprache, gesellschaft, children }: {
    readonly segment: DetailSegment;
    readonly slug: string;
    readonly sprache: Sprache;
    readonly gesellschaft: BereichZeile;
    readonly children: ReactNode;
  },
) {
  const p = praefix(sprache);
  return (
    <main className="mx-auto w-full max-w-content px-s4 py-s6" data-cse="gruppen-detail">
      <p className="m-0 text-sm text-text-muted">
        <a
          href={`${p}/${segment}`}
          data-cse="gruppen-liste"
          className="text-text-muted underline hover:text-text"
        >
          {ZURUECK[segment]?.[sprache] ?? segment}
        </a>
      </p>
      <h1 className="mb-s2 mt-s2 text-h1 text-text">
        {TITEL[segment]?.[sprache] ?? segment}
      </h1>

      {children}

      <p className="mt-s6 text-sm text-text-muted">
        <a
          href={`${p}/unternehmen/${gesellschaft.slug}/${segment}/${slug}`}
          data-cse="kanonische-adresse"
          className="text-text-muted underline hover:text-text"
        >
          {sprache === 'en'
            ? `This page belongs to ${gesellschaft.name} — open it there`
            : `Diese Seite gehört zu ${gesellschaft.name} — dort ansehen`}
        </a>
      </p>
    </main>
  );
}
