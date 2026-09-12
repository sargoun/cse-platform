/**
 * Der Nachtlauf muss den EMPFAENGER finden — und konnte die Tabelle nicht
 * lesen, in der er steht.
 *
 * `benachrichtigung.empfaenger_id` ist ein `benutzer`. Die Quelle einer
 * Ablaufwarnung kennt aber eine `person` (D-09: der Mensch und sein Zugang
 * sind zwei Dinge, und ein `nachweis` haengt am Menschen). Dazwischen liegt
 * genau eine Abfrage — `select id from benutzer where person_id = …` —, und
 * `cse_job` hatte auf `benutzer` weder ein Leserecht noch eine Policy.
 *
 * Der Nachtlauf waere also an `permission denied for table benutzer`
 * gescheitert, NACHDEM er die Quittungen in `nachweis_warnung` geschrieben
 * hat. Beim naechsten Lauf haetten die Quittungen die Stufen abgefangen: die
 * Warnung waere weg gewesen, ohne dass sie je jemand bekommen hat. Gefunden
 * hat das nicht ein Mensch, sondern der erste Test, der die Zustellung
 * ueberhaupt unter `cse_job` ausfuehrt.
 *
 * **Vier Spalten, nicht die Tabelle (K-05).** `benutzer` traegt E-Mail, Name,
 * Sprache, letzte IP, letzter Login. Nichts davon braucht ein Nachtlauf, um
 * eine Meldung zuzustellen — er braucht die Kennung, die Verknuepfung zum
 * Menschen, die Auskunft, ob der Zugang aktiv ist, und `erstellt_am`. Ein
 * `grant select on benutzer` waere bequemer und gaebe einem Prozess, der um
 * drei Uhr nachts ohne Aufsicht laeuft, das Adressbuch der Belegschaft dazu.
 *
 * `erstellt_am` steht mit in der Liste, weil es SORTIERT wird, und Postgres
 * verlangt das Leserecht auch fuer eine Spalte, die nur in `order by` steht —
 * nicht nur fuer die, die in der Ergebnisliste auftaucht. Der erste Entwurf
 * gewaehrte drei Spalten und sortierte ueber die vierte; der Fehler lautete
 * dann `permission denied for table benutzer` und nannte die Spalte nicht.
 * Sortiert wird ueberhaupt, weil EMP-14 einen Zugang je Person verlangt: sind
 * es doch zwei, entscheidet der aeltere, und zwar reproduzierbar.
 *
 * **Und eine Policy, nicht nur ein Grant.** Dieselbe Falle wie in 0099 und
 * 0096: `benutzer` traegt `force row level security`, die beiden vorhandenen
 * Policies gelten `to cse_app`. Ohne eigene Policy liest `cse_job` null
 * Zeilen — das Recht waere da, der Weg nicht, und der Unterschied faellt
 * genau dann auf, wenn niemand hinsieht.
 *
 * Der Zuschnitt der Policy ist `for select` und `using (true)`: der Job
 * loest Empfaenger auf, und welche Person er dabei trifft, bestimmt seine
 * Eingabe, nicht seine Sitzung — eine hat er nicht. Was ihn begrenzt, sind
 * die drei Spalten darueber.
 */
grant select (id, person_id, status, erstellt_am) on benutzer to cse_job;

create policy t_benutzer_job_empfaenger on benutzer
  for select to cse_job
  using (true);
