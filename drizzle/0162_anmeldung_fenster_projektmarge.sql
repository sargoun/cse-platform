/**
 * Zwei Fenster, die fehlten, und eine Marge, die nichts mass.
 *
 * **1. Die Anmeldung kannte `gueltig_ab` nicht.** `app.kennwort_anmelden`
 * suchte den Standardbereich mit `entzogen_am is null` und `gueltig_bis`,
 * aber ohne `gueltig_ab` -- eine Mitgliedschaft, die erst naechsten Monat
 * beginnt, band die Sitzung heute schon an diesen Bereich, statt in die
 * Gruppenansicht zu fallen. Dieselbe Luecke stand in der Frage, ob eine Rolle
 * den zweiten Faktor verlangt: eine abgelaufene Mitgliedschaft konnte ihn
 * fordern, eine noch nicht begonnene ihn ersparen. `app.switcher_mandanten()`
 * und jede Policy pruefen beide Grenzen; die Anmeldung tat es nicht.
 *
 * **2. Die Projektmarge mischte Zeitraeume.** `app.projekt_kennzahlen`
 * schnitt den LOHN auf `p_von`/`p_bis`, summierte aber Rechnungen und
 * Eingangsrechnungen ueber die ganze Laufzeit -- und die Auftragssumme in
 * derselben Zeile ist ohnehin die ganze Laufzeit, weil sie sich nicht auf ein
 * Jahr schneiden laesst. Die Marge verglich damit Erloese aus vier Jahren mit
 * Lohn aus einem. Sie ist jetzt durchgehend die Laufzeit; der Zeitraum waehlt
 * die PROJEKTE, und genau das sagt die Seite auch.
 *
 * `app.projekt_lohnkosten` nimmt dafuer NULL als "ohne Grenze" -- der Aufruf
 * mit einem Zeitraum bleibt fuer jeden anderen Zweck derselbe.
 */

create or replace function app.kennwort_anmelden(
  p_email      text,
  p_kennwort   text,
  p_token_hash text,
  p_ip         inet default null,
  p_user_agent text default null
) returns table (
  ergebnis          anmeldung_ergebnis,
  sitzung_id        uuid,
  benutzer_id       uuid,
  braucht_faktor    boolean,
  faktor_vorhanden  boolean,
  muss_wechseln     boolean
)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
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
     and bm.gueltig_ab <= current_date
     and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
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
                           and bm.gueltig_ab <= current_date
                           and (bm.gueltig_bis is null
                                or bm.gueltig_bis >= current_date))))
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
end $$;

comment on function app.kennwort_anmelden(text, text, text, inet, text) is
  'AUT-01: E-Mail + Kennwort, Rate-Limiting, Sitzung als aal1. Der Hash verlaesst die '
  'Datenbank nie. Standardbereich und 2FA-Pflicht sehen dasselbe Gueltigkeitsfenster '
  'wie app.switcher_mandanten().';

create or replace function app.projekt_lohnkosten(p_von date, p_bis date)
returns table (projekt_id uuid, lohn_cent bigint)
language sql stable security definer
set search_path = pg_catalog, public, app as $$
  select z.projekt_id,
         -- Invariante 1: Geld ist ganzzahlig. Der Satz ist Cent JE STUNDE,
         -- die Dauer steht in Minuten -- also erst multiplizieren, EINMAL am
         -- Ende durch 60 teilen und dabei kaufmaennisch runden (+30 vor der
         -- GANZZAHLIGEN Division). Wer je Zeile teilte, verloere je Zeile
         -- einen halben Cent.
         --
         -- Das ::bigint steht INNEN, und dort muss es stehen: sum() ueber
         -- bigint liefert numeric, und mit einem numeric links waere `/ 60`
         -- eine Bruchdivision -- 2125.5 --, die der Cast am Ende noch einmal
         -- rundet. Zweimal 25 Minuten zu 25,50 EUR/h ergaeben so 2126 statt
         -- 2125 Cent. Erst ganzzahlig machen, dann teilen.
         ((coalesce(sum(
            z.dauer_netto_minuten::bigint * coalesce(a.stundensatz_intern, 0)
          ), 0)::bigint + 30) / 60)
    from public.zeiteintrag z
    -- **Die Anstellung steht in der ZEILE.** `zeiteintrag.anstellung_id` ist
    -- `not null` -- der Eintrag weiss, unter welcher Anstellung er entstand.
    -- Die frueheren Bedingungen suchten sie stattdessen ueber Person und
    -- Gesellschaft: hat jemand in derselben Gesellschaft ZWEI Anstellungen
    -- (Wechsel des Vertrags, zweite Taetigkeit -- Invariante 9 erlaubt das
    -- ausdruecklich), traf ein Zeiteintrag beide Zeilen und ging doppelt in
    -- die Lohnkosten ein, zusaetzlich zum falschen Stundensatz. Der
    -- Mandantenvergleich bleibt: er ist die zweite Linie, nicht die erste.
    join public.anstellung a
      on a.id = z.anstellung_id
     and a.mandant_id = z.mandant_id
     and a.geloescht_am is null
   where z.projekt_id is not null
     and z.mandant_id = app.aktiver_mandant()
     -- Die Freigabe ist ein ZEITPUNKT, kein Status (§7.3, EMP-04):
     -- `zeiteintrag_status` führt laufend, abgeschlossen, offen_nacherfassung
     -- und storniert.
     and z.freigegeben_am is not null
     and z.storniert_am is null
     and z.ersetzt_am is null
     -- NULL heisst: ohne Grenze. `app.projekt_kennzahlen` fragt so, weil
     -- die Auftragssumme daneben die ganze Laufzeit meint und ein
     -- zeitraumgeschnittener Lohn in derselben Zeile eine Marge ergaebe, die
     -- nichts misst (D-522).
     and (p_von is null
          or (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date >= p_von)
     and (p_bis is null
          or (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date <= p_bis)
     -- Dasselbe Recht, das die Berichtsroute verlangt. Ein Definer OHNE
     -- Rechtefrage wäre eine Tür neben der Tür: er läuft am Eigentümer vorbei
     -- an jeder Policy, und `security definer` heisst nicht „ohne Bedingung".
     and app.hat_recht('kalkulation.lesen', app.aktiver_mandant())
   group by z.projekt_id
$$;

create or replace function app.projekt_kennzahlen(p_von date, p_bis date)
returns table (
  projekt_id uuid,
  auftragssumme_cent bigint,
  berechnet_cent bigint,
  lohn_cent bigint,
  fremd_cent bigint
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Projektkennzahlen sind ausserhalb des internen Portals nicht lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('kalkulation.lesen', app.aktiver_mandant()) then
    raise exception 'kalkulation.lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select pr.id,
           coalesce(pr.auftragssumme_netto_cent, 0)::bigint,
           coalesce((select sum(r.netto_gesamt_cent) from public.rechnung r
                      where r.projekt_id = pr.id
                        and r.status = 'festgeschrieben'), 0)::bigint,
           /*
            * **Die ganze Laufzeit, nicht der Zeitraum** (D-522).
            *
            * Die Auftragssumme in der Zeile daneben IST die ganze Laufzeit --
            * eine Auftragssumme laesst sich nicht auf ein Jahr schneiden --,
            * und das Berechnete und die Fremdleistung darunter waren es auch.
            * Nur der Lohn war zeitraumgeschnitten, und die Marge aus beidem
            * mass damit nichts: Erloese aus vier Jahren gegen Lohn aus einem.
            * Der Zeitraum waehlt die PROJEKTE (die Seite sagt das auch so);
            * die Betraege gehoeren dem Projekt.
            */
           coalesce((select lk.lohn_cent from app.projekt_lohnkosten(null, null) lk
                      where lk.projekt_id = pr.id), 0)::bigint,
           coalesce((select sum(e.netto_cent) from public.eingangsrechnung e
                      where e.projekt_id = pr.id
                        and e.status in ('freigegeben', 'gebucht')), 0)::bigint
      from public.projekt pr
     where pr.mandant_id = app.aktiver_mandant()
       and pr.archiviert_am is null;
end
$$;

comment on function app.projekt_kennzahlen(date, date) is
  'REP-05, K-05, D-92, D-522. Auftragssumme, Berechnetes, Lohn und Fremdleistung je '
  'Projekt -- alle vier ueber die ganze Laufzeit, weil eine Auftragssumme keinen '
  'Zeitraum kennt. Der Zeitraum waehlt die Projekte. Intern und mit kalkulation.lesen.';

/**
 * **Die Kennwort-Zuruecksetzung hatte keine Bremse.**
 *
 * `/auth/passwort-vergessen` ist oeffentlich und legt bei jedem Absenden
 * einen frischen Token an. Zwei Folgen, beide real:
 *
 *  - **Jede Anforderung entwertet die vorherige.** Wer eine fremde Adresse
 *    wiederholt einreicht, macht den Link, den der Mensch gerade bekommen
 *    hat, laufend ungueltig -- ohne je Zugriff zu haben.
 *  - **Sobald ein E-Mail-Weg angeschlossen ist, ist es ein Versandhebel** auf
 *    eine beliebige Adresse.
 *
 * Die vorhandene Bremse (`app.versuch_protokollieren`) passt NICHT: sie
 * SPERRT das Konto nach zu vielen Fehlversuchen. Auf diesen Weg angewandt
 * waere sie eine Einladung, ein fremdes Konto durch blosses Anfordern
 * auszusperren -- aus einer Bremse wuerde eine Waffe. Diese hier zaehlt und
 * bremst, und sie sperrt nichts.
 *
 * **Die Antwort bleibt ununterscheidbar.** Die Seite zeigt denselben Satz wie
 * sonst; gebremst heisst „es geht kein neuer Link hinaus", nicht „diese
 * Adresse gibt es".
 */
create function app.kennwort_reset_gebremst(p_email text, p_ip inet) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_hash     text := encode(digest(lower(coalesce(p_email, '')), 'sha256'), 'hex');
  v_fenster  int  := coalesce((app.plattform_einstellung('auth.fenster_minuten'))::int, 15);
  v_max_kenn int  := coalesce((app.plattform_einstellung('auth.max_reset_kennung'))::int, 3);
  v_max_ip   int  := coalesce((app.plattform_einstellung('auth.max_reset_ip'))::int, 20);
  v_seit     timestamptz := now() - make_interval(mins => v_fenster);
  v_kenn     int;
  v_ip       int;
  v_bremst   boolean;
begin
  select count(*) into v_kenn from kern.anmeldeversuch a
   where a.kennung_hash = v_hash and a.art = 'kennwort_reset' and a.erstellt_am >= v_seit;
  select count(*) into v_ip from kern.anmeldeversuch a
   where a.ip is not distinct from p_ip and a.art = 'kennwort_reset'
     and a.erstellt_am >= v_seit;

  v_bremst := v_kenn >= v_max_kenn or v_ip >= v_max_ip;

  -- Der Versuch wird IMMER protokolliert, auch der gebremste: sonst faellt
  -- das Fenster nach der ersten Ablehnung wieder leer und die Bremse loeste
  -- sich selbst.
  insert into kern.anmeldeversuch (kennung_hash, ip, art, erfolg, grund)
  values (v_hash, p_ip, 'kennwort_reset', not v_bremst,
          case when v_bremst then 'reset_gebremst' else null end);

  return v_bremst;
end
$$;

comment on function app.kennwort_reset_gebremst(text, inet) is
  'AUT-07. Bremse fuer die Kennwort-Zuruecksetzung -- zaehlt je Adresse und je IP im '
  'Anmeldefenster und SPERRT nichts: eine Bremse, die ein fremdes Konto aussperren '
  'koennte, waere eine Waffe.';

alter function app.kennwort_reset_gebremst(text, inet) owner to cse_definer;
revoke execute on function app.kennwort_reset_gebremst(text, inet) from public;
grant execute on function app.kennwort_reset_gebremst(text, inet) to cse_anon, cse_app;

/*
 * `ist_vorlaeufig`: wie die uebrigen auth-Grenzen sind das gesetzte Zahlen und
 * keine abgestimmten. Drei Anforderungen je Viertelstunde reichen fuer jeden
 * Menschen, der seinen Link nicht findet, und nehmen dem Missbrauch die
 * Wiederholung -- aber die Zahl gehoert bestaetigt (O-134-Nachbar).
 */
insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig)
values ('auth.max_reset_kennung', '3',
        'Kennwort-Zuruecksetzungen je Adresse im Anmeldefenster (AUT-07).', true),
       ('auth.max_reset_ip', '20',
        'Kennwort-Zuruecksetzungen je IP im Anmeldefenster (AUT-07).', true)
on conflict (schluessel) do nothing;

/**
 * **Der zweite Faktor hatte keine Bremse — der erste schon.**
 *
 * `/auth/zwei-faktor/pruefen` prueft einen sechsstelligen Code und gab bei
 * einem falschen nur `false` zurueck: kein Zaehler, keine Sperre. Wer eine
 * `aal1`-Sitzung in die Hand bekommt (gestohlenes Cookie, offener Rechner),
 * darf damit unbegrenzt raten. Eine Million Moeglichkeiten klingt viel und ist
 * es nicht, wenn jeder Versuch kostenlos ist und das Fenster alle dreissig
 * Sekunden neu aufgeht: der Faktor, der die erste Stufe absichert, war die
 * schwaechere von beiden.
 *
 * **Gezaehlt wird je BENUTZER, und gesperrt wird der WEG, nicht das Konto.**
 * Der Ratende hat die Sitzung schon; ein gesperrtes Konto naehme ihm nichts
 * und dem Menschen alles. Nach `auth.max_faktor_versuche` Fehlschlaegen im
 * Anmeldefenster wird auch ein RICHTIGER Code abgewiesen -- das ist der Sinn
 * der Bremse -- und nach dem Fenster geht es weiter.
 */
create function app.faktor_versuch(p_benutzer uuid, p_erfolg boolean) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_hash    text := encode(digest('faktor:' || p_benutzer::text, 'sha256'), 'hex');
  v_fenster int  := coalesce((app.plattform_einstellung('auth.fenster_minuten'))::int, 15);
  v_max     int  := coalesce((app.plattform_einstellung('auth.max_faktor_versuche'))::int, 8);
  v_seit    timestamptz := now() - make_interval(mins => v_fenster);
  v_fehl    int;
begin
  select count(*) into v_fehl from kern.anmeldeversuch a
   where a.kennung_hash = v_hash and a.art = 'faktor' and not a.erfolg
     and a.erstellt_am >= v_seit;

  insert into kern.anmeldeversuch (kennung_hash, ip, art, erfolg, grund)
  values (v_hash, null, 'faktor', p_erfolg and v_fehl < v_max,
          case when v_fehl >= v_max then 'faktor_gebremst'
               when not p_erfolg then 'faktor_falsch' end);

  return v_fehl >= v_max;
end
$$;

comment on function app.faktor_versuch(uuid, boolean) is
  'AUT-02, AUT-07. Zaehlt Versuche am zweiten Faktor je Benutzer und bremst den WEG '
  '(nicht das Konto) nach zu vielen Fehlschlaegen im Anmeldefenster.';

alter function app.faktor_versuch(uuid, boolean) owner to cse_definer;
revoke execute on function app.faktor_versuch(uuid, boolean) from public;
grant execute on function app.faktor_versuch(uuid, boolean) to cse_anon, cse_app;

insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig)
values ('auth.max_faktor_versuche', '8',
        'Fehlversuche am zweiten Faktor je Benutzer im Anmeldefenster (AUT-02).', true)
on conflict (schluessel) do nothing;
