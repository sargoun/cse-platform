import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withGroupScope } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../Anmeldung';
import { portalZugang } from '../zugang';

/**
 * `/portal/gruppe` — die Gruppenuebersicht, LESEND (TEN-05, Invariante 10).
 *
 * `withGroupScope` gibt einen `LeseKontext` zurueck und keinen
 * `SchreibKontext`: ein Schreibversuch ist hier ein Compilerfehler und keine
 * Laufzeitentscheidung. Die zweite Linie steht trotzdem — K-03 kennt fuer
 * diesen Scope ueberhaupt keine Schreib-Policy.
 */
export const dynamic = 'force-dynamic';

export default async function Gruppenuebersicht() {
  const zugang = await portalZugang('/portal/gruppe');
  if (zugang === null) return <AnmeldungNoetig />;

  const bereiche = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) => {
    const alle = (await tx.unsafe(
      `select id from mandant where archiviert_am is null`,
    )) as { id: string }[];
    return withGroupScope(tx, zugang.sitzung, alle.map((a) => a.id), async (kontext) =>
      kontext.abfrage<{ name: string; slug: string }>(
        `select name, slug from mandant order by sortierung, slug`,
      ));
  }) as Promise<readonly { name: string; slug: string }[]>);

  return (
    <PortalRahmen
      titel="Gruppenübersicht"
      bereich={null}
      nurLesen
      leiste={zugang.leiste}
      wurzel="/portal/gruppe"
      aktiverTab="uebersicht"
    >
      <h1 className="mb-s5 text-h1 text-text">Gruppenübersicht</h1>
      <ul data-cse="gruppe-bereiche" className="flex flex-col gap-s3">
        {bereiche.map((b) => (
          <li key={b.slug} className="rounded-lg border border-line bg-surface p-s4">
            <span className="text-base text-text">{b.name}</span>
          </li>
        ))}
      </ul>
      <p className="mt-s6 text-sm text-text-subtle">
        Kennzahlen über alle Gesellschaften erscheinen hier, sobald die Module
        gemergt sind, die sie zählen. Eine Null wäre hier eine Aussage über die
        Gruppe — und keine über den Bauzustand.
      </p>
    </PortalRahmen>
  );
}
