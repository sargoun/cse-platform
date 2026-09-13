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
import { findeProjekt, type ProjektZeile } from '@/server/services/bau/lv';
import {
  BEHINDERUNG_GRUND_KURZ, BEHINDERUNG_PILLE, BEHINDERUNG_STATUS_TEXT,
} from '../../../nachtrag-anzeige';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/behinderungen` — die
 * Behinderungsanzeigen eines Projekts (BAU-06, § 6 VOB/B).
 *
 * **Die Spalte „Angezeigt am" ist die wichtigste der Seite.** Eine
 * Behinderungsanzeige ist eine empfangsbedürftige Erklärung: sie wirkt, wenn
 * sie beim Auftraggeber ist, nicht wenn sie geschrieben wurde. Ein Entwurf,
 * der hier ohne Datum steht, ist im Bauzeitenstreit nichts wert — und genau
 * das soll man sehen, solange sich der Fehler noch beheben lässt.
 */
export const dynamic = 'force-dynamic';

export default async function BehinderungenJeProjekt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/behinderungen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjekt(kontext, id);
      if (projekt === null) return null;
      return { projekt, anzeigen: await listeBehinderungen(kontext, { projektId: id }) };
    }),
  ) as Promise<{
    projekt: ProjektZeile; anzeigen: readonly BehinderungZeile[];
  } | null>);

  if (daten === null) notFound();

  const entwuerfe = daten.anzeigen.filter((b) => b.angezeigt_lokal === null && !b.storniert);

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
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">Behinderungsanzeigen</h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {daten.projekt.nummer} · {daten.projekt.bezeichnung}
          </p>
        </div>
        <Link
          href={`/portal/${mandant}/bau/projekte/${id}/behinderungen/neu`}
          className="rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Behinderung anzeigen
        </Link>
      </div>

      {entwuerfe.length > 0 && (
        <p
          className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-warning"
          data-cse="nicht-abgesendet"
        >
          {entwuerfe.length === 1
            ? 'Eine Anzeige ist geschrieben, aber nicht abgesendet. '
            : `${String(entwuerfe.length)} Anzeigen sind geschrieben, aber nicht abgesendet. `}
          Eine Behinderungsanzeige wirkt erst, wenn sie beim Auftraggeber ist
          (§ 6 Abs. 1 VOB/B).
        </p>
      )}

      {daten.anzeigen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zu diesem Projekt ist keine Behinderung angezeigt.
        </p>
      ) : (
        <DataTable
          beschriftung="Behinderungsanzeigen dieses Projekts"
          zeilen={daten.anzeigen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nummer', kopf: 'Nr.', zelle: (z) => z.nummer },
            {
              schluessel: 'ursache',
              kopf: 'Hindernde Umstände',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${id}/behinderungen/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.ursache}
                </Link>
              ),
            },
            {
              schluessel: 'grund',
              kopf: 'Risikosphäre (§ 6 Abs. 2)',
              zelle: (z) => BEHINDERUNG_GRUND_KURZ[z.grund_kategorie] ?? z.grund_kategorie,
            },
            { schluessel: 'beginn', kopf: 'Beginn', zelle: (z) => z.beginn_lokal },
            {
              schluessel: 'angezeigt',
              kopf: 'Angezeigt am',
              zelle: (z) => (
                <span data-cse="angezeigt-am">
                  {z.angezeigt_lokal === null ? (
                    <span className="text-warning">nicht abgesendet</span>
                  ) : (
                    <>
                      {z.angezeigt_lokal}
                      <span className="block text-xs text-text-subtle">
                        {z.versandart === null
                          ? ''
                          : VERSANDART_TEXT[z.versandart] ?? z.versandart}
                      </span>
                    </>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill zustand={BEHINDERUNG_PILLE[z.status] ?? 'Entwurf'} />
                  {/* §9: das WORT trägt die rechtliche Bedeutung, nicht die Farbe. */}
                  <span className="text-xs text-text-muted">
                    {BEHINDERUNG_STATUS_TEXT[z.status] ?? z.status}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 text-sm">
        <Link
          href={`/portal/${mandant}/bau/projekte`}
          className="text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Zurück zu den Projekten
        </Link>
      </p>
    </PortalRahmen>
  );
}
