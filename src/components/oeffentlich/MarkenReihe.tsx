import { BereichsAvatar } from '@/components/ui/AreaBadge';
import { mitSprache, type Sprache } from '@/lib/sprache';
import type { ShellBereich } from './OeffentlicheShell';

/**
 * Die runde Markenreihe UNTER DEM HERO (PUB-14, DESIGN §6).
 *
 * **Warum sie umgezogen ist.** Sie stand im Fussbereich, der Test hiess
 * woertlich „die Markenavatar-Reihe steht im Fussbereich" — und DESIGN §6
 * schreibt seit jeher: „Public site uses the same circular-avatar row — four
 * brand avatars UNDER THE HERO, tapping one opens that company's profile."
 * Code, Test und Testname waren sich einig und lagen gemeinsam daneben:
 * wieder eine Pruefung, die denselben Irrtum traegt wie der Code und deshalb
 * gruen ist.
 *
 * Der Unterschied ist kein Geschmack. Unter dem Hero ist die Reihe das erste,
 * was jemand nach der Ueberschrift sieht — vier Gesellschaften, vier Farben,
 * ein Tippen zum Profil. Im Fussbereich ist sie eine Linkliste unter der
 * Anschrift, die niemand scrollt.
 *
 * **Sie ersetzt den Fussbereich nicht, sie entlastet ihn.** Unten stehen die
 * Gesellschaften weiterhin — als Textlinks neben ihrer Anschrift, mit eigener
 * Beschriftung. Zwei `nav` mit demselben zugaenglichen Namen waeren ein
 * mehrdeutiges Landmark und im strikten Modus ein Locator-Verstoss; das hat
 * dieser Zweig beim Telefonmenue schon einmal gekostet.
 */
export function MarkenReihe(
  { bereiche, aktiv, sprache, beschriftung }: {
    readonly bereiche: readonly ShellBereich[];
    readonly aktiv: string | null;
    readonly sprache: Sprache;
    readonly beschriftung: string;
  },
) {
  if (bereiche.length === 0) return null;
  return (
    <nav
      aria-label={beschriftung}
      data-cse="marken-reihe"
      className="mx-auto flex max-w-content flex-wrap items-center gap-s5 px-s6 pb-s5"
    >
      {bereiche.map((b) => (
        <a
          key={b.slug}
          href={mitSprache(`/unternehmen/${b.slug}`, sprache)}
          data-cse="marken-avatar"
          aria-current={b.slug === aktiv ? 'page' : undefined}
          /*
           * `min-h-11` = 44px (DESIGN §5): der Avatar allein misst 32px, und
           * ein Ziel, das man auf dem Telefon nicht trifft, ist keines.
           */
          className="flex min-h-11 items-center gap-s2 text-sm text-text-muted hover:text-text"
        >
          <BereichsAvatar bereich={b.bereich} aktiv={b.slug === aktiv} />
          {b.name}
        </a>
      ))}
    </nav>
  );
}
