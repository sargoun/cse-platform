import { StatusPill } from '@/components/ui/StatusPill';
import { TabLeiste } from './TabLeiste';
import { SeitenNavigation } from './SeitenNavigation';
import { tableiste, type LeistenSchluessel } from '@/server/registry/tableiste';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Der Rahmen einer angemeldeten Portalseite — als SERVER-Komponente.
 *
 * Die Vorschau unter `/dev/portal` ist eine Client-Komponente, weil sie den
 * Umschalter vorfuehrt. Die echten Seiten brauchen davon nichts: Kopfzeile,
 * Identitaetsstreifen und Tab-Leiste sind Auslieferung, keine Interaktion —
 * und was der Server rendert, kann kein Skript aushebeln.
 *
 * DESIGN §6 Regel 4: der 3px-Balken im Hue des aktiven Bereichs steht zu jeder
 * Zeit ganz oben. In der Gruppenansicht ist er neutral, weil dort kein Bereich
 * aktiv IST.
 */
export interface PortalRahmenProps {
  readonly titel: string;
  readonly bereich: BereichSchluessel | null;
  readonly nurLesen: boolean;
  readonly leiste: LeistenSchluessel;
  readonly wurzel: string;
  readonly aktiverTab?: string;
  /**
   * Je Tab-Schluessel: darf er erscheinen? Kommt aus `portalZugang`, das ihn
   * in derselben gebundenen Transaktion bewertet wie den Zugang zur Seite.
   */
  readonly sichtbareTabs?: Readonly<Record<string, boolean>>;
  readonly children: React.ReactNode;
}

export function PortalRahmen({
  titel, bereich, nurLesen, leiste, wurzel, aktiverTab, sichtbareTabs, children,
}: PortalRahmenProps) {
  const tabs = tableiste(leiste);
  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <div
        aria-hidden="true"
        data-cse="identitaets-streifen"
        data-bereich={bereich ?? 'gruppe'}
        className="h-[3px] w-full shrink-0"
        style={{
          background: bereich === null
            ? 'var(--border-line-strong)' : `var(--area-${bereich})`,
        }}
      />

      <header className="flex h-14 shrink-0 items-center gap-s3 border-b border-line
                         bg-surface px-s4">
        <span className="text-h3 text-text">{titel}</span>
        {nurLesen && (
          <span data-cse="header-nur-lesen"><StatusPill zustand="Nur Lesen" /></span>
        )}
      </header>

      <div className="flex flex-1">
        <SeitenNavigation
          ziele={tabs.ziele}
          wurzel={wurzel}
          {...(aktiverTab === undefined ? {} : { aktiv: aktiverTab })}
          {...(sichtbareTabs === undefined ? {} : { sichtbar: sichtbareTabs })}
          label={titel}
        />
        {/* `pb-20` unter `md`: die Tab-Leiste liegt fest am unteren Rand und
            verdeckte sonst die letzte Zeile jeder Liste. */}
        <main className="flex-1 p-s5 pb-20 md:pb-s5">{children}</main>
      </div>

      <TabLeiste
        ziele={tabs.ziele}
        wurzel={wurzel}
        {...(aktiverTab === undefined ? {} : { aktiv: aktiverTab })}
        {...(sichtbareTabs === undefined ? {} : { sichtbar: sichtbareTabs })}
        label={titel}
      />
    </div>
  );
}
