import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { RAUM_NEU_TEXTE } from '@/lib/i18n/verwaltung/raumbuch-neu';
import { ladeStammauswahl } from '@/server/services/raumbuch/raum';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/objekte/[id]/raumbuch/neu` — ein einzelner Raum
 * (V-012, OPS-02, OPS-03).
 *
 * **Was es vorher gab: eine Datei.** Ein Raum entstand ausschliesslich im
 * CSV-/Excel-Import. Für den Anbau, das neue WC oder den Raum, den die Datei
 * vergessen hat, musste man eine Tabelle bauen, um eine Zeile zu ergänzen —
 * und der Import überschreibt dabei alles, was er wiederzuerkennen glaubt.
 *
 * **Der Hinweis auf den Import bleibt trotzdem stehen.** Für ein ganzes
 * Gebäude ist er der richtige Weg: er zeigt eine Vorschau, bevor er etwas
 * übernimmt. Diese Seite ist für die EINE Zeile, nicht als Ersatz.
 *
 * **Warum die Etage ein eigenes Feld mit einem eigenen Satz ist.** Sie gehört
 * zum Schlüssel (`raum_natuerlich_uk` über Objekt, Etage, Nummer). „101" im
 * Untergeschoss und „101" im ersten Obergeschoss sind zwei Räume; fielen sie
 * zusammen, verlöre einer seine m² aus der Kalkulation — und heraus käme ein
 * systematisch zu billiges Angebot mit korrekter Rechnung.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'objekt.schreiben';
const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

export default async function NeuerRaum(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/objekte/${id}/raumbuch/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(RAUM_NEU_TEXTE, zugang.sprache);
  /*
   * `objekt.lesen` wird geholt, WEIL die Seite das Raumbuch verlinkt — und das
   * öffnet mit diesem Recht (AUT-06). Ohne die Prüfung führte „Zum Raumbuch"
   * für eine Rolle mit `objekt.schreiben` und ohne `objekt.lesen` auf 404.
   */
  const darf = await haeltRechte(zugang.sitzung, RECHT, 'objekt.lesen');
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [objekt] = await kontext.abfrage<{
        bezeichnung: string; archiviert_am: Date | null;
      }>(
        `select bezeichnung, archiviert_am from objekt
          where id = $1 and mandant_id = app.aktiver_mandant()`, [id]);
      if (objekt === undefined) return null;
      return { objekt, stamm: await ladeStammauswahl(kontext) };
    })) as Promise<{
      objekt: { bezeichnung: string; archiviert_am: Date | null };
      stamm: Awaited<ReturnType<typeof ladeStammauswahl>>;
    } | null>);

  if (daten === null) notFound();
  const { objekt, stamm } = daten;

  const raumbuch = `/portal/${mandant}/objekte/${id}/raumbuch`;
  const darfRaumbuch = darf['objekt.lesen'] === true;
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong '
    + 'px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel={`${t.titel} · ${objekt.bezeichnung}`}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darfRaumbuch
        ? { zurueck: { ziel: raumbuch, text: objekt.bezeichnung } } : {})}
    >
      <div className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.titel}</h1>
        {darfRaumbuch ? (
          <Link href={`/portal/${mandant}/objekte/${id}/raumbuch`} className={knopf}>
            {t.zumRaumbuch}
          </Link>
        ) : null}
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <Hinweis art="hinweis" cse="raum-neu-warum" className="mb-s6 max-w-prose">
        {t.warum} {t.importHinweis}
      </Hinweis>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="raum-neu-fehler" className="mb-s5 max-w-prose">
          {t.fehler[fehler] ?? fehler}
        </Hinweis>
      ) : null}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht} <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : objekt.archiviert_am !== null ? (
        <Hinweis art="warnung" cse="objekt-archiviert" className="max-w-prose">
          {t.fehler['objekt_archiviert']}
        </Hinweis>
      ) : (
        <Card>
          <form method="post" action="/api/raum" data-cse="raum-neu-formular"
                className="flex max-w-[60ch] flex-col gap-s5">
            <input type="hidden" name="aktion" value="anlegen" />
            <input type="hidden" name="objektId" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-[14ch] flex-1 flex-col gap-s2 text-sm text-text">
                {t.raumnummer}
                <input type="text" name="raumnummer" maxLength={60} className={FELD}
                       data-cse="raum-nummer" />
                <span className="text-xs text-text-muted">{t.raumnummerErklaerung}</span>
              </label>
              <label className="flex min-w-[14ch] flex-1 flex-col gap-s2 text-sm text-text">
                {t.etage}
                <input type="text" name="etage" maxLength={30} className={FELD}
                       data-cse="raum-etage" />
                <span className="text-xs text-text-muted">{t.etageErklaerung}</span>
              </label>
            </div>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.bezeichnung}
              <input type="text" name="bezeichnung" maxLength={200} className={FELD}
                     data-cse="raum-bezeichnung" />
              <span className="text-xs text-text-muted">{t.bezeichnungErklaerung}</span>
            </label>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-[14ch] flex-1 flex-col gap-s2 text-sm text-text">
                {t.flaeche}
                <input type="text" inputMode="decimal" name="flaecheQm" required
                       maxLength={20} className={FELD} data-cse="raum-flaeche" />
                <span className="text-xs text-text-muted">{t.flaecheErklaerung}</span>
              </label>
              <label className="flex min-w-[14ch] flex-1 flex-col gap-s2 text-sm text-text">
                {t.fensterflaeche} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="text" inputMode="decimal" name="fensterFlaecheQm"
                       maxLength={20} className={FELD} data-cse="raum-fensterflaeche" />
                <span className="text-xs text-text-muted">{t.fensterflaecheErklaerung}</span>
              </label>
            </div>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.nutzungsart} <span className="text-text-muted">{t.freiwillig}</span>
              <input type="text" name="nutzungsart" maxLength={120} className={FELD}
                     data-cse="raum-nutzungsart" />
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.belagsart}
              <select name="belagsartId" className={FELD} defaultValue=""
                      data-cse="raum-belagsart">
                <option value="">{t.ohneBelagsart}</option>
                {stamm.belagsarten.map((b) => (
                  <option key={b.id} value={b.id}>{b.bezeichnung}</option>
                ))}
              </select>
              <span className="text-xs text-text-muted">{t.belagsartErklaerung}</span>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.reinigungsklasse} <span className="text-text-muted">{t.freiwillig}</span>
              <select name="reinigungsklasseId" className={FELD} defaultValue=""
                      data-cse="raum-klasse">
                <option value="">{t.ohneKlasse}</option>
                {stamm.klassen.map((k) => (
                  <option key={k.id} value={k.id}>{k.bezeichnung}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.sortierung} <span className="text-text-muted">{t.freiwillig}</span>
              <input type="number" name="sortierung" min={0} max={9999} defaultValue={0}
                     className={FELD} data-cse="raum-sortierung" />
              <span className="text-xs text-text-muted">{t.sortierungErklaerung}</span>
            </label>

            <div className="flex flex-wrap gap-s3">
              <Button type="submit" variante="primary" data-cse="raum-anlegen">
                {t.anlegen}
              </Button>
              {darfRaumbuch ? (
                <Link href={`/portal/${mandant}/objekte/${id}/raumbuch`} className={knopf}>
                  {t.abbrechen}
                </Link>
              ) : null}
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
