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
] as const;

/** Die Routen, die ein Recht verlangen. */
export const GESCHUETZTE_ROUTEN: readonly RouteEintrag[] =
  ROUTEN.filter((r) => r.recht !== null);
