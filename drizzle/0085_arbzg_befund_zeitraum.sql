-- ---------------------------------------------------------------------------
-- 0085 — Ein ArbZG-Befund geht nur an die Gesellschaften, die ihn ANGEHEN
-- ---------------------------------------------------------------------------
--
-- `app.arbzg_befund_schreiben` leitete die betroffenen Gesellschaften so ab:
--
--     select array_agg(distinct a.mandant_id) from public.anstellung a
--      where a.person_id = p_person and a.geloescht_am is null;
--
-- Keine Bedingung auf `status`, keine auf `austritt`. Eine Person, die 2018
-- ein halbes Jahr bei der REALTIME Service GmbH gearbeitet hat und seit 2019
-- nicht mehr, bekam jeden gesellschaftsuebergreifenden Befund von 2026 auch
-- DORT eingetragen — in einer Gesellschaft, die zu dieser Person keine
-- laufende Beziehung mehr hat und den Verstoss nie haette sehen duerfen.
--
-- Das ist kein Anzeigefehler, sondern ein Riss in der Mandantenwand: die alte
-- Gesellschaft liest in `arbeitszeit_verstoss` Person, Regel, Zeitraum und
-- Dauer. K-06 erlaubt genau EINE Ueberschreitung (`app.arbzg_belastung`), und
-- die gibt Zahlen zurueck, nie eine Zeile in einer fremden Tabelle.
--
-- **Die richtige Bedingung ist die UEBERSCHNEIDUNG mit dem Befundzeitraum.**
-- Nicht „aktiv heute": ein Befund ueber den Maerz 2026 geht die Gesellschaft
-- an, die im Maerz 2026 beschaeftigt hat — auch wenn das Verhaeltnis
-- inzwischen endete. Und eine Gesellschaft, die erst im Mai anfing, geht er
-- nichts an, auch wenn sie heute beschaeftigt. Die Frage ist nie „wer kennt
-- die Person", sondern „wer war zu DIESER Zeit ihr Arbeitgeber".
--
-- Dieselbe Bedingung steht jetzt auch im `insert`: `anstellung_id` griff mit
-- `limit 1` irgendeine Zeile heraus — moeglicherweise die laengst beendete,
-- und dann zeigte der Befund auf ein Arbeitsverhaeltnis, das es zur Tatzeit
-- nicht gab.
--
-- Und der Konfliktzweig fuehrt `schwere` und `betrifft_fremden_mandant` nach.
-- Er tat es nicht: wurde aus einem einzelgesellschaftlichen Befund am
-- naechsten Tag ein gesellschaftsuebergreifender, blieb die Zeile auf
-- `betrifft_fremden_mandant = false` stehen — und der Dienstplan sagte
-- „Arbeitszeit ueberschritten" statt „ueber Gesellschaften hinweg". Genau die
-- Unterscheidung, fuer die 0064 geschrieben wurde.
-- ---------------------------------------------------------------------------

create or replace function app.arbzg_befund_schreiben(
  p_person uuid,
  p_regel arbzg_regel,
  p_schwere verstoss_schwere,
  p_beginn timestamptz,
  p_ende timestamptz,
  p_ist_minuten integer,
  p_grenzwert integer,
  p_ursache jsonb,
  p_mandanten uuid[]
) returns setof uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_aufrufer uuid := app.aktiver_mandant();
        v_mandanten uuid[] := p_mandanten;
        v_m uuid;
        v_von date := (p_beginn at time zone 'Europe/Berlin')::date;
        v_bis date := (p_ende   at time zone 'Europe/Berlin')::date;
begin
  if v_aufrufer is not null then
    if not app.hat_recht('dienstplan.arbzg_pruefen', v_aufrufer)
       or not exists (select 1 from public.anstellung a
                       where a.person_id = p_person and a.mandant_id = v_aufrufer
                         and a.geloescht_am is null)
    then raise exception 'nicht berechtigt' using errcode = '42501'; end if;
  elsif session_user <> 'cse_job' then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  /*
   * `null` heisst: alle Gesellschaften, die zur TATZEIT beschaeftigt haben.
   *
   * Eine leere Ableitung ist KEIN stiller Durchlauf: gibt es keine solche
   * Beschaeftigung, ist der Befund nicht zuzuordnen, und die Funktion hebt.
   */
  if v_mandanten is null then
    select array_agg(distinct a.mandant_id) into v_mandanten
      from public.anstellung a
     where a.person_id = p_person
       and a.geloescht_am is null
       and a.eintritt <= v_bis
       and (a.austritt is null or a.austritt >= v_von);
  end if;
  if v_mandanten is null or array_length(v_mandanten, 1) is null then
    raise exception 'kein Mandant fuer diesen Befund' using errcode = 'P0002';
  end if;

  foreach v_m in array v_mandanten loop
    return query
    insert into public.arbeitszeit_verstoss
          (mandant_id, person_id, anstellung_id, regel, schwere,
           zeitraum_beginn, zeitraum_ende, ist_minuten, grenzwert_minuten,
           betrifft_fremden_mandant, ursache, fingerprint, erkannt_durch, erstellt_von_art)
    select v_m, p_person, a.id, p_regel, p_schwere, p_beginn, p_ende, p_ist_minuten, p_grenzwert,
           array_length(v_mandanten, 1) > 1,
           zeit_intern.ursache_fuer_mandant(p_ursache, v_m),   -- foreign windows reduced, §5.11
           encode(digest(v_m::text || p_person::text || p_regel::text ||
                         (p_beginn at time zone 'Europe/Berlin')::date::text, 'sha256'), 'hex'),
           (case when v_aufrufer is null then 'detektor_job' else 'planung_live' end)::erkennung_quelle,
           'system'
      from public.anstellung a
     where a.person_id = p_person and a.mandant_id = v_m and a.geloescht_am is null
       and a.eintritt <= v_bis
       and (a.austritt is null or a.austritt >= v_von)
     -- Die zur Tatzeit laufende Beschaeftigung, nicht irgendeine: die juengste
     -- passende. `limit 1` ohne `order by` ist eine Auswahl ohne Regel.
     order by a.eintritt desc
     limit 1
    on conflict (mandant_id, fingerprint) where hinfaellig_am is null
    do update set ist_minuten = excluded.ist_minuten, ursache = excluded.ursache,
                  zeitraum_beginn = excluded.zeitraum_beginn,
                  zeitraum_ende = excluded.zeitraum_ende,
                  schwere = excluded.schwere,
                  betrifft_fremden_mandant = excluded.betrifft_fremden_mandant,
                  geaendert_am = now()
    returning id;
  end loop;

  perform app.protokolliere('arbzg.befund_geschrieben', 'person', p_person::text,
            null, jsonb_build_object('regel', p_regel, 'mandanten', v_mandanten));
end $$;

comment on function app.arbzg_befund_schreiben(
  uuid, arbzg_regel, verstoss_schwere, timestamptz, timestamptz, integer, integer, jsonb, uuid[]
) is
  'Schreibt einen ArbZG-Befund in jede Gesellschaft, die zur TATZEIT '
  'beschaeftigt hat (K-06) — nicht in jede, die die Person je kannte. '
  'p_mandanten = null heisst: aus dem Befundzeitraum ableiten.';
