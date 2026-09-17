import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { KATALOG, sucheBestand } from '@/server/agent/tools/suche-bestand';
import { Wertregister } from '@/server/agent/tools/register';
import type { BereichSchluessel } from '@/lib/design/theme';

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
 * **Und deshalb ist der Katalog kurz.** Neun Fragen, jede nachgerechnet. Ein
 * langer Katalog aus erfundenen Fragen wäre dasselbe wie ein Modell, das SQL
 * schreibt — nur langsamer.
 *
 * **Ohne Modell, und trotzdem vollständig.** Diese Seite braucht keinen
 * Anbieter: die Zahl kommt aus der Datenbank, der Satz daneben aus einer
 * Vorlage. Ein Modell würde den Satz später schöner formulieren — es würde die
 * Zahl nicht besser machen, denn es darf sie ohnehin nicht anfassen
 * (Invariante 6).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'CEO-Assistent' };

export default async function Assistent(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const gefragt = typeof suche['frage'] === 'string' ? suche['frage'] : null;

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
  const mandantId = sitzung.aktiverMandantId;
  if (mandantId === null) notFound();

  const eintrag = gefragt === null ? null : KATALOG.find((k) => k.id === gefragt) ?? null;

  /*
   * **Die Antwort entsteht auf dem Server, in der Sitzung des Fragenden.**
   * `withTenant` bindet den Mandanten; RLS ist die zweite Linie, die
   * Bedingung im Katalog-SQL die erste. Wer eine fremde Abfragekennung in die
   * Adresse tippt, bekommt sie gegen SEINE Gesellschaft ausgeführt — es gibt
   * keinen Parameter, mit dem sich das verschieben liesse.
   */
  const antwort = eintrag === null ? null : await db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const register = new Wertregister();
      const ergebnis = await sucheBestand(
        { abfrage: <T,>(sql: string, werte?: readonly unknown[]) =>
            kontext.abfrage<T>(sql, werte) },
        mandantId, eintrag.id, register,
      );
      if (!ergebnis.ok) return { fehler: ergebnis.fehler.nachricht } as const;
      const wert = register.lies(ergebnis.daten.antwortToken);
      const stand = register.lies(ergebnis.daten.standToken);
      return {
        frage: ergebnis.daten.frage,
        anzeige: wert.anzeige,
        stand: stand.anzeige,
        abfrageId: ergebnis.daten.abfrageId,
      } as const;
    }));

  return (
    <PortalRahmen
      titel="CEO-Assistent"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <p className="mb-s3 text-sm">
        <Link href={`/portal/${mandant}/agenten`}
              className="text-text-muted underline-offset-2 hover:underline">
          ← Agenten
        </Link>
      </p>
      <h1 className="mb-s5 mt-0 text-h1 text-text">CEO-Assistent</h1>

      <Hinweis art="hinweis" cse="assistent-erklaerung" className="mb-s5 max-w-prose">
        <strong className="block">Er liest die echten Daten dieser Gesellschaft.</strong>
        Jede Antwort ist eine Abfrage gegen die Datenbank, kein Modell — und sie trägt
        den Zeitpunkt, zu dem sie gelesen wurde. Was nicht im Katalog steht, wird
        nicht beantwortet, statt geraten zu werden: eine Zahl, die entsteht, weil eine
        Zahl erwartet wurde, ist schlimmer als keine Antwort (AGT-07).
      </Hinweis>

      {antwort !== null && (
        'fehler' in antwort ? (
          <Hinweis art="warnung" cse="assistent-keine-antwort" className="mb-s5 max-w-prose">
            {antwort.fehler}
          </Hinweis>
        ) : (
          <Card className="mb-s5" data-cse="assistent-antwort">
            <p className="m-0 mb-s2 text-sm text-text-muted">{antwort.frage}</p>
            <p className="m-0 cse-zahl text-h1 text-text" data-cse="assistent-zahl">
              {antwort.anzeige}
            </p>
            <p className="m-0 mt-s3 text-xs text-text-subtle">
              {`Gelesen am ${antwort.stand} · Abfrage „${antwort.abfrageId}" · `}
              gerechnet hat die Datenbank, nicht ein Modell.
            </p>
          </Card>
        )
      )}

      <h2 className="mb-s4 mt-0 text-h3 text-text">Fragen, die er beantworten kann</h2>
      <ul className="m-0 grid list-none grid-cols-1 gap-s3 p-0 md:grid-cols-2">
        {KATALOG.map((k) => (
          <li key={k.id}>
            {/*
              * Ein Verweis und kein Formular: die Frage ändert nichts, sie
              * liest. Damit ist die Antwort eine Adresse, die sich
              * weitergeben, lesezeichen und im Protokoll wiederfinden lässt.
              */}
            <Link
              href={{ pathname: `/portal/${mandant}/agenten/assistent`, query: { frage: k.id } }}
              data-cse="assistent-frage"
              data-frage={k.id}
              className={[
                'block rounded-lg border p-s4 text-sm transition-colors duration-fast',
                k.id === gefragt
                  ? 'border-line-strong bg-surface-2 text-text'
                  : 'border-line bg-surface text-text hover:bg-surface-2',
              ].join(' ')}
              aria-current={k.id === gefragt ? 'page' : undefined}
            >
              {k.frage}
              {k.einheit === null ? null : (
                <span className="mt-s1 block text-xs text-text-muted">
                  {`Antwort in ${k.einheit}`}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Fehlt eine Frage? Sie kommt in den Katalog, sobald jemand die Abfrage dazu
        geschrieben und nachgerechnet hat — nicht, indem ein Modell sie sich ausdenkt.
      </p>
    </PortalRahmen>
  );
}
