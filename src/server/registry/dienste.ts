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
  { modul: 'finanzen', pfad: 'finanz/geld', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/steuer/satz', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/hash-chain', schreibend: false },
  {
    modul: 'nummernkreis', pfad: 'finanz/nummernkreis',
    schreibend: true, schreibRecht: 'nummernkreis.ziehen',
  },
  { modul: 'finanzen', pfad: 'finanz/menge', schreibend: false },
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
