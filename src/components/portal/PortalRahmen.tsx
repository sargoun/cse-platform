import { StatusPill } from '@/components/ui/StatusPill';
import { TabLeiste } from './TabLeiste';
import { SeitenNavigation } from './SeitenNavigation';
import { tableiste, type LeistenSchluessel } from '@/server/registry/tableiste';
import { NAVIGATION } from '@/server/registry/navigation';
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
  /** Je Rechteschluessel der NAVIGATION — fuellt das Blatt hinter `Mehr`. */
  readonly navigationsRechte?: Readonly<Record<string, boolean>>;
  readonly children: React.ReactNode;
}

export function PortalRahmen({
  titel, bereich, nurLesen, leiste, wurzel, aktiverTab, sichtbareTabs,
  navigationsRechte, children,
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
        {/*
          * **Der Schreibtisch bekommt das VOLLE Register, nicht die fuenf
          * Ziele des Telefons.**
          *
          * Hier stand `ziele={tabs.ziele}`. Das sind die fuenf Punkte der
          * Tab-Leiste — Uebersicht, Auftraege, Dienstplan, Freigaben und
          * `Mehr` —, und `Mehr` traegt `pfad: ''`, zeigt also auf die Seite,
          * auf der man ohnehin steht.
          *
          * Die Folge war, dass auf einem 1440-px-Bildschirm KEIN Weg zu
          * Zeiten, Personal, Objekten, CRM, Finanzen, Reinigung, Security,
          * Bau oder Qualitaet fuehrte. Alle diese Bildschirme waren gebaut,
          * geprueft und erreichbar — nur nannte sie niemand. Wer das Portal
          * oeffnete, sah vier Punkte und schloss daraus, es gebe vier Module.
          *
          * `NAVIGATION` ist das Register, das genau dafuer angelegt wurde
          * (18 Eintraege, jeder mit seinem Recht). Es war da, die Sidebar war
          * da — verbunden waren sie nie.
          */}
        <SeitenNavigation
          ziele={NAVIGATION.filter((n) => leiste !== 'gruppe' || n.gruppe)}
          wurzel={wurzel}
          {...(aktiverTab === undefined ? {} : { aktiv: aktiverTab })}
          {...(navigationsRechte === undefined ? {} : { sichtbar: navigationsRechte })}
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
        {...(navigationsRechte === undefined ? {} : { navigationsRechte })}
        gruppenansicht={leiste === 'gruppe'}
        label={titel}
      />
    </div>
  );
}
