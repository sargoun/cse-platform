import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  kommendeVeranstaltungen, type VeranstaltungZeileAnzeige,
} from '@/server/services/security/eventbesetzung';

/**
 * `/portal/[mandant]/security/veranstaltungen` — die anstehenden
 * Eventdienste mit ihrem Besetzungsstand (SEC-08).
 *
 * **Was die Liste beantwortet, ist eine einzige Frage:** wo fehlen noch
 * Wachen, und wie lange ist es hin. Deshalb steht die Besetzung als
 * `x von y` in der Zeile und nicht hinter einem Klick.
 */
export const dynamic = 'force-dynamic';

export default async function Veranstaltungen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/security/veranstaltungen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'dienstplan.schreiben');
  if (sitzung.aktiverMandantId === null) notFound();

  const heute = await berlinHeute();
  const zeilen = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) =>
        kommendeVeranstaltungen(kontext, heute))) as
        Promise<readonly VeranstaltungZeileAnzeige[]>);

  return (
    <PortalRahmen
      titel="Veranstaltungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Veranstaltungen</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Kurzfristige Eventdienste. Die Besetzung läuft über dieselben Prüfungen
        wie jede andere Einteilung — § 34a-Nachweis, Bewacherregister und
        Arbeitszeit. Schnell heisst hier nicht ungeprüft.
      </p>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine anstehende Veranstaltung.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {zeilen.map((v) => {
            const offen = v.sollBesetzung - v.besetzt;
            return (
              <li
                key={v.id}
                data-cse="veranstaltung"
                data-veranstaltung={v.id}
                className="mb-s3 rounded-lg border border-line bg-surface p-s4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-s3">
                  {/*
                    * Das Besetzungsbrett dahinter verlangt laut Manifest
                    * `dienstplan.schreiben`; diese Liste nur `security.lesen`.
                    * Ohne das Schreibrecht führte der Zeilentitel auf 404 und
                    * verriete, was er nicht zeigen darf (AUT-06; Copilot-Runde
                    * auf PR 16 / D-581) — dann steht die Bezeichnung als Text.
                    */}
                  {darf['dienstplan.schreiben'] === true ? (
                    <Link
                      href={`/portal/${mandant}/security/veranstaltungen/${v.id}/besetzung`}
                      className="text-base text-text underline-offset-2
                                 hover:text-brand hover:underline"
                    >
                      {v.bezeichnung}
                    </Link>
                  ) : (
                    <span className="text-base text-text">{v.bezeichnung}</span>
                  )}
                  <span className="text-sm tabular-nums text-text-muted">
                    {v.beginnLokal} – {v.endeLokal}
                  </span>
                </div>
                <p className="m-0 mt-s2 text-sm text-text-muted">
                  {v.kunde}
                  {' · '}
                  {v.ort}
                  {v.anlass !== null && ` · ${v.anlass}`}
                  {!v.hatObjekt && (
                    <span className="ml-s2 text-warning">
                      Ort nur als Text erfasst — für Schichten braucht es ein Objekt
                    </span>
                  )}
                </p>
                <p className="m-0 mt-s2 text-sm tabular-nums">
                  <span className={offen > 0 ? 'text-warning' : 'text-success'}>
                    {v.besetzt} von {v.sollBesetzung} besetzt
                    {offen > 0 && ` · ${offen} offen`}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </PortalRahmen>
  );
}
