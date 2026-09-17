import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { listeAufmasse, type AufmassKopfZeile } from '@/server/services/bau/aufmass';
import { AUFMASS_PILLE, AUFMASS_STATUS_TEXT } from '../aufmass-anzeige';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/aufmass` — alle Blätter, über die Projekte hinweg
 * (BAU-02, Seitenkarte §5.9).
 *
 * Die Liste beantwortet die Frage der Bauleitung, die auf Projektebene nicht
 * zu stellen ist: **was liegt vorgelegt und ist nicht gegengezeichnet?** Ein
 * Blatt in diesem Zustand ist Geld, das nicht abgerechnet werden kann, und je
 * länger es liegt, desto schwerer wird die Feststellung nachzuholen.
 */
export const dynamic = 'force-dynamic';

export default async function AufmassUeberProjekte(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/bau/aufmass`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const blaetter = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => listeAufmasse(kontext)),
  ) as Promise<readonly AufmassKopfZeile[]>);

  const offen = blaetter.filter((b) => b.status === 'vorgelegt');

  return (
    <PortalRahmen
      titel="Aufmaße"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Aufmaße</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {offen.length === 0
          ? 'Kein Blatt wartet auf eine Gegenzeichnung.'
          : `${String(offen.length)} Blatt/Blätter sind vorgelegt und noch nicht gegengezeichnet.`}
      </p>

      {blaetter.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Es ist noch kein Aufmaß aufgenommen.
        </p>
      ) : (
        <DataTable
          beschriftung="Aufmaße über alle Projekte"
          zeilen={blaetter}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'projekt',
              kopf: 'Projekt',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/aufmass`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.projekt}
                </Link>
              ),
            },
            { schluessel: 'nummer', kopf: 'Blatt', zelle: (z) => z.nummer },
            {
              schluessel: 'bezeichnung',
              kopf: 'Bezeichnung',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/aufmass/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.bezeichnung}
                </Link>
              ),
            },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde },
            { schluessel: 'messdatum', kopf: 'Messdatum', zelle: (z) => z.messdatum_lokal },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={AUFMASS_PILLE[z.status] ?? 'Entwurf'} />
                  <span className="text-xs text-text-muted">
                    {AUFMASS_STATUS_TEXT[z.status] ?? z.status}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
