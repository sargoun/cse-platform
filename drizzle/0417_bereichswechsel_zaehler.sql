-- 0417 — der Bereichswechsel bekommt seine Zaehler und seine Gewerke
-- (TEN-06, TEN-10, DESIGN §6, V-165, D-659).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- DESIGN §6 Regel 2 und TEN-10 verlangen im Umschalter je Bereich einen
-- LIVE-Zaehler. 01-KERN §6.3 und 05-API-KARTE nennen dafuer
-- app.mandant_kennzahlen — gebaut war sie nie. Der Umschalter lebte nur in
-- der Entwicklungsflaeche mit festen Zahlen (24/8/12), und die echte
-- Bereichswahl zeigte keine. Die Frage aus DECISIONS „Carried over" Nr. 2
-- (zaehlt der Umschalter nach den Rechten des Betrachters?) war offen.
--
-- Im mandant-Scope sieht eine Sitzung ueber RLS nur den AKTIVEN Bereich
-- (t_mandant_lesen, K-03). Was ein Umschalter ueber die ANDEREN zeigen soll,
-- braucht deshalb einen benannten Leseweg — sonst entsteht entweder ein
-- dekorativer Umschalter oder ein Dienstkonto an der RLS vorbei.
--
-- ===========================================================================
-- Die zwei Funktionen
-- ===========================================================================
--
--  1. app.mandant_kennzahlen() — NUR Anzahlen, nie Geld, nie Zeilen (EMP-13,
--     D-09 §6; der Rueckgabetyp traegt kein bigint). Beschraenkt auf
--     app.switcher_mandanten() und gefiltert nach den LESERECHTEN DES
--     BETRACHTERS im jeweiligen Bereich (D-659, beantwortet „Carried over"
--     Nr. 2): app.hat_recht fragt dieselbe Aufloesung wie jede Policy —
--     mit der Modulliste der Mitgliedschaft (0416), dem zweiten Faktor
--     (0395) und der Gruppenansicht. Wer auftrag.lesen in einem Bereich
--     nicht haelt, bekommt fuer ihn KEINE Zeile, keine Null: eine Null waere
--     eine Aussage ueber den Bestand.
--       auftraege_aktiv   auftrag.status = aktiv, nicht archiviert —
--                         dieselbe Zahl wie die Gruppenuebersicht
--                         (services/gruppe/uebersicht.ts).
--       projekte_laufend  projekt.status in (geplant, in_arbeit), nicht
--                         archiviert — dieselbe Zahl wie die Bauuebersicht
--                         (services/bau/uebersicht.ts); nur wo bau gebucht
--                         ist oder die Buchung nie gepflegt wurde (D-377,
--                         O-355), und nur mit bau.lesen.
--     LIVE gezaehlt statt aus einer Zwischentabelle, die ein Job fuellt, wie
--     01-KERN §6.3 es vorsah (D-659): beide Zaehlungen laufen ueber
--     vorhandene Indizes (auftrag_liste_idx, projekt_status_idx), je Bereich
--     eine, und nur fuer Sitzungen mit mehr als einem Bereich. Eine Tabelle
--     haette einen Job, eine Frist und einen veralteten Stand gebraucht — fuer
--     eine Zahl, die TEN-10 ausdruecklich live nennt.
--  2. app.umschalter_bereiche() — dieselben Bereiche wie
--     app.switcher_bereiche() (0018), dazu die gebuchten Gewerke fuer die
--     Unterzeile („Reinigung · 24 laufende Auftraege"). NULL, solange die
--     Buchung nie gepflegt wurde (O-355): dann ist das Gewerk unbekannt, und
--     unbekannt ist nicht leer. switcher_bereiche bleibt, wie es ist — die
--     Kontoseite liest es.
--
-- Beide gehoeren cse_definer (K-01) und bringen ihre eigenen d-Policies mit.
-- Die vorhandenen (d_feed_mandant, d_auftrag_lesen, d_projekt_kennzahlen,
-- d_bm_lesen) decken das Lesen heute schon breit ab; die eigenen hier halten
-- auch dann, wenn jene einmal enger werden.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 und 0393.

-- ---------------------------------------------------------------------------
-- 0. Was cse_definer dafuer braucht
-- ---------------------------------------------------------------------------

grant execute on function app.switcher_mandanten() to cse_definer;

grant select (id, slug, name, sortierung, module, module_gepflegt, archiviert_am)
  on mandant to cse_definer;
grant select (benutzer_id, mandant_id, ist_standard, entzogen_am)
  on benutzer_mandant to cse_definer;
grant select (mandant_id, status, archiviert_am) on auftrag to cse_definer;
grant select (mandant_id, status, archiviert_am) on projekt to cse_definer;

create policy d_umschalter_mandant on mandant
  for select to cse_definer
  using (id = any (app.switcher_mandanten()));
comment on policy d_umschalter_mandant on mandant is
  'app.umschalter_bereiche und app.mandant_kennzahlen (0417): nur die Bereiche des Umschalters.';

create policy d_umschalter_mitgliedschaft on benutzer_mandant
  for select to cse_definer
  using (benutzer_id = app.aktueller_benutzer());
comment on policy d_umschalter_mitgliedschaft on benutzer_mandant is
  'app.umschalter_bereiche (0417): nur die eigenen Mitgliedschaften (ist_standard).';

create policy d_umschalter_auftrag on auftrag
  for select to cse_definer
  using (mandant_id = any (app.switcher_mandanten()));
comment on policy d_umschalter_auftrag on auftrag is
  'app.mandant_kennzahlen (0417): gezaehlt wird nur in den Bereichen des Umschalters.';

create policy d_umschalter_projekt on projekt
  for select to cse_definer
  using (mandant_id = any (app.switcher_mandanten()));
comment on policy d_umschalter_projekt on projekt is
  'app.mandant_kennzahlen (0417): gezaehlt wird nur in den Bereichen des Umschalters.';

-- ---------------------------------------------------------------------------
-- 1. Die Zaehler
-- ---------------------------------------------------------------------------

create function app.mandant_kennzahlen()
returns table (mandant_id uuid, schluessel text, wert integer)
language sql stable security definer set search_path = pg_catalog, public, app as $$
  with bereich as (
    select m.id, m.module, m.module_gepflegt
      from public.mandant m
     where m.id = any (app.switcher_mandanten())
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
  'TEN-10, DESIGN §6 Regel 2 (0417, V-165, D-659): die Live-Zaehler des Umschalters. '
  'Nur Anzahlen, nur Bereiche aus switcher_mandanten, nur mit dem Leserecht des '
  'Betrachters im jeweiligen Bereich — sonst keine Zeile.';

alter function app.mandant_kennzahlen() owner to cse_definer;
revoke all on function app.mandant_kennzahlen() from public;
grant execute on function app.mandant_kennzahlen() to cse_app;

-- ---------------------------------------------------------------------------
-- 2. Die Bereiche mit ihren Gewerken
-- ---------------------------------------------------------------------------

create function app.umschalter_bereiche()
returns table (id uuid, slug text, name text, ist_standard boolean, gewerke text[])
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select m.id, m.slug, m.name,
         coalesce(bool_or(bm.ist_standard), false),
         case when m.module_gepflegt then m.module end
    from public.mandant m
    left join public.benutzer_mandant bm
           on bm.mandant_id = m.id
          and bm.benutzer_id = app.aktueller_benutzer()
          and bm.entzogen_am is null
   where m.id = any (app.switcher_mandanten())
   group by m.id, m.slug, m.name, m.sortierung, m.module, m.module_gepflegt
   order by coalesce(bool_or(bm.ist_standard), false) desc, m.sortierung, m.slug
$$;

comment on function app.umschalter_bereiche() is
  'DESIGN §6 (0417, V-165): die Bereiche des Umschalters wie switcher_bereiche (0018), '
  'dazu die gebuchten Gewerke — NULL, solange die Buchung nie gepflegt wurde (O-355).';

alter function app.umschalter_bereiche() owner to cse_definer;
revoke all on function app.umschalter_bereiche() from public;
grant execute on function app.umschalter_bereiche() to cse_app;
