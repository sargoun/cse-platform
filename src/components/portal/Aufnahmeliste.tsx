import type { SchichtMedium } from '@/server/services/mitarbeiter/medien';
import type { AufnahmelisteTexte } from '@/lib/i18n/verwaltung/aufnahmen';

/**
 * Die Aufnahmen einer Wachbuchseite oder einer Schicht, wie die Verwaltung
 * sie sieht (SEC-05, TIM-10, V-181).
 *
 * **Ein LINK je Aufnahme, kein eingebettetes Bild** — dieselbe Regel wie auf
 * der Fotoseite der Schicht: die signierte Adresse gilt fuenfzehn Minuten,
 * ein zwischengespeichertes `src` liefert danach einen Fehler, und die
 * Adresse entsteht nur, wo die Sitzung die Zeile lesen darf
 * (`signierteAdressen`). Wo keine Adresse entstehen konnte, steht der Grund
 * da: die Datei ist nach Ablauf der Aufbewahrung entfernt (LEG-09), oder der
 * Speicher ist gerade nicht erreichbar — nie ein toter Bildrahmen.
 *
 * Die Zeit ist die SERVERZEIT der Zeile, fertig aus der Datenbank
 * (Invariante 2, Invariante 5). Die Sätze kommen aus `AUFNAHMEN_TEXTE`
 * (`lib/i18n/verwaltung/aufnahmen.ts`), in der Sprache der Sitzung.
 */
export interface Aufnahme {
  readonly medium: SchichtMedium;
  readonly adresse: string | null;
}

export function Aufnahmeliste({
  aufnahmen, texte, marke,
}: {
  readonly aufnahmen: readonly Aufnahme[];
  readonly texte: AufnahmelisteTexte;
  /** `data-cse` je Zeile — damit ein Test die Zeilen findet, nicht das Layout. */
  readonly marke: string;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-s2 p-0">
      {aufnahmen.map(({ medium, adresse }, i) => (
        <li key={medium.id} data-cse={marke} className="text-sm text-text">
          {adresse !== null ? (
            <a
              href={adresse}
              className="inline-flex min-h-11 items-center underline underline-offset-2
                         hover:text-text-muted"
            >
              {texte.fotoOeffnen(i + 1)}
            </a>
          ) : (
            <span className="text-text-muted">
              {texte.fotoNummer(i + 1)}
              {' — '}
              {medium.entfernt ? texte.fotoEntfernt : texte.fotoOhneAdresse}
            </span>
          )}
          <span className="tabular-nums text-text-muted">
            {' · '}
            {texte.fotoErfasst(medium.erfasstLokal)}
          </span>
          {medium.beschreibung !== null && (
            <span className="text-text-muted">
              {' · '}
              {medium.beschreibung}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
