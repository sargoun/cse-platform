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
 * Menschen und die beiden Spalten, die sagen, ob der Zugang gilt. Ein
 * `grant select on benutzer` waere bequemer und gaebe einem Prozess, der um
 * drei Uhr nachts ohne Aufsicht laeuft, das Adressbuch der Belegschaft dazu.
 *
 * `deaktiviert_am` steht mit in der Liste, weil die Abfrage deckungsgleich
 * mit `benutzer_person_key` sein muss — dem eindeutigen Index aus 0007, der
 * EIN Login je Mensch erzwingt (EMP-14). Nur mit `deaktiviert_am is null`
 * liefert sie hoechstens eine Zeile, und zwar nach Schema statt nach Hoffnung.
 * Der erste Entwurf gewaehrte stattdessen `erstellt_am`, um nach ihm zu
 * SORTIEREN — Postgres verlangt das Leserecht naemlich auch fuer eine Spalte,
 * die nur in `order by` steht. Sortiert wurde, weil der Code mehrere Zugaenge
 * fuer moeglich hielt; das Schema laesst sie nicht zu.
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
grant select (id, person_id, status, deaktiviert_am) on benutzer to cse_job;

create policy t_benutzer_job_empfaenger on benutzer
  for select to cse_job
  using (true);
