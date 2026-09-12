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
  { modul: 'finanzen', pfad: 'finanz/xrechnung/aus-snapshot', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/xrechnung/pruefstand', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/xrechnung/dienst', schreibend: false },
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
