import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { VeranstaltungTexte } from '@/lib/i18n/verwaltung/security';

/**
 * Das Formular für eine Veranstaltung (V-004, SEC-08).
 *
 * **Der Ort ist ein Objekt ODER ein Text**, und das Formular zeigt beide
 * nebeneinander statt hintereinander: `veranstaltung_ort_genannt` verlangt
 * eines von beidem, und ein Feld, das erst nach einer Auswahl erscheint,
 * braucht JavaScript. Die Portalformulare laufen ohne.
 *
 * **Zwei `datetime-local`-Felder und kein Dauerfeld.** Eine Veranstaltung
 * über Mitternacht ist der Normalfall dieses Gewerks; eine Dauer in Stunden
 * liesse offen, an welchem Tag sie endet, und der Dienst müsste es raten.
 */

export interface KundeAuswahl { readonly id: string; readonly name: string }
export interface ObjektAuswahl { readonly id: string; readonly bezeichnung: string }
export interface LeitungAuswahl { readonly id: string; readonly name: string }
export interface LeistungAuswahl {
  readonly id: string;
  readonly bezeichnung: string;
  readonly auftragsnummer: string;
}

export interface VeranstaltungFormularProps {
  readonly zurueck: string;
  readonly kunden: readonly KundeAuswahl[];
  readonly objekte: readonly ObjektAuswahl[];
  readonly leitungen: readonly LeitungAuswahl[];
  readonly leistungen: readonly LeistungAuswahl[];
  readonly t: VeranstaltungTexte;
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function VeranstaltungFormular({
  zurueck, kunden, objekte, leitungen, leistungen, t,
}: VeranstaltungFormularProps) {
  return (
    <form method="post" action="/api/security/veranstaltungen"
          data-cse="veranstaltung-formular"
          className="flex max-w-[56ch] flex-col gap-s5">
      <input type="hidden" name="zurueck" value={zurueck} />
      <input type="hidden" name="aktion" value="anlegen" />

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.fuerWen}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.kunde}
            <select name="kunde" required className={FELD} defaultValue=""
                    data-cse="veranstaltung-kunde">
              <option value="" disabled>{t.kundeWaehlen}</option>
              {kunden.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.bezeichnung}
            <input name="bezeichnung" required maxLength={160} className={FELD}
                   placeholder={t.bezeichnungBeispiel}
                   data-cse="veranstaltung-bezeichnung" />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.anlass} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="anlass" maxLength={160} className={FELD}
                   placeholder={t.anlassBeispiel} />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.leistung} <span className="text-text-subtle">{t.freiwillig}</span>
            <select name="leistung" className={FELD} defaultValue="">
              <option value="">{t.ohneLeistung}</option>
              {leistungen.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.auftragsnummer} · {l.bezeichnung}
                </option>
              ))}
            </select>
            <span className="text-xs text-text-muted">{t.leistungErklaerung}</span>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.wo}</h2>
        <p className="mb-s4 mt-0 text-sm text-text-muted">{t.ortErklaerung}</p>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.objekt}
            <select name="objekt" className={FELD} defaultValue=""
                    data-cse="veranstaltung-objekt">
              <option value="">{t.ohneObjekt}</option>
              {objekte.map((o) => (
                <option key={o.id} value={o.id}>{o.bezeichnung}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.ortText}
            <input name="ort_text" maxLength={240} className={FELD}
                   placeholder={t.ortTextBeispiel}
                   data-cse="veranstaltung-ort-text" />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.wann}</h2>
        <p className="mb-s4 mt-0 text-sm text-text-muted">{t.zeitErklaerung}</p>
        <div className="flex flex-col gap-s4 sm:flex-row">
          <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
            {t.beginn}
            <input name="beginn" type="datetime-local" required className={FELD}
                   data-cse="veranstaltung-beginn" />
          </label>
          <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
            {t.ende}
            <input name="ende" type="datetime-local" required className={FELD}
                   data-cse="veranstaltung-ende" />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.wieViele}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.sollBesetzung}
            <input name="soll_besetzung" type="number" min={1} max={999} step={1}
                   defaultValue="1" required className={FELD}
                   data-cse="veranstaltung-besetzung" />
            <span className="text-xs text-text-muted">{t.besetzungErklaerung}</span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.besucher} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="besucher" type="number" min={0} step={1} className={FELD} />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.leitung} <span className="text-text-subtle">{t.freiwillig}</span>
            <select name="leitung" className={FELD} defaultValue="">
              <option value="">{t.ohneLeitung}</option>
              {leitungen.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        </div>
      </Card>

      <p className="m-0 max-w-prose text-sm text-text-muted">{t.besetzenIstSpaeter}</p>

      <div>
        <Button type="submit" variante="primary" data-cse="veranstaltung-speichern">
          {t.veranstaltungAnlegen}
        </Button>
      </div>
    </form>
  );
}
