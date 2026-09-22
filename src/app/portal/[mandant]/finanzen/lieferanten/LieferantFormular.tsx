import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import type { LieferantenTexte } from '@/lib/i18n/verwaltung/finanzen/lieferanten';
import type { LieferantZeile } from '@/server/services/finanz/lieferant';

/**
 * Das Formular der Lieferantenstammdaten (V-006).
 *
 * **Die IBAN wird beim Bearbeiten NICHT vorbefüllt — sie kann es gar nicht.**
 * `cse_app` hält auf `lieferant.iban` kein `select` (Spaltenentzug, `0123`);
 * lesbar ist sie nur über `app.lieferant_konditionen`, das den Zugriff
 * protokolliert. Ein leeres Feld heisst deshalb „unverändert lassen" und
 * nicht „löschen", und der Satz daneben sagt es — sonst hiesse Speichern
 * ohne IBAN, den Lieferanten unbezahlbar zu machen.
 *
 * **Die Leistungsart ist eine Auswahl mit drei Werten und keine zwei
 * Häkchen.** § 13b Abs. 2 Nr. 4 und Nr. 8 sind verschiedene Tatbestände mit
 * verschiedenen Voraussetzungen; nebeneinander angekreuzt ergäben sie einen
 * Fall, den das Gesetz nicht kennt.
 */

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function LieferantFormular({ zurueck, fehlerweg, vorhanden, t }: {
  readonly zurueck: string;
  readonly fehlerweg: string;
  /** Beim Bearbeiten die vorhandene Zeile, beim Anlegen `null`. */
  readonly vorhanden: LieferantZeile | null;
  readonly t: LieferantenTexte;
}) {
  return (
    <form method="post" action="/api/finanzen/lieferanten"
          data-cse="lieferant-formular"
          className="flex max-w-[64ch] flex-col gap-s5">
      <input type="hidden" name="aktion" value={vorhanden === null ? 'anlegen' : 'aendern'} />
      <input type="hidden" name="zurueck" value={zurueck} />
      <input type="hidden" name="fehlerweg" value={fehlerweg} />
      {vorhanden === null ? null : (
        <input type="hidden" name="id" value={vorhanden.id} />
      )}

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.name}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.name}
            <input type="text" name="name" required maxLength={200} className={FELD}
                   placeholder={t.nameBeispiel}
                   defaultValue={vorhanden?.name ?? ''}
                   data-cse="lieferant-name" />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.anschrift}</h2>
        <div className="flex flex-col gap-s4">
          <div className="flex flex-wrap gap-s4">
            <label className="flex flex-[3] flex-col gap-s2 text-sm text-text">
              {t.strasse}
              <input type="text" name="strasse" maxLength={200} className={FELD} />
            </label>
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.hausnummer}
              <input type="text" name="hausnummer" maxLength={20} className={FELD} />
            </label>
          </div>
          <div className="flex flex-wrap gap-s4">
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.plz}
              <input type="text" name="plz" maxLength={20} className={FELD} />
            </label>
            <label className="flex flex-[3] flex-col gap-s2 text-sm text-text">
              {t.ort}
              <input type="text" name="ort" maxLength={200} className={FELD}
                     defaultValue={vorhanden?.ort ?? ''} />
            </label>
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.land}
              <input type="text" name="land" maxLength={2} className={FELD}
                     defaultValue={vorhanden?.land ?? 'DE'}
                     data-cse="lieferant-land" />
            </label>
          </div>
          <span className="text-xs text-text-muted">{t.landErklaerung}</span>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.kontakt}</h2>
        <div className="flex flex-wrap gap-s4">
          <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
            {t.email} <span className="text-text-muted">{t.freiwillig}</span>
            <input type="email" name="email" maxLength={200} className={FELD} />
          </label>
          <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
            {t.telefon} <span className="text-text-muted">{t.freiwillig}</span>
            <input type="text" name="telefon" maxLength={60} className={FELD} />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.steuer}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.ustId} <span className="text-text-muted">{t.freiwillig}</span>
            <input type="text" name="ust_id" maxLength={40} className={FELD}
                   defaultValue={vorhanden?.ustId ?? ''}
                   data-cse="lieferant-ustid" />
            <span className="text-xs text-text-muted">{t.ustIdErklaerung}</span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.steuernummer} <span className="text-text-muted">{t.freiwillig}</span>
            <input type="text" name="steuernummer" maxLength={40} className={FELD} />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.bank}</h2>
        {vorhanden === null ? null : (
          <Hinweis art="hinweis" cse="iban-nicht-lesbar" className="mb-s4 max-w-prose">
            {t.ibanNichtLesbar}
          </Hinweis>
        )}
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.iban} <span className="text-text-muted">{t.freiwillig}</span>
            <input type="text" name="iban" maxLength={40} className={FELD}
                   data-cse="lieferant-iban" />
            <span className="text-xs text-text-muted">{t.ibanErklaerung}</span>
          </label>
          <div className="flex flex-wrap gap-s4">
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.bic} <span className="text-text-muted">{t.freiwillig}</span>
              <input type="text" name="bic" maxLength={11} className={FELD} />
            </label>
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.zahlungsziel} <span className="text-text-muted">{t.freiwillig}</span>
              <input type="number" name="zahlungsziel" min={0} max={3650}
                     className={FELD} data-cse="lieferant-zahlungsziel" />
            </label>
          </div>
          <span className="text-xs text-text-muted">{t.zahlungszielErklaerung}</span>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.bauleistung}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.leistungsart}
            <select name="leistungsart" className={FELD}
                    defaultValue={vorhanden?.leistungsart ?? ''}
                    data-cse="lieferant-leistungsart">
              <option value="">{t.leistungsartKeine}</option>
              <option value="bau">{t.leistungsartBau}</option>
              <option value="gebaeudereinigung">{t.leistungsartReinigung}</option>
            </select>
            <span className="text-xs text-text-muted">{t.leistungsartErklaerung}</span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.bauleistenderBis} <span className="text-text-muted">{t.freiwillig}</span>
            <input type="date" name="bauleistender_bis" className={FELD}
                   defaultValue={vorhanden?.istBauleistenderBis ?? ''}
                   data-cse="lieferant-bauleistender" />
            <span className="text-xs text-text-muted">{t.bauleistenderErklaerung}</span>
          </label>
        </div>
      </Card>

      <div>
        <Button type="submit" variante="primary" data-cse="lieferant-speichern">
          {vorhanden === null ? t.anlegen : t.speichern}
        </Button>
      </div>
    </form>
  );
}
