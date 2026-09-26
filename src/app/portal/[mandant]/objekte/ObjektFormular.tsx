import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ObjekteTexte } from '@/lib/i18n/verwaltung/objekte';
import { koordinateAlsText } from '@/server/services/objekt/anlegen';

/**
 * Das Formular für ein Objekt — einmal zum Anlegen, einmal zum Ändern
 * (OPS-01, V-001, V-020).
 *
 * **Ein Baustein für beide Wege, weil es dieselben Felder sind.** Zwei
 * getrennte Formulare wären zwei Stellen, an denen „Zutritt" steht — und die
 * zweite ist die, die beim nächsten Feld vergessen wird. Was sich
 * unterscheidet, ist genau dreierlei: die Beschriftung des Knopfes, das
 * versteckte `aktion`, und ob die Objektnummer angeboten wird.
 *
 * **Die Nummer steht nur im Anlegen-Fall.** Sie steht auf Schlüsselschildern,
 * in Dienstanweisungen und auf jedem unterschriebenen Leistungsnachweis; sie
 * nachträglich zu ändern machte all diese Papiere still falsch.
 *
 * **Die Texte kommen von aussen** (`t`), nicht aus dieser Datei: die
 * Verwaltung läuft in zwei Sprachen (D-82), und ein Baustein, der seine
 * eigenen deutschen Wörter trägt, ist der Grund, warum eine halb übersetzte
 * Oberfläche entsteht.
 */

export interface KundeAuswahl {
  readonly id: string;
  readonly name: string;
}

export interface ObjektWerte {
  readonly bezeichnung: string;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly adresszusatz: string | null;
  readonly plz: string;
  readonly ort: string;
  readonly land: string;
  readonly kundeId: string | null;
  readonly gebaeudetyp: string | null;
  readonly etagenAnzahl: number | null;
  readonly zutrittHinweis: string | null;
  readonly bemerkung: string | null;
  /** Wie gespeichert (`52.520008`), oder `null` — beide oder keiner (V-170). */
  readonly geoLat: string | null;
  readonly geoLon: string | null;
}

export interface ObjektFormularProps {
  /** Wohin der Server bei einem Fehler zurückschickt. */
  readonly zurueck: string;
  /** `undefined` heisst anlegen; sonst die Kennung des Objekts. */
  readonly objektId?: string | undefined;
  readonly werte?: ObjektWerte | undefined;
  readonly kunden: readonly KundeAuswahl[];
  readonly t: ObjekteTexte;
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function ObjektFormular(
  { zurueck, objektId, werte, kunden, t }: ObjektFormularProps,
) {
  const aendern = objektId !== undefined;
  return (
    <form method="post" action="/api/objekt" data-cse="objekt-formular"
          className="flex max-w-[56ch] flex-col gap-s5">
      <input type="hidden" name="zurueck" value={zurueck} />
      <input type="hidden" name="aktion" value={aendern ? 'aendern' : 'anlegen'} />
      {aendern && <input type="hidden" name="id" value={objektId} />}

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.was}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.bezeichnung}
            <input name="bezeichnung" required className={FELD}
                   defaultValue={werte?.bezeichnung ?? ''}
                   placeholder={t.bezeichnungBeispiel}
                   data-cse="objekt-bezeichnung" />
          </label>
          {!aendern && (
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.objektnummer} <span className="text-text-subtle">{t.freiwillig}</span>
              <input name="objektnummer" className={FELD}
                     placeholder={t.objektnummerBeispiel}
                     data-cse="objekt-nummer" />
              <span className="text-xs text-text-muted">{t.objektnummerHinweis}</span>
            </label>
          )}
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.gebaeudetyp} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="gebaeudetyp" className={FELD}
                   defaultValue={werte?.gebaeudetyp ?? ''}
                   placeholder={t.gebaeudetypBeispiel} />
            {/* // TODO(client, O-69): Kontrolliertes Vokabular fuer Gebaeudetyp? */}
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.etagen} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="etagenAnzahl" inputMode="numeric" className={FELD}
                   defaultValue={werte?.etagenAnzahl === null || werte === undefined
                     ? '' : String(werte.etagenAnzahl)} />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.wo}</h2>
        <p className="mb-s4 mt-0 text-sm text-text-muted">{t.anschriftPflicht}</p>
        <div className="flex flex-col gap-s4">
          <div className="flex gap-s3">
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.strasse}
              <input name="strasse" required className={FELD}
                     defaultValue={werte?.strasse ?? ''}
                     autoComplete="address-line1" data-cse="objekt-strasse" />
            </label>
            <label className="flex w-24 flex-col gap-s2 text-sm text-text">
              {t.hausnummer}
              <input name="hausnummer" className={FELD}
                     defaultValue={werte?.hausnummer ?? ''} />
            </label>
          </div>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.adresszusatz} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="adresszusatz" className={FELD}
                   defaultValue={werte?.adresszusatz ?? ''}
                   placeholder={t.adresszusatzBeispiel} />
          </label>
          <div className="flex gap-s3">
            <label className="flex w-28 flex-col gap-s2 text-sm text-text">
              {t.plz}
              <input name="plz" required className={FELD}
                     defaultValue={werte?.plz ?? ''}
                     autoComplete="postal-code" data-cse="objekt-plz" />
            </label>
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.ort}
              <input name="ort" required className={FELD}
                     defaultValue={werte?.ort ?? ''}
                     autoComplete="address-level2" data-cse="objekt-ort" />
            </label>
            <label className="flex w-20 flex-col gap-s2 text-sm text-text">
              {t.land}
              <input name="land" className={FELD} maxLength={2}
                     defaultValue={werte?.land ?? 'DE'} />
            </label>
          </div>
          {/*
            * V-170 (OPS-01): die Spalten gab es seit 0021, kein Formular fragte
            * danach — und das Bautagebuch meldete für jede Baustelle
            * „Keine Koordinaten am Objekt hinterlegt", ohne einen Ort, an dem
            * man sie hätte eintragen können. Text statt `type="number"`: ein
            * deutsches Komma soll ankommen und im Dienst geprüft werden.
            */}
          <div className="flex gap-s3">
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.breitengrad} <span className="text-text-subtle">{t.freiwillig}</span>
              <input name="geoLat" inputMode="decimal" className={FELD}
                     defaultValue={koordinateAlsText(werte?.geoLat ?? null)}
                     placeholder={t.breitengradBeispiel} data-cse="objekt-geo-lat" />
            </label>
            <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
              {t.laengengrad} <span className="text-text-subtle">{t.freiwillig}</span>
              <input name="geoLon" inputMode="decimal" className={FELD}
                     defaultValue={koordinateAlsText(werte?.geoLon ?? null)}
                     placeholder={t.laengengradBeispiel} data-cse="objekt-geo-lon" />
            </label>
          </div>
          <span className="text-xs text-text-muted">{t.koordinatenHinweis}</span>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.wem}</h2>
        <p className="mb-s4 mt-0 text-sm text-text-muted">{t.kundeFreiwillig}</p>
        <label className="flex flex-col gap-s2 text-sm text-text">
          {t.kunde}
          <select name="kundeId" className={FELD} data-cse="objekt-kunde"
                  defaultValue={werte?.kundeId ?? ''}>
            <option value="">{t.ohneKunde}</option>
            {kunden.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </label>
      </Card>

      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.intern}</h2>
        <p className="mb-s4 mt-0 text-sm text-text-muted">{t.nurIntern}</p>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.zutritt}
            <textarea name="zutrittHinweis" rows={3} className={FELD}
                      defaultValue={werte?.zutrittHinweis ?? ''}
                      placeholder={t.zutrittBeispiel} />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.bemerkung}
            <textarea name="bemerkung" rows={3} className={FELD}
                      defaultValue={werte?.bemerkung ?? ''} />
          </label>
        </div>
      </Card>

      <Button type="submit" variante="primary" className="self-start"
              data-cse="objekt-speichern">
        {aendern ? t.aenderungenSpeichern : t.objektAnlegen}
      </Button>
    </form>
  );
}
