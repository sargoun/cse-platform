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
import { offeneArchivierungen } from '@/server/services/buchhaltung/belegarchiv';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { formatiereBytes, KATEGORIE } from '../../dokumente/darstellung';

/**
 * `/portal/[mandant]/buchhaltung/archiv` — das GoBD-Archiv dieser
 * Gesellschaft (ACC-06, DOC-07, LEG-01, D-483).
 *
 * Was hier steht, ist nicht loeschbar — und die Seite sagt, WARUM das eine
 * Eigenschaft ist und kein Vorsatz: kein `DELETE`-Recht fuer eine
 * Anwendungsrolle, ein Ausloeser, der auch den Eigentuemer abweist, eine
 * Loeschsperre, die das weiche Loeschen abweist, ein einziger Loeschweg im
 * Code, den eine Merge-Wache haelt. Die Frist beginnt mit dem Schluss des
 * Kalenderjahrs, in dem das Dokument entstand (§ 147 Abs. 4 AO), und wird
 * nie kuerzer.
 *
 * Was die Plattform NICHT erzwingen kann, steht ebenfalls da: die
 * Unveraenderlichkeit des Objektspeichers selbst ist eine Einstellung beim
 * Anbieter (O-364).
 */
export const dynamic = 'force-dynamic';

const FINANZ_KATEGORIEN = ['rechnung', 'buchhaltung', 'beleg'] as const;

interface Zeile {
  readonly id: string;
  readonly titel: string;
  readonly kategorie: string;
  readonly bucket: string;
  readonly entstanden: string;
  readonly aufbewahrung_bis: string | null;
  readonly loeschsperre: boolean;
  readonly groesse: string;
  readonly sha256: string | null;
}

interface Kennzahlen {
  readonly gesamt: number;
  readonly gesperrt: number;
  readonly offen: number;
  readonly fruehestes_ende: string | null;
}

interface Rechte {
  readonly aufbewahrung: boolean;
  readonly buendel: boolean;
}

function deutschesDatum(iso: string | null): string {
  if (iso === null) return '—';
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

export default async function Archiv(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/archiv`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;
  const suche = await searchParams;
  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const jahr = jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const FILTER = `d.geloescht_am is null
          and (d.kategorie::text = any($1::text[]) or d.bucket = 'archiv')`;
      const zeilen = await kontext.abfrage<Zeile>(
        `select d.id, d.titel, d.kategorie::text as kategorie, d.bucket,
                d.entstanden_am::text as entstanden, d.aufbewahrung_bis::text as aufbewahrung_bis,
                d.loeschsperre, d.groesse_bytes::text as groesse,
                (select v.sha256 from dokument_version v
                  where v.dokument_id = d.id and v.mandant_id = d.mandant_id
                  order by v.version desc limit 1) as sha256
           from dokument d
          where ${FILTER}
            and ($2::int is null or extract(year from d.entstanden_am) = $2)
          order by d.entstanden_am desc, d.titel
          limit 300`,
        [FINANZ_KATEGORIEN, jahr]);
      const [k] = await kontext.abfrage<Kennzahlen>(
        `select count(*)::int as gesamt,
                count(*) filter (where d.loeschsperre)::int as gesperrt,
                count(*) filter (where d.aufbewahrung_bis is null)::int as offen,
                min(d.aufbewahrung_bis)::text as fruehestes_ende
           from dokument d
          where ${FILTER}`, [FINANZ_KATEGORIEN]);
      const jahre = await kontext.abfrage<{ jahr: number }>(
        `select distinct extract(year from d.entstanden_am)::int as jahr
           from dokument d where ${FILTER} order by 1 desc`, [FINANZ_KATEGORIEN]);
      const [r] = await kontext.abfrage<Rechte>(
        `select app.hat_recht('dokument.aufbewahrung_verwalten', $1::uuid) as aufbewahrung,
                app.hat_recht('dokument.buendel_exportieren', $1::uuid) as buendel`, [mandantId]);
      const offeneLaeufe = (await offeneArchivierungen(kontext)).length;
      return { zeilen, k: k ?? { gesamt: 0, gesperrt: 0, offen: 0, fruehestes_ende: null },
        jahre: jahre.map((j) => j.jahr), rechte: r ?? { aufbewahrung: false, buendel: false },
        offeneLaeufe };
    })) as Promise<{
      zeilen: readonly Zeile[]; k: Kennzahlen; jahre: readonly number[]; rechte: Rechte;
      offeneLaeufe: number;
    }>);

  const speicher = new SupabaseSpeicher();
  const basis = `/portal/${mandant}/buchhaltung/archiv`;
  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="GoBD-Archiv"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">GoBD-Archiv</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Rechnungen, Belege und Buchhaltungsunterlagen dieser Gesellschaft — zehn Jahre
        aufbewahrt, nicht löschbar. Die Frist beginnt mit dem Schluss des Kalenderjahrs, in
        dem das Dokument entstand (§ 147 Abs. 4 AO), und wird nie kürzer.
      </p>

      <Hinweis cse="archiv-zusage" className="mb-s5 max-w-prose">
        <strong>Löschen ist hier keine Handlung, die fehlschlägt — es gibt sie nicht.</strong>{' '}
        Keine Anwendungsrolle hält ein Löschrecht auf dieser Tabelle; ein Auslöser weist auch den
        Eigentümer ab; die Löschsperre weist das Aussortieren ab; im Code gibt es genau einen
        Löschweg, und eine Merge-Wache hält ihn. Belegt durch Tests (D-483).
      </Hinweis>

      <ul data-cse="archiv-kennzahlen" className="mb-s6 grid grid-cols-2 gap-s4 md:grid-cols-4">
        <li><KpiStat label="Dokumente im Archiv" wert={String(daten.k.gesamt)} icon="dokument" /></li>
        <li><KpiStat label="Unter Löschsperre" wert={String(daten.k.gesperrt)} icon="schloss" ton="success" /></li>
        <li><KpiStat label="Frühestes Fristende" wert={deutschesDatum(daten.k.fruehestes_ende)} icon="kalender" ton="muted" /></li>
        <li>
          <KpiStat label="Rechnungen ohne Archivlauf" wert={String(daten.offeneLaeufe)} icon="rechnung"
                   ton={daten.offeneLaeufe > 0 ? 'warning' : 'success'} />
        </li>
      </ul>

      {daten.offeneLaeufe > 0 ? (
        <Hinweis art="warnung" cse="archiv-offene-laeufe" className="mb-s5 max-w-prose">
          <strong>{String(daten.offeneLaeufe)} festgeschriebene Rechnung(en) tragen noch keinen Beleg.</strong>{' '}
          Der nächtliche Archivlauf legt das PDF ab, sobald der Belegspeicher verbunden ist —
          bis dahin sperrt die Exportsperre den Zeitraum (ACC-03).
        </Hinweis>
      ) : null}

      {speicher.verbunden ? null : (
        <p data-cse="speicher-nicht-verbunden"
           className="mb-s5 max-w-prose rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          Der Belegspeicher ist nicht verbunden (Einstellungen › Integrationen). Verzeichnet
          ist, was hier steht; die Dateien selbst sind erst mit Verbindung abrufbar.
        </p>
      )}

      <nav aria-label="Archiv-Werkzeuge" data-cse="archiv-werkzeuge" className="mb-s6 flex flex-wrap gap-s3">
        {daten.rechte.aufbewahrung ? (
          <Link href={`/portal/${mandant}/dokumente/aufbewahrung`}
                className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2">
            Aufbewahrungsregeln
          </Link>
        ) : null}
        {daten.rechte.buendel ? (
          <Link href={`/portal/${mandant}/dokumente/buendel`}
                className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2">
            Prüfbündel je Jahrgang
          </Link>
        ) : null}
        <Link href={`/portal/${mandant}/finanzen/ausgangsbuch`}
              className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2">
          Rechnungsausgangsbuch
        </Link>
      </nav>

      <form method="get" action={basis} data-cse="archiv-filter" className="mb-s5 flex flex-wrap items-center gap-s3">
        <label htmlFor="jahr" className="text-sm text-text">Entstehungsjahr</label>
        <select id="jahr" name="jahr" defaultValue={jahr === null ? '' : String(jahr)} className={feld}>
          <option value="">alle</option>
          {daten.jahre.map((j) => <option key={j} value={String(j)}>{j}</option>)}
        </select>
        <button type="submit" className="min-h-11 rounded-md border border-line-strong px-s5 text-sm text-text hover:bg-surface-2">
          Anzeigen
        </button>
      </form>

      {daten.zeilen.length === 0 ? (
        <p data-cse="archiv-leer" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {jahr === null
            ? 'Noch kein Dokument im Archiv. Der erste Eintrag entsteht mit der ersten festgeschriebenen Rechnung oder dem ersten abgelegten Beleg.'
            : `Kein Dokument mit Entstehungsjahr ${String(jahr)}.`}
        </p>
      ) : (
        <DataTable
          beschriftung="Dokumente im GoBD-Archiv"
          zeilen={daten.zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'titel', kopf: 'Dokument',
              zelle: (z) => (
                <Link href={`/portal/${mandant}/dokumente/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.titel}
                </Link>
              ) },
            { schluessel: 'kategorie', kopf: 'Kategorie', zelle: (z) => KATEGORIE[z.kategorie] ?? z.kategorie },
            { schluessel: 'entstanden', kopf: 'Entstanden', zelle: (z) => deutschesDatum(z.entstanden) },
            { schluessel: 'frist', kopf: 'Aufbewahrung bis',
              zelle: (z) => z.aufbewahrung_bis === null
                ? <span className="text-text-muted">offen (O-25)</span>
                : deutschesDatum(z.aufbewahrung_bis) },
            { schluessel: 'sperre', kopf: 'Löschsperre',
              zelle: (z) => <StatusPill zustand={z.loeschsperre ? 'Archiviert' : 'Offen'} /> },
            { schluessel: 'sha', kopf: 'SHA-256',
              zelle: (z) => (
                <span className="font-mono text-xs text-text-muted" title={z.sha256 ?? ''}>
                  {z.sha256 === null ? '—' : `${z.sha256.slice(0, 12)}…`}
                </span>
              ) },
            { schluessel: 'groesse', kopf: 'Größe', numerisch: true, zelle: (z) => formatiereBytes(z.groesse) },
          ]}
        />
      )}

      <p data-cse="archiv-anbieter" className="mt-s6 max-w-prose text-xs text-text-subtle">
        Die Unveränderlichkeit des Objektspeichers selbst (Versionierung, Object Lock) ist eine
        Einstellung beim Anbieter und wird hier nicht behauptet — offen (O-364).
      </p>
    </PortalRahmen>
  );
}
