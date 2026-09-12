/**
 * Sieben Rechte ohne Weg — dieselbe Falle wie in 0096, 0099 und 0100,
 * diesmal vollstaendig.
 *
 * Gefunden hat sie nicht ein Mensch, sondern die Katalogwache in
 * `tests/isolation/spaltenrechte.test.ts`: „jede Rolle mit einem Recht auf
 * einer force-RLS-Tabelle hat dort auch eine Policy". Unter `force row level
 * security` heisst keine anwendbare Policy nicht „alles erlaubt", sondern
 * „nichts". Die Rechte standen also im Katalog, sahen im Quelltext nach
 * Absicht aus — und jede Abfrage von `cse_job` haette null Zeilen geliefert
 * oder mit einem Rechtefehler geendet. Nachts, in einem Prozess, dem niemand
 * zusieht.
 *
 * Jede der sieben Zeilen hat eine ausdrueckliche Absicht in der Migration,
 * die sie gewaehrt hat. Deshalb wird hier NACHGEZOGEN und nicht entzogen:
 *
 *   0012  `grant select, insert, update on versand to cse_job` — die
 *         Ausgangswarteschlange. Wer sie abarbeitet, ist ein Job; ein
 *         Mensch hat dort `select` und sonst nichts.
 *   0041  `grant select on einsatz_medien_bezug to cse_job` — der
 *         Aufbewahrungslauf. `einsatz_medien` hat seine beiden
 *         Job-Policies (`t_job`, `t_job_frist`) bekommen, das Bezugsregister
 *         daneben nicht; ohne das Register kommt der Lauf nicht an die
 *         Bezugsart der Datei, die er behalten oder loeschen soll.
 *   0075  `steuersatz_gruppe`, `masseinheit`, `kleinbetrag_grenze` — die drei
 *         Referenztabellen. Ihr eigener Kommentar sagt: „`using (true)`:
 *         JEDER Scope muss einen Steuersatz lesen koennen". Die Policy stand
 *         dann `to cse_app`, also fuer einen Scope.
 *   0077  `grant select on rechnung_snapshot, rechnung_hash to cse_job` —
 *         woertlich: „Der naechtliche Pruefer liest; schreiben kann er
 *         nichts, und genau deshalb ist sein Befund ein Zeugnis und keine
 *         Tautologie". Der Pruefer haette nichts gelesen.
 *
 * **`using (true)` ist hier kein Verzicht, sondern die einzig richtige
 * Formulierung.** Ein Job hat keine Sitzung: kein `app.aktiver_mandant()`,
 * kein `app.aktueller_benutzer()`, kein Recht. Jede mandantengebundene
 * Bedingung waere in diesem Kontext NULL und wuerde alles ausschliessen —
 * also genau der Zustand, den diese Migration behebt. Was `cse_job`
 * eingrenzt, sind die GRANTS: auf `rechnung_hash` und `rechnung_snapshot`
 * ausschliesslich `select` (0077 entzieht dort insert/update/delete/truncate
 * ausdruecklich), auf den Referenztabellen `select`, auf `versand` genau die
 * drei Rechte, die ein Versandlauf braucht.
 *
 * **Und die Grenze, die bleibt:** `for select` heisst `for select`. Kein
 * `for all`, nirgends — ausser auf `versand`, wo die drei Policies einzeln
 * stehen, damit sichtbar bleibt, dass der Lauf anlegt und quittiert, aber
 * nichts loescht (Invariante 8).
 */

-- Die Ausgangswarteschlange (0012).
create policy t_versand_job_lesen on versand
  for select to cse_job using (true);
create policy t_versand_job_anlegen on versand
  for insert to cse_job with check (true);
create policy t_versand_job_quittieren on versand
  for update to cse_job using (true) with check (true);

-- Das Bezugsregister des Aufbewahrungslaufs (0041).
create policy t_emb_job_lesen on einsatz_medien_bezug
  for select to cse_job using (true);

-- Die drei Referenztabellen (0075) — „JEDER Scope", wie dort geschrieben.
create policy r_lesen_job on steuersatz_gruppe
  for select to cse_job using (true);
create policy r_lesen_job on masseinheit
  for select to cse_job using (true);
create policy r_lesen_job on kleinbetrag_grenze
  for select to cse_job using (true);

-- Der naechtliche Kettenpruefer (0077). Lesen, nie schreiben.
create policy t_snapshot_job_lesen on rechnung_snapshot
  for select to cse_job using (true);
create policy t_hash_job_lesen on rechnung_hash
  for select to cse_job using (true);
