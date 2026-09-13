import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { slugFuer } from './kennung';

/**
 * `/portal/[mandant]/agenten` — die vier Agenten und ihr Zustand
 * (AGT-01, D-03, SPEC §22).
 *
 * **Was diese Seite zeigt, ist der Zustand — nicht ein Versprechen.** Ein
 * Agent, der nicht eingeschaltet ist, steht hier als ausgeschaltet; einer
 * ohne Monatsbudget steht als „kein Budget", und beides heisst dasselbe: er
 * läuft nicht. Ein Zentrum, das vier Kacheln zeigt und verschweigt, dass
 * keine davon laufen kann, ist schlimmer als keins — es sieht fertig aus.
 *
 * **Kein Startknopf, solange kein Modell verbunden ist.** Die Laufzeit steht
 * (PR 74: Aufgabe, Schritt, Kosten, Hartstopp), der Anbieterzugang nicht. Ein
 * Knopf, der dann eine Aufgabe anlegt, die niemand ausführt, wäre eine
 * vorgetäuschte Funktion — CLAUDE.md „no fake integrations". Stattdessen sagt
 * die Seite, was fehlt.
 *
 * **Kein Betrag wird hier gerechnet.** `kosten_cent` steht auf der Aufgabe,
 * seit der Kostenausloeser die Mikrocent EINMAL umgerechnet hat (K-16(b));
 * die Seite formatiert (Invariante 1, Invariante 6).
 */
export const dynamic = 'force-dynamic';

interface AgentZeile {
  readonly id: string;
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string;
  readonly ist_aktiv: boolean;
  readonly aufgaben: string;
  readonly laufend: string;
  readonly kosten_cent: string;
  readonly letzte: string | null;
}

interface BudgetZeile {
  readonly budget_cent: string | null;
  readonly verbrauch_mikrocent: string;
  readonly status: string;
  readonly ist_platzhalter: boolean;
}

export default async function AgentenZentrum(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/agenten`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const { agenten, budget } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      /*
       * Die Zahlen je Agent kommen aus EINER Abfrage mit seitlichem Verbund.
       * Vier Einzelabfragen in einer Schleife wären vier Rundreisen und —
       * schlimmer — vier Zeitpunkte: die Summe stimmte dann mit keiner Zeile.
       */
      const agenten = await kontext.abfrage<AgentZeile>(
        `select ag.id, ag.kennung::text as kennung, ag.name, ag.beschreibung, ag.ist_aktiv,
                z.aufgaben::text, z.laufend::text, z.kosten_cent::text,
                to_char(z.letzte at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as letzte
           from agent ag
           left join lateral (
             select count(*) as aufgaben,
                    count(*) filter (where a.status = 'laufend') as laufend,
                    coalesce(sum(a.kosten_cent), 0) as kosten_cent,
                    max(a.erstellt_am) as letzte
               from agent_aufgabe a
              where a.agent_id = ag.id
           ) z on true
          -- Nach der ENUM-Ordnung, nicht alphabetisch: agent_kennung ist eine
          -- geschlossene Menge in einer gewollten Reihenfolge (D-03). Nach
          -- Namen sortiert stuende der Finanz-Assistent vor dem
          -- CEO-Assistenten; vier feste Zeilen sollen jedes Mal gleich
          -- aussehen.
          order by ag.kennung`);

      const budget = await kontext.abfrage<BudgetZeile>(
        `select budget_cent::text, verbrauch_mikrocent::text,
                status::text as status, ist_platzhalter
           from agent_budget
          where geltungsbereich = 'mandant'
            and jahr  = extract(year  from (now() at time zone 'Europe/Berlin'))::integer
            and monat = extract(month from (now() at time zone 'Europe/Berlin'))::integer`);

      return { agenten, budget: budget[0] ?? null };
    }))) as { agenten: readonly AgentZeile[]; budget: BudgetZeile | null };

  const budgetFehlt = budget === null || budget.budget_cent === null;

  return (
    <PortalRahmen
      titel="Agenten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Agenten</h1>
        <Link
          href={`/portal/${mandant}/agenten/budget`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Budget
        </Link>
      </div>

      {/*
        * Der ehrliche Zustand, ganz oben und nicht im Kleingedruckten: solange
        * kein Modellzugang eingerichtet ist, führt kein Weg von hier zu einem
        * laufenden Agenten. Wer das erst nach dem dritten Klick erfährt, hat
        * dreimal etwas gesucht, was es nicht gibt.
        */}
      <section className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s5">
        <h2 className="text-h3 text-text">Kein Modellzugang eingerichtet</h2>
        <p className="mt-s2 text-sm text-text-muted">
          Die Laufzeit steht: Aufgaben, Schritte, Kosten und der harte
          Budgetstopp sind gebaut und geprüft. Es fehlt der Zugang zum
          Sprachmodell — EU-Verarbeitung mit Zero-Retention und ein
          Auftragsverarbeitungsvertrag. Bis der eingerichtet ist, startet
          niemand einen Lauf, und diese Seite zeigt, was bereits gelaufen ist.
        </p>
      </section>

      <ul className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        {agenten.map((a) => (
          <li key={a.id} className="rounded-lg border border-line bg-surface p-s5">
            <div className="flex flex-wrap items-baseline justify-between gap-s3">
              <h2 className="text-h3 text-text">
                <Link
                  href={`/portal/${mandant}/agenten/${slugFuer(a.kennung)}`}
                  className="underline-offset-2 hover:text-brand hover:underline"
                >
                  {a.name}
                </Link>
              </h2>
              <StatusPill zustand={a.ist_aktiv ? 'Aktiv' : 'Inaktiv'} />
            </div>

            <p className="mt-s2 text-sm text-text-muted">{a.beschreibung}</p>

            <dl className="mt-s4 grid grid-cols-3 gap-s3 text-sm">
              <div>
                <dt className="text-text-subtle">Aufgaben</dt>
                <dd className="text-text">{a.aufgaben}</dd>
              </div>
              <div>
                <dt className="text-text-subtle">Laufend</dt>
                <dd className="text-text">{a.laufend}</dd>
              </div>
              <div>
                <dt className="text-text-subtle">Kosten</dt>
                <dd className="text-text">{formatiereGeld(cent(BigInt(a.kosten_cent)))}</dd>
              </div>
            </dl>

            <p className="mt-s3 text-xs text-text-subtle">
              {a.letzte === null ? 'Noch kein Lauf' : `Zuletzt ${a.letzte}`}
              {budgetFehlt ? ' · kein Monatsbudget hinterlegt' : null}
            </p>
          </li>
        ))}
      </ul>
    </PortalRahmen>
  );
}
