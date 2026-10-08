-- 0534 — Die Turnusse einer Pauschale fuer ihre Abrechnung lesen
--        (V-327, O-146, O-700, D-783, D-789, D-850, CLN-02, FIN-01)
--
-- Der Befund: turnus_ausnahme.abrechnungsrelevant ist „ja" vorbelegt
-- (O-700, D-783) — ein Ausfall mindert die Pauschale, ein Zusatztermin wird
-- berechnet —, aber monatspauschale.ts las die Ausnahmen nicht; die Rechnung
-- entstand aus der Pauschale allein. Voreinstellung (O-146, D-789): Minderung
-- um den Anteil des Termins, Pauschale geteilt durch die Termine des Monats;
-- ein Zusatztermin als eigene Zeile.
--
-- Warum eine Definer-Funktion und keine Abfrage im Dienst: turnus und
-- turnus_ausnahme liest cse_app nur mit reinigung.lesen. Wer abrechnet, liest
-- die Vereinbarung mit abrechnung.lesen — haelt er reinigung.lesen nicht,
-- filtert RLS STILL, die Ausnahmen fehlen, und die Rechnung verlangt die
-- volle Pauschale fuer ausgefallene Termine. Dieselbe Lage wie bei den
-- erfassten Minuten (fin.auftrag_erfasste_minuten, 0107): die Funktion gibt
-- genau, was die Rechnung braucht — die Regel, die Gueltigkeit, Tag, Art und
-- Abrechnungsrelevanz der Ausnahmen —, keinen Grundtext, keine Person.
--
-- Welche Turnusse: die an der Leistungszeile der Vereinbarung haengen; gilt
-- die Vereinbarung fuer den ganzen Auftrag, die an seinen Leistungszeilen,
-- die im Zeitraum keine eigene Vereinbarung haben (die rechnet ihre selbst
-- ab). Archivierte nicht; die Gueltigkeit des Turnus schneidet sein Fenster.
--
-- Geprueft wie jeder Definer, der sich nicht auf den Aufrufer verlaesst:
-- aktive Gesellschaft, abrechnung.lesen, die Vereinbarung gehoert ihr.
--
-- Nur Kommentare mit Doppelstrich.

create function fin.turnusse_der_abrechnung(p_konfiguration uuid, p_von date, p_bis date)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_va       record;
  v_ergebnis jsonb;
begin
  if v_mandant is null then
    raise exception 'Turnusse der Abrechnung: nur in einer Gesellschaft'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('abrechnung.lesen', v_mandant) then
    raise exception 'Turnusse der Abrechnung: liest, wer abrechnung.lesen haelt'
      using errcode = 'insufficient_privilege';
  end if;
  if p_von is null or p_bis is null or p_von > p_bis then
    raise exception 'Turnusse der Abrechnung: kein Zeitraum (% bis %)', p_von, p_bis
      using errcode = 'invalid_parameter_value';
  end if;

  select v.mandant_id, v.auftrag_id, v.auftrag_leistung_id into v_va
    from public.vertrag_abrechnung v where v.id = p_konfiguration;
  if not found or v_va.mandant_id is distinct from v_mandant then
    raise exception 'Vereinbarung % gehoert nicht zum aktiven Mandanten (Invariante 3)', p_konfiguration
      using errcode = 'insufficient_privilege';
  end if;

  with leistung as (
    select l.id from public.auftrag_leistung l
     where l.auftrag_id = v_va.auftrag_id
       and (case when v_va.auftrag_leistung_id is not null
                 then l.id = v_va.auftrag_leistung_id
                 else not exists (
                   select 1 from public.vertrag_abrechnung e
                    where e.auftrag_leistung_id = l.id
                      and e.gueltig_ab <= p_bis
                      and (e.gueltig_bis is null or e.gueltig_bis >= p_von)) end)
  ),
  t as (
    select t.id, t.rrule,
           to_char(t.dtstart_lokal, 'YYYY-MM-DD') as anker_datum,
           extract(hour from t.dtstart_lokal)::int as anker_stunde,
           extract(minute from t.dtstart_lokal)::int as anker_minute,
           t.dauer_minuten, t.feiertagsregel::text as feiertagsregel,
           to_char(t.gueltig_ab, 'YYYY-MM-DD') as gueltig_ab,
           to_char(t.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis
      from public.turnus t
     where t.mandant_id = v_mandant and t.archiviert_am is null
       and t.auftrag_leistung_id in (select id from leistung)
       and t.gueltig_ab <= p_bis and (t.gueltig_bis is null or t.gueltig_bis >= p_von)
  )
  select jsonb_build_object(
           'turnusse', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from t), '[]'::jsonb),
           'ausnahmen', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', a.id, 'turnus_id', a.turnus_id,
                      'datum', to_char(a.datum, 'YYYY-MM-DD'), 'art', a.art::text,
                      'abrechnungsrelevant', a.abrechnungsrelevant)
                    order by a.datum, a.id)
               from public.turnus_ausnahme a
              where a.mandant_id = v_mandant and a.turnus_id in (select id from t)
                and a.datum between p_von and p_bis), '[]'::jsonb))
    into v_ergebnis;
  return v_ergebnis;
end $$;

comment on function fin.turnusse_der_abrechnung(uuid, date, date) is
  'V-327, O-146, D-850: Regel, Gueltigkeit und Ausnahmen (Tag, Art, Abrechnungsrelevanz) der '
  'Turnusse einer Pauschalvereinbarung — fuer die Minderung bei Ausfall und den Zusatztermin. '
  'Mit abrechnung.lesen, ohne reinigung.lesen: RLS filterte sonst still.';

alter function fin.turnusse_der_abrechnung(uuid, date, date) owner to cse_definer;
revoke all on function fin.turnusse_der_abrechnung(uuid, date, date) from public;
grant execute on function fin.turnusse_der_abrechnung(uuid, date, date) to cse_app;

-- Die Lesepfade. turnus (d_planungsbedarf), auftrag und auftrag_leistung (0107)
-- liest cse_definer schon; die Vereinbarung bisher nur ohne Gueltigkeit (0340).
grant select (gueltig_ab, gueltig_bis) on vertrag_abrechnung to cse_definer;
grant select (id, mandant_id, turnus_id, datum, art, abrechnungsrelevant)
  on turnus_ausnahme to cse_definer;

create policy d_turnus_ausnahme_abrechnung on turnus_ausnahme for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

comment on policy d_turnus_ausnahme_abrechnung on turnus_ausnahme is
  'V-327, D-850: fin.turnusse_der_abrechnung liest Tag, Art und Abrechnungsrelevanz der '
  'Ausnahmen der aktiven Gesellschaft — den Grundtext nicht (Spaltenliste).';
