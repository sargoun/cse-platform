import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { bereicheLesen, oeffentlichLesen, type BereichZeile } from '@/server/inhalt/lesen';
import { ProfilTabs } from '@/components/oeffentlich/ProfilTabs';
import { praefix, type Sprache } from '@/lib/sprache';

/**
 * Der gemeinsame Rahmen der Profil-UNTERSEITEN (SEITENKARTE §2.2, DESIGN §4).
 *
 * **Warum es ihn gibt.** Zehn Adressen teilen sich dieselben vier Dinge: die
 * Auflösung von `[bereich]` gegen `mandant.slug`, den 404 für einen erfundenen
 * Bereich, den Deckel mit dem Gesellschaftsnamen und die Reiterleiste. Zehnmal
 * abgeschrieben wäre die neunte irgendwann eine 404-lose Seite, die jeden
 * Bereichsnamen akzeptiert — und das ist kein Schönheitsfehler, sondern eine
 * Adresse, unter der eine Suchmaschine beliebig viele leere Seiten findet.
 *
 * **Die Profilwurzel geht NICHT hier durch.** Sie rendert weiter über
 * `OeffentlicheSeite`, weil sie aus `seite`/`abschnitt` kommt — sie ist eine
 * redaktionelle Seite, die Unterseiten sind Listen aus Fachtabellen. Die
 * Reiterleiste steht trotzdem auf beiden; sie ist ein Bauteil, kein Rahmen.
 *
 * **`geloescht_am` fällt hier nicht auf.** `bereicheLesen` liest die vier
 * Gesellschaften, wie der Fussbereich sie liest; eine stillgelegte ist dort
 * schon nicht dabei, und ihre Adresse wird damit 404 — was richtig ist.
 */
export interface ProfilRahmenProps {
  readonly bereich: string;
  /** Das aktive Reitersegment — für `aria-current`. */
  readonly aktiv: string;
  readonly sprache: Sprache;
  readonly titel: string;
  /** Ein Satz unter der Überschrift, wo die Seite einen braucht. */
  readonly vorspann?: string;
  readonly children: (daten: BereichZeile) => ReactNode;
}

/** Löst `[bereich]` gegen die vier Gesellschaften auf — `null` heisst 404. */
export async function ladeBereich(
  slug: string, sprache: Sprache,
): Promise<BereichZeile | null> {
  const bereiche = await oeffentlichLesen((kontext) => bereicheLesen(kontext, sprache));
  return bereiche.find((b) => b.slug === slug) ?? null;
}

export async function ProfilRahmen(
  { bereich, aktiv, sprache, titel, vorspann, children }: ProfilRahmenProps,
) {
  const daten = await ladeBereich(bereich, sprache);
  if (daten === null) notFound();

  return (
    <main className="mx-auto w-full max-w-content px-s4 py-s6" data-cse="profil-unterseite">
      {/*
        * Der Weg zurück auf die Profilwurzel steht ÜBER der Überschrift und
        * nicht nur in der Reiterleiste: wer über eine Suchmaschine direkt auf
        * „Galerie" landet, weiss sonst nicht, zu welcher Gesellschaft sie
        * gehört, bevor er die Leiste gelesen hat.
        */}
      <p className="m-0 text-sm text-text-muted">
        <a
          href={`${praefix(sprache)}/unternehmen/${daten.slug}`}
          data-cse="profil-wurzel"
          className="text-text-muted underline hover:text-text"
        >
          {daten.name}
        </a>
      </p>
      <h1 className="mb-s2 mt-s2 text-h1 text-text">{titel}</h1>
      {vorspann !== undefined && (
        <p className="m-0 max-w-[72ch] text-base text-text-muted">{vorspann}</p>
      )}

      <ProfilTabs
        bereich={daten.slug}
        aktiv={aktiv}
        sprache={sprache}
        label={sprache === 'en' ? 'Profile sections' : 'Bereiche des Profils'}
      />

      {children(daten)}
    </main>
  );
}
