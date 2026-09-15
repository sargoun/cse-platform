import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  EINBETTUNG_DIMENSION, EINBETTUNG_MODELL, WISSENSQUELLEN, einbettungsStand,
} from '@/server/config/rag';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/agenten/wissen` — was im Index steht und wie frisch es
 * ist (AGT-06).
 *
 * **Die Seite, die heute vor allem eines sagt: er ist leer, und warum.** Ohne
 * bestätigten Einbettungsanbieter wird nichts indiziert. Das ist keine
 * Verzögerung, sondern eine Entscheidung: ein Index aus Ersatzvektoren
 * lieferte Treffer, die plausibel aussehen, und dass ihre Reihenfolge Zufall
 * ist, merkt niemand — der schlimmste Platzhalter, den diese Plattform kennt.
 *
 * **Und sie sagt, was drinstünde.** Verträge, Objektakten, Angebote,
 * Korrespondenz — der Grund, warum diese Tabelle keine Gruppenansicht hat:
 * „zeig mir ähnliche Klauseln" wäre über vier Gesellschaften hinweg „zeig mir
 * den Vertrag der Schwester".
 */
export const dynamic = 'force-dynamic';

const QUELLE_TEXT: Readonly<Record<string, string>> = {
  vertrag: 'Verträge — Laufzeiten, Kündigungsfristen, Leistungsbeschreibungen',
  objekt: 'Objektakten — Raumbücher, Besonderheiten, Zugangsregelungen',
  angebot: 'Angebote — Kalkulationsgrundlagen und Formulierungen, die getragen haben',
  korrespondenz: 'Korrespondenz — was mit einem Kunden besprochen wurde',
};

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short',
});

interface Stand {
  readonly quelle: string;
  readonly chunks: number;
  readonly vertraulich: number;
  readonly aeltester: Date | null;
  readonly juengster: Date | null;
}

export default async function Wissen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/agenten/wissen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const { stand, zeilen } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext) => {
        /*
         * Der Stand kommt aus dem REGISTER (0154), nicht aus zwei
         * Umgebungsvariablen: wer Vertragstext an einen Auftragsverarbeiter
         * gibt, ist eine Zeile mit Namen und Datum (D-04).
         */
        const [reg] = await kontext.abfrage<{ modell: string | null; anbieter: string | null }>(
          `with m as (select app.modell_fuer('embedding'::ki_faehigkeit) as modell)
           select m.modell,
                  (select r.anbieter from modell_register r
                    where r.modell = m.modell and r.faehigkeit = 'embedding'
                    limit 1) as anbieter
             from m`);
        return {
          stand: einbettungsStand({
            modell: reg?.modell ?? null, anbieter: reg?.anbieter ?? null,
          }),
          /*
           * **`where mandant_id = $1` steht hier, obwohl RLS es schon tut.**
           * Invariante 3: die Policy ist die ZWEITE Linie, nie die einzige.
           * Eine Aggregatabfrage ohne eigenen Filter zaehlt bei der kleinsten
           * Regression in der Sitzungsbindung ueber alle Gesellschaften — und
           * eine falsche Zahl faellt niemandem auf.
           */
          zeilen: await kontext.abfrage<Record<string, unknown>>(
            `select quelle_typ::text as quelle, count(*)::int as chunks,
                    count(*) filter (where vertraulichkeit = 'vertraulich')::int as vertraulich,
                    min(eingebettet_am) as aeltester, max(eingebettet_am) as juengster
               from wissens_chunk
              where mandant_id = $1::uuid and ist_aktiv
              group by quelle_typ
              order by quelle_typ`, [kontext.aktiverMandantId]),
        };
      }))) as {
    stand: ReturnType<typeof einbettungsStand>;
    zeilen: readonly Record<string, unknown>[];
  };

  const nachQuelle = new Map<string, Stand>(zeilen.map((z) => [String(z['quelle']), {
    quelle: String(z['quelle']),
    chunks: Number(z['chunks']),
    vertraulich: Number(z['vertraulich']),
    aeltester: (z['aeltester'] as Date | null) ?? null,
    juengster: (z['juengster'] as Date | null) ?? null,
  }]));
  const gesamt = [...nachQuelle.values()].reduce((s, z) => s + z.chunks, 0);

  return (
    <PortalRahmen
      titel="Wissensindex"
      wurzelTitel="Agenten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Wissensindex</h1>
        <Link href={`/portal/${mandant}/agenten`}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
          Zum Agentenzentrum
        </Link>
      </div>

      {!stand.verbunden ? (
        <Hinweis art="warnung" cse="wissen-nicht-verbunden" className="mb-s5 max-w-prose">
          <strong>Nicht verbunden — der Index bleibt leer.</strong>{' '}
          {stand.hinweis}
        </Hinweis>
      ) : (
        <Hinweis art="erfolg" cse="wissen-verbunden" className="mb-s5 max-w-prose">
          <strong>Verbunden.</strong> Eingebettet wird mit{' '}
          <span className="font-mono">{stand.modell}</span> in{' '}
          {String(stand.dimension)} Dimensionen.
        </Hinweis>
      )}

      <section className="mb-s6 max-w-prose">
        <h2 className="mb-s2 text-h2 text-text">Was hier stünde</h2>
        <ul className="flex flex-col gap-s2 text-sm" data-cse="wissen-quellen">
          {WISSENSQUELLEN.map((q) => {
            const z = nachQuelle.get(q);
            return (
              <li key={q} data-cse="wissen-quelle" data-quelle={q}
                  data-chunks={z?.chunks ?? 0}
                  className="rounded-md border border-line bg-surface p-s3">
                <span className="text-text">{QUELLE_TEXT[q] ?? q}</span>
                <span className="block text-xs text-text-muted">
                  {z === undefined || z.chunks === 0
                    ? 'nichts indiziert'
                    : `${String(z.chunks)} Passagen, davon ${String(z.vertraulich)} vertraulich · `
                      + `zuletzt ${z.juengster === null ? '—' : BERLIN.format(z.juengster)}`}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-s3 text-xs text-text-subtle" data-cse="wissen-gesamt" data-gesamt={gesamt}>
          {gesamt === 0
            ? 'Null Passagen im Index.'
            : `${String(gesamt)} Passagen insgesamt.`}
        </p>
      </section>

      <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s2 text-h2 text-text">Warum es diese Seite gibt</h2>
        <p className="text-sm text-text-muted">
          Ein Vektorindex kennt von sich aus keine Gesellschaftsgrenze: eine Ähnlichkeitssuche
          ohne Filter liefert den Vertrag der Schwestergesellschaft, weil er inhaltlich ähnlich
          ist. Deshalb steht die Gesellschaft hier im Primärschlüssel, in jeder Policy und in
          jeder Abfrage — und es gibt <strong>keine Gruppenansicht</strong> auf diesen Index.
        </p>
        <p className="mt-s3 text-sm text-text-muted">
          Jede Passage steht auf <strong>vertraulich</strong>, bis ein Mensch sie herabstuft —
          mit Namen und Zeitpunkt. Die andere Richtung, alles sei normal bis jemand widerspricht,
          verliert beim ersten vergessenen Widerspruch einen Vertrag an einen Agenten, der ihn
          zitieren darf.
        </p>
        <p className="mt-s3 text-xs text-text-subtle">
          Modell: <span className="font-mono">{EINBETTUNG_MODELL}</span> ·{' '}
          {String(EINBETTUNG_DIMENSION)} Dimensionen. Die Zahl steht in der Spalte und in einem
          CHECK: ein Modellwechsel ist eine Migration und ein vollständiger Neuaufbau, keine
          Einstellung. Zwei Vektoren aus verschiedenen Modellen im selben Index sind kein Index.
        </p>
      </section>
    </PortalRahmen>
  );
}
