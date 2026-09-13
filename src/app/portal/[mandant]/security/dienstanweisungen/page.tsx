import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  leseAnweisungen, STATUS_TEXT, type AnweisungZeile,
} from '@/server/services/security/dienstanweisung';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';

/**
 * `/portal/[mandant]/security/dienstanweisungen` — die Anweisungen der
 * Gesellschaft (SEC-06, DOC-05).
 *
 * **Die Spalte, auf die es ankommt, ist „bestätigt".** Eine Dienstanweisung
 * ist im Haftungsfall so viel wert, wie sich zeigen lässt, WER WELCHEN TEXT
 * gelesen hat — nicht, dass sie existiert. Die Zahl steht deshalb in der
 * Liste und nicht erst zwei Klicks tiefer.
 *
 * **„4 von 11" ist kein Fortschrittsbalken, sondern ein Anti-Join gegen eine
 * echte Population** (`da_pflicht`, §6.9): wer dem Objekt zugeordnet, aber
 * noch nicht verplant ist, zählt mit. Die Lücke, die der Entwurf hatte, wurde
 * sonst erst nach der Schicht sichtbar.
 */
export const dynamic = 'force-dynamic';

function pille(a: AnweisungZeile): PillZustand {
  if (a.archiviert) return 'Archiviert';
  if (a.status === 'entwurf') return 'Entwurf';
  if (a.status === 'archiviert') return 'Archiviert';
  // Veröffentlicht und jemand fehlt noch: das ist der Zustand, der etwas von
  // jemandem verlangt.
  if (a.kenntnisnahmePflicht && a.bestaetigt < a.pflichtig) return 'Offen';
  return 'Aktiv';
}

export default async function Dienstanweisungen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/security/dienstanweisungen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const anweisungen = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) =>
        leseAnweisungen(kontext))) as Promise<readonly AnweisungZeile[]>);

  return (
    <PortalRahmen
      titel="Dienstanweisungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Dienstanweisungen</h1>
        <Link
          href={`/portal/${mandant}/security/dienstanweisungen/neu`}
          className="no-underline"
        >
          <Button variante="primary">Anweisung anlegen</Button>
        </Link>
      </div>

      {anweisungen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diese Gesellschaft ist keine Dienstanweisung hinterlegt. Solange
          keine da ist, gibt es auch nichts zu bestätigen — und im Streitfall
          nichts vorzulegen.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {anweisungen.map((a) => (
            <li
              key={a.id}
              data-cse="dienstanweisung"
              data-anweisung={a.id}
              data-status={a.status}
              className="mb-s3 rounded-lg border border-line bg-surface p-s4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <Link
                  href={`/portal/${mandant}/security/dienstanweisungen/${a.id}`}
                  className="text-base text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {a.titel}
                </Link>
                <StatusPill zustand={pille(a)} />
              </div>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {a.objekt ?? (a.posten ?? 'Gesellschaftsweit')}
                {' · '}
                {STATUS_TEXT[a.status]}
                {a.aktiveVersion !== null && (
                  <>
                    {' · Fassung '}
                    <span className="cse-zahl">{a.aktiveVersion}</span>
                    {' von '}
                    <span className="cse-zahl">{a.fassungen}</span>
                  </>
                )}
              </p>
              {a.kenntnisnahmePflicht && (
                <p className="m-0 mt-s2 text-sm text-text">
                  <Link
                    href={
                      `/portal/${mandant}/security/dienstanweisungen/${a.id}/kenntnisnahmen`
                    }
                    className="text-text underline-offset-2 hover:text-brand"
                    data-cse="kenntnisstand"
                  >
                    Bestätigt:{' '}
                    <span className="cse-zahl">{a.bestaetigt}</span>
                    {' von '}
                    <span className="cse-zahl">{a.pflichtig}</span>
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PortalRahmen>
  );
}
