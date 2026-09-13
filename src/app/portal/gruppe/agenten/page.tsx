import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { mikrocentNachCent } from '@/server/agent/kosten';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/agenten` — Agentenaktivitaet, Kosten und Budgetverbrauch
 * ueber alle Bereiche (AGT-04, AGT-05), lesend.
 *
 * Dieselbe Umrechnung wie im Bereich: Mikrocent werden an EINER Stelle zu
 * Cent (`mikrocentNachCent`, K-16(b)). Und derselbe Satz wie dort: solange
 * kein Modellzugang eingerichtet ist, laeuft nichts — die Seite zeigt, was
 * gelaufen ist, nicht, was laufen koennte.
 */
export const dynamic = 'force-dynamic';

const BUDGET_PILLE: Readonly<Record<string, PillZustand>> = {
  aktiv: 'Aktiv', gewarnt: 'Wartet', gestoppt: 'Abgelehnt',
};

interface Budget {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly geltungsbereich: string;
  readonly agent: string | null;
  readonly budget_cent: string | null;
  readonly verbrauch_mikrocent: string;
  readonly reserviert_mikrocent: string;
  readonly status: string;
  readonly ist_platzhalter: boolean;
}

interface Aktivitaet {
  readonly slug: string;
  readonly bereich_name: string;
  readonly agent: string;
  readonly aufgaben: number;
  readonly laufend: number;
  readonly kosten_cent: string;
  readonly letzte: string | null;
}

export default async function GruppenAgenten({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/agenten');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, budgets, aktivitaet } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const ids = mandantIdsFuer(kontext, aktiv);
    const budgets = await kontext.abfrage<Budget>(
      `select b.id, m.slug, m.name as bereich_name, b.geltungsbereich::text as geltungsbereich,
              ag.name as agent, b.budget_cent::text, b.verbrauch_mikrocent::text,
              b.reserviert_mikrocent::text, b.status::text as status, b.ist_platzhalter
         from agent_budget b
         join mandant m on m.id = b.mandant_id
         left join agent ag on ag.id = b.agent_id
        where b.mandant_id = any($1::uuid[])
          and b.jahr  = extract(year  from (now() at time zone 'Europe/Berlin'))::integer
          and b.monat = extract(month from (now() at time zone 'Europe/Berlin'))::integer
        order by m.sortierung, (b.geltungsbereich = 'mandant') desc, ag.name`,
      [ids],
    );
    const aktivitaet = await kontext.abfrage<Aktivitaet>(
      `select m.slug, m.name as bereich_name, ag.name as agent,
              count(*)::int as aufgaben,
              count(*) filter (where a.status = 'laufend')::int as laufend,
              coalesce(sum(a.kosten_cent), 0)::text as kosten_cent,
              to_char(max(a.erstellt_am) at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as letzte
         from agent_aufgabe a
         join mandant m on m.id = a.mandant_id
         join agent ag on ag.id = a.agent_id
        where a.mandant_id = any($1::uuid[])
        group by m.slug, m.name, m.sortierung, ag.name, ag.kennung
        order by m.sortierung, ag.kennung`,
      [ids],
    );
    return { bereiche, aktiv, budgets, aktivitaet };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Agenten" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Agenten</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/agenten" />

      <section className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s5">
        <h2 className="text-h3 text-text">Kein Modellzugang eingerichtet</h2>
        <p className="mt-s2 text-sm text-text-muted">
          Die Laufzeit steht; es fehlt der Zugang zum Sprachmodell — EU-Verarbeitung
          mit Zero-Retention und ein Auftragsverarbeitungsvertrag. Bis dahin startet
          niemand einen Lauf. Diese Seite zeigt je Gesellschaft, was gelaufen ist und
          was das Budget dafür vorsieht.
        </p>
      </section>

      <h2 className="mb-s3 text-h2 text-text">Budget im laufenden Monat</h2>
      {budgets.length === 0 ? (
        <LeereListe text="Kein Budget für diesen Monat in dieser Auswahl." />
      ) : (
        <div data-cse="agenten-budgets">
          <DataTable
            beschriftung="KI-Budget je Gesellschaft im laufenden Monat"
            zeilen={budgets}
            schluessel={(b) => b.id}
            spalten={[
              { schluessel: 'bereich', kopf: 'Gesellschaft',
                zelle: (b) => <BereichMarke slug={b.slug} name={b.bereich_name} /> },
              { schluessel: 'geltung', kopf: 'Gilt für',
                zelle: (b) => (b.geltungsbereich === 'mandant' ? 'alle Agenten' : (b.agent ?? '—')) },
              { schluessel: 'budget', kopf: 'Obergrenze', numerisch: true,
                zelle: (b) => (b.budget_cent === null ? '—' : (
                  <span>
                    {formatiereGeld(cent(BigInt(b.budget_cent)))}
                    {b.ist_platzhalter ? <span className="ml-s2 text-xs text-text-muted">Platzhalter</span> : null}
                  </span>
                )) },
              { schluessel: 'verbrauch', kopf: 'Verbraucht', numerisch: true,
                zelle: (b) => formatiereGeld(cent(mikrocentNachCent(BigInt(b.verbrauch_mikrocent)))) },
              { schluessel: 'reserviert', kopf: 'Gebunden', numerisch: true,
                zelle: (b) => formatiereGeld(cent(mikrocentNachCent(BigInt(b.reserviert_mikrocent)))) },
              { schluessel: 'status', kopf: 'Status',
                zelle: (b) => <StatusPill zustand={BUDGET_PILLE[b.status] ?? 'Aktiv'} /> },
            ]}
          />
        </div>
      )}

      <h2 className="mb-s3 mt-s6 text-h2 text-text">Aktivität</h2>
      {aktivitaet.length === 0 ? (
        <LeereListe text="Noch kein Lauf in dieser Auswahl." />
      ) : (
        <div data-cse="agenten-aktivitaet">
          <DataTable
            beschriftung="Aufgaben und Kosten je Agent und Gesellschaft"
            zeilen={aktivitaet}
            schluessel={(a) => `${a.slug}:${a.agent}`}
            spalten={[
              { schluessel: 'bereich', kopf: 'Gesellschaft',
                zelle: (a) => <BereichMarke slug={a.slug} name={a.bereich_name} /> },
              { schluessel: 'agent', kopf: 'Agent', zelle: (a) => a.agent },
              { schluessel: 'aufgaben', kopf: 'Aufgaben', numerisch: true, zelle: (a) => a.aufgaben },
              { schluessel: 'laufend', kopf: 'Laufend', numerisch: true, zelle: (a) => a.laufend },
              { schluessel: 'kosten', kopf: 'Kosten', numerisch: true,
                zelle: (a) => formatiereGeld(cent(BigInt(a.kosten_cent))) },
              { schluessel: 'letzte', kopf: 'Zuletzt', zelle: (a) => a.letzte ?? '—' },
            ]}
          />
        </div>
      )}
      <GruppenHinweis text="Die Obergrenze je Gesellschaft ist ein Platzhalter, bis die Geschäftsführung sie festlegt (O-26). Geändert wird sie im Bereich, unter KI-Budget." />
    </GruppenRahmen>
  );
}
