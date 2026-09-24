/**
 * Das Dienstregister — welcher Dienst schreibt, und in welchem Modul.
 *
 * Es existiert für die Zusage von PR 8: **in der Gruppenansicht führt kein
 * Schreibpfad**. Diese Zusage über eine Liste zu prüfen, die jemand pflegt,
 * wäre eine Erinnerung; über ein Register geprüft ist sie eine Eigenschaft.
 * Der Test iteriert dieses Register, also ist ein Modul, das in Phase 5 landet,
 * automatisch mitgeprüft — vorausgesetzt, es trägt sich hier ein, und genau
 * das erzwingt der Gegentest (jeder Dienst unter `services/` steht im
 * Register).
 */

export interface DienstEintrag {
  /** Der Modulname aus §7.4 — Basis des Rechteschlüssels. */
  readonly modul: string;
  /** Der Dateipfad unter `src/server/services/`, ohne Endung. */
  readonly pfad: string;
  /** Schreibt dieser Dienst? Nur-Lese-Dienste dürfen in der Gruppenansicht laufen. */
  readonly schreibend: boolean;
  /** Der Rechteschlüssel, den der Schreibpfad verlangt. */
  readonly schreibRecht?: string;
}

export const DIENSTE: readonly DienstEintrag[] = [
  /**
   * **Die Buchhaltung (PR 58, ACC-01).** `kontenrahmen` und `kontierung`
   * lesen; `periode` und `buchungssatz` schreiben — und sie schreiben als
   * Folge einer Festschreibung, nicht als eigene Handlung. Ihr Schreibrecht
   * ist deshalb `finanzen.schreiben` und nicht `buchhaltung.schreiben`
   * (D-427): wer eine Rechnung festschreibt, wird dadurch nicht Buchhalter.
   */
  /*
   * Der Vergaberadar (RAD-01 … RAD-07, D-489, D-490). Lesend bis auf
   * `radar/vorgang`, das den Stand setzt (RAD-07): die
   * Bekanntmachungen schreibt der Nachtlauf als `cse_job`, und `bewertung`
   * hat fuer `cse_app` gar kein Schreibrecht — eine Punktzahl von Hand waere
   * das Ende von RAD-05.
   */
  { modul: 'radar', pfad: 'radar/bewertung', schreibend: false },
  { modul: 'radar', pfad: 'radar/gewichte.platzhalter', schreibend: false },
  { modul: 'radar', pfad: 'radar/import', schreibend: false },
  { modul: 'radar', pfad: 'radar/lauf', schreibend: false },
  { modul: 'radar', pfad: 'radar/ocds', schreibend: false },
  { modul: 'radar', pfad: 'radar/quelle', schreibend: false },
  { modul: 'radar', pfad: 'radar/ted', schreibend: false },
  /**
   * **Die beiden Waechter (PR 71).** `benachrichtigung` definiert nur die zwei
   * Arten; `warnung` schreibt die Quittung und stellt zu — und zwar als JOB,
   * nicht als Handlung eines Menschen. Das Schreibrecht ist deshalb keines aus
   * dem Katalog: `cse_job` traegt die Policy, `cse_app` hat auf
   * `radar_warnung` nur Lesen.
   */
  { modul: 'radar', pfad: 'radar/benachrichtigung', schreibend: false },
  { modul: 'radar', pfad: 'radar/warnung', schreibend: false },
  /**
   * **Die drei fehlenden Wachen aus SPEC §14 (PR 72).** Sie lesen und melden;
   * geschrieben wird nur die Quittung, und die schreibt `cse_job` über seine
   * Policy — kein Recht aus dem Katalog, weil hier kein Mensch handelt.
   */
  { modul: 'dienstplan', pfad: 'waechter/dienstplan', schreibend: false },
  { modul: 'dienstplan', pfad: 'waechter/benachrichtigung', schreibend: false },
  /**
   * **Stapel, Einspruch, Ruecknahme (PR 75, APR-04…APR-06).** Alle drei
   * entscheiden ueber eine Freigabe und tragen deshalb dasselbe Recht wie die
   * Einzelentscheidung; `fenster.platzhalter` haelt nur die zwei offenen
   * Zahlen aus O-108.
   */
  {
    modul: 'freigabe', pfad: 'freigabe/stapel',
    schreibend: true, schreibRecht: 'freigabe.entscheiden',
  },
  { modul: 'freigabe', pfad: 'freigabe/fenster.platzhalter', schreibend: false },
  /**
   * **Die LAGE eines Fensters (APR-05, APR-06)** — eine reine Funktion ueber
   * vier Werten (Entscheidungsstand, Ausfuehrungsstand, Fensterspalte, Uhr),
   * ohne Datenbank und ohne Schreibweg. Geschrieben wird in `freigabe/stapel`;
   * `fenster.platzhalter` darueber haelt die zwei offenen Zahlen aus O-108.
   */
  { modul: 'freigabe', pfad: 'freigabe/fenster', schreibend: false },
  /**
   * **Die Vergabemappe (PR 70, RAD-07, D-07).** `mappe` fuehrt die Pruefliste
   * unter `vergabe.schreiben`; `einreichung` bezeugt die Abgabe und traegt
   * deshalb ein eigenes Recht — wer Formblaetter abhakt, bezeugt damit nicht,
   * dass jemand hochgeladen hat.
   */
  { modul: 'vergabe', pfad: 'vergabe/mappe', schreibend: true, schreibRecht: 'vergabe.schreiben' },
  {
    modul: 'vergabe', pfad: 'vergabe/einreichung',
    schreibend: true, schreibRecht: 'vergabe.einreichung_erfassen',
  },
  {
    modul: 'radar', pfad: 'radar/vorgang',
    schreibend: true, schreibRecht: 'radar.status_setzen',
  },
  /**
   * **Das Suchprofil des Vergaberadars (RAD-04, RAD-05).** Stammdaten,
   * CPV-Zeilen und Benachrichtigungsempfaenger — fuenf Schreibhandlungen
   * hinter EINEM Recht, weil sie ein Profil betreffen. Punkte rechnet es
   * keine: die Bewertung entsteht im Nachtlauf aus `radar/bewertung`.
   */
  {
    modul: 'radar', pfad: 'radar/profil',
    schreibend: true, schreibRecht: 'radar.profil_schreiben',
  },
  { modul: 'buchhaltung', pfad: 'buchhaltung/kontenrahmen', schreibend: false },
  { modul: 'buchhaltung', pfad: 'buchhaltung/kontierung', schreibend: false },
  { modul: 'buchhaltung', pfad: 'buchhaltung/index', schreibend: false },
  {
    modul: 'buchhaltung', pfad: 'buchhaltung/periode',
    schreibend: true, schreibRecht: 'finanzen.schreiben',
  },
  {
    modul: 'buchhaltung', pfad: 'buchhaltung/buchungssatz',
    schreibend: true, schreibRecht: 'finanzen.schreiben',
  },
  /**
   * Der Archivlauf legt das Rechnungs-PDF ab und haengt es an die Buchung
   * (PR 59, ACC-03). `finanzen.schreiben` und nicht ein eigenes Recht: er
   * tut nichts, was die festschreibende Person nicht ohnehin ausgeloest hat
   * — dieselbe Ueberlegung wie D-427 fuer den Buchungssatz selbst. Ein
   * zweites Recht zu verlangen hiesse, dass eine Rechnung ohne ihren Beleg
   * bliebe, weil der naechtliche Lauf es nicht hat.
   */
  {
    modul: 'buchhaltung', pfad: 'buchhaltung/belegarchiv',
    schreibend: true, schreibRecht: 'finanzen.schreiben',
  },
  /**
   * Das Exportpaket LIEST — es paart Buchungszeilen mit ihren Dateien und
   * legt nichts ab. Die Datei selbst schreibt PR 60.
   */
  { modul: 'buchhaltung', pfad: 'buchhaltung/exportpaket', schreibend: false },
  /**
   * Der EXTF-Schreiber und seine Zeichenkodierung sind REINE Funktionen: sie
   * bekommen Cent und Strings und geben Bytes zurueck. Kein Datenbankzugriff,
   * kein Schreibrecht — und genau deshalb sind sie byteweise pruefbar.
   */
  { modul: 'buchhaltung', pfad: 'buchhaltung/datev/extf', schreibend: false },
  { modul: 'buchhaltung', pfad: 'buchhaltung/datev/cp1252', schreibend: false },
  /**
   * Der Exportvorgang legt eine Zeile an und stempelt die Buchungszeilen.
   * `buchhaltung.exportieren` und nicht `finanzen.schreiben`: hier entsteht
   * eine Datei, die das Haus verlaesst — das ist eine andere Handlung als
   * eine Rechnung festzuschreiben.
   */
  {
    modul: 'buchhaltung', pfad: 'buchhaltung/datev/export',
    schreibend: true, schreibRecht: 'buchhaltung.exportieren',
  },
  /**
   * Der Vermerk am Stapel (V-027) — dasselbe Recht wie beim Erzeugen. Er
   * SENDET nichts: es gibt keinen DATEV-Endpunkt (O-05); wer die Datei dem
   * Steuerbuero gibt, ist ein Mensch, und was hier entsteht, ist sein Vermerk
   * darueber.
   */
  {
    modul: 'buchhaltung', pfad: 'buchhaltung/datev/stapel',
    schreibend: true, schreibRecht: 'buchhaltung.exportieren',
  },
  { modul: 'finanzen', pfad: 'finanz/geld', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/steuer/satz', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/hash-chain', schreibend: false },
  {
    modul: 'nummernkreis', pfad: 'finanz/nummernkreis',
    schreibend: true, schreibRecht: 'nummernkreis.ziehen',
  },
  { modul: 'finanzen', pfad: 'finanz/menge', schreibend: false },
  /**
   * Der CAMT.053-Leser und der Abgleich sind REINE Funktionen (PR 61): XML
   * herein, Zeilen hinaus; offene Posten herein, ein VORSCHLAG hinaus. Keine
   * Datenbank, kein Schreibrecht — und genau deshalb laesst sich jede
   * Zuordnungsregel ohne Fixtur pruefen. Was der Vorschlag wird, entscheidet
   * der Dienst darueber; nur ein eindeutiger Treffer darf ohne Menschen
   * gebucht werden (ACC-04).
   */
  { modul: 'zahlung', pfad: 'finanz/bank/camt', schreibend: false },
  { modul: 'zahlung', pfad: 'finanz/bank/abgleich', schreibend: false },
  /**
   * Der Import verbindet beide: er liest, gleicht ab und legt bei einem
   * EINDEUTIGEN Treffer die Zahlung an. `zahlung.schreiben`, denn genau das
   * tut er — wer den Auszug nur ansieht, braucht es nicht (die Policy auf
   * `kontoauszug` liest mit `buchhaltung.lesen`).
   */
  {
    modul: 'zahlung', pfad: 'finanz/bank/import',
    schreibend: true, schreibRecht: 'zahlung.schreiben',
  },
  /**
   * Die Kalkulation LIEST — sie schreibt nichts. Der Preis, den sie
   * ausrechnet, wird erst vom Angebot gespeichert, und das ist der Dienst,
   * der dann sein Schreibrecht nennt. Solange die Rechnung selbst nichts
   * ablegt, gilt sie auch in der Gruppenansicht als unbedenklich.
   */
  { modul: 'objekt', pfad: 'kalkulation/richtzeit', schreibend: false },
  { modul: 'objekt', pfad: 'kalkulation/tarif', schreibend: false },
  { modul: 'objekt', pfad: 'kalkulation/raumbuch', schreibend: false },
  { modul: 'objekt', pfad: 'kalkulation/index', schreibend: false },
  /**
   * Die BESTAETIGUNG schreibt dagegen: sie setzt die Werte, auf denen der
   * Preis ruht, und hebt `ist_platzhalter`. Deshalb nennt sie ihr Recht.
   */
  {
    modul: 'objekt', pfad: 'kalkulation/bestaetigung',
    schreibend: true, schreibRecht: 'kalkulation.schreiben',
  },
  /**
   * Der Angebotsdienst SCHREIBT — und sein Recht ist `angebot.versenden`,
   * nicht `angebot.schreiben`: der Uebergang, der etwas aus dem Haus laesst,
   * ist der, der ein eigenes Recht braucht (Invariante 7).
   */
  {
    modul: 'angebot', pfad: 'angebot/index',
    schreibend: true, schreibRecht: 'angebot.versenden',
  },
  /**
   * Das Angebot VON HAND (V-005) — `angebot.schreiben` und nicht
   * `angebot.versenden`: hier entsteht ein Entwurf ohne Nummer, und er
   * verlaesst das Haus nicht. Zwei von drei Gesellschaften hatten bis dahin
   * gar keinen Entstehungsweg: die Kalkulation rechnet aus Flaechen, und ein
   * Raumbuch gibt es in der Sicherheit und im Bau nicht.
   */
  {
    modul: 'angebot', pfad: 'angebot/von-hand',
    schreibend: true, schreibRecht: 'angebot.schreiben',
  },
  /**
   * Die Berichtigung eines ENTWURFS (V-130, D-626) — dasselbe Recht wie das
   * Anlegen und aus demselben Grund: ein Blatt ohne Nummer, das ausser dem
   * Haus niemand gesehen hat. Die Trennlinie zu `angebot.versenden` ist
   * `versendet_am`, und `ap_unveraenderlich` (0024) haelt sie in der
   * Datenbank.
   */
  {
    modul: 'angebot', pfad: 'angebot/entwurf',
    schreibend: true, schreibRecht: 'angebot.schreiben',
  },
  /**
   * Der Tabellenleser liest nur; der Import SCHREIBT — und zwar zweimal
   * verschieden: die Vorschau legt Zwischenzeilen an, die Uebernahme aendert
   * das lebende Raumbuch. Beide tragen dasselbe Recht, weil beide eine Datei
   * in den Mandanten bringen.
   */
  /**
   * Der PDF-Schreiber ist eine reine Funktion: Text hinein, Bytes heraus. Er
   * legt nichts ab — wer das Ergebnis speichert, tut das ueber `dokument`.
   */
  { modul: 'dokument', pfad: 'dokument/pdf', schreibend: false },
  { modul: 'objekt_import', pfad: 'raumbuch/tabelle', schreibend: false },
  {
    modul: 'objekt_import', pfad: 'raumbuch/import',
    schreibend: true, schreibRecht: 'objekt_import.schreiben',
  },
  /**
   * V-039 — die eigenen Anmeldungen sehen und beenden.
   *
   * **Kein Schreibrecht, und das ist kein Loch.** Die Policy
   * `t_sitzung_eigene_schreiben` deckelt das UPDATE auf `benutzer_id =
   * app.aktueller_benutzer()`; ein Rechteschluessel fuer „die eigene
   * Anmeldung beenden" waere einer, den jede Rolle hielte — also keiner
   * (K-19, §12.4 Selbstzugriff).
   */
  { modul: 'system', pfad: 'konto/sitzungen', schreibend: false },
  /**
   * V-120 — das Modellregister.
   *
   * Die Zeile ist eine RECHTSAUSSAGE und kein Schalter: sie bezeugt, dass
   * ein Mensch hingesehen hat. Deshalb aal2 in der Policy (0381) und
   * deshalb setzt die Datenbank den Zeugen, statt ihn abzufragen.
   */
  {
    modul: 'system', pfad: 'system/modellregister',
    schreibend: true, schreibRecht: 'system.einstellung_verwalten',
  },
  /**
   * V-006 — die Kreditorenstammdaten.
   *
   * `eingang.schreiben` ist dasselbe Recht wie fuer die
   * Eingangsrechnung selbst: wer Rechnungen erfasst, legt den
   * Lieferanten an, von dem sie kommen. Ein eigenes Recht braeuchten
   * genau dieselben Menschen zusaetzlich (K-19).
   */
  {
    modul: 'finanzen', pfad: 'finanz/lieferant',
    schreibend: true, schreibRecht: 'eingang.schreiben',
  },
  /**
   * V-011 — der Schreibweg der Ausgabe.
   *
   * `eingang.schreiben` ist das kleinere der zwei Rechte: erfassen ist
   * Belegarbeit. Freigeben, ablehnen und buchen verlangen
   * `eingang.freigeben`, und die Route prueft das je Handlung — wer eine
   * Quittung eintippen darf, gibt sie nicht schon deshalb frei.
   */
  {
    modul: 'finanzen', pfad: 'finanz/ausgabe-schreiben',
    schreibend: true, schreibRecht: 'eingang.schreiben',
  },
  /**
   * V-022, V-074, V-075, V-076 — ein Konto zuruecknehmen.
   *
   * **Das Schreibrecht ist `system.benutzer_verwalten` und deckt drei der
   * vier Handlungen.** Der Sitzungswiderruf haengt am kleineren
   * `system.sitzung_widerrufen` (bindbar bis `leitung`): er nimmt ein
   * Plaetzchen aus dem Verkehr, keinen Menschen aus dem Betrieb. Beide
   * Rechte prueft die Datenbank je Funktion selbst (`drizzle/0379`) —
   * das Register nennt hier das groessere, weil es das ist, an dem die
   * Route haengt.
   */
  {
    modul: 'system', pfad: 'konto/verwaltung',
    schreibend: true, schreibRecht: 'system.benutzer_verwalten',
  },
  { modul: 'zeit', pfad: 'zeit/dauer', schreibend: false },
  /**
   * **Was ein `datetime-local`-Feld schickt, wird hier zum Instant.**
   *
   * Die Datei lag als `social/planeingabe` im Social-Modul — an Social war sie
   * nie gebunden, sie stand dort nur, weil die Beitragsplanung sie zuerst
   * brauchte. Der Gesprächstermin (REC-06) braucht dieselbe Umrechnung, und
   * eine zweite Fassung wäre eine zweite Wahrheit über dieselbe Zeitzone.
   * `social/planeingabe` re-exportiert weiter.
   */
  { modul: 'zeit', pfad: 'zeit/formulareingabe', schreibend: false },
  /**
   * V-051 — die Artdefinition der Meldung „Ihre Zeitmeldung wurde …".
   *
   * `schreibend: false`: die Datei baut Titel, Text und Ziel und schreibt
   * nichts. Die Zustellung macht `app.einwand_entscheidung_melden` (0377),
   * aufgerufen aus `zeit/einwand`.
   */
  { modul: 'zeit', pfad: 'zeit/benachrichtigung', schreibend: false },
  { modul: 'zeit', pfad: 'zeit/spalten', schreibend: false },
  /**
   * Der Check-in SCHREIBT — die Marke und den Zeiteintrag. Sein Recht ist
   * `zeit.checkin_verwalten`, weil das die AUSGABE der Marke ist, die ein
   * Mensch mit Rechten ausloest; das Einloesen selbst laeuft ohne Sitzung
   * ueber `cse_checkin` (K-08) und hat deshalb gar kein Recht, an dem es
   * haengen koennte.
   */
  {
    modul: 'zeit', pfad: 'zeit/checkin',
    schreibend: true, schreibRecht: 'zeit.checkin_verwalten',
  },
  /**
   * Die Korrektur praegt eine neue Fassung und ihre Spur (TIM-11). In der
   * Gruppenansicht laeuft sie nicht: Invariante 10, und ohne genau einen
   * aktiven Mandanten waere jede `WITH CHECK` ohnehin falsch.
   */
  /**
   * V-064 — was die Verwaltung mit einem LAUFENDEN Eintrag darf.
   *
   * `zeit.korrigieren` wie bei `zeit/korrektur` daneben: es ist derselbe
   * Vorgang in einer frueheren Phase. Wer Zeiten nur ERFASST
   * (`zeit.schreiben`), setzt damit noch keine fremde Arbeitszeit fest.
   */
  {
    modul: 'zeit', pfad: 'zeit/laufender-eintrag',
    schreibend: true, schreibRecht: 'zeit.korrigieren',
  },
  /**
   * V-066/V-067 — eine Arbeitszeit eintragen, zu der es KEIN Geraetereignis
   * gibt. `zeit.nacherfassung_pruefen` ist die Entscheidung (TIM-09); den
   * Schreibzugriff verlangt die Policy `t_mandant` ohnehin als
   * `zeit.schreiben`.
   */
  {
    modul: 'zeit', pfad: 'zeit/nacherfassung',
    schreibend: true, schreibRecht: 'zeit.nacherfassung_pruefen',
  },
  {
    modul: 'zeit', pfad: 'zeit/korrektur',
    schreibend: true, schreibRecht: 'zeit.korrigieren',
  },
  /**
   * „Aktuell im Einsatz" ZAEHLT nur (DSH-05) — in der Gruppenansicht ist
   * daran nichts gefaehrlich, und schreiben kann es nicht.
   */
  /*
   * `zeit/live` ist am 23.09.2026 ENTFALLEN (V-072).
   *
   * Der Dienst bildete `zeiteintrag_offen` ein drittes Mal ab — die Sicht
   * selbst ist die eine Wahrheit, `/zeiten/live` liest sie ueber
   * `ladeLaufende`, und die Dashboard-Kachel liest sie ueber das
   * Kennzahlenregister, das SQL nimmt und keine Funktion. Gebaut war er fuer
   * genau diese Kachel und von ihr nie aufrufbar; einen Aufrufer hatte er in
   * zwei Jahren nicht. Was bleibt, ist eine Frage mit einer Antwort statt
   * dreier Wege zu ihr.
   */
  /**
   * Die Offline-Warteschlange (TIM-09). Sie SCHREIBT — die nachgereichte
   * Behauptung und, wenn ein Mensch entscheidet, den Zeiteintrag samt
   * Korrekturzeile.
   *
   * Das Recht ist `zeit.nacherfassung_pruefen` und nicht `zeit.schreiben`: der
   * Schreibweg, den dieser Dienst wirklich bewacht, ist die ENTSCHEIDUNG ueber
   * einen fremden Anspruch. Die Aufnahme selbst laeuft ohne Sitzung ueber
   * `cse_checkin` (K-08) und hat deshalb gar kein Recht, an dem sie haengen
   * koennte — genau wie das Einloesen der Check-in-Marke.
   */
  {
    modul: 'zeit', pfad: 'zeit/offline',
    schreibend: true, schreibRecht: 'zeit.nacherfassung_pruefen',
  },
  /**
   * Die Medienerfassung PRUEFT, LEGT AB — und legt seit 0303 auch die ZEILE
   * an. Der Satz, der frueher hier stand („er kann keine Zeile anlegen"),
   * stimmt nicht mehr: `legeSchichtMediumAb` nimmt einen `SchreibKontext` und
   * schreibt selbst in `einsatz_medien`. Der Weg ueber die Marke
   * (`app.offline_ereignis_annehmen`) bleibt daneben bestehen.
   *
   * Das Recht ist `zeit.schreiben` — der Schluessel, den `t_mandant` auf
   * `einsatz_medien` in seiner WITH-CHECK-Haelfte verlangt, also der Weg des
   * BUEROS. Der Weg der Kraft laeuft ueber `t_selbst_schichtmedien` (0303) und
   * traegt bewusst gar kein Recht (K-19, Selbstzugriff), genau wie bei
   * `abwesenheit/antrag`, wo ebenfalls das staerkere Buerorecht hier steht.
   * `zeit.schreiben` haengt an super_admin/admin/leitung und nicht an
   * `mitarbeiter`; die Gruppenansichtsprobe bleibt damit gruen.
   */
  { modul: 'zeit', pfad: 'zeit/medien', schreibend: true, schreibRecht: 'zeit.schreiben' },
  /**
   * Der Monatsanteil RECHNET nur (§7.3): er liest die Sicht und verteilt die
   * Pause. Geteilt wird nichts — der Zeiteintrag bleibt eine Zeile.
   */
  { modul: 'zeit', pfad: 'zeit/monatsanteil', schreibend: false },
  /**
   * Zeit → Auftrag ist eine Aufloesung, kein Uebertrag (TIM-12). Sie liest
   * zwei Sichten und darf deshalb auch in der Gruppenansicht laufen.
   */
  { modul: 'zeit', pfad: 'zeit/auftrag', schreibend: false },
  /**
   * Die § 17-Aufzeichnung SCHREIBT — aber nur das Artefakt eines gesperrten
   * Monats, und nur einmal (§7.3).
   *
   * `zeit.schreiben` und nicht `zeit.exportieren`, obwohl das Praegen beim
   * Ausgeben passiert: K-03 nennt in jeder `WITH CHECK` `<modul>.schreiben`,
   * und die Policy auf `zeitnachweis` haelt sich daran. Zwei verschiedene
   * Schluessel — einer im Register, einer in der Datenbank — waeren ein
   * Dienst, dessen erklaertes Recht ihn nicht schreiben laesst: der Bildschirm
   * bliebe leer, und niemand suchte den Grund in der Policy. Das Tor, das die
   * AUSGABE begrenzt, sitzt an der Route `/portal/[mandant]/zeiten/milog` und
   * heisst dort `zeit.exportieren` (ACC-12).
   */
  {
    modul: 'zeit', pfad: 'zeit/milog',
    schreibend: true, schreibRecht: 'zeit.schreiben',
  },
  /**
   * Der Einwand hat ZWEI Schreibwege mit verschiedenen Wachen: das Einreichen
   * ist Selbstzugriff (EMP-07 fuehrt es als `S`, es gibt kein Modulrecht
   * dafuer), das Entscheiden verlangt `zeit.einwand_entscheiden`. Genannt ist
   * hier das Recht des GEFAEHRLICHEREN Weges — wer ueber den Lohn eines
   * anderen befindet, braucht ein Recht; wer die eigene Abweichung meldet,
   * nicht.
   */
  {
    modul: 'zeit', pfad: 'zeit/einwand',
    schreibend: true, schreibRecht: 'zeit.einwand_entscheiden',
  },
  /**
   * Die Sollzeitregel LIEST nichts und schreibt nichts — sie antwortet, oder
   * sie verweigert die Antwort (O-18). Ein Dienst ohne Datenbank, damit die
   * offene Frage an EINER Stelle sitzt statt in dreissig Formeln.
   */
  { modul: 'zeit', pfad: 'zeit/sollstunden', schreibend: false },
  /**
   * Das Stundenkonto SCHREIBT — und genannt ist das Recht des
   * GEFAEHRLICHSTEN Weges: `zeit.konto_abschliessen`. Buchen darf, wer
   * `zeit.schreiben` haelt; einen Monat unumkehrbar zu sperren ist eine
   * eigene Entscheidung mit eigenem Recht, und eine Korrektur in einen
   * gesperrten Monat verlangt zusaetzlich `zeit.konto_korrigieren`. Alle drei
   * stehen in der Policy von 0060, nicht nur in diesem Register.
   */
  {
    modul: 'zeit', pfad: 'zeit/stundenkonto',
    schreibend: true, schreibRecht: 'zeit.konto_abschliessen',
  },
  /**
   * Das Urlaubskonto SCHREIBT den eingetragenen Anspruch — die abgeleiteten
   * Tage schreibt niemand von Hand (0061, PR 38).
   */
  {
    modul: 'zeit', pfad: 'zeit/urlaubskonto',
    schreibend: true, schreibRecht: 'zeit.schreiben',
  },
  { modul: 'dienstplan', pfad: 'zeit/arbzg', schreibend: false },
  /**
   * Die Pruefung ueber Gesellschaftsgrenzen (K-06). Sie SCHREIBT, wenn der
   * Aufrufer es verlangt — aber nie selbst in `arbeitszeit_verstoss`: das tut
   * ausschliesslich `app.arbzg_befund_schreiben`, weil ein Befund ueber zwei
   * Gesellschaften in beiden stehen muss.
   */
  {
    modul: 'dienstplan', pfad: 'arbzg/pruefung',
    schreibend: true, schreibRecht: 'dienstplan.arbzg_pruefen',
  },
  /**
   * Der naechtliche Detektor. Er schreibt `planungs_konflikt` — in der
   * Gruppenansicht laeuft er darum nicht (Invariante 10); er laeuft ohnehin
   * als `cse_job` je Mandant.
   */
  {
    modul: 'dienstplan', pfad: 'arbzg/detektor',
    schreibend: true, schreibRecht: 'dienstplan.arbzg_pruefen',
  },
  /**
   * Abwesenheiten und Antraege (PR 38). Genannt ist je Weg das Recht des
   * GEFAEHRLICHSTEN Zugriffs: wer eine Abwesenheit entscheidet, entscheidet
   * ueber Lohnfortzahlung und Urlaubskonto, und wer einen Antrag entscheidet,
   * ueber die Freizeit eines Menschen. Der GRUND einer Abwesenheit haengt
   * daneben an `zeit.abwesenheit_grund_lesen` und kommt nur durch die
   * Definer-Funktion (Art. 9 DSGVO).
   */
  {
    modul: 'zeit', pfad: 'abwesenheit/index',
    schreibend: true, schreibRecht: 'zeit.abwesenheit_genehmigen',
  },
  {
    modul: 'zeit', pfad: 'abwesenheit/antrag',
    schreibend: true, schreibRecht: 'zeit.antrag_entscheiden',
  },
  /** Die Tagesrechnung kennt keine Datenbank — sie rechnet Kalendertage. */
  { modul: 'zeit', pfad: 'abwesenheit/tage', schreibend: false },
  /**
   * Die Einteilung SCHREIBT `einsatz_zuordnung` — und ist der einzige Weg
   * dorthin. Genannt ist `dienstplan.schreiben`; die beiden Tore, die sie
   * durchlaeuft, haben ihre eigenen Rechte an ihren eigenen Diensten
   * (`nachweis/tor`, `arbzg/pruefung`).
   */
  {
    modul: 'dienstplan', pfad: 'dienstplan/einteilung',
    schreibend: true, schreibRecht: 'dienstplan.schreiben',
  },
  /**
   * Die Vorkommnisrechnung kennt keine Datenbank — sie sagt nur, WELCHE
   * Schichten eine Serie im Fenster verlangt.
   */
  { modul: 'dienstplan', pfad: 'dienstplan/vorkommnisse', schreibend: false },
  /**
   * Die Spurenrechnung des Wochenrasters. Sie rechnet nur, wo ein Block
   * steht — kein Zugriff, kein Schreiben.
   */
  { modul: 'dienstplan', pfad: 'dienstplan/wochenraster', schreibend: false },
  /**
   * Der Materialisierer schreibt: er legt `einsatz`-Zeilen an, aktualisiert
   * sie und storniert verwaiste. In der Gruppenansicht laeuft er darum nicht
   * (Invariante 10) — er laeuft ohnehin als `cse_job` je Mandant.
   */
  {
    modul: 'dienstplan', pfad: 'dienstplan/generator',
    schreibend: true, schreibRecht: 'dienstplan.schreiben',
  },
  { modul: 'dokument', pfad: 'dokument/kategorie', schreibend: false },
  {
    modul: 'dokument', pfad: 'dokument/upload',
    schreibend: true, schreibRecht: 'dokument.schreiben',
  },
  /**
   * Die Ablage fuer Dateien, die die PLATTFORM erzeugt (PR 60). Sie ist die
   * SCHWESTER von `dokument/upload` und nicht sein Ersatz: der Upload prueft
   * Magic Bytes und entfernt Metadaten, weil dort Inhalt ankommt, den ein
   * Mensch mitbringt. Hier stammen die Bytes aus dieser Codebasis.
   *
   * `dokument.schreiben`, dieselbe Schranke wie beim Upload: wer keine
   * Dokumente ablegen darf, legt auch keine erzeugten ab.
   */
  {
    modul: 'dokument', pfad: 'dokument/erzeugt',
    schreibend: true, schreibRecht: 'dokument.schreiben',
  },
  { modul: 'referenz', pfad: 'inhalt/seite', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/nap', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/routen', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/referenz', schreibend: false },
  // Die oeffentliche Galerie (0170): liest `medien` mit einem `galerie_rang`
  // und nichts sonst. Lesend — kuratiert wird in der Website-Redaktion.
  { modul: 'referenz', pfad: 'inhalt/galerie', schreibend: false },
  // Die Website-Redaktion (§5.21): sie schreibt in seite, abschnitt, medien
  // und referenz — alle vier Policies verlangen dasselbe Recht.
  {
    modul: 'referenz', pfad: 'inhalt/redaktion',
    schreibend: true, schreibRecht: 'referenz.schreiben',
  },
  // Die Anfrageformulare (§5.21, REQ-01 … REQ-04). Eigener Dienst und nicht
  // Teil von `inhalt/redaktion`: `formular_definition` haengt an
  // `formular.schreiben` statt an `referenz.schreiben`, ist in ihren FELDERN
  // nach dem Veroeffentlichen eingefroren und wird nie an ihrem Platz
  // geaendert, sondern als Version + 1 angelegt.
  {
    modul: 'formular', pfad: 'inhalt/formular',
    schreibend: true, schreibRecht: 'formular.schreiben',
  },
  {
    modul: 'referenz', pfad: 'inhalt/import',
    schreibend: true, schreibRecht: 'referenz.schreiben',
  },
  // SEO-Oberflächen. Sie lesen veröffentlichte Zeilen und sonst nichts —
  // in der Gruppenansicht ist daran nichts gefährlich.
  { modul: 'referenz', pfad: 'inhalt/jsonld', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/sitemap', schreibend: false },
  { modul: 'referenz', pfad: 'inhalt/llms', schreibend: false },
  // Lead und Formular. Die Annahme SCHREIBT — sie ist der einzige Dienst
  // dieser Domäne, den ein anonymer Aufrufer auslöst.
  { modul: 'crm', pfad: 'lead/sla', schreibend: false },
  {
    modul: 'formular', pfad: 'lead/annahme',
    schreibend: true, schreibRecht: 'formular.schreiben',
  },
  {
    modul: 'crm', pfad: 'lead/eskalation',
    schreibend: true, schreibRecht: 'crm.schreiben',
  },
  {
    modul: 'versand', pfad: 'lead/bestaetigung',
    schreibend: true, schreibRecht: 'crm.kommunikation_versenden',
  },
  { modul: 'crm', pfad: 'lead/benachrichtigung', schreibend: false },
  /* V-137: eine Einsendung, gegen die Felder ihrer Version lesbar gemacht — rein. */
  { modul: 'crm', pfad: 'lead/einsendung', schreibend: false },
  /*
   * Kunde, Kontakt und Lead von Hand anlegen (CRM-01, CRM-03, CRM-07). Ein
   * eigener Dienst und nicht ein Zweig in `lead/annahme`: die Annahme ist der
   * ANONYME Weg mit Honigtopf, Ratenlimit und einem Prinzipal ohne Leserecht.
   * Dieselbe Funktion fuer beides hiesse, dass jede Aenderung am einen Weg den
   * anderen mitveraendert — und einer der beiden ist oeffentlich erreichbar.
   */
  {
    modul: 'crm', pfad: 'crm/anlegen',
    schreibend: true, schreibRecht: 'crm.schreiben',
  },
  /*
   * Kunde und Ansprechpartner AENDERN (V-017, V-018, V-019). Eigene Datei und
   * nicht ein Zweig in `crm/anlegen`: sie fasst vier Spalten mit Absicht NICHT
   * an — `debitorennummer`, `zahlungsziel_tage`, `mahnsperre_bis`,
   * `mahnsperre_grund`. `cse_app` darf sie schreiben, aber nicht LESEN (K-05);
   * ein Formular, das den ganzen Datensatz zurueckschreibt, ueberschriebe sie
   * mit null — eine geloeschte Mahnsperre ist eine Mahnung an einen Kunden,
   * mit dem gerade verhandelt wird. Wer sie aendern will, geht ueber
   * `crm/kondition` und braucht `crm_entgelt.lesen` dazu.
   */
  {
    modul: 'crm', pfad: 'crm/aendern',
    schreibend: true, schreibRecht: 'crm.schreiben',
  },
  /**
   * Die Nachricht an einen Kontakt (V-101, CRM-08, D-627) — der erste
   * Aufrufer von `sendeNachAussen`. `crm.kommunikation_versenden` stand seit
   * 0008 im Katalog und wurde bis hierher von keiner Route benutzt. Der Dienst
   * schreibt die benannte Freigabe des Verfassers und — sobald ein Versender
   * verbunden ist — die Nachricht; ohne Versender schreibt er NICHTS.
   */
  {
    modul: 'crm', pfad: 'crm/nachricht-an-kontakt',
    schreibend: true, schreibRecht: 'crm.kommunikation_versenden',
  },
  /*
   * Die Zahlungskonditionen (CRM-01, FIN-15, K-05). Schreibrecht ist
   * `crm.schreiben` — der Dienst verlangt ZUSAETZLICH `crm_entgelt.lesen`,
   * weil die vier Spalten `cse_app` spaltenweise entzogen sind: wer sie nicht
   * sehen darf, darf sie nicht blind ersetzen.
   */
  {
    modul: 'crm', pfad: 'crm/kondition',
    schreibend: true, schreibRecht: 'crm.schreiben',
  },
  /*
   * Der Rechtsgrundlagen-Block eines Ansprechpartners (CRM-03, CRM-08,
   * LEG-08). Gelesen ueber die Definer aus 0247, geschrieben mit
   * `crm.rechtsgrundlage_setzen` UND `crm.schreiben` (die WITH-CHECK-Klausel
   * von `t_mandant` verlangt das zweite). Das Register fuehrt EIN Recht je
   * Zeile; hier steht das engere.
   */
  {
    modul: 'crm', pfad: 'crm/kontakt-grundlage',
    schreibend: true, schreibRecht: 'crm.rechtsgrundlage_setzen',
  },
  /*
   * Die Matrix des § 7 UWG (O-660). Rein — ohne Datenbank, ohne Uhr. Sie ist
   * NICHT das Tor; das Tor ist `app.darf_kontaktiert_werden`. Laeuft deshalb
   * auch in der Gruppenansicht.
   */
  { modul: 'crm', pfad: 'crm/uwg-matrix', schreibend: false },
  /*
   * Der Kundenzugang (AUT-01, DOC-04). `cse_app` hat auf `benutzer` nur
   * SELECT; geschrieben wird ueber die vier SECURITY-DEFINER aus 0249, die
   * `system.benutzer_verwalten` selbst noch einmal pruefen.
   */
  {
    modul: 'crm', pfad: 'crm/kundenzugang',
    schreibend: true, schreibRecht: 'system.benutzer_verwalten',
  },
  /**
   * **Die Einladung eines Verwaltungskontos (AUT-04, D-610, 0372).** Die
   * Schwester von `crm/kundenzugang` — dieselbe Kette aus
   * `kern.kennwort_token`, derselbe einmalige Klartext, dieselbe
   * Definer-Funktion, die das Recht noch einmal prueft. Der Unterschied ist
   * das Recht: `system.verwaltungskonto_erstellen` ist `nur_global` und
   * damit dem Super-Admin vorbehalten, waehrend `system.benutzer_verwalten`
   * bei der Gesellschaft bleibt.
   */
  {
    modul: 'system', pfad: 'system/verwaltungskonto',
    schreibend: true, schreibRecht: 'system.verwaltungskonto_erstellen',
  },
  /*
   * Wiedervorlagen (CRM-04). Schreibt in `lead_aktivitaet` und spiegelt nach
   * `aufgabe` und `kalender_eintrag`, soweit `aufgabe.schreiben` und
   * `kalender.schreiben` reichen — was fehlt, wird benannt (O-663).
   */
  {
    modul: 'crm', pfad: 'crm/wiedervorlage',
    schreibend: true, schreibRecht: 'crm.schreiben',
  },
  /*
   * Der Versandstand eines Kaeufers (FIN-11, LEG-05, 07-INTEGRATIONEN §12.1).
   * Ein reines Praedikat: ein Pflichtkaeufer ohne Uebertragungsweg SPERRT, er
   * faellt nicht auf E-Mail zurueck. Kein Kanal gilt hier als verbunden, ohne
   * dass die Umgebung es sagt.
   */
  { modul: 'crm', pfad: 'crm/erechnung', schreibend: false },
  /*
   * Die Akquise (§12). Sie gehört zum Modul `crm` und nicht zu einem eigenen:
   * ein recherchiertes Ziel ist eine Vorstufe des Leads, und wer Leads sehen
   * darf, soll auch sehen, woher der nächste kommt. Ein eigener
   * Rechteschlüssel hätte bedeutet, dass eine Vertriebsleitung ihre eigene
   * Pipeline nur halb sieht.
   *
   * `bewertung`, `gewichte.platzhalter` und `entwurf` RECHNEN und FORMULIEREN,
   * sie schreiben nichts — sie laufen deshalb auch in der Gruppenansicht.
   * `quelle` schreibt die Laufprotokolle, `ziel` die Liste, `uebernahme` den
   * Lead.
   */
  { modul: 'crm', pfad: 'akquise/bewertung', schreibend: false },
  { modul: 'crm', pfad: 'akquise/gewichte.platzhalter', schreibend: false },
  { modul: 'crm', pfad: 'akquise/entwurf', schreibend: false },
  /*
   * `quelle` liest nur. Der Lauf, der `akquise_lauf` schreibt, steht in
   * `server/jobs/akquise.ts` — `cse_app` hat auf dieser Tabelle gar kein
   * INSERT (0172). Eine Recherche ist ein Nachtlauf und kein Knopf.
   */
  { modul: 'crm', pfad: 'akquise/quelle', schreibend: false },
  {
    modul: 'crm', pfad: 'akquise/ziel',
    schreibend: true, schreibRecht: 'crm.schreiben',
  },
  {
    modul: 'crm', pfad: 'akquise/uebernahme',
    schreibend: true, schreibRecht: 'crm.schreiben',
  },
  // Kennzahlen. Sie ZÄHLEN — in der Gruppenansicht ist daran nichts
  // gefährlich, und schreiben können sie nicht.
  { modul: 'bericht', pfad: 'bericht/kacheln', schreibend: false },
  { modul: 'bericht', pfad: 'bericht/dashboard', schreibend: false },
  /**
   * Nachweise und Qualifikationen (PR 31, SEC-02/03/04, LEG-04, EMP-08).
   *
   * Modul `personal` und nicht `nachweis`: das Modul `nachweis` gehört dem
   * LEISTUNGSNACHWEIS (03-GEWERKE §1.7), also dem unterschriebenen
   * Leistungsbeleg. Die Zertifikate eines Menschen hängen unter
   * `personal.nachweis_*`. Zwei Dinge unter einem Modulnamen wären ein Recht,
   * das jemand für das eine erteilt und das für das andere gilt.
   */
  { modul: 'personal', pfad: 'nachweis/gueltigkeit', schreibend: false },
  { modul: 'personal', pfad: 'nachweis/uebersicht', schreibend: false },
  { modul: 'personal', pfad: 'nachweis/benachrichtigung', schreibend: false },
  /**
   * Das SEC-04-Tor LIEST — es entscheidet, es schreibt nicht. Geschrieben wird
   * die `einsatz_zuordnung`, und das ist der Dienstplandienst, der sein
   * eigenes Recht nennt. Auch in der Gruppenansicht ist an einer Prüfung
   * nichts gefährlich: sie kann nichts ändern.
   */
  { modul: 'security', pfad: 'nachweis/tor', schreibend: false },
  /**
   * Der Ablaufwächter dagegen SCHREIBT: er quittiert je Stufe genau einmal in
   * `nachweis_warnung`, und ohne diese Quittung gäbe es die Zusage nicht.
   */
  {
    modul: 'personal', pfad: 'nachweis/ablauf',
    schreibend: true, schreibRecht: 'personal.nachweis_verwalten',
  },
  /**
   * Der Postendienst SCHREIBT — er legt Posten an — und trägt deshalb
   * `security.schreiben`. Seine Lesehälfte (die Dringlichkeitsabfrage und das
   * Tor vor der Veröffentlichung) ist in der Gruppenansicht ungefährlich; das
   * Register kennt aber einen Eintrag je Datei, und die Datei schreibt.
   */
  {
    modul: 'security', pfad: 'security/posten',
    schreibend: true, schreibRecht: 'security.schreiben',
  },
  /**
   * Das Wachbuch schreibt mit `wachbuch.schreiben` — dem einen Schreibrecht,
   * das die Rolle `mitarbeiter` in dieser Domäne tatsächlich hält (SEC-05: die
   * Wache führt das Buch). Gelesen wird mit `wachbuch.lesen`, im eigenen
   * Portal über `t_person` ganz ohne Modulrecht (K-18).
   */
  {
    modul: 'wachbuch', pfad: 'security/wachbuch',
    schreibend: true, schreibRecht: 'wachbuch.schreiben',
  },
  /**
   * Die Eventbesetzung trägt `dienstplan.schreiben` und NICHT
   * `security.schreiben`: was sie anlegt, ist eine Schicht und eine
   * Einteilung, und beides gehört dem Dienstplan. Ein eigenes „Security darf
   * einteilen"-Recht wäre ein zweiter Schlüssel zu derselben Tür — und der
   * eine, den niemand mitzieht, wenn die Tür enger wird.
   */
  {
    modul: 'dienstplan', pfad: 'security/eventbesetzung',
    schreibend: true, schreibRecht: 'dienstplan.schreiben',
  },
  /**
   * PR 42 — die versionierte Dienstanweisung (SEC-06, EMP-09).
   *
   * Genannt ist `dienstanweisung.schreiben`, das Recht des GEFAEHRLICHSTEN
   * Zugriffs dieser Datei: wer eine Fassung veroeffentlicht, verpflichtet
   * jede Wache des Objekts, sie zu lesen. Die Kenntnisnahme liegt in derselben
   * Datei und traegt ausdruecklich KEIN Modulrecht — die Rolle `mitarbeiter`
   * haelt `dienstanweisung.schreiben` nicht, und K-19 verbietet, dafuer einen
   * zweiten Schluessel zu erfinden. Sie laeuft ueber die INSERT-Policy
   * `t_selbst_bestaetigen` (0078 §12), die genau Zeilen der eigenen
   * Beschaeftigung zulaesst. Zwei Rechte, eine Datei, und das engere steht
   * hier — dieselbe Regel wie bei `abwesenheit/antrag`.
   */
  {
    modul: 'dienstanweisung', pfad: 'security/dienstanweisung',
    schreibend: true, schreibRecht: 'dienstanweisung.schreiben',
  },
  /**
   * PR 42 — die Schluesselverwaltung (SEC-07).
   *
   * `schluessel.schreiben` ist hier wirklich tragend und nicht bloss
   * symmetrisch: die Rolle `mitarbeiter` HAELT es (03-AUTH §12.3), weil SEC-07
   * die Wache vor Ort quittieren laesst — anders als bei der Dienstanweisung.
   */
  {
    modul: 'schluessel', pfad: 'security/schluessel',
    schreibend: true, schreibRecht: 'schluessel.schreiben',
  },
  /**
   * Bau (PR 43, BAU-01 – BAU-03).
   *
   * Der Parser und die LV-Rechnung LESEN — sie sind reine Arithmetik ohne
   * Datenbankgriff und damit auch in der Gruppenansicht unbedenklich. Der
   * Aufmassdienst SCHREIBT, und sein Recht ist `bau.aufmass_erfassen` und
   * nicht `bau.schreiben`: das ist der eine Bauschluessel, den die Rolle
   * `mitarbeiter` haelt (03-GEWERKE §1.7), und BAU-02 laesst die Kraft vor Ort
   * das Blatt aufnehmen. Die Gegenzeichnung verlangt darueber hinaus
   * `bau.aufmass_freigeben` — geprueft an der Route, weil sie ein zweiter
   * Vorgang ist und nicht ein zweites Schreibrecht desselben.
   */
  /**
   * V-003 — das Bauprojekt selbst. `bau.schreiben` und nicht
   * `bau.aufmass_erfassen`: ein Vorhaben ANLEGEN ist die Handlung der
   * Bauleitung, ein Aufmass aufnehmen die der Kraft vor Ort.
   */
  {
    modul: 'bau', pfad: 'bau/projekt',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  { modul: 'bau', pfad: 'bau/rechenansatz', schreibend: false },
  { modul: 'bau', pfad: 'bau/lv', schreibend: false },
  {
    modul: 'bau', pfad: 'bau/aufmass',
    schreibend: true, schreibRecht: 'bau.aufmass_erfassen',
  },
  /**
   * PR 44 — Nachtrag, Behinderungsanzeige, Warnung ausserhalb des LV.
   *
   * `bau/ausserhalb-lv` LIEST: es vergleicht erfasste Zeit und Aufmass gegen
   * das Leistungsverzeichnis und meldet, was dort nicht steht. Ein Dienst, der
   * nur warnt, darf in der Gruppenansicht laufen — er aendert nichts.
   *
   * `bau/nachtrag` traegt `bau.nachtrag_anmelden` und nicht
   * `bau.nachtrag_einreichen`: der Anmeldung folgt die Einreichung als
   * ZWEITER Vorgang mit eigenem Recht, und sie wird an der Route geprueft.
   * Anmelden und Einreichen sind in § 2 VOB/B zwei Erklaerungen, nicht zwei
   * Zustaende derselben.
   */
  { modul: 'bau', pfad: 'bau/ausserhalb-lv', schreibend: false },
  {
    modul: 'bau', pfad: 'bau/nachtrag',
    schreibend: true, schreibRecht: 'bau.nachtrag_anmelden',
  },
  {
    modul: 'bau', pfad: 'bau/behinderung',
    schreibend: true, schreibRecht: 'bau.behinderung_erstellen',
  },
  /**
   * PR 45 — das Wetter am Bautagebuch. Es SCHREIBT (`wetter_beobachtung`),
   * und das Recht ist das des Eintrags, an den es sich heftet: wer ein
   * Bautagebuch fuehren darf, heftet das Wetter daran.
   */
  {
    modul: 'bau', pfad: 'bau/wetter',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  /**
   * PR 45 — das Bautagebuch selbst (BAU-07).
   *
   * `bau.schreiben` und nicht `bau.aufmass_erfassen`: ein Aufmass ist eine
   * Mengenfeststellung, ein Bautagebuch die laufende Beweisfuehrung der
   * Bauleitung. Die Seitenkarte gibt `…/bautagebuch/[datum]` dasselbe Recht.
   *
   * Der Dienst SCHREIBT, obwohl sein sichtbarster Teil — der Abgleich der
   * Mannstunden gegen `zeiteintrag` — nur liest: ein Register, das nach dem
   * Schwerpunkt einer Datei entscheidet, laesst irgendwann den Anfuegeweg in
   * der Gruppenansicht laufen.
   */
  {
    modul: 'bau', pfad: 'bau/bautagebuch',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  /**
   * Die Reinigung — die Sollzeitrechnung und der Abzug LESEN, der Rest
   * schreibt.
   *
   * `sollzeit` und `schnappschuss` sind reine Funktionen: sie rechnen und
   * hashen, sie legen nichts ab. Wer etwas ablegt, nennt sein Recht — und das
   * ist beim Nachweis `nachweis.schreiben`, nicht `reinigung.schreiben`: das
   * Modul `nachweis` gehört dem Leistungsnachweis (CLN-04), während das
   * Zuschneiden einer Zone Reinigungsstammdaten sind.
   */
  { modul: 'reinigung', pfad: 'reinigung/sollzeit', schreibend: false },
  { modul: 'reinigung', pfad: 'reinigung/schnappschuss', schreibend: false },
  { modul: 'reinigung', pfad: 'reinigung/index', schreibend: false },
  {
    modul: 'reinigung', pfad: 'reinigung/revier',
    schreibend: true, schreibRecht: 'reinigung.schreiben',
  },
  {
    modul: 'nachweis', pfad: 'reinigung/leistungsnachweis',
    schreibend: true, schreibRecht: 'nachweis.schreiben',
  },
  /**
   * Qualität liegt im Modul `qualitaet` und nicht bei der Reinigung: die
   * Tabellen sind gewerkeübergreifend (04-SEITENKARTE.md §5.6). Dass die
   * Dateien unter `services/reinigung/` liegen, ist Ablage — das Recht
   * entscheidet der Modulname hier.
   */
  {
    modul: 'qualitaet', pfad: 'reinigung/reklamation',
    schreibend: true, schreibRecht: 'qualitaet.schreiben',
  },
  {
    modul: 'qualitaet', pfad: 'reinigung/qualitaet',
    schreibend: true, schreibRecht: 'qualitaet.schreiben',
  },
  /**
   * Das Mitarbeiterportal LIEST — jeder dieser Dienste ist `schreibend:
   * false`, und das ist keine Nachlaessigkeit, sondern die Zusage von EMP-07
   * und K-18: die einzigen Schreibwege des Menschen sind der Zeit-Einwand
   * (`zeit/einwand`), der Antrag (`abwesenheit/antrag`) und die
   * Abwesenheitsmeldung (`abwesenheit/index`) — alle drei laufen im
   * Mandanten-Scope mit einem serverseitig aufgeloesten Mandanten und stehen
   * bereits mit ihrem Schreibrecht in diesem Register. Ein vierter, hier
   * angelegter Schreibpfad waere genau der, der an ihnen vorbeifuehrt.
   */
  { modul: 'zeit', pfad: 'mitarbeiter/person', schreibend: false },
  { modul: 'dienstplan', pfad: 'mitarbeiter/schichten', schreibend: false },
  { modul: 'zeit', pfad: 'mitarbeiter/stunden', schreibend: false },
  { modul: 'zeit', pfad: 'mitarbeiter/zeiten', schreibend: false },
  /**
   * Was die Oberflaeche wissen muss, um den richtigen Stempelknopf zu zeigen
   * (D-618) — LESEND, wie jeder Dienst dieses Portals. Der Stempel selbst
   * steht in `zeit/checkin`.
   */
  { modul: 'zeit', pfad: 'mitarbeiter/stempeluhr', schreibend: false },
  { modul: 'nachweis', pfad: 'mitarbeiter/nachweise', schreibend: false },
  { modul: 'zeit', pfad: 'mitarbeiter/antraege', schreibend: false },
  { modul: 'zeit', pfad: 'mitarbeiter/felder', schreibend: false },
  /**
   * Die vier Nachzuegler des Mitarbeiterportals (0300–0304). Ebenfalls
   * LESEND — `tests/kern/mitarbeiter.test.ts` prueft das eigens („und KEINER
   * davon schreibt"), und keine der vier Dateien nimmt einen `SchreibKontext`.
   * Der Ablageweg fuer ein Schichtmedium liegt in `zeit/medien` und traegt
   * dort sein Recht.
   */
  { modul: 'nachweis', pfad: 'mitarbeiter/nachweis-schicht', schreibend: false },
  { modul: 'zeit', pfad: 'mitarbeiter/medien', schreibend: false },
  { modul: 'dienstplan', pfad: 'mitarbeiter/schicht-zugang', schreibend: false },
  { modul: 'wachbuch', pfad: 'mitarbeiter/schichtbuch', schreibend: false },
  /**
   * PR 42 — die eigenen Dienstanweisungen. LESEND: der Schreibweg der
   * Bestaetigung liegt in `security/dienstanweisung` und steht dort mit
   * seinem Recht.
   */
  { modul: 'dienstanweisung', pfad: 'mitarbeiter/dienstanweisungen', schreibend: false },
  /**
   * **Unterlagen und Objekte der eigenen Einteilung (0360, 0361).** Ebenfalls
   * LESEND. Die Abrufspur in `dokument_zugriff` schreibt die ROUTE
   * `api/mein/dokumente/[id]/datei`, nicht der Dienst — damit bleibt die
   * Zusage „kein Dienst unter `mitarbeiter/` schreibt" wahr.
   * `mitarbeiter/objekte` liest den Zutrittshinweis ueber den Definer
   * `app.mein_objekt_zugang` (0360), dessen Praedikat wortgleich
   * `app.ist_eingesetzt_auf_objekt` ist — keine neue Sichtbarkeitsregel,
   * sondern dieselbe in einer Funktion.
   */
  { modul: 'dokument', pfad: 'mitarbeiter/dokumente', schreibend: false },
  { modul: 'objekt', pfad: 'mitarbeiter/objekte', schreibend: false },
  /*
   * Objekt anlegen, aendern, archivieren (OPS-01, V-001, V-020). Bis PR dieses
   * Registereintrags entstand JEDE Objektzeile im Seed — die Plattform konnte
   * Objekte zeigen und bebuchen, aber kein einziges erfassen. Schreibrecht ist
   * `objekt.schreiben`, dasselbe, das die Policy `t_mandant` im `with check`
   * verlangt: eine Stelle, zwei Zusagen, dieselbe Antwort.
   */
  {
    modul: 'objekt', pfad: 'objekt/anlegen',
    schreibend: true, schreibRecht: 'objekt.schreiben',
  },
  /**
   * V-044 — was an einem Objekt haengt: Reviere, Posten,
   * Dienstanweisungen, Schluessel, Auftraege, Einsaetze, Dokumente,
   * Pruefungen. Rein lesend; jede Unterabfrage laeuft unter der Policy
   * IHRER Tabelle, und der Reiter darueber unter dem Recht seines Moduls.
   */
  { modul: 'objekt', pfad: 'objekt/umfeld', schreibend: false },
  /**
   * V-010 — den Qualifikationsnachweis aufnehmen, bestaetigen,
   * widerrufen. Er haengt am MENSCHEN (Invariante 9); das Modul ist
   * trotzdem `personal`, weil das Recht dort liegt.
   */
  {
    modul: 'personal', pfad: 'nachweis/aufnahme',
    schreibend: true, schreibRecht: 'personal.nachweis_verwalten',
  },
  /**
   * **Der Posteingang der Kraft (0350, EMP-11).** Beide lesend: der Faden wird
   * gelesen, geantwortet wird ueber `kern/nachricht` — den Fachdienst, der
   * ohnehin unter `nachricht.versenden` schreibt. Ein vierter, im Portaldienst
   * angelegter Schreibweg waere genau der, der an den drei bekannten
   * vorbeifuehrt. `mitarbeiter/posteingang` beruehrt gar keine Datenbank: es
   * mischt `benachrichtigung` und `nachricht` zu einer Liste.
   */
  { modul: 'nachricht', pfad: 'mitarbeiter/nachricht', schreibend: false },
  { modul: 'nachricht', pfad: 'mitarbeiter/posteingang', schreibend: false },

  /**
   * Die Rechnung (PR 46). Der Kanonisierer und der Kettenlauf LESEN — der
   * eine formatiert, der andere rechnet nach und schreibt ausdruecklich
   * nichts (§5.7: ein Pruefer, der repariert, bezeugt nichts mehr).
   *
   * Der Rechnungsdienst schreibt, und sein Recht ist `finanzen.festschreiben`
   * und nicht `finanzen.schreiben`: der Uebergang, der eine Nummer vergibt
   * und einen Beleg unveraenderlich macht, ist der, der ein eigenes Recht
   * braucht. Das Anlegen eines Entwurfs laeuft im selben Dienst und ist durch
   * die K-03-Policy auf `finanzen.schreiben` gebunden — zwei Rechte, eine
   * Datei, und das engere steht hier.
   */
  { modul: 'finanzen', pfad: 'finanz/kanonisch', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/kettenlauf', schreibend: false },
  {
    modul: 'finanzen', pfad: 'finanz/rechnung',
    schreibend: true, schreibRecht: 'finanzen.festschreiben',
  },
  /**
   * Der §14-UStG-Vorabpruefer (PR 47). Er LIEST — und das ist keine
   * Formalie: die Vorschau `rechnungen/[id]/pruefung` laeuft auch in einer
   * Nur-Lese-Sitzung, und ein Pruefer, der nebenbei etwas ablegt, waere ein
   * Schreibpfad auf einem Bildschirm, der keinen haben darf.
   */
  { modul: 'finanzen', pfad: 'finanz/ustg14', schreibend: false },
  /**
   * Die Positionsherkunft (PR 49, FIN-07/FIN-18). Sie SCHREIBT — sie legt
   * `rechnungsposition_quelle` an und setzt in der Festschreibungstransaktion
   * `zeiteintrag.abgerechnet_am`.
   *
   * Ihr Schreibrecht ist `finanzen.festschreiben` und nicht
   * `finanzen.schreiben`: der Schreibweg, der ueber die Domaenengrenze geht —
   * der Abrechnungsstempel auf einem fremden Zeiteintrag — haengt an den zwei
   * schmalen Policies aus `0088`, und die verlangen genau dieses Recht. Das
   * Anlegen einer Herkunftszeile im Entwurf laeuft im selben Dienst und ist
   * durch die K-03-Policy auf `finanzen.schreiben` gebunden — zwei Rechte,
   * eine Datei, und das engere steht hier (wie bei `finanz/rechnung`).
   */
  {
    modul: 'finanzen', pfad: 'finanz/positionsquelle',
    schreibend: true, schreibRecht: 'finanzen.festschreiben',
  },
  /**
   * Die fuenf Abrechnungsarten (PR 48, FIN-01).
   *
   * **Vier der sechs Dateien LESEN nur** — eine Strategie fragt Zeiteintraege,
   * Aufmasszeilen oder Sonderleistungen ab und gibt Zeilen-ENTWUERFE zurueck.
   * Das ist Absicht und nicht Zufall: eine Strategie, die selbst schriebe,
   * haette einen zweiten Weg in `rechnungsposition` neben
   * `fuegePositionHinzu()` — also eine zweite Stelle, an der ein Nettobetrag
   * entsteht (D-350, Abnahme 2).
   *
   * Geschrieben wird nur in `index.ts` (`bestuecke`, `bestueckeAusAbrechnungs
   * art`), und dort durch den Rechnungsdienst. Sein Recht ist deshalb
   * `finanzen.schreiben` — der Entwurf, nicht die Festschreibung: diese
   * Schicht bestueckt einen Entwurf und beruehrt keinen festgeschriebenen
   * Beleg.
   */
  { modul: 'finanzen', pfad: 'finanz/abrechnungsart/typen', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/abrechnungsart/register', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/abrechnungsart/stunden', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/abrechnungsart/monatspauschale', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/abrechnungsart/festpreis-los', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/abrechnungsart/einheitspreis-aufmass', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/abrechnungsart/einzelabruf', schreibend: false },
  {
    modul: 'finanzen', pfad: 'finanz/abrechnungsart/index',
    schreibend: true, schreibRecht: 'finanzen.schreiben',
  },

  /**
   * PR 50 — der Abzug der Abschlaege in einer Schlussrechnung (FIN-08).
   *
   * `index` SCHREIBT (`schreibeVerrechnung` legt die Bezugszeilen an und setzt
   * den Kopfbetrag), die beiden Bedingungsdateien nicht: `bedingungen` ist
   * eine reine Rechnung ueber Basispunkte, `bedingungen.platzhalter` eine
   * Konstante. Das engere Recht steht an der Datei, die es braucht — wie bei
   * `finanz/rechnung`.
   */
  {
    modul: 'finanzen', pfad: 'finanz/abschlag/index',
    schreibend: true, schreibRecht: 'finanzen.schreiben',
  },
  { modul: 'finanzen', pfad: 'finanz/abschlag/bedingungen', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/abschlag/bedingungen.platzhalter', schreibend: false },

  /**
   * PR 51 — §13b UStG und §48 EStG (FIN-09, FIN-10).
   *
   * Beide SIND reine Entscheidungen: sie bekommen die Zeilen, die der Aufrufer
   * schon gelesen hat, und geben eine Lage zurueck. Kein Schreibrecht, weil
   * keine von ihnen schreibt — die Werte landen ueber `finanz/rechnung` auf
   * dem Beleg, und dort haengt das Recht.
   */
  { modul: 'finanzen', pfad: 'finanz/steuer/nachweis', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/estg48/abzug', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/estg48/grenzen.platzhalter', schreibend: false },

  /**
   * Der Steuerfall SCHREIBT: er setzt `reverse_charge`, den Pflichthinweis und
   * die §48-Felder am Entwurf. Was er NICHT kann, ist eine Verlagerung ohne
   * Nachweis setzen — das entscheidet `fin.reverse_charge_pruefen` in der
   * Datenbank.
   */
  {
    modul: 'finanzen', pfad: 'finanz/steuerfall',
    schreibend: true, schreibRecht: 'finanzen.schreiben',
  },

  /**
   * Die steuerlichen Angaben eines KUNDEN (FIN-09, FIN-10, FIN-11, LEG-05,
   * LEG-06): §13b als Zeitscheiben, §48b am LEISTUNGSDATUM, E-Rechnungsweg.
   * Vier Vorgaenge, zwei Rechte — `erechnung` schreibt den Kundenstamm
   * (`crm.schreiben`), die drei anderen sind Finanzangaben. Hier steht das
   * strengere.
   */
  {
    modul: 'finanzen', pfad: 'finanz/kunde-steuer',
    schreibend: true, schreibRecht: 'finanzen.schreiben',
  },

  /**
   * PR 52 — die XRechnung (FIN-11).
   *
   * **Keiner dieser fuenf schreibt**, und das ist die ganze Aussage dieses
   * Blocks: die XRechnung entsteht aus dem Snapshot, der laengst
   * festgeschrieben ist (K-12). Ein Schreibrecht hier waere ein Hinweis
   * darauf, dass irgendwo doch etwas am Beleg geaendert wird — und genau das
   * darf nicht sein.
   *
   * `dienst` ist der einzige, der ueberhaupt an die Datenbank geht, und auch
   * er nur lesend: eine Zeile aus `rechnung_snapshot`. Das Recht dafuer
   * (`finanzen.herunterladen`) sitzt an der Route und an der Seite, weil es
   * dort um die AUSGABE geht und nicht um die Berechnung.
   */
  /*
   * Die UNTDID-4461-Teilmenge (BT-81). Eine Liste und zwei reine Funktionen —
   * sie liest nichts und schreibt nichts.
   */
  { modul: 'finanzen', pfad: 'finanz/zahlungsmittel', schreibend: false },
  /*
   * V-132, D-625: welches Logo eine Rechnung druckt — eine reine Wahl aus zwei
   * Pfaden und die Prüfung des Schlüssels; sie liest und schreibt nichts.
   */
  { modul: 'finanzen', pfad: 'finanz/rechnungslogo', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/xrechnung/index', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/xrechnung/xml', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/xml-lesen', schreibend: false },
  /* PR 63 — E-Rechnung lesen (ACC-05): reine Extraktion, kein Modell, kein OCR (O-135). */
  { modul: 'eingang', pfad: 'finanz/eingang/erechnung', schreibend: false },
  { modul: 'eingang', pfad: 'finanz/eingang/pdf-anhang', schreibend: false },
  {
    modul: 'eingang', pfad: 'finanz/eingang/vorschlag',
    schreibend: true, schreibRecht: 'eingang.schreiben',
  },
  {
    modul: 'eingang', pfad: 'finanz/eingang/ablage',
    schreibend: true, schreibRecht: 'eingang.schreiben',
  },
  /* PR 64 — GoBD-Archiv: Buendel, Wirtschaftsjahr, Aufbewahrung, der eine Loeschweg. */
  { modul: 'dokument', pfad: 'archiv/zip', schreibend: false },
  { modul: 'buchhaltung', pfad: 'buchhaltung/wirtschaftsjahr', schreibend: false },
  /* PR 65 — Offene Posten, Monatszahlen, Periodenschloss. */
  { modul: 'buchhaltung', pfad: 'buchhaltung/offene-posten', schreibend: false },
  { modul: 'buchhaltung', pfad: 'buchhaltung/monatszahlen', schreibend: false },
  {
    modul: 'buchhaltung', pfad: 'buchhaltung/periodenschluss',
    schreibend: true, schreibRecht: 'buchhaltung.festschreiben',
  },
  { modul: 'dokument', pfad: 'buchhaltung/pruefbuendel', schreibend: false },
  /* PR 66 — Z3-Datentraegerueberlassung und Verfahrensdokumentation. */
  { modul: 'buchhaltung', pfad: 'buchhaltung/z3', schreibend: false },
  { modul: 'buchhaltung', pfad: 'buchhaltung/verfahrensdokumentation', schreibend: false },
  /* PR 67 — Jahrespaket und Lohnexport. */
  { modul: 'buchhaltung', pfad: 'buchhaltung/jahrespaket', schreibend: false },
  { modul: 'zeit', pfad: 'zeit/lohnexport', schreibend: false },
  /*
   * Phase 10 — das Verarbeitungsverzeichnis nach Art. 30 DSGVO (LEG-09).
   * Lesend: es beschreibt die Konfiguration der Gesellschaft, es aendert
   * nichts. Modul `system`, wie die Seite und die Route.
   */
  { modul: 'system', pfad: 'datenschutz/verzeichnis', schreibend: false },
  { modul: 'system', pfad: 'datenschutz/loeschkonzept', schreibend: false },
  /*
   * Die beiden oeffentlichen PFLICHTWEGE (LEG-09, LEG-07). Sie schreiben, und
   * zwar ueber den EINGANGSPRINZIPAL — derselbe wie bei der Angebotsanfrage,
   * mit `formular.schreiben` und ohne Leserecht. Das Register nennt deshalb
   * `formular.schreiben` und nicht `datenschutz.*`: das waere das Recht des
   * Bearbeitenden, nicht das des Eingangs.
   *
   * In der Gruppenansicht laufen sie nicht: `withEingang` bindet genau EINEN
   * Mandanten, und den nennt das Formular. Eine Anfrage „an die Gruppe" gaebe
   * es rechtlich ohnehin nicht — die vier sind eigene juristische Personen.
   */
  {
    modul: 'formular', pfad: 'datenschutz/anfrage',
    schreibend: true, schreibRecht: 'formular.schreiben',
  },
  {
    modul: 'formular', pfad: 'datenschutz/barriere',
    schreibend: true, schreibRecht: 'formular.schreiben',
  },
  /*
   * Phase 10 — die Betriebsueberwachung (SPEC §14, D-540). Lesend: sie stellt
   * das Laufprotokoll neben den Zeitplan und loest nichts aus. Ein Lauf startet
   * ueber `/api/jobs/[schluessel]` mit dem Betriebsgeheimnis, nicht von hier.
   */
  { modul: 'system', pfad: 'betrieb/ueberwachung', schreibend: false },
  /* D-487 — Serien anlegen; Anmeldecode durch die Einsatzleitung. */
  {
    modul: 'dienstplan', pfad: 'dienstplan/serie',
    schreibend: true, schreibRecht: 'dienstplan.schreiben',
  },
  {
    modul: 'personal', pfad: 'personal/zugangscode',
    schreibend: true, schreibRecht: 'personal.zugang_verwalten',
  },
  /* V-014 — den Zugang selbst einrichten, umschreiben, sperren, entsperren.
     Fuenf Migrationen bauten um diese Zeile herum; angelegt hat sie bis
     dahin nur der Seed. */
  {
    modul: 'personal', pfad: 'personal/zugang',
    schreibend: true, schreibRecht: 'personal.zugang_verwalten',
  },
  /* V-013 — die einzelne Schicht: `einsatz.quelle = 'manuell'` stand seit
     0028 im Vokabular, angelegt hat so eine Zeile nie jemand. */
  {
    modul: 'dienstplan', pfad: 'dienstplan/einzelschicht',
    schreibend: true, schreibRecht: 'dienstplan.schreiben',
  },
  /* V-021 — eine Serie aendern, beenden, archivieren. `archiviert_am` stand
     seit 0028 da und wurde nie geschrieben. */
  {
    modul: 'dienstplan', pfad: 'dienstplan/serie-pflege',
    schreibend: true, schreibRecht: 'dienstplan.schreiben',
  },
  /* V-015 — die eine Zahl, ohne die kein Agent laeuft. Eigenes Recht, weil
     sich sonst begrenzt, wer seine Grenze selbst verstellt (AGT-05). */
  {
    modul: 'agent', pfad: 'agent/budget-pflege',
    schreibend: true, schreibRecht: 'agent.budget_verwalten',
  },
  {
    modul: 'dokument', pfad: 'dokument/aufbewahrung',
    schreibend: true, schreibRecht: 'dokument.aufbewahrung_verwalten',
  },
  {
    modul: 'dokument', pfad: 'dokument/loeschung',
    schreibend: true, schreibRecht: 'dokument.archivieren',
  },
  /**
   * V-023 — die Abweichung dieser Gesellschaft an der Rechtematrix.
   *
   * `system.rolle_verwalten` und nicht `system.rolle_lesen`: wer die Matrix
   * ansehen darf, verstellt sie damit nicht. Das Lesen ist bis `leitung`
   * bindbar, das Verwalten nur bis `admin` — und der zweite Faktor ist
   * Pflicht, weil `p_rb_aal2` (0008) restriktiv darauf besteht.
   */
  {
    modul: 'system', pfad: 'system/rollenrecht',
    schreibend: true, schreibRecht: 'system.rolle_verwalten',
  },
  /**
   * V-081 — der Auftrag laeuft, ruht oder ist storniert.
   *
   * `auftrag.schreiben` und ausdruecklich nicht `auftrag.abschliessen`:
   * Pausieren und Stornieren sind Auftragspflege, der Abschluss stellt nach
   * D-366 die FIN-18-Warnung scharf und traegt sein eigenes Recht (0296).
   * `abgeschlossen` ist ueber diesen Dienst gar nicht erreichbar.
   */
  {
    modul: 'auftrag', pfad: 'auftrag/status',
    schreibend: true, schreibRecht: 'auftrag.schreiben',
  },
  /**
   * V-172 — die Angaben eines Auftrags aus dem Formular: deutsche Zahlen,
   * Grenzen aus 0025, Kunde/Objekt/Leitung unter RLS. Liest nur; geschrieben
   * wird im Assistenten und in `auftrag/aendern`.
   */
  { modul: 'auftrag', pfad: 'auftrag/angaben', schreibend: false },
  /**
   * V-173 — Stammdaten eines Auftrags pflegen. `auftrag.schreiben`; gesperrt
   * für abgeschlossen und storniert, der Wert aus einem Angebot bleibt.
   */
  {
    modul: 'auftrag', pfad: 'auftrag/aendern',
    schreibend: true, schreibRecht: 'auftrag.schreiben',
  },
  { modul: 'finanzen', pfad: 'finanz/xrechnung/aus-snapshot', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/xrechnung/pruefstand', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/xrechnung/dienst', schreibend: false },
  /**
   * Zahlungen und offene Posten (PR 54.1, FIN-14).
   *
   * Der schreibende Teil traegt `zahlung.schreiben` und nicht
   * `finanzen.schreiben`: eine Zahlung zu erfassen ist keine Handlung am
   * Beleg. Wer Rechnungen schreiben darf, darf deshalb nicht schon deswegen
   * Zahlungseingaenge buchen — und umgekehrt.
   *
   * `iban`, `skonto` und `skonto.platzhalter` rechnen nur; sie sehen keine
   * Datenbank. `abgleich` LIEST und stempelt `neu_berechnet_am` — das
   * Schreibrecht dafuer haelt `cse_job` als Spaltenrecht, nicht diese
   * Registratur, weshalb er hier als lesend steht: kein Mensch schreibt
   * ueber ihn.
   */
  { modul: 'zahlung', pfad: 'finanz/zahlung/iban', schreibend: false },
  { modul: 'zahlung', pfad: 'finanz/zahlung/skonto', schreibend: false },
  { modul: 'zahlung', pfad: 'finanz/zahlung/skonto.platzhalter', schreibend: false },
  { modul: 'zahlung', pfad: 'finanz/zahlung/abgleich', schreibend: false },
  {
    modul: 'zahlung', pfad: 'finanz/zahlung/index',
    schreibend: true, schreibRecht: 'zahlung.schreiben',
  },
  /**
   * Die Kreditorenseite (PR 54.3, FIN-14). Modul `eingang` und nicht
   * `finanzen`: eine Eingangsrechnung ist kein Beleg, den wir ausstellen —
   * wer fakturiert, prueft deshalb nicht schon deswegen Lieferantenrechnungen.
   * Das Freigeben traegt noch einmal ein eigenes Recht (`eingang.freigeben`),
   * und es steht auf der Route, nicht hier: hier steht das ENGERE der beiden
   * Schreibrechte dieser Datei.
   */
  {
    modul: 'eingang', pfad: 'finanz/eingangsrechnung',
    schreibend: true, schreibRecht: 'eingang.schreiben',
  },
  /**
   * Die Freigabe als Vorgang (K-13, APR-07, PR 54.3).
   *
   * Modul `freigabe` und Schreibrecht `freigabe.entscheiden`: die
   * Entscheidung IST die Handlung, und sie traegt ein eigenes Recht — nicht
   * das der Domaene, die sie braucht. Wer eine Eingangsrechnung erfassen
   * darf, darf damit noch keine Freigabe in die Kette schreiben.
   */
  {
    modul: 'freigabe', pfad: 'freigabe/erteilen',
    schreibend: true, schreibRecht: 'freigabe.entscheiden',
  },
  /**
   * **Der Posteingang (PR 62, APR-01/02/03/07) — und alles daran LIEST.**
   *
   * Das ist keine Nachlaessigkeit, sondern die tragende Eigenschaft dieser
   * fuenf Dateien: der Diff, die Konfidenz, die Einstufung, die
   * Zusammenfassung und die Kettenrechnung sind REINE Funktionen. Keine
   * kennt eine Datenbank, keine eine Uhr, keine ein Modell.
   *
   * Gerade `kette.ts` gehoert hierher und nicht zu den Schreibern: sie
   * RECHNET den Hash nach, sie schreibt ihn nicht. Geschrieben wird der
   * Schnappschuss ausschliesslich in `app.freigabe_entscheiden` (0136), und
   * das ist der Grund, warum ein Aufrufer sich keinen Hash aussuchen kann.
   *
   * Dass sie in der Gruppenansicht laufen duerfen, ist damit richtig: die
   * Gruppe LIEST Freigaben (`gruppe.freigabe.lesen`), und ein Diff ohne
   * Schreibpfad ist genau das, was sie dort braucht (Invariante 10).
   */
  {
    /* Die Handlung nach der Genehmigung (§4.8) — laeuft in der Transaktion der Entscheidung. */
    modul: 'freigabe', pfad: 'freigabe/ausfuehrung',
    schreibend: true, schreibRecht: 'freigabe.entscheiden',
  },
  { modul: 'freigabe', pfad: 'freigabe/diff', schreibend: false },
  { modul: 'freigabe', pfad: 'freigabe/konfidenz', schreibend: false },
  { modul: 'freigabe', pfad: 'freigabe/posteingang', schreibend: false },
  { modul: 'freigabe', pfad: 'freigabe/zusammenfassung', schreibend: false },
  { modul: 'freigabe', pfad: 'freigabe/kette', schreibend: false },
  { modul: 'freigabe', pfad: 'freigabe/pruefdauer', schreibend: false },
  {
    modul: 'freigabe', pfad: 'freigabe/vergleich-schluessel.platzhalter',
    schreibend: false,
  },
  /**
   * Die Bildschirme des Posteingangs (PR 62 Rest, D-472).
   *
   * `laden` liest Posteingang und Pruefansicht und VERMERKT das Oeffnen —
   * eine anfuegende Zeile in `freigabe_ansicht`, kein Schreibrecht: der
   * Vermerk ist Teil des Lesens (APR-08: die Pruefdauer misst der Server).
   * `entscheiden` ist der einzige Schreiber, und er schreibt nicht selbst —
   * er ruft `app.freigabe_entscheiden` (0137), das Recht ist dasselbe wie
   * bei `erteilen`. `diff-json` und `json` sind reine Umformungen.
   */
  /**
   * Die Gruppenansicht (TEN-05, D-475) — sechs Leser, kein Schreiber.
   *
   * Modul `bericht`, weil sie genau das sind: Berichte ueber mehrere
   * Gesellschaften, gelesen im Gruppen-Scope, in dem keine Tabelle eine
   * Schreib-Policy kennt (Invariante 10). Jede Zelle fragt VOR der Zaehlung
   * das Recht des Bereichs, damit eine fehlende Berechtigung nie als Null
   * erscheint.
   */
  { modul: 'bericht', pfad: 'gruppe/uebersicht', schreibend: false },
  { modul: 'bericht', pfad: 'gruppe/finanzen', schreibend: false },
  { modul: 'bericht', pfad: 'gruppe/offene-posten', schreibend: false },
  { modul: 'bericht', pfad: 'gruppe/auslastung', schreibend: false },
  /**
   * Die beiden Nachzuegler derselben Art (RAD-07/REP-06, CAL-01/CAL-02): die
   * Vergabepipeline und der zusammengefuehrte Kalender ueber alle
   * Gesellschaften. Beide nehmen einen `LeseKontext`, beide fragen je Bereich
   * zuerst das Recht, damit eine fehlende Berechtigung nicht als Null
   * erscheint. `gruppe/radar` rechnet ausdruecklich KEINE zweite Bewertung —
   * keine Gruppenpunktzahl, kein Mittelwert; die Punktzahl bleibt die der
   * Gesellschaft. Dazu gehoert 0370, das der Gruppenansicht die Bewerberdaten
   * ENTZIEHT (`p_gruppe_kein_personenbezug`, restriktiv).
   */
  { modul: 'bericht', pfad: 'gruppe/radar', schreibend: false },
  { modul: 'bericht', pfad: 'gruppe/kalender', schreibend: false },
  { modul: 'freigabe', pfad: 'freigabe/diff-json', schreibend: false },
  { modul: 'freigabe', pfad: 'freigabe/json', schreibend: false },
  { modul: 'freigabe', pfad: 'freigabe/laden', schreibend: false },
  {
    modul: 'freigabe', pfad: 'freigabe/entscheiden',
    schreibend: true, schreibRecht: 'freigabe.entscheiden',
  },
  /**
   * Das Rechnungsausgangsbuch (PR 56, FIN-16). Es LIEST — und das ist keine
   * Formalie: ein Buch, das beim Lesen etwas ablegt, ist kein Buch. Modul
   * `nummernkreis`, weil es die Sicht auf den Kreis ist.
   */
  { modul: 'nummernkreis', pfad: 'finanz/ausgangsbuch', schreibend: false },
  /**
   * Das Mahnwesen (PR 55, FIN-15).
   *
   * `zins` und `stufen.platzhalter` rechnen nur — keine Datenbank. `lauf`
   * SCHREIBT: er legt Entwuerfe an, und das traegt `mahnung.schreiben`.
   * `index` schreibt ebenfalls, und sein engeres Recht (`mahnung.freigeben`
   * fuer die Freigabe) steht auf der Route, nicht hier — hier steht das
   * engere der beiden Schreibrechte dieser Datei.
   */
  { modul: 'mahnung', pfad: 'finanz/mahnung/zins', schreibend: false },
  { modul: 'mahnung', pfad: 'finanz/mahnung/stufen.platzhalter', schreibend: false },
  {
    modul: 'mahnung', pfad: 'finanz/mahnung/lauf',
    schreibend: true, schreibRecht: 'mahnung.schreiben',
  },
  {
    modul: 'mahnung', pfad: 'finanz/mahnung/index',
    schreibend: true, schreibRecht: 'mahnung.schreiben',
  },
  {
    modul: 'mahnung', pfad: 'finanz/mahnung/stufen',
    schreibend: true, schreibRecht: 'mahnung.schreiben',
  },
  /**
   * ZUGFeRD (PR 53, FIN-12).
   *
   * Alle drei LESEN nur: `cii` setzt XML aus einem Schnappschuss zusammen,
   * `icc` rechnet ein Farbprofil aus Konstanten, `pdfa3` setzt daraus ein
   * Blatt. Keiner von ihnen sieht eine Datenbank — die Rechnung kommt fertig
   * herein (K-12). Modul `finanzen`, weil es derselbe Beleg ist wie die
   * XRechnung, nur in einem zweiten Format.
   */
  { modul: 'finanzen', pfad: 'finanz/zugferd/cii', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/zugferd/icc', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/zugferd/pdfa3', schreibend: false },
  /*
   * V-134, D-629: das Rechnungsblatt — was darauf steht (aus der Nutzlast,
   * formatiert, nie gerechnet) und wie es gesetzt wird. Beide lesen nichts.
   */
  { modul: 'finanzen', pfad: 'finanz/zugferd/blatt-inhalt', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/zugferd/blatt', schreibend: false },
  /**
   * **Die Berichte (PR 79, REP-01…REP-07) — alle vier lesend, ausnahmslos.**
   *
   * Ein Bericht, der schreibt, ist kein Bericht. Das ist hier keine
   * Selbstverständlichkeit, sondern die Bedingung dafür, dass die
   * Gruppenfassung überhaupt existieren darf (Invariante 10): sie läuft ohne
   * aktiven Mandanten, und `gruppenansicht.test.ts` liest genau dieses
   * Register, um zu prüfen, dass dort kein Schreibpfad steht.
   *
   * `zeitraum` und `ausgabe` sehen nie eine Datenbank — Datumsarithmetik und
   * CSV-Maskierung; sie stehen trotzdem hier, weil der Gegentest jeden Dienst
   * verlangt und eine Ausnahmeliste die Stelle wäre, an der der fünfte
   * vergessen wird.
   */
  { modul: 'bericht', pfad: 'bericht/zeitraum', schreibend: false },
  { modul: 'bericht', pfad: 'bericht/ausgabe', schreibend: false },
  { modul: 'bericht', pfad: 'bericht/kennzahlen', schreibend: false },
  { modul: 'bericht', pfad: 'bericht/gruppe', schreibend: false },
  /**
   * **Der Kalender (CAL-01…CAL-03) — beide lesend.**
   *
   * `eintraege` SAMMELT aus sechs Quellen und schreibt in keine; `ical`
   * formatiert und sieht nie eine Datenbank. Dass hier kein Schreibpfad
   * steht, ist die Bedingung dafuer, dass `/portal/gruppe/kalender` ueberhaupt
   * existieren darf (Invariante 10) — `gruppenansicht.test.ts` liest genau
   * dieses Register.
   *
   * Ein Termin wird ueber die Seite geschrieben, nicht ueber einen Dienst;
   * kommt das, traegt es sein eigenes `schreibRecht` (`kalender.schreiben`).
   */
  { modul: 'kalender', pfad: 'kalender/eintraege', schreibend: false },
  { modul: 'kalender', pfad: 'kalender/ical', schreibend: false },
  { modul: 'kalender', pfad: 'kalender/fenster', schreibend: false },
  { modul: 'kalender', pfad: 'kalender/tagesraster', schreibend: false },
  /**
   * **Das Social Media Center (SOC-01…SOC-08) — einer schreibt, zwei nicht.**
   *
   * `weg` ist die Zustandsregel ohne jeden Zugriff, `port` der Vertrag mit
   * den fremden Plattformen. `dienst` legt an, legt vor, plant und
   * veroeffentlicht — und traegt deshalb `social.schreiben`. Damit ist
   * `/portal/gruppe/social` lesend moeglich und schreibend nicht
   * (Invariante 10); `gruppenansicht.test.ts` liest genau dieses Register.
   */
  { modul: 'social', pfad: 'social/weg', schreibend: false },
  { modul: 'social', pfad: 'social/port', schreibend: false },
  { modul: 'social', pfad: 'social/planeingabe', schreibend: false },
  { modul: 'social', pfad: 'social/dienst', schreibend: true, schreibRecht: 'social.schreiben' },
  /**
   * **Recruiting (REC-01 … REC-09, PR 79).** `rangfolge` ist reiner Code ohne
   * jeden Zugriff — Punktzahl und Reihenfolge rechnet eine geprüfte Funktion
   * und nicht das Modell (Invariante 6). `dienst` legt Stellen an, nimmt
   * Bewerbungen entgegen, bewertet und entscheidet.
   *
   * **Das Register nennt EIN Schreibrecht, der Dienst kennt drei.** Was hier
   * steht, ist die Frage, die der Gruppentest stellt: gibt es in der
   * Gruppenansicht ein Recht, unter dem dieser Dienst schreiben dürfte? Für
   * `recruiting/dienst` ist das `recruiting.stelle_schreiben` — mandantenweit
   * und in `gruppe` nicht gebunden. Die übrigen Schreibwege tragen ihr
   * eigenes Recht an ihrer eigenen Stelle: `bewerte` verlangt
   * `recruiting.bewerbung_bewerten`, `entscheide` verlangt
   * `recruiting.entscheiden` (REC-06: eine Einstellungsentscheidung ist etwas
   * anderes als eine Punktzahl), und `nimmBewerbungAn` verlangt GAR KEIN
   * Recht — es ist der Weg des öffentlichen Formulars, und ein Bewerber hat
   * keine Sitzung (REC-03).
   *
   * Damit ist `/portal/gruppe` lesend möglich und schreibend nicht
   * (Invariante 10) — auch wenn es dort heute keine Recruiting-Seite gibt.
   */
  { modul: 'recruiting', pfad: 'recruiting/rangfolge', schreibend: false },
  {
    modul: 'recruiting', pfad: 'recruiting/dienst', schreibend: true,
    schreibRecht: 'recruiting.stelle_schreiben',
  },
  /*
   * Die Antwort an eine Bewerberin (REC-03). Dasselbe Muster wie oben: das
   * Register nennt das Recht, unter dem in der Gruppenansicht geschrieben
   * werden KOENNTE — `recruiting.bewerbung_bewerten`. Dass `legeVor` und
   * `sende` zusaetzlich `recruiting.entscheiden` verlangen, steht an der
   * Route: eine Absage IST die Entscheidung, aus Sicht der Empfaengerin.
   */
  {
    modul: 'recruiting', pfad: 'recruiting/antwort', schreibend: true,
    schreibRecht: 'recruiting.bewerbung_bewerten',
  },
  /* =====================================================================
   * **Die Domaenenwelle (Routenbau, 117 offene Adressen).** Fuenfzehn
   * Domaenen, nacheinander gebaut, gepruefet und behoben; die Eintraege lagen
   * bis hierher in `docs/architecture/routenbau/register/<domaene>.md` und
   * sind mit dieser Zeile dort geloescht. Sortiert ist nach Domaene, weil die
   * Datei nach BAUWELLE geordnet ist und nicht alphabetisch — wer den Block
   * spaeter liest, soll sehen, was zusammen entstanden ist.
   * ===================================================================== */

  /**
   * **Aufgaben und Nachrichtenfaeden (OPS-11, EMP-11, 0230/0231).**
   *
   * `kern/aufgabe` schreibt vier Uebergaenge — anlegen, Stand setzen,
   * erledigen, abbrechen — alle unter `aufgabe.schreiben`. Das ZUWEISEN
   * verlangt zusaetzlich `aufgabe.zuweisen`, und das prueft die Route
   * (`api/aufgaben`), nicht dieses Register: wer eine Aufgabe bearbeiten darf,
   * darf sie nicht schon deswegen jemand anderem aufhalsen.
   *
   * `kern/nachricht` schreibt unter `nachricht.versenden`. Der Weg nach
   * draussen (`sendeNachAussen`) laeuft zusaetzlich durch
   * `kern.nachricht_sendetor()` und die Freigabekette (Invariante 7) — und
   * heute gegen keinen verbundenen Versender (O-36), weshalb er wirft, statt
   * einen Erfolg zu behaupten. Der Gelesen-Stempel (`markiereGelesen`) traegt
   * bewusst KEIN Recht: `t_empfaenger_eigene_stempeln` (0231) bindet ihn an
   * `app.aktueller_benutzer()` bzw. `app.aktuelle_person()`.
   */
  {
    modul: 'aufgabe', pfad: 'kern/aufgabe',
    schreibend: true, schreibRecht: 'aufgabe.schreiben',
  },
  {
    modul: 'nachricht', pfad: 'kern/nachricht',
    schreibend: true, schreibRecht: 'nachricht.versenden',
  },
  /*
   * `inhalt/sicherheit-txt` ist reine Formatierung: eine Kontaktadresse
   * hinein, RFC-9116-Text heraus, oder `null`. Kein Schreibpfad, keine
   * Abfrage, kein Mandant — sie liest nicht einmal selbst, das tut der
   * Handler.
   */
  { modul: 'inhalt', pfad: 'inhalt/sicherheit-txt', schreibend: false },

  /**
   * **Die Abnahme (§ 12 VOB/B, 0210/0211).**
   *
   * `bau.schreiben` und nicht `bau.aufmass_freigeben`: eine Abnahme ist keine
   * Mengenfeststellung, sondern die Erklaerung der Vertragsparteien ueber
   * Gefahruebergang, Fristbeginn und Vertragsstrafe. Die Seitenkarte gibt
   * `…/projekte/[id]/abnahme` genau dieses Recht.
   */
  {
    modul: 'bau', pfad: 'bau/abnahme',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  /**
   * Der LV-Import (BAU-01, REQ-04, 0212) und die Uebersicht.
   *
   * `bau/lv-quelle` LIEST: der Parser nimmt Text hinein und gibt Zeilen
   * heraus, ohne die Datenbank zu beruehren — damit ist er fuer sich testbar
   * und in der Gruppenansicht unbedenklich. `bau/lv-import` schreibt Staging
   * und Uebernahme und traegt `bau.schreiben`, dasselbe Recht wie die Route.
   *
   * `bau/uebersicht` LIEST: es zaehlt und filtert fuer die Moduluebersicht, es
   * rechnet nichts.
   */
  { modul: 'bau', pfad: 'bau/lv-quelle', schreibend: false },
  {
    modul: 'bau', pfad: 'bau/lv-import',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  { modul: 'bau', pfad: 'bau/uebersicht', schreibend: false },

  /**
   * **Die vier Betroffenenrechte (0220–0229).** Auskunft, Berichtigung,
   * Loeschentscheidung und Werbewiderspruch. `werbewiderspruch` traegt
   * `datenschutz.auskunft_erstellen` wie die Auskunft: es ist derselbe
   * Bearbeiterkreis, und ein eigener Schluessel stuende im Katalog nicht.
   *
   * Der anonyme Weg (`erfasseOhneToken`) haelt KEIN Benutzerrecht — er kann
   * keines halten, weil niemand angemeldet ist. Er laeuft ueber
   * `app.werbewiderspruch_formular`, und die Funktion prueft K-04,
   * `app.ist_readonly()` und `formular.schreiben` SELBST, statt es dem
   * Aufrufer zu glauben; dazu Ratenlimit und Honigtopf.
   */
  {
    modul: 'datenschutz', pfad: 'datenschutz/auskunft',
    schreibend: true, schreibRecht: 'datenschutz.auskunft_erstellen',
  },
  {
    modul: 'datenschutz', pfad: 'datenschutz/berichtigung',
    schreibend: true, schreibRecht: 'datenschutz.berichtigung_bearbeiten',
  },
  {
    modul: 'datenschutz', pfad: 'datenschutz/loeschentscheidung',
    schreibend: true, schreibRecht: 'datenschutz.loeschung_pruefen',
  },
  {
    modul: 'datenschutz', pfad: 'datenschutz/werbewiderspruch',
    schreibend: true, schreibRecht: 'datenschutz.auskunft_erstellen',
  },

  /*
   * **Dienstplan, Phase „Bekanntgabe" (0265–0274)** — die Bekanntgabe selbst,
   * der Konflikt-Einzelsatz hinter Quittung und Uebersteuerung, die eine
   * Meldungsart (NOT-01) und die gewerkeuebergreifende Besetzungsluecke.
   *
   * `dienstplan/konflikt` schreibt ueber `app.arbzg_befund_quittieren` —
   * `arbeitszeit_verstoss` gewaehrt `cse_app` kein UPDATE. Die Funktion prueft
   * das SCHWAECHERE `dienstplan.arbzg_lesen`; das staerkere
   * `dienstplan.arbzg_uebersteuern` setzt die Route durch, und deshalb steht
   * es hier.
   */
  {
    modul: 'dienstplan', pfad: 'dienstplan/veroeffentlichung',
    schreibend: true, schreibRecht: 'dienstplan.veroeffentlichen',
  },
  {
    modul: 'dienstplan', pfad: 'dienstplan/konflikt',
    schreibend: true, schreibRecht: 'dienstplan.arbzg_uebersteuern',
  },
  /* Registriert nur die Art `dienstplan.plan_veroeffentlicht` (D-493). */
  { modul: 'dienstplan', pfad: 'dienstplan/benachrichtigung', schreibend: false },
  { modul: 'dienstplan', pfad: 'dienstplan/besetzungsluecke', schreibend: false },
  /*
   * `dienstplan/serienliste` haben ZWEI Domaenen gemeldet (dienstplan-zeit und
   * reinigung-security-qualitaet), wortgleich und beide lesend. Ein Eintrag.
   */
  { modul: 'dienstplan', pfad: 'dienstplan/serienliste', schreibend: false },

  /**
   * **Die Einstellungen (0200–0209).**
   *
   * `agent/richtlinie` ist **das Ausgangs-Gate als DATEN** (AGT-03, APR-01,
   * Invariante 7): es liest die acht AKTIONEN und setzt eine Zeile.
   * Entschieden wird in `server/agent/policy.ts`, nicht hier — und fuer
   * Angebot, Nachtrag und Behinderungsanzeige im Code, unabhaengig von jeder
   * Zeile der Tabelle. Das Schreibrecht ist `agent.richtlinie_verwalten` und
   * nicht `versand.freigeben`: wer die REGEL setzt, gibt damit nichts frei.
   * Auch diesen Eintrag haben zwei Domaenen gemeldet (einstellungen und
   * agenten-freigaben-radar), wortgleich. Ein Eintrag.
   *
   * `einstellung/vorlagen` traegt `bau.schreiben` und nicht das Recht seiner
   * SEITE (`system.einstellung_verwalten`): geschrieben wird in
   * `behinderung_vorlage`, und deren Policy verlangt genau dieses. Das
   * Register nennt das Recht des SCHREIBWEGS, nicht das der Adresse.
   *
   * `audit/buendel` schreibt unter `system.audit_exportieren`;
   * `app.audit_kette_fortschreiben` prueft zusaetzlich `app.ist_readonly`.
   */
  { modul: 'system', pfad: 'migration/uebernahme', schreibend: false },
  {
    modul: 'agent', pfad: 'agent/richtlinie',
    schreibend: true, schreibRecht: 'agent.richtlinie_verwalten',
  },
  {
    modul: 'system', pfad: 'audit/buendel',
    schreibend: true, schreibRecht: 'system.audit_exportieren',
  },
  {
    modul: 'system', pfad: 'mandant/identitaet',
    schreibend: true, schreibRecht: 'system.identitaet_verwalten',
  },
  /*
   * V-100, D-628: Logo, Avatar und Titelbild — dasselbe Recht wie die
   * uebrige Identitaet. Die Pfadspalten bekamen ihr Spaltenrecht erst mit
   * diesem Dienst (0393).
   */
  {
    modul: 'system', pfad: 'mandant/markenbild',
    schreibend: true, schreibRecht: 'system.identitaet_verwalten',
  },
  {
    modul: 'system', pfad: 'einstellung/vorlagen',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  {
    modul: 'stammdaten', pfad: 'zeit/arbeitszeitmodell',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },

  /**
   * **Das Kundenportal (AUT-01, CRM-06, 04-SEITENKARTE §8).** Zwoelf Dienste,
   * alle LESEND — und das ist keine Momentaufnahme, sondern der Typ: jeder
   * bekommt einen `KundenAbfrage` mit genau einer Methode (`abfrage`), und
   * `kundePortal` reicht ihm einen `LeseKontext` ohne `schreibe`. Ein
   * Schreibversuch aus einer Kundenseite ist damit ein Compilerfehler und
   * keine Laufzeitentscheidung; ob ein Kundenzugang im Portal ueberhaupt
   * schreiben darf, ist O-74.
   *
   * Kein `schreibRecht` an einer der zwoelf Zeilen — dann greift die erste
   * Pruefung („jeder schreibende Dienst nennt sein Schreibrecht") gar nicht.
   */
  { modul: 'kundenportal', pfad: 'kundenportal/angebot', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/auftrag', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/basis', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/dokument', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/nachricht', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/nachweis', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/objekt', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/projekt', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/rechnung', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/reklamation', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/uebersicht', schreibend: false },
  { modul: 'kundenportal', pfad: 'kundenportal/zahlung', schreibend: false },

  /**
   * **Reinigung, Security und Qualitaet (0285–0289).**
   *
   * `nachweis/register` und `security/bewacherregister` tragen `modul:
   * 'personal'` wie ihre Geschwister weiter oben: ein Nachweis haengt am
   * MENSCHEN und nicht am Gewerk. `security/bewacherregister` schreibt das
   * Bewacherregister nach § 34a GewO und traegt deshalb
   * `personal.bewacher_verwalten` und nicht `security.schreiben`.
   */
  {
    modul: 'reinigung', pfad: 'reinigung/turnus',
    schreibend: true, schreibRecht: 'reinigung.schreiben',
  },
  { modul: 'reinigung', pfad: 'reinigung/turnusvorschau', schreibend: false },
  {
    modul: 'reinigung', pfad: 'reinigung/sonderleistung',
    schreibend: true, schreibRecht: 'reinigung.schreiben',
  },
  { modul: 'reinigung', pfad: 'reinigung/uebersicht', schreibend: false },
  { modul: 'personal', pfad: 'nachweis/register', schreibend: false },
  {
    modul: 'personal', pfad: 'security/bewacherregister',
    schreibend: true, schreibRecht: 'personal.bewacher_verwalten',
  },
  { modul: 'security', pfad: 'security/uebersicht', schreibend: false },
  { modul: 'security', pfad: 'security/veranstaltung', schreibend: false },
  /**
   * V-004 — die Veranstaltung ANLEGEN. Eigene Zeile und eigene Datei, weil
   * `security/veranstaltung` daneben als lesend gefuehrt ist und es bleiben
   * soll: eine Schreibfunktion darin machte die Registerzeile still falsch.
   */
  {
    modul: 'security', pfad: 'security/veranstaltung-anlegen',
    schreibend: true, schreibRecht: 'security.schreiben',
  },

  /**
   * **Die fuenf Stammdatenkataloge (SEITENKARTE §5.13, 0275–0279).**
   * `katalog` ist das Gemeinsame der fuenf — Schluesselform, Pflichttexte,
   * i18n auf genau de/en/ar/tr, `pflegbar`/`sperrgrund`, die Uebersetzer fuer
   * 23505/42501 und die Stufenkollision aus 0276. Es rechnet nichts und
   * schreibt nichts, deshalb `schreibend: false`.
   *
   * Die fuenf Fachdienste schreiben und nennen dafuer `stammdaten.verwalten`
   * — dasselbe Recht, das die Routen und die WITH-CHECK-Policies verlangen.
   * Modul ist `stammdaten` und nicht `reinigung`: abwesenheitsart, antragsart
   * und qualifikation haengen am MENSCHEN, belagsart und reinigungsklasse sind
   * in einer Gesellschaft ohne Reinigung einfach leer.
   */
  { modul: 'stammdaten', pfad: 'stammdaten/katalog', schreibend: false },
  {
    modul: 'stammdaten', pfad: 'stammdaten/abwesenheitsart',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },
  {
    modul: 'stammdaten', pfad: 'stammdaten/antragsart',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },
  {
    modul: 'stammdaten', pfad: 'stammdaten/belagsart',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },
  {
    modul: 'stammdaten', pfad: 'stammdaten/qualifikation',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },
  {
    modul: 'stammdaten', pfad: 'stammdaten/reinigungsklasse',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },

  /**
   * Der Leistungskatalog (OPS-06, CLN-05, 0295–0299). Schreibt Fassungen und
   * Positionen; `katalog.schreiben` halten nur `admin` und `super_admin`,
   * nicht `leitung` — die beiden Katalogseiten pruefen das mit `haeltRechte`,
   * damit kein Knopf auf ein 404 fuehrt.
   */
  {
    modul: 'katalog', pfad: 'katalog/index',
    schreibend: true, schreibRecht: 'katalog.schreiben',
  },
  /**
   * Der Auftragsabschluss (OPS-05, FIN-18). `auftrag.abschliessen` und NICHT
   * `auftrag.schreiben`: der Abschluss stellt nach D-366 die FIN-18-Warnung im
   * Rechnungsweg scharf. Seit 0296 setzt `kern.auftrag_uebergang_pruefen`
   * dasselbe Recht als zweite Linie durch.
   */
  {
    modul: 'auftrag', pfad: 'auftrag/abschluss',
    schreibend: true, schreibRecht: 'auftrag.abschliessen',
  },
  /**
   * Die Kundenfreigabe am Auftrag (PRO-05) — der BELEG, keine
   * Veroeffentlichung. Modul `referenz`, weil hier ueber eine oeffentliche
   * Nennung entschieden wird und nicht ueber den Auftrag.
   */
  {
    modul: 'referenz', pfad: 'auftrag/kundenfreigabe',
    schreibend: true, schreibRecht: 'referenz.kundenfreigabe_erfassen',
  },
  /**
   * Der Schalter `sichtbar_fuer_kunde` (DOC-04). `dokument.kunde_freigeben`
   * und ausdruecklich nicht `dokument.schreiben`: das haelt auch die Rolle
   * `mitarbeiter` (0297 bindet es im Ausloeser).
   */
  {
    modul: 'dokument', pfad: 'dokument/kundenfreigabe',
    schreibend: true, schreibRecht: 'dokument.kunde_freigeben',
  },
  /**
   * Der EINZELNE Raum (OPS-02, OPS-03) — neben dem Massenweg
   * `raumbuch/import`. Hier passen Tor und Policy zusammen: `t_mandant` auf
   * `raum` verlangt im WITH CHECK genau `objekt.schreiben`.
   */
  {
    modul: 'objekt', pfad: 'raumbuch/raum',
    schreibend: true, schreibRecht: 'objekt.schreiben',
  },
  /**
   * Die Prozentumrechnung (Invariante 1) — eine REINE Funktion, kein
   * Schreibweg. Sie entstand, weil dieselbe Umrechnung zweimal im Baum stand:
   * in `kalkulation/bestaetigung.ts` fuer die Zuschlaege und in
   * `auftrag/abschluss.ts` fuer den Sicherheitseinbehalt — mit zwei Regeln,
   * zwei Grenzen und zwei Antworten auf ein mitgetipptes Prozentzeichen. Beide
   * rufen jetzt hierher; Grenze und Fehlername bleiben beim Aufrufer.
   */
  { modul: 'finanzen', pfad: 'finanz/prozent', schreibend: false },

  /*
   * **Der Feed-Zugang steht NICHT hier, und das ist kein Vergessen.**
   *
   * Er schreibt (`kalender_feed` anlegen und widerrufen), aber er gehoert dem
   * MENSCHEN und keiner Gesellschaft: `t_feed_eigene` bindet ihn an
   * `app.aktueller_benutzer()`, er laeuft ueber `bindePersoenlich`, und es
   * gibt keinen Rechteschluessel dafuer — ein Recht davor hiesse, dass jemand
   * seinen eigenen Kalender nicht abonnieren darf.
   *
   * Genau dafuer gibt es die Grenze dieses Verzeichnisses: was einem Menschen
   * gehoert, liegt neben `server/benachrichtigung/posteingang.ts` unter
   * `server/kalender/`, nicht unter `server/services/`. Der Gegentest liest
   * `services/`, und die Zusage, die er traegt — jeder schreibende Dienst
   * nennt sein Recht —, gilt fuer Mandantenlogik. Sie hier aufzuweichen
   * hiesse, sie ueberall aufzuweichen.
   */
  /**
   * **Nachtrag: die neun, die zwei Domaenen als „bereits gefuehrt" meldeten.**
   *
   * Sie waren es nicht — keiner der neun stand im Register, und der Gegentest
   * („das Register kennt jeden Dienst, der existiert") war darueber rot. Der
   * Eintragende hat sie deshalb NICHT geraten, sondern stehen lassen und
   * gemeldet: `schreibend` und `schreibRecht` folgen aus der Policy der
   * geschriebenen Tabelle, und wer sie errät, errät eine Rechtezusage.
   *
   * Nachgesehen wurde in den Dateien selbst. Die sechs Finanzdienste nehmen
   * ausschliesslich `Abfrage` (lesen) — kein `SchreibKontext`, kein `insert`,
   * kein `update`. `finanz/versand` liest das Versandprotokoll; geschrieben
   * wird `rechnung_versand` an anderer Stelle. Die drei Personaldienste
   * schreiben, jeder unter dem Recht seiner Policy.
   */
  { modul: 'finanzen', pfad: 'finanz/ausgabe', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/beleg', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/kreisuebersicht', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/versand', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/vorabpruefung', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/zugferd/vorschau', schreibend: false },

  /**
   * `personal/stammdaten` schreibt `person` (Geburtsort, Staatsangehoerigkeit
   * — Bewacherregister, §34a GewO). Die Policy `t_person_personalpflege`
   * (0190) verlangt `personal.schreiben`; gelesen wird dagegen ueber
   * `app.person_stammdaten_lesen` unter `personal.stammdaten_lesen`, und
   * jeder Lesezugriff hinterlaesst eine Auditzeile.
   */
  {
    modul: 'personal', pfad: 'personal/stammdaten',
    schreibend: true, schreibRecht: 'personal.schreiben',
  },

  /**
   * `personal/anstellung` schreibt `anstellung` und `anstellung_kondition`.
   * Zwei Rechte treffen aufeinander: `personal.anstellung_beenden` fuer die
   * Beendigung, `personal.entgelt_schreiben` fuer die datierte Kondition
   * (0192). **Hier steht das strengere** — dieselbe Regel wie bei
   * `finanz/kunde-steuer` weiter oben. Wer nur beenden darf, kommt an der
   * Kondition ohnehin an der Policy nicht vorbei.
   */
  {
    modul: 'personal', pfad: 'personal/anstellung',
    schreibend: true, schreibRecht: 'personal.entgelt_schreiben',
  },

  /**
   * `personal/dublette` fuehrt zwei Personenzeilen zusammen. Der Schreibweg
   * ist ausschliesslich `app.person_zusammenfuehren` (0194), und die Funktion
   * prueft selbst `personal.zusammenfuehren` (Zeile 221) — die Dublette kann
   * bei einer SCHWESTERGESELLSCHAFT beschaeftigt sein, die die
   * zusammenfuehrende Sitzung gar nicht sieht, deshalb ein Definer und keine
   * Policy.
   */
  {
    modul: 'personal', pfad: 'personal/dublette',
    schreibend: true, schreibRecht: 'personal.zusammenfuehren',
  },

  /**
   * **Der Reststapel des internen Portals (0365–0368).** Vier Dienste hinter
   * vier Seiten, die es bis dahin nicht gab.
   *
   * `dokument/ablage` ist die Schwester von `dokument/upload` und
   * `dokument/erzeugt`: `upload` traegt die Reihenfolge (Groesse, Magic
   * Bytes, EXIF, Aufbewahrung, Speichern), `ablage` setzt sie in Zeilen um —
   * `dokument` plus erste `dokument_version` mit ihrem SHA-256. Dieselbe
   * Schranke wie bei beiden, und es ist die der Tabelle: `t_mandant` auf
   * `dokument` und `t_version_schreiben` auf `dokument_version` verlangen im
   * WITH CHECK genau `dokument.schreiben`.
   */
  {
    modul: 'dokument', pfad: 'dokument/ablage',
    schreibend: true, schreibRecht: 'dokument.schreiben',
  },

  /**
   * **Einstellen (D-09, EMP-14).** Erst der Mensch, dann die Beschaeftigung —
   * in EINER Transaktion, weil eine `person` ohne Beschaeftigung von dieser
   * Gesellschaft aus unsichtbar ist. Setzt weder Stundensatz noch
   * Wochenstunden (Spiegel der datierten Kondition, genau ein Schreiber,
   * 0192) und legt keinen Portalzugang an. Das Recht steht seit 0367 auch in
   * der Datenbank: `t_person_schreiben` und `t_anstellung_schreiben` (0004)
   * pruefen `personal.schreiben` und liessen bis dahin jede interne Sitzung
   * mit aktivem Bereich schreiben.
   */
  {
    modul: 'personal', pfad: 'personal/einstellung',
    schreibend: true, schreibRecht: 'personal.schreiben',
  },

  /**
   * **Die Stapelmappe (APR-02, APR-04).** Rein LESEND: sie legt zu jedem
   * offenen Vorgang seine geaenderten Felder daneben, damit ein Mensch
   * verantworten kann, was er stapelweise genehmigt. Geschrieben wird in
   * `freigabe/stapel`; auch die Ansichtszeile mit Kanal `stapel` entsteht
   * dort, wo die Entscheidung faellt (APR-08).
   */
  { modul: 'freigabe', pfad: 'freigabe/stapel-mappe', schreibend: false },

  /**
   * **Die Freigabe zur Abrechnung (TIM-12, FIN-07, §7.3).** Schreibt ueber
   * `app.zeit_zur_abrechnung_freigeben` (0366) und nicht mit einem `update`:
   * das Recht gehoert in die Datenbank, nicht nur in die Route — die Funktion
   * prueft `zeit.abrechnung_freigeben` selbst, und die schmale Policy
   * `z_definer_abrechnungsfreigabe` laesst nur abgeschlossene, nicht
   * stornierte, noch nicht freigegebene Zeilen zu. Der Schluessel steht im
   * Katalog und haengt seit D-611/0371 an `super_admin` und `admin`; fuer
   * `leitung` ist er je Gesellschaft anlegbar (D-612).
   */
  {
    modul: 'zeit', pfad: 'zeit/abrechnungsfreigabe',
    schreibend: true, schreibRecht: 'zeit.abrechnung_freigeben',
  },
] as const;

/**
 * `src/server/jobs/**` steht bewusst NICHT im Dienstregister.
 *
 * Jobs laufen als `cse_job`, nicht als `cse_app`, und nie in einer
 * Benutzersitzung — die Frage "ist dieser Dienst in der Gruppenansicht
 * erreichbar" hat fuer sie keine Bedeutung. Sie in dieselbe Liste zu legen
 * hiesse, sie gegen eine Zusage zu pruefen, die ueber sie nichts aussagt.
 */

export const SCHREIBENDE_DIENSTE: readonly DienstEintrag[] =
  DIENSTE.filter((d) => d.schreibend);
