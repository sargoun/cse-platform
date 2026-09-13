import type { BereichSchluessel } from '@/lib/design/theme';
import { shellTexte } from '@/lib/i18n/texte';
import { GesellschaftsWahl } from './GesellschaftsWahl';
import { EIGENNAME, SPRACHEN, mitSprache, type Sprache } from '@/lib/sprache';

/**
 * Die oeffentliche Shell — Kopf 72px, Fussbereich, Markenavatar-Reihe (PUB-14).
 *
 * **Keine Drittanbieter.** PUB-13 verbietet Tracker, und daraus folgt: kein
 * Cookie-Banner, weil es nichts zu erlauben gibt. Diese Shell laedt deshalb
 * keine externen Schriften, keine Analytik und kein Kartenskript — der
 * Playwright-Test faengt jede Anfrage ab und zaehlt sie.
 */
export interface ShellBereich {
  readonly slug: string;
  readonly name: string;
  readonly bereich: BereichSchluessel;
  /**
   * Die eine Zeile aus `napAus()` — Firma, Strasse, PLZ und Ort.
   *
   * Sie kommt fertig formatiert herein und wird hier NICHT zusammengesetzt.
   * PUB-12 verlangt eine ueber alle Flaechen hinweg zeichengleiche Anschrift,
   * und zwei Schreibweisen derselben Adresse sind fuer eine Suchmaschine zwei
   * Unternehmen. Ein Literal im Fussbereich war genau dieser zweite Eintrag.
   */
  readonly nap: string;
}

/** §5 TMG und LEG-07: von jeder Seite aus erreichbar, nicht nur von der Startseite. */
const RECHTLICH = [
  ['/impressum', 'impressum'],
  ['/datenschutz', 'datenschutz'],
  ['/barrierefreiheit', 'barrierefreiheit'],
] as const;

/** Die Punkte der Kopfnavigation — Pfad und Schlüssel, Beschriftung je Sprache. */
const HAUPT = [
  ['/unternehmen', 'unternehmen'],
  ['/leistungen', 'leistungen'],
  ['/projekte', 'projekte'],
  ['/kontakt', 'kontakt'],
] as const;

export interface OeffentlicheShellProps {
  readonly bereiche: readonly ShellBereich[];
  /**
   * Der Slug der Gesellschaft, deren Seite offen ist — `null` sonst.
   *
   * `null` und nicht `undefined`: `exactOptionalPropertyTypes` laesst eine
   * ausgelassene Eigenschaft nicht mit `undefined` belegen, und das Layout
   * rechnet sie aus dem Pfad aus, hat also immer einen Wert zu uebergeben —
   * auch den leeren.
   */
  readonly aktiv?: string | null;
  /** Der Auftrittsname der Gruppe — aus `plattform_einstellung`, nicht als Literal. */
  readonly gruppeName: string;
  readonly sprache: Sprache;
  /**
   * Der Inhaltspfad OHNE Sprachpräfix — den die Sprachwahl umschaltet.
   *
   * Sie muss auf DIESELBE Seite in der anderen Sprache zeigen, nicht auf die
   * Startseite. Wer auf einer Leistungsseite die Sprache wechselt und dabei
   * seinen Platz verliert, wechselt sie kein zweites Mal.
   */
  readonly pfad: string;
  /**
   * Wohin „Anmelden" fuehrt — oder `null`, wenn es diesen Weg noch nicht gibt.
   *
   * **Warum als Eigenschaft und nicht als Literal.** Die echte Anmeldung
   * (Telefon + Einmalcode) ist PR 20 und noch nicht gebaut; bis dahin gibt es
   * nur `/dev/anmelden`, und das steht hinter `CSE_DEV_FLAECHEN`. Ein festes
   * Ziel hier waere in einem Produktionsbau ein Verweis ins Leere — also
   * entscheidet die Huelle nichts, sondern bekommt den Pfad von der Schicht,
   * die die Umgebung kennt. Ist er `null`, steht der Punkt gar nicht da:
   * lieber kein Knopf als einer, der auf 404 fuehrt.
   */
  readonly anmeldePfad?: string | null;
  readonly children: React.ReactNode;
}

export function OeffentlicheShell(
  { bereiche, aktiv, gruppeName, sprache, pfad, anmeldePfad = null, children }:
  OeffentlicheShellProps,
) {
  const t = shellTexte(sprache);
  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <header
        data-cse="oeffentlicher-kopf"
        className="sticky top-0 z-40 flex h-[72px] items-center gap-s5 px-s5"
      >
        {/*
          * **Der Unschaerfe-Grund liegt HIER und nicht auf dem `header`** —
          * und das ist der Unterschied zwischen einem Menue, das aufgeht, und
          * einem, das unter dem Bild verschwindet.
          *
          * `backdrop-filter` macht ein Element zum ENTHALTENDEN BLOCK fuer
          * `position: fixed` in seinem Inneren (CSS Filter Effects §3, wie
          * `transform` und `filter`). Stand `backdrop-blur` am `header`, dann
          * rechnete das Vollbild-Blatt darunter — `fixed inset-x-0 top-[72px]
          * bottom-0` — nicht gegen das Fenster, sondern gegen eine Leiste von
          * 72px Hoehe: `top: 72px` und `bottom: 0` ergaben eine Hoehe von
          * NULL. Sichtbar blieb ein Streifen von wenigen Pixeln, und weil der
          * `z-index` des Blattes im Stapelkontext des Kopfes gefangen war, lag
          * er ausserdem unter dem Heldenbild. Auf dem Telefon fuehrte damit
          * kein Weg zu Unternehmen, Leistungen, Projekten oder Kontakt —
          * dieselbe Luecke, die dieses Menue schliessen sollte.
          *
          * Die Unschaerfe bleibt (DESIGN §5 verlangt sie), sie sitzt nur eine
          * Ebene tiefer. Der Kopf selbst traegt jetzt keinen Filter und damit
          * keinen enthaltenden Block.
          */}
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 border-b border-line bg-surface/80 backdrop-blur"
        />
        {/*
          * `min-h-11`: der Auftrittsname ist ein Verweis, also ein Tippziel
          * (DESIGN §8). Als blosser `text-h3` war er 30px hoch.
          *
          * `min-w-0` (mit `truncate` am Span darin): die Kopfzeile ist eine
          * Reihe ohne Umbruch, und rechts stehen „Anmelden" und die Sprachwahl
          * mit fester Mindestbreite.
          * Ohne diese beiden Klassen drueckt ein laengerer `gruppenname` — er
          * kommt aus `plattform_einstellung`, nicht aus dem Quelltext — die
          * Zeile ueber den Rand, und zwar auf JEDER oeffentlichen Seite. Das
          * Kuerzel in der Sprachwahl wurde genau deswegen eingefuehrt; die
          * Ursache lag daneben.
          */}
        <a
          href={mitSprache('/', sprache)}
          aria-label={t.zurStartseite}
          className="flex min-h-11 min-w-0 items-center text-h3 text-text"
        >
          {/*
            * `truncate` gehoert an das SPAN, nicht an das `a`.
            *
            * `text-overflow` greift nicht am Flex-Container — der Text waere
            * dort ein anonymes Flex-Element und wuerde ohne Auslassungszeichen
            * abgeschnitten. Und `min-w-0` gehoert dazu: `white-space: nowrap`
            * macht die Mindestbreite des Spans zur GANZEN Zeichenkette, und
            * ein Flex-Element schrumpft nicht unter seine Mindestbreite.
            */}
          <span className="min-w-0 truncate">{gruppeName}</span>
        </a>
        <nav aria-label={t.hauptnavigation} className="ml-auto hidden gap-s4 md:flex">
          {HAUPT.map(([ziel, schluessel]) => (
            <a
              key={schluessel}
              href={mitSprache(ziel, sprache)}
              className="text-sm text-text-muted transition-colors duration-fast ease-brand hover:text-text"
            >
              {t.navigation[schluessel]}
            </a>
          ))}
        </nav>

        {/*
          * Die Gesellschaftswahl steht NEBEN der Hauptnavigation und nicht
          * darin: „Unternehmen" fuehrt auf die Uebersicht aller vier, die Wahl
          * springt in eine davon. Zwei verschiedene Fragen, zwei Elemente.
          * DESIGN §6, D-381.
          */}
        <GesellschaftsWahl
          bereiche={bereiche}
          aktiv={aktiv ?? null}
          sprache={sprache}
          beschriftung={t.bereicheNav}
        />

        {/*
          * **Das Vollbild-Menue des Telefons** — DESIGN §5: „Mobile:
          * full-screen overlay menu".
          *
          * Es gab keines. Die Hauptnavigation ist `hidden md:flex`, und
          * darunter stand NICHTS: auf einem Telefon fuehrte vom oeffentlichen
          * Auftritt kein Weg zu Unternehmen, Leistungen, Projekten oder
          * Kontakt. Vier gebaute Seiten, kein Verweis — dasselbe Muster wie im
          * Portal, nur auf dem Geraet, mit dem die meisten Besucher kommen.
          *
          * `<details>` und kein Zustand im Browser: das Blatt oeffnet ohne
          * JavaScript und ist damit auch dann da, wenn das Netz schlecht ist.
          * Derselbe Weg wie im Portal (`TabLeiste`), aus demselben Grund.
          */}
        <details data-cse="menue" className="ml-auto md:hidden">
          <summary
            aria-label={t.menue}
            className="flex min-h-11 min-w-11 cursor-pointer list-none items-center
                       justify-center rounded-sm border border-line px-s3 text-sm text-text"
          >
            {t.menue}
          </summary>
          {/*
            `top-[72px]`: die Kopfzeile ist 72px hoch (DESIGN §5) und traegt
            das `<summary>`, mit dem sich das Blatt wieder schliesst. Laege es
            darueber, gaebe es ohne JavaScript keinen Weg zurueck.
          */}
          {/*
            * **Eine eigene Beschriftung, nicht noch einmal „Hauptnavigation".**
            *
            * Zwei `nav`-Elemente mit demselben Namen sind fuer einen
            * Screenreader zwei gleich heissende Landmarken — er kann sie nicht
            * auseinanderhalten, und die Sprungliste nennt beide gleich. Fuer
            * jeden Locator sind sie ausserdem ZWEI Treffer: dreizehn
            * Sprachpruefungen fielen daran, weil
            * `nav[aria-label="Main navigation"]` ploetzlich mehrdeutig war.
            */}
          <nav
            aria-label={t.menue}
            data-cse="menue-blatt"
            className="fixed inset-x-0 bottom-0 top-[72px] z-50 overflow-y-auto
                       bg-surface p-s5"
          >
            <ul className="m-0 list-none p-0">
              {HAUPT.map(([ziel, schluessel]) => (
                <li key={schluessel} className="border-b border-line">
                  <a
                    href={mitSprache(ziel, sprache)}
                    data-cse="menue-ziel"
                    className="flex min-h-11 items-center py-s3 text-base text-text"
                  >
                    {t.navigation[schluessel]}
                  </a>
                </li>
              ))}
              {/*
                * **Die vier Gesellschaften — auf dem Telefon HIER und nicht im
                * Kopf** (DESIGN §6, D-381).
                *
                * Der Kopf ist 72px hoch und traegt unter `md` schon den
                * Menueknopf; ein zweites Klappelement daneben waere bei 375px
                * kein Ziel mehr, das man trifft. Also eine Ebene tiefer, im
                * Blatt, das ohnehin offen ist, wenn jemand navigiert.
                *
                * Sie stehen VOR „Angebot anfragen", weil sie zu den Seiten
                * gehoeren und nicht zur Handlung: erst wohin, dann was.
                */}
              {bereiche.length > 1 && bereiche.map((b) => (
                <li key={b.slug} className="border-b border-line">
                  <a
                    href={mitSprache(`/unternehmen/${b.slug}`, sprache)}
                    data-cse="menue-gesellschaft"
                    aria-current={b.slug === aktiv ? 'page' : undefined}
                    className="flex min-h-11 items-center py-s3 text-base text-text-muted"
                  >
                    {b.name}
                  </a>
                </li>
              ))}
              <li className="border-b border-line">
                <a
                  href={mitSprache('/angebot', sprache)}
                  data-cse="menue-ziel"
                  className="flex min-h-11 items-center py-s3 text-base text-brand"
                >
                  {t.angebotAnfragen}
                </a>
              </li>
              {anmeldePfad !== null && (
                <li className="border-b border-line">
                  <a
                    href={anmeldePfad}
                    data-cse="menue-ziel"
                    className="flex min-h-11 items-center py-s3 text-base text-text"
                  >
                    {t.anmelden}
                  </a>
                </li>
              )}
            </ul>
          </nav>
        </details>

        {/*
          * **Der rote Knopf, den DESIGN §5 woertlich nennt** — „rot *Angebot
          * anfragen* + ghost *Login* rechts".
          *
          * Er fehlte, und mit ihm der einzige Weg, den dieser Auftritt
          * geschaeftlich hat: `/angebot` war gebaut, geprueft und erreichbar
          * — und stand in KEINER Navigation. Wer ein Angebot wollte, musste
          * die Adresse kennen. Derselbe Fehler wie die leere „Mehr"-Liste im
          * Portal, nur an der Stelle, an der er Geld kostet.
          *
          * **Und trotzdem `md:flex`** — am Telefon steht in der Kopfzeile
          * NICHTS ausser dem Namen und dem Menue. Hier standen einmal drei
          * Absaetze uebereinander, von denen einer erklaerte, warum dieser
          * Knopf NICHT hinter `md:` liegt; er lag da bereits. Ein Kommentar,
          * der das Gegenteil des Codes darunter behauptet, ist schlechter als
          * keiner.
          *
          * Der Grund fuer `md:`: erst der Auftrittsname, dann „Anmelden",
          * dann der rote Knopf, das Menue und die Sprachwahl — bei 375px
          * schob das die Zeile ueber den Rand, und „kein waagerechtes
          * Scrollen bei 375px" fiel auf `/` wie auf `/en`. DESIGN §5 sagt es
          * auch: „Mobile: full-screen overlay menu." Nicht „dasselbe, nur
          * enger", sondern: unter `md` gehoert alles in das Blatt — und das
          * Blatt fuehrt `/angebot` als ersten Punkt nach den vier Seiten.
          *
          * `min-h-11` sind 44px: DESIGN §8 nennt das Tap-Ziel nicht als
          * Richtwert, sondern als Untergrenze.
          */}
        <a
          href={mitSprache('/angebot', sprache)}
          data-cse="angebot-anfragen"
          className="ml-auto hidden min-h-11 items-center rounded-sm bg-brand px-s4
                     text-sm font-semibold text-white transition-colors duration-fast ease-brand
                     hover:bg-brand-hover md:ml-s4 md:flex"
        >
          {t.angebotAnfragen}
        </a>

        {anmeldePfad !== null && (
          <a
            href={anmeldePfad}
            data-cse="anmelden"
            className="ml-s3 hidden min-h-11 items-center rounded-sm border border-line
                       px-s4 text-sm text-text transition-colors duration-fast ease-brand
                       hover:bg-surface-2 md:flex"
          >
            {t.anmelden}
          </a>
        )}

        {/*
          * Die Sprachwahl: zwei Verweise, kein Auswahlfeld.
          *
          * Ein `<select>`, das beim Ändern navigiert, ist für Tastatur und
          * Screenreader eine Falle — die Pfeiltaste löst den Wechsel aus, bevor
          * jemand die Auswahl bestätigt hat. Zwei Links tun genau das, wonach
          * sie aussehen, und `hreflang` sagt der Maschine, was sie sind.
          */}
        <nav
          aria-label={t.sprachwahl}
          data-cse="sprachwahl"
          className="ml-s4 flex items-center gap-s2"
        >
          {SPRACHEN.map((s) => (
            <a
              key={s}
              href={mitSprache(pfad, s)}
              hrefLang={s}
              lang={s}
              data-sprache={s}
              aria-current={s === sprache ? 'true' : undefined}
              aria-label={EIGENNAME[s]}
              /*
               * 44×44 (DESIGN §8) — und `min-w-11` ist hier nicht Zierde:
               * unter `sm` steht im Verweis nur „DE", also ein Ziel von rund
               * 36×30 px. Das ist die Groesse, die man mit dem Daumen zweimal
               * verfehlt, und sie stand auf jeder oeffentlichen Seite genau
               * auf dem Geraet, fuer das das Kuerzel eingefuehrt wurde.
               */
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-sm px-s2
                          text-sm ${
                s === sprache ? 'text-text' : 'text-text-muted hover:text-text'}`}
            >
              {/*
                * Auf dem Telefon das Kürzel, ab `sm` der Eigenname.
                *
                * Nicht Geschmack, sondern Arithmetik: bei 375px stehen im Kopf
                * der Auftrittsname, „Anmelden" und zwei Sprachen nebeneinander,
                * und „Deutsch English" ausgeschrieben schob die Zeile über den
                * Rand — `documentElement.scrollWidth > clientWidth`, also
                * waagerechtes Scrollen auf JEDER öffentlichen Seite. Der
                * zugängliche Name bleibt der ausgeschriebene: `aria-label`
                * gewinnt gegen den Textinhalt, und `hreflang`/`lang` stehen
                * ohnehin daneben. Eine Maschine liest weiter „Deutsch".
                */}
              <span className="sm:hidden">{s.toUpperCase()}</span>
              <span className="hidden sm:inline">{EIGENNAME[s]}</span>
            </a>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      {/*
        * Die Gesellschaftswahl steht im KOPF (PUB-14, DESIGN §6, D-381) und
        * nicht hier — siehe `GesellschaftsWahl`. Unten bleiben die vier
        * Gesellschaften als Textlinks neben ihrer Anschrift: derselbe Weg,
        * anderer Anlass, und mit eigener Beschriftung. Zwei `nav` mit
        * demselben zugaenglichen Namen waeren ein mehrdeutiges Landmark und
        * im strikten Modus ein Locator-Verstoss — das hat dieser Zweig beim
        * Telefonmenue schon einmal gekostet.
        */}
      <footer className="border-t border-line bg-surface px-s5 py-s6">
        <nav aria-label={t.gesellschaftenNav} className="flex flex-wrap gap-s5">
          {bereiche.map((b) => (
            <a
              key={b.slug}
              href={mitSprache(`/unternehmen/${b.slug}`, sprache)}
              data-cse="fuss-gesellschaft"
              aria-current={b.slug === aktiv ? 'page' : undefined}
              className="flex min-h-11 items-center text-sm text-text-muted transition-colors duration-fast ease-brand hover:text-text"
            >
              {b.name}
            </a>
          ))}
        </nav>
        {/* Vier Gesellschaften, vier Anschriften — jede aus ihrer `mandant`-Zeile. */}
        <ul data-cse="nap" className="mt-s5 flex flex-col gap-s2 text-xs text-text-subtle">
          {bereiche.map((b) => <li key={b.slug}>{b.nap}</li>)}
        </ul>

        <nav aria-label={t.rechtlichesNav} className="mt-s5 flex flex-wrap gap-s4">
          {RECHTLICH.map(([ziel, schluessel]) => (
            <a
              key={schluessel}
              href={mitSprache(ziel, sprache)}
              className="text-xs text-text-muted transition-colors duration-fast ease-brand hover:text-text"
            >
              {t.rechtlich[schluessel]}
            </a>
          ))}
        </nav>

        {/*
          * §5 TMG und DSGVO Art. 13 verlangen die Pflichtangaben auf Deutsch.
          * Die englische Fassung ist eine Lesehilfe — und sagt das, statt es
          * offenzulassen.
          */}
        {t.rechtsverbindlichHinweis !== '' && (
          <p data-cse="rechtshinweis" className="mt-s4 text-xs text-text-subtle">
            {t.rechtsverbindlichHinweis}
          </p>
        )}
      </footer>
    </div>
  );
}
