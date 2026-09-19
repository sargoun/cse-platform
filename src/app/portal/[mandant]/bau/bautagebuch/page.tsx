import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { listeBautage, type BautagKopfZeile } from '@/server/services/bau/bautagebuch';
import { BAUTAG_PILLE, BAUTAG_STATUS_TEXT } from '../bautagebuch-anzeige';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/bautagebuch` — alle Bautage, über die Projekte
 * hinweg (BAU-07, Seitenkarte §5.9).
 *
 * Die Liste beantwortet die Frage, die auf Projektebene nicht zu stellen ist:
 * **welcher Tag steht noch als Entwurf offen?** Ein nicht abgeschlossener
 * Bautag ist eine Seite, die sich noch ändern lässt — und je länger er offen
 * steht, desto weniger ist er im Streitfall wert. Genau dafür trägt 0082 den
 * Index `bautagebuch_offen_idx` (REP-05).
 */
export const dynamic = 'force-dynamic';

export default async function BautagebuchUeberProjekte(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<{ offen?: string }>;
  },
) {
  const { mandant } = await params;
  const { offen } = await searchParams;
  const nurOffene = offen === '1';
  const pfad = `/portal/${mandant}/bau/bautagebuch`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: der Bautag `…/bautagebuch/[datum]` verlangt laut Manifest
     `bau.schreiben`, diese Liste nur `bau.lesen` — eine `kunde` sah jeden Tag
     als Verweis und bekam dahinter ein 404. Ein Verweis auf 404 verraet, was
     er nicht zeigen darf (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'bau.schreiben');

  const tage = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => listeBautage(kontext, { nurOffene })),
  ) as Promise<readonly BautagKopfZeile[]>);

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
            Alle Baustellen · {nurOffene ? 'nur offene Tage' : 'alle Tage'}
          </p>
        </div>
        {/*
          * Die Adresse steht AUSGESCHRIEBEN und nicht als Variable: die
          * typisierten Routen von Next prüfen ein Vorlagenliteral gegen die
          * bekannten Muster, und eine Variable vom Typ `string` erfüllt keines
          * — der Filterlink wäre dann der einzige ungeprüfte Link der Seite.
          */}
        <Link
          href={nurOffene
            ? `/portal/${mandant}/bau/bautagebuch`
            : `/portal/${mandant}/bau/bautagebuch?offen=1`}
          className="rounded-md border border-line px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          {nurOffene ? 'Alle Tage zeigen' : 'Nur offene Tage'}
        </Link>
      </div>

      {tage.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {nurOffene
            ? 'Kein Bautag steht als Entwurf offen.'
            : 'Es ist noch kein Bautag erfasst.'}
        </p>
      ) : (
        <DataTable
          beschriftung="Bautage aller Baustellen"
          zeilen={tage}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'datum',
              kopf: 'Tag',
              zelle: (z) => (darf['bau.schreiben'] === true ? (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/bautagebuch/${z.datum}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.datum_lokal}
                </Link>
              ) : z.datum_lokal),
            },
            {
              schluessel: 'projekt',
              kopf: 'Baustelle',
              zelle: (z) => `${z.projekt_nummer} · ${z.projekt}`,
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={z.storniert ? 'Archiviert' : BAUTAG_PILLE[z.status] ?? 'Entwurf'} />
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
            { schluessel: 'fotos', kopf: 'Fotos', numerisch: true, zelle: (z) => z.fotos },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
