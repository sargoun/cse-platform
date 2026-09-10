import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Wochenplan } from '@/components/portal/Wochenplan';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ladePlanfenster, montag, tagePlus } from '../daten';
import { berlinHeute } from '@/server/db/heute';

/**
 * `/portal/[mandant]/dienstplan/woche` — TIM-01, TIM-04.
 *
 * Die Standardansicht. Sie zeigt sieben Tage nebeneinander und innerhalb
 * eines Tages jede Schicht in ihrer eigenen Spur: zehn Wachen, die zur selben
 * Sekunde anfangen, sind zehn Spalten und nicht eine Zeile mit einer Zahl
 * daneben (TIM-04).
 *
 * Die Woche kommt aus `?woche=`; ohne Parameter ist es die laufende. Der
 * Parameter ist ein KALENDERTAG und keine Wochennummer — ISO-Wochen an den
 * Jahresgrenzen sind eine eigene Fehlerquelle, und der Plan braucht sie
 * nirgends.
 */
export const dynamic = 'force-dynamic';

export default async function Wochenansicht({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/woche`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const roh = typeof frage['woche'] === 'string' ? frage['woche'] : null;
  /**
   * „Heute" kommt aus der DATENBANK, nicht aus der Uhr dieses Prozesses:
   * `new Date()` läse zwischen Mitternacht und 02:00 Berliner Zeit noch den
   * gestrigen UTC-Tag — der Planer, der am Montag um 00:30 den Plan öffnet,
   * sähe die vorige Woche (Invariante 2 und 5, `@/server/db/heute`).
   */
  const heute = await berlinHeute();
  const anker = roh !== null && /^\d{4}-\d{2}-\d{2}$/u.test(roh) ? roh : heute;
  const von = montag(anker);
  const bis = tagePlus(von, 6);

  const { tage, schichten } = await ladePlanfenster(sitzung, von, bis);

  return (
    <PortalRahmen
      titel="Dienstplan"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Dienstplan</h1>
        <p className="m-0 text-sm text-text-muted">
          {schichten.length === 1 ? '1 Schicht' : `${String(schichten.length)} Schichten`}
          {' · '}
          <span className="tabular-nums">{von}</span> bis <span className="tabular-nums">{bis}</span>
        </p>
      </div>

      <nav aria-label="Woche wechseln" className="mb-s4 flex flex-wrap items-center gap-s2">
        <Woechentlich mandant={mandant} ziel={tagePlus(von, -7)} text="← Vorige Woche" />
        <Woechentlich mandant={mandant} ziel={heute} text="Diese Woche" />
        <Woechentlich mandant={mandant} ziel={tagePlus(von, 7)} text="Nächste Woche →" />
        <Link
          href={`/portal/${mandant}/dienstplan/monat?monat=${von}`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          Monatsansicht
        </Link>
      </nav>

      {schichten.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Woche ist nichts geplant. Schichten entstehen aus Serien —
          der Generator füllt acht Wochen im Voraus; eine leere Woche heißt
          also, dass für diesen Zeitraum noch keine Serie läuft.
        </p>
      ) : (
        <Wochenplan
          tage={tage}
          schichten={schichten}
          zielFuer={(s) => `/portal/${mandant}/dienstplan/einsatz/${s.id}`}
        />
      )}
    </PortalRahmen>
  );
}

function Woechentlich(
  { mandant, ziel, text }: { readonly mandant: string; readonly ziel: string; readonly text: string },
) {
  return (
    <Link
      href={`/portal/${mandant}/dienstplan/woche?woche=${ziel}`}
      className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
    >
      {text}
    </Link>
  );
}
