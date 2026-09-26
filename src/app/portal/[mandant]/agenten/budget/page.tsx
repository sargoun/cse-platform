import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { mikrocentNachCent } from '@/server/agent/kosten';
import { warnschwelleOffen } from '@/server/agent/budget';
import { monatsName } from '@/lib/datum/kalendertag';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { BUDGET_TEXTE } from '@/lib/i18n/verwaltung/agent-budget';
import { eigenerEintrag } from '@/lib/nachschlagen';

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

const RECHT_BUDGET = 'agent.budget_verwalten';
const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

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
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
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

  const { budgets, offen, agenten } = await (db().begin(SCHNAPPSCHUSS,
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

      /* Fuer die Auswahl im Formular — nur die, die es in dieser
         Gesellschaft ueberhaupt gibt. */
      const agenten = await kontext.abfrage<{ id: string; name: string }>(
        `select id, name from agent order by name`);

      return { budgets, offen, agenten };
    }))) as { budgets: readonly BudgetZeile[]; offen: readonly Offen[];
      agenten: readonly { id: string; name: string }[] };

  /* Der laufende Monat kommt aus der DATENBANK, nicht aus dem Node-Prozess
     (Invariante 2): am Ersten um 00:30 Berliner Zeit ist der UTC-Monat noch
     der alte, und das Formular schlüge den falschen Monat vor. */
  const heuteBerlin = await berlinHeute();
  const jahrJetzt = Number(heuteBerlin.slice(0, 4));
  const monatJetzt = Number(heuteBerlin.slice(5, 7));
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gesetzt = suche['gesetzt'] !== undefined;
  const darf = await haeltRechte(sitzung, RECHT_BUDGET);
  const t = nachSprache(BUDGET_TEXTE, zugang.sprache);
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
                  {b.warnschwelle_prozent === null ? null : (
                    <span className="text-xs text-text-muted" data-cse="budget-warnung-ab">
                      {t.warnungAb(b.warnschwelle_prozent)}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}

      {/*
        **Die Warnschwelle wird genannt, nicht erfunden** (O-195, V-245). Die
        Abfrage oben liest `warnschwelle_prozent`, und bis V-015 stand hier
        unbedingt „nicht hinterlegt". Mit der Maske darunter LÄSST sie sich
        setzen — der Satz fiel dabei ersatzlos weg, und die Seite schwieg
        über eine Schwelle, die sie gar nicht zeigte. Jetzt: eine gesetzte
        Schwelle steht in ihrer Zeile, und solange eine gezeigte Zeile keine
        hat (oder es keine Zeile gibt), steht der Satz wieder da. Die
        Bedingung steht als `warnschwelleOffen` im Budgetdienst und ist dort in
        beiden Zweigen geprüft (V-254) — hier stand sie als Ausdruck, dessen
        zweiter Zweig nie lief. Erklärender Text in `text-text-muted`, nicht
        `text-subtle`: DESIGN §9 hält `--text-subtle` Meta, Zeitstempeln und
        Platzhaltern vor.
      */}
      {warnschwelleOffen(budgets) ? (
        <p className="mt-s5 max-w-prose text-sm text-text-muted" data-cse="budget-warnschwelle-offen">
          {t.warnschwelleOffen}
        </p>
      ) : null}

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

      {/*
        **Die Obergrenze setzen** (V-015). Bis dahin las diese Seite
        `agent_budget` und zeigte sie sauber an — angelegt hat eine Zeile nur
        der Seed, mit `budget_cent is null`. Das heisst „kein Budget
        entschieden", und darauf antwortet `app.agent_budget_pruefen` mit
        `budget_fehlt`: es lief kein einziger Agent.
      */}
      <h2 className="mb-s2 mt-s6 text-h2 text-text">{t.titel}</h2>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">{t.erklaerung}</p>

      {gesetzt && fehler === null && (
        <Hinweis art="erfolg" cse="budget-gesetzt" className="mb-s4 max-w-prose">
          {t.gesetzt}
        </Hinweis>
      )}
      {fehler !== null && (
        <Hinweis art="warnung" cse="budget-fehler" className="mb-s4 max-w-prose">
          {eigenerEintrag(t.fehler, fehler) ?? fehler}
        </Hinweis>
      )}

      {darf[RECHT_BUDGET] !== true ? (
        <Hinweis art="hinweis" cse="budget-kein-recht" className="max-w-prose">
          {t.keinSchreibrecht} <Recht schluessel={RECHT_BUDGET} sprache={zugang.sprache} />.
          {' '}{t.warumRecht}
        </Hinweis>
      ) : (
        <Card>
          <form method="post" action="/api/agenten/budget" data-cse="budget-formular"
                className="flex max-w-[60ch] flex-col gap-s5">
            <input type="hidden" name="mandant" value={mandant} />
            <p className="m-0 text-sm text-text-muted">{t.warumRecht}</p>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.geltung}
              <select name="agent" className={FELD} defaultValue="" data-cse="budget-agent">
                <option value="">{t.fuerMandant}</option>
                {agenten.map((a) => (
                  <option key={a.id} value={a.id}>{t.fuerAgent}: {a.name}</option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.jahr}
                <input type="number" name="jahr" min={2000} max={2100} required
                       defaultValue={jahrJetzt} className={FELD} data-cse="budget-jahr" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.monat}
                <input type="number" name="monat" min={1} max={12} required
                       defaultValue={monatJetzt} className={FELD} data-cse="budget-monat" />
              </label>
            </div>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.betrag}
              <input name="budget" required inputMode="decimal" maxLength={20}
                     className={FELD} data-cse="budget-betrag" />
              <span className="text-xs text-text-muted">{t.betragErklaerung}</span>
            </label>

            <label className="flex items-start gap-s3 text-sm text-text">
              <input type="checkbox" name="stopp" value="1" defaultChecked
                     className="mt-s1 min-h-5 min-w-5" data-cse="budget-stopp" />
              <span>
                {t.stopp}
                <span className="mt-s1 block text-xs text-text-muted">{t.stoppErklaerung}</span>
              </span>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.warnschwelle} <span className="text-text-muted">{t.freiwillig}</span>
              <input type="number" name="warnschwelle" min={1} max={100}
                     className={FELD} data-cse="budget-warnschwelle" />
              <span className="text-xs text-text-muted">{t.warnschwelleErklaerung}</span>
            </label>

            <div>
              <Button type="submit" variante="primary" data-cse="budget-speichern">
                {t.speichern}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
