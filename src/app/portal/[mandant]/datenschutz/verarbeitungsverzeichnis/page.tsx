import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  QUELLE_LABEL, erstelleVerarbeitungsverzeichnis,
  type Abschnitt, type Verarbeitungsverzeichnis,
} from '@/server/services/datenschutz/verzeichnis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/datenschutz/verarbeitungsverzeichnis` — das Verzeichnis
 * nach Art. 30 DSGVO, erzeugt aus der lebenden Konfiguration (LEG-09,
 * Phase 10).
 *
 * **Warum das eine Seite ist und kein Dokument im Ordner.** Ein Verzeichnis
 * in einer Datei beschreibt den Tag, an dem jemand es zuletzt angefasst hat.
 * Vor einer Aufsicht zählt der Stand des Systems — also wird es beim Abruf
 * aus `mandant`, den gebuchten Modulen, den Aufbewahrungsregeln und den
 * Registern erzeugt. Dieselbe Bauart wie ACC-10 (D-485).
 *
 * **Die Seite behauptet keine Rechtsgrundlage.** Abschnitt 8 sagt
 * ausdrücklich, was hier NICHT steht und warum (O-514). Ein Verzeichnis mit
 * ausgedachten Grundlagen wäre schlimmer als keines: es sähe geprüft aus.
 */
export const dynamic = 'force-dynamic';

function Tabelle({ a }: { readonly a: Abschnitt }) {
  if (a.tabelle === null) return null;
  const kopf = a.tabelle.kopf;
  const zeilen = a.tabelle.zeilen.map((z, i) => ({ i, z }));
  if (zeilen.length === 0) {
    return (
      <p data-cse="vv-tabelle-leer" className="text-sm text-text-muted">
        Keine Zeile — für diese Gesellschaft trifft nichts davon zu.
      </p>
    );
  }
  return (
    <DataTable
      beschriftung={`${a.nummer} ${a.titel}`}
      zeilen={zeilen}
      schluessel={(r) => String(r.i)}
      spalten={kopf.map((k, s) => ({
        schluessel: `s${String(s)}`,
        kopf: k,
        zelle: (r: { i: number; z: readonly string[] }) => r.z[s] ?? '',
      }))}
    />
  );
}

export default async function Verarbeitungsverzeichnisseite(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(
    `/portal/${mandant}/datenschutz/verarbeitungsverzeichnis`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const v = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) =>
      erstelleVerarbeitungsverzeichnis(kontext, new Date()))
  ) as Promise<Verarbeitungsverzeichnis>);

  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong '
    + 'px-s5 py-s3 text-sm text-text hover:bg-surface-2';
  const api = `/api/datenschutz/verarbeitungsverzeichnis?mandant=${mandant}`;

  return (
    <PortalRahmen
      titel="Verarbeitungsverzeichnis"
      wurzelTitel="Datenschutz"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="datenschutz"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Verarbeitungsverzeichnis</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Art. 30 Abs. 1 DSGVO für die {v.verantwortlicher.firma}, erzeugt aus der
        laufenden Konfiguration: Verantwortlicher, Tätigkeiten der gebuchten
        Module, Empfänger, Fristen und die Massnahmen, die das System erzwingt.
        Die Rechtsgrundlage je Tätigkeit steht hier bewusst nicht — sie ist eine
        Entscheidung der Geschäftsführung (Abschnitt 8).
      </p>

      <dl data-cse="vv-kopf"
          className="mb-s5 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Abgerufen</dt>
        <dd className="text-text">{v.abgerufenAm}</dd>
        <dt className="text-text-muted">Tätigkeiten</dt>
        <dd className="text-text" data-cse="vv-anzahl">{String(v.taetigkeiten.length)}</dd>
        <dt className="text-text-muted">SHA-256 des Inhalts</dt>
        {/* `break-all` wie bei ACC-10: ein Hash ist ein Wort ohne Trennstelle. */}
        <dd className="min-w-0 break-all font-mono text-xs text-text" data-cse="vv-sha256">
          {v.sha256}
        </dd>
      </dl>

      <div data-cse="vv-abrufe" className="mb-s6 flex flex-wrap items-center gap-s3">
        <a href={`${api}&format=md`} data-cse="vv-markdown" className={knopf}>Markdown</a>
        <a href={`${api}&format=json`} data-cse="vv-json" className={knopf}>Struktur (JSON)</a>
      </div>

      {v.offen.length > 0 ? (
        <Hinweis art="warnung" cse="vv-offen" className="mb-s6 max-w-prose">
          <strong>{String(v.offen.length)} offene Punkte.</strong> Dieses
          Verzeichnis gibt sie als offen aus, nicht als entschieden:
          <ul className="m-0 mt-s2 list-disc ps-s5">
            {v.offen.map((o) => <li key={o}>{o}</li>)}
          </ul>
        </Hinweis>
      ) : null}

      {v.abschnitte.map((a) => (
        <section key={a.nummer} data-cse="vv-abschnitt" className="mb-s7">
          <h2 className="mb-s1 text-h3 text-text">{a.nummer}. {a.titel}</h2>
          <p className="mb-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">
            {QUELLE_LABEL[a.quelle]}
          </p>
          {a.absaetze.map((p) => (
            <p key={p.slice(0, 40)} className="mb-s3 max-w-prose text-sm text-text">{p}</p>
          ))}
          <Tabelle a={a} />
        </section>
      ))}
    </PortalRahmen>
  );
}
