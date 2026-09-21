-- ===========================================================================
-- 0375 — Der Stichtag ist der BERLINER Tag, nicht der UTC-Tag
--        (Invariante 2, K-11, V-103)
--
-- **Wie der Befund aufgefallen ist.** Der Seed brach ab:
--
--   PostgresError: Der Verantwortliche gehoert nicht zu dieser Gesellschaft
--
-- Derselbe Seed war Stunden zuvor durchgelaufen, und nichts am Seed hatte
-- sich geaendert. Geaendert hatte sich die UHRZEIT: 23:23 UTC — in Berlin
-- war schon der naechste Tag.
--
-- ---------------------------------------------------------------------------
-- **Der Fehler, in einer Zeile.**
-- ---------------------------------------------------------------------------
--
--   benutzer_mandant.gueltig_ab   default app.berlin_heute()   -> 22.09.
--   app.ist_mitglied(...)         p_stichtag date default CURRENT_DATE
--                                 (Sitzung laeuft in UTC)      -> 21.09.
--
-- Die Mitgliedschaft wird mit dem Berliner Tag gestempelt und gegen den
-- UTC-Tag geprueft. `gueltig_ab (22.) <= stichtag (21.)` ist falsch — also
-- ist ein soeben angelegtes Konto **kein Mitglied**.
--
-- **Das ist kein Seed-Problem.** Es trifft den Betrieb:
--
--   * Zwischen 00:00 und 02:00 Berliner Zeit (im Winter 01:00) ist jede NEU
--     angelegte Mitgliedschaft fuer bis zu zwei Stunden unwirksam.
--   * `app.ist_mitglied` haengt nicht nur am Auftrag: wer in diesem Fenster
--     eine Leitung einlaedt, legt ein Konto an, das sich anmelden kann und
--     nichts sieht.
--   * Und es faellt nur nachts auf. Ein Fehler, der zwei Stunden am Tag
--     existiert, wird beim Nachstellen am Vormittag nicht reproduziert —
--     genau die Sorte, vor der CLAUDE.md warnt: „silent, expensive,
--     late-discovered".
--
-- ---------------------------------------------------------------------------
-- **Die Entscheidung: der Geschaeftstag dieser Plattform ist der Berliner.**
-- ---------------------------------------------------------------------------
--
-- Invariante 2 sagt es fuer Zeitstempel („stored UTC, displayed
-- Europe/Berlin"); fuer ein DATUM ist die Folge strenger, nicht schwaecher.
-- Ein Datum ist hier nie ein Zeitpunkt, sondern ein Geschaeftstag: der Tag,
-- an dem eine Mitgliedschaft beginnt, ein Preis gilt, ein Leistungswert
-- greift. Dieser Tag ist der, den der Mensch in Berlin auf dem Kalender
-- sieht — nicht der, den ein Server in UTC fuehrt.
--
-- `CURRENT_DATE` gibt den UTC-Tag, weil die Sitzungen in UTC laufen. Es ist
-- damit in JEDER dieser Funktionen falsch, auch wo es heute nicht auffaellt.
-- Gemessen mit:
--
--   select p.proname, pg_get_function_arguments(p.oid)
--     from pg_proc p
--    where p.pronamespace in ('app'::regnamespace, 'kern'::regnamespace)
--      and pg_get_function_arguments(p.oid) ilike '%default current_date%';
--
-- Drei Treffer, und alle drei stehen unten. `app.berlin_heute()` gibt es
-- seit 0004 und ist genau dafuer gebaut.
-- ===========================================================================

/*
 * 1. Die Mitgliedschaft — der Treffer, der den Seed angehalten hat.
 *
 * Nur die Vorgabe des Arguments aendert sich; der Rumpf bleibt Wort fuer
 * Wort stehen. Wer einen anderen Stichtag will (eine Rueckschau, ein
 * Bericht), uebergibt ihn weiterhin selbst.
 */
create or replace function app.ist_mitglied(
  p_benutzer uuid, p_mandant uuid, p_stichtag date default app.berlin_heute()
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1 from public.benutzer_mandant bm
     where bm.benutzer_id = p_benutzer
       and bm.mandant_id  = p_mandant
       and bm.entzogen_am is null
       and bm.gueltig_ab <= p_stichtag
       and (bm.gueltig_bis is null or bm.gueltig_bis >= p_stichtag))
$$;

/*
 * 2. Die Katalogpositionen. Ein Preis, der ab dem 22. gilt, gilt ab dem
 * Berliner 22. — nicht ab 02:00 Berliner Zeit desselben Tages.
 */
create or replace function app.katalog_positionen(
  p_schluessel text, p_stichtag date default app.berlin_heute()
) returns table (
  id uuid, oz text, kurztext text, langtext text, einheit text,
  zeitwert_minuten numeric,              -- nicht-geld: Minuten
  leistungswert_qm_pro_stunde numeric,   -- nicht-geld: m2/h
  standard_einzelpreis_cent bigint, kostenart kostenart,
  steuer_kennzeichen steuer_kennzeichen, ist_platzhalter boolean
)
language sql stable
set search_path = pg_catalog, public, app
as $$
  select p.id, p.oz, p.kurztext, p.langtext, p.einheit,
         p.zeitwert_minuten, p.leistungswert_qm_pro_stunde,
         p.standard_einzelpreis_cent, p.kostenart, p.steuer_kennzeichen, p.ist_platzhalter
    from public.leistungskatalog_position p
    join public.leistungskatalog k on k.id = p.katalog_id
   where k.schluessel = p_schluessel
     and k.status = 'aktiv'
     and p.gueltig_ab <= p_stichtag
     and (p.gueltig_bis is null or p.gueltig_bis >= p_stichtag)
   order by p.sortierung, p.oz
$$;

/*
 * 3. Die Leistungswerte. Dieselbe Begruendung, und hier haengt ein PREIS
 * daran: aus `Σ m² ÷ Leistungswert` entsteht die Kalkulationszeit und damit
 * das Angebot (OPS-07, CLN-05). Ein Wert, der zwei Stunden lang der falsche
 * ist, rechnet zwei Stunden lang falsche Angebote.
 */
create or replace function app.leistungswerte_lesen(
  p_stichtag date default app.berlin_heute()
) returns table (
  belagsart_id uuid, code text, bezeichnung text,
  leistungswert_qm_pro_stunde numeric,   -- nicht-geld: m2/h
  ist_platzhalter boolean, quelle text
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app
as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Leistungswerte sind ausserhalb des internen Portals nicht lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('objekt.lesen', app.aktiver_mandant()) then
    raise exception 'objekt.lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select b.id, b.code, b.bezeichnung, b.leistungswert_qm_pro_stunde,
           b.ist_platzhalter, b.quelle
      from public.belagsart b
     where b.mandant_id = app.aktiver_mandant()
       and b.gueltig_ab <= p_stichtag
       and (b.gueltig_bis is null or b.gueltig_bis >= p_stichtag)
     order by b.code;
end $$;

comment on function app.ist_mitglied(uuid, uuid, date) is
  'Invariante 2 / V-103: der Stichtag ist der BERLINER Tag. Mit CURRENT_DATE '
  '(UTC) war jede zwischen 00:00 und 02:00 Berliner Zeit angelegte '
  'Mitgliedschaft fuer bis zu zwei Stunden unwirksam — ein Fehler, der nur '
  'nachts existiert und am Vormittag nicht nachstellbar ist.';
