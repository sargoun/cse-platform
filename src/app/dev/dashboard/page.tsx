import { notFound } from 'next/navigation';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withDevAdmin } from '@/server/kontext/dev';
import { registriereBerichtKacheln } from '@/server/services/bericht/kacheln';
import { dashboard } from '@/server/services/bericht/dashboard';
import { kacheln } from '@/server/registry/kennzahlen';
import { KachelRaster, type KachelAnzeige } from '@/components/portal/KachelRaster';

/**
 * Das Dashboard (DSH-01, DSH-02, DSH-03).
 *
 * **Der Bereichsfilter ist EIN Argument**, und er steht in der URL. Ein
 * Wechsel aendert damit jede Zahl, jedes Linkziel und jede dahinterliegende
 * Liste in einem Schritt — waere er je Kachel gebaut, zeigte nach dem Wechsel
 * die eine den neuen Bereich und die andere noch den alten, und beide Zahlen
 * saehen plausibel aus.
 */
export const dynamic = 'force-dynamic';

/** Einmal je Prozess. Ein zweiter Aufruf wuerfe "bereits registriert". */
let registriert = false;
function stelleSicherRegistriert(): void {
  if (registriert || kacheln().length > 0) { registriert = true; return; }
  registriereBerichtKacheln();
  registriert = true;
}

interface Bereich { id: string; slug: string; name: string }

export default async function DashboardSeite(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  if (!devFlaechenAn()) notFound();
  stelleSicherRegistriert();

  const { bereich } = await searchParams;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) => {
    const bereiche = (await tx.unsafe(
      `select id, slug, name from mandant where archiviert_am is null
        order by sortierung, slug`,
    )) as Bereich[];

    const gewaehlt = bereich === undefined || bereich === 'gruppe'
      ? null
      : bereiche.find((b) => b.slug === bereich || b.id === bereich)?.id ?? null;

    const werte = await withDevAdmin(tx, gewaehlt, async (kontext) =>
      dashboard(
        kontext,
        { mandantId: gewaehlt, mandantIds: kontext.mandantIds },
        // Der Super-Admin sieht alles; die rollenbezogene Filterung kommt mit
        // PR 19, wo es echte Sitzungen gibt.
        () => true,
      ));

    return { bereiche, gewaehlt, werte };
  }) as Promise<{
    bereiche: Bereich[];
    gewaehlt: string | null;
    werte: Awaited<ReturnType<typeof dashboard>>;
  }>);

  const anzeige: readonly KachelAnzeige[] = daten.werte.map((w) => ({
    schluessel: w.kachel.schluessel,
    label: w.kachel.label,
    wert: w.wert,
    ton: w.kachel.ton,
    ziel: w.ziel,
  }));

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s5 p-s6">
      <h1 className="text-h1 text-text">Übersicht</h1>

      <nav aria-label="Bereich" data-cse="bereichsfilter" className="flex flex-wrap gap-s3">
        <a
          href="/dev/dashboard?bereich=gruppe"
          data-cse="bereich-knopf"
          aria-current={daten.gewaehlt === null ? 'true' : undefined}
          className={`rounded-full border border-line px-s4 py-s2 text-sm ${
            daten.gewaehlt === null ? 'bg-white text-ink' : 'text-text-muted'}`}
        >
          Alle Bereiche
        </a>
        {daten.bereiche.map((b) => (
          <a
            key={b.slug}
            href={`/dev/dashboard?bereich=${b.slug}`}
            data-cse="bereich-knopf"
            aria-current={daten.gewaehlt === b.id ? 'true' : undefined}
            className={`rounded-full border border-line px-s4 py-s2 text-sm ${
              daten.gewaehlt === b.id ? 'bg-white text-ink' : 'text-text-muted'}`}
          >
            {b.name}
          </a>
        ))}
      </nav>

      <KachelRaster kacheln={anzeige} />
    </main>
  );
}
