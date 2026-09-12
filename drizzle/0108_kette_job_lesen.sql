/**
 * Der naechtliche Kettenpruefer konnte zwei seiner vier Tabellen nicht lesen.
 *
 * 0077 gab `cse_job` `select` auf `rechnung_snapshot` und `rechnung_hash`,
 * 0101 zog die fehlenden Policies nach — und `pruefeKette` liest ausserdem
 * `nummernkreis` (die Kreise samt `genesis_hash`/`letzter_hash`) und
 * `rechnung` (Nummer und Summen des Belegs, gegen den die Nutzlast geprueft
 * wird). Auf beiden hatte `cse_job` weder Recht noch Policy.
 *
 * Ausgefallen waere das nicht mit einem Fehler, sondern mit einer Meldung:
 * die Kreisabfrage haette null Zeilen geliefert, die Schleife darunter waere
 * nie gelaufen, und der Lauf haette „keine Abweichung" gemeldet. Ein
 * Manipulationspruefer, der jede Nacht „ok" sagt, ohne etwas gesehen zu
 * haben, ist der teuerste Fall dieses Projekts: er ersetzt Aufmerksamkeit
 * durch Vertrauen und gibt nichts dafuer.
 *
 * **Spalten, nicht Tabellen (K-05).** `rechnung` traegt Kopftext, Fusstext,
 * Kundenbezug, Objektbezug, Zahlungsziel, Steuerhinweise. Ein Pruefer, der
 * Hashes nachrechnet, braucht davon nichts. Er braucht die Kennung, die
 * Nummer, den Status, die drei Summen, die in der Nutzlast stehen — und
 * `nummer_laufend`, weil Postgres das Leserecht auch fuer eine Spalte
 * verlangt, die nur in `order by` steht (dieselbe Falle wie in 0100).
 *
 * `nummernkreis` ebenso: `naechste_nummer`, `format_maske` und
 * `ist_platzhalter` gehen den Pruefer nichts an; `jahr` und `geoeffnet_am`
 * stehen nur wegen der Sortierung mit drin, `kreis_typ` wegen der Bedingung.
 *
 * **Und die Policy bindet den Mandanten, nicht `true`.** Die sieben Policies
 * aus 0101 stehen auf `using (true)`, weil ein Job damals keine Sitzung
 * hatte: was ihn begrenzte, war allein seine Eingabe. Seit
 * `src/server/jobs/sitzung.ts` hat er eine — `alsJobSitzung` setzt
 * `app.mandant_id` und faehrt unter `set local role cse_job`. Damit kann die
 * Wand hier in der DATENBANK stehen statt in der Abfrage:
 * `app.aktiver_mandant()` ist NULL, solange niemand gebunden hat, und
 * `mandant_id = NULL` liefert keine Zeile. Wer den Pruefer ohne Binder
 * registriert, bekommt also nichts zu sehen — und der Isolationstest sagt
 * ihm, dass er nichts sieht, statt ihn „ok" melden zu lassen.
 */
grant select (
  id, mandant_id, kreis_typ, jahr, bezeichnung,
  letzter_hash, vorgaenger_nummernkreis_id, genesis_hash, geoeffnet_am
) on nummernkreis to cse_job;

grant select (
  id, mandant_id, nummer, nummer_laufend, status,
  netto_gesamt_cent, steuer_gesamt_cent, brutto_cent
) on rechnung to cse_job;

create policy t_nummernkreis_job_lesen on nummernkreis
  for select to cse_job
  using (mandant_id = app.aktiver_mandant());

create policy t_rechnung_job_lesen on rechnung
  for select to cse_job
  using (mandant_id = app.aktiver_mandant());
