import { Button } from '@/components/ui/Button';
import type { KalenderTerminTexte } from '@/lib/i18n/verwaltung/kalender-termin';
import { EIGENE_ARTEN } from '@/server/services/kalender/termin';

/**
 * Das Formular eines eigenen Termins — EINES für Anlegen (`/kalender/neu`)
 * und Ändern (`/kalender/[id]`), damit beide dieselben Felder in derselben
 * Lesart schicken (`api/kalender/eintraege/termin-rumpf.ts`, V-221).
 *
 * **Uhrzeit ODER ganzer Tag.** Beide Feldpaare stehen da; die Route liest das
 * Paar, das das Kästchen „Ganztägig" wählt. Ohne JavaScript lässt sich keins
 * ausblenden — und ein Formular, das ohne Skript nicht geht, geht auf dem
 * Telefon im Treppenhaus nicht.
 *
 * Kein sichtbares Wort steht hier fest: alles kommt über `t` (D-592).
 */
export interface TerminWerte {
  readonly art: string;
  readonly titel: string;
  readonly ort: string;
  readonly beschreibung: string;
  readonly ganztaegig: boolean;
  /** `JJJJ-MM-TTTHH:MM`, Berliner Wanduhr. */
  readonly beginn: string;
  readonly ende: string;
  /** `JJJJ-MM-TT`. */
  readonly vonTag: string;
  readonly bisTag: string;
  readonly teilnehmer: readonly string[];
}

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

export function TerminFormular({ t, aktion, zurueck, benutzer, werte, knopf, cse, aendern }: {
  readonly t: KalenderTerminTexte;
  readonly aktion: string;
  readonly zurueck: string;
  readonly benutzer: readonly { readonly id: string; readonly name: string }[];
  readonly werte: TerminWerte;
  readonly knopf: string;
  readonly cse: string;
  /** Beim Ändern: das Feld `aktion=aendern` für `api/kalender/eintraege/[id]`. */
  readonly aendern?: boolean;
}) {
  return (
    <form method="post" action={aktion} data-cse={cse}
          className="flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
      {aendern === true && <input type="hidden" name="aktion" value="aendern" />}
      <input type="hidden" name="zurueck" value={zurueck} />

      <label className="flex flex-col gap-s2 text-sm text-text">
        {t.art}
        <select name="art" defaultValue={werte.art} className={FELD} data-cse="termin-art-wahl">
          {EIGENE_ARTEN.map((a) => (
            <option key={a} value={a}>{t.arten[a]}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-s2 text-sm text-text">
        {t.titel}
        <input name="titel" required maxLength={200} defaultValue={werte.titel}
               placeholder={t.titelBeispiel} className={FELD} data-cse="termin-titel-feld" />
      </label>

      <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
        <legend className="mb-s2 text-sm text-text">{t.beginn} · {t.ende}</legend>
        <div className="flex flex-wrap gap-s4">
          <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
            {t.beginn}
            <input type="datetime-local" name="beginn" defaultValue={werte.beginn}
                   className={FELD} data-cse="termin-beginn" />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
            {t.ende}
            <input type="datetime-local" name="ende" defaultValue={werte.ende}
                   className={FELD} data-cse="termin-ende" />
          </label>
        </div>
        <label className="flex items-center gap-s3 text-sm text-text">
          <input type="checkbox" name="ganztaegig" value="ja"
                 defaultChecked={werte.ganztaegig} className="min-h-5 min-w-5"
                 data-cse="termin-ganztaegig" />
          {t.ganztaegig}
        </label>
        <p className="m-0 text-xs text-text-subtle">{t.ganztaegigHinweis}</p>
        <div className="flex flex-wrap gap-s4">
          <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
            {t.vonTag}
            <input type="date" name="vonTag" defaultValue={werte.vonTag}
                   className={FELD} data-cse="termin-von-tag" />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
            {t.bisTag}
            <input type="date" name="bisTag" defaultValue={werte.bisTag}
                   className={FELD} data-cse="termin-bis-tag" />
          </label>
        </div>
        <p className="m-0 text-xs text-text-subtle">{t.zeitHinweis}</p>
      </fieldset>

      <label className="flex flex-col gap-s2 text-sm text-text">
        {t.ort}
        <input name="ort" maxLength={200} defaultValue={werte.ort} className={FELD}
               data-cse="termin-ort-feld" />
      </label>

      <label className="flex flex-col gap-s2 text-sm text-text">
        {t.beschreibung}
        <textarea name="beschreibung" rows={4} maxLength={4000}
                  defaultValue={werte.beschreibung} className={FELD}
                  data-cse="termin-beschreibung-feld" />
      </label>

      {benutzer.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-s2 border-0 p-0" data-cse="termin-teilnehmende">
          <legend className="mb-s2 text-sm text-text">{t.teilnehmende}</legend>
          {benutzer.map((b) => (
            <label key={b.id} className="flex items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="teilnehmer" value={b.id}
                     defaultChecked={werte.teilnehmer.includes(b.id)}
                     className="min-h-5 min-w-5" />
              {b.name}
            </label>
          ))}
          <p className="m-0 text-xs text-text-subtle">{t.teilnehmendeHinweis}</p>
        </fieldset>
      )}

      <div>
        <Button type="submit" variante="primary" data-cse={`${cse}-abschicken`}>
          {knopf}
        </Button>
      </div>
    </form>
  );
}
