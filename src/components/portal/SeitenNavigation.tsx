import { tabZiel, type TabZiel } from '@/server/registry/tableiste';
import { Icon } from '@/components/ui/Icon';

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
}

export function SeitenNavigation({
  ziele, aktiv, wurzel, label, sichtbar,
}: SeitenNavigationProps) {
  const gezeigt = ziele.filter((z) => sichtbar?.[z.schluessel] !== false);
  /*
   * **Keine Schiene, wenn kein Punkt uebrig ist.**
   *
   * Das `<nav>` ist `w-56` breit und traegt eine Trennlinie. Blieb nichts
   * uebrig — auf `/portal/mein/**` hielt die Sitzung kein einziges Modulrecht
   * —, stand am Schreibtisch trotzdem eine leere Spalte von 224px mit einem
   * Strich daneben. Das liest sich nicht als „hier gibt es nichts zu
   * navigieren", sondern als „hier fehlt etwas", und beim dritten Mal glaubt
   * man es dem Bildschirm.
   */
  if (gezeigt.length === 0) return null;
  return (
    <nav
      aria-label={label}
      data-cse="seitennavigation"
      className="hidden w-56 shrink-0 border-r border-line bg-surface p-s3 md:block"
    >
      <ul className="flex flex-col gap-s1">
        {gezeigt.map((z) => {
          const ziel = tabZiel(wurzel, z);
          return (
            <li key={z.schluessel}>
              <a
                href={ziel}
                data-cse="nav-punkt"
                data-tab={z.schluessel}
                aria-current={z.schluessel === aktiv ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-s2 rounded-md px-s3 py-s2
                            text-base ${z.schluessel === aktiv
                              ? 'bg-surface-2 text-text' : 'text-text-muted hover:bg-surface-2'}`}
              >
                <Icon name={z.icon} groesse="md" className="shrink-0" />
                {z.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
