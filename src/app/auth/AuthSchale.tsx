import type { ReactNode } from 'react';
import { Marke } from '@/components/marke/Marke';
import { PORTAL_BCP47, PORTAL_RICHTUNG, type PortalSprache } from '@/lib/i18n/texte';
import { setzeEin } from '@/lib/i18n/vorlage';

/** Die drei Wörter des Rahmens — deutsch, solange eine Seite nichts anderes sagt. */
export interface SchalenBeschriftung {
  readonly marke: string;
  readonly zurWebsite: string;
  /** Mit `{schritt}` und `{schritte}`. */
  readonly schritt: string;
}

const DEUTSCH: SchalenBeschriftung = {
  marke: 'CSE Gruppe', zurWebsite: 'Zur Website', schritt: 'Schritt {schritt} von {schritte}',
};

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
 *
 * **Die Anmeldung der Beschäftigten spricht vier Sprachen** (V-200, EMP-12,
 * SEITENKARTE §12). Sie reicht `sprache`, die Wörter des Rahmens und die
 * Sprachwahl herein; der Rahmen setzt `lang` und `dir` (Arabisch läuft von
 * rechts) und schreibt Fliesstext dort in 16 px (DESIGN §8). Die Anmeldung
 * der Verwaltung reicht nichts davon und bleibt, wie sie war.
 */
export function AuthSchale({
  titel, unterzeile, schritt, schritte, children, fuss, breit = false,
  sprache, beschriftung = DEUTSCH, sprachwahl,
}: {
  readonly titel: string;
  readonly unterzeile?: ReactNode;
  readonly schritt?: number;
  readonly schritte?: number;
  readonly children: ReactNode;
  readonly fuss?: ReactNode;
  /** Fuer Auswahlseiten mit Zeilen — `max-w-wahl` statt `max-w-form` (§5). */
  readonly breit?: boolean;
  /** Die Sprache einer Fläche der Beschäftigten — setzt `lang`, `dir` und 16 px. */
  readonly sprache?: PortalSprache;
  readonly beschriftung?: SchalenBeschriftung;
  /** Die Sprachwahl (`GeraeteSprachwahl`) — neben der Marke, wo sie zuerst gefunden wird. */
  readonly sprachwahl?: ReactNode;
}) {
  const klein = sprache === undefined ? 'text-sm' : 'text-base';
  /*
   * **Der Rückweg führt in die Website der gewählten Sprache** — Englisch
   * auf `/en` (D-82), wie der Verweis auf die Datenschutzerklärung (D-694
   * Nr. 6). Arabisch und Türkisch haben keine eigene Website und führen auf
   * die deutsche. Hier stand fest `/`: wer „To the website" antippte, landete
   * auf der deutschen Startseite.
   */
  const website = sprache === 'en' ? '/en' : '/';
  return (
    <div className="relative min-h-dvh"
         {...(sprache === undefined ? {} : {
           lang: PORTAL_BCP47[sprache], dir: PORTAL_RICHTUNG[sprache], 'data-sprache': sprache,
         })}>
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
        <div className="flex flex-wrap items-center justify-between gap-s3">
          {/* Die Marke traegt den Rueckweg — ein Ziel, ein Element (D-613). */}
          <a href={website} data-cse="auth-zurueck"
             className="group inline-flex items-center gap-s3 self-start rounded-md
                        p-s1 transition-colors duration-fast ease-brand">
            <Marke art="gruppe" groesse="lg" />
            <span className="flex flex-col">
              <span className="text-base font-semibold text-text">{beschriftung.marke}</span>
              <span className={`${sprache === undefined ? 'text-xs' : 'text-base'} text-text-subtle
                                transition-colors duration-fast ease-brand
                                group-hover:text-text-muted`}>
                {/* Der Pfeil zeigt zurück — auf Arabisch nach rechts (§12). */}
                <span aria-hidden="true">{sprache === 'ar' ? '→' : '←'}</span>{' '}
                {beschriftung.zurWebsite}
              </span>
            </span>
          </a>
          {sprachwahl}
        </div>

        <section className="flex flex-col gap-s5 rounded-xl border border-line
                            bg-surface p-s5 sm:p-s6">
          <header className="flex flex-col gap-s3">
            {schritt !== undefined && schritte !== undefined && (
              <p data-cse="auth-schritt"
                 className={`flex items-center gap-s3 font-semibold text-text-subtle ${
                   sprache === undefined ? 'text-xs uppercase tracking-widest' : 'text-base'}`}>
                {setzeEin(beschriftung.schritt, {
                  schritt: String(schritt), schritte: String(schritte),
                })}
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
                  className={`flex flex-col gap-s3 px-s2 ${klein} text-text-subtle`}>
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
