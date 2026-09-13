import { tabZiel, type TabZiel } from '@/server/registry/tableiste';
import { Icon } from '@/components/ui/Icon';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Die Navigation AB 768 px — das Gegenstueck zur Tab-Leiste.
 *
 * **Ohne sie gab es ueber `md` ueberhaupt keine Navigation.** Die Tab-Leiste
 * traegt `md:hidden`, und eine Sidebar existierte nicht: am Schreibtisch, wo
 * die Verwaltung arbeitet, war jede Portalseite eine Sackgasse. Das ist keine
 * Geschmacksfrage — DESIGN §5 ersetzt die Sidebar UNTER 768 px durch die
 * Leiste, nicht umgekehrt.
 *
 * Dieselben Ziele, dieselbe Rechtefilterung, dieselbe Quelle
 * (`registry/tableiste.ts`). Zwei Listen, die auseinanderlaufen koennen, waeren
 * die naechste Stelle, an der eine Seite erreichbar bleibt, die es nicht mehr
 * gibt.
 */
export interface SeitenNavigationProps {
  readonly ziele: readonly TabZiel[];
  readonly aktiv?: string;
  readonly wurzel: string;
  readonly label: string;
  readonly sichtbar?: Readonly<Record<string, boolean>>;
  /**
   * Der Hue des aktiven Punktes — DESIGN §5 nennt ihn als Teil der Sidebar.
   *
   * `null` heisst: kein Bereich aktiv (Gruppenansicht). Dann traegt der Balken
   * dieselbe neutrale Linie wie der Identitaetsstreifen ganz oben, statt einen
   * Bereich zu behaupten, in dem man nicht ist.
   */
  readonly bereich?: BereichSchluessel | null;
  /** Uebersetzte Beschriftungen je Schluessel — siehe `TabLeiste` (D-419). */
  readonly beschriftungen?: Readonly<Record<string, string>>;
}

export function SeitenNavigation({
  ziele, aktiv, wurzel, label, sichtbar, bereich = null, beschriftungen,
}: SeitenNavigationProps) {
  const gezeigt = ziele.filter((z) => sichtbar?.[z.schluessel] !== false);
  /*
   * **Keine Schiene, wenn kein Punkt uebrig ist.**
   *
   * Das `<nav>` ist 248px breit und traegt eine Trennlinie. Blieb nichts
   * uebrig — auf `/portal/mein/**` hielt die Sitzung kein einziges Modulrecht
   * —, stand am Schreibtisch trotzdem eine leere Spalte mit einem Strich
   * daneben. Das liest sich nicht als „hier gibt es nichts zu navigieren",
   * sondern als „hier fehlt etwas", und beim dritten Mal glaubt man es dem
   * Bildschirm.
   */
  if (gezeigt.length === 0) return null;
  /*
   * **248px, Beschriftung `sm`, 3px-Balken am aktiven Punkt — DESIGN §5.**
   *
   * Hier stand `w-56` (224px) und `text-base`. Keine der beiden Zahlen steht in
   * DESIGN.md; der Absatz „Portal sidebar" nennt 248px, `--surface`, „active
   * item: `--surface-2` bg + 3px left bar in the current area's identity hue"
   * und „label `sm`". 24px Unterschied sieht niemand — aber `Sidebar.tsx`
   * rendert dieselbe Schiene mit `md:w-[248px]`, und zwei Fassungen derselben
   * Breite sind der Anfang davon, dass DESIGN.md aufhoert, die Quelle zu sein.
   */
  return (
    <nav
      aria-label={label}
      data-cse="seitennavigation"
      className="hidden w-[248px] shrink-0 border-r border-line bg-surface p-s3 md:block"
    >
      <ul className="flex flex-col gap-s1">
        {gezeigt.map((z) => {
          const ziel = tabZiel(wurzel, z);
          const istAktiv = z.schluessel === aktiv;
          return (
            <li key={z.schluessel}>
              <a
                href={ziel}
                data-cse="nav-punkt"
                data-tab={z.schluessel}
                aria-current={istAktiv ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-s2 rounded-md border-l-[3px] px-s3 py-s2
                            text-sm ${istAktiv
                              ? `bg-surface-2 text-text ${
                                bereich === null ? 'border-line-strong' : ''}`
                              : 'border-transparent text-text-muted hover:bg-surface-2'}`}
                {...(istAktiv && bereich !== null
                  ? { style: { borderLeftColor: `var(--area-${bereich})` } }
                  : {})}
              >
                <Icon name={z.icon} groesse="md" className="shrink-0" />
                {beschriftungen?.[z.schluessel] ?? z.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
