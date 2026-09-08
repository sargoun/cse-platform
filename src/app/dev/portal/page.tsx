import { devFlaechenAn } from '@/lib/dev-flaechen';
import { notFound } from 'next/navigation';
import { PortalVorschau } from './PortalVorschau';

/**
 * Die Portal-Shell zum Anfassen — Umschalter, Identitätsstreifen, Sidebar,
 * Gruppenansicht.
 *
 * Entwicklungsfläche wie der Kitchensink: in einem Produktionsbuild ein 404
 * (`lib/dev-flaechen.ts`). Sie zeigt die Shell mit festen Beispieldaten; die
 * echten Zähler und Bereiche kommen aus der Sitzung, sobald die Anmeldung
 * angeschlossen ist.
 */
export const dynamic = 'force-static';

export default function PortalSeite() {
  if (!devFlaechenAn()) notFound();
  return <PortalVorschau />;
}
