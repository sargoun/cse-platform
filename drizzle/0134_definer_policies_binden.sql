-- ===========================================================================
-- 0134 — Die vier Definer-Policies aus 0132 bekommen ihren Mandantenschnitt
-- ===========================================================================
--
-- **Der Befund, und er stammt von einer Wache.** `tests/isolation/rechnung.test.ts`
-- zaehlt die `cse_definer`-Policies dieser Domaene auf und sagt „und keine
-- weitere". Sie ist damit gefallen, und zwar zu Recht: 0132 hat auf `rechnung`
-- und `buchungssatz` je zwei Policies mit `using (true)` angelegt.
--
-- **Warum `using (true)` hier falsch ist, obwohl es harmlos aussieht.**
-- Permissive Policies werden ODER-verknuepft. `d_rechnung_lesen` schneidet auf
-- den aktiven Mandanten; eine zweite permissive Policy mit `true` daneben hebt
-- diesen Schnitt auf — fuer JEDEN Definer-Aufruf, nicht nur fuer den, der sie
-- brauchte. Die Kommentarzeile in jenem Test benennt genau diese Falle: „eine
-- Verbreiterung, die wie eine Ergaenzung aussieht".
--
-- Der Archivlauf und `app.rechnung_beleg_setzen` laufen beide in einer Sitzung
-- mit gebundenem Mandanten; der Schnitt kostet sie nichts.
--
-- `d_beleg_dokument` (0132, auf `beleg`) bleibt absichtlich `using (true)`:
-- `fin.dokument_haengt_an_buchung` ist ein Loeschriegel und muss die Zeile
-- auch dann sehen, wenn niemand einen Mandanten gebunden hat — etwa beim
-- Loeschversuch als Tabelleneigentuemer. Ein Riegel, der ohne Sitzung blind
-- wird, faellt auf, statt zu halten. Er filtert selbst ueber
-- `b.mandant_id = old.mandant_id`.

drop policy d_rechnung_beleg   on rechnung;
drop policy d_rechnung_beleg_u on rechnung;
drop policy d_bs_beleg         on buchungssatz;
drop policy d_bs_beleg_u       on buchungssatz;

create policy d_rechnung_beleg on rechnung for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_rechnung_beleg_u on rechnung for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

create policy d_bs_beleg on buchungssatz for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_bs_beleg_u on buchungssatz for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

/**
 * Dasselbe fuer `datev_konfiguration` (0133).
 *
 * `app.datev_stammdaten` prueft `app.hat_recht('buchhaltung.lesen', p_mandant)`
 * und liest danach die Zeile. Mit `using (true)` laese es die Stammdaten JEDER
 * Gesellschaft, sobald der Aufrufer irgendwo dieses Recht haelt — der zweite
 * Riegel fehlte. Beraternummer und Mandantennummer sind das, womit sich beim
 * Steuerbuero eine fremde Buchhaltung ansprechen liesse.
 */
drop policy d_datev_konfiguration on datev_konfiguration;
create policy d_datev_konfiguration on datev_konfiguration for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
