import { Button } from '@/components/ui/Button';
import type { GewerkTexte } from '@/lib/i18n/verwaltung/gewerke';
import type { GewerkKatalogZeile } from '@/server/services/bau/gewerk';

/**
 * Das Formular für ein neues Gewerk (`zeile === null`) und für die Änderung
 * eines lebenden — derselbe Satz Felder, nur der Code ist beim Ändern fest
 * (BAU-07, V-182). Ein echtes `<form method="post">` ohne Skript; die Route
 * ist `POST /api/bau/gewerke`, der Rückweg die Katalogseite (`zurueck`).
 *
 * **Steht der Name an einem abgeschlossenen Bautag, ist auch er fest**
 * (D-679): das Feld ist schreibgeschützt und sagt, warum — ein Feld, dessen
 * Änderung der Dienst nur abweisen kann, lädt nicht zum Ändern ein.
 */
export function GewerkFormular({ t, pfad, zeile }: {
  readonly t: GewerkTexte;
  readonly pfad: string;
  readonly zeile: GewerkKatalogZeile | null;
}) {
  const feld = 'mt-s1 min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
    + 'text-sm text-text';
  const beschriftung = 'block text-micro uppercase tracking-[0.08em] text-text-muted';
  const praefix = zeile === null ? 'neu' : zeile.id;
  return (
    <form method="post" action="/api/bau/gewerke"
          data-cse={zeile === null ? 'gewerk-formular' : 'gewerk-aendern'}
          className="mt-s3 max-w-prose rounded-lg border border-line bg-surface p-s5">
      <input type="hidden" name="aktion" value={zeile === null ? 'anlegen' : 'aendern'} />
      <input type="hidden" name="zurueck" value={pfad} />
      {zeile !== null && <input type="hidden" name="id" value={zeile.id} />}

      {zeile === null && (
        <label className="mb-s4 block" htmlFor={`${praefix}-code`}>
          <span className={beschriftung}>{t.code}</span>
          <input id={`${praefix}-code`} name="code" required maxLength={12}
                 aria-describedby={`${praefix}-code-hinweis`} className={feld} />
          <span id={`${praefix}-code-hinweis`} className="mt-s1 block text-xs text-text-muted">
            {t.codeHinweis}
          </span>
        </label>
      )}

      <label className="mb-s4 block" htmlFor={`${praefix}-bezeichnung`}>
        <span className={beschriftung}>{t.bezeichnung}</span>
        <input id={`${praefix}-bezeichnung`} name="bezeichnung" required maxLength={120}
               defaultValue={zeile?.bezeichnung} className={feld}
               readOnly={zeile?.nameFest === true}
               aria-describedby={zeile?.nameFest === true ? `${praefix}-name-fest` : undefined} />
        {zeile?.nameFest === true && (
          <span id={`${praefix}-name-fest`} className="mt-s1 block text-xs text-text-muted"
                data-cse="gewerk-name-fest">
            {t.bezeichnungFest}
          </span>
        )}
      </label>

      <fieldset className="mb-s4 border-0 p-0">
        <legend className={beschriftung}>{t.uebersetzungen}</legend>
        <p className="m-0 mb-s2 text-xs text-text-muted">{t.uebersetzungenHinweis}</p>
        {(['en', 'ar', 'tr'] as const).map((s) => (
          <label key={s} className="mb-s2 block" htmlFor={`${praefix}-${s}`}>
            <span className="text-sm text-text-muted">{t.sprache[s]}</span>
            <input id={`${praefix}-${s}`} name={`bezeichnung_${s}`} maxLength={120} lang={s}
                   dir={s === 'ar' ? 'rtl' : undefined}
                   defaultValue={zeile?.uebersetzungen[s]} className={feld} />
          </label>
        ))}
      </fieldset>

      <div className="mb-s4 grid gap-s4 md:grid-cols-2">
        <label className="block" htmlFor={`${praefix}-lb`}>
          <span className={beschriftung}>{t.leistungsbereich}</span>
          <input id={`${praefix}-lb`} name="leistungsbereich" maxLength={20}
                 aria-describedby={`${praefix}-lb-hinweis`}
                 defaultValue={zeile?.leistungsbereich ?? undefined} className={feld} />
          <span id={`${praefix}-lb-hinweis`} className="mt-s1 block text-xs text-text-muted">
            {t.leistungsbereichHinweis}
          </span>
        </label>
        <label className="block" htmlFor={`${praefix}-sortierung`}>
          <span className={beschriftung}>{t.sortierung}</span>
          <input id={`${praefix}-sortierung`} name="sortierung" type="number" min={0} max={999}
                 step={1} defaultValue={zeile?.sortierung ?? 0} className={feld} />
        </label>
      </div>

      <label className="mb-s5 flex items-start gap-s2 text-sm text-text">
        <input type="checkbox" name="bestaetigt" value="ja"
               defaultChecked={zeile !== null && !zeile.istPlatzhalter}
               className="min-h-6 min-w-6" />
        <span>
          {t.bestaetigt}
          <span className="mt-s1 block text-xs text-text-muted">{t.bestaetigtHinweis}</span>
        </span>
      </label>

      <Button type="submit" variante={zeile === null ? 'primary' : 'secondary'}>
        {zeile === null ? t.anlegen : t.speichern}
      </Button>
    </form>
  );
}
