import { NextResponse, type NextRequest } from 'next/server';
import {
  KontoGesperrtFehler, NichtAngemeldetFehler, NichtGefundenFehler,
  ZuVieleVersucheFehler, ZweiterFaktorFehler,
} from './fehler.js';
import { erwarteterUrsprung, internerPfad } from './ursprung.js';

/**
 * Die HTTP-Antwort zu einem Autorisierungsfehler — an EINER Stelle.
 *
 * **Warum das eine eigene Datei bekommt.** `authorize` wirft; jede Route, die
 * es aufruft, muss den Wurf uebersetzen. Wer das vergisst, bekommt fuer ein
 * FEHLENDES RECHT eine **500** — und damit genau das Orakel, das AUT-06
 * verhindern soll: 500 heisst „hier ist etwas", 404 heisst nichts. Der Fall
 * faellt beim Bauen nicht auf, weil er nur eintritt, wenn jemand ohne das
 * Recht die Route aufruft; im gruenen Pfad wirft niemand.
 *
 * **Und warum hier auch die Anmeldung steht** (D-766, V-256). Eine Route,
 * die ohne Sitzung oder ohne zweiten Faktor angesprochen wird, antwortete
 * einem nativen Browserformular mit `{"fehler":"keine_sitzung"}` — der Mensch,
 * dessen Sitzung abgelaufen war, sah eine weisse Seite mit JSON und verlor
 * dabei, was er gerade abgeschickt hatte. D-599 sagt „ein Browser bekommt
 * eine Seite, ein Programm bekommt JSON"; D-692 Nr. 7 hatte die Wächter
 * davon ausgenommen. Die Ausnahme ist aufgehoben — und zwar HIER, nicht an
 * den 218 Stellen in 170 Dateien, die die Antwort selbst schrieben:
 * `ohneSitzungAntwort`, `ohneFaktorAntwort` und `anmeldungsAntwort`
 * entscheiden, ob ein Formular fragt, und wohin es dann geht.
 * `tests/kern/sitzung-formularweg.test.ts` hält den Baum dagegen.
 *
 * **Und die Lesewege** (D-768, V-258): ein Download-Link nach abgelaufener
 * Sitzung endete genauso — 22 `GET`-Routen (Belege, Exporte, Rechnungsdateien)
 * schrieben ihr 401 selbst. Eine Navigation des Browsers bekommt jetzt
 * dieselbe Anmeldung, und zurück geht es auf die Seite, von der der Download
 * kam (`tests/kern/sitzung-leseweg.test.ts`).
 */

// ---------------------------------------------------------------------------
// Wer fragt: ein Browserformular oder ein Programm?
// ---------------------------------------------------------------------------

/**
 * Die Felder eines schon gelesenen Formulars: `FormData` oder der Rumpf aus
 * `liesRumpf` (`api/rumpf.ts`). Strukturell beschrieben, damit dieser Dienst
 * nichts aus `src/app` importiert.
 */
export type GeleseneFelder =
  | { get(name: string): FormDataEntryValue | null }
  | { readonly felder: Readonly<Record<string, string>>; readonly json: boolean };

/** Die zwei Rümpfe, die ein `<form method="post">` ohne Skript schickt. */
const FORMULAR_RUMPF: ReadonlySet<string> = new Set([
  'application/x-www-form-urlencoded', 'multipart/form-data',
]);

function feld(felder: GeleseneFelder, name: string): string | undefined {
  if ('felder' in felder) {
    /* Ein JSON-Rumpf ist ein Programm, auch wenn er ein Feld `zurueck` trägt. */
    if (felder.json) return undefined;
    const wert = felder.felder[name];
    return wert === undefined || wert === '' ? undefined : wert;
  }
  const wert = felder.get(name);
  return typeof wert === 'string' && wert !== '' ? wert : undefined;
}

/** Der Medientyp eines Kopfes, ohne Parameter (`; boundary=…`, `; charset=…`). */
function medientyp(kopf: string | null): string {
  return (kopf ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Nimmt der Aufrufer AUSDRÜCKLICH eine HTML-Seite an?
 *
 * Jeder Browser schickt `text/html` im `Accept` einer Navigation — und das
 * Absenden eines Formulars IST eine. `fetch()` schickt ohne Angabe nur den
 * Platzhalter „Stern/Stern", und der zählt hier nicht: ein Skript, das
 * `FormData` postet (`Schichtfoto`), will JSON und liest es. `text/html;q=0`
 * heisst „nicht annehmbar" (RFC 9110).
 */
function willSeite(anfrage: Request): boolean {
  return (anfrage.headers.get('accept') ?? '').split(',').some((teil) => {
    const [typ, ...parameter] = teil.split(';');
    if (typ?.trim().toLowerCase() !== 'text/html') return false;
    const q = parameter.map((p) => p.trim()).find((p) => /^q=/iu.test(p));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

/**
 * Ist dieser Aufruf ein Browserformular (D-599, D-692 Nr. 1, D-766)?
 *
 * **Dasselbe Kriterium wie auf den Fehlerwegen — nicht ein neues.**
 *
 *  1. Sind die Felder schon gelesen, entscheiden sie: ein Formular mit
 *     `fehlerweg` oder `zurueck` ist ein Portalformular (`grundAufsFormularweg`,
 *     D-692 Nr. 1), ein JSON-Rumpf nie (`liesRumpf` → `json`).
 *  2. VOR dem Rumpf — und dort steht fast jeder Sitzungswächter — gibt es
 *     keine Felder. Dort entscheidet der Rumpf selbst: `urlencoded` oder
 *     `multipart/form-data`, wie die Grössenprüfung der Schichtwege es schon
 *     tut (D-692 Nachsatz (i)), und dazu `Accept: text/html` — damit ein
 *     Skript, das `FormData` postet, weiter JSON bekommt.
 *
 * **Warum der Wächter den Rumpf nicht liest, um die Felder zu fragen.** Wer
 * keine Sitzung hat, bekommt keine Arbeit gemacht: ein `multipart`-Rumpf mit
 * Fotos wäre sonst ganz gelesen, bevor feststeht, dass ihn niemand annehmen
 * darf.
 *
 * **Wohin es kippt, wenn ein Browser kein `text/html` schickt:** auf JSON —
 * die Antwort von vorher, nicht eine neue Sackgasse. D-599 hatte den Kopf
 * genau deshalb nicht zur alleinigen Weiche gemacht; hier ist er es nur, wo
 * es keine Felder gibt.
 */
export function istBrowserFormular(anfrage: Request, felder?: GeleseneFelder): boolean {
  if (felder !== undefined
      && (feld(felder, 'fehlerweg') !== undefined || feld(felder, 'zurueck') !== undefined)) {
    return true;
  }
  return FORMULAR_RUMPF.has(medientyp(anfrage.headers.get('content-type'))) && willSeite(anfrage);
}

/** `HEAD` antwortet wie `GET`, nur ohne Rumpf (RFC 9110) — also mit demselben Status. */
const LESE_METHODEN: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/**
 * Ist dieser Aufruf eine NAVIGATION des Browsers — ein Verweis, ein
 * Download-Link, eine eingetippte Adresse (D-768, V-258)?
 *
 * **Dasselbe Merkmal wie beim Formular, nur ohne Rumpf.** Ein `GET` trägt
 * keinen; es bleibt `Accept` mit AUSDRÜCKLICHEM `text/html` (`willSeite`).
 * Das schickt jeder Browser, wenn er eine Adresse aufruft; `fetch()` ohne
 * Angabe schickt nur den Platzhalter, ein `<img>` Bildtypen und den
 * Platzhalter — beide bleiben ein Programm und bekommen JSON.
 *
 * **Kein zweites Merkmal.** `Sec-Fetch-Mode`/`Sec-Fetch-Dest` wertet die
 * Plattform nirgends aus (nur `Sec-Fetch-Site`, als Riegel gegen fremde
 * Einbettung, und dort ausdrücklich „fehlt er, geht die Anfrage durch" —
 * ältere Telefone schicken ihn nicht). Ein Merkmal, das ausgerechnet diesen
 * Telefonen fehlt, wäre hier ein neues und das falsche.
 */
export function istBrowserNavigation(anfrage: Request): boolean {
  return LESE_METHODEN.has(anfrage.method.toUpperCase()) && willSeite(anfrage);
}

/** Bekommt dieser Aufrufer eine Seite statt JSON: ein Formular (D-766) oder eine Navigation (D-768)? */
function bekommtSeite(anfrage: Request, felder?: GeleseneFelder): boolean {
  return istBrowserFormular(anfrage, felder) || istBrowserNavigation(anfrage);
}

// ---------------------------------------------------------------------------
// Wohin es zurückgeht
// ---------------------------------------------------------------------------

/**
 * Die Seite, auf die der Mensch nach der Anmeldung zurückkehrt — nur ein
 * eigener Pfad, sonst `null` (D-560, D-766).
 *
 * Gesucht wird die SEITE DES FORMULARS: `fehlerweg` (D-692 Nr. 2 — genau
 * dafür gibt es das Feld), sonst die Seite, von der der Browser kam
 * (`Referer`; die Plattform schickt ihn eigenen Seiten vollständig,
 * `strict-origin-when-cross-origin`, SEC-A7), sonst `zurueck` — das Ziel des
 * Erfolgs, meist die Liste daneben.
 *
 * Eine NAVIGATION (D-768) will zuerst dorthin zurück, wohin sie wollte — die
 * angefragte Adresse selbst, wenn sie eine Seite ist. Ein Download unter
 * `/api/…` ist keine: dann gilt die Seite, von der er kam (`Referer`), und
 * fehlt auch die, reist kein `weiter` mit und die Anmeldung führt ins Portal.
 *
 * Jeder Kandidat geht durch `internerPfad`: ein fremder Ursprung, ein
 * Schema-Wechsel, `//boese.example`, `/\boese.example` und `/.//boese.example`
 * fallen durch. Und er muss eine SEITE sein — `/api/…` ist keine, und
 * `/auth/…` wäre eine Schleife zurück in die Anmeldung.
 */
export function rueckkehrAdresse(anfrage: NextRequest, felder?: GeleseneFelder): string | null {
  const kandidaten = [
    felder === undefined ? undefined : feld(felder, 'fehlerweg'),
    istBrowserNavigation(anfrage)
      ? `${anfrage.nextUrl.pathname}${anfrage.nextUrl.search}` : undefined,
    anfrage.headers.get('referer') ?? undefined,
    felder === undefined ? undefined : feld(felder, 'zurueck'),
  ];
  for (const roh of kandidaten) {
    const pfad = internerPfad(roh, anfrage);
    if (pfad !== null && !/^\/(?:api|auth)(?:[/?#]|$)/u.test(pfad)) return pfad;
  }
  return null;
}

/** Welche Anmeldung passt: E-Mail und Kennwort, oder Mobilnummer und Code. */
export type Anmeldeweg = 'verwaltung' | 'beschaeftigte';

/** Die beiden Eingänge unter `src/app/auth` (EMP-01, AUT-01). */
export const ANMELDUNG: Readonly<Record<Anmeldeweg, string>> = {
  verwaltung: '/auth/login',
  beschaeftigte: '/auth/mitarbeiter',
};

/** Der Faktor-Schritt (AUT-02) — `einrichten` reicht mit Faktor an `pruefen` weiter. */
export const FAKTOR_SCHRITT = '/auth/zwei-faktor/einrichten';

/** Was eine Wächterantwort über das Formular weiss. */
export interface Formularweg {
  /** Die schon gelesenen Felder — sie entscheiden zuerst. */
  readonly felder?: GeleseneFelder | undefined;
  /**
   * Die Anmeldung dieser Route. Ohne Angabe entscheidet die Rückkehradresse:
   * eine Seite unter `/portal/mein` gehört den Beschäftigten, jede andere der
   * Verwaltung (Leitung und Kunden melden sich dort ebenfalls an, AUT-01).
   */
  readonly anmeldung?: Anmeldeweg;
}

function anmeldewegFuer(weg: Formularweg, rueckkehr: string | null): Anmeldeweg {
  if (weg.anmeldung !== undefined) return weg.anmeldung;
  return rueckkehr !== null && /^\/portal\/mein(?:[/?#]|$)/u.test(rueckkehr)
    ? 'beschaeftigte' : 'verwaltung';
}

/** 303 auf einen Pfad dieses Ursprungs, mit `weiter=`, wenn es eine Rückkehr gibt. */
function weiterleitung(anfrage: NextRequest, pfad: string, rueckkehr: string | null): NextResponse {
  const ziel = new URL(pfad, erwarteterUrsprung(anfrage));
  if (rueckkehr !== null) ziel.searchParams.set('weiter', rueckkehr);
  return NextResponse.redirect(ziel, 303);
}

// ---------------------------------------------------------------------------
// Die Wächter
// ---------------------------------------------------------------------------

/**
 * Ohne brauchbare Sitzung (401) — für ein Programm JSON wie bisher, für ein
 * Browserformular (D-766) und eine Navigation per `GET` (D-768) eine Seite.
 *
 * `sitzung` ist, was `aktuelleSitzung()` lieferte:
 *
 *  - `null`: nicht (mehr) angemeldet → 303 auf die passende Anmeldung, mit
 *    `weiter=<Rückkehradresse>`; beide Anmeldungen führen danach dorthin.
 *  - eine Sitzung OHNE aktiven Bereich (Gruppenansicht, ein Konto vor der
 *    Bereichswahl — Invariante 10): angemeldet ist sie. Die Anmeldung wäre
 *    hier die falsche Seite; `/portal` weiss, wohin diese Sitzung gehört
 *    (Gruppenübersicht, Bereichswahl).
 *
 * Ein Programm bekommt `{"fehler":"keine_sitzung"}` mit 401 — auf JEDEM
 * Schreibweg derselbe Code; drei Benachrichtigungswege schrieben bis D-766
 * `nicht_angemeldet`, gerufen nur von Formularen.
 */
export function ohneSitzungAntwort(
  anfrage: NextRequest,
  sitzung: { readonly aktiverMandantId: string | null } | null,
  weg: Formularweg = {},
): NextResponse {
  if (!bekommtSeite(anfrage, weg.felder)) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (sitzung !== null) return weiterleitung(anfrage, '/portal', null);
  const rueckkehr = rueckkehrAdresse(anfrage, weg.felder);
  return weiterleitung(anfrage, ANMELDUNG[anmeldewegFuer(weg, rueckkehr)], rueckkehr);
}

/**
 * Ohne zweiten Faktor (403, AUT-02) — für ein Browserformular und eine
 * Navigation (D-768) der Faktor-Schritt mit Rückkehr, wie die Pforte es für
 * Seiten tut (`portal/zugang.ts`, V-136); für ein Programm JSON wie bisher.
 *
 * **`einrichten`, nicht `pruefen`.** Die Pforte fragt die Datenbank, ob ein
 * Faktor hinterlegt ist; eine Route, deren Transaktion gerade abgebrochen
 * ist, weiss es nicht. `einrichten` reicht ein Konto MIT bestätigtem Faktor
 * an `pruefen` weiter (samt `weiter=`) und richtet ihn sonst ein — dasselbe
 * Ende wie bei der Pforte, einen Schritt später.
 */
export function ohneFaktorAntwort(anfrage: NextRequest, weg: Formularweg = {}): NextResponse {
  if (!bekommtSeite(anfrage, weg.felder)) {
    return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
  }
  return weiterleitung(anfrage, FAKTOR_SCHRITT, rueckkehrAdresse(anfrage, weg.felder));
}

/**
 * Die Antwort auf einen Wurf, der die ANMELDUNG betrifft — keine Sitzung
 * (`NichtAngemeldetFehler`), kein zweiter Faktor (`ZweiterFaktorFehler`) —,
 * sonst `null`.
 *
 * Für die Gerüste, die Dienstfehler an `status` und `code` erkennen: beide
 * Klassen tragen beides und liefen dort als „fachlicher Fehler" mit
 * `?meldung=` zurück aufs Formular. Diese Frage kommt VOR jener.
 */
export function anmeldungsAntwort(
  fehler: unknown, anfrage: NextRequest, weg: Formularweg = {},
): NextResponse | null {
  if (fehler instanceof NichtAngemeldetFehler) return ohneSitzungAntwort(anfrage, null, weg);
  if (fehler instanceof ZweiterFaktorFehler) return ohneFaktorAntwort(anfrage, weg);
  return null;
}

/**
 * Das 404 für „gibt es nicht" UND „darf nicht" — byte-gleich, auch hinter
 * einem Formular (AUT-06, D-656 Nr. 2, D-682 Nr. 2).
 */
export function nichtGefundenAntwort(): NextResponse {
  return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
}

/**
 * Die Antwort zu einem Wurf von `authorize` — `null` heisst: DIESER Fehler
 * gehoert nicht hierher. Der Aufrufer wirft ihn weiter, damit ein
 * Programmfehler ein roter Lauf bleibt und nicht als huebsche 404 im Formular
 * landet.
 *
 * `anfrage` ist Pflicht (D-766): ohne sie lässt sich nicht entscheiden, ob
 * ein Formular fragt — und die Antwort ohne Sitzung wäre wieder eine weisse
 * JSON-Seite.
 */
export function autorisierungsAntwort(
  fehler: unknown, anfrage: NextRequest, weg: Formularweg = {},
): NextResponse | null {
  if (fehler instanceof NichtGefundenFehler) return nichtGefundenAntwort();
  const anmeldung = anmeldungsAntwort(fehler, anfrage, weg);
  if (anmeldung !== null) return anmeldung;
  if (fehler instanceof KontoGesperrtFehler) {
    return NextResponse.json({ fehler: 'konto_gesperrt' }, { status: 403 });
  }
  if (fehler instanceof ZuVieleVersucheFehler) {
    return NextResponse.json({ fehler: 'zu_viele_versuche' }, { status: 429 });
  }
  return null;
}
