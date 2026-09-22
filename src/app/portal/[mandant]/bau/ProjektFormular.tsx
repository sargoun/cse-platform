import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ProjektTexte } from '@/lib/i18n/verwaltung/bau';

/**
 * Das Formular für ein Bauvorhaben (V-003, OPS-05, BAU-01).
 *
 * **Der Auftrag steht ganz oben und ist die erste Wahl**, weil er die
 * Identität des Projekts ist: `projekt_auftrag_uk` lässt genau eines je
 * Auftrag zu, und Kunde, Objekt und Nummer kommen aus seiner Zeile. Ein
 * Formular, das den Kunden daneben noch einmal fragte, liesse beide
 * auseinanderlaufen.
 *
 * **Die Vertragsgrundlage hat keinen Vorgabewert.** `VOB/B` und `BGB`
 * unterscheiden Fristen, Abnahme, Mängelrechte und den Umgang mit Nachträgen;
 * eine stille Voreinstellung wäre eine Rechtswahl, die niemand getroffen hat.
 * Deshalb steht dort eine leere Zeile „Bitte wählen", und der Dienst weist
 * ohne Wahl ab.
 *
 * **Geld steht in ganzen Cent** (Invariante 1) und der Einbehalt in
 * Basispunkten — beides sagt das Feld selbst, mit einem Beispiel.
 */

export interface AuftragAuswahl {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
}

export interface BauleitungAuswahl {
  readonly id: string;
  readonly name: string;
}

export interface ProjektFormularProps {
  readonly zurueck: string;
  readonly auftraege: readonly AuftragAuswahl[];
  readonly bauleitung: readonly BauleitungAuswahl[];
  readonly t: ProjektTexte;
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export function ProjektFormular({ zurueck, auftraege, bauleitung, t }: ProjektFormularProps) {
  return (
    <form method="post" action="/api/bau/projekte" data-cse="projekt-formular"
          className="flex max-w-[56ch] flex-col gap-s5">
      <input type="hidden" name="zurueck" value={zurueck} />
      <input type="hidden" name="aktion" value="anlegen" />

      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.woher}</h2>
        <p className="mb-s4 mt-0 text-sm text-text-muted">{t.auftragErklaerung}</p>
        <label className="flex flex-col gap-s2 text-sm text-text">
          {t.auftrag}
          <select name="auftrag" required className={FELD} defaultValue=""
                  data-cse="projekt-auftrag">
            <option value="" disabled>{t.auftragWaehlen}</option>
            {auftraege.map((a) => (
              <option key={a.id} value={a.id}>
                {a.auftragsnummer} · {a.bezeichnung}
              </option>
            ))}
          </select>
        </label>
        <p className="mb-0 mt-s3 text-xs text-text-muted">{t.kundeKommtVomAuftrag}</p>
        <p className="mb-0 mt-s2 text-xs text-text-muted">{t.nummerIstAuftragsnummer}</p>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.was}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.bezeichnung}
            <input name="bezeichnung" required maxLength={160} className={FELD}
                   placeholder={t.bezeichnungBeispiel} data-cse="projekt-bezeichnung" />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.art}
            <select name="art" required className={FELD} defaultValue="ausbau"
                    data-cse="projekt-art">
              <option value="hochbau">{t.artHochbau}</option>
              <option value="ausbau">{t.artAusbau}</option>
              <option value="rueckbau">{t.artRueckbau}</option>
            </select>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.vertragsgrundlage}
            <select name="vertragsgrundlage" required className={FELD} defaultValue=""
                    data-cse="projekt-grundlage">
              <option value="" disabled>{t.grundlageWaehlen}</option>
              <option value="vob_b">{t.grundlageVob}</option>
              <option value="bgb">{t.grundlageBgb}</option>
            </select>
            <span className="text-xs text-text-muted">{t.grundlageErklaerung}</span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.verantwortlich} <span className="text-text-subtle">{t.freiwillig}</span>
            <select name="verantwortlich" className={FELD} defaultValue="">
              <option value="">{t.ohneVerantwortlich}</option>
              {bauleitung.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.wann}</h2>
        <div className="flex flex-col gap-s4 sm:flex-row">
          <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
            {t.sollBeginn} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="soll_beginn" type="date" className={FELD} />
          </label>
          <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
            {t.sollEnde} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="soll_ende" type="date" className={FELD} />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-s4 mt-0 text-h3 text-text">{t.geld}</h2>
        <div className="flex flex-col gap-s4">
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.summe} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="summe_cent" inputMode="numeric" pattern="-?[0-9]*" className={FELD}
                   placeholder={t.summeBeispiel} />
            <span className="text-xs text-text-muted">{t.summeErklaerung}</span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            {t.einbehalt} <span className="text-text-subtle">{t.freiwillig}</span>
            <input name="einbehalt_bp" type="number" min={0} max={10000} step={1}
                   className={FELD} placeholder={t.einbehaltBeispiel} />
            <span className="text-xs text-text-muted">{t.einbehaltErklaerung}</span>
          </label>
        </div>
      </Card>

      <p className="m-0 max-w-prose text-sm text-text-muted">{t.naechsterSchritt}</p>

      <div>
        <Button type="submit" variante="primary" data-cse="projekt-speichern">
          {t.projektAnlegen}
        </Button>
      </div>
    </form>
  );
}
