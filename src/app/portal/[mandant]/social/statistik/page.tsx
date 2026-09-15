import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { type SocialStatistik, statistik } from '@/server/services/social/dienst';
import { PLATTFORM_NAME } from '@/server/services/social/port';
import { STATUS_TEXT, type BeitragStatus } from '@/server/services/social/weg';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/social/statistik` — **was diese Plattform weiss, und was
 * nicht** (SOC-01).
 *
 * **Reichweite und Interaktionen stehen hier nicht.** Die kennt nur die
 * Plattform, auf der ein Beitrag steht; solange keine verbunden ist (O-10),
 * gibt es sie nicht. Eine Null dafür läse sich wie eine Messung — „nicht
 * verbunden" ist die Wahrheit, und sie steht so da.
 *
 * Was hier steht, ist das Eigene: was wartet, was hinausging, wo es liegen
 * blieb, und wie lange eine Freigabe braucht.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Statistik — Social Media' };

const STAENDE: readonly BeitragStatus[] = [
  'entwurf', 'vorgelegt', 'freigegeben', 'geplant', 'veroeffentlicht',
  'abgelehnt', 'zurueckgezogen',
];

export default async function Statistik(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/social/statistik`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const s = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) =>
      statistik(kontext))) as Promise<SocialStatistik>);

  const liegenGeblieben = s.jeKanal.reduce((n, k) => n + k.nichtVerbunden, 0);
  const dauer = s.pruefdauerStunden === null
    ? '—'
    : `${s.pruefdauerStunden.toFixed(1).replace('.', ',')} h`;

  return (
    <PortalRahmen
      titel="Statistik"
      wurzelTitel="Social Media"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Statistik</h1>
        <Link href={`/portal/${mandant}/social`}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
          Zum Center
        </Link>
      </div>

      <div data-cse="statistik-kennzahlen" className="mb-s5 grid grid-cols-2 gap-s3 lg:grid-cols-4">
        <KpiStat label="Auf der eigenen Seite" wert={String(s.aufWebsite)} />
        <KpiStat label="In Prüfung" wert={String(s.jeStatus['vorgelegt'] ?? 0)} />
        <KpiStat label="Liegen geblieben" wert={String(liegenGeblieben)} />
        <KpiStat label="Prüfdauer (Median)" wert={dauer} />
      </div>

      <Hinweis art="hinweis" cse="statistik-keine-reichweite" className="mb-s5 max-w-prose">
        <strong>Reichweite und Interaktionen stehen hier nicht.</strong> Sie kommen von der
        Plattform, auf der ein Beitrag steht — und solange keine verbunden ist, gibt es sie
        nicht. Eine Null dafür läse sich wie eine Messung; das hier ist eine Auskunft
        darüber, was diese Plattform selbst weiss.
      </Hinweis>

      <section className="mb-s6">
        <h2 className="mb-s3 text-h2 text-text">Nach Stand</h2>
        <ul data-cse="statistik-staende" className="flex flex-col gap-s2">
          {STAENDE.map((st) => (
            <li key={st} data-cse="statistik-stand" data-status={st}
                className="flex items-baseline justify-between gap-s3 border-b border-line py-s2">
              <span className="text-sm text-text">{STATUS_TEXT[st]}</span>
              <span className="text-sm tabular-nums text-text-muted">
                {String(s.jeStatus[st] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-s3 text-h2 text-text">Je Kanal</h2>
        <ul data-cse="statistik-kanaele" className="flex flex-col gap-s2">
          {s.jeKanal.map((k) => (
            <li key={k.plattform} data-cse="statistik-kanal" data-plattform={k.plattform}
                className="flex flex-wrap items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s3">
              <span className="text-sm text-text">{PLATTFORM_NAME[k.plattform]}</span>
              <span className="flex flex-wrap items-center gap-s3 text-xs text-text-subtle">
                <span>{String(k.veroeffentlicht)} veröffentlicht</span>
                <span>{String(k.nichtVerbunden)} liegen geblieben</span>
                <span>{String(k.fehlgeschlagen)} fehlgeschlagen</span>
                <StatusPill zustand={k.verbunden ? 'Aktiv' : 'Inaktiv'} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </PortalRahmen>
  );
}
