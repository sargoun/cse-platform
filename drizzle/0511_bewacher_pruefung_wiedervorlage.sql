-- 0511 — die Zuverlaessigkeitsueberpruefung hat eine Wiedervorlage
--        (V-320, O-140, SEC-02, SEC-03, D-815).
--
-- Sachkunde und Unterrichtung nach § 34a GewO sind unbefristet (O-140,
-- D-788); der einzige Anlass einer Nachpruefung ist die
-- Zuverlaessigkeitsueberpruefung der Behoerde, spaetestens nach fuenf Jahren
-- (§ 34a Abs. 1 GewO, Bewacherregister). bewacher_eintrag traegt
-- letzte_pruefung_am und naechste_pruefung_am seit 0031 — gelesen hat sie
-- kein Waechter, und eine leere naechste Pruefung fiel nie auf.
--
-- (1) app.bewacher_naechste_pruefung: die Wiedervorlage eines Eintrags — die
--     eingetragene naechste Pruefung, sonst die letzte plus p_jahre. Gespeichert
--     wird nur, was ein Mensch eintraegt; abgeleitet wird beim Lesen, damit ein
--     Voreinstellungswert nie als Mitteilung der Behoerde in der Zeile steht.
--     Die Jahre gibt der Aufrufer (ZUVERLAESSIGKEIT_JAHRE im Dienst), eine
--     Stelle fuer die Zahl. Ein 29. Februar plus fuenf Jahre ist der 28.
--     Februar — wie date + interval in Postgres immer rechnet.
--
-- (2) kern.bewacher_pruefung_empfaenger: wer die Wiedervorlage einer Person
--     erfaehrt — in jeder Gesellschaft, in der sie aktiv beschaeftigt ist, die
--     Mitglieder mit personal.bewacher_verwalten. Das ist das Recht der
--     Registerseite, auf die die Meldung zeigt (NOT-03). Nur Mitglieder mit
--     gueltiger Mitgliedschaft am Berliner Tag (app.berlin_heute(), 0169) und
--     aktivem Menschenkonto: waechter_meldung nimmt andere nicht an (0149).
--     Mit Slug und Buchung der Gesellschaft — ob Security dort gebucht ist,
--     entscheidet der Waechter mit modulAktiv, dieselbe Regel wie die Seite.
--     Ein Definer wie 0504/0507: der Waechter laeuft unter cse_job, und keine
--     der beiden Rollen sieht Anstellungen und Mitgliedschaften fremder Konten.
--
-- Nur Kommentare mit Doppelstrich.

create function app.bewacher_naechste_pruefung(
  p_letzte date, p_naechste date, p_jahre integer
) returns date
language sql immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_naechste,
    case when p_jahre between 1 and 10
         then (p_letzte + make_interval(years => p_jahre))::date end)
$$;

comment on function app.bewacher_naechste_pruefung(date, date, integer) is
  'V-320, O-140, D-815: die Wiedervorlage der Zuverlaessigkeitsueberpruefung — die '
  'eingetragene naechste Pruefung, sonst die letzte plus p_jahre (1 bis 10). Abgeleitet '
  'beim Lesen, nie gespeichert.';

revoke all on function app.bewacher_naechste_pruefung(date, date, integer) from public;
grant execute on function app.bewacher_naechste_pruefung(date, date, integer)
  to cse_app, cse_job, cse_definer;

create function kern.bewacher_pruefung_empfaenger(p_person uuid)
returns table (mandant_id uuid, slug text, module text[], module_gepflegt boolean,
               benutzer_id uuid)
language sql stable security definer
set search_path = pg_catalog, public, app as $$
  with gesellschaften as (
    select distinct a.mandant_id
      from public.anstellung a
     where a.person_id = p_person
       and a.geloescht_am is null
       and a.status = 'aktiv'
  ),
  mitglieder as (
    select distinct bm.mandant_id, bm.benutzer_id
      from public.benutzer_mandant bm
      join public.benutzer b on b.id = bm.benutzer_id
     where bm.mandant_id in (select g.mandant_id from gesellschaften g)
       and bm.entzogen_am is null
       and bm.gueltig_ab <= app.berlin_heute()
       and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute())
       and b.status = 'aktiv' and b.deaktiviert_am is null and not b.ist_dienstkonto
  )
  select m.id, m.slug, m.module::text[], m.module_gepflegt, mi.benutzer_id
    from gesellschaften g
    join public.mandant m on m.id = g.mandant_id
    join mitglieder mi on mi.mandant_id = g.mandant_id
   where mi.benutzer_id = any (kern.traeger_des_rechts(g.mandant_id, 'personal.bewacher_verwalten'))
$$;

comment on function kern.bewacher_pruefung_empfaenger(uuid) is
  'V-320, O-140, D-815: wer die Wiedervorlage der Zuverlaessigkeitsueberpruefung einer Person '
  'erfaehrt — je Gesellschaft mit aktiver Anstellung die Mitglieder mit '
  'personal.bewacher_verwalten, mit Slug und Modulbuchung der Gesellschaft.';

alter function kern.bewacher_pruefung_empfaenger(uuid) owner to cse_definer;
revoke execute on function kern.bewacher_pruefung_empfaenger(uuid) from public;
grant execute on function kern.bewacher_pruefung_empfaenger(uuid) to cse_job;
