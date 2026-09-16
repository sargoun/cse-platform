import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { alleJobs } from '@/server/jobs/bootstrap';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import {
  AUSGEBLIEBEN_FAKTOR, BEFUND_LABEL, liesBetriebslage,
  type Befundart, type Betriebslage, type MandantFehler,
} from '@/server/services/betrieb/ueberwachung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/betrieb` — die Betriebsansicht (SPEC §14,
 * D-540, Phase 10).
 *
 * **Ein Lauf, der nachts scheitert, hatte bisher keinen Bildschirm.** Er stand
 * in `job_lauf` und auf `stderr`, und beides sieht niemand. Hier steht er —
 * zusammen mit den beiden stilleren Ausfällen: dem Lauf, der begonnen und nie
 * geendet hat, und dem, der gar nicht erst gestartet ist.
 *
 * Die Seite ENTSCHEIDET nichts und startet nichts. Ein Lauf wird über
 * `/api/jobs/[schluessel]` ausgelöst und verlangt das Betriebsgeheimnis; ein
 * Knopf hier wäre derselbe Schalter ohne Geheimnis.
 */
export const dynamic = 'force-dynamic';

/** Jeder Befund bekommt ein Pill aus dem festen Wortschatz (DESIGN §5). */
const PILL: Readonly<Record<Befundart, PillZustand>> = {
  fehler: 'Fehler',
  haengt: 'Wartet',
  teilweise: 'Fehler',
  ausgeblieben: 'Überfällig',
  nie_gelaufen: 'Inaktiv',
};

const ERGEBNIS_PILL: Readonly<Record<string, PillZustand>> = {
  erfolg: 'Abgeschlossen',
  teilweise: 'Fehler',
  fehler: 'Fehler',
  abgebrochen: 'Abgelehnt',
  läuft: 'In Arbeit',
};

function HierListe({ hier }: { readonly hier: readonly MandantFehler[] }) {
  if (hier.length === 0) return null;
  return (
    <ul className="m-0 mt-s2 list-disc ps-s5 text-xs text-text-muted">
      {hier.map((h, i) => (
        <li key={`${h.zeitpunkt}-${String(i)}`}>
          {h.zeitpunkt}: {h.fehlertext ?? 'ohne Text'}
        </li>
      ))}
    </ul>
  );
}

export default async function Betriebsseite(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/betrieb`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const jobs = alleJobs(db());
  const lage = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) =>
      liesBetriebslage(kontext, jobs))) as Promise<Betriebslage>);

  return (
    <PortalRahmen
      titel="Betrieb"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Betrieb</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Jeder geplante Lauf gegen sein Protokoll. Ein gescheiterter Lauf steht hier,
        ein hängender auch — und der stillste Ausfall ebenfalls: der Lauf, der gar
        nicht erst gestartet ist. Der erwartete Abstand kommt aus dem Zeitplan des
        Laufs; als ausgeblieben gilt er erst nach dem {String(AUSGEBLIEBEN_FAKTOR)}-fachen
        davon, weil dann ein Auslöser beweisbar ausgefallen ist.
      </p>
      <p data-cse="betrieb-stand" className="mb-s5 text-xs text-text-subtle">
        Stand: {lage.stand} · {String(lage.staende.length)} geplante Läufe ·{' '}
        {String(lage.unauffaellig)} ohne Befund
        {lage.unbeurteilbar > 0
          ? ` · ${String(lage.unbeurteilbar)} mit kalendergebundenem Zeitplan`
          : ''}
      </p>

      <Hinweis art={lage.ausloeser.erweiterung && lage.ausloeser.eintraege !== null
        && lage.ausloeser.eintraege >= lage.ausloeser.erwartet ? 'erfolg' : 'warnung'}
               cse="betrieb-ausloeser" className="mb-s6 max-w-prose">
        <strong>Der Auslöser.</strong> {lage.ausloeser.text}
      </Hinweis>

      <section className="mb-s7">
        <h2 className="mb-s3 text-h3 text-text">
          Befunde ({String(lage.befunde.length)})
        </h2>
        {lage.befunde.length === 0 ? (
          <p data-cse="betrieb-ohne-befund" className="max-w-prose text-sm text-text-muted">
            Kein Lauf ist gescheitert, keiner hängt, keiner ist ausgeblieben.
          </p>
        ) : (
          <ul data-cse="betrieb-befunde" className="m-0 grid list-none gap-s4 p-0">
            {lage.befunde.map((b) => (
              <li key={b.schluessel} data-cse="betrieb-befund" data-art={b.art}
                  className="rounded-lg border border-line bg-surface p-s5">
                <div className="flex flex-wrap items-baseline justify-between gap-s3">
                  <h3 className="text-sm font-semibold text-text">{b.bezeichnung}</h3>
                  <StatusPill zustand={PILL[b.art]} />
                </div>
                <p className="mt-s1 text-xs text-text-subtle">
                  {BEFUND_LABEL[b.art]} · <code className="font-mono">{b.schluessel}</code> ·
                  Zeitplan <code className="font-mono">{b.zeitplan}</code> (UTC) · {b.erwartung}
                </p>
                <p className="mt-s2 text-sm text-text">
                  {b.zuletzt === null
                    ? 'Für diesen Lauf gibt es in dieser Datenbank kein einziges Protokoll.'
                    : b.art === 'haengt'
                      ? `Begonnen ${b.zuletzt} (${b.alterText ?? ''}) und nie beendet.`
                      : `Letzter Lauf: ${b.zuletzt} (${b.alterText ?? ''}).`}
                </p>
                {b.haengende > 0 && b.art !== 'haengt' && (
                  <p data-cse="betrieb-haengende" className="mt-s2 text-xs text-warning">
                    Ausserdem {String(b.haengende)} begonnene Läufe ohne Ende.
                  </p>
                )}
                {b.fehlertext !== null && (
                  <p data-cse="betrieb-fehlertext"
                     className="mt-s2 max-w-prose break-words font-mono text-xs text-danger">
                    {b.fehlertext}
                  </p>
                )}
                {b.fehlerhafteMandanten !== null && (
                  <p className="mt-s2 text-xs text-text-muted">
                    {String(b.fehlerhafteMandanten)} Gesellschaften hat dieser Lauf nicht
                    geschafft. {b.hier.length === 0
                      ? 'Diese hier war nicht darunter — die übrigen stehen in deren '
                        + 'eigener Betriebsansicht.'
                      : `Davon hier: ${String(b.hier.length)}.`}
                  </p>
                )}
                <HierListe hier={b.hier} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-s7">
        <h2 className="mb-s3 text-h3 text-text">Jeder geplante Lauf</h2>
        <DataTable
          beschriftung="Geplante Läufe und ihr letzter Stand"
          zeilen={lage.staende.map((s, i) => ({ i, s }))}
          schluessel={(r) => String(r.i)}
          spalten={[
            { schluessel: 'lauf', kopf: 'Lauf', zelle: (r) => r.s.bezeichnung },
            {
              schluessel: 'plan', kopf: 'Zeitplan (UTC)',
              zelle: (r) => <code className="font-mono text-xs">{r.s.zeitplan}</code>,
            },
            { schluessel: 'erwartung', kopf: 'Erwartet', zelle: (r) => (r.s.beurteilbar
              ? r.s.erwartung
              : <span className="text-text-subtle">nicht beurteilbar</span>) },
            {
              schluessel: 'zuletzt', kopf: 'Zuletzt',
              zelle: (r) => r.s.zuletzt ?? <span className="text-text-subtle">nie</span>,
            },
            {
              schluessel: 'stand', kopf: 'Stand',
              zelle: (r) => (r.s.befund !== null
                ? <StatusPill zustand={PILL[r.s.befund]} />
                : r.s.ergebnis === null
                  ? <StatusPill zustand="Inaktiv" />
                  : <StatusPill zustand={ERGEBNIS_PILL[r.s.ergebnis] ?? 'Inaktiv'} />),
            },
          ]}
        />
        <p className="mt-s2 max-w-prose text-xs text-text-subtle">
          „Nicht beurteilbar" heisst: der Zeitplan hängt an Monatstag, Monat oder
          Wochentag, und wie weit zwei Läufe dann auseinanderliegen, rechnet diese
          Seite nicht nach. Sie sagt es lieber, als es zu erfinden — ein Bildschirm,
          der grundlos rot ist, wird nicht mehr gelesen.
        </p>
      </section>

      <section className="mb-s7">
        <h2 className="mb-s3 text-h3 text-text">Die letzten gescheiterten Läufe</h2>
        {lage.fehllaeufe.length === 0 ? (
          <p data-cse="betrieb-ohne-fehllauf" className="max-w-prose text-sm text-text-muted">
            Im Protokoll steht kein gescheiterter Lauf.
          </p>
        ) : (
          <ul data-cse="betrieb-fehllaeufe" className="m-0 grid list-none gap-s3 p-0">
            {lage.fehllaeufe.map((f, i) => (
              <li key={`${f.schluessel}-${String(i)}`}
                  className="rounded-md border border-line bg-surface-2 p-s4">
                <div className="flex flex-wrap items-baseline justify-between gap-s3">
                  <span className="text-sm text-text">{f.bezeichnung}</span>
                  <span className="text-xs text-text-subtle">{f.gestartet}</span>
                </div>
                <p className="mt-s1 text-xs text-text-muted">Ergebnis: {f.ergebnis}</p>
                {f.fehlertext !== null && (
                  <p className="mt-s1 max-w-prose break-words font-mono text-xs text-text-muted">
                    {f.fehlertext}
                  </p>
                )}
                <HierListe hier={f.hier} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-s2 max-w-prose text-xs text-text-subtle">
          Ein Lauf steht hier auch dann, wenn ein späterer gelungen ist — der Rückblick
          zeigt, was passiert ist, die Befunde oben zeigen, was jetzt gilt.
        </p>
      </section>
    </PortalRahmen>
  );
}
