import { BereichsAvatar } from '@/components/ui/AreaBadge';
import { mitSprache, type Sprache } from '@/lib/sprache';
import type { ShellBereich } from './OeffentlicheShell';

/**
 * Die Gesellschaftswahl IM KOPF (DESIGN §6, D-381).
 *
 * **Warum sie nicht mehr unter dem Hero steht.** Dort war sie gebaut, und dort
 * war sie in der Praxis falsch — aus zwei Gruenden, die ein Entwurf nicht
 * zeigen kann. Sie sass unmittelbar unter dem Kopfbild, wo die ueberlebensgrosse
 * Geisterschrift des Heros durchschlaegt; die vier Namen landeten auf dieser
 * Schrift und lasen sich als Kollision, nicht als Bedienelement. Und sie
 * verbrauchte ein ganzes Band Hoehe direkt unter der Falz, auf genau der
 * Flaeche, auf der der erste Eindruck entschieden wird.
 *
 * **Kein JavaScript.** `<details>` oeffnet ohne, genau wie das Telefonmenue
 * daneben und die Tableiste im Portal. Ein Auswahlfeld, das erst laedt, ist
 * auf einem schlechten Netz kein Auswahlfeld.
 *
 * **Auf dem Telefon steht sie nicht hier.** Der Kopf ist 72px hoch und traegt
 * dort schon den Menueknopf; ein zweites Klappelement daneben waere bei 375px
 * kein Ziel mehr, das man trifft. Die vier Gesellschaften stehen deshalb als
 * eigener Abschnitt IM Vollbildmenue — derselbe Weg, eine Ebene tiefer.
 */
export function GesellschaftsWahl(
  { bereiche, aktiv, sprache, beschriftung }: {
    readonly bereiche: readonly ShellBereich[];
    readonly aktiv: string | null;
    readonly sprache: Sprache;
    readonly beschriftung: string;
  },
) {
  /*
   * Eine Wahl mit einem einzigen Ziel ist keine Wahl (DESIGN §6 Regel 1: „one
   * area = a static logo, no chevron, no dropdown"). Dass es heute vier
   * Gesellschaften sind, steht in der Datenbank und nicht hier.
   */
  if (bereiche.length < 2) return null;

  const hier = bereiche.find((b) => b.slug === aktiv) ?? null;

  return (
    <details data-cse="gesellschaftswahl" className="relative hidden xl:block">
      <summary
        aria-label={beschriftung}
        className="flex min-h-11 cursor-pointer list-none items-center gap-s2 rounded-sm
                   border border-line px-s3 text-sm text-text-muted hover:text-text"
      >
        {/*
          * Die Zusammenfassung zeigt, wo man IST — nicht, was man waehlen
          * kann. „Gesellschaften" als Dauerbeschriftung waere eine Zeile, die
          * auf jeder der fuenf Seiten dasselbe sagt; der Firmenname sagt
          * etwas.
          */}
        {hier === null ? null : <BereichsAvatar bereich={hier.bereich} aktiv bild={hier.marke.avatar} />}
        <span className="max-w-[16ch] truncate">{hier?.name ?? beschriftung}</span>
        {/*
          * Das Zeichen ist DEKORATION und traegt deshalb `aria-hidden`: der
          * zugaengliche Name steht schon am `summary`, und ein vorgelesenes
          * „nach unten zeigendes Dreieck" ist fuer niemanden eine Auskunft.
          */}
        <span aria-hidden="true" className="text-text-subtle">▾</span>
      </summary>

      <nav
        aria-label={beschriftung}
        data-cse="gesellschaftswahl-blatt"
        className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[15rem] rounded-sm
                   border border-line bg-surface-2 p-s2 shadow-pop"
      >
        <ul className="m-0 list-none p-0">
          {bereiche.map((b) => (
            <li key={b.slug}>
              <a
                href={mitSprache(`/unternehmen/${b.slug}`, sprache)}
                data-cse="gesellschaftswahl-ziel"
                aria-current={b.slug === aktiv ? 'page' : undefined}
                className="flex min-h-11 items-center gap-s2 rounded-sm px-s2 text-sm
                           text-text-muted hover:bg-surface-3 hover:text-text"
              >
                <BereichsAvatar bereich={b.bereich} aktiv={b.slug === aktiv}
                                bild={b.marke.avatar} />
                {b.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
