import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  VERSANDART_TEXT, listeBehinderungen, type BehinderungZeile,
} from '@/server/services/bau/behinderung';
import {
  BEHINDERUNG_GRUND_KURZ, BEHINDERUNG_PILLE, BEHINDERUNG_STATUS_TEXT,
} from '../nachtrag-anzeige';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/behinderungen` — alle Behinderungsanzeigen über die
 * Projekte hinweg (BAU-06, Seitenkarte §5.9).
 *
 * Die Frage, die auf Projektebene nicht zu stellen ist: **was ist
 * geschrieben, aber nicht abgesendet?** Eine Behinderungsanzeige wirkt erst
 * beim Auftraggeber; ein Entwurf im System ist im Bauzeitenstreit nichts
 * wert, und es fällt nur auf, wenn jemand über alle Projekte hinwegschaut.
 */
export const dynamic = 'force-dynamic';

export default async function BehinderungenUeberProjekte(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/bau/behinderungen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const anzeigen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => listeBehinderungen(kontext)),
  ) as Promise<readonly BehinderungZeile[]>);

  const offen = anzeigen.filter((b) => b.angezeigt_lokal === null && !b.storniert);

  return (
    <PortalRahmen
      titel="Behinderungsanzeigen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Behinderungsanzeigen</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {offen.length === 0
          ? 'Jede geschriebene Anzeige ist abgesendet.'
          : `${String(offen.length)} Anzeige(n) sind geschrieben, aber nicht abgesendet — `
            + 'eine Behinderungsanzeige wirkt erst beim Auftraggeber (§ 6 Abs. 1 VOB/B).'}
      </p>

      {anzeigen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Es ist keine Behinderung angezeigt.
        </p>
      ) : (
        <DataTable
          beschriftung="Behinderungsanzeigen über alle Projekte"
          zeilen={anzeigen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'projekt',
              kopf: 'Projekt',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/behinderungen`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.projekt}
                </Link>
              ),
            },
            { schluessel: 'nummer', kopf: 'Nr.', zelle: (z) => z.nummer },
            {
              schluessel: 'ursache',
              kopf: 'Hindernde Umstände',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/behinderungen/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.ursache}
                </Link>
              ),
            },
            {
              schluessel: 'grund',
              kopf: 'Risikosphäre',
              zelle: (z) => BEHINDERUNG_GRUND_KURZ[z.grund_kategorie] ?? z.grund_kategorie,
            },
            { schluessel: 'beginn', kopf: 'Beginn', zelle: (z) => z.beginn_lokal },
            {
              schluessel: 'angezeigt',
              kopf: 'Angezeigt am',
              zelle: (z) => z.angezeigt_lokal === null ? (
                <span className="text-warning">nicht abgesendet</span>
              ) : (
                <>
                  {z.angezeigt_lokal}
                  <span className="block text-xs text-text-subtle">
                    {z.versandart === null ? '' : VERSANDART_TEXT[z.versandart] ?? z.versandart}
                  </span>
                </>
              ),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill zustand={BEHINDERUNG_PILLE[z.status] ?? 'Entwurf'} />
                  <span className="text-xs text-text-muted">
                    {BEHINDERUNG_STATUS_TEXT[z.status] ?? z.status}
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
