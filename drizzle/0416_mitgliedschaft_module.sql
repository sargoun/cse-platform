-- 0416 — die Module einer Administration lassen sich zuweisen (AUT-01, V-164,
-- D-658).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- SPEC AUT-01: „Admin — assigned modules within assigned areas". Die Spalte
-- dafuer steht seit 0007 in benutzer_mandant.module (NULL = alle Module der
-- Rolle, sonst Schnittmenge), und app.hat_recht_fuer wertet sie seit 0008
-- aus, zuletzt in der Fassung aus 0395. Geschrieben hat sie niemand: keine
-- Funktion, keine Route, keine Oberflaeche, auch nicht der Seed. Jede
-- Administration hielt damit ALLE Module ihrer Rolle. 03-AUTH §7.1 verlangt
-- ausserdem einen Ausloeser, der die Werte gegen den Modulkatalog prueft
-- (bm_module_pruefen); auch den gab es nicht.
--
-- ===========================================================================
-- Die drei Teile
-- ===========================================================================
--
--  1. kern.bm_module_pruefen — der Ausloeser aus 03-AUTH §7.1. Jeder Wert
--     muss ein Modul des Katalogs sein (select distinct modul from
--     berechtigung), die leere Liste gibt es nicht (sie hiesse „kein Recht in
--     dieser Gesellschaft", und dafuer gibt es den Entzug), und die Liste
--     wird sortiert und ohne Doppel gespeichert — dieselbe Menge ist dann
--     dieselbe Zeile. Dazu: der ANWENDUNGSWEG (current_user = cse_app) aendert
--     die Spalte nie direkt. t_bm_entziehen (0102) gibt cse_app ein UPDATE auf
--     die ganze Zeile unter system.benutzer_verwalten, und ohne diese Sperre
--     koennte jede Administration mit diesem Recht ihre eigene Modulliste auf
--     NULL setzen — genau das Risiko, das 03-AUTH §12.1 an
--     system.module_zuweisen haengt. Dasselbe Muster wie
--     kern.person_stammdaten_schutz (0190): im Definer ist current_user
--     cse_definer, im Seed und in Migrationen postgres.
--  2. app.mitgliedschaft_module_setzen — der eine Schreibweg. Er verlangt
--     genau einen aktiven Mandanten ohne Lesemodus (Invariante 10), den
--     zweiten Faktor (K-15), system.module_zuweisen IM aktiven Mandanten, eine
--     lebende Mitgliedschaft DIESES Mandanten mit der Plattformrolle admin,
--     und ein FREMDES Konto: wer seine eigene Liste erweitern koennte, haette
--     keine. Und niemand vergibt mehr, als er selbst haelt: wessen eigene
--     Mitgliedschaft in dieser Gesellschaft auf Module beschraenkt ist, weist
--     nur eine Teilmenge davon zu, und nie „alle Module der Rolle". Sonst
--     reichten zwei beschraenkte Konten mit system.module_zuweisen, um
--     einander ueber Kreuz alles zu geben (heute haelt das Recht nur die
--     Plattformrolle super_admin; O-76 kann es an admin binden). Die globale
--     Rolle haelt ihre Rechte in jedem Bereich ohne Schnittmenge (Zweig 1 in
--     app.hat_recht_fuer, 0395) und ist deshalb nicht beschraenkt. Er
--     schreibt audit_log.
--  3. d_bm_module_setzen — die eigene Policy fuer cse_definer, eng auf den
--     aktiven Mandanten. d_bm_aus_anstellung_entziehen (0191) deckt das UPDATE
--     heute schon (using true); die eigene Policy haelt auch dann, wenn jene
--     einmal enger wird.
--
-- Nur die Plattformrolle admin, und das ist eine Entscheidung (D-658): SPEC
-- §3 nennt die Modulzuweisung nur fuer sie. leitung ist „own business area
-- only", mitarbeiter und kunde haben ihre Decken (K-04), und eine eigene
-- Rolle einer Gesellschaft IST bereits ein Zuschnitt ihrer Rechte (AUT-03).
--
-- Die Rechte gelten mit der naechsten Anfrage (03-AUTH §7.3, kein Cache);
-- eine laufende Sitzung muss dafuer nicht enden.

-- ---------------------------------------------------------------------------
-- 1. Der Ausloeser
-- ---------------------------------------------------------------------------

create function kern.bm_module_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
declare v_unbekannt text[];
begin
  if new.module is not null then
    if cardinality(new.module) = 0 then
      raise exception 'Eine Modulliste ohne Modul gibt es nicht — ohne Recht in dieser '
                      'Gesellschaft ist ein Entzug, keine Zuweisung.'
        using errcode = '22023', detail = 'keine_module';
    end if;
    select array_agg(x order by x) into v_unbekannt
      from unnest(new.module) as x
     where x is null
        or not exists (select 1 from public.berechtigung b where b.modul = x);
    if v_unbekannt is not null then
      raise exception 'Unbekannte Module: %', array_to_string(v_unbekannt, ', ', '(leer)')
        using errcode = '22023', detail = 'unbekanntes_modul',
              hint = 'Erlaubt sind die Module des Rechtekatalogs (select distinct modul from berechtigung).';
    end if;
    new.module := (select array_agg(distinct x order by x) from unnest(new.module) as x);
  end if;

  if current_user = 'cse_app'
     and ((tg_op = 'INSERT' and new.module is not null)
          or (tg_op = 'UPDATE' and new.module is distinct from old.module)) then
    raise exception 'Module werden ueber app.mitgliedschaft_module_setzen zugewiesen.'
      using errcode = '42501', detail = 'nur_ueber_funktion',
            hint = 'AUT-01, 03-AUTH §12.1: system.module_zuweisen, zweiter Faktor, fremdes Konto.';
  end if;
  return new;
end $$;

comment on function kern.bm_module_pruefen() is
  'AUT-01, 03-AUTH §7.1 (0416): benutzer_mandant.module nur mit Modulen des Katalogs, '
  'nie leer, sortiert ohne Doppel — und nie direkt aus dem Anwendungsweg.';

create trigger trg_bm_module_pruefen
  before insert or update of module on benutzer_mandant
  for each row execute function kern.bm_module_pruefen();

-- ---------------------------------------------------------------------------
-- 2. Die Policy fuer den Schreibweg
-- ---------------------------------------------------------------------------

grant update (module, geaendert_von) on benutzer_mandant to cse_definer;

create policy d_bm_module_setzen on benutzer_mandant
  for update to cse_definer
  using (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

comment on policy d_bm_module_setzen on benutzer_mandant is
  'app.mitgliedschaft_module_setzen (0416): nur Mitgliedschaften des aktiven Mandanten.';

-- ---------------------------------------------------------------------------
-- 3. Der Schreibweg
-- ---------------------------------------------------------------------------

create function app.mitgliedschaft_module_setzen(p_mitgliedschaft uuid, p_module text[])
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_bm      record;
  v_neu     text[];
  v_global  boolean;
  v_eigene  text[];
  v_mehr    text[];
begin
  if v_mandant is null or app.ist_gruppenansicht() then
    raise exception 'Module zuweisen verlangt genau einen aktiven Mandanten.'
      using errcode = '42501', hint = 'Die Gruppenansicht ist lesend (Invariante 10).';
  end if;
  if app.ist_readonly() then
    raise exception 'Diese Sitzung ist lesend.' using errcode = '42501';
  end if;
  if app.aal() <> 'aal2' then
    raise exception 'Module zuweisen verlangt den zweiten Faktor.'
      using errcode = '42501', hint = 'K-15.';
  end if;
  if not app.hat_recht('system.module_zuweisen', v_mandant) then
    raise exception 'Module zuweisen verlangt system.module_zuweisen.'
      using errcode = '42501';
  end if;

  select bm.id, bm.benutzer_id, bm.module, r.schluessel, r.mandant_id as rolle_mandant
    into v_bm
    from public.benutzer_mandant bm
    join public.rolle r on r.id = bm.rolle_id
   where bm.id = p_mitgliedschaft
     and bm.mandant_id = v_mandant
     and bm.entzogen_am is null;
  if not found then
    -- Dieselbe Antwort fuer „gibt es nicht" und „gehoert einer anderen
    -- Gesellschaft" (AUT-06).
    raise exception 'Diese Mitgliedschaft gibt es hier nicht.' using errcode = 'P0002';
  end if;
  if v_bm.schluessel <> 'admin' or v_bm.rolle_mandant is not null then
    raise exception 'Module werden nur einer Administration zugewiesen.'
      using errcode = '22023', detail = 'nur_admin';
  end if;
  if v_bm.benutzer_id = app.aktueller_benutzer() then
    raise exception 'Die eigene Modulliste aendert ein anderes Konto.'
      using errcode = '42501', detail = 'eigenes_konto',
            hint = '03-AUTH §12.1: eine Administration, die ihre eigene Liste erweitert, hat keine.';
  end if;

  -- Dieselbe Normalform wie im Ausloeser, damit „unveraendert" erkannt wird;
  -- die Pruefung selbst macht der Ausloeser beim Schreiben.
  if p_module is not null then
    v_neu := (select array_agg(distinct x order by x) from unnest(p_module) as x);
    if v_neu is null then
      raise exception 'Eine Modulliste ohne Modul gibt es nicht.'
        using errcode = '22023', detail = 'keine_module';
    end if;
  end if;
  if v_neu is not distinct from v_bm.module then
    return false;
  end if;

  -- Niemand vergibt mehr, als er selbst haelt. Die globale Rolle traegt keine
  -- Schnittmenge (0395, Zweig 1); jede andere Quelle des Rechts ist die eigene
  -- Mitgliedschaft in DIESER Gesellschaft, und deren Modulliste ist die Decke.
  select exists (select 1 from public.benutzer b
                  where b.id = app.aktueller_benutzer()
                    and b.globale_rolle_id is not null
                    and b.status = 'aktiv' and b.deaktiviert_am is null)
    into v_global;
  if not v_global then
    select bm.module into v_eigene
      from public.benutzer_mandant bm
     where bm.benutzer_id = app.aktueller_benutzer()
       and bm.mandant_id = v_mandant
       and bm.entzogen_am is null;
    if v_eigene is not null then
      if v_neu is null then
        raise exception 'Alle Module vergibt nur, wer selbst alle haelt.'
          using errcode = '42501', detail = 'ueber_eigene_module';
      end if;
      select array_agg(x order by x) into v_mehr
        from unnest(v_neu) as x
       where not (x = any (v_eigene));
      if v_mehr is not null then
        raise exception 'Zugewiesen werden nur eigene Module; nicht gehalten: %',
                        array_to_string(v_mehr, ', ')
          using errcode = '42501', detail = 'ueber_eigene_module';
      end if;
    end if;
  end if;

  update public.benutzer_mandant
     set module = v_neu, geaendert_von = app.aktueller_benutzer()
   where id = p_mitgliedschaft;

  perform app.protokolliere('system.module_zugewiesen', 'benutzer_mandant',
                            p_mitgliedschaft::text,
                            jsonb_build_object('module', v_bm.module),
                            jsonb_build_object('module', v_neu,
                                               'benutzer_id', v_bm.benutzer_id),
                            v_mandant);
  return true;
end $$;

comment on function app.mitgliedschaft_module_setzen(uuid, text[]) is
  'AUT-01 (0416, V-164): die Module einer Administration im aktiven Mandanten. NULL = alle '
  'Module der Rolle. Verlangt system.module_zuweisen, aal2 und ein fremdes Konto; protokolliert.';

alter function app.mitgliedschaft_module_setzen(uuid, text[]) owner to cse_definer;
revoke all on function app.mitgliedschaft_module_setzen(uuid, text[]) from public;
grant execute on function app.mitgliedschaft_module_setzen(uuid, text[]) to cse_app;
