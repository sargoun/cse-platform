import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { listeSeiten, type SeiteZeile } from '@/server/services/inhalt/redaktion';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { WebsiteSpruenge } from '../spruenge';

/**
 * `/portal/[mandant]/website/seiten` — die Seiten des öffentlichen Auftritts
 * (§5.21, PUB-07).
 *
 * **Warum es diese Seite geben muss.** Der Auftritt liest seine Texte aus
 * `seite`/`abschnitt`. Ohne diesen Bildschirm ändert sie niemand ausser über
 * `pnpm content:import` — also über einen Entwickler, für jeden Tippfehler.
 *
 * **Die Gruppenseiten stehen mit in der Liste** (Startseite, Impressum,
 * Datenschutz). Sie gehören keiner Gesellschaft und tragen deshalb das Schild
 * „Gruppe": wer dort etwas ändert, ändert es für alle vier.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Seiten' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

export default async function WebsiteSeiten(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/website/seiten`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const seiten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => listeSeiten(kontext))
  ) as Promise<readonly SeiteZeile[]>);

  return (
    <PortalRahmen
      titel="Seiten"
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="seiten"
                       sitzung={zugang.sitzung} />
      <h1 className="mb-s4 text-h1 text-text">Seiten</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Was hier veröffentlicht ist, steht auf dem öffentlichen Auftritt. Ein
        Entwurf ist für Besucher nicht vorhanden — nicht leer, sondern 404.
      </p>

      {seiten.length === 0 ? (
        <Hinweis art="hinweis" cse="keine-seiten">
          Für diese Gesellschaft ist noch keine Seite angelegt. `pnpm content:import`
          legt den Erstbestand an; danach wird hier gepflegt.
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Seiten des öffentlichen Auftritts"
          zeilen={[...seiten]}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'pfad', kopf: 'Adresse',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/website/seiten/${z.id}`}
                  data-cse="seite"
                  data-pfad={z.pfad}
                  className="font-mono text-sm text-text underline hover:text-brand"
                >
                  {z.pfad}
                </Link>
              ),
            },
            { schluessel: 'titel', kopf: 'Titel', zelle: (z) => z.titel },
            {
              schluessel: 'sprache', kopf: 'Sprache',
              zelle: (z) => (
                <span className="font-mono text-xs uppercase text-text-muted">{z.sprache}</span>
              ),
            },
            {
              schluessel: 'gehoert', kopf: 'Gehört',
              zelle: (z) => (
                <span className="text-sm text-text-muted">
                  {z.bereichSlug ?? 'Gruppe'}
                </span>
              ),
            },
            {
              schluessel: 'abschnitte', kopf: 'Abschnitte', numerisch: true,
              zelle: (z) => z.abschnitte,
            },
            {
              schluessel: 'status', kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={z.status === 'veroeffentlicht' ? 'Aktiv' : 'Entwurf'} />
                  {z.veroeffentlichtAm !== null && (
                    <span className="text-xs text-text-muted">
                      {BERLIN.format(new Date(z.veroeffentlichtAm))}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
