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
] as const;

/** Die Routen, die ein Recht verlangen. */
export const GESCHUETZTE_ROUTEN: readonly RouteEintrag[] =
  ROUTEN.filter((r) => r.recht !== null);
