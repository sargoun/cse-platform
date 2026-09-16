import type { BereichSchluessel } from '@/lib/design/theme';
import { shellTexte } from '@/lib/i18n/texte';
import { GesellschaftsWahl } from './GesellschaftsWahl';
import { Logo, Marke } from '@/components/marke/Marke';
import { EIGENNAME, SPRACHEN, mitSprache, type Sprache } from '@/lib/sprache';
import { berlinKalendertag } from '@/server/services/zeit/dauer';

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
  /*
   * **Das Jahr in BERLINER Zeit, nicht in der des Servers** (Invariante 2).
   *
   * Hier stand `new Date().getFullYear()` mit dem Vermerk „eine Fusszeile ist
   * kein Zeiteintrag". Das stimmt — und trotzdem war es falsch: der Server
   * läuft in UTC, und zwischen 00:00 und 01:00 Berliner Zeit am Neujahrstag
   * ist dort noch der 31. Dezember. Eine Stunde im Jahr stünde im Impressum
   * das alte Jahr. Eine Stunde ist wenig; ein Copyright-Vermerk mit dem
   * falschen Jahr ist trotzdem eine falsche Angabe, und die Regel lautet
   * „angezeigt wird Europe/Berlin" ohne Ausnahme für Kleinigkeiten.
   */
  const jahr = Number(berlinKalendertag(new Date()).slice(0, 4));
  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      {/*
        * **Drei Stufen, nicht zwei** (DESIGN §5 Navigation, D-417).
        *
        * Die volle Zeile — Auftrittsname, vier Punkte, Gesellschaftswahl,
        * roter Knopf, Anmelden, Sprachwahl — braucht rund 1130px. Sie stand
        * ab `md` (768px), und gemessen hiess das: von 768 bis etwa 1090px lief
        * JEDE oeffentliche Seite waagerecht ueber, der Auftrittsname schrumpfte
        * auf 0px (`min-w-0` + `truncate`), der rote Knopf brach in zwei Zeilen
        * und die Sprachwahl stand ausserhalb des Fensters — auf jedem Tablet
        * und jedem kleinen Laptop. Die 375px- und 1280px-Pruefungen sahen
        * davon nichts.
        *
        *  - unter `lg`: Auftrittsname und Menueknopf, alles andere im Blatt
        *  - `lg` bis `xl`: dazu die vier Punkte und der rote Knopf (~745px)
        *  - ab `xl` (1280px): die volle Zeile
        */}
      <header
        data-cse="oeffentlicher-kopf"
        /* Klebt oben: der obere Inset gehoert an ihn, nicht an den Inhalt
           darunter (DESIGN §8). `sicher-seiten` haelt ihn im Querformat von
           der Rundung weg. */
        /*
         * `box-content`: `sicher-oben` traegt den oberen Inset als Rahmen, und
         * ein Rahmen liegt bei `border-box` INNERHALB der 72px — im
         * installierten Modus waere die Leiste dann 72px hoch geblieben und
         * ihr Inhalt auf 25px zusammengedrueckt. Mit `content-box` sind die
         * 72px die Zeile, und der Inset kommt darueber.
         */
        className="sicher-oben sicher-seiten sticky top-0 z-40 box-content flex
                   h-[72px] items-center gap-s5 px-s5"
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
          * Reihe ohne Umbruch, und ab `lg` stehen rechts die Punkte und der rote
          * Knopf, ab `xl` auch „Anmelden" und die Sprachwahl mit fester
          * Mindestbreite (D-417). Ohne diese beiden Klassen
          * drueckt ein laengerer `gruppenname` — er kommt aus
          * `plattform_einstellung`, nicht aus dem Quelltext — die Zeile ueber
          * den Rand, und zwar auf JEDER oeffentlichen Seite.
          *
          * **Die Kuerzung ist die Notbremse, nicht der Normalfall.** Sie hat
          * einmal den Normalfall getragen: mit der Sprachwahl im Telefonkopf
          * blieben dem Namen 118px von 146, und „CSE Gruppe" stand als
          * „CSE Gr…" da. Seit D-415 steht auf dem Telefon nur noch der Name
          * neben dem Menueknopf, und DESIGN §5 sagt zu: bei 360px und darueber
          * wird nicht gekuerzt. Greift die Bremse doch, ist der Name in den
          * Einstellungen zu lang — nicht die Zeile zu eng.
          */}
        <a
          href={mitSprache('/', sprache)}
          aria-label={t.zurStartseite}
          data-cse="kopf-logo"
          className="flex min-h-11 min-w-0 items-center gap-s2 text-h3 text-text"
        >
          <Marke art="gruppe" groesse="md" />
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
        <nav aria-label={t.hauptnavigation} className="ml-auto hidden gap-s4 lg:flex">
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
          * Es gab keines. Die Hauptnavigation ist `hidden lg:flex`, und
          * darunter stand NICHTS: auf einem Telefon fuehrte vom oeffentlichen
          * Auftritt kein Weg zu Unternehmen, Leistungen, Projekten oder
          * Kontakt. Vier gebaute Seiten, kein Verweis — dasselbe Muster wie im
          * Portal, nur auf dem Geraet, mit dem die meisten Besucher kommen.
          *
          * `<details>` und kein Zustand im Browser: das Blatt oeffnet ohne
          * JavaScript und ist damit auch dann da, wenn das Netz schlecht ist.
          * Derselbe Weg wie im Portal (`TabLeiste`), aus demselben Grund.
          */}
        <details data-cse="menue" className="order-last ml-auto xl:hidden lg:ml-s3">
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
                * Der Kopf ist 72px hoch und traegt unter `xl` schon den
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
              {/*
                * **Die Sprachwahl auf dem Telefon — hier** (DESIGN §5).
                *
                * Zwei Punkte in der Liste, die schon offen ist, statt zweier
                * Verweise in einer Zeile, die keinen Platz hat. Und hier steht
                * der Eigenname ausgeschrieben: das Kuerzel „DE" gab es nur,
                * weil im Kopf nichts anderes mehr hineinging.
                *
                * **Kein zweites `nav` und kein zweites `data-cse="sprachwahl"`.**
                * Zwei gleich benannte Landmarken sind fuer einen Screenreader
                * nicht unterscheidbar und fuer jeden Locator zwei Treffer —
                * daran fielen schon einmal dreizehn Sprachpruefungen. Diese
                * Punkte liegen IM Menue-`nav` und tragen eine eigene Kennung.
                */}
              {SPRACHEN.filter((s) => s !== sprache).map((s) => (
                <li key={s} className="border-b border-line">
                  <a
                    href={mitSprache(pfad, s)}
                    hrefLang={s}
                    lang={s}
                    data-sprache={s}
                    data-cse="menue-sprache"
                    className="flex min-h-11 items-center py-s3 text-base text-text-muted"
                  >
                    {EIGENNAME[s]}
                  </a>
                </li>
              ))}
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
          * **Und trotzdem `lg:flex`** — am Telefon steht in der Kopfzeile
          * NICHTS ausser dem Namen und dem Menue. Hier standen einmal drei
          * Absaetze uebereinander, von denen einer erklaerte, warum dieser
          * Knopf NICHT hinter `lg:` liegt; er lag da bereits. Ein Kommentar,
          * der das Gegenteil des Codes darunter behauptet, ist schlechter als
          * keiner.
          *
          * Der Grund fuer `lg:`: erst der Auftrittsname, dann „Anmelden",
          * dann der rote Knopf, das Menue und die Sprachwahl — bei 375px
          * schob das die Zeile ueber den Rand, und „kein waagerechtes
          * Scrollen bei 375px" fiel auf `/` wie auf `/en`. DESIGN §5 sagt es
          * auch: „Mobile: full-screen overlay menu." Nicht „dasselbe, nur
          * enger", sondern: unter `lg` gehoert alles in das Blatt — und das
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
                     hover:bg-brand-hover lg:ml-s4 lg:flex"
        >
          {t.angebotAnfragen}
        </a>

        {anmeldePfad !== null && (
          <a
            href={anmeldePfad}
            data-cse="anmelden"
            className="ml-s3 hidden min-h-11 items-center rounded-sm border border-line
                       px-s4 text-sm text-text transition-colors duration-fast ease-brand
                       hover:bg-surface-2 xl:flex"
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
        {/*
          * **`hidden xl:flex` — unterhalb von `xl` steht die Sprachwahl im
          * Blatt, nicht im Kopf** (DESIGN §5, D-415, D-417).
          *
          * Sie stand hier, sie kostete 96px einer 72px-Zeile, und was wich,
          * war der Name: bei 360–414px rechnete der Auftrittsname 146px und
          * bekam 118. Sichtbar war davon „CSE Gr…" — sauber gesetzt, mit
          * Auslassungszeichen, auf JEDER oeffentlichen Seite.
          *
          * **Und die 375px-Pruefung blieb gruen, WEIL gekuerzt wurde.** Sie
          * misst `scrollWidth > clientWidth`; `truncate` verhindert genau das.
          * Die Zusage „kein waagerechtes Scrollen" war erfuellt, die Zeile
          * darunter trotzdem falsch — deshalb prueft sie jetzt beides.
          */}
        <nav
          aria-label={t.sprachwahl}
          data-cse="sprachwahl"
          className="ml-s4 hidden items-center gap-s2 xl:flex"
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
              /* 44×44 (DESIGN §8) — auch fuer ein Wort wie „Deutsch". */
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-sm px-s2
                          text-sm ${
                s === sprache ? 'text-text' : 'text-text-muted hover:text-text'}`}
            >
              {/*
                * Immer der Eigenname: die Wahl steht nur noch ab `xl` in der
                * Zeile (D-417), und dort ist Platz. Das Kuerzel „DE" gab es
                * nur, weil die Zeile einmal bei 375px voll war — jetzt liegt
                * sie dort im Blatt, ausgeschrieben.
                */}
              {EIGENNAME[s]}
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
      <footer data-cse="oeffentlicher-fuss" className="border-t border-line bg-surface">
        <div className="mx-auto max-w-content px-s5 py-s7">
          {/*
            * Drei Spalten ab `md`: die Marke mit ihrem Satz, die vier
            * Gesellschaften mit ihren Anschriften, das Rechtliche. Darunter
            * die Zeile mit Jahr und Hinweis. Vorher standen vier Anschriften
            * als lose Zeilen am linken Rand — kein Bild, keine Ordnung.
            *
            * Die NAP-Liste bleibt EINE Liste mit vier reinen Zeilen
            * (`[data-cse="nap"] li`): `seo.spec.ts` liest sie zeichengleich
            * gegen `llms.txt`, deshalb steht der Verweis auf die Gesellschaft
            * in einer eigenen Liste daneben und nicht in derselben Zeile.
            */}
          <div className="grid grid-cols-1 gap-s6 md:grid-cols-[1.4fr_1.6fr_auto] md:gap-s7">
            <div className="min-w-0">
              <Logo art="gruppe" name={gruppeName} groesse="lg" href={mitSprache('/', sprache)} />
              <p className="mt-s3 max-w-[38ch] text-sm leading-relaxed text-text-muted">{t.leitsatz}</p>
            </div>

            <div className="min-w-0">
              <h2 className="mb-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">
                {t.gesellschaftenNav}
              </h2>
              <nav aria-label={t.gesellschaftenNav}>
                <ul className="m-0 grid list-none grid-cols-1 gap-x-s5 gap-y-s1 p-0 sm:grid-cols-2">
                  {bereiche.map((b) => (
                    <li key={b.slug}>
                      <a
                        href={mitSprache(`/unternehmen/${b.slug}`, sprache)}
                        data-cse="fuss-gesellschaft"
                        aria-current={b.slug === aktiv ? 'page' : undefined}
                        className="flex min-h-11 items-center gap-s2 text-sm text-text-muted transition-colors duration-fast ease-brand hover:text-text"
                      >
                        <Marke art={b.bereich} groesse="sm" />
                        <span className="truncate">{b.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <h3 className="mb-s2 mt-s4 text-micro uppercase tracking-[0.08em] text-text-subtle">
                {t.anschriften}
              </h3>
              {/* Vier Gesellschaften, vier Anschriften — jede aus ihrer `mandant`-Zeile. */}
              <ul data-cse="nap" className="m-0 flex list-none flex-col gap-s1 p-0 text-xs leading-relaxed text-text-subtle">
                {bereiche.map((b) => <li key={b.slug}>{b.nap}</li>)}
              </ul>
            </div>

            <div className="min-w-0">
              <h2 className="mb-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">
                {t.rechtlichesNav}
              </h2>
              <nav aria-label={t.rechtlichesNav}>
                <ul className="m-0 flex list-none flex-col gap-s1 p-0">
                  {RECHTLICH.map(([ziel, schluessel]) => (
                    <li key={schluessel}>
                      <a
                        href={mitSprache(ziel, sprache)}
                        className="flex min-h-11 items-center text-sm text-text-muted transition-colors duration-fast ease-brand hover:text-text"
                      >
                        {t.rechtlich[schluessel]}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>

          <div className="mt-s6 flex flex-col gap-s2 border-t border-line pt-s4 text-xs text-text-subtle sm:flex-row sm:items-baseline sm:justify-between">
            <p className="m-0">© {jahr} {gruppeName}. {t.alleRechte}</p>
            {/*
              * §5 TMG und DSGVO Art. 13 verlangen die Pflichtangaben auf Deutsch.
              * Die englische Fassung ist eine Lesehilfe — und sagt das, statt es
              * offenzulassen.
              */}
            {t.rechtsverbindlichHinweis !== '' && (
              <p data-cse="rechtshinweis" className="m-0 max-w-[60ch]">
                {t.rechtsverbindlichHinweis}
              </p>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
