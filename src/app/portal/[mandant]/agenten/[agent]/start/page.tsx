import type postgres from 'postgres';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { mikrocentNachCent } from '@/server/agent/kosten';
import { ENTWURF_AUFTRAEGE, fuelleTatsachen } from '@/server/agent/auftraege';
import { VORGANG_LABEL } from '../../../freigaben/darstellung';
import type { VorgangTyp } from '@/server/services/freigabe/posteingang';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '../../../../rechte';
import { kennungFuer } from '../../kennung';
import { MAX_SCHRITTE_PLATZHALTER } from '@/server/agent/limits.platzhalter';

/**
 * `/portal/[mandant]/agenten/[agent]/start` — das Vorschaltblatt vor einem
 * Lauf (AGT-01, AGT-05, Invariante 6, Invariante 7).
 *
 * **Warum es diese Seite gibt, obwohl der Knopf auch auf der Detailseite
 * steht.** Dort ist er einer von acht Abschnitten. Hier steht vor ihm, was
 * dieser Lauf tun wird: welcher Auftrag (aus `ENTWURF_AUFTRAEGE`, nicht aus
 * dem Formular), welche Vorgangsart daraus entsteht, welche Tatsachen aus
 * DIESER Gesellschaft hineingehen, welches Modell formuliert und wie viel
 * Budget noch übrig ist. Wer auf einen Knopf drückt, der eine Modellanfrage
 * kostet und eine Freigabe im Posteingang anlegt, soll beides vorher gelesen
 * haben.
 *
 * **Die Zahlen unten kommen NICHT aus einem Modell** (Invariante 6). Sie sind
 * `count(*)`-Abfragen gegen die Tabellen der aktiven Gesellschaft, von
 * `fuelleTatsachen()` gestellt und durch RLS begrenzt; das Modell bekommt sie
 * als fertige Zeichenkette und setzt sie in Sätze. Deshalb stehen sie hier
 * schon vor dem Lauf — genau diese Werte gehen hinein, und `pruefeZahlenherkunft`
 * weist nach dem Lauf jede ab, die dazugekommen ist.
 *
 * **Und der Lauf sendet nichts.** Am Ende steht eine offene Freigabe im
 * Posteingang. Was daraus wird, entscheidet ein Mensch (Invariante 7).
 *
 * **Kein Zweig für „ohne Startrecht".** Die Route ist im Manifest auf
 * `agent.aufgabe_starten` bewacht, und `pruefeZugang` antwortet bei fehlendem
 * Recht mit 404 (AUT-06) — wer es nicht hält, sieht diese Seite nie. Der
 * Ersatzsatz steht auf der Detailseite, weil die nur `agent.lesen` verlangt.
 *
 * **`agent.lesen` wird trotzdem gefragt** — für den Budgetstand. `agent_budget`
 * hängt per RLS an `agent.lesen`, nicht an `agent.aufgabe_starten`; ohne die
 * Frage stünde bei fehlendem Recht still „kein Budget hinterlegt", und das
 * ist die gefährlichere der beiden Falschaussagen: sie liest sich wie „es
 * gibt keine Obergrenze".
 */
export const dynamic = 'force-dynamic';

interface AgentKopf {
  readonly id: string;
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string;
  readonly verbot_beschreibung: string;
  readonly ist_aktiv: boolean;
  readonly max_schritte: number | null;
}

interface BudgetStand {
  readonly budgetCent: bigint | null;
  readonly verbrauchMikrocent: bigint;
  readonly reserviertMikrocent: bigint;
  readonly status: string;
  readonly istPlatzhalter: boolean;
  readonly stoppt: boolean;
}

/** Wie die Schlüssel der Tatsachen auf dem Bildschirm heissen. */
const TATSACHE_LABEL: Readonly<Record<string, string>> = {
  stand: 'Stand (Serverdatum, Europe/Berlin)',
  offene_freigaben: 'Offene Freigaben',
  unbesetzte_schichten_morgen: 'Unterbesetzte Schichten morgen',
  zusammenfassung: 'Zusammenfassung (aus denselben Zahlen gebaut)',
  empfehlung: 'Empfehlung (feste Vorgabe des Auftrags)',
  empfaenger: 'Empfänger der Anfrage',
  datum: 'Eingang der Anfrage',
  betreff: 'Betreff der Anfrage',
  offene_anfragen: 'Offene Anfragen',
  offen: 'Was im Entwurf offen bleibt',
  ohne_unterschrift: 'Leistungsnachweise ohne Unterschrift',
  nachweise_gesamt: 'Leistungsnachweise insgesamt',
  ueberfaellige_forderungen: 'Überfällige Forderungen',
  faellige_eingangsrechnungen: 'Fällige Eingangsrechnungen',
};

export default async function AgentStart(
  { params }: { params: Promise<{ mandant: string; agent: string }> },
) {
  const { mandant, agent } = await params;
  const kennung = kennungFuer(agent);
  if (kennung === undefined) notFound();

  const tor = await mandantTor(`/portal/${mandant}/agenten/${agent}/start`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * Einmal je Aufruf DIESER Seite: ein Doppelklick, ein „Formular erneut
   * senden" und eine wiederholte Zustellung schicken denselben Wert, und
   * `starteAufgabe` findet die vorhandene Aufgabe statt eine zweite
   * anzulegen. Wer die Seite neu lädt, bekommt einen neuen Schlüssel — ein
   * zweiter Lauf, den jemand WILL, bleibt möglich.
   */
  const laufSchluessel = randomUUID();

  const darf = await haeltRechte(zugang.sitzung, 'agent.lesen', 'freigabe.lesen');
  const darfBudget = darf['agent.lesen'] === true;

  const auftrag = ENTWURF_AUFTRAEGE[kennung];

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<AgentKopf>(
        `select id, kennung::text as kennung, name, beschreibung, verbot_beschreibung,
                ist_aktiv, max_schritte
           from agent where kennung = $1::agent_kennung`,
        [kennung]);
      if (kopf === undefined) return null;

      const [modell] = await kontext.abfrage<{ modell: string | null; anbieter: string | null }>(
        `select app.modell_fuer('entwurf_text') as modell,
                (select r.anbieter from modell_register r
                  where r.modell = app.modell_fuer('entwurf_text')
                    and r.faehigkeit = 'entwurf_text' limit 1) as anbieter`);

      /*
       * **Das Budget nur fragen, wenn die Sitzung es sehen darf.** Ohne
       * `agent.lesen` gibt die Policy null Zeilen zurück, und null Zeilen
       * heissen dann „ich darf nicht sehen" und nicht „es ist keines
       * hinterlegt".
       */
      const budget = darfBudget
        ? await kontext.abfrage<{
          budget_cent: string | null; verbrauch_mikrocent: string;
          reserviert_mikrocent: string; status: string; ist_platzhalter: boolean;
          stopp_bei_ueberschreitung: boolean;
        }>(
          `select b.budget_cent::text, b.verbrauch_mikrocent::text,
                  b.reserviert_mikrocent::text, b.status::text as status,
                  b.ist_platzhalter, b.stopp_bei_ueberschreitung
             from agent_budget b
            where b.geltungsbereich = 'mandant'
              and (b.jahr, b.monat) = (extract(year from app.berlin_heute())::int,
                                       extract(month from app.berlin_heute())::int)`)
        : [];

      /*
       * **Die Tatsachen werden HIER gelesen, mit derselben Funktion, die der
       * Lauf benutzt** — nicht mit einer zweiten Abfrage, die dasselbe
       * meint. Zwei Abfragen liefen auseinander, und dann stünde auf dem
       * Vorschaltblatt eine andere Zahl als im Entwurf.
       */
      const tatsachen = await fuelleTatsachen(
        { abfrage: kontext.abfrage.bind(kontext) }, kennung);

      return {
        kopf, tatsachen,
        modell: modell?.modell ?? null,
        anbieter: modell?.anbieter ?? null,
        budget: budget[0] === undefined ? null : {
          budgetCent: budget[0].budget_cent === null ? null : BigInt(budget[0].budget_cent),
          verbrauchMikrocent: BigInt(budget[0].verbrauch_mikrocent),
          reserviertMikrocent: BigInt(budget[0].reserviert_mikrocent),
          status: budget[0].status,
          istPlatzhalter: budget[0].ist_platzhalter,
          stoppt: budget[0].stopp_bei_ueberschreitung,
        } satisfies BudgetStand,
      };
    })) as Promise<{
      kopf: AgentKopf;
      tatsachen: Readonly<Record<string, string>>;
      modell: string | null;
      anbieter: string | null;
      budget: BudgetStand | null;
    } | null>);

  if (daten === null) notFound();
  const { kopf, tatsachen, modell, anbieter, budget } = daten;

  const verbrauchCent = budget === null ? 0n : mikrocentNachCent(budget.verbrauchMikrocent);
  const gebundenCent = budget === null ? 0n : mikrocentNachCent(budget.reserviertMikrocent);
  const restCent = budget === null || budget.budgetCent === null
    ? null : budget.budgetCent - verbrauchCent - gebundenCent;
  const gestoppt = budget !== null
    && (budget.status === 'gestoppt'
      || (budget.stoppt && restCent !== null && restCent <= 0n));

  return (
    <PortalRahmen
      titel="Lauf starten"
      wurzelTitel="Agenten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">Lauf starten</h1>
          <p className="mt-s2 max-w-prose text-sm text-text-muted">{kopf.name}</p>
        </div>
        <span className="flex items-center gap-s2">
          <StatusPill zustand={kopf.ist_aktiv ? 'Aktiv' : 'Inaktiv'} />
          <Link href={`/portal/${mandant}/agenten/${agent}`}
                data-cse="start-zum-agenten"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zum Agenten
          </Link>
        </span>
      </div>

      <Hinweis art="hinweis" cse="start-legt-vor" className="mb-s5 max-w-prose">
        <strong>Ein Lauf versendet nichts.</strong> Er formuliert einen Entwurf aus
        gerechneten Zahlen und legt ihn als offene Freigabe im Posteingang vor; was daraus
        wird, entscheidet ein Mensch (Invariante 7).
        {darf['freigabe.lesen'] === true ? (
          <>
            {' '}
            <Link href={`/portal/${mandant}/freigaben`} data-cse="start-zum-posteingang"
                  className="underline underline-offset-2">
              zum Posteingang
            </Link>
          </>
        ) : null}
      </Hinweis>

      {/* ------------------------------------------------ Was dieser Lauf tut */}
      <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
               data-cse="start-auftrag">
        <h2 className="text-h2 text-text">Was dieser Lauf tut</h2>
        {auftrag === undefined ? (
          <p className="mt-s3 text-sm text-text-muted" data-cse="start-ohne-auftrag">
            Für diesen Agenten ist kein von Hand auslösbarer Auftrag hinterlegt
            (<code className="text-xs">server/agent/auftraege.ts</code>). Solange keiner
            eingetragen ist, gibt es hier nichts zu starten — die Liste der Aufträge ist
            der geschlossene Satz, und ein Formular, das eine Vorlage mitgäbe, wäre ein
            Weg, das Modell an den Diensten vorbei zu füttern.
          </p>
        ) : (
          <dl className="mt-s3 grid grid-cols-1 gap-s2 text-sm sm:grid-cols-[12rem_1fr] sm:gap-x-s5">
            <dt className="text-text-muted">Auftrag</dt>
            <dd className="text-text" data-cse="start-titel">{auftrag.titel}</dd>
            <dt className="text-text-muted">Vorgangsart</dt>
            <dd className="text-text" data-cse="start-vorgang" data-typ={auftrag.vorgangTyp}>
              {VORGANG_LABEL[auftrag.vorgangTyp as VorgangTyp] ?? auftrag.vorgangTyp}
            </dd>
            <dt className="text-text-muted">Was eine Genehmigung auslöst</dt>
            <dd className="text-text">
              <code className="text-xs">{auftrag.aktion}</code>
              {auftrag.aktion === 'interner_hinweis'
                ? ' — eine Handlung im Haus, kein Versand.'
                : ' — ein Mensch übernimmt den Text und verschickt ihn selbst.'}
            </dd>
            <dt className="text-text-muted">Schritte je Aufgabe</dt>
            <dd className="text-text">
              {kopf.max_schritte === null
                /* Die Zahl kommt aus der Quelle, nicht aus dieser Zeile: `laufzeit.ts`
                   benutzt `MAX_SCHRITTE_PLATZHALTER` als Rueckfall, wenn `max_schritte`
                   leer ist. Stand hier die 12 als Literal, sagte der Bildschirm nach
                   einer Aenderung des Platzhalters eine Grenze zu, die nicht gilt. */
                ? `${String(MAX_SCHRITTE_PLATZHALTER)} — Platzhalter (offene Frage O-196)`
                : String(kopf.max_schritte)}
            </dd>
          </dl>
        )}
        <p className="mt-s4 max-w-prose rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text">
          <strong>Er tut ausdrücklich nicht:</strong> {kopf.verbot_beschreibung}
        </p>
      </section>

      {/* ------------------------------------------------------- Die Tatsachen */}
      <section className="mb-s6 max-w-prose" data-cse="start-tatsachen">
        <h2 className="mb-s2 text-h2 text-text">Womit er formuliert</h2>
        <p className="mb-s3 text-sm text-text-muted">
          Genau diese Werte gehen in den Entwurf. Sie sind aus den Tabellen dieser
          Gesellschaft gezählt — <strong>gerechnet, nicht vom Modell geschätzt</strong>
          {' '}(Invariante 6). Das Modell setzt sie in Sätze und rechnet nichts; nach dem
          Lauf prüft <code className="text-xs">pruefeZahlenherkunft</code>, dass keine Zahl
          dazugekommen ist. Das Datum kommt von der Serveruhr
          (<code className="text-xs">app.berlin_heute()</code>), nie aus dem Browser.
        </p>
        {Object.keys(tatsachen).length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diesen Agenten füllt <code className="text-xs">fuelleTatsachen()</code>
            {' '}keine Werte. Ein Platzhalter ohne Tatsache bleibt im Entwurf STEHEN und
            fällt auf — er wird nicht stillschweigend leer.
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-s2 rounded-lg border border-line bg-surface p-s5 text-sm sm:grid-cols-[12rem_1fr] sm:gap-x-s5">
            {Object.entries(tatsachen).map(([schluessel, wert]) => (
              <div key={schluessel} className="contents">
                <dt className="text-text-muted" data-cse="start-tatsache"
                    data-schluessel={schluessel}>
                  {TATSACHE_LABEL[schluessel] ?? schluessel}
                </dt>
                <dd className="text-text">{wert === '' ? '—' : wert}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* ------------------------------------------------------ Modell, Budget */}
      <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
               data-cse="start-lage">
        <h2 className="text-h2 text-text">Womit und wovon</h2>
        <p className="mt-s3 text-sm" data-cse="start-modell" data-anbieter={anbieter ?? ''}>
          <span className="text-text-subtle">Formuliert mit: </span>
          {modell === null ? (
            <span className="text-text">
              kein Modell freigegeben — die KI-Funktion ist abgeschaltet (§8, D-04)
            </span>
          ) : (
            <>
              <code className="text-text">{modell}</code>
              {anbieter === 'demo' ? (
                <span className="text-text-muted">
                  {' '}· Demobetrieb: läuft im eigenen Prozess, kein Anbieter, kein
                  Netzverkehr. Er formuliert aus Vorlagen und gerechneten Werten und
                  erfindet keine Zahl.
                </span>
              ) : (
                <span className="text-text-muted">
                  {' '}· Anbieter {anbieter ?? 'unbekannt'}, freigegeben im Modellregister
                  (EU-Verarbeitung und Nullspeicherung, §8).
                </span>
              )}
            </>
          )}
        </p>

        <p className="mt-s3 text-sm" data-cse="start-budget"
           data-gestoppt={gestoppt ? '1' : '0'}>
          <span className="text-text-subtle">Budget dieses Monats: </span>
          {!darfBudget ? (
            <span className="text-text-muted">
              hier nicht sichtbar — dafür braucht es das Recht
              {' '}<code className="text-xs">agent.lesen</code>. Das heisst nicht, dass
              keine Obergrenze gilt.
            </span>
          ) : budget === null ? (
            <span className="text-text-muted">
              für diesen Monat ist keine Obergrenze hinterlegt. Der harte Stopp aus AGT-05
              greift dann nicht — wie viel die KI kosten darf, entscheidet die
              Geschäftsführung (offene Frage O-26).
            </span>
          ) : (
            <span className="text-text">
              {budget.budgetCent === null
                ? 'ohne Betragsgrenze'
                : formatiereGeld(cent(budget.budgetCent))}
              {' · verbraucht '}{formatiereGeld(cent(verbrauchCent))}
              {gebundenCent > 0n ? ` · gebunden ${formatiereGeld(cent(gebundenCent))}` : ''}
              {restCent === null ? '' : ` · übrig ${formatiereGeld(cent(restCent))}`}
              {budget.istPlatzhalter ? ' — Platzhalter (O-26)' : ''}
            </span>
          )}
        </p>
      </section>

      {/* ------------------------------------------------------------ Der Knopf */}
      {!kopf.ist_aktiv ? (
        <Hinweis art="warnung" cse="start-agent-aus" className="max-w-prose">
          <strong>Der Agent ist abgeschaltet.</strong> Solange er aus ist, läuft er
          nicht — auch nicht auf Knopfdruck. Abgeschaltet ist er, solange kein
          Modellzugang eingerichtet ist (D-435).
        </Hinweis>
      ) : auftrag === undefined ? null : modell === null ? (
        <Hinweis art="warnung" cse="start-kein-modell" className="max-w-prose">
          <strong>Ohne freigegebenes Modell gibt es keinen Lauf.</strong> Die Arbeit läuft
          von Hand weiter; nichts wird ersatzweise erfunden. Ein Knopf, der verspricht,
          was nicht geht, wäre schlimmer als keiner.
        </Hinweis>
      ) : gestoppt ? (
        <Hinweis art="warnung" cse="start-budget-stopp" className="max-w-prose">
          <strong>Das Monatsbudget ist ausgeschöpft.</strong> Der harte Stopp aus AGT-05
          weist weitere Läufe ab — ein Knopf, den der Deckel abweisen würde, hätte gar
          nicht erst dastehen dürfen.
        </Hinweis>
      ) : (
        <form method="post" action="/api/agenten/lauf"
              data-cse="start-formular"
              className="max-w-prose rounded-lg border border-line bg-surface p-s5">
          {/*
            * Kein verstecktes `mandant`-Feld: die Route nimmt den Bereich aus
            * der Sitzung (Invariante 3). Ein Feld, das der Server nicht liest,
            * sieht im Quelltext aus wie eine Stellschraube und ist keine.
            */}
          <input type="hidden" name="agent" value={kopf.kennung} />
          <input type="hidden" name="schluessel" value={laufSchluessel} />
          <p className="mb-s4 text-sm text-text-muted">
            Nach dem Start steht das Ergebnis in der Aktivitätsliste des Agenten — dorthin
            führt der Weg zurück. Einen zweiten Vorschlag zur selben Lage gibt es nicht:
            ein Ereignis darf zweimal ankommen, der Agent läuft einmal.
          </p>
          <Button type="submit" variante="primary" data-cse="start-ausloesen">
            Lauf starten und vorlegen
          </Button>
        </form>
      )}
    </PortalRahmen>
  );
}
