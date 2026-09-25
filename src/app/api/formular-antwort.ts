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
 * Der Grund eines abgewiesenen FORMULARS, aus dem Formular selbst gelesen —
 * mit `fehlerweg` vor `zurueck` (V-198, D-692).
 *
 * **Zwei Felder, weil es zwei Ziele sind.** `zurueck` ist das Ziel des
 * ERFOLGS — nach einer Abwesenheitsmeldung die Liste der Anträge. Ein
 * Fehlschlag gehört dorthin, wo das Formular steht, sonst steht der Satz über
 * einer Liste, in der die Eingabe fehlt; das sagt `fehlerweg`. Fehlt es, ist
 * `zurueck` die Seite des Formulars selbst (Wachbuch, Fotos, Bautagebuch).
 *
 * **Ohne beide Felder ist der Aufrufer kein Portalformular**, sondern ein
 * Programm — und das bekommt JSON mit dem Status (D-599: „ein Browser bekommt
 * eine Seite, ein Programm bekommt JSON"). Nie wird ein Satz mitgeschickt: die
 * Seite schlägt den Grund in IHRER Sprache nach, und ein Satz eines Dienstes
 * ist deutsch.
 */
export function grundAufsFormularweg(
  anfrage: NextRequest, daten: FormData, grund: string, status: number,
): NextResponse {
  const feld = (name: string): string | undefined => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert !== '' ? wert : undefined;
  };
  const weg = feld('fehlerweg') ?? feld('zurueck');
  if (weg === undefined) return NextResponse.json({ fehler: grund }, { status });
  const ziel = internesZiel(weg, HEIMWEG, anfrage);
  ziel.searchParams.set('fehler', grund);
  return NextResponse.redirect(ziel, 303);
}

/**
 * Die Antwort auf einen FACHLICHEN Fehler — als Umleitung fuer ein Formular,
 * als JSON fuer einen JSON-Aufrufer.
 *
 * **Fuer einen neuen Aufrufer ist `grundAufsFormular` der Weg** (D-753): der
 * Satz eines Dienstes ist deutsch und traegt manchmal eine Kennung, und eine
 * Seite, die `?meldung=` roh zeigt, zeigt auch jeden Text aus einem
 * praeparierten Link. Die beiden Zeitrouten, fuer die diese Weiche gebaut
 * wurde, schicken seit V-197/D-753 einen Grund.
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
