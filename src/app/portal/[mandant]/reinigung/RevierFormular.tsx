import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { RevierTexte } from '@/lib/i18n/verwaltung/reinigung';

/**
 * Das Formular für ein Revier — einmal zum Anlegen, einmal zum Ändern
 * (V-002, CLN-01, OPS-02).
 *
 * **Ein Baustein für beide Wege**, wie bei `ObjektFormular`: zwei getrennte
 * Formulare wären zwei Stellen, an denen „Sollzeit" steht, und die zweite ist
 * die, die beim nächsten Feld vergessen wird. Was sich unterscheidet, ist
 * dreierlei: die Beschriftung des Knopfes, das versteckte `aktion` — und dass
 * **das Objekt beim Ändern nicht mehr angeboten wird**.
 *
 * **Warum das Objekt nur beim Anlegen wählbar ist.** `revier_raum` zeigt auf
 * `objekt_id` (0065); ein Revier umzuhängen erbte Räume eines fremden
 * Gebäudes. Der Dienst nimmt das Feld beim Ändern gar nicht erst entgegen —
 * hier steht es deshalb als Text, nicht als Auswahl, damit sichtbar bleibt,
 * WO die Fläche liegt.
 *
 * **Die Texte kommen von aussen** (`t`): die Verwaltung läuft in zwei
 * Sprachen (D-82).
 */

export interface ObjektAuswahl {
  readonly id: string;
  readonly bezeichnung: string;
}

export interface RevierWerte {
  readonly bezeichnung: string;
  readonly kurzzeichen: string | null;
  readonly beschreibung: string | null;
  readonly sollzeitMinuten: string;
  readonly aktivAb: string;
  readonly aktivBis: string | null;
  /** Der Name des Objekts — beim Ändern nur noch Anzeige. */
  readonly objekt: string | null;
}

export interface RevierFormularProps {
  /** Wohin der Server bei einem Fehler zurückschickt. */
  readonly zurueck: string;
  /** `undefined` heisst anlegen; sonst die Kennung des Reviers. */
  readonly revierId?: string | undefined;
  readonly werte?: RevierWerte | undefined;
  readonly objekte: readonly ObjektAuswahl[];
  readonly t: RevierTexte;
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function RevierFormular(
  { zurueck, revierId, werte, objekte, t }: RevierFormularProps,
) {
  const aendern = revierId !== undefined;
  return (
    <form method="post" action="/api/reinigung/reviere" data-cse="revier-formular"
          className="flex max-w-[56ch] flex-col gap-s5">
      <input type="hidden" name="zurueck" value={zurueck} />
      <input type="hidden" name="aktion" value={aendern ? 'aendern' : 'anlegen'} />
      {aendern && <input type="hidden" name="id" value={revierId} />}

      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.wo}</h2>
        {aendern ? (
          <>
            <p className="m-0 text-sm text-text" data-cse="revier-objekt-fest">
              {t.objekt}: <strong>{werte?.objekt ?? '—'}</strong>
            </p>
            <p className="mb-0 mt-s3 text-xs text-text-muted">{t.objektBleibt}</p>
          </>
        ) : (
          <>
            <p className="mb-s4 mt-0 text-sm text-text-muted">{t.objektPflicht}</p>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.objekt}
              <select name="objekt" required className={FELD} data-cse="revier-objekt"
                      defaultValue="">
                <option value="" disabled>{t.objektWaehlen}</option>
                {objekte.map((o) => (
                  <option key={o.id} value={o.id}>{o.bezeichnung}</option>
                ))}
              </select>
            </label>
            <p className="mb-0 mt-s3 text-xs text-text-muted">{t.objektBleibt}</p>
          </>
        )}
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.was}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.bezeichnung}
            <input name="bezeichnung" required maxLength={120} className={FELD}
                   defaultValue={werte?.bezeichnung ?? ''}
                   placeholder={t.bezeichnungBeispiel}
                   data-cse="revier-bezeichnung" />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.kurzzeichen} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="kurzzeichen" maxLength={16} className={FELD}
                   defaultValue={werte?.kurzzeichen ?? ''}
                   placeholder={t.kurzzeichenBeispiel} />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.beschreibung} <span className="text-text-subtle">{t.freiwillig}</span>
            <textarea name="beschreibung" rows={3} className={FELD}
                      defaultValue={werte?.beschreibung ?? ''}
                      placeholder={t.beschreibungBeispiel} />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.sollzeit}
            <input name="sollzeit" required inputMode="decimal" className={FELD}
                   defaultValue={werte?.sollzeitMinuten ?? ''}
                   placeholder={t.sollzeitBeispiel}
                   data-cse="revier-sollzeit" />
            <span className="text-xs text-text-muted">{t.sollzeitErklaerung}</span>
            <span className="text-xs text-text-muted">{t.sollzeitWirdGerechnet}</span>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.wann}</h2>
        <div className="flex flex-col gap-s4 sm:flex-row">
          <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
            {t.aktivAb}
            <input name="aktiv_ab" type="date" className={FELD}
                   defaultValue={werte?.aktivAb ?? ''} />
          </label>
          {aendern && (
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.aktivBis} <span className="text-text-subtle">{t.aktivBisOffen}</span>
              <input name="aktiv_bis" type="date" className={FELD}
                     defaultValue={werte?.aktivBis ?? ''} />
            </label>
          )}
        </div>
        <p className="mb-0 mt-s3 text-xs text-text-muted">{t.aktivAbErklaerung}</p>
      </Card>

      {!aendern && (
        <p className="m-0 max-w-prose text-sm text-text-muted">{t.naechsterSchritt}</p>
      )}

      <div>
        <Button type="submit" variante="primary" data-cse="revier-speichern">
          {aendern ? t.aenderungenSpeichern : t.revierAnlegen}
        </Button>
      </div>
    </form>
  );
}
