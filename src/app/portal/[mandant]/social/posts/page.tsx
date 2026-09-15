import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable, type Spalte } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { type BeitragZeile, listeBeitraege } from '@/server/services/social/dienst';
import { type BeitragStatus, STATUS_TEXT } from '@/server/services/social/weg';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/social/posts` — Entwurf · In Prüfung · Freigegeben ·
 * Geplant · Veröffentlicht (SOC-02, SOC-03).
 *
 * **Der Filter steht in der Adresse, nicht im Zustand einer Komponente.** Eine
 * gefilterte Liste ist damit ein Link, den jemand weitergeben kann — genau wie
 * bei den Berichten (REP-*). Ein Filter, der nur im Browser lebt, lässt sich
 * nicht in eine Nachricht kopieren, und dann schickt man Screenshots.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Beiträge — Social Media' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const ART: Readonly<Record<string, string>> = {
  beitrag: 'Beitrag', projektschau: 'Projektschau',
  neuigkeit: 'Neuigkeit', aktualisierung: 'Aktualisierung',
};

const FILTER: readonly BeitragStatus[] = [
  'entwurf', 'vorgelegt', 'freigegeben', 'geplant', 'veroeffentlicht',
];

export default async function Beitraege(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/social/posts`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const suche = await searchParams;
  const roh = suche['status'];
  const status = typeof roh === 'string' && (FILTER as readonly string[]).includes(roh)
    ? roh as BeitragStatus : null;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) =>
      listeBeitraege(kontext, status === null ? {} : { status }))
  ) as Promise<readonly BeitragZeile[]>);

  const knopf = (aktiv: boolean): string =>
    'inline-flex min-h-11 items-center rounded-md border px-s4 py-s3 text-sm '
    + (aktiv ? 'border-brand bg-surface-3 text-text' : 'border-line text-text hover:bg-surface-2');

  const spalten: readonly Spalte<BeitragZeile>[] = [
    {
      schluessel: 'titel', kopf: 'Beitrag',
      zelle: (z) => (
        <div className="min-w-0">
          <Link href={`/portal/${mandant}/social/posts/${z.id}`}
                className="text-text underline underline-offset-4 hover:text-brand">
            {z.titel}
          </Link>
          <div className="mt-s1 text-xs text-text-subtle">
            {ART[z.art] ?? z.art}
            {z.projektId === null ? '' : ' · aus einem Projekt'}
            {z.referenzId === null ? '' : ' · aus einer Referenz'}
          </div>
        </div>
      ),
    },
    {
      schluessel: 'status', kopf: 'Stand',
      zelle: (z) => (
        <span data-cse="beitrag-status" data-status={z.status} className="text-sm text-text-muted">
          {STATUS_TEXT[z.status] ?? z.status}
        </span>
      ),
    },
    {
      schluessel: 'wann', kopf: 'Geplant / draussen',
      zelle: (z) => {
        const wann = z.veroeffentlichtAm ?? z.geplantFuer;
        return wann === null
          ? <span className="text-text-subtle">—</span>
          : <span className="text-sm">{BERLIN.format(new Date(wann))}</span>;
      },
    },
  ];

  return (
    <PortalRahmen
      titel="Beiträge"
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
        <h1 className="text-h1 text-text">Beiträge</h1>
        <Link href={`/portal/${mandant}/social/posts/neu`} className={knopf(false)}
              data-cse="beitrag-neu">
          Neuer Beitrag
        </Link>
      </div>

      <nav aria-label="Nach Stand filtern" className="mb-s5 flex flex-wrap gap-s2">
        <Link href={`/portal/${mandant}/social/posts`} className={knopf(status === null)}
              data-cse="filter-alle">Alle</Link>
        {FILTER.map((s) => (
          <Link key={s} href={`/portal/${mandant}/social/posts?status=${s}`}
                className={knopf(status === s)} data-cse={`filter-${s}`}>
            {STATUS_TEXT[s]}
          </Link>
        ))}
      </nav>

      {zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="beitraege-leer" className="max-w-prose">
          {status === null
            ? 'Noch kein Beitrag. Ein Entwurf entsteht über „Neuer Beitrag" und geht von dort '
              + 'durch Prüfung und Freigabe — nicht direkt hinaus.'
            : `Kein Beitrag mit dem Stand „${STATUS_TEXT[status]}".`}
        </Hinweis>
      ) : (
        <DataTable
          spalten={spalten}
          zeilen={zeilen}
          schluessel={(z) => z.id}
          beschriftung="Beiträge mit Stand und Zeitpunkt"
        />
      )}
    </PortalRahmen>
  );
}
