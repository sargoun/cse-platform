import { StatusPill } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import { Marke } from '@/components/marke/Marke';
import { Glocke } from './Glocke';
import { Zurueck, type ZurueckProps } from './Zurueck';
import { TabLeiste } from './TabLeiste';
import { SeitenNavigation } from './SeitenNavigation';
import { istInterneLeiste, tableiste, type LeistenSchluessel } from '@/server/registry/tableiste';
import { Sprachumschalter } from './Sprachumschalter';
import { NAVIGATION } from '@/server/registry/navigation';
import { internBeschriftungen } from '@/lib/i18n/intern';
import { gemerkteHuelle } from '@/app/portal/huellen-speicher';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Der Rahmen einer angemeldeten Portalseite — als SERVER-Komponente.
 *
 * Die Vorschau unter `/dev/portal` ist eine Client-Komponente, weil sie den
 * Umschalter vorfuehrt. Die echten Seiten brauchen davon nichts: Kopfzeile,
 * Identitaetsstreifen und Tab-Leiste sind Auslieferung, keine Interaktion —
 * und was der Server rendert, kann kein Skript aushebeln.
 *
 * DESIGN §6 Regel 4: der 3px-Balken im Hue des aktiven Bereichs steht zu jeder
 * Zeit ganz oben. In der Gruppenansicht ist er neutral, weil dort kein Bereich
 * aktiv IST.
 */
export interface PortalRahmenProps {
  readonly titel: string;
  /**
   * Der Name der Portalwurzel, wenn `titel` ihn NICHT schon traegt.
   *
   * Dann zeigt die Kopfzeile eine Spur: `‹ Wurzel › Seite`, und der erste
   * Teil ist der Weg zurueck. Ohne ihn stand dort nur der Seitenname — der
   * zwar auf die Wurzel verwies, aber wie eine Ueberschrift aussah. „Wie
   * komme ich hier weg" wurde daraufhin zweimal gefragt, und das ist zweimal
   * mehr, als eine sichtbare Spur gekostet haette.
   */
  readonly wurzelTitel?: string;
  readonly bereich: BereichSchluessel | null;
  readonly nurLesen: boolean;
  readonly leiste: LeistenSchluessel;
  readonly wurzel: string;
  readonly aktiverTab?: string;
  /**
   * Je Tab-Schluessel: darf er erscheinen? Kommt aus `portalZugang`, das ihn
   * in derselben gebundenen Transaktion bewertet wie den Zugang zur Seite.
   */
  readonly sichtbareTabs?: Readonly<Record<string, boolean>>;
  /**
   * Je NAVIGATIONS-Schluessel (`crm`, `objekte`, …): darf der Punkt
   * erscheinen? Fuellt die Sidebar UND das Blatt hinter `Mehr` — beide lesen
   * unter `schluessel`, nicht unter `recht`.
   */
  readonly navigationsRechte?: Readonly<Record<string, boolean>>;
  /**
   * Uebersetzte Beschriftungen (D-419): je Tab-Schluessel fuer Leiste und
   * Schiene, und unter `sitzung.*` fuer die Kopfzeile (`konto`, `website`,
   * `abmelden`). Das Mitarbeiterportal spricht vier Sprachen (EMP-12); das
   * interne Portal laesst die Angabe weg und bekommt die deutschen Labels des
   * Registers.
   */
  readonly beschriftungen?: Readonly<Record<string, string>>;
  /**
   * Der Weg eine Ebene HINAUF — auf jede Seite, ueber der eine Liste steht
   * (DESIGN §5 „The way back", D-613).
   *
   * **Nicht dasselbe wie die Spur.** `wurzelTitel` fuehrt auf die
   * PORTALWURZEL; wer auf `personal/anstellungen/[id]/entgelt` steht, landet
   * damit ganz oben und nicht bei der Anstellung. Dieser Verweis fuehrt dahin,
   * wo der Datensatz wohnt — die Liste, aus der die Seite kommt.
   *
   * Er steht hier und nicht in jeder Seite, damit er ueberall an derselben
   * Stelle sitzt: zuerst im `main`, vor jeder Ueberschrift. Gemessen trugen
   * ihn 15 von 350 Detailseiten, und keine zwei an derselben Stelle.
   */
  readonly zurueck?: ZurueckProps;
  readonly children: React.ReactNode;
}

export function PortalRahmen({
  titel, wurzelTitel, bereich, nurLesen, leiste, wurzel, aktiverTab, sichtbareTabs,
  navigationsRechte, beschriftungen, zurueck, children,
}: PortalRahmenProps) {
  const tabs = tableiste(leiste);
  /**
   * **Darf diese Sitzung die Wurzel ueberhaupt OEFFNEN?**
   *
   * Die Wortmarke und die Spur zeigen auf `wurzel` — die Uebersicht. Die
   * traegt im Manifest ein eigenes Leserecht (`bericht.dashboard_lesen` im
   * Mandantenportal, `gruppe.bericht.lesen` in der Gruppensicht), und Rechte
   * sind je Gesellschaft einzeln widerrufbar. Wem es fehlt, der bekam hinter
   * dem Firmennamen ein 404 — auf JEDER Portalseite, weil der Rahmen ueberall
   * derselbe ist (AUT-06, D-581).
   *
   * **Gefragt wird die Leiste, nicht ein zweites Mal die Datenbank.** Die
   * Wurzel ist der Tab mit dem leeren Pfad; `sichtbareTabs` hat ihn in
   * derselben gebundenen Transaktion bewertet, in der das Tor den Zugang zur
   * Seite geprueft hat (`portalZugang`). Ein eigener `haeltRechte`-Aufruf
   * hier waere eine zweite Abfrage auf jeder einzelnen Seite — und eine
   * zweite Wahrheit ueber dasselbe Recht.
   *
   * Fehlt die Angabe (eine Seite, die sie nicht reicht), bleibt es beim
   * Verweis: diese Pruefung verschaerft, sie erfindet nichts.
   */
  const wurzelTab = tabs.ziele.find((t) => t.pfad === '' && t.recht !== null);
  const wurzelOffen = wurzelTab === undefined || sichtbareTabs === undefined
    || sichtbareTabs[wurzelTab.schluessel] !== false;
  /**
   * Die Beschriftungen — uebergebene zuerst, sonst die der internen Huelle in
   * der Sprache DIESER Anfrage (D-592).
   *
   * Das Mitarbeiterportal und das Kundenportal geben ihre Karte mit; sie
   * sprechen vier Sprachen und haben eigene Schluessel. Alles andere ist das
   * interne Portal, und dort holt der Rahmen die Karte selbst, statt sie sich
   * von 176 Aufrufstellen reichen zu lassen — von denen eine sie vergessen
   * wuerde, ohne dass jemand einen Fehler saehe.
   */
  const stand = gemerkteHuelle();
  const karte = beschriftungen ?? internBeschriftungen(stand.sprache);
  const b = (schluessel: string, vorgabe: string): string =>
    karte[schluessel] ?? vorgabe;
  /**
   * **Auf dem Telefon braucht jede Leiste ohne `Mehr` einen eigenen Ausgang.**
   *
   * Die Sitzungsnavigation der Kopfzeile ist unter `sm` ausgeblendet, und das
   * ist richtig — bei 375px hat die Zeile keinen Platz fuer vier Punkte. Das
   * interne Portal traegt sie im „Mehr"-Blatt. Die Arbeiter-, die Kunden- und
   * die Gruppenleiste haben KEIN `Mehr` (SEITENKARTE §11.2), und damit hatte
   * eine Reinigungskraft auf ihrem Telefon weder Konto noch Website — und vor
   * allem keine Abmeldung. Ein Telefon, das man weitergibt, blieb angemeldet.
   * Deshalb hier ein Blatt hinter einem Personen-Symbol, nur unter `sm` und
   * nur fuer Leisten ohne `Mehr` (D-419).
   */
  const ohneMehr = !tabs.ziele.some((z) => z.schluessel === 'mehr');
  return (
    /*
     * `sicher-oben`: mit `viewport-fit=cover` beginnt der Inhalt bei y=0 — im
     * Browsertab liegt dort die Adresszeile, im installierten Modus die
     * Statusleiste. Der Inset ist dann nicht null, und der Identitaetsstreifen
     * verschwaende unter der Uhr (DESIGN §8).
     */
    <div className="sicher-oben flex min-h-dvh flex-col bg-ink">
      <div
        aria-hidden="true"
        data-cse="identitaets-streifen"
        data-bereich={bereich ?? 'gruppe'}
        /*
         * **Der neutrale Fall kommt aus dem Thema, nicht aus einem `var()`.**
         *
         * Hier stand `background: 'var(--border-line-strong)'`. Diese
         * Eigenschaft gibt es in `globals.css` nicht — sie heisst dort
         * `--border-strong`; `border-line-strong` ist der Name der
         * TAILWIND-Klasse. Ein `var()` auf eine unbekannte Eigenschaft ohne
         * Ersatzwert ist ungueltig, die ganze Deklaration faellt weg, und der
         * Balken wurde durchsichtig: in der Gruppenansicht fehlte der
         * 3px-Streifen aus DESIGN §6 Regel 4 ganz. Nichts im Log, nichts rot —
         * nur die eine Ansicht ohne das Zeichen, das sagt, wo man ist. Als
         * Klasse kann derselbe Vertipper nicht mehr passieren: die
         * Tailwind-Wache kennt die Farbnamen des Themas.
         */
        className={`h-[3px] w-full shrink-0 ${bereich === null ? 'bg-line-strong' : ''}`}
        {...(bereich === null
          ? {}
          : { style: { background: `var(--area-${bereich})` } })}
      />

      <header className="sicher-seiten flex h-14 shrink-0 items-center gap-s3
                         border-b border-line bg-surface px-s4">
        {/*
          * Der Auftrittsname ist ein WEG, kein Schild.
          *
          * Er stand als `span` da, und die Kopfzeile trug sonst nichts: wer
          * in `/portal/bau/zeiten` stand, kam von dort nicht zur Uebersicht
          * dieser Gesellschaft, nicht in eine andere, nicht zu seinem Konto
          * und nicht zurueck auf die Website. Das Portal hatte einen Eingang
          * und keinen Ausgang.
          */}
        {/*
          * `min-h-11 min-w-11`: aus einem Schild wurde ein Tippziel.
          *
          * Als `span` unterlag der Name keiner Mindestgroesse. Als Verweis
          * schon — DESIGN §8 verlangt 44px fuer alles Bedienbare, und die
          * Zeilenhoehe von `text-h3` sind 28. Neun Bildschirme unter
          * `/portal/mein/**` fielen daran, jeder mit genau diesem einen Knoten.
          */}
        {wurzelTitel === undefined || wurzelTitel === titel ? (
          /*
           * Das Logo der Gesellschaft als Weg zur Uebersicht — Zeichen und
           * Name (DESIGN §1 Lockup), ohne den Unterstrich, der aus einem
           * Firmennamen einen Textlink machte. Der Hover ist die Flaeche.
           */
          wurzelOffen ? (
            <a href={wurzel} data-cse="portal-logo"
               className="-ms-s2 flex min-h-11 min-w-11 items-center gap-s2 rounded-md px-s2
                          text-h3 text-text transition-colors duration-fast ease-brand
                          hover:bg-surface-2">
              {bereich === null ? <Marke art="gruppe" groesse="sm" /> : <Marke art={bereich} groesse="sm" />}
              <span className="truncate">{titel}</span>
            </a>
          ) : (
            /*
             * Ohne das Recht auf die Uebersicht bleibt der Name ein NAME —
             * nicht ein ausgegrauter Knopf. Ein gesperrter Verweis verraet
             * dasselbe wie ein offener (AUT-06); er ist nur hoeflicher dabei.
             */
            <span data-cse="portal-logo-ohne-ziel"
                  className="-ms-s2 flex min-h-11 min-w-11 items-center gap-s2 px-s2
                             text-h3 text-text">
              {bereich === null ? <Marke art="gruppe" groesse="sm" /> : <Marke art={bereich} groesse="sm" />}
              <span className="truncate">{titel}</span>
            </span>
          )
        ) : (
          /*
           * **Der Titel der Spur gehoert in ein `truncate`, und das ist keine
           * Kosmetik.**
           *
           * `min-width: auto` gilt fuer ein Flex-Element nur, solange sein
           * `overflow` `visible` ist. `truncate` traegt `overflow: hidden` und
           * nimmt dem Element damit die automatische Mindestbreite von selbst —
           * deshalb war `portal-logo` zwei Zeilen weiter oben immer in Ordnung
           * und die Spur nicht: dort steht der Titel in einem `truncate`-Span,
           * hier stand er als nackter Text.
           *
           * Gemessen auf `/portal/[mandant]/buchhaltung/verfahrensdokumentation`
           * bei 390 px: `a.flex min-h-11 min-w-11 items-center (134>60)` — der
           * Inhalt brauchte 134 px in einem 60-px-Kasten, und die Seite wurde
           * 403 px breit. Genau die 13 px, die die Suite gemeldet hat.
           *
           * `min-w-11` bleibt: 44 px ist das Beruehrungsziel (DESIGN §9, BFSG).
           * Die Marke und das `‹` behalten ihre Groesse; was nachgibt, ist der
           * Text — mit Auslassungspunkten, nicht auf null (D-609).
           */
          <nav aria-label={b('pfad.label', 'Pfad')} data-cse="spur"
               className="flex min-w-0 items-center gap-s2">
            {wurzelOffen ? (
              <a href={wurzel} data-cse="spur-zurueck"
                 className="flex min-h-11 min-w-11 items-center gap-s2 text-sm text-text-muted
                            transition-colors duration-fast ease-brand hover:text-text">
                {bereich === null ? <Marke art="gruppe" groesse="sm" /> : <Marke art={bereich} groesse="sm" />}
                <span aria-hidden="true">‹</span>
                <span className="truncate">{wurzelTitel}</span>
              </a>
            ) : (
              <span data-cse="spur-ohne-ziel"
                    className="flex min-h-11 min-w-11 items-center gap-s2 text-sm text-text-muted">
                {bereich === null ? <Marke art="gruppe" groesse="sm" /> : <Marke art={bereich} groesse="sm" />}
                <span className="truncate">{wurzelTitel}</span>
              </span>
            )}
            <span aria-hidden="true" className="text-text-subtle">›</span>
            <span className="truncate text-h3 text-text">{titel}</span>
          </nav>
        )}
        {nurLesen && (
          <span data-cse="header-nur-lesen"><StatusPill zustand="Nur Lesen" /></span>
        )}
        {/*
          * Am Schreibtisch in der Kopfzeile, am Telefon im „Mehr"-Blatt.
          *
          * NICHT beides auf einmal: bei 375px stehen hier schon der
          * Auftrittsname und die Lesemarke, und drei weitere Punkte daneben
          * schoeben die Zeile ueber den Rand — derselbe Fehler, der die
          * oeffentliche Kopfzeile schon einmal zum waagerechten Scrollen
          * gebracht hat. Das Telefon hat sein Blatt, und dort stehen
          * dieselben drei Ziele.
          */}
        {/*
          * **Die Glocke steht VOR der Sitzungsnavigation und auch am Telefon.**
          *
          * Sie ist kein Sitzungspunkt („Bereich wechseln", „Konto",
          * „Abmelden"), sondern ein Posteingang — und der einzige Weg zu einer
          * Meldung, die sonst niemand sieht. Deshalb bleibt sie unter `sm`
          * sichtbar, wo die uebrige Navigation ins „Mehr"-Blatt wandert: sie
          * ist EIN Symbol von 44px, und dafuer ist bei 375px Platz.
          *
          * Sie rendert sich selbst zu `null`, wo es keinen Bereich gibt —
          * in der Gruppenansicht faehrt kein Pfad dorthin.
          */}
        <span className="ms-auto flex items-center">
          <Glocke wurzel={wurzel} />
        </span>
        <nav
          aria-label={b('sitzung.label', 'Sitzung')}
          data-cse="sitzungsnavigation"
          className="hidden items-center gap-s4 sm:flex"
        >
          {/*
            * Auch im Mitarbeiterportal: ein Konto kann in einer Gesellschaft
            * Beschaeftigte und in einer anderen Leitung sein, und dann ist die
            * Bereichswahl der einzige Weg in das andere Portal (§4.4). Nur die
            * Beschriftung folgt der Sprache der Person (D-419).
            */}
          <a href="/auth/bereich"
             className="flex min-h-11 items-center text-sm text-text-muted hover:text-text">
            {b('sitzung.bereich', 'Bereich wechseln')}
          </a>
          <a href="/portal/konto"
             className="flex min-h-11 items-center text-sm text-text-muted hover:text-text">
            {b('sitzung.konto', 'Konto')}
          </a>
          <a href="/"
             className="flex min-h-11 items-center text-sm text-text-muted hover:text-text">
            {b('sitzung.website', 'Website')}
          </a>
          {/*
            * Der Sprachumschalter — nur im internen Portal (D-592). Das
            * Mitarbeiterportal spricht vier Sprachen und waehlt sie auf der
            * Profilseite; zwei Umschalter mit verschiedenen Auswahlmengen auf
            * einem Bildschirm waeren eine Falle, keine Hilfe.
            */}
          {istInterneLeiste(leiste) && (
            <Sprachumschalter label={b('sprache.label', 'Sprache')} ort="kopfzeile" />
          )}
          {/*
            * Ein FORMULAR, kein Verweis: eine Abmeldung aendert Zustand, und
            * ein GET dafuer laesst sich von einem fremden Bild-Tag ausloesen.
            */}
          <form method="post" action="/api/abmelden">
            <button type="submit"
                    className="flex min-h-11 items-center text-sm text-text-muted
                               hover:text-text">
              {b('sitzung.abmelden', 'Abmelden')}
            </button>
          </form>
        </nav>

        {ohneMehr && (
          <details data-cse="sitzungsmenue" className="relative ms-auto sm:hidden">
            {/* Ein Symbol allein traegt seinen Namen (DESIGN §5 Icons). */}
            <summary
              aria-label={b('sitzung.label', 'Sitzung')}
              className="flex min-h-11 min-w-11 cursor-pointer list-none items-center
                         justify-center rounded-md text-text-muted hover:bg-surface-2
                         hover:text-text"
            >
              <Icon name="person" groesse="md" />
            </summary>
            {/* Dropdown nach DESIGN §6: `--surface-2`, `--r-lg`, `--shadow-pop`, 320px. */}
            <nav
              aria-label={b('sitzung.label', 'Sitzung')}
              data-cse="sitzungsmenue-blatt"
              className="absolute end-0 top-full z-50 mt-s1 w-[320px] rounded-lg border
                         border-line bg-surface-2 p-s2 shadow-pop"
            >
              <ul className="m-0 list-none p-0">
                {([
                  ['/auth/bereich', b('sitzung.bereich', 'Bereich wechseln')],
                  ['/portal/konto', b('sitzung.konto', 'Konto')],
                  ['/', b('sitzung.website', 'Website')],
                ] as const).map(([ziel, text]) => (
                  <li key={ziel}>
                    <a href={ziel} data-cse="sitzungsmenue-ziel"
                       className="flex min-h-11 items-center rounded-md px-s2 text-sm text-text
                                  hover:bg-surface-3">
                      {text}
                    </a>
                  </li>
                ))}
                <li>
                  <form method="post" action="/api/abmelden">
                    <button type="submit" data-cse="sitzungsmenue-abmelden"
                            className="flex min-h-11 w-full items-center rounded-md px-s2
                                       text-start text-sm text-text hover:bg-surface-3">
                      {b('sitzung.abmelden', 'Abmelden')}
                    </button>
                  </form>
                </li>
              </ul>
            </nav>
          </details>
        )}
      </header>

      <div className="flex flex-1">
        {/*
          * **Der Schreibtisch bekommt das VOLLE Register, nicht die fuenf
          * Ziele des Telefons.**
          *
          * Hier stand `ziele={tabs.ziele}`. Das sind die fuenf Punkte der
          * Tab-Leiste — Uebersicht, Auftraege, Dienstplan, Freigaben und
          * `Mehr` —, und `Mehr` traegt `pfad: ''`, zeigt also auf die Seite,
          * auf der man ohnehin steht.
          *
          * Die Folge war, dass auf einem 1440-px-Bildschirm KEIN Weg zu
          * Zeiten, Personal, Objekten, CRM, Finanzen, Reinigung, Security,
          * Bau oder Qualitaet fuehrte. Alle diese Bildschirme waren gebaut,
          * geprueft und erreichbar — nur nannte sie niemand. Wer das Portal
          * oeffnete, sah vier Punkte und schloss daraus, es gebe vier Module.
          *
          * `NAVIGATION` ist das Register, das genau dafuer angelegt wurde
          * (18 Eintraege, jeder mit seinem Recht). Es war da, die Sidebar war
          * da — verbunden waren sie nie.
          */}
        {/*
          * **Die Arbeiterin, die Kundin und die Gruppenleitung haben am
          * Schreibtisch dieselben Ziele wie am Telefon — nicht gar keine.**
          *
          * `NAVIGATION` ist das Register der MANDANTEN-Module, jedes mit einem
          * Modulrecht. Eine Reinigungskraft haelt keines davon; die Schiene
          * blieb deshalb leer, und am Schreibtisch trug ihr Portal ueberhaupt
          * keine Navigation — die Tab-Leiste ist `md:hidden`. Ihre Ziele
          * stehen in ihrer eigenen Leiste (`mitarbeiter`), und die ist hier
          * die richtige Quelle. `Mehr` faellt dabei ohnehin weg (`OHNE_MEHR`).
          *
          * **Die Gruppenansicht gehoerte in dieselbe Zeile und stand in der
          * anderen.** Sie bekam `NAVIGATION.filter(n => n.gruppe)` — also die
          * MANDANTEN-Module unter `/portal/gruppe`. Beides daran war falsch:
          *
          *  - Die Rechte. `navigationsRechte` traegt `objekt.lesen`,
          *    `crm.lesen`, …; die Gruppenrouten verlangen `gruppe.objekt.lesen`
          *    und Geschwister (`0004`/`0009`). Wer nur `gruppe.*` haelt — das
          *    Publikum, fuer das TEN-05 diese Ansicht gebaut hat — sah eine
          *    LEERE Schiene, und `SeitenNavigation` blendet sie dann ganz aus:
          *    am 1440-px-Bildschirm keine Navigation, weil die Leiste
          *    `md:hidden` ist.
          *  - Die Pfade. `dienstplan/woche`, `zeiten`, `personal/anstellungen`,
          *    `angebote`, `finanzen/rechnungen`, `bau/projekte`,
          *    `reinigung/reviere`, `qualitaet/reklamationen` gibt es unter
          *    `/portal/gruppe` NICHT (§6 der Seitenkarte kennt `dienstplan`,
          *    `auslastung`, `personen`, `rechnungen`, `projekte` …). Ein
          *    `super_admin`, der jedes Modulrecht haelt, bekam die Schiene also
          *    voll — und 8 von 12 Punkten fuehrten auf 404.
          *
          * Die Gruppenleiste traegt bewusst kein `Mehr`: „jede Gruppenseite ist
          * lesend und von den fuenf Knotenpunkten aus erreichbar"
          * (`registry/tableiste.ts`). Genau diese fuenf stehen hier, mit den
          * `gruppe.*`-Rechten, die `sichtbareTabs` ohnehin schon bewertet hat.
          */}
        <SeitenNavigation
          ziele={leiste === 'intern_global' || leiste === 'intern_admin'
            || leiste === 'intern_leitung'
            ? NAVIGATION
            : tabs.ziele}
          wurzel={wurzel}
          {...(aktiverTab === undefined ? {} : { aktiv: aktiverTab })}
          {...(leiste === 'intern_global' || leiste === 'intern_admin'
            || leiste === 'intern_leitung'
            ? (navigationsRechte === undefined ? {} : { sichtbar: navigationsRechte })
            : (sichtbareTabs === undefined ? {} : { sichtbar: sichtbareTabs }))}
          bereich={bereich}
          label={titel}
          beschriftungen={karte}
        />
        {/* `ueber-tableiste` unter `md`: die Tab-Leiste liegt fest am unteren Rand und
            verdeckte sonst die letzte Zeile jeder Liste. */}
        {/*
          * `min-w-0` — und das ist der Unterschied zwischen einer Seite, die
          * passt, und einer, die auf jedem Telefon seitwaerts laeuft.
          *
          * `main` ist ein Flex-Element, und ein Flex-Element hat
          * `min-width: auto`: es wird nie schmaler als der breiteste Inhalt.
          * Ein Wochenraster, eine Tabelle oder ein 40px-Wort wie
          * „Eingangsrechnungen" machten damit das GANZE `main` breiter als
          * das Fenster — und mit ihm die Ueberschriftzeile, die Sprungleiste,
          * jede Karte. Gemessen: 63 Portalseiten liefen bei 375px ueber,
          * 35 bei 820px, mit genau dieser Kette. Mit `min-w-0` bleibt `main`
          * so breit wie das Fenster; was wirklich breiter ist (das Raster,
          * eine Tabelle ab `md`), rollt in seinem eigenen Behaelter (D-420).
          */}
        <main className="ueber-tableiste sicher-seiten min-w-0 flex-1 p-s5">
          {zurueck !== undefined && (
            <Zurueck ziel={zurueck.ziel} text={zurueck.text}
                     sprache={beschriftungen?.['sitzung.sprache'] ?? null} />
          )}
          {children}
        </main>
      </div>

      <TabLeiste
        ziele={tabs.ziele}
        wurzel={wurzel}
        {...(aktiverTab === undefined ? {} : { aktiv: aktiverTab })}
        {...(sichtbareTabs === undefined ? {} : { sichtbar: sichtbareTabs })}
        {...(navigationsRechte === undefined ? {} : { navigationsRechte })}
        gruppenansicht={leiste === 'gruppe'}
        label={titel}
        beschriftungen={karte}
        intern={istInterneLeiste(leiste)}
      />
    </div>
  );
}
