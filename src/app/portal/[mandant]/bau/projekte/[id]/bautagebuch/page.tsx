import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { listeBautage, type BautagKopfZeile } from '@/server/services/bau/bautagebuch';
import { findeProjekt, type ProjektZeile } from '@/server/services/bau/lv';
import { BAUTAG_PILLE, BAUTAG_STATUS_TEXT } from '../../../bautagebuch-anzeige';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/bautagebuch` — die Tage einer
 * Baustelle (BAU-07, Seitenkarte §5.9).
 *
 * **Stornierte Tage stehen mit in der Liste.** Sie herauszufiltern waere
 * bequem und naehme der Liste genau das, was sie beweist: dass an diesem
 * Datum zuerst etwas anderes stand. Die Spalte „Korrektur" sagt, in welche
 * Richtung der Verweis geht.
 *
 * **Der Knopf fuehrt auf HEUTE.** Ein Bautagebuch wird am Tag gefuehrt, nicht
 * nachtraeglich; welcher Tag heute ist, beantwortet die Datenbank in Berliner
 * Ortszeit und nicht die Uhr des Node-Prozesses (Invariante 5, K-11).
 */
export const dynamic = 'force-dynamic';

export default async function BautagebuchListe(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/bautagebuch`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const heute = await berlinHeute();
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjekt(kontext, id);
      if (projekt === null) return null;
      return { projekt, tage: await listeBautage(kontext, { projektId: id }) };
    }),
  ) as Promise<{ projekt: ProjektZeile; tage: readonly BautagKopfZeile[] } | null>);

  // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();

  const wurzel = `/portal/${mandant}/bau/projekte/${id}/bautagebuch`;

  return (
    <PortalRahmen
      titel="Bautagebuch"
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
          <h1 className="m-0 text-h1 text-text">Bautagebuch</h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {daten.projekt.nummer} · {daten.projekt.bezeichnung}
          </p>
        </div>
        <Link
          href={`${wurzel}/${heute}`}
          className="rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Heutigen Tag führen
        </Link>
      </div>

      {daten.tage.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zu dieser Baustelle ist noch kein Bautag erfasst.
        </p>
      ) : (
        <DataTable
          beschriftung="Bautage"
          zeilen={daten.tage}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'datum',
              kopf: 'Tag',
              zelle: (z) => (
                <Link
                  href={`${wurzel}/${z.datum}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.datum_lokal}
                </Link>
              ),
            },
            {
              schluessel: 'arbeitszeit',
              kopf: 'Arbeitszeit',
              zelle: (z) => (z.arbeitsbeginn_lokal === null && z.arbeitsende_lokal === null
                ? '—'
                : `${z.arbeitsbeginn_lokal ?? '?'}–${z.arbeitsende_lokal ?? '?'}`),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill zustand={z.storniert ? 'Archiviert' : BAUTAG_PILLE[z.status] ?? 'Entwurf'} />
                  {/* §9: das WORT traegt die Bedeutung, nicht die Farbe. */}
                  <span className="text-xs text-text-muted">
                    {z.storniert ? 'Storniert' : BAUTAG_STATUS_TEXT[z.status] ?? z.status}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'wetter',
              kopf: 'Wetter',
              zelle: (z) => (z.wetter_quelle === 'keine'
                ? <span className="text-text-subtle">nicht verfügbar</span>
                : z.wetter_quelle === 'dwd' ? 'DWD' : 'manuell'),
            },
            {
              schluessel: 'mannstunden',
              kopf: 'Zeilen',
              numerisch: true,
              zelle: (z) => z.mannstunden_zeilen,
            },
            { schluessel: 'positionen', kopf: 'Vorgänge', numerisch: true, zelle: (z) => z.positionen },
            { schluessel: 'fotos', kopf: 'Fotos', numerisch: true, zelle: (z) => z.fotos },
            {
              schluessel: 'korrektur',
              kopf: 'Korrektur',
              zelle: (z) => (z.ersetzt_durch_id !== null
                ? <span className="text-warning">ersetzt</span>
                : z.ersetzt_id !== null
                  ? <span className="text-text-muted">Ersatztag</span>
                  : '—'),
            },
          ]}
        />
      )}

      <p className="mt-s4 max-w-prose text-xs text-text-subtle">
        Stornierte Tage bleiben sichtbar. Ein Bautagebuch, aus dem sich die
        falsche Seite entfernen lässt, beweist nichts — erst das Nebeneinander
        von Irrtum und Richtigstellung tut es (LEG-01).
      </p>
    </PortalRahmen>
  );
}
