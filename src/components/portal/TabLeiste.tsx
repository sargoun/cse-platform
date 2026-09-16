import { tabZiel, type TabZiel } from '@/server/registry/tableiste';
import { GRUPPEN_NAVIGATION, NAVIGATION } from '@/server/registry/navigation';
import { Icon } from '@/components/ui/Icon';

/**
 * Die Tab-Leiste unter 768 px (DESIGN §5/§8, SEITENKARTE §11.2).
 *
 * **Tap-Ziele mindestens 44×44 px.** Nicht als Richtwert: WCAG 2.5.5 nennt die
 * Zahl, und diese Leiste ist das, was jemand mit Handschuhen im Treppenhaus
 * trifft oder nicht trifft.
 *
 * `aria-current="page"` und nicht nur eine Farbe — §9 verbietet Farbe als
 * einziges Signal, und ein Screenreader liest keine Farbe.
 */
export interface TabLeisteProps {
  readonly ziele: readonly TabZiel[];
  /**
   * Je Schluessel: darf dieser Tab erscheinen?
   *
   * Ein Menuepunkt, der auf 404 fuehrt, ist schlechter als keiner — er
   * verraet die Existenz dessen, was er nicht zeigen darf (AUT-06). §11.2
   * beschreibt die Leiste einer Rolle, die ihre fuenf Rechte HAELT; wer eines
   * nicht haelt, sieht vier.
   */
  readonly sichtbar?: Readonly<Record<string, boolean>>;
  /** Der Schlüssel des aktiven Ziels. */
  readonly aktiv?: string;
  /** Die Portalwurzel, z. B. `/portal/reinigung` oder `/portal/mein`. */
  readonly wurzel: string;
  readonly label: string;
  /**
   * Je NAVIGATIONS-Schluessel (`crm`, `objekte`, …): darf der Punkt
   * erscheinen? **Nicht je Rechteschluessel** — die Karte kommt aus
   * `portalZugang` und ist dort nach `schluessel` gebaut, damit Sidebar und
   * Blatt dieselbe Karte lesen.
   *
   * Nur damit kann das fuenfte Ziel sein Versprechen einloesen. Fehlt die
   * Angabe, bleibt `Mehr` ein gewoehnlicher Link — das ist der Zustand vor
   * dieser Ergaenzung und keine Verschlechterung.
   */
  readonly navigationsRechte?: Readonly<Record<string, boolean>>;
  readonly gruppenansicht?: boolean;
  /**
   * Uebersetzte Beschriftungen je Tab-Schluessel (D-419).
   *
   * Das Register traegt deutsche Labels; das Mitarbeiterportal spricht vier
   * Sprachen (EMP-12). Was hier fehlt, faellt auf das Register zurueck.
   */
  readonly beschriftungen?: Readonly<Record<string, string>>;
}

/**
 * Das Blatt hinter `Mehr` (SEITENKARTE §11.2: "a full-screen sheet with the
 * complete sidebar tree").
 *
 * **Ohne JavaScript**: `<details>` oeffnet und schliesst von sich aus. Eine
 * Loesung mit Zustand im Browser flackerte beim ersten Rendern und waere im
 * Treppenhaus mit schlechtem Netz genau dann nicht da, wenn sie gebraucht
 * wird.
 *
 * Ein Punkt, den die Sitzung nicht sehen darf, erscheint NICHT — nicht
 * ausgegraut: ein Menuepunkt, der auf 404 fuehrt, verraet die Existenz
 * dessen, was er nicht zeigen darf (AUT-06).
 */
function MehrZelle({ wurzel, rechte, gruppenansicht }: {
  readonly wurzel: string;
  readonly rechte: Readonly<Record<string, boolean>>;
  readonly gruppenansicht: boolean;
}) {
  /*
   * **Nachgeschlagen unter `schluessel`, nicht unter `recht`.**
   *
   * Hier stand `rechte[n.recht] === true`. `portalZugang` schluesselt die
   * Karte aber nach `n.schluessel` — also `crm` und nicht `crm.lesen`, seit
   * die Sidebar dieselbe Karte benutzt (`SeitenNavigation` liest
   * `sichtbar[z.schluessel]`). Jede Abfrage traf damit `undefined`,
   * `undefined === true` war falsch, und das Blatt ging auf und war LEER:
   * kein einziger Punkt, obwohl die Sitzung jedes Recht hielt. Unter 768 px
   * ist dieses Blatt der einzige Weg zu den Modulen ausserhalb der vier
   * Tabs — am Telefon war das Portal damit auf vier Bildschirme geschrumpft,
   * ohne dass irgendwo ein Fehler erschien.
   *
   * `=== true` bleibt und ist NICHT das `!== false` der Sidebar: was nicht
   * ausdruecklich erlaubt ist, erscheint hier nicht (AUT-06). Ein fehlender
   * Schluessel blendet aus, statt aufzudecken.
   */
  const punkte = (gruppenansicht ? GRUPPEN_NAVIGATION : NAVIGATION)
    .filter((n) => rechte[n.schluessel] === true);

  return (
    <details data-cse="mehr" className="flex-1">
      <summary
        data-cse="tab"
        data-tab="mehr"
        className="flex min-h-[44px] cursor-pointer list-none flex-col items-center
                   justify-center gap-s1 px-s2 py-s2 text-micro text-text-muted"
      >
        <Icon name="menue" groesse="md" />
        Mehr
      </summary>
      {/*
        `ueber-leiste-oberkante`, nicht `inset-0`.

        Das Blatt lag ueber der GANZEN Ansicht — und damit ueber der
        Tab-Leiste, in der sein eigenes `<summary>` steckt. Ohne JavaScript
        schliesst ein `<details>` nur ueber sein `<summary>`; verdeckt man das,
        gibt es keinen Weg zurueck, und der Fokus bleibt im Blatt gefangen.

        Hier stand `bottom-11` — 44px, die Hoehe der Zelle. Seit die Leiste um
        die Safe Area waechst (DESIGN §8), ist sie 44px PLUS Inset hoch, und
        das Blatt verdeckte auf jedem Telefon mit Home-Indikator wieder genau
        den Knopf, der es zumacht. `ueber-leiste-oberkante` rechnet beides
        zusammen, an einer Stelle.
      */}
      <nav
        aria-label="Alle Bereiche"
        data-cse="mehr-blatt"
        className="ueber-leiste-oberkante sicher-seiten fixed inset-x-0 top-0 z-50
                   overflow-y-auto bg-surface p-s5"
      >
        <h2 className="mt-0 text-h3 text-text">Alle Bereiche</h2>
        <ul className="m-0 list-none p-0">
          {punkte.map((n) => (
            <li key={n.schluessel} className="border-b border-line">
              <a
                href={n.pfad === '' ? wurzel : `${wurzel}/${n.pfad}`}
                data-cse="mehr-ziel"
                data-ziel={n.schluessel}
                className="flex min-h-[44px] items-center gap-s3 py-s3 text-sm text-text"
              >
                <Icon name={n.icon} groesse="md" className="shrink-0" />
                {n.label}
              </a>
            </li>
          ))}
        </ul>

        {/*
          * Dieselben Ziele wie in der Kopfzeile am Schreibtisch.
          *
          * Am Telefon traegt die Kopfzeile sie nicht — bei 375px stehen dort
          * schon der Auftrittsname und die Lesemarke, und vier weitere Punkte
          * schoeben die Zeile ueber den Rand. Das Blatt ist der Ort, an dem
          * das Telefon alles findet, was nicht in fuenf Tabs passt; ein
          * Portal ohne Ausgang waere es sonst genau hier.
          */}
        <h2 className="mt-s5 text-h3 text-text">Sitzung</h2>
        <ul className="m-0 list-none p-0">
          {([['/auth/bereich', 'Bereich wechseln'], ['/portal/konto', 'Konto'],
             ['/', 'Website']] as const).map(([ziel, text]) => (
               <li key={ziel} className="border-b border-line">
                 <a href={ziel} data-cse="mehr-sitzung"
                    className="flex min-h-[44px] items-center py-s3 text-sm text-text">
                   {text}
                 </a>
               </li>
             ))}
          <li className="border-b border-line">
            <form method="post" action="/api/abmelden">
              <button type="submit" data-cse="mehr-abmelden"
                      className="flex min-h-[44px] w-full items-center py-s3 text-sm text-text">
                Abmelden
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </details>
  );
}

export function TabLeiste({
  ziele, aktiv, wurzel, label, sichtbar, navigationsRechte, gruppenansicht = false,
  beschriftungen,
}: TabLeisteProps) {
  const gezeigt = ziele.filter((z) => sichtbar?.[z.schluessel] !== false);
  return (
    <nav
      aria-label={label}
      data-cse="tableiste"
      /*
       * `sicher-unten` und `sicher-seiten`: der Balken waechst um die Flaeche,
       * die das Geraet fuer Home-Indikator und Rundung nimmt (DESIGN §8). Die
       * 44px-Zelle darunter bleibt 44px — der Inset ist Platz, den das System
       * nimmt, nicht Platz, den der Knopf hergibt.
       */
      className="sicher-unten sicher-seiten fixed inset-x-0 bottom-0 z-40 flex
                 border-t border-line bg-surface md:hidden"
    >
      {gezeigt.map((z) => {
        if (z.schluessel === 'mehr' && navigationsRechte !== undefined) {
          return (
            <MehrZelle
              key={z.schluessel}
              wurzel={wurzel}
              rechte={navigationsRechte}
              gruppenansicht={gruppenansicht}
            />
          );
        }
        const ziel = tabZiel(wurzel, z);
        return (
          <a
            key={z.schluessel}
            href={ziel}
            data-cse="tab"
            data-tab={z.schluessel}
            aria-current={z.schluessel === aktiv ? 'page' : undefined}
            className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-s1
                        px-s2 py-s2 text-micro ${
                          z.schluessel === aktiv ? 'text-text' : 'text-text-muted'}`}
          >
            <Icon name={z.icon} groesse="md" />
            {beschriftungen?.[z.schluessel] ?? z.label}
          </a>
        );
      })}
    </nav>
  );
}
