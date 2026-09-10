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
    pfad: 'api/check-in/[token]',
    recht: null,
    grund:
      'TIM-07, TIM-08, K-08 Registerzeile 3. Die Kraft, die um 05:55 im Treppenhaus einen '
      + 'Link antippt, hat keine Anmeldung — hinter einer gäbe es keinen Check-in, und ein '
      + 'Recht, gegen das man prüfen könnte, gibt es in diesem Moment nicht. Was sie '
      + 'schützt, ist die Marke: ein 256-Bit-Geheimnis, gespeichert nur als SHA-256, gültig '
      + 'genau einmal und nur in seinem abgeleiteten Fenster, eingelöst in EINER bedingten '
      + 'Anweisung (K-09). Der Prinzipal ist `cse_checkin` und hält kein einziges '
      + 'Tabellenrecht: er darf genau `app.checkin_verbrauchen` ausführen, und die Funktion '
      + 'leitet Mandant, Beschäftigung und Mensch aus der Einteilung ab, nie aus der '
      + 'Anfrage. Jede Ablehnung — unbekannt, abgelaufen, zu früh, widerrufen, benutzt — '
      + 'ergibt dieselbe Antwort, damit die Adresse kein Orakel ist (AUT-06).',
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
  {
    /**
     * Eine Notiz festhalten und die naechste Aktion setzen. `crm.schreiben`,
     * nicht `crm.lesen`: beides aendert den Datenbestand, auch wenn das eine
     * nur ein Satz ist.
     */
    pfad: 'api/lead',
    recht: 'crm.schreiben',
  },
  {
    /** Der Auftragsassistent (OPS-10). Legt an, also `auftrag.schreiben`. */
    pfad: 'api/auftrag',
    recht: 'auftrag.schreiben',
  },
  {
    /**
     * Einen Planungskonflikt quittieren (TIM-05).
     *
     * `dienstplan.konflikt_quittieren` und **nicht** `dienstplan.schreiben`:
     * wer quittiert, aendert den Plan nicht, sondern uebernimmt die
     * Verantwortung dafuer, ihn so zu lassen. Das sind zwei Entscheidungen,
     * und wer die eine darf, darf darum nicht automatisch die andere.
     */
    pfad: 'api/konflikt',
    recht: 'dienstplan.konflikt_quittieren',
  },
  {
    /**
     * Die Werte bestaetigen, auf denen ein Preis ruht (OPS-07).
     *
     * `kalkulation.schreiben` und nicht `angebot.schreiben`: wer hier
     * eintraegt, aendert den RECHENWEG, nicht den Text des Angebots. Und
     * nicht `angebot.versenden`, denn dieser Weg laesst nichts aus dem Haus
     * — er macht den Versand nur moeglich, und der bleibt ein eigener Klick
     * mit eigenem Recht (Invariante 7).
     */
    pfad: 'api/kalkulation',
    recht: 'kalkulation.schreiben',
  },
  {
    pfad: 'api/zeit/einwand',
    recht: null,
    grund:
      'EMP-07. Der eine Schreibweg, den ein Mitarbeitender in der Zeitdomäne besitzt — er '
      + 'meldet eine Abweichung an seinem eigenen Zeiteintrag. Der Rechtekatalog führt dafür '
      + 'KEINEN Schlüssel: §12.4 markiert das Einreichen als Selbstzugriff (`S`), und einen '
      + 'Schlüssel zu erfinden, den man anschliessend jeder Mitarbeiterrolle bindet, prüfte '
      + 'nichts und behauptete zu prüfen (K-19). Offen ist die Route deshalb nur im Sinne von '
      + '"kein Modulrecht": sie verlangt eine Sitzung mit Person, löst den Mandanten '
      + 'serverseitig aus der Anstellung auf (nie aus der Anfrage, K-02) und schreibt gegen '
      + 'die Policy `t_selbst_einreichen`, die ausschliesslich Zeilen zulässt, deren '
      + 'Anstellung dem angemeldeten Menschen gehört. Geändert wird dabei nichts: der '
      + 'Zeiteintrag bleibt, bis die Planung entschieden hat.',
  },
  {
    /**
     * Die Entscheidung ueber einen fremden Einwand (EMP-07).
     *
     * `zeit.einwand_entscheiden` und nicht `zeit.schreiben`: wer Zeiten
     * erfasst, befindet damit noch nicht ueber die Meldung eines Kollegen —
     * dieselbe Trennung wie `dienstplan.konflikt_quittieren` gegen
     * `dienstplan.schreiben`. Die KORREKTUR danach ist ein dritter Vorgang
     * mit dem dritten Recht (`zeit.korrigieren`, TIM-11).
     */
    pfad: 'api/zeit/einwand/entscheidung',
    recht: 'zeit.einwand_entscheiden',
  },
  {
    /**
     * TIM-05, TIM-06, SEC-04, LEG-03, LEG-04 — der einzige Schreibweg auf
     * `einsatz_zuordnung`. `dienstplan.schreiben` ist das Recht des Planers;
     * die beiden Tore, die der Dienst durchläuft, prüfen nicht die
     * Berechtigung, sondern die Zulässigkeit — ein Planer mit jedem Recht
     * darf keinen Wachmann ohne § 34a-Nachweis einteilen.
     */
    pfad: 'api/einsaetze/[id]/besetzen',
    recht: 'dienstplan.schreiben',
  },
  {
    /**
     * R-08. Absagen ist dieselbe Entscheidung wie Einteilen, in die andere
     * Richtung, und trägt deshalb dasselbe Recht. Gelöscht wird nichts
     * (Invariante 8): die Zeile bleibt mit Grund und Zeitpunkt stehen.
     */
    pfad: 'api/einsaetze/[id]/absagen',
    recht: 'dienstplan.schreiben',
  },
  {
    pfad: 'api/check-in/[token]/offline',
    recht: null,
    grund:
      'TIM-09, K-08 Registerzeile 4. Die Kraft, deren Telefon im Treppenhaus kein Netz '
      + 'hatte, hat keine Anmeldung — hinter einer gäbe es diese Nachreichung nicht. Was sie '
      + 'schützt, ist DIESELBE Marke wie beim Check-in, derselbe Prinzipal `cse_checkin` '
      + 'ohne ein einziges Tabellenrecht und dieselbe Funktion aus dem geschlossenen '
      + 'K-08-Register: die Wiedergabe ist Check-in-Material, das spät ankommt, und ein '
      + 'zweiter, laxerer Weg wäre kein zweiter Weg, sondern ein Umgehungsweg. Sie erzeugt '
      + 'KEINEN Zeiteintrag (§9.4) und antwortet in jedem Fall 202, damit die Adresse kein '
      + 'Orakel darüber ist, ob eine Marke auflöst (AUT-06).',
  },
  {
    pfad: 'api/check-in/[token]/medien',
    recht: null,
    grund:
      'TIM-10, DOC-06, K-08 Registerzeile 4. Dieselbe Marke, derselbe Prinzipal und '
      + 'dieselbe Funktion wie die Nachreichung: die Aufnahme fährt als `art = foto` durch '
      + 'die Warteschlange, statt eine SECHSTE Zeile im geschlossenen K-08-Register zu '
      + 'minten (D-135). Was sie schützt, ist die Marke plus die Prüfkette der Route selbst '
      + '— Grösse, Typ aus Magic Bytes, Metadaten entfernt, privater Bucket. Der Mandant '
      + 'kommt aus der Marke, nie aus der Anfrage.',
  },
  {
    /**
     * Die eine Adresse, unter der eine Schichtaufnahme erreichbar ist.
     *
     * `zeit.lesen`, weil `einsatz_medien` unter dem Modul `zeit` liegt — die
     * Aufnahme haengt an einem Zeiteintrag oder an einer Schicht. Die Route
     * gibt eine SIGNIERTE Adresse zurueck, nie die Datei und nie einen
     * Bucket-Pfad, und die Zeile wird durch die Sitzung des Aufrufers
     * gelesen, damit RLS dieselbe Bedingung ein zweites Mal prueft (SEC-A6).
     */
    pfad: 'api/medien/[id]',
    recht: 'zeit.lesen',
  },
  {
    /**
     * Ueber eine nachgereichte Behauptung entscheiden (TIM-09).
     *
     * `zeit.nacherfassung_pruefen` und nicht `zeit.schreiben`: wer Zeiten
     * erfasst, befindet damit noch nicht ueber die Behauptung eines Menschen,
     * dass er gearbeitet hat. Uebernehmen und Ablehnen laufen ueber dieselbe
     * Adresse, weil sie dieselbe Sitzung, denselben Ursprungscheck und
     * denselben Mandantenkontext brauchen.
     */
    pfad: 'api/offline-ereignis/[id]',
    recht: 'zeit.nacherfassung_pruefen',
  },
] as const;

/** Die Routen, die ein Recht verlangen. */
export const GESCHUETZTE_ROUTEN: readonly RouteEintrag[] =
  ROUTEN.filter((r) => r.recht !== null);
