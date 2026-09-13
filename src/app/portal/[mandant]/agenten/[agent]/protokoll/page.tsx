import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { schritte, type SchrittZeile } from '@/server/agent/laufzeit';
import { kennungFuer } from '../../kennung';
import { Schrittkette } from '../../Schrittkette';

/**
 * `/portal/[mandant]/agenten/[agent]/protokoll` — jeder Schritt dieses
 * Agenten: Werkzeug, Modell, Tokens, Kosten, Dauer (AGT-04, SEC-A9).
 *
 * **Diese Seite trägt ein eigenes Recht** (`agent.protokoll_lesen`), und das
 * ist keine Förmlichkeit: `agent.lesen` zeigt, DASS ein Lauf war; das
 * Protokoll zeigt, WAS er gelesen hat. Das zweite ist eine Aussage über
 * Personendaten und über den Inhalt von Kundenakten.
 *
 * Die Nutzlast selbst steht auch hier nicht auf der Seite. Sie kommt einzeln
 * über `app.agent_nutzlast_lesen` (0129) — je Schritt, auf Klick, und jeder
 * dieser Zugriffe steht im Audit. Eine Liste, die hundert Nutzlasten auf
 * einmal auflegt, protokollierte hundert Zugriffe, von denen niemand einen
 * gewollt hat.
 */
export const dynamic = 'force-dynamic';

export default async function AgentProtokoll(
  { params }: { params: Promise<{ mandant: string; agent: string }> },
) {
  const { mandant, agent } = await params;
  const kennung = kennungFuer(agent);
  if (kennung === undefined) notFound();

  const zugang = await portalZugang(`/portal/${mandant}/agenten/[agent]/protokoll`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<{ id: string; name: string }>(
        `select id, name from agent where kennung = $1::agent_kennung`, [kennung]);
      if (kopf === undefined) return null;
      return { kopf, zeilen: await schritte(kontext, { agentId: kopf.id }) };
    }))) as { kopf: { id: string; name: string }; zeilen: readonly SchrittZeile[] } | null;

  if (daten === null) notFound();

  return (
    <PortalRahmen
      titel={`Protokoll — ${daten.kopf.name}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Schrittprotokoll</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {daten.kopf.name} — jeder Schritt, in der Reihenfolge, in der er lief.
        Ein Schritt wird protokolliert, <em>bevor</em> der nächste läuft;
        schlägt das Protokollieren fehl, scheitert der Lauf.
      </p>

      <Schrittkette zeilen={daten.zeilen} />
    </PortalRahmen>
  );
}
