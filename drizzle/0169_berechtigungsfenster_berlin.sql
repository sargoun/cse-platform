/**
 * 0169 — Das Berechtigungsfenster zaehlt den BERLINER Kalendertag, nicht den
 * der Serverzeitzone (K-11/§1.8, Invariante 2, AUT-01).
 *
 * **Der Befund.** `benutzer_mandant` traegt `gueltig_ab` und `gueltig_bis` als
 * `date`. Sechs Funktionen pruefen sie gegen `current_date` — und
 * `current_date` ist der Kalendertag der SITZUNGSZEITZONE. Die Verbindung
 * laeuft auf UTC (Supabase-Vorgabe). Im Sommer ist Berlin UTC+2, also gilt
 * jede Nacht zwischen 00:00 und 02:00 Berliner Zeit:
 *
 *  - eine Mitgliedschaft mit `gueltig_bis = gestern` (berlinisch) ist noch
 *    gueltig, weil `current_date` noch auf gestern steht — **ein Zugriff
 *    ueberlebt sein Ende um bis zu zwei Stunden**;
 *  - eine Mitgliedschaft mit `gueltig_ab = heute` (berlinisch) gilt noch
 *    nicht — wer zum Monatsersten anfaengt, ist um 00:30 ausgesperrt.
 *
 * Beides ist still: kein Fehler, keine Zeile im Protokoll, nur ein 404 zu
 * viel oder eines zu wenig (AUT-06 beantwortet beide Faelle gleich).
 *
 * **Warum es bisher niemandem auffiel.** 0075 hat `app.berlin_heute()`
 * eingefuehrt und im Kommentar ausdruecklich auf die FINANZDOMAENE bezogen —
 * dort war die Begruendung eine Rechnung, die um 00:30 falsch datiert wird.
 * Dieselbe Uhr steht auch ueber den Berechtigungen; nur hat sie dort niemand
 * abgelesen. Gefunden hat es `tests/isolation/recruiting.test.ts`, und zwar
 * nur zur HAELFTE des Tages: der Fall sucht sich eine Zone, deren Datum von
 * Berlin abweicht, und findet vormittags (UTC) eine, die zurueckliegt —
 * nachmittags eine, die vorausliegt. Nur die zurueckliegende faellt.
 *
 * **Was hier passiert.** Dieselben sechs Funktionen, Wort fuer Wort wie sie in
 * der Datenbank stehen (`pg_get_functiondef`, deshalb die GROSSSCHREIBUNG der
 * Schluesselwoerter — eine Abschrift von Hand haette abgeschrieben), mit genau
 * EINER Aenderung: `current_date` wird zu `app.berlin_heute()`. Alle vierzehn
 * Vorkommen stehen an `bm.gueltig_ab` oder `bm.gueltig_bis`; kein anderes
 * `current_date` steht in diesen Koerpern.
 *
 * Dazu die Vorgabe der Spalte selbst: `gueltig_ab date not null default
 * current_date` legte eine Mitgliedschaft, die um 00:30 Berliner Zeit
 * entsteht, auf GESTERN — einen Tag zu frueh gueltig.
 *
 * `app.berlin_heute()` ist `stable` und steht deshalb (§1.9) in keinem CHECK
 * und in keinem Indexpraedikat — hier steht es in keinem von beidem.
 */


-- -------------------------------------------------------------------------
-- 3. Die Empfaenger einer Benachrichtigung  (2 Vorkommen)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.benutzer_mit_recht(p_schluessel text, p_mandant uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  with recht as (
    select b.id, b.nur_global from public.berechtigung b where b.schluessel = p_schluessel
  ),
  global as (
    select bn.id as benutzer_id
      from public.benutzer bn
      join recht r on true
      join public.rolle_berechtigung rb
        on rb.rolle_id = bn.globale_rolle_id and rb.berechtigung_id = r.id
       and rb.mandant_id is not distinct from p_mandant
     where bn.status = 'aktiv' and bn.deaktiviert_am is null and rb.gewaehrt
    union
    select bn.id
      from public.benutzer bn
      join recht r on true
      join public.rolle_berechtigung rb
        on rb.rolle_id = bn.globale_rolle_id and rb.berechtigung_id = r.id
       and rb.mandant_id is null
     where bn.status = 'aktiv' and bn.deaktiviert_am is null and rb.gewaehrt
       and not exists (select 1 from public.rolle_berechtigung rb2
                        where rb2.rolle_id = bn.globale_rolle_id
                          and rb2.berechtigung_id = r.id
                          and rb2.mandant_id = p_mandant)
  ),
  mitglied as (
    select bm.benutzer_id
      from public.benutzer_mandant bm
      join public.benutzer bn on bn.id = bm.benutzer_id
      join recht r on not r.nur_global
      join public.rolle_berechtigung rb
        on rb.rolle_id = bm.rolle_id and rb.berechtigung_id = r.id
       and rb.mandant_id is not distinct from p_mandant
     where bm.mandant_id = p_mandant
       and bm.entzogen_am is null
       and bm.gueltig_ab <= app.berlin_heute()
       and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute())
       and (bm.module is null or split_part(p_schluessel, '.', 1) = any (bm.module))
       and bn.status = 'aktiv' and bn.deaktiviert_am is null
       and rb.gewaehrt
  )
  select benutzer_id from global
  union
  select benutzer_id from mitglied
$function$;

-- -------------------------------------------------------------------------
-- 2. Das Tor zur Gruppenansicht  (2 Vorkommen)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.darf_gruppenansicht()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  select coalesce(array_length(app.switcher_mandanten(), 1), 0) >= 2
     and (exists (select 1 from public.benutzer_mandant bm
                    join public.rolle r on r.id = bm.rolle_id
                   where bm.benutzer_id = app.aktueller_benutzer()
                     and bm.entzogen_am is null
                     and bm.gueltig_ab <= app.berlin_heute()
                     and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute())
                     and r.portal = 'intern')
       or exists (select 1 from public.benutzer b
                    join public.rolle r on r.id = b.globale_rolle_id
                   where b.id = app.aktueller_benutzer()
                     and b.deaktiviert_am is null and b.status = 'aktiv'
                     and r.portal = 'intern'))
     and exists (select 1
                   from unnest(app.switcher_mandanten()) as s(id)
                   cross join public.berechtigung b
                  where b.modul = 'gruppe' and b.aktion = 'lesen'
                    and app.hat_recht(b.schluessel, s.id))
$function$;

-- -------------------------------------------------------------------------
-- 4. Die Rechtefrage selbst — `app.hat_recht` delegiert hierher  (2 Vorkommen)
-- -------------------------------------------------------------------------

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

-- -------------------------------------------------------------------------
-- 6. Der Kalender-Feed hinter seinem Hash  (2 Vorkommen)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.kalender_feed_aufloesen(p_hash text)
 RETURNS TABLE(benutzer_id uuid, person_id uuid, mandant_id uuid, slug text, portal text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_benutzer uuid;
  v_person   uuid;
begin
  /*
   * Der Abruf zaehlt nur, wenn der MENSCH den Zugang noch hat. Dieselben
   * fuenf Bedingungen wie in app.sitzung_aufloesen -- ein Feed, der einen
   * deaktivierten Zugang ueberlebt, ist eine Sitzung ohne Ablauf.
   */
  update public.kalender_feed f
     set letzter_abruf_am = now(), abrufe = abrufe + 1
    from public.benutzer b
   where f.token_hash = p_hash
     and f.widerrufen_am is null
     and b.id = f.benutzer_id
     and b.deaktiviert_am is null
     and b.status = 'aktiv'
     and (b.gesperrt_bis is null or b.gesperrt_bis <= now())
     and not b.ist_dienstkonto
  returning b.id, b.person_id into v_benutzer, v_person;

  if v_benutzer is null then return; end if;

  /*
   * `left join` und nicht `from mandant`: ein gueltiger Token, dessen Mensch
   * gerade keine Mitgliedschaft traegt, muss EINE Zeile ergeben -- sonst
   * liest der Aufrufer "keine Zeile" als "Token unbekannt" und antwortet 404,
   * wo ein leerer Kalender richtig waere. Der Unterschied zwischen "gibt es
   * nicht" und "ist heute leer" gehoert nicht verwischt.
   */
  return query
  select v_benutzer, v_person, m.id, m.slug,
         /*
          * Das Portal kommt aus der ROLLE (K-04) -- zuerst aus der
          * Mitgliedschaft in DIESEM Bereich, sonst aus der globalen Rolle
          * (TEN-08), sonst 'mitarbeiter'. Fail closed: die engste Decke,
          * wenn keine Rolle sie nennt.
          */
         coalesce(
           (select r.portal from public.benutzer_mandant bm
              join public.rolle r on r.id = bm.rolle_id
             where bm.benutzer_id = v_benutzer and bm.mandant_id = m.id
               and bm.entzogen_am is null limit 1),
           (select r.portal from public.rolle r
             join public.benutzer b2 on b2.globale_rolle_id = r.id
            where b2.id = v_benutzer and r.geltungsbereich = 'global'
              and r.archiviert_am is null),
           'mitarbeiter')::text
    from (select 1) as anker
    left join public.mandant m
      on m.archiviert_am is null
     and exists (select 1 from public.benutzer_mandant bm
                  where bm.benutzer_id = v_benutzer
                    and bm.mandant_id = m.id
                    and bm.entzogen_am is null
                    and bm.gueltig_ab <= app.berlin_heute()
                    and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute()))
   order by m.sortierung, m.slug;
end
$function$;

-- -------------------------------------------------------------------------
-- 5. Die Anmeldung mit Kennwort  (4 Vorkommen)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.kennwort_anmelden(p_email text, p_kennwort text, p_token_hash text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text)
 RETURNS TABLE(ergebnis anmeldung_ergebnis, sitzung_id uuid, benutzer_id uuid, braucht_faktor boolean, faktor_vorhanden boolean, muss_wechseln boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app', 'kern'
AS $function$
declare
  v_b        record;
  v_zd       record;
  v_stunden  int := coalesce((app.plattform_einstellung('auth.sitzung_stunden'))::int, 12);
  v_frei     boolean;
  v_mandant  uuid;
  v_ansicht  sitzung_ansicht;
  v_pflicht  boolean;
  v_faktor   boolean;
  v_id       uuid;
begin
  -- Erst bremsen, dann prüfen: ein Zähler, der nur bei existierenden Konten
  -- läuft, bremst das Durchprobieren nicht (AUT-07).
  v_frei := app.versuch_protokollieren(p_email, p_ip, false, 'kennwort_versuch', 'passwort');
  if not v_frei then
    return query select 'gebremst'::anmeldung_ergebnis, null::uuid, null::uuid, false, false, false;
    return;
  end if;

  select b.id, b.status, b.gesperrt_bis, b.deaktiviert_am, b.ist_dienstkonto
    into v_b
    from public.benutzer b
   where lower(b.email) = lower(p_email) and b.deaktiviert_am is null;

  if v_b.id is null or v_b.ist_dienstkonto then
    return query select 'falsch'::anmeldung_ergebnis, null::uuid, null::uuid, false, false, false;
    return;
  end if;

  select z.anbieter, z.kennwort_hash, z.muss_wechseln into v_zd
    from kern.zugangsdaten z where z.benutzer_id = v_b.id;

  if v_zd.anbieter is not null and v_zd.anbieter <> 'demo' then
    return query select 'fremd'::anmeldung_ergebnis, null::uuid, v_b.id, false, false, false;
    return;
  end if;

  -- **Der Hash wird verglichen, nicht ausgeliefert.** `crypt` rechnet mit dem
  -- Salz aus dem gespeicherten Wert; das Ergebnis ist der gespeicherte Wert
  -- genau dann, wenn das Kennwort stimmt.
  if v_zd.kennwort_hash is null
     or crypt(p_kennwort, v_zd.kennwort_hash) <> v_zd.kennwort_hash then
    return query select 'falsch'::anmeldung_ergebnis, null::uuid, null::uuid, false, false, false;
    return;
  end if;

  -- Das Kennwort stimmt. Ob das Konto benutzbar ist, ist die zweite Frage —
  -- und ihre Antwort darf sich vom „falsch" oben unterscheiden, weil sie
  -- niemandem etwas verrät, der das Kennwort nicht schon hat.
  if v_b.status <> 'aktiv' or (v_b.gesperrt_bis is not null and v_b.gesperrt_bis > now()) then
    return query select 'gesperrt'::anmeldung_ergebnis, null::uuid, v_b.id, false, false, false;
    return;
  end if;

  perform app.versuch_protokollieren(p_email, p_ip, true, null, 'passwort');

  -- Der Standardmandant entscheidet die Ansicht. Ohne Mitgliedschaft bleibt
  -- nur die Gruppenansicht — `sitzung_ansicht_stimmig` lässt nichts anderes zu.
  select bm.mandant_id into v_mandant
    from public.benutzer_mandant bm
   where bm.benutzer_id = v_b.id and bm.entzogen_am is null
     -- DIESELBE Gueltigkeit wie im Bereichswechsler und in jeder Policy: eine
     -- Mitgliedschaft, die erst naechsten Monat beginnt, ist heute keine.
     -- Ohne `gueltig_ab` band die Anmeldung die Sitzung an einen Bereich, den
     -- der Mensch noch gar nicht betreten darf -- statt in die Gruppenansicht
     -- zu fallen, wie es ohne Mitgliedschaft richtig waere.
     and bm.gueltig_ab <= app.berlin_heute()
     and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute())
   order by bm.ist_standard desc, bm.erstellt_am
   limit 1;
  v_ansicht := case when v_mandant is null then 'gruppe' else 'mandant' end::sitzung_ansicht;

  -- Verlangt IRGENDEINE Rolle dieses Kontos den zweiten Faktor?
  select exists (
    select 1 from public.rolle r
     where r.erfordert_2fa
       and (r.id = (select b2.globale_rolle_id from public.benutzer b2 where b2.id = v_b.id)
            -- Auch hier das Fenster: eine abgelaufene oder noch nicht
            -- begonnene Mitgliedschaft darf keinen zweiten Faktor verlangen
            -- und keinen ersparen.
            or r.id in (select bm.rolle_id from public.benutzer_mandant bm
                         where bm.benutzer_id = v_b.id and bm.entzogen_am is null
                           and bm.gueltig_ab <= app.berlin_heute()
                           and (bm.gueltig_bis is null
                                or bm.gueltig_bis >= app.berlin_heute()))))
    into v_pflicht;
  v_faktor := app.hat_zweiten_faktor(v_b.id);

  insert into public.benutzer_sitzung
    (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal, ablauf_am, ip, user_agent)
  values
    (v_b.id, p_token_hash, v_mandant, v_ansicht, 'aal1',
     now() + make_interval(hours => v_stunden), p_ip, p_user_agent)
  returning id into v_id;

  update public.benutzer set letzter_login_am = now(), letzte_ip = p_ip where id = v_b.id;

  return query select 'ok'::anmeldung_ergebnis, v_id, v_b.id,
                      v_pflicht, v_faktor, coalesce(v_zd.muss_wechseln, false);
end $function$;

-- -------------------------------------------------------------------------
-- 1. Die Bereiche des Umschalters  (2 Vorkommen)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.switcher_mandanten()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  select coalesce(array_agg(distinct m.id), '{}')
    from public.mandant m
   where m.archiviert_am is null
     and (app.ist_super_admin()
          or exists (select 1 from public.benutzer_mandant bm
                      where bm.benutzer_id = app.aktueller_benutzer()
                        and bm.mandant_id = m.id
                        and bm.entzogen_am is null
                        and bm.gueltig_ab <= app.berlin_heute()
                        and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute())))
$function$;

-- ---------------------------------------------------------------------------
-- 7. Die Vorgabe der Spalte
-- ---------------------------------------------------------------------------

alter table benutzer_mandant alter column gueltig_ab set default app.berlin_heute();

comment on column benutzer_mandant.gueltig_ab is
  'Der BERLINER Kalendertag, ab dem die Mitgliedschaft gilt (0169). Nicht current_date: das ist der Tag der Sitzungszeitzone.';

comment on function app.berlin_heute() is
  'K-11/§1.8: der BERLINER Kalendertag. Ersetzt current_date in der Finanzdomaene UND im Berechtigungsfenster (0169).';
