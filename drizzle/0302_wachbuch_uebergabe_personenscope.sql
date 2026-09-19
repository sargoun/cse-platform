-- 0302 — Die Uebergabe im Wachbuch, im Personen-Scope erreichbar
--        (SEC-05, EMP-13, K-18, O-151, § 34a GewO).
--
-- ===========================================================================
-- Der Befund: zwei Dinge, die unabhaengig voneinander nicht wirken
-- ===========================================================================
--
-- SEC-05 und 04-SEITENKARTE §7 geben der Wache auf der eigenen Schicht das
-- Wachbuch DIESES Objekts — zuerst, damit sie liest, was die vorige Schicht
-- hinterlassen hat, und dann ihren eigenen Eintrag schreibt. Die Plattform hat
-- dafuer schon alles gebaut, nur trifft im Mitarbeiterportal nichts davon zu:
--
-- 1. `wachbuch_eintrag.p_ma_decke` ist RESTRICTIVE und traegt den Zweig
--    `app.uebergabe_sichtbar(objekt_id, erfasst_am)`. Eine restriktive Policy
--    kann aber nur VERENGEN; sie laesst nichts zu. Permissiv lesen koennen
--    `t_person` (nur die EIGENEN Eintraege) und `t_mandant` (verlangt
--    `wachbuch.lesen`, das an super_admin/admin/leitung haengt und nicht an
--    `mitarbeiter`). Ergebnis: die Wache sieht in beiden Scopes NULL von sechs
--    Eintraegen — auch die ihrer Vorgaengerin am selben Objekt in derselben
--    Nacht.
--
-- 2. `app.uebergabe_sichtbar` ist im Personen-Scope strukturell FALSE, und
--    nicht nur unentschieden. Sie ruft `app.uebergabe_fenster()`, und die
--    liest `app.einstellung('wachbuch.uebergabe_fenster')` — die einstellige
--    Fassung, die den Mandanten aus `app.aktiver_mandant()` nimmt. Im
--    Personen-Scope ist der NULL (K-20), die Einstellung also NULL, das
--    Fenster `interval '0'` und `p_erfasst_am > now() - 0` fuer jeden
--    vergangenen Eintrag falsch. Auch mit gesetztem `PT12H`. Die Frage O-151
--    („welche Eintraege, wie lange") zu beantworten aendert daran nichts: die
--    Antwort kaeme nie an.
--
-- ===========================================================================
-- Was hier geaendert wird — und was ausdruecklich nicht
-- ===========================================================================
--
-- **Die Funktion loest den Mandanten jetzt aus dem OBJEKT auf** statt aus der
-- Sitzung. Das ist keine Erweiterung, sondern die Reparatur einer Annahme: das
-- Uebergabefenster ist eine Einstellung DER GESELLSCHAFT, zu der das Objekt
-- gehoert — nicht eine der Sitzung, die gerade fragt. Im Mandantenscope
-- aendert sich damit nichts (dort IST der Mandant des Objekts der aktive;
-- jede andere Zeile faellt schon an der Policy). Im Personen-Scope, im
-- Gruppen-Scope und im Kunden-Scope wird die Funktion ueberhaupt erst
-- beantwortbar — 03-GEWERKE §6.12 sagt ueber sie „resolves in all four", und
-- genau das war sie nicht.
--
-- **Kein neues Recht, kein neuer Rechteschluessel** (K-19): die Wache liest
-- nicht „das Wachbuch", sondern „die Uebergabe an MEINEM Objekt in MEINEM
-- Fenster". Das ist Selbstzugriff ueber `app.aktuelle_person()` und laesst
-- sich als Recht nicht formulieren. `wachbuch.lesen` zu binden hiesse, jeder
-- Kraft jedes Wachbuch jeder Liegenschaft der Gesellschaft zu geben.
--
-- **Kein Vorgabefenster.** Ohne gesetzte Einstellung bleibt es
-- `interval '0'`, und dann ist die Uebergabeliste LEER. Das ist die ehrliche
-- Antwort auf eine offene Geschaeftsfrage (O-151) und keine Zahl, die jemand
-- geraten hat — die Seite sagt es als Satz, statt „keine Eintraege" zu zeigen.
-- Der Seed setzt `{"interval": "PT0S"}` (0033), also aus.
--
-- **Der eigene Eintrag bleibt unberuehrt.** `t_person` zeigt der Wache ihre
-- eigenen Seiten weiter unabhaengig von jedem Fenster; die Policy unten kommt
-- nur fuer FREMDE Eintraege ueberhaupt zum Tragen.
-- ===========================================================================

/**
 * Das Uebergabefenster einer GESELLSCHAFT.
 *
 * Dieselbe Rechnung wie in der einstelligen Fassung aus 0070, nur mit dem
 * Mandanten als Parameter — und ohne Vorgabe: was nicht eingestellt ist, ist
 * aus (O-151).
 *
 * `app.einstellung(uuid, text)` ist `security definer`; dieser Aufruf laeuft
 * im Eigentum DIESER Funktion und kommt deshalb an `mandant_einstellung`
 * vorbei an der RLS — richtig, denn ein Fenster ist keine Zeile, die jemandem
 * gehoert.
 *
 * TODO(client, O-151): Welche Wachbucheintraege darf die FOLGESCHICHT zur Uebergabe sehen, und fuer welchen Zeitraum vor Dienstbeginn?
 */
create or replace function app.uebergabe_fenster(p_mandant uuid)
returns interval
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (app.einstellung(p_mandant, 'wachbuch.uebergabe_fenster')->>'interval')::interval,
    interval '0');
$$;

/*
 * **Eigentum: `cse_definer`, und nicht `postgres`** (K-01).
 *
 * Eine `security definer`-Funktion laeuft als ihr Eigentuemer. Ohne die
 * folgende Zeile gehoerte sie dem Migrationsbenutzer `postgres` — Superuser
 * mit BYPASSRLS —, und damit liefe sie an jeder Zeilenpolicy vorbei. Die
 * NULLSTELLIGE Fassung aus 0070 traegt diesen Fehler als Altlast und steht
 * dafuer in der Ausnahmeliste von `tests/isolation/definer-eigentum.test.ts`;
 * eine NEUE Funktion darf ihn nicht erben, nur weil sie denselben Namen traegt.
 * (Die Wache verglich bis 0304 nur `nspname.proname` — eine Ueberladung
 * rutschte durch. Sie vergleicht jetzt die volle Signatur.)
 *
 * `app.einstellung(uuid, text)` ist bisher nur `cse_app` und `cse_job`
 * gegrantet. Aus dem Rumpf heraus laeuft der Aufruf als `cse_definer`, und ohne
 * das Recht scheiterte er mit „permission denied for function app.einstellung"
 * — also ausgerechnet dort, wo das Fenster gelesen wird.
 */
alter function app.uebergabe_fenster(uuid) owner to cse_definer;
grant execute on function app.einstellung(uuid, text) to cse_definer;

revoke execute on function app.uebergabe_fenster(uuid) from public;
grant execute on function app.uebergabe_fenster(uuid) to cse_app, cse_job;

comment on function app.uebergabe_fenster(uuid) is
  'SEC-05 (0302): das Uebergabefenster der Gesellschaft, an der das Objekt '
  'haengt. Die einstellige Fassung aus 0070 nimmt den AKTIVEN Mandanten und '
  'ist damit im Personen-Scope blind — dort ist er NULL (K-20). Ohne '
  'gesetzte Einstellung: interval 0, also aus (O-151).';

/**
 * `app.uebergabe_sichtbar` — jetzt in allen vier Scopes beantwortbar.
 *
 * Geaendert ist genau EINE Zeile: das Fenster kommt aus dem Mandanten des
 * OBJEKTS statt aus dem der Sitzung. Der erste Einschub bleibt, wie er war
 * (`app.ist_eingesetzt_auf_objekt`), und er traegt weiter die eigentliche
 * Abgrenzung: gefragt wird nur nach Objekten, auf denen dieser Mensch
 * eingesetzt IST.
 *
 * Die Funktion behaelt ihren Eigentuemer (`create or replace` aendert ihn
 * nicht) und steht damit weiter in der K-01-Altlastliste von
 * `tests/isolation/definer-eigentum.test.ts` — diese Migration repariert ihre
 * Logik, nicht ihr Eigentum.
 */
create or replace function app.uebergabe_sichtbar(p_objekt uuid, p_erfasst_am timestamptz)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app.ist_eingesetzt_auf_objekt(p_objekt)
     and p_erfasst_am is not null
     and p_erfasst_am > now() - coalesce(
           (select app.uebergabe_fenster(o.mandant_id)
              from public.objekt o where o.id = p_objekt),
           interval '0');
$$;

comment on function app.uebergabe_sichtbar(uuid, timestamptz) is
  'SEC-05, EMP-13 (0070, Fenster korrigiert in 0302): darf die Folgeschicht '
  'diesen Eintrag zur Uebergabe sehen? Das Fenster kommt aus dem Mandanten '
  'des OBJEKTS — aus dem der Sitzung gelesen war die Funktion im '
  'Personen-Scope immer false, weil app.aktiver_mandant() dort NULL ist.';

/**
 * Die Uebergabe, permissiv — im Personen-Scope des Mitarbeiterportals.
 *
 * Das ist die Zeile, die in 0070 fehlte: der Zweig in `p_ma_decke` beschreibt
 * die Uebergabe, kann sie als RESTRICTIVE Policy aber nur verengen. Hier
 * steht sie als Erlaubnis — mit genau demselben Praedikat, damit die zwei
 * nicht auseinanderlaufen koennen.
 *
 * Eng gehalten ist sie dreifach: `app.scope() = 'person'` (kein Weg ins
 * interne Portal), `mandant_id = any (app.sichtbare_mandanten())` — im
 * Personen-Scope die lebenden Beschaeftigungen dieses Menschen (0004) — und
 * das Fenster selbst, das ohne Einstellung geschlossen ist.
 *
 * Was sie NICHT gibt: Schreiben. Der Eintrag der Wache entsteht ueber
 * `t_mandant` mit `wachbuch.schreiben` im M1-Scope, und Eintraege sind
 * ohnehin anfuegbar und nie aenderbar (0070, § 34a GewO).
 */
create policy t_person_uebergabe on wachbuch_eintrag for select to cse_app
using (
  app.scope() = 'person'
  and mandant_id = any (app.sichtbare_mandanten())
  and app.uebergabe_sichtbar(objekt_id, erfasst_am)
);

comment on policy t_person_uebergabe on wachbuch_eintrag is
  'SEC-05 (0302): die Uebergabe der vorigen Schicht, im Personen-Scope. '
  'Praedikat wortgleich mit dem uebergabe-Zweig von p_ma_decke, die als '
  'RESTRICTIVE Policy nichts zulassen kann. Ohne die Einstellung '
  'wachbuch.uebergabe_fenster ist das Fenster 0 und die Liste leer (O-151).';
