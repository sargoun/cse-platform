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
import { haeltRechte } from '../../rechte';

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

  /* AUT-06: ein Knopf, dessen Ziel diese Sitzung nicht oeffnen darf,
     verraet die Existenz dessen, was er nicht zeigen darf. */
  /*
   * `agent.aufgabe_starten` gehoert zum Verweis auf den Assistenten und nicht
   * zu dieser Seite: die Seitenkarte bewacht `/agenten/assistent` damit, und
   * ein Verweis auf eine Seite, die diese Sitzung nicht oeffnen darf, fuehrt
   * auf 404 (AUT-06, D-567).
   */
  const darf = await haeltRechte(
    sitzung, 'agent.budget_verwalten', 'agent.aufgabe_starten',
    /* Das Tor der Richtlinienliste im Manifest — gefragt wird genau das
       Recht, mit dem die Route bewacht ist, damit der Verweis nie auf ein
       404 fuehrt (AUT-06). */
    'agent.richtlinie_verwalten',
    /* Das Tor der Wissensquellen (AGT-06) — dasselbe Spiel. */
    'agent.werkzeug_verbinden');
  if (sitzung.aktiverMandantId === null) notFound();

  const { agenten, budget, modell } = await (db().begin(SCHNAPPSCHUSS,
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

      /*
       * **Derselbe Blick wie auf der Detailseite.** Diese Seite behauptete
       * unbedingt „Kein Modellzugang eingerichtet" -- ein Satz aus der Zeit
       * vor dem Modellregister (0154). Seit der Demobetrieb eingetragen ist,
       * zeigt die Detailseite einen Startknopf, und die Uebersicht darueber
       * sagte das Gegenteil. Zwei Bildschirme, zwei Wahrheiten: wer den
       * Knopf drueckt, glaubt der Uebersicht danach nichts mehr.
       */
      const [m] = await kontext.abfrage<{ modell: string | null; anbieter: string | null }>(
        /*
         * Der Anbieter wird AUF DIESELBE FAEHIGKEIT eingegrenzt wie das
         * Modell. Ein Modell kann fuer mehrere Faehigkeiten eingetragen sein,
         * und ohne die Bedingung traf die Unterabfrage irgendeine dieser
         * Zeilen -- die Uebersicht haette den Textlauf als Demobetrieb
         * beschriftet, obwohl die Zeile fuer `entwurf_text` einen echten
         * Anbieter nennt. Die Detailseite filtert laengst so; zwei Fassungen
         * derselben Frage laufen sonst auseinander.
         */
        `select app.modell_fuer('entwurf_text') as modell,
                (select r.anbieter from modell_register r
                  where r.modell = app.modell_fuer('entwurf_text')
                    and r.faehigkeit = 'entwurf_text'
                  limit 1) as anbieter`);

      return { agenten, budget: budget[0] ?? null, modell: m ?? null };
    }))) as {
    agenten: readonly AgentZeile[]; budget: BudgetZeile | null;
    modell: { modell: string | null; anbieter: string | null } | null;
  };

  const budgetFehlt = budget === null || budget.budget_cent === null;
  const modellName = modell?.modell ?? null;
  const istDemo = modell?.anbieter === 'demo';

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
        <div className="flex flex-wrap gap-s3">
          {/*
            * **Der Assistent steht hier oben und nicht nur in der Kachelliste.**
            * Er ist der eine Agent, den man BENUTZT statt ihn zu beobachten:
            * er beantwortet Fragen aus den echten Daten und braucht dafuer
            * kein Modell (AGT-07). Ihn zwischen drei Agenten zu verstecken,
            * die ohne Anbieterzugang gar nicht laufen koennen, hiesse das
            * einzige Stueck zu verbergen, das heute arbeitet.
            */}
          {darf['agent.aufgabe_starten'] === true && (
          <Link
            href={`/portal/${mandant}/agenten/assistent`}
            data-cse="zum-assistenten"
            className="min-h-11 rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Fragen stellen
          </Link>
          )}
          {darf['agent.budget_verwalten'] === true && (
            <Link
              href={`/portal/${mandant}/agenten/budget`}
              className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
            >
              Budget
            </Link>
          )}
          {/*
            * **Der Eingang zu den Richtlinien.** Die Liste war gebaut und von
            * nirgendwo im Portal erreichbar — nur ihre eigene Detailseite
            * verwies zurueck auf sie. Sie gehoert hierher: wer ueber das
            * Einschalten eines Agenten nachdenkt, stellt als naechstes die
            * Frage, was ohne einen Menschen hinausgehen darf (Invariante 7).
            */}
          {darf['agent.richtlinie_verwalten'] === true && (
            <Link
              href={`/portal/${mandant}/agenten/richtlinien`}
              data-cse="zu-den-richtlinien"
              className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
            >
              Was hinausgehen darf
            </Link>
          )}
          {/*
            * **Der Eingang zu den Wissensquellen** (V-046, AGT-06). Dieselbe
            * Lücke wie bei den Richtlinien: gebaut, geprüft, von nirgendwo
            * erreichbar. Und dieselbe Nachbarschaft — wer wissen will, was
            * ein Agent ANTWORTET, fragt als nächstes, woher er es hat.
            */}
          {darf['agent.werkzeug_verbinden'] === true && (
            <Link
              href={`/portal/${mandant}/agenten/wissen`}
              data-cse="zum-wissen"
              className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
            >
              Woher das Wissen kommt
            </Link>
          )}
        </div>
      </div>

      {/*
        * Der ehrliche Zustand, ganz oben und nicht im Kleingedruckten — und
        * zwar der WIRKLICHE: er kommt aus `app.modell_fuer`, derselben
        * Quelle, aus der die Detailseite ihren Startknopf ableitet.
        */}
      {modellName === null ? (
        <section className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s5"
                 data-cse="agenten-kein-modell">
          <h2 className="text-h3 text-text">Kein Modellzugang eingerichtet</h2>
          <p className="mt-s2 text-sm text-text-muted">
            Die Laufzeit steht: Aufgaben, Schritte, Kosten und der harte
            Budgetstopp sind gebaut und geprüft. Es fehlt der Zugang zum
            Sprachmodell — EU-Verarbeitung mit Zero-Retention und ein
            Auftragsverarbeitungsvertrag. Bis der eingerichtet ist, startet
            niemand einen Lauf, und diese Seite zeigt, was bereits gelaufen ist.
          </p>
        </section>
      ) : istDemo ? (
        <section className="mb-s5 rounded-lg border border-line bg-surface-2 p-s5"
                 data-cse="agenten-demobetrieb">
          <h2 className="text-h3 text-text">Demobetrieb — kein Anbieter, kein Netzverkehr</h2>
          <p className="mt-s2 text-sm text-text-muted">
            Freigegeben ist <code className="text-text">{modellName}</code>: er läuft im
            eigenen Prozess, formuliert aus Vorlagen und gerechneten Werten und erfindet
            keine Zahl. Damit ist die ganze Kette begehbar — Lauf, Schritte, Kosten,
            Freigabe. Ein echter Anbieter ersetzt ihn, sobald einer im Modellregister
            freigegeben ist; EU-Verarbeitung mit Zero-Retention und ein
            Auftragsverarbeitungsvertrag bleiben die Bedingung dafür.
          </p>
        </section>
      ) : null}

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
