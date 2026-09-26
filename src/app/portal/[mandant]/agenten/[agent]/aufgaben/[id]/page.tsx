import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { schritte, type SchrittZeile } from '@/server/agent/laufzeit';
import { kennungFuer } from '../../../kennung';
import { Schrittkette } from '../../../Schrittkette';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Recht } from '@/components/ui/Recht';
import { beschriftung, lesbar } from '@/lib/i18n/beschriftung/basis';
import { VORGANG_TEXT } from '@/lib/i18n/beschriftung/agent';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { AUFGABE_PILLE } from '../../../darstellung';

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


/**
 * Die vier Auslöser aus `ausloeser` (0128) — als Satz, nicht als Schlüssel.
 *
 * `agent` heisst: ein anderer Agent hat ihn angestossen. Das gehört auf den
 * Bildschirm und nicht in eine Fussnote: eine Kette aus Agenten ist etwas
 * anderes als ein Lauf, den ein Mensch wollte (AGT-04).
 */
const AUSLOESER: Readonly<Record<string, string>> = {
  mensch: 'einen Menschen',
  zeitplan: 'den Zeitplan',
  ereignis: 'ein Ereignis',
  agent: 'einen anderen Agenten',
};

interface Kopf {
  readonly id: string;
  readonly titel: string;
  readonly vorgang: string;
  readonly status: string;
  readonly ausloeser: string;
  readonly ausgeloest_von: string | null;
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
  kennungOder404(id);
  const kennung = kennungFuer(agent);
  if (kennung === undefined) notFound();

  const zugang = await portalZugang(`/portal/${mandant}/agenten/${agent}/aufgaben/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'agent.budget_verwalten');
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
        /*
         * **`a.ausgeloest_durch`, nicht `a.ausloeser`.**
         *
         * `ausloeser` ist der TYP (`create type ausloeser as enum`, 0128), die
         * SPALTE heisst `ausgeloest_durch`. PostgreSQL antwortete
         * `column a.ausloeser does not exist`, und JEDE Laufansicht dieser
         * Plattform endete mit 500 — für jede Rolle, in jeder Gesellschaft,
         * seit es die Seite gibt.
         *
         * **Gefunden hat es keine Prüfung, sondern ein Rundgang.** Kein
         * einziger Browserlauf öffnete `/agenten/[agent]/aufgaben/[id]`; die
         * Seite stand in der Karte, war bewacht, hatte Rechte und Marken — und
         * niemand ist je auf sie geklickt. Erst der erweiterte Verweiselauf
         * (D-575), der jedem gezeigten Link bis zum Ende folgt, lief hinein.
         * `tests/e2e/agenten.spec.ts` öffnet sie jetzt.
         *
         * `angefordert_von` steht daneben: „ausgelöst durch einen Menschen"
         * ohne den Namen ist die halbe Auskunft, und bei einem Lauf, den ein
         * Zeitplan startete, ist die Spalte leer — das sagt die Seite dann so.
         */
        `select a.id, a.titel, a.vorgang_typ::text as vorgang, a.status::text as status,
                a.ausgeloest_durch::text as ausloeser, a.schritte_anzahl,
                a.kosten_cent::text as kosten_cent,
                b.name as ausgeloest_von,
                a.budget_stopp, a.fehler_text, ag.name as agent_name,
                to_char(a.erstellt_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as erstellt_am,
                to_char(a.beendet_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as beendet_am
           from agent_aufgabe a
           join agent ag on ag.id = a.agent_id
           left join benutzer b on b.id = a.angefordert_von
          where a.id = $1::uuid and ag.kennung = $2::agent_kennung`,
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
        <StatusPill zustand={eigenerEintrag(AUFGABE_PILLE, kopf.status) ?? 'Wartet'} />
      </div>

      {kopf.budget_stopp ? (
        <section className="mb-s5 rounded-lg border border-danger bg-danger-soft p-s5">
          <h2 className="text-h3 text-text">Vom Budget gestoppt</h2>
          <p className="mt-s2 text-sm text-text-muted">
            Dieser Lauf endete, weil das Monatsbudget erreicht war — nicht,
            weil die Aufgabe fertig war.
            {/* `/agenten/budget` verlangt `agent.budget_verwalten` (Manifest) — ohne
              * das Recht fuehrte „Budget ansehen" auf 404 (AUT-06; D-581). */}
            {darf['agent.budget_verwalten'] === true && (
              <>
                {' '}
                <Link
                  href={`/portal/${mandant}/agenten/budget`}
                  className="underline underline-offset-2 hover:text-brand"
                >
                  Budget ansehen
                </Link>
              </>
            )}
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
          <dd className="text-text" data-vorgang={kopf.vorgang}>
            {beschriftung(VORGANG_TEXT, kopf.vorgang)}
          </dd>
        </div>
        <div>
          <dt className="text-text-subtle">Ausgelöst durch</dt>
          <dd className="text-text" data-cse="lauf-ausloeser">
            {eigenerEintrag(AUSLOESER, kopf.ausloeser) ?? lesbar(kopf.ausloeser)}
            {kopf.ausgeloest_von === null
              ? '' : ` · ${kopf.ausgeloest_von}`}
          </dd>
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
          <Recht schluessel="agent.protokoll_lesen" />; dieses Konto hat
          es nicht.
        </p>
      )}
    </PortalRahmen>
  );
}
