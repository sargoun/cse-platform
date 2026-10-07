-- 0509 — Teams pflegen (V-378, O-650, D-813).
--
-- team und team_mitglied (0230) fuellte nur der Seed; Kalender und Aufgaben
-- lesen sie. Jetzt legt eine Gesellschaft Teams an und ordnet Beschaeftigungen
-- zu (kalender.schreiben, wie die Policies aus 0230 es schon verlangen). Eine
-- Mitgliedschaft endet, statt zu verschwinden: beendet_am und beendet_von
-- halten fest, wer bis wann im Team war — eine Teamaufgabe von gestern bleibt
-- erklaerbar.
--
-- Daraus folgt zweierlei:
--   (1) eindeutig ist nur die LAUFENDE Mitgliedschaft je Team und
--       Beschaeftigung; nach dem Ende darf dieselbe Beschaeftigung wieder
--       zugeordnet werden.
--   (2) wer ausgetreten ist, sieht die Aufgaben des Teams nicht mehr:
--       t_aufgabe_eigene und p_zustaendig (0230) fragen nur noch laufende
--       Mitgliedschaften.
--
-- Die Rolle im Team bleibt Text; die Vorschlagsliste (Leitung,
-- Stellvertretung, Mitglied, Springer) steht im Dienst (O-650, D-799).
--
-- Nur Kommentare mit Doppelstrich.

alter table team_mitglied
  add column beendet_am timestamptz,
  add column beendet_von uuid references benutzer(id);

alter table team_mitglied add constraint tm_beendet_mit_namen check (
  beendet_am is null or beendet_von is not null);

alter table team_mitglied drop constraint tm_uk;
create unique index tm_laufend_uk on team_mitglied (team_id, anstellung_id)
  where beendet_am is null;

-- (2) Die Aufgabenpolicies aus 0230, mit dem laufenden Fenster.

drop policy t_aufgabe_eigene on aufgabe;
create policy t_aufgabe_eigene on aufgabe for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and (zugewiesen_an = app.aktueller_benutzer()
              or erstellt_von = app.aktueller_benutzer()
              or (zugewiesen_team_id is not null
                  and zugewiesen_team_id in (select tm.team_id from team_mitglied tm
                                              where tm.person_id = app.aktuelle_person()
                                                and tm.beendet_am is null))));

drop policy p_zustaendig on aufgabe;
create policy p_zustaendig on aufgabe as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or zugewiesen_an = app.aktueller_benutzer()
         or erstellt_von = app.aktueller_benutzer()
         or (zugewiesen_team_id is not null
             and zugewiesen_team_id in (select tm.team_id from team_mitglied tm
                                         where tm.person_id = app.aktuelle_person()
                                           and tm.beendet_am is null)));

comment on column team_mitglied.beendet_am is
  'V-378, D-813: Ende der Mitgliedschaft; die Zeile bleibt. Eindeutig ist nur die laufende '
  'Mitgliedschaft je Team und Beschaeftigung (tm_laufend_uk).';
