import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { MONATSNAMEN, monatVerschieben } from '@/lib/datum/kalendertag';
import { erstelleLohnexport, type Lohnexport, type KontoLage } from '@/server/services/zeit/lohnexport';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';

/**
 * `/portal/[mandant]/buchhaltung/lohnexport` — Zeitdaten eines Monats fuer
 * das Lohnsystem (ACC-12, TIM-13, D-06, PR 67, D-486).
 *
 * Die Seite zeigt je Beschaeftigung, was das Paket traegt: Kontostand,
 * Soll und Ist, Saldo, den Nachweis — und ob der Monat gesperrt ist. Das
 * Format ist ein Platzhalter (O-27), und die Seite sagt es; die Datei kommt
 * ueber die API und steht im Protokoll.
 */
export const dynamic = 'force-dynamic';

const LAGE: Readonly<Record<KontoLage, PillZustand>> = {
  gesperrt: 'Abgeschlossen', vorlaeufig: 'In Prüfung', offen: 'Offen', kein_konto: 'Wartet',
};

function monatsLabel(monat: string): string {
  const m = Number(monat.slice(5, 7));
  return `${MONATSNAMEN[m - 1] ?? monat.slice(5, 7)} ${monat.slice(0, 4)}`;
}

export default async function LohnexportSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/lohnexport`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: ein Knopf, dessen Ziel diese Sitzung nicht oeffnen darf,
     verraet die Existenz dessen, was er nicht zeigen darf. */
  const darf = await haeltRechte(zugang.sitzung, 'zeit.exportieren');
  const suche = await searchParams;
  const monatRoh = typeof suche['monat'] === 'string' ? suche['monat'] : null;
  const gewaehlt = monatRoh !== null && /^\d{4}-(0[1-9]|1[0-2])$/u.test(monatRoh) ? monatRoh : null;

  const e = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
      /* Vorgabe: der Vormonat — der, den das Lohnbuero gerade abrechnet. */
      const vormonat = monatVerschieben(`${(heute?.tag ?? '2026-01-01').slice(0, 7)}-01`, -1).slice(0, 7);
      return erstelleLohnexport(kontext, gewaehlt ?? vormonat);
    })) as Promise<Lohnexport>);

  const basis = `/portal/${mandant}/buchhaltung/lohnexport`;
  const api = `/api/buchhaltung/lohnexport?mandant=${mandant}&monat=${e.monat}`;
  const zurueck = monatVerschieben(`${e.monat}-01`, -1).slice(0, 7);
  const vor = monatVerschieben(`${e.monat}-01`, 1).slice(0, 7);
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Lohnexport"
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
        <h1 className="text-h1 text-text">Lohnexport {monatsLabel(e.monat)}</h1>
        <nav aria-label="Monat" className="flex gap-s2">
          <a href={`${basis}?monat=${zurueck}`} data-cse="lohnexport-zurueck" className={knopf}>‹ {monatsLabel(zurueck)}</a>
          <a href={`${basis}?monat=${vor}`} data-cse="lohnexport-vor" className={knopf}>{monatsLabel(vor)} ›</a>
        </nav>
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Zeitdaten je Beschäftigung für das Lohnsystem: das Stundenkonto des Monats, die Abwesenheiten mit Art und
        Lohnart, jeder Zeiteintrag mit Beginn, Ende und Pause. Entgelt, Zuschläge und Sozialversicherung rechnet das
        Lohnsystem (D-06); Personalnummer und Name gehen mit, Stundensätze nicht.
      </p>

      <Hinweis art="warnung" cse="lohnexport-format" className="mb-s5 max-w-prose">
        <strong>Format: {e.format.bezeichnung} — Platzhalter.</strong> Das Lohnsystem und sein Importformat sind
        nicht festgelegt (O-27); dieser Export ist nicht mit ihm abgestimmt und nicht verbunden. Zielsystem:{' '}
        {e.format.zielsystem ?? 'nicht festgelegt'}.
      </Hinweis>

      <ul data-cse="lohnexport-kennzahlen" className="mb-s6 grid grid-cols-2 gap-s4 md:grid-cols-4">
        <li><KpiStat label="Beschäftigte im Monat" wert={String(e.zahlen.beschaeftigte)} icon="personal" /></li>
        <li><KpiStat label="Konten gesperrt" wert={`${String(e.zahlen.gesperrt)} / ${String(e.zahlen.beschaeftigte)}`} icon="schloss" ton={e.zahlen.vorlaeufig > 0 ? 'warning' : 'success'} /></li>
        <li><KpiStat label="Nicht freigegebene Zeiten" wert={String(e.zahlen.unfreigegeben)} icon="zeit" ton={e.zahlen.unfreigegeben > 0 ? 'warning' : 'success'} /></li>
        <li><KpiStat label="Abwesenheiten ohne Lohnart" wert={String(e.zahlen.abwesenheitenOhneLohnart)} icon="kalender" ton={e.zahlen.abwesenheitenOhneLohnart > 0 ? 'warning' : 'muted'} /></li>
      </ul>

      {e.hinweise.length > 0 ? (
        <Hinweis art="hinweis" cse="lohnexport-hinweise" className="mb-s5 max-w-prose">
          <ul className="list-disc pl-s5">
            {e.hinweise.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </Hinweis>
      ) : null}

      <div data-cse="lohnexport-abrufe" className="mb-s6 flex flex-wrap items-center gap-s3">
        <a href={api} data-cse="lohnexport-abrufen" className={knopf}>Paket (ZIP)</a>
        {darf['zeit.exportieren'] === true && (
          <Link href={`/portal/${mandant}/zeiten/milog`} className={knopf}>MiLoG-Nachweise</Link>
        )}
        <span className="font-mono text-xs text-text-muted" data-cse="lohnexport-sha256" title={e.zipSha256}>
          SHA-256 {e.zipSha256.slice(0, 16)}…
        </span>
      </div>

      {e.zeilen.length === 0 ? (
        <p data-cse="lohnexport-leer" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine Beschäftigung in diesem Monat.
        </p>
      ) : (
        <DataTable
          beschriftung={`Beschäftigungen im Monat ${monatsLabel(e.monat)}`}
          zeilen={e.zeilen}
          schluessel={(z) => z.anstellungId}
          spalten={[
            { schluessel: 'pn', kopf: 'Personalnr.', zelle: (z) => <span className="font-mono text-xs">{z.personalnummer}</span> },
            { schluessel: 'name', kopf: 'Name', zelle: (z) => z.person },
            { schluessel: 'konto', kopf: 'Konto', zelle: (z) => <StatusPill zustand={LAGE[z.konto]} /> },
            { schluessel: 'soll', kopf: 'Soll', numerisch: true, zelle: (z) => stundenAusMinuten(z.sollMinuten) },
            { schluessel: 'ist', kopf: 'Ist', numerisch: true, zelle: (z) => stundenAusMinuten(z.istMinuten) },
            { schluessel: 'saldo', kopf: 'Saldo', numerisch: true, zelle: (z) => stundenAusMinuten(z.saldoMinuten) },
            { schluessel: 'zeiten', kopf: 'Zeiteinträge', numerisch: true,
              zelle: (z) => (z.unfreigegeben > 0 ? `${String(z.zeiteintraege)} (${String(z.unfreigegeben)} offen)` : String(z.zeiteintraege)) },
            { schluessel: 'nachweis', kopf: 'Nachweis',
              zelle: (z) => (z.nachweisHash === null
                ? <span className="text-text-muted">—</span>
                : <span className="font-mono text-xs text-text-muted" title={z.nachweisHash}>{z.nachweisQuelle} · {z.nachweisHash.slice(0, 8)}…</span>) },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
