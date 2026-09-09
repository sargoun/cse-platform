-- 0007 — Anmeldung, Sitzung, 2FA-Gate und Rate-Limiting (AUT-01/02/04/07/08).
--
-- Nummerierung: der Plan sah `0007_hash_kette` vor. Die Kette brauchte keine
-- eigene Migration — ihre Spalten (`letzter_hash`, `genesis_hash`,
-- `vorgaenger_nummernkreis_id`) sitzen auf `nummernkreis`, und eine Tabelle
-- verketteter SÄTZE gibt es erst mit dem Rechnungsmodell (PR 46). Eine leere
-- Migration anzulegen, nur damit die Nummer stimmt, wäre eine Datei, die
-- vorgibt etwas zu tun.

-- ---------------------------------------------------------------------------
-- Supabase-Schema-Shim.
--
-- `benutzer.id` IST `auth.users.id` (§6.4): die Policies vergleichen direkt
-- gegen den angemeldeten Benutzer, und ein eigener Schlüssel erzwänge in jeder
-- Policy einen Join. In Supabase existiert `auth.users` bereits — dort sind
-- die folgenden Anweisungen alle No-Ops. Lokal und im Test existiert es nicht,
-- und ohne dieses Minimum liesse sich der Fremdschlüssel nicht anlegen.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- Supabase liefert diese Funktion; lokal steht sie auf demselben GUC, den die
-- Sitzungsauflösung setzt, damit Policies in beiden Umgebungen dasselbe lesen.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.benutzer_id', true), '')::uuid
$$;

grant usage on schema auth to cse_app, cse_anon, cse_definer, cse_job;

-- ---------------------------------------------------------------------------
-- Vokabulare.
-- ---------------------------------------------------------------------------
create type benutzer_status       as enum ('eingeladen','aktiv','gesperrt','deaktiviert');
create type rolle_geltungsbereich as enum ('global','mandant');
-- Genau die vier K-18-Scopes. KEIN fünfter Wert `keine`: ein fünfter `ansicht`
-- wäre ein fünfter `app.scope`, und K-18 lässt vier.
create type sitzung_ansicht       as enum ('mandant','gruppe','person','kunde');
create type sitzung_aal           as enum ('aal1','aal2');
create type sitzung_ende_grund    as enum ('abmeldung','ablauf','inaktivitaet','gesperrt','wechsel');
create type sprache               as enum ('de','en','ar','tr');

-- ---------------------------------------------------------------------------
-- plattform_einstellung — die Stellgrössen, die VOR jedem Mandanten gelten.
-- ---------------------------------------------------------------------------

/**
 * `03-AUTH-BERECHTIGUNGEN.md` §10 legt jede Schwelle, jedes Fenster und jede
 * Sperrdauer in `einstellung` ab, gelesen über `app.einstellung(schluessel)`.
 * Deren Eigentümertabelle `mandant_einstellung` (`01-KERN.md` §6.30) trägt
 * aber `mandant_id NOT NULL` und sagt ausdrücklich: **es gibt keine
 * plattformweite Zeile**, damit ein Default nie unbemerkt für alle vier
 * Gesellschaften gilt.
 *
 * Ein Anmeldeversuch findet vor jeder Mandantenauflösung statt — es gibt in
 * diesem Moment keinen Mandanten, dessen Einstellung gelesen werden könnte.
 * Beide Sätze zusammen erzwingen eine zweite, plattformweite Tabelle; sie ist
 * nicht erfunden, sondern das, was übrig bleibt, wenn beide Vorgaben gelten.
 * Ihr Namensraum ist bewusst getrennt, damit niemand eine Betriebseinstellung
 * hierher legt und sie versehentlich für die ganze Gruppe setzt.
 */
create table plattform_einstellung (
  id            uuid primary key default gen_random_uuid(),
  schluessel    text not null unique
                  check (schluessel ~ '^[a-z_]+(\.[a-z_]+){1,2}$'),
  wert          jsonb not null,
  beschreibung  text,
  -- Ob der Wert vom Mandanten bestätigt ist oder ein Platzhalter (K-17).
  ist_vorlaeufig boolean not null default true,
  grundlage     text,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid,
  geaendert_von uuid
);

create function app.plattform_einstellung(p_schluessel text) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select e.wert from public.plattform_einstellung e where e.schluessel = p_schluessel
$$;

grant execute on function app.plattform_einstellung(text) to cse_app, cse_anon;

-- Alle vier sind PLATZHALTER (K-17). Die SPEC nennt keine Zahl, und eine hier
-- gewählte Zahl läse sich später wie eine entschiedene.
-- TODO(client): O-80 — AUT-07-Schwellen: Versuche je Kennung und je IP, das
-- Zeitfenster, die Sperrdauer, ob sie automatisch abläuft oder eine
-- Entsperrung durch eine Verwaltung verlangt, und ob eine Sperre per E-Mail
-- mitgeteilt wird.
insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig) values
  ('auth.max_versuche_kennung', '10'::jsonb,
   'Fehlversuche je Kennung im Fenster, bevor gesperrt wird (VORLÄUFIG, O-80).', true),
  ('auth.max_versuche_ip', '50'::jsonb,
   'Fehlversuche je IP im Fenster (VORLÄUFIG, O-80).', true),
  ('auth.fenster_minuten', '15'::jsonb,
   'Beobachtungsfenster in Minuten (VORLÄUFIG, O-80).', true),
  ('auth.sperrdauer_minuten', '30'::jsonb,
   'Dauer der Kontosperre in Minuten (VORLÄUFIG, O-80).', true),
  ('retention.anmeldeversuch_tage', '30'::jsonb,
   'Aufbewahrung der Rate-Limiting-Telemetrie (VORLÄUFIG, O-92).', true);

-- ---------------------------------------------------------------------------
-- rolle — die fünf Standardrollen (AUT-01).
-- ---------------------------------------------------------------------------
create table rolle (
  id              uuid primary key default gen_random_uuid(),
  -- NULL = Plattformrolle; gesetzt = eigener Zuschnitt eines Mandanten (AUT-03).
  mandant_id      uuid references mandant(id),
  schluessel      text not null check (schluessel ~ '^[a-z][a-z0-9_]{2,39}$'),
  bezeichnung     text not null,
  beschreibung    text,
  geltungsbereich rolle_geltungsbereich not null default 'mandant',
  -- DIE Quelle von app.portal() (K-04).
  portal          text not null check (portal in ('intern','mitarbeiter','kunde')),
  erfordert_2fa   boolean not null default false,
  -- Die fünf Seed-Rollen: nicht löschbar, schluessel/portal unveränderlich;
  -- ihre RECHTE bleiben editierbar (AUT-03).
  ist_system      boolean not null default false,
  archiviert_am   timestamptz,
  erstellt_am     timestamptz not null default now(),
  geaendert_am    timestamptz,
  erstellt_von    uuid,
  geaendert_von   uuid
);

create unique index rolle_schluessel_key on rolle (mandant_id, schluessel) nulls not distinct
  where archiviert_am is null;

-- `rang` wird NICHT ausgeliefert (§6.5, INVENTED RULE): eine Rangordnung, die
-- niemand entschieden hat, würde als Eskalationsregel gelesen.

insert into rolle (schluessel, bezeichnung, beschreibung, geltungsbereich, portal, erfordert_2fa, ist_system) values
  ('super_admin', 'Super-Administration', 'Gruppenweit, alle Bereiche.',        'global',  'intern',      true,  true),
  ('admin',       'Administration',       'Verwaltung eines Bereichs.',         'mandant', 'intern',      true,  true),
  ('leitung',     'Leitung',              'Operative Leitung eines Bereichs.',  'mandant', 'intern',      false, true),
  ('mitarbeiter', 'Mitarbeitende',        'Eigene Arbeit, eigenes Portal.',     'mandant', 'mitarbeiter', false, true),
  ('kunde',       'Kundenzugang',         'Eigene Vorgänge im Kundenportal.',   'mandant', 'kunde',       false, true);

-- ---------------------------------------------------------------------------
-- benutzer — das Anmeldekonto. id IST auth.users.id.
-- ---------------------------------------------------------------------------
create table benutzer (
  -- KEIN gen_random_uuid(): der Schlüssel ist der Fremdschlüssel. Ein eigener
  -- erzwänge in jeder Policy einen Join gegen auth.uid().
  id                          uuid primary key references auth.users(id) on delete restrict,
  person_id                   uuid references person(id),
  email                       text,
  name                        text not null,
  -- Nur für Konten OHNE person_id: sonst gewinnt person.sprache (§3.2).
  sprache                     sprache not null default 'de',
  globale_rolle_id            uuid references rolle(id),
  -- Dienstkonto (Service Principal), nie ein Mensch. Ohne diese Spalte ist die
  -- Verweigerung interaktiver Anmeldung gar nicht formulierbar.
  ist_dienstkonto             boolean not null default false,
  status                      benutzer_status not null default 'eingeladen',
  gesperrt_bis                timestamptz,
  letzter_login_am            timestamptz,
  letzte_ip                   inet,
  benachrichtigung_praeferenz jsonb not null default '{}',
  deaktiviert_am              timestamptz,
  erstellt_am                 timestamptz not null default now(),
  geaendert_am                timestamptz,
  erstellt_von                uuid,
  geaendert_von               uuid,

  -- Ein Telefon-Login hat keine E-Mail, aber dann einen Menschen dahinter.
  constraint benutzer_kennung check (email is not null or person_id is not null),
  constraint benutzer_status_stimmig check ((status = 'deaktiviert') = (deaktiviert_am is not null)),
  constraint benutzer_dienstkonto_ohne_mensch check (not ist_dienstkonto or person_id is null)
);

create unique index benutzer_email_key on benutzer (lower(email))
  where email is not null and deaktiviert_am is null;

-- EIN Login je Mensch (EMP-14, D-09). Der Entwurf hatte hier nur einen
-- nicht-eindeutigen Index: zwei Konten konnten auf denselben Menschen zeigen,
-- und welche kombinierte Portalansicht er sah, hing davon ab, womit er sich
-- angemeldet hat.
create unique index benutzer_person_key on benutzer (person_id)
  where person_id is not null and deaktiviert_am is null;

create index benutzer_status_idx on benutzer (status) where deaktiviert_am is null;

-- ---------------------------------------------------------------------------
-- benutzer_mandant — Zugang, Rolle und Modulbeschränkung je Bereich.
-- ---------------------------------------------------------------------------
create table benutzer_mandant (
  id             uuid primary key default gen_random_uuid(),
  benutzer_id    uuid not null references benutzer(id),
  mandant_id     uuid not null references mandant(id),
  rolle_id       uuid not null references rolle(id),
  -- NULL = alle Module der Rolle. Nicht-NULL = Schnittmenge (AUT-01).
  module         text[],
  -- K-14: true = vom anstellung-Trigger erzeugt und nur von ihm entfernbar.
  aus_anstellung boolean not null default false,
  ist_standard   boolean not null default false,
  gueltig_ab     date not null default current_date,
  gueltig_bis    date,
  -- EINZIGE Liveness-Spalte.
  entzogen_am    timestamptz,
  entzogen_von   uuid references benutzer(id),
  entzugsgrund   text,
  erstellt_am    timestamptz not null default now(),
  geaendert_am   timestamptz,
  erstellt_von   uuid,
  geaendert_von  uuid,

  constraint bm_gueltig check (gueltig_bis is null or gueltig_bis >= gueltig_ab)
);

create unique index benutzer_mandant_key on benutzer_mandant (benutzer_id, mandant_id)
  where entzogen_am is null;
create index benutzer_mandant_benutzer_idx on benutzer_mandant (benutzer_id)
  where entzogen_am is null;
create index benutzer_mandant_mandant_idx on benutzer_mandant (mandant_id, rolle_id)
  where entzogen_am is null;
create unique index benutzer_mandant_standard_uk on benutzer_mandant (benutzer_id)
  where ist_standard and entzogen_am is null;

-- ---------------------------------------------------------------------------
-- benutzer_sitzung — die EINZIGE Quelle des aktiven Mandanten (TEN-04).
-- ---------------------------------------------------------------------------
create table benutzer_sitzung (
  id                    uuid primary key default gen_random_uuid(),
  benutzer_id           uuid not null references benutzer(id),
  -- encode(sha256(cookie), 'hex'). Der Rohwert wird nie gespeichert.
  token_hash            text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  aktiver_mandant_id    uuid references mandant(id),
  ansicht               sitzung_ansicht not null default 'mandant',
  aal                   sitzung_aal not null default 'aal1',
  ip                    inet,
  user_agent            text,
  geraet                text,
  letzte_aktivitaet_am  timestamptz not null default now(),
  ablauf_am             timestamptz not null,
  mandant_gewechselt_am timestamptz,
  beendet_am            timestamptz,
  ende_grund            sitzung_ende_grund,
  erstellt_am           timestamptz not null default now(),

  -- JEDE mandantenübergreifende Ansicht hat per Konstruktion keinen aktiven
  -- Mandanten — nicht nur die Gruppenansicht (K-02, K-18, Invariante 10).
  constraint sitzung_ansicht_stimmig
    check ((ansicht = 'mandant') = (aktiver_mandant_id is not null)),
  constraint sitzung_ende_stimmig check ((beendet_am is null) = (ende_grund is null))
);

create index benutzer_sitzung_benutzer_idx
  on benutzer_sitzung (benutzer_id, letzte_aktivitaet_am desc) where beendet_am is null;
create index benutzer_sitzung_ablauf_idx on benutzer_sitzung (ablauf_am) where beendet_am is null;

-- ---------------------------------------------------------------------------
-- kern.anmeldeversuch — Rate-Limiting VOR jeder Mandantenauflösung.
-- ---------------------------------------------------------------------------

/**
 * Warum eine eigene Tabelle und nicht `audit_log`: die Sperrabfrage lautet
 * "Fehlversuche von dieser IP und für diese Kennung in den letzten N Minuten".
 * Ein Zähler je Benutzer kann Versuche gegen **nicht existierende** Konten
 * nicht bremsen — und genau das ist der Enumerationsfall, für den AUT-07 da
 * ist. Ausserdem ist `audit_log` hash-verkettet und append-only: eine Zeile je
 * Fehlversuch serialisierte jede Anmeldung hinter dem Kettenkopf. Eine
 * zusammenfassende `audit_log`-Zeile je Sperrung genügt AUT-08.
 *
 * Kein `mandant_id`: der Versuch findet statt, bevor irgendein Mandant bekannt
 * ist. Keine `cse_app`-Policy: gelesen und geschrieben ausschliesslich von
 * `app.versuch_protokollieren` (K-08).
 */
create table kern.anmeldeversuch (
  id           uuid primary key default gen_random_uuid(),
  -- SHA-256 der eingegebenen E-Mail bzw. Telefonnummer — nie im Klartext.
  kennung_hash text not null,
  ip           inet,
  art          text not null,
  erfolg       boolean not null,
  grund        text,
  erstellt_am  timestamptz not null default now()
);

create index anmeldeversuch_kennung_idx on kern.anmeldeversuch (kennung_hash, erstellt_am desc)
  where not erfolg;
create index anmeldeversuch_ip_idx on kern.anmeldeversuch (ip, erstellt_am desc) where not erfolg;
create index anmeldeversuch_purge_idx on kern.anmeldeversuch (erstellt_am);

-- ---------------------------------------------------------------------------
-- Die Sitzungs- und Rechte-Akzessoren.
-- ---------------------------------------------------------------------------

create function app.aal() returns text
language sql stable as $$ select coalesce(app.guc('app.aal'), 'aal1') $$;

/**
 * Hat dieses Konto einen zweiten Faktor hinterlegt?
 *
 * Live gelesen aus `auth.mfa_factors` — NICHT als Spiegelspalte auf
 * `benutzer` (review B18). Eine gespiegelte Spalte ohne Abgleichspfad ist
 * genau dann falsch, wenn es darauf ankommt: der Faktor wurde entfernt, die
 * Spalte sagt weiterhin ja, und AUT-02 ist ausgehebelt.
 *
 * Lokal existiert die Supabase-Tabelle nicht; dann zählt der Enrolment-Stand,
 * den der Test setzt. In Supabase gewinnt die echte Tabelle.
 */
create table if not exists auth.mfa_factors (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  status     text not null default 'verified'
);

create function app.hat_zweiten_faktor(p_benutzer uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app, auth as $$
  select exists (
    select 1 from auth.mfa_factors f
     where f.user_id = p_benutzer and f.status = 'verified')
$$;

grant execute on function app.hat_zweiten_faktor(uuid) to cse_app;

/**
 * Super-Admin — global, und nur mit zweitem Faktor IN DIESER SITZUNG.
 *
 * Das Enrolment allein genügt nicht: ein Konto, das einen Faktor besitzt, ihn
 * aber in dieser Sitzung nicht vorgezeigt hat, ist `aal1`, und `aal1` ist
 * nicht Super-Admin. Sonst wäre der zweite Faktor eine Eigenschaft des Kontos
 * statt eine der Anmeldung.
 */
create function app.ist_super_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select app.aal() = 'aal2'
     and exists (
       select 1 from public.benutzer b join public.rolle r on r.id = b.globale_rolle_id
        where b.id = app.aktueller_benutzer()
          and b.deaktiviert_am is null and b.status = 'aktiv'
          and r.schluessel = 'super_admin' and r.geltungsbereich = 'global')
$$;

grant execute on function app.ist_super_admin() to cse_app;

/**
 * Die Bereiche, die der Switcher anbietet.
 *
 * Getrennt von `sichtbare_mandanten()` und das ist Absicht (B14): ein
 * archivierter Mandant bleibt LESBAR — seine Rechnungen stehen zehn Jahre —
 * wird aber nicht mehr als Arbeitskontext angeboten. Ein Super-Admin sieht
 * jeden nicht archivierten Bereich ohne Zuweisungszeile, damit ein fünfter
 * Mandant sofort erscheint (TEN-08).
 */
create function app.switcher_mandanten() returns uuid[]
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select coalesce(array_agg(distinct m.id), '{}')
    from public.mandant m
   where m.archiviert_am is null
     and (app.ist_super_admin()
          or exists (select 1 from public.benutzer_mandant bm
                      where bm.benutzer_id = app.aktueller_benutzer()
                        and bm.mandant_id = m.id
                        and bm.entzogen_am is null
                        and bm.gueltig_ab <= current_date
                        and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)))
$$;

grant execute on function app.switcher_mandanten() to cse_app;

-- ---------------------------------------------------------------------------
-- app.versuch_protokollieren — Rate-Limiting und Sperre (AUT-07, K-08).
-- ---------------------------------------------------------------------------

/**
 * Schreibt den Versuch und entscheidet, ob gesperrt wird. Gibt zurück, ob der
 * Aufrufer **jetzt** weitermachen darf.
 *
 * Der Rückgabewert ist bewusst dasselbe `false` für "gesperrt" und "zu viele
 * Versuche" und für ein unbekanntes Konto: eine Antwort, die zwischen ihnen
 * unterscheidet, ist ein Enumerationsorakel.
 */
create function app.versuch_protokollieren(
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
begin
  insert into kern.anmeldeversuch (kennung_hash, ip, art, erfolg, grund)
  values (v_hash, p_ip, p_art, p_erfolg, p_grund);

  if p_erfolg then
    return true;
  end if;

  select count(*) into v_kenn from kern.anmeldeversuch a
   where a.kennung_hash = v_hash and not a.erfolg and a.erstellt_am >= v_seit;
  select count(*) into v_ip from kern.anmeldeversuch a
   where a.ip is not distinct from p_ip and not a.erfolg and a.erstellt_am >= v_seit;

  if v_kenn >= v_max_kenn then
    -- Existiert das Konto, wird es gesperrt. Existiert es nicht, zählt der
    -- Versuch trotzdem — das ist der ganze Zweck einer Tabelle statt eines
    -- Zählers je Benutzer.
    select b.id into v_benutzer from public.benutzer b
     where lower(b.email) = lower(p_kennung) and b.deaktiviert_am is null;
    if v_benutzer is not null then
      update public.benutzer
         set gesperrt_bis = now() + make_interval(mins => v_sperre), status = 'gesperrt'
       where id = v_benutzer;
      -- EINE zusammenfassende audit_log-Zeile je Sperrung genügt AUT-08.
      perform app.protokolliere('auth.konto_gesperrt', 'benutzer', v_benutzer::text,
                                null, jsonb_build_object('versuche', v_kenn), null);
    end if;
    return false;
  end if;

  return v_kenn < v_max_kenn and v_ip < v_max_ip;
end $$;

grant execute on function app.versuch_protokollieren(text, inet, boolean, text, text)
  to cse_anon, cse_app;

-- ---------------------------------------------------------------------------
-- app.sitzung_aufloesen — der Hot Path jeder Anfrage (K-08).
-- ---------------------------------------------------------------------------

/**
 * Löst das Sitzungscookie auf und stempelt die Aktivität in DERSELBEN
 * Anweisung, die die Sitzung validiert — sonst gäbe es ein Fenster, in dem
 * eine abgelaufene Sitzung noch als frisch gelesen wird.
 *
 * Verweigert:
 *  - unbekannten oder beendeten Token
 *  - abgelaufene und zu lange untätige Sitzungen
 *  - deaktivierte, gesperrte und noch nicht aktivierte Konten
 *  - **Dienstkonten** — ein Service Principal meldet sich nie interaktiv an
 *
 * In allen Fällen: null Zeilen. Kein Grund, keine Unterscheidung.
 */
create function app.sitzung_aufloesen(p_token_hash text)
returns table (
  benutzer_id uuid, person_id uuid, aktiver_mandant_id uuid,
  ansicht text, aal text, portal text, sitzung_id uuid
)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_leerlauf int := coalesce((app.plattform_einstellung('auth.leerlauf_minuten'))::int, 480);
begin
  return query
  update public.benutzer_sitzung s
     set letzte_aktivitaet_am = now()
    from public.benutzer b
   where s.token_hash = p_token_hash
     and s.benutzer_id = b.id
     and s.beendet_am is null
     and s.ablauf_am > now()
     and s.letzte_aktivitaet_am > now() - make_interval(mins => v_leerlauf)
     and b.deaktiviert_am is null
     and b.status = 'aktiv'
     and (b.gesperrt_bis is null or b.gesperrt_bis <= now())
     and not b.ist_dienstkonto
  returning b.id, b.person_id, s.aktiver_mandant_id,
            s.ansicht::text, s.aal::text,
            -- Das Portal kommt aus der ROLLE der aktiven Mitgliedschaft
            -- (K-04), nicht aus dem Cookie. In den drei mandantenüber-
            -- greifenden Ansichten ist es eine Konstante des Scopes.
            case
              when s.ansicht = 'mandant' then coalesce((
                select r.portal from public.benutzer_mandant bm
                  join public.rolle r on r.id = bm.rolle_id
                 where bm.benutzer_id = b.id and bm.mandant_id = s.aktiver_mandant_id
                   and bm.entzogen_am is null limit 1), 'mitarbeiter')
              when s.ansicht = 'gruppe' then 'intern'
              when s.ansicht = 'person' then 'mitarbeiter'
              else 'kunde'
            end,
            s.id;
end $$;

grant execute on function app.sitzung_aufloesen(text) to cse_anon, cse_app;

insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig) values
  ('auth.leerlauf_minuten', '480'::jsonb,
   'Sitzung endet nach dieser Untätigkeit (VORLÄUFIG, O-80).', true);

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------

/**
 * Ein manipuliertes Cookie kann keinen fremden Bereich aktivieren.
 *
 * Geprüft gegen `switcher_mandanten()`, nicht gegen `sichtbare_mandanten()`
 * (B14): ein archivierter Mandant bleibt lesbar, wird aber nicht als
 * Arbeitskontext angeboten — und darf folglich auch nicht per Cookie zum
 * Arbeitskontext gemacht werden.
 */
create function kern.sitzung_mandant_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_erlaubt uuid[];
begin
  if new.aktiver_mandant_id is null then return new; end if;

  select coalesce(array_agg(distinct m.id), '{}') into v_erlaubt
    from public.mandant m
   where m.archiviert_am is null
     and (exists (select 1 from public.benutzer b join public.rolle r on r.id = b.globale_rolle_id
                   where b.id = new.benutzer_id and r.schluessel = 'super_admin')
          or exists (select 1 from public.benutzer_mandant bm
                      where bm.benutzer_id = new.benutzer_id and bm.mandant_id = m.id
                        and bm.entzogen_am is null));

  if not (new.aktiver_mandant_id = any (v_erlaubt)) then
    raise exception 'Sitzung: der Benutzer hat keinen Zugang zu diesem Bereich (TEN-04)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_sitzung_mandant_pruefen
  before insert or update of aktiver_mandant_id, ansicht on benutzer_sitzung
  for each row execute function kern.sitzung_mandant_pruefen();

/** Jeder Wechsel des Bereichs oder der Ansicht landet im audit_log (TEN-09). */
create function kern.sitzung_wechsel_audit() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if (new.aktiver_mandant_id is distinct from old.aktiver_mandant_id)
     or (new.ansicht is distinct from old.ansicht) then
    -- Das Paar reist IN vorher/nachher; audit_log führt dafür keine eigenen
    -- Spalten mandant_id_alt/neu (§4.4).
    perform app.protokolliere(
      'sitzung.mandant_gewechselt', 'benutzer_sitzung', new.id::text,
      jsonb_build_object('mandant_id', old.aktiver_mandant_id, 'ansicht', old.ansicht),
      jsonb_build_object('mandant_id', new.aktiver_mandant_id, 'ansicht', new.ansicht),
      new.aktiver_mandant_id);
    new.mandant_gewechselt_am := now();
  end if;
  return new;
end $$;

create trigger trg_sitzung_wechsel_audit
  before update on benutzer_sitzung
  for each row execute function kern.sitzung_wechsel_audit();

/** `globale_rolle_id` zeigt nur auf eine Rolle mit geltungsbereich = 'global'. */
create function kern.benutzer_globale_rolle_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.globale_rolle_id is not null and not exists (
       select 1 from public.rolle r
        where r.id = new.globale_rolle_id and r.geltungsbereich = 'global') then
    raise exception 'benutzer.globale_rolle_id verlangt eine Rolle mit geltungsbereich = global'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger trg_benutzer_globale_rolle
  before insert or update of globale_rolle_id on benutzer
  for each row execute function kern.benutzer_globale_rolle_pruefen();

/**
 * AUT-02 — ein Konto wird nicht `aktiv`, solange eine Rolle mit
 * `erfordert_2fa` zugewiesen ist und kein Faktor hinterlegt wurde.
 *
 * Die Datenbank ist hier die ZWEITE Verteidigungslinie. Die erste ist das
 * Sitzungs-Gate: `app.hat_recht()` verlangt für ein `erfordert_2fa`-Recht
 * `app.aal() = 'aal2'`, und `app.ist_super_admin()` ebenso. Eine Prüfung nur
 * hier hiesse: wer den Faktor nach dem Aktivieren entfernt, behält alles.
 */
create function kern.benutzer_2fa_pflicht() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if new.status <> 'aktiv' then return new; end if;
  if exists (
       select 1 from public.rolle r
        where (r.id = new.globale_rolle_id
               or r.id in (select bm.rolle_id from public.benutzer_mandant bm
                            where bm.benutzer_id = new.id and bm.entzogen_am is null))
          and r.erfordert_2fa)
     and not app.hat_zweiten_faktor(new.id) then
    raise exception 'Konto benötigt einen zweiten Faktor, bevor es aktiv wird (AUT-02)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_benutzer_2fa_pflicht
  before insert or update of status, globale_rolle_id on benutzer
  for each row execute function kern.benutzer_2fa_pflicht();

/** `benutzer_mandant.rolle_id` muss geltungsbereich = 'mandant' tragen. */
create function kern.bm_rolle_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_bereich rolle_geltungsbereich; v_mandant uuid;
begin
  select r.geltungsbereich, r.mandant_id into v_bereich, v_mandant
    from public.rolle r where r.id = new.rolle_id;
  if v_bereich <> 'mandant' then
    raise exception 'benutzer_mandant verlangt eine Rolle mit geltungsbereich = mandant'
      using errcode = 'restrict_violation';
  end if;
  if v_mandant is not null and v_mandant <> new.mandant_id then
    raise exception 'Die Rolle gehört einem anderen Bereich'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger trg_bm_rolle_pruefen
  before insert or update of rolle_id, mandant_id on benutzer_mandant
  for each row execute function kern.bm_rolle_pruefen();

/**
 * K-14 — abgeleitete Mitgliedschaften sind ADDITIV.
 *
 * Eine Zeile mit `aus_anstellung = true` kann nicht manuell entzogen werden,
 * ohne sie vorher zu übernehmen. Andersherum: eine manuell vergebene
 * `leitung` wird vom Anstellungs-Trigger nie mit `mitarbeiter` überschrieben,
 * weil er nur einfügt, wenn keine lebende Zeile existiert.
 */
create function kern.bm_aus_anstellung_schutz() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.aus_anstellung and new.aus_anstellung
     and new.entzogen_am is not null and old.entzogen_am is null then
    raise exception
      'Diese Mitgliedschaft stammt aus einer Anstellung (K-14). Erst übernehmen '
      '(aus_anstellung = false), dann entziehen.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger trg_bm_aus_anstellung_schutz
  before update on benutzer_mandant
  for each row execute function kern.bm_aus_anstellung_schutz();

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table rolle                 enable row level security;
alter table rolle                 force  row level security;
alter table benutzer              enable row level security;
alter table benutzer              force  row level security;
alter table benutzer_mandant      enable row level security;
alter table benutzer_mandant      force  row level security;
alter table benutzer_sitzung      enable row level security;
alter table benutzer_sitzung      force  row level security;
alter table plattform_einstellung enable row level security;
alter table plattform_einstellung force  row level security;
alter table kern.anmeldeversuch   enable row level security;
alter table kern.anmeldeversuch   force  row level security;

-- Rollen sind der Katalog: lesbar, damit der Rechte-Editor sie anzeigt.
create policy t_rolle_lesen on rolle for select to cse_app
  using (mandant_id is null or mandant_id = any (app.sichtbare_mandanten()));

-- Ein Admin sieht nur Konten, die SEINEM Bereich zugeordnet sind.
create policy t_benutzer_lesen on benutzer for select to cse_app
  using (id = app.aktueller_benutzer()
         or app.ist_super_admin()
         or (exists (select 1 from benutzer_mandant bm
                      where bm.benutzer_id = benutzer.id
                        and bm.mandant_id = app.aktiver_mandant()
                        and bm.entzogen_am is null)
             and app.hat_recht('system.benutzer_lesen', app.aktiver_mandant())));

/**
 * Auf SELECT liegt bewusst KEIN aal2-Gate (K-15): eine restriktive
 * aal2-Policy hier gäbe jedem `leitung`, `mitarbeiter` und `kunde` null
 * Zeilen, `sichtbare_mandanten()` wäre leer, jede darauf gebaute Policy
 * false — und die Plattform ginge für alle Nicht-Admins schwarz,
 * einschliesslich Check-in und Kundenportal.
 */
create policy t_bm_lesen on benutzer_mandant for select to cse_app
  using (benutzer_id = app.aktueller_benutzer()
         or app.ist_super_admin()
         or (mandant_id = app.aktiver_mandant()
             and app.hat_recht('system.benutzer_lesen', mandant_id)));

create policy t_bm_schreiben on benutzer_mandant for insert to cse_app
  with check (app.hat_recht('system.benutzer_verwalten', mandant_id)
              and mandant_id = app.aktiver_mandant()
              and not app.ist_gruppenansicht()
              and not app.ist_readonly());

-- Der SCHREIBpfad trägt das aal2-Gate, restriktiv (K-15).
create policy p_bm_aal2 on benutzer_mandant as restrictive for insert to cse_app
  with check (app.aal() = 'aal2');

create policy t_sitzung_eigene on benutzer_sitzung for select to cse_app
  using (benutzer_id = app.aktueller_benutzer());
create policy t_sitzung_eigene_schreiben on benutzer_sitzung for update to cse_app
  using (benutzer_id = app.aktueller_benutzer())
  with check (benutzer_id = app.aktueller_benutzer());

-- Plattformeinstellungen: lesbar für alle Angemeldeten, schreibbar für
-- niemanden über cse_app — sie werden per Migration oder Verwaltung gesetzt.
create policy t_plattform_lesen on plattform_einstellung for select to cse_app using (true);

-- kern.anmeldeversuch: KEINE cse_app-Policy. Der einzige Weg ist die
-- Definer-Funktion, und ohne Policy trifft ein direkter Zugriff null Zeilen.

grant select on rolle to cse_app;
grant select on benutzer to cse_app;
grant select, insert, update on benutzer_mandant to cse_app;
grant select, update on benutzer_sitzung to cse_app;
grant select on plattform_einstellung to cse_app;

/**
 * Selbstpflege als COLUMN-GRANT, nicht als Trigger-Whitelist (K-05-Muster).
 * Ein Trigger, der Spalten vergleicht, ist beim nächsten neuen Feld still
 * unvollständig; ein Grant, der ein Feld nicht nennt, ist es nie.
 */
create policy t_benutzer_selbstpflege on benutzer for update to cse_app
  using (id = app.aktueller_benutzer())
  with check (id = app.aktueller_benutzer());
grant update (name, sprache, benachrichtigung_praeferenz) on benutzer to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0007)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- rolle (archiv): AUT-03, SEC-A9. Die Historie in `benutzer_mandant` verweist auf die Rolle, unter der jemand gehandelt hat. Die Rolle zu löschen macht zehn Jahre Rechtevergabe unlesbar; `archiviert_am` beendet ihre Verwendung.
create trigger trg_rolle_kein_hard_delete
  before delete on rolle
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rolle_kein_truncate
  before truncate on rolle
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rolle from cse_app, cse_anon, cse_checkin, cse_job;

-- benutzer (archiv): SEC-A9, LEG-01. `audit_log` benennt dieses Konto als Akteur — dauerhaft. Ein gelöschter Benutzer macht jede Zeile, die er geschrieben hat, herrenlos. `deaktiviert_am` beendet den Zugang.
create trigger trg_benutzer_kein_hard_delete
  before delete on benutzer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_benutzer_kein_truncate
  before truncate on benutzer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on benutzer from cse_app, cse_anon, cse_checkin, cse_job;

-- benutzer_mandant (archiv): AUT-08, LEG-01. Wer wann in welchem Bereich welche Rolle hatte, ist die Antwort auf "wer durfte das". `entzogen_am` beendet den Zugang und behält die Antwort.
create trigger trg_benutzer_mandant_kein_hard_delete
  before delete on benutzer_mandant
  for each row execute function kern.verhindere_loeschung();
create trigger trg_benutzer_mandant_kein_truncate
  before truncate on benutzer_mandant
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on benutzer_mandant from cse_app, cse_anon, cse_checkin, cse_job;

-- benutzer_sitzung (archiv): SEC-A9, AUT-08. Sitzungen sind Teil des Sicherheitsprotokolls: von welchem Gerät und welcher IP wann gearbeitet wurde. `beendet_am` beendet sie.
create trigger trg_benutzer_sitzung_kein_hard_delete
  before delete on benutzer_sitzung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_benutzer_sitzung_kein_truncate
  before truncate on benutzer_sitzung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on benutzer_sitzung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_rolle_geaendert_am
  before update on rolle
  for each row execute function kern.setze_geaendert_am();
create trigger trg_benutzer_geaendert_am
  before update on benutzer
  for each row execute function kern.setze_geaendert_am();
create trigger trg_benutzer_mandant_geaendert_am
  before update on benutzer_mandant
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
