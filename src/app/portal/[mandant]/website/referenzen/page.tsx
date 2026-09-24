import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { listeReferenzen, type ReferenzPflegeZeile } from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { WEBSITE_REFERENZ_TEXTE } from '@/lib/i18n/verwaltung/website-referenz';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { WebsiteSpruenge } from '../spruenge';

/**
 * `/portal/[mandant]/website/referenzen` — welche Projekte öffentlich stehen
 * (§5.21, PRO-05).
 *
 * **Die Kundenfreigabe ist die ganze Seite.** Ein Projekt darf nur dann mit
 * dem Namen des Kunden auf die Website, wenn dieser schriftlich zugestimmt
 * hat. Die Tabelle zeigt deshalb je Zeile, ob eine Freigabe vorliegt, wann sie
 * erteilt wurde und worauf sie sich stützt — und der Veröffentlichen-Knopf
 * steht nur dort, wo sie vorliegt.
 *
 * **Warum das nicht nur die Policy erledigt.** Sie erledigt es, und das ist
 * richtig. Aber ein Knopf, der still nichts tut, ist eine schlechtere Antwort
 * als ein Satz, der sagt, was fehlt.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Referenzen' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

export default async function WebsiteReferenzen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  // V-154: eine abgewiesene Statusänderung kommt als Grund zurück, nicht als JSON.
  const rohFehler = (await searchParams)['fehler'];
  const abgewiesen = typeof rohFehler === 'string' ? rohFehler : null;
  const tor = await mandantTor(`/portal/${mandant}/website/referenzen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  /*
   * **Der Veröffentlichen-Knopf stand hier ohne Rechteprüfung**, nur gegen
   * `nurLesen` und die Kundenfreigabe. `referenz.veroeffentlichen` hält aber
   * NUR `super_admin`; ein `admin` sah den Knopf, das POST scheiterte in
   * `authorize`, und weil die Route nur `RedaktionFehler` fing, endete das in
   * einem 500. Ein Knopf, dessen Route abweist, ist ein Fehlerbericht mit
   * Verzögerung (AUT-06) — und ein 500 sagt „mein Fehler", wo „das dürfen Sie
   * nicht" die Wahrheit ist.
   */
  const darf = await haeltRechte(
    zugang.sitzung, 'referenz.schreiben', 'referenz.veroeffentlichen',
    'referenz.kundenfreigabe_erfassen');
  const t = nachSprache(WEBSITE_REFERENZ_TEXTE, zugang.sprache);

  const referenzen = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, (kontext) => listeReferenzen(kontext)),
  ) as Promise<readonly ReferenzPflegeZeile[]>);

  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const zurueck = `/portal/${mandant}/website/referenzen`;
  /*
   * **Der Weg, der fehlte (V-154).** Die Kundenfreigabe am Auftrag sagte „die
   * öffentliche Referenz legt danach ein Mensch hier an" — und hier gab es
   * keinen Knopf, auch nicht im Leerzustand. Er steht nur, wo BEIDE Rechte
   * da sind: `t_referenz_pflege` verlangt für das `insert` ebenso
   * `referenz.kundenfreigabe_erfassen` wie für jedes `update`, und ein Knopf,
   * dessen Formular abgewiesen wird, ist ein Fehlerbericht mit Verzögerung.
   */
  const darfAnlegen = !nurLesen && darf['referenz.schreiben'] === true
    && darf['referenz.kundenfreigabe_erfassen'] === true;
  const anlegenKnopf = darfAnlegen ? (
    <Link
      href={`/portal/${mandant}/website/referenzen/neu`}
      data-cse="referenz-neu"
      className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2"
    >
      {t.neueReferenz}
    </Link>
  ) : null;

  return (
    <PortalRahmen
      titel="Referenzen"
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
      <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Referenzen</h1>
        {referenzen.length > 0 && anlegenKnopf}
      </div>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Ein Projekt geht nur mit schriftlicher Zustimmung des Kunden auf die
        Website. Ohne sie bleibt es hier stehen — auch als Entwurf ist es kein
        Versehen, sondern der Normalfall.
      </p>
      {abgewiesen !== null && (
        <Hinweis art="warnung" cse="referenz-status-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{t.statusNichtGesetzt}</strong>
          {eigenerEintrag(t.statusFehler, abgewiesen) ?? t.statusFehlerSonst}
        </Hinweis>
      )}
      {!nurLesen && darf['referenz.schreiben'] === true && !darfAnlegen && (
        <p className="mb-s5 max-w-[72ch] text-sm text-text-muted" data-cse="anlegen-verlangt">
          {t.anlegenVerlangt}{' '}
          <Recht schluessel="referenz.kundenfreigabe_erfassen" sprache={zugang.sprache} />.
        </p>
      )}

      {referenzen.length === 0 ? (
        <Hinweis art="hinweis" cse="keine-referenzen">
          <strong className="block">Für diese Gesellschaft ist noch kein Projekt erfasst.</strong>
          {darfAnlegen && (
            <>
              <span className="mb-s4 mt-s2 block">{t.leerWeg}</span>
              {anlegenKnopf}
            </>
          )}
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Referenzen dieser Gesellschaft"
          zeilen={[...referenzen]}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'titel', kopf: 'Projekt',
              zelle: (z) => (
                <span data-cse="referenz" data-slug={z.slug} className="text-sm text-text">
                  {darf['referenz.schreiben'] === true ? (
                    <Link
                      href={`/portal/${mandant}/website/referenzen/${z.id}`}
                      className="text-text underline underline-offset-4 hover:text-brand"
                      data-cse="referenz-bearbeiten"
                    >
                      {z.titel}
                    </Link>
                  ) : z.titel}
                </span>
              ),
            },
            {
              schluessel: 'kunde', kopf: 'Kunde',
              zelle: (z) => z.kundeName ?? '—',
            },
            { schluessel: 'jahr', kopf: 'Jahr', numerisch: true, zelle: (z) => z.jahr ?? '—' },
            {
              schluessel: 'freigabe', kopf: 'Kundenfreigabe',
              zelle: (z) => (
                <span
                  className="inline-flex flex-wrap items-center gap-s2"
                  data-cse="kundenfreigabe"
                  data-freigegeben={z.freigegeben ? 'ja' : 'nein'}
                >
                  <StatusPill zustand={z.freigegeben ? 'Bereit' : 'Wartet'} />
                  <span className="text-xs text-text-muted">
                    {z.freigegeben
                      ? (z.freigabeAm === null
                        ? 'ohne Datum'
                        : BERLIN.format(new Date(z.freigabeAm)))
                      : 'fehlt'}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'status', kopf: 'Website',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={z.status === 'veroeffentlicht' ? 'Aktiv' : 'Entwurf'} />
                  {!nurLesen && darf['referenz.veroeffentlichen'] === true && (
                    <form method="post" action="/api/website/referenzen">
                      <input type="hidden" name="id" value={z.id} />
                      <input type="hidden" name="zurueck" value={zurueck} />
                      <input
                        type="hidden" name="veroeffentlicht"
                        value={z.status === 'veroeffentlicht' ? '0' : '1'}
                      />
                      {/*
                        * Kein Knopf ohne Freigabe: die Datenbank wiese ihn
                        * ohnehin ab, und ein Knopf, der still nichts tut, ist
                        * schlechter als keiner (AUT-06 im Kleinen).
                        */}
                      {z.status === 'veroeffentlicht' ? (
                        <Button type="submit" variante="ghost">Zurückziehen</Button>
                      ) : z.freigegeben ? (
                        <Button type="submit" variante="secondary">Veröffentlichen</Button>
                      ) : (
                        <span className="text-xs text-text-subtle">
                          erst mit Kundenfreigabe
                        </span>
                      )}
                    </form>
                  )}
                  {/*
                    * Der Verweis auf die ausführliche Fassung steht nur, wo
                    * das Recht sie öffnet: `/…/veroeffentlichen` ist im
                    * Manifest mit `referenz.veroeffentlichen` bewacht, und ein
                    * Verweis auf einen 404 verrät, dass es dort etwas gibt
                    * (AUT-06).
                    */}
                  {darf['referenz.veroeffentlichen'] === true && (
                    <Link
                      href={`/portal/${mandant}/website/referenzen/${z.id}/veroeffentlichen`}
                      className="text-xs text-text-muted underline underline-offset-2 hover:text-brand"
                      data-cse="zur-veroeffentlichung"
                    >
                      Ausführlich
                    </Link>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
