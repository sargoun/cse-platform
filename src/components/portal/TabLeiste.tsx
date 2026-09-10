import { tabZiel, type TabZiel } from '@/server/registry/tableiste';
import { GRUPPEN_NAVIGATION, NAVIGATION } from '@/server/registry/navigation';

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
   * Je Rechteschluessel der NAVIGATION: haelt die Sitzung ihn?
   *
   * Nur damit kann das fuenfte Ziel sein Versprechen einloesen. Fehlt die
   * Angabe, bleibt `Mehr` ein gewoehnlicher Link — das ist der Zustand vor
   * dieser Ergaenzung und keine Verschlechterung.
   */
  readonly navigationsRechte?: Readonly<Record<string, boolean>>;
  readonly gruppenansicht?: boolean;
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
  const punkte = (gruppenansicht ? GRUPPEN_NAVIGATION : NAVIGATION)
    .filter((n) => rechte[n.recht] === true);

  return (
    <details data-cse="mehr" className="flex-1">
      <summary
        data-cse="tab"
        data-tab="mehr"
        className="flex min-h-[44px] cursor-pointer list-none flex-col items-center
                   justify-center gap-s1 px-s2 py-s2 text-micro text-text-muted"
      >
        <span aria-hidden="true" className="text-base">⋯</span>
        Mehr
      </summary>
      <nav
        aria-label="Alle Bereiche"
        data-cse="mehr-blatt"
        className="fixed inset-0 z-50 overflow-y-auto bg-surface p-s5"
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
                <span aria-hidden="true" className="text-base">{n.symbol}</span>
                {n.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}

export function TabLeiste({
  ziele, aktiv, wurzel, label, sichtbar, navigationsRechte, gruppenansicht = false,
}: TabLeisteProps) {
  const gezeigt = ziele.filter((z) => sichtbar?.[z.schluessel] !== false);
  return (
    <nav
      aria-label={label}
      data-cse="tableiste"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface md:hidden"
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
            <span aria-hidden="true" className="text-base">{z.symbol}</span>
            {z.label}
          </a>
        );
      })}
    </nav>
  );
}
