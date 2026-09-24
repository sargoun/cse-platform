import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { MODELLE_TEXTE } from '@/lib/i18n/verwaltung/einstellungen/modelle';
import {
  FAEHIGKEITEN, modelle, type ModellZeile,
} from '@/server/services/system/modellregister';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/einstellungen/modelle` — das Modellregister (V-120,
 * D-04, 07-INTEGRATIONEN §3.6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund kam beim Einrichten, von einem Menschen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `docs/EINRICHTEN-*.md` §9 beschrieb den letzten Schritt der KI-Anbindung
 * als handgeschriebene Zeile `insert into modell_register …`. Genau dort
 * blieb der Betreiber stehen und fragte, was diese Zeile überhaupt sei. Er
 * hatte recht: `0154` gab `cse_app` auf der Tabelle nur `select`, und damit
 * war ein Datenbankwerkzeug der einzige Weg, ein Modell freizugeben.
 *
 * **Die Zeile ist eine Rechtsaussage, kein Schalter.** Sie sagt, dass ein
 * Mensch hingesehen und bezeugt hat, dass ein fremder Dienstleister
 * Vertragstext verarbeiten darf. Ein Formular dafür ist deshalb nicht
 * Bequemlichkeit, sondern die Form, in der so etwas überhaupt entstehen
 * sollte: mit Pflichtfeldern, mit Nachweis — und mit einem Zeugen, den die
 * Datenbank setzt statt ihn abzufragen (`trg_modell_register_zeuge`, 0381).
 */
export const dynamic = 'force-dynamic';

const RECHT = 'system.einstellung_verwalten';
const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export const metadata = { title: 'Sprachmodelle' };

export default async function Modelle(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/einstellungen/modelle`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(MODELLE_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => modelle(kontext))
  ) as Promise<readonly ModellZeile[]>);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <Hinweis art="hinweis" cse="modelle-warum" className="mb-s6 max-w-prose">
        {t.warum}
      </Hinweis>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="modelle-fehler" className="mb-s5 max-w-prose">
          {eigenerEintrag(t.fehler, fehler) ?? fehler}
        </Hinweis>
      )}

      {zeilen.length === 0 ? (
        <Hinweis art="warnung" cse="keine-modelle" className="mb-s6 max-w-prose">
          <strong className="block">{t.keine}</strong>
          {t.keineErklaerung}
        </Hinweis>
      ) : (
        <ul className="m-0 mb-s6 list-none p-0" data-cse="modell-liste">
          {zeilen.map((m) => (
            <li key={m.id} data-cse="modell" data-modell={m.id}
                className="mb-s3 rounded-lg border border-line bg-surface p-s4">
              <div className="mb-s2 flex flex-wrap items-center gap-s3">
                <strong className="text-text">{m.modell}</strong>
                <span className="text-sm text-text-muted">{m.anbieter}</span>
                <span className="text-sm text-text-muted">{m.faehigkeit}</span>
                <StatusPill sprache={zugang.sprache}
                            zustand={m.aufrufbar ? 'Aktiv' : 'Inaktiv'} />
                <span className="text-sm text-text-muted">
                  {m.aufrufbar ? t.aufrufbar : t.nichtAufrufbar}
                </span>
              </div>

              {/*
                * **Die drei Bestätigungen einzeln, nicht als Summe.** Ein
                * „nicht aufrufbar“ allein sagt nicht, WELCHE fehlt — und
                * genau das ist die Frage, die der Betreiber als nächstes
                * hat.
                */}
              <p className="m-0 mb-s2 flex flex-wrap gap-s3 text-xs">
                <span className={m.euVerarbeitung ? 'text-success' : 'text-warning'}>
                  {m.euVerarbeitung ? '✓' : '✗'} {t.euVerarbeitung}
                </span>
                <span className={m.zeroRetention ? 'text-success' : 'text-warning'}>
                  {m.zeroRetention ? '✓' : '✗'} {t.zeroRetention}
                </span>
                <span className={m.freigegeben ? 'text-success' : 'text-warning'}>
                  {m.freigegeben ? '✓' : '✗'} {t.freigegeben}
                </span>
              </p>

              {m.geprueftVon === null ? null : (
                <p className="m-0 text-xs text-text-subtle">
                  {t.geprueftVon} {m.geprueftVon}
                  {m.geprueftAm === null ? '' : ` ${t.geprueftAm} ${m.geprueftAm}`}
                </p>
              )}
              {m.bemerkung === null ? null : (
                <p className="m-0 mt-s1 text-xs text-text-muted">{m.bemerkung}</p>
              )}

              {darf[RECHT] === true && (
                <form method="post" action="/api/system/modelle" className="mt-s3">
                  <input type="hidden" name="aktion"
                         value={m.freigegeben ? 'sperren' : 'freigeben'} />
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="zurueck" value={pfad} />
                  <input type="hidden" name="fehlerweg" value={pfad} />
                  <Button type="submit" variante="secondary" data-cse="modell-schalten">
                    {m.freigegeben ? t.sperren : t.freigeben}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht} <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : (
        <Card>
          <h2 className="mb-s4 mt-0 text-h3 text-text">{t.anlegen}</h2>
          <form method="post" action="/api/system/modelle"
                data-cse="modell-formular"
                className="flex max-w-[56ch] flex-col gap-s4">
            <input type="hidden" name="aktion" value="anlegen" />
            <input type="hidden" name="zurueck" value={pfad} />
            <input type="hidden" name="fehlerweg" value={pfad} />

            <div className="flex flex-wrap gap-s4">
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                {t.anbieter}
                <input type="text" name="anbieter" required maxLength={60}
                       className={FELD} placeholder={t.anbieterBeispiel}
                       defaultValue="openai" data-cse="modell-anbieter" />
              </label>
              <label className="flex flex-[2] flex-col gap-s2 text-sm text-text">
                {t.modell}
                <input type="text" name="modell" required maxLength={120}
                       className={FELD} placeholder={t.modellBeispiel}
                       data-cse="modell-kennung" />
              </label>
            </div>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.faehigkeit}
              <select name="faehigkeit" required className={FELD} defaultValue=""
                      data-cse="modell-faehigkeit">
                <option value="" disabled>{t.faehigkeit}</option>
                {FAEHIGKEITEN.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <span className="text-xs text-text-muted">{t.faehigkeitErklaerung}</span>
            </label>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-s2 text-sm font-semibold text-text">{t.flaggen}</legend>
              <div className="flex flex-col gap-s3">
                <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
                  <input type="checkbox" name="eu_verarbeitung" value="ja"
                         className="mt-s2 h-4 w-4 accent-[var(--farbe-brand)]"
                         data-cse="modell-eu" />
                  <span>
                    {t.euVerarbeitung}
                    <span className="block text-xs text-text-muted">
                      {t.euVerarbeitungErklaerung}
                    </span>
                  </span>
                </label>
                <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
                  <input type="checkbox" name="zero_retention" value="ja"
                         className="mt-s2 h-4 w-4 accent-[var(--farbe-brand)]"
                         data-cse="modell-retention" />
                  <span>
                    {t.zeroRetention}
                    <span className="block text-xs text-text-muted">
                      {t.zeroRetentionErklaerung}
                    </span>
                  </span>
                </label>
                <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
                  <input type="checkbox" name="freigegeben" value="ja"
                         className="mt-s2 h-4 w-4 accent-[var(--farbe-brand)]"
                         data-cse="modell-freigabe" />
                  <span>
                    {t.freigegeben}
                    <span className="block text-xs text-text-muted">
                      {t.freigegebenErklaerung}
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.nachweis}
              <input type="url" name="nachweis_url" maxLength={500} className={FELD}
                     placeholder={t.nachweisBeispiel} data-cse="modell-nachweis" />
              <span className="text-xs text-text-muted">{t.nachweisErklaerung}</span>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.bemerkung} <span className="text-text-muted">{t.freiwillig}</span>
              <textarea name="bemerkung" rows={3} maxLength={1000} className={FELD}
                        placeholder={t.bemerkungBeispiel} data-cse="modell-bemerkung" />
            </label>

            <div>
              <Button type="submit" variante="primary" data-cse="modell-speichern">
                {t.anlegen}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
