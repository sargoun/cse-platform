-- 0143 · Anmeldecode durch die Einsatzleitung; Abwesenheiten fuer den Lohnexport
--        (EMP-01, ACC-12, PR 67, D-487)
--
-- **Zwei kontrollierte Ueberschreitungen, beide unter einem Recht, beide eng.**
--
-- (1) `app.zugang_code_ausstellen` — Solange kein SMS-Gateway verbunden ist
--     (O-82), kommt bei einer Mitarbeiterin kein Code an. Die Plattform
--     taeuscht keinen Versand vor; sie gibt der Einsatzleitung den Weg, den es
--     im Betrieb ohnehin gibt: den Code persoenlich nennen. Wer
--     `personal.zugang_verwalten` haelt, laesst fuer eine Person MIT
--     Beschaeftigung in der aktiven Gesellschaft denselben Einmalcode
--     anlegen, den auch die SMS truege — ueber dieselbe Funktion, mit
--     derselben Bremse (drei offene Codes) und derselben Frist. Die Nummer
--     selbst verlaesst die Funktion nicht: zurueck kommen `ok`, ein Grund und
--     die letzten drei Ziffern. Jede Ausstellung steht im Protokoll mit der
--     Person, nie mit dem Code.
--
-- (2) `app.lohnexport_abwesenheiten` — `abwesenheit.abwesenheitsart_id` ist
--     `cse_app` mit Absicht nicht gewaehrt (0073: der Grund einer Abwesenheit
--     ist gesundheitsnah). Das Lohnbuero braucht ihn trotzdem — Urlaub,
--     Krankheit und Fortbildung sind verschiedene Lohnarten. Die Funktion
--     liefert die Abwesenheiten eines Zeitraums MIT Art, nur unter
--     `zeit.exportieren` und nur fuer die aktive Gesellschaft; sie liest, sie
--     schreibt nichts (stable), und der Abruf des Exports steht im Protokoll
--     der Route.

create function app.zugang_code_ausstellen(
  p_person      uuid,
  p_code_hash   text,
  p_gueltig_bis timestamptz
) returns table (ok boolean, grund text, telefon_maskiert text)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_zugang   uuid;
  v_telefon  text;
  v_gesperrt timestamptz;
  v_ok       boolean;
  v_maske    text;
begin
  if v_mandant is null or not app.hat_recht('personal.zugang_verwalten', v_mandant) then
    raise insufficient_privilege using message =
      'Einen Anmeldecode stellt nur aus, wer Zugänge verwaltet (personal.zugang_verwalten).';
  end if;

  if not exists (
    select 1 from public.anstellung a
     where a.person_id = p_person and a.mandant_id = v_mandant and a.geloescht_am is null
  ) then
    return query select false, 'keine_anstellung'::text, null::text;
    return;
  end if;

  select z.id, z.telefon_e164, z.gesperrt_am
    into v_zugang, v_telefon, v_gesperrt
    from public.mitarbeiter_zugang z
   where z.person_id = p_person;

  if v_zugang is null then
    return query select false, 'kein_zugang'::text, null::text;
    return;
  end if;
  v_maske := '…' || right(v_telefon, 3);
  if v_gesperrt is not null then
    return query select false, 'gesperrt'::text, v_maske;
    return;
  end if;

  -- Dieselbe Funktion wie die SMS-Anforderung: dieselbe Bremse, dieselbe Frist.
  v_ok := app.zugang_code_anfordern(v_telefon, p_code_hash, p_gueltig_bis, null);

  perform app.protokolliere('zugang.code_ausgestellt', 'person', p_person::text, null,
                            jsonb_build_object('ok', v_ok, 'gueltig_bis', p_gueltig_bis,
                                               'weg', 'einsatzleitung'),
                            v_mandant);

  return query select v_ok, case when v_ok then 'ausgestellt' else 'bremse' end, v_maske;
end $$;

comment on function app.zugang_code_ausstellen(uuid, text, timestamptz) is
  'Einmalcode fuer die Mitarbeiter-Anmeldung, ausgestellt durch die Einsatzleitung statt per SMS '
  '(O-82). Nur unter personal.zugang_verwalten, nur fuer Beschaeftigte der aktiven Gesellschaft; '
  'gibt nie die Nummer zurueck; protokolliert jede Ausstellung (D-487).';

alter function app.zugang_code_ausstellen(uuid, text, timestamptz) owner to cse_definer;
revoke execute on function app.zugang_code_ausstellen(uuid, text, timestamptz) from public;
grant execute on function app.zugang_code_ausstellen(uuid, text, timestamptz) to cse_app;

-- ---------------------------------------------------------------------------

create function app.lohnexport_abwesenheiten(p_von date, p_bis date)
returns table (
  id uuid, anstellung_id uuid, art text, bezeichnung text, bezahlt boolean, lohnart text,
  gesundheitsbezogen boolean, von date, bis date, von_halbtags boolean, bis_halbtags boolean,
  tage_angerechnet numeric, status text
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null or not app.hat_recht('zeit.exportieren', v_mandant) then
    raise insufficient_privilege using message =
      'Abwesenheiten mit Art liest nur der Lohnexport (zeit.exportieren).';
  end if;
  return query
    select a.id, a.anstellung_id, art.schluessel, art.bezeichnung, art.bezahlt,
           art.lohnart_schluessel, art.ist_gesundheitsbezogen,
           a.von, a.bis, a.von_halbtags, a.bis_halbtags, a.tage_angerechnet, a.status::text
      from public.abwesenheit a
      join public.abwesenheitsart art on art.id = a.abwesenheitsart_id
     where a.mandant_id = v_mandant
       and a.storniert_am is null
       and a.status in ('genehmigt', 'erfasst')
       and a.von <= p_bis and a.bis >= p_von
     order by a.von, a.id;
end $$;

comment on function app.lohnexport_abwesenheiten(date, date) is
  'Abwesenheiten eines Zeitraums MIT Art fuer den Lohnexport (ACC-12) — die Art ist cse_app '
  'sonst entzogen (0073). Nur unter zeit.exportieren, nur die aktive Gesellschaft (D-487).';

alter function app.lohnexport_abwesenheiten(date, date) owner to cse_definer;
revoke execute on function app.lohnexport_abwesenheiten(date, date) from public;
grant execute on function app.lohnexport_abwesenheiten(date, date) to cse_app;

-- ---------------------------------------------------------------------------
-- (3) `app.planungsbedarf_eigen` — Der Generator lief bisher nur als `cse_job`
--     (nachts). Legt eine Administration eine Serie an, sollen die Schichten
--     sofort entstehen — in ihrer Transaktion, als `cse_app`. `app.planungsbedarf`
--     nimmt den Mandanten als Parameter und bleibt der Jobrolle vorbehalten;
--     dieser Wrapper kennt nur die AKTIVE Gesellschaft und verlangt
--     `dienstplan.schreiben` — dasselbe Recht, das die Serie anlegt.

create function app.planungsbedarf_eigen(p_von date, p_bis date)
returns table (planungsserie_id uuid, quelle einsatz_quelle, carrier_id uuid,
               objekt_id uuid, revier_id uuid, posten_id uuid, veranstaltung_id uuid,
               auftrag_leistung_id uuid, rrule text, dtstart_lokal timestamp, zeitzone text,
               dauer_minuten integer, soll_besetzung smallint, min_besetzung smallint,
               feiertagsregel turnus_feiertagsregel, gueltig_ab date, gueltig_bis date)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null or not app.hat_recht('dienstplan.schreiben', v_mandant) then
    raise insufficient_privilege using message =
      'Den Planungsbedarf liest nur, wer den Dienstplan schreibt (dienstplan.schreiben).';
  end if;
  return query select * from app.planungsbedarf(v_mandant, p_von, p_bis);
end $$;

comment on function app.planungsbedarf_eigen(date, date) is
  'app.planungsbedarf fuer die aktive Gesellschaft, unter dienstplan.schreiben — damit eine neu '
  'angelegte Serie ihre Schichten sofort bekommt, nicht erst im Nachtlauf (D-487).';

alter function app.planungsbedarf_eigen(date, date) owner to cse_definer;
revoke execute on function app.planungsbedarf_eigen(date, date) from public;
grant execute on function app.planungsbedarf_eigen(date, date) to cse_app;

-- Der Wrapper ruft `app.planungsbedarf` als `cse_definer` auf; die Funktion war bisher
-- allein der Jobrolle gewaehrt. Die Definer-Rolle bekommt sie dazu — nicht `cse_app`.
grant execute on function app.planungsbedarf(uuid, date, date) to cse_definer;
