import type { ReactNode } from 'react';

/**
 * Der Rahmen aller `/auth`-Seiten.
 *
 * **Eine Anmeldung ist eine Seite ohne Navigation.** Kein Portalmenue (man ist
 * nicht drin), keine Websitenavigation (man will nicht dorthin) — nur der
 * Schritt, der jetzt dran ist, und ein Weg zurueck. Jede Ablenkung an dieser
 * Stelle ist ein Abbruch.
 *
 * Der Schrittzaehler steht oben, wo er gelesen wird, bevor das Formular
 * gelesen wird: wer weiss, dass noch ein Schritt kommt, bricht beim zweiten
 * nicht ab.
 */
export function AuthSchale({
  titel, unterzeile, schritt, schritte, children, fuss,
}: {
  readonly titel: string;
  readonly unterzeile?: ReactNode;
  readonly schritt?: number;
  readonly schritte?: number;
  readonly children: ReactNode;
  readonly fuss?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-form flex-col gap-s5 p-s6">
      <a href="/" className="inline-flex items-center gap-s2 self-start text-sm font-semibold
                             tracking-wide text-text-muted transition-colors duration-fast
                             ease-brand hover:text-text">
        <span aria-hidden="true">←</span> CSE Gruppe
      </a>

      <header className="flex flex-col gap-s3">
        {schritt !== undefined && schritte !== undefined && (
          <p data-cse="auth-schritt" className="text-xs font-semibold uppercase tracking-widest
                                                text-text-subtle">
            Schritt {schritt} von {schritte}
          </p>
        )}
        <h1 className="text-h1 text-text">{titel}</h1>
        {unterzeile !== undefined && (
          <p className="max-w-[58ch] text-base text-text-muted">{unterzeile}</p>
        )}
      </header>

      {children}

      {fuss !== undefined && (
        <footer className="flex flex-col gap-s2 border-t border-line pt-s4 text-sm text-text-subtle">
          {fuss}
        </footer>
      )}
    </main>
  );
}

/**
 * Ein Fehler am Formular, nicht an einem Feld.
 *
 * DESIGN §5 kennt keinen `danger`-Hinweis: ein Fehler gehoert ans Feld. „E-Mail
 * oder Kennwort stimmt nicht" gehoert aber an KEINES der beiden Felder — zu
 * sagen, welches, waere genau die Auskunft, die AUT-06 verweigert. Also steht
 * er ueber dem Formular, in der Sprache eines Feldfehlers: Rand in `danger`,
 * Text in `danger`, `role="alert"`, damit ein Screenreader ihn sofort liest.
 */
export function AuthFehler({ cse, children }: { readonly cse: string; readonly children: ReactNode }) {
  return (
    <p data-cse={cse} role="alert"
       className="rounded-md border border-danger p-s4 text-sm text-danger">
      {children}
    </p>
  );
}
