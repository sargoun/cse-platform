-- 0155 — Die echte Anmeldung: Kennwort, zweiter Faktor, Einladung, Zurücksetzung.
--
-- AUT-01 (E-Mail + Kennwort), AUT-02 (zweiter Faktor für Rollen mit
-- `erfordert_2fa`), AUT-04 (Einladung), AUT-07 (Rate-Limiting — steht schon in
-- 0007 und wird hier nur benutzt).
--
-- ---------------------------------------------------------------------------
-- Warum überhaupt etwas Eigenes, wenn Supabase Auth gesetzt ist
-- ---------------------------------------------------------------------------
--
-- Gesetzt ist der Anbieter, nicht der Zeitpunkt. Solange kein Supabase-Projekt
-- hinterlegt ist, gibt es im ganzen Haus **keinen** Weg an einem Kennwort
-- vorbei ins interne Portal: `/dev/anmelden` stellt eine Sitzung ohne jede
-- Prüfung aus und steht hinter `CSE_DEV_FLAECHEN`. Zehn Routen unter `/auth`
-- existieren nur als Zeile in der Spezifikation.
--
-- Diese Migration legt die Speicher an, die eine Anmeldung überhaupt erst
-- prüfbar machen, und markiert jede Zeile mit ihrem `anbieter`. `'demo'` heisst:
-- das Konto wird hier geprüft. `'supabase'` heisst: `auth.users` gewinnt, und
-- diese Tabelle hält für dieses Konto kein Geheimnis. Der Wechsel ist damit
-- eine Zeile je Konto und kein Umbau — und der Bildschirm sagt, welcher der
-- beiden gerade gilt, statt es zu verschweigen.
--
-- ---------------------------------------------------------------------------
-- Warum `kern` und nicht `public`
-- ---------------------------------------------------------------------------
--
-- Ein Kennwort-Hash und ein TOTP-Geheimnis sind die zwei Werte, die eine
-- Anwendung nie braucht. Sie werden geprüft, nicht gelesen. In `public` läge
-- beides unter RLS — also hinter einer Policy, die jemand später weiten kann.
-- In `kern` liegt es hinter GAR KEINEM Tabellenrecht: `cse_app` hat auf diesem
-- Schema `usage`, aber auf diesen Tabellen kein `select`. Der einzige Weg
-- führt durch die `security definer`-Funktionen unten, und die geben den Hash
-- nie heraus — sie vergleichen ihn in der Datenbank (`crypt`) und antworten mit
-- ja oder nein.
--
-- Das TOTP-Geheimnis ist die eine Ausnahme: RFC 6238 rechnet HMAC-SHA1 über
-- einen Zeitschritt, und das tut hier Node. Also verlässt es die Datenbank —
-- aber nur für das EIGENE, bereits gebundene Konto (`app.aktueller_benutzer()`),
-- nie für ein fremdes und nie vor der ersten Stufe der Anmeldung.

-- ---------------------------------------------------------------------------
-- kern.zugangsdaten — ein Kennwort je Konto.
-- ---------------------------------------------------------------------------

create table kern.zugangsdaten (
  benutzer_id         uuid primary key references public.benutzer(id) on delete cascade,
  -- Wie `modell_register.anbieter` (0154): die Herkunft steht in der Zeile,
  -- nicht in einer Umgebungsvariablen neben der Zeile.
  anbieter            text not null default 'demo'
                        check (anbieter ~ '^[a-z][a-z0-9_-]*$'),
  -- bcrypt aus pgcrypto. Kein SHA und kein eigener Aufbau: ein Kennwort-Hash
  -- muss langsam sein, und `crypt`/`gen_salt('bf', …)` ist der langsame, der
  -- hier ohne zusätzliche Abhängigkeit schon liegt.
  kennwort_hash       text,
  kennwort_gesetzt_am timestamptz,
  -- AUT-04: ein von der Verwaltung gesetztes Kennwort gilt für genau eine
  -- Anmeldung; danach verlangt der Weg ein eigenes.
  muss_wechseln       boolean not null default false,
  erstellt_am         timestamptz not null default now(),
  geaendert_am        timestamptz,

  constraint zd_hash_hat_zeitpunkt
    check ((kennwort_hash is null) = (kennwort_gesetzt_am is null)),
  -- Ein fremder Anbieter hält hier nichts: sonst stünde derselbe Mensch mit
  -- zwei Kennwörtern in zwei Systemen, und welches gilt, entschiede die
  -- Reihenfolge der Abfrage.
  constraint zd_fremder_anbieter_ohne_hash
    check (anbieter = 'demo' or kennwort_hash is null)
);

comment on table kern.zugangsdaten is
  'Kennwort je Konto. Nur über app.*-Funktionen erreichbar; cse_app hat kein select.';

-- ---------------------------------------------------------------------------
-- kern.zweiter_faktor — TOTP nach RFC 6238.
-- ---------------------------------------------------------------------------

create table kern.zweiter_faktor (
  id            uuid primary key default gen_random_uuid(),
  benutzer_id   uuid not null references public.benutzer(id) on delete cascade,
  art           text not null default 'totp' check (art in ('totp')),
  -- Base32 ohne Polster, wie `otpauth://` es erwartet.
  geheimnis     text not null check (geheimnis ~ '^[A-Z2-7]{16,64}$'),
  -- NULL = angelegt, aber nie mit einem richtigen Code bestätigt. Ein solcher
  -- Faktor zählt NICHT: sonst sperrte ein abgebrochenes Einrichten das Konto
  -- aus, weil `hat_zweiten_faktor` ja sagt und niemand den Code kennt.
  bestaetigt_am timestamptz,
  letzter_schritt bigint,
  erstellt_am   timestamptz not null default now()
);

-- Genau EIN bestätigter Faktor je Konto. Unbestätigte dürfen mehrere
-- herumliegen — jeder Neuversuch legt einen an, und der alte verfällt still.
create unique index zweiter_faktor_bestaetigt_uk
  on kern.zweiter_faktor (benutzer_id) where bestaetigt_am is not null;
create index zweiter_faktor_benutzer_idx on kern.zweiter_faktor (benutzer_id, erstellt_am desc);

-- ---------------------------------------------------------------------------
-- kern.wiederherstellungscode — der Weg zurück ohne Telefon.
-- ---------------------------------------------------------------------------

create table kern.wiederherstellungscode (
  id            uuid primary key default gen_random_uuid(),
  benutzer_id   uuid not null references public.benutzer(id) on delete cascade,
  -- SHA-256 des Codes. Wie beim Sitzungstoken: der Rohwert wird EINMAL
  -- angezeigt und nie gespeichert.
  code_hash     text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  eingeloest_am timestamptz,
  erstellt_am   timestamptz not null default now()
);

create unique index wiederherstellungscode_uk on kern.wiederherstellungscode (benutzer_id, code_hash);
create index wiederherstellungscode_offen_idx
  on kern.wiederherstellungscode (benutzer_id) where eingeloest_am is null;

-- ---------------------------------------------------------------------------
-- kern.kennwort_token — Einladung und Zurücksetzung, eine Tabelle.
-- ---------------------------------------------------------------------------

/**
 * Beide sind derselbe Vorgang: ein einmaliger, befristeter Beweis, der zum
 * Setzen eines Kennworts berechtigt. Zwei Tabellen hiessen zwei Abläufe, die
 * auseinanderdriften — und die Einladung ist genau die Zurücksetzung eines
 * Kontos, das noch keines hatte.
 */
create table kern.kennwort_token (
  id            uuid primary key default gen_random_uuid(),
  benutzer_id   uuid not null references public.benutzer(id) on delete cascade,
  zweck         text not null check (zweck in ('zuruecksetzen','einladung')),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  gueltig_bis   timestamptz not null,
  eingeloest_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references public.benutzer(id)
);

create index kennwort_token_benutzer_idx on kern.kennwort_token (benutzer_id, erstellt_am desc);

-- Fristen und Länge — PLATZHALTER (K-17). Die SPEC nennt keine Zahl.
-- TODO(client): O-500 — Gültigkeit des Einladungs- und des
-- Zurücksetzungs-Links, Anzahl der Wiederherstellungscodes, und ob ein
-- gesetztes Kennwort eine Mindestlänge über 12 Zeichen hinaus braucht.
insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig) values
  ('auth.einladung_stunden', '168'::jsonb,
   'Gültigkeit eines Einladungslinks in Stunden (VORLÄUFIG, O-500).', true),
  ('auth.zuruecksetzung_stunden', '2'::jsonb,
   'Gültigkeit eines Zurücksetzungslinks in Stunden (VORLÄUFIG, O-500).', true),
  ('auth.wiederherstellungscodes', '10'::jsonb,
   'Anzahl der ausgegebenen Wiederherstellungscodes (VORLÄUFIG, O-500).', true),
  ('auth.kennwort_mindestlaenge', '12'::jsonb,
   'Mindestlänge eines Kennworts (VORLÄUFIG, O-500).', true);

-- ---------------------------------------------------------------------------
-- app.hat_zweiten_faktor — jetzt auch über den eigenen Speicher.
-- ---------------------------------------------------------------------------

/**
 * In Supabase gewinnt weiterhin `auth.mfa_factors`. Lokal zählt ein
 * **bestätigter** Faktor aus `kern.zweiter_faktor`. Das `or` ist keine
 * Aufweichung: beide Seiten fragen dasselbe — liegt ein benutzbarer zweiter
 * Faktor vor —, und keine der beiden kann die andere überstimmen.
 */
create or replace function app.hat_zweiten_faktor(p_benutzer uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app, kern, auth as $$
  select exists (
      select 1 from auth.mfa_factors f
       where f.user_id = p_benutzer and f.status = 'verified')
      or exists (
      select 1 from kern.zweiter_faktor z
       where z.benutzer_id = p_benutzer and z.bestaetigt_am is not null)
$$;

grant execute on function app.hat_zweiten_faktor(uuid) to cse_app, cse_anon;

-- ---------------------------------------------------------------------------
-- app.kennwort_pruefen_und_anmelden — die erste Stufe, in EINER Anweisung.
-- ---------------------------------------------------------------------------

/**
 * Prüfen, protokollieren und die Sitzung ausstellen gehören zusammen, weil
 * jede Lücke dazwischen eine Frage aufwirft, die niemand beantworten kann:
 * war der Versuch erfolgreich, aber die Sitzung kam nicht? Zählt er dann?
 *
 * **Die Sitzung ist immer `aal1`.** Auch für ein Konto ohne Pflicht zum
 * zweiten Faktor — `aal2` bedeutet „in DIESER Anmeldung vorgezeigt", und
 * vorgezeigt wurde nichts. Was `aal2` verlangt, steht in
 * `berechtigung.erfordert_2fa` und bleibt bis dahin leer; der Weg dorthin ist
 * `app.sitzung_faktor_bestaetigt` unten.
 *
 * `ergebnis`:
 *   'ok'            — Sitzung steht. `braucht_faktor` sagt, ob sie noch an
 *                     den Weg unter `/auth/zwei-faktor` vorbei muss.
 *   'falsch'        — Kennung oder Kennwort. EIN Wort für beide Fälle.
 *   'gesperrt'      — Konto gesperrt (AUT-07) oder nicht aktiv.
 *   'gebremst'      — zu viele Fehlversuche im Fenster.
 *   'fremd'         — dieses Konto wird woanders geprüft (anbieter <> 'demo').
 */
create type anmeldung_ergebnis as enum ('ok','falsch','gesperrt','gebremst','fremd');

create function app.kennwort_anmelden(
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
     and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
   order by bm.ist_standard desc, bm.erstellt_am
   limit 1;
  v_ansicht := case when v_mandant is null then 'gruppe' else 'mandant' end::sitzung_ansicht;

  -- Verlangt IRGENDEINE Rolle dieses Kontos den zweiten Faktor?
  select exists (
    select 1 from public.rolle r
     where r.erfordert_2fa
       and (r.id = (select b2.globale_rolle_id from public.benutzer b2 where b2.id = v_b.id)
            or r.id in (select bm.rolle_id from public.benutzer_mandant bm
                         where bm.benutzer_id = v_b.id and bm.entzogen_am is null)))
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
  'AUT-01: E-Mail + Kennwort, Rate-Limiting, Sitzung als aal1. Der Hash verlässt die Datenbank nie.';

grant execute on function app.kennwort_anmelden(text, text, text, inet, text) to cse_anon, cse_app;

-- ---------------------------------------------------------------------------
-- Der zweite Faktor.
-- ---------------------------------------------------------------------------

/**
 * Ein Geheimnis anlegen — für das EIGENE, schon gebundene Konto.
 *
 * Die Einrichtung findet nach der ersten Stufe statt: es gibt eine Sitzung,
 * sie ist `aal1`, und `app.aktueller_benutzer()` steht. Ein Parameter für den
 * Benutzer wäre eine Einladung, ein fremdes Konto mit einem eigenen Faktor zu
 * versehen.
 */
create function app.faktor_anlegen(p_geheimnis text) returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare v_id uuid; v_benutzer uuid := app.aktueller_benutzer();
begin
  if v_benutzer is null then return null; end if;
  -- Ein bereits bestätigter Faktor wird nicht still ersetzt: der Weg dorthin
  -- ist `system.zwei_faktor_zuruecksetzen` durch eine Verwaltung (0008).
  if exists (select 1 from kern.zweiter_faktor z
              where z.benutzer_id = v_benutzer and z.bestaetigt_am is not null) then
    return null;
  end if;
  delete from kern.zweiter_faktor z
   where z.benutzer_id = v_benutzer and z.bestaetigt_am is null;
  insert into kern.zweiter_faktor (benutzer_id, geheimnis)
  values (v_benutzer, p_geheimnis) returning id into v_id;
  return v_id;
end $$;

grant execute on function app.faktor_anlegen(text) to cse_app;

/**
 * Das Geheimnis für die Prüfung herausgeben — die eine Stelle, an der es die
 * Datenbank verlässt, und nur für das eigene Konto.
 *
 * `p_nur_bestaetigt` trennt die zwei Momente: beim Einrichten wird der frisch
 * angelegte, noch unbestätigte geprüft; bei jeder späteren Anmeldung nur der
 * bestätigte.
 */
create function app.faktor_geheimnis(p_nur_bestaetigt boolean default true)
returns table (id uuid, geheimnis text, letzter_schritt bigint)
language sql stable security definer
set search_path = pg_catalog, public, app, kern as $$
  select z.id, z.geheimnis, z.letzter_schritt
    from kern.zweiter_faktor z
   where z.benutzer_id = app.aktueller_benutzer()
     and (z.bestaetigt_am is not null or not p_nur_bestaetigt)
   order by (z.bestaetigt_am is not null) desc, z.erstellt_am desc
   limit 1
$$;

grant execute on function app.faktor_geheimnis(boolean) to cse_app;

/**
 * Der Schritt wird festgehalten, damit derselbe Code kein zweites Mal gilt.
 *
 * Ohne das ist TOTP gegen Wiedereinspielung offen: wer den Code im selben
 * 30-Sekunden-Fenster abfängt, kommt damit durch. `letzter_schritt` macht
 * jeden Code einmalig, und die Bedingung im UPDATE entscheidet das Rennen
 * zweier gleichzeitiger Versuche in der Datenbank statt in der Anwendung.
 */
create function app.faktor_schritt_verbrauchen(p_id uuid, p_schritt bigint) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare v_treffer int;
begin
  update kern.zweiter_faktor z
     set letzter_schritt = p_schritt,
         bestaetigt_am   = coalesce(z.bestaetigt_am, now())
   where z.id = p_id
     and z.benutzer_id = app.aktueller_benutzer()
     and (z.letzter_schritt is null or z.letzter_schritt < p_schritt);
  get diagnostics v_treffer = row_count;
  return v_treffer = 1;
end $$;

grant execute on function app.faktor_schritt_verbrauchen(uuid, bigint) to cse_app;

/**
 * Die Sitzung auf `aal2` heben — der einzige Weg dorthin.
 *
 * Über den Hash des Tokens, nicht über den Benutzer: dieselbe Begründung wie
 * bei `app.sitzung_beenden`. Wer den Token hat, IST der Inhaber — und die
 * Anhebung gilt genau der Sitzung, in der der Faktor vorgezeigt wurde, nicht
 * allen offenen Sitzungen dieses Kontos.
 */
create function app.sitzung_faktor_bestaetigt(p_token_hash text) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app as $$
declare v_treffer int;
begin
  update public.benutzer_sitzung s
     set aal = 'aal2'
   where s.token_hash = p_token_hash and s.beendet_am is null and s.ablauf_am > now();
  get diagnostics v_treffer = row_count;
  return v_treffer = 1;
end $$;

grant execute on function app.sitzung_faktor_bestaetigt(text) to cse_app, cse_anon;

-- ---------------------------------------------------------------------------
-- Wiederherstellungscodes.
-- ---------------------------------------------------------------------------

create function app.wiederherstellungscodes_setzen(p_hashes text[]) returns int
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare v_benutzer uuid := app.aktueller_benutzer(); v_n int;
begin
  if v_benutzer is null then return 0; end if;
  -- Neue Codes ersetzen die alten vollständig. Ein Bestand aus zwei Ausgaben
  -- hiesse, dass ein Zettel von vor einem Jahr weiter gilt.
  delete from kern.wiederherstellungscode where benutzer_id = v_benutzer;
  insert into kern.wiederherstellungscode (benutzer_id, code_hash)
  select v_benutzer, h from unnest(p_hashes) as h;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function app.wiederherstellungscodes_setzen(text[]) to cse_app;

create function app.wiederherstellungscode_einloesen(p_hash text) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare v_treffer int; v_benutzer uuid := app.aktueller_benutzer();
begin
  if v_benutzer is null then return false; end if;
  update kern.wiederherstellungscode c
     set eingeloest_am = now()
   where c.benutzer_id = v_benutzer and c.code_hash = p_hash and c.eingeloest_am is null;
  get diagnostics v_treffer = row_count;
  if v_treffer = 1 then
    perform app.protokolliere('auth.wiederherstellungscode_benutzt', 'benutzer',
                              v_benutzer::text, null, null, null);
  end if;
  return v_treffer = 1;
end $$;

grant execute on function app.wiederherstellungscode_einloesen(text) to cse_app;

create function app.wiederherstellungscodes_offen() returns int
language sql stable security definer set search_path = pg_catalog, public, app, kern as $$
  select count(*)::int from kern.wiederherstellungscode c
   where c.benutzer_id = app.aktueller_benutzer() and c.eingeloest_am is null
$$;

grant execute on function app.wiederherstellungscodes_offen() to cse_app;

-- ---------------------------------------------------------------------------
-- Einladung und Zurücksetzung.
-- ---------------------------------------------------------------------------

/**
 * Einen Token anlegen — und **immer dasselbe antworten**.
 *
 * Gibt es die Adresse nicht, passiert nichts und die Rückgabe ist trotzdem
 * `true`. Sonst wäre „Kennwort vergessen" die bequemste Auskunft darüber,
 * welche Adressen ein Konto haben — dieselbe Regel wie AUT-06 und wie bei der
 * Mitarbeiteranmeldung.
 */
create function app.kennwort_token_anlegen(
  p_email text, p_zweck text, p_token_hash text
) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare
  v_benutzer uuid;
  v_stunden  int := case p_zweck
                      when 'einladung' then
                        coalesce((app.plattform_einstellung('auth.einladung_stunden'))::int, 168)
                      else
                        coalesce((app.plattform_einstellung('auth.zuruecksetzung_stunden'))::int, 2)
                    end;
begin
  select b.id into v_benutzer from public.benutzer b
   where lower(b.email) = lower(p_email) and b.deaktiviert_am is null and not b.ist_dienstkonto;
  if v_benutzer is null then return true; end if;

  -- Ältere offene Token desselben Zwecks verfallen. Zwei gültige Links auf
  -- dasselbe Konto sind ein Link zu viel.
  update kern.kennwort_token set eingeloest_am = now()
   where benutzer_id = v_benutzer and zweck = p_zweck and eingeloest_am is null;

  insert into kern.kennwort_token (benutzer_id, zweck, token_hash, gueltig_bis, erstellt_von)
  values (v_benutzer, p_zweck, p_token_hash,
          now() + make_interval(hours => v_stunden), app.aktueller_benutzer());
  return true;
end $$;

grant execute on function app.kennwort_token_anlegen(text, text, text) to cse_anon, cse_app;

/** Was steckt hinter diesem Token — ohne ihn einzulösen. */
create function app.kennwort_token_lesen(p_token_hash text)
returns table (benutzer_id uuid, name text, email text, zweck text)
language sql stable security definer set search_path = pg_catalog, public, app, kern as $$
  select t.benutzer_id, b.name, b.email, t.zweck
    from kern.kennwort_token t join public.benutzer b on b.id = t.benutzer_id
   where t.token_hash = p_token_hash and t.eingeloest_am is null and t.gueltig_bis > now()
$$;

grant execute on function app.kennwort_token_lesen(text) to cse_anon, cse_app;

/**
 * Einlösen und Kennwort setzen — in einer Anweisung, damit ein Token nicht
 * verbraucht werden kann, ohne dass ein Kennwort entsteht.
 *
 * Eine Einladung aktiviert das Konto zusätzlich: `status = 'eingeladen'` ist
 * genau der Zustand „eingeladen, aber noch nie angemeldet", und er endet hier.
 */
/**
 * Braucht dieses Konto einen zweiten Faktor, bevor es `aktiv` werden darf?
 *
 * Genau die Frage, die `kern.benutzer_2fa_pflicht` (0007) stellt — hier als
 * Ausdruck, damit der Einladungsweg sie VORHER stellen kann, statt in den
 * Trigger zu laufen und dem Eingeladenen eine Ausnahme zu zeigen.
 */
create function app.braucht_zweiten_faktor(p_benutzer uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select exists (
      select 1 from public.rolle r
       where (r.id = (select b.globale_rolle_id from public.benutzer b where b.id = p_benutzer)
              or r.id in (select bm.rolle_id from public.benutzer_mandant bm
                           where bm.benutzer_id = p_benutzer and bm.entzogen_am is null))
         and r.erfordert_2fa)
    and not app.hat_zweiten_faktor(p_benutzer)
$$;

grant execute on function app.braucht_zweiten_faktor(uuid) to cse_anon, cse_app;

/**
 * Einlösen und Kennwort setzen — in einer Anweisung, damit ein Token nicht
 * verbraucht werden kann, ohne dass ein Kennwort entsteht.
 *
 * **Der Token wird NICHT immer verbraucht.** `kern.benutzer_2fa_pflicht`
 * (0007) lässt ein Konto nicht `aktiv` werden, solange eine Rolle mit
 * `erfordert_2fa` zugewiesen ist und kein Faktor hinterlegt wurde — und genau
 * das trifft auf jede Administration zu. Ein Einladungsweg, der hier einfach
 * `status = 'aktiv'` schriebe, liefe in die Ausnahme des Triggers und zeigte
 * sie dem Eingeladenen; einer, der den Token trotzdem verbraucht, liesse ihn
 * mit einem Kennwort und ohne Zugang zurück.
 *
 * Also: Kennwort setzen, dann prüfen. Geht die Aktivierung, ist der Vorgang
 * hier zu Ende. Fehlt der zweite Faktor, bleibt der Token **offen** und
 * `braucht_faktor` sagt es — der Einladungsweg richtet ihn mit DEMSELBEN Token
 * ein (`app.token_faktor_*`) und schliesst beides zusammen ab.
 *
 * Bei einer Zurücksetzung stellt sich die Frage nicht: das Konto ist bereits
 * aktiv, und der Faktor wird bei der nächsten Anmeldung verlangt.
 */
create function app.kennwort_token_einloesen(p_token_hash text, p_kennwort text)
-- Die Ausgabespalten tragen ein `o_`: `benutzer_id` heisst auch die Spalte in
-- `kern.zugangsdaten`, und `on conflict (benutzer_id)` waere dann mehrdeutig —
-- Postgres weist das zur Laufzeit ab, nicht beim Anlegen der Funktion.
returns table (o_benutzer_id uuid, o_braucht_faktor boolean)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare
  v_t record;
  v_min int := coalesce((app.plattform_einstellung('auth.kennwort_mindestlaenge'))::int, 12);
  v_offen boolean := false;
begin
  if p_kennwort is null or length(p_kennwort) < v_min then return; end if;

  select t.id, t.benutzer_id, t.zweck into v_t
    from kern.kennwort_token t
   where t.token_hash = p_token_hash and t.eingeloest_am is null and t.gueltig_bis > now()
     for update;
  if v_t.id is null then return; end if;

  insert into kern.zugangsdaten (benutzer_id, anbieter, kennwort_hash, kennwort_gesetzt_am)
  values (v_t.benutzer_id, 'demo', crypt(p_kennwort, gen_salt('bf', 12)), now())
  on conflict (benutzer_id) do update
    set kennwort_hash = excluded.kennwort_hash,
        kennwort_gesetzt_am = excluded.kennwort_gesetzt_am,
        anbieter = 'demo', muss_wechseln = false, geaendert_am = now();

  if v_t.zweck = 'einladung' then
    v_offen := app.braucht_zweiten_faktor(v_t.benutzer_id);
    if not v_offen then
      update public.benutzer set status = 'aktiv'
       where id = v_t.benutzer_id and status = 'eingeladen';
    end if;
  end if;

  if not v_offen then
    update kern.kennwort_token set eingeloest_am = now() where id = v_t.id;
  end if;

  -- Ein neues Kennwort beendet jede andere offene Sitzung. Wer es
  -- zurücksetzt, weil ein fremder Zugriff im Raum steht, hätte sonst genau
  -- nichts erreicht.
  update public.benutzer_sitzung s
     set beendet_am = now(), ende_grund = 'abmeldung'
   where s.benutzer_id = v_t.benutzer_id and s.beendet_am is null;

  perform app.protokolliere('auth.kennwort_gesetzt', 'benutzer', v_t.benutzer_id::text,
                            null, jsonb_build_object('zweck', v_t.zweck), null);
  return query select v_t.benutzer_id, v_offen;
end $$;

grant execute on function app.kennwort_token_einloesen(text, text) to cse_anon, cse_app;

-- ---------------------------------------------------------------------------
-- Der zweite Faktor, ausgewiesen durch einen Einladungstoken statt durch eine
-- Sitzung.
-- ---------------------------------------------------------------------------

/**
 * **Warum es diese drei Funktionen zusätzlich gibt.**
 *
 * Das Einrichten in `app.faktor_*` hängt an `app.aktueller_benutzer()` — es
 * setzt eine Sitzung voraus. Ein eingeladenes Konto hat keine: es ist noch
 * nicht `aktiv`, und `app.sitzung_aufloesen` gibt für ein nicht aktives Konto
 * null Zeilen. Genau in dieser Lücke steckte der Einladungsweg fest.
 *
 * Der Ausweis ist deshalb der Token, nicht die Sitzung — dieselbe Begründung
 * wie bei `app.sitzung_beenden`: wer ihn hat, IST der Eingeladene. Der Token
 * bleibt bis zum Abschluss offen und wird von `app.token_faktor_bestaetigen`
 * zusammen mit der Aktivierung verbraucht.
 */
create function app.token_faktor_anlegen(p_token_hash text, p_geheimnis text) returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare v_benutzer uuid; v_id uuid;
begin
  select t.benutzer_id into v_benutzer from kern.kennwort_token t
   where t.token_hash = p_token_hash and t.eingeloest_am is null and t.gueltig_bis > now();
  if v_benutzer is null then return null; end if;
  if exists (select 1 from kern.zweiter_faktor z
              where z.benutzer_id = v_benutzer and z.bestaetigt_am is not null) then
    return null;
  end if;
  delete from kern.zweiter_faktor z
   where z.benutzer_id = v_benutzer and z.bestaetigt_am is null;
  insert into kern.zweiter_faktor (benutzer_id, geheimnis)
  values (v_benutzer, p_geheimnis) returning id into v_id;
  return v_id;
end $$;

grant execute on function app.token_faktor_anlegen(text, text) to cse_anon, cse_app;

create function app.token_faktor_geheimnis(p_token_hash text)
returns table (id uuid, geheimnis text, letzter_schritt bigint)
language sql stable security definer
set search_path = pg_catalog, public, app, kern as $$
  select z.id, z.geheimnis, z.letzter_schritt
    from kern.kennwort_token t
    join kern.zweiter_faktor z on z.benutzer_id = t.benutzer_id
   where t.token_hash = p_token_hash and t.eingeloest_am is null and t.gueltig_bis > now()
     and z.bestaetigt_am is null
   order by z.erstellt_am desc
   limit 1
$$;

grant execute on function app.token_faktor_geheimnis(text) to cse_anon, cse_app;

/** Bestätigen, aktivieren und den Token verbrauchen — zusammen oder gar nicht. */
create function app.token_faktor_bestaetigen(
  p_token_hash text, p_id uuid, p_schritt bigint
) returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare v_t record; v_treffer int;
begin
  select t.id, t.benutzer_id into v_t from kern.kennwort_token t
   where t.token_hash = p_token_hash and t.eingeloest_am is null and t.gueltig_bis > now()
     for update;
  if v_t.id is null then return null; end if;

  update kern.zweiter_faktor z
     set letzter_schritt = p_schritt, bestaetigt_am = coalesce(z.bestaetigt_am, now())
   where z.id = p_id and z.benutzer_id = v_t.benutzer_id
     and (z.letzter_schritt is null or z.letzter_schritt < p_schritt);
  get diagnostics v_treffer = row_count;
  if v_treffer <> 1 then return null; end if;

  update public.benutzer set status = 'aktiv'
   where id = v_t.benutzer_id and status = 'eingeladen';
  update kern.kennwort_token set eingeloest_am = now() where id = v_t.id;

  perform app.protokolliere('auth.zweiter_faktor_eingerichtet', 'benutzer',
                            v_t.benutzer_id::text, null, null, null);
  return v_t.benutzer_id;
end $$;

grant execute on function app.token_faktor_bestaetigen(text, uuid, bigint) to cse_anon, cse_app;

/** Das eigene Kennwort ändern — mit dem alten als Beweis. */
create function app.kennwort_aendern(p_alt text, p_neu text) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare
  v_benutzer uuid := app.aktueller_benutzer();
  v_hash text;
  v_min int := coalesce((app.plattform_einstellung('auth.kennwort_mindestlaenge'))::int, 12);
begin
  if v_benutzer is null or p_neu is null or length(p_neu) < v_min then return false; end if;
  select z.kennwort_hash into v_hash from kern.zugangsdaten z where z.benutzer_id = v_benutzer;
  if v_hash is null or crypt(p_alt, v_hash) <> v_hash then return false; end if;
  update kern.zugangsdaten
     set kennwort_hash = crypt(p_neu, gen_salt('bf', 12)),
         kennwort_gesetzt_am = now(), muss_wechseln = false, geaendert_am = now()
   where benutzer_id = v_benutzer;
  perform app.protokolliere('auth.kennwort_geaendert', 'benutzer', v_benutzer::text, null, null, null);
  return true;
end $$;

grant execute on function app.kennwort_aendern(text, text) to cse_app;

/**
 * Ein Kennwort für die Demodaten setzen — **nur ohne bestehendes**.
 *
 * `pnpm db:seed` braucht einen Weg, den Konten der Demodaten ein Kennwort zu
 * geben. Er darf keines überschreiben: sonst wäre ein zweiter Seed-Lauf auf
 * einer benutzten Fläche eine stille Übernahme aller Konten.
 */
create function app.demo_kennwort_setzen(p_benutzer uuid, p_kennwort text) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
begin
  insert into kern.zugangsdaten (benutzer_id, anbieter, kennwort_hash, kennwort_gesetzt_am)
  values (p_benutzer, 'demo', crypt(p_kennwort, gen_salt('bf', 12)), now())
  on conflict (benutzer_id) do nothing;
  return found;
end $$;

grant execute on function app.demo_kennwort_setzen(uuid, text) to cse_job;

comment on function app.demo_kennwort_setzen(uuid, text) is
  'Seed-Weg für Demodaten. Überschreibt nie ein bestehendes Kennwort.';

-- ---------------------------------------------------------------------------
-- K-01 und K-08: Eigentum und wer ausführen darf.
-- ---------------------------------------------------------------------------

/**
 * **`cse_definer` statt des Migrationsrollen-Eigentums (K-01).** Eine
 * `security definer`-Funktion, die dem Superuser gehört, läuft als Superuser —
 * also an jeder RLS vorbei. `cse_definer` hat genau die Rechte, die diese
 * Funktionen brauchen, und keines mehr. `tests/isolation/definer-eigentum.ts`
 * lässt die Altlast nicht wachsen.
 *
 * **`revoke … from public` (K-08).** Postgres gibt jeder neuen Funktion
 * `EXECUTE` an PUBLIC, und ein späteres `grant … to cse_app` ersetzt das
 * nicht, sondern tritt daneben. Ohne diesen Block hinge das Zurückhalten
 * allein an den Funktionskörpern — und `app.kennwort_anmelden` und
 * `app.kennwort_token_*` geben ausdrücklich auch OHNE Sitzung etwas heraus,
 * weil der Anmeldende noch niemand ist. Genau dafür ist K-08 da.
 */
do $$
declare v_sig text;
begin
  for v_sig in
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.prosecdef
       and p.proname in (
         'hat_zweiten_faktor', 'kennwort_anmelden', 'faktor_anlegen', 'faktor_geheimnis',
         'faktor_schritt_verbrauchen', 'sitzung_faktor_bestaetigt',
         'wiederherstellungscodes_setzen', 'wiederherstellungscode_einloesen',
         'wiederherstellungscodes_offen', 'kennwort_token_anlegen', 'kennwort_token_lesen',
         'kennwort_token_einloesen', 'kennwort_aendern', 'demo_kennwort_setzen',
         'braucht_zweiten_faktor', 'token_faktor_anlegen', 'token_faktor_geheimnis',
         'token_faktor_bestaetigen')
  loop
    execute format('alter function app.%s owner to cse_definer', v_sig);
    execute format('revoke execute on function app.%s from public', v_sig);
  end loop;
end $$;

/**
 * `app.hat_zweiten_faktor` wurde oben mit `create or replace` neu geschrieben
 * und behält dabei ihr altes Eigentum — der Block darüber fasst sie deshalb
 * mit an, obwohl sie nicht neu ist. Ohne das liefe die neu hinzugekommene
 * Abfrage auf `kern.zweiter_faktor` unter dem alten Eigentümer, und `cse_app`
 * hat auf dieser Tabelle kein `select`.
 */
grant select, insert, update, delete on kern.zugangsdaten to cse_definer;
grant select, insert, update, delete on kern.zweiter_faktor to cse_definer;
grant select, insert, update, delete on kern.wiederherstellungscode to cse_definer;
grant select, insert, update, delete on kern.kennwort_token to cse_definer;

/**
 * Und die Tabellen, die diese Funktionen anfassen.
 *
 * **`auth.mfa_factors` war der Fall, der es zeigte.** `app.hat_zweiten_faktor`
 * gehörte vorher der Migrationsrolle und las sie deshalb ohne eigenes Recht;
 * mit dem Wechsel auf `cse_definer` (K-01) fehlte es. Aufgefallen ist das nicht
 * beim Anlegen der Funktion, sondern beim Seed — über den Trigger
 * `kern.benutzer_2fa_pflicht`, der sie aufruft. Ein Eigentumswechsel ohne die
 * passenden Rechte ist eine Funktion, die erst beim ersten Aufruf abbricht.
 */
grant select on auth.mfa_factors to cse_definer;
grant select on public.rolle, public.benutzer_mandant to cse_definer;
grant select, update on public.benutzer to cse_definer;
grant select, insert, update on public.benutzer_sitzung to cse_definer;

/**
 * Und die `app`-Funktionen, die sie ihrerseits aufrufen.
 *
 * Solange eine Definer-Funktion der Migrationsrolle gehörte, rief sie jede
 * andere ohne eigenes Recht. Als Eigentum von `cse_definer` braucht sie
 * `execute` — und `app.versuch_protokollieren` trägt es nur für `cse_anon`
 * und `cse_app`. Ohne diesen Block bricht `app.kennwort_anmelden` beim ersten
 * Anmeldeversuch ab, nicht beim Anlegen.
 */
grant execute on function app.versuch_protokollieren(text, inet, boolean, text, text)
  to cse_definer;
grant execute on function app.plattform_einstellung(text) to cse_definer;
grant execute on function app.protokolliere(text, text, text, jsonb, jsonb, uuid) to cse_definer;
grant execute on function app.hat_zweiten_faktor(uuid) to cse_definer;
grant execute on function app.braucht_zweiten_faktor(uuid) to cse_definer;
grant execute on function app.aktueller_benutzer() to cse_definer;

/**
 * Und die Policy, ohne die das Ganze still nichts tut.
 *
 * `benutzer` trägt RLS mit `force`, und `cse_definer` ist weder Eigentümer
 * noch `bypassrls`. `0116` gab der Rolle deshalb ein `d_benutzer_anmeldung`
 * für SELECT — aber kein UPDATE: die Mitarbeiteranmeldung schreibt nichts an
 * `benutzer`.
 *
 * Die Kennwortanmeldung tut es an zwei Stellen: `letzter_login_am` (AUT-08)
 * und die Aktivierung eines eingeladenen Kontos (AUT-04). Ohne Policy traf
 * das UPDATE **null Zeilen und meldete keinen Fehler** — die Einladung lief
 * durch, das Konto blieb `eingeladen`, und der Eingeladene stand vor einer
 * Anmeldung, die ihn für gesperrt hielt. Genau dieser Fall stand in
 * `tests/isolation/anmeldung-kennwort.test.ts`, bevor die Policy da war.
 *
 * **`using (true)` ist hier die richtige Verengung** — dieselbe Begründung wie
 * in `0116`: eine Anmeldung muss ein Konto anfassen können, das sie noch nicht
 * kennt, und `cse_definer` ist `NOLOGIN` und nur über genau diese Funktionen
 * zu betreten. `with check` verengt dagegen scharf: eine Aktivierung darf ein
 * Konto nicht zugleich zum Dienstkonto machen oder seine Deaktivierung
 * aufheben.
 */
create policy d_benutzer_anmeldung_pflege on benutzer
  for update to cse_definer
  using (true)
  with check (not ist_dienstkonto and deaktiviert_am is null);
