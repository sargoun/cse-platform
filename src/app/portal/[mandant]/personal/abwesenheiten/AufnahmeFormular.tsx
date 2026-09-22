import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AbwesenheitAufnahmeTexte } from '@/lib/i18n/verwaltung/personal';

/**
 * Das Formular der Abwesenheitsaufnahme im Büro (V-025, EMP-09).
 *
 * **Ohne JavaScript, wie jedes Portalformular.** Die AU-Felder erscheinen
 * deshalb nicht erst nach der Wahl einer krankheitsbezogenen Art — sie stehen
 * da, mit dem Satz daneben, dass sie nur dort gemeint sind. Ein Feld, das erst
 * nach einer Auswahl auftaucht, braucht ein Skript; dieselbe Entscheidung wie
 * bei `VeranstaltungFormular`.
 *
 * **Die Bemerkung sagt ausdrücklich, was NICHT hineingehört.** Eine Diagnose
 * ist ein Gesundheitsdatum nach Art. 9 DSGVO; sie landet sonst in einem
 * Freitextfeld, das die halbe Verwaltung lesen kann — und niemand braucht sie,
 * um eine Abwesenheit zu führen.
 */

export interface AnstellungAuswahl {
  readonly id: string;
  readonly name: string;
}

export interface ArtAuswahl {
  readonly id: string;
  readonly bezeichnung: string;
  /**
   * Ob hinterlegt ist, dass diese Art bezahlt oder unbezahlt ist (O-139).
   *
   * Eine Art ohne diese Angabe weist `pruefeArt` ab. Sie hier WEGZULASSEN
   * waere die bequemere Wahl und die falsche: „Krankheit" fehlte dann
   * kommentarlos in der Liste, und die Aufnehmende suchte den Fehler bei
   * sich. Sie steht deshalb da, nicht wählbar, mit dem Grund daneben.
   */
  readonly geklaert: boolean;
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function AbwesenheitAufnahmeFormular({
  zurueck, fehlerweg, anstellungen, arten, t,
}: {
  readonly zurueck: string;
  /** Wohin bei einer Ueberlappung — das Formular, das den Satz dazu kennt. */
  readonly fehlerweg: string;
  readonly anstellungen: readonly AnstellungAuswahl[];
  readonly arten: readonly ArtAuswahl[];
  readonly t: AbwesenheitAufnahmeTexte;
}) {
  return (
    <form method="post" action="/api/personal/abwesenheit"
          data-cse="abwesenheit-formular"
          className="flex max-w-[56ch] flex-col gap-s5">
      <input type="hidden" name="zurueck" value={zurueck} />
      <input type="hidden" name="fehlerweg" value={fehlerweg} />

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.person}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.person}
            <select name="anstellung" required className={FELD} defaultValue=""
                    data-cse="abwesenheit-anstellung">
              <option value="" disabled>{t.personWaehlen}</option>
              {anstellungen.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <span className="text-xs text-text-muted">{t.personErklaerung}</span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.art}
            <select name="abwesenheitsart" required className={FELD} defaultValue=""
                    data-cse="abwesenheit-art">
              <option value="" disabled>{t.artWaehlen}</option>
              {arten.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.geklaert}>
                  {a.geklaert ? a.bezeichnung : `${a.bezeichnung} — ${t.artOffen}`}
                </option>
              ))}
            </select>
            <span className="text-xs text-text-muted">{t.artErklaerung}</span>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.von}</h2>
        <div className="flex flex-col gap-s4">
          <div className="flex flex-wrap gap-s4">
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.von}
              <input type="date" name="von" required className={FELD}
                     data-cse="abwesenheit-von" />
              <span className="flex min-h-11 items-center gap-s2 text-sm text-text">
                <input type="checkbox" name="von_halbtags" value="ja"
                       className="h-4 w-4 accent-[var(--farbe-brand)]" />
                {t.halbtags}
              </span>
            </label>
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.bis}
              <input type="date" name="bis" required className={FELD}
                     data-cse="abwesenheit-bis" />
              <span className="flex min-h-11 items-center gap-s2 text-sm text-text">
                <input type="checkbox" name="bis_halbtags" value="ja"
                       className="h-4 w-4 accent-[var(--farbe-brand)]" />
                {t.halbtags}
              </span>
            </label>
          </div>
          <span className="text-xs text-text-muted">{t.zeitraumErklaerung}</span>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.auVorliegt}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
            <input type="checkbox" name="au_vorliegt" value="ja"
                   className="h-4 w-4 accent-[var(--farbe-brand)]"
                   data-cse="abwesenheit-au" />
            {t.auVorliegt}
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.auBis} <span className="text-text-muted">{t.freiwillig}</span>
            <input type="date" name="au_bis" className={FELD}
                   data-cse="abwesenheit-au-bis" />
          </label>
          <span className="text-xs text-text-muted">{t.auErklaerung}</span>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.bemerkung}</h2>
        <label className="flex flex-col gap-s2 text-sm text-text">
          {t.bemerkung} <span className="text-text-muted">{t.freiwillig}</span>
          <textarea name="bemerkung" rows={4} maxLength={2000} className={FELD}
                    data-cse="abwesenheit-bemerkung" />
          <span className="text-xs text-text-muted">{t.bemerkungErklaerung}</span>
        </label>
      </Card>

      <p className="m-0 max-w-prose text-sm text-text-muted">{t.statusErklaerung}</p>
      <p className="m-0 max-w-prose text-sm text-text-subtle">{t.antragErklaerung}</p>

      <div>
        <Button type="submit" variante="primary" data-cse="abwesenheit-speichern">
          {t.aufnehmen}
        </Button>
      </div>
    </form>
  );
}
