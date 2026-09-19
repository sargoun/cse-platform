import { praefix, type Sprache } from '@/lib/sprache';

/**
 * Die Unterreiter eines Gesellschaftsprofils (SEITENKARTE §2.2, DESIGN §4/§5).
 *
 * **Verweise, keine Knöpfe.** Ein Reiter ändert die Adresse; als `<button>`
 * überlebte er weder einen Mittelklick noch einen kopierten Link, und ein
 * Screenreader bekäme „Schaltfläche" statt „Link" angesagt. `FilterPill` ist
 * ein Knopf mit `onClick` und damit hier das falsche Bauteil — die WERTE sind
 * dieselben (DESIGN §5), die Semantik ist es nicht.
 *
 * **`aria-current="page"` und nicht nur eine Farbe.** §9 verbietet Farbe als
 * einziges Signal, und wer die Leiste vorgelesen bekommt, hört sonst sieben
 * gleichwertige Verweise.
 *
 * **Waagerecht rollbar, kein Umbruch** (DESIGN §5). Sieben Reiter passen bei
 * 375px nicht nebeneinander; umbrechen lassen hiesse, den Deckel darüber um
 * eine Zeile zu verschieben, sobald ein Bereichsname länger wird.
 */
export interface ProfilTab {
  /** Das Segment hinter `/unternehmen/<bereich>` — leer für die Wurzel. */
  readonly segment: string;
  readonly label: string;
}

export const PROFIL_TABS: readonly ProfilTab[] = [
  { segment: '', label: 'Profil' },
  { segment: 'leistungen', label: 'Leistungen' },
  { segment: 'projekte', label: 'Projekte' },
  { segment: 'galerie', label: 'Galerie' },
  { segment: 'news', label: 'Aktuelles' },
  { segment: 'beitraege', label: 'Beiträge' },
  { segment: 'kontakt', label: 'Kontakt' },
  { segment: 'unternehmensdaten', label: 'Unternehmensdaten' },
];

/** Dieselben Reiter auf Englisch (D-82). */
export const PROFIL_TABS_EN: readonly ProfilTab[] = [
  { segment: '', label: 'Profile' },
  { segment: 'leistungen', label: 'Services' },
  { segment: 'projekte', label: 'Projects' },
  { segment: 'galerie', label: 'Gallery' },
  { segment: 'news', label: 'News' },
  { segment: 'beitraege', label: 'Posts' },
  { segment: 'kontakt', label: 'Contact' },
  { segment: 'unternehmensdaten', label: 'Company details' },
];

export function profilTabs(sprache: Sprache): readonly ProfilTab[] {
  return sprache === 'en' ? PROFIL_TABS_EN : PROFIL_TABS;
}

export function ProfilTabs(
  { bereich, aktiv, sprache, label }: {
    readonly bereich: string;
    /** Das aktive Segment — leer für die Profilwurzel. */
    readonly aktiv: string;
    readonly sprache: Sprache;
    readonly label: string;
  },
) {
  const basis = `${praefix(sprache)}/unternehmen/${bereich}`;
  return (
    <nav
      aria-label={label}
      data-cse="profil-tabs"
      /*
       * `overflow-x-auto` plus `flex-nowrap`: waagerecht rollbar, kein Umbruch
       * (DESIGN §5). `-mx-s4 px-s4` gibt der Rolle am Telefon denselben Rand
       * wie dem Text darüber, ohne dass der erste Reiter am Rand klebt.
       */
      className="-mx-s4 flex flex-nowrap gap-s2 overflow-x-auto px-s4 py-s3"
    >
      {profilTabs(sprache).map((t) => {
        const hier = t.segment === aktiv;
        return (
          <a
            key={t.segment === '' ? 'wurzel' : t.segment}
            href={t.segment === '' ? basis : `${basis}/${t.segment}`}
            data-cse="profil-tab"
            data-tab={t.segment === '' ? 'wurzel' : t.segment}
            aria-current={hier ? 'page' : undefined}
            className={[
              'inline-flex min-h-11 shrink-0 items-center rounded-full px-s4 text-sm',
              'transition-colors duration-fast ease-brand',
              hier ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
            ].join(' ')}
          >
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
