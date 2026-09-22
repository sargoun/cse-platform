import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { alleJobs } from '@/server/jobs/bootstrap';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  LOESCHART_LABEL, erstelleLoeschkonzept, type Loeschkonzept,
} from '@/server/services/datenschutz/loeschkonzept';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/datenschutz/loeschkonzept` — das Löschkonzept (LEG-09,
 * Phase 10).
 *
 * **Die zweite Hälfte ist die wichtigere.** „Was wird gelöscht" beantwortet
 * jede Software; „was wird NICHT gelöscht, und warum" ist die Frage, an der
 * eine Auskunft scheitert. Deshalb steht das Register der Löschsperren hier
 * vollständig, mit dem Grund, den `rls.ts` je Tabelle festhält (K-16) — und
 * nicht als Satz „aus gesetzlichen Gründen".
 *
 * Die Seite LÖSCHT nichts. Der Weg für einen Antrag nach Art. 17 ist
 * `/datenschutz/[id]/loeschung` und erzeugt eine Entscheidung.
 */
export const dynamic = 'force-dynamic';

export default async function Loeschkonzeptseite(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/datenschutz/loeschkonzept`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * Das Verzeichnis nach Art. 30 liegt unter demselben Recht — der Verweis
   * dorthin steht trotzdem unter der Frage, weil ein Mandanten-Override sie
   * trennen kann und ein Knopf auf 404 dasselbe verrät wie eine Seite
   * (AUT-06, D-581).
   */
  const darf = await haeltRechte(zugang.sitzung, 'system.einstellung_lesen');

  const jobs = alleJobs(db());
  const k = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) =>
      erstelleLoeschkonzept(kontext, jobs, new Date()))) as Promise<Loeschkonzept>);

  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong '
    + 'px-s5 py-s3 text-sm text-text hover:bg-surface-2';
  const api = `/api/datenschutz/loeschkonzept?mandant=${mandant}`;

  return (
    <PortalRahmen
      titel="Löschkonzept"
      wurzelTitel="Datenschutz"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="datenschutz"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Löschkonzept</h1>
        {darf['system.einstellung_lesen'] === true && (
          <Link href={`/portal/${mandant}/datenschutz/verarbeitungsverzeichnis`}
                className={knopf}>
            Zum Verarbeitungsverzeichnis
          </Link>
        )}
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Abgeleitet aus den Aufbewahrungsregeln der {k.firma}, den Löschläufen und
        dem Register der Löschsperren. Diese Seite beschreibt, was gelöscht wird —
        sie löscht nichts. Ein Antrag nach Art. 17 läuft über den
        Datenschutz-Posteingang und endet in einer Entscheidung, nicht in einem
        Löschbefehl.
      </p>

      <dl data-cse="lk-kopf"
          className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Abgerufen</dt>
        <dd className="text-text">{k.abgerufenAm}</dd>
        <dt className="text-text-muted">SHA-256 des Inhalts</dt>
        <dd className="min-w-0 break-all font-mono text-xs text-text" data-cse="lk-sha256">
          {k.sha256}
        </dd>
      </dl>

      <div data-cse="lk-abrufe" className="mb-s6 flex flex-wrap items-center gap-s3">
        <a href={`${api}&format=md`} data-cse="lk-markdown" className={knopf}>Markdown</a>
        <a href={`${api}&format=json`} data-cse="lk-json" className={knopf}>Struktur (JSON)</a>
      </div>

      {k.offen.length > 0 ? (
        <Hinweis art="warnung" cse="lk-offen" className="mb-s6 max-w-prose">
          <strong>{String(k.offen.length)} offene Punkte.</strong> Eine Frist, die
          niemand entschieden hat, steht hier als offen — nicht als Zahl:
          <ul className="m-0 mt-s2 list-disc ps-s5">
            {k.offen.map((o) => <li key={o}>{o}</li>)}
          </ul>
        </Hinweis>
      ) : null}

      <section className="mb-s7">
        <h2 className="mb-s3 text-h3 text-text">1. Fristen</h2>
        <DataTable
          beschriftung="Fristen je Klasse"
          zeilen={k.fristen.map((f, i) => ({ i, f }))}
          schluessel={(r) => String(r.i)}
          spalten={[
            { schluessel: 'klasse', kopf: 'Klasse', zelle: (r) => r.f.klasse },
            {
              schluessel: 'frist',
              kopf: 'Frist',
              zelle: (r) => (r.f.offen
                ? <StatusPill zustand="Offen" />
                : r.f.frist),
            },
            { schluessel: 'grundlage', kopf: 'Grundlage', zelle: (r) => r.f.grundlage },
            { schluessel: 'ausloeser', kopf: 'Auslöser', zelle: (r) => r.f.ausloeser },
          ]}
        />
        <p className="mt-s2 max-w-prose text-xs text-text-subtle">
          Eine offene Frist zeigt hier den Zustand und nicht den Text daneben —
          wer die Tabelle überfliegt, soll die Lücke sehen, nicht überlesen.
          Der genaue Satz steht im Markdown-Abruf.
        </p>
      </section>

      <section className="mb-s7">
        <h2 className="mb-s3 text-h3 text-text">2. Was wirklich löscht</h2>
        {k.laeufe.length === 0 ? (
          <p className="max-w-prose text-sm text-text-muted">
            Kein Lauf dieser Plattform löscht personenbezogene Daten.
          </p>
        ) : (
          <DataTable
            beschriftung="Löschläufe"
            zeilen={k.laeufe.map((l, i) => ({ i, l }))}
            schluessel={(r) => String(r.i)}
            spalten={[
              { schluessel: 'lauf', kopf: 'Lauf', zelle: (r) => r.l.bezeichnung },
              {
                schluessel: 'plan', kopf: 'Zeitplan (UTC)',
                zelle: (r) => <code className="font-mono text-xs">{r.l.zeitplan}</code>,
              },
              { schluessel: 'wirkung', kopf: 'Wirkung', zelle: (r) => r.l.wirkung },
            ]}
          />
        )}
      </section>

      <section className="mb-s7">
        <h2 className="mb-s2 text-h3 text-text">3. Was NICHT gelöscht wird — und warum</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Diese Tabellen tragen den Riegel `kern.verhindere_loeschung()` und
          haben keine `DELETE`-Erlaubnis (K-16). Jede Zeile nennt ihren Grund;
          „aus gesetzlichen Gründen" steht hier bei keiner.
        </p>
        {k.sperren.map((g) => (
          <div key={g.art} className="mb-s5">
            <h3 className="mb-s2 text-sm font-semibold text-text">
              {LOESCHART_LABEL[g.art]}
            </h3>
            <DataTable
              beschriftung={LOESCHART_LABEL[g.art]}
              zeilen={g.tabellen.map((t, i) => ({ i, t }))}
              schluessel={(r) => String(r.i)}
              spalten={[
                {
                  schluessel: 'tabelle', kopf: 'Tabelle',
                  zelle: (r) => <code className="font-mono text-xs">{r.t.tabelle}</code>,
                },
                { schluessel: 'grund', kopf: 'Grund', zelle: (r) => r.t.grund },
              ]}
            />
          </div>
        ))}
      </section>
    </PortalRahmen>
  );
}
