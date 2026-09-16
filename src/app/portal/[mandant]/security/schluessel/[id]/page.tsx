import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  EREIGNIS_TEXT, EMPFAENGER_TEXT, ZUSTAND_TEXT,
  findeSchluessel, leseQuittungen, pruefeQuittungen,
  type Abzugsbefund, type QuittungZeile, type SchluesselZeile,
} from '@/server/services/security/schluessel';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/security/schluessel/[id]` — der aktuelle Halter und die
 * vollständige Historie (SEC-07, LEG-01, Abnahme 3).
 *
 * **Beide Zustände bleiben protokolliert.** Eine Rücknahme löscht die Ausgabe
 * nicht, sie SCHLIESST sie: die Ausgabezeile bleibt stehen und nennt die
 * Zeile, die sie beendet hat. Ein Journal, aus dem die halbe Bewegung
 * verschwindet, beantwortet die Frage „wer hatte Zutritt" nicht mehr — und
 * das ist die erste Frage nach einem Einbruch.
 *
 * **Der Abzug wird nachgerechnet.** `pruefeQuittungen` kanonisiert die
 * gespeicherte Nutzlast erneut und vergleicht den Hash. Steht hier „geprüft",
 * ist es geprüft und nicht behauptet.
 *
 * **Die Unterschrift ist heute ein NAME.** Das Bild vom Bildschirm braucht den
 * Uploadweg (DOC-06) und eine Zeile im geschlossenen Register
 * `einsatz_medien_bezug`; für `schluessel_quittung` gibt es beides nicht, und
 * die Seite sagt das (D-232) statt es zu verschweigen.
 */
export const dynamic = 'force-dynamic';

export default async function Schluessel(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/security/schluessel/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'schluessel.schreiben');
  if (sitzung.aktiverMandantId === null) notFound();

  const { schluessel, quittungen, befund } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        schluessel: await findeSchluessel(kontext, id),
        quittungen: await leseQuittungen(kontext, id),
        befund: await pruefeQuittungen(kontext, id),
      }))) as Promise<{
        schluessel: SchluesselZeile | null;
        quittungen: readonly QuittungZeile[];
        befund: Abzugsbefund;
      }>);

  if (schluessel === null) notFound();

  const marke = 'text-micro uppercase tracking-[0.08em] text-text-subtle';

  return (
    <PortalRahmen
      titel={schluessel.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <Link
        href={`/portal/${mandant}/security/schluessel`}
        className="mb-s4 inline-block min-h-11 text-sm text-text underline"
      >
        ← Schlüssel
      </Link>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{schluessel.bezeichnung}</h1>
        <StatusPill
          zustand={schluessel.status === 'ausgegeben' ? 'In Arbeit' : 'Bereit'}
        />
      </div>

      <dl className="mb-s5 grid grid-cols-[auto_1fr] gap-x-s4 gap-y-s2">
        <dt className={marke}>Objekt</dt>
        <dd className="m-0 text-base text-text">{schluessel.objekt}</dd>
        <dt className={marke}>Zustand</dt>
        <dd className="m-0 text-base text-text" data-cse="zustand">
          {ZUSTAND_TEXT[schluessel.status]}
        </dd>
        <dt className={marke}>Halter</dt>
        <dd className="m-0 text-base text-text" data-cse="halter">
          {schluessel.besitzer ?? '—'}
        </dd>
        {schluessel.nummer !== null && (
          <>
            <dt className={marke}>Nummer</dt>
            <dd className="m-0 text-base text-text">
              <span className="cse-zahl">{schluessel.nummer}</span>
            </dd>
          </>
        )}
        {schluessel.schliessanlage !== null && (
          <>
            <dt className={marke}>Schliessanlage</dt>
            <dd className="m-0 text-base text-text">{schluessel.schliessanlage}</dd>
          </>
        )}
        {schluessel.sicherungskarteNummer !== null && (
          <>
            <dt className={marke}>Sicherungskarte</dt>
            <dd className="m-0 text-base text-text">
              <span className="cse-zahl">{schluessel.sicherungskarteNummer}</span>
            </dd>
          </>
        )}
        {schluessel.artBezeichnung !== null && (
          <>
            <dt className={marke}>Art</dt>
            <dd className="m-0 text-base text-text">{schluessel.artBezeichnung}</dd>
          </>
        )}
      </dl>

      {/*
        * Die Quittung dahinter öffnet mit `schluessel.schreiben` (Manifest);
        * diese Seite mit `schluessel.lesen`. Wer das Journal lesen darf, darf
        * nicht zwangsläufig quittieren — ohne das Schreibrecht führte der Knopf
        * auf 404 und verriete, was er nicht zeigen darf (AUT-06; Copilot-Runde
        * auf PR 16 / D-581).
        */}
      {darf['schluessel.schreiben'] === true && (
        <p className="mb-s6">
          <Link
            href={`/portal/${mandant}/security/schluessel/${id}/quittung`}
            className="no-underline"
          >
            <Button variante="primary">Quittung schreiben</Button>
          </Link>
        </p>
      )}

      <h2 className="mb-s2 text-h2 text-text">Journal</h2>
      <p className="mb-s4 text-sm text-text-muted" data-cse="abzugsbefund">
        <span className="cse-zahl">{befund.geprueft}</span> Quittungen,
        Abzugsprüfung:{' '}
        {befund.intakt ? 'unverändert' : `${String(befund.brueche.length)} auffällig`}
      </p>

      {quittungen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diesen Schlüssel ist noch nichts gebucht. Er liegt im Depot, weil
          das Journal leer ist — nicht, weil jemand das eingetragen hätte.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {quittungen.map((q) => (
            <li
              key={q.id}
              data-cse="quittung"
              data-quittung={q.id}
              data-art={q.art}
              data-offen={q.offen ? 'ja' : 'nein'}
              className="mb-s3 rounded-lg border border-line bg-surface p-s4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <span className="text-base text-text">{EREIGNIS_TEXT[q.art]}</span>
                <span className="text-sm tabular-nums text-text-muted">
                  {q.quittiertLokal}
                </span>
              </div>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {q.empfaengerArt !== null && `${EMPFAENGER_TEXT[q.empfaengerArt]}: `}
                {q.empfaengerName ?? '—'}
                {q.unterzeichnerName !== null && ` · unterschrieben: ${q.unterzeichnerName}`}
                {q.uebergebenVon !== null && ` · übergeben von ${q.uebergebenVon}`}
                {q.nachgetragen && ' · nachgetragen'}
              </p>
              {q.geplanteRueckgabe !== null && (
                <p className="m-0 mt-s2 text-sm text-text-muted">
                  Rückgabe zugesagt für{' '}
                  <span className="cse-zahl">{q.geplanteRueckgabe}</span>
                </p>
              )}
              {q.zeitabweichungSek !== null && (
                <p className="m-0 mt-s2 text-sm text-text-muted" data-cse="zeitabweichung">
                  Geräteuhr wich um{' '}
                  <span className="cse-zahl">{q.zeitabweichungSek}</span> s ab;
                  gespeichert ist die Serverzeit.
                </p>
              )}
              {q.art === 'ausgabe' && (
                <p
                  className={`m-0 mt-s2 text-sm ${q.offen ? 'text-warning' : 'text-text-muted'}`}
                  data-cse="abschluss"
                >
                  {q.offen
                    ? 'Offen — dieser Schlüssel ist noch draussen.'
                    : `Geschlossen durch die Rücknahme vom ${q.geschlossenLokal ?? '—'}.`}
                </p>
              )}
              {q.bemerkung !== null && (
                <p className="m-0 mt-s2 text-sm text-text">{q.bemerkung}</p>
              )}
              {!q.signaturHinterlegt && ['ausgabe', 'ruecknahme'].includes(q.art) && (
                <p className="m-0 mt-s2 text-sm text-text-subtle" data-cse="signatur-bild">
                  Unterschriftsbild: nicht verbunden — der Uploadweg für
                  Schlüsselquittungen ist nicht gebaut (D-232).
                </p>
              )}
              <p className="m-0 mt-s2 break-all text-micro text-text-subtle">
                <span className="cse-zahl" data-cse="snapshot-hash">{q.snapshotHash}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </PortalRahmen>
  );
}
