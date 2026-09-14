import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mitLesekontext } from '../../reinigung/daten';
import { listeReklamationen, type ReklamationZeile }
  from '@/server/services/reinigung/reklamation';

/**
 * `/portal/[mandant]/qualitaet/reklamationen` — die Beanstandungen (OPS-11,
 * SPEC §22).
 *
 * **Qualität steht NEBEN den Gewerken, nicht darin.** Eine Beschwerde über
 * einen Wachmann ist dieselbe Zeile wie eine über eine Reinigungsrunde; sie
 * unter `reinigung` abzulegen hiesse, die Reklamationen der SSE Security im
 * Modul einer anderen Gesellschaft zu führen (04-SEITENKARTE.md §5.6).
 *
 * **Die Spalte „Bestrittener Nachweis" ist die, um die es geht.** Sie
 * verbindet die Beschwerde mit dem Dokument, das der Kunde unterschrieben hat
 * — und genau diese Verbindung entscheidet vor einer Rechnungsfreigabe, ob ein
 * Streitfall offen ist (FIN-18).
 *
 * **Keine Frist steht hier**, solange O-14 unbeantwortet ist: `faellig_am`
 * bleibt leer, weil kein Job und kein Auslöser eine Frist aus der Priorität
 * ableitet. Eine abgeleitete Frist wäre ein Versprechen an den Kunden, das
 * niemand gegeben hat.
 */
export const dynamic = 'force-dynamic';

/**
 * Die vorhandenen Pillen aus DESIGN §5. „Behoben" und „Geschlossen" fehlen
 * dem Vokabular; `03-GEWERKE.md` §3.5 beantragt beide. Bis dahin wird
 * abgebildet statt erfunden.
 */
const PILLE: Readonly<Record<string, PillZustand>> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  behoben: 'Bereit',
  abgelehnt: 'Abgelehnt',
  geschlossen: 'Abgeschlossen',
};

export default async function ReklamationsListe({
  params,
}: {
  params: Promise<{ mandant: string }>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/qualitaet/reklamationen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await mitLesekontext(sitzung, async (k) => listeReklamationen(k));
  const offen = zeilen.filter((z) => z.status === 'offen' || z.status === 'in_arbeit').length;
  const mitNachweis = zeilen.filter((z) => z.leistungsnachweisId !== null).length;

  return (
    <PortalRahmen
      titel="Reklamationen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="qualitaet"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Reklamationen</h1>
        <Link href={`/portal/${mandant}/qualitaet/reklamationen/neu`} className="text-sm underline hover:text-text">
          Beanstandung aufnehmen
        </Link>
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <KpiStat label="Vorgänge" wert={String(zeilen.length)} icon="dokument" ton="info" />
        <KpiStat
          label="Offen"
          wert={String(offen)}
          icon="warnung"
          ton={offen === 0 ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Bestreiten einen Nachweis"
          wert={String(mitNachweis)}
          icon="rechnung"
          ton={mitNachweis === 0 ? 'muted' : 'warning'}
        />
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine Beanstandung erfasst. Das heisst: keine ist eingegangen — nicht,
          dass alles in Ordnung wäre.
        </p>
      ) : (
        <DataTable<ReklamationZeile>
          beschriftung="Reklamationen mit Objekt, Zustand und bestrittenem Nachweis"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (z) => (
                <Link href={`/portal/${mandant}/qualitaet/reklamationen/${z.id}`} className="underline hover:text-text">
                  {z.nummer}
                </Link>
              ),
            },
            { schluessel: 'objekt', kopf: 'Objekt', zelle: (z) => z.objekt ?? '—' },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde ?? '—' },
            {
              schluessel: 'eingang',
              kopf: 'Eingang (Berlin)',
              zelle: (z) => z.eingangAmLokal,
            },
            {
              schluessel: 'nachweis',
              kopf: 'Bestrittener Nachweis',
              zelle: (z) => (z.leistungsnachweisId === null
                ? '—'
                : (
                  <Link
                    href={`/portal/${mandant}/reinigung/leistungsnachweise/${z.leistungsnachweisId}`}
                    className="underline hover:text-text"
                  >
                    {z.leistungsnachweisNummer ?? 'Nachweis'}
                  </Link>
                )),
            },
            {
              schluessel: 'nacharbeit',
              kopf: 'Nacharbeit',
              zelle: (z) => z.nacharbeitDatum ?? '—',
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Offen'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
