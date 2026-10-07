import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { FormField } from '@/components/ui/FormField';
import { Hinweis, type HinweisArt } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { zeitpunktInSprache } from '@/lib/datum/zeitpunkt';
import type { PortalSprache } from '@/lib/i18n/texte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { ZEICHNUNG_TEXTE, type ZeichnungTexte } from '@/lib/i18n/verwaltung/verfahrensdokumentation-zeichnung';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  BEMERKUNG_HOECHSTENS, FUNKTION_HOECHSTENS, FUNKTION_MINDESTENS,
  type Zeichnung, type ZeichnungsStand,
} from '@/server/services/buchhaltung/verfahrensdokumentation-zeichnung';

/**
 * Der Abschnitt „Prüfung und Zeichnung" der Verfahrensdokumentation (V-316,
 * O-188, D-837) — zweisprachig, anders als die Seite um ihn herum.
 *
 * Er sagt zuerst, ob die letzte Zeichnung noch gilt (`zeichnungsStand`),
 * dann, wer bisher gezeichnet hat, und gibt dem, der zeichnen darf, das
 * Formular. Hash und Schemastand stehen NICHT im Formular: die Route erzeugt
 * die Dokumentation beim Zeichnen neu und zeichnet, was dann entsteht.
 */
export const ZEICHNUNG_RECHT = 'buchhaltung_konfiguration.verwalten';

/** Fällig ist eine Prüfung ohne Zeichnung, nach neuem Schemastand und nach dem Turnus. */
function hinweisArt(art: ZeichnungsStand['art']): HinweisArt {
  if (art === 'aktuell') return 'erfolg';
  return art === 'inhalt_geaendert' ? 'hinweis' : 'warnung';
}

function standSatz(stand: ZeichnungsStand, t: ZeichnungTexte, sprache: PortalSprache | null): string {
  switch (stand.art) {
    case 'ungezeichnet': return t.ungezeichnet;
    case 'schemastand_gewechselt':
      return t.schemastandGewechselt(stand.gezeichnet ?? t.schemastandUnbekannt);
    case 'turnus_abgelaufen': return t.turnusAbgelaufen(tagInSprache(stand.faelligSeit, sprache));
    case 'inhalt_geaendert': return t.inhaltGeaendert(tagInSprache(stand.faelligAm, sprache));
    case 'aktuell': return t.aktuell(tagInSprache(stand.faelligAm, sprache));
  }
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function Zeichnungsvermerk({
  sprache, stand, zeichnungen, aktuellerHash, darfZeichnen, ergebnis,
}: {
  readonly sprache: PortalSprache | null;
  readonly stand: ZeichnungsStand;
  readonly zeichnungen: readonly Zeichnung[];
  readonly aktuellerHash: string;
  readonly darfZeichnen: boolean;
  /** `?zeichnung=` der Route: `gezeichnet` oder ein Grund (V-275, D-769). */
  readonly ergebnis: string | null;
}) {
  const t = nachSprache(ZEICHNUNG_TEXTE, sprache);

  return (
    <section aria-labelledby="zeichnung-titel" id="zeichnung" data-cse="vd-zeichnung"
             className="mb-s7 max-w-prose rounded-lg border border-line bg-surface p-s5">
      <h2 id="zeichnung-titel" className="mb-s3 mt-0 text-h2 text-text">{t.titel}</h2>
      <p className="mb-s4 text-sm text-text-muted">{t.erklaerung}</p>

      {ergebnis === null ? null : ergebnis === 'gezeichnet' ? (
        <Hinweis art="erfolg" rolle="status" cse="vd-zeichnung-ergebnis" className="mb-s4">
          {t.gezeichnet}
        </Hinweis>
      ) : (
        <Hinweis art="warnung" rolle="alert" cse="vd-zeichnung-fehler" className="mb-s4">
          {eigenerEintrag(t.fehler, ergebnis) ?? t.fehlerSonst}
        </Hinweis>
      )}

      <Hinweis art={hinweisArt(stand.art)} cse="vd-zeichnung-stand" className="mb-s5">
        <span data-stand={stand.art}>{standSatz(stand, t, sprache)}</span>
      </Hinweis>

      <h3 className="mb-s3 mt-0 text-h3 text-text">{t.verlauf}</h3>
      {zeichnungen.length === 0 ? (
        <p className="mb-s5 text-sm text-text-muted" data-cse="vd-zeichnung-leer">{t.verlaufLeer}</p>
      ) : (
        <div className="mb-s5" data-cse="vd-zeichnungen">
          <DataTable
            beschriftung={t.verlauf}
            zeilen={zeichnungen}
            schluessel={(z) => z.id}
            spalten={[
              { schluessel: 'am', kopf: t.spalteAm,
                zelle: (z: Zeichnung) => zeitpunktInSprache(z.gezeichnetAm, sprache) },
              { schluessel: 'von', kopf: t.spalteVon,
                zelle: (z: Zeichnung) => z.gezeichnetVon ?? t.unbekannt },
              { schluessel: 'funktion', kopf: t.spalteFunktion, zelle: (z: Zeichnung) => z.funktion },
              { schluessel: 'schemastand', kopf: t.spalteSchemastand,
                zelle: (z: Zeichnung) => z.schemastand ?? t.schemastandUnbekannt },
              { schluessel: 'hash', kopf: t.spalteHash,
                zelle: (z: Zeichnung) => (
                  <span className="break-all font-mono text-xs" title={z.sha256}>
                    {z.sha256.slice(0, 12)}
                    {z.sha256 === aktuellerHash ? (
                      <span className="ml-s2 font-sans text-text-muted">({t.dieseFassung})</span>
                    ) : null}
                  </span>
                ) },
              { schluessel: 'bemerkung', kopf: t.spalteBemerkung,
                zelle: (z: Zeichnung) => z.bemerkung ?? t.unbekannt },
            ]}
          />
        </div>
      )}

      {darfZeichnen ? (
        <form method="post" action="/api/buchhaltung/verfahrensdokumentation/zeichnung"
              className="flex flex-col gap-s4" data-cse="vd-zeichnung-formular">
          <h3 className="m-0 text-h3 text-text">{t.formular}</h3>
          <p className="m-0 text-sm text-text-muted">{t.formularErklaerung}</p>
          <FormField label={t.funktion} name="funktion" type="text" required minLength={FUNKTION_MINDESTENS}
                     maxLength={FUNKTION_HOECHSTENS} autoComplete="organization-title" hinweis={t.funktionHinweis}
                     data-cse="vd-zeichnung-funktion" />
          <label className="flex flex-col gap-s2 text-sm text-text">
            <span>{t.bemerkung} <span className="text-text-muted">{t.freiwillig}</span></span>
            <textarea name="bemerkung" rows={3} maxLength={BEMERKUNG_HOECHSTENS} className={FELD}
                      data-cse="vd-zeichnung-bemerkung" />
          </label>
          <div>
            <Button type="submit" variante="primary" data-cse="vd-zeichnen">{t.zeichnen}</Button>
          </div>
        </form>
      ) : (
        <p className="m-0 text-sm text-text-muted" data-cse="vd-zeichnung-ohne-recht">
          {t.zeichnenRechtVor}{' '}<Recht schluessel={ZEICHNUNG_RECHT} sprache={sprache} />{' '}{t.zeichnenRechtNach}
        </p>
      )}

      <p className="m-0 mt-s4 text-xs text-text-muted" data-cse="vd-zeichnung-voreinstellung">
        {t.voreinstellung}
      </p>
    </section>
  );
}
