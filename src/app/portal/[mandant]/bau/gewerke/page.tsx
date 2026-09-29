import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { GewerkFormular } from '../GewerkFormular';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { GEWERK_TEXTE } from '@/lib/i18n/verwaltung/gewerke';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  leseGewerkeKatalog, type GewerkKatalogZeile,
} from '@/server/services/bau/gewerk';

/**
 * `/portal/[mandant]/bau/gewerke` — der Gewerkekatalog des Bautagebuchs
 * (BAU-07 „Mannstunden per trade", V-182, D-676).
 *
 * **Warum diese Seite fehlte und was daran teuer war.** Jede Mannstundenzeile
 * verlangt ein Gewerk, der Katalog wird leer ausgeliefert (O-159), und nur der
 * Seed füllte ihn. Das Bautagebuch sagte in jedem echten Bau-Mandanten
 * „keine Gewerke hinterlegt" — und bot keinen Weg, das zu ändern.
 *
 * **Was hier entschieden wird und was nicht.** WELCHE Gewerke geführt werden,
 * entscheidet die Gesellschaft (O-159); die Seite sagt das als Satz und
 * schlägt keines vor. Ein Eintrag ohne das Häkchen „bestätigt" trägt im
 * Bautagebuch „unbestätigt" (`ist_platzhalter`, §1.16).
 *
 * **Umbenennen ja, den Code ändern nein; gelöscht wird nie** — archiviert.
 * Die Zahl der gebuchten Mannstundenzeilen steht an jeder Zeile: sie ist die
 * Folge eines Archivierens, und wer archiviert, soll sie vorher sehen.
 */
export const dynamic = 'force-dynamic';

export default async function Gewerke(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/bau/gewerke`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(GEWERK_TEXTE, zugang.sprache);
  const darf = await haeltRechte(zugang.sitzung, 'bau.schreiben');
  const schreiben = darf['bau.schreiben'] === true;

  const suche = await searchParams;
  /* D-599/D-728: Grund und Ergebnis nur als EIGENER Eintrag der Tabelle. */
  const fehler = typeof suche['fehler'] === 'string'
    ? (eigenerEintrag(t.fehler, suche['fehler']) ?? t.fehlerUnbekannt) : null;
  const erfolg = typeof suche['gewerk'] === 'string'
    ? eigenerEintrag(t.erfolg, suche['gewerk']) ?? null : null;

  const katalog = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => leseGewerkeKatalog(kontext))) as Promise<
      readonly GewerkKatalogZeile[]>);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.einleitung}</p>

      {fehler !== null && (
        <Hinweis art="warnung" cse="gewerk-abgewiesen" rolle="alert" className="mb-s5 max-w-prose">
          <strong>{t.abgewiesen}</strong>{' '}
          {fehler}
        </Hinweis>
      )}
      {erfolg !== null && (
        <Hinweis art="erfolg" cse="gewerk-gespeichert" rolle="status" className="mb-s5 max-w-prose">
          {erfolg}
        </Hinweis>
      )}

      <Hinweis art="warnung" cse="gewerk-offen" className="mb-s6 max-w-prose">
        {t.offen}
      </Hinweis>

      <section data-cse="gewerk-katalog" className="mb-s7">
        {katalog.length === 0 ? (
          <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.leer}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-s3 p-0">
            {katalog.map((g) => (
              <li key={g.id} data-cse="gewerk" data-code={g.code}
                  data-archiviert={g.archiviert ? 'ja' : 'nein'}
                  className="rounded-lg border border-line bg-surface p-s4">
                <p className="m-0 text-base text-text">
                  <span className="tabular-nums text-text-muted">{g.code}</span>
                  {' · '}
                  <span className={g.archiviert ? 'line-through' : undefined}>{g.bezeichnung}</span>
                  {g.istPlatzhalter && !g.archiviert && (
                    <span className="ml-s2 text-sm text-warning">({t.unbestaetigt})</span>
                  )}
                  {g.archiviert && (
                    <span className="ml-s2 text-sm text-text-muted">({t.archiviert})</span>
                  )}
                </p>
                <p className="m-0 mt-s1 text-sm text-text-muted">
                  {g.leistungsbereich !== null && (
                    <>
                      {t.leistungsbereich}
                      {' '}
                      <span className="tabular-nums">{g.leistungsbereich}</span>
                      {' · '}
                    </>
                  )}
                  {t.buchungen(g.buchungen)}
                  {(['en', 'ar', 'tr'] as const).map((s) => (g.uebersetzungen[s] === undefined ? null : (
                    <span key={s}>
                      {' · '}
                      {t.sprache[s]}
                      {': '}
                      <span lang={s} dir={s === 'ar' ? 'rtl' : undefined}>{g.uebersetzungen[s]}</span>
                    </span>
                  )))}
                </p>

                {schreiben && !g.archiviert && (
                  <details className="mt-s3">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-text-muted
                                        hover:text-text">
                      {t.aendern}
                    </summary>
                    <GewerkFormular t={t} pfad={pfad} zeile={g} />
                    <form method="post" action="/api/bau/gewerke" className="mt-s3">
                      <input type="hidden" name="aktion" value="archivieren" />
                      <input type="hidden" name="id" value={g.id} />
                      <input type="hidden" name="zurueck" value={pfad} />
                      <p className="m-0 mb-s2 max-w-prose text-sm text-text-muted">
                        {t.archivierenHinweis}
                      </p>
                      <Button type="submit" variante="secondary" data-cse="gewerk-archivieren">
                        {t.archivieren}
                      </Button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-cse="gewerk-neu">
        <h2 className="mb-s3 text-h3 text-text">{t.neuTitel}</h2>
        {schreiben ? (
          <GewerkFormular t={t} pfad={pfad} zeile={null} />
        ) : (
          <p className="m-0 max-w-prose text-sm text-text-muted" data-cse="gewerk-kein-recht">
            {t.keinSchreibrecht}
          </p>
        )}
      </section>
    </PortalRahmen>
  );
}
