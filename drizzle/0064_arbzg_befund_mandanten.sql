-- ---------------------------------------------------------------------------
-- 0064 — `app.arbzg_befund_schreiben` leitet die Gesellschaften ab, wenn der
--        Aufrufer sie nicht nennen KANN
--
-- Die Funktion aus `0039` schreibt den Befund in jede Gesellschaft aus
-- `p_mandanten`. Der Aufrufer in `services/arbzg/pruefung.ts` übergab dafür
-- `null` — und `foreach v_m in array null` läuft null Mal. Ergebnis: der
-- Zweig `schreiben: true` schrieb nichts, `arbeitszeit_verstoss` blieb leer,
-- und die Konfliktkarte im Eingang zeigte nie eine Regel, weil sie ihren Text
-- über `planungs_konflikt.arbeitszeit_verstoss_id` liest. Ein stiller
-- Fehlschlag: kein Fehler, keine Zeile, nichts zu sehen.
--
-- **Warum der Aufrufer die Liste nicht nennen kann.** K-06 ist genau darauf
-- gebaut: `app.arbzg_belastung` gibt Dauern und Grenzen zurück und sagt über
-- die fremde Gesellschaft nur DASS, nie welche. Der Dienst weiss deshalb, dass
-- ein Befund über Gesellschaften hinweg entstand — aber nicht, über welche.
-- Ihn danach fragen zu lassen, hiesse die Wand einzureissen, die die ganze
-- Konstruktion trägt.
--
-- **Die Ableitung gehört deshalb hierher**, in die Definer-Funktion, die
-- ohnehin alles sehen darf: `null` heisst ab jetzt „jede Gesellschaft, in der
-- diese Person beschäftigt ist" — die Lesart, die § 2 Abs. 1 ArbZG für einen
-- gesellschaftsübergreifenden Verstoss verlangt (er gilt in beiden). Ein
-- Befund, der NUR im eigenen Haus entstand, nennt seine Gesellschaft weiterhin
-- selbst und landet auch nur dort; sonst erführe eine unbeteiligte
-- Gesellschaft, dass diese Person anderswo zu lange gearbeitet hat.
--
-- Alles andere bleibt: dieselbe Rechteprüfung, dieselbe Reduktion der Ursache
-- je Gesellschaft (`zeit_intern.ursache_fuer_mandant`), derselbe
-- Fingerabdruck, dieselbe Auditzeile.
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

  /**
   * `null` heisst: alle Gesellschaften dieser Person — der Fall K-06.
   *
   * Eine leere Ableitung ist KEIN stiller Durchlauf: gibt es keine
   * Beschaeftigung, ist der Befund nicht zuzuordnen, und die Funktion hebt.
   * Zurueckzukehren, als sei nichts gewesen, waere genau der Fehler, den
   * diese Migration behebt.
   */
  if v_mandanten is null then
    select array_agg(distinct a.mandant_id) into v_mandanten
      from public.anstellung a
     where a.person_id = p_person and a.geloescht_am is null;
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
     limit 1
    on conflict (mandant_id, fingerprint) where hinfaellig_am is null
    do update set ist_minuten = excluded.ist_minuten, ursache = excluded.ursache,
                  zeitraum_beginn = excluded.zeitraum_beginn, zeitraum_ende = excluded.zeitraum_ende,
                  geaendert_am = now()
    returning id;
  end loop;

  perform app.protokolliere('arbzg.befund_geschrieben', 'person', p_person::text,
            null, jsonb_build_object('regel', p_regel, 'mandanten', v_mandanten));
end $$;

comment on function app.arbzg_befund_schreiben(
  uuid, arbzg_regel, verstoss_schwere, timestamptz, timestamptz, integer, integer, jsonb, uuid[]
) is
  'Schreibt einen ArbZG-Befund in jede betroffene Gesellschaft (K-06). '
  'p_mandanten = null heisst: jede Gesellschaft, in der die Person beschäftigt '
  'ist — die Lesart für einen gesellschaftsübergreifenden Verstoss, dessen '
  'fremde Seite der Aufrufer nicht kennen darf.';
