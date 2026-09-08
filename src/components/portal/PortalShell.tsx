'use client';

/**
 * Die Portal-Shell — Kopfzeile, Identitätsstreifen, Sidebar.
 *
 * DESIGN §6 Regel 4: **ein 3px-Balken im Hue des aktiven Bereichs läuft zu
 * jeder Zeit über den obersten Rand.** Wer zehn Tabs offen hat, weiss daran,
 * wo er ist, bevor er irgendwo klickt. Er ist deshalb kein Dekor, sondern das
 * erste Element im Dokument — und in der Gruppenansicht neutral, weil dort
 * kein Bereich aktiv IST.
 */
import { BereichsUmschalter } from './BereichsUmschalter';
import { Sidebar } from './Sidebar';
import { StatusPill } from '@/components/ui/StatusPill';
import type { NaviEintrag } from '@/server/registry/navigation';
import type { UmschalterBereich } from './typen';

export interface PortalShellProps {
  readonly bereiche: readonly UmschalterBereich[];
  readonly aktiverMandantId: string | null;
  readonly gruppenansicht: boolean;
  readonly gruppeSichtbar: boolean;
  readonly punkte: readonly NaviEintrag[];
  readonly aktiverPunkt: string;
  readonly basis: string;
  readonly onWechsel: (mandantId: string | null) => void;
  readonly children: React.ReactNode;
}

export function PortalShell({
  bereiche, aktiverMandantId, gruppenansicht, gruppeSichtbar,
  punkte, aktiverPunkt, basis, onWechsel, children,
}: PortalShellProps) {
  const aktiv = bereiche.find((b) => b.id === aktiverMandantId);

  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <div
        aria-hidden="true"
        data-cse="identitaets-streifen"
        data-bereich={gruppenansicht ? 'gruppe' : aktiv?.bereich}
        className="h-[3px] w-full shrink-0"
        style={{
          background: gruppenansicht || aktiv === undefined
            ? 'var(--border-strong)'
            : `var(--area-${aktiv.bereich})`,
        }}
      />

      <header className="flex h-14 shrink-0 items-center gap-s3 border-b border-border bg-surface px-s3">
        <BereichsUmschalter
          bereiche={bereiche}
          aktiv={aktiverMandantId}
          gruppenansicht={gruppenansicht}
          gruppeSichtbar={gruppeSichtbar}
          onWechsel={onWechsel}
        />
        {/* Regel 3: die Gruppenansicht trägt das Schild auch im Header,
            nicht nur im Menü. */}
        {gruppenansicht && (
          <span data-cse="header-nur-lesen"><StatusPill zustand="Nur Lesen" /></span>
        )}
      </header>

      <div className="flex flex-1">
        <Sidebar punkte={punkte} basis={basis} aktiv={aktiverPunkt} />
        <main className="flex-1 p-s5 pb-20 md:pb-s5">{children}</main>
      </div>
    </div>
  );
}
