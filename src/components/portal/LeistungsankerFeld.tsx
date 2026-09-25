import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { LEISTUNGSANKER_TEXTE } from '@/lib/i18n/verwaltung/leistungsanker';
import type { AnkerbareLeistung } from '@/server/services/dienstplan/leistungsanker';
import type { InternSprache } from '@/lib/i18n/intern';
import type { PortalSprache } from '@/lib/i18n/texte';

/**
 * Das Feld „Leistungszeile" — der Abrechnungsanker einer Schicht, eines
 * Turnus oder eines Postens (TIM-12, V-191).
 *
 * Ein Baustein und keine Abschrift je Seite: sieben Masken setzen denselben
 * Anker (Einzelschicht anlegen und Schichtblatt, zwei Turnusmasken,
 * Turnuspflege, Posten anlegen und Postenblatt), und eine Abschrift, die beim
 * nächsten Satz zurückbleibt, erklärte die Abrechnung falsch.
 *
 * **Ohne `auftrag.lesen` gibt es KEIN Feld** (`leistungen === null`), sondern
 * einen Satz. Ein Auswahlfeld, dessen Liste die RLS leert, schickte beim
 * Speichern „ohne" — und löschte in einer Pflegemaske den Anker, den jemand
 * anderes gesetzt hat. Kein Feld heisst: der Anker bleibt.
 *
 * **Jede Zeile nennt Kunde und Objekt ihres Auftrags** (V-192): ohne sie
 * liess sich ein Turnus am Objekt von Kunde A an den Auftrag von Kunde B
 * hängen, ohne dass es jemand sah. Ob das je richtig ist, fragt O-927.
 *
 * **Und der bisherige Anker ist immer gewählt** (V-192). Der Dienst liefert
 * ihn mit (`listeAnkerbareLeistungen(…, bisher)`), auch jenseits der
 * Obergrenze. Fehlt er trotzdem in der Liste, steht er als eigene Zeile da
 * und bleibt vorgewählt: ein Feld, das dann „ohne" vorwählte, löste den Anker
 * beim nächsten Speichern — in der Turnuspflege schon beim Ändern einer
 * Uhrzeit.
 */
export function LeistungsankerFeld({
  leistungen, gewaehlt, sprache, feldKlasse, name = 'auftrag_leistung',
}: {
  /** `null`: der Betrachter darf Aufträge nicht lesen — dann kein Feld. */
  readonly leistungen: readonly AnkerbareLeistung[] | null;
  readonly gewaehlt: string | null;
  readonly sprache: PortalSprache | InternSprache | null | undefined;
  readonly feldKlasse: string;
  readonly name?: string;
}) {
  const t = nachSprache(LEISTUNGSANKER_TEXTE, sprache);
  if (leistungen === null) {
    return (
      <p data-cse="leistungsanker-kein-recht" className="m-0 max-w-prose text-sm text-text-muted">
        {t.keinLeserecht} <Recht schluessel="auftrag.lesen" sprache={sprache ?? null} />. {t.bleibt}
      </p>
    );
  }
  const fehlt = gewaehlt !== null && !leistungen.some((l) => l.id === gewaehlt);
  return (
    <label className="flex flex-col gap-s2 text-sm text-text">
      {t.feld}
      <select name={name} className={feldKlasse} defaultValue={gewaehlt ?? ''}
              data-cse="leistungsanker">
        <option value="">{t.ohne}</option>
        {fehlt && gewaehlt !== null && (
          <option value={gewaehlt} data-cse="leistungsanker-bisher">{t.bisherNichtGelistet}</option>
        )}
        {leistungen.map((l) => (
          <option key={l.id} value={l.id}>
            {l.auftragsnummer} · {t.position} {l.positionNr} · {l.bezeichnung}
            {l.kunde === null ? '' : ` · ${l.kunde}`}
            {l.objekt === null ? '' : ` · ${l.objekt}`}
            {l.lebt ? '' : ` (${t.nichtWaehlbar})`}
          </option>
        ))}
      </select>
      <span className="text-xs text-text-muted">
        {leistungen.length === 0 ? t.keineZeilen : t.erklaerung}
      </span>
    </label>
  );
}
