import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { mikrocentNachCent } from '@/server/agent/kosten';
import { monatsName } from '@/lib/datum/kalendertag';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/agenten/budget` — Obergrenze, Verbrauch, Reservierung
 * und der harte Stopp (AGT-05, SPEC §22).
 *
 * **Diese Seite ist die Antwort auf „warum läuft nichts mehr".** Der
 * Hartstopp lehnt Läufe ab und schreibt eine Benachrichtigung; wer der
 * Benachrichtigung folgt, landet hier und muss in einem Blick sehen: welche
 * Obergrenze gilt, wieviel davon verbraucht ist, wieviel gerade gebunden ist
 * — und ob gestoppt wurde.
 *
 * **Die Cent-Zahl entsteht an EINER Stelle** (`mikrocentNachCent`, K-16(b)).
 * Der Verbrauch liegt in Mikrocent, weil ein einzelner Modellaufruf Bruchteile
 * eines Cents kostet und auf Cent gerundet jeder erste Schritt 0 wäre. Die
 * Umrechnung geschieht hier, an der Anzeigegrenze, mit derselben Funktion wie
 * überall sonst — zwei Umrechnungsstellen hiessen zwei Beträge, und beide
 * hätten recht.
 *
 * **`Platzhalter` steht dran, wo es einer ist.** Der Seed legt 50,00 € je
 * Gesellschaft an, damit überhaupt etwas läuft; wieviel die KI kosten darf,
 * entscheidet die Geschäftsführung (O-26). Eine Zahl ohne diese Markierung
 * sähe aus wie eine Entscheidung.
 */
export const dynamic = 'force-dynamic';

const BUDGET_PILLE: Readonly<Record<string, PillZustand>> = {
  aktiv: 'Aktiv',
  gewarnt: 'Wartet',
  gestoppt: 'Abgelehnt',
};

interface BudgetZeile {
  readonly id: string;
  readonly bereich: string;
  readonly agent: string | null;
  readonly jahr: number;
  readonly monat: number;
  readonly budget_cent: string | null;
  readonly verbrauch_mikrocent: string;
  readonly reserviert_mikrocent: string;
  readonly status: string;
  readonly ist_platzhalter: boolean;
  readonly stopp_bei_ueberschreitung: boolean;
  readonly warnschwelle_prozent: number | null;
  readonly gestoppt_am: string | null;
}

interface Offen {
  readonly id: string;
  readonly aufgabe: string | null;
  readonly betrag_mikrocent: string;
  readonly verfaellt_am: string;
}

/** Ein Balken ohne eigene Rechnung: Anteil in Prozent, gedeckelt bei 100. */
function anteilProzent(verbrauchMikrocent: bigint, budgetCent: bigint): number {
  if (budgetCent <= 0n) return 100;
  const promille = (verbrauchMikrocent * 1000n) / (budgetCent * 10_000n);
  return Math.min(100, Number(promille) / 10);
}

export default async function AgentBudget(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/agenten/budget`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const { budgets, offen } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const budgets = await kontext.abfrage<BudgetZeile>(
        `select b.id, b.geltungsbereich::text as bereich, ag.name as agent,
                b.jahr, b.monat, b.budget_cent::text,
                b.verbrauch_mikrocent::text, b.reserviert_mikrocent::text,
                b.status::text as status, b.ist_platzhalter,
                b.stopp_bei_ueberschreitung, b.warnschwelle_prozent,
                to_char(b.gestoppt_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as gestoppt_am
           from agent_budget b
           left join agent ag on ag.id = b.agent_id
          order by b.jahr desc, b.monat desc,
                   (b.geltungsbereich = 'mandant') desc, ag.name`);

      /*
       * Offene Reservierungen: gebundenes Budget, das noch nicht gebucht ist.
       * Sie stehen hier, weil sie sonst unerklaerlich waeren — der Verbrauch
       * ist niedrig, und trotzdem lehnt der Deckel ab.
       */
      const offen = await kontext.abfrage<Offen>(
        `select r.id, a.titel as aufgabe, r.betrag_mikrocent::text,
                to_char(r.verfaellt_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as verfaellt_am
           from agent_reservierung r
           left join agent_aufgabe a
             on a.mandant_id = r.mandant_id and a.id = r.agent_aufgabe_id
          where r.freigegeben_am is null
          order by r.verfaellt_am`);

      return { budgets, offen };
    }))) as { budgets: readonly BudgetZeile[]; offen: readonly Offen[] };

  const gestoppt = budgets.filter((b) => b.status === 'gestoppt');

  return (
    <PortalRahmen
      titel="KI-Budget"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">KI-Budget</h1>

      {gestoppt.length === 0 ? null : (
        <section className="mb-s5 rounded-lg border border-danger bg-danger-soft p-s5">
          <h2 className="text-h3 text-text">Gestoppt</h2>
          <p className="mt-s2 text-sm text-text-muted">
            Das Monatsbudget ist erreicht. Weitere Läufe werden abgelehnt, bis
            die Obergrenze erhöht wird oder der Monat wechselt. Manuelle Arbeit
            ist nicht betroffen — der Stopp gilt den Agenten, nicht dem Portal.
          </p>
        </section>
      )}

      {budgets.length === 0 ? (
        <p className="rounded-lg border border-warning bg-warning-soft p-s5 text-sm text-text">
          <strong>Für diesen Monat ist kein Budget hinterlegt.</strong>{' '}
          Ohne Budgetzeile läuft kein Agent — das ist die sichere Richtung: kein
          Budget heisst „nicht entschieden" und nicht „unbegrenzt" (offene Frage
          O-26).
        </p>
      ) : (
        <DataTable
          beschriftung="Monatsbudgets der Agenten mit Obergrenze, Verbrauch und Zustand"
          zeilen={budgets}
          schluessel={(b) => b.id}
          spalten={[
            {
              schluessel: 'monat',
              kopf: 'Monat',
              zelle: (b) => monatsName(
                `${String(b.jahr).padStart(4, '0')}-${String(b.monat).padStart(2, '0')}-01`,
              ),
            },
            {
              schluessel: 'geltung',
              kopf: 'Gilt für',
              zelle: (b) => (b.bereich === 'mandant'
                ? 'Alle Agenten'
                : b.agent ?? 'Agent'),
            },
            {
              schluessel: 'budget',
              kopf: 'Obergrenze',
              numerisch: true,
              zelle: (b) => (b.budget_cent === null
                ? <span className="text-text-subtle">nicht festgelegt</span>
                : (
                  <span className="inline-flex items-baseline gap-s2">
                    {formatiereGeld(cent(BigInt(b.budget_cent)))}
                    {b.ist_platzhalter
                      ? <span className="text-xs text-text-subtle">Platzhalter</span>
                      : null}
                  </span>
                )),
            },
            {
              schluessel: 'verbrauch',
              kopf: 'Verbraucht',
              numerisch: true,
              zelle: (b) => {
                const verbraucht = mikrocentNachCent(BigInt(b.verbrauch_mikrocent));
                if (b.budget_cent === null) return formatiereGeld(cent(verbraucht));
                const anteil = anteilProzent(
                  BigInt(b.verbrauch_mikrocent), BigInt(b.budget_cent),
                );
                return (
                  <span className="inline-flex items-baseline gap-s2">
                    {formatiereGeld(cent(verbraucht))}
                    <span className="text-xs text-text-subtle">
                      {anteil.toFixed(0)} %
                    </span>
                  </span>
                );
              },
            },
            {
              schluessel: 'reserviert',
              kopf: 'Gebunden',
              numerisch: true,
              zelle: (b) => formatiereGeld(
                cent(mikrocentNachCent(BigInt(b.reserviert_mikrocent))),
              ),
            },
            {
              schluessel: 'stopp',
              kopf: 'Zustand',
              zelle: (b) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={BUDGET_PILLE[b.status] ?? 'Aktiv'} />
                  {b.gestoppt_am === null
                    ? null
                    : <span className="text-xs text-text-muted">seit {b.gestoppt_am}</span>}
                  {b.stopp_bei_ueberschreitung
                    ? null
                    : <span className="text-xs text-warning">ohne Hartstopp</span>}
                </span>
              ),
            },
          ]}
        />
      )}

      <h2 className="mb-s3 mt-s6 text-h2 text-text">Gebundenes Budget</h2>
      {offen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine offene Reservierung. Jeder Lauf bindet seinen geschätzten Betrag,
          bevor er teuer wird, und gibt ihn beim Buchen wieder frei; ein
          abgestürzter Lauf hält damit kein Budget für immer.
        </p>
      ) : (
        <DataTable
          beschriftung="Offene Reservierungen mit Betrag und Verfallszeit"
          zeilen={offen}
          schluessel={(r) => r.id}
          spalten={[
            {
              schluessel: 'aufgabe',
              kopf: 'Aufgabe',
              zelle: (r) => r.aufgabe ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'betrag',
              kopf: 'Gebunden',
              numerisch: true,
              zelle: (r) => formatiereGeld(
                cent(mikrocentNachCent(BigInt(r.betrag_mikrocent))),
              ),
            },
            { schluessel: 'verfall', kopf: 'Verfällt', zelle: (r) => r.verfaellt_am },
          ]}
        />
      )}

      <p className="mt-s5 text-xs text-text-subtle">
        Warnschwelle: nicht hinterlegt (offene Frage O-195). AGT-05 nennt eine
        Obergrenze und einen harten Stopp; ab welchem Anteil vorher gewarnt
        wird, ist eine Finanzregel und wird nicht erfunden.
      </p>
    </PortalRahmen>
  );
}
