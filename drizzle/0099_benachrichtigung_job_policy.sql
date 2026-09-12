/**
 * `cse_job` darf Benachrichtigungen schreiben — und konnte es nicht.
 *
 * 0011 hat die Rechte vergeben:
 *
 *   -- Benachrichtigungen schreibt der Dienst, nicht der Benutzer.
 *   grant select, insert on benachrichtigung to cse_job;
 *
 * und keine Policy dazugelegt. `benachrichtigung` traegt `enable row level
 * security` UND `force row level security`; die beiden vorhandenen Policies
 * gelten `to cse_app`. Fuer `cse_job` gab es damit KEINE anwendbare Policy —
 * und keine Policy heisst unter RLS nicht „alles erlaubt", sondern „nichts".
 * Jeder Einfuegeversuch des Nachtlaufs waere an
 * `new row violates row-level security policy` gescheitert.
 *
 * **Warum das bis heute niemand gemerkt hat:** es gab keinen Nachtlauf.
 * `src/server/jobs/` war vollstaendig gebaut und nirgends verdrahtet, also
 * hat nie ein Prozess als `cse_job` eine Benachrichtigung geschrieben. Die
 * Luecke im Recht und die Luecke in der Verdrahtung haben sich gegenseitig
 * unsichtbar gemacht — der Grant sah nach Absicht aus, und die Absicht war
 * richtig; sie war nur nicht ausfuehrbar.
 *
 * Dieselbe Bauart wie der Befund hinter 0096: ein `grant execute` ohne den
 * Eigentuemer. Ein Recht ist kein Weg.
 *
 * **Zuschnitt.** `for insert` und `for select`, getrennt, und nicht
 * `for all`: der Job LEGT AN und liest, was er angelegt hat. Er soll nichts
 * aendern und nichts loeschen — `gelesen_am` setzt der Mensch im Portal
 * (`t_benachrichtigung_lesen_setzen`, `to cse_app`), und eine Meldung, die
 * ein Job zuruecknehmen kann, ist keine Meldung.
 *
 * `with check (true)` ist hier der ehrliche Ausdruck: eine Einschraenkung auf
 * einen Mandanten gibt es nicht, weil dieser Schreiber keinen hat — er laeuft
 * uebergreifend, und das ist bei `nachweis_warnungen` sogar zwingend (ein
 * Nachweis haengt am Menschen und traegt kein `mandant_id`, D-09). Was die
 * Zeile bindet, sind die Fremdschluessel: `mandant_id` und `empfaenger_id`
 * muessen existieren, `art`, `titel`, `text`, `ziel`, `objekt_typ` sind
 * `not null`. Die Rolle selbst ist der Zuschnitt: `cse_job` haelt auf dieser
 * Tabelle `select, insert` und sonst nichts.
 */
create policy t_benachrichtigung_job_anlegen on benachrichtigung
  for insert to cse_job
  with check (true);

create policy t_benachrichtigung_job_lesen on benachrichtigung
  for select to cse_job
  using (true);
