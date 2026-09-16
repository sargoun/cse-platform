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
import { slugTor } from '../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
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

  /**
   * Der Pfad muss zum gebundenen Mandanten passen — und wenn nicht, gilt §4.5.
   *
   * Hier stand `notFound()` fuer JEDEN abweichenden Slug. Das ist fuer einen
   * fremden Bereich richtig und fuer den eigenen falsch: wer in zwei
   * Gesellschaften arbeitet und die Adresse der anderen oeffnet, bekommt das
   * Zwischenblatt mit POST-Knopf. Ein GET wechselt den Mandanten nie, aber ein
   * 404 auf den eigenen Bereich sagt "gibt es nicht" ueber etwas, das es gibt.
   *
   * **Und dieses Tor steht VOR der Frage nach dem aktiven Bereich.** Darueber
   * stand `if (sitzung.aktiverMandantId === null) notFound()` — und in der
   * Gruppenansicht ist er immer null (K-20). Damit endete „Bereich oeffnen"
   * auf der Gruppenuebersicht auf „Diese Seite gibt es hier nicht", statt auf
   * dem Wechselblatt: der Knopf, der in eine Gesellschaft fuehren soll, fuehrte
   * in ein 404. Die Reihenfolge IST die Regel — dieselbe Lehre wie bei den
   * nummerierten Ausloesern in 0036: wer zuerst prueft, bestimmt, welche
   * Antwort der Mensch liest.
   */
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  // Nach `slugTor` ist der aktive Bereich der des Pfads; ohne einen (K-20)
  // gibt es diese Seite nicht.
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const bereiche = await kontext.abfrage<Bereich>(
        `select id, slug, name from mandant where id = $1`, [sitzung.aktiverMandantId],
      );
      // `slugTor` hat die Adresse bereits gegen die Sitzung geprüft; diese
      // Zeile fängt nur noch den Fall ab, dass die Zeile selbst fehlt.
      const eigen = bereiche[0];
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
        {
          mandantId: sitzung.aktiverMandantId,
          mandantSlug: eigen.slug,
          mandantIds: kontext.mandantIds,
        },
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
    icon: w.kachel.icon,
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
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Übersicht</h1>
      <KachelRaster kacheln={anzeige} />
    </PortalRahmen>
  );
}
