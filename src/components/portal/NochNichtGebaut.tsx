import { PortalRahmen } from './PortalRahmen';
import type { LeistenSchluessel } from '@/server/registry/tableiste';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Was eine Route zeigt, die es im Manifest gibt und als Seite noch nicht.
 *
 * **Nicht 404 und nicht eine leere Liste.** Beides waere eine Luege: 404
 * hiesse "diese Seite gibt es nicht", obwohl `04-SEITENKARTE.md` sie fuehrt
 * und die Tab-Leiste sie anbietet; eine leere Tabelle hiesse "hier ist nichts",
 * obwohl es die Daten schlicht noch nicht gibt. Wer die beiden verwechselt,
 * ruft beim Kunden an — dieselbe Begruendung, aus der `KeinKundenzugangFehler`
 * lieber wirft, als eine leere Liste zu zeigen.
 *
 * Der Zugang ist dabei ECHT geprueft: diese Seite wird nur gerendert, wenn
 * `portalZugang` sie erlaubt hat. Eine Route ohne Recht faellt vorher auf 404,
 * eine Route ausserhalb des Manifests ebenso. Es ist also kein Freibrief,
 * sondern eine ehrliche Antwort innerhalb der Wache.
 */
export interface NochNichtGebautProps {
  readonly titel: string;
  readonly bereich: BereichSchluessel | null;
  readonly leiste: LeistenSchluessel;
  readonly wurzel: string;
  readonly sichtbareTabs?: Readonly<Record<string, boolean>>;
  /** Je Rechteschluessel der NAVIGATION — fuellt das Blatt hinter `Mehr`. */
  readonly navigationsRechte?: Readonly<Record<string, boolean>>;
  /** Die Beschriftungen in der Sprache der Person — siehe `PortalRahmen` (D-419). */
  readonly beschriftungen?: Readonly<Record<string, string>>;
  readonly aktiverTab?: string;
  /** Die Phase aus dem Manifest — sie sagt, WANN, statt nur "spaeter". */
  readonly phase: number | null;
  readonly pfad: string;
}

export function NochNichtGebaut({
  titel, bereich, leiste, wurzel, sichtbareTabs, aktiverTab, phase, pfad, navigationsRechte,
  beschriftungen,
}: NochNichtGebautProps) {
  return (
    <PortalRahmen
      titel={titel}
      bereich={bereich}
      nurLesen
      leiste={leiste}
      wurzel={wurzel}
      {...(aktiverTab === undefined ? {} : { aktiverTab })}
      {...(sichtbareTabs === undefined ? {} : { sichtbareTabs })}
      {...(navigationsRechte === undefined ? {} : { navigationsRechte })}
      {...(beschriftungen === undefined ? {} : { beschriftungen })}
    >
      <h1 className="mb-s4 text-h1 text-text">Dieses Modul wird noch gebaut</h1>
      <p data-cse="noch-nicht" className="max-w-[72ch] text-base text-text-muted">
        {/* `break-all`: ein Musterpfad wie `/portal/[mandant]/einstellungen/benutzer`
            hat keine Trennstelle, und ohne Umbruch schob er bei 375px die ganze
            Seite seitwaerts (WCAG 1.4.10). */}
        <code className="break-all text-text">{pfad}</code> steht in der Seitenkarte und
        ist Ihnen freigegeben — die Seite dahinter entsteht
        {phase === null ? ' in einer späteren Phase' : ` in Phase ${phase}`}.
      </p>
      <p className="mt-s4 max-w-[72ch] text-sm text-text-subtle">
        Hier steht bewusst kein leerer Bildschirm mit einer Überschrift: eine
        leere Liste liest sich wie „es gibt nichts“, und das wäre eine Aussage
        über Ihre Daten statt über den Bauzustand.
      </p>
    </PortalRahmen>
  );
}
