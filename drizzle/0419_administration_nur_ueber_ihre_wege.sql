-- 0419 — eine Administration entsteht nicht am Anwendungsweg vorbei
-- (AUT-01, 03-AUTH §12.1, D-610, D-658, V-168, D-662).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- kern.bm_module_pruefen (0416) sperrt den Anwendungsweg (cse_app) nur beim
-- SETZEN einer Modulliste. Eine Kontoverwaltung mit system.benutzer_verwalten
-- kommt auf Datenbankebene trotzdem zu einer Administration mit ALLEN Modulen
-- der Rolle, ohne system.module_zuweisen und ohne die Decke der eigenen
-- Module (D-658 Nr. 4):
--
--   1. eine beschraenkte Administration entziehen (t_bm_entziehen, 0102: ein
--      UPDATE auf entzogen_am, und der Ausloeser aus 0416 haengt an update of
--      module) und mit module = NULL neu anlegen (t_bm_schreiben, 0007);
--   2. eine entzogene, unbeschraenkte Administration wiederbeleben
--      (entzogen_am zurueck auf NULL);
--   3. eine andere Mitgliedschaft per UPDATE rolle_id zur Administration
--      machen.
--
-- Heute nimmt kein Anwendungscode diese Wege: nichts unter src schreibt
-- benutzer_mandant direkt. Die zweite Linie soll aber gerade dann halten,
-- wenn einmal jemand einen solchen Weg baut.
--
-- ===========================================================================
-- Die Regel (D-662)
-- ===========================================================================
--
-- Auf dem Anwendungsweg (current_user = cse_app) entsteht keine LEBENDE
-- Mitgliedschaft mit der Plattformrolle admin — weder durch INSERT noch durch
-- ein UPDATE, das eine Mitgliedschaft zur lebenden Administration macht
-- (rolle_id wechselt auf admin, oder entzogen_am geht von gesetzt auf leer).
--
-- Eine Administration hat genau zwei Wege, und beide laufen als cse_definer:
-- app.verwaltungskonto_einladen (0372, D-610: system.verwaltungskonto_erstellen,
-- nur super_admin) legt sie an, app.mitgliedschaft_module_setzen (0416) aendert
-- ihre Module. Seed und Migration laufen als Eigentuemer. Keiner davon ist
-- beruehrt.
--
-- Was bleibt: das ENTZIEHEN einer Administration (entzogen_am setzen) und jede
-- andere Aenderung an einer lebenden Administration, die sie nicht erst dazu
-- macht (ist_standard, gueltig_bis). Und jede andere Rolle — leitung,
-- mitarbeiter, kunde — kennt keine Modulliste (0416: nur die Plattformrolle
-- admin) und ist hier nicht gemeint.
--
-- Ein eigener Ausloeser und keine neue Fassung von kern.bm_module_pruefen:
-- jener haengt an update of module und pruefte den Katalog; dieser haengt an
-- rolle_id und entzogen_am und prueft den Weg. Eine Funktion ohne security
-- definer, wie 0416: current_user ist dann der Aufrufer, im Definer
-- cse_definer, im Seed postgres. rolle liest der Anwendungsweg ueber
-- t_rolle_lesen (0007), dieselbe Lesung wie kern.bm_rolle_pruefen.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie in 0417.

create function kern.bm_administration_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
declare v_admin boolean;
begin
  if current_user <> 'cse_app' or new.entzogen_am is not null then
    return new;
  end if;

  select r.schluessel = 'admin' and r.mandant_id is null into v_admin
    from public.rolle r
   where r.id = new.rolle_id;
  if not coalesce(v_admin, false) then
    return new;
  end if;

  if tg_op = 'INSERT'
     or old.entzogen_am is not null
     or old.rolle_id is distinct from new.rolle_id then
    raise exception 'Eine Administration entsteht ueber app.verwaltungskonto_einladen, '
                    'ihre Module aendert app.mitgliedschaft_module_setzen.'
      using errcode = '42501', detail = 'administration_nur_ueber_funktion',
            hint = 'AUT-01, D-610, D-658, D-662: nicht am Anwendungsweg vorbei anlegen, '
                   'wiederbeleben oder umwidmen.';
  end if;
  return new;
end $$;

comment on function kern.bm_administration_pruefen() is
  'AUT-01, D-662 (0419): auf dem Anwendungsweg entsteht keine lebende Mitgliedschaft mit der '
  'Plattformrolle admin — kein INSERT, kein Wiederbeleben, kein Umwidmen. Entziehen bleibt.';

create trigger trg_bm_administration_pruefen
  before insert or update of rolle_id, entzogen_am on benutzer_mandant
  for each row execute function kern.bm_administration_pruefen();
