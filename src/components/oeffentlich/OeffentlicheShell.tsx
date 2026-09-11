import { BereichsAvatar } from '@/components/ui/AreaBadge';
import type { BereichSchluessel } from '@/lib/design/theme';
import { shellTexte } from '@/lib/i18n/texte';
import { EIGENNAME, SPRACHEN, mitSprache, type Sprache } from '@/lib/sprache';

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
const RECHTLICH = [
  ['/impressum', 'impressum'],
  ['/datenschutz', 'datenschutz'],
  ['/barrierefreiheit', 'barrierefreiheit'],
] as const;

/** Die Punkte der Kopfnavigation — Pfad und Schlüssel, Beschriftung je Sprache. */
const HAUPT = [
  ['/unternehmen', 'unternehmen'],
  ['/leistungen', 'leistungen'],
  ['/projekte', 'projekte'],
  ['/kontakt', 'kontakt'],
] as const;

export interface OeffentlicheShellProps {
  readonly bereiche: readonly ShellBereich[];
  readonly aktiv?: string;
  /** Der Auftrittsname der Gruppe — aus `plattform_einstellung`, nicht als Literal. */
  readonly gruppeName: string;
  readonly sprache: Sprache;
  /**
   * Der Inhaltspfad OHNE Sprachpräfix — den die Sprachwahl umschaltet.
   *
   * Sie muss auf DIESELBE Seite in der anderen Sprache zeigen, nicht auf die
   * Startseite. Wer auf einer Leistungsseite die Sprache wechselt und dabei
   * seinen Platz verliert, wechselt sie kein zweites Mal.
   */
  readonly pfad: string;
  /**
   * Wohin „Anmelden" fuehrt — oder `null`, wenn es diesen Weg noch nicht gibt.
   *
   * **Warum als Eigenschaft und nicht als Literal.** Die echte Anmeldung
   * (Telefon + Einmalcode) ist PR 20 und noch nicht gebaut; bis dahin gibt es
   * nur `/dev/anmelden`, und das steht hinter `CSE_DEV_FLAECHEN`. Ein festes
   * Ziel hier waere in einem Produktionsbau ein Verweis ins Leere — also
   * entscheidet die Huelle nichts, sondern bekommt den Pfad von der Schicht,
   * die die Umgebung kennt. Ist er `null`, steht der Punkt gar nicht da:
   * lieber kein Knopf als einer, der auf 404 fuehrt.
   */
  readonly anmeldePfad?: string | null;
  readonly children: React.ReactNode;
}

export function OeffentlicheShell(
  { bereiche, aktiv, gruppeName, sprache, pfad, anmeldePfad = null, children }:
  OeffentlicheShellProps,
) {
  const t = shellTexte(sprache);
  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <header
        data-cse="oeffentlicher-kopf"
        className="sticky top-0 z-40 flex h-[72px] items-center gap-s5 border-b border-line
                   bg-surface/80 px-s5 backdrop-blur"
      >
        <a
          href={mitSprache('/', sprache)}
          aria-label={t.zurStartseite}
          className="text-h3 text-text"
        >
          {gruppeName}
        </a>
        <nav aria-label={t.hauptnavigation} className="ml-auto hidden gap-s4 md:flex">
          {HAUPT.map(([ziel, schluessel]) => (
            <a
              key={schluessel}
              href={mitSprache(ziel, sprache)}
              className="text-sm text-text-muted hover:text-text"
            >
              {t.navigation[schluessel]}
            </a>
          ))}
        </nav>

        {/*
          * Der Weg ins Portal — und er ist NICHT hinter `md:` versteckt.
          *
          * Die Hauptnavigation ist es (`hidden md:flex`), und das ist dort
          * richtig: sie fuehrt zu Lesestoff. Dieser Punkt fuehrt zur Arbeit.
          * Wer ihn braucht, steht mit einem Telefon im Treppenhaus, nicht mit
          * einem Bildschirm am Schreibtisch — auf genau dem Geraet also,
          * auf dem er sonst fehlte.
          *
          * `min-h-11` sind 44px: DESIGN §8 nennt das Tap-Ziel nicht als
          * Richtwert, sondern als Untergrenze.
          */}
        {anmeldePfad !== null && (
          <a
            href={anmeldePfad}
            data-cse="anmelden"
            className="ml-auto flex min-h-11 items-center rounded-sm border border-line
                       px-s4 text-sm text-text hover:bg-surface-2 md:ml-s4"
          >
            {t.anmelden}
          </a>
        )}

        {/*
          * Die Sprachwahl: zwei Verweise, kein Auswahlfeld.
          *
          * Ein `<select>`, das beim Ändern navigiert, ist für Tastatur und
          * Screenreader eine Falle — die Pfeiltaste löst den Wechsel aus, bevor
          * jemand die Auswahl bestätigt hat. Zwei Links tun genau das, wonach
          * sie aussehen, und `hreflang` sagt der Maschine, was sie sind.
          */}
        <nav
          aria-label={t.sprachwahl}
          data-cse="sprachwahl"
          className="ml-s4 flex items-center gap-s2"
        >
          {SPRACHEN.map((s) => (
            <a
              key={s}
              href={mitSprache(pfad, s)}
              hrefLang={s}
              lang={s}
              data-sprache={s}
              aria-current={s === sprache ? 'true' : undefined}
              aria-label={EIGENNAME[s]}
              className={`rounded-sm px-s2 py-s1 text-sm ${
                s === sprache ? 'text-text' : 'text-text-muted hover:text-text'}`}
            >
              {/*
                * Auf dem Telefon das Kürzel, ab `sm` der Eigenname.
                *
                * Nicht Geschmack, sondern Arithmetik: bei 375px stehen im Kopf
                * der Auftrittsname, „Anmelden" und zwei Sprachen nebeneinander,
                * und „Deutsch English" ausgeschrieben schob die Zeile über den
                * Rand — `documentElement.scrollWidth > clientWidth`, also
                * waagerechtes Scrollen auf JEDER öffentlichen Seite. Der
                * zugängliche Name bleibt der ausgeschriebene: `aria-label`
                * gewinnt gegen den Textinhalt, und `hreflang`/`lang` stehen
                * ohnehin daneben. Eine Maschine liest weiter „Deutsch".
                */}
              <span className="sm:hidden">{s.toUpperCase()}</span>
              <span className="hidden sm:inline">{EIGENNAME[s]}</span>
            </a>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      {/* PUB-14: dieselbe runde Avatarreihe wie im Portal, oeffentliche Absicht. */}
      <footer className="border-t border-line bg-surface px-s5 py-s6">
        <nav aria-label={t.bereicheNav} className="flex flex-wrap gap-s5">
          {bereiche.map((b) => (
            <a
              key={b.slug}
              href={mitSprache(`/unternehmen/${b.slug}`, sprache)}
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

        <nav aria-label={t.rechtlichesNav} className="mt-s5 flex flex-wrap gap-s4">
          {RECHTLICH.map(([ziel, schluessel]) => (
            <a
              key={schluessel}
              href={mitSprache(ziel, sprache)}
              className="text-xs text-text-muted hover:text-text"
            >
              {t.rechtlich[schluessel]}
            </a>
          ))}
        </nav>

        {/*
          * §5 TMG und DSGVO Art. 13 verlangen die Pflichtangaben auf Deutsch.
          * Die englische Fassung ist eine Lesehilfe — und sagt das, statt es
          * offenzulassen.
          */}
        {t.rechtsverbindlichHinweis !== '' && (
          <p data-cse="rechtshinweis" className="mt-s4 text-xs text-text-subtle">
            {t.rechtsverbindlichHinweis}
          </p>
        )}
      </footer>
    </div>
  );
}
