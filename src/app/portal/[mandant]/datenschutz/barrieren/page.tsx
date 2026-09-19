import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import type { BereichSchluessel } from '@/lib/design/theme';
import { liste, type BerichtZeile } from '@/server/services/datenschutz/barriere';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/datenschutz/barrieren` — die gemeldeten Barrieren
 * (LEG-07, BFSG).
 *
 * **Warum die Liste hier liegt und nicht unter `website`.** Behoben werden
 * Barrieren von denen, die den Auftritt pflegen — das Recht ist deshalb
 * `referenz.schreiben`. Aber GEZÄHLT werden sie für die
 * Barrierefreiheitserklärung, und die ist ein Rechtsdokument neben dem
 * Verarbeitungsverzeichnis. Beides an einem Ort zu haben ist der Kompromiss,
 * den ein Audit am wenigsten missversteht.
 *
 * **Eine Meldung ohne E-Mail-Adresse ist die Regel und kein Fehler.** Der
 * Meldeweg muss ohne Identifikation offen sein; wer das nicht weiss, hält die
 * leere Spalte für einen Datenverlust. Der Hinweis oben sagt es deshalb.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Gemeldete Barrieren — Datenschutz' };

const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen',
  in_bearbeitung: 'In Arbeit',
  behoben: 'Abgeschlossen',
  kein_mangel: 'Archiviert',
};

const STATUS_WORT: Readonly<Record<string, string>> = {
  neu: 'Neu',
  in_bearbeitung: 'In Bearbeitung',
  behoben: 'Behoben',
  kein_mangel: 'Kein Mangel',
};

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

export default async function Barrieren(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/datenschutz/barrieren`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'referenz.schreiben');

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => liste(kontext))
  ) as Promise<readonly BerichtZeile[]>);

  const offen = zeilen.filter((z) => !['behoben', 'kein_mangel'].includes(z.status));

  return (
    <PortalRahmen
      titel="Gemeldete Barrieren"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Gemeldete Barrieren</h1>
        <p className="m-0 text-sm text-text-muted">
          {`${String(offen.length)} offen von ${String(zeilen.length)}`}
        </p>
      </div>

      <Hinweis art="hinweis" cse="barrieren-erklaerung" className="mb-s5 max-w-prose">
        Diese Meldungen kommen aus
        <code className="mx-s1 font-mono">/barrierefreiheit/feedback</code>, dem
        Meldeweg, den das BFSG verlangt. <strong>Eine Meldung ohne E-Mail-Adresse
        ist die Regel, nicht ein Fehler</strong>: der Weg muss ohne Identifikation
        offen sein — ein Pflichtfeld wäre eine Hürde vor dem Weg, der Hürden melden
        soll. Was hier erledigt wird, gehört in die Barrierefreiheitserklärung:
        sie muss den Stand nennen.
      </Hinweis>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine Barriere gemeldet.
        </p>
      ) : (
        <DataTable
          beschriftung="Gemeldete Barrieren, offene zuerst"
          zeilen={[...zeilen]}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'was',
              kopf: 'Meldung',
              zelle: (z) => (
                <span className="block max-w-prose">
                  {z.beschreibung}
                  {z.seite === null ? null : (
                    <span className="block font-mono text-xs text-text-muted">{z.seite}</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'hilfsmittel',
              kopf: 'Hilfsmittel',
              zelle: (z) => z.hilfsmittel ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'antwort',
              kopf: 'Antwort an',
              zelle: (z) => (z.email === null
                ? <span className="text-text-subtle" title="Ohne Adresse gemeldet — das ist zulässig und beabsichtigt.">anonym</span>
                : z.email),
            },
            {
              schluessel: 'eingang',
              kopf: 'Eingegangen',
              zelle: (z) => BERLIN.format(new Date(z.eingegangenAm)),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span>
                  <StatusPill zustand={STATUS_PILLE[z.status] ?? 'Offen'} />
                  <span className="block text-xs text-text-muted">
                    {STATUS_WORT[z.status] ?? z.status}
                  </span>
                  {z.antwort === null ? null : (
                    <span className="mt-s1 block max-w-prose text-xs text-text-muted">
                      {z.antwort}
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'handlung',
              kopf: '',
              zelle: (z) => (
                darf['referenz.schreiben'] !== true
                || ['behoben', 'kein_mangel'].includes(z.status)
                  ? <span className="text-text-subtle">—</span>
                  : (
                    <details data-cse="barriere-erledigen">
                      <summary className="cursor-pointer text-sm text-brand">Erledigen</summary>
                      <form method="post" action="/api/barrierefreiheit/erledigen"
                            className="mt-s3 flex flex-col gap-s2">
                        <input type="hidden" name="id" value={z.id} />
                        <input type="hidden" name="zurueck" value={pfad} />
                        <textarea name="antwort" rows={3} required
                                  placeholder="Was wurde getan?"
                                  className="rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text" />
                        <div className="flex flex-wrap gap-s2">
                          <Button type="submit" name="handlung" value="behoben"
                                  variante="primary">
                            Behoben
                          </Button>
                          <Button type="submit" name="handlung" value="kein_mangel"
                                  variante="secondary">
                            Kein Mangel
                          </Button>
                        </div>
                      </form>
                    </details>
                  )
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
