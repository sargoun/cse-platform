import { notFound } from 'next/navigation';
import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { bindeAnfrage, withGroupScope } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { AnmeldungNoetig } from '../Anmeldung';
import { portalZugang } from '../zugang';

/**
 * `/portal/gruppe` — die Gruppenuebersicht, LESEND (TEN-05, Invariante 10).
 *
 * `withGroupScope` gibt einen `LeseKontext` zurueck und keinen
 * `SchreibKontext`: ein Schreibversuch ist hier ein Compilerfehler und keine
 * Laufzeitentscheidung. Die zweite Linie steht trotzdem — K-03 kennt fuer
 * diesen Scope ueberhaupt keine Schreib-Policy.
 *
 * **Ein GET betritt die Gruppenansicht nicht.** Diese Seite rief frueher
 * `withGroupScope`, gleichgueltig was in `benutzer_sitzung.ansicht` stand —
 * die Sitzung sagte `mandant`, die Seite las als Gruppe. Damit war die URL der
 * Ansichtszustand, der Wechsel stand in keiner Pruefspur, und §4.5 sagt dazu
 * in einem Satz: *"A GET never switches the tenant."* Traegt die Sitzung die
 * Gruppenansicht nicht, steht hier das Zwischenblatt mit POST-Knopf — oder
 * 404, wo die Tabelle in §4.5 404 sagt.
 */
export const dynamic = 'force-dynamic';

/** Was §4.5 fuer eine Sitzung ohne Gruppenansicht vorsieht. */
interface Vorentscheid {
  readonly darf: boolean;
  readonly aktuellerName: string | null;
}

async function vorentscheid(
  sitzung: Parameters<typeof withGroupScope>[1],
): Promise<Vorentscheid> {
  return db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    const [z] = (await tx.unsafe(
      `select app.darf_gruppenansicht() as darf,
              (select m.name from mandant m where m.id = $1) as name`,
      [sitzung.aktiverMandantId],
    )) as { darf: boolean; name: string | null }[];
    return { darf: z?.darf === true, aktuellerName: z?.name ?? null };
  }) as Promise<Vorentscheid>;
}

export default async function Gruppenuebersicht() {
  const zugang = await portalZugang('/portal/gruppe');
  if (zugang === null) return <AnmeldungNoetig />;

  if (zugang.sitzung.ansicht !== 'gruppe') {
    const { darf, aktuellerName } = await vorentscheid(zugang.sitzung);
    // 404 und nicht 403: eine Absage, die sich von "gibt es nicht"
    // unterscheidet, ist eine Auskunft ueber das, was es gibt (AUT-06).
    if (!darf) notFound();
    return (
      <Wechselblatt
        aktuell={aktuellerName}
        zielTitel="Gruppenübersicht"
        zielSlug={null}
      />
    );
  }

  const bereiche = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withGroupScope(tx, zugang.sitzung, async (kontext) =>
      kontext.abfrage<{ name: string; slug: string }>(
        `select name, slug from mandant order by sortierung, slug`,
      ))) as Promise<readonly { name: string; slug: string }[]>);

  return (
    <PortalRahmen
      titel="Gruppenübersicht"
      bereich={null}
      nurLesen
      leiste={zugang.leiste}
      wurzel="/portal/gruppe"
      aktiverTab="uebersicht"
      sichtbareTabs={zugang.sichtbareTabs}
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
