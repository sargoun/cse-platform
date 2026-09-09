import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db } from '@/server/db/pool';
import { bindeAnfrage } from '@/server/kontext/index';
import { findeRoute } from '@/server/registry/routen';
import { NochNichtGebaut } from '@/components/portal/NochNichtGebaut';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { AnmeldungNoetig } from './Anmeldung';
import { portalWurzel, portalZugang } from './zugang';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Die gemeinsame Antwort fuer jede Portalroute, deren Modul noch nicht gebaut
 * ist.
 *
 * **Warum es sie gibt.** `04-SEITENKARTE.md` fuehrt 432 Routen; gebaut sind
 * die von Phase 3. Die Tab-Leisten verlangen nach §11.2 genau fuenf Ziele je
 * Portal, und darunter sind Module aus Phase 4 bis 9. Ohne diese Seite fuehrte
 * jeder solche Tab auf ein Next-404 — also auf die Auskunft "diese Seite gibt
 * es nicht" fuer eine Seite, die das Dokument fuehrt und die Leiste anbietet.
 *
 * **Die Wache bleibt dieselbe.** Es laeuft `portalZugang`: eine Route, die
 * nicht im Manifest steht, faellt weiter auf 404, ein fehlendes Recht ebenso,
 * und ein fremdes Portal auf die K-04-Decke. Diese Datei fuegt keine
 * Erreichbarkeit hinzu — sie ersetzt nur die falsche Antwort durch die wahre.
 */

const BEREICHE = new Set<string>(['reinigung', 'security', 'bau', 'operations']);

function bereichAus(slug: string | undefined): BereichSchluessel | null {
  return slug !== undefined && BEREICHE.has(slug) ? (slug as BereichSchluessel) : null;
}

export interface UnterseiteProps {
  /** Die konkrete URL, so wie der Browser sie geschickt hat. */
  readonly pfad: string;
  /**
   * Die Portalwurzel — oder `undefined`, dann kommt sie aus der Sitzung.
   *
   * Die Kontoseiten brauchen das: `/portal/konto/...` ist keine Portalwurzel,
   * und die Leiste dort relativ zu ihr aufzuloesen ergaebe
   * `/portal/konto/auftraege` — eine Adresse, die es nicht gibt.
   */
  readonly wurzel?: string;
  readonly bereich: BereichSchluessel | null;
}

/**
 * Prueft den Slug einer `/portal/[mandant]/…`-Adresse gegen die Sitzung.
 *
 * §4.5, Zeile fuer Zeile: gleich dem aktiven Bereich → weiter. Ein Bereich,
 * in dem der Benutzer Mitglied ist, aber nicht der aktive → dasselbe
 * Zwischenblatt, denn **ein GET wechselt den Mandanten nie**. Alles andere →
 * 404, nie 403.
 */
export async function slugTor(
  sitzung: Parameters<typeof bindeAnfrage>[1], slug: string,
): Promise<{ art: 'ok' } | { art: 'wechsel'; aktuell: string | null; ziel: string }> {
  const befund = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    const [z] = (await tx.unsafe(
      `select app.mandant_fuer_wechsel($1) as ziel_id,
              (select m.name from mandant m where m.id = $2) as aktuell`,
      [slug, sitzung.aktiverMandantId],
    )) as { ziel_id: string | null; aktuell: string | null }[];
    return { zielId: z?.ziel_id ?? null, aktuell: z?.aktuell ?? null };
  }) as Promise<{ zielId: string | null; aktuell: string | null }>);

  if (befund.zielId !== null && befund.zielId === sitzung.aktiverMandantId) {
    return { art: 'ok' };
  }
  // Unbekannter Slug UND fremder Bereich geben hier dieselbe `null` zurueck —
  // die Funktion in der Datenbank unterscheidet sie absichtlich nicht (AUT-06).
  if (befund.zielId === null) notFound();
  return { art: 'wechsel', aktuell: befund.aktuell, ziel: slug };
}

export async function Unterseite({ pfad, wurzel, bereich }: UnterseiteProps) {
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const route = findeRoute(pfad);
  const echteWurzel = wurzel ?? portalWurzel(zugang);
  return (
    <NochNichtGebaut
      titel={echteWurzel === '/portal/gruppe' ? 'Gruppenübersicht' : 'Portal'}
      bereich={bereich}
      leiste={zugang.leiste}
      wurzel={echteWurzel}
      sichtbareTabs={zugang.sichtbareTabs}
      phase={route?.phase ?? null}
      pfad={route?.pfad ?? pfad}
    />
  );
}

/** Die Variante unter `/portal/[mandant]/…` — mit der Slug-Pruefung davor. */
export async function MandantUnterseite({ segmente, mandant }: {
  readonly segmente: readonly string[];
  readonly mandant: string;
}) {
  const pfad = `/portal/${[mandant, ...segmente].join('/')}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang.sitzung, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }

  const route = findeRoute(pfad);
  return (
    <NochNichtGebaut
      titel="Portal"
      bereich={bereichAus(mandant)}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      phase={route?.phase ?? null}
      pfad={route?.pfad ?? pfad}
    />
  );
}
