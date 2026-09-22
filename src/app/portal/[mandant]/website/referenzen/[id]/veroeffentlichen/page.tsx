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
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Referenz veröffentlichen' };

const BERLIN_TAG = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

export default async function ReferenzVeroeffentlichen(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const referenzId = kennungOder404(id);
  const pfad = `/portal/${mandant}/website/referenzen/${referenzId}/veroeffentlichen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(
    zugang.sitzung, 'referenz.veroeffentlichen', 'referenz.kundenfreigabe_erfassen',
    'referenz.schreiben');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const darfSchalten = darf['referenz.veroeffentlichen'] === true && !nurLesen;

  const r = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeReferenzZurPflege(kontext, referenzId))
  ) as Promise<ReferenzDetail | null>);

  // 404 und nicht 403 (AUT-06).
  if (r === null) notFound();

  const oeffentlich = `/unternehmen/${mandant}/projekte/${r.slug}`;
  const draussen = r.status === 'veroeffentlicht';

  return (
    <PortalRahmen
      titel="Veröffentlichen"
      wurzelTitel="Website"
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
      <p className="mb-s3 text-sm">
        <Link href={`/portal/${mandant}/website/referenzen/${referenzId}`}
              className="text-text-muted underline-offset-2 hover:underline">
          ← {r.titel}
        </Link>
      </p>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 min-w-0 text-h1 text-text">
          {draussen ? 'Zurückziehen' : 'Veröffentlichen'}
        </h1>
        <StatusPill zustand={draussen ? 'Aktiv' : 'Entwurf'} />
      </div>

      {/* ── Was öffentlich würde ────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">
          {draussen ? 'Was öffentlich steht' : 'Was öffentlich würde'}
        </h2>
        <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-2" data-cse="vorschau">
          <div className="sm:col-span-2">
            <dt className="text-xs text-text-muted">Adresse</dt>
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
            <dt className="text-xs text-text-muted">Projekt</dt>
            <dd className="m-0 text-sm text-text">{r.titel}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Kunde</dt>
            <dd className="m-0 text-sm text-text" data-cse="kunde">
              {r.kundeName ?? '— (kein Name genannt)'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Jahr</dt>
            <dd className="m-0 text-sm text-text">
              {r.jahr === null ? '—' : String(r.jahr)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Bild</dt>
            <dd className="m-0 text-sm text-text-muted" data-cse="bild">
              {r.medienAlt ?? 'kein Bild'}
              {r.medienPlatzhalter === true ? ' — Platzhalter (O-13)' : ''}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-text-muted">Beschreibung</dt>
            <dd className="m-0 whitespace-pre-line text-sm text-text-muted">
              {r.beschreibung ?? '—'}
            </dd>
          </div>
        </dl>
        {r.medienPlatzhalter === true && (
          <Hinweis art="warnung" cse="platzhalterbild" className="mt-s4 max-w-prose">
            Das gewählte Bild ist als <strong>Platzhalter</strong> markiert. Ein
            Platzhalterbild unter einer Kundenreferenz ist eine Aussage über ein Projekt,
            das so nicht aussah — echtes Bildmaterial mit Freigaben fehlt noch (O-13).
          </Hinweis>
        )}
      </Card>

      {/* ── Kundenfreigabe ──────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">Kundenfreigabe</h2>
        <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-muted">Stand</dt>
            <dd className="m-0" data-cse="kundenfreigabe"
                data-freigegeben={r.freigegeben ? 'ja' : 'nein'}>
              <StatusPill zustand={r.freigegeben ? 'Bereit' : 'Wartet'} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Erteilt am</dt>
            <dd className="m-0 text-sm text-text">
              {r.freigabeAm === null ? '—' : BERLIN_TAG.format(new Date(r.freigabeAm))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Beleg</dt>
            <dd className="m-0 text-sm text-text-muted">{r.freigabeBeleg ?? '—'}</dd>
          </div>
        </dl>
      </Card>

      {/* ── Die Entscheidung ────────────────────────────────────────────── */}
      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">Entscheidung</h2>

        {!darfSchalten ? (
          <p className="m-0 max-w-prose text-sm text-text-muted" data-cse="kein-schaltrecht">
            {nurLesen
              ? 'Die Gruppenansicht ist lesend (Invariante 10). Veröffentlicht wird in '
                + 'genau einer Gesellschaft.'
              : 'Auf die Website stellen darf, wer referenz.veroeffentlichen hält — '
                + 'heute nur die Super-Administration. Hier steht deshalb kein Knopf: '
                + 'einer, der abgewiesen wird, ist schlechter als keiner.'}
          </p>
        ) : draussen ? (
          <>
            <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
              Zurückgezogen antwortet{' '}
              <code className="font-mono">{oeffentlich}</code> mit <strong>404</strong>.
              Eingehende Verweise brechen, und was eine Suchmaschine schon gelesen hat,
              bleibt eine Weile in ihrem Cache — zurückholen kann diese Plattform das
              nicht.
            </p>
            <form method="post" action="/api/website/referenzen">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="veroeffentlicht" value="0" />
              <input type="hidden" name="zurueck" value={pfad} />
              <Button type="submit" variante="secondary" data-cse="referenz-zurueckziehen">
                Zurückziehen
              </Button>
            </form>
          </>
        ) : r.freigegeben ? (
          <>
            <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
              Die Kundenfreigabe liegt vor. Veröffentlicht steht dieses Projekt mit
              Namen, Kunden und Jahr unter{' '}
              <code className="font-mono">{oeffentlich}</code> und in der Projektliste
              der Gesellschaft.
            </p>
            <form method="post" action="/api/website/referenzen">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="veroeffentlicht" value="1" />
              <input type="hidden" name="zurueck" value={pfad} />
              <Button type="submit" variante="primary" data-cse="referenz-veroeffentlichen">
                Veröffentlichen
              </Button>
            </form>
          </>
        ) : (
          <Hinweis art="warnung" cse="ohne-kundenfreigabe" className="max-w-prose">
            <strong className="block">
              Ohne Kundenfreigabe geht diese Referenz nicht hinaus.
            </strong>
            Es fehlt {r.freigabeAm === null ? 'die Zustimmung mit Datum und Beleg' : 'das Häkchen'}.
            Eingetragen wird sie im Block „Kundenfreigabe" auf der{' '}
            {darf['referenz.schreiben'] === true ? (
              <Link href={`/portal/${mandant}/website/referenzen/${referenzId}`}
                    className="underline underline-offset-4"
                    data-cse="zur-freigabe-erfassung">
                Bearbeitungsseite
              </Link>
            ) : 'Bearbeitungsseite'}
            {' '}— und dort verlangt sie{' '}
            <Recht schluessel="referenz.kundenfreigabe_erfassen" />. Hier
            steht deshalb kein Knopf: die Policy wiese ihn ab, und ein Knopf, der still
            nichts tut, lässt den Menschen den Fehler bei sich suchen.
          </Hinweis>
        )}
      </Card>
    </PortalRahmen>
  );
}
