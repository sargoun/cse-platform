import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Monatsplan } from '@/components/portal/Wochenplan';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ladePlanfenster, monatsgrenzen } from '../daten';

/**
 * `/portal/[mandant]/dienstplan/monat` — TIM-01.
 *
 * **Kein Raster.** Der Monat ist eine Uebersicht, keine Disposition, und ein
 * 31-Spalten-Raster auf einem Telefon ist entweder unlesbar oder scrollt
 * seitwaerts — DESIGN §8 verbietet das zweite ausdruecklich. Stattdessen
 * Karten, die ab 375px einspaltig stehen und mit der Breite mitwachsen.
 */
export const dynamic = 'force-dynamic';

export default async function Monatsansicht({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/monat`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const roh = typeof frage['monat'] === 'string' ? frage['monat'] : null;
  const anker = roh !== null && /^\d{4}-\d{2}-\d{2}$/u.test(roh)
    ? roh
    : new Date().toISOString().slice(0, 10);
  const { von, bis } = monatsgrenzen(anker);
  const { tage, schichten } = await ladePlanfenster(sitzung, von, bis);

  return (
    <PortalRahmen
      titel="Dienstplan — Monat"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Dienstplan — Monat</h1>
        <p className="m-0 text-sm text-text-muted">
          {schichten.length === 1 ? '1 Schicht' : `${String(schichten.length)} Schichten`}
        </p>
      </div>

      <nav aria-label="Ansicht wechseln" className="mb-s4 flex flex-wrap gap-s2">
        <Link
          href={`/portal/${mandant}/dienstplan/woche?woche=${von}`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-border-strong hover:text-text"
        >
          Wochenansicht
        </Link>
      </nav>

      {schichten.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In diesem Monat ist nichts geplant.
        </p>
      ) : (
        <Monatsplan
          tage={tage}
          schichten={schichten}
          zielFuer={(s) => `/portal/${mandant}/dienstplan/einsatz/${s.id}`}
        />
      )}
    </PortalRahmen>
  );
}
