'use client';

import { useState } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { Card } from '@/components/ui/Card';
import { KpiStat } from '@/components/ui/KpiStat';
import { NAVIGATION, GRUPPEN_NAVIGATION } from '@/server/registry/navigation';
import type { UmschalterBereich } from '@/components/portal/typen';

/**
 * Beispieldaten in Berliner Wirklichkeit. Die Zähler sind hier fest — in der
 * Anwendung kommen sie aus einer Live-Abfrage je Bereich (DESIGN §6 Regel 2),
 * und `null` heisst dort: der Benutzer hält `gruppe.bericht.lesen` nicht.
 */
const BEREICHE: readonly UmschalterBereich[] = [
  { id: 'm1', slug: 'reinigung', name: 'CSE Dienstleistung', gewerk: 'Reinigung',
    zaehler: 24, zaehlerWort: 'Aufträge', bereich: 'reinigung' },
  { id: 'm2', slug: 'security', name: 'SSE Security', gewerk: 'Sicherheit',
    zaehler: 8, zaehlerWort: 'Aufträge', bereich: 'security' },
  { id: 'm3', slug: 'bau', name: 'REALTIME Service', gewerk: 'Bau',
    zaehler: 12, zaehlerWort: 'Projekte', bereich: 'bau' },
  { id: 'm4', slug: 'operations', name: 'CSE Operations', gewerk: 'Digital & KI',
    zaehler: null, zaehlerWort: '', bereich: 'operations' },
];

export function PortalVorschau() {
  const [aktiv, setAktiv] = useState<string | null>('m1');
  const gruppe = aktiv === null;
  const bereich = BEREICHE.find((b) => b.id === aktiv);

  return (
    <PortalShell
      bereiche={BEREICHE}
      aktiverMandantId={aktiv}
      gruppenansicht={gruppe}
      gruppeSichtbar
      punkte={gruppe ? GRUPPEN_NAVIGATION : NAVIGATION}
      aktiverPunkt="dashboard"
      basis={gruppe ? '/portal/gruppe' : `/portal/${bereich?.slug ?? ''}`}
      onWechsel={setAktiv}
    >
      <div className="flex flex-col gap-s5">
        <header className="flex flex-col gap-s1">
          <h1 className="text-h1 text-text">
            {gruppe ? 'Gruppenübersicht' : bereich?.name}
          </h1>
          <p className="max-w-prose text-base text-text-muted">
            {gruppe
              ? 'Alle vier Bereiche zusammen — ausschliesslich lesend. '
                + 'Hier entsteht kein Datensatz, und es gibt keinen Weg, auf dem einer entstünde.'
              : `${bereich?.gewerk} · Berlin`}
          </p>
        </header>

        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiStat label="Offene Aufträge" wert={gruppe ? '44' : String(bereich?.zaehler ?? 0)} ton="info" />
          <KpiStat label="Einsätze heute" wert={gruppe ? '112' : '47'} ton="success" />
          <KpiStat label="Überfällig" wert="3" ton="danger" />
          <KpiStat label="Offene Angebote" wert="12" ton="warning" />
        </div>

        <Card>
          <p className="text-sm text-text-muted">
            {gruppe
              ? 'In dieser Ansicht wird kein Bearbeiten-Knopf gerendert — und ein direkter '
                + 'POST auf einen Schreibpfad antwortet KEIN_AKTIVER_MANDANT. Zwei Linien, '
                + 'nicht eine.'
              : 'Mit ⌘K den Bereich wechseln. Der 3px-Streifen ganz oben trägt den Hue des '
                + 'aktiven Bereichs — daran sieht man bei zehn offenen Tabs, wo man ist.'}
          </p>
        </Card>
      </div>
    </PortalShell>
  );
}
