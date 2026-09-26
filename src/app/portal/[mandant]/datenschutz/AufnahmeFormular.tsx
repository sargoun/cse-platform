import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AufnahmeTexte } from '@/lib/i18n/verwaltung/datenschutz';
import type { InternSprache } from '@/lib/i18n/intern';
import {
  ANFRAGE_ARTEN, ART_TEXT, ART_TEXT_EN, AUFNAHME_WEGE,
} from '@/server/services/datenschutz/anfrage';

/**
 * Das Formular für eine aufgenommene Betroffenenanfrage (V-031, Art. 12 Abs. 1).
 *
 * **Radioknöpfe für den Eingangsweg, keine Auswahlliste.** Vier Werte passen
 * auf jeden Bildschirm, und jeder trägt seine Fundstelle im Artikel daneben —
 * in einer zugeklappten Liste stünde die Begründung erst nach dem Aufklappen,
 * also genau dann nicht, wenn sie die Wahl leiten soll.
 *
 * **Der Eingangszeitpunkt ist FREIWILLIG und kein Pflichtfeld.** Beim Anruf,
 * den man gerade entgegennimmt, ist „jetzt" richtig, und ein Pflichtfeld
 * zwänge die Aufnehmende, den Augenblick abzutippen, den die Datenbank besser
 * weiss (Invariante 5). Nur beim Brief weicht der Eingang ab — dann steht er
 * im Feld.
 */

export interface AufnahmeFormularProps {
  readonly mandant: string;
  readonly sprache: InternSprache;
  readonly t: AufnahmeTexte;
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function AufnahmeFormular({ mandant, sprache, t }: AufnahmeFormularProps) {
  /*
   * Die Artbeschreibungen kommen aus dem DIENST und nicht aus der Textdatei
   * dieser Seite: „Auskunft (Art. 15)" steht schon im Posteingang, auf dem
   * Vorgangsblatt und in der öffentlichen Bestätigung. Zwei Tabellen für
   * dieselben sechs Artikel wären zwei Gelegenheiten, sie zu verwechseln.
   */
  const arten = sprache === 'en' ? ART_TEXT_EN : ART_TEXT;

  return (
    <form method="post" action="/api/datenschutz/aufnehmen"
          data-cse="aufnahme-formular"
          className="flex max-w-[56ch] flex-col gap-s5">
      {/*
        * `__ID__` ersetzt die Route durch die Kennung des angelegten Vorgangs.
        * Das Ziel steht deshalb hier und nicht dort: welcher Mandant gemeint
        * ist, weiss diese Seite, und ein in der Route zusammengesetzter Pfad
        * wäre ein zweiter Ort, an dem die Adressform gepflegt werden müsste.
        */}
      <input type="hidden" name="zurueck"
             value={`/portal/${mandant}/datenschutz/__ID__`} />

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.anliegen}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.anliegen}
            <select name="art" required className={FELD} defaultValue=""
                    data-cse="aufnahme-art">
              <option value="" disabled>{t.anliegen}</option>
              {ANFRAGE_ARTEN.map((a) => (
                <option key={a} value={a}>{arten[a].kurz}</option>
              ))}
            </select>
            <span className="text-xs text-text-muted">{t.anliegenErklaerung}</span>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.weg}</h2>
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">{t.weg}</legend>
          <div className="flex flex-col gap-s2">
            {AUFNAHME_WEGE.map((w) => (
              <label key={w} data-cse="aufnahme-weg" data-wert={w}
                     className="flex min-h-11 cursor-pointer items-start gap-s3
                                rounded-md border border-line bg-surface px-s4 py-s2
                                text-sm text-text hover:border-line-strong">
                <input type="radio" name="eingangsweg" value={w} required
                       className="mt-s2 h-4 w-4 accent-[var(--farbe-brand)]" />
                <span>
                  {t.wege[w]}
                  <span className="block text-xs text-text-muted">
                    {t.wegeErklaerung[w]}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <span className="mt-s2 block text-xs text-text-muted">{t.wegErklaerung}</span>
        </fieldset>

        <label className="mt-s4 flex flex-col gap-s2 text-sm text-text">
          {t.eingegangen} <span className="text-text-muted">{t.freiwillig}</span>
          <input type="datetime-local" name="eingegangen" className={FELD}
                 data-cse="aufnahme-eingegangen" />
          <span className="text-xs text-text-muted">
            {t.eingegangenErklaerung} {t.eingegangenJetzt}
          </span>
        </label>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.name}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.name}
            <input type="text" name="name" required maxLength={200} className={FELD}
                   placeholder={t.nameBeispiel} data-cse="aufnahme-name" />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.email}
            <input type="email" name="email" required maxLength={200} className={FELD}
                   data-cse="aufnahme-email" />
            <span className="text-xs text-text-muted">{t.emailErklaerung}</span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.rolle} <span className="text-text-muted">{t.freiwillig}</span>
            <input type="text" name="rolle" maxLength={200} className={FELD}
                   placeholder={t.rolleBeispiel} data-cse="aufnahme-rolle" />
            <span className="text-xs text-text-muted">{t.rolleErklaerung}</span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.nachricht}
            <textarea name="nachricht" rows={6} maxLength={5000} className={FELD}
                      data-cse="aufnahme-nachricht" />
            <span className="text-xs text-text-muted">{t.nachrichtErklaerung}</span>
          </label>
        </div>
      </Card>

      <p className="m-0 max-w-prose text-sm text-text-muted">{t.identitaetSpaeter}</p>

      <div>
        <Button type="submit" variante="primary" data-cse="aufnahme-speichern">
          {t.aufnehmen}
        </Button>
      </div>
    </form>
  );
}
