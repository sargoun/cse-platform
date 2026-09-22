import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { LIEFERANTEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/lieferanten';
import { leseLieferant, type LieferantZeile } from '@/server/services/finanz/lieferant';
import { LieferantFormular } from '../LieferantFormular';
import { LIEFERANT_FEHLER } from '../fehler';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/finanzen/lieferanten/[id]` — ein Lieferant: Stammdaten
 * ändern, sperren, archivieren (V-006).
 *
 * **Die Bankverbindung steht NICHT auf diesem Blatt.** `cse_app` hält auf
 * `lieferant.iban`, `bic`, `kreditorennummer` und `zahlungsziel_tage` kein
 * `select` (Spaltenentzug, `0123`); lesbar sind sie nur über
 * `app.lieferant_konditionen`, das jeden Zugriff protokolliert. Sie hier
 * einzublenden hiesse, diesen Schutz für eine Bequemlichkeit aufzugeben —
 * und die IBAN eines Lieferanten ist genau die Angabe, um die Betrug
 * kreist.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'eingang.schreiben';

function Feld({ kopf, children }: {
  readonly kopf: string; readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{kopf}</dt>
      <dd className="m-0 mt-s1 text-sm text-text">{children}</dd>
    </div>
  );
}

export default async function LieferantBlatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/finanzen/lieferanten/${id}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(LIEFERANTEN_TEXTE, zugang.sprache);
  const meldungen = nachSprache(LIEFERANT_FEHLER, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT, 'eingang.lesen');
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const zeile = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => leseLieferant(kontext, id))
  ) as Promise<LieferantZeile | null>);

  // Ein fremder oder unbekannter Lieferant gibt dieselbe Antwort — 404, nie 403.
  if (zeile === null) notFound();

  return (
    <PortalRahmen
      titel={zeile.name}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['eingang.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/finanzen/lieferanten`, text: t.modul } }
        : {})}
    >
      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{zeile.name}</h1>
        <StatusPill sprache={zugang.sprache}
                    zustand={zeile.archiviert ? 'Archiviert'
                      : zeile.status === 'gesperrt' ? 'Fehler' : 'Aktiv'} />
        {zeile.status === 'gesperrt' && !zeile.archiviert && (
          <span className="text-sm text-text-muted">{t.statusGesperrt}</span>
        )}
      </div>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="lieferant-fehler" className="mb-s5 max-w-prose">
          {meldungen[fehler] ?? fehler}
        </Hinweis>
      )}

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s5 sm:grid-cols-2 lg:grid-cols-4">
        <Feld kopf={t.nummer}>
          <span className="tabular-nums">{zeile.lieferantennummer}</span>
        </Feld>
        <Feld kopf={t.ort}>{zeile.ort ?? '—'}</Feld>
        <Feld kopf={t.ustId}>{zeile.ustId ?? '—'}</Feld>
        <Feld kopf={t.rechnungen}>
          <span className="tabular-nums">{String(zeile.rechnungen)}</span>
        </Feld>
      </dl>

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht}{' '}
          <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : zeile.archiviert ? (
        <Hinweis art="hinweis" cse="lieferant-archiviert" className="max-w-prose">
          {t.archivierenErklaerung}
        </Hinweis>
      ) : (
        <>
          <h2 className="mb-s4 text-h2 text-text">{t.bearbeitenTitel}</h2>
          <LieferantFormular
            zurueck={pfad} fehlerweg={pfad} vorhanden={zeile} t={t}
          />

          <h2 className="mb-s3 mt-s6 text-h2 text-text">{t.status}</h2>
          <div className="flex flex-col gap-s3">
            {/*
              * **Sperren und archivieren stehen getrennt und beide
              * zugeklappt.** Sie sehen sich ähnlich und meinen Verschiedenes:
              * die Sperre ist umkehrbar und lässt jede Buchung stehen, die
              * Archivierung nimmt den Lieferanten aus jeder Auswahlliste. Ein
              * gemeinsamer Knopf hiesse, den Unterschied der Hand zu
              * überlassen.
              */}
            <details data-cse="lieferant-sperre"
                     className="rounded-md border border-line bg-surface px-s4 py-s3">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">
                {zeile.status === 'gesperrt' ? t.entsperren : t.sperren}
              </summary>
              <p className="mb-s3 mt-s2 max-w-prose text-sm text-text-muted">
                {t.sperrenErklaerung}
              </p>
              <form method="post" action="/api/finanzen/lieferanten">
                <input type="hidden" name="aktion"
                       value={zeile.status === 'gesperrt' ? 'entsperren' : 'sperren'} />
                <input type="hidden" name="id" value={zeile.id} />
                <input type="hidden" name="zurueck" value={pfad} />
                <input type="hidden" name="fehlerweg" value={pfad} />
                <Button type="submit" variante="secondary">
                  {zeile.status === 'gesperrt' ? t.entsperren : t.sperren}
                </Button>
              </form>
            </details>

            <details data-cse="lieferant-archiv"
                     className="rounded-md border border-line bg-surface px-s4 py-s3">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">
                {t.archivieren}
              </summary>
              <p className="mb-s3 mt-s2 max-w-prose text-sm text-text-muted">
                {t.archivierenErklaerung}
              </p>
              <form method="post" action="/api/finanzen/lieferanten">
                <input type="hidden" name="aktion" value="archivieren" />
                <input type="hidden" name="id" value={zeile.id} />
                <input type="hidden" name="zurueck"
                       value={`/portal/${mandant}/finanzen/lieferanten`} />
                <input type="hidden" name="fehlerweg" value={pfad} />
                <Button type="submit" variante="danger" data-cse="lieferant-archivieren">
                  {t.archivieren}
                </Button>
              </form>
            </details>
          </div>
        </>
      )}
    </PortalRahmen>
  );
}
