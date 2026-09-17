import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { listeAufmasse, type AufmassKopfZeile } from '@/server/services/bau/aufmass';
import { findeProjekt, type ProjektZeile } from '@/server/services/bau/lv';
import { AUFMASS_PILLE, AUFMASS_STATUS_TEXT } from '../../../aufmass-anzeige';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '../../../../../rechte';

/**
 * `/portal/[mandant]/bau/projekte/[id]/aufmass` — die Blaetter eines Projekts
 * (BAU-02).
 *
 * Die Spalte „Fotos" steht hier, weil sie die Frage beantwortet, die sonst
 * erst beim Gegenzeichnen auffaellt: ein Blatt ohne Messfoto laesst sich nicht
 * vorlegen (BAU-03), und das soll man sehen, solange die Kraft noch auf der
 * Baustelle ist.
 */
export const dynamic = 'force-dynamic';

export default async function AufmassListe(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/bau/projekte/${id}/aufmass`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: `…/aufmass/neu` verlangt laut Manifest `bau.aufmass_erfassen`,
     diese Liste nur `bau.lesen` — eine `kunde` sah den Knopf und bekam
     dahinter ein 404. Ein Verweis auf 404 verraet, was er nicht zeigen darf
     (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'bau.aufmass_erfassen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjekt(kontext, id);
      if (projekt === null) return null;
      return { projekt, blaetter: await listeAufmasse(kontext, { projektId: id }) };
    }),
  ) as Promise<{
    projekt: ProjektZeile; blaetter: readonly AufmassKopfZeile[];
  } | null>);

  if (daten === null) notFound();

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
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">Aufmaße</h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {daten.projekt.nummer} · {daten.projekt.bezeichnung}
          </p>
        </div>
        {darf['bau.aufmass_erfassen'] === true && (
          <Link
            href={`/portal/${mandant}/bau/projekte/${id}/aufmass/neu`}
            className="rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Aufmaß aufnehmen
          </Link>
        )}
      </div>

      {daten.blaetter.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zu diesem Projekt ist noch kein Aufmaß aufgenommen.
        </p>
      ) : (
        <DataTable
          beschriftung="Aufmaßblätter"
          zeilen={daten.blaetter}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nummer', kopf: 'Blatt', zelle: (z) => z.nummer },
            {
              schluessel: 'bezeichnung',
              kopf: 'Bezeichnung',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${id}/aufmass/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.bezeichnung}
                </Link>
              ),
            },
            { schluessel: 'bereich', kopf: 'Bereich', zelle: (z) => z.bereich ?? '—' },
            { schluessel: 'messdatum', kopf: 'Messdatum', zelle: (z) => z.messdatum_lokal },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={AUFMASS_PILLE[z.status] ?? 'Entwurf'} />
                  {/* §9: das WORT traegt die rechtliche Bedeutung, nicht die Farbe. */}
                  <span className="text-xs text-text-muted">
                    {AUFMASS_STATUS_TEXT[z.status] ?? z.status}
                  </span>
                </span>
              ),
            },
            { schluessel: 'zeilen', kopf: 'Zeilen', numerisch: true, zelle: (z) => z.zeilen },
            {
              schluessel: 'fotos',
              kopf: 'Fotos',
              numerisch: true,
              zelle: (z) => (
                <span className={z.fotos === 0 ? 'text-warning' : 'text-text-muted'}>
                  {z.fotos === 0 ? 'fehlt' : z.fotos}
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
