import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ladeLaufende, type LaufendeZeile } from '@/server/services/freigabe/pruefdauer';
import { RISIKO_LABEL } from '../darstellung';

/**
 * `/portal/[mandant]/freigaben/laufend` — was gleich hinausgeht (APR-05,
 * APR-06, `04-SEITENKARTE.md` §5.20).
 *
 * **Entschieden, aber noch nicht geschehen.** Der Posteingang zeigt, was auf
 * eine Entscheidung wartet; hier steht, was auf die UHR wartet: ein
 * Einspruchsfenster, das noch läuft, oder eine Ausführung, die sich noch
 * zurücknehmen lässt. Die Restzeit steht als Zeitpunkt in Berliner Ortszeit,
 * nicht als tickender Zähler — eine Zahl, die im Bildschirm herunterläuft,
 * verlangt eine Client-Komponente und einen Neuaufbau, und beide erzählen
 * nichts, was der Zeitpunkt nicht sagt.
 */
export const dynamic = 'force-dynamic';

/** Fensterfristen werden in Berliner Ortszeit angezeigt (Invariante 2, K-11). */
const ZEIT = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

function verbleibend(bis: Date, jetzt: Date): string {
  const minuten = Math.max(0, Math.round((bis.getTime() - jetzt.getTime()) / 60_000));
  if (minuten < 60) return `noch ${String(minuten)} Min.`;
  const stunden = Math.floor(minuten / 60);
  return `noch ${String(stunden)} Std. ${String(minuten % 60)} Min.`;
}

export default async function Laufend(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/freigaben/laufend`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return (
      <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant}
                    zielSlug={tor.ziel} zurueck={tor.zurueck} />
    );
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const jetzt = new Date();
  const zeilen = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) =>
      ladeLaufende(kontext)))) as readonly LaufendeZeile[];

  return (
    <PortalRahmen
      titel="Laufende Fenster"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="freigaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Laufende Fenster</h1>
        <Link
          href={`/portal/${mandant}/freigaben`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zum Posteingang
        </Link>
      </div>

      <p className="mb-s6 max-w-prose text-sm text-text-muted">
        Entschieden, aber noch nicht abgeschlossen: ein Einspruchsfenster, das
        noch läuft (APR-05), oder eine Ausführung, die sich noch zurücknehmen
        lässt (APR-06). Der Weg dorthin führt über die Prüfseite — dort steht,
        worüber entschieden wurde.
      </p>

      {zeilen.length === 0 ? (
        <p
          data-cse="laufend-leer"
          className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
        >
          Kein Fenster läuft. Was genehmigt war, ist ausgelöst; was ausgeführt
          war, steht fest.
        </p>
      ) : (
        <DataTable
          beschriftung="Freigaben in einem laufenden Fenster"
          zeilen={zeilen}
          schluessel={(z) => `${z.art}:${z.id}`}
          spalten={[
            {
              schluessel: 'titel', kopf: 'Vorgang',
              zelle: (z) => (
                <Link href={`/portal/${mandant}/freigaben/${z.id}`}
                      className="text-sm text-text underline underline-offset-2">
                  {z.titel ?? 'ohne Titel'}
                </Link>
              ),
            },
            {
              schluessel: 'art', kopf: 'Fenster',
              zelle: (z) => (
                <span className="text-sm text-text" data-cse="laufend-art" data-art={z.art}>
                  {z.art === 'einspruch' ? 'Einspruch möglich' : 'Rücknahme möglich'}
                </span>
              ),
            },
            {
              schluessel: 'risiko', kopf: 'Risiko',
              zelle: (z) => (
                <span className="text-sm text-text-muted">
                  {RISIKO_LABEL[z.risiko] ?? z.risiko}
                </span>
              ),
            },
            {
              schluessel: 'bis', kopf: 'Läuft bis',
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-sm text-text">{ZEIT.format(z.laeuftBis)}</span>
                  <span className="text-xs text-text-subtle" data-cse="laufend-rest">
                    {verbleibend(z.laeuftBis, jetzt)}
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
