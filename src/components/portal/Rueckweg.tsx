import { Hinweis } from '@/components/ui/Hinweis';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * Der Ausgang eines abgeschickten Formulars auf seiner Seite — ein Schlüssel
 * aus der Adresse, ein Satz aus der Tabelle der Seite (D-769, D-772, V-274).
 *
 * **Der Befund.** Die CRM-Seiten zeigten `?meldung=` und `?erfolg=` so, wie sie
 * in der Adresse standen: den deutschen Satz eines Dienstes (in einer
 * englischen Sitzung ebenso), rohe Datenbanktexte, die Eingabe des Menschen —
 * und jeden Text, den jemand in einen Link schrieb, als Warnung oder als
 * Bestätigung des Portals. Das Kundenblatt schlug `?grund=` mit eckigen
 * Klammern nach: `?grund=__proto__` fand `Object.prototype`, React warf, die
 * Seite antwortete mit 500 (D-728).
 *
 * **Hier steht der Weg einmal.** Eine Abweisung wird der Satz zu ihrem Grund,
 * nur als eigener Eintrag nachgeschlagen; ein Grund, den die Tabelle nicht
 * kennt, wird ihr allgemeiner Satz — nie der Schlüssel, nie Text aus der
 * Adresse. Eine Bestätigung erscheint nur zu einem Schlüssel, den die Tabelle
 * kennt: ein allgemeines „Gespeichert." zu einem unbekannten Wort wäre eine
 * Bestätigung, die ein Verweis fälschen kann (wie `vermerkt` im Radar, V-271).
 * Der Warnkasten trägt `rolle="alert"`, der Erfolgskasten `rolle="status"` —
 * beide melden den Ausgang eines Formulars (DESIGN §5 „Notices", §9).
 */

/** Die Sätze einer Abweisung: der fett gesetzte Anfang, der allgemeine Satz, einer je Grund. */
export interface AbweisungSaetze {
  readonly titel: string;
  readonly sonst: string;
  readonly fehler: Readonly<Record<string, string>>;
}

/**
 * Ein Schlüssel aus der Adresse — eine einzelne, nicht leere Zeichenkette,
 * sonst `null`. Ein doppelter Parameter (`?fehler=a&fehler=b`) ist keiner.
 */
export function einSchluessel(wert: unknown): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

/** Der Satz zu einem Grund — oder der allgemeine der Seite. Nie der Grund selbst. */
export function abweisungsSatz(saetze: AbweisungSaetze, grund: string): string {
  return eigenerEintrag(saetze.fehler, grund) ?? saetze.sonst;
}

/** Der Warnkasten einer Abweisung — nichts, solange die Adresse keinen Grund trägt. */
export function Abweisung({ saetze, grund, cse, className = 'mb-s5 max-w-prose' }: {
  readonly saetze: AbweisungSaetze;
  readonly grund: string | null;
  /** Der `data-cse`-Anker für die Browsersuite. */
  readonly cse: string;
  readonly className?: string;
}) {
  if (grund === null) return null;
  return (
    <Hinweis art="warnung" rolle="alert" cse={cse} className={className}>
      <strong>{saetze.titel}</strong> {abweisungsSatz(saetze, grund)}
    </Hinweis>
  );
}

/** Der Erfolgskasten — nur zu einem Schlüssel, den die Tabelle kennt. */
export function Bestaetigung({ saetze, erfolg, cse, className = 'mb-s5 max-w-prose' }: {
  readonly saetze: Readonly<Record<string, string>>;
  readonly erfolg: string | null;
  readonly cse: string;
  readonly className?: string;
}) {
  const satz = eigenerEintrag(saetze, erfolg);
  if (satz === undefined) return null;
  return (
    <Hinweis art="erfolg" rolle="status" cse={cse} className={className}>
      {satz}
    </Hinweis>
  );
}
