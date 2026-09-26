import type postgres from 'postgres';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungFuer } from '../kennung';
import { MAX_SCHRITTE_PLATZHALTER } from '@/server/agent/limits.platzhalter';
import { haeltRechte } from '../../../rechte';
import {
  WERKZEUG_REGISTER, fuerAgent, untergrenze, type AgentKennung,
} from '@/server/agent/tools/register-werkzeuge';
import { standAus } from '@/server/agent/tools/freischaltung';
import { Recht } from '@/components/ui/Recht';
import { beschriftung } from '@/lib/i18n/beschriftung/basis';
import {
  NEBENWIRKUNG_TEXT, UNTERGRENZE_TEXT, WERKZEUG_TEXT,
} from '@/lib/i18n/beschriftung/agent';
import { eigenerEintrag } from '@/lib/nachschlagen';

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

/** Warum ein Werkzeug nicht gesetzt wurde — ein Satz je Grund aus `werkzeug-pflege.ts`. */
const WERKZEUG_FEHLER: Readonly<Record<string, string>> = {
  unbekannt: 'Dieses Werkzeug gibt es nicht. Es wurde nichts geändert.',
  kein_agent: 'Diesen Agenten gibt es nicht. Es wurde nichts geändert.',
  nicht_im_register: 'Dieser Agent führt dieses Werkzeug nicht — welcher Agent welches '
    + 'Werkzeug führen darf, steht im Register (D-513). Es wurde nichts geändert.',
  freigabe_pflicht: 'Was das Haus verlässt, geht nie ohne menschliche Freigabe hinaus '
    + '(Invariante 7). Es wurde nichts geändert.',
  abgewiesen: 'Nicht gespeichert — dafür fehlt in dieser Gesellschaft das Recht, '
    + 'Werkzeuge zu verbinden.',
};

interface AgentKopf {
  readonly id: string;
  readonly kennung: string;
  readonly name: string;
  readonly beschreibung: string;
  /** Was er ausdruecklich NICHT tut — die Spalte, die es in 0128 gibt. */
  readonly verbot_beschreibung: string;
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
  { params, searchParams }: {
    params: Promise<{ mandant: string; agent: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, agent } = await params;
  const suche = await searchParams;
  const lauf = typeof suche['lauf'] === 'string' ? suche['lauf'] : null;
  const laufCode = typeof suche['code'] === 'string' ? suche['code'] : null;
  const werkzeugGesetzt = suche['werkzeug'] === 'gesetzt';
  const werkzeugFehler = typeof suche['werkzeug_fehler'] === 'string'
    ? suche['werkzeug_fehler'] : null;
  const kennung = kennungFuer(agent);
  if (kennung === undefined) notFound();
  /*
   * Einmal je Aufruf dieser Seite — die Seite ist `force-dynamic`, also ist
   * jeder Aufruf ein neuer Schlüssel und jede Wiederholung DESSELBEN Aufrufs
   * derselbe. Genau das unterscheidet „noch einmal" von „aus Versehen zweimal".
   */
  const laufSchluessel = randomUUID();

  const zugang = await portalZugang(`/portal/${mandant}/agenten/${agent}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;

  /* AUT-06: ein Knopf, dessen Ziel diese Sitzung nicht oeffnen darf,
     verraet die Existenz dessen, was er nicht zeigen darf. */
  const darf = await haeltRechte(
    sitzung, 'agent.budget_verwalten', 'agent.protokoll_lesen', 'freigabe.lesen',
    'agent.werkzeug_verbinden',
  );
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<AgentKopf>(
        `select id, kennung::text as kennung, name, beschreibung, verbot_beschreibung,
                ist_aktiv, max_schritte
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
       *
       * **Das Recht wird GEFRAGT, nicht aus der leeren Menge geschlossen.**
       * `t_richtlinie_lesen` verlangt `versand.lesen` — wer es nicht hat,
       * bekommt null Zeilen, und null Zeilen heissen dann „ich darf nicht
       * sehen" und nicht „es gibt keine". Ohne diese Unterscheidung stuende
       * auf dem Bildschirm „nichts geht automatisch hinaus", waehrend
       * vielleicht das Gegenteil eingestellt ist — die gefaehrlichere der
       * beiden Falschaussagen.
       */
      const [darf] = await kontext.abfrage<{ ok: boolean }>(
        `select app.hat_recht('versand.lesen', app.aktiver_mandant()) as ok`);
      const darfRichtlinien = darf?.ok === true;

      /*
       * **Worauf dieser Agent laeuft** (0154, §8): der Aufrufer fragt nie ein
       * Modell, sondern eine Faehigkeit — und die Antwort steht auf dem
       * Bildschirm, damit niemand raten muss, ob gerade ein Anbieter oder der
       * hausinterne Demobetrieb formuliert.
       */
      const [entwurfModell] = await kontext.abfrage<{ modell: string | null; anbieter: string | null }>(
        `select app.modell_fuer('entwurf_text') as modell,
                (select r.anbieter from modell_register r
                  where r.modell = app.modell_fuer('entwurf_text')
                    and r.faehigkeit = 'entwurf_text' limit 1) as anbieter`);
      const [darfStarten] = await kontext.abfrage<{ ok: boolean }>(
        `select app.hat_recht('agent.aufgabe_starten', app.aktiver_mandant()) as ok`);

      const richtlinien = darfRichtlinien
        ? await kontext.abfrage<Richtlinie>(
          `select aktion::text as aktion, auto_erlaubt, begruendung
             from agent_richtlinie order by aktion`)
        : [];

      /*
       * Der Stand je Werkzeug kommt aus `agent_werkzeug` — welche Zeilen es
       * GIBT, entscheidet das Register im Code (AGT-02, neun Namen). Eine
       * fehlende Zeile heisst „nicht freigeschaltet", nicht „gibt es nicht".
       */
      const stand = await kontext.abfrage<{
        werkzeug: string; ist_aktiv: boolean; erfordert_freigabe: boolean;
      }>(
        `select werkzeug::text as werkzeug, ist_aktiv, erfordert_freigabe
           from agent_werkzeug where agent_id = $1::uuid`, [kopf.id]);

      return {
        kopf, aufgaben, richtlinien, darfRichtlinien, stand,
        modell: entwurfModell?.modell ?? null,
        anbieter: entwurfModell?.anbieter ?? null,
        darfStarten: darfStarten?.ok === true,
      };
    }))) as {
      kopf: AgentKopf;
      aufgaben: readonly AufgabeZeile[];
      richtlinien: readonly Richtlinie[];
      darfRichtlinien: boolean;
      stand: readonly { werkzeug: string; ist_aktiv: boolean; erfordert_freigabe: boolean }[];
      modell: string | null;
      anbieter: string | null;
      darfStarten: boolean;
    } | null;

  if (daten === null) notFound();
  const { kopf, aufgaben, richtlinien, darfRichtlinien, modell, anbieter, darfStarten } = daten;

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

      <p className="mb-s4 max-w-prose text-sm text-text-muted">{kopf.beschreibung}</p>

      {/*
        * **Was er NICHT tut, steht gleichrangig daneben.** Ein Agent ist so
        * gefährlich wie die Menge dessen, was ihm niemand verboten hat; diese
        * Zeile steht seit 0128 in der Tabelle (`verbot_beschreibung`) und
        * gehört auf den Bildschirm, auf dem jemand über das Einschalten
        * nachdenkt — nicht in eine Dokumentation, die er dabei nicht offen hat.
        */}
      <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text">
        <strong>Er tut ausdrücklich nicht:</strong> {kopf.verbot_beschreibung}
      </p>

      {lauf !== null ? (
        <Hinweis
          art={lauf === 'gestoert' ? 'warnung' : 'erfolg'}
          cse="lauf-ergebnis"
          className="mb-s5 max-w-prose"
        >
          {lauf === 'vorgelegt' ? (
              <>
                <strong>Vorschlag liegt vor.</strong>{' '}
                Der Entwurf steht im Freigabe-Posteingang und wartet auf eine Entscheidung —
                versendet wurde nichts.
                {/*
                  * `/freigaben` verlangt laut Manifest `freigabe.lesen`; diese
                  * Seite verlangt nur `agent.lesen`. Wer einen Lauf starten
                  * darf, darf den Posteingang nicht zwangslaeufig oeffnen —
                  * der Verweis fuehrte dann auf 404 und verriet, was er nicht
                  * zeigen darf (AUT-06, Copilot-Runde auf PR 16 / D-581).
                  */}
                {darf['freigabe.lesen'] === true && (
                  <>
                    {' '}
                    <Link href={`/portal/${mandant}/freigaben`}
                          data-cse="zum-posteingang"
                          className="underline underline-offset-2">
                      zum Posteingang
                    </Link>
                  </>
                )}
              </>
          ) : lauf === 'bestand' ? (
              <>
                <strong>Dieser Lauf gab es schon.</strong>{' '}
                Zur selben Lage entsteht kein zweiter Entwurf — ein Ereignis darf zweimal
                ankommen, der Agent läuft einmal.
              </>
          ) : (
            <>
              <strong>Kein Lauf.</strong>{' '}
                {laufCode === 'RESIDENCY_BLOCKED'
                  ? 'Für das Formulieren ist kein Modell mit EU-Verarbeitung und '
                    + 'Nullspeicherung freigegeben (§8, D-04). Die Arbeit läuft von Hand weiter.'
                  : `Der Modellaufruf endete mit „${laufCode ?? 'unbekannt'}". `
                    + 'Der Vorgang steht im Agentenzentrum.'}
            </>
          )}
        </Hinweis>
      ) : null}

      {/*
        * **Der Lauf — und worauf er läuft.**
        *
        * Der Knopf legt VOR, er sendet nicht: am Ende steht ein Vorschlag im
        * Freigabe-Posteingang, und was daraus wird, entscheidet ein Mensch
        * (Invariante 7). Daneben steht, welches Modell formuliert — der
        * Aufrufer fragt eine FÄHIGKEIT, das Register nennt das Modell (§8),
        * und ob gerade ein Anbieter oder der hausinterne Demobetrieb
        * antwortet, soll niemand raten müssen.
        */}
      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5" data-cse="agent-lauf">
        <h2 className="text-h3 text-text">Lauf</h2>
        <p className="mt-s2 max-w-prose text-sm text-text-muted">
          Ein Lauf formuliert einen Entwurf aus gerechneten Zahlen und legt ihn im
          Freigabe-Posteingang vor. Er versendet nichts und ändert nichts — die
          Entscheidung trifft ein Mensch.
        </p>

        <p className="mt-s3 text-sm" data-cse="agent-modell" data-anbieter={anbieter ?? ''}>
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
                  erfindet keine Zahl. Ein echter Anbieter ersetzt ihn, sobald einer
                  im Modellregister freigegeben ist.
                </span>
              ) : null}
            </>
          )}
        </p>

        {!kopf.ist_aktiv ? (
          <p className="mt-s4 text-sm text-text-muted" data-cse="agent-aus">
            Der Agent ist abgeschaltet. Solange er aus ist, läuft er nicht — auch
            nicht auf Knopfdruck.
          </p>
        ) : !darfStarten ? (
          <p className="mt-s4 text-sm text-text-muted" data-cse="agent-kein-startrecht">
            Einen Lauf auszulösen ist eine eigene Befugnis
            („agent.aufgabe_starten"), und dieses Konto hält sie nicht.
          </p>
        ) : modell === null ? (
          <p className="mt-s4 text-sm text-text-muted" data-cse="agent-kein-modell">
            Ohne freigegebenes Modell gibt es keinen Lauf. Die Arbeit läuft von Hand
            weiter; nichts wird ersatzweise erfunden.
          </p>
        ) : (
          <form method="post" action="/api/agenten/lauf" className="mt-s4">
            {/*
              * Kein verstecktes `mandant`-Feld: die Route nimmt den Bereich aus
              * der Sitzung (Invariante 3). Ein Feld, das der Server nicht
              * liest, sieht im Quelltext aus wie eine Stellschraube und ist
              * keine — und wer es aendert, glaubt danach, er habe etwas
              * bewirkt.
              */}
            <input type="hidden" name="agent" value={kopf.kennung} />
            {/*
              * **Der Schlüssel gegen den zweiten Vorschlag.** Er entsteht
              * einmal je Aufruf DIESER Seite; ein Doppelklick, ein „Formular
              * erneut senden" und eine wiederholte Zustellung schicken
              * denselben Wert, und `starteAufgabe` findet die vorhandene
              * Aufgabe statt eine zweite anzulegen. Wer die Seite neu lädt,
              * bekommt einen neuen Schlüssel — ein zweiter Lauf, den jemand
              * WILL, ist nach wie vor einer.
              */}
            <input type="hidden" name="schluessel" value={laufSchluessel} />
            <Button type="submit" variante="primary" data-cse="agent-starten">
              Lauf starten und vorlegen
            </Button>
            {/*
              * **Der Eingang zum Vorschaltblatt.** `/agenten/[agent]/start`
              * wird im Manifest mit demselben `agent.aufgabe_starten` bewacht,
              * das diesen Zweig überhaupt erst zeichnet — wer den Verweis
              * sieht, darf die Seite öffnen (AUT-06). Ohne ihn war sie von
              * nirgendwo im Portal erreichbar. Dort steht VOR dem Lauf, was
              * dieser Knopf sofort auslöst: Auftrag, Vorgangsart, die
              * Tatsachen mit ihren Werten, Modell samt Anbieter und der
              * Budgetstand.
              */}
            <p className="mt-s3 text-sm">
              <Link href={`/portal/${mandant}/agenten/${agent}/start`}
                    data-cse="agent-zum-vorschaltblatt"
                    className="text-brand underline underline-offset-2">
                Erst ansehen, was in den Lauf eingeht
              </Link>
              <span className="text-text-muted">
                {' '}— Auftrag, Tatsachen, Modell und Budget auf einem Blatt.
              </span>
            </p>
          </form>
        )}
      </section>

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="text-h3 text-text">Grenzen</h2>
        <dl className="mt-s3 grid grid-cols-1 gap-s3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-subtle">Schritte je Aufgabe</dt>
            <dd className="text-text">
              {kopf.max_schritte === null
                /* Die Zahl kommt aus der Quelle, nicht aus dieser Zeile: `laufzeit.ts`
                   benutzt `MAX_SCHRITTE_PLATZHALTER` als Rueckfall, wenn `max_schritte`
                   leer ist. Stand hier die 12 als Literal, sagte der Bildschirm nach
                   einer Aenderung des Platzhalters eine Grenze zu, die nicht gilt. */
                ? `${String(MAX_SCHRITTE_PLATZHALTER)} — Platzhalter (offene Frage O-196)`
                : String(kopf.max_schritte)}
            </dd>
          </div>
          {/*
            * **Ohne das Recht steht die ZEILE nicht da** — nicht nur der Link
            * fehlt.
            *
            * Hier stand „siehe Budget — dafür fehlt Ihnen das Recht". Der
            * Satz nannte das geschützte Ziel beim Namen und erklärte
            * obendrein, welches Recht dahintersteht: er verriet genau das,
            * was er verbergen sollte (AUT-06). Ein Bildschirm, der eine Tür
            * zeigt und dazusagt, dass man den Schlüssel nicht hat, hat die
            * Tür trotzdem gezeigt. Gemeldet hat das die Copilot-Runde auf
            * PR 16.
            */}
          {darf['agent.budget_verwalten'] !== true ? null : (
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
          )}
        </dl>
        <p className="mt-s3 text-xs text-text-subtle">
          Erreicht ein Lauf die Schrittgrenze, endet die Aufgabe als
          abgebrochen — mit einem Text, der genau das sagt, statt eines
          Ergebnisses, das aussieht, als wäre es fertig.
        </p>
      </section>

      {/*
        * **Die Werkzeuge — der Abschnitt, der die Frage vor dem Einschalten
        * beantwortet.** Ein Agent ist genau so mächtig wie das, was er
        * anfassen darf. Die Liste kommt aus dem Register (AGT-02, neun
        * Namen), der Stand aus `agent_werkzeug`; eine fehlende Zeile heisst
        * „nicht freigeschaltet", nicht „gibt es nicht".
        *
        * **Drei Stände, nicht zwei** (V-228, D-722): „bereit" steht nur da,
        * wo das Werkzeug freigeschaltet ist UND einen Ausführer hat. Ein
        * freigeschaltetes Modellwerkzeug ohne Ausführer sagt das, statt wie
        * die zwei auszusehen, die wirklich laufen. Und derselbe Stand gilt
        * zur Laufzeit: der CEO-Assistent fragt ihn vor jeder Antwort
        * (`verlangeWerkzeug`).
        *
        * **Pflegbar mit `agent.werkzeug_verbinden`** — je Werkzeug ein
        * Formular mit zwei Schaltern. Ein Versandwerkzeug trägt die
        * Freigabepflicht fest (Invariante 7): der Schalter ist gesetzt und
        * gesperrt, und der Dienst weist „ohne Freigabe" ab, bevor die
        * Datenbank es tut.
        */}
      <h2 id="werkzeuge" className="mb-s3 text-h2 text-text">Werkzeuge</h2>
      {werkzeugGesetzt ? (
        <Hinweis art="erfolg" cse="werkzeug-gesetzt" className="mb-s4 max-w-prose">
          Gespeichert. Der Stand gilt ab sofort, für jeden Aufruf dieses Werkzeugs.
        </Hinweis>
      ) : werkzeugFehler !== null ? (
        <Hinweis art="warnung" cse="werkzeug-abgewiesen" className="mb-s4 max-w-prose">
          {eigenerEintrag(WERKZEUG_FEHLER, werkzeugFehler) ?? WERKZEUG_FEHLER['unbekannt']}
        </Hinweis>
      ) : null}
      <ul className="mb-s6 flex flex-col gap-s3" data-cse="agent-werkzeuge">
        {fuerAgent(kopf.kennung as AgentKennung).map((w) => {
          const stand = standAus(w.name, daten.stand.find((z) => z.werkzeug === w.name));
          const zustand = stand.bereit ? 'bereit' : stand.freigeschaltet ? 'ohne_ausfuehrer' : 'aus';
          const versand = untergrenze(w.nebenwirkung) === 'freigabe_erforderlich';
          return (
            <li key={w.name} data-cse="agent-werkzeug" data-werkzeug={w.name}
                data-aktiv={stand.freigeschaltet ? '1' : '0'}
                data-bereit={stand.bereit ? '1' : '0'}
                className="rounded-lg border border-line bg-surface p-s4">
              <div className="flex flex-wrap items-baseline justify-between gap-s2">
                <span className="text-sm font-medium text-text" title={w.name}>
                  {beschriftung(WERKZEUG_TEXT, w.name)}
                </span>
                <span data-cse="werkzeug-zustand" data-zustand={zustand}
                      className={`text-xs ${zustand === 'bereit'
                        ? 'text-success'
                        : zustand === 'ohne_ausfuehrer' ? 'text-warning' : 'text-text-muted'}`}>
                  {zustand === 'bereit'
                    ? 'bereit'
                    : zustand === 'ohne_ausfuehrer'
                      ? 'freigeschaltet, aber ohne Ausführer — braucht Modellzugang'
                      : stand.ausfuehrbar
                        ? 'nicht freigeschaltet'
                        : 'nicht freigeschaltet · braucht Modellzugang'}
                </span>
              </div>
              <p className="mt-s2 max-w-prose text-sm text-text">{w.zweck}</p>
              <p className="mt-s2 max-w-prose text-sm text-text-muted">
                <strong>Nicht:</strong> {w.abgrenzung}
              </p>
              <p className="mt-s2 text-xs text-text-subtle">
                {`Wirkung: ${beschriftung(NEBENWIRKUNG_TEXT, w.nebenwirkung)} · `}
                {`Richtlinie: ${beschriftung(UNTERGRENZE_TEXT, untergrenze(w.nebenwirkung))} · `}
                {stand.erfordertFreigabe
                  ? 'in dieser Gesellschaft: nur mit Freigabe'
                  : 'in dieser Gesellschaft: ohne eigene Freigabe'}
              </p>
              {darf['agent.werkzeug_verbinden'] !== true ? null : (
                <form method="post" action="/api/agenten/werkzeug"
                      data-cse="werkzeug-formular"
                      className="mt-s3 flex flex-wrap items-center gap-s4">
                  <input type="hidden" name="agent" value={kopf.id} />
                  <input type="hidden" name="werkzeug" value={w.name} />
                  <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
                    <input type="checkbox" name="aktiv" value="1"
                           data-cse="werkzeug-aktiv" defaultChecked={stand.freigeschaltet} />
                    Für diesen Agenten freigeschaltet
                  </label>
                  {versand ? (
                    <>
                      {/* Ein gesperrtes Feld wird nicht gesendet — die Pflicht geht als
                          verstecktes Feld mit, und der Dienst prüft sie ohnehin. */}
                      <input type="hidden" name="freigabe" value="1" />
                      <label className="flex min-h-11 items-center gap-s2 text-sm text-text-muted">
                        <input type="checkbox" checked disabled readOnly
                               data-cse="werkzeug-freigabe" />
                        Nur mit Freigabe (Pflicht, Invariante 7)
                      </label>
                    </>
                  ) : (
                    <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
                      <input type="checkbox" name="freigabe" value="1"
                             data-cse="werkzeug-freigabe" defaultChecked={stand.erfordertFreigabe} />
                      Ergebnis nur mit Freigabe
                    </label>
                  )}
                  <Button type="submit" variante="secondary" data-cse="werkzeug-speichern">
                    Speichern
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mb-s6 max-w-prose text-xs text-text-muted" data-cse="agent-werkzeuge-hinweis">
        Zwei der neun haben einen Ausführer und rechnen ohne Modell:{' '}
        <strong>{beschriftung(WERKZEUG_TEXT, WERKZEUG_REGISTER.berechne_preis.name)}</strong>{' '}
        ruft dieselbe getestete Kalkulation wie die Angebotsseite (Invariante 6), und{' '}
        <strong>{beschriftung(WERKZEUG_TEXT, WERKZEUG_REGISTER.suche_bestand.name)}</strong>{' '}
        beantwortet Fragen aus einem geprüften Katalog. Für die übrigen sieben gibt es noch
        keinen Ausführer: sie brauchen einen Modellanbieter mit EU-Verarbeitung und
        Nullspeicherung (D-435) und antworten bis dahin „kein Modellzugang", statt etwas zu
        erfinden — auch wenn sie freigeschaltet sind.{' '}
        {modell === null
          ? 'Ein Modell für Entwürfe ist derzeit nicht freigegeben.'
          : anbieter === 'demo'
            ? 'Den Entwurf eines Laufs formuliert derzeit der hausinterne Demobetrieb — '
              + 'deterministisch, ohne Anbieter; er ist kein Werkzeug dieser Liste.'
            : 'Den Entwurf eines Laufs formuliert das freigegebene Modell aus dem Register.'}
      </p>

      <h2 className="mb-s3 text-h2 text-text">Was hinausgehen darf</h2>
      {!darfRichtlinien ? (
        <p className="mb-s6 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Die Versandrichtlinien sind hier nicht sichtbar — dafür braucht es
          das Recht <Recht schluessel="versand.lesen" />. Das heisst nicht, dass keine
          hinterlegt sind.
        </p>
      ) : richtlinien.length === 0 ? (
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
        {darf['agent.protokoll_lesen'] === true && (
          <Link
            href={`/portal/${mandant}/agenten/${agent}/protokoll`}
            className="text-sm text-text underline-offset-2 hover:text-brand hover:underline"
          >
            Schrittprotokoll
          </Link>
        )}
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
                <span className="inline-flex flex-wrap items-center gap-s2">
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
