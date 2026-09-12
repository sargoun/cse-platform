import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  NACHTRAG_WACHFRIST_TAGE, listeNachtraege, type NachtragZeile,
} from '@/server/services/bau/nachtrag';
import { ladeAusserhalbLv, type AusserhalbLvWarnung }
  from '@/server/services/bau/ausserhalb-lv';
import { NACHTRAG_PILLE, NACHTRAG_STATUS_TEXT } from '../nachtrag-anzeige';
import { AusserhalbLvWarnungen } from '../AusserhalbLvWarnungen';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/nachtraege` — alle Nachträge über die Projekte
 * hinweg, mit dem Filter „angemeldet, aber nicht eingereicht" (BAU-04,
 * BAU-05, Seitenkarte §5.9).
 *
 * Die Liste beantwortet die Frage, die auf Projektebene nicht zu stellen ist:
 * **welcher Anspruch ist angekündigt und liegt seither?** Ein Nachtrag in
 * diesem Zustand ist Geld, das nicht fällig wird — und nach
 * {@link NACHTRAG_WACHFRIST_TAGE} Tagen wählt ihn die SPEC-§14-Wache aus. Sie
 * meldet **einmal**; diese Seite zeigt ihn, solange er offen ist.
 *
 * Der Filter läuft als `?offen=1` über einen `GET`-Link und nicht über
 * JavaScript: eine Liste, die erst nach einem Skriptdownload filtert, filtert
 * auf einem Baustellentelefon gar nicht.
 */
export const dynamic = 'force-dynamic';

export default async function NachtraegeUeberProjekte(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<{ offen?: string }>;
  },
) {
  const { mandant } = await params;
  const { offen = '' } = await searchParams;
  const nurOffen = offen === '1';
  const pfad = `/portal/${mandant}/bau/nachtraege`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      nachtraege: await listeNachtraege(kontext, { nurOffen }),
      warnungen: await ladeAusserhalbLv(kontext),
    })),
  ) as Promise<{
    nachtraege: readonly NachtragZeile[];
    warnungen: readonly AusserhalbLvWarnung[];
  }>);

  const ueberfaellig = daten.nachtraege.filter((n) => n.ueberfaellig);

  return (
    <PortalRahmen
      titel="Nachträge"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Nachträge</h1>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">
        {ueberfaellig.length === 0
          ? `Kein Nachtrag liegt länger als ${String(NACHTRAG_WACHFRIST_TAGE)} Tage `
            + 'angemeldet und nicht eingereicht.'
          : `${String(ueberfaellig.length)} Nachtrag/Nachträge sind seit mehr als `
            + `${String(NACHTRAG_WACHFRIST_TAGE)} Tagen angemeldet und nicht eingereicht. `
            + 'Solange die Kalkulation fehlt, wird nichts fällig.'}
      </p>

      <p className="mb-s5 flex flex-wrap gap-s3 text-sm">
        <Link
          href={`/portal/${mandant}/bau/nachtraege`}
          aria-current={nurOffen ? undefined : 'page'}
          className={nurOffen
            ? 'text-text-muted underline-offset-2 hover:text-text hover:underline'
            : 'font-semibold text-text'}
        >
          Alle
        </Link>
        <Link
          href={`/portal/${mandant}/bau/nachtraege?offen=1`}
          aria-current={nurOffen ? 'page' : undefined}
          className={nurOffen
            ? 'font-semibold text-text'
            : 'text-text-muted underline-offset-2 hover:text-text hover:underline'}
          data-cse="filter-offen"
        >
          Angemeldet, nicht eingereicht
        </Link>
      </p>

      <AusserhalbLvWarnungen
        warnungen={daten.warnungen}
        mandant={mandant}
        projektId={null}
      />

      {daten.nachtraege.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {nurOffen
            ? 'Kein Nachtrag ist angemeldet und noch nicht eingereicht.'
            : 'Es ist kein Nachtrag angemeldet.'}
        </p>
      ) : (
        <DataTable
          beschriftung="Nachträge über alle Projekte"
          zeilen={daten.nachtraege}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'projekt',
              kopf: 'Projekt',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/nachtraege`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.projekt}
                </Link>
              ),
            },
            { schluessel: 'nummer', kopf: 'Nr.', zelle: (z) => z.nummer },
            {
              schluessel: 'titel',
              kopf: 'Titel',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/nachtraege/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.titel}
                </Link>
              ),
            },
            {
              schluessel: 'grundlage',
              kopf: 'Grundlage',
              zelle: (z) => z.grundlage_fundstelle,
            },
            {
              schluessel: 'angemeldet',
              kopf: 'Angemeldet',
              zelle: (z) => z.angemeldet_lokal ?? (
                <span className="text-warning">nicht angekündigt</span>
              ),
            },
            {
              schluessel: 'eingereicht',
              kopf: 'Eingereicht',
              zelle: (z) => z.eingereicht_lokal ?? (
                <span className={z.ueberfaellig ? 'text-danger' : 'text-text-muted'}>
                  {z.offen_seit_tagen === null
                    ? '—'
                    : `offen seit ${String(z.offen_seit_tagen)} Tagen`}
                </span>
              ),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill
                    zustand={z.ueberfaellig
                      ? 'Überfällig'
                      : NACHTRAG_PILLE[z.status] ?? 'Offen'}
                  />
                  <span className="text-xs text-text-muted">
                    {NACHTRAG_STATUS_TEXT[z.status] ?? z.status}
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
