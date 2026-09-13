import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { schritte, type SchrittZeile } from '@/server/agent/laufzeit';
import { kennungFuer } from '../../../kennung';
import { Schrittkette } from '../../../Schrittkette';

/**
 * `/portal/[mandant]/agenten/[agent]/aufgaben/[id]` — ein Lauf, von vorne bis
 * hinten (AGT-01, AGT-04).
 *
 * **Der Kopf beantwortet vier Fragen:** wer hat ihn ausgelöst, was sollte er
 * tun, was ist dabei herausgekommen, was hat er gekostet. Die Schrittkette
 * darunter beantwortet die fünfte — wie er dahin kam.
 *
 * **Die Schrittkette steht nur mit `agent.protokoll_lesen` da.** Der Kopf ist
 * `agent.lesen`; die Kette zeigt Werkzeuge und Modelle und gehört damit zum
 * Protokoll. Das Tor prüft das Recht serverseitig, und die Seite zeigt sonst
 * einen Satz statt einer leeren Tabelle: eine leere Tabelle sähe aus, als
 * wäre nichts gelaufen.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  wartend: 'Wartet',
  laufend: 'In Arbeit',
  abgeschlossen: 'Abgeschlossen',
  abgebrochen: 'Abgelehnt',
  fehler: 'Fehler',
  wartet_freigabe: 'In Prüfung',
};

interface Kopf {
  readonly id: string;
  readonly titel: string;
  readonly vorgang: string;
  readonly status: string;
  readonly ausloeser: string;
  readonly schritte_anzahl: number;
  readonly kosten_cent: string;
  readonly budget_stopp: boolean;
  readonly fehler_text: string | null;
  readonly agent_name: string;
  readonly erstellt_am: string;
  readonly beendet_am: string | null;
}

export default async function Lauf(
  { params }: { params: Promise<{ mandant: string; agent: string; id: string }> },
) {
  const { mandant, agent, id } = await params;
  const kennung = kennungFuer(agent);
  if (kennung === undefined) notFound();

  const zugang = await portalZugang(`/portal/${mandant}/agenten/[agent]/aufgaben/[id]`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      /*
       * Das zweite Recht wird IN derselben gebundenen Transaktion gefragt,
       * nicht daneben: `app.hat_recht` liest die Sitzung aus den GUCs, und
       * ausserhalb der Bindung sind die leer — die Antwort waere dann immer
       * „nein", also fuer jeden dieselbe halbe Seite.
       */
      const [recht] = await kontext.abfrage<{ ok: boolean }>(
        `select app.hat_recht('agent.protokoll_lesen', app.aktiver_mandant()) as ok`);
      const darfProtokoll = recht?.ok === true;

      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.titel, a.vorgang_typ::text as vorgang, a.status::text as status,
                a.ausloeser::text as ausloeser, a.schritte_anzahl, a.kosten_cent::text,
                a.budget_stopp, a.fehler_text, ag.name as agent_name,
                to_char(a.erstellt_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as erstellt_am,
                to_char(a.beendet_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as beendet_am
           from agent_aufgabe a
           join agent ag on ag.id = a.agent_id
          where a.id = $1 and ag.kennung = $2::agent_kennung`,
        [id, kennung]);
      if (kopf === undefined) return null;

      const kette = darfProtokoll
        ? await schritte(kontext, { aufgabeId: kopf.id })
        : [];
      return { kopf, kette, darfProtokoll };
    }))) as {
      kopf: Kopf; kette: readonly SchrittZeile[]; darfProtokoll: boolean;
    } | null;

  if (daten === null) notFound();
  const { kopf, kette, darfProtokoll } = daten;

  return (
    <PortalRahmen
      titel={kopf.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <p className="mb-s2 text-sm text-text-muted">
        <Link
          href={`/portal/${mandant}/agenten/${agent}`}
          className="underline-offset-2 hover:text-brand hover:underline"
        >
          {kopf.agent_name}
        </Link>
      </p>
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{kopf.titel}</h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Wartet'} />
      </div>

      {kopf.budget_stopp ? (
        <section className="mb-s5 rounded-lg border border-danger bg-danger-soft p-s5">
          <h2 className="text-h3 text-text">Vom Budget gestoppt</h2>
          <p className="mt-s2 text-sm text-text-muted">
            Dieser Lauf endete, weil das Monatsbudget erreicht war — nicht,
            weil die Aufgabe fertig war.{' '}
            <Link
              href={`/portal/${mandant}/agenten/budget`}
              className="underline underline-offset-2 hover:text-brand"
            >
              Budget ansehen
            </Link>
          </p>
        </section>
      ) : null}

      {kopf.fehler_text === null ? null : (
        <section className="mb-s5 rounded-lg border border-danger bg-danger-soft p-s5">
          <h2 className="text-h3 text-text">Abgebrochen</h2>
          <p className="mt-s2 text-sm text-text-muted">{kopf.fehler_text}</p>
        </section>
      )}

      <dl className="mb-s6 grid grid-cols-2 gap-s4 rounded-lg border border-line bg-surface p-s5 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-text-subtle">Vorgang</dt>
          <dd className="text-text">{kopf.vorgang}</dd>
        </div>
        <div>
          <dt className="text-text-subtle">Ausgelöst durch</dt>
          <dd className="text-text">{kopf.ausloeser}</dd>
        </div>
        <div>
          <dt className="text-text-subtle">Schritte</dt>
          <dd className="text-text">{kopf.schritte_anzahl}</dd>
        </div>
        <div>
          <dt className="text-text-subtle">Kosten</dt>
          <dd className="text-text">{formatiereGeld(cent(BigInt(kopf.kosten_cent)))}</dd>
        </div>
        <div>
          <dt className="text-text-subtle">Begonnen</dt>
          <dd className="text-text">{kopf.erstellt_am}</dd>
        </div>
        <div>
          <dt className="text-text-subtle">Beendet</dt>
          <dd className="text-text">
            {kopf.beendet_am ?? <span className="text-text-subtle">—</span>}
          </dd>
        </div>
      </dl>

      <h2 className="mb-s3 text-h2 text-text">Schritte</h2>
      {darfProtokoll ? (
        <Schrittkette zeilen={kette} />
      ) : (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Die Schrittkette zeigt, welche Werkzeuge dieser Lauf benutzt hat und
          was er einem Modell geschickt hat. Dafür braucht es das Recht
          <code className="mx-s2">agent.protokoll_lesen</code>; dieses Konto hat
          es nicht.
        </p>
      )}
    </PortalRahmen>
  );
}
