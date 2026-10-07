-- 0502 — die Modulbuchung einer Gesellschaft eintragen (V-298, O-355, D-809).
--
-- mandant.module (0001) und module_gepflegt (0103) schrieb bis hierher nur
-- der Seed. Die Seite Einstellungen › Module zeigte die Buchung und sagte, ein
-- Eingabeweg fehle. Voreinstellung (O-355, D-784): die Super-Administration
-- traegt die Buchung beim Vertragsschluss ein.
--
-- Ein Definer mit dem Tor aus 0494 — genau eine aktive Gesellschaft, keine
-- Gruppenansicht (Invariante 10), keine lesende Sitzung, zweiter Faktor —
-- und dazu eine Super-Administration (app.ist_super_admin) mit
-- system.module_zuweisen. Das Recht allein reicht nicht: es ist an eine
-- Administration bindbar (03-AUTH §12), und eine Gesellschaft bucht ihre
-- Gewerke nicht selbst.
--
-- Gebucht werden die Gewerke (reinigung, security, bau); der Querschnitt
-- haengt an keinem Gewerk und wird nicht gebucht (registry/modul.ts). Eine
-- leere Buchung ist erlaubt und heisst „kein Gewerk" — die Aussage der CSE
-- Operations (0103).
--
-- Wer eingetragen hat und wann, steht an der Zeile: der Seed ueberschreibt
-- eine eingetragene Buchung nicht mehr, und die Seite unterscheidet den
-- Seed-Stand von einer Eintragung. Jede Aenderung schreibt trg_mandant_audit
-- (0005) mit vorher und nachher ins Protokoll (TEN-09).
--
-- Nur Kommentare mit Doppelstrich.

alter table mandant
  add column module_eingetragen_am  timestamptz,
  add column module_eingetragen_von uuid references benutzer (id);

comment on column mandant.module_eingetragen_am is
  'V-298: wann die Super-Administration die Modulbuchung eingetragen hat. NULL = '
  'Seed-Stand oder nie eingetragen; der Seed ueberschreibt nur dann.';
comment on column mandant.module_eingetragen_von is
  'V-298: wer die Modulbuchung eingetragen hat (Super-Administration).';

-- Die Zeilenregel ist die aus 0494 (d_mandant_angaben_pflegen): der Definer
-- aendert nur die aktive Gesellschaft. Hier kommen nur die Spalten dazu.
grant update (module, module_gepflegt, module_eingetragen_am, module_eingetragen_von)
  on mandant to cse_definer;

-- Gibt zurueck, ob sich etwas geaendert hat. Dieselbe Buchung zweimal
-- abzuschicken ist kein Fehler; einen Seed-Stand zu bestaetigen ist eine
-- Eintragung und wird festgehalten.
create function app.mandant_module_buchen(p_gewerke text[]) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_neu text[];
  v_zahl integer;
begin
  if v_mandant is null or app.ist_gruppenansicht() then
    raise exception 'Die Modulbuchung traegt man in genau einer aktiven Gesellschaft ein.'
      using errcode = '42501', hint = 'Die Gruppenansicht ist lesend (Invariante 10).';
  end if;
  if app.ist_readonly() then
    raise exception 'Diese Sitzung ist lesend.' using errcode = '42501';
  end if;
  if app.aal() <> 'aal2' then
    raise exception 'Die Modulbuchung verlangt den zweiten Faktor.'
      using errcode = '42501', hint = 'K-15.';
  end if;
  -- Erst das Recht, dann die Super-Administration: wer das Recht nicht haelt,
  -- erfaehrt nicht, wer die Buchung eintraegt (AUT-06).
  if not app.hat_recht('system.module_zuweisen', v_mandant) then
    raise exception 'Die Modulbuchung verlangt system.module_zuweisen.'
      using errcode = '42501';
  end if;
  if not app.ist_super_admin() then
    raise exception 'Die Modulbuchung traegt die Super-Administration ein.'
      using errcode = '42501', detail = 'nur_super_admin',
            hint = 'O-355: beim Vertragsschluss, nicht von der Gesellschaft selbst.';
  end if;

  if p_gewerke is null then
    raise exception 'Die Gewerke fehlen.' using errcode = '22023', detail = 'keine_angabe';
  end if;
  if exists (select 1 from unnest(p_gewerke) g
              where g is null or g not in ('reinigung', 'security', 'bau')) then
    raise exception 'Gebucht werden nur die Gewerke reinigung, security und bau.'
      using errcode = '22023', detail = 'unbekanntes_gewerk';
  end if;
  v_neu := array(select distinct g from unnest(p_gewerke) g order by g);

  update public.mandant m
     set module = v_neu,
         module_gepflegt = true,
         module_eingetragen_am = now(),
         module_eingetragen_von = app.aktueller_benutzer()
   where m.id = v_mandant
     and (m.module is distinct from v_neu
          or not m.module_gepflegt
          or m.module_eingetragen_am is null);
  get diagnostics v_zahl = row_count;
  return v_zahl > 0;
end $$;

comment on function app.mandant_module_buchen(text[]) is
  'V-298, D-809: traegt die gebuchten Gewerke der aktiven Gesellschaft ein '
  '(reinigung, security, bau; leer = kein Gewerk) und setzt module_gepflegt. '
  'Verlangt eine Super-Administration mit system.module_zuweisen und aal2. Gibt '
  'zurueck, ob sich etwas geaendert hat.';

alter function app.mandant_module_buchen(text[]) owner to cse_definer;
revoke execute on function app.mandant_module_buchen(text[]) from public;
grant execute on function app.mandant_module_buchen(text[]) to cse_app;
