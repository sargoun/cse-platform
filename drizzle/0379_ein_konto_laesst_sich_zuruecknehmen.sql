-- 0379 — ein Konto laesst sich zuruecknehmen (V-022, V-074, V-075, V-076).
--
-- ===========================================================================
-- Vier Befunde, eine Wurzel
-- ===========================================================================
--
-- `benutzer.status` fuehrt vier Werte — `eingeladen`, `aktiv`, `gesperrt`,
-- `deaktiviert`. Drei davon sind Sackgassen:
--
--   V-074  `gesperrt` setzt die Brute-Force-Wache (`app.versuch_protokollieren`,
--          0007). NICHTS setzt sie zurueck. Wer sich zehnmal vertippt hat,
--          wartet die Sperrdauer ab — und wenn ein Admin ihm helfen will, kann
--          er es nicht.
--   V-075  `deaktiviert` hat ueberhaupt keinen Erzeuger. Der Wert existiert,
--          die Spalte `deaktiviert_am` existiert, der Check zwischen beiden
--          existiert — und kein Weg fuehrt hin.
--   V-022  Auf dem Benutzerblatt laesst sich einladen und niemals
--          zuruecknehmen. Ein ausgeschiedener Mitarbeiter behaelt sein Konto,
--          bis jemand die Datenbank von Hand anfasst.
--   V-076  Das Recht `system.sitzung_widerrufen` ist im Katalog vergeben und
--          an `super_admin` und `admin` gebunden. **Kein Code prueft es, kein
--          Bildschirm bietet den Widerruf an** — und das Benutzerblatt sagt
--          woertlich „Das Widerrufen fremder Sitzungen kommt mit
--          `system.sitzung_widerrufen`". Es kam nie.
--
-- Die gemeinsame Wurzel steht in `0007`: `cse_app` bekommt auf `benutzer` ein
-- SPALTEN-Grant — `update (name, sprache, benachrichtigung_praeferenz)` — und
-- die einzige UPDATE-Policy ist `t_benutzer_selbstpflege` auf die eigene
-- Zeile. `status`, `gesperrt_bis` und `deaktiviert_am` sind der Anwendung
-- damit entzogen. Das ist richtig so und war nie das Problem: das Problem ist,
-- dass daneben kein Weg gebaut wurde.
--
-- Also derselbe Bauplan wie `0377`: vier Funktionen unter `cse_definer`, jede
-- auf EINEN Fall geschnitten, jede mit ihrer eigenen Rechtefrage.
--
-- ===========================================================================
-- Was jede der vier prueft — und warum je dreimal dasselbe dasteht
-- ===========================================================================
--
-- Eine gemeinsame `app.konto_wache()` waere kuerzer. Sie waere auch die
-- Stelle, an der spaeter jemand eine Bedingung lockert, um EINEN Fall zu
-- erlauben, und sie damit in allen vieren lockert. Die Pruefungen stehen
-- deshalb je Funktion, und jede nennt ihr eigenes Recht:
--
--   * kein Lesemodus, keine Gruppenansicht (Invariante 10),
--   * zweiter Faktor (K-15) — ein Konto zurueckzunehmen ist eine
--     Verwaltungshandlung, keine Selbstpflege,
--   * das Recht IM AKTIVEN MANDANTEN (K-03), nicht global,
--   * das Zielkonto ist Mitglied DIESES Mandanten und nicht entzogen —
--     sonst reichte ein Admin einer Gesellschaft in eine andere hinein,
--   * und jede schreibt `audit_log` (AUT-08). Ein Zugangsentzug ohne Spur
--     ist im Streitfall keiner.

-- ---------------------------------------------------------------------------
-- Zuerst: die Entsperrung muss auch WIRKEN
-- ---------------------------------------------------------------------------
--
-- `app.versuch_protokollieren` zaehlt die Fehlversuche der letzten
-- `auth.fenster_minuten` (Vorgabe 15) und sperrt ab `auth.max_versuche_kennung`
-- (Vorgabe 10) fuer `auth.sperrdauer_minuten` (Vorgabe 30).
--
-- **Die Sperrdauer ist damit laenger als das Fenster — und genau deshalb
-- reicht es nicht, `gesperrt_bis` zu loeschen.** Der reale Fall ist der
-- Anruf: jemand ist um 09:00 ausgesperrt, meldet sich um 09:05, und der Admin
-- entsperrt. Ein einziger weiterer Fehlversuch um 09:06 findet die zehn alten
-- Zeilen von 09:00 noch im Fenster — und sperrt sofort wieder. Die
-- Entsperrung waere ein Knopf, der manchmal still nichts tut.
--
-- **Die Zeilen zu loeschen kommt nicht in Frage** (Invariante 8):
-- `kern.anmeldeversuch` ist die Spur, an der ein Angriff spaeter abgelesen
-- wird. Stattdessen merkt sich das Konto, WANN entsperrt wurde, und das
-- Fenster beginnt fruehestens dort. Was danach schiefgeht, zaehlt weiter —
-- die Wache bleibt scharf, sie zaehlt nur nicht mehr zweimal dasselbe.

alter table benutzer add column entsperrt_am timestamptz;

comment on column benutzer.entsperrt_am is
  'Wann dieses Konto zuletzt von Hand entsperrt wurde. `versuch_protokollieren` '
  'zaehlt Fehlversuche erst ab hier — sonst sperrten die Versuche, die zur '
  'Sperre fuehrten, das Konto sofort wieder (V-074).';

create or replace function app.versuch_protokollieren(
  p_kennung text, p_ip inet, p_erfolg boolean, p_grund text, p_art text default 'passwort'
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_hash     text := encode(digest(lower(coalesce(p_kennung, '')), 'sha256'), 'hex');
  v_fenster  int  := coalesce((app.plattform_einstellung('auth.fenster_minuten'))::int, 15);
  v_max_kenn int  := coalesce((app.plattform_einstellung('auth.max_versuche_kennung'))::int, 10);
  v_max_ip   int  := coalesce((app.plattform_einstellung('auth.max_versuche_ip'))::int, 50);
  v_sperre   int  := coalesce((app.plattform_einstellung('auth.sperrdauer_minuten'))::int, 30);
  v_seit     timestamptz := now() - make_interval(mins => v_fenster);
  v_kenn     int;
  v_ip       int;
  v_benutzer uuid;
  v_entsperrt timestamptz;
begin
  insert into kern.anmeldeversuch (kennung_hash, ip, art, erfolg, grund)
  values (v_hash, p_ip, p_art, p_erfolg, p_grund);

  if p_erfolg then
    return true;
  end if;

  /*
   * **Das Fenster beginnt fruehestens bei der letzten Entsperrung** (V-074).
   *
   * Nachgeschlagen wird ueber denselben Hash wie der Zaehler, nicht ueber die
   * Klartext-Kennung: die Funktion kennt das Konto sonst gar nicht. Ein
   * unbekanntes Konto findet nichts und rechnet weiter wie bisher — der
   * Rueckgabewert bleibt fuer alle Faelle derselbe, sonst waere er ein
   * Enumerationsorakel.
   */
  select b.entsperrt_am into v_entsperrt
    from public.benutzer b
   where lower(b.email) = lower(p_kennung) and b.deaktiviert_am is null;
  if v_entsperrt is not null and v_entsperrt > v_seit then
    v_seit := v_entsperrt;
  end if;

  select count(*) into v_kenn from kern.anmeldeversuch a
   where a.kennung_hash = v_hash and not a.erfolg and a.erstellt_am >= v_seit;
  /*
   * Der IP-Zaehler bleibt beim vollen Fenster. Eine Entsperrung gilt einem
   * KONTO; sie darf nicht die Schwelle fuer eine Adresse zuruecksetzen, hinter
   * der gerade fuenfzig fremde Konten durchprobiert werden.
   */
  select count(*) into v_ip from kern.anmeldeversuch a
   where a.ip is not distinct from p_ip and not a.erfolg
     and a.erstellt_am >= now() - make_interval(mins => v_fenster);

  if v_kenn >= v_max_kenn then
    select b.id into v_benutzer from public.benutzer b
     where lower(b.email) = lower(p_kennung) and b.deaktiviert_am is null;
    if v_benutzer is not null then
      update public.benutzer
         set gesperrt_bis = now() + make_interval(mins => v_sperre), status = 'gesperrt'
       where id = v_benutzer;
      perform app.protokolliere('auth.konto_gesperrt', 'benutzer', v_benutzer::text,
                                null, jsonb_build_object('versuche', v_kenn), null);
    end if;
    return false;
  end if;

  return v_kenn < v_max_kenn and v_ip < v_max_ip;
end $$;

-- ---------------------------------------------------------------------------
-- Die gemeinsame Vorpruefung — als Funktion, nicht als Kommentar
-- ---------------------------------------------------------------------------
--
-- Sie prueft NUR, was bei allen vier gleich ist: Schreibbarkeit, zweiter
-- Faktor und die Mitgliedschaft des ZIELS im aktiven Mandanten. Das RECHT
-- fragt jede Funktion selbst — es ist bei `sitzungen_widerrufen` ein anderes
-- als bei den drei uebrigen, und eine Wache, die das Recht als Parameter
-- naehme, waere eine Wache, die man mit dem falschen Parameter aufrufen kann.

create function app.konto_ziel_pruefen(p_benutzer uuid) returns uuid
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare v_mandant uuid := app.aktiver_mandant();
begin
  if p_benutzer is null then
    raise exception 'Ohne Konto keine Handlung.' using errcode = '22023';
  end if;
  if v_mandant is null or app.ist_gruppenansicht() then
    raise exception 'Kontoverwaltung verlangt genau einen aktiven Mandanten.'
      using errcode = '42501',
            hint = 'Die Gruppenansicht ist lesend (Invariante 10).';
  end if;
  if app.ist_readonly() then
    raise exception 'Diese Sitzung ist lesend.' using errcode = '42501';
  end if;
  if app.aal() <> 'aal2' then
    raise exception 'Kontoverwaltung verlangt den zweiten Faktor.'
      using errcode = '42501', hint = 'K-15.';
  end if;
  /*
   * **Das Ziel muss in DIESER Gesellschaft sitzen** (K-03). Ohne diese Zeile
   * reichte ein Admin der Reinigung in die Security hinein, sobald er die
   * Kennung eines dortigen Kontos kennt — und Kennungen sind keine
   * Geheimnisse.
   */
  if not exists (select 1 from public.benutzer_mandant bm
                  where bm.benutzer_id = p_benutzer
                    and bm.mandant_id = v_mandant
                    and bm.entzogen_am is null) then
    raise exception 'Dieses Konto gehoert nicht zu dieser Gesellschaft.'
      using errcode = '42501';
  end if;
  return v_mandant;
end $$;

comment on function app.konto_ziel_pruefen(uuid) is
  'Was bei jeder Kontohandlung gleich ist: schreibbare Sitzung, zweiter Faktor '
  'und ein Ziel, das Mitglied des AKTIVEN Mandanten ist. Das Recht prueft jede '
  'Funktion selbst — es ist nicht bei allen dasselbe.';

alter function app.konto_ziel_pruefen(uuid) owner to cse_definer;
/*
 * **`create function` gibt PUBLIC das EXECUTE, ungefragt** (K-08). Ohne den
 * Entzug haelt jede Rolle der Datenbank den Aufruf — auch `cse_anon` und
 * `cse_checkin`, die hier nichts zu suchen haben. Dass die Funktion drinnen
 * ihr Recht prueft, ist kein Ersatz: sie prueft es gegen die GUCs des
 * Aufrufers, und ein Prinzipal ohne Sitzung hat keine.
 *
 * Gefunden von `tests/isolation/definer-eigentum.test.ts` §K-08, die genau
 * diesen Fall zaehlt — ohne sie waere er still geblieben.
 */
revoke all on function app.konto_ziel_pruefen(uuid) from public;
grant execute on function app.konto_ziel_pruefen(uuid) to cse_app;

-- ---------------------------------------------------------------------------
-- V-074 — entsperren
-- ---------------------------------------------------------------------------

create function app.konto_entsperren(p_benutzer uuid, p_grund text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.konto_ziel_pruefen(p_benutzer);
  v_vorher  text;
begin
  if not app.hat_recht('system.benutzer_verwalten', v_mandant) then
    raise exception 'Entsperren verlangt system.benutzer_verwalten.'
      using errcode = '42501';
  end if;
  if p_grund is null or btrim(p_grund) = '' then
    raise exception 'Eine Entsperrung ohne Grund ist im Streitfall keine.'
      using errcode = '22023';
  end if;

  select b.status::text into v_vorher from public.benutzer b where b.id = p_benutzer;
  if v_vorher is distinct from 'gesperrt' then
    /*
     * Kein Fehler, sondern `false`: zwei Bearbeiterinnen auf demselben Blatt
     * sind der Normalfall, und die zweite soll „ist schon offen" lesen und
     * nicht eine Ausnahme. Unterschieden wird beides am Rueckgabewert.
     */
    return false;
  end if;

  update public.benutzer
     set status = 'aktiv', gesperrt_bis = null, entsperrt_am = now()
   where id = p_benutzer;

  perform app.protokolliere('auth.konto_entsperrt', 'benutzer', p_benutzer::text,
                            jsonb_build_object('status', v_vorher),
                            jsonb_build_object('status', 'aktiv', 'grund', p_grund),
                            v_mandant);
  return true;
end $$;

comment on function app.konto_entsperren(uuid, text) is
  'V-074. Die Brute-Force-Sperre war eine Einbahnstrasse. `entsperrt_am` setzt '
  'zugleich das Zaehlfenster, sonst sperrte der naechste Fehlversuch sofort '
  'wieder.';

alter function app.konto_entsperren(uuid, text) owner to cse_definer;
revoke all on function app.konto_entsperren(uuid, text) from public;
grant execute on function app.konto_entsperren(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- V-075 und V-022 — deaktivieren und wieder aktivieren
-- ---------------------------------------------------------------------------
--
-- **Deaktivieren, nicht loeschen** (Invariante 8). `audit_log` benennt dieses
-- Konto als Akteur, dauerhaft; ein geloeschtes Konto macht jede Zeile
-- herrenlos, die es geschrieben hat. Der Trigger `trg_benutzer_kein_hard_delete`
-- sagt dasselbe noch einmal.
--
-- **Die Sitzungen enden mit.** `app.sitzung_aufloesen` verlangt `status =
-- 'aktiv'` (0138) — ein deaktiviertes Konto kommt beim naechsten Aufruf also
-- ohnehin nicht mehr durch. Die offenen Zeilen in `benutzer_sitzung` blieben
-- aber als „laeuft bis …" stehen, und eine Liste, die einen Zugang behauptet,
-- den es nicht gibt, ist schlimmer als keine Liste.
--
-- **Niemand deaktiviert sich selbst.** Es gibt keinen Weg zurueck, der nicht
-- ueber ein anderes Konto fuehrt: wer sich selbst deaktiviert, sperrt sich in
-- derselben Sekunde aus, in der er die Taste loslaesst. Dieselbe Begruendung
-- wie bei `beendeEigeneSitzung` (V-039).

create function app.konto_deaktivieren(p_benutzer uuid, p_grund text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.konto_ziel_pruefen(p_benutzer);
  v_vorher  text;
  v_offen   int;
begin
  if not app.hat_recht('system.benutzer_verwalten', v_mandant) then
    raise exception 'Deaktivieren verlangt system.benutzer_verwalten.'
      using errcode = '42501';
  end if;
  if p_benutzer = app.aktueller_benutzer() then
    raise exception 'Das eigene Konto laesst sich nicht deaktivieren.'
      using errcode = '42501',
            hint = 'Der Weg zurueck fuehrt ueber ein anderes Konto.';
  end if;
  if p_grund is null or btrim(p_grund) = '' then
    raise exception 'Ein Zugangsentzug ohne Grund ist im Streitfall keiner.'
      using errcode = '22023';
  end if;

  select b.status::text into v_vorher from public.benutzer b where b.id = p_benutzer;
  if v_vorher = 'deaktiviert' then
    return false;
  end if;

  update public.benutzer
     set status = 'deaktiviert', deaktiviert_am = now(), gesperrt_bis = null
   where id = p_benutzer;

  update public.benutzer_sitzung
     set beendet_am = now(), ende_grund = 'gesperrt'
   where benutzer_id = p_benutzer and beendet_am is null;
  get diagnostics v_offen = row_count;

  perform app.protokolliere('auth.konto_deaktiviert', 'benutzer', p_benutzer::text,
                            jsonb_build_object('status', v_vorher),
                            jsonb_build_object('status', 'deaktiviert',
                                               'grund', p_grund,
                                               'sitzungen_beendet', v_offen),
                            v_mandant);
  return true;
end $$;

comment on function app.konto_deaktivieren(uuid, text) is
  'V-075, V-022. Der einzige Erzeuger von `status = deaktiviert`. Beendet die '
  'offenen Sitzungen mit, damit die Liste keinen Zugang behauptet, den es nicht '
  'mehr gibt. Nie das eigene Konto.';

alter function app.konto_deaktivieren(uuid, text) owner to cse_definer;
revoke all on function app.konto_deaktivieren(uuid, text) from public;
grant execute on function app.konto_deaktivieren(uuid, text) to cse_app;

/**
 * Der Weg zurueck.
 *
 * **Er geht auf `aktiv` und nicht auf `eingeladen`.** Ein reaktiviertes Konto
 * hat seine Anmeldung noch; `eingeladen` hiesse, die Einladung sei offen, und
 * das Blatt zeigte einen Einladungsstand, den niemand verschickt hat.
 */
create function app.konto_reaktivieren(p_benutzer uuid, p_grund text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.konto_ziel_pruefen(p_benutzer);
  v_vorher  text;
begin
  if not app.hat_recht('system.benutzer_verwalten', v_mandant) then
    raise exception 'Reaktivieren verlangt system.benutzer_verwalten.'
      using errcode = '42501';
  end if;
  if p_grund is null or btrim(p_grund) = '' then
    raise exception 'Eine Reaktivierung ohne Grund ist im Streitfall keine.'
      using errcode = '22023';
  end if;

  select b.status::text into v_vorher from public.benutzer b where b.id = p_benutzer;
  if v_vorher is distinct from 'deaktiviert' then
    return false;
  end if;

  update public.benutzer
     set status = 'aktiv', deaktiviert_am = null, entsperrt_am = now()
   where id = p_benutzer;

  perform app.protokolliere('auth.konto_reaktiviert', 'benutzer', p_benutzer::text,
                            jsonb_build_object('status', v_vorher),
                            jsonb_build_object('status', 'aktiv', 'grund', p_grund),
                            v_mandant);
  return true;
end $$;

comment on function app.konto_reaktivieren(uuid, text) is
  'V-022. Der Rueckweg aus `deaktiviert`. Auf `aktiv`, nicht auf `eingeladen` — '
  'die Anmeldung besteht, es wurde nur der Zugang entzogen.';

alter function app.konto_reaktivieren(uuid, text) owner to cse_definer;
revoke all on function app.konto_reaktivieren(uuid, text) from public;
grant execute on function app.konto_reaktivieren(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- V-076 — fremde Sitzungen widerrufen
-- ---------------------------------------------------------------------------
--
-- **Ein EIGENES Recht, und deshalb eine eigene Funktion.** `system.benutzer_
-- verwalten` und `system.sitzung_widerrufen` sind im Katalog getrennt, und die
-- Trennung ist die zwischen „darf Zugaenge gestalten" und „darf jemanden JETZT
-- hinauswerfen" — der zweite Fall ist der Verdachtsfall, und `leitung` ist
-- dafuer bindbar, ohne dass sie Rollen vergeben duerfte.
--
-- **Der Widerruf beendet, er deaktiviert nicht.** Wer widerrufen ist, kann
-- sich sofort wieder anmelden; das ist der Unterschied zum Entzug und der
-- Grund, warum der Widerruf am kleineren Recht haengt. Er nimmt ein
-- gestohlenes Plaetzchen aus dem Verkehr, keinen Menschen aus dem Betrieb.

create function app.sitzungen_widerrufen(p_benutzer uuid, p_grund text)
returns int
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.konto_ziel_pruefen(p_benutzer);
  v_anzahl  int;
begin
  if not app.hat_recht('system.sitzung_widerrufen', v_mandant) then
    raise exception 'Der Widerruf verlangt system.sitzung_widerrufen.'
      using errcode = '42501';
  end if;
  if p_grund is null or btrim(p_grund) = '' then
    raise exception 'Ein Widerruf ohne Grund ist im Streitfall keiner.'
      using errcode = '22023';
  end if;
  /*
   * **Die eigenen Sitzungen gehen hier NICHT** — dafuer gibt es
   * `/portal/konto/sicherheit` (V-039), und dort bleibt die laufende stehen.
   * Ueber diesen Weg beendete man sie mit, saehe die Weiterleitung nicht mehr
   * und wuesste nicht, warum.
   */
  if p_benutzer = app.aktueller_benutzer() then
    raise exception 'Die eigenen Anmeldungen stehen unter /portal/konto/sicherheit.'
      using errcode = '42501';
  end if;

  update public.benutzer_sitzung
     set beendet_am = now(), ende_grund = 'gesperrt'
   where benutzer_id = p_benutzer and beendet_am is null;
  get diagnostics v_anzahl = row_count;

  if v_anzahl > 0 then
    perform app.protokolliere('auth.sitzungen_widerrufen', 'benutzer', p_benutzer::text,
                              null,
                              jsonb_build_object('anzahl', v_anzahl, 'grund', p_grund),
                              v_mandant);
  end if;
  return v_anzahl;
end $$;

comment on function app.sitzungen_widerrufen(uuid, text) is
  'V-076. Das Recht `system.sitzung_widerrufen` war vergeben und wurde von '
  'keiner Zeile geprueft. Beendet ALLE offenen Anmeldungen eines fremden '
  'Kontos — nie die eigenen, die stehen unter /portal/konto/sicherheit.';

alter function app.sitzungen_widerrufen(uuid, text) owner to cse_definer;
revoke all on function app.sitzungen_widerrufen(uuid, text) from public;
grant execute on function app.sitzungen_widerrufen(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- Was `cse_definer` dafuer braucht — und was er laengst hat
-- ---------------------------------------------------------------------------
--
-- Der Definer umgeht RLS nicht automatisch: er laeuft ALS `cse_definer`, und
-- auch der stoesst auf `force row level security`. Dieselbe Lektion wie in
-- `0374` und `0377` — ohne Grant und Policy antwortet die Funktion mit
-- „permission denied", und zwar erst zur Laufzeit.
--
-- **Das meiste steht schon da, und deshalb steht hier so wenig.** Die
-- Anmeldung laeuft seit `0116` als Definer und hat dabei mitgebracht, was die
-- vier Funktionen oben brauchen:
--
--   benutzer            `grant select, update` (0155), Lesepolicy
--                       `d_benutzer_anmeldung` (0116) — UPDATE-Policy: FEHLT
--   benutzer_sitzung    `grant select, insert, update` (0155), Policies
--                       `d_sitzung_lesen` / `d_sitzung_beenden` (0116) — fertig
--   benutzer_mandant    Spalten-Grant auf u. a. `benutzer_id, mandant_id,
--                       entzogen_am` (0128), Policy `d_feed_mitgliedschaft`
--                       (0161) — genau die drei Spalten, die
--                       `konto_ziel_pruefen` liest
--
-- Es fehlt also GENAU eine Zeile: schreiben durfte `cse_definer` auf
-- `benutzer` bislang nur dem Grant nach, nie einer Policy nach. Dass
-- `app.versuch_protokollieren` trotzdem sperren konnte, liegt daran, dass sie
-- einem anderen Eigentuemer gehoert — es war nie ein Beleg dafuer, dass
-- `cse_definer` hier schreiben darf.
--
-- **`using (true)` ist nicht die Rechtefrage.** Die steht in den vier
-- Funktionen, je einzeln, gegen den AKTIVEN Mandanten; `cse_definer` ist kein
-- Weg, auf den eine Sitzung von aussen kaeme (K-08). Eine Policy, die hier
-- noch einmal `hat_recht` fragte, fragte es gegen die GUCs derselben Sitzung
-- und sagte damit nichts Neues — sie sähe nur so aus.

create policy d_benutzer_konto_schreiben on public.benutzer
  for update to cse_definer using (true) with check (true);

comment on policy d_benutzer_konto_schreiben on public.benutzer is
  'V-022, V-074, V-075. `status`, `gesperrt_bis`, `deaktiviert_am` und '
  '`entsperrt_am` sind `cse_app` entzogen (Spalten-Grant, 0007). Geschrieben '
  'werden sie nur von app.konto_entsperren / _deaktivieren / _reaktivieren, '
  'und jede von ihnen fragt ihr Recht selbst.';
