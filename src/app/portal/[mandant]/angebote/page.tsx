import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/angebote` — die Angebotsliste (OPS-08).
 *
 * Die Statusabbildung steht hier und nicht im Datenmodell: DESIGN §5 fuehrt
 * ein FESTES Vokabular, und ein Zustand des Angebots, der keine Pille hat,
 * waere eine erfundene Beschriftung an der Oberflaeche.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  in_pruefung: 'In Prüfung',
  versendet: 'Angebot',
  angenommen: 'Aktiv',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
  abgelaufen: 'Überfällig',
};

interface AngebotZeile {
  readonly id: string;
  readonly angebotsnummer: string | null;
  readonly titel: string;
  readonly kunde: string;
  readonly status: string;
  readonly netto_cent: string;
  readonly gueltig_bis: string | null;
  readonly hat_auftrag: boolean;
}

export default async function Angebotsliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/angebote`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<AngebotZeile>(

      `select a.id, a.angebotsnummer, a.titel, k.name as kunde, a.status::text as status,
              a.netto_cent::text, to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
              exists (select 1 from auftrag t where t.angebot_id = a.id) as hat_auftrag
         from angebot a join kunde k on k.id = a.kunde_id
        where a.archiviert_am is null
        order by a.erstellt_am desc`,
    ))) as Promise<readonly AngebotZeile[]>);

  return (
    <PortalRahmen
      titel="Angebote"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Angebote</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Angebot' : `${String(zeilen.length)} Angebote`}
        </p>
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Angebot. Ein Reinigungsangebot entsteht aus dem Raumbuch
          eines Objekts — dort steht der Knopf.
        </p>
      ) : (
        <DataTable
          beschriftung="Angebote dieser Gesellschaft mit Kunde, Status und Nettosumme"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'titel',
              kopf: 'Angebot',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/angebote/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.titel}
                </Link>
              ),
            },
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (z) => z.angebotsnummer ?? (
                <span className="text-text-subtle">ohne — Entwurf</span>
              ),
            },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde },
            {
              schluessel: 'netto',
              kopf: 'Netto',
              numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.netto_cent))),
            },
            {
              schluessel: 'gueltig',
              kopf: 'Bindefrist',
              zelle: (z) => z.gueltig_bis ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={PILLE[z.status] ?? 'Entwurf'} />
                  {z.hat_auftrag ? (
                    <span className="text-xs text-text-muted">→ Auftrag</span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
