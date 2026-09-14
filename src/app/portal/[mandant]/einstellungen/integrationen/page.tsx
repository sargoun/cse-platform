import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { anbindungen, STAND_TEXT, type Anbindungsstand } from '@/server/registry/integrationen';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/integrationen` — jede Anbindung mit ihrem
 * wahren Zustand (CLAUDE.md „No fake integrations", SEITENKARTE 5.24).
 *
 * Die Zustaende kommen aus den Adaptern, die die Verbindung auch benutzen
 * (`registry/integrationen.ts`). Diese Seite behauptet nichts, was ein
 * Adapter nicht bestaetigt — und sie nennt zu jeder Luecke die offene Frage,
 * die sie schliesst.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<Anbindungsstand, PillZustand>> = {
  verbunden: 'Aktiv',
  nicht_verbunden: 'Inaktiv',
  entwicklung: 'Entwurf',
  dateiexport: 'Bereit',
  nicht_vorgesehen: 'Archiviert',
};

export default async function Integrationen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/integrationen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const zeilen = anbindungen();
  const verbunden = zeilen.filter((z) => z.stand === 'verbunden').length;

  return (
    <PortalRahmen
      titel="Integrationen"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}/einstellungen`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Integrationen</h1>
      <p data-cse="integrationen-zaehler" data-verbunden={verbunden} data-anzahl={zeilen.length}
         className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        {String(verbunden)} von {String(zeilen.length)} Anbindungen sind verbunden. Was nicht
        verbunden ist, wird nicht vorgetäuscht: der jeweilige Bildschirm sagt es, und
        nichts geht hinaus. Jede externe Verbindung braucht eine EU-Region und einen
        Vertrag zur Auftragsverarbeitung — siehe Auftragsverarbeiter.
      </p>
      <div data-cse="integrationen">
        <DataTable
          beschriftung="Anbindungen und ihr Zustand"
          zeilen={zeilen}
          schluessel={(z) => z.schluessel}
          spalten={[
            { schluessel: 'name', kopf: 'Anbindung', zelle: (z) => z.name },
            { schluessel: 'zweck', kopf: 'Zweck', zelle: (z) => z.zweck },
            { schluessel: 'stand', kopf: 'Zustand',
              zelle: (z) => (
                <span className="flex items-center gap-s2" data-stand={z.stand}>
                  <StatusPill zustand={PILLE[z.stand]} />
                  <span className="text-xs text-text-muted">{STAND_TEXT[z.stand]}</span>
                </span>
              ) },
            { schluessel: 'hinweis', kopf: 'Woher die Antwort kommt', zelle: (z) => z.hinweis },
            { schluessel: 'offen', kopf: 'Offene Frage',
              zelle: (z) => (z.offen === null ? '—' : <code className="text-xs">{z.offen}</code>) },
          ]}
        />
      </div>
      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">
        Verbunden wird über Umgebungsvariablen des Deployments, nie über ein Feld in
        dieser Oberfläche — ein Schlüssel gehört nicht in eine Datenbank, die jemand
        exportieren kann.
      </p>
    </PortalRahmen>
  );
}
