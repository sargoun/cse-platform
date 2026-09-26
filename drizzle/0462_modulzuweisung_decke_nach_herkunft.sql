-- 0462 — die Decke der eigenen Module faellt nur fuer die Rolle, aus der das
-- Recht kommt (AUT-01, 03-AUTH §12.1, D-658 Nr. 4, V-237, D-731).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- app.mitgliedschaft_module_setzen (0416, 0461) laesst niemanden mehr Module
-- vergeben, als er selbst haelt (D-658 Nr. 4) — und nahm davon JEDEN mit
-- irgendeiner globalen Rolle aus, ohne zu fragen, ob system.module_zuweisen
-- aus dieser Rolle stammt. Die Begruendung („die globale Rolle traegt keine
-- Schnittmenge") gilt aber nur fuer Rechte, die AUS ihr kommen. Kommt das
-- Recht aus der Mitgliedschaft — eine globale Rolle ohne dieses Recht, oder
-- eine Zeile der Gesellschaft, die es der globalen Rolle hier verweigert, und
-- daneben eine Administration mit Modulliste, an die O-76 das Recht bindet —,
-- vergab das Konto alle Module, obwohl es selbst nur seine Liste haelt.
-- Heute latent: die einzige globale Rolle ist super_admin, und sie haelt das
-- Recht per Vorgabe.
--
-- ===========================================================================
-- Die Aenderung
-- ===========================================================================
--
-- Ausgenommen ist nur, wessen globale Rolle system.module_zuweisen in dieser
-- Gesellschaft selbst gewaehrt — dieselbe Suche wie Zweig 1 in
-- app.hat_recht_fuer (0395): zuerst die Zeile der Gesellschaft, sonst die
-- Vorgabe der Plattform. Den zweiten Faktor, den Zweig 1 fuer eine Rolle mit
-- Pflicht verlangt, hat die Funktion vorher schon selbst verlangt. Jedes
-- andere Konto hat das Recht aus seiner Mitgliedschaft, und deren Modulliste
-- ist die Decke — wie bisher.
--
-- Die Suche ist eine zweite Fassung von Zweig 1 und nicht ein Aufruf von
-- app.hat_recht_fuer: dieser beantwortet „haelt das Konto das Recht", nicht
-- „woher". tests/isolation/mitgliedschaft-module.test.ts §5 haelt beide
-- nebeneinander (globale Rolle mit Recht: keine Decke; Zeile der
-- Gesellschaft, die es verweigert: Decke).
--
-- Aeltere Fassungen dieser Funktion: 0416 (angelegt) und 0461 (Protokoll mit
-- dem Konto vorher und nachher). Alles ausser der Ausnahme ist wortgleich zu
-- 0461.
--
-- Neu gelesen werden berechtigung und rolle_berechtigung. cse_definer haelt
-- darauf seit 0128 select (Spalten) und die breiten Policies
-- d_berechtigung_lesen und d_rb_lesen (using true); die eigenen hier halten
-- auch dann, wenn jene einmal enger werden, und fragen nur das eine Recht.
-- Die Spaltengrants unten stehen schon seit 0128 und nennen, was die
-- Funktion braucht.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie in 0417.

-- ---------------------------------------------------------------------------
-- 0. Was cse_definer dafuer liest
-- ---------------------------------------------------------------------------

grant select (id, schluessel) on berechtigung to cse_definer;
grant select (rolle_id, berechtigung_id, mandant_id, gewaehrt) on rolle_berechtigung to cse_definer;

create policy d_modulzuweisung_recht on berechtigung
  for select to cse_definer
  using (schluessel = 'system.module_zuweisen');
comment on policy d_modulzuweisung_recht on berechtigung is
  'app.mitgliedschaft_module_setzen (0462): nur das eine Recht, dessen Herkunft gefragt wird.';

create policy d_modulzuweisung_rolle_recht on rolle_berechtigung
  for select to cse_definer
  using (berechtigung_id = (select b.id from public.berechtigung b
                             where b.schluessel = 'system.module_zuweisen'));
comment on policy d_modulzuweisung_rolle_recht on rolle_berechtigung is
  'app.mitgliedschaft_module_setzen (0462): nur die Zeilen des einen Rechts — globale Rolle, '
  'Gesellschaft oder Vorgabe der Plattform.';

-- ---------------------------------------------------------------------------
-- 1. Die Funktion
-- ---------------------------------------------------------------------------

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
  -- Schnittmenge (0395, Zweig 1) — aber nur, wenn das Recht auch AUS ihr
  -- kommt. Ausgenommen ist deshalb nur, wessen globale Rolle
  -- system.module_zuweisen in DIESER Gesellschaft selbst gewaehrt: dieselbe
  -- Suche wie Zweig 1 in app.hat_recht_fuer (0395), zuerst die Zeile der
  -- Gesellschaft, sonst die Vorgabe der Plattform. Den zweiten Faktor hat
  -- die Funktion oben schon verlangt. Jede andere Quelle des Rechts ist die
  -- eigene Mitgliedschaft in DIESER Gesellschaft, und deren Modulliste ist
  -- die Decke (0462, V-237).
  select coalesce((
           select rb.gewaehrt
             from public.rolle_berechtigung rb
             join public.berechtigung be on be.id = rb.berechtigung_id
            where rb.rolle_id = b.globale_rolle_id
              and be.schluessel = 'system.module_zuweisen'
              and (rb.mandant_id = v_mandant or rb.mandant_id is null)
            order by rb.mandant_id nulls last
            limit 1), false)
    into v_global
    from public.benutzer b
   where b.id = app.aktueller_benutzer()
     and b.globale_rolle_id is not null
     and b.status = 'aktiv' and b.deaktiviert_am is null;
  v_global := coalesce(v_global, false);
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
  'AUT-01 (0416, 0461, 0462, V-164, V-237): die Module einer Administration im aktiven '
  'Mandanten. NULL = alle Module der Rolle. Verlangt system.module_zuweisen, aal2 und ein '
  'fremdes Konto; die eigenen Module sind die Decke, ausser das Recht kommt aus der globalen '
  'Rolle; protokolliert.';

alter function app.mitgliedschaft_module_setzen(uuid, text[]) owner to cse_definer;
revoke all on function app.mitgliedschaft_module_setzen(uuid, text[]) from public;
grant execute on function app.mitgliedschaft_module_setzen(uuid, text[]) to cse_app;
