import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { erstelleZ3Paket, type Z3Paket } from '@/server/services/buchhaltung/z3';
import { liesWirtschaftsjahr, wirtschaftsjahrVon } from '@/server/services/buchhaltung/wirtschaftsjahr';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/buchhaltung/z3-export` — die Datentraegerueberlassung
 * nach § 147 Abs. 6 AO (ACC-09, PR 66, D-485).
 *
 * Die Seite baut das Paket des gewaehlten Wirtschaftsjahrs und zeigt, was
 * darin ist: jede Tabelle mit Zeilenzahl und SHA-256, der Hash des Pakets,
 * die Zahl der unvollstaendigen Buchungszeilen — und die Grenzen (keine
 * DTD im Paket, Windows-1252, Platzhalter). Der Abruf selbst laeuft ueber
 * die API und steht im Protokoll.
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

export default async function Z3Export(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/z3-export`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * `/buchhaltung` und `/buchhaltung/buchungen` verlangen laut Manifest
   * `buchhaltung.lesen`; diese Seite oeffnet mit `buchhaltung.exportieren`.
   * Wer das Paket ziehen darf, darf nicht zwangslaeufig das Journal lesen —
   * Knopf und Verweis fuehrten dann auf 404 und verrieten, was sie nicht
   * zeigen duerfen (AUT-06, Copilot-Runde auf PR 16 / D-581).
   */
  const darf = await haeltRechte(zugang.sitzung, 'buchhaltung.lesen');
  const suche = await searchParams;
  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const gewaehlt = jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const wj = await liesWirtschaftsjahr(kontext);
      const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
      const jahr = gewaehlt ?? wirtschaftsjahrVon(heute?.tag ?? '2026-01-01', wj);
      const jahre = await kontext.abfrage<{ jahr: number }>(
        `select distinct extract(year from belegdatum)::int as jahr from buchungssatz order by 1 desc`);
      const paket = await erstelleZ3Paket(kontext, jahr);
      return { paket, jahre: [...new Set([jahr, ...jahre.map((j) => j.jahr)])].sort((a, b) => b - a) };
    })) as Promise<{ paket: Z3Paket; jahre: readonly number[] }>);

  const z = daten.paket;
  const zeilenGesamt = z.tabellen.reduce((s, t) => s + t.zeilen, 0);
  const basis = `/portal/${mandant}/buchhaltung/z3-export`;
  const api = `/api/buchhaltung/z3-export?mandant=${mandant}&jahr=${String(z.jahr)}`;
  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Z3-Export"
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
        <h1 className="text-h1 text-text">Z3-Export {z.bezeichnung}</h1>
        {darf['buchhaltung.lesen'] === true && (
          <Link href={`/portal/${mandant}/buchhaltung`} className={knopf}>Zur Buchhaltung</Link>
        )}
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Datenträgerüberlassung nach § 147 Abs. 6 AO für das Wirtschaftsjahr {z.bezeichnung}{' '}
        ({deutschesDatum(z.von)} bis {deutschesDatum(z.bis)}): Journal, Ausgangsrechnungen mit Positionen,
        Eingangsrechnungen, Zahlungen, offene Posten, Belege und Stammdaten als CSV mit Strukturbeschreibung
        (<code className="font-mono text-xs">index.xml</code>) und Prüfsummen. Das Paket zeigt den Stand, wie er
        ist — es bereinigt nichts und rechnet nichts (D-06).
      </p>

      <form method="get" action={basis} data-cse="z3-jahr" className="mb-s5 flex flex-wrap items-center gap-s3">
        <label htmlFor="jahr" className="text-sm text-text">Wirtschaftsjahr</label>
        <select id="jahr" name="jahr" defaultValue={String(z.jahr)} className={feld}>
          {daten.jahre.map((j) => <option key={j} value={String(j)}>{j}</option>)}
        </select>
        <button type="submit" className={knopf}>Anzeigen</button>
        {z.wirtschaftsjahr.istPlatzhalter ? (
          <span data-cse="z3-wirtschaftsjahr" className="text-xs text-text-muted">
            Beginn {String(z.wirtschaftsjahr.beginnTag)}.{String(z.wirtschaftsjahr.beginnMonat)}. — angenommen (O-05)
          </span>
        ) : null}
      </form>

      <ul data-cse="z3-kennzahlen" className="mb-s6 grid grid-cols-2 gap-s4 md:grid-cols-4">
        <li><KpiStat label="Tabellen" wert={String(z.tabellen.length)} icon="buch" /></li>
        <li><KpiStat label="Zeilen gesamt" wert={String(zeilenGesamt)} icon="rechnung" /></li>
        <li><KpiStat label="Unvollständige Buchungszeilen" wert={String(z.unvollstaendig)} icon="warnung" ton={z.unvollstaendig > 0 ? 'warning' : 'success'} /></li>
        <li><KpiStat label="Paket" wert={groesse(z.zip.byteLength)} icon="export" ton="muted" /></li>
      </ul>

      {z.unvollstaendig > 0 ? (
        <Hinweis art="warnung" cse="z3-unvollstaendig" className="mb-s5 max-w-prose">
          <strong>{String(z.unvollstaendig)} Buchungszeile(n) ohne Beleg oder Konto.</strong> Sie stehen im Journal mit
          leeren Feldern; ein Prüfer sieht das. Wer ein vollständiges Paket will, kontiert sie zuerst
          {/* Ohne `buchhaltung.lesen` endet der Satz nach „zuerst" — samt Gedankenstrich faellt nur der Verweis. */}
          {darf['buchhaltung.lesen'] === true && (
            <>
              {' — '}
              <Link href={`/portal/${mandant}/buchhaltung/buchungen`} className="underline underline-offset-2">zu den Buchungen</Link>
            </>
          )}.
        </Hinweis>
      ) : (
        <Hinweis art="erfolg" cse="z3-unvollstaendig" className="mb-s5 max-w-prose">
          <strong>Jede Buchungszeile des Zeitraums trägt Beleg und Konto.</strong>
        </Hinweis>
      )}
      <Hinweis art="hinweis" cse="z3-grenzen" className="mb-s5 max-w-prose">
        <strong>Was das Paket nicht enthält.</strong> Die DTD des Beschreibungsstandards liegt nicht bei
        (<code className="font-mono text-xs">index.xml</code> nennt sie; O-365). Bankverbindungen sowie Kreditoren- und
        Debitorennummern sind der Anwendungsrolle entzogen und fehlen im Stamm; die Kontonummern stehen in{' '}
        <code className="font-mono text-xs">konten.csv</code>. Die CSV-Dateien sind Windows-1252; ersetzte Zeichen:{' '}
        {String(z.ersetzteZeichen)}.
      </Hinweis>

      <div data-cse="z3-abrufe" className="mb-s6 flex flex-wrap items-center gap-s3">
        <a href={`${api}&format=zip`} data-cse="z3-abrufen" className={knopf}>Paket (ZIP)</a>
        <a href={`${api}&format=index`} data-cse="z3-index-abrufen" className={knopf}>Strukturbeschreibung (index.xml)</a>
        <span className="font-mono text-xs text-text-muted" data-cse="z3-sha256" title={z.zipSha256}>
          SHA-256 {z.zipSha256.slice(0, 16)}…
        </span>
      </div>

      <DataTable
        beschriftung={`Tabellen des Z3-Pakets ${z.bezeichnung}`}
        zeilen={z.tabellen}
        schluessel={(t) => t.name}
        spalten={[
          { schluessel: 'datei', kopf: 'Datei', zelle: (t) => <span className="font-mono text-xs">{t.datei}</span> },
          { schluessel: 'text', kopf: 'Inhalt', zelle: (t) => t.text },
          { schluessel: 'zeilen', kopf: 'Zeilen', numerisch: true, zelle: (t) => String(t.zeilen) },
          { schluessel: 'groesse', kopf: 'Größe', numerisch: true, zelle: (t) => groesse(t.groesseBytes) },
          { schluessel: 'sha', kopf: 'SHA-256',
            zelle: (t) => <span className="font-mono text-xs text-text-muted" title={t.sha256}>{t.sha256.slice(0, 12)}…</span> },
        ]}
      />
    </PortalRahmen>
  );
}
