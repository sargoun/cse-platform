/**
 * Eine Bereichszuweisung liess sich nicht ENTZIEHEN.
 *
 * `benutzer_mandant` traegt seit 0007 `grant select, insert, update` fuer
 * `cse_app` — und genau zwei Policies: `t_bm_lesen` (select) und
 * `t_bm_schreiben` (insert). Unter `force row level security` heisst „keine
 * Policy fuer diese Anweisung" nicht „alles erlaubt", sondern „nichts": ein
 * `update`, das `entzogen_am` setzt, trifft null Zeilen.
 *
 * **Was das praktisch bedeutet.** Ein ausgeschiedener Mitarbeiter behaelt
 * seinen Zugang zu der Gesellschaft, aus der ihn jemand entfernt hat — die
 * Oberflaeche meldet Erfolg, die Zeile bleibt stehen, und `app.hat_recht`
 * antwortet weiter `true`. Das ist die schlechteste Sorte Fehler: er sieht aus
 * wie ein erledigter Vorgang.
 *
 * Gefunden hat es die Katalogwache in `tests/isolation/spaltenrechte.test.ts`,
 * nachdem sie von „gibt es IRGENDEINE Policy fuer diese Rolle" auf „gibt es
 * eine fuer DIESE ANWEISUNG" geschaerft wurde. Die erste Fassung (0099-0101)
 * haette diesen Fall nie gemeldet: die Tabelle hat ja Policies, nur nicht die
 * gebrauchte.
 *
 * **Der Zuschnitt ist der des Anlegens** — dieselbe Entscheidung, dieselbe
 * Person, dasselbe Recht (`system.benutzer_verwalten`), derselbe aktive
 * Mandant, keine Gruppenansicht (Invariante 10), kein Nur-Lesen. Wer
 * zuweisen darf, darf entziehen; alles andere waere eine Einbahnstrasse.
 *
 * **`using` UND `with check`, und beide gleich.** `using` entscheidet, welche
 * Zeile ueberhaupt sichtbar ist; `with check`, wie sie danach aussehen darf.
 * Ohne das zweite liesse sich `mandant_id` im Update auf einen fremden Bereich
 * umschreiben — eine Zuweisung, die niemand angelegt hat.
 *
 * **Das aal2-Gate gilt hier genauso.** `p_bm_aal2` war `for insert`; ein
 * Entzug ohne zweiten Faktor waere die offene Seite derselben Tuer. Die
 * restriktive Policy wird deshalb ersetzt durch eine fuer beide Anweisungen.
 *
 * KEIN `for delete`: eine Zuweisung wird entzogen, nicht geloescht
 * (Invariante 8). `entzogen_am` ist die Spur, die spaeter die Frage „wer
 * hatte wann Zugriff" beantwortet.
 */
create policy t_bm_entziehen on benutzer_mandant for update to cse_app
  using (app.hat_recht('system.benutzer_verwalten', mandant_id)
         and mandant_id = app.aktiver_mandant()
         and not app.ist_gruppenansicht()
         and not app.ist_readonly())
  with check (app.hat_recht('system.benutzer_verwalten', mandant_id)
              and mandant_id = app.aktiver_mandant()
              and not app.ist_gruppenansicht()
              and not app.ist_readonly());

drop policy p_bm_aal2 on benutzer_mandant;
create policy p_bm_aal2 on benutzer_mandant as restrictive for insert to cse_app
  with check (app.aal() = 'aal2');
create policy p_bm_aal2_update on benutzer_mandant as restrictive for update to cse_app
  using (app.aal() = 'aal2') with check (app.aal() = 'aal2');
