import { StatusPill } from '@/components/ui/StatusPill';
import { TabLeiste } from './TabLeiste';
import { SeitenNavigation } from './SeitenNavigation';
import { tableiste, type LeistenSchluessel } from '@/server/registry/tableiste';
import { NAVIGATION } from '@/server/registry/navigation';
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
  readonly children: React.ReactNode;
}

export function PortalRahmen({
  titel, bereich, nurLesen, leiste, wurzel, aktiverTab, sichtbareTabs,
  navigationsRechte, children,
}: PortalRahmenProps) {
  const tabs = tableiste(leiste);
  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <div
        aria-hidden="true"
        data-cse="identitaets-streifen"
        data-bereich={bereich ?? 'gruppe'}
        className="h-[3px] w-full shrink-0"
        style={{
          background: bereich === null
            ? 'var(--border-line-strong)' : `var(--area-${bereich})`,
        }}
      />

      <header className="flex h-14 shrink-0 items-center gap-s3 border-b border-line
                         bg-surface px-s4">
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
        <a href={wurzel}
           className="flex min-h-11 min-w-11 items-center text-h3 text-text hover:underline">
          {titel}
        </a>
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
        <nav
          aria-label="Sitzung"
          data-cse="sitzungsnavigation"
          className="ms-auto hidden items-center gap-s4 sm:flex"
        >
          <a href="/auth/bereich"
             className="flex min-h-11 items-center text-sm text-text-muted hover:text-text">
            Bereich wechseln
          </a>
          <a href="/portal/konto"
             className="flex min-h-11 items-center text-sm text-text-muted hover:text-text">
            Konto
          </a>
          <a href="/"
             className="flex min-h-11 items-center text-sm text-text-muted hover:text-text">
            Website
          </a>
          {/*
            * Ein FORMULAR, kein Verweis: eine Abmeldung aendert Zustand, und
            * ein GET dafuer laesst sich von einem fremden Bild-Tag ausloesen.
            */}
          <form method="post" action="/api/abmelden">
            <button type="submit"
                    className="flex min-h-11 items-center text-sm text-text-muted
                               hover:text-text">
              Abmelden
            </button>
          </form>
        </nav>
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
        <SeitenNavigation
          ziele={NAVIGATION.filter((n) => leiste !== 'gruppe' || n.gruppe)}
          wurzel={wurzel}
          {...(aktiverTab === undefined ? {} : { aktiv: aktiverTab })}
          {...(navigationsRechte === undefined ? {} : { sichtbar: navigationsRechte })}
          label={titel}
        />
        {/* `pb-20` unter `md`: die Tab-Leiste liegt fest am unteren Rand und
            verdeckte sonst die letzte Zeile jeder Liste. */}
        <main className="flex-1 p-s5 pb-20 md:pb-s5">{children}</main>
      </div>

      <TabLeiste
        ziele={tabs.ziele}
        wurzel={wurzel}
        {...(aktiverTab === undefined ? {} : { aktiv: aktiverTab })}
        {...(sichtbareTabs === undefined ? {} : { sichtbar: sichtbareTabs })}
        {...(navigationsRechte === undefined ? {} : { navigationsRechte })}
        gruppenansicht={leiste === 'gruppe'}
        label={titel}
      />
    </div>
  );
}
