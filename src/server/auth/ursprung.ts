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
 * `x-forwarded-host` wird **nicht** gelesen. Er ist vom Aufrufer setzbar, ohne
 * dass ein Browser ihn je selbst schickt — ihn zu lesen hiesse, den erwarteten
 * Ursprung vom Aufrufer bestimmen zu lassen.
 *
 * SEC-A7 (HSTS) verkleinert das Restfenster zusätzlich, ersetzt diese Prüfung
 * aber nicht: HSTS wirkt erst nach dem ersten Besuch und nur im Browser.
 *
 * ## Der Befund, der `nextUrl.host` hier abgelöst hat
 *
 * Oben stand: „Der Rechnername bleibt `nextUrl.host`: den leitet Next.js aus
 * dem `Host`-Kopf ab." **Das tut Next.js nicht.** `NextRequest.nextUrl` trägt
 * die Adresse, unter der der SERVER läuft — im Betrieb `localhost:3000` —, und
 * zwar unabhängig davon, welchen `Host` der Browser geschickt hat. Nachgemessen
 * am laufenden Server: mit `Host: 192.168.0.193` und
 * `Origin: http://192.168.0.193` kam `fremder_ursprung` zurück; mit demselben
 * `Host` und `Origin: http://localhost:3000` ging dieselbe Anfrage durch.
 *
 * Die Folge war keine Kleinigkeit: **jeder** schreibende Weg — 77 Routen —
 * antwortete 403, sobald jemand die Plattform unter einer anderen Adresse
 * aufrief als der, unter der der Server gestartet wurde. Im Telefon-Browser
 * über die LAN-Adresse, hinter einem Reverse-Proxy, unter der späteren
 * Produktionsdomain: lesen ja, schreiben nie. Und weil das Tor korrekt 403
 * meldet, sah es aus wie eine Sicherheitsfunktion, die ihre Arbeit tut.
 *
 * Verglichen wird deshalb gegen den `Host`-Kopf — die Adresse, die der
 * BROWSER angesprochen hat. Das ist auch die Prüfung, die Next.js für seine
 * eigenen Server Actions macht (deshalb ging die Anmeldung am Telefon,
 * während jede API-Route abwies), und dieselbe, die Django und Rails führen.
 *
 * **Warum der `Host`-Kopf hier trägt, obwohl er fälschbar ist.** CSRF setzt
 * den Browser des Opfers voraus: der setzt `Host` aus der Adresse, die das
 * Opfer besucht hat, und `Origin` aus der Seite, die das Formular schickt. Wer
 * beide Köpfe selbst schreibt, hat kein fremdes Sitzungskeks und greift damit
 * niemanden an — er redet mit dem Server über sein eigenes Konto.
 *
 * ## `CSE_VERTRAUTE_URSPRUENGE`
 *
 * Ein Reverse-Proxy, der `Host` auf seinen eigenen Namen umschreibt, bricht
 * den Vergleich trotzdem. Für diesen Fall nennt die Umgebung die erlaubten
 * Ursprünge ausdrücklich, kommagetrennt — eine LISTE, die jemand hinschreibt,
 * nicht ein Kopf, den der Aufrufer mitbringt.
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

/**
 * Der Rechnername, den der BROWSER angesprochen hat.
 *
 * `nextUrl.host` ist es nicht — siehe den Befund oben. Fehlt der `Host`-Kopf
 * (HTTP/1.0, ein Werkzeug ohne Köpfe), bleibt `nextUrl.host` als Rückfall;
 * eine Anfrage ohne `Host` kommt von keinem Browser und wird gleich darauf am
 * fehlenden `Origin` scheitern.
 */
function wirt(anfrage: NextRequest): string {
  const kopf = anfrage.headers.get('host');
  return kopf !== null && kopf !== '' ? kopf : anfrage.nextUrl.host;
}

/** Der Ursprung, den eine echte Anfrage dieser Anwendung tragen muss. */
export function erwarteterUrsprung(anfrage: NextRequest): string {
  const roh = `${schema(anfrage)}://${wirt(anfrage)}`;
  /*
   * Ueber `URL` normalisiert: `https://cse.example:443` und
   * `https://cse.example` sind derselbe Ursprung, und der Browser schickt im
   * `Origin` immer die kurze Form. Von Hand verglichen waeren sie verschieden.
   */
  try {
    return new URL(roh).origin;
  } catch {
    return roh;
  }
}

/**
 * Ursprünge, die die Umgebung ausdrücklich erlaubt — für einen Proxy, der den
 * `Host`-Kopf umschreibt.
 *
 * Leer ist die Vorgabe und der Normalfall. Was hier steht, hat ein Mensch
 * hingeschrieben; nichts davon kommt aus der Anfrage.
 */
function vertrauteUrspruenge(): readonly string[] {
  const roh = process.env['CSE_VERTRAUTE_URSPRUENGE'] ?? '';
  return roh.split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((t) => { try { return new URL(t).origin; } catch { return ''; } })
    .filter((t) => t !== '');
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
    const ursprung = new URL(roh).origin;
    return ursprung === erwarteterUrsprung(anfrage)
      || vertrauteUrspruenge().includes(ursprung);
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
  // DIESELBE Herkunft wie das Tor oben, nicht `nextUrl.origin`: hinter einem
  // TLS-beendenden Proxy steht dort `http`, und ein interner Redirect zeigte
  // dann auf `http://…` — ein Downgrade auf dem Rueckweg aus dem Portal.
  const basis = new URL(erwarteterUrsprung(anfrage));
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
