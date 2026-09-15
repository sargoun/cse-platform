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
  { modul: 'zeit', pfad: 'zeit/dauer', schreibend: false },
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
  {
    modul: 'zeit', pfad: 'zeit/korrektur',
    schreibend: true, schreibRecht: 'zeit.korrigieren',
  },
  /**
   * „Aktuell im Einsatz" ZAEHLT nur (DSH-05) — in der Gruppenansicht ist
   * daran nichts gefaehrlich, und schreiben kann es nicht.
   */
  { modul: 'zeit', pfad: 'zeit/live', schreibend: false },
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
   * Die Medienerfassung PRUEFT und LEGT AB — in den Bucket, nicht in die
   * Datenbank. Die `einsatz_medien`-Zeile schreibt
   * `app.offline_ereignis_annehmen`, weil dort Mandant, Beschaeftigung und
   * Mensch aus der Marke aufgeloest werden. Was dieser Dienst tut, ist in der
   * Gruppenansicht ungefaehrlich: er kann keine Zeile anlegen, und der Lesepfad
   * gibt nur eine signierte Adresse zurueck, die RLS zuvor freigegeben hat.
   */
  { modul: 'zeit', pfad: 'zeit/medien', schreibend: false },
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
  { modul: 'nachweis', pfad: 'mitarbeiter/nachweise', schreibend: false },
  { modul: 'zeit', pfad: 'mitarbeiter/antraege', schreibend: false },
  { modul: 'zeit', pfad: 'mitarbeiter/felder', schreibend: false },
  /**
   * PR 42 — die eigenen Dienstanweisungen. LESEND: der Schreibweg der
   * Bestaetigung liegt in `security/dienstanweisung` und steht dort mit
   * seinem Recht.
   */
  { modul: 'dienstanweisung', pfad: 'mitarbeiter/dienstanweisungen', schreibend: false },

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
  /* D-487 — Serien anlegen; Anmeldecode durch die Einsatzleitung. */
  {
    modul: 'dienstplan', pfad: 'dienstplan/serie',
    schreibend: true, schreibRecht: 'dienstplan.schreiben',
  },
  {
    modul: 'personal', pfad: 'personal/zugangscode',
    schreibend: true, schreibRecht: 'personal.zugang_verwalten',
  },
  {
    modul: 'dokument', pfad: 'dokument/aufbewahrung',
    schreibend: true, schreibRecht: 'dokument.aufbewahrung_verwalten',
  },
  {
    modul: 'dokument', pfad: 'dokument/loeschung',
    schreibend: true, schreibRecht: 'dokument.archivieren',
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
   * Die Gruppenansicht (TEN-05, D-475) — vier Leser, kein Schreiber.
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
