import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { listeProjekte, type ProjektZeile } from '@/server/services/bau/lv';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte` — die Bauprojekte (OPS-05, BAU-01).
 *
 * Ein Projekt IST ein Auftrag mit einer Bauerweiterung (03-GEWERKE §7.1), und
 * die Liste zeigt deshalb die zwei Dinge, die es zum Bauprojekt machen: die
 * **Vertragsgrundlage** — VOB/B oder BGB entscheidet ueber Nachtrag,
 * Behinderung, Abnahme und Gewaehrleistung — und die Frage, ob schon ein
 * Leistungsverzeichnis und Aufmasse daran haengen.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant',
  in_arbeit: 'In Arbeit',
  // DESIGN §5 kennt „Abgenommen" nicht; 03-GEWERKE §3.5 hat die Zeile
  // beantragt. Bis sie dort steht, traegt die Pille das naechstliegende Wort
  // des geschlossenen Vokabulars und die Spalte daneben das genaue.
  abgenommen: 'Bereit',
  abgeschlossen: 'Abgeschlossen',
  archiviert: 'Archiviert',
};

const ART_TEXT: Readonly<Record<string, string>> = {
  hochbau: 'Hochbau', ausbau: 'Ausbau', rueckbau: 'Rückbau',
};

const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  vob_b: 'VOB/B', bgb: 'BGB',
};

export default async function Projektliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/bau/projekte`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => listeProjekte(kontext)),
  ) as Promise<readonly ProjektZeile[]>);

  return (
    <PortalRahmen
      titel="Bauprojekte"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Bauprojekte</h1>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Bauprojekt angelegt. Ein Projekt entsteht aus einem Auftrag —
          es ist dessen bauliche Erweiterung, kein zweiter Vorgang daneben.
        </p>
      ) : (
        <DataTable
          beschriftung="Bauprojekte"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.nummer },
            {
              schluessel: 'bezeichnung',
              kopf: 'Projekt',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.id}/lv`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.bezeichnung}
                </Link>
              ),
            },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde },
            { schluessel: 'art', kopf: 'Gewerk', zelle: (z) => ART_TEXT[z.art] ?? z.art },
            {
              schluessel: 'grundlage',
              kopf: 'Vertrag',
              zelle: (z) => GRUNDLAGE_TEXT[z.vertragsgrundlage] ?? z.vertragsgrundlage,
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Geplant'} />,
            },
            {
              schluessel: 'frist',
              kopf: 'Soll-Ende',
              numerisch: true,
              zelle: (z) => z.soll_ende_lokal ?? '—',
            },
            {
              schluessel: 'aufmass',
              kopf: 'Aufmaße',
              numerisch: true,
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.id}/aufmass`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.aufmass_anzahl}
                </Link>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
