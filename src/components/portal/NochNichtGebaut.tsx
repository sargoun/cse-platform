import { PortalRahmen } from './PortalRahmen';
import { bauzustandTexte } from '@/lib/i18n/intern';
import { gemerkteHuelle } from '@/app/portal/huellen-speicher';
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
  /**
   * **Ob die SITZUNG schreibgeschuetzt ist — nicht, ob die Seite leer ist.**
   *
   * Hier stand `nurLesen` fest auf wahr, und das war eine Verwechslung mit
   * Folgen. „Nur Lesen" ist in dieser Plattform die Aussage ueber eine
   * Sitzung: die Gruppenansicht schreibt nicht (Invariante 10). Auf einer
   * Seite, die bloss noch nicht gebaut ist, sagte dasselbe Schild einer
   * Mitarbeiterin, ihr KONTO duerfe nichts — und genau so hat es ein Nutzer
   * gelesen, der daraufhin fragte, warum sein Mitarbeiter keine Stunden
   * erfassen koenne. Ein Bauzustand wurde zur Rechteauskunft.
   *
   * Der Wert kommt deshalb aus der Sitzung und nicht aus dieser Datei. In der
   * Gruppenansicht steht das Schild weiterhin — dort stimmt es.
   */
  readonly nurLesen?: boolean;
}

export function NochNichtGebaut({
  titel, bereich, leiste, wurzel, sichtbareTabs, aktiverTab, phase, pfad, navigationsRechte,
  beschriftungen, nurLesen = false,
}: NochNichtGebautProps) {
  /*
   * Die Sprache kommt aus dem Anfragespeicher, nicht aus einer Eigenschaft
   * (D-592) — diese Seite steht an 136 Routen, und 136 Aufrufe um eine
   * Eigenschaft zu ergaenzen hiesse, sie bei der 137. zu vergessen.
   */
  const t = bauzustandTexte(gemerkteHuelle().sprache);
  const [vor, nach] = t.satz(phase);
  return (
    <PortalRahmen
      titel={titel}
      bereich={bereich}
      nurLesen={nurLesen}
      leiste={leiste}
      wurzel={wurzel}
      {...(aktiverTab === undefined ? {} : { aktiverTab })}
      {...(sichtbareTabs === undefined ? {} : { sichtbareTabs })}
      {...(navigationsRechte === undefined ? {} : { navigationsRechte })}
      {...(beschriftungen === undefined ? {} : { beschriftungen })}
    >
      <h1 className="mb-s4 text-h1 text-text">{t.titel}</h1>
      <p data-cse="noch-nicht" className="max-w-[72ch] text-base text-text-muted">
        {/* `break-all`: ein Musterpfad wie `/portal/[mandant]/einstellungen/benutzer`
            hat keine Trennstelle, und ohne Umbruch schob er bei 375px die ganze
            Seite seitwaerts (WCAG 1.4.10). */}
        <code className="break-all text-text">{pfad}</code>{vor}{nach}
      </p>
      <p className="mt-s4 max-w-[72ch] text-sm text-text-subtle">
        {t.warumKeinLeererBildschirm}
      </p>
    </PortalRahmen>
  );
}
