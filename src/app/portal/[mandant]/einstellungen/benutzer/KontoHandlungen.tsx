import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { ZugangTexte } from '@/lib/i18n/verwaltung/einstellungen/zugang';

/**
 * Die vier Handlungen an einem fremden Konto (V-022, V-074, V-075, V-076).
 *
 * **Jede steht in ihrem eigenen `details` mit ihrem eigenen Grundfeld.** Vier
 * Knöpfe nebeneinander über einem gemeinsamen Textfeld wären vier
 * Gelegenheiten, den Grund der einen unter die andere zu schreiben — und der
 * Grund ist das, was im Streitfall gelesen wird. Zugeklappt ist ausserdem die
 * ehrliche Vorgabe: der Regelfall auf diesem Blatt ist Nachschlagen, nicht
 * Entziehen.
 *
 * **Sichtbar ist nur, was gerade möglich ist.** Entsperren erscheint an einem
 * gesperrten Konto, Wiedergeben an einem entzogenen. Ein Knopf, der
 * zuverlässig „war schon offen" antwortet, ist ein Knopf, den man nach dem
 * dritten Mal nicht mehr liest.
 */

/**
 * Die Adresse der eigenen Sicherheitsseite — als Konstante, nicht als Text im
 * Rumpf. Sie ist ein WEG und keine Beschriftung: übersetzt würde sie falsch,
 * und die Übersetzungswache kann das am Syntaxbaum nicht unterscheiden.
 */
const EIGENE_SICHERHEIT = '/portal/konto/sicherheit';

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

function Handlung({ mandant, benutzerId, aktion, titel, erklaerung, knopf, art, grundWort }: {
  readonly mandant: string;
  readonly benutzerId: string;
  readonly aktion: string;
  readonly titel: string;
  readonly erklaerung: string;
  readonly knopf: string;
  readonly art: 'primary' | 'secondary' | 'danger';
  readonly grundWort: string;
}) {
  return (
    <details data-cse="konto-handlung" data-aktion={aktion}
             className="rounded-md border border-line bg-surface px-s4 py-s3">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">
        {titel}
      </summary>
      <p className="mb-s3 mt-s2 max-w-prose text-sm text-text-muted">{erklaerung}</p>
      <form method="post" action="/api/konto/verwaltung"
            className="flex max-w-[56ch] flex-col gap-s3">
        <input type="hidden" name="aktion" value={aktion} />
        <input type="hidden" name="benutzer" value={benutzerId} />
        <input type="hidden" name="zurueck"
               value={`/portal/${mandant}/einstellungen/benutzer/${benutzerId}`} />
        <label className="flex flex-col gap-s2 text-sm text-text">
          {grundWort}
          <input type="text" name="grund" required maxLength={500} className={FELD}
                 data-cse="konto-grund" />
        </label>
        <div>
          <Button type="submit" variante={art} data-cse="konto-ausfuehren">
            {knopf}
          </Button>
        </div>
      </form>
    </details>
  );
}

export function KontoHandlungen({
  mandant, benutzerId, status, selbst, darfVerwalten, darfWiderrufen, t,
}: {
  readonly mandant: string;
  readonly benutzerId: string;
  readonly status: string;
  readonly selbst: boolean;
  readonly darfVerwalten: boolean;
  readonly darfWiderrufen: boolean;
  readonly t: ZugangTexte;
}) {
  if (!darfVerwalten && !darfWiderrufen) return null;
  const gemeinsam = { mandant, benutzerId, grundWort: t.grund };

  return (
    <section className="mb-s6" data-cse="konto-handlungen">
      <h2 className="mb-s3 text-h2 text-text">{t.abschnitt}</h2>

      {selbst ? (
        /*
         * **Am eigenen Konto steht hier nichts** — und die Seite sagt, warum.
         * `0379` weist Entzug und Widerruf am eigenen Konto ab: beides sperrte
         * den Handelnden in derselben Sekunde aus, in der er die Taste
         * loslässt. Ein Knopf, der zuverlässig eine Fehlermeldung gibt, ist
         * schlechter als keiner (AUT-06).
         */
        <Hinweis art="hinweis" cse="konto-selbst" className="max-w-prose">
          {t.eigenesKonto}
          {' '}<code className="font-mono">{EIGENE_SICHERHEIT}</code>.
        </Hinweis>
      ) : (
        <div className="flex flex-col gap-s3">
          {darfVerwalten && status === 'gesperrt' && (
            <Handlung
              {...gemeinsam} aktion="entsperren"
              titel={t.entsperrenTitel} erklaerung={t.entsperrenText}
              knopf={t.entsperrenKnopf} art="primary"
            />
          )}

          {darfVerwalten && status !== 'deaktiviert' && (
            <Handlung
              {...gemeinsam} aktion="deaktivieren"
              titel={t.entziehenTitel} erklaerung={t.entziehenText}
              knopf={t.entziehenKnopf} art="danger"
            />
          )}

          {darfVerwalten && status === 'deaktiviert' && (
            <Handlung
              {...gemeinsam} aktion="reaktivieren"
              titel={t.wiedergebenTitel} erklaerung={t.wiedergebenText}
              knopf={t.wiedergebenKnopf} art="primary"
            />
          )}

          {darfWiderrufen && (
            <Handlung
              {...gemeinsam} aktion="sitzungen_widerrufen"
              titel={t.widerrufenTitel} erklaerung={t.widerrufenText}
              knopf={t.widerrufenKnopf} art="secondary"
            />
          )}
        </div>
      )}
    </section>
  );
}
