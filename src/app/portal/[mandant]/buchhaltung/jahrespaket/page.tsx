import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { alleJobs } from '@/server/jobs/bootstrap';
import { waehleSpeicher } from '@/server/storage/waehle';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { erstelleJahrespaket, type Jahrespaket } from '@/server/services/buchhaltung/jahrespaket';
import { auslieferungAusUmgebung } from '@/server/services/buchhaltung/verfahrensdokumentation';
import { liesWirtschaftsjahr, wirtschaftsjahrVon } from '@/server/services/buchhaltung/wirtschaftsjahr';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/buchhaltung/jahrespaket` — das Jahrespaket fuer den
 * Steuerberater (ACC-11, D-06, PR 67, D-486).
 *
 * Die Seite baut das Manifest (was hinein kommt, was fehlt und warum) ohne
 * Dateien zu holen; der Abruf ueber die API packt das ZIP und steht im
 * Protokoll.
 */
export const dynamic = 'force-dynamic';

function deutschesDatum(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function groesse(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export default async function JahrespaketSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/jahrespaket`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * `/buchhaltung` verlangt laut Manifest `buchhaltung.lesen`,
   * `/dokumente/buendel` `dokument.buendel_exportieren`; diese Seite oeffnet
   * mit `buchhaltung.exportieren`. Wer das Paket ziehen darf, darf nicht
   * zwangslaeufig die Uebersicht oder das Pruefbuendel oeffnen — der Knopf
   * fuehrte dann auf 404 und verriete, was er nicht zeigen darf (AUT-06,
   * Copilot-Runde auf PR 16 / D-581).
   */
  const darf = await haeltRechte(zugang.sitzung, 'buchhaltung.lesen', 'dokument.buendel_exportieren');
  const suche = await searchParams;
  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const gewaehlt = jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null;
  const speicher = waehleSpeicher();
  const jobs = alleJobs(db());

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const wj = await liesWirtschaftsjahr(kontext);
      const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
      const jahr = gewaehlt ?? wirtschaftsjahrVon(heute?.tag ?? '2026-01-01', wj);
      const jahre = await kontext.abfrage<{ jahr: number }>(
        `select distinct extract(year from belegdatum)::int as jahr from buchungssatz order by 1 desc`);
      const paket = await erstelleJahrespaket(kontext, speicher, jahr,
        { jobs, auslieferung: auslieferungAusUmgebung() }, { nurManifest: true });
      return { paket, jahre: [...new Set([jahr, ...jahre.map((j) => j.jahr)])].sort((a, b) => b - a) };
    })) as Promise<{ paket: Jahrespaket; jahre: readonly number[] }>);

  const jp = daten.paket;
  const basis = `/portal/${mandant}/buchhaltung/jahrespaket`;
  const api = `/api/buchhaltung/jahrespaket?mandant=${mandant}&jahr=${String(jp.jahr)}`;
  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Jahrespaket"
      wurzelTitel="Buchhaltung"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="buchhaltung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Jahrespaket {jp.bezeichnung}</h1>
        {darf['buchhaltung.lesen'] === true && (
          <Link href={`/portal/${mandant}/buchhaltung`} className={knopf}>Zur Buchhaltung</Link>
        )}
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Ein ZIP für den Steuerberater, Wirtschaftsjahr {jp.bezeichnung} ({deutschesDatum(jp.von)} bis {deutschesDatum(jp.bis)}):
        die Datentabellen, Monatszahlen (BWA-artig), offene Posten zum Stichtag, das Rechnungsausgangsbuch, die
        DATEV-Stapel des Jahres, das Prüfbündel mit Belegen und die Verfahrensdokumentation. Jahresabschluss,
        E-Bilanz und Steuererklärung entstehen beim Steuerberater — das Paket ist die Übergabe (D-06).
      </p>

      <form method="get" action={basis} data-cse="jahrespaket-jahr" className="mb-s5 flex flex-wrap items-center gap-s3">
        <label htmlFor="jahr" className="text-sm text-text">Wirtschaftsjahr</label>
        <select id="jahr" name="jahr" defaultValue={String(jp.jahr)} className={feld}>
          {daten.jahre.map((j) => <option key={j} value={String(j)}>{j}</option>)}
        </select>
        <button type="submit" className={knopf}>Anzeigen</button>
      </form>

      <ul data-cse="jahrespaket-kennzahlen" className="mb-s6 grid grid-cols-2 gap-s4 md:grid-cols-4">
        <li><KpiStat label="Dateien im Paket" wert={String(jp.dateien.length + jp.zahlen.belegeImPaket + jp.zahlen.datevDateien)} icon="export" /></li>
        <li><KpiStat label="DATEV-Stapel" wert={String(jp.zahlen.datevStapel)} icon="buch" ton={jp.zahlen.zeilenOhneStapel > 0 ? 'warning' : 'success'} /></li>
        <li><KpiStat label="Belege im Paket" wert={`${String(jp.zahlen.belegeImPaket)} / ${String(jp.zahlen.belege)}`} icon="dokument" ton={jp.zahlen.belegeImPaket < jp.zahlen.belege ? 'warning' : 'success'} /></li>
        <li><KpiStat label="Zeilen ohne Stapel" wert={String(jp.zahlen.zeilenOhneStapel)} icon="warnung" ton={jp.zahlen.zeilenOhneStapel > 0 ? 'warning' : 'success'} /></li>
      </ul>

      {jp.hinweise.length > 0 ? (
        <Hinweis art="warnung" cse="jahrespaket-hinweise" className="mb-s5 max-w-prose">
          <strong>Was fehlt oder offen ist — das LIESMICH sagt es auch:</strong>
          <ul className="mt-s2 list-disc pl-s5">
            {jp.hinweise.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </Hinweis>
      ) : (
        <Hinweis art="erfolg" cse="jahrespaket-hinweise" className="mb-s5 max-w-prose">
          <strong>Vollständig:</strong> jede Datei, jeder Stapel, jeder Beleg des Jahres ist im Paket.
        </Hinweis>
      )}
      {!jp.speicherVerbunden ? (
        <Hinweis art="hinweis" cse="jahrespaket-speicher" className="mb-s5 max-w-prose">
          <strong>Belegspeicher nicht verbunden.</strong> Listen, Manifest und Dokumentation entstehen im Speicher;
          EXTF-Dateien und PDF-Belege kommen erst mit verbundenem Speicher hinein — das Paket behauptet sie nicht.
        </Hinweis>
      ) : null}

      <div data-cse="jahrespaket-abrufe" className="mb-s6 flex flex-wrap items-center gap-s3">
        <a href={api} data-cse="jahrespaket-abrufen" className={knopf}>Paket (ZIP)</a>
        <Link href={`/portal/${mandant}/buchhaltung/datev`} className={knopf}>DATEV-Stapel</Link>
        {darf['dokument.buendel_exportieren'] === true && (
          <Link href={`/portal/${mandant}/dokumente/buendel?jahr=${String(jp.jahr)}`} className={knopf}>Prüfbündel</Link>
        )}
      </div>

      <DataTable
        beschriftung={`Dateien des Jahrespakets ${jp.bezeichnung}`}
        zeilen={jp.dateien}
        schluessel={(d) => d.pfad}
        spalten={[
          { schluessel: 'pfad', kopf: 'Datei', zelle: (d) => <span className="font-mono text-xs">{d.pfad}</span> },
          { schluessel: 'groesse', kopf: 'Größe', numerisch: true, zelle: (d) => groesse(d.groesseBytes) },
          { schluessel: 'sha', kopf: 'SHA-256',
            zelle: (d) => <span className="font-mono text-xs text-text-muted" title={d.sha256}>{d.sha256.slice(0, 12)}…</span> },
        ]}
      />
    </PortalRahmen>
  );
}
