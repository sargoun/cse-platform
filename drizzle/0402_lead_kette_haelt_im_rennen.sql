-- ===========================================================================
-- 0402 — Die Kette Lead, Angebot, Auftrag haelt auch im Rennen und nach dem
--        Archiv (V-142, D-636, Nachpruefung von 0400)
-- ===========================================================================
-- **Der Befund.** Zwei Stellen aus 0400 hielten nur, solange niemand
-- gleichzeitig klickt oder archiviert.
--
--   1. kern.lead_bezug_stimmt (0400) las den Lead OHNE Sperre. Ein Angebot
--      fuer Kunde A an der Anfrage L wurde geprueft und eingefuegt; zwischen
--      Pruefung und Abschluss konnte ein gleichzeitiges Kunden-zuordnen den
--      Lead auf Kunde B umhaengen. Dessen Vorpruefung und
--      kern.lead_kunde_bleibt sahen das Angebot noch nicht (es war nicht
--      festgeschrieben), und danach stand ein Angebot fuer A an einer
--      Anfrage von B: genau der Zustand, den beide Ausloeser verbieten, und
--      der Herkunftsbericht zaehlte einen Kanal fuer einen fremden Umsatz.
--   2. lead_ausschreibung_uk (0400) zaehlte auch ARCHIVIERTE Leads. Eine
--      Bekanntmachung, deren Lead archiviert wurde, liess sich in dieser
--      Gesellschaft nie wieder uebernehmen. Archiviert beendet einen Lead
--      (0017); der Schluessel soll zwei GLEICHZEITIG bearbeitete Leads zu
--      derselben Vergabe verhindern, nicht die Vergabe fuer immer sperren.
--
-- **Was diese Migration aendert.**
--   1. kern.lead_bezug_stimmt sperrt die Zeile des Leads mit FOR SHARE. Ein
--      gleichzeitiges Umhaengen (FOR UPDATE in services/crm/lead-kette.ts,
--      danach das UPDATE selbst) wartet, bis das Angebot festgeschrieben ist,
--      und sieht es dann; umgekehrt wartet das Angebot auf das Umhaengen und
--      liest den neuen Kunden. Der Rest der Funktion bleibt Wort fuer Wort
--      wie in 0400 — create or replace verlangt den ganzen Rumpf.
--   2. lead_ausschreibung_uk gilt nur noch fuer nicht archivierte Leads.
--
-- **Warum die Sperre erlaubt ist.** FOR SHARE verlangt ein UPDATE-Recht an
-- der Tabelle und die UPDATE-Policy fuer die Zeile. cse_definer haelt seit
-- 0400 update (status, konvertiert_am) auf lead und die Policy
-- d_lead_kette_folgen im aktiven Mandanten — dieselben Grenzen, mehr nicht.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der Bezug wird unter Sperre gelesen.
-- ---------------------------------------------------------------------------
-- Ersetzt die Fassung aus 0400. Einzige Aenderung: for share an der Abfrage.
create or replace function kern.lead_bezug_stimmt() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_kunde uuid;
begin
  if new.lead_id is null then return new; end if;
  select l.kunde_id into v_kunde
    from public.lead l
   where l.id = new.lead_id and l.mandant_id = new.mandant_id
     for share;
  if not found then
    raise exception 'Diese Anfrage ist in dieser Gesellschaft nicht bekannt'
      using errcode = 'foreign_key_violation';
  end if;
  if v_kunde is null then
    raise exception 'Die Anfrage hat noch keinen Kunden; erst den Kunden zuordnen'
      using errcode = 'check_violation';
  end if;
  if v_kunde <> new.kunde_id then
    raise exception 'Die Anfrage gehoert einem anderen Kunden als dieser Vorgang'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function kern.lead_bezug_stimmt() is
  'V-138, V-142, D-632, D-636: ein Angebot oder Auftrag mit lead_id gehoert dem Kunden seines '
  'Leads; gelesen unter FOR SHARE, damit kein gleichzeitiges Umhaengen dazwischenkommt.';

alter function kern.lead_bezug_stimmt() owner to cse_definer;
revoke execute on function kern.lead_bezug_stimmt() from public;

-- ---------------------------------------------------------------------------
-- 2. Eine Bekanntmachung, ein LAUFENDER Lead je Gesellschaft.
-- ---------------------------------------------------------------------------
drop index lead_ausschreibung_uk;
create unique index lead_ausschreibung_uk on lead (mandant_id, ausschreibung_id)
  where ausschreibung_id is not null and archiviert_am is null;
