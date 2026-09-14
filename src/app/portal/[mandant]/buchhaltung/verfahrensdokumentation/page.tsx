import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { alleJobs } from '@/server/jobs/bootstrap';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  QUELLE_LABEL, TEILE, auslieferungAusUmgebung, erstelleVerfahrensdokumentation,
  type Abschnitt, type Verfahrensdokumentation,
} from '@/server/services/buchhaltung/verfahrensdokumentation';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/buchhaltung/verfahrensdokumentation` — die
 * Verfahrensdokumentation, erzeugt aus der lebenden Konfiguration (ACC-10,
 * LEG-01, PR 66, D-485).
 *
 * Die Seite ZEIGT das Dokument, das die API als Markdown, PDF oder JSON
 * liefert: dieselbe Struktur, derselbe Hash. Jeder Abschnitt traegt seine
 * Quelle; was ein Platzhalter ist, steht als Platzhalter.
 */
export const dynamic = 'force-dynamic';

function Tabelle({ a }: { readonly a: Abschnitt }) {
  if (a.tabelle === null) return null;
  const kopf = a.tabelle.kopf;
  const zeilen = a.tabelle.zeilen.map((z, i) => ({ i, z }));
  if (zeilen.length === 0) {
    return <p data-cse="vd-tabelle-leer" className="text-sm text-text-muted">Keine Einträge.</p>;
  }
  return (
    <DataTable
      beschriftung={`${a.nummer} ${a.titel}`}
      zeilen={zeilen}
      schluessel={(r) => String(r.i)}
      spalten={kopf.map((k, s) => ({
        schluessel: `s${String(s)}`, kopf: k,
        zelle: (r: { i: number; z: readonly string[] }) => r.z[s] ?? '',
      }))}
    />
  );
}

export default async function Verfahrensdoku({ params }: { params: Promise<{ mandant: string }> }) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/verfahrensdokumentation`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const jobs = alleJobs(db());
  const d = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) =>
      erstelleVerfahrensdokumentation(kontext, { jobs, auslieferung: auslieferungAusUmgebung() }))) as Promise<Verfahrensdokumentation>);

  const api = `/api/buchhaltung/verfahrensdokumentation?mandant=${mandant}`;
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Verfahrensdokumentation"
      wurzelTitel="Buchhaltung"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Verfahrensdokumentation</h1>
        <Link href={`/portal/${mandant}/buchhaltung`} className={knopf}>Zur Buchhaltung</Link>
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Erzeugt aus der lebenden Konfiguration der {d.firma} (GoBD Rz. 151 ff.): Gesellschaft, Fassung und
        Schemastand, Nummernkreise, Kontenzuordnung, Aufbewahrungsregeln, Rollen und Rechte, Jobs und
        Auftragsverarbeiter — dazu die Verfahren, die der Code durchsetzt, in Worten. Nichts hier rechnet oder
        entscheidet (D-06).
      </p>

      <dl data-cse="vd-kopf" className="mb-s5 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Abgerufen</dt>
        <dd className="text-text">{d.abgerufenAm} (Europe/Berlin)</dd>
        <dt className="text-text-muted">Fassung</dt>
        <dd className="text-text" data-cse="vd-fassung">
          Commit {d.auslieferung.commit ?? 'nicht bekannt (lokal)'} · Umgebung {d.auslieferung.umgebung ?? 'lokal'}
        </dd>
        <dt className="text-text-muted">Schemastand</dt>
        <dd className="text-text" data-cse="vd-schemastand">
          {d.schemastand === null
            ? 'nicht ablesbar — diese Datenbank führt kein Migrationsjournal'
            : `${d.schemastand.migration} (${d.schemastand.angewendetAm}), ${String(d.migrationen)} Migrationen`}
        </dd>
        <dt className="text-text-muted">SHA-256 der Struktur (Konfiguration und Verfahren)</dt>
        <dd className="font-mono text-xs text-text" data-cse="vd-sha256">{d.sha256}</dd>
      </dl>

      <div data-cse="vd-abrufe" className="mb-s6 flex flex-wrap items-center gap-s3">
        <a href={`${api}&format=md`} data-cse="vd-markdown" className={knopf}>Markdown</a>
        <a href={`${api}&format=pdf`} data-cse="vd-pdf" className={knopf}>PDF</a>
        <a href={`${api}&format=json`} data-cse="vd-json" className={knopf}>Struktur (JSON)</a>
      </div>

      {d.offen.length > 0 ? (
        <Hinweis art="warnung" cse="vd-offen" className="mb-s6 max-w-prose">
          <strong>{String(d.offen.length)} offene Punkte.</strong> Diese Dokumentation gibt sie als offen aus, nicht als entschieden — Abschnitt 5 nennt jeden.
        </Hinweis>
      ) : null}

      {TEILE.map((teil) => (
        <section key={teil.praefix} data-cse="vd-teil" className="mb-s7">
          <h2 className="mb-s4 text-h2 text-text">{teil.praefix}. {teil.titel}</h2>
          {d.abschnitte
            .filter((a) => a.nummer === teil.praefix || a.nummer.startsWith(`${teil.praefix}.`))
            .map((a) => (
              <article key={a.nummer} data-cse="vd-abschnitt" data-quelle={a.quelle}
                       className="mb-s6 rounded-lg border border-line bg-surface p-s5">
                <h3 className="text-h3 text-text">{a.nummer} {a.titel}</h3>
                <p className="mb-s3 text-xs text-text-muted">Quelle: {QUELLE_LABEL[a.quelle]}</p>
                {a.absaetze.map((p, i) => (
                  <p key={i} className="mb-s3 max-w-prose text-sm text-text">{p}</p>
                ))}
                <Tabelle a={a} />
                {(a.bestand ?? []).length > 0 ? (
                  <div data-cse="vd-bestand" className="mt-s3 max-w-prose text-sm text-text-muted">
                    <p className="text-xs">Bestand beim Abruf (nicht Teil des Hashs):</p>
                    <ul className="list-disc pl-s5">
                      {(a.bestand ?? []).map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
        </section>
      ))}
    </PortalRahmen>
  );
}
