import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { SupabaseSpeicher } from '@/server/storage/adapter';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { erstellePruefbuendel, type Pruefbuendel } from '@/server/services/buchhaltung/pruefbuendel';
import { liesWirtschaftsjahr, wirtschaftsjahrVon } from '@/server/services/buchhaltung/wirtschaftsjahr';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/dokumente/buendel` — das Pruefbuendel eines Jahrgangs
 * (DOC-08, ACC-06, ACC-09, PR 64, D-483).
 *
 * Die Seite zeigt das MANIFEST: jede festgeschriebene Rechnung des
 * Wirtschaftsjahrs, ob sie Beleg und Buchung traegt, was das Ausgangsbuch
 * sagt, welche Dateien mit welchem SHA-256 dazugehoeren — und ob die
 * Exportsperre den Zeitraum noch haelt. Das Manifest gibt es immer; das ZIP
 * mit den Dateien nur mit verbundenem Belegspeicher und ohne Sperre, und die
 * Seite sagt, welches von beiden fehlt.
 */
export const dynamic = 'force-dynamic';

function deutschesDatum(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

export default async function Buendel(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/dokumente/buendel`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const suche = await searchParams;
  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const gewaehlt = jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const wj = await liesWirtschaftsjahr(kontext);
      const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
      const jahr = gewaehlt ?? wirtschaftsjahrVon(heute?.tag ?? '2026-01-01', wj);
      const jahre = await kontext.abfrage<{ jahr: number }>(
        `select distinct extract(year from rechnungsdatum)::int as jahr
           from rechnung where status = 'festgeschrieben' and rechnungsdatum is not null
          order by 1 desc`);
      const buendel = await erstellePruefbuendel(kontext, jahr);
      return { buendel, jahre: [...new Set([jahr, ...jahre.map((j) => j.jahr)])].sort((a, b) => b - a) };
    })) as Promise<{ buendel: Pruefbuendel; jahre: readonly number[] }>);

  const b = daten.buendel;
  const speicher = new SupabaseSpeicher();
  const basis = `/portal/${mandant}/dokumente/buendel`;
  const api = `/api/dokumente/buendel?mandant=${mandant}&jahr=${String(b.jahr)}`;
  const zipMoeglich = speicher.verbunden && b.sperre === null;
  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Prüfbündel"
      wurzelTitel="Dokumente"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Prüfbündel {b.bezeichnung}</h1>
        <Link href={`/portal/${mandant}/buchhaltung/archiv`} className={knopf}>Zum GoBD-Archiv</Link>
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Jede festgeschriebene Rechnung des Wirtschaftsjahrs {b.bezeichnung} ({deutschesDatum(b.von)} bis{' '}
        {deutschesDatum(b.bis)}), ihr archiviertes PDF und ihre Buchungszeilen — gegen das
        Rechnungsausgangsbuch gehalten. Das Manifest ist kanonisch und ohne Uhr: derselbe Jahrgang
        ergibt denselben Hash. Nichts hier berechnet Steuern oder Löhne (D-06).
      </p>

      <form method="get" action={basis} data-cse="buendel-jahr" className="mb-s5 flex flex-wrap items-center gap-s3">
        <label htmlFor="jahr" className="text-sm text-text">Wirtschaftsjahr</label>
        <select id="jahr" name="jahr" defaultValue={String(b.jahr)} className={feld}>
          {daten.jahre.map((j) => <option key={j} value={String(j)}>{j}</option>)}
        </select>
        <button type="submit" className={knopf}>Anzeigen</button>
        {b.wirtschaftsjahr.istPlatzhalter ? (
          <span className="text-xs text-text-muted">Beginn {String(b.wirtschaftsjahr.beginnTag)}.{String(b.wirtschaftsjahr.beginnMonat)}. — angenommen (O-05)</span>
        ) : null}
      </form>

      <ul data-cse="buendel-kennzahlen" className="mb-s6 grid grid-cols-2 gap-s4 md:grid-cols-4">
        <li><KpiStat label="Rechnungen" wert={String(b.rechnungen.length)} icon="rechnung" /></li>
        <li><KpiStat label="Ohne Beleg" wert={String(b.ohneBeleg)} icon="dokument" ton={b.ohneBeleg > 0 ? 'warning' : 'success'} /></li>
        <li><KpiStat label="Ohne Buchung" wert={String(b.ohneBuchung)} icon="buch" ton={b.ohneBuchung > 0 ? 'warning' : 'success'} /></li>
        <li><KpiStat label="Dateien im Bündel" wert={b.paket === null ? '—' : String(b.paket.dateien.length)} icon="export" ton="muted" /></li>
      </ul>

      {b.sperre !== null ? (
        <Hinweis art="warnung" cse="buendel-sperre" className="mb-s5 max-w-prose">
          <strong>Gesperrt.</strong> {b.sperre.satz}
        </Hinweis>
      ) : null}
      <Hinweis art={b.ausgangsbuch.ok ? 'erfolg' : 'warnung'} cse="buendel-ausgangsbuch" className="mb-s5 max-w-prose">
        <strong>Rechnungsausgangsbuch{b.ausgangsbuch.ok ? ' stimmt' : ' weicht ab'}.</strong>{' '}
        {b.ausgangsbuch.kreise.length === 0
          ? 'Kein Nummernkreis mit Rechnungen in diesem Zeitraum.'
          : b.ausgangsbuch.kreise.map((k) =>
            `${k.nummernkreis}: ${String(k.anzahl)} Nummern ${String(k.ersteNummer)}–${String(k.letzteNummer)}`
            + `${k.luecken.length > 0 ? `, ${String(k.luecken.length)} Lücke(n)` : ', lückenlos'}`
            + `${k.ohneKettenglied > 0 ? `, ${String(k.ohneKettenglied)} ohne Kettenglied` : ''}`).join(' · ')}
        {' '}<Link href={`/portal/${mandant}/finanzen/ausgangsbuch?jahr=${String(b.jahr)}`} className="underline underline-offset-2">Zum Ausgangsbuch</Link>.
      </Hinweis>

      <div data-cse="buendel-abrufe" className="mb-s6 flex flex-wrap items-center gap-s3">
        <a href={`${api}&format=manifest`} data-cse="manifest-abrufen" className={knopf}>
          Manifest (JSON)
        </a>
        {zipMoeglich ? (
          <a href={`${api}&format=zip`} data-cse="buendel-abrufen" className={knopf}>Bündel (ZIP)</a>
        ) : (
          <span data-cse="buendel-nicht-moeglich" className="text-sm text-text-muted">
            {b.sperre !== null
              ? 'Bündel (ZIP): erst ohne Sperre.'
              : 'Bündel (ZIP): der Belegspeicher ist nicht verbunden — das Manifest gibt es, die Dateien nicht.'}
          </span>
        )}
        <span className="font-mono text-xs text-text-muted" data-cse="manifest-sha256" title={b.manifestSha256}>
          SHA-256 {b.manifestSha256.slice(0, 16)}…
        </span>
      </div>

      {b.rechnungen.length === 0 ? (
        <p data-cse="buendel-leer" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine festgeschriebene Rechnung im Wirtschaftsjahr {b.bezeichnung}.
        </p>
      ) : (
        <DataTable
          beschriftung={`Rechnungen des Wirtschaftsjahrs ${b.bezeichnung}`}
          zeilen={b.rechnungen}
          schluessel={(r) => r.rechnungId}
          spalten={[
            { schluessel: 'nummer', kopf: 'Nummer',
              zelle: (r) => (
                <Link href={`/portal/${mandant}/finanzen/rechnungen/${r.rechnungId}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {r.nummer ?? '—'}
                </Link>
              ) },
            { schluessel: 'datum', kopf: 'Datum', zelle: (r) => deutschesDatum(r.rechnungsdatum) },
            { schluessel: 'brutto', kopf: 'Brutto', numerisch: true, zelle: (r) => formatiereGeld(cent(r.bruttoCent)) },
            { schluessel: 'art', kopf: 'Art', zelle: (r) => (r.storniert ? 'Storno' : 'Rechnung') },
            { schluessel: 'beleg', kopf: 'Beleg',
              zelle: (r) => (r.belegId === null
                ? <StatusPill zustand="Wartet" />
                : <span className="font-mono text-xs text-text-muted">{r.belegnummer ?? r.belegId.slice(0, 8)}</span>) },
            { schluessel: 'zeilen', kopf: 'Buchungszeilen', numerisch: true,
              zelle: (r) => (r.buchungszeilen === 0 ? <StatusPill zustand="Wartet" /> : String(r.buchungszeilen)) },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
