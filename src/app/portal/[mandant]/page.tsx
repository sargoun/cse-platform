import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { KachelRaster, type KachelAnzeige } from '@/components/portal/KachelRaster';
import { registriereBerichtKacheln } from '@/server/services/bericht/kacheln';
import { dashboard } from '@/server/services/bericht/dashboard';
import { kacheln } from '@/server/registry/kennzahlen';
import { AnmeldungNoetig } from '../Anmeldung';
import { portalZugang } from '../zugang';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]` — das rollenaufgeloeste Dashboard (DSH-01, DSH-03).
 *
 * **Eine Route, ein Recht, fuenf Renderings.** Die Zahlen, die eine Rolle
 * sieht, sind ihre eigenen RECHTE — deshalb genuegt ein Schluessel fuer alle
 * Dashboards: eine Kachel, deren Recht der Betrachter nicht haelt, wird nicht
 * gerendert statt leer gerendert. `leitung` bekommt damit von selbst weniger
 * als `admin`, ohne dass irgendwo eine Rollenliste steht.
 *
 * **Das Segment ist Routing, nie Autoritaet** (K-02, §1.5). Der aktive Mandant
 * kommt aus der SITZUNG; der Pfad wird nur dagegen geprueft. Waere es
 * umgekehrt, waere ein Mandantenwechsel eine Adresszeile.
 */
export const dynamic = 'force-dynamic';

let registriert = false;
function stelleSicherRegistriert(): void {
  if (registriert || kacheln().length > 0) { registriert = true; return; }
  registriereBerichtKacheln();
  registriert = true;
}

interface Bereich { id: string; slug: string; name: string }

export default async function MandantDashboard(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}`);
  if (zugang === null) return <AnmeldungNoetig />;
  stelleSicherRegistriert();

  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const bereiche = await kontext.abfrage<Bereich>(
        `select id, slug, name from mandant where id = $1`, [sitzung.aktiverMandantId],
      );
      const eigen = bereiche[0];
      /**
       * Der Pfad muss zum gebundenen Mandanten passen. Tut er das nicht, ist
       * die Adresse eine Behauptung über einen anderen Mandanten — und die
       * Antwort darauf ist 404, nicht ein stiller Wechsel.
       */
      if (eigen === undefined || eigen.slug !== mandant) return null;

      /**
       * Die Rechte werden EINMAL geholt, nicht je Kachel.
       *
       * `dashboard()` filtert synchron — es soll nicht wissen, dass die
       * Antwort aus der Datenbank kommt. Und eine Abfrage je Kachel wären
       * sieben Rundreisen für eine Frage, die eine beantwortet.
       */
      const gefragt = [...new Set(kacheln().map((k) => k.recht))];
      const antworten = await kontext.abfrage<{ recht: string; ok: boolean }>(
        `select r as recht, app.hat_recht(r, $2::uuid) as ok
           from unnest($1::text[]) as r`,
        [gefragt, sitzung.aktiverMandantId],
      );
      const gehalten = new Set(antworten.filter((a) => a.ok).map((a) => a.recht));

      const werte = await dashboard(
        kontext,
        { mandantId: sitzung.aktiverMandantId, mandantIds: kontext.mandantIds },
        (recht) => gehalten.has(recht),
      );
      return { eigen, werte };
    })) as Promise<{ eigen: Bereich; werte: Awaited<ReturnType<typeof dashboard>> } | null>);

  if (daten === null) notFound();

  const anzeige: readonly KachelAnzeige[] = daten.werte.map((w) => ({
    schluessel: w.kachel.schluessel,
    label: w.kachel.label,
    wert: w.wert,
    ton: w.kachel.ton,
    ziel: w.ziel,
  }));

  return (
    <PortalRahmen
      titel={daten.eigen.name}
      bereich={daten.eigen.slug as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
    >
      <h1 className="mb-s5 text-h1 text-text">Übersicht</h1>
      <KachelRaster kacheln={anzeige} />
    </PortalRahmen>
  );
}
