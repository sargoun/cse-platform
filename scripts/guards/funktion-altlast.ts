/**
 * **Die Altlast der mehrfach ersetzten Datenbankfunktionen — sie darf nur
 * schrumpfen.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Ausfall, gegen den die Wache geschrieben ist. Er ist passiert.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kern.angebot_versand_pruefen` entstand in `0024` mit der Prüfung auf offene
 * Kalkulationswerte. `0295` ERSETZTE sie und legte Invariante 7 hinein: ohne
 * benannten Menschen verlässt nichts das Haus. `0392` (V-130) brauchte zwei
 * weitere Prüfungen darin, ging von der 0024-Fassung aus — und löschte damit
 * die Preisfreigabe.
 *
 * Danach fiel ein Versand ohne Freigabe nur noch am CHECK
 * `angebot_freigabe_vor_versand` auf, mit „violates check constraint" statt
 * dem Satz über den fehlenden Arbeitsschritt. Ein Versand aus
 * `status = 'in_pruefung'` wäre am CHECK ganz vorbeigelaufen, weil dessen
 * erster Zweig genau diesen Status erlaubt — `0295` sagt das an dieser Stelle
 * selbst, im Kommentar, den der Ersetzende nicht mehr gelesen hat.
 *
 * Die Migration lief durch, `tsc` war still, der Linter auch. Gefunden hat es
 * eine Isolationsprüfung, zwei Gates später.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum diese Liste und kein „ab jetzt sauber".**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Neunzehn Stellen im Baum ersetzen eine Funktion, ohne die frühere Migration
 * zu nennen. Sie alle sofort rot zu machen hiesse, die Wache am ersten Tag
 * neunzehnmal zu brechen — und eine Sperrklinke mit Fehlalarmen wird nach dem
 * dritten Mal abgeschaltet und meldet dann gar nichts mehr.
 *
 * **Die Liste sagt NICHT, dass dort etwas fehlt** — sie sagt, dass es niemand
 * geprüft hat. Wer eine dieser Funktionen das nächste Mal anfasst, liest die
 * ältere Fassung, nennt ihre Nummer im Kommentar und streicht die Zeile.
 *
 * Jeder Eintrag ist `<neueste Migration>:<Funktion>`.
 *
 * **Eigene Datei und nicht in `run-all.ts`**, damit das Prüfstück
 * (`tests/kern/funktion-mehrfach-ersetzt.test.ts`) sie lesen kann, ohne den
 * Wächterlauf mitzustarten — `run-all.ts` ruft am Ende `process.exit`.
 */
export const FUNKTION_ALTLAST: ReadonlySet<string> = new Set([
  '0085:app.arbzg_befund_schreiben',
  '0094:app.arbzg_befund_ueberholen',
  '0169:app.benutzer_mit_recht',
  '0169:app.darf_gruppenansicht',
  '0149:app.hat_recht',
  '0169:app.hat_recht_fuer',
  '0069:app.ist_eingesetzt_auf_objekt',
  '0375:app.ist_mitglied',
  '0169:app.kalender_feed_aufloesen',
  '0375:app.katalog_positionen',
  '0169:app.kennwort_anmelden',
  '0375:app.leistungswerte_lesen',
  '0162:app.projekt_kennzahlen',
  '0162:app.projekt_lohnkosten',
  '0138:app.sitzung_aufloesen',
  '0169:app.switcher_mandanten',
  '0013:fin.nummernkreis_pruefen',
  '0141:kern.setze_aufbewahrung',
  '0018:kern.sitzung_wechsel_audit',
]);
