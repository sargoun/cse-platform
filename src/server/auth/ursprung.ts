/**
 * Das Ursprungstor — die CSRF-Schranke vor jedem schreibenden Handler.
 *
 * Es stand sechsmal fast gleich in sechs Route-Dateien und verglich dabei nur
 * `URL.host`. `host` ist Rechnername plus Port und **enthält das Schema
 * nicht**: `http://cse.example` und `https://cse.example` haben denselben
 * `host`. Eine Seite, die unter `http` auf demselben Namen liegt, kam damit
 * durch das Tor einer `https`-Anfrage — die Schranke war für genau den
 * Angriff offen, gegen den sie steht.
 *
 * Verglichen wird deshalb der **ganze Ursprung**: Schema, Rechnername, Port.
 *
 * ## Warum nicht einfach `anfrage.nextUrl.origin`
 *
 * Hinter einem Vercel- oder Reverse-Proxy endet TLS am Proxy. Die Anwendung
 * sieht dahinter `http`, während der Browser `https` gesprochen hat. Ein
 * strenger Vergleich gegen `nextUrl.origin` würde dann **jede echte** Anfrage
 * abweisen — das Tor wäre zu, aber für die Falschen.
 *
 * Das Schema kommt darum aus `x-forwarded-proto`, wenn der Proxy es setzt,
 * sonst aus der Anfrage selbst. Der Rechnername bleibt `nextUrl.host`: den
 * leitet Next.js aus dem `Host`-Kopf ab, und mehr als der `Host`-Kopf steht
 * dem Server ohnehin nicht zur Verfügung.
 *
 * `x-forwarded-host` wird **nicht** gelesen. Er ist vom Aufrufer setzbar und
 * würde erlauben, sich den erwarteten Ursprung selbst zu bestimmen — das Tor
 * wäre dann eine Formsache. `x-forwarded-proto` allein zu nehmen ist der
 * kleinere Preis: er kann eine `http`-Anfrage als `https` ausgeben, was
 * niemandem etwas nützt, der nicht ohnehin schon denselben Rechnernamen hält.
 *
 * SEC-A7 (HSTS) verkleinert das Restfenster zusätzlich, ersetzt diese Prüfung
 * aber nicht: HSTS wirkt erst nach dem ersten Besuch und nur im Browser.
 */
import type { NextRequest } from 'next/server';

/** Das Schema, das der Browser gesprochen hat — nicht das, was hinter dem Proxy ankommt. */
function schema(anfrage: NextRequest): string {
  const weitergeleitet = anfrage.headers.get('x-forwarded-proto');
  if (weitergeleitet !== null && weitergeleitet !== '') {
    // Mehrere Proxys hängen mit Komma an; der erste ist der äußerste.
    const erstes = weitergeleitet.split(',')[0]?.trim();
    if (erstes !== undefined && erstes !== '') return erstes;
  }
  return anfrage.nextUrl.protocol.replace(/:$/, '');
}

/** Der Ursprung, den eine echte Anfrage dieser Anwendung tragen muss. */
export function erwarteterUrsprung(anfrage: NextRequest): string {
  return `${schema(anfrage)}://${anfrage.nextUrl.host}`;
}

/**
 * Trägt die Anfrage den Ursprung dieser Anwendung?
 *
 * Fehlt der `Origin`-Kopf, ist die Antwort **nein**. Das ist die
 * fail-closed-Richtung: ein Formular aus dem eigenen Portal schickt ihn immer
 * mit, ein `curl`-Aufruf ohne Kopf hat kein Anrecht auf eine schreibende
 * Handlung.
 */
export function istGleicherUrsprung(anfrage: NextRequest): boolean {
  const roh = anfrage.headers.get('origin');
  if (roh === null || roh === '') return false;
  try {
    return new URL(roh).origin === erwarteterUrsprung(anfrage);
  } catch {
    return false;
  }
}

/**
 * Das Ziel nach dem Import — und warum `new URL(zurueck, basis)` nicht reicht.
 *
 * Ein ABSOLUTER Wert ignoriert die Basis: `new URL('https://boese.example',
 * 'https://cse.example')` ergibt `https://boese.example`. Das Feld `zurueck`
 * kommt aus dem Formular, also vom Aufrufer — ein praeparierter POST schickte
 * den angemeldeten Benutzer nach dem Import auf eine fremde Seite, und der
 * Weg dorthin begann sichtbar im eigenen Portal.
 *
 * Genommen wird darum nur der PFAD, und nur, wenn er im eigenen Ursprung
 * landet. Alles andere faellt auf das Standardziel zurueck — still, weil ein
 * Fehler hier dem Angreifer mehr saegte als dem Benutzer.
 */
export function internesZiel(
  zurueck: string | null | undefined, standard: string, anfrage: NextRequest,
): URL {
  const basis = new URL(anfrage.nextUrl.origin);
  if (zurueck === null || zurueck === undefined || zurueck === '') {
    return new URL(standard, basis);
  }
  try {
    const ziel = new URL(zurueck, basis);
    if (ziel.origin !== basis.origin) return new URL(standard, basis);
    // Nur Pfad, Abfrage und Anker uebernehmen — nie Anmeldedaten im Ziel.
    return new URL(`${ziel.pathname}${ziel.search}${ziel.hash}`, basis);
  } catch {
    return new URL(standard, basis);
  }
}
