-- 0418 — die Zaehler des Bereichswechsels nur dort, wo der Betrachter intern
-- arbeitet (TEN-10, DESIGN §6, D-659, V-166, D-660).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- app.mandant_kennzahlen (0417) zaehlte je Bereich, sobald app.hat_recht das
-- Leserecht bejahte. Die Rolle kunde haelt auftrag.lesen und bau.lesen
-- plattformweit (0008). Auf eigene Zeilen beschraenkt wird sie allein ueber die
-- RLS: t_kunde und p_kunde_decke auf auftrag (0025), t_kunde und
-- p_portal_decke auf projekt (0071). Die Definer-Funktion laeuft als
-- cse_definer und sieht diese Policies nicht (d_auftrag_lesen und
-- d_projekt_kennzahlen stehen auf using true). Ihr count lief deshalb ueber
-- ALLE Kunden der Gesellschaft.
--
-- Ein Kundenkonto kann in zwei Gesellschaften Zugang haben: 0249 gibt einem
-- bestehenden Kundenkonto in einer weiteren Gesellschaft eine zweite
-- Mitgliedschaft. Die Kopfzeile des Kundenportals verweist dann auf
-- /auth/bereich, und diese Seite fragte die Zaehler ohne Einschraenkung. Dort
-- stand zum Beispiel: Reinigung, 57 laufende Auftraege. Gemeint war der
-- Auftragsbestand der Gesellschaft ueber alle Kunden, und genau diese Zahl
-- darf ein Kunde nicht sehen (05-API-KARTE: a count is a real disclosure).
--
-- Dasselbe gilt fuer jede Mitgliedschaft, deren Rolle nicht intern ist, auch
-- im internen Portal. Wer in der Reinigung leitet und bei REALTIME Kunde ist,
-- haette im Umschalter den Bestand von REALTIME gesehen. Dort zeigt die RLS
-- ihm nach dem Wechsel nur seine eigenen Vorgaenge. Die Anwendungswege
-- verhindern das Mischen von kunde und intern (0249, 0372); die Datenbank
-- verlaesst sich nicht darauf.
--
-- ===========================================================================
-- Die Regel (D-660)
-- ===========================================================================
--
-- Zwei Bedingungen, beide fail-closed, zusaetzlich zum Leserecht aus 0417:
--
--  1. Die SITZUNG ist intern: app.portal() = intern. Das ist das interne
--     Portal und die Gruppenansicht, also genau die Leisten, die einen
--     Umschalter tragen (D-659 Nr. 4). Die Anwendung fragt ausserdem nur dort
--     (umschalterStand, zaehltFuer); die Datenbank sagt dasselbe noch einmal,
--     fuer den Aufrufer, der es vergisst.
--  2. Der Betrachter arbeitet IM JEWEILIGEN BEREICH intern. Das Portal im
--     Bereich wird genau so bestimmt wie in app.sitzung_aufloesen (0138) beim
--     Wechsel dorthin: die Rolle der nicht entzogenen Mitgliedschaft in DIESEM
--     Bereich, sonst die globale Rolle, sonst mitarbeiter. Ohne
--     Gueltigkeitsfenster, weil sitzung_aufloesen keines kennt: eine
--     abgelaufene Kundenmitgliedschaft neben einer globalen internen Rolle
--     macht die Sitzung nach dem Wechsel zu einer Kundensitzung, und die RLS
--     zeigt dann nur die eigenen Vorgaenge. Ein Fenster hier haette in genau
--     diesem Fall ueber die globale Rolle intern gerechnet und den ganzen
--     Bestand gezaehlt.
--
-- Nur wenn beides gilt, ist die Zahl dieselbe, die die RLS dem Betrachter in
-- diesem Bereich zeigt: p_kunde_decke laesst ein internes Portal durch, und
-- p_portal_decke oeffnet ihm alle Projekte. Ohne internes Portal gibt es fuer
-- den Bereich keine Zeile, auch keine Null.
--
-- ===========================================================================
-- Was sonst bleibt
-- ===========================================================================
--
-- Aeltere Fassung dieser Funktion: 0417 (angelegt dort). Signatur,
-- Rueckgabetyp (nur Anzahlen, kein bigint), die beiden Zaehlungen und ihre
-- Bedingungen sind wortgleich zu 0417; neu ist nur die Auswahl der Bereiche.
-- create or replace laesst Eigentuemer (cse_definer) und Grants stehen; sie
-- werden unten trotzdem noch einmal ausdruecklich gesetzt.
--
-- Neu gelesen werden rolle und benutzer. Beide bekommen eine eigene Policy
-- fuer cse_definer, eng auf das eigene Konto und seine Rollen, im selben
-- Muster wie d_umschalter_mitgliedschaft (0417). Die breiten Policies
-- d_feed_rolle, d_rolle_freigabe, d_feed_benutzer und d_benutzer_anmeldung
-- decken das Lesen heute schon ab; die eigenen halten auch dann, wenn jene
-- einmal enger werden.
--
-- Die Spaltengrants unten und die aus 0416 und 0417 auf benutzer_mandant sind
-- heute wirkungslos: 0155 gibt cse_definer select auf ganz rolle, benutzer und
-- benutzer_mandant, 0191 insert und update auf ganz benutzer_mandant. Sie
-- beschraenken also nichts. Sie nennen, welche Spalten die Funktion braucht,
-- und tragen erst, wenn die Tabellengrants einmal enger werden (D-660 Nr. 5).
--
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie in 0417.

-- ---------------------------------------------------------------------------
-- 0. Was cse_definer zusaetzlich liest
-- ---------------------------------------------------------------------------

grant execute on function app.portal() to cse_definer;
grant select (id, portal, geltungsbereich, archiviert_am) on rolle to cse_definer;
grant select (id, globale_rolle_id) on benutzer to cse_definer;
grant select (benutzer_id, mandant_id, rolle_id, entzogen_am) on benutzer_mandant to cse_definer;

create policy d_umschalter_benutzer on benutzer
  for select to cse_definer
  using (id = (select app.aktueller_benutzer()));
comment on policy d_umschalter_benutzer on benutzer is
  'app.mandant_kennzahlen (0418): nur das eigene Konto (globale Rolle).';

create policy d_umschalter_rolle on rolle
  for select to cse_definer
  using (id in (select bm.rolle_id from public.benutzer_mandant bm
                 where bm.benutzer_id = (select app.aktueller_benutzer())
                   and bm.entzogen_am is null)
         or id = (select b.globale_rolle_id from public.benutzer b
                   where b.id = (select app.aktueller_benutzer())));
comment on policy d_umschalter_rolle on rolle is
  'app.mandant_kennzahlen (0418): nur die Rollen der eigenen Mitgliedschaften und die globale Rolle.';

-- ---------------------------------------------------------------------------
-- 1. Die Zaehler — nur in einer internen Sitzung, nur wo der Betrachter
--    intern arbeitet
-- ---------------------------------------------------------------------------

create or replace function app.mandant_kennzahlen()
returns table (mandant_id uuid, schluessel text, wert integer)
language sql stable security definer set search_path = pg_catalog, public, app as $$
  with bereich as (
    select m.id, m.module, m.module_gepflegt
      from public.mandant m
     where app.portal() = 'intern'
       and m.id = any (app.switcher_mandanten())
       and coalesce(
             (select r.portal
                from public.benutzer_mandant bm
                join public.rolle r on r.id = bm.rolle_id
               where bm.benutzer_id = app.aktueller_benutzer()
                 and bm.mandant_id = m.id
                 and bm.entzogen_am is null
               limit 1),
             (select r.portal
                from public.benutzer b
                join public.rolle r on r.id = b.globale_rolle_id
               where b.id = app.aktueller_benutzer()
                 and r.geltungsbereich = 'global'
                 and r.archiviert_am is null),
             'mitarbeiter') = 'intern'
  )
  select b.id, 'auftraege_aktiv'::text,
         (select count(*) from public.auftrag a
           where a.mandant_id = b.id and a.status = 'aktiv'
             and a.archiviert_am is null)::integer
    from bereich b
   where app.hat_recht('auftrag.lesen', b.id)
  union all
  select b.id, 'projekte_laufend'::text,
         (select count(*) from public.projekt p
           where p.mandant_id = b.id and p.status in ('geplant', 'in_arbeit')
             and p.archiviert_am is null)::integer
    from bereich b
   where (not b.module_gepflegt or 'bau' = any (b.module))
     and app.hat_recht('bau.lesen', b.id)
$$;

comment on function app.mandant_kennzahlen() is
  'TEN-10, DESIGN §6 Regel 2 (0417, 0418, V-166, D-660): die Live-Zaehler des Umschalters. '
  'Nur Anzahlen, nur Bereiche aus switcher_mandanten, nur in einer internen Sitzung, nur wo '
  'der Betrachter nach dem Wechsel intern arbeitete (Portal wie app.sitzung_aufloesen) und '
  'das Leserecht haelt — sonst keine Zeile.';

alter function app.mandant_kennzahlen() owner to cse_definer;
revoke all on function app.mandant_kennzahlen() from public;
grant execute on function app.mandant_kennzahlen() to cse_app;
