import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { GEWERKE, GEWERK_FUER_MODUL, QUERSCHNITT } from '@/server/registry/modul';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/module` — was diese Gesellschaft gebucht
 * hat und was deshalb sichtbar ist (AUT-01, D-377).
 *
 * Zwei Tabellen, eine Regel: `mandant.module` nennt die Gewerke, das
 * Register (`modul.ts`) ordnet jedes Modul einem Gewerk zu oder erklaert es
 * zum Querschnitt. Was hier steht, ist die Antwort auf „warum sehe ich das
 * Wachbuch nicht" — und `module_gepflegt = false` heisst: es wird gar nicht
 * gefiltert, weil die Buchung noch nie eingetragen wurde (O-355).
 */
export const dynamic = 'force-dynamic';

const GEWERK_NAME: Readonly<Record<string, string>> = {
  reinigung: 'Gebäudereinigung', security: 'Sicherheits- und Objektschutzdienste', bau: 'Hochbau, Ausbau, Rückbau',
};

interface Zeile {
  readonly module: readonly string[] | null;
  readonly module_gepflegt: boolean;
}

export default async function Module(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/module`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const [m] = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<Zeile>(
      `select module, module_gepflegt from mandant where id = $1`, [mandantId]))) as Promise<readonly Zeile[]>);
  if (m === undefined) notFound();
  const gebucht = new Set(m.module ?? []);
  const gewerkModule = Object.entries(GEWERK_FUER_MODUL);

  return (
    <PortalRahmen
      titel="Module"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Module</h1>
      <p data-cse="module-gepflegt" data-gepflegt={String(m.module_gepflegt)}
         className={`mb-s5 max-w-prose rounded-lg border p-s4 text-sm ${m.module_gepflegt
           ? 'border-line bg-surface text-text-muted' : 'border-warning bg-warning-soft text-warning'}`}>
        {m.module_gepflegt
          ? 'Die Buchung ist eingetragen: nur die Module der gebuchten Gewerke sind sichtbar (D-377).'
          : 'Die Buchung ist noch nicht eingetragen (O-355): es wird nicht gefiltert, damit eine neu angelegte Gesellschaft nicht schwarz wird. Was unten als gebucht steht, ist der Seed, keine Entscheidung.'}
      </p>

      <h2 className="mb-s3 text-h2 text-text">Gewerke</h2>
      <ul data-cse="gewerke" className="mb-s6 grid grid-cols-1 gap-s3 md:grid-cols-3">
        {GEWERKE.map((g) => (
          <li key={g} data-gewerk={g} data-gebucht={String(gebucht.has(g))}
              className="flex items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s4">
            <span className="text-sm text-text">{GEWERK_NAME[g] ?? g}</span>
            <StatusPill zustand={gebucht.has(g) ? 'Aktiv' : 'Inaktiv'} />
          </li>
        ))}
      </ul>

      <h2 className="mb-s3 text-h2 text-text">Module je Gewerk</h2>
      <ul className="mb-s6 grid grid-cols-1 gap-s3 md:grid-cols-2">
        {gewerkModule.map(([modul, gewerk]) => (
          <li key={modul} className="flex items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s4">
            <span className="text-sm text-text">
              <code>{modul}</code>
              <span className="ml-s2 text-xs text-text-muted">→ {GEWERK_NAME[gewerk] ?? gewerk}</span>
            </span>
            <StatusPill zustand={!m.module_gepflegt || gebucht.has(gewerk) ? 'Aktiv' : 'Inaktiv'} />
          </li>
        ))}
      </ul>

      <h2 className="mb-s3 text-h2 text-text">Querschnitt — in jeder Gesellschaft</h2>
      <p className="mb-s3 max-w-[72ch] text-sm text-text-muted">
        Diese Module hängen an keinem Gewerk: jede Gesellschaft hat Kunden, Aufträge,
        Rechnungen, Personal und ein Protokoll.
      </p>
      <p data-cse="querschnitt" className="flex flex-wrap gap-s2">
        {[...QUERSCHNITT].sort().map((q) => (
          <code key={q} className="rounded-md bg-surface-3 px-s2 py-s1 text-xs text-text">{q}</code>
        ))}
      </p>
      <p className="mt-s5 text-sm text-text-subtle">
        Die Buchung ändert die Super-Administration (`system.module_zuweisen`,
        Zwei-Faktor-Pflicht); die Änderung ist eine Zeile in `mandant.module`.
      </p>
    </PortalRahmen>
  );
}
