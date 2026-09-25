import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { InternSprache } from '@/lib/i18n/intern';
import {
  modulName, type ModulZuweisungTexte,
} from '@/lib/i18n/verwaltung/einstellungen/module-zuweisung';

/**
 * Die Module einer Administration setzen (AUT-01, V-164, D-658).
 *
 * **Ein Formular ohne JavaScript**, wie jedes Portalformular: zwei Optionen
 * für den Umfang und eine Liste von Haken. „Alle Module der Rolle" ist eine
 * eigene Wahl und nicht „kein Haken gesetzt" — eine leere Auswahl ist ein
 * Versehen, und die Datenbank weist sie ab, statt sie still zu „alles" zu
 * machen.
 *
 * **Sichtbar nur, wo es geht:** mit `system.module_zuweisen`, an einer
 * lebenden Mitgliedschaft mit der Plattformrolle `admin`, und nicht am
 * eigenen Konto. Am eigenen Konto steht statt der Knöpfe der Satz, warum
 * (0416) — ein Knopf, der zuverlässig „nicht möglich" antwortet, ist
 * schlechter als keiner.
 *
 * **Genau eine Mitgliedschaft.** `benutzer_mandant_key` erlaubt je Konto und
 * Gesellschaft nur eine lebende Zeile; das Formular ist deshalb eines und
 * keine Liste. Der Knopf ist `secondary`: das Blatt trägt mit den
 * Kontohandlungen schon seinen einen roten Knopf (DESIGN §5).
 */
export interface ZuweisbareMitgliedschaft {
  readonly id: string;
  readonly module: readonly string[] | null;
}

export function ModulZuweisung({
  mandant, benutzerId, selbst, mitgliedschaft, katalog, sprache, t,
}: {
  readonly mandant: string;
  readonly benutzerId: string;
  readonly selbst: boolean;
  readonly mitgliedschaft: ZuweisbareMitgliedschaft | null;
  readonly katalog: readonly string[];
  readonly sprache: InternSprache;
  readonly t: ModulZuweisungTexte;
}) {
  if (mitgliedschaft === null) return null;
  const m = mitgliedschaft;
  const zurueck = `/portal/${mandant}/einstellungen/benutzer/${benutzerId}`;
  const gewaehlt = new Set(m.module ?? []);

  return (
    <section className="mb-s6" data-cse="modul-zuweisung">
      <h2 className="mb-s3 text-h2 text-text">{t.abschnitt}</h2>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">{t.erklaerung}</p>

      {selbst ? (
        <Hinweis art="hinweis" cse="modul-zuweisung-selbst" className="max-w-prose">
          {t.eigenesKonto}
        </Hinweis>
      ) : (
        <form method="post" action="/api/einstellungen/mitgliedschaft-module"
              data-cse="modul-zuweisung-formular"
              className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
          <input type="hidden" name="mitgliedschaft" value={m.id} />
          <input type="hidden" name="zurueck" value={zurueck} />

          <fieldset className="flex flex-col gap-s2 border-0 p-0">
            <legend className="mb-s2 text-sm font-semibold text-text">{t.umfang}</legend>
            <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
              <input type="radio" name="umfang" value="alle" defaultChecked={m.module === null}
                     className="mt-s1" data-cse="modul-umfang-alle" />
              <span>{t.alle}</span>
            </label>
            <label className="flex min-h-11 items-start gap-s2 text-sm text-text">
              <input type="radio" name="umfang" value="auswahl"
                     defaultChecked={m.module !== null}
                     className="mt-s1" data-cse="modul-umfang-auswahl" />
              <span>{t.auswahl}</span>
            </label>
          </fieldset>

          <fieldset className="border-0 p-0">
            <legend className="mb-s2 text-sm font-semibold text-text">{t.module}</legend>
            <ul className="m-0 grid list-none grid-cols-1 gap-x-s4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {katalog.map((modul) => (
                <li key={modul}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-s2 text-sm text-text">
                    <input type="checkbox" name="modul" value={modul}
                           defaultChecked={gewaehlt.has(modul)}
                           className="h-4 w-4 accent-brand" data-cse="modul-haken" />
                    {modulName(modul, sprache)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <div>
            <Button type="submit" variante="secondary" data-cse="modul-speichern">
              {t.speichern}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
