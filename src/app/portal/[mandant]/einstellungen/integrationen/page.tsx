import type postgres from 'postgres';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { anbindungen, STAND_TEXT, type Anbindungsstand } from '@/server/registry/integrationen';
import { alleJobs } from '@/server/jobs/bootstrap';
import { planzeilen } from '@/server/jobs/zeitplan';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/integrationen` — jede Anbindung mit ihrem
 * wahren Zustand (CLAUDE.md „No fake integrations", SEITENKARTE 5.24).
 *
 * Die Zustaende kommen aus den Adaptern, die die Verbindung auch benutzen
 * (`registry/integrationen.ts`). Diese Seite behauptet nichts, was ein
 * Adapter nicht bestaetigt — und sie nennt zu jeder Luecke die offene Frage,
 * die sie schliesst.
 */
export const dynamic = 'force-dynamic';

/** Gespeichert UTC, gezeigt Europe/Berlin (Invariante 2). */
const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const PILLE: Readonly<Record<Anbindungsstand, PillZustand>> = {
  verbunden: 'Aktiv',
  nicht_verbunden: 'Inaktiv',
  entwicklung: 'Entwurf',
  dateiexport: 'Bereit',
  nicht_vorgesehen: 'Archiviert',
};

export default async function Integrationen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/integrationen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const zeilen = anbindungen();
  const verbunden = zeilen.filter((z) => z.stand === 'verbunden').length;

  /*
   * **Der Zeitplan allein ist eine Behauptung.**
   *
   * `zeitplan: '0 3 * * *'` steht im Code und sagt, wann etwas laufen SOLL.
   * Ob es gelaufen ist, steht in `job_lauf` — und genau dieser Vergleich
   * fehlte: sechzehn Waechter mit einem Zeitplan, kein einziger Lauf, und
   * kein Bildschirm, auf dem das aufgefallen waere. Ein Job, der nie laeuft,
   * erzeugt keine Fehlermeldung; er erzeugt nur nichts.
   *
   * `job_lauf` traegt KEIN `mandant_id` (0010) — die Laeufe sind
   * plattformweit, und das ist richtig: ein Nachtlauf laeuft einmal und
   * schreibt sein Ergebnis je Mandant daneben. Die Abfrage steht deshalb
   * ausserhalb von `withTenant`.
   */
  const laeufe = await (db().begin(SCHNAPPSCHUSS, (tx: postgres.TransactionSql) =>
    tx.unsafe(
      `select distinct on (job) job, gestartet_am, ergebnis::text as ergebnis
         from job_lauf order by job, gestartet_am desc`,
    )) as Promise<readonly { job: string; gestartet_am: Date; ergebnis: string | null }[]>);
  const letzter = new Map(laeufe.map((l) => [l.job, l]));
  const plan = planzeilen(alleJobs(db()));
  const nieGelaufen = plan.filter((p) => !letzter.has(p.schluessel)).length;

  return (
    <PortalRahmen
      titel="Integrationen"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}/einstellungen`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Integrationen</h1>
      <p data-cse="integrationen-zaehler" data-verbunden={verbunden} data-anzahl={zeilen.length}
         className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        {String(verbunden)} von {String(zeilen.length)} Anbindungen sind verbunden. Was nicht
        verbunden ist, wird nicht vorgetäuscht: der jeweilige Bildschirm sagt es, und
        nichts geht hinaus. Jede externe Verbindung braucht eine EU-Region und einen
        Vertrag zur Auftragsverarbeitung — siehe Auftragsverarbeiter.
      </p>
      <div data-cse="integrationen">
        <DataTable
          beschriftung="Anbindungen und ihr Zustand"
          zeilen={zeilen}
          schluessel={(z) => z.schluessel}
          spalten={[
            { schluessel: 'name', kopf: 'Anbindung', zelle: (z) => z.name },
            { schluessel: 'zweck', kopf: 'Zweck', zelle: (z) => z.zweck },
            { schluessel: 'stand', kopf: 'Zustand',
              zelle: (z) => (
                <span className="flex items-center gap-s2" data-stand={z.stand}>
                  <StatusPill zustand={PILLE[z.stand]} />
                  <span className="text-xs text-text-muted">{STAND_TEXT[z.stand]}</span>
                </span>
              ) },
            { schluessel: 'hinweis', kopf: 'Woher die Antwort kommt', zelle: (z) => z.hinweis },
            { schluessel: 'offen', kopf: 'Offene Frage',
              zelle: (z) => (z.offen === null ? '—' : <code className="text-xs">{z.offen}</code>) },
          ]}
        />
      </div>
      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">
        Verbunden wird über Umgebungsvariablen des Deployments, nie über ein Feld in
        dieser Oberfläche — ein Schlüssel gehört nicht in eine Datenbank, die jemand
        exportieren kann.
      </p>

      <h2 className="mb-s3 mt-s7 text-h2 text-text">Nachtläufe</h2>
      <p data-cse="jobs-zaehler" data-anzahl={plan.length} data-nie={nieGelaufen}
         className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        {String(plan.length)} Wächter tragen einen Zeitplan (SPEC §14).{' '}
        {nieGelaufen === 0
          ? 'Jeder davon ist mindestens einmal gelaufen.'
          : `${String(nieGelaufen)} davon sind noch nie gelaufen.`}{' '}
        Ein Zeitplan im Code sagt, wann etwas laufen soll; wann es gelaufen ist, steht
        hier. Die beiden auseinanderlaufen zu lassen ist der Fehler, der keine
        Fehlermeldung erzeugt.
      </p>

      {nieGelaufen === plan.length ? (
        <Hinweis art="warnung" cse="jobs-kein-ausloeser" className="mb-s5 max-w-prose">
          <strong>Kein Wächter ist je gelaufen.</strong> Das ist kein Fehler im Code —
          es fehlt der Auslöser. Der Plan dafür wird aus dem Job-Register erzeugt
          (<code>pnpm jobs:plan</code> → <code>docs/JOB-AUSLOESER.sql</code>) und einmal
          in der Datenbank eingespielt; ohne <code>JOB_TOKEN</code> nimmt die
          Auslöseroute ohnehin nichts an.
        </Hinweis>
      ) : null}

      <div data-cse="jobs">
        <DataTable
          beschriftung="Nachtläufe, ihr Zeitplan und ihr letzter Lauf"
          zeilen={plan}
          schluessel={(p) => p.schluessel}
          spalten={[
            { schluessel: 'bezeichnung', kopf: 'Wächter', zelle: (p) => p.bezeichnung },
            { schluessel: 'zeitplan', kopf: 'Zeitplan (UTC)',
              zelle: (p) => <code className="text-xs">{p.zeitplan}</code> },
            { schluessel: 'bereich', kopf: 'Umfang', zelle: (p) => p.bereich },
            { schluessel: 'lauf', kopf: 'Zuletzt gelaufen',
              zelle: (p) => {
                const l = letzter.get(p.schluessel);
                return l === undefined ? (
                  <span data-cse="job-nie" className="flex items-center gap-s2">
                    <StatusPill zustand="Inaktiv" />
                    <span className="text-xs text-text-muted">noch nie</span>
                  </span>
                ) : (
                  <span data-cse="job-lauf" data-ergebnis={l.ergebnis ?? 'offen'}
                        className="flex items-center gap-s2">
                    <StatusPill zustand={l.ergebnis === 'erfolg' ? 'Aktiv' : 'Überfällig'} />
                    <span className="text-xs text-text-muted">
                      {BERLIN.format(new Date(l.gestartet_am))}
                    </span>
                  </span>
                );
              } },
          ]}
        />
      </div>
    </PortalRahmen>
  );
}
