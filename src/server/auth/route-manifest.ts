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
    pfad: '.well-known/security.txt',
    recht: null,
    grund:
      'RFC 9116, neben SEC-A7. Eine `.well-known`-Datei hinter einer Anmeldung erfüllt '
      + 'ihren Zweck nicht: sie wird von Prüfwerkzeugen und Sicherheitsforschenden ohne '
      + 'Sitzung abgeholt, und wer eine Lücke findet, soll sie melden können, ohne ein '
      + 'Konto zu haben. Sie enthält nur, was ohnehin veröffentlicht werden soll — eine '
      + 'Kontaktadresse, ein Ablaufdatum, zwei Sprachen. Und sie antwortet 404, solange '
      + 'kein Postfach benannt ist (O-35): eine Adresse, die niemand liest, ist '
      + 'schlechter als keine Datei (SEITENKARTE §2.5).',
  },
  {
    pfad: 'api/berichte/[bericht]/csv',
    recht: 'bericht.exportieren',
    grund:
      'REP-07. Ein EIGENES Recht neben `bericht.lesen`: wer eine Zahl ansehen darf, darf '
      + 'sie nicht schon aus dem Haus tragen. Eine CSV-Datei verlässt das Portal und damit '
      + 'jede Zugriffskontrolle darin — sie liegt danach in einem Downloads-Ordner, einem '
      + 'Mailanhang, einem geteilten Laufwerk. Der Bereich kommt aus der SITZUNG; '
      + '`?mandant=` steht nur für den Dateinamen in der Adresse (Invariante 3).',
  },
  {
    pfad: 'api/kalender/[token]',
    recht: null,
    grund:
      'CAL-03. Die einzige Route ohne Sitzung, die Mandantendaten herausgibt — und deshalb '
      + 'die mit der längsten Begründung. Ein Kalenderprogramm KANN sich nicht anmelden: '
      + 'es führt keinen zweiten Faktor und verhandelt kein Ablaufdatum. Der Token ersetzt '
      + 'die Anmeldung, NICHT die Rechte: er sagt, WER liest, und danach entscheiden '
      + 'dieselben Policies wie im Portal, was dieser Mensch sieht — die Route bindet eine '
      + 'Sitzung für ihn und stellt dieselbe Abfrage wie die Seite. Gespeichert ist der '
      + 'SHA-256 des Tokens, nie der Token; er gilt nur lesend, nur für die eigenen '
      + 'Einträge, und ein Widerruf wirkt beim nächsten Abruf. Ein falscher Token ist 404 '
      + 'und nicht 401: ein 401 lüde zum zweiten Versuch ein.',
  },
  {
    pfad: 'api/kalender-feed/anlegen',
    recht: null,
    grund:
      'CAL-03. Ein Recht davor hiesse, dass jemand seinen EIGENEN Kalender nicht abonnieren '
      + 'darf — und es gäbe keinen Schlüssel, der das ausdrückt. `t_feed_eigene` bindet jede '
      + 'Zeile an `app.aktueller_benutzer()`; geschützt ist der Weg durch die Methode (nur '
      + 'POST) und das Ursprungstor. Der Token steht genau einmal in der Antwort und danach '
      + 'nirgends mehr.',
  },
  {
    pfad: 'api/kalender-feed/widerrufen',
    recht: null,
    grund:
      'CAL-03, dieselbe Begründung wie beim Anlegen: ein eigener Zugang, an '
      + '`app.aktueller_benutzer()` gebunden. Ein fremder Zugang antwortet wie ein nicht '
      + 'vorhandener — die Policy lässt das `update` gar nicht greifen, und die Route sagt '
      + 'nicht, ob es die Zeile gibt (AUT-06).',
  },
  {
    pfad: 'api/benachrichtigungen/[id]/oeffnen',
    recht: null,
    grund:
      'NOT-01, NOT-03. Der Posteingang ist PERSÖNLICH: `t_benachrichtigung_lesen_setzen` '
      + 'bindet jede Zeile an `empfaenger_id = app.aktueller_benutzer()`. Ein Recht davor '
      + 'hiesse, dass jemand eine Mitteilung bekommen kann, die er nicht ansehen darf. '
      + 'Geschützt ist der Weg stattdessen durch die Methode (nur POST — ein GET, das '
      + 'stempelt, leert den Posteingang von allein), durch das Ursprungstor und dadurch, '
      + 'dass das ZIEL aus der Zeile kommt und nicht aus dem Rumpf: ein Feld dafür wäre '
      + 'eine offene Weiterleitung (D-504). Eine fremde Zeile trifft null Zeilen und '
      + 'antwortet 404 wie jede fremde Zeile (AUT-06).',
  },
  {
    pfad: 'api/benachrichtigungen/gelesen',
    recht: null,
    grund:
      'NOT-01, dieselbe Begründung wie darüber: persönlicher Posteingang, POST, '
      + 'Ursprungstor, geprüfter Rückweg (D-504).',
  },
  {
    pfad: 'api/benachrichtigungen/praeferenz',
    recht: null,
    grund:
      'NOT-02. Es sind die EIGENEN Einstellungen; `t_praeferenz_eigene` bindet sie an '
      + '`app.aktueller_benutzer()`. Die Arten kommen aus dem Register und nicht aus dem '
      + 'Rumpf — sonst liesse sich eine Zeile für eine Art schreiben, die es nicht gibt.',
  },
  {
    /**
     * Anlegen, Stand setzen, zuweisen, erledigen, abbrechen (OPS-11).
     *
     * `aufgabe.schreiben` traegt alle fuenf; das Zuweisen prueft der Handler
     * zusaetzlich gegen `aufgabe.zuweisen` — die Seite entscheidet, was sie
     * ZEIGT, der Handler, was er TUT (AUT-04). Es gibt KEINEN
     * `loeschen`-Vorgang: `aufgabe` traegt die Loeschsperre aus 0230, und
     * Abbrechen mit Pflichtgrund ist die Antwort auf „nicht mehr noetig".
     */
    pfad: 'api/aufgaben',
    recht: 'aufgabe.schreiben',
  },
  {
    /**
     * Faden eroeffnen, antworten, schliessen, wieder oeffnen — und den EIGENEN
     * Gelesen-Stempel setzen (EMP-11, NOT-03).
     *
     * `nachricht.versenden` fuer alles Schreibende. Der Gelesen-Stempel laeuft
     * durch denselben Handler OHNE Recht: `t_empfaenger_eigene_stempeln`
     * (0231) bindet ihn an `app.aktueller_benutzer()` bzw.
     * `app.aktuelle_person()`, und ein Recht davor hiesse, dass jemand eine
     * Nachricht bekommen kann, die er nicht als gelesen markieren darf.
     * Geschuetzt ist der Weg durch die Methode (nur POST — ein GET, das
     * stempelt, leert den Posteingang von allein, D-504) und das Ursprungstor.
     *
     * Nach draussen geht hier nichts: das laeuft ueber `sendeNachAussen`,
     * `kern.nachricht_sendetor()` und die Freigabekette (Invariante 7).
     */
    pfad: 'api/nachrichten',
    recht: 'nachricht.versenden',
  },
  {
    pfad: 'auth/abmelden',
    recht: null,
    grund:
      'AUT-01, SPEC §3. Derselbe Vorgang wie `api/abmelden` darunter und aus demselben '
      + 'Grund offen: er beendet die EIGENE Sitzung, und der Aufrufer weist sie durch '
      + 'den Besitz des Tokens aus — ein Recht zu verlangen hiesse, eine Abmeldung an '
      + 'eine Berechtigung zu binden, die gerade entzogen worden sein kann. Geschützt '
      + 'durch die Methode (nur POST, kein GET-Export) und durch das Ursprungstor.',
  },
  {
    pfad: 'auth/callback',
    recht: null,
    grund:
      'AUT-01. Die Rückleitung des Identitätsanbieters — sie findet VOR jeder Sitzung '
      + 'statt, ein Recht hätte niemanden zu prüfen. Solange kein Supabase-Projekt '
      + 'hinterlegt ist (O-501), stellt sie nichts aus: sie leitet zur Anmeldung zurück '
      + 'bzw. antwortet 501, statt so zu tun, als wäre ein Anbieter da.',
  },
  {
    pfad: 'api/abmelden',
    recht: null,
    grund:
      'AUT-01. Der Gegenweg zur Anmeldung: er beendet die EIGENE Sitzung, und der '
      + 'Aufrufer weist sie durch den Besitz des Tokens aus — ein Recht zu verlangen '
      + 'hiesse, eine Abmeldung an eine Berechtigung zu binden, die gerade entzogen '
      + 'worden sein kann. Geschützt ist sie stattdessen durch die Methode: POST, damit '
      + 'kein fremdes Bild-Tag und kein Vorauslader sie auslösen kann, und durch den '
      + 'Zuschnitt der Anweisung auf `token_hash = $1 and beendet_am is null` — mehr als '
      + 'die eigene, noch offene Zeile ist damit nicht erreichbar.',
  },
  {
    /**
     * Der Ausloeser der Nachtlaeufe (SPEC §14).
     *
     * `recht: null`, und das ist KEINE offene Route: sie verlangt ein
     * Geheimnis im Kopf `x-job-token`, das in konstanter Zeit verglichen
     * wird, und antwortet ohne gesetztes `JOB_TOKEN` mit 503 statt
     * ersatzweise zu laufen. Ein Rechteschluessel waere hier die falsche
     * Sperre: der Aufrufer ist ein Zeitplan und kein Mensch — er hat keine
     * Sitzung, keinen Mandanten und keine Rolle, gegen die `authorize()`
     * etwas pruefen koennte.
     *
     * Was sie dennoch nicht darf: mehr tun, als der Job tut. Der Lauf
     * selbst verbindet sich als `cse_job`, und die Mandantenschleife
     * kommt aus `mandant`, nicht aus der Anfrage. Wer das Geheimnis hat,
     * kann einen Nachtlauf ausloesen — er kann damit nichts lesen.
     */
    pfad: 'api/jobs/[schluessel]',
    recht: null,
    grund:
      'SPEC §14. Der externe Zeitplan (Supabase cron / Vercel cron) hat keine Sitzung, '
      + 'gegen die sich ein Recht pruefen liesse. Gesperrt ist sie stattdessen durch ein '
      + 'Geheimnis in `JOB_TOKEN`, in konstanter Zeit verglichen; ohne gesetztes '
      + 'Geheimnis antwortet sie 503 „nicht verbunden" und loest nichts aus. Ein '
      + 'falsches Geheimnis bekommt 404, nicht 403 (AUT-06).',
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
     * Die Preisfreigabe eines Angebots (0295). `angebot.preis_freigeben` und
     * nicht `angebot.schreiben`: wer eine Position tippt, hat den Preis damit
     * nicht verantwortet. Eine EIGENE Adresse neben `api/angebot`, weil das
     * Manifest EIN Recht je Pfad fuehrt — ein weiteres `aktion=` auf der
     * bestehenden Route liesse die Aufzaehlungsprobe von aussen nichts mehr
     * sehen.
     */
    pfad: 'api/angebot/freigabe',
    recht: 'angebot.preis_freigeben',
  },
  {
    /**
     * Annahme oder Ablehnung durch den Kunden festhalten.
     * `angebot.annahme_erfassen`: eine Willenserklaerung des Kunden
     * PROTOKOLLIEREN ist etwas anderes, als das Angebot zu schreiben oder es
     * zu versenden — drei Handlungen, drei Schluessel.
     */
    pfad: 'api/angebot/entscheidung',
    recht: 'angebot.annahme_erfassen',
  },
  {
    /**
     * Ein Angebot VON HAND — der Weg, der nicht durch ein Raumbuch führt
     * (V-005, SEC-01, BAU-01).
     *
     * `angebot.schreiben` und nicht `angebot.versenden`: hier entsteht ein
     * ENTWURF ohne Nummer, und er verlässt das Haus nicht. Der Versand bleibt
     * mit seinem eigenen Schlüssel auf `api/angebot`, die Preisfreigabe auf
     * `api/angebot/freigabe` — drei verschieden schwere Handlungen, drei
     * Adressen, drei Rechte.
     *
     * **Warum nicht ein viertes `aktion=` auf `api/angebot`.** Das Manifest
     * führt EIN Recht je Pfad. Ein weiterer Zweig in einem Handler, der nach
     * aussen `angebot.versenden` heisst, machte aus dem Schreibrecht eine
     * Angabe, die die Aufzählungsprobe nicht mehr sehen kann — dieselbe
     * Begründung wie bei `api/angebot/freigabe`.
     *
     * `t_mandant` auf `angebot` und `angebotsposition` (0024) verlangt
     * `angebot.schreiben` bei jedem Schreibvorgang ein zweites Mal.
     */
    pfad: 'api/angebot/von-hand',
    recht: 'angebot.schreiben',
  },
  {
    /**
     * Die Berichtigung eines ENTWURFS (V-130, D-626): eine Position ändern
     * oder entfernen, den ganzen Entwurf zurückziehen.
     *
     * `angebot.schreiben` und nicht `angebot.versenden`, aus demselben Grund
     * wie bei `von-hand`: hier verlässt nichts das Haus. Die Trennlinie ist
     * `versendet_am`, und `ap_unveraenderlich` (0024) hält sie in der
     * Datenbank — was danach kommt, ist eine neue Version mit Rückverweis.
     */
    pfad: 'api/angebot/entwurf',
    recht: 'angebot.schreiben',
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
     * Einen Raum anlegen, aendern oder ausser Dienst stellen.
     * `objekt.schreiben` — der Raum gehoert dem Objekt, und die Route bindet
     * `raum` an `objekt_id`, damit keine Kennung aus dem Formular ein Zimmer
     * in ein fremdes Haus haengt (K-02).
     */
    pfad: 'api/raum',
    recht: 'objekt.schreiben',
  },
  {
    /**
     * Der Leistungskatalog (0298): Kopf anlegen, Kopf aendern, Position
     * anlegen, Position aendern, Position ausser Kraft setzen — fuenf
     * Handlungen, ein Recht, weil sie denselben Katalog betreffen. Jede
     * Position ist an ihren `katalogId` gebunden, wie `api/raum` seinen Raum
     * an `objekt_id` bindet.
     */
    pfad: 'api/katalog',
    recht: 'katalog.schreiben',
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
     * Einen Auftrag abschliessen (0296, 0299). `auftrag.abschliessen` und
     * nicht `auftrag.schreiben`: der Abschluss beendet die Leistungspflicht
     * und startet Fristen — wer eine Position aendert, entscheidet das nicht
     * mit.
     */
    pfad: 'api/auftrag/abschluss',
    recht: 'auftrag.abschliessen',
  },
  {
    /**
     * Der Auftrag laeuft, ruht oder ist storniert (V-081, OPS-05).
     *
     * **`auftrag.schreiben` und ausdruecklich NICHT `auftrag.abschliessen`.**
     * Pausieren und Stornieren sind Auftragspflege; der Abschluss stellt nach
     * D-366 die FIN-18-Warnung im Rechnungsweg scharf und traegt deshalb sein
     * eigenes Recht (0296). `abgeschlossen` ist hier gar nicht waehlbar.
     *
     * Die zweite Linie ist der Ausloeser `kern.auftrag_status_pruefen` (0389)
     * mit der Tabelle der erlaubten Wege; `storniert` ist dort einwegig.
     */
    pfad: 'api/auftrag/status',
    recht: 'auftrag.schreiben',
  },
  {
    /**
     * Die Kundenfreigabe zur Nennung als Referenz (0296).
     * `referenz.kundenfreigabe_erfassen` und nicht `auftrag.schreiben`: was
     * hier festgehalten wird, ist die Erklaerung des KUNDEN, mit seinem Namen
     * werben zu duerfen — dasselbe Recht, das `t_referenz_pflege` in seiner
     * `with check` fuer jeden Schreibvorgang auf `referenz` verlangt.
     */
    pfad: 'api/auftrag/kundenfreigabe',
    recht: 'referenz.kundenfreigabe_erfassen',
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
     * Einen ArbZG-Befund uebersteuern (TIM-06) — **nicht** `api/konflikt`.
     * Dort wird der PLANUNGSKONFLIKT quittiert, hier der BEFUND dahinter
     * uebersteuert: zwei Aufzeichnungen, zwei Rechte, zwei Handlungen.
     * `app.arbzg_befund_quittieren` prueft nur `dienstplan.arbzg_lesen`,
     * also das schwaechere Recht; das staerkere setzt diese Route mit
     * `authorize()` selbst durch, die Datenbank ist hier die zweite Linie.
     */
    pfad: 'api/konflikt/uebersteuern',
    recht: 'dienstplan.arbzg_uebersteuern',
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
     * Ein Bild in die oeffentliche Galerie aufnehmen oder herausnehmen
     * (§5.21, PUB-04, 0170).
     *
     * `referenz.schreiben` — dasselbe Recht, das `t_medien_pflege` verlangt.
     * Die Route ist die erste Linie, die Policy die zweite: ein Bild, das auf
     * einer oeffentlichen Seite steht und dort nicht hingehoert, laesst sich
     * nicht zurueckholen.
     */
    pfad: 'api/website/galerie',
    recht: 'referenz.schreiben',
  },
  {
    /**
     * Ein Projekt auf die Website stellen oder zurueckziehen (§5.21, PRO-05).
     *
     * `referenz.veroeffentlichen` und NICHT `referenz.schreiben`: einen
     * Entwurf zu aendern und ihn mit dem Namen eines Kunden oeffentlich zu
     * machen sind zwei Entscheidungen, und die zweite traegt die
     * Kundenfreigabe. Der Dienst prueft sie zusaetzlich und sagt, was fehlt.
     */
    pfad: 'api/website/referenzen',
    recht: 'referenz.veroeffentlichen',
  },
  {
    /*
     * LEG-09, Art. 15–21 DSGVO. Der oeffentliche Eingang fuer
     * Betroffenenrechte — wie `api/anfrage` bewusst OHNE Konto: wer eine
     * Auskunft verlangt, ist per Definition niemand, den die Plattform kennt.
     * Geschrieben wird ueber den Eingangsprinzipal, der `formular.schreiben`
     * haelt und kein Leserecht.
     */
    /*
     * LEG-09. Entscheiden — im Gegensatz zum oeffentlichen Eingang daneben
     * verlangt dieser Weg alles: Sitzung, Mandant und das Recht. Entgegennehmen
     * darf jeder, entscheiden nur ein benannter Mensch.
     */
    /*
     * CRM-01/CRM-03. Kunde ODER Ansprechpartner — welches, entscheidet das
     * Feld `kundeId`. Eine Route fuer beides, weil beide dasselbe Recht
     * verlangen und dasselbe Formular sie erzeugt; zwei Routen waeren zwei
     * Stellen, an denen `crm.schreiben` steht.
     */
    pfad: 'api/crm/kunde',
    recht: 'crm.schreiben',
  },
  {
    /**
     * Die Nachricht an einen Kontakt (V-101, CRM-08, D-627).
     *
     * Das Kontaktblatt nannte diesen Endpunkt seit je als „nicht gebaut".
     * `crm.kommunikation_versenden` statt `crm.schreiben`: hier soll etwas das
     * Haus VERLASSEN (Invariante 7), und das Recht dazu ist ein anderes als
     * das, einen Kontakt zu pflegen. Im Katalog an super_admin, admin und
     * leitung gebunden — dieselben drei, die `freigabe.entscheiden` halten,
     * sodass wer schreibt auch benannt freigeben kann.
     */
    pfad: 'api/crm/nachrichten',
    recht: 'crm.kommunikation_versenden',
  },
  {
    /*
     * OPS-01/V-001/V-020. Anlegen ODER aendern ODER archivieren — welches,
     * entscheidet das Feld `aktion`. Eine Route fuer alle drei, weil alle drei
     * `objekt.schreiben` verlangen und aus Formularen derselben Flaeche
     * entstehen; drei Routen waeren drei Stellen, an denen dieses Recht steht,
     * und die dritte ist die, die beim naechsten Umbau vergessen wird.
     */
    pfad: 'api/objekt',
    recht: 'objekt.schreiben',
  },
  {
    /*
     * CRM-02/CRM-07. Anlegen ODER den Stand aendern. Ein Verlust traegt einen
     * Grund — beide Verlustzustaende, `verloren` wie `kein_bedarf`: eine
     * Pipeline, in der die Haelfte der Verluste „ohne Grund" heisst,
     * beantwortet keine einzige Frage.
     */
    pfad: 'api/crm/lead',
    recht: 'crm.schreiben',
  },
  {
    /*
     * CRM-01/FIN-15/K-05. Das Tor ist `crm.schreiben`; der Dienst verlangt
     * ZUSAETZLICH `crm_entgelt.lesen`, weil Debitorennummer, Zahlungsziel und
     * Mahnsperre `cse_app` spaltenweise entzogen sind. Hier steht das
     * schwaechere der beiden; der Dienst prueft das genaue und weist mit
     * deutschem Satz ab.
     */
    pfad: 'api/crm/kunde/konditionen',
    recht: 'crm.schreiben',
  },
  {
    /*
     * FIN-09/FIN-10/FIN-11. Vier Vorgaenge auf einem Blatt: `erechnung`
     * schreibt den Kundenstamm (`crm.schreiben`), `bauleistender`,
     * `bescheinigung` und `widerruf` sind Finanzangaben
     * (`finanzen.schreiben`). Die Route waehlt je `was`; hier steht das
     * schwaechere als Torpruefung, die Dienste pruefen das genaue.
     */
    pfad: 'api/crm/kunde/steuer',
    recht: 'crm.schreiben',
  },
  {
    /*
     * AUT-01/DOC-04. Ausstellen, neu einladen, entziehen. `cse_app` hat auf
     * `benutzer` nur SELECT — geschrieben wird ueber die SECURITY-DEFINER aus
     * 0249, die dasselbe Recht noch einmal pruefen.
     */
    pfad: 'api/crm/kunde/zugang',
    recht: 'system.benutzer_verwalten',
  },
  {
    /*
     * AUT-04/D-610. Ein Verwaltungskonto einladen — die absendende Haelfte,
     * die bis 0372 fehlte: die einzige Stelle, die in `benutzer` schrieb, war
     * der SEED.
     *
     * **`system.verwaltungskonto_erstellen` ist `nur_global`** — auch ein
     * Admin seiner eigenen Gesellschaft bekommt hier 404, weil `app.hat_recht`
     * fuer ein `nur_global`-Recht nur die globale Rolle auswertet (0169). Das
     * ist D-610: was bei Missbrauch die GRUPPE trifft, gehoert nach oben.
     *
     * Die Pruefung steht zweifach — hier und in
     * `app.verwaltungskonto_einladen` (0372), die zusaetzlich `aal2` verlangt.
     */
    pfad: 'api/system/verwaltungskonto',
    recht: 'system.verwaltungskonto_erstellen',
  },
  {
    /*
     * CRM-08/LEG-08. Die Rechtsgrundlage eines Ansprechpartners. Der Dienst
     * verlangt zusaetzlich `crm.schreiben`: die WITH-CHECK-Klausel von
     * `t_mandant` auf `ansprechpartner` gibt sonst „new row violates row-level
     * security policy" — richtig gesperrt, an der falschen Stelle erklaert.
     */
    pfad: 'api/crm/ansprechpartner/[id]/rechtsgrundlage',
    recht: 'crm.rechtsgrundlage_setzen',
  },
  {
    /*
     * CRM-08/LEG-08. Ein EIGENER Endpunkt mit eigenem Nachweis (Quelle,
     * Eingangsdatum, Umfang), nicht in die Rechtsgrundlage gefaltet: Art. 21
     * DSGVO ist nachweispflichtig, und beide Widersprueche sind Einwegwege.
     * Die Route waehlt je `umfang` zwischen `crm.rechtsgrundlage_setzen`
     * (Werbewiderspruch, taegliche Vertriebsarbeit) und
     * `datenschutz.auskunft_erstellen` (Vollwiderspruch, Entscheidung der
     * Datenschutzstelle). Hier steht das schwaechere.
     */
    pfad: 'api/crm/ansprechpartner/[id]/widerspruch',
    recht: 'crm.rechtsgrundlage_setzen',
  },
  {
    /*
     * CRM-04. Erledigen, verschieben, anlegen — ein Recht, drei Vorgaenge:
     * sie stehen auf derselben Liste und gehoeren demselben Menschen.
     * `anlegen` spiegelt nach `aufgabe` und `kalender_eintrag`, soweit
     * `aufgabe.schreiben` und `kalender.schreiben` reichen, und nennt in der
     * Rueckmeldung, was NICHT entstand (O-663).
     */
    pfad: 'api/crm/wiedervorlage',
    recht: 'crm.schreiben',
  },
  {
    /*
     * V-022, V-074, V-075, V-076. Ein fremdes Konto entsperren, entziehen,
     * wiedergeben oder seine Anmeldungen widerrufen.
     *
     * **Das Manifest nennt das GROESSERE der zwei Rechte.** Drei der vier
     * Handlungen verlangen `system.benutzer_verwalten`; der Sitzungswiderruf
     * verlangt `system.sitzung_widerrufen`, das bis `leitung` bindbar ist.
     * Welches im Einzelfall gilt, entscheidet die Route je Handlung — ein
     * festes Recht waere entweder zu eng (eine `leitung` kaeme nicht an den
     * Widerruf, fuer den sie gebunden ist) oder zu weit (der Zugangsentzug
     * hinge am kleineren Recht). Die vier Funktionen in `0379` fragen ihr
     * Recht ein zweites Mal, gegen den aktiven Mandanten.
     */
    pfad: 'api/konto/verwaltung',
    recht: 'system.benutzer_verwalten',
  },
  {
    /*
     * V-025, EMP-09. Die Krankmeldung am Telefon um 05:40.
     *
     * `zeit.abwesenheit_melden` ist DASSELBE Recht wie auf dem Weg der
     * Arbeiterin — die INSERT-Policy auf `abwesenheit` (0073) verlangt es von
     * beiden, und `admin` wie `leitung` halten es seit je. Was hier anders
     * ist, ist nicht das Recht, sondern WESSEN Anstellung eingetragen wird:
     * der zusammengesetzte Fremdschluessel haelt sie im Mandanten.
     */
    pfad: 'api/personal/abwesenheit',
    recht: 'zeit.abwesenheit_melden',
  },
  {
    /*
     * V-010, SEC-02, SEC-03, EMP-08, § 34a GewO. Die Sachkunde, das
     * Führungszeugnis, der Erste-Hilfe-Kurs — aufnehmen, bestätigen,
     * widerrufen.
     *
     * Ein Recht für alle drei: es ist dieselbe Personalstelle, die die
     * Urkunde in der Hand hält. `n_schreiben` und `n_aendern` (0030) pruefen
     * es ein zweites Mal, gegen den aktiven Mandanten.
     */
    pfad: 'api/personal/nachweise',
    recht: 'personal.nachweis_verwalten',
  },
  {
    /*
     * V-006, FIN-14, ACC-05. Lieferantenstammdaten anlegen, aendern, sperren,
     * archivieren.
     *
     * **Eine Route fuer vier Handlungen, weil es EIN Recht ist.**
     * `eingang.schreiben` deckt alle vier, und `t_mandant` auf `lieferant`
     * (0123) prueft es bei jeder. Anders als bei `api/konto/verwaltung`, wo
     * die Handlungen tatsaechlich an zwei verschiedenen Rechten haengen.
     */
    pfad: 'api/finanzen/lieferanten',
    recht: 'eingang.schreiben',
  },
  {
    /*
     * V-011, FIN-14, FIN-17, ACC-01, ACC-03. Eine Ausgabe erfassen,
     * freigeben, ablehnen oder buchen.
     *
     * **Das Manifest nennt das KLEINERE der zwei Rechte**, weil es das ist,
     * mit dem man die Route ueberhaupt betritt: erfassen ist Belegarbeit
     * (`eingang.schreiben`). Freigeben, ablehnen und buchen sind
     * Entscheidungen ueber Geld und verlangen `eingang.freigeben` — die
     * Route prueft das je Handlung. Ein gemeinsames Recht hiesse: wer eine
     * Quittung eintippen darf, gibt sie auch frei, und genau diese Trennung
     * ist das Vieraugenprinzip.
     */
    pfad: 'api/finanzen/ausgaben',
    recht: 'eingang.schreiben',
  },
  {
    /*
     * V-117, V-118, EMP-05. Den Urlaubsanspruch aus dem Arbeitsvertrag
     * nachtragen — und das Konto anlegen, falls der Nachtlauf noch nicht
     * durch war.
     *
     * `zeit.schreiben` und nicht `zeit.konto_abschliessen`: der Anspruch ist
     * eine Stammangabe, kein Abschluss. Wer ihn eintraegt, entscheidet nichts
     * ueber einen Monat — er schreibt auf, was im Vertrag steht.
     */
    pfad: 'api/personal/urlaubsanspruch',
    recht: 'zeit.schreiben',
  },
  {
    /*
     * V-120, D-04. Ein Sprachmodell freigeben — der Weg, den
     * `docs/EINRICHTEN-*.md` §9 bis hierher als handgeschriebene
     * SQL-Anweisung beschreiben musste.
     *
     * `system.einstellung_verwalten`, dasselbe Recht wie fuer die uebrigen
     * Plattformeinstellungen. Der ZEUGE kommt nicht aus dem Formular: den
     * setzt `trg_modell_register_zeuge` (0381) auf den, der schreibt.
     */
    pfad: 'api/system/modelle',
    recht: 'system.einstellung_verwalten',
  },
  {
    pfad: 'api/datenschutz/bearbeiten',
    recht: 'datenschutz.auskunft_erstellen',
  },
  {
    /*
     * V-031, Art. 12 Abs. 1. Eine Anfrage protokollieren, die NICHT durch das
     * oeffentliche Formular kam — Brief, Anruf, E-Mail, persoenlich.
     *
     * **Dasselbe Recht wie /bearbeiten, und das ist kein Versehen.** Wer den
     * Vorgang fuehren darf, nimmt den Brief auf, der ihn ausloest; ein eigenes
     * Recht braeuchten genau die Menschen zusaetzlich, die die Arbeit ohnehin
     * tun (K-19). Vom oeffentlichen Eingang daneben trennt sie die Policy
     * `t_betroffenenanfrage_aufnahme` (0378): dieser Weg kann `eingangsweg =
     * formular` nicht schreiben, und der oeffentliche Prinzipal nichts anderes.
     */
    pfad: 'api/datenschutz/aufnehmen',
    recht: 'datenschutz.auskunft_erstellen',
  },
  {
    /*
     * LEG-07. Eine gemeldete Barriere abschliessen. `referenz.schreiben`, weil
     * behoben wird, wer die Seite aendern kann — der Meldeweg daneben verlangt
     * gar kein Recht, und das ist die Richtung: melden darf jeder.
     */
    pfad: 'api/barrierefreiheit/erledigen',
    recht: 'referenz.schreiben',
  },
  {
    pfad: 'api/barrierefreiheit/meldung',
    recht: null,
    grund:
      'LEG-07, BFSG. Der gesetzliche Meldeweg fuer Barrieren. Ein Konto davor '
      + 'traefe genau die Menschen, fuer die er da ist — und ein Honigtopf oder '
      + 'ein Ratenlimit ebenso: ein Screenreader, der ein unsichtbares Feld doch '
      + 'ausfuellt, liesse die Meldung verwerfen, ohne dass jemand erfaehrt warum.',
  },
  {
    pfad: 'api/datenschutz/anfrage',
    recht: null,
    grund:
      'Art. 12 Abs. 2 DSGVO verlangt, die Ausuebung der Betroffenenrechte zu '
      + 'ERLEICHTERN. Ein Konto davor waere das Gegenteil — und die meisten '
      + 'Anfragenden haben keines. Der Schutz liegt nicht an der Tuer, sondern '
      + 'im Prinzipal: er darf anlegen und nicht lesen.',
  },
  {
    pfad: 'api/datenschutz/zuordnen',
    recht: 'datenschutz.auskunft_erstellen',
    grund:
      'LEG-09, Art. 12 Abs. 6. Ein EIGENER Weg neben /bearbeiten, weil die Zuordnung das '
      + 'Gegenteil einer Entscheidung ist: sie ist eine Feststellung, sie ist aenderbar, und '
      + 'sie darf keinen Vorgang abschliessen. Am selben Knopf wie „Beantwortet" haette '
      + 'irgendwann ein Vorgang als entschieden gegolten, weil jemand den falschen Menschen '
      + 'gesucht hat. Art und Kennung kommen als EIN Wert (`person:uuid`).',
  },
  {
    pfad: 'api/datenschutz/auskunft',
    recht: 'datenschutz.auskunft_erstellen',
    grund:
      'LEG-09, Art. 15. Liefert die Auskunft nur AUSGELIEFERT, wenn sie vollstaendig ist — '
      + 'sonst 409 mit den fehlenden Rechten. Eine halbe Art.-15-Auskunft geht an die '
      + 'betroffene Person und sieht aus wie eine Antwort. Jeder Abruf wird protokolliert und '
      + 'mit seiner Pruefsumme in `datenschutz_auskunft` festgehalten (SEC-A9).',
  },
  {
    pfad: 'api/datenschutz/berichtigung',
    recht: 'datenschutz.berichtigung_bearbeiten',
    grund:
      'LEG-09, Art. 16 und Art. 19. Ausdruecklich NICHT `datenschutz.auskunft_erstellen`: die '
      + 'drei Datenschutzrechte im Katalog sind drei Zustaendigkeiten, und sie hier zu einem '
      + 'zu verschmelzen nahm dem Katalog die Unterscheidung, die er absichtlich trifft.',
  },
  {
    pfad: 'api/datenschutz/loeschung',
    recht: 'datenschutz.loeschung_pruefen',
    grund:
      'LEG-09, Art. 17 gegen LEG-01/LEG-02. Diese Route LOESCHT NICHTS — sie haelt eine '
      + 'Entscheidung je Tabelle fest (04-SEITENKARTE §5.25). Solange es keinen '
      + 'Anonymisierungsweg gibt, ist das Ergebnis eine Vormerkung (O-644), und die Seite '
      + 'nennt sie so.',
  },
  {
    pfad: 'api/datenschutz/widerspruch',
    recht: 'datenschutz.auskunft_erstellen',
    grund:
      'LEG-08/LEG-09, Art. 21. Der einzige Schreibweg des Hauses auf `widerspruch_am`; vorher '
      + 'nannte kein `.ts` die Spalte, obwohl die Seitenkarte die Entscheidung '
      + '`M/datenschutz/[id]` zuwies (§2.4). Das Recht ist das der Route und nicht '
      + '`crm.schreiben`: verlangte sie das, waere die Zusage fuer eine '
      + 'Datenschutzbeauftragte ohne CRM-Schreibrecht unerreichbar. Der Betroffene kommt aus '
      + 'der ZUORDNUNG des Vorgangs, nie aus dem Formular — die Wirkung ist unwiderruflich.',
  },
  {
    pfad: 'api/werbewiderspruch',
    recht: null,
    grund:
      'CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG: der Empfaenger muss „jederzeit" widersprechen '
      + 'koennen, ohne andere Kosten als die der Uebermittlung. Ein Konto davor waere das '
      + 'Gegenteil, und ein Ursprungstest sperrte jeden, der den Link aus seinem '
      + 'E-Mail-Programm oeffnet — den Regelfall. Der Schutz liegt nicht an der Tuer: mit '
      + 'Token entscheidet der bedingte Verbrauch in `app.werbewiderspruch_einloesen` (K-09), '
      + 'ohne Token der Eingangsprinzipal mit `formular.schreiben`, und das prueft seit '
      + 'dieser Runde `app.werbewiderspruch_formular` selbst; dazu ein Ratenlimit je '
      + 'IP-Abdruck in derselben Transaktion und ein Honigtopf im Formular. '
      + 'Die Antwort verraet nie, ob eine Adresse im Bestand war.',
  },
  {
    /*
     * PUB-07/PUB-08. Einen Abschnitt aendern ODER eine Seite veroeffentlichen.
     * Das Manifest nennt das schwaechere Recht (die Route bewacht die
     * Adresse); die Route verlangt fuer `status` zusaetzlich
     * `referenz.veroeffentlichen`. Einen Entwurf schreiben und einen Satz auf
     * die Startseite der GmbH stellen sind zwei Handlungen.
     */
    pfad: 'api/website/seite',
    recht: 'referenz.schreiben',
  },
  {
    /**
     * Die Anfrageformulare einer Gesellschaft: Kopf, Zustaendigkeit,
     * Veroeffentlichen/Zurueckziehen, neue Version (§5.21, REQ-01 … REQ-04).
     *
     * `formular.schreiben` — dasselbe Recht, das `t_formular_schreiben`
     * (0016) auf `formular_definition` verlangt. Es haelt auch der zum
     * Internet offene Annahmeprinzipal `formular_eingang`; den weist der
     * Dienst zusaetzlich ab (`verweigereDienstkonto`, O-682), denn ein
     * Dienstkonto pflegt keine Website. Welches Recht das Live-Stellen
     * wirklich tragen soll, ist offen.
     */
    pfad: 'api/website/formular',
    recht: 'formular.schreiben',
  },
  {
    /**
     * Die Leistungseintraege einer Bereichsprofilseite (§5.21, PRO-02, PUB-11).
     *
     * `referenz.schreiben` — dasselbe Recht, das `t_abschnitt_pflege` verlangt.
     * Die Mandantengrenze zieht der Dienst ueber den PFAD der Seite
     * (`EIGENE_PROFILSEITE`), weil `abschnitt` keine `mandant_id` traegt
     * (O-49); die Route ist die erste Linie davor.
     */
    pfad: 'api/website/leistungen',
    recht: 'referenz.schreiben',
  },
  {
    /**
     * Die Texte und der Zustand EINER Sprachfassung des Unternehmensprofils
     * (§5.21, PRO-01, PRO-02, D-82).
     *
     * `referenz.schreiben` — dasselbe Recht, das `t_profil_pflege` verlangt.
     * Veroeffentlicht wird je SPRACHE: eine Sprachfassung mitzureissen ist
     * nicht moeglich, und deshalb traegt die Route auch keinen zweiten
     * Rechteschluessel fuers Veroeffentlichen — anders als bei `seite`.
     */
    pfad: 'api/website/profil',
    recht: 'referenz.schreiben',
  },
  {
    /**
     * Eine Referenz ANLEGEN (V-154), ihre Felder und ihre Kundenfreigabe
     * (§5.21, PRO-05).
     *
     * `referenz.schreiben` steht hier; die Policy `t_referenz_pflege` verlangt
     * in ihrer `with check` zusaetzlich `referenz.kundenfreigabe_erfassen`, und
     * zwar fuer JEDEN Schreibvorgang auf dieser Tabelle — das `insert` der
     * Anlage eingeschlossen. Das zweite prueft der
     * DIENST vor jedem Schreiben und weist es mit einem Satz ab — eine
     * `with check` wirft, sie filtert nicht, und ein 500 waere die falsche
     * Auskunft fuer eine Handlung, die jemand einfach nicht darf.
     *
     * Das Veroeffentlichen steht NICHT hier: es hat sein eigenes Recht
     * (`referenz.veroeffentlichen`) und seine eigene Route
     * (`api/website/referenzen`).
     */
    pfad: 'api/website/referenz',
    recht: 'referenz.schreiben',
  },
  {
    /*
     * REC-03. Vier Handlungen an einem Antwortentwurf: entwerfen, aendern,
     * vorlegen, senden. Das Manifest nennt das SCHWAECHERE der beiden Rechte,
     * weil es die Route bewacht; die Route selbst verlangt fuer `vorlegen` und
     * `senden` zusaetzlich `recruiting.entscheiden`.
     *
     * Das ist kein Schlupfloch, sondern die Reihenfolge: das Manifest sagt
     * „wer darf diese Adresse ueberhaupt aufrufen", die Route sagt „und wer
     * darf DIESE Handlung". Ein Manifest, das hier `entscheiden` forderte,
     * naehme dem Bewertenden das Entwerfen.
     */
    pfad: 'api/recruiting/antwort',
    recht: 'recruiting.bewerbung_bewerten',
  },
  {
    /*
     * §12. Ansehen, verwerfen und uebernehmen sind Entscheidungen eines
     * Menschen ueber einen Vertriebsvorgang — deshalb `crm.schreiben` und
     * nicht ein eigener Schluessel, den man anschliessend jeder Rolle bindet,
     * die `crm.schreiben` schon hat (K-19).
     *
     * **Senden ist hier KEINE Handlung.** Der Weg nach draussen fuehrt ueber
     * `lead_aktivitaet` und dort durch `kern.uwg_sendetor`; eine zweite Tuer
     * neben dem Tor waere der ganze Sinn des Tores.
     */
    pfad: 'api/akquise/ziel',
    recht: 'crm.schreiben',
  },
  {
    pfad: 'api/konto/sitzung',
    recht: null,
    grund:
      'AUT-05, V-039. Eine EIGENE Anmeldung beenden. Wie bei `api/konto/sprache` fuehrt '
      + 'der Rechtekatalog dafuer keinen Schluessel, und §12.4 markiert den Zugriff auf '
      + 'das eigene Konto als Selbstzugriff (S). Einen Schluessel zu erfinden, den man '
      + 'anschliessend jeder Rolle bindet, pruefte nichts und behauptete zu pruefen '
      + '(K-19). `system.sitzung_widerrufen` ist etwas anderes: das Recht, FREMDE '
      + 'Sitzungen zu beenden (V-076). Bewacht wird der Weg durch die Sitzung, den '
      + 'Ursprungsvergleich und `t_sitzung_eigene_schreiben`, die ausschliesslich Zeilen '
      + 'mit `benutzer_id = app.aktueller_benutzer()` zulaesst — die Kennung kommt aus '
      + 'der Datenbanksitzung und nie aus einem Feld der Anfrage (K-02).',
  },
  {
    pfad: 'api/konto/sprache',
    recht: null,
    grund:
      'EMP-12. Die eigene Portalsprache — de/en/ar/tr sind vollstaendig uebersetzt, und bis '
      + 'zu dieser Route liess sich die Sprache NIRGENDS aendern: keine Seite, keine Route, '
      + 'kein Recht. Der Rechtekatalog fuehrt dafuer keinen Schluessel, und §12.4 markiert '
      + 'den Zugriff auf das eigene Konto als Selbstzugriff (`S`); einen Schluessel zu '
      + 'erfinden, den man anschliessend JEDER Rolle bindet, pruefte nichts und behauptete '
      + 'zu pruefen (K-19) — dieselbe Begruendung wie bei `api/zeit/einwand`. Offen ist die '
      + 'Route deshalb nur im Sinne von "kein Modulrecht". Bewacht wird sie dreifach: durch '
      + 'die Sitzung und den Ursprungsvergleich; durch `t_person_selbstpflege` bzw. '
      + '`t_benutzer_selbstpflege`, die ausschliesslich die eigene Zeile zulassen (die '
      + 'Kennung kommt aus `app.aktuelle_person()`, nie aus der Anfrage, K-02); und durch '
      + 'das SPALTENRECHT aus 0165 — geaendert werden darf `sprache`, sonst nichts. '
      + '`person.telefon` daneben ist der Anmeldeweg (EMP-01): ein tabellenweites '
      + 'Schreibrecht machte aus dieser Route eine Kontouebernahme.',
  },
  {
    /**
     * TIM-07 — die AUSGABE der Check-in-Marke, und ihr Widerruf.
     *
     * **Die Haelfte, die gefehlt hat.** Das Einloesen ist seit 0035 komplett;
     * die Ausgabe hatte genau einen Aufrufer, den Seed. Ohne diese Route kommt
     * im Betrieb niemand an einen Check-in-Link — und TIM-07 ist der EINZIGE
     * Weg, auf dem eine Mitarbeiterin ihre Zeit selbst erfasst (EMP-07
     * verbietet ihr, den Eintrag zu schreiben).
     *
     * **Ein Recht fuer beides.** Wer eine Marke ausstellen darf, darf sie auch
     * zuruecknehmen; eine zweite Berechtigung dafuer waere eine, die niemand
     * vergibt, und dann stuende der Widerruf still. Die Datenbank prueft
     * dasselbe Recht ein zweites Mal — und zwar im Mandanten der MARKE, nicht
     * im aktiven der Sitzung (0164).
     *
     * **Der Name sagt `marken`, nicht `zeiten`** — und das ist kein Zufall:
     * `tests/kern/mitarbeiter.test.ts` laesst unter `api/zeit…` keine Route
     * zu, weil EMP-07 verbietet, dass irgendein Weg einen Zeiteintrag
     * AENDERT. Diese Route aendert keinen; sie gibt die Marke aus, aus der
     * beim Einloesen ein neuer entsteht. Die Wache ist absichtlich stumpf,
     * und ein Pfad, der sie umgeht, waere eine Ausnahme in der Wache — der
     * ehrlichere Weg ist ein Name, der sagt, was verwaltet wird.
     */
    pfad: 'api/checkin-marken',
    recht: 'zeit.checkin_verwalten',
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
     * Der dritte Vorgang: die Korrektur selbst (TIM-11, LEG-01, SEC-A9).
     *
     * **Der Befund, der diese Route gebracht hat.** `korrigiereZeiteintrag`
     * war gebaut und geprueft und hatte KEINEN Aufrufer — keine Route, keine
     * Seite. Damit endete der Einwandsweg im Nichts: eine Mitarbeiterin meldet
     * eine Abweichung (EMP-07), die Planung erkennt sie an, und der
     * Zeiteintrag blieb, wie er war. Die Entscheidungsroute daneben sagt das
     * selbst („Anerkennen schreibt hier keine Korrektur") — nur gab es die
     * Korrektur nirgends. Ein anerkannter Einwand, der die Aufzeichnung nicht
     * aendert, ist im Lohnstreit eine Zusage ohne Folge.
     *
     * `zeit.korrigieren` und nicht `zeit.schreiben`: wer Zeiten erfasst,
     * aendert damit noch keine bestehende Aufzeichnung — dieselbe Trennung,
     * die `zeit.einwand_entscheiden` vom Erfassen trennt. Melden, entscheiden,
     * korrigieren sind drei Vorgaenge mit drei Rechten, und die Datenbank
     * prueft darueber hinaus, dass der Handelnde nicht der Betroffene ist
     * (`zk_nicht_selbst`, 0036).
     */
    pfad: 'api/zeit/korrektur',
    recht: 'zeit.korrigieren',
  },
  {
    /**
     * Erfasste Zeit zur Abrechnung freigeben (TIM-12, FIN-07, FIN-18).
     *
     * **`zeit.abrechnung_freigeben` ist seit D-611/0371 gebunden** — an
     * `super_admin` und `admin`, fuer `leitung` je Gesellschaft anlegbar
     * (D-612, 03-AUTH §12.4). Bis dahin war die Route gebaut, geprueft und
     * fuer jede Sitzung unerreichbar; die Antwort des Mandanten hat sie mit
     * einer Rechtebindung geoeffnet und nicht mit einem Umbau. Die Pruefung
     * steht weiterhin dreifach: hier, in `app.zeit_zur_abrechnung_freigeben`
     * (0366) und im Manifest der Seite.
     */
    pfad: 'api/zeit/abrechnungsfreigabe',
    recht: 'zeit.abrechnung_freigeben',
  },
  {
    pfad: 'api/karriere/bewerbung',
    recht: null,
    grund:
      'REC-03. Der oeffentliche Bewerbungsweg — wie `api/anfrage` bewusst ohne Konto, '
      + 'weil sich jemand ohne Konto bewirbt. Was ihn schuetzt, sind nicht Rechte des '
      + 'Aufrufers: Honigtopf, Ratenlimit ueber den IP-Hash, Validierung, und ein '
      + 'Prinzipal (`withEingang`), der schreiben und NICHT lesen kann — wer sich '
      + 'bewirbt, sieht damit keine fremde Bewerbung. Der Mandant kommt nie aus dem '
      + 'Formular: bei einer Stellenbewerbung wird er aus der STELLE aufgeloest, und '
      + 'zwar ueber die oeffentliche Sicht, die nur veroeffentlichte Stellen durchlaesst '
      + '(K-02). Ohne das koennte ein praeparierter POST eine Bewerbung in eine fremde '
      + 'Gesellschaft schreiben oder sich auf einen Entwurf bewerben, den niemand '
      + 'ausgeschrieben hat.',
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
    /**
     * EMP-10, NOT-01. Ueber einen Antrag zu entscheiden heisst, ueber die
     * Freizeit eines Menschen zu entscheiden — ein eigenes Recht, nicht
     * `zeit.schreiben`.
     */
    pfad: 'api/antraege/[id]',
    recht: 'zeit.antrag_entscheiden',
  },
  {
    /**
     * EMP-10, EMP-05. Genehmigen, ablehnen und stornieren sind drei Wege
     * derselben Entscheidung — sie betrifft Lohnfortzahlung und Urlaubskonto.
     */
    pfad: 'api/abwesenheiten/[id]',
    recht: 'zeit.abwesenheit_genehmigen',
  },
  {
    /**
     * EMP-04, LEG-01. Einen Lohnmonat zu schliessen ist unumkehrbar und praegt
     * den § 17-Nachweis; `zeit.konto_abschliessen` ist deshalb ein eigenes
     * Recht neben `zeit.konto_lesen`, und die Route verlangt zusaetzlich den
     * zweiten Faktor (05-API-KARTE §7.9).
     */
    pfad: 'api/stundenkonto/[id]/monat-abschliessen',
    recht: 'zeit.konto_abschliessen',
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
    pfad: 'api/speicher/[bucket]/[...schluessel]',
    recht: null,
    grund:
      'V-131, D-623. Die Auslieferung des Vorführspeichers — offen wie eine signierte '
      + 'Supabase-Adresse offen ist: wer sie hat, hat sie von einer Route bekommen, die '
      + 'Sitzung, Recht und Mandant geprüft und den Abruf vermerkt hat. Die Route selbst '
      + 'prüft Ablauf und HMAC der Adresse (15 Minuten, DOC-03) und antwortet 404, wenn '
      + 'kein Vorführordner aktiv ist — also in jedem Deployment.',
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
  {
    /**
     * SEC-01. Einen Wachposten anlegen — Mindestbesetzung, Sollbesetzung,
     * Abdeckung. `security.schreiben`, dasselbe Recht, das die
     * `WITH CHECK`-Haelfte der Zeilenpolitik von `posten` verlangt (K-03).
     */
    pfad: 'api/sicherheit/posten',
    recht: 'security.schreiben',
  },
  {
    /**
     * SEC-05, TIM-08, TIM-10 — eine Wachbuchseite schreiben oder
     * richtigstellen.
     *
     * `wachbuch.schreiben` und nicht `wachbuch.lesen`: das ist das eine Recht
     * dieser Domaene, das die Rolle `mitarbeiter` wirklich haelt (03-AUTH
     * §12.7), denn SEC-05 laesst die Wache das Buch fuehren. Ihr Leseweg im
     * eigenen Portal laeuft ueber `t_person` ganz ohne Modulrecht (K-18) —
     * deshalb ist dieses Recht hier tragend und nicht bloss symmetrisch.
     *
     * Korrigieren traegt DASSELBE Recht: eine Korrektur ist ein neuer Eintrag
     * mit einem Storno daneben, kein zweiter Vorgang mit eigener Schwelle.
     */
    pfad: 'api/sicherheit/wachbuch',
    recht: 'wachbuch.schreiben',
  },
  {
    /**
     * SEC-08, SEC-04, TIM-05 — kurzfristige Eventbesetzung.
     *
     * `dienstplan.schreiben`, nicht `security.schreiben`: was hier entsteht,
     * ist eine Schicht und eine Einteilung, und beide gehoeren dem
     * Dienstplan. Dasselbe Recht traegt `api/einsaetze/[id]/besetzen`, und
     * das ist der Punkt — es gibt genau EINEN Schreibweg auf
     * `einsatz_zuordnung`, und diese Adresse benutzt ihn, statt einen zweiten
     * zu oeffnen.
     */
    pfad: 'api/sicherheit/event-besetzung',
    recht: 'dienstplan.schreiben',
  },
  {
    /**
     * SEC-06, DOC-05, EMP-12 — eine Dienstanweisung anlegen.
     *
     * `dienstanweisung.schreiben`, dasselbe Recht, das die `WITH
     * CHECK`-Haelfte der Zeilenpolitik von `dienstanweisung` und
     * `dienstanweisung_version` verlangt (K-03). Die Rolle `mitarbeiter`
     * haelt es NICHT — ihr Weg ist die Bestaetigung, und die hat ihre eigene
     * Adresse unter `api/mein/`.
     */
    pfad: 'api/sicherheit/dienstanweisungen',
    recht: 'dienstanweisung.schreiben',
  },
  {
    /**
     * SEC-06, DOC-05, Abnahme 1 — eine neue Fassung anlegen oder eine
     * bestehende freigeben.
     *
     * DASSELBE Recht: eine Fassung anzulegen und sie freizugeben sind zwei
     * Haelften eines Vorgangs, nicht zwei Schwellen. Was die Freigabe
     * ausloest — Kopf fortschreiben, Pflichtpopulation vervollstaendigen —
     * tut ohnehin der Ausloeser und nicht diese Adresse.
     */
    pfad: 'api/sicherheit/dienstanweisungen/[id]/version',
    recht: 'dienstanweisung.schreiben',
  },
  {
    /**
     * SEC-07 — einen Schluessel in den Bestand nehmen.
     *
     * `schluessel.schreiben`, dasselbe Recht wie in der Zeilenpolitik (K-03).
     * Der ZUSTAND des Schluessels laesst sich hier nicht setzen: er ist aus
     * dem Journal abgeleitet, und `s_status_abgeleitet` weist jede direkte
     * Aenderung ab (0079 §6).
     */
    pfad: 'api/sicherheit/schluessel',
    recht: 'schluessel.schreiben',
  },
  {
    /**
     * SEC-07, TIM-08, LEG-01 — eine Journalzeile schreiben: Uebergabe,
     * Ruecknahme, Verlust, Sperrung, Entsperrung, Vernichtung,
     * Wiederauffinden, Inventur.
     *
     * Alle acht ueber EINE Adresse, weil alle acht dieselbe Sitzung, denselben
     * Ursprungscheck, denselben Mandantenkontext und dasselbe Recht brauchen —
     * und dieselbe Zeile in derselben Tabelle sind. Die zweite Uebergabe ohne
     * Ruecknahme weist `sq_offene_ausgabe_uk` ab, nicht dieser Eintrag.
     */
    pfad: 'api/sicherheit/schluessel/[id]/quittung',
    recht: 'schluessel.schreiben',
  },
  {
    /**
     * Das Bewacherregister nach § 34a GewO (SEC-03): einen Eintrag anlegen,
     * aendern, ablaufen lassen.
     *
     * `personal.bewacher_verwalten` und NICHT `security.schreiben` — der
     * Eintrag ist eine Tatsache ueber den MENSCHEN (Invariante 9), kein
     * Dienstplanvorgang. `be_schreiben` (INSERT auf `bewacher_eintrag`)
     * verlangt in der Datenbank denselben Schluessel.
     *
     * **Nicht verbunden**: es gibt keinen Abgleich mit dem behoerdlichen
     * Register; `quelle` bleibt per Pruefbedingung `manuell`, und die Seite
     * sagt das UEBER der Tabelle. Ein Abgleichknopf waere die vorgetaeuschte
     * Anbindung, die CLAUDE.md ausschliesst.
     */
    pfad: 'api/security/bewacherregister',
    recht: 'personal.bewacher_verwalten',
  },
  {
    /**
     * EMP-09, SEC-06 — die Wache bestaetigt eine Dienstanweisung mit einem
     * Tipp.
     *
     * Bewusst OHNE Rechteschluessel: die Rolle `mitarbeiter` haelt
     * `dienstanweisung.schreiben` nicht (03-AUTH §12.3), und K-19 verbietet,
     * dafuer einen neuen Schluessel zu erfinden — er muesste jeder
     * Mitarbeiterrolle gebunden werden, also nichts pruefen und dabei
     * behaupten, man pruefe; und `super_admin` bekaeme ihn mit. Genau diesen
     * Fall nennt 0078 §12 als Begruendung fuer `t_selbst_bestaetigen`.
     */
    pfad: 'api/mein/dienstanweisungen/[id]/kenntnisnahme',
    recht: null,
    grund:
      'EMP-09, SEC-06, SEITENKARTE §7. Die Bestaetigung einer Dienstanweisung ist '
      + 'Selbstzugriff und kein Modulrecht: ein Recht gehoert einer Rolle und eine Rolle '
      + 'vielen Menschen, also liesse sich „nur der Betroffene" gar nicht als Recht '
      + 'ausdruecken — und `dienstanweisung.schreiben` ist an super_admin, admin und '
      + 'leitung gebunden, nicht an die Wache, die bestaetigt. Die Wache ist die Sitzung, '
      + 'der Ursprungsvergleich, der aus der Anweisung serverseitig aufgeloeste Mandant '
      + '(K-02), die Policy `t_selbst_bestaetigen` auf `da_kenntnisnahme` und die '
      + 'restriktive Mitarbeiterdecke (K-04); die Fassung selbst ist im Personen-Scope '
      + 'nur ueber `t_person` sichtbar, also nur auf einem Objekt, auf dem dieser Mensch '
      + 'eingesetzt ist.',
  },
  {
    /**
     * Die Vorschau auf den Rechenansatz (BAU-02).
     *
     * `bau.aufmass_erfassen` und nicht `bau.lesen`: sie gehoert zum
     * Erfassungsbildschirm `…/aufmass/neu`, und genau dieses Recht haelt die
     * Kraft vor Ort — `bau.lesen` haelt sie nicht (03-GEWERKE §1.7). Sie
     * schreibt nichts: Formel hinein, Zahl heraus.
     */
    pfad: 'api/bau/aufmasse/vorschau',
    recht: 'bau.aufmass_erfassen',
  },
  {
    /**
     * Ein Aufmassblatt aufnehmen (BAU-02, BAU-03).
     *
     * Dieselbe Begruendung, und die Route nimmt die MESSFOTOS mit: BAU-03
     * verlangt sie, bevor ein Blatt vorgelegt wird, und ein zweiter Schritt
     * erzeugte den Zustand „Blatt ohne Foto", in dem die Kraft die Baustelle
     * schon verlassen hat.
     */
    pfad: 'api/bau/aufmasse',
    recht: 'bau.aufmass_erfassen',
  },
  {
    /**
     * Die Gegenzeichnung (BAU-03).
     *
     * `bau.aufmass_freigeben`, nicht `bau.aufmass_erfassen`: wer ein Blatt
     * aufnimmt, stellt damit noch nicht fest, dass der Auftraggeber es
     * anerkannt hat — dieselbe Trennung wie zwischen
     * `dienstplan.konflikt_quittieren` und `dienstplan.schreiben`.
     */
    pfad: 'api/bau/aufmasse/[id]/gegenzeichnung',
    recht: 'bau.aufmass_freigeben',
  },
  {
    /**
     * Das Bautagebuch — anlegen, anfuegen, korrigieren, abschliessen,
     * gegenzeichnen (BAU-07).
     *
     * `bau.schreiben` und nicht `bau.aufmass_erfassen`: die Seitenkarte gibt
     * `…/bautagebuch/[datum]` genau dieses Recht. Ein Bautagebuch ist die
     * laufende Beweisfuehrung der Bauleitung und keine Mengenfeststellung
     * der Kraft vor Ort.
     *
     * Ein Eingang fuer mehrere Vorgaenge: alle teilen Sitzung,
     * Ursprungspruefung, Mandantenkontext und Recht, und die Korrektur IST
     * ein Anfuegen mit einem Storno daneben.
     */
    pfad: 'api/bau/bautagebuch',
    recht: 'bau.schreiben',
  },
  {
    /**
     * Das Wetter eines Bautags anheften (BAU-08).
     *
     * Dasselbe Recht wie der Tag, an den es sich heftet — es entsteht kein
     * zweiter Vorgang, sondern ein Feld desselben. Die Route gibt einen
     * BEFUND zurueck und wirft nicht, wenn der DWD schweigt: der Tag
     * speichert trotzdem, und nichts wird erfunden.
     */
    pfad: 'api/bau/bautagebuch/[id]/wetter',
    recht: 'bau.schreiben',
  },
  {
    /**
     * Einen Nachtrag ANMELDEN (BAU-04, BAU-05).
     *
     * `bau.nachtrag_anmelden` — das Recht der Ankuendigung nach § 2 Abs. 6
     * Nr. 1 VOB/B, nicht `bau.schreiben`: wer ein Leistungsverzeichnis
     * pflegt, kuendigt damit noch keinen Verguetungsanspruch an. Und nicht
     * `bau.nachtrag_einreichen`: das ist der Uebergang, an dem etwas das Haus
     * verlaesst, und er hat seine eigene Adresse.
     *
     * `POST` statt des in der API-Karte genannten Methodenpaars: der Aufrufer
     * ist ein HTML-Formular, und ein Formular kennt nur `GET` und `POST`.
     */
    pfad: 'api/bau/nachtraege',
    recht: 'bau.nachtrag_anmelden',
  },
  {
    /**
     * Die Ankuendigung nachtragen (BAU-04).
     *
     * Dasselbe Recht wie das Anmelden und trotzdem eine eigene Adresse: das
     * Datum ist write-once, und ein Weg, der ein bestehendes Datum
     * verschoebe, waere in einem auditierten Datensatz kein Versehen mehr.
     */
    pfad: 'api/bau/nachtraege/[id]/anmelden',
    recht: 'bau.nachtrag_anmelden',
  },
  {
    /**
     * Die Einreichung beim Auftraggeber (BAU-04, Invariante 7).
     *
     * `bau.nachtrag_einreichen` — der Uebergang, an dem die Kalkulation das
     * Haus verlaesst. Er verlangt zusaetzlich eine genehmigte `freigabe`;
     * ohne sie ist der Zustand `eingereicht` nicht einmal in der Datenbank
     * darstellbar (`nachtrag_eingereicht_freigegeben`, 0080).
     */
    pfad: 'api/bau/nachtraege/[id]/einreichen',
    recht: 'bau.nachtrag_einreichen',
  },
  {
    /**
     * Leistung ausserhalb des LV ohne Nachtrag (BAU-05).
     *
     * `bau.lesen` und nicht `bau.nachtrag_anmelden`: die Warnung zu SEHEN
     * heisst nicht, einen Anspruch anmelden zu duerfen. Die einzige Route
     * dieses PRs, die in der API-Karte als `GET` steht — sie liest und
     * schreibt nichts.
     */
    pfad: 'api/bau/nachtrag-warnungen',
    recht: 'bau.lesen',
  },
  {
    /**
     * Die Behinderungsanzeige entwerfen (BAU-06, § 6 Abs. 1 VOB/B).
     *
     * `bau.behinderung_erstellen` — ein eigener Schluessel im Katalog, und
     * das aus gutem Grund: eine Behinderungsanzeige ist eine
     * anspruchswahrende Rechtserklaerung und kein Datensatz.
     *
     * `POST` statt `PUT`: der Aufrufer ist ein HTML-Formular.
     */
    pfad: 'api/bau/behinderungen',
    recht: 'bau.behinderung_erstellen',
  },
  {
    /**
     * Den Versand dokumentieren (BAU-06, Invariante 7).
     *
     * Das Recht ist `bau.behinderung_erstellen` und NICHT
     * `versand.freigeben`: hier wird festgehalten, was ein Mensch getan hat.
     * Die Freigabe ist ein anderer Vorgang mit einem anderen Recht — sie wird
     * hier durch `server/agent/policy.ts` GEPRUEFT, nie erteilt. Ohne
     * genehmigte Freigabe mit benanntem Menschen und passendem Nutzlast-Hash
     * geht nichts hinaus, und `e_mail`/`portal` werden als nicht verbunden
     * abgewiesen statt nachgebaut (O-116).
     */
    pfad: 'api/bau/behinderungen/[id]/versenden',
    recht: 'bau.behinderung_erstellen',
  },
  {
    /**
     * Der Wegfall nach § 6 Abs. 3 VOB/B (BAU-06).
     *
     * Kein Ausgang und deshalb kein Tor: der Wegfall wird festgehalten, das
     * Schreiben darueber ist ein VERSAND und laeuft ueber die Adresse daneben.
     */
    pfad: 'api/bau/behinderungen/[id]/wegfall',
    recht: 'bau.behinderung_erstellen',
  },
  {
    /**
     * Die Abnahme protokollieren, einen Mangel behoben melden, ein Protokoll
     * stornieren (§ 12 VOB/B).
     *
     * `bau.schreiben` und nicht `bau.aufmass_freigeben`: wer ein Aufmass
     * gegenzeichnet, stellt eine Menge fest; wer eine Abnahme protokolliert,
     * haelt fest, dass Gefahr, Gewaehrleistungsfrist und Faelligkeit
     * umgeschlagen sind. Die Seitenkarte gibt der Seite dasselbe Recht.
     *
     * Ein Eingang fuer drei Vorgaenge: alle teilen Sitzung, Ursprungspruefung,
     * Mandantenkontext und Recht — und die Korrektur IST ein Storno mit
     * Ersatzprotokoll, kein zweiter Schreibweg.
     */
    pfad: 'api/bau/abnahmen',
    recht: 'bau.schreiben',
  },
  {
    /**
     * Ein Leistungsverzeichnis hochladen, pruefen, uebernehmen oder verwerfen
     * (BAU-01, REQ-04, OPS-04-Muster).
     *
     * `bau.schreiben`: der Import bewegt Vertragsmengen und Einheitspreise
     * eines Leistungsverzeichnisses. Geparst wird SERVERSEITIG, die Vorschau
     * liegt im Staging (`lv_import`, `lv_import_zeile`) — uebernommen wird,
     * was der Server gelesen hat, nie etwas aus einem versteckten Feld des
     * Browsers (K-12).
     */
    pfad: 'api/bau/lv-import',
    recht: 'bau.schreiben',
  },
  {
    /**
     * Eine maschinell gelesene LV-Position BESTAETIGEN (APR-03, K-10).
     *
     * `bau.schreiben`: die Bestaetigung benennt den Menschen, der einen aus
     * einem PDF gelesenen Preis verantwortet. Daran haengt mehr als ein
     * Haekchen — `kern.aufmass_vorlage_pruefen()` (0072) weist jede Vorlage
     * eines Aufmasses ab, deren Zeilen auf eine unbestaetigte maschinelle
     * Position buchen.
     */
    pfad: 'api/bau/lv-positionen/[id]/bestaetigung',
    recht: 'bau.schreiben',
  },
  {
    /**
     * Raeume einer Zone zuordnen und ihre Sollzeit neu rechnen (CLN-01,
     * OPS-07).
     *
     * `reinigung.schreiben` und nicht `kalkulation.schreiben`: hier wird
     * keine Grundlage BESTAETIGT, sondern eine Zone zugeschnitten. Der
     * Leistungswert selbst bleibt, was der Katalog sagt; was sich aendert,
     * ist die Menge Raeume, ueber die gerechnet wird.
     *
     * `POST` statt des in der API-Karte genannten `PUT`: der Aufrufer ist ein
     * HTML-Formular, und ein Formular kennt nur `GET` und `POST`.
     */
    pfad: 'api/reinigung/reviere/[id]/raeume',
    recht: 'reinigung.schreiben',
  },
  {
    /**
     * Schritt 1 des Leistungsnachweises: den Entwurf samt Zeilen anlegen
     * (CLN-04, TIM-12).
     *
     * `nachweis.schreiben` — das Modul gehoert dem Leistungsnachweis, nicht
     * dem Qualifikationsnachweis (der laeuft unter `personal.nachweis_*`).
     */
    pfad: 'api/reinigung/leistungsnachweise/entwurf',
    recht: 'nachweis.schreiben',
  },
  {
    /**
     * Schritt 2: vorlegen und unterschreiben (CLN-04, TIM-08, LEG-10).
     *
     * Beides unter EINER Adresse, weil beides dieselbe Sitzung, denselben
     * Ursprungscheck und denselben Mandantenkontext braucht — dieselbe
     * Begruendung wie bei `api/angebot`. Was den Vorgang absichert, ist nicht
     * eine zweite Adresse, sondern die bestaetigte Pruefsumme: stimmt sie
     * nicht mehr mit den Zeilen ueberein, wird nichts geschrieben.
     */
    pfad: 'api/reinigung/leistungsnachweise',
    recht: 'nachweis.schreiben',
  },
  {
    /**
     * Eine Arbeitszeit NACHERFASSEN, zu der es kein Geraetereignis gibt
     * (V-066, V-067, TIM-09).
     *
     * `zeit.nacherfassung_pruefen` — dasselbe Recht wie die Seite, auf der
     * dieser Weg steht, und dasselbe, das die Uebernahme eines
     * Offline-Anspruchs verlangt. Der Unterschied zu `api/zeit/offline` ist
     * der, auf den es im Streit ankommt: dort hat eine MASCHINE eine Zeit
     * behauptet, hier ein MENSCH.
     */
    pfad: 'api/zeit/nacherfassung',
    recht: 'zeit.nacherfassung_pruefen',
  },
  {
    /**
     * Einen LAUFENDEN Zeiteintrag schliessen oder stornieren (V-064, TIM-11).
     *
     * `zeit.korrigieren` und nicht `zeit.schreiben`: es ist derselbe Vorgang
     * wie die Korrektur eines abgeschlossenen Eintrags, nur eine Phase
     * frueher — und er setzt die Arbeitszeit eines ANDEREN Menschen fest.
     *
     * Was hier entsteht, ist keine Stempelzeit, sondern eine Behauptung der
     * Verwaltung (Invariante 5). Sie wird als solche gespeichert:
     * `quelle_ende = 'planer_entscheidung'`, `nacherfasst = true`,
     * `behauptet_ende` gesetzt — erzwungen von `z_quelle_ende_belegt` und
     * `z_anspruch_je_ereignis`.
     */
    pfad: 'api/zeit/laufend',
    recht: 'zeit.korrigieren',
  },
  {
    /**
     * Eine Veranstaltung anlegen, aendern oder archivieren (V-004, SEC-08).
     *
     * `security.schreiben` — dasselbe Recht, das die RLS von `veranstaltung`
     * verlangt. Die BESETZUNG derselben Veranstaltung liegt dagegen hinter
     * `dienstplan.schreiben` (Seitenkarte §5.8): wer das Event erfasst, teilt
     * damit noch niemanden ein.
     *
     * Woher ein Veranstaltungsauftrag ueberhaupt entsteht, ist offen (O-703);
     * diese Adresse baut den Weg, der am wenigsten erfindet — handerfasst,
     * mit optionaler Verbindung zu einer Auftragsleistung.
     */
    pfad: 'api/security/veranstaltungen',
    recht: 'security.schreiben',
  },
  {
    /**
     * Ein Bauvorhaben anlegen, aendern oder archivieren (V-003, OPS-05).
     *
     * `bau.schreiben` und nicht `bau.aufmass_erfassen`: ein Vorhaben ANLEGEN
     * ist die Handlung der Bauleitung, ein Aufmass aufnehmen die der Kraft
     * vor Ort. Beides zu vermischen gaebe jeder Kraft, die ein Blatt
     * aufnehmen darf, auch das Recht, ein Projekt zu archivieren.
     *
     * Der AUFTRAG wird gewaehlt, nie erfunden: `projekt_auftrag_uk` laesst
     * genau ein Projekt je Auftrag zu, und Kunde, Objekt und Nummer liest der
     * Dienst aus dessen Zeile statt aus dem Formular.
     */
    pfad: 'api/bau/projekte',
    recht: 'bau.schreiben',
  },
  {
    /**
     * Eine Reinigungszone anlegen, aendern oder archivieren (V-002, CLN-01).
     *
     * `reinigung.schreiben` — dasselbe Recht, das die RLS von `revier`
     * verlangt und das `dienste.ts` fuer `reinigung/revier` fuehrt. Ohne
     * diese Adresse konnte KEINE neue Flaeche entstehen: der Turnus haengt am
     * Revier, der Einsatz am Turnus, der Nachweis am Einsatz.
     *
     * Das OBJEKT einer bestehenden Zone laesst sich hier nicht umhaengen; der
     * Dienst nimmt das Feld beim Aendern gar nicht erst entgegen. Eine Zone
     * mit Raeumen eines fremden Gebaeudes waere eine Flaeche an einer Adresse,
     * an der sie nicht liegt.
     */
    pfad: 'api/reinigung/reviere',
    recht: 'reinigung.schreiben',
  },
  {
    /**
     * Den Turnus eines Reviers anlegen, aendern oder stilllegen (CLN-02).
     *
     * `reinigung.schreiben` — dasselbe Recht, das der Handler mit
     * `authorize()` durchsetzt und das die RLS von `turnus` verlangt. Die
     * Dauer ist nach oben gedeckelt (`MAX_DAUER_MINUTEN`); ein Turnus ueber
     * 1440 Minuten liesse sich anlegen und hielte danach jede Nacht den
     * Generator an.
     */
    pfad: 'api/reinigung/turnus',
    recht: 'reinigung.schreiben',
  },
  {
    /**
     * Sonderleistungen (CLN-05, OPS-06): Abruf erfassen, Zustand setzen,
     * stornieren — und den Zeitwert einer Katalogzeile pflegen.
     *
     * **Vier Vorgaenge, EINE Adresse, ZWEI Rechte.** Die drei Vorgaenge auf
     * `sonderleistung` verlangen `reinigung.schreiben` (so steht es in der
     * RLS dieser Tabelle), der Zeitwert einer Katalogzeile
     * `katalog.schreiben` (RLS von `leistungskatalog_position`). Hier steht
     * wie ueberall in dieser Datei das SCHWAECHERE als Torpruefung — der
     * Handler waehlt je `art` und prueft das genaue selbst. Ein gemeinsames
     * Recht fuer beide Haelften waere eine erfundene Vereinfachung.
     *
     * Welche Haelfte die SEITE tragen soll, ist offen (O-702); das ist eine
     * Registerentscheidung in `routen.generiert.ts` und keine dieser Zeile.
     */
    pfad: 'api/reinigung/sonderleistungen',
    recht: 'reinigung.schreiben',
  },
  {
    /**
     * Beanstandung anlegen und abstellen (OPS-11, SPEC §22).
     *
     * `qualitaet.schreiben` und nicht `reinigung.schreiben`: eine Beschwerde
     * ueber einen Wachmann ist dieselbe Zeile wie eine ueber eine
     * Reinigungsrunde, und das Modul ist fuer drei Bereiche freigeschaltet
     * (04-SEITENKARTE.md §5.6).
     */
    pfad: 'api/qualitaet/reklamationen',
    recht: 'qualitaet.schreiben',
  },
  {
    /**
     * Qualitaetspruefungen anlegen und ihre Positionen bewerten (CLN-03).
     *
     * `qualitaet.schreiben` wie bei der Reklamation daneben: die Pruefung
     * gehoert dem Qualitaetsmodul, nicht dem Gewerk, und ist fuer alle drei
     * Bereiche freigeschaltet. Die Punkteskala prueft der DIENST — der
     * Ausloeser `qp_punkte_brauchen_skala` prueft die eigene Spalte und nicht
     * `pruefverfahren.max_punkte` (Invariante 6).
     */
    pfad: 'api/qualitaet/pruefungen',
    recht: 'qualitaet.schreiben',
  },
  {
    /**
     * Antrag einreichen aus dem Mitarbeiterportal (EMP-10).
     *
     * Bewusst OHNE Rechteschluessel: SEITENKARTE §7 fuehrt das Einreichen als
     * Selbstzugriff (`S`) und nicht als Modulrecht — „Almost nothing here is a
     * permission. Self-access ... is a policy branch keyed on the server-set
     * `app.person_id` GUC, not a right." Ein erfundener Schluessel muesste jeder
     * Mitarbeiterrolle gebunden werden, also nichts pruefen und dabei
     * behaupten, man pruefe; und `super_admin` bekaeme ihn mit. Bewacht wird
     * der Weg durch die Sitzung, den Ursprungsvergleich, den serverseitig aus
     * der Beschaeftigung aufgeloesten Mandanten (K-02, nie ein Feld der
     * Anfrage) und die Policy `t_selbst_einreichen` auf `antrag`, die nur
     * Zeilen zulaesst, deren Anstellung dem angemeldeten Menschen gehoert —
     * mit der restriktiven K-04-Mitarbeiterdecke darueber.
     */
    pfad: 'api/mein/antraege',
    recht: null,
    grund:
      'EMP-10, SEITENKARTE §7. Das Einreichen eines eigenen Antrags ist Selbstzugriff und '
      + 'kein Modulrecht: ein Recht gehoert einer Rolle und eine Rolle vielen Menschen, also '
      + 'liesse sich „nur der Betroffene" gar nicht als Recht ausdruecken. Die Wache ist die '
      + 'Sitzung, der Ursprungsvergleich, der aus der Beschaeftigung serverseitig '
      + 'aufgeloeste Mandant (K-02) und die Policy `t_selbst_einreichen` plus die '
      + 'restriktive Mitarbeiterdecke (K-04).',
  },
  {
    /**
     * Abwesenheit melden (EMP-10) — der EINE Schreibweg des Portals mit einem
     * Recht. `zeit.abwesenheit_melden` ist im Katalog an `mitarbeiter`
     * gebunden, und die INSERT-Policy auf `abwesenheit` prueft denselben
     * Schluessel ein zweites Mal (AUT-05).
     */
    pfad: 'api/mein/abwesenheit',
    recht: 'zeit.abwesenheit_melden',
  },
  {
    /**
     * Die eigene Zeit stempeln (D-618, O-93, TIM-07, Migration 0373).
     *
     * **Kein Recht, und das ist die Entscheidung.** `zeit.checkin_verwalten`
     * ist das Recht der PLANUNG, Marken fuer FREMDE auszugeben; eine
     * Reinigungskraft haelt es nicht und soll es nicht halten. Die eigene
     * Zeit zu stempeln ist Selbstzugriff und kein Modulrecht (K-19).
     *
     * Die Wache ist die Sitzung, der Ursprungsvergleich, der aus der
     * EINTEILUNG serverseitig aufgeloeste Mandant (K-02) — und vor allem
     * `app.checkin_aus_der_sitzung` (0373) selbst, die auf `app.portal() =
     * 'mitarbeiter'` (K-04) und auf der Personenzugehoerigkeit der Einteilung
     * besteht. Beides kann diese Route nicht umgehen (Invariante 3).
     *
     * Geschrieben wird am Ende ueber `app.checkin_verbrauchen`, den einen
     * Schreiber des Check-in-Pfades (K-08) — EMP-07 bleibt unberuehrt, weil
     * `p_ma_kein_update` das AENDERN ueber `cse_app` verbietet und der
     * Check-in seit jeher ueber `cse_definer` schreibt.
     */
    pfad: 'api/mein/stempeluhr',
    recht: null,
    grund:
      'TIM-07, EMP-01, D-618. Die EIGENE Zeit zu stempeln ist Selbstzugriff und kein '
      + 'Modulrecht (K-19); `zeit.checkin_verwalten` gehoert der Planung, die Marken fuer '
      + 'FREMDE ausgibt. Die Wache ist die Sitzung, der Ursprungsvergleich, der aus der '
      + 'Einteilung serverseitig aufgeloeste Mandant (K-02) und '
      + '`app.checkin_aus_der_sitzung` (0373), die Portal UND Personenzugehoerigkeit selbst '
      + 'prueft. Der Schreibvorgang muendet in `app.checkin_verbrauchen` (K-08).',
  },
  {
    /**
     * Die eigene Einteilung zusagen oder absagen (V-049, D-622, Migration 0374).
     *
     * **Kein Recht, und das ist die Entscheidung — aus demselben Grund wie
     * bei der Stempeluhr darueber.** `dienstplan.schreiben` ist das Recht,
     * den Plan zu MACHEN. Wer es einer Reinigungskraft gaebe, gaebe ihr den
     * Plan. Auf die eigene Einteilung zu antworten ist Selbstzugriff und kein
     * Modulrecht (K-19).
     *
     * Die Wache ist die Sitzung, der Ursprungsvergleich, der aus der
     * EINTEILUNG serverseitig aufgeloeste Mandant (K-02) — und vor allem
     * `app.schicht_zusagen` / `app.schicht_absagen` (0374) selbst, die auf
     * `app.portal() = 'mitarbeiter'` (K-04) und auf der
     * Personenzugehoerigkeit der Einteilung bestehen. Beides kann diese Route
     * nicht umgehen (Invariante 3).
     */
    pfad: 'api/mein/schicht',
    recht: null,
    grund:
      'EMP-02, V-049, D-622. Auf die EIGENE Einteilung zu antworten ist Selbstzugriff und '
      + 'kein Modulrecht (K-19); `dienstplan.schreiben` gehoert dem Buero, das den Plan '
      + 'macht. Die Wache ist die Sitzung, der Ursprungsvergleich, der aus der Einteilung '
      + 'serverseitig aufgeloeste Mandant (K-02) und `app.schicht_zusagen` / '
      + '`app.schicht_absagen` (0374), die Portal UND Personenzugehoerigkeit selbst pruefen. '
      + 'Das Arbeiterportal hat auf `einsatz_zuordnung` ueber `cse_app` keinen Schreibweg: '
      + '`t_selbst_m1` gibt nur `r`.',
  },
  {
    pfad: 'api/mein/abwesenheit/[id]/zurueckziehen',
    recht: null,
    grund:
      'V-056, EMP-10, SEITENKARTE §7. Die EIGENE Abwesenheit zuruecknehmen ist Selbstzugriff '
      + 'und kein Modulrecht (K-19) — dieselbe Begruendung wie beim Antrag daneben. Die '
      + 'Wache ist die Sitzung, der Ursprungsvergleich, der aus der Beschaeftigung '
      + 'serverseitig aufgeloeste Mandant (K-02) und die Policy `t_selbst_zurueckziehen` '
      + '(0386), deren USING nur erfasst/beantragt und deren WITH CHECK nur storniert '
      + 'zulaesst — eine Selbstgenehmigung ist damit nicht formulierbar, und eine schon '
      + 'entschiedene Abwesenheit bleibt der Planung.',
  },
  {
    pfad: 'api/mein/antraege/[id]/zurueckziehen',
    recht: null,
    grund:
      'EMP-10, SEITENKARTE §7. Den EIGENEN Antrag zurueckziehen ist Selbstzugriff und kein '
      + 'Modulrecht (K-19). Die Wache ist die Sitzung, der Ursprungsvergleich, der aus der '
      + 'Beschaeftigung serverseitig aufgeloeste Mandant (K-02) und die Policy '
      + '`t_selbst_zurueckziehen` (0301), deren USING nur eingereicht/in_pruefung und deren '
      + 'WITH CHECK nur zurueckgezogen zulaesst — eine Selbstgenehmigung ist damit nicht '
      + 'formulierbar.',
  },
  {
    pfad: 'api/mein/schichten/[zuordnungId]/fotos',
    recht: null,
    grund:
      'TIM-10, DOC-06, SEITENKARTE §7. Die Aufnahme an der eigenen Schicht laeuft ueber '
      + '`t_selbst_schichtmedien` (0303); die Abgrenzung kommt aus der SICHTBARKEIT des '
      + 'Elternteils unter der RLS von `einsatz` bzw. `bautagebuch`, nicht aus einem '
      + 'Rechteschluessel. `zeit.schreiben` ist an super_admin/admin/leitung gebunden und '
      + 'waere hier das falsche Recht — es oeffnete die Zeiterfassung der ganzen '
      + 'Gesellschaft.',
  },
  {
    pfad: 'api/mein/schichten/[zuordnungId]/bautagebuch/position',
    recht: null,
    grund:
      'BAU-07, SEITENKARTE §7. Die Kolonne FUEGT AN, ueber '
      + '`bautagebuch_position.t_selbst_m1_erfassen` (0303) auf '
      + '`app.ist_eingesetzt_auf_projekt`. `bau.schreiben` waere zu breit: es traegt in '
      + 'derselben WITH-CHECK-Haelfte auch `lv_position`, `nachtrag` und die '
      + 'Aufmassfreigabe — wer den Tag fuehrt, bekaeme das Leistungsverzeichnis. Ein neuer '
      + 'Schluessel scheidet nach K-19 aus.',
  },
  {
    pfad: 'api/mein/schichten/[zuordnungId]/bautagebuch/mannstunden',
    recht: null,
    grund:
      'BAU-07, SEITENKARTE §7. Wie die Position: '
      + '`bautagebuch_mannstunden.t_selbst_m1_erfassen` (0303), Selbstzugriff ueber '
      + '`app.ist_eingesetzt_auf_projekt` und `app.aktuelle_person()`. Abschluss und '
      + 'Gegenzeichnung bleiben `bau.schreiben` und damit der Bauleitung.',
  },
  {
    pfad: 'api/mein/schichten/[zuordnungId]/bautagebuch/korrektur',
    recht: null,
    grund:
      'V-063, BAU-07, LEG-01. Die EIGENE Mannstundenzeile stornieren und ersetzen: '
      + '`bautagebuch_mannstunden.t_selbst_m1_storno` (0303) laesst nur die eigene, '
      + 'lebende Zeile zu und nur den Uebergang auf storniert MIT Ersatz '
      + '(`ersetzt_durch_id is not null`). Ein Fachrecht davor waere eines, das die '
      + 'Kolonne gar nicht halten soll — die Grenze ist die Person, nicht die Rolle.',
  },
  {
    pfad: 'api/mein/schichten/[zuordnungId]/bautagebuch/foto',
    recht: null,
    grund:
      'V-063, BAU-07, TIM-10. Ein Tagesfoto am Bautag der eigenen Schicht: '
      + '`einsatz_medien.t_selbst_schichtmedien` (0303) nennt '
      + '`bezug_tabelle = bautagebuch` ausdruecklich und bindet an '
      + '`app.aktuelle_person()`. Der Tag kommt aus der SCHICHT, nie aus der Anfrage.',
  },
  {
    /**
     * Die Wachbuchseite von der eigenen Schicht (SEC-05, § 34a GewO).
     *
     * `recht: null` heisst hier NICHT „ungeprueft". Es heisst: diese Route
     * ruft `authorize()` nicht, und das Manifest sagt genau das, was der
     * Handler tut — eine Zeile `wachbuch.schreiben` waere eine Behauptung
     * ueber ein Tor, das es in dieser Datei nicht gibt. Geprueft wird der
     * Schluessel trotzdem, nur eine Ebene tiefer.
     */
    pfad: 'api/mein/schichten/[zuordnungId]/wachbuch',
    recht: null,
    grund:
      'SEC-05, TIM-08, LEG-01, SEITENKARTE §7. Der Weg fuehrt ueber die Bruecke '
      + '`api/mein/schichten/bruecke.ts`: Ursprungsvergleich, Sitzung, die eigene '
      + 'Zuordnung im Personen-Scope und der daraus serverseitig abgeleitete Mandant '
      + '(K-02) — nie ein Feld der Anfrage. Das Recht `wachbuch.schreiben` prueft die '
      + 'WITH-CHECK-Haelfte von `wachbuch_eintrag.t_mandant` (0070), also die zweite '
      + 'Linie an der Stelle, an der sie wirkt (AUT-05); `einsatz.t_selbst_m1` (0300) '
      + 'traegt die Zugehoerigkeitsprobe, und die restriktive Mitarbeiterdecke (K-04) '
      + 'liegt darueber. Objekt, Einsatz und Urheber loest der Dienst selbst auf.',
  },
  {
    /**
     * Den Leistungsnachweis auf der Schicht anlegen und vorlegen (CLN-04).
     *
     * Wie die Wachbuchseite: kein `authorize()` im Handler, also `recht: null`
     * — und aus demselben Grund, aus dem `api/mein/antraege` keinen Schluessel
     * traegt. Die Abgrenzung ist „diese Kraft ist auf DIESEM Objekt
     * eingesetzt", und das laesst sich als Rolle nicht sagen (K-19).
     */
    pfad: 'api/mein/schichten/[zuordnungId]/leistungsnachweis',
    recht: null,
    grund:
      'CLN-04, FIN-05, SEITENKARTE §7. Selbstzugriff ueber die Bruecke '
      + '`api/mein/schichten/bruecke.ts` (Ursprung, Sitzung, eigene Zuordnung, daraus '
      + 'der Mandant — K-02) und die Policies `leistungsnachweis.t_selbst_m1_lesen` und '
      + '`t_selbst_m1_vorlegen` (0304) auf `app.ist_eingesetzt_auf_objekt`. Deren '
      + 'WITH CHECK verlangt zusaetzlich `nachweis.schreiben` (AUT-05) und laesst genau '
      + 'zwei Uebergaenge zu — entwurf→vorgelegt und vorgelegt→signiert; stornieren und '
      + 'ablehnen bleiben dem Buero. Den Kunden liest die Route aus `objekt.kunde_id`, '
      + 'nicht aus dem Formular.',
  },
  {
    /**
     * Die Unterschrift des Kunden auf dem Telefon der Kraft (CLN-04, LEG-01).
     *
     * Eine eigene Adresse und nicht ein Zweig der Route darueber: zwischen
     * Anzeige und Fingerdruck steht die Pruefsumme (0066), und `signiere`
     * weist ab, was nicht dazu passt. Auch hier kein `authorize()` — die
     * Wache ist dieselbe Bruecke plus die Signaturdecke.
     */
    pfad: 'api/mein/schichten/[zuordnungId]/leistungsnachweis/[id]/unterschrift',
    recht: null,
    grund:
      'CLN-04, TIM-08, LEG-01, SEITENKARTE §7. Selbstzugriff ueber dieselbe Bruecke wie '
      + 'der Nachweis (Ursprung, Sitzung, eigene Zuordnung, Mandant aus der Schicht — '
      + 'K-02). Die Zeile entsteht unter `leistungsnachweis_signatur.p_portal_decke` und '
      + '`t_selbst_signatur` (0304): sichtbar bleibt nur die eigene Gegenzeichnung und '
      + 'die Unterschrift, die DIESES Konto selbst aufgenommen hat (0066 §5.8). '
      + '`unterzeichnet_am` stempelt ein Ausloeser mit `now()` (Invariante 5); die '
      + 'bestaetigte Pruefsumme haelt `signiere` gegen einen neu gebauten Abzug und weist '
      + 'ab, wenn beide nicht gleich sind.',
  },
  {
    /**
     * Die eigene Unterlage abrufen (EMP-11, DOC-03, DOC-04, SEC-A6, 0361).
     *
     * Wie die Schichtwege darueber ohne `authorize()` — und wie dort heisst
     * `recht: null` nicht „ungeprueft", sondern: diese Route bindet kein
     * Modulrecht, weil `dokument.lesen` der Rolle `mitarbeiter` bewusst fehlt.
     * Der Abruf schreibt seine Spur VOR der signierten Adresse; ein Abruf ohne
     * Spur waere fuer die Auskunft nach Art. 15 DSGVO unsichtbar.
     */
    pfad: 'api/mein/dokumente/[id]/datei',
    recht: null,
    grund:
      'EMP-11, DOC-03, DOC-04, SEC-A6. Selbstzugriff (04-SEITENKARTE §7): „nur der '
      + 'Betroffene" lässt sich als Recht nicht ausdrücken (K-19) — die Rolle '
      + '`mitarbeiter` hält `dokument.lesen` bewusst NICHT, sonst läge ihr die '
      + 'Rechnungsablage offen. Bewacht ist der Abruf stattdessen durch die Sitzung, '
      + 'durch `dokument.t_person` (0009: freigegeben, nicht gelöscht, eigene '
      + 'Gesellschaft), durch den serverseitig aus der gelesenen Zeile abgeleiteten '
      + 'Mandanten (K-02, nie aus der Anfrage) und durch `Sec-Fetch-Site` gegen eine '
      + 'fremde Einbettung. Vor der signierten Adresse schreibt die Route die Abrufspur '
      + '`dokument_zugriff` (0361) in derselben Transaktion: ein Abruf ohne Spur wäre '
      + 'für die Auskunft nach Art. 15 DSGVO unsichtbar.',
  },
  {
    /**
     * Der Rueckweg des Posteingangs (EMP-11, NOT-03, 0350): stempeln und
     * antworten. Kein Rechteschluessel, und das ist kein Loch (K-19,
     * SEITENKARTE §7) — dieselbe Begruendung wie bei `api/mein/antraege`:
     * „nur die Beteiligte" laesst sich als Recht nicht ausdruecken, weil ein
     * Recht einer Rolle gehoert und eine Rolle vielen Menschen.
     */
    pfad: 'api/mein/nachrichten/[id]',
    recht: null,
    grund:
      'EMP-11, NOT-03, SEITENKARTE §7. Den EIGENEN Faden als gelesen stempeln und darin '
      + 'antworten ist Selbstzugriff und kein Modulrecht (K-19). Die Wache ist vierfach: '
      + 'die Sitzung, der Ursprungsvergleich, der aus dem FADEN serverseitig aufgeloeste '
      + 'Mandant (K-02, Invariante 3 — ein fremder Faden gibt dort null Zeilen und damit '
      + '404 statt 403, AUT-06) und die Policies: `t_empfaenger_eigene_stempeln` (0231) '
      + 'trifft nur die eigenen Zustellzeilen, und fuer die Antwort pruefen '
      + '`t_nachricht_mandant` und `t_empfaenger_mandant` im WITH CHECK '
      + '`nachricht.versenden` — im Katalog an `mitarbeiter` gebunden — unter der '
      + 'restriktiven K-04-Mitarbeiterdecke `p_beteiligt`. Nichts verlaesst dabei das '
      + 'System: richtung `intern`, kanal `portal` (Invariante 7, O-36).',
  },

  /**
   * Die vier Wege der Ausgangsrechnung (PR 46) — VIER Adressen und nicht eine.
   *
   * Der Grund steht in den Rechten selbst: Entwurf schreiben, festschreiben,
   * verwerfen und stornieren sind im Katalog vier Schluessel, und vier
   * Handlungen hinter EINER Adresse hiessen, dass die Rechteprüfung sich
   * innerhalb des Handlers verzweigt — also an genau der Stelle, an der eine
   * Aufzaehlungsprobe von aussen nichts mehr sieht. Wer eine Position tippen
   * darf, soll damit keine Rechnung ausgestellt haben.
   */
  {
    pfad: 'api/rechnungen',
    recht: 'finanzen.schreiben',
  },
  {
    /**
     * Die Abrechnungsart eines Auftrags festlegen oder beenden (PR 48,
     * FIN-01, O-04).
     *
     * `abrechnung.schreiben` und nicht `finanzen.schreiben`: hier entsteht
     * keine Rechnung, sondern die REGEL, nach der eine entsteht — und die
     * Seitenkarte bewacht `auftraege/[id]/abrechnung` mit genau diesem
     * Schluessel. Ein Rechnungsschreiber soll den Stundensatz eines laufenden
     * Vertrages nicht nebenbei aendern koennen.
     */
    pfad: 'api/abrechnung',
    recht: 'abrechnung.schreiben',
  },
  {
    /**
     * Das einseitige Tor (FIN-02, FIN-03, Invariante 4). Hinter ihm zieht die
     * Datenbank die Nummer aus dem lueckenlosen Kreis und schreibt den
     * Kettensatz — in DERSELBEN Transaktion, sonst gaebe es vergebene Nummern
     * ohne Kettenglied.
     */
    pfad: 'api/rechnungen/festschreiben',
    recht: 'finanzen.festschreiben',
  },
  {
    /**
     * Der Abzug der Abschlaege in einer Schlussrechnung (FIN-08).
     *
     * `finanzen.schreiben` und NICHT `finanzen.festschreiben`: er aendert
     * einen Entwurf, vergibt keine Nummer und macht nichts unveraenderlich.
     * Am Festschreibungsrecht haengend koennte die Buchhaltungskraft die
     * Rechnung nicht vorbereiten, die eine andere dann festschreibt.
     */
    pfad: 'api/rechnungen/abschlaege',
    recht: 'finanzen.schreiben',
  },
  {
    /**
     * §13b UStG und §48 EStG an einem Entwurf bestimmen (FIN-09, FIN-10).
     *
     * `finanzen.schreiben` wie der Abzug daneben: die Route aendert einen
     * Entwurf. Was sie NICHT kann, ist einen Reverse Charge setzen, den die
     * Nachweise nicht decken — das entscheidet `fin.reverse_charge_pruefen`
     * in der Datenbank und nicht dieses Recht.
     */
    pfad: 'api/rechnungen/steuerfall',
    recht: 'finanzen.schreiben',
  },
  {
    /**
     * Die XRechnung als Datei (FIN-11, PR 52).
     *
     * `finanzen.herunterladen` und NICHT `finanzen.lesen`: das ist dasselbe
     * Recht wie fuer das PDF (03-AUTH §2524), und es traegt eine eigene
     * Entscheidung — wer eine Rechnung am Bildschirm sehen darf, darf sie
     * damit noch nicht als Datei aus dem Haus tragen. Der Kunde haelt es
     * ebenfalls, fuer seine eigenen festgeschriebenen Belege.
     *
     * Die Route SCHREIBT nichts. Sie liest den Snapshot und erzeugt daraus
     * Text; entsteht das Dokument nicht, antwortet sie 422 mit der Liste der
     * fehlenden Felder und nie mit einer halben Datei.
     */
    pfad: 'api/finanzen/rechnungen/[id]/xrechnung.xml',
    recht: 'finanzen.herunterladen',
  },
  {
    /**
     * Dieselbe Rechnung als ZUGFeRD (PR 53, FIN-12) — PDF/A-3 mit
     * eingebetteter CII. Dasselbe Recht wie die XRechnung: es ist derselbe
     * Beleg aus derselben Quelle, nur in dem Format, das ein gewerblicher
     * Empfänger erwartet.
     */
    pfad: 'api/finanzen/rechnungen/[id]/zugferd.pdf',
    recht: 'finanzen.herunterladen',
  },
  {
    /**
     * Der EIGENE Beleg des Kunden als ZUGFeRD (FIN-11, FIN-12, DOC-03).
     *
     * Eine eigene Route neben `api/finanzen/rechnungen/[id]/zugferd.pdf`, weil
     * die interne mit 401 abbricht, sobald `sitzung.aktiverMandantId` null ist
     * — und im Kunden-Scope ist sie das IMMER (K-20). Dieselbe Datei aus
     * derselben Quelle (`rechnung_snapshot`, K-12); was sich unterscheidet,
     * ist ausschliesslich, WER lesen darf.
     *
     * Dasselbe Recht wie intern: `authorize` bekommt den Bereich aus der
     * angefragten Rechnung (`mandantZurRechnung`), weil `app.hat_recht(recht,
     * null)` im Kunden-Scope auf alles `false` antwortet. Eine fremde Kennung
     * liefert `null` und damit 404, noch bevor ein Recht gefragt wird
     * (AUT-06).
     */
    pfad: 'api/kunde/rechnungen/[id]/zugferd.pdf',
    recht: 'finanzen.herunterladen',
  },
  {
    /**
     * Derselbe Beleg als XRechnung (UBL). Gleiches Recht, gleiches Tor,
     * gleiche Quelle — nur das Format wechselt.
     */
    pfad: 'api/kunde/rechnungen/[id]/xrechnung.xml',
    recht: 'finanzen.herunterladen',
  },
  {
    /**
     * Verwerfen ist ein ZUSTANDSWECHSEL, kein Loeschen (Invariante 8). Der
     * Entwurf bleibt mit Grund stehen — er ist der Satz, den eine
     * Betriebspruefung liest, wenn sie nach der fehlenden Nummer fragt.
     */
    pfad: 'api/rechnungen/verwerfen',
    recht: 'finanzen.entwurf_verwerfen',
  },
  {
    /**
     * Storno und Korrektur. Eigenes Recht, weil hier ein bereits ausgestellter
     * Beleg aufgehoben wird — wer festschreiben darf, darf deshalb noch lange
     * nicht aufheben. O-77 fragt, WER das sein soll; bis dahin gilt die
     * Katalogvorgabe.
     */
    pfad: 'api/rechnungen/storno',
    recht: 'finanzen.stornieren',
  },
  {
    /**
     * Der §14-UStG-Vorabbericht (PR 47, FIN-04). Er LIEST — deshalb
     * `finanzen.lesen` und nicht `finanzen.festschreiben`: der Bericht sagt,
     * welches Pflichtfeld fehlt, und stellt nichts aus. Haette er das engere
     * Recht, müsste die Buchhaltung jemanden mit Festschreibungsrecht fragen,
     * um einen Tippfehler in der Kundenanschrift zu finden.
     */
    pfad: 'api/rechnungen/pruefung',
    recht: 'finanzen.lesen',
  },
  {
    /**
     * Zahlungseingang erfassen und stornieren (PR 54.1, FIN-14, ACC-04).
     *
     * `zahlung.schreiben` und NICHT `finanzen.schreiben`: eine Zahlung zu
     * erfassen ist keine Handlung am Beleg. Wer Rechnungen schreibt, darf
     * deshalb nicht schon deswegen Geldeingaenge buchen — die Trennung ist
     * die uebliche im Rechnungswesen, und der Katalog fuehrt beide Rechte
     * getrennt.
     */
    pfad: 'api/finanzen/zahlungen',
    recht: 'zahlung.schreiben',
  },
  {
    /**
     * Eingangsrechnungen erfassen und weiterschieben (PR 54.3, FIN-14,
     * ACC-03, ACC-05).
     *
     * Hier steht `eingang.schreiben`, das SCHWAECHERE der beiden Rechte, die
     * diese Adresse traegt: das Erfassen. Freigeben und Buchen pruefen im
     * Handler zusaetzlich `eingang.freigeben` — wer erfasst, gibt nicht schon
     * deswegen frei (Invariante 7). Das Manifest fuehrt das Eintrittsrecht;
     * die engere Pruefung steht dort, wo sie greift, und ein Isolationstest
     * haelt beide auseinander.
     */
    pfad: 'api/finanzen/eingangsrechnungen',
    recht: 'eingang.schreiben',
  },
  {
    /**
     * Mahnungen: Entwuerfe anlegen, verwerfen, freigeben, Versand
     * dokumentieren (PR 55, FIN-15).
     *
     * Hier steht `mahnung.schreiben`, das SCHWAECHERE der beiden Rechte
     * dieser Adresse. Freigeben und Versenden pruefen im Handler zusaetzlich
     * `mahnung.freigeben` — wer eine Mahnung vorbereitet, laesst sie nicht
     * schon deswegen hinausgehen (Invariante 7). Ein Isolationstest haelt
     * beide auseinander.
     */
    pfad: 'api/finanzen/mahnungen',
    recht: 'mahnung.schreiben',
  },
  {
    /**
     * Eine Mahnstufe bestaetigen (PR 55, FIN-15, O-19).
     *
     * `mahnung.schreiben` und nicht `mahnung.freigeben`: hier wird die REGEL
     * gesetzt, nicht ein Brief freigegeben. Die beiden auseinanderzuhalten
     * ist der Kern von Invariante 7 — wer Stufen pflegt, laesst damit noch
     * nichts hinausgehen.
     */
    pfad: 'api/einstellungen/mahnwesen',
    recht: 'mahnung.schreiben',
  },
  {
    /**
     * Eine Abweichung dieser Gesellschaft an der Rechtematrix setzen (V-023,
     * AUT-03).
     *
     * **`system.rolle_verwalten` und ausdruecklich `erfordert2fa`.** Die
     * restriktive Policy `p_rb_aal2` (0008) weist eine `aal1`-Sitzung ab —
     * mit „new row violates row-level security policy", also einem 500er an
     * einer Stelle, an der „zeig den zweiten Faktor" die Wahrheit ist. Der
     * Handler sagt denselben Satz vorher und verstaendlich (AUT-02, K-15).
     *
     * **`system.rolle_lesen` reicht NICHT.** Wer die Matrix ansehen darf,
     * verstellt sie damit nicht — `rolle_lesen` ist bis `leitung` bindbar,
     * `rolle_verwalten` nur bis `admin`.
     */
    pfad: 'api/einstellungen/rollenrecht',
    recht: 'system.rolle_verwalten',
  },
  {
    /**
     * Ein Dokument samt Datei entfernen (V-026, DOC-07, LEG-01).
     *
     * **`dokument.archivieren` und nicht `dokument.schreiben`.** Wer ablegen
     * darf, raeumt damit nicht auf: das eine legt etwas hinzu, das andere
     * nimmt etwas fort, und in einem Archiv ist das nicht dieselbe Handlung.
     * Der Katalog trennt sie seit `0008`; gefragt hat bis hierher niemand
     * danach.
     *
     * Was bleiben MUSS, entscheidet nicht diese Route: `kern.dokument_
     * loeschsperre` (0009) und `fin.dokument_haengt_an_buchung` (0132) stehen
     * vor der Zeile und gelten fuer jeden Weg.
     */
    pfad: 'api/dokumente/loeschen',
    recht: 'dokument.archivieren',
  },
  {
    /**
     * Eine Richtlinie des Ausgangs-Gates setzen (AGT-03, APR-01,
     * Invariante 7).
     *
     * `agent.richtlinie_verwalten` und nicht `versand.freigeben`: hier wird
     * die REGEL gesetzt, nicht eine Nachricht freigegeben. Wer Richtlinien
     * pflegt, laesst damit noch nichts hinausgehen - und wer freigibt,
     * aendert damit keine Regel. `0203` zieht die RLS der Tabelle auf
     * dasselbe Recht; vorher kam die Sitzung durch das Tor und bekam null
     * Zeilen.
     */
    pfad: 'api/einstellungen/agent-richtlinien',
    recht: 'agent.richtlinie_verwalten',
  },
  {
    /**
     * Das Beweismittelbuendel ueber das Pruefprotokoll (SEC-A9, DOC-08,
     * LEG-01): Manifest immer, ZIP mit Protokoll-CSV dazu. Jeder Abruf steht
     * im Protokoll - ein Beweismittel verlaesst das Haus.
     *
     * `system.audit_exportieren` ist das Recht der Route; die
     * Vorher/Nachher-WERTE haengen zusaetzlich an
     * `system.audit_sensitiv_lesen`, und DAS Recht verlangt seit 0206 den
     * zweiten Faktor (`berechtigung.erfordert_2fa`, AUT-02). Fehlt eines von
     * beiden, kommt ein redigiertes Buendel mit dem Grund im Manifest und
     * der Kopfzeile `x-cse-redigiert`. Der Handler autorisiert mit
     * `schreibend: true`: der GET schreibt Kettenglieder und zwei
     * Protokollzeilen.
     */
    pfad: 'api/einstellungen/protokoll/export',
    recht: 'system.audit_exportieren',
  },
  {
    /**
     * Das Erscheinungsbild einer Gesellschaft pflegen (TEN-07, PUB-09,
     * LEG-07, DESIGN §11).
     *
     * `system.identitaet_verwalten` und nicht `system.mandant_verwalten`:
     * das Erscheinungsbild ist nicht die Firmierung. Wer das Logo pflegt,
     * aendert damit keine Registernummer.
     */
    pfad: 'api/einstellungen/identitaet',
    recht: 'system.identitaet_verwalten',
  },
  {
    /**
     * Logo, Avatar und Titelbild setzen oder die Zuordnung wegnehmen (V-100,
     * D-628). Dasselbe Recht wie die uebrige Identitaet: wer das
     * Erscheinungsbild pflegt, pflegt auch seine Bilder.
     */
    pfad: 'api/einstellungen/identitaet/bild',
    recht: 'system.identitaet_verwalten',
  },
  {
    pfad: 'api/marke/[mandant]/[art]/[version]',
    recht: null,
    grund:
      'V-100, D-628, PUB-09, PUB-14, PRO-01. Logo, Avatar und Titelbild stehen auf der '
      + 'öffentlichen Website — hinter einer Anmeldung sähe sie niemand. Offen ist die Route '
      + 'trotzdem nur für eine VERÖFFENTLICHTE Identität (`oeffentlich_sichtbar`, gelesen über '
      + 'die Projektions-View); sonst nur für eine Sitzung in genau dieser Gesellschaft, und '
      + 'sonst 404. Der Behälter `marke` bleibt privat.',
  },
  {
    /**
     * Eine Behinderungsvorlage bestaetigen (BAU-06, § 6 VOB/B).
     *
     * Im Manifest steht das Recht der SEITE; der Handler autorisiert
     * zusaetzlich `bau.schreiben`, das Recht der TABELLE
     * (`behinderung_vorlage`, Policy `t_mandant`). Nur das erste zu pruefen
     * hiesse: Handler durch, RLS weist ab, null Zeilen, Erfolgsmeldung fuer
     * eine Aenderung, die nicht stattfand.
     */
    pfad: 'api/einstellungen/vorlagen',
    recht: 'system.einstellung_verwalten',
  },
  {
    /**
     * Ein Arbeitszeitmodell oder eine Tarifregel hinterlegen (EMP-04,
     * TIM-06, TIM-14, O-18, O-50).
     *
     * `stammdaten.verwalten` ist das Recht der Seite UND das der beiden
     * Tabellen (0201) - hier gibt es keinen Rechtebruch zu ueberbruecken.
     * Die gesetzlichen ArbZG-Grenzen sind keine Einstellung; ein Wert
     * darunter wird abgewiesen.
     */
    pfad: 'api/einstellungen/arbeitszeit',
    recht: 'stammdaten.verwalten',
  },
  {
    /**
     * Die fuenf Stammdatenkataloge (SEITENKARTE §5.13, OPS-02, OPS-03,
     * SEC-01, EMP-05, EMP-10).
     *
     * `stammdaten.verwalten` und nicht `objekt.lesen`: hier wird der KATALOG
     * gepflegt, nicht ein Objekt gelesen. Dass belagsart und reinigungsklasse
     * zusaetzlich `objekt.lesen` brauchen, ist die Lesepolicy der Tabellen
     * (0021) und keine zweite Routenfrage — die Seiten sagen es dem Menschen.
     */
    pfad: 'api/stammdaten/abwesenheitsarten',
    recht: 'stammdaten.verwalten',
  },
  { pfad: 'api/stammdaten/antragsarten', recht: 'stammdaten.verwalten' },
  { pfad: 'api/stammdaten/belagsarten', recht: 'stammdaten.verwalten' },
  { pfad: 'api/stammdaten/qualifikationen', recht: 'stammdaten.verwalten' },
  { pfad: 'api/stammdaten/reinigungsklassen', recht: 'stammdaten.verwalten' },
  {
    /**
     * Das archivierte Dokument zu einer Buchungszeile (PR 59, ACC-03,
     * DOC-03, DOC-04).
     *
     * `buchhaltung.lesen` und nicht `dokument.lesen`: der Zugang laeuft ueber
     * die BUCHUNG, nicht ueber die Dokumentenablage. Wer das Hauptbuch lesen
     * darf, sieht die Belege, auf die es sich beruft — ohne dafuer Zugriff
     * auf jedes Dokument des Hauses zu bekommen, und umgekehrt oeffnet
     * `dokument.lesen` allein keine Buchung.
     *
     * Die Route liefert keine Bytes; sie leitet auf eine signierte Adresse
     * um, die nach fuenfzehn Minuten ablaeuft (D-445).
     */
    pfad: 'api/buchhaltung/buchungen/[id]/beleg',
    recht: 'buchhaltung.lesen',
  },
  {
    /**
     * Einen EXTF-Buchungsstapel erzeugen (PR 60, ACC-02).
     *
     * `buchhaltung.exportieren` und nicht `buchhaltung.lesen`: hier entsteht
     * eine Datei, die das Haus verlaesst. Der Katalog trennt die beiden seit
     * 0008 genau dafuer und bindet das Exportrecht an `super_admin` und
     * `admin`.
     *
     * Die Route SENDET nichts — es gibt keinen DATEV-Endpunkt und keine
     * Zugangsdaten. Sie erzeugt; ein Mensch uebergibt.
     */
    pfad: 'api/buchhaltung/datev',
    recht: 'buchhaltung.exportieren',
  },
  {
    /**
     * Die archivierte EXTF-Datei (PR 60, ACC-02, DOC-03).
     *
     * Ebenfalls `buchhaltung.exportieren`, anders als beim einzelnen Beleg:
     * wer das Hauptbuch liest, bekommt damit nicht die Datei in die Hand, die
     * an das Steuerbuero geht — in ihr stehen saemtliche Buchungen eines
     * Monats. Weitergeleitet wird auf eine signierte, ablaufende Adresse
     * (D-445).
     */
    pfad: 'api/buchhaltung/datev/[id]/datei',
    recht: 'buchhaltung.exportieren',
  },
  {
    /**
     * Der VERMERK am Buchungsstapel (V-027): übergeben oder verworfen.
     *
     * `buchhaltung.exportieren` — dasselbe Recht, das den Stapel erzeugt und
     * das `t_mandant` auf `datev_export` im WITH CHECK verlangt. Wer eine
     * Datei erzeugen darf, vermerkt auch, was aus ihr geworden ist; ein
     * eigenes Recht trennte zwei Hälften desselben Vorgangs.
     *
     * **Sie sendet nichts.** Es gibt keinen DATEV-Endpunkt und keine
     * Zugangsdaten (O-05). Was hier entsteht, ist der Vermerk eines Menschen
     * über etwas, das er selbst getan hat.
     */
    pfad: 'api/buchhaltung/datev/[id]/stand',
    recht: 'buchhaltung.exportieren',
  },
  {
    /**
     * Der Abruf einer Datei aus der Ablage (DOC-03, SEC-A6, D-478).
     *
     * `dokument.lesen` im aktiven Mandanten; die Route vermerkt den Abruf
     * in `dokument_zugriff` und leitet auf eine signierte, ablaufende
     * Adresse weiter. Ohne verbundenen Speicher antwortet sie 503 — es gibt
     * dann keine Adresse, die sie ausgeben koennte.
     */
    pfad: 'api/dokumente/[id]/datei',
    recht: 'dokument.lesen',
  },
  {
    /**
     * Ein Dokument fuer das Kundenportal freigeben oder die Freigabe
     * zuruecknehmen (0297, DOC-01, DOC-03).
     *
     * `dokument.kunde_freigeben` und nicht `dokument.lesen`: wer eine Akte
     * ansehen darf, gibt damit nichts nach draussen. Eine EIGENE Adresse
     * neben `…/datei`, weil das Manifest EIN Recht je Pfad fuehrt.
     */
    pfad: 'api/dokumente/[id]/kundenfreigabe',
    recht: 'dokument.kunde_freigeben',
  },
  {
    /**
     * Ablegen, was ein MENSCH mitbringt (DOC-01, DOC-03, DOC-06, TIM-10).
     *
     * `dokument.schreiben` — dasselbe Recht wie jeder andere Schreibweg in
     * die Ablage. Die KUNDENsichtbarkeit steht ausdruecklich NICHT hier: sie
     * ist eine eigene Handlung mit `dokument.kunde_freigeben` auf
     * `api/dokumente/[id]/kundenfreigabe`. Zwei Schreibflaechen ueber einer
     * Spalte, mit zwei verschiedenen Rechten, waeren der Defekt, bei dem der
     * schwaechere Weg gewinnt.
     *
     * **Ein `multipart`-POST und kein Upload-Ticket** (Abweichung von
     * 05-API-KARTE §C): nur so findet die MIME-Pruefung an den BYTES statt.
     * Wer den Browser direkt in den Bucket schreiben laesst, prueft danach
     * eine Datei, die schon liegt.
     */
    pfad: 'api/dokumente/upload',
    recht: 'dokument.schreiben',
  },
  {
    /**
     * Einen CAMT.053-Kontoauszug einlesen (PR 61, ACC-04).
     *
     * `zahlung.schreiben` und nicht `buchhaltung.lesen`: der Import legt bei
     * einem EINDEUTIGEN Treffer eine Zahlung an. Wer den Auszug nur ansehen
     * will, kommt ueber die Portalseite mit `buchhaltung.lesen` — Lesen und
     * Einlesen sind hier zwei verschiedene Handlungen.
     *
     * Die Route RUFT NICHTS AB. Es gibt kein PSD2, kein FinTS und keine
     * Zugangsdaten; ein Mensch laedt die Datei hoch.
     */
    pfad: 'api/buchhaltung/bank',
    recht: 'zahlung.schreiben',
  },
  {
    /**
     * Die Klaerung eines Umsatzes: ein Mensch bestaetigt einen offenen
     * Posten oder sagt „ohne Bezug" (ACC-04). Dasselbe Recht wie der Import,
     * denn dieselbe Zahlung entsteht — nur mit einem Menschen als Akteur.
     */
    pfad: 'api/buchhaltung/bank/umsatz',
    recht: 'zahlung.schreiben',
  },
  {
    /**
     * Eine Aufbewahrungsregel dieser Gesellschaft setzen (DOC-07, PR 64,
     * D-483). Nie unter die gesetzliche Untergrenze — der Dienst sagt es,
     * der Ausloeser haelt es.
     */
    pfad: 'api/dokumente/aufbewahrung',
    recht: 'dokument.aufbewahrung_verwalten',
  },
  {
    /**
     * Das Pruefbuendel eines Wirtschaftsjahrs abrufen (DOC-08, PR 64):
     * Manifest immer, ZIP nur mit verbundenem Speicher und ohne Sperre.
     * Jeder Abruf steht im Protokoll — ein Buendel verlaesst das Haus.
     */
    pfad: 'api/dokumente/buendel',
    recht: 'dokument.buendel_exportieren',
  },
  {
    /**
     * Das Periodenschloss (ACC-01, PR 65): vorlaeufig schliessen, schliessen,
     * wieder oeffnen — unter `buchhaltung.festschreiben`, dem Recht, das auch
     * in einen vorlaeufig geschlossenen Monat noch buchen darf.
     */
    pfad: 'api/buchhaltung/perioden',
    recht: 'buchhaltung.festschreiben',
  },
  {
    /**
     * Die Datentraegerueberlassung Z3 (ACC-09, § 147 Abs. 6 AO, PR 66):
     * das Paket eines Wirtschaftsjahrs zum Herunterladen — unter
     * `buchhaltung.exportieren`, wie der DATEV-Export: Daten verlassen das
     * Haus, und jeder Abruf steht im Protokoll.
     */
    pfad: 'api/buchhaltung/z3-export',
    recht: 'buchhaltung.exportieren',
  },
  {
    /**
     * Die Verfahrensdokumentation (ACC-10, PR 66) als Markdown, PDF oder
     * JSON — unter `buchhaltung_konfiguration.lesen`, dem Recht der Seite:
     * sie beschreibt die Konfiguration, sie aendert sie nicht.
     */
    pfad: 'api/buchhaltung/verfahrensdokumentation',
    recht: 'buchhaltung_konfiguration.lesen',
  },
  {
    /**
     * Das Verarbeitungsverzeichnis nach Art. 30 DSGVO (LEG-09, Phase 10) als
     * Markdown oder JSON — unter `system.einstellung_lesen`, demselben Recht
     * wie die Seite: es beschreibt die Konfiguration der Gesellschaft und
     * aendert nichts. Zwei Rechte fuer dieselbe Auskunft waeren eine Tuer mit
     * zwei Schloessern und einem Schluessel.
     *
     * Kein PDF: ein Verzeichnis nach Art. 30 wird fortgeschrieben und
     * vorgelegt, nicht archiviert — eine dritte Kopie waere ab dem Abruf
     * veraltet.
     */
    pfad: 'api/datenschutz/verarbeitungsverzeichnis',
    recht: 'system.einstellung_lesen',
  },
  {
    /**
     * Das Löschkonzept (LEG-09, Phase 10) als Markdown oder JSON — dasselbe
     * Recht wie die Seite und wie das Verzeichnis daneben: beide beschreiben
     * die Konfiguration dieser Gesellschaft und ändern nichts. Es beschreibt
     * Löschungen und führt keine aus.
     */
    pfad: 'api/datenschutz/loeschkonzept',
    recht: 'system.einstellung_lesen',
  },
  {
    /**
     * Das Jahrespaket fuer den Steuerberater (ACC-11, PR 67): ein ZIP je
     * Wirtschaftsjahr, unter `buchhaltung.exportieren` wie der DATEV-Stapel.
     * Jeder Abruf steht im Protokoll.
     */
    pfad: 'api/buchhaltung/jahrespaket',
    recht: 'buchhaltung.exportieren',
  },
  {
    /**
     * Der Lohnexport (ACC-12, PR 67): Zeitdaten eines Monats fuer das
     * Lohnsystem — personenbezogen, deshalb `zeit.exportieren` und nicht
     * `buchhaltung.exportieren`; das Format ist ein Platzhalter (O-27).
     */
    pfad: 'api/buchhaltung/lohnexport',
    recht: 'zeit.exportieren',
  },
  {
    /**
     * Eine Serie anlegen und sofort planen (TIM-01, TIM-02, D-487) — unter
     * `dienstplan.schreiben`, wie das Besetzen einer Schicht.
     */
    pfad: 'api/dienstplan/serien',
    recht: 'dienstplan.schreiben',
  },
  {
    /**
     * Eine Einzeltermin-Ausnahme einer Serie (TIM-02): ausfall,
     * verschiebung, zusatz. `dienstplan.schreiben` ist das Torrecht; die
     * Ausnahmetabellen gehoeren aber den GEWERKEN — `turnus_ausnahme`
     * verlangt `reinigung.schreiben` (0029), `posten_ausnahme`
     * `security.schreiben` (0069). Welches gilt, entscheidet der Traeger,
     * und der Handler prueft es nach dem Lesen der Serie zusaetzlich selbst.
     */
    pfad: 'api/dienstplan/serien/[id]/ausnahmen',
    recht: 'dienstplan.schreiben',
  },
  {
    /**
     * V-021, TIM-02, TIM-03. Eine Serie AENDERN, BEENDEN oder ARCHIVIEREN.
     *
     * Dasselbe Rechtepaar wie bei den Ausnahmen daneben und aus demselben
     * Grund: die Route gehoert dem Dienstplan, die Schreibpolicy der Tabelle
     * fragt das Gewerk (`turnus` → `reinigung.schreiben` (0029), `posten` →
     * `security.schreiben` (0069)). `horizont` und `archivieren` schreiben
     * nur auf `planungsserie` und brauchen nur `dienstplan.schreiben` — das
     * Ausfuehrungsprotokoll des Generators gehoert dem Dienstplan.
     */
    pfad: 'api/dienstplan/serien/[id]',
    recht: 'dienstplan.schreiben',
  },
  {
    /**
     * V-015, AGT-05. Die Obergrenze eines Monats setzen.
     *
     * **`agent.budget_verwalten` und ausdruecklich NICHT
     * `agent.aufgabe_starten`.** Das zweite haelt auch eine `leitung`; wer
     * damit auch die Obergrenze setzen duerfte, verstellte seine eigene
     * Grenze, und AGT-05 haette keine. `0385` zieht die Schreibpolicy auf
     * `agent_budget` auf dasselbe Recht nach — die Route prueft es, damit
     * der Mensch einen Satz bekommt statt „null Zeilen betroffen".
     */
    pfad: 'api/agenten/budget',
    recht: 'agent.budget_verwalten',
  },
  {
    /**
     * Einen Zeitraum bekanntgeben (TIM-01, NOT-01). Geschrieben wird ueber
     * `app.dienstplan_veroeffentlichung_anlegen` (0266) — `cse_app` haelt auf
     * `benachrichtigung` kein Tabellenrecht INSERT. Die Leserechte
     * (`dienstplan.lesen`, `objekt.lesen`) prueft der Dienst zusaetzlich,
     * damit der Beleg nicht aus einer von der RLS leergeraeumten Abfrage
     * entsteht.
     */
    pfad: 'api/dienstplan/veroeffentlichung',
    recht: 'dienstplan.veroeffentlichen',
  },
  {
    /**
     * Den Stand einer Bekanntmachung setzen (RAD-07, D-490). Drei Staende —
     * geprueft, in Bearbeitung, verworfen mit Grund. **Einreichen steht hier
     * nicht**: die Vergabeplattformen bieten dafuer keine Schnittstelle an
     * (D-07), und eine Route, die so hiesse, waere eine Behauptung.
     */
    pfad: 'api/radar/vorgang',
    recht: 'radar.status_setzen',
  },
  {
    /**
     * Ein Suchprofil des Vergaberadars pflegen (RAD-04, RAD-05): Stammdaten
     * setzen, eine CPV-Zeile anlegen oder aendern, eine entfernen, einen
     * Benachrichtigungsempfaenger eintragen, einen entfernen. Fuenf
     * Handlungen, ein Tor — fuenf Routen waeren fuenf Stellen, an denen
     * jemand das `authorize` vergisst.
     *
     * Was gesperrt ist, taucht hier nicht einmal als Feldname auf:
     * Gewichtung, Benachrichtigungsschwelle, Skala, Waehrung und die Wirkung
     * der Negativ-Stichwoerter sind O-15, O-47 und O-191.
     */
    pfad: 'api/radar/profil',
    recht: 'radar.profil_schreiben',
  },
  {
    /**
     * Die Pruefliste der Vergabemappe (RAD-07): Position anlegen, Stand einer
     * Position setzen, Stand der Mappe setzen — drei Handlungen, ein Recht.
     */
    pfad: 'api/vergabe/mappe',
    recht: 'vergabe.schreiben',
  },
  {
    /**
     * Eine geforderte Unterlage beilegen. Dasselbe Recht wie die Pruefliste:
     * eine Datei anzuhaengen ist Fuehren der Mappe, nicht Bezeugen einer
     * Abgabe. Sie setzt `vorhanden`, nie `geprueft` (D-492).
     */
    pfad: 'api/vergabe/unterlage',
    recht: 'vergabe.schreiben',
  },
  {
    /**
     * Festhalten, dass ein MENSCH eingereicht hat (D-07). Ein eigenes Recht,
     * weil es eine andere Aussage ist als „ich habe ein Formular abgehakt":
     * `vergabe.einreichung_erfassen` bezeugt eine Abgabe, die ausserhalb
     * dieser Plattform stattgefunden hat.
     */
    pfad: 'api/vergabe/einreichung',
    recht: 'vergabe.einreichung_erfassen',
  },
  {
    /**
     * Wie das Verfahren ausgegangen ist (REP-06). Dasselbe Recht wie die
     * Einreichung: beides bezeugt, was ausserhalb dieser Plattform geschehen
     * ist — die Abgabe und die Entscheidung der Vergabestelle.
     */
    pfad: 'api/vergabe/ausgang',
    recht: 'vergabe.einreichung_erfassen',
  },
  {
    /**
     * Ein Agentenlauf (AGT-01). `agent.aufgabe_starten` und nicht ein
     * Senderecht: der Lauf legt VOR — am Ende steht ein Vorschlag im
     * Posteingang, und was daraus wird, entscheidet ein Mensch (Invariante 7).
     */
    pfad: 'api/agenten/lauf',
    recht: 'agent.aufgabe_starten',
  },
  {
    /**
     * Stapelfreigabe (APR-04) — `freigabe.stapel_entscheiden`, NICHT
     * `freigabe.entscheiden`.
     *
     * Ein frueherer Entwurf hier stand auf „ein Stapel ist zehnmal dieselbe
     * Handlung". Der Katalog sagt etwas anderes, und er hat recht: das Recht
     * ist an `admin` und `leitung` BINDBAR, nicht gebunden. Wer einzeln
     * entscheiden darf, darf damit nicht schon fuenfzig auf einmal — das ist
     * der Unterschied zwischen einer Pruefung und einem Haeckchen bei „alle",
     * und genau den soll APR-08 aufspueren.
     */
    pfad: 'api/freigaben/stapel',
    recht: 'freigabe.stapel_entscheiden',
  },
  {
    /**
     * Einspruch (APR-05) und Ruecknahme (APR-06) — zwei eigene, bindbare
     * Rechte. Beide holen eine GEFALLENE Entscheidung zurueck, und das ist
     * eine andere Befugnis als sie zu treffen: die Route waehlt je nach
     * `was` zwischen `freigabe.einspruch_erheben` und `freigabe.rueckgaengig`.
     * Hier steht das schwaechere der beiden als Torpruefung; die Route und
     * die Definer-Funktion pruefen das genaue.
     */
    pfad: 'api/freigaben/fenster',
    recht: 'freigabe.einspruch_erheben',
  },
  {
    /**
     * Der Anmeldecode aus der Hand der Einsatzleitung (EMP-01, O-82, D-487):
     * `personal.zugang_verwalten`, das Recht der Zugangsseite. Der Klartext
     * geht in einen kurzlebigen Keks, nie in die Adresse.
     */
    pfad: 'api/personal/zugang-code',
    recht: 'personal.zugang_verwalten',
  },
  {
    /**
     * V-014, EMP-01, EMP-14, AUT-08. Den Telefonzugang einrichten, die
     * Anmeldenummer umschreiben, sperren, entsperren.
     *
     * **Dasselbe Recht wie die Codeausstellung daneben**, und das ist hier
     * richtig: es ist dieselbe Personalstelle, die die Nummer entgegennimmt
     * und den verlorenen Zugang anhaelt. `t_zugang_anlegen` und
     * `t_zugang_aendern` (0113/0384) pruefen den Mandanten und die
     * Beschaeftigung ein zweites Mal.
     *
     * **Das Sperren braucht ausdruecklich keinen zweiten Schluessel.** Ein
     * verlorenes Diensttelefon wird gemeldet, waehrend jemand im Treppenhaus
     * steht; eine Sperre, die auf ein zweites Augenpaar wartet, kommt zu
     * spaet. Ob umgekehrt das UMSCHREIBEN vier Augen braucht, ist offen
     * (O-86) und wird nicht erfunden.
     */
    pfad: 'api/personal/zugang',
    recht: 'personal.zugang_verwalten',
  },
  {
    /**
     * V-013, TIM-01, TIM-04. Eine EINZELNE Schicht anlegen oder absagen.
     *
     * `dienstplan.schreiben` fuer beides — es ist dieselbe Disposition, die
     * eine Sonderreinigung ansetzt und sie wieder absagt. `t_mandant` auf
     * `einsatz` (0028) prueft den Schluessel bei jedem Schreibvorgang ein
     * zweites Mal.
     *
     * Nicht zu verwechseln mit `api/einsaetze/[id]/absagen`: dort sagt EINE
     * Eingeteilte ihre Zuordnung ab, hier faellt die ganze Schicht aus.
     */
    pfad: 'api/dienstplan/einsatz',
    recht: 'dienstplan.schreiben',
  },
  {
    /**
     * Einstellen (D-09, EMP-14, §5.12) — `personal.schreiben`, dasselbe Recht
     * wie `…/anstellungen/[id]/vertrag`.
     *
     * **Eine Route fuer zwei Wege**, weil es EIN Vorgang ist: die
     * Beschaeftigung entsteht, und der Mensch davor entweder auch oder eben
     * nicht. Zwei Routen waeren zwei Transaktionen, und dazwischen laege eine
     * `person`-Zeile ohne Beschaeftigung — von dieser Gesellschaft aus
     * unsichtbar (`t_person_lesen`) und damit fuer immer unauffindbar.
     *
     * Entgelt und Kondition laufen weiter ueber `…/entgelt` mit dem
     * strengeren `personal.entgelt_schreiben`; der Portalzugang ueber
     * `api/personal/zugang-code`. Der `authorize`-Aufruf steht wie bei der
     * Personalakte darunter in `api/personal/gemeinsam.ts`; seit 0367
     * verlangen `t_person_schreiben` und `t_anstellung_schreiben` denselben
     * Schluessel ein zweites Mal (AUT-05).
     */
    pfad: 'api/personal/anstellungen',
    recht: 'personal.schreiben',
  },
  /**
   * Die Personalakte (D-09, 01-KERN §6.13/§6.14/§6.15, 05-API-KARTE §C.8).
   *
   * **Fuenf Adressen und nicht eine Maske**, weil die Spalten dahinter
   * verschieden schwer wiegen. Wer eine Personalnummer tippt, soll damit
   * keinen Stundensatz gesetzt und keinen Austritt verfuegt haben — und genau
   * das waere der Fall, wenn ein Handler sich intern verzweigte: von aussen
   * saehe die Aufzaehlungsprobe nur noch EIN Recht.
   *
   * Alle fuenf laufen durch `api/personal/gemeinsam.ts`; dort steht der
   * `authorize`-Aufruf, einmal statt fuenfmal.
   */
  {
    /**
     * Personalnummer und Eintritt — das Leichteste der drei auf `anstellung`.
     * Arbeitszeitmodell und Wochenstunden stehen bewusst NICHT hier: sie sind
     * der Spiegel der datierten `anstellung_kondition` (§6.14) und laufen
     * ueber `…/entgelt` mit dem strengeren Schluessel; `cse_app` hat auf
     * diesen Spalten ueberhaupt kein UPDATE (0191).
     */
    pfad: 'api/personal/anstellungen/[id]/vertrag',
    recht: 'personal.schreiben',
  },
  {
    /**
     * Der datierte Entgeltsatz (§6.15, Invariante 1). `personal.schreiben`
     * waere hier zu schwach: `personal.entgelt_schreiben` haelt nur
     * `super_admin` fest, `admin` bindbar — und dieselbe Trennung prueft die
     * WITH-CHECK-Haelfte von `anstellung_kondition` ein zweites Mal (0192,
     * AUT-05). Der Betrag wird serverseitig in Cent geparst, nie geraten.
     */
    pfad: 'api/personal/anstellungen/[id]/entgelt',
    recht: 'personal.entgelt_schreiben',
  },
  {
    /**
     * Austritt und Grund (K-14, R-08). Ein eigener Schluessel, weil am
     * Statuswechsel der Entzug der abgeleiteten Mitgliedschaft haengt — und
     * weil es nie ein DELETE ist (Invariante 8): Zeit-, Konto- und
     * Rechnungsdaten haengen an dieser Zeile.
     */
    pfad: 'api/personal/anstellungen/[id]/beenden',
    recht: 'personal.anstellung_beenden',
  },
  {
    /**
     * Geburtsdatum, Geburtsort, Staatsangehoerigkeit (SEC-03, LEG-09, §6.13).
     *
     * **Geschrieben mit `personal.schreiben`, gelesen mit
     * `personal.stammdaten_lesen`** — und das Manifest fuehrt das SCHREIBEN,
     * weil diese Route schreibt. GRANT UPDATE und GRANT SELECT sind getrennt:
     * das Formular nimmt ein Geburtsdatum auf, ohne es zurueckzulesen; wer das
     * Ergebnis sehen will, geht ueber `app.person_stammdaten_lesen` und
     * hinterlaesst seine Auditzeile. `t_person_personalpflege` (0190) verlangt
     * zusaetzlich eine Beschaeftigung in der AKTIVEN Gesellschaft — `person`
     * traegt keinen Mandanten (D-09).
     */
    pfad: 'api/personal/personen/[id]/stammdaten',
    recht: 'personal.schreiben',
  },
  {
    /**
     * Zwei `person`-Zeilen sind ein Mensch (§6.13, LEG-09).
     *
     * Der eigene Schluessel ist hier die ganze Zusage: die Zusammenfuehrung
     * zieht Zertifikate, Beschaeftigungen und Zugaenge zusammen und ist nicht
     * rueckgaengig zu machen — sie darf nicht dasselbe Recht tragen wie eine
     * korrigierte Personalnummer. Mandant, Zyklusfreiheit und Protokoll
     * prueft `app.person_zusammenfuehren` (0194) ein zweites Mal; der
     * Dublettenzeiger ist fuer `cse_app` nicht schreibbar.
     */
    pfad: 'api/personal/zusammenfuehren',
    recht: 'personal.zusammenfuehren',
  },
  /**
   * Der Freigabe-Posteingang (PR 62 Rest, APR-01/02/03/07/08, D-472).
   *
   * Zwei Leser, ein Schreiber. Das Lesen der Pruefansicht VERMERKT das
   * Oeffnen (eine anfuegende Zeile in `freigabe_ansicht`) — das ist Teil des
   * Lesens, kein Schreibrecht: ohne den Vermerk gibt es keine Pruefdauer,
   * und ohne Pruefdauer keine Entscheidung (APR-08). Die Entscheidung selbst
   * traegt das Recht der Handlung, nicht das der Domaene, aus der der
   * Vorschlag stammt.
   */
  { pfad: 'api/freigaben', recht: 'freigabe.lesen' },
  { pfad: 'api/freigaben/[id]', recht: 'freigabe.lesen' },
  { pfad: 'api/freigaben/[id]/entscheidung', recht: 'freigabe.entscheiden' },
  /**
   * Das Social Media Center (PR 78, SOC-01…SOC-08).
   *
   * **Vier Routen, zwei Rechte — und die Grenze liegt nicht beim Aufwand,
   * sondern bei der Oeffentlichkeit.** Anlegen und Bearbeiten aendern einen
   * Entwurf, den ausser der Redaktion niemand sieht: `social.schreiben`.
   * Planen und Veroeffentlichen bringen denselben Text nach draussen, wo
   * ihn niemand zurueckholt: `social.planen`. Wer schreiben darf, darf
   * damit nicht schon senden — dieselbe Trennung wie zwischen Entscheiden
   * und Stapel-Entscheiden darueber.
   *
   * `schritt` traegt beides: die Route waehlt je Schritt und prueft das
   * genaue Recht selbst. Hier steht das SCHWAECHERE als Torpruefung; ein
   * Vorlegen soll nicht am Planungsrecht scheitern.
   *
   * Freigeben und Ablehnen stehen NICHT hier: sie fallen im
   * Freigabe-Posteingang (`freigabe.entscheiden`), und der Beitrag folgt
   * seiner Freigabe ueber den Trigger aus `0163`. Ein zweiter Weg zur
   * selben Entscheidung waere einer zu viel (SOC-08).
   */
  { pfad: 'api/social/beitraege', recht: 'social.schreiben' },
  { pfad: 'api/social/beitraege/[id]', recht: 'social.schreiben' },
  { pfad: 'api/social/beitraege/[id]/schritt', recht: 'social.schreiben' },
  { pfad: 'api/social/beitraege/[id]/planung', recht: 'social.planen' },
  /**
   * Recruiting (REC-02, REC-05, REC-08, REC-09) — vier schreibende Routen,
   * vier verschiedene Rechte. Die Trennung ist der Inhalt: eine Stelle
   * ausschreiben, sie hinausgeben, eine Bewerbung bewerten und über einen
   * Menschen entscheiden sind vier Vorgänge, und wer den einen darf, darf
   * dadurch nicht die anderen.
   *
   * `…/entscheidung` trägt zusätzlich einen Riegel, den kein Recht ersetzt:
   * der Auslöser `kern.entscheidung_ist_menschlich` (0166) weist jede Zeile
   * ab, deren Akteur kein Mensch ist (Art. 22 DSGVO).
   */
  { pfad: 'api/recruiting/stellen', recht: 'recruiting.stelle_schreiben' },
  /**
   * **Vorlegen ist BITTEN, nicht entscheiden.**
   *
   * Wer die Anzeige schreibt, darf um ihre Freigabe bitten — deshalb
   * `stelle_schreiben` und nicht `stelle_veroeffentlichen`. Entschieden wird
   * im Freigabe-Posteingang, und die Zeile dort trägt
   * `erforderliches_recht = 'recruiting.stelle_veroeffentlichen'`; der Riegel
   * `stelle_braucht_genehmigung` (0167) laesst ohne diese Entscheidung keinen
   * Statuswechsel zu. Zwei Wege zu derselben Entscheidung waeren einer zu
   * viel (Invariante 7).
   */
  { pfad: 'api/recruiting/stellen/[id]/freigabe', recht: 'recruiting.stelle_schreiben' },
  {
    pfad: 'api/recruiting/stellen/[id]/veroeffentlichen',
    recht: 'recruiting.stelle_veroeffentlichen',
  },
  /**
   * **Ein Gespraech ist ein Kalendertermin — und ein Blick in eine Bewerbung.**
   *
   * Das Manifest fuehrt EIN Recht je Route; hier steht das engere der beiden,
   * `bewerbung_lesen`, weil die Route zu genau dieser Bewerbung schreibt. Das
   * zweite, `kalender.schreiben`, bewacht den BILDSCHIRM
   * (`/recruiting/gespraeche`, Seitenkarte) und damit das Formular: wer es
   * nicht haelt, sieht es nicht.
   */
  { pfad: 'api/recruiting/gespraeche', recht: 'recruiting.bewerbung_lesen' },
  {
    pfad: 'api/recruiting/bewerbungen/[id]/bewertung',
    recht: 'recruiting.bewerbung_bewerten',
  },
  {
    pfad: 'api/recruiting/bewerbungen/[id]/entscheidung',
    recht: 'recruiting.entscheiden',
  },
] as const;

/** Die Routen, die ein Recht verlangen. */
export const GESCHUETZTE_ROUTEN: readonly RouteEintrag[] =
  ROUTEN.filter((r) => r.recht !== null);
