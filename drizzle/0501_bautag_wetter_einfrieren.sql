-- 0501 — Ein abgeschlossener Bautag friert auch sein Wetter ein
--        (V-328, O-158, BAU-06, BAU-07, BAU-08, D-808).
--
-- `kern.bautagebuch_einfrieren` (0082) nennt die Inhaltsspalten des Tages.
-- Die Wetterspalten kamen erst mit 0083 dazu — Fremdschluessel koennen ihrem
-- Ziel nicht vorausgehen (0082, Absatz c) —, und das Einfrieren wurde nie
-- nachgezogen. Ein geschlossener Tag liess sich damit im Wetter noch
-- aendern: Werte, Quelle, Notiz und das Kennzeichen
-- `arbeitsbehindernde_witterung`, auf das sich eine Behinderungsanzeige
-- stuetzt (BAU-06). Ein Beleg, der sich nach dem Abschluss umschreiben
-- laesst, belegt nichts.
--
-- Seit V-328 setzt die Bauleitung das Kennzeichen (`setzeWitterung`) — nur am
-- offenen Tag. Der Wetterlauf und das Anheften schreiben ebenfalls nur offene
-- Tage (`abgeschlossen_am is null`, `bau/wetter.ts`); fuer sie aendert sich
-- nichts. Korrigiert wird, wie beim uebrigen Tag, durch Storno und Ersatztag.
--
-- `create or replace`: Eigentum, Ausloeser und Rechte bleiben. Der Rumpf ist
-- der aus 0082, ergaenzt um die zehn Spalten aus 0083.

create or replace function kern.bautagebuch_einfrieren() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.abgeschlossen_am is null then return new; end if;

  if new.projekt_id is distinct from old.projekt_id
     or new.datum is distinct from old.datum
     or new.arbeitsbeginn is distinct from old.arbeitsbeginn
     or new.arbeitsende is distinct from old.arbeitsende
     or new.besondere_vorkommnisse is distinct from old.besondere_vorkommnisse
     or new.bemerkungen is distinct from old.bemerkungen
     or new.behinderung_id is distinct from old.behinderung_id
     or new.abgeschlossen_am is distinct from old.abgeschlossen_am
     -- 0083: das Wetter des Tages und die Aussage der Bauleitung dazu.
     or new.wetter_quelle is distinct from old.wetter_quelle
     or new.wetter_frueh_id is distinct from old.wetter_frueh_id
     or new.wetter_mittag_id is distinct from old.wetter_mittag_id
     or new.wetter_abend_id is distinct from old.wetter_abend_id
     or new.wetter_snapshot is distinct from old.wetter_snapshot
     or new.temperatur_min_c is distinct from old.temperatur_min_c
     or new.temperatur_max_c is distinct from old.temperatur_max_c
     or new.niederschlag_mm is distinct from old.niederschlag_mm
     or new.wetter_notiz is distinct from old.wetter_notiz
     or new.arbeitsbehindernde_witterung is distinct from old.arbeitsbehindernde_witterung then
    raise exception 'Ein abgeschlossener Bautag ist unveraenderlich (BAU-07, LEG-01)'
      using errcode = 'check_violation',
            hint = 'Korrigiert wird durch Storno und einen Ersatztag, nie durch Aendern.';
  end if;

  if new.status is distinct from old.status
     and new.status not in ('gegengezeichnet','abgeschlossen') then
    raise exception 'Ein abgeschlossener Bautag faellt nicht in den Entwurf zurueck'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function kern.bautagebuch_einfrieren() is
  'BAU-07, LEG-01: ab abgeschlossen_am bewegt sich kein Inhalt des Tages mehr — '
  'seit 0501 auch nicht sein Wetter und das Witterungskennzeichen (V-328).';
