import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';
import type { PortalSprache } from '@/lib/i18n/texte';

/**
 * Die Zeile „Gefiltert: … · Alle anzeigen" über einer Liste (DSH-04, V-150).
 *
 * **Warum es sie geben muss.** Eine Kachel führt auf die Liste MIT dem
 * Filter, der ihre Menge zeigt (`?status=aktiv`). Stünde der Filter nur in
 * der Adresse, sähe die Liste aus wie „alle Aufträge" — und wer vom Dashboard
 * kommt, hielte vierzehn aktive für alle, die es gibt. Deshalb steht er als
 * Satz über der Liste, mit dem Weg zurück zur ganzen.
 *
 * Dieselbe Form wie der Monatsfilter der Rechnungsliste (`monat-filter`).
 */
export function Listenfilter({ sprache, beschreibung, alleZiel }: {
  readonly sprache: PortalSprache | null;
  /** Was gefiltert ist, schon übersetzt — z. B. „aktiv". */
  readonly beschreibung: string;
  /** Die ungefilterte Liste. */
  readonly alleZiel: string;
}) {
  const t = nachSprache(KENNZAHL_TEXTE, sprache);
  return (
    <p data-cse="listen-filter" className="mb-s5 text-sm text-text-muted">
      {t.gefiltert} <strong className="text-text">{beschreibung}</strong>{' · '}
      {/* `<a>` und nicht `Link`: das Ziel entsteht zur Laufzeit (wie `KachelRaster`). */}
      <a href={alleZiel} className="underline underline-offset-2 hover:text-text"
         data-cse="listen-filter-alle">
        {t.alleZeigen}
      </a>
    </p>
  );
}
