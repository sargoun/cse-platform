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
 * Ein Baustein und keine Abschrift je Seite: fünf Masken setzen denselben
 * Anker (Einzelschicht, zwei Turnusmasken, Turnuspflege, Posten), und eine
 * Abschrift, die beim nächsten Satz zurückbleibt, erklärte die Abrechnung
 * falsch.
 *
 * **Ohne `auftrag.lesen` gibt es KEIN Feld** (`leistungen === null`), sondern
 * einen Satz. Ein Auswahlfeld, dessen Liste die RLS leert, schickte beim
 * Speichern „ohne" — und löschte in einer Pflegemaske den Anker, den jemand
 * anderes gesetzt hat. Kein Feld heisst: der Anker bleibt.
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
  const vorhanden = gewaehlt !== null && leistungen.some((l) => l.id === gewaehlt);
  return (
    <label className="flex flex-col gap-s2 text-sm text-text">
      {t.feld}
      <select name={name} className={feldKlasse} defaultValue={vorhanden ? gewaehlt : ''}
              data-cse="leistungsanker">
        <option value="">{t.ohne}</option>
        {leistungen.map((l) => (
          <option key={l.id} value={l.id}>
            {l.auftragsnummer} · {t.position} {l.positionNr} · {l.bezeichnung}
            {l.lebt ? '' : ` (${t.beendet})`}
          </option>
        ))}
      </select>
      <span className="text-xs text-text-muted">
        {leistungen.length === 0 ? t.keineZeilen : t.erklaerung}
      </span>
    </label>
  );
}
