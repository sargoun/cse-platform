import type postgres from 'postgres';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { KATALOG } from '@/server/agent/tools/suche-bestand';
import { werkzeugStand, type WerkzeugStand } from '@/server/agent/tools/freischaltung';
import { leseFrage, type ProtokollierteFrage } from '@/server/services/agent/assistent';
import { istUuid } from '@/lib/uuid';
import { eigenerEintrag } from '@/lib/nachschlagen';
import type { BereichSchluessel } from '@/lib/design/theme';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';

/**
 * `/portal/[mandant]/agenten/assistent` — der CEO-Assistent (AGT-07, SPEC §21).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum hier kein Eingabefeld für eine freie Frage steht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Textfeld verspricht: „frag mich irgendetwas". Dahinter müsste ein Modell
 * SQL schreiben — und ein Modell, das SQL schreibt, schreibt irgendwann eines
 * ohne Mandantenbedingung. Nicht aus Bosheit, sondern weil es bei der
 * neunhundertsten Frage einmal `where mandant_id` vergisst. Das ist genau der
 * Fehler, den Invariante 3 unmöglich machen soll, und er wäre unsichtbar: die
 * Antwort sähe richtig aus.
 *
 * Deshalb ein **Katalog**: benannte Abfragen, jede von Hand geschrieben, jede
 * mit der Mandantengrenze im SQL. Was nicht darin steht, wird nicht
 * beantwortet — und genau das sagt AGT-07: „When it cannot answer from the
 * schema, it says so."
 *
 * **Jede Frage ist eine protokollierte Aufgabe** (AGT-04, V-229, D-723). Die
 * Karten sind Formulare: ein Klick schickt die Frage an
 * `POST /api/agenten/assistent`, dort entstehen Aufgabe und Schritt
 * (Werkzeug, Eingabe, Ausgabe, Dauer), und die Seite zeigt danach die Antwort
 * DIESER Aufgabe (`?aufgabe=`). Vorher rechnete die Seite beim Anzeigen und
 * hinterliess keine Spur; im Agentenzentrum standen nur die Knopf-Läufe.
 * Geschrieben wird nie beim Anzeigen — ein GET, der eine Zeile anlegt, legte
 * sie auch beim Vorladen eines Links an.
 *
 * **„Ergebnis nur mit Freigabe" wirkt** (V-270, D-763). Trägt das Werkzeug
 * in dieser Gesellschaft die Freigabepflicht, geht die Antwort in den
 * Posteingang, und diese Seite sagt das — statt einer Zahl, die niemand
 * freigegeben hat. Genehmigt ein Mensch, steht die Antwort hier; die
 * Auslieferung geht durch das Tor in `server/agent/policy.ts`.
 *
 * **Ohne Modell, und trotzdem vollständig.** Die Zahl kommt aus der
 * Datenbank, der Satz daneben aus einer Vorlage. Ein Modell würde den Satz
 * später schöner formulieren — es würde die Zahl nicht besser machen, denn es
 * darf sie ohnehin nicht anfassen (Invariante 6).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'CEO-Assistent' };

/** Warum eine Frage nicht angenommen wurde — ein Satz je Grund der Route. */
const FEHLER_TEXT: Readonly<Record<string, string>> = {
  unbekannt: 'Diese Frage steht nicht im Katalog. Beantwortet wird nur, was jemand als '
    + 'Abfrage geschrieben und nachgerechnet hat.',
  schluessel: 'Das Formular war unvollständig. Bitte die Frage noch einmal antippen.',
  agent_aus: 'Der CEO-Assistent ist abgeschaltet und beantwortet keine Fragen.',
};

export default async function Assistent(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const aufgabeId = typeof suche['aufgabe'] === 'string' && istUuid(suche['aufgabe'])
    ? suche['aufgabe'] : null;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const zugang = await portalZugang(`/portal/${mandant}/agenten/assistent`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return (
      <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant}
                    zielSlug={tor.ziel} zurueck={tor.zurueck} />
    );
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  const darf = await haeltRechte(sitzung, 'agent.protokoll_lesen', 'agent.werkzeug_verbinden',
    'freigabe.entscheiden');

  /*
   * **Gelesen wird, was protokolliert ist** — die Antwort der Aufgabe, nicht
   * eine neu gerechnete. Und der Stand des Werkzeugs, damit die Seite sagt,
   * wenn der Assistent in dieser Gesellschaft gar nicht antworten darf.
   */
  const { frage, stand } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => ({
      frage: aufgabeId === null ? null : await leseFrage(kontext, aufgabeId),
      stand: await werkzeugStand(kontext, 'ceo_assistent', 'suche_bestand'),
    })))) as { frage: ProtokollierteFrage | null; stand: WerkzeugStand };
  const freigeschaltet = stand.bereit;
  /* Das Blatt einer Freigabe verlangt `freigabe.entscheiden` (Routenmanifest). */
  const zurFreigabe = frage === null || frage.freigabeId === null
    || darf['freigabe.entscheiden'] !== true
    ? null
    : alsRoute(`/portal/${mandant}/freigaben/${frage.freigabeId}`);

  const aufgabeLink = frage === null || darf['agent.protokoll_lesen'] !== true
    ? null
    : alsRoute(`/portal/${mandant}/agenten/ceo-assistent/aufgaben/${frage.aufgabeId}`);

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/agenten`, text: 'Agenten' }}
      titel="CEO-Assistent"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 mt-0 text-h1 text-text">CEO-Assistent</h1>

      <Hinweis art="hinweis" cse="assistent-erklaerung" className="mb-s5 max-w-prose">
        <strong className="block">Er liest die echten Daten dieser Gesellschaft.</strong>
        Jede Antwort ist eine Abfrage gegen die Datenbank, kein Modell — sie trägt den
        Zeitpunkt, zu dem sie gelesen wurde, und steht als Aufgabe im Protokoll des
        Agenten. Was nicht im Katalog steht, wird nicht beantwortet, statt geraten zu
        werden: eine Zahl, die entsteht, weil eine Zahl erwartet wurde, ist schlimmer als
        keine Antwort (AGT-07).
      </Hinweis>

      {!freigeschaltet ? (
        <Hinweis art="warnung" cse="assistent-gesperrt" className="mb-s5 max-w-prose">
          Das Werkzeug „Bestand abfragen" ist in dieser Gesellschaft für den CEO-Assistenten
          nicht freigeschaltet — er beantwortet deshalb keine Frage. Eine Frage wird trotzdem
          protokolliert, mit dem Grund, warum sie unbeantwortet blieb.
          {darf['agent.werkzeug_verbinden'] === true && (
            <>
              {' '}
              <Link href={alsRoute(`/portal/${mandant}/agenten/ceo-assistent#werkzeuge`)}
                    data-cse="assistent-zum-werkzeug"
                    className="underline underline-offset-2">
                Werkzeug freischalten
              </Link>
            </>
          )}
        </Hinweis>
      ) : null}

      {freigeschaltet && stand.erfordertFreigabe ? (
        <Hinweis art="hinweis" cse="assistent-nur-mit-freigabe" className="mb-s5 max-w-prose">
          <strong className="block">Antworten gehen hier nur mit Freigabe heraus.</strong>
          Das Werkzeug „Bestand abfragen" gibt sein Ergebnis in dieser Gesellschaft erst
          weiter, wenn ein Mensch es im Freigabe-Posteingang genehmigt hat. Bis dahin steht
          die Antwort dort und nicht hier.
        </Hinweis>
      ) : null}

      {/*
        * **Der Ausgang einer Frage wird angesagt** (DESIGN §5 „Notices", §9,
        * V-217, V-270): eine Abweisung und eine Frage ohne Antwort als
        * `alert`, die Antwort und „liegt zur Freigabe" als `status`. Nach der
        * 303-Umleitung erfuhr ein Screenreader sonst nicht, was geschah.
        */}
      {fehler !== null && (
        <Hinweis art="warnung" rolle="alert" cse="assistent-abgewiesen"
                 className="mb-s5 max-w-prose">
          {eigenerEintrag(FEHLER_TEXT, fehler) ?? FEHLER_TEXT['unbekannt']}
        </Hinweis>
      )}

      {frage !== null && frage.freigabe === 'wartet' ? (
        <Hinweis art="hinweis" rolle="status" cse="assistent-wartet-auf-freigabe"
                 className="mb-s5 max-w-prose">
          <strong className="block">Die Antwort liegt zur Freigabe.</strong>
          Sie steht im Freigabe-Posteingang dieser Gesellschaft und erscheint hier, sobald ein
          Mensch sie genehmigt hat. Abgelehnt, bleibt sie dort.
          {zurFreigabe === null ? null : (
            <>
              {' '}
              <Link href={zurFreigabe} data-cse="assistent-zur-freigabe"
                    className="underline underline-offset-2">
                Zur Freigabe
              </Link>
            </>
          )}
        </Hinweis>
      ) : frage !== null && frage.freigabe === 'nicht_lesbar' ? (
        <Hinweis art="warnung" rolle="alert" cse="assistent-freigabe-nicht-lesbar"
                 className="mb-s5 max-w-prose">
          <strong className="block">Diese Antwort ging über eine Freigabe.</strong>
          Die Freigabe ist für diesen Zugang nicht lesbar — die Antwort wird deshalb hier
          nicht gezeigt.
        </Hinweis>
      ) : frage !== null && (
        frage.antwort === null ? (
          <Hinweis art="warnung" rolle="alert" cse="assistent-keine-antwort"
                   className="mb-s5 max-w-prose">
            {frage.fehlerText ?? 'Diese Frage blieb ohne Antwort.'}
            {aufgabeLink === null ? null : (
              <>
                {' '}
                <Link href={aufgabeLink} data-cse="assistent-zur-aufgabe"
                      className="underline underline-offset-2">
                  Zum Protokoll
                </Link>
              </>
            )}
          </Hinweis>
        ) : (
          /* `Card` reicht weder Rolle noch `data-cse` weiter — beides steht
             deshalb am Bereich um die Karte; der Anker stand vorher an der
             Karte und kam nie im Dokument an. */
          <div role="status" data-cse="assistent-antwort" className="mb-s5">
            <Card>
              <p className="m-0 mb-s2 text-sm text-text-muted">{frage.antwort.frage}</p>
              <p className="m-0 cse-zahl text-h1 text-text" data-cse="assistent-zahl">
                {frage.antwort.anzeige}
              </p>
              <p className="m-0 mt-s3 text-xs text-text-subtle">
                {`Gelesen am ${frage.antwort.stand} · gerechnet hat die Datenbank, nicht ein `
                  + 'Modell · protokolliert als Aufgabe des Agenten'
                  + (frage.freigabe === 'geliefert' ? ' · im Posteingang freigegeben.' : '.')}
                {aufgabeLink === null ? null : (
                  <>
                    {' '}
                    <Link href={aufgabeLink} data-cse="assistent-zur-aufgabe"
                          className="underline underline-offset-2">
                      Zum Protokoll
                    </Link>
                  </>
                )}
              </p>
            </Card>
          </div>
        )
      )}

      <h2 className="mb-s2 mt-0 text-h3 text-text">Fragen, die er beantworten kann</h2>
      {/*
        * **Die Anleitung steht hier und nicht in der Erklärung darüber.**
        *
        * Der Mandant hat es am Telefon gefunden: er tippte im Agentenzentrum
        * auf „Fragen stellen", landete hier, sah eine Liste — und suchte ein
        * Eingabefeld. Es gibt keines, und das ist Absicht (AGT-07); die Liste
        * IST die Eingabe. Nur sagte das niemand, und eine Karte mit einem
        * Rahmen sieht aus wie ein Schild, nicht wie ein Knopf.
        */}
      <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted"
         data-cse="assistent-anleitung">
        Tippen Sie eine Frage an — die Antwort steht dann oben auf dieser Seite.
        Ein freies Eingabefeld gibt es bewusst nicht: beantwortet wird, was
        jemand als Abfrage geschrieben und nachgerechnet hat.
      </p>
      <ul className="m-0 grid list-none grid-cols-1 gap-s3 p-0 md:grid-cols-2">
        {KATALOG.map((k) => {
          const aktuell = frage?.antwort?.abfrageId === k.id;
          return (
            <li key={k.id}>
              {/*
                * **Ein Formular und kein Verweis** (V-229): die Frage legt eine
                * Aufgabe an, und das tut nur ein POST. Der Schlüssel entsteht
                * einmal je Anzeige dieser Seite — ein Doppelklick schickt
                * denselben, und es bleibt bei einer Aufgabe.
                */}
              <form method="post" action="/api/agenten/assistent" className="m-0">
                <input type="hidden" name="frage" value={k.id} />
                <input type="hidden" name="schluessel" value={randomUUID()} />
                <button
                  type="submit"
                  data-cse="assistent-frage"
                  data-frage={k.id}
                  aria-current={aktuell ? 'true' : undefined}
                  className={[
                    'block w-full rounded-lg border p-s4 text-start text-sm transition-colors',
                    'duration-fast',
                    aktuell
                      ? 'border-line-strong bg-surface-2 text-text'
                      : 'border-line bg-surface text-text hover:bg-surface-2',
                  ].join(' ')}
                >
                  {/*
                    * Das `›` macht aus der Karte sichtbar einen Weg. `aria-hidden`,
                    * weil der Knopf seinen Namen schon trägt — ein vorgelesenes
                    * „grösser als" wäre Lärm (DESIGN §5).
                    */}
                  <span className="flex items-start justify-between gap-s3">
                    <span>{k.frage}</span>
                    <span aria-hidden="true" className="shrink-0 text-text-subtle">›</span>
                  </span>
                  {k.einheit === null ? null : (
                    <span className="mt-s1 block text-xs text-text-muted">
                      {`Antwort in ${k.einheit}`}
                    </span>
                  )}
                </button>
              </form>
            </li>
          );
        })}
      </ul>

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Fehlt eine Frage? Sie kommt in den Katalog, sobald jemand die Abfrage dazu
        geschrieben und nachgerechnet hat — nicht, indem ein Modell sie sich ausdenkt.
      </p>
    </PortalRahmen>
  );
}
