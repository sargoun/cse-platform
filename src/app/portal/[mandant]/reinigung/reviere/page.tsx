import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ladeReviere, mitLesekontext, type RevierZeile } from '../daten';

/**
 * `/portal/[mandant]/reinigung/reviere` — die Arbeitszonen (CLN-01, OPS-02,
 * OPS-03).
 *
 * **Die Minutenspalte ist eine ZIELZEIT und die Seite sagt es.** `revier.
 * sollzeit_minuten` entsteht aus `Σ m² ÷ Leistungswert` und ist deshalb als
 * einzige Dauer dieser Plattform gebrochen (K-16(c)); jede GEMESSENE Dauer —
 * die gearbeiteten Minuten eines Zeiteintrags, eine Ruhezeit — bleibt
 * ganzzahlig, weil sie Beweismittel ist. Die beiden nebeneinander zu zeigen,
 * ohne zu sagen, welche welche ist, ist der Fehler, den K-16 verhindern will.
 *
 * **Und die Spalte „Summe Räume" steht daneben, weil sie gleich sein muss.**
 * Eine Zone, deren Räume in der Summe etwas anderes ergeben als ihr Kopf, ist
 * zweimal gerundet worden — ein Fehler ohne Ausnahme, der sich nur so zeigen
 * lässt: indem beide Zahlen nebeneinander stehen.
 */
export const dynamic = 'force-dynamic';

/** Punkt zu Komma — die Datenbank liefert Punkte, DESIGN §5 zeigt Kommas. */
function deutsch(wert: string | null): string {
  return wert === null ? '—' : wert.replace('.', ',');
}

export default async function ReviereListe({
  params,
}: {
  params: Promise<{ mandant: string }>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/reinigung/reviere`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const reviere = await mitLesekontext(sitzung, async (kontext) => ladeReviere(kontext));

  const ohneRaeume = reviere.filter((r) => r.anzahlRaeume === 0).length;
  const uneinig = reviere.filter(
    (r) => r.summeRaeume !== null && r.summeRaeume !== r.sollzeitMinuten,
  ).length;

  return (
    <PortalRahmen
      titel="Reviere"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Reviere</h1>
        <p className="m-0 text-sm text-text-muted">
          {reviere.length === 1 ? '1 Zone' : `${String(reviere.length)} Zonen`}
        </p>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Ein Revier ist die Fläche, die eine Reinigungskraft in einem Durchgang
        abarbeitet. Die Sollzeit ist ein <strong className="text-text">berechneter
        Zielwert</strong> aus Fläche und Leistungswert — keine gemessene Dauer.
      </p>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiStat label="Reviere" wert={String(reviere.length)} icon="objekt" ton="info" />
        <KpiStat
          label="Ohne Räume"
          wert={String(ohneRaeume)}
          icon="warnung"
          ton={ohneRaeume === 0 ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Summe weicht ab"
          wert={String(uneinig)}
          icon="fehler"
          ton={uneinig === 0 ? 'muted' : 'danger'}
        />
      </div>

      {reviere.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diese Gesellschaft ist noch keine Zone zugeschnitten. Ein Revier
          entsteht am Objekt — es ist die Einheit, gegen die der Dienstplan plant.
        </p>
      ) : (
        <DataTable<RevierZeile>
          beschriftung="Reviere mit Sollzeit und Raumzahl"
          zeilen={reviere}
          schluessel={(r) => r.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Revier',
              zelle: (r) => (
                <Link href={`/portal/${mandant}/reinigung/reviere/${r.id}`} className="underline hover:text-text">
                  {r.bezeichnung}
                  {r.kurzzeichen !== null && (
                    <span className="ml-s2 text-text-muted">({r.kurzzeichen})</span>
                  )}
                </Link>
              ),
            },
            { schluessel: 'objekt', kopf: 'Objekt', zelle: (r) => r.objekt },
            {
              schluessel: 'sollzeit',
              kopf: 'Sollzeit (Zielwert, Min.)',
              numerisch: true,
              zelle: (r) => deutsch(r.sollzeitMinuten),
            },
            {
              schluessel: 'summe',
              kopf: 'Summe Räume (Min.)',
              numerisch: true,
              zelle: (r) => (
                <span
                  className={
                    r.summeRaeume !== null && r.summeRaeume !== r.sollzeitMinuten
                      ? 'text-danger'
                      : ''
                  }
                >
                  {deutsch(r.summeRaeume)}
                  {r.summeRaeume !== null && r.summeRaeume !== r.sollzeitMinuten && (
                    <Icon
                      name="warnung"
                      groesse="sm"
                      className="ml-s2 inline-block align-[-2px]"
                    />
                  )}
                </span>
              ),
            },
            {
              schluessel: 'raeume',
              kopf: 'Räume',
              numerisch: true,
              zelle: (r) => String(r.anzahlRaeume),
            },
            {
              schluessel: 'aktiv',
              kopf: 'Aktiv',
              zelle: (r) => `${r.aktivAb}${r.aktivBis === null ? '' : ` – ${r.aktivBis}`}`,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
