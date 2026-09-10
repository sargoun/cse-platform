import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/** `/portal/[mandant]/auftraege` — was diese Gesellschaft ausfuehrt (OPS-05). */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant', aktiv: 'In Arbeit', pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen', storniert: 'Abgelehnt',
};

interface Zeile {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kunde: string;
  readonly objekt: string | null;
  readonly art: string;
  readonly status: string;
  readonly wert: string | null;
  readonly start: string;
  readonly laufzeit_bis: string | null;
}

export default async function Auftragsliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/auftraege`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<Zeile>(
      `select a.id, a.auftragsnummer, a.bezeichnung, k.name as kunde,
              o.bezeichnung as objekt, a.art::text as art, a.status::text as status,
              a.auftragswert_netto_cent::text as wert,
              to_char(a.start_datum, 'DD.MM.YYYY') as start,
              to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_bis
         from auftrag a
         join kunde k on k.id = a.kunde_id
         left join objekt o on o.id = a.objekt_id
        where a.archiviert_am is null
        order by a.start_datum desc`,
    ))) as Promise<readonly Zeile[]>);

  return (
    <PortalRahmen
      titel="Aufträge"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Aufträge</h1>
        <Link
          href={`/portal/${mandant}/auftraege/neu`}
          data-cse="auftrag-neu"
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
        >
          Neuer Auftrag
        </Link>
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Auftrag. Ein angenommenes Angebot wird mit einem Klick zu
          einem — oder Sie legen hier einen an.
        </p>
      ) : (
        <DataTable
          beschriftung="Aufträge dieser Gesellschaft"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Auftrag',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/auftraege/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.bezeichnung}
                </Link>
              ),
            },
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.auftragsnummer },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde },
            { schluessel: 'objekt', kopf: 'Objekt', zelle: (z) => z.objekt ?? '—' },
            {
              schluessel: 'wert', kopf: 'Wert netto', numerisch: true,
              zelle: (z) => (z.wert === null
                ? <span className="text-text-subtle">offen</span>
                : formatiereGeld(cent(BigInt(z.wert)))),
            },
            { schluessel: 'start', kopf: 'Start', zelle: (z) => z.start },
            {
              schluessel: 'status', kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Geplant'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
