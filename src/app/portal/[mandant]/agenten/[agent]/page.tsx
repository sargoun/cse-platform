import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungFuer } from '../kennung';

/**
 * `/portal/[mandant]/agenten/[agent]` — was dieser Agent tut, was er darf und
 * was er getan hat (AGT-01, AGT-02, AGT-03).
 *
 * **Drei Abschnitte, und der mittlere ist der wichtigste:** die Werkzeuge.
 * Ein Agent ist genau so mächtig wie die Liste dessen, was er anfassen darf;
 * sie hier NICHT zu zeigen hiesse, die einzige Frage unbeantwortet zu lassen,
 * die ein Geschäftsführer vor dem Einschalten stellt.
 *
 * **Die Werkzeugliste ist der geschlossene Satz aus 0128** (`agent_werkzeug_name`)
 * und keine Aufzählung in dieser Datei. Was hier stünde, wäre eine zweite
 * Wahrheit, und beim neunten Werkzeug wäre sie die falsche.
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

interface AgentKopf {
  readonly id: string;
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string | null;
  readonly ist_aktiv: boolean;
  readonly max_schritte: number | null;
}

interface AufgabeZeile {
  readonly id: string;
  readonly titel: string;
  readonly vorgang: string;
  readonly status: string;
  readonly schritte_anzahl: number;
  readonly kosten_cent: string;
  readonly budget_stopp: boolean;
  readonly erstellt_am: string;
}

interface Richtlinie {
  readonly aktion: string;
  readonly auto_erlaubt: boolean;
  readonly begruendung: string | null;
}

export default async function AgentDetail(
  { params }: { params: Promise<{ mandant: string; agent: string }> },
) {
  const { mandant, agent } = await params;
  const kennung = kennungFuer(agent);
  if (kennung === undefined) notFound();

  const zugang = await portalZugang(`/portal/${mandant}/agenten/[agent]`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<AgentKopf>(
        `select id, kennung::text as kennung, name, beschreibung, ist_aktiv, max_schritte
           from agent where kennung = $1::agent_kennung`,
        [kennung]);
      if (kopf === undefined) return null;

      const aufgaben = await kontext.abfrage<AufgabeZeile>(
        `select a.id, a.titel, a.vorgang_typ::text as vorgang, a.status::text as status,
                a.schritte_anzahl, a.kosten_cent::text, a.budget_stopp,
                to_char(a.erstellt_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as erstellt_am
           from agent_aufgabe a
          where a.agent_id = $1
          order by a.erstellt_am desc
          limit 20`,
        [kopf.id]);

      /*
       * Die Richtlinien haengen am MANDANTEN und nicht am Agenten: was hinaus
       * darf, entscheidet die Gesellschaft, nicht das Werkzeug (Invariante 7).
       * Sie stehen hier trotzdem, weil sie die Frage beantworten, die auf
       * dieser Seite gestellt wird.
       */
      const richtlinien = await kontext.abfrage<Richtlinie>(
        `select aktion::text as aktion, auto_erlaubt, begruendung
           from agent_richtlinie order by aktion`);

      return { kopf, aufgaben, richtlinien };
    }))) as {
      kopf: AgentKopf;
      aufgaben: readonly AufgabeZeile[];
      richtlinien: readonly Richtlinie[];
    } | null;

  if (daten === null) notFound();
  const { kopf, aufgaben, richtlinien } = daten;

  return (
    <PortalRahmen
      titel={kopf.name}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{kopf.name}</h1>
        <StatusPill zustand={kopf.ist_aktiv ? 'Aktiv' : 'Inaktiv'} />
      </div>

      {kopf.beschreibung === null ? null : (
        <p className="mb-s5 max-w-prose text-sm text-text-muted">{kopf.beschreibung}</p>
      )}

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="text-h3 text-text">Grenzen</h2>
        <dl className="mt-s3 grid grid-cols-1 gap-s3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-subtle">Schritte je Aufgabe</dt>
            <dd className="text-text">
              {kopf.max_schritte === null
                ? '12 — Platzhalter (offene Frage O-196)'
                : String(kopf.max_schritte)}
            </dd>
          </div>
          <div>
            <dt className="text-text-subtle">Monatsbudget</dt>
            <dd className="text-text">
              <Link
                href={`/portal/${mandant}/agenten/budget`}
                className="underline-offset-2 hover:text-brand hover:underline"
              >
                siehe Budget
              </Link>
            </dd>
          </div>
        </dl>
        <p className="mt-s3 text-xs text-text-subtle">
          Erreicht ein Lauf die Schrittgrenze, endet die Aufgabe als
          abgebrochen — mit einem Text, der genau das sagt, statt eines
          Ergebnisses, das aussieht, als wäre es fertig.
        </p>
      </section>

      <h2 className="mb-s3 text-h2 text-text">Was hinausgehen darf</h2>
      {richtlinien.length === 0 ? (
        <p className="mb-s6 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine Richtlinie hinterlegt — also geht nichts automatisch hinaus.
        </p>
      ) : (
        <ul className="mb-s6 grid grid-cols-1 gap-s3 sm:grid-cols-2">
          {richtlinien.map((r) => (
            <li key={r.aktion} className="rounded-lg border border-line bg-surface p-s4">
              <div className="flex items-baseline justify-between gap-s3">
                <span className="text-sm text-text">{r.aktion}</span>
                <StatusPill zustand={r.auto_erlaubt ? 'Aktiv' : 'In Prüfung'} />
              </div>
              <p className="mt-s2 text-xs text-text-muted">
                {r.auto_erlaubt
                  ? 'Automatisch erlaubt.'
                  : 'Nur nach menschlicher Freigabe (Invariante 7).'}
                {r.begruendung === null ? null : ` ${r.begruendung}`}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
        <h2 className="text-h2 text-text">Läufe</h2>
        <Link
          href={`/portal/${mandant}/agenten/${agent}/protokoll`}
          className="text-sm text-text underline-offset-2 hover:text-brand hover:underline"
        >
          Schrittprotokoll
        </Link>
      </div>

      {aufgaben.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Dieser Agent hat noch nichts getan. Solange kein Modellzugang
          eingerichtet ist, bleibt das so — die Laufzeit steht, der
          Anbieterzugang fehlt.
        </p>
      ) : (
        <DataTable
          beschriftung="Läufe dieses Agenten mit Zustand, Schritten und Kosten"
          zeilen={aufgaben}
          schluessel={(a) => a.id}
          spalten={[
            {
              schluessel: 'titel',
              kopf: 'Aufgabe',
              zelle: (a) => (
                <Link
                  href={`/portal/${mandant}/agenten/${agent}/aufgaben/${a.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {a.titel}
                </Link>
              ),
            },
            { schluessel: 'vorgang', kopf: 'Vorgang', zelle: (a) => a.vorgang },
            {
              schluessel: 'schritte',
              kopf: 'Schritte',
              numerisch: true,
              zelle: (a) => String(a.schritte_anzahl),
            },
            {
              schluessel: 'kosten',
              kopf: 'Kosten',
              numerisch: true,
              zelle: (a) => formatiereGeld(cent(BigInt(a.kosten_cent))),
            },
            { schluessel: 'wann', kopf: 'Begonnen', zelle: (a) => a.erstellt_am },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (a) => (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill zustand={PILLE[a.status] ?? 'Wartet'} />
                  {a.budget_stopp
                    ? <span className="text-xs text-warning">Budget</span>
                    : null}
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
