-- ===========================================================================
-- 0395 — Der zweite Faktor der ROLLE gilt, nicht nur der des Rechts
--        (AUT-02, D-33, K-15, V-136)
-- ===========================================================================
-- **Der Befund.** Die Rollen admin und super_admin tragen seit 0007
-- erfordert_2fa = true, und die Anmeldung leitet sie nach dem Kennwort auf
-- den Faktor-Schritt. Durchgesetzt wurde die Pflicht danach aber nur fuer die
-- wenigen RECHTE mit erfordert_2fa (heute eines) und drei Routen mit eigenem
-- aal2-Waechter. app.hat_recht_fuer wertete weder die globale Rolle noch die
-- Mitgliedschaftsrolle gegen ihre eigene Pflicht aus: wer nach dem Kennwort
-- statt des Faktor-Schritts eine Portaladresse aufrief, arbeitete mit aal1
-- und allen Rechten seiner Rolle. Ein abgegriffenes Admin-Kennwort oeffnete
-- damit Finanzen, Personal und CRM — genau das, wofuer der Stack „2FA for
-- admin roles" festschreibt.
--
-- **Was diese Migration aendert.**
--   1. app.hat_recht_fuer: eine Rolle mit erfordert_2fa gewaehrt ohne aal2
--      nichts — im globalen Zweig wie im Mitgliedschaftszweig. Das ist die
--      zweite Linie in der Datenbank: sie gilt fuer jede Policy, jede API und
--      jeden Dienst, gleich welcher Weg davor vergessen wurde.
--   2. app.faktor_pflicht(): verlangt irgendeine gueltige Rolle dieses Kontos
--      den zweiten Faktor? Dieselbe Frage, die die Anmeldung als
--      braucht_faktor stellt (0162), fuer die Portal-Pforte, die eine
--      aal1-Sitzung damit auf den Faktor-Schritt leitet statt auf ein 404.
--
-- **Was sie bewusst NICHT aendert (K-15).** Kein aal2-Gate auf dem Lesen von
-- benutzer_mandant: app.sichtbare_mandanten() haengt daran, und eine solche
-- Policy liesse die Plattform fuer leitung, mitarbeiter und kunde schwarz
-- werden. Diese drei Rollen tragen erfordert_2fa = false und sind von dieser
-- Migration nicht beruehrt. Ein Hintergrundlauf fragt mit dem Vorgabewert
-- p_aal = aal2 und ist ebenfalls nicht beruehrt.
--
-- **Die aelteren Fassungen von app.hat_recht_fuer sind gelesen:** 0149 legte
-- sie an, 0169 zog die Gueltigkeitsfenster auf app.berlin_heute(). Die
-- Fassung hier ist Zeile fuer Zeile die aus 0169, erweitert um genau die zwei
-- Stellen mit v_pflicht — nichts aus 0169 faellt weg.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 und 0393.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.hat_recht_fuer(p_benutzer uuid, p_schluessel text, p_mandant uuid, p_aal text DEFAULT 'aal2'::text, p_gruppenansicht boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_recht     record;
  v_rolle     uuid;
  v_gewaehrt  boolean;
  v_pflicht   boolean;
begin
  if p_benutzer is null then return false; end if;

  select b.id, b.aktion, b.nur_global, b.erfordert_2fa into v_recht
    from public.berechtigung b where b.schluessel = p_schluessel;
  if not found then return false; end if;

  if v_recht.erfordert_2fa and p_aal <> 'aal2' then
    return false;
  end if;

  if p_gruppenansicht and v_recht.aktion not in ('lesen', 'exportieren') then
    return false;
  end if;

  -- Die globale Rolle: sie gilt in jedem Bereich, ohne Zuweisungszeile (TEN-08).
  select b.globale_rolle_id into v_rolle
    from public.benutzer b
   where b.id = p_benutzer and b.deaktiviert_am is null and b.status = 'aktiv';

  if v_rolle is not null then
    -- AUT-02 (0395): verlangt die Rolle den zweiten Faktor, gewaehrt sie ohne
    -- ihn nichts. Die Mitgliedschaft darunter wird trotzdem gefragt.
    select r.erfordert_2fa into v_pflicht from public.rolle r where r.id = v_rolle;
    if not (coalesce(v_pflicht, false) and p_aal <> 'aal2') then
      select rb.gewaehrt into v_gewaehrt
        from public.rolle_berechtigung rb
       where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id
         and rb.mandant_id is not distinct from p_mandant
       order by rb.mandant_id nulls last limit 1;
      if v_gewaehrt is null then
        select rb.gewaehrt into v_gewaehrt
          from public.rolle_berechtigung rb
         where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id and rb.mandant_id is null;
      end if;
      if v_gewaehrt then return true; end if;
    end if;
  end if;

  if v_recht.nur_global then return false; end if;
  if p_mandant is null then return false; end if;

  -- Die Mitgliedschaftsrolle in genau diesem Bereich.
  select bm.rolle_id into v_rolle
    from public.benutzer_mandant bm
   where bm.benutzer_id = p_benutzer and bm.mandant_id = p_mandant
     and bm.entzogen_am is null
     and bm.gueltig_ab <= app.berlin_heute()
     and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute())
     -- AUT-01: eine Modulbeschränkung ist eine SCHNITTMENGE, kein Zusatz.
     and (bm.module is null or split_part(p_schluessel, '.', 1) = any (bm.module))
   limit 1;
  if v_rolle is null then return false; end if;

  -- AUT-02 (0395): dieselbe Regel fuer die Rolle in diesem Bereich.
  select r.erfordert_2fa into v_pflicht from public.rolle r where r.id = v_rolle;
  if coalesce(v_pflicht, false) and p_aal <> 'aal2' then return false; end if;

  -- Mandantenspezifisch schlägt Plattform-Vorgabe.
  select rb.gewaehrt into v_gewaehrt
    from public.rolle_berechtigung rb
   where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id
     and rb.mandant_id = p_mandant;
  if v_gewaehrt is not null then return v_gewaehrt; end if;

  select rb.gewaehrt into v_gewaehrt
    from public.rolle_berechtigung rb
   where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id and rb.mandant_id is null;

  return coalesce(v_gewaehrt, false);
end $function$;

-- Verlangt irgendeine gueltige Rolle des angemeldeten Kontos den zweiten
-- Faktor? Dieselbe Frage wie braucht_faktor in app.kennwort_anmelden (0162),
-- mit demselben Gueltigkeitsfenster der Mitgliedschaft.
create function app.faktor_pflicht() returns boolean
language sql stable security definer
set search_path = pg_catalog, public, app as $$
  select exists (
    select 1 from public.rolle r
     where r.erfordert_2fa
       and (r.id = (select b.globale_rolle_id from public.benutzer b
                     where b.id = app.aktueller_benutzer())
            or r.id in (select bm.rolle_id from public.benutzer_mandant bm
                         where bm.benutzer_id = app.aktueller_benutzer()
                           and bm.entzogen_am is null
                           and bm.gueltig_ab <= app.berlin_heute()
                           and (bm.gueltig_bis is null
                                or bm.gueltig_bis >= app.berlin_heute()))))
$$;

comment on function app.faktor_pflicht() is
  'AUT-02, V-136: verlangt eine gueltige Rolle des angemeldeten Kontos den zweiten '
  'Faktor? Die Portal-Pforte leitet eine aal1-Sitzung damit auf den Faktor-Schritt.';

alter function app.faktor_pflicht() owner to cse_definer;
revoke execute on function app.faktor_pflicht() from public;
grant execute on function app.faktor_pflicht() to cse_app;
