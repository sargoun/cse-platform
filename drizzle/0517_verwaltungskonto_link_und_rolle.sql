-- 0517 — ein Verwaltungskonto bekommt einen neuen Link und eine andere Rolle
--        (V-302, O-980, O-981, D-784, D-821).
--
-- 0372 legt ein Verwaltungskonto an und stellt EINEN Einladungslink aus. Ist
-- er verloren oder abgelaufen, gab es keinen Weg zu einem neuen: eine zweite
-- Einladung derselben Adresse weist 0372 als „schon eingetragen" ab, und
-- „Kennwort vergessen" braucht den Postausgang, der nicht verbunden ist
-- (O-501). Die Rolle einer Mitgliedschaft aenderte ebenfalls kein Weg.
-- Voreinstellung (O-980, O-981, D-784): die Super-Administration stellt den
-- Link neu aus — der alte verfaellt, wie 0249 — und wechselt die Rolle am
-- Benutzerblatt; beides protokolliert.
--
-- (1) app.verwaltungskonto_link_neu(p_benutzer, p_token_hash): fuer ein
--     Verwaltungskonto dieser Gesellschaft (lebende Mitgliedschaft mit der
--     Plattformrolle admin oder leitung, nicht aus einer Anstellung). Wartet
--     das Konto noch, ist der neue Link eine Einladung; ist es aktiv, ein Link
--     zum Setzen eines neuen Kennworts — derselbe Annahmeweg (0155). Gueltig
--     ist er so lange, wie die Plattform es fuer seinen Zweck einstellt
--     (auth.einladung_stunden bzw. auth.zuruecksetzung_stunden, 0155). Jeder
--     offene Link des Kontos verfaellt dabei. Ein gesperrtes oder
--     deaktiviertes Konto bekommt keinen: erst entsperren bzw. wiedergeben.
-- (2) app.verwaltungskonto_rolle_wechseln(p_benutzer, p_rolle): admin oder
--     leitung, sonst nichts — super_admin entsteht nur ueber die Umgebung
--     (D-617), Mitarbeiter- und Kundenrollen haben eigene Wege. Nicht am
--     eigenen Konto. Eine Modulzuweisung bleibt stehen: an der Leitung ist sie
--     eine Einschraenkung, nie eine Erweiterung.
--
-- Beide wie 0372: nur die Super-Administration (system.verwaltungskonto_erstellen,
-- nur_global), mit zweitem Faktor, im internen Portal, in genau einer
-- Gesellschaft und nicht aus der Gruppenansicht. Abweisungen kommen als
-- Schluessel (ok = false, grund), nicht als Satz — die Seite hat ihn in ihrer
-- Sprache (D-769, D-774). cse_definer haelt die noetigen Rechte auf
-- benutzer_mandant (0191) und kern.kennwort_token (0155) schon.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 0. Die gemeinsamen Tore
-- ---------------------------------------------------------------------------

create function kern.verwaltungskonto_tor() returns uuid
language plpgsql stable
set search_path = pg_catalog, public, app
as $$
declare
  v_mandant uuid := app.aktiver_mandant();
begin
  if app.portal() is distinct from 'intern' then
    raise exception 'Ein Verwaltungskonto wird nur im internen Portal gepflegt (K-04).'
      using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() or app.ist_gruppenansicht() or v_mandant is null then
    raise exception 'Ein Verwaltungskonto wird in genau einer Gesellschaft gepflegt, '
                    'nicht aus der Gruppenansicht (Invariante 10).'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('system.verwaltungskonto_erstellen', v_mandant) then
    raise exception 'system.verwaltungskonto_erstellen fehlt (D-610: nur der Super-Admin).'
      using errcode = 'insufficient_privilege';
  end if;
  if app.aal() is distinct from 'aal2' then
    raise exception 'Ein Verwaltungskonto wird nur mit zweitem Faktor gepflegt (AUT-02).'
      using errcode = 'insufficient_privilege';
  end if;
  return v_mandant;
end $$;

comment on function kern.verwaltungskonto_tor() is
  'V-302, D-821: die Tore von 0372 fuer die Pflege eines Verwaltungskontos — gibt die '
  'aktive Gesellschaft zurueck oder wirft. Nur fuer die beiden Definer.';

alter function kern.verwaltungskonto_tor() owner to cse_definer;
revoke all on function kern.verwaltungskonto_tor() from public;

-- ---------------------------------------------------------------------------
-- 1. Link neu ausstellen
-- ---------------------------------------------------------------------------

create function app.verwaltungskonto_link_neu(p_benutzer uuid, p_token_hash text)
returns table (ok boolean, grund text, zweck text)
language plpgsql security definer
set search_path = pg_catalog, public, app, kern
as $$
declare
  v_mandant uuid := kern.verwaltungskonto_tor();
  v_status  benutzer_status;
  v_aus     timestamptz;
  v_zweck   text;
  v_stunden int;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Der Link wird ausserhalb der Datenbank gebildet und nur als SHA-256 '
                    'uebergeben.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.benutzer_mandant bm join public.rolle r on r.id = bm.rolle_id
     where bm.benutzer_id = p_benutzer and bm.mandant_id = v_mandant
       and bm.entzogen_am is null and not bm.aus_anstellung
       and r.mandant_id is null and r.schluessel in ('admin', 'leitung')) then
    return query select false, 'kein_verwaltungskonto'::text, null::text;
    return;
  end if;

  select b.status, b.deaktiviert_am into v_status, v_aus
    from public.benutzer b where b.id = p_benutzer;
  if v_aus is not null or v_status = 'deaktiviert' then
    return query select false, 'deaktiviert'::text, null::text;
    return;
  end if;
  if v_status = 'gesperrt' then
    return query select false, 'gesperrt'::text, null::text;
    return;
  end if;
  v_zweck := case when v_status = 'eingeladen' then 'einladung' else 'zuruecksetzen' end;
  v_stunden := case v_zweck
    when 'einladung'
      then coalesce((app.plattform_einstellung('auth.einladung_stunden'))::int, 168)
    else coalesce((app.plattform_einstellung('auth.zuruecksetzung_stunden'))::int, 2) end;

  -- Der alte Link verfaellt — jeder offene, gleich welcher Zweck (wie 0249).
  update kern.kennwort_token t set eingeloest_am = now()
   where t.benutzer_id = p_benutzer and t.eingeloest_am is null;
  insert into kern.kennwort_token
    (benutzer_id, zweck, token_hash, gueltig_bis, erstellt_von)
  values (p_benutzer, v_zweck, p_token_hash,
          now() + make_interval(hours => v_stunden), app.aktueller_benutzer());

  perform app.protokolliere('system.verwaltungskonto_link_neu', 'benutzer',
                            p_benutzer::text, null,
                            jsonb_build_object('zweck', v_zweck, 'gueltig_stunden', v_stunden),
                            v_mandant);

  return query select true, 'ausgestellt'::text, v_zweck;
end $$;

comment on function app.verwaltungskonto_link_neu(uuid, text) is
  'V-302, O-980, D-821: stellt fuer ein Verwaltungskonto der aktiven Gesellschaft einen neuen '
  'Link aus — Einladung, solange es wartet, sonst ein Kennwortlink; jeder offene Link verfaellt. '
  'Nur die Super-Administration mit aal2. Der Klartext entsteht ausserhalb.';

alter function app.verwaltungskonto_link_neu(uuid, text) owner to cse_definer;
revoke all on function app.verwaltungskonto_link_neu(uuid, text) from public;
grant execute on function app.verwaltungskonto_link_neu(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- 2. Die Rolle wechseln
-- ---------------------------------------------------------------------------

create function app.verwaltungskonto_rolle_wechseln(p_benutzer uuid, p_rolle text)
returns table (ok boolean, grund text)
language plpgsql security definer
set search_path = pg_catalog, public, app, kern
as $$
declare
  v_mandant uuid := kern.verwaltungskonto_tor();
  v_rolle   text := btrim(coalesce(p_rolle, ''));
  v_bm      uuid;
  v_alt     text;
  v_neu_id  uuid;
begin
  if v_rolle not in ('admin', 'leitung') then
    return query select false, 'rolle_unzulaessig'::text;
    return;
  end if;
  if p_benutzer is not distinct from app.aktueller_benutzer() then
    return query select false, 'selbst'::text;
    return;
  end if;

  select bm.id, r.schluessel into v_bm, v_alt
    from public.benutzer_mandant bm join public.rolle r on r.id = bm.rolle_id
   where bm.benutzer_id = p_benutzer and bm.mandant_id = v_mandant
     and bm.entzogen_am is null and not bm.aus_anstellung
     and r.mandant_id is null and r.schluessel in ('admin', 'leitung')
   order by bm.gueltig_ab desc
   limit 1
   for update of bm;
  if v_bm is null then
    return query select false, 'kein_verwaltungskonto'::text;
    return;
  end if;
  if v_alt = v_rolle then
    return query select true, 'unveraendert'::text;
    return;
  end if;

  select r.id into v_neu_id from public.rolle r
   where r.schluessel = v_rolle and r.mandant_id is null;
  update public.benutzer_mandant
     set rolle_id = v_neu_id, geaendert_von = app.aktueller_benutzer()
   where id = v_bm;

  perform app.protokolliere('system.verwaltungskonto_rolle_gewechselt', 'benutzer_mandant',
                            v_bm::text,
                            jsonb_build_object('rolle', v_alt, 'benutzer', p_benutzer),
                            jsonb_build_object('rolle', v_rolle, 'benutzer', p_benutzer),
                            v_mandant);

  return query select true, 'gewechselt'::text;
end $$;

comment on function app.verwaltungskonto_rolle_wechseln(uuid, text) is
  'V-302, O-981, D-821: wechselt die Rolle der lebenden Verwaltungsmitgliedschaft eines Kontos '
  'in der aktiven Gesellschaft zwischen admin und leitung, protokolliert. Nicht am eigenen '
  'Konto; nur die Super-Administration mit aal2.';

alter function app.verwaltungskonto_rolle_wechseln(uuid, text) owner to cse_definer;
revoke all on function app.verwaltungskonto_rolle_wechseln(uuid, text) from public;
grant execute on function app.verwaltungskonto_rolle_wechseln(uuid, text) to cse_app;
