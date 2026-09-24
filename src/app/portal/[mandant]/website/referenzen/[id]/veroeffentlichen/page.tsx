import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { ladeReferenzZurPflege, type ReferenzDetail } from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { WebsiteSpruenge } from '../../../spruenge';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { WEBSITE_REFERENZ_TEXTE } from '@/lib/i18n/verwaltung/website-referenz';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/website/referenzen/[id]/veroeffentlichen` — die
 * Entscheidungsseite für genau eine Referenz (PRO-05, PUB-07).
 *
 * **Sie ist die ausführliche Fassung des Knopfes in der Liste, nicht eine
 * zweite.** Beide zeigen auf dieselbe Route `POST /api/website/referenzen` mit
 * derselben Prüfung: `setzeReferenzStatus` fragt die Kundenfreigabe ab und
 * nennt den Grund, `t_referenz_pflege` verlangt
 * `referenz.kundenfreigabe_erfassen`, und `authorize` verlangt
 * `referenz.veroeffentlichen`. Ein zweiter Weg mit eigener Prüfung wäre der
 * eine, der beim nächsten Umbau vergessen wird.
 *
 * **Zwei Rechte, und zusammen machen sie diese Seite zu einer
 * Ein-Rollen-Seite.** `referenz.veroeffentlichen` hält NUR `super_admin`,
 * `referenz.kundenfreigabe_erfassen` zusätzlich `admin` und `leitung`. Die
 * Route (und damit die Seite) ist im Manifest auf das erste gestellt; der Knopf
 * steht zusätzlich nur, wenn `haeltRechte` es bestätigt — denn ein Knopf, der
 * in `authorize` abgewiesen wird, war bis heute ein **500** und kein Satz.
 *
 * **Ohne Kundenfreigabe steht hier kein Knopf, sondern ein Satz.** Ein Knopf,
 * der still nichts tut, ist schlechter als keiner: die Policy weist ihn ab,
 * und der Mensch sucht den Fehler bei sich.
 *
 * **Die ganze Seite spricht die Sprache der Sitzung** (V-161) — vorher stand
 * der englische Satz einer Abweisung über deutschen Blöcken.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Referenz veröffentlichen' };

const BERLIN_TAG = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

export default async function ReferenzVeroeffentlichen(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  // V-154: eine abgewiesene Statusänderung kommt als Grund zurück, nicht als JSON.
  const rohFehler = (await searchParams)['fehler'];
  const abgewiesen = typeof rohFehler === 'string' ? rohFehler : null;
  const referenzId = kennungOder404(id);
  const pfad = `/portal/${mandant}/website/referenzen/${referenzId}/veroeffentlichen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const sprache = zugang.sprache;

  const darf = await haeltRechte(
    zugang.sitzung, 'referenz.veroeffentlichen', 'referenz.kundenfreigabe_erfassen',
    'referenz.schreiben');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const darfSchalten = darf['referenz.veroeffentlichen'] === true && !nurLesen;
  const t = nachSprache(WEBSITE_REFERENZ_TEXTE, sprache);

  const r = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeReferenzZurPflege(kontext, referenzId))
  ) as Promise<ReferenzDetail | null>);

  // 404 und nicht 403 (AUT-06).
  if (r === null) notFound();

  const oeffentlich = `/unternehmen/${mandant}/projekte/${r.slug}`;
  const draussen = r.status === 'veroeffentlicht';
  const titel = draussen ? t.vTitelZurueckziehen : t.vTitelVeroeffentlichen;

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/website/referenzen/${referenzId}`, text: r.titel }}
      titel={titel}
      wurzelTitel={t.wurzelTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="referenzen"
                       sitzung={zugang.sitzung} />

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 min-w-0 text-h1 text-text">{titel}</h1>
        <StatusPill zustand={draussen ? 'Aktiv' : 'Entwurf'} sprache={sprache} />
      </div>

      {abgewiesen !== null && (
        <Hinweis art="warnung" cse="referenz-status-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{t.statusNichtGesetzt}</strong>
          {eigenerEintrag(t.statusFehler, abgewiesen) ?? t.statusFehlerSonst}
        </Hinweis>
      )}

      {/* ── Was öffentlich würde ────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">
          {draussen ? t.vWasSteht : t.vWasWuerde}
        </h2>
        <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-2" data-cse="vorschau">
          <div className="sm:col-span-2">
            <dt className="text-xs text-text-muted">{t.vAdresse}</dt>
            <dd className="m-0">
              {draussen && r.freigegeben ? (
                <a href={oeffentlich}
                   className="font-mono text-sm text-text underline underline-offset-4 hover:text-brand">
                  {oeffentlich}
                </a>
              ) : (
                <span className="font-mono text-sm text-text-muted">{oeffentlich}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">{t.spalteProjekt}</dt>
            <dd className="m-0 text-sm text-text">{r.titel}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">{t.spalteKunde}</dt>
            <dd className="m-0 text-sm text-text" data-cse="kunde">
              {r.kundeName ?? t.vKeinName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">{t.spalteJahr}</dt>
            <dd className="m-0 text-sm text-text">
              {r.jahr === null ? '—' : String(r.jahr)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">{t.feldBild}</dt>
            <dd className="m-0 text-sm text-text-muted" data-cse="bild">
              {r.medienAlt ?? t.keinBild}
              {r.medienPlatzhalter === true ? t.vPlatzhalterBild : ''}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-text-muted">{t.feldBeschreibung}</dt>
            <dd className="m-0 whitespace-pre-line text-sm text-text-muted">
              {r.beschreibung ?? '—'}
            </dd>
          </div>
        </dl>
        {r.medienPlatzhalter === true && (
          <Hinweis art="warnung" cse="platzhalterbild" className="mt-s4 max-w-prose">
            {t.vPlatzhalterWarnung}
          </Hinweis>
        )}
      </Card>

      {/* ── Kundenfreigabe ──────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.freigabeTitel}</h2>
        <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-muted">{t.freigabeStand}</dt>
            <dd className="m-0" data-cse="kundenfreigabe"
                data-freigegeben={r.freigegeben ? 'ja' : 'nein'}>
              <StatusPill zustand={r.freigegeben ? 'Bereit' : 'Wartet'} sprache={sprache} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">{t.erteiltAm}</dt>
            <dd className="m-0 text-sm text-text">
              {r.freigabeAm === null ? '—' : BERLIN_TAG.format(new Date(r.freigabeAm))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">{t.beleg}</dt>
            <dd className="m-0 text-sm text-text-muted">{r.freigabeBeleg ?? '—'}</dd>
          </div>
        </dl>
      </Card>

      {/* ── Die Entscheidung ────────────────────────────────────────────── */}
      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.vEntscheidung}</h2>

        {!darfSchalten ? (
          <p className="m-0 max-w-prose text-sm text-text-muted" data-cse="kein-schaltrecht">
            {nurLesen ? t.vGruppeLesend : (
              <>
                {t.nurSuperAdminVor}{' '}
                <Recht schluessel="referenz.veroeffentlichen" sprache={sprache} />{' '}
                {t.vKeinSchaltrechtNach}
              </>
            )}
          </p>
        ) : draussen ? (
          <>
            <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
              {t.vZurueckziehenVor}{' '}
              <code className="font-mono">{oeffentlich}</code>{' '}
              {t.vZurueckziehenNach}
            </p>
            <form method="post" action="/api/website/referenzen">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="veroeffentlicht" value="0" />
              <input type="hidden" name="zurueck" value={pfad} />
              <Button type="submit" variante="secondary" data-cse="referenz-zurueckziehen">
                {t.vTitelZurueckziehen}
              </Button>
            </form>
          </>
        ) : r.freigegeben ? (
          <>
            <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
              {t.vVeroeffentlichenVor}{' '}
              <code className="font-mono">{oeffentlich}</code>{' '}
              {t.vVeroeffentlichenNach}
            </p>
            <form method="post" action="/api/website/referenzen">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="veroeffentlicht" value="1" />
              <input type="hidden" name="zurueck" value={pfad} />
              <Button type="submit" variante="primary" data-cse="referenz-veroeffentlichen">
                {t.vTitelVeroeffentlichen}
              </Button>
            </form>
          </>
        ) : (
          <Hinweis art="warnung" cse="ohne-kundenfreigabe" className="max-w-prose">
            <strong className="block">{t.vOhneFreigabeTitel}</strong>
            {r.freigabeAm === null ? t.vFehltZustimmung : t.vFehltHaken}{' '}
            {t.vEingetragenVor}{' '}
            {darf['referenz.schreiben'] === true ? (
              <Link href={`/portal/${mandant}/website/referenzen/${referenzId}`}
                    className="underline underline-offset-4"
                    data-cse="zur-freigabe-erfassung">
                {t.vBearbeitungsseite}
              </Link>
            ) : t.vBearbeitungsseite}
            {' '}{t.vEingetragenNach}{' '}
            <Recht schluessel="referenz.kundenfreigabe_erfassen" sprache={sprache} />
            {t.vKeinKnopf}
          </Hinweis>
        )}
      </Card>
    </PortalRahmen>
  );
}
