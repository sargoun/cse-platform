/**
 * Das Route-Manifest — welche Route welches Recht verlangt.
 *
 * Es steht hier und nicht verstreut in den Handlern, weil die
 * Aufzählungsprüfung (PR 6 Akzeptanz 5, PR 7 Akzeptanz 6) eine Liste braucht,
 * gegen die sie prüfen kann. Ein Handler, der sein Recht nur in seinem eigenen
 * Rumpf kennt, ist von aussen nicht auf Vollständigkeit prüfbar — und "wir
 * haben `authorize()` überall aufgerufen" ist genau die Behauptung, die eine
 * einzige vergessene Datei falsch macht.
 *
 * Eine Route, die absichtlich offen ist, steht mit `oeffentlich: true` drin.
 * Sie fehlt nicht — sie ist eine Entscheidung, die jemand getroffen und
 * unterschrieben hat.
 */

export interface RouteEintrag {
  /** Der Pfad unter `src/app`, z. B. `healthz` oder `api/kunden`. */
  readonly pfad: string;
  /** Der Rechteschlüssel, oder `null` für eine bewusst offene Route. */
  readonly recht: string | null;
  /** Warum sie offen ist. Pflicht, wenn `recht` null ist. */
  readonly grund?: string;
}

export const ROUTEN: readonly RouteEintrag[] = [
  {
    pfad: 'healthz',
    recht: null,
    grund:
      'Liveness-Probe für Vercel und die Überwachung. Gibt Build und Region zurück und '
      + 'liest keine Zeile — hinter einer Anmeldung wäre sie als Probe unbrauchbar.',
  },
  {
    pfad: 'llms.txt',
    recht: null,
    grund:
      'PUB-12. Beschreibt die Gruppe für Sprachmodelle und enthält ausschliesslich, was '
      + 'ohnehin öffentlich steht — Firma, Anschrift, Telefon aus `mandant` und die '
      + 'veröffentlichten Seiten. Hinter einer Anmeldung wäre die Datei sinnlos.',
  },
  {
    pfad: 'api/anfrage',
    recht: null,
    grund:
      'REQ-01 … REQ-07. Der Weg, auf dem jemand OHNE Konto ein Angebot anfragt — hinter '
      + 'einer Anmeldung gäbe es keine Anfrage. Was sie schützt, sind nicht Rechte des '
      + 'Aufrufers, sondern Honigtopf, Ratenlimit auf `ip_hash`, Validierung gegen die '
      + 'Formularversion (SEC-A4) und ein Prinzipal, der `formular.schreiben` hält und '
      + '`formular.lesen` nicht.',
  },
  {
    pfad: 'api/sitzung/mandant',
    recht: null,
    grund:
      '03-AUTH §4.4. Der Wechsel des aktiven Bereichs verlangt kein MODULRECHT — es gibt '
      + 'keines dafür, und es gäbe auch keinen Mandanten, gegen den man es prüfen könnte: '
      + 'gefragt wird ja gerade nach einem anderen. Bewacht wird sie durch die Sitzung '
      + '(`aktuelleSitzung`), den Origin-Vergleich, und vor allem durch die zwei '
      + '`security definer`-Funktionen `app.mandant_fuer_wechsel` (nur Bereiche aus '
      + '`switcher_mandanten()`) und `app.darf_gruppenansicht` (die drei Bedingungen aus '
      + '§4.5) — plus den Trigger `kern.sitzung_mandant_pruefen`, der eine fremde Zeile '
      + 'auch dann abweist, wenn diese Route je umgangen würde.',
  },
  {
    /**
     * Die drei Angebotsuebergaenge. Das Recht ist `angebot.versenden` und
     * nicht `angebot.schreiben`: es gibt den Uebergang frei, der etwas aus
     * dem Haus laesst (Invariante 7). Anlegen und Wandeln laufen ueber
     * dieselbe Adresse, weil sie dieselbe Sitzung, denselben Ursprungscheck
     * und denselben Mandantenkontext brauchen — und weil drei Adressen fuer
     * drei Zeilen Unterschied drei Stellen waeren, an denen die Pruefung
     * fehlen kann.
     */
    pfad: 'api/angebot',
    recht: 'angebot.versenden',
  },
  {
    /**
     * Hochladen UND uebernehmen tragen dasselbe Recht: die Vorschau legt
     * bereits Zwischenzeilen an, und wer eine Datei in den Mandanten schiebt,
     * schreibt — auch wenn das lebende Raumbuch erst der zweite Schritt
     * beruehrt.
     */
    pfad: 'api/raumbuch-import',
    recht: 'objekt_import.schreiben',
  },
] as const;

/** Die Routen, die ein Recht verlangen. */
export const GESCHUETZTE_ROUTEN: readonly RouteEintrag[] =
  ROUTEN.filter((r) => r.recht !== null);
