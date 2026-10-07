import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { VerwaltungskontoPflegeTexte }
  from '@/lib/i18n/verwaltung/einstellungen/verwaltungskonto-pflege';

/**
 * Neuer Link und Rollenwechsel an einem Verwaltungskonto (V-302, O-980,
 * O-981, D-821).
 *
 * **Nur für die Super-Administration, nie am eigenen Konto** — die Seite
 * zeigt die beiden Handlungen nur dann, und `app.verwaltungskonto_link_neu`
 * bzw. `…_rolle_wechseln` (0517) fragen Recht, zweiten Faktor und Konto ein
 * zweites Mal. Jede Handlung steht in ihrem eigenen `details`, wie die
 * Kontohandlungen daneben: der Regelfall auf diesem Blatt ist Nachschlagen.
 */

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function VerwaltungskontoPflege({ mandant, benutzerId, wartet, rolle, t }: {
  readonly mandant: string;
  readonly benutzerId: string;
  /** `benutzer.status = 'eingeladen'` — dann ist der neue Link eine Einladung. */
  readonly wartet: boolean;
  /** Die jetzige Rolle der lebenden Verwaltungsmitgliedschaft. */
  readonly rolle: 'admin' | 'leitung';
  readonly t: VerwaltungskontoPflegeTexte;
}) {
  const verborgen = (
    <>
      <input type="hidden" name="benutzer" value={benutzerId} />
      <input type="hidden" name="zurueck"
             value={`/portal/${mandant}/einstellungen/benutzer/${benutzerId}`} />
    </>
  );
  return (
    <section className="mb-s6" data-cse="verwaltungskonto-pflege">
      <h2 className="mb-s3 text-h2 text-text">{t.abschnitt}</h2>
      <p className="mb-s3 max-w-prose text-sm text-text-muted">{t.nurSuperAdmin}</p>

      <details data-cse="vk-pflege" data-aktion="link_neu"
               className="mb-s3 rounded-md border border-line bg-surface px-s4 py-s3">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">
          {t.linkTitel}
        </summary>
        <p className="mb-s3 mt-s2 max-w-prose text-sm text-text-muted">
          {wartet ? t.linkWartet : t.linkAktiv}
        </p>
        <form method="post" action="/api/system/verwaltungskonto">
          <input type="hidden" name="aktion" value="link_neu" />
          {verborgen}
          <Button type="submit" variante="secondary" data-cse="vk-link-neu">{t.linkKnopf}</Button>
        </form>
      </details>

      <details data-cse="vk-pflege" data-aktion="rolle"
               className="rounded-md border border-line bg-surface px-s4 py-s3">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">
          {t.rolleTitel}
        </summary>
        <p className="mb-s3 mt-s2 max-w-prose text-sm text-text-muted">{t.rolleErklaerung}</p>
        <form method="post" action="/api/system/verwaltungskonto"
              className="flex max-w-[56ch] flex-col gap-s3">
          <input type="hidden" name="aktion" value="rolle" />
          {verborgen}
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.rolle}
            <select name="rolle" defaultValue={rolle === 'admin' ? 'leitung' : 'admin'}
                    className={FELD} data-cse="vk-rolle">
              <option value="admin">{t.rolleAdmin}</option>
              <option value="leitung">{t.rolleLeitung}</option>
            </select>
          </label>
          <div>
            <Button type="submit" variante="secondary" data-cse="vk-rolle-wechseln">
              {t.rolleKnopf}
            </Button>
          </div>
        </form>
      </details>
    </section>
  );
}

/** Der neue Link — genau einmal, aus dem Keks der Route. */
export function NeuerLink({ token, einladung, t }: {
  readonly token: string;
  readonly einladung: boolean;
  readonly t: VerwaltungskontoPflegeTexte;
}) {
  return (
    <Hinweis art="erfolg" rolle="status" cse="vk-neuer-link" className="mb-s5 max-w-prose">
      <strong>{t.linkAnzeigeTitel}</strong>{' '}
      {einladung ? t.linkAnzeigeEinladung : t.linkAnzeigeKennwort}
      <br /><br />
      <span className="text-sm text-text-muted">{t.linkKopieren}:</span>
      <br />
      <code data-cse="vk-neuer-link-wert" className="break-all font-mono text-sm text-text">
        {`/auth/einladung/${token}`}
      </code>
      <br /><br />
      <span className="text-sm">{t.linkEinmal}</span>
    </Hinweis>
  );
}
