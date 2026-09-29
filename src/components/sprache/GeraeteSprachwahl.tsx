import {
  PORTAL_BCP47, PORTAL_EIGENNAME, PORTAL_RICHTUNG, PORTAL_SPRACHEN, type PortalSprache,
} from '@/lib/i18n/texte';

/**
 * Die Sprachwahl der Flächen OHNE Sitzung — Stempeluhr und Anmeldung der
 * Beschäftigten (V-200, EMP-12, SEITENKARTE §12, DESIGN §5 „Filter pills", §8).
 *
 * **Verweise, keine Knöpfe.** Die Stempelfläche hat genau EINEN Knopf (DESIGN
 * §8: „one screen, one primary button"), und die Browserprüfung zählt ihn.
 * Die Wahl ist deshalb eine Reihe aus `<a>` in der Pillenform — DESIGN §5
 * kennt sie als Navigationsreihe: sie führt auf eine andere Adresse, und die
 * aktuelle trägt `aria-current`, damit die Farbe sie nicht allein markiert.
 *
 * **Ein gewöhnlicher Verweis und nicht `next/link`.** `next/link` lädt
 * sichtbare Ziele vorab; das Ziel hier setzt einen Keks
 * (`/api/geraetesprache`), und ein Vorabladen stellte die Sprache um, ohne dass
 * jemand getippt hat.
 *
 * **Jede Sprache nennt sich selbst** — „العربية", nicht „Arabisch" —, mit
 * `lang` und `dir` am Wort: wer die Seite nicht lesen kann, muss seine
 * Sprache trotzdem finden. 44 px je Ziel, 16 px Schrift (DESIGN §8).
 */
export function GeraeteSprachwahl({ aktiv, zurueck, label }: {
  readonly aktiv: PortalSprache;
  /** Die Seite, auf die die Wahl zurückführt — geprüft wird sie von der Route. */
  readonly zurueck: string;
  /** „Sprache" in der aktuellen Sprache — der Name der Reihe für Screenreader. */
  readonly label: string;
}) {
  return (
    <nav aria-label={label} data-cse="geraete-sprachwahl"
         className="flex justify-center">
      <ul className="m-0 flex list-none items-center gap-s1 rounded-full border border-line
                     bg-surface-3 p-s1">
        {PORTAL_SPRACHEN.map((s) => (
          <li key={s}>
            <a
              href={`/api/geraetesprache?sprache=${s}&zurueck=${encodeURIComponent(zurueck)}`}
              hrefLang={PORTAL_BCP47[s]}
              lang={PORTAL_BCP47[s]}
              dir={PORTAL_RICHTUNG[s]}
              data-sprache={s}
              aria-current={s === aktiv ? 'true' : undefined}
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-full px-s2
                          text-base transition-colors duration-fast ease-brand ${
                s === aktiv
                  ? 'bg-surface font-semibold text-text'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text'}`}
            >
              {PORTAL_EIGENNAME[s]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
