-- 0460 — eine Administration entsteht auch nicht ueber Konto oder Fenster
-- (AUT-01, 03-AUTH §12.1, D-610, D-658, D-662, V-236, D-730).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- 0419 (kern.bm_administration_pruefen) sperrt den Anwendungsweg beim
-- Anlegen, Wiederbeleben und Umwidmen einer lebenden Plattform-
-- Administration. Der Ausloeser haengt aber nur an update of rolle_id,
-- entzogen_am; der aus 0416 nur an module, der aus 0007 nur an rolle_id und
-- mandant_id. cse_app haelt seit 0007 ein UPDATE auf die GANZE Zeile, und
-- t_bm_entziehen (0102) schraenkt keine Spalte ein. Mit
-- system.benutzer_verwalten und dem zweiten Faktor gingen damit zwei Wege
-- durch alle Ausloeser:
--
--   1. update benutzer_mandant set benutzer_id = X an einer lebenden
--      Administration ohne Modulliste: das Konto X ist danach eine
--      Administration mit allen Modulen der Rolle — ohne
--      app.verwaltungskonto_einladen (D-610, nur super_admin) und ohne
--      system.module_zuweisen.
--   2. set gueltig_bis = null an einer abgelaufenen, nie entzogenen
--      Administration: app.hat_recht_fuer prueft das Fenster (0395), die
--      Zeile gilt wieder. Dasselbe mit einem frueheren gueltig_ab.
--
-- D-662 Nr. 1 („auf dem Anwendungsweg entsteht keine lebende
-- Administration") war damit nicht vollstaendig wahr.
--
-- ===========================================================================
-- Zwei Linien, und jede haelt allein
-- ===========================================================================
--
-- ERSTE LINIE: Spaltenrechte statt eines Rechts auf die ganze Zeile — das
-- Muster, das 0007 selbst fuer benutzer vorschreibt (K-05: ein Ausloeser,
-- der Spalten vergleicht, ist beim naechsten neuen Feld still
-- unvollstaendig; ein Recht, das ein Feld nicht nennt, ist es nie).
-- Genannt ist, was der Anwendungsweg an einer Mitgliedschaft PFLEGT: Rolle,
-- Modulliste (die 0416 ohnehin auf app.mitgliedschaft_module_setzen
-- verweist), Uebernahme aus der Anstellung (K-14), Standard, Fenster,
-- Entzug mit Grund und Urheber, geaendert_von. Nicht genannt ist, was eine
-- Mitgliedschaft IST: id, benutzer_id, mandant_id — und erstellt_am,
-- erstellt_von, geaendert_am, die ihre Spur sind. Eine Mitgliedschaft
-- wechselt nie das Konto; wer eine fuer ein anderes Konto braucht, legt sie
-- an, und die alte bleibt als Antwort auf „wer hatte wann Zugriff" stehen
-- (Invariante 8). Heute schreibt kein Anwendungscode benutzer_mandant
-- direkt (grep ueber src: nur der Seed, als Eigentuemer); die
-- Definer-Wege (0191, 0249, 0372, 0416) laufen als cse_definer mit eigenen
-- Rechten und sind nicht beruehrt.
--
-- ZWEITE LINIE: kern.bm_administration_pruefen haengt jetzt an JEDEM Update
-- der Zeile, nicht an zwei Spalten, und fragt nicht mehr „welche Spalte hat
-- sich geaendert", sondern „gibt die Zeile danach mehr Administration als
-- vorher". Die Regel (D-730): auf dem Anwendungsweg (current_user = cse_app)
-- darf eine Zeile, die NACH der Anweisung eine lebende Mitgliedschaft mit
-- der Plattformrolle admin ist, nur entstehen, wenn sie VORHER schon eine
-- war — fuer dasselbe Konto, in derselben Gesellschaft, und mit einem
-- Fenster [gueltig_ab, gueltig_bis], das im alten liegt. Verkuerzen geht,
-- Verlaengern, Wiedereroeffnen und Vorziehen nicht; Entziehen und Herabstufen
-- geben ohnehin weniger. Damit faellt, was 0419 sperrte (Anlegen,
-- Wiederbeleben, Umwidmen), unter dieselbe eine Frage wie die zwei Wege
-- oben — und ein kuenftiges Recht auf benutzer_id, das jemand wieder
-- vergibt, oeffnet nichts.
--
-- Wer eine Administration verlaengern will, entzieht die alte Zeile und
-- laedt ueber app.verwaltungskonto_einladen neu ein (0372 nimmt ein
-- vorhandenes Konto an, sobald es in der Gesellschaft keine lebende
-- Mitgliedschaft mehr hat) — derselbe eine Weg wie beim ersten Mal.
--
-- Die Funktion bleibt ohne security definer, wie in 0419: current_user ist
-- der Aufrufer, im Definer cse_definer, im Seed und in Migrationen der
-- Eigentuemer. Aeltere Fassung dieser Funktion: 0419 (die einzige); die
-- Meldung und detail bleiben dieselben, die Pruefungen aus 0419 stecken in
-- der neuen Regel.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie in 0417.

-- ---------------------------------------------------------------------------
-- 1. Die erste Linie: Spaltenrechte
-- ---------------------------------------------------------------------------

revoke update on benutzer_mandant from cse_app;
grant update (rolle_id, module, aus_anstellung, ist_standard, gueltig_ab, gueltig_bis,
              entzogen_am, entzogen_von, entzugsgrund, geaendert_von)
  on benutzer_mandant to cse_app;

-- ---------------------------------------------------------------------------
-- 2. Die zweite Linie: der Ausloeser fragt nach der ganzen Zeile
-- ---------------------------------------------------------------------------

create or replace function kern.bm_administration_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
declare
  v_neu_admin boolean;
  v_alt_admin boolean;
begin
  -- Nur der Anwendungsweg, und nur eine Zeile, die danach lebt.
  if current_user <> 'cse_app' or new.entzogen_am is not null then
    return new;
  end if;

  select r.schluessel = 'admin' and r.mandant_id is null into v_neu_admin
    from public.rolle r
   where r.id = new.rolle_id;
  if not coalesce(v_neu_admin, false) then
    return new;
  end if;

  -- Die Zeile ist danach eine lebende Plattform-Administration. Durch geht
  -- sie nur, wenn sie das vorher schon war — dasselbe Konto, dieselbe
  -- Gesellschaft, und ein Fenster, das im alten liegt.
  if tg_op = 'UPDATE' and old.entzogen_am is null then
    select r.schluessel = 'admin' and r.mandant_id is null into v_alt_admin
      from public.rolle r
     where r.id = old.rolle_id;
    if coalesce(v_alt_admin, false)
       and new.benutzer_id = old.benutzer_id
       and new.mandant_id = old.mandant_id
       and new.gueltig_ab >= old.gueltig_ab
       and (old.gueltig_bis is null
            or (new.gueltig_bis is not null and new.gueltig_bis <= old.gueltig_bis)) then
      return new;
    end if;
  end if;

  raise exception 'Eine Administration entsteht ueber app.verwaltungskonto_einladen, '
                  'ihre Module aendert app.mitgliedschaft_module_setzen.'
    using errcode = '42501', detail = 'administration_nur_ueber_funktion',
          hint = 'AUT-01, D-610, D-658, D-662, D-730: nicht am Anwendungsweg vorbei anlegen, '
                 'wiederbeleben, umwidmen, einem anderen Konto geben oder ihr Fenster '
                 'verlaengern. Entziehen und Verkuerzen bleiben.';
end $$;

comment on function kern.bm_administration_pruefen() is
  'AUT-01, D-662, D-730 (0419, 0460): auf dem Anwendungsweg gibt keine Anweisung einer '
  'Mitgliedschaft mehr Plattform-Administration, als sie vorher hatte — kein Anlegen, '
  'Wiederbeleben, Umwidmen, kein anderes Konto, kein laengeres Fenster. Entziehen und '
  'Verkuerzen bleiben.';

drop trigger trg_bm_administration_pruefen on benutzer_mandant;
create trigger trg_bm_administration_pruefen
  before insert or update on benutzer_mandant
  for each row execute function kern.bm_administration_pruefen();
