import type { ReactNode } from 'react';
import { Marke } from '@/components/marke/Marke';

/**
 * Der Rahmen aller `/auth`-Seiten (DESIGN §5 „Standalone pages").
 *
 * **Eine Anmeldung ist eine Seite ohne Navigation.** Kein Portalmenue (man ist
 * nicht drin), keine Websitenavigation (man will nicht dorthin) — nur der
 * Schritt, der jetzt dran ist, und ein Weg zurueck. Jede Ablenkung an dieser
 * Stelle ist ein Abbruch.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum die Flaeche einen eigenen Schwerpunkt braucht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Genau WEIL hier keine Navigation steht, hat die Seite nichts, woran sie
 * haengt. Die Vorfassung setzte ihren Inhalt oben links in ein schwarzes
 * Rechteck: Rueckweg, Ueberschrift, Formular, Fusszeile — lose untereinander,
 * ohne Flaeche darunter. Am Telefon fiel das nicht auf; auf einem Bildschirm
 * blieben zwei Drittel leer, und eine fertige Seite las sich wie eine, die
 * nicht geladen hat.
 *
 * Drei Dinge beheben das, und alle drei stehen in DESIGN §5:
 *
 *  1. **Mittig auf beiden Achsen** ab `sm`. Darunter oben ausgerichtet —
 *     sonst schiebt die Tastatur des Telefons die Karte aus dem Bild.
 *  2. **Eine Tafel** (`--surface`, Rand, `--r-xl`, `--s6`). Das Formular
 *     steht AUF etwas, nicht IN nichts.
 *  3. **Ein Lichthauch** (`bg-wash-brand`) hinter allem — genau einer,
 *     ohne Bewegung, ohne Ereignisse. Er gibt dem Auge ein Oben.
 *
 * **Das Markenzeichen steht UEBER der Tafel, nicht darin.** Es gehoert der
 * Seite, nicht dem Formular: wer hier landet, soll in einem Blick sehen, bei
 * wem er sich anmeldet. Der Rueckweg haengt daran (D-613) — `← CSE Gruppe`
 * ist der einzige Ausgang, den diese Seite hat.
 *
 * Der Schrittzaehler steht oben in der Tafel, wo er gelesen wird, bevor das
 * Formular gelesen wird: wer weiss, dass noch ein Schritt kommt, bricht beim
 * zweiten nicht ab.
 */
export function AuthSchale({
  titel, unterzeile, schritt, schritte, children, fuss, breit = false,
}: {
  readonly titel: string;
  readonly unterzeile?: ReactNode;
  readonly schritt?: number;
  readonly schritte?: number;
  readonly children: ReactNode;
  readonly fuss?: ReactNode;
  /** Fuer Auswahlseiten mit Zeilen — `max-w-wahl` statt `max-w-form` (§5). */
  readonly breit?: boolean;
}) {
  return (
    <div className="relative min-h-dvh">
      {/*
        * Der eine Lichthauch (§5). `fixed`, damit er beim Rollen einer langen
        * Auswahlliste nicht mitwandert; `pointer-events-none`, damit er
        * keinen Klick abfaengt; `aria-hidden`, weil er nichts sagt.
        */}
      <div aria-hidden="true"
           className="pointer-events-none fixed inset-0 bg-wash-brand" />

      <main className={`relative mx-auto flex min-h-dvh w-full flex-col
                        justify-start gap-s5 p-s5 sm:justify-center sm:p-s6
                        ${breit ? 'max-w-wahl' : 'max-w-form'}`}>
        {/* Die Marke traegt den Rueckweg — ein Ziel, ein Element (D-613). */}
        <a href="/" data-cse="auth-zurueck"
           className="group inline-flex items-center gap-s3 self-start rounded-md
                      p-s1 transition-colors duration-fast ease-brand">
          <Marke art="gruppe" groesse="lg" />
          <span className="flex flex-col">
            <span className="text-base font-semibold text-text">CSE Gruppe</span>
            <span className="text-xs text-text-subtle transition-colors duration-fast
                             ease-brand group-hover:text-text-muted">
              <span aria-hidden="true">←</span> Zur Website
            </span>
          </span>
        </a>

        <section className="flex flex-col gap-s5 rounded-xl border border-line
                            bg-surface p-s5 sm:p-s6">
          <header className="flex flex-col gap-s3">
            {schritt !== undefined && schritte !== undefined && (
              <p data-cse="auth-schritt"
                 className="flex items-center gap-s3 text-xs font-semibold uppercase
                            tracking-widest text-text-subtle">
                Schritt {schritt} von {schritte}
                {/*
                  * Der Fortschritt als BALKEN und nicht nur als Zahl: „Schritt
                  * 1 von 2" muss man lesen, einen halb gefuellten Balken sieht
                  * man. `aria-hidden`, weil der Satz daneben dasselbe sagt.
                  */}
                <span aria-hidden="true"
                      className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span className="h-full rounded-full bg-brand transition-all duration-base
                                   ease-brand"
                        style={{ width: `${String(Math.round((schritt / schritte) * 100))}%` }} />
                </span>
              </p>
            )}
            <h1 className="text-h1 text-text">{titel}</h1>
            {unterzeile !== undefined && (
              <p className="max-w-[58ch] text-base text-text-muted">{unterzeile}</p>
            )}
          </header>

          {children}
        </section>

        {fuss !== undefined && (
          <footer data-cse="auth-fuss"
                  className="flex flex-col gap-s3 px-s2 text-sm text-text-subtle">
            {fuss}
          </footer>
        )}
      </main>
    </div>
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
       className="rounded-md border border-danger bg-danger-soft p-s4 text-sm text-danger">
      {children}
    </p>
  );
}
