-- 0516 — die Hashkette ueber das Pruefprotokoll hat einen Nachtlauf
--        (V-336, O-623, D-791, D-820).
--
-- Die Kette aus 0204 wurde nur beim Bilden eines Beweismittelbuendels
-- fortgeschrieben; zwischen zwei Buendeln blieben Protokollzeilen ungekettet,
-- und app.audit_kette_pruefen rief niemand regelmaessig. Beide Einstiege
-- verlangen system.audit_exportieren — ein Nachtlauf unter cse_job hat keinen
-- Benutzer und bekam 0 bzw. nichts. Voreinstellung (O-623, D-791): naechtlich
-- fortschreiben und nachrechnen, der Befund steht im Nachtlauf-Protokoll.
--
-- (1) kern.audit_glied_hash: die EINE Fassung der Gliedformel. 0204 schrieb
--     sie zweimal aus (fortschreiben, pruefen); ein dritter Schreiber haette
--     die dritte gebracht, und drei Fassungen laufen auseinander. Dieselben
--     Felder, dieselbe Reihenfolge, dieselben Trenner, dasselbe Zeitformat —
--     ein vor 0516 gebildetes Glied rechnet danach gleich.
-- (2) kern.audit_kette_schreiben / kern.audit_kette_rechnen: der Rumpf der
--     beiden Einstiege, ohne Tor, nur fuer cse_definer. Beide nehmen zuerst
--     eine Advisory-Sperre: ein Buendel und der Nachtlauf laesen sonst
--     dieselben ungeketteten Zeilen, und der zweite liefe in den
--     Eindeutigkeitsschluessel auf audit_id.
-- (3) app.audit_kette_fortschreiben / app.audit_kette_pruefen behalten ihre
--     Tore aus 0204 (system.audit_exportieren, nicht in einer lesenden
--     Sitzung) und rufen den Rumpf.
-- (4) kern.audit_kette_nachtlauf: der Einstieg fuer cse_job. Kettet, was
--     fehlt, und rechnet nach — die in diesem Lauf beruehrten Ketten, die
--     beiden juengsten, jede schon einmal gebrochene und die am laengsten
--     nicht gepruefte. So kommt jede Kette reihum wieder dran, ohne dass jede
--     Nacht zehn Jahre Protokoll gerechnet werden.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 1. Die Gliedformel
-- ---------------------------------------------------------------------------

create function kern.audit_glied_hash(p_prev text, a public.audit_log) returns text
language sql stable
set search_path = pg_catalog, public, app
as $$
  select encode(digest(convert_to(
      coalesce(p_prev, '')
      || '|' || a.id::text
      || '|' || coalesce(a.mandant_id::text, '')
      || '|' || a.ebene::text
      || '|' || a.akteur_typ::text
      || '|' || coalesce(a.akteur_id::text, '')
      || '|' || coalesce(a.agent_id::text, '')
      || '|' || a.aktion
      || '|' || a.objekt_typ
      || '|' || coalesce(a.objekt_id, '')
      || '|' || coalesce(a.vorher::text, '')
      || '|' || coalesce(a.nachher::text, '')
      || '|' || coalesce(array_to_string(a.geaendert_felder, ','), '')
      || '|' || coalesce(a.ip::text, '')
      || '|' || coalesce(a.sitzung_id::text, '')
      || '|' || to_char(a.erstellt_am at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'),
      'UTF8'), 'sha256'), 'hex')
$$;

comment on function kern.audit_glied_hash(text, public.audit_log) is
  'V-336, D-820: SHA256 ueber Vorgaengerhash und die beweistragenden Felder einer '
  'Protokollzeile — die eine Fassung der Formel aus 0204.';

alter function kern.audit_glied_hash(text, public.audit_log) owner to cse_definer;
revoke all on function kern.audit_glied_hash(text, public.audit_log) from public;

-- ---------------------------------------------------------------------------
-- 2. Der Rumpf: schreiben und rechnen, ohne Tor
-- ---------------------------------------------------------------------------

create function kern.audit_kette_schreiben(p_grenze integer) returns integer
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_a public.audit_log;
  v_teil text;
  v_partition text;
  v_kette kern.audit_kette;
  v_vorgaenger_id uuid;
  v_prev text;
  v_nr bigint;
  v_hash text;
  v_anzahl integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('kern.audit_kette'));

  -- Die Reihenfolge ist (erstellt_am, id), nicht id — siehe 0204.
  for v_a in
    select a.*
      from public.audit_log a
     where not exists (select 1 from kern.audit_kettenglied g where g.audit_id = a.id)
     order by a.erstellt_am, a.id
     limit p_grenze
  loop
    v_teil := 'audit_log_' || to_char(v_a.erstellt_am at time zone 'UTC', 'YYYY_MM');
    if v_partition is null or v_partition <> v_teil then
      v_partition := v_teil;
      select * into v_kette from kern.audit_kette k
       where k.partition = v_partition for update;
      if not found then
        -- Der Startwert ist der letzte Hash der Vormonatskette und wird
        -- mitgeschrieben (start_hash, 0204).
        select k2.id, k2.letzter_hash into v_vorgaenger_id, v_prev
          from kern.audit_kette k2
         where k2.partition < v_partition
         order by k2.partition desc limit 1;
        insert into kern.audit_kette (partition, vorgaenger_kette_id, start_hash)
        values (v_partition, v_vorgaenger_id, v_prev)
        returning * into v_kette;
      else
        v_prev := v_kette.letzter_hash;
      end if;
      v_nr := v_kette.letzte_nr;
    end if;

    v_nr := v_nr + 1;
    v_hash := kern.audit_glied_hash(v_prev, v_a);

    insert into kern.audit_kettenglied (kette_id, ketten_nr, audit_id, vorheriger_hash, hash)
    values (v_kette.id, v_nr, v_a.id, v_prev, v_hash);

    update kern.audit_kette
       set letzte_nr = v_nr, letzter_hash = v_hash
     where id = v_kette.id;

    v_prev := v_hash;
    v_anzahl := v_anzahl + 1;
  end loop;

  return v_anzahl;
end $$;

comment on function kern.audit_kette_schreiben(integer) is
  'V-336, D-820: kettet bis zu p_grenze ungekettete Protokollzeilen, aelteste zuerst. '
  'Ohne Tor — gerufen nur aus app.audit_kette_fortschreiben und kern.audit_kette_nachtlauf.';

alter function kern.audit_kette_schreiben(integer) owner to cse_definer;
revoke all on function kern.audit_kette_schreiben(integer) from public;

create function kern.audit_kette_rechnen(p_partition text)
  returns table (glieder bigint, bruch_bei bigint, kopf_hash text)
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_kette kern.audit_kette;
  v_g record;
  v_prev text;
  v_hash text;
  v_bruch bigint := null;
  v_anzahl bigint := 0;
begin
  perform pg_advisory_xact_lock(hashtext('kern.audit_kette'));

  select * into v_kette from kern.audit_kette k where k.partition = p_partition;
  if not found then return; end if;

  -- Gegen den festgehaltenen Startwert, nicht gegen den jetzigen Kopf der
  -- Vormonatskette (0204).
  v_prev := v_kette.start_hash;

  for v_g in
    select g.ketten_nr, g.vorheriger_hash, g.hash, a as zeile
      from kern.audit_kettenglied g
      join public.audit_log a on a.id = g.audit_id
     where g.kette_id = v_kette.id
     order by g.ketten_nr
  loop
    v_anzahl := v_anzahl + 1;
    v_hash := kern.audit_glied_hash(v_prev, v_g.zeile);
    if v_hash <> v_g.hash
       or coalesce(v_g.vorheriger_hash, '') <> coalesce(v_prev, '') then
      v_bruch := v_g.ketten_nr;
      exit;
    end if;
    v_prev := v_g.hash;
  end loop;

  update kern.audit_kette
     set geprueft_am = case when v_bruch is null then now() else geprueft_am end,
         gebrochen_bei = v_bruch
   where id = v_kette.id;

  return query select v_anzahl, v_bruch, v_kette.letzter_hash;
end $$;

comment on function kern.audit_kette_rechnen(text) is
  'V-336, D-820: rechnet eine Kette nach, haelt den Befund am Kettenkopf fest und gibt '
  'die erste Abweichung zurueck. Ohne Tor — gerufen nur aus den beiden Einstiegen.';

alter function kern.audit_kette_rechnen(text) owner to cse_definer;
revoke all on function kern.audit_kette_rechnen(text) from public;

-- ---------------------------------------------------------------------------
-- 3. Die beiden Einstiege aus 0204 — Tore wie bisher, Rumpf von oben
-- ---------------------------------------------------------------------------

create or replace function app.audit_kette_fortschreiben(p_grenze integer default 20000)
  returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if not app.hat_recht('system.audit_exportieren') then return 0; end if;
  -- Nicht in der Gruppenansicht: hier wird geschrieben (Invariante 10, 0204).
  if app.ist_readonly() then return 0; end if;
  return kern.audit_kette_schreiben(p_grenze);
end $$;

create or replace function app.audit_kette_pruefen(p_partition text)
  returns table (glieder bigint, bruch_bei bigint, kopf_hash text)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if not app.hat_recht('system.audit_exportieren') then return; end if;
  if not exists (select 1 from kern.audit_kette k where k.partition = p_partition) then
    return;
  end if;
  -- Die Pruefung schreibt ihren Befund — also nicht lesend (0204).
  if app.ist_readonly() then return; end if;
  return query
    select r.glieder, r.bruch_bei, r.kopf_hash from kern.audit_kette_rechnen(p_partition) r;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Der Nachtlauf
-- ---------------------------------------------------------------------------

create function kern.audit_kette_nachtlauf(p_grenze integer default 50000)
  returns table (kette text, glieder bigint, bruch_bei bigint, neu integer)
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_neu integer;
  v_teil text;
  v_r record;
begin
  -- Wer schreibt, sagt es: der Lauf ruft mit nurLesen = false (jobs/auditKette.ts).
  if app.ist_readonly() then
    raise exception 'Der Nachtlauf der Pruefprotokoll-Kette schreibt Kettenglieder; '
                    'die Sitzung ist nur lesend.'
      using errcode = '25006';
  end if;

  v_neu := kern.audit_kette_schreiben(p_grenze);

  for v_teil in
    select k.partition
      from kern.audit_kette k
     where exists (select 1 from kern.audit_kettenglied g
                    where g.kette_id = k.id and g.erstellt_am >= now())
        or k.partition in (select k2.partition from kern.audit_kette k2
                            order by k2.partition desc limit 2)
        or k.gebrochen_bei is not null
        or k.id = (select k3.id from kern.audit_kette k3
                    order by k3.geprueft_am nulls first, k3.partition limit 1)
     order by k.partition
  loop
    select * into v_r from kern.audit_kette_rechnen(v_teil);
    kette := v_teil;
    glieder := v_r.glieder;
    bruch_bei := v_r.bruch_bei;
    neu := v_neu;
    return next;
  end loop;
end $$;

comment on function kern.audit_kette_nachtlauf(integer) is
  'V-336, O-623, D-820: der Nachtlauf der Pruefprotokoll-Kette — kettet, was fehlt, und '
  'rechnet die beruehrten, die beiden juengsten, die gebrochenen und die am laengsten '
  'ungeprueften Ketten nach. Nur fuer cse_job.';

alter function kern.audit_kette_nachtlauf(integer) owner to cse_definer;
revoke all on function kern.audit_kette_nachtlauf(integer) from public;
grant execute on function kern.audit_kette_nachtlauf(integer) to cse_job;
