import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { RECHNUNGS_EINSTELLUNG_TEXTE } from '@/lib/i18n/verwaltung/einstellungen/rechnungen';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  LEISTUNGSORT_ARTEN, leseLeistungsortRegel, type LeistungsortStand,
} from '@/server/services/finanz/leistungsort-regel';

/**
 * `/portal/[mandant]/einstellungen/rechnungen` — die Regeln, nach denen die
 * Rechnungen dieser Gesellschaft entstehen (V-373, O-933, D-836).
 *
 * Heute eine Regel: ob der Leistungsort (das Objekt) einem anderen Kunden
 * gehören darf als dem Rechnungsempfänger. Sie war bis V-373 eine Zeile im
 * Code (`OBJEKT_KUNDE_REGEL`); jetzt wählt sie jede Gesellschaft selbst, und
 * `legeEntwurfAn` und `aendereEntwurf` lesen sie (`leistungsort-regel.ts`).
 *
 * Die Seite sagt, was gilt — auch, wenn nichts gesetzt ist: dann die
 * Voreinstellung, und das steht so da. Lesen darf sie, wer die Einstellungen
 * lesen darf; ändern, wer `system.einstellung_verwalten` hält.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'system.einstellung_verwalten';

export const metadata = { title: 'Rechnungen — Einstellungen' };

export default async function Rechnungsregeln(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/einstellungen/rechnungen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(RECHNUNGS_EINSTELLUNG_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT);
  const suche = await searchParams;
  const ergebnis = typeof suche['leistungsort'] === 'string' ? suche['leistungsort'] : null;

  const stand = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => leseLeistungsortRegel(kontext))
  ) as Promise<LeistungsortStand>);

  const texte = { frei: t.frei, gleich: t.gleich };
  const erklaerung = { frei: t.freiErklaerung, gleich: t.gleichErklaerung };

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={darf[RECHT] !== true}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <section aria-labelledby="leistungsort-titel" id="leistungsort"
               className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
               data-cse="leistungsort-regel">
        <h2 id="leistungsort-titel" className="mb-s3 mt-0 text-h3 text-text">
          {t.leistungsortTitel}
        </h2>
        <p className="mb-s4 text-sm text-text-muted">{t.leistungsortErklaerung}</p>

        {ergebnis === null ? null : ergebnis === 'gesetzt' || ergebnis === 'unveraendert' ? (
          <Hinweis art="erfolg" rolle="status" cse="leistungsort-ergebnis" className="mb-s4">
            {ergebnis === 'gesetzt' ? t.gesetzt : t.unveraendert}
          </Hinweis>
        ) : (
          <Hinweis art="warnung" rolle="alert" cse="leistungsort-fehler" className="mb-s4">
            {eigenerEintrag(t.fehler, ergebnis) ?? t.fehlerSonst}
          </Hinweis>
        )}

        <p className="mb-s4 text-sm text-text" data-cse="leistungsort-gilt"
           data-art={stand.regel.art} data-gesetzt={stand.gesetzt ? 'ja' : 'nein'}>
          <strong>{t.gilt}</strong> {texte[stand.regel.art]}
          {stand.gesetzt ? null : (
            <span className="block text-xs text-text-muted">{t.nichtGesetzt}</span>
          )}
        </p>

        {darf[RECHT] === true ? (
          <form method="post" action="/api/einstellungen/rechnungen"
                className="flex flex-col gap-s4" data-cse="leistungsort-formular">
            <fieldset className="flex flex-col gap-s2 border-0 p-0">
              <legend className="mb-s2 text-sm font-semibold text-text">
                {t.leistungsortTitel}
              </legend>
              {LEISTUNGSORT_ARTEN.map((art) => (
                <label key={art} className="flex min-h-11 items-start gap-s2 text-sm text-text">
                  <input type="radio" name="art" value={art} required
                         defaultChecked={stand.regel.art === art}
                         className="mt-s1" data-cse={`leistungsort-${art}`} />
                  <span>
                    {texte[art]}
                    <span className="block text-xs text-text-muted">{erklaerung[art]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div>
              <Button type="submit" variante="primary" data-cse="leistungsort-speichern">
                {t.speichern}
              </Button>
            </div>
          </form>
        ) : (
          <p className="m-0 text-sm text-text-muted" data-cse="leistungsort-ohne-recht">
            {t.keinSchreibrechtVor}{' '}<Recht schluessel={RECHT} sprache={zugang.sprache} />{' '}{t.keinSchreibrechtNach}
          </p>
        )}

        <p className="m-0 mt-s4 text-xs text-text-muted" data-cse="leistungsort-voreinstellung">
          {t.voreinstellung}
        </p>
      </section>
    </PortalRahmen>
  );
}
