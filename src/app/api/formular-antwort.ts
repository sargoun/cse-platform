import { NextResponse, type NextRequest } from 'next/server';
import { internesZiel } from '@/server/auth/ursprung';

/**
 * Ein Formular darf nicht auf einer weissen Seite mit JSON enden.
 *
 * **Der Befund, der diese Datei gebaut hat.** `POST /api/abwesenheiten/[id]`
 * und `POST /api/antraege/[id]` antworteten im Fehlerfall mit
 * `{"fehler":"…"}`. Beide werden ausschliesslich von Portalformularen ohne
 * JavaScript aufgerufen. Bei `GrundFehlt` oder `UrlaubskontoFehlt` landete
 * der Mensch also auf einer weissen Seite mit einem JSON-Objekt — sein
 * Entwurf weg, der Rueckweg der Zurueck-Knopf. Die beiden Seiten lasen dafuer
 * `?meldung=` aus und hielten einen Hinweisblock bereit: toter Code, weil ihn
 * niemand setzte.
 *
 * **Warum das eine eigene Datei ist und keine Kopie in `api/personal`.**
 * `fuehrePersonalAus` (api/personal/gemeinsam.ts) hatte die Weiche schon, als
 * Teil seines Geruests. Die zwei Zeitrouten liegen aber nicht unter
 * `api/personal` und haben ein anderes Geruest (sie ehren `zurueck` auch im
 * ERFOLGSfall, weil dieselbe Route aus einer Liste UND aus einem Detailblatt
 * angesprochen wird). Sie an das Personal-Geruest zu haengen haette diesen
 * Unterschied eingeebnet; die Weiche abzuschreiben haette zwei Stellen
 * ergeben, von denen eine beim naechsten Umbau anders aussieht.
 *
 * `zurueck` laeuft durch `internesZiel`: ein Ziel ausserhalb dieser Anwendung
 * ist kein Rueckweg, sondern eine offene Weiterleitung (D-560).
 */

/** Der Wegweiser, wenn `zurueck` nicht in diese Anwendung zeigt (D-560). */
const HEIMWEG = '/portal';

/**
 * Wie `fehlerAufsFormular`, aber mit einem GRUND statt eines Satzes (V-158).
 *
 * **Wann der Grund und nicht der Satz.** Der Satz eines Dienstes ist deutsch
 * und manchmal mit Kennung („Einteilung 3f2a… gibt es in dieser Gesellschaft
 * nicht") — in einer Oberfläche, die auch Englisch spricht, ist beides falsch.
 * Wo die Zielseite ihre Sätze zweisprachig in `lib/i18n/verwaltung/` führt,
 * reist deshalb nur der Schlüssel (`?fehler=<grund>`), und die Seite schlägt
 * ihn in ihrer Sprache nach. Ein Schlüssel, den sie nicht kennt, bekommt dort
 * einen allgemeinen Satz — nie den rohen Schlüssel.
 */
export function grundAufsFormular(
  anfrage: NextRequest,
  argumente: {
    readonly json: boolean;
    readonly zurueck: string | undefined;
    readonly grund: string;
  },
): NextResponse | null {
  if (argumente.json) return null;
  const zurueck = argumente.zurueck;
  if (zurueck === undefined || zurueck === '') return null;
  const trenner = zurueck.includes('?') ? '&' : '?';
  return NextResponse.redirect(
    internesZiel(
      `${zurueck}${trenner}fehler=${encodeURIComponent(argumente.grund)}`,
      HEIMWEG, anfrage),
    303,
  );
}

/**
 * Die Antwort auf einen FACHLICHEN Fehler — als Umleitung fuer ein Formular,
 * als JSON fuer einen JSON-Aufrufer.
 *
 * `null` heisst: dafuer ist diese Weiche nicht zustaendig (kein Formular oder
 * kein `zurueck`). Der Aufrufer antwortet dann wie bisher mit JSON — das ist
 * die richtige Antwort fuer eine Schnittstelle und die einzig moegliche ohne
 * eine Seite, auf die man zurueckkehren koennte.
 */
export function fehlerAufsFormular(
  anfrage: NextRequest,
  argumente: {
    readonly json: boolean;
    readonly zurueck: string | undefined;
    readonly meldung: string;
  },
): NextResponse | null {
  if (argumente.json) return null;
  const zurueck = argumente.zurueck;
  if (zurueck === undefined || zurueck === '') return null;
  const trenner = zurueck.includes('?') ? '&' : '?';
  return NextResponse.redirect(
    internesZiel(
      `${zurueck}${trenner}meldung=${encodeURIComponent(argumente.meldung)}`,
      HEIMWEG, anfrage),
    303,
  );
}
