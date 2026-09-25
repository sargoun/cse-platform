-- 0461 — die Protokollzeile der Modulzuweisung nennt nur, was sich aenderte
-- (SEC-A9, AUT-01, V-164, V-237, D-731).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- app.mitgliedschaft_module_setzen (0416) schreibt system.module_zugewiesen
-- mit vorher = {module} und nachher = {module, benutzer_id}. app.protokolliere
-- (0415, dieselbe Berechnung seit 0004) zaehlt als geaendert jedes Feld aus
-- nachher, dessen Wert in vorher ein anderer ist — und ein Feld, das in
-- vorher fehlt, ist dort NULL. Jede Zeile trug deshalb
-- geaendert_felder = {benutzer_id, module}: eine Kontoaenderung, die nie
-- stattfand, im Pruefprotokoll einer Rechtevergabe.
--
-- ===========================================================================
-- Die Aenderung
-- ===========================================================================
--
-- Das Konto steht in vorher UND nachher. Es ist der Bezug der Zeile (wessen
-- Module), keine Aenderung, und wer das Protokoll liest, findet es auf beiden
-- Seiten. Geaendert wird nichts an app.protokolliere: dort ist die Regel
-- „ein Feld nur in nachher ist neu" fuer andere Aufrufer richtig, und der
-- heisseste Pfad der Plattform bekommt keine neue Fassung fuer einen Fehler
-- an einer Stelle.
--
-- Aeltere Fassung dieser Funktion: 0416 (angelegt dort, die einzige). Alles
-- andere ist wortgleich zu 0416 — dieselben Pruefungen in derselben
-- Reihenfolge, dieselbe Decke, dasselbe UPDATE. create or replace laesst
-- Eigentuemer (cse_definer), Grants, die Policy d_bm_module_setzen und das
-- Spaltenrecht update (module, geaendert_von) aus 0416 stehen; Eigentuemer
-- und Ausfuehrungsrecht werden unten trotzdem ausdruecklich gesetzt.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie in 0417.

create or replace function app.mitgliedschaft_module_setzen(p_mitgliedschaft uuid, p_module text[])
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

  -- Das Konto steht vorher UND nachher: es ist der Bezug der Zeile, keine
  -- Aenderung. Nur nachher genannt, zaehlte app.protokolliere es in
  -- geaendert_felder mit (0461, V-237).
  perform app.protokolliere('system.module_zugewiesen', 'benutzer_mandant',
                            p_mitgliedschaft::text,
                            jsonb_build_object('module', v_bm.module,
                                               'benutzer_id', v_bm.benutzer_id),
                            jsonb_build_object('module', v_neu,
                                               'benutzer_id', v_bm.benutzer_id),
                            v_mandant);
  return true;
end $$;


comment on function app.mitgliedschaft_module_setzen(uuid, text[]) is
  'AUT-01 (0416, 0461, V-164, V-237): die Module einer Administration im aktiven Mandanten. '
  'NULL = alle Module der Rolle. Verlangt system.module_zuweisen, aal2 und ein fremdes Konto; '
  'protokolliert — das Konto als Bezug vorher und nachher, geaendert ist nur module.';

alter function app.mitgliedschaft_module_setzen(uuid, text[]) owner to cse_definer;
revoke all on function app.mitgliedschaft_module_setzen(uuid, text[]) from public;
grant execute on function app.mitgliedschaft_module_setzen(uuid, text[]) to cse_app;
