import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withPersonScope } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../Anmeldung';
import { portalZugang } from '../zugang';

/**
 * `/portal/mein` — das Mitarbeiterportal, Seite "Heute" (EMP-02, EMP-14).
 *
 * **Der Personen-Scope, nicht die Gruppenansicht** (K-18). Fatima arbeitet in
 * zwei Gesellschaften (D-09); ihr Portal zeigt beide Beschaeftigungen, und
 * zwar als SUBJEKT — nicht als jemand, der ueber Mandanten hinwegliest. Ueber
 * den Gruppen-Scope gelesen bliebe diese Seite leer, weil dessen Policy ein
 * Leitungsrecht verlangt, das kein `mitarbeiter` haelt.
 *
 * Was hier steht, sind die Beschaeftigungen. Schichten, Stunden und Nachweise
 * kommen mit Phase 5 — die Tab-Leiste fuehrt sie bereits, weil §11.2 fuenf
 * Ziele verlangt und weil eine Leiste, die mitwaechst, dreimal umgebaut wird.
 */
export const dynamic = 'force-dynamic';

interface AnstellungZeile {
  id: string;
  mandant_name: string;
  personalnummer: string | null;
  eintritt: Date | string;
  status: string;
}

export default async function MeinPortal() {
  const zugang = await portalZugang('/portal/mein');
  if (zugang === null) return <AnmeldungNoetig />;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withPersonScope(tx, zugang.sitzung, async (kontext) =>
      kontext.abfrage<AnstellungZeile>(
        `select a.id, m.name as mandant_name, a.personalnummer, a.eintritt, a.status
           from anstellung a join mandant m on m.id = a.mandant_id
          where a.geloescht_am is null
          order by m.sortierung, m.slug`,
      ))) as Promise<readonly AnstellungZeile[]>);

  return (
    <PortalRahmen
      titel="Mein Bereich"
      bereich={null}
      nurLesen
      leiste={zugang.leiste}
      wurzel="/portal/mein"
      aktiverTab="heute"
      sichtbareTabs={zugang.sichtbareTabs}
    >
      <h1 className="mb-s5 text-h1 text-text">Heute</h1>

      <section className="flex flex-col gap-s3">
        <h2 className="text-h3 text-text">Meine Beschäftigungen</h2>
        {zeilen.length === 0 ? (
          <p className="text-base text-text-muted">
            Für diese Anmeldung ist keine Beschäftigung hinterlegt.
          </p>
        ) : (
          <ul data-cse="meine-anstellungen" className="flex flex-col gap-s3">
            {zeilen.map((z) => (
              <li
                key={z.id}
                data-cse="anstellung"
                className="rounded-lg border border-line bg-surface p-s4"
              >
                <span className="text-base text-text">{z.mandant_name}</span>
                <span className="ml-s3 text-sm text-text-muted">
                  {z.personalnummer ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Was noch nicht da ist, steht als NICHT da — nicht als leere Liste. */}
      <p data-cse="phase-hinweis" className="mt-s6 text-sm text-text-subtle">
        Schichten, Stundenkonto und Nachweise erscheinen hier, sobald die
        Zeiterfassung gebaut ist (Phase 5).
      </p>
    </PortalRahmen>
  );
}
