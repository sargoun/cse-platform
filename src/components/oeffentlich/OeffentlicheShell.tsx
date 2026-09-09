import { BereichsAvatar } from '@/components/ui/AreaBadge';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Die oeffentliche Shell — Kopf 72px, Fussbereich, Markenavatar-Reihe (PUB-14).
 *
 * **Keine Drittanbieter.** PUB-13 verbietet Tracker, und daraus folgt: kein
 * Cookie-Banner, weil es nichts zu erlauben gibt. Diese Shell laedt deshalb
 * keine externen Schriften, keine Analytik und kein Kartenskript — der
 * Playwright-Test faengt jede Anfrage ab und zaehlt sie.
 */
export interface ShellBereich {
  readonly slug: string;
  readonly name: string;
  readonly bereich: BereichSchluessel;
  /**
   * Die eine Zeile aus `napAus()` — Firma, Strasse, PLZ und Ort.
   *
   * Sie kommt fertig formatiert herein und wird hier NICHT zusammengesetzt.
   * PUB-12 verlangt eine ueber alle Flaechen hinweg zeichengleiche Anschrift,
   * und zwei Schreibweisen derselben Adresse sind fuer eine Suchmaschine zwei
   * Unternehmen. Ein Literal im Fussbereich war genau dieser zweite Eintrag.
   */
  readonly nap: string;
}

/** §5 TMG und LEG-07: von jeder Seite aus erreichbar, nicht nur von der Startseite. */
const RECHTLICH: readonly (readonly [string, string])[] = [
  ['/impressum', 'Impressum'],
  ['/datenschutz', 'Datenschutz'],
  ['/barrierefreiheit', 'Barrierefreiheit'],
];

export interface OeffentlicheShellProps {
  readonly bereiche: readonly ShellBereich[];
  readonly aktiv?: string;
  /** Der Auftrittsname der Gruppe — aus `plattform_einstellung`, nicht als Literal. */
  readonly gruppeName: string;
  readonly children: React.ReactNode;
}

export function OeffentlicheShell(
  { bereiche, aktiv, gruppeName, children }: OeffentlicheShellProps,
) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <header
        data-cse="oeffentlicher-kopf"
        className="sticky top-0 z-40 flex h-[72px] items-center gap-s5 border-b border-border
                   bg-surface/80 px-s5 backdrop-blur"
      >
        <a href="/" className="text-h3 text-text">{gruppeName}</a>
        <nav aria-label="Hauptnavigation" className="ml-auto hidden gap-s4 md:flex">
          <a href="/unternehmen" className="text-sm text-text-muted hover:text-text">Unternehmen</a>
          <a href="/leistungen" className="text-sm text-text-muted hover:text-text">Leistungen</a>
          <a href="/projekte" className="text-sm text-text-muted hover:text-text">Projekte</a>
          <a href="/kontakt" className="text-sm text-text-muted hover:text-text">Kontakt</a>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      {/* PUB-14: dieselbe runde Avatarreihe wie im Portal, oeffentliche Absicht. */}
      <footer className="border-t border-border bg-surface px-s5 py-s6">
        <nav aria-label="Unsere Bereiche" className="flex flex-wrap gap-s5">
          {bereiche.map((b) => (
            <a
              key={b.slug}
              href={`/${b.slug}`}
              data-cse="marken-avatar"
              aria-current={b.slug === aktiv ? 'page' : undefined}
              className="flex items-center gap-s2 text-sm text-text-muted hover:text-text"
            >
              <BereichsAvatar bereich={b.bereich} aktiv={b.slug === aktiv} />
              {b.name}
            </a>
          ))}
        </nav>
        {/* Vier Gesellschaften, vier Anschriften — jede aus ihrer `mandant`-Zeile. */}
        <ul data-cse="nap" className="mt-s5 flex flex-col gap-s2 text-xs text-text-subtle">
          {bereiche.map((b) => <li key={b.slug}>{b.nap}</li>)}
        </ul>

        <nav aria-label="Rechtliches" className="mt-s5 flex flex-wrap gap-s4">
          {RECHTLICH.map(([href, text]) => (
            <a key={href} href={href} className="text-xs text-text-muted hover:text-text">
              {text}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
