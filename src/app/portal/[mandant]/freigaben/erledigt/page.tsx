import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ladeErledigte, type ErledigtZeile } from '@/server/services/freigabe/pruefdauer';
import { STATUS_LABEL, STATUS_PILL, ausfuehrungText, zeitpunkt } from '../darstellung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/freigaben/erledigt` — was entschieden wurde, mit dem
 * Beweis daneben (APR-07, SEC-A9, LEG-01, `04-SEITENKARTE.md` §5.20).
 *
 * **Die Kettennummer und der Hash stehen in der Liste, nicht erst im Detail.**
 * Eine Geschichte entschiedener Vorgänge ohne ihren Beweis ist ein Protokoll,
 * dem man glauben muss; mit ihm ist sie nachprüfbar. Der Hash steht gekürzt —
 * die vollen 64 Zeichen stehen auf der Prüfseite, wo sie sich vergleichen
 * lassen.
 */
export const dynamic = 'force-dynamic';

export default async function Erledigt(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/freigaben/erledigt`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return (
      <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant}
                    zielSlug={tor.ziel} zurueck={tor.zurueck} />
    );
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'freigabe.entscheiden');
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) =>
      ladeErledigte(kontext)))) as readonly ErledigtZeile[];

  return (
    <PortalRahmen
      titel="Entschieden"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="freigaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Entschieden</h1>
        <Link
          href={`/portal/${mandant}/freigaben`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zum Posteingang
        </Link>
      </div>

      <p className="mb-s6 max-w-prose text-sm text-text-muted">
        Jede Entscheidung mit ihrem Schnappschuss: Kettennummer und Hash über
        genau das, was vorlag. Der Schnappschuss ist unveränderlich — eine
        Korrektur ist eine neue Freigabe, keine Änderung dieser Zeile.
      </p>

      {zeilen.length === 0 ? (
        <p
          data-cse="erledigt-leer"
          className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
        >
          Noch nichts entschieden.
        </p>
      ) : (
        <DataTable
          beschriftung="Entschiedene Freigaben mit ihrem Schnappschuss"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'titel', kopf: 'Vorgang',
              /*
               * Die Pruefseite `/freigaben/[id]` verlangt `freigabe.entscheiden`
               * (Manifest); diese Liste nur `freigabe.lesen`. Wer liest und nicht
               * entscheidet, sah je Zeile einen Verweis mit 404 dahinter (AUT-06;
               * D-581) — jetzt den Titel als Text.
               */
              zelle: (z) => darf['freigabe.entscheiden'] === true ? (
                <Link href={`/portal/${mandant}/freigaben/${z.id}`}
                      className="text-sm text-text underline underline-offset-2">
                  {z.titel ?? 'ohne Titel'}
                </Link>
              ) : (z.titel ?? 'ohne Titel'),
            },
            {
              schluessel: 'status', kopf: 'Entscheidung',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2"
                      data-cse="erledigt-status" data-status={z.status}>
                  <StatusPill zustand={STATUS_PILL[z.status as keyof typeof STATUS_PILL]} />
                  <span className="text-sm text-text">
                    {STATUS_LABEL[z.status as keyof typeof STATUS_LABEL] ?? z.status}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'wer', kopf: 'Von · wann',
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-sm text-text">{z.entschiedenVon ?? '—'}</span>
                  <span className="text-xs text-text-subtle">{zeitpunkt(z.entschiedenAm)}</span>
                </span>
              ),
            },
            {
              schluessel: 'ausfuehrung', kopf: 'Ausführung',
              zelle: (z) => (
                <span className="text-sm text-text-muted" data-cse="erledigt-ausfuehrung">
                  {z.status === 'genehmigt' ? ausfuehrungText(z.ausfuehrungStatus, '') : '—'}
                </span>
              ),
            },
            {
              schluessel: 'beweis', kopf: 'Kettenglied',
              zelle: (z) => (
                z.hash === null
                  ? <span className="text-sm text-text-subtle">kein Schnappschuss</span>
                  : (
                    <span className="inline-flex flex-col gap-s1" data-cse="erledigt-kettenglied">
                      <span className="text-sm text-text">Nr. {z.ketteNr}</span>
                      <code className="text-xs text-text-subtle">{z.hash.slice(0, 16)}…</code>
                    </span>
                  )
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
