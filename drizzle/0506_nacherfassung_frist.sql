-- 0506 — eine späte Nacherfassung meldet sich bei der Leitung (V-321, O-165, D-810).
--
-- Eine Nacherfassung (zeiteintrag_korrektur.art = 'nacherfassung') nahm die
-- Plattform ohne Blick auf den Abstand zum Arbeitstag an. Voreinstellung zu
-- O-165 (D-788): sieben Kalendertage nach dem Arbeitstag — die Obergrenze des
-- § 17 Abs. 1 MiLoG —, danach ein Hinweis an die Leitung. Kein Verbot: eine
-- spaete Aufzeichnung ist besser als keine.
--
-- app.nacherfassung_spaet_melden stellt genau diese eine Art zu, weil
-- benachrichtigung von cse_app kein insert annimmt (0266). Er prueft selbst,
-- was er meldet: die Korrektur gehoert der aktiven Gesellschaft, ist eine
-- Nacherfassung, stammt vom Aufrufer und ist frisch; der Abstand wird aus der
-- Datenbank gerechnet — Berliner Tag der Korrektur gegen Berliner Tag des
-- Arbeitsbeginns der neuen Fassung (Invariante 2). Empfaenger ist die Leitung
-- der Gesellschaft (Systemrolle leitung, gueltige Mitgliedschaft), ohne den
-- Aufrufer. Je Korrektur hoechstens einmal.
--
-- Nur Kommentare mit Doppelstrich.

grant select on zeiteintrag_korrektur to cse_definer;
create policy d_korrektur_lesen on zeiteintrag_korrektur for select to cse_definer
  using (true);

create function app.nacherfassung_spaet_melden(
  p_korrektur uuid, p_frist_tage integer, p_titel text, p_text text, p_ziel text
) returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_benutzer uuid := app.aktueller_benutzer();
  v_tage integer;
  v_zahl integer;
begin
  if v_mandant is null or v_benutzer is null then
    raise exception 'Nur in einer aktiven Gesellschaft mit angemeldeter Person.'
      using errcode = '42501';
  end if;
  if p_frist_tage is null or p_frist_tage < 1 or p_frist_tage > 60 then
    raise exception 'Die Frist liegt zwischen 1 und 60 Tagen.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_titel), '') = '' or coalesce(btrim(p_text), '') = ''
     or coalesce(btrim(p_ziel), '') = '' then
    raise exception 'Titel, Text und Ziel sind Pflicht.' using errcode = '22023';
  end if;

  select (k.erstellt_am at time zone 'Europe/Berlin')::date
         - (coalesce(n.beginn_zeitpunkt, a.beginn_zeitpunkt) at time zone 'Europe/Berlin')::date
    into v_tage
    from public.zeiteintrag_korrektur k
    join public.zeiteintrag a on a.id = k.ursprung_zeiteintrag_id
    left join public.zeiteintrag n on n.id = k.ersatz_zeiteintrag_id
   where k.id = p_korrektur
     and k.mandant_id = v_mandant
     and k.art = 'nacherfassung'
     and k.durchgefuehrt_von = v_benutzer
     and k.erstellt_am >= now() - interval '1 hour';

  if v_tage is null or v_tage <= p_frist_tage then
    return 0;
  end if;

  insert into public.benachrichtigung
    (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
  select distinct v_mandant, bm.benutzer_id, 'zeit.nacherfassung_spaet', p_titel, p_text,
         p_ziel, 'zeiteintrag_korrektur', p_korrektur::text, true
    from public.benutzer_mandant bm
    join public.rolle r on r.id = bm.rolle_id
                       and r.mandant_id is null and r.schluessel = 'leitung'
    join public.benutzer b on b.id = bm.benutzer_id
   where bm.mandant_id = v_mandant
     and bm.entzogen_am is null
     and bm.gueltig_ab <= current_date
     and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
     and b.status = 'aktiv' and b.deaktiviert_am is null and not b.ist_dienstkonto
     and b.id <> v_benutzer
     and not exists (
       select 1 from public.benachrichtigung x
        where x.art = 'zeit.nacherfassung_spaet'
          and x.objekt_typ = 'zeiteintrag_korrektur'
          and x.objekt_id = p_korrektur::text);
  get diagnostics v_zahl = row_count;
  return v_zahl;
end $$;

comment on function app.nacherfassung_spaet_melden(uuid, integer, text, text, text) is
  'V-321, O-165, D-810: meldet eine Nacherfassung, die mehr als p_frist_tage nach dem '
  'Arbeitstag erfolgt, einmal an die Leitung der aktiven Gesellschaft (ohne den Aufrufer). '
  'Nur fuer die eigene, frische Nacherfassung des Aufrufers. Gibt die Zahl der Empfaenger '
  'zurueck; 0, wenn die Frist eingehalten ist.';

alter function app.nacherfassung_spaet_melden(uuid, integer, text, text, text) owner to cse_definer;
revoke execute on function app.nacherfassung_spaet_melden(uuid, integer, text, text, text) from public;
grant execute on function app.nacherfassung_spaet_melden(uuid, integer, text, text, text) to cse_app;
